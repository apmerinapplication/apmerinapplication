"""Vercel Flask entrypoint. Cloud-only persistence; no desktop runtime or daemon."""
import os
import tempfile
from pathlib import Path
from flask import Flask
from procurement_automation.cloud_config import validate_cloud_environment


# Vercel discovers this Flask instance. The existing authenticated quotation tools
# remain available, and / redirects to the shared dashboard at /workflow/.
app=Flask('apmerin_web',static_folder=None)
try:
    validate_cloud_environment()
except (RuntimeError, ValueError):
    # Keep every application route closed, without crashing the function runtime.
    # Never import the local application or create storage when setup is incomplete.
    app.logger.error('Cloud configuration is missing or invalid. Check the required Vercel environment variables.')

    @app.route('/', defaults={'path': ''}, methods=['GET','POST','PUT','PATCH','DELETE','OPTIONS'])
    @app.route('/<path:path>', methods=['GET','POST','PUT','PATCH','DELETE','OPTIONS'])
    def setup_required(path):
        headers={'Cache-Control':'no-store','Retry-After':'300',
                 'X-Content-Type-Options':'nosniff',
                 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}
        if path.endswith('/health') or '/api/' in '/'+path:
            return {'ok':False,'error':'cloud_configuration_required'},503,headers
        return '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AP Merin · Setup required</title>
<style>body{margin:0;background:#f3f6fa;color:#10234b;font:17px/1.6 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}main{margin:24px;padding:40px;max-width:580px;background:white;border:1px solid #dce4ed;border-radius:16px}small{color:#307382;letter-spacing:2px}h1{line-height:1.2}p{color:#52657d}</style>
<main><small>AP MERIN SERVICES</small><h1>Cloud setup required</h1>
<p>The application is deployed, but its server settings are incomplete. An administrator needs to configure the required environment variables in Vercel and redeploy.</p>
<p>The dashboard will become available after configuration and database setup are verified.</p></main></html>''',503,headers
else:
    os.environ['APMERIN_DATA_DIR']=str(Path(tempfile.gettempdir())/'apmerin-web-scratch')
    os.environ['APMERIN_HTTPS']='1'
    os.environ['APMERIN_TRIAL']='0'
    os.environ['APMERIN_DEMO']='0'
    from shared_wsgi import application
    app.wsgi_app=application
