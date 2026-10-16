-- Apply once in Supabase SQL Editor. No customer records or credentials.
BEGIN;
CREATE SCHEMA IF NOT EXISTS apmerin;
REVOKE ALL ON SCHEMA apmerin FROM PUBLIC, anon, authenticated;
SET LOCAL search_path TO apmerin, pg_catalog;

            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,version INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS records_job ON records(job_id,kind);
            CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,job_id TEXT REFERENCES jobs(id),actor TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,message_id TEXT,content_hash TEXT NOT NULL,data TEXT NOT NULL,job_id TEXT REFERENCES jobs(id),status TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS message_thread ON messages(message_id);
            CREATE TABLE IF NOT EXISTS occurrences(mailbox TEXT,folder TEXT,validity TEXT,uid BIGINT,message_key TEXT REFERENCES messages(id),PRIMARY KEY(mailbox,folder,validity,uid));
            CREATE TABLE IF NOT EXISTS checkpoints(mailbox TEXT,folder TEXT,validity TEXT,uid BIGINT,PRIMARY KEY(mailbox,folder));
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reminder_actions(id TEXT PRIMARY KEY,until_date TEXT,reason TEXT,actor TEXT);
            CREATE TABLE IF NOT EXISTS extraction_cache(hash TEXT PRIMARY KEY,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ai_usage(month TEXT PRIMARY KEY,spent DOUBLE PRECISION NOT NULL DEFAULT 0,reserved DOUBLE PRECISION NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS worker_state(key TEXT PRIMARY KEY,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,last_at DOUBLE PRECISION NOT NULL);
            CREATE TABLE IF NOT EXISTS job_imports(reference TEXT PRIMARY KEY,actor TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS review_flag_actions(job_id TEXT,flag_id TEXT,data TEXT,PRIMARY KEY(job_id,flag_id));
            
CREATE INDEX IF NOT EXISTS messages_job ON messages(job_id);
CREATE INDEX IF NOT EXISTS messages_review ON messages(status,created_at);
CREATE TABLE IF NOT EXISTS tracking_shipments(id TEXT PRIMARY KEY,carrier TEXT,kind TEXT,number TEXT,data TEXT);
CREATE TABLE IF NOT EXISTS tracking_links(shipment_id TEXT,job_id TEXT,evidence TEXT,PRIMARY KEY(shipment_id,job_id,evidence));
CREATE TABLE IF NOT EXISTS worker_leases(name TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at DOUBLE PRECISION NOT NULL);

ALTER TABLE apmerin.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.users FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.jobs FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.records FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.events FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.messages FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.occurrences FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.checkpoints FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.settings FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.reminder_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.reminder_actions FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.extraction_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.extraction_cache FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.ai_usage FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.worker_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.worker_state FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.login_attempts FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.job_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.job_imports FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.review_flag_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.review_flag_actions FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.tracking_shipments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.tracking_shipments FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.tracking_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.tracking_links FROM PUBLIC, anon, authenticated;
ALTER TABLE apmerin.worker_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apmerin.worker_leases FROM PUBLIC, anon, authenticated;

-- Evidence is accessed only by the authenticated Flask backend.
INSERT INTO storage.buckets (id,name,public,file_size_limit)
VALUES ('apmerin-evidence','apmerin-evidence',false,26214400)
ON CONFLICT (id) DO UPDATE SET public=false;
COMMIT;
