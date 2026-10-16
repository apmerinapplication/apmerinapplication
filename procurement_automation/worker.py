"""One durable worker per data directory. Safe defaults: review mode, no sending."""
import argparse
import json
import os
import time
import threading
from pathlib import Path
from .store import Store, now
from .workflow import Workflow
from .ingestion import scan_mailbox, extract_attachment

def run_once(store, process_ai=True):
    flow=Workflow(store)
    from .job_import import mailbox_configs,run_pending
    configs=mailbox_configs()
    run_pending(store,flow)
    for config in configs:
        state=dict(last_attempt=now(),status='ok')
        try:state['processed']=scan_mailbox(store,flow,config)
        except Exception as exc:
            # Do not log credentials or arbitrary provider responses.
            state.update(status='error',error_type=type(exc).__name__,message='Mailbox scan failed; check folder names, credentials and connectivity.')
        with store.transaction() as c:c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('mailbox:'+config['id'],json.dumps(state)))
    with store.connection() as c:
        pending=[dict(r) for r in c.execute("SELECT id,data FROM messages WHERE status='review' ORDER BY created_at") if not json.loads(r["data"]).get("extracted")][:100]
    for row in pending:
        data=json.loads(row['data'])
        extracts=[]
        from .attachment_rules import ignored,DEFAULT_RULES
        rules=store.setting('attachment_rules',DEFAULT_RULES)
        for a in data['attachments']:
            if ignored(a,rules):continue
            try:extracts.append(dict(hash=a['hash'],**extract_attachment(store,a['hash'],a['filename'])))
            except Exception as e:extracts.append(dict(hash=a['hash'],error=type(e).__name__,needs_vision=True))
        data['extracted']=True;data['extractions']=extracts
        with store.transaction() as c:c.execute('UPDATE messages SET data=? WHERE id=?',(json.dumps(data),row['id']))
    if process_ai:process_pending_ai(store,limit=3)
    with store.transaction() as c:c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('heartbeat',json.dumps(dict(at=now(),mailboxes=len(configs),status='running' if configs else 'not_configured'))))
    from .import_facts import enrich
    from .rfq_identity import reconcile
    reconcile(store,flow)
    with store.connection() as c:imported=[store.job(c,r[0]) for r in c.execute('SELECT id FROM jobs') if store.job(c,r[0]).get('import_review')]
    for job in imported:enrich(store,job.get('company_reference') or job.get('client_reference') or job['requisition_no'],job['id'],'email worker')
    from .tracking import discover,poll
    discover(store);poll(store)
    backup_if_due(store)

def process_pending_ai(store,limit=3):
    """Small, cached background queue; never block dashboard HTTP or mailbox checks."""
    from .ai_credentials import key
    from .ai import propose
    if not key(store):return 0
    with store.connection() as c:
        if store.is_cloud:
            rows=c.execute("""SELECT id,(data::jsonb - 'body_html' - 'identity_body' - 'body_full')::text AS data,job_id
                FROM messages WHERE status IN ('review','ai_pending')
                AND COALESCE((data::jsonb->>'ai_attempted')::boolean,false)=false
                AND COALESCE((data::jsonb->>'extracted')::boolean,false)=true
                AND (job_id IS NOT NULL OR COALESCE((data::jsonb->>'new_rfq')::boolean,false)=true OR jsonb_array_length(COALESCE(data::jsonb->'candidates','[]'::jsonb))>0)
                AND (data::jsonb->>'event'='unknown' OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(data::jsonb->'extractions','[]'::jsonb)) e WHERE e->>'needs_vision'='true'))
                ORDER BY created_at DESC LIMIT ?""",(limit,)).fetchall()
        else:rows=c.execute("SELECT id,data,job_id FROM messages WHERE status IN ('review','ai_pending') ORDER BY created_at DESC").fetchall()
    processed=0
    for row in rows:
        d=json.loads(row['data'])
        if d.get('ai_attempted') or not d.get('extracted') or not (row['job_id'] or d.get('new_rfq') or d.get('candidates')):continue
        if d.get('event')!='unknown' and not any(e.get('needs_vision') for e in d.get('extractions',[])):continue
        outcome=propose(store,row['id']);processed+=1
        if processed>=limit or outcome in ['cooldown','failed','budget_exhausted']:break
    return processed


def ai_loop(store,stop):
    while not stop.is_set():
        try:process_pending_ai(store,limit=1)
        except Exception as exc:
            with store.transaction() as c:c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('gemini',json.dumps(dict(status='error',error_type=type(exc).__name__,last_attempt=now()))))
        stop.wait(3)


def backup_if_due(store):
    if os.environ.get('APMERIN_BACKUP_KEY'):
        with store.connection() as c:
            row=c.execute("SELECT data FROM worker_state WHERE key='backup'").fetchone()
        if not row or json.loads(row[0])['at'][:10]!=now()[:10]:
            from .backup import make_backup
            try:make_backup(store,os.environ.get('APMERIN_BACKUP_DIR',str(store.directory/'backups')),bool(os.environ.get('APMERIN_BACKUP_DESTINATION')))
            except Exception as exc:
                with store.transaction() as c:c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('backup_error',json.dumps(dict(at=now(),error_type=type(exc).__name__,message='Backup failed. Check encryption key and off-server SSH destination.'))))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--once',action='store_true');args=parser.parse_args()
    store=Store()
    if store.is_cloud:raise RuntimeError('Use authenticated request-sized cloud tasks for Supabase/Vercel; no daemon worker is needed')
    # OS lock is released on crashes/restarts; prevents overlapping workers and scans.
    lock=open(store.directory/'worker.lock','a+b')
    if os.name=='nt':
        import msvcrt
        lock.write(b'0');lock.flush();lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    else:
        import fcntl
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    from .job_import import run_pending
    from .mail_sync import due,begin,finish
    stop_ai=threading.Event()
    if not args.once:threading.Thread(target=ai_loop,args=(store,stop_ai),name="gemini-extraction",daemon=True).start()
    maintenance_at=0
    while True:
        if time.monotonic()-maintenance_at>=60:
            backup_if_due(store);maintenance_at=time.monotonic()
            from .tracking import poll
            poll(store)
        if args.once or due(store):
            begin(store)
            try:run_once(store,process_ai=args.once)
            except Exception as exc:
                with store.transaction() as c:c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('mailbox:worker',json.dumps(dict(status='error',error_type=type(exc).__name__))))
            finish(store)
        else:run_pending(store,Workflow(store))
        if args.once:break
        time.sleep(3)

if __name__=='__main__':main()
