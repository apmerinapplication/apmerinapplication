"""Resumable, authenticated request-sized work for Vercel. No daemon threads."""
import imaplib
import json
import os
import re
import ssl
import time
import uuid
from .store import now


def state(store, name, value=None):
    with store.transaction() if value is not None else store.connection() as c:
        if value is not None:c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',(name,json.dumps(value)))
        row=c.execute('SELECT data FROM worker_state WHERE key=?',(name,)).fetchone()
        return json.loads(row[0]) if row else {}


def acquire(store):
    token=uuid.uuid4().hex
    with store.transaction() as c:
        row=c.execute("SELECT data FROM worker_state WHERE key='cloud_lease'").fetchone()
        if row and json.loads(row[0]).get('expires',0)>time.time():return None
        c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('cloud_lease',json.dumps(dict(token=token,expires=time.time()+330))))
    return token


def release(store,token):
    with store.transaction() as c:
        row=c.execute("SELECT data FROM worker_state WHERE key='cloud_lease'").fetchone()
        if row and json.loads(row[0]).get('token')==token:c.execute("DELETE FROM worker_state WHERE key='cloud_lease'")


def extract_one(store,mid=None):
    from .ingestion import extract_attachment
    from .attachment_rules import ignored,DEFAULT_RULES
    with store.connection() as c:
        if mid:rows=c.execute('SELECT id,data FROM messages WHERE id=?',(mid,)).fetchall()
        elif store.is_cloud:
            rows=c.execute("SELECT id,data FROM messages WHERE status='review' AND COALESCE((data::jsonb->>'extracted')::boolean,false)=false ORDER BY created_at DESC LIMIT 1").fetchall()
        else:rows=c.execute("SELECT id,data FROM messages WHERE status='review' ORDER BY created_at DESC").fetchall()
    row=next((r for r in rows if not json.loads(r['data']).get('extracted')),None)
    if not row:return False
    data=json.loads(row['data']);extracts=[];rules=store.setting('attachment_rules',DEFAULT_RULES)
    for a in data.get('attachments',[]):
        if ignored(a,rules):continue
        try:extracts.append(dict(hash=a['hash'],**extract_attachment(store,a['hash'],a['filename'])))
        except Exception as exc:extracts.append(dict(hash=a['hash'],needs_vision=True,error=type(exc).__name__))
    with store.transaction() as c:
        fresh=c.execute('SELECT data FROM messages WHERE id=?',(row['id'],)).fetchone()
        current=json.loads(fresh[0]);current.update(extractions=extracts,extracted=True)
        c.execute('UPDATE messages SET data=? WHERE id=?',(json.dumps(current),row['id']))
    return True


def import_step(store):
    """Persist each folder search and each fetched message, including UIDVALIDITY."""
    from .job_import import mailbox_configs,state as import_state,assemble,reference
    from .workflow import Workflow
    from .ingestion import ingest
    with store.connection() as c:task=c.execute("SELECT * FROM job_imports WHERE status IN ('queued','running') ORDER BY updated_at LIMIT 1").fetchone()
    if not task:return False
    ref=reference(task['reference']);data=json.loads(task['data']);cursor=data.get('cursor',dict(term=0,mailbox=0,folder=0,terms=[ref]));configs=mailbox_configs()
    def save(status='running',**extra):
        data.update(extra,cursor=cursor);import_state(store,ref,status,**data)
    try:
        if not configs:raise ValueError('Mailbox settings missing')
        # After all folders/terms, extract one remaining message per invocation before assembly.
        if cursor['term']>=len(cursor['terms']):
            pattern=re.compile(r'(?<!\w)'+re.escape(ref)+r'(?!\w)',re.I)
            with store.connection() as c:
                matches=[r['id'] for r in c.execute('SELECT id,data FROM messages') if not json.loads(r['data']).get('extracted') and pattern.search(json.loads(r['data']).get('subject','')+'\n'+json.loads(r['data']).get('body_full',json.loads(r['data']).get('body','')))]
            if matches:
                extract_one(store,matches[0]);save(message='Extracting matched document evidence');return True
            jid=assemble(store,Workflow(store),ref,task['actor'])
            if jid:
                with store.connection() as c:job=store.job(c,jid)
                aliases=[reference(v) for v in [job.get('requisition_no'),job.get('client_reference'),job.get('company_reference')] if v and v not in cursor['terms'] and re.fullmatch(r'[A-Za-z0-9 ./_-]{3,100}',v)]
                if aliases:
                    cursor['terms'].extend(dict.fromkeys(aliases));save(message='Searching related client and AP references',job_id=jid);return True
            save('complete' if jid else 'not_found',job_id=jid,message='Evidence card ready; review extracted details.' if jid else 'No matching email found. Check the reference and mailbox folders.');return True
        cfg=configs[cursor['mailbox']];folders=cfg.get('folders',['INBOX','Sent'])
        password=os.environ.get(cfg['password_env'],'')
        if not password:raise ValueError('Missing mailbox secret')
        with imaplib.IMAP4_SSL(cfg['host'],int(cfg.get('port',993)),ssl_context=ssl.create_default_context(),timeout=max(12,min(180,int(cfg.get('history_timeout',120))))) as mail:
            mail.login(cfg['username'],password)
            if folders==['*']:
                if not cursor.get('folders'):
                    status,listing=mail.list();resolved=[]
                    if status!='OK':raise RuntimeError('Folder discovery failed')
                    for line in listing or []:
                        match=re.match(rb'\((.*?)\)\s+(?:"[^"]*"|NIL)\s+(.+)$',line)
                        if match and b'\\Noselect' not in match[1]:resolved.append(match[2].decode())
                    cursor['folders']=resolved
                folders=cursor['folders']
            folder=folders[cursor['folder']];selected=folder if folder.startswith('"') else '"'+folder.replace('"','')+'"'
            if mail.select(selected,readonly=True)[0]!='OK':raise RuntimeError('Folder unavailable')
            validity=mail.response('UIDVALIDITY')[1][0].decode()
            if cursor.get('validity')!=validity:cursor.pop('uids',None)
            cursor['validity']=validity
            if 'uids' not in cursor:
                term=cursor['terms'][cursor['term']]
                status,values=mail.uid('SEARCH',None,'SUBJECT','"'+term+'"')
                if status=='OK' and not (values[0] or b'') and not re.fullmatch(r'Q[0-9]{3,12}',term):
                    status,values=mail.uid('SEARCH',None,'TEXT','"'+term+'"')
                if status!='OK':raise RuntimeError('Search failed')
                cursor['uids']=[int(v) for v in (values[0] or b'').split()]
                save(message='Searching '+cfg['id']+' · '+folder.strip('"'))
            # Persist after every message, including on a killed/restarted invocation.
            batch_started=time.monotonic()
            for _ in range(min(5,len(cursor['uids']))):
                if time.monotonic()-batch_started>10:break
                uid=cursor['uids'][0];status,parts=mail.uid('FETCH',str(uid),'(BODY.PEEK[])')
                if status!='OK':raise RuntimeError('Fetch failed')
                raw=next(p[1] for p in parts if isinstance(p,tuple))
                ingest(store,Workflow(store),raw,cfg['id'],folder.strip('"'),validity,uid,live_monitor=False)
                cursor['uids'].pop(0);data['email_occurrences']=data.get('email_occurrences',0)+1
                save(message='Importing email evidence · '+str(data['email_occurrences'])+' messages saved')
            if not cursor['uids']:
                cursor.pop('uids',None);cursor.pop('validity',None);cursor['folder']+=1
                if cursor['folder']>=len(folders):
                    cursor['folder']=0;cursor['mailbox']+=1;cursor.pop('folders',None)
                    if cursor['mailbox']>=len(configs):cursor['mailbox']=0;cursor['term']+=1
            save(message='Importing email evidence · '+str(data.get('email_occurrences',0))+' messages saved')
        return True
    except Exception as exc:
        save('failed',message='Import paused. Check mailbox access/folders and retry; saved evidence is retained.',error_type=type(exc).__name__)
        return True


def mail_step(store):
    from .mail_sync import due,begin,finish
    from .job_import import mailbox_configs
    from .workflow import Workflow
    from .ingestion import scan_mailbox
    if not due(store) and state(store,'mail_sync').get('status')!='running':return False
    configs=mailbox_configs();progress=state(store,'cloud_mail_cursor')
    if not progress:begin(store);progress=dict(mailbox=0,folder=0)
    if not configs:
        state(store,'mailbox:configuration',dict(status='error',processed=0));finish(store);return False
    # An earlier setup failure must not poison successful checks after credentials
    # are added. Individual mailbox failures remain visible and still fail finish().
    if state(store,'mailbox:configuration').get('status')=='error':
        state(store,'mailbox:configuration',dict(status='ok',processed=0))
    cfg=configs[progress['mailbox']];folders=cfg.get('folders',['INBOX','Sent'])
    # Monitoring uses explicit Inbox/Sent folders; '*' is for historical import only.
    if folders==['*']:folders=cfg.get('monitor_folders',['INBOX','Sent'])
    folder=folders[progress['folder']];previous=state(store,'mailbox:'+cfg['id']) if progress['folder'] else {}
    try:
        processed=scan_mailbox(store,Workflow(store),dict(cfg,folders=[folder],batch_size=5,timeout=12))
        previous.update(status='ok',processed=previous.get('processed',0)+processed,last_attempt=now())
        if not processed:progress['folder']+=1
    except Exception as exc:
        previous.update(status='error',processed=previous.get('processed',0),error_type=type(exc).__name__,last_attempt=now());progress['folder']+=1
    state(store,'mailbox:'+cfg['id'],previous)
    if progress['folder']>=len(folders):progress['folder']=0;progress['mailbox']+=1
    if progress['mailbox']>=len(configs):state(store,'cloud_mail_cursor',{});finish(store)
    else:state(store,'cloud_mail_cursor',progress)
    return True


def tick(store):
    token=acquire(store)
    if not token:return dict(status='busy',changed=False)
    started=time.monotonic();changed=False
    try:
        for _ in range(5):
            progressed=False
            for operation in [import_step,mail_step,extract_one]:
                if time.monotonic()-started<25:
                    worked=operation(store);progressed=worked or progressed;changed=worked or changed
            if not progressed or time.monotonic()-started>=25:break
        if time.monotonic()-started<35:
            from .worker import process_pending_ai
            changed=bool(process_pending_ai(store,limit=1)) or changed
        if changed and time.monotonic()-started<35:
            from .rfq_identity import reconcile
            from .workflow import Workflow
            from .tracking import discover
            reconcile(store,Workflow(store));discover(store)
        if time.monotonic()-started<35:
            from .tracking import poll
            poll(store)
        state(store,'cloud_tick',dict(at=now(),status='ok',duration_seconds=round(time.monotonic()-started,2)))
        return dict(status='ok',changed=changed)
    except Exception as exc:
        state(store,'cloud_tick',dict(at=now(),status='error',error_type=type(exc).__name__))
        return dict(status='error',changed=changed,error='Background processing failed. See Administration.')
    finally:release(store,token)
