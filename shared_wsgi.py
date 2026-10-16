"""Cloud entrypoint: authenticated quotation tools plus shared workflow at /workflow/."""
import os
import secrets
from pathlib import Path
from flask import request,session,jsonify,redirect,render_template
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.middleware.proxy_fix import ProxyFix
from procurement_automation.shared_app import create_app

workflow_app=create_app()
store=workflow_app.extensions['workflow_store']
# Keep legacy runtime persistence on the same private data volume; never migrate credentials.
os.environ['APMERIN_DATA_DIR']=str(store.directory/'legacy')
os.environ['APMERIN_SHARED_MODE']='1'
import app as legacy
legacy.app.secret_key=workflow_app.secret_key
legacy.app.config.update(SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Strict',SESSION_COOKIE_SECURE=os.environ.get('APMERIN_HTTPS')=='1',PERMANENT_SESSION_LIFETIME=workflow_app.config['PERMANENT_SESSION_LIFETIME'],MAX_CONTENT_LENGTH=(4 if store.is_cloud else 25)*1024*1024)
legacy.get_api_key=lambda:'' # No unmetered legacy AI paths in the shared deployment.

@legacy.app.before_request
def shared_security():
    if request.path.startswith('/static/'):
        if request.path in ['/static/email_studio.js','/static/app.js','/static/gemini_engine.js']:
            from prepare_web_assets import asset_bytes
            from flask import Response
            file=Path(__file__).parent/request.path.lstrip('/')
            return Response(asset_bytes(file),mimetype='application/javascript')
        return
    with store.connection() as c:u=c.execute('SELECT role FROM users WHERE id=? AND active=1',(session.get('uid',''),)).fetchone()
    if not u:
        return redirect('/workflow/') if request.method=='GET' else (jsonify(error='Sign in at /workflow/'),401)
    if u['role']=='accounting':return redirect('/workflow/') if request.method=='GET' else (jsonify(error='Procurement role required'),403)
    allowed={'/','/quotation','/api/config/api-key','/api/parse-rfq','/api/parse-quotation','/api/match','/api/recalculate','/api/export-excel','/api/export-csv','/api/download-file'}
    if request.path not in allowed:return jsonify(error='Use shared workflow settings and approved sending'),403
    if request.path=='/api/config/api-key':
        return jsonify(success=True,has_key=False,masked_key='') if request.method=='GET' else (jsonify(error='AI is configured server-side'),403)
    if request.method not in ['GET','HEAD']:
        if u['role']=='accounting':return jsonify(error='Procurement role required'),403
        if not secrets.compare_digest(request.headers.get('X-CSRF-Token',''),session.get('csrf','!')):return jsonify(error='Invalid request token'),403

legacy.app.view_functions['index']=lambda:redirect('/workflow/')
@legacy.app.get('/quotation')
def quotation():return render_template('index.html',default_usd_rates=legacy.USD_BASE_RATES,has_gemini=False)

application=DispatcherMiddleware(legacy.app,{'/workflow':workflow_app})
if os.environ.get('APMERIN_HTTPS')=='1':application=ProxyFix(application,x_for=1,x_proto=1,x_host=1)
