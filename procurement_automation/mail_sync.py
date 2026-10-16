"""Coalesced login refresh and ten-minute checks while authenticated users are active."""
import json
import uuid
from datetime import datetime,timezone,timedelta
from .store import now

INTERVAL_SECONDS=600

def presence(store,uid,request_check=False):
    with store.transaction() as c:
        c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('presence:'+uid,json.dumps(dict(at=now()))))
        if request_check:
            row=c.execute("SELECT data FROM worker_state WHERE key='mail_sync'").fetchone()
            state=json.loads(row[0]) if row else {}
            if state.get('status') not in ['queued','running']:
                state.update(status='queued',request_id=uuid.uuid4().hex,requested_at=now())
                c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('mail_sync',json.dumps(state)))

def status(store):
    with store.connection() as c:
        row=c.execute("SELECT data FROM worker_state WHERE key='mail_sync'").fetchone()
    return dict(interval_seconds=INTERVAL_SECONDS,**(json.loads(row[0]) if row else dict(status='idle')))

def due(store,at=None):
    at=at or datetime.now(timezone.utc)
    with store.connection() as c:
        row=c.execute("SELECT data FROM worker_state WHERE key='mail_sync'").fetchone();state=json.loads(row[0]) if row else {}
        if state.get('status')=='queued':return True
        if state.get('status')=='running' and at-datetime.fromisoformat(state.get('started_at',now()))<timedelta(minutes=10):return False
        active=any(at-datetime.fromisoformat(json.loads(r[0])['at'])<timedelta(seconds=150) for r in c.execute("SELECT data FROM worker_state WHERE key LIKE 'presence:%'"))
        completed=state.get('completed_at')
        return active and (not completed or (at-datetime.fromisoformat(completed)).total_seconds()>=INTERVAL_SECONDS)

def begin(store):
    with store.transaction() as c:
        row=c.execute("SELECT data FROM worker_state WHERE key='mail_sync'").fetchone();state=json.loads(row[0]) if row else {}
        state.update(status='running',started_at=now())
        c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('mail_sync',json.dumps(state)))

def finish(store):
    with store.transaction() as c:
        row=c.execute("SELECT data FROM worker_state WHERE key='mail_sync'").fetchone();state=json.loads(row[0]) if row else {}
        mailboxes=[json.loads(r[0]) for r in c.execute("SELECT data FROM worker_state WHERE key LIKE 'mailbox:%'")]
        state.update(status='error' if not mailboxes or any(m.get('status')=='error' for m in mailboxes) else 'complete',completed_at=now(),processed=sum(m.get('processed',0) for m in mailboxes),message='Email check failed; see Administration.' if not mailboxes or any(m.get('status')=='error' for m in mailboxes) else 'Inbox and Sent emails checked')
        c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('mail_sync',json.dumps(state)))
