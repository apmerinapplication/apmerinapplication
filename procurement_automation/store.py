"""Transactional shared workflow storage. Never imports or overwrites legacy databases."""
import json
import os
import sqlite3
import uuid
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

def now():
    return datetime.now(timezone.utc).isoformat()


class DashboardReadView:
    """Request-local rows for read-only dashboards; never persisted or reused."""
    def __init__(self, connection):
        self.connection=connection
        self.job_rows={r['id']:dict(r) for r in connection.execute('SELECT * FROM jobs')}
        self.record_rows={jid:[] for jid in self.job_rows}
        for row in connection.execute('SELECT * FROM records ORDER BY created_at'):
            self.record_rows.setdefault(row['job_id'],[]).append(dict(row))

    def execute(self,query,args=()):
        if not query.lstrip().upper().startswith('SELECT '):
            raise RuntimeError('Dashboard read view cannot modify records')
        return self.connection.execute(query,args)

class Store:
    def __init__(self, directory=None):
        self.database_url = os.environ.get('APMERIN_DATABASE_URL', '') if directory is None else ''
        self.is_cloud = bool(self.database_url)
        if os.environ.get('VERCEL') and not self.is_cloud:
            raise RuntimeError('Configure Supabase APMERIN_DATABASE_URL; Vercel cannot use local SQLite')
        if self.is_cloud:
            self.directory = Path(tempfile.gettempdir()) / 'apmerin-cache'
            self.directory.mkdir(parents=True, exist_ok=True)
            self.path = None
            return  # Schema is installed explicitly, never on a web cold start.
        self.directory = Path(directory or os.environ.get('APMERIN_DATA_DIR', Path(__file__).parent / 'shared_data'))
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'workflow.sqlite'
        with self.connection() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,version INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS records_job ON records(job_id,kind);
            CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,job_id TEXT REFERENCES jobs(id),actor TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,message_id TEXT,content_hash TEXT NOT NULL,data TEXT NOT NULL,job_id TEXT REFERENCES jobs(id),status TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS message_thread ON messages(message_id);
            CREATE TABLE IF NOT EXISTS occurrences(mailbox TEXT,folder TEXT,validity TEXT,uid INTEGER,message_key TEXT REFERENCES messages(id),PRIMARY KEY(mailbox,folder,validity,uid));
            CREATE TABLE IF NOT EXISTS checkpoints(mailbox TEXT,folder TEXT,validity TEXT,uid INTEGER,PRIMARY KEY(mailbox,folder));
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reminder_actions(id TEXT PRIMARY KEY,until_date TEXT,reason TEXT,actor TEXT);
            CREATE TABLE IF NOT EXISTS extraction_cache(hash TEXT PRIMARY KEY,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ai_usage(month TEXT PRIMARY KEY,spent REAL NOT NULL DEFAULT 0,reserved REAL NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS worker_state(key TEXT PRIMARY KEY,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,last_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS job_imports(reference TEXT PRIMARY KEY,actor TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS review_flag_actions(job_id TEXT,flag_id TEXT,data TEXT,PRIMARY KEY(job_id,flag_id));
            ''')
            from .tracking import setup
            setup(c)

    @contextmanager
    def connection(self):
        if self.is_cloud:
            import psycopg
            from .postgres import Connection
            # Transaction-pooler compatible: no named prepared statements or session state.
            with psycopg.connect(self.database_url, connect_timeout=8, sslmode='require', prepare_threshold=None) as raw:
                raw.execute('SET LOCAL search_path TO apmerin, pg_catalog')
                raw.execute("SET LOCAL statement_timeout = '15000ms'")
                yield Connection(raw)
            return
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA busy_timeout=30000')
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    @contextmanager
    def transaction(self):
        with self.connection() as c:
            if self.is_cloud:
                # Preserve SQLite's serialized-write semantics, including version/budget checks.
                c.execute('SELECT pg_advisory_xact_lock(69946752)')
            else:c.execute('BEGIN IMMEDIATE')
            yield c

    def blob(self, folder, name):
        from .blobs import LocalBlob, CloudBlob
        return (CloudBlob if self.is_cloud else LocalBlob)(self, folder, name)

    def setting(self, key, default=None, c=None):
        if c is None:
            with self.connection() as conn:
                return self.setting(key, default, conn)
        r = c.execute('SELECT data FROM settings WHERE key=?', (key,)).fetchone()
        return json.loads(r[0]) if r else default

    def set_setting(self, c, key, data):
        c.execute('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', (key,json.dumps(data)))

    def event(self, c, job_id, actor, kind, data):
        c.execute('INSERT INTO events VALUES (?,?,?,?,?,?)',(uuid.uuid4().hex,job_id,actor,kind,json.dumps(data),now()))

    def job(self, c, job_id):
        r = c.job_rows.get(job_id) if isinstance(c,DashboardReadView) else c.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not r:
            raise LookupError('Job not found')
        return dict(json.loads(r['data']),id=r['id'],version=r['version'],created_at=r['created_at'],updated_at=r['updated_at'])

    def records(self,c,job_id,kind=None):
        if isinstance(c,DashboardReadView):
            return [dict(json.loads(r['data']),id=r['id'],kind=r['kind'],created_at=r['created_at']) for r in c.record_rows.get(job_id,[]) if kind is None or r['kind']==kind]
        query = 'SELECT * FROM records WHERE job_id=?'
        args = [job_id]
        if kind:
            query += ' AND kind=?'
            args.append(kind)
        return [dict(json.loads(r['data']),id=r['id'],kind=r['kind'],created_at=r['created_at']) for r in c.execute(query+' ORDER BY created_at',args)]

    def add_record(self,c,job_id,kind,data,actor):
        rid = uuid.uuid4().hex
        c.execute('INSERT INTO records VALUES (?,?,?,?,?)',(rid,job_id,kind,json.dumps(data),now()))
        self.event(c,job_id,actor,kind,dict(data,record_id=rid))
        return rid

    def bump(self,c,job_id):
        c.execute('UPDATE jobs SET version=version+1,updated_at=? WHERE id=?',(now(),job_id))
