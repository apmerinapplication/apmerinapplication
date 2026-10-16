"""Fail closed before constructing any production application or storage client."""
import os
from urllib.parse import urlsplit


def validate_cloud_environment():
    required=['APMERIN_DATABASE_URL','APMERIN_SUPABASE_URL','APMERIN_SUPABASE_SERVICE_KEY',
              'APMERIN_SESSION_SECRET','APMERIN_WORKER_SECRET','APMERIN_GEMINI_KEY']
    missing=[name for name in required if not os.environ.get(name,'').strip()]
    if missing:raise RuntimeError('Missing server environment variables: '+', '.join(missing))
    database=urlsplit(os.environ['APMERIN_DATABASE_URL'])
    if database.scheme not in ['postgresql','postgres'] or not database.hostname or not database.username or not database.password:
        raise RuntimeError('Configure the complete Supabase Postgres transaction-pooler URI')
    storage=urlsplit(os.environ['APMERIN_SUPABASE_URL'])
    if storage.scheme!='https' or not storage.hostname or storage.username or storage.query or storage.fragment or storage.path not in ['','/']:
        raise RuntimeError('Configure the HTTPS Supabase project URL')
    for name in ['APMERIN_SESSION_SECRET','APMERIN_WORKER_SECRET']:
        if len(os.environ[name])<32 or os.environ[name].startswith('REPLACE_'):
            raise RuntimeError('Configure a random '+name+' of at least 32 characters')
    if os.environ['APMERIN_SESSION_SECRET']==os.environ['APMERIN_WORKER_SECRET']:
        raise RuntimeError('Session and worker secrets must be different')
