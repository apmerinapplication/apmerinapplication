"""Authenticated shared dashboard; legacy client-provided roles are never trusted."""
import json
import os
import secrets
import time
from datetime import timedelta
from functools import wraps
from pathlib import Path
from flask import Flask, jsonify, request, session, render_template, Response, send_file, redirect
from werkzeug.security import generate_password_hash, check_password_hash
from .store import Store, now
from .workflow import Workflow, DEFAULT_POLICY

def message_metadata(data,review=False):
    # Outlook HTML is fetched through the authenticated preview endpoint on demand.
    omitted={'body_html','identity_body'}|({'body_full'} if review else set())
    return {k:v for k,v in data.items() if k not in omitted}

def create_app(directory=None, testing=False):
    app=Flask(__name__,template_folder='templates',static_folder='static')
    store=Store(directory)
    flow=Workflow(store)
    # Avoid transferring megabytes of Outlook HTML from Postgres for every list/card.
    metadata_sql="(data::jsonb - 'body_html' - 'identity_body')::text" if store.is_cloud else 'data'
    review_sql="(data::jsonb - 'body_html' - 'identity_body' - 'body_full')::text" if store.is_cloud else 'data'
    key=os.environ.get('APMERIN_SESSION_SECRET')
    if key and (len(key)<32 or key.startswith('REPLACE_')):
        raise ValueError('Configure a random session secret of at least 32 characters')
    if not key and store.is_cloud:raise RuntimeError('Configure a stable APMERIN_SESSION_SECRET for cloud sessions')
    if not key:
        path=store.directory/'session.key'
        if not path.exists():
            try:
                fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'w') as f:f.write(secrets.token_hex(32))
            except FileExistsError:pass
        key=path.read_text()
    app.config.update(SECRET_KEY=key,TESTING=testing,SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Strict',SESSION_COOKIE_SECURE=os.environ.get('APMERIN_HTTPS')=='1',PERMANENT_SESSION_LIFETIME=timedelta(hours=8),MAX_CONTENT_LENGTH=(4 if store.is_cloud else 25)*1024*1024)
    app.extensions.update(workflow_store=store,workflow=flow)

    @app.before_request
    def security():
        if request.path.startswith('/static/') or request.path in ['/','/api/login','/api/session','/health','/api/internal/tick']:
            return
        with store.connection() as c:
            u=c.execute('SELECT id,name,role FROM users WHERE id=? AND active=1',(session.get('uid',''),)).fetchone()
        if not u:return jsonify(error='Sign in required'),401
        if request.method not in ['GET','HEAD','OPTIONS'] and not secrets.compare_digest(request.headers.get('X-CSRF-Token',''),session.get('csrf','!')):
            return jsonify(error='Invalid request token'),403

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers.setdefault('X-Frame-Options','DENY')
        response.headers['Referrer-Policy']='same-origin'
        response.headers.setdefault('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'")
        if request.path.startswith('/api/'):response.headers['Cache-Control']='no-store'
        return response

    def user():
        with store.connection() as c:
            u=c.execute('SELECT id,name,role FROM users WHERE id=? AND active=1',(session.get('uid',''),)).fetchone()
            return dict(u) if u else None

    def roles(*allowed):
        def decorate(fn):
            @wraps(fn)
            def wrapped(*args,**kwargs):
                if not user() or user()['role'] not in allowed:return jsonify(error='Role cannot perform this action'),403
                return fn(*args,**kwargs)
            return wrapped
        return decorate

    @app.errorhandler(ValueError)
    def invalid(e):return jsonify(error=str(e)),400
    @app.errorhandler(LookupError)
    def missing(e):return jsonify(error=str(e)),404
    @app.errorhandler(RuntimeError)
    def conflict(e):return jsonify(error=str(e)),409

    @app.get('/')
    def dashboard():return render_template('shared.html',demo=os.environ.get('APMERIN_DEMO')=='1',trial=os.environ.get('APMERIN_TRIAL')=='1')

    @app.get('/health')
    def health():
        if store.is_cloud:
            try:
                with store.connection() as c:c.execute('SELECT id FROM users LIMIT 0')
            except Exception:return jsonify(status='unavailable',message='Cloud database or schema is not ready'),503
        return jsonify(status='ok')

    @app.errorhandler(413)
    def too_large(e):return jsonify(error='This upload exceeds the web request limit. Use a document section smaller than 3 MB.'),413

    @app.post('/api/worksheet/extract')
    @roles('admin','procurement')
    def worksheet_extract():
        from .worksheet_ai import extract
        data=request.get_json() or {}
        return jsonify(items=extract(store,data.get('parts'),data.get('kind','rfq')),review_required=True)

    @app.post('/api/login')
    def login():
        data=request.get_json() or {}
        attempt=request.remote_addr or 'local'
        with store.transaction() as c:
            row=c.execute('SELECT * FROM login_attempts WHERE key=?',(attempt,)).fetchone()
            if row and row['count']>=10 and time.time()-row['last_at']<900:
                return jsonify(error='Too many attempts. Try again in 15 minutes.'),429
            u=c.execute('SELECT * FROM users WHERE id=? AND active=1',(data.get('id',''),)).fetchone()
            valid=check_password_hash(u['password_hash'] if u else generate_password_hash('unused'),data.get('password',''))
            if not u or not valid:
                count=row['count']+1 if row and time.time()-row['last_at']<900 else 1
                c.execute('INSERT OR REPLACE INTO login_attempts VALUES (?,?,?)',(attempt,count,time.time()))
                return jsonify(error='Invalid account or password'),401
            c.execute('DELETE FROM login_attempts WHERE key=?',(attempt,))
        session.clear();session['uid']=u['id'];session['csrf']=secrets.token_urlsafe(32);session.permanent=True
        from .mail_sync import presence
        presence(store,u['id'],True)
        return jsonify(user=dict(id=u['id'],name=u['name'],role=u['role']),csrf=session['csrf'])

    @app.get('/api/session')
    def current_session():return jsonify(user=user(),csrf=session.get('csrf'))

    @app.post('/api/logout')
    def logout():
        with store.transaction() as c:c.execute('DELETE FROM worker_state WHERE key=?',('presence:'+session.get('uid',''),))
        session.clear();return jsonify(success=True)

    @app.route('/api/mail-sync',methods=['GET','POST'])
    def mail_sync():
        from .mail_sync import presence,status
        from .job_import import mailbox_configs
        configured=bool(mailbox_configs())
        if request.method=='POST':presence(store,user()['id'],(request.get_json() or {}).get('check',False) is True)
        result=status(store)
        with store.connection() as c:pending=bool(c.execute("SELECT 1 FROM job_imports WHERE status IN ('queued','running') LIMIT 1").fetchone())
        return jsonify(dict(result,serverless=store.is_cloud,pending_imports=pending,mailbox_configured=configured))

    @app.post('/api/automation/tick')
    def browser_tick():
        if not store.is_cloud:return jsonify(status='local_worker',changed=False)
        from .cloud_tasks import tick
        return jsonify(tick(store))

    @app.post('/api/internal/tick')
    def scheduled_tick():
        secret=os.environ.get('APMERIN_WORKER_SECRET','')
        supplied=request.headers.get('Authorization','')
        if len(secret)<32 or not secrets.compare_digest(supplied,'Bearer '+secret):return jsonify(error='Worker authorization required'),401
        if not store.is_cloud:return jsonify(error='Cloud worker is not configured'),503
        from .cloud_tasks import tick
        return jsonify(tick(store))

    @app.get('/api/users')
    def users():
        with store.connection() as c:return jsonify(users=[dict(r) for r in c.execute('SELECT id,name,role,active FROM users')])

    @app.get('/api/contacts')
    def contacts():return jsonify(contacts=store.setting('contacts',[]))

    @app.put('/api/users/<uid>')
    @roles('admin')
    def change_user(uid):
        data=request.get_json() or {}
        with store.transaction() as c:
            u=c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
            if not u:raise LookupError('Account not found')
            role=data.get('role',u['role'])
            if role not in ['admin','procurement','accounting']:raise ValueError('Unknown role')
            if role!=u['role']:raise ValueError('The five account roles are fixed; change staff names rather than changing seat permissions')
            if u['role']=='admin' and (role!='admin' or data.get('active') is False):raise ValueError('Keep the administrator active')
            password=generate_password_hash(data['password']) if data.get('password') else u['password_hash']
            if data.get('password') and len(data['password'])<12:raise ValueError('Use at least 12 characters')
            c.execute('UPDATE users SET name=?,role=?,active=?,password_hash=? WHERE id=?',(data.get('name',u['name']),role,int(data.get('active',bool(u['active']))),password,uid))
            store.event(c,None,user()['id'],'account_updated',dict(id=uid,role=role))
        return jsonify(success=True)

    @app.get('/api/jobs')
    def jobs():
        with store.connection() as c:
            result=[]
            for row in c.execute('SELECT id FROM jobs ORDER BY updated_at DESC'):
                j=store.job(c,row[0]);j['finance']=flow.finance(c,j)
                from .workflow import effective_owner
                from .dashboard_details import details
                messages=[dict(id=r['id'],**json.loads(r['data'])) for r in c.execute(f'SELECT id,{metadata_sql} AS data FROM messages WHERE job_id=?',(j['id'],))]
                j['client_po_references']=details(store,c,j,store.records(c,j['id']),messages,references_only=True)['client_po_references']
                from .staff_confirmation import summary as staff_summary
                j['staff_status']=staff_summary(store,flow,c,j);j['effective_owner']=effective_owner(j);result.append(j)
        return jsonify(jobs=result)

    @app.post('/api/jobs')
    @roles('admin','procurement')
    def create_job():
        with store.transaction() as c:return jsonify(job=flow.create(c,request.get_json() or {},user()['id'])),201

    @app.route('/api/job-imports',methods=['GET','POST'])
    @roles('admin','procurement')
    def imports():
        from .job_import import queue
        if request.method=='POST':
            result=queue(store,(request.get_json() or {}).get('reference'),user()['id'])
            return jsonify(result),202
        from datetime import datetime,timezone
        with store.connection() as c:
            seen=store.setting('import_notices_seen:'+user()['id'],{},c);result=[]
            for r in c.execute('SELECT * FROM job_imports ORDER BY updated_at DESC LIMIT 30'):
                if r['status']=='complete':
                    try:recent=(datetime.now(timezone.utc)-datetime.fromisoformat(r['updated_at'])).total_seconds()<=300
                    except (ValueError,TypeError):recent=False
                    if not recent or seen.get(r['reference'])==r['updated_at'] or (r['actor']!=user()['id'] and user()['role']!='admin'):continue
                result.append(dict(reference=r['reference'],status=r['status'],completed_at=r['updated_at'],**json.loads(r['data'])))
        return jsonify(imports=result)

    @app.post('/api/job-imports/seen')
    @roles('admin','procurement')
    def import_notices_seen():
        notices=(request.get_json() or {}).get('notices',[])
        if not isinstance(notices,list) or len(notices)>30:raise ValueError('Invalid import notices')
        with store.transaction() as c:
            key='import_notices_seen:'+user()['id'];seen=store.setting(key,{},c)
            for notice in notices:
                if not isinstance(notice,dict):raise ValueError('Invalid import notice')
                row=c.execute('SELECT status,updated_at FROM job_imports WHERE reference=?',(notice.get('reference',''),)).fetchone()
                if row and row['status']=='complete' and row['updated_at']==notice.get('completed_at'):seen[notice['reference']]=row['updated_at']
            store.set_setting(c,key,seen)
        return jsonify(success=True)

    @app.post('/api/jobs/<jid>/transfer')
    @roles('admin','procurement')
    def transfer_job(jid):
        with store.transaction() as c:return jsonify(job=flow.transfer(c,jid,request.get_json() or {},user()['id']))

    @app.post('/api/jobs/<jid>/refresh-import')
    @roles('admin','procurement')
    def refresh_import(jid):
        from .job_import import queue
        with store.connection() as c:
            job=flow.check_version(c,jid,(request.get_json() or {}).get('version'))
        if not job.get('import_review'):raise ValueError('This action is for automatically imported jobs')
        return jsonify(queue(store,job.get('company_reference') or job.get('client_reference') or job['requisition_no'],user()['id'],True)),202

    @app.get('/api/jobs/<jid>')
    def detail(jid):
        with store.connection() as c:
            j=store.job(c,jid);j['finance']=flow.finance(c,j)
            events=[dict(r,data=json.loads(r['data'])) for r in c.execute('SELECT * FROM events WHERE job_id=? ORDER BY created_at DESC',(jid,))]
            messages=[dict(id=r['id'],status=r['status'],**json.loads(r['data'])) for r in c.execute(f'SELECT id,status,{metadata_sql} AS data FROM messages WHERE job_id=?',(jid,))]
            records=store.records(c,jid)
            from .dashboard_details import details
            from .tracking import list_for_job
            from .staff_confirmation import summary as staff_summary
            facts=details(store,c,j,records,messages)
            return jsonify(job=j,staff_status=staff_summary(store,flow,c,j),records=records,events=events,messages=[message_metadata(m) for m in messages],tracking=list_for_job(store,c,jid),**facts)

    @app.post('/api/jobs/<jid>/approve-receipt')
    @roles('admin','procurement','accounting')
    def approve_receipt(jid):
        from .staff_confirmation import approve
        with store.transaction() as c:rid=approve(store,flow,c,jid,request.get_json() or {},user()['id'])
        return jsonify(id=rid),201

    @app.post('/api/jobs/<jid>/confirm-payment')
    @roles('admin','accounting')
    def confirm_payment(jid):
        from .staff_confirmation import payment
        with store.transaction() as c:rid=payment(store,flow,c,jid,request.get_json() or {},user()['id'])
        return jsonify(id=rid),201

    @app.post('/api/tracking/<sid>/manual')
    @roles('admin','procurement')
    def tracking_manual(sid):
        from .tracking import manual
        with store.transaction() as c:manual(store,c,sid,request.get_json() or {},user()['id'])
        return jsonify(success=True)

    @app.post('/api/jobs/<jid>/flags/<fid>')
    @roles('admin','procurement')
    def flag_action(jid,fid):
        from .dashboard_details import details
        data=request.get_json() or {}
        if data.get('status') not in ['reviewed','open'] or not str(data.get('resolution','')).strip():raise ValueError('Record the review outcome before changing the flag')
        with store.transaction() as c:
            job=flow.check_version(c,jid,data.get('version'))
            messages=[dict(id=r['id'],**json.loads(r['data'])) for r in c.execute('SELECT * FROM messages WHERE job_id=?',(jid,))]
            flags=details(store,c,job,store.records(c,jid),messages)['review_flags']
            if not any(f['id']==fid for f in flags):raise LookupError('Flag is no longer present. Reload the job.')
            action=dict(status=data['status'],resolution=str(data['resolution'])[:3000],reviewed_by=user()['id'],reviewed_at=now())
            c.execute('INSERT OR REPLACE INTO review_flag_actions VALUES (?,?,?)',(jid,fid,json.dumps(action)))
            store.event(c,jid,user()['id'],'review_flag_updated',dict(flag_id=fid,**action));store.bump(c,jid)
        return jsonify(success=True)

    @app.put('/api/jobs/<jid>')
    @roles('admin','procurement')
    def update_job(jid):
        with store.transaction() as c:return jsonify(job=flow.update(c,jid,request.get_json() or {},user()['id']))

    @app.put('/api/jobs/<jid>/items')
    @roles('admin','procurement')
    def replace_items(jid):
        from .workflow import number
        import uuid
        data=request.get_json() or {}
        with store.transaction() as c:
            job=flow.check_version(c,jid,data.get('version'))
            records=store.records(c,jid)
            if any(r['kind'] in ['client_po','supplier_po','shipment','delivery','invoice'] or (r['kind']=='supplier_quote' and r.get('lines')) for r in records):raise ValueError('Items already have commercial allocations. Create a reviewed amendment rather than replacing them.')
            items=[]
            for item in data.get('items',[]):
                if not item.get('description'):raise ValueError('Item description required')
                items.append(dict(item,id=uuid.uuid4().hex,quantity=str(number(item['quantity'],True)),unit_price=str(number(item.get('unit_price',0)))))
            if not items:raise ValueError('At least one RFQ item required')
            job['items']=items
            saved={k:v for k,v in job.items() if k not in ['id','version','created_at','updated_at']}
            c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(saved),jid));store.bump(c,jid)
            store.event(c,jid,user()['id'],'rfq_items_revised',dict(items=items))
            return jsonify(job=store.job(c,jid))

    @app.post('/api/jobs/<jid>/records/<kind>')
    def add_record(jid,kind):
        finance_kind=kind in ['invoice','payment']
        role=user()['role']
        payload=request.get_json() or {}
        accounting_draft=role=='accounting' and kind=='draft' and payload.get('purpose')=='payment_follow_up'
        accounting_confirmation=False
        if role=='accounting' and kind=='sent_confirmation':
            with store.connection() as c:accounting_confirmation=any(r['id']==payload.get('draft_id') and r.get('purpose')=='payment_follow_up' for r in store.records(c,jid,'draft'))
        if role!='admin' and not accounting_draft and not accounting_confirmation and ((finance_kind and role!='accounting') or (not finance_kind and role!='procurement')):
            return jsonify(error='Role cannot edit these records'),403
        with store.transaction() as c:return jsonify(id=flow.record(c,jid,kind,payload,user()['id'])),201

    @app.get('/api/reminders')
    def reminders():
        with store.connection() as c:return jsonify(reminders=flow.reminders(c,user()))

    @app.post('/api/jobs/<jid>/review-tasks/<rid>/resolve')
    def resolve_review_task(jid,rid):
        data=request.get_json() or {}
        if not str(data.get('evidence','')).strip():raise ValueError('Record the outcome or evidence before completing this review task')
        with store.transaction() as c:
            flow.check_version(c,jid,data.get('version'))
            task=next((r for r in store.records(c,jid,'review_task') if r['id']==rid),None)
            if not task:raise LookupError('Review task not found')
            role=user()['role']
            if role!='admin' and role!=('accounting' if task.get('finance') else 'procurement'):return jsonify(error='Role cannot complete this task'),403
            task.update(resolved=True,resolution=str(data['evidence']),resolved_by=user()['id'],resolved_at=now())
            saved={k:v for k,v in task.items() if k not in ['id','kind','created_at']}
            c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(saved),rid));store.bump(c,jid)
            store.event(c,jid,user()['id'],'review_task_completed',dict(task_id=rid,evidence=data['evidence']))
        return jsonify(success=True)

    @app.post('/api/reminders/snooze')
    def snooze():
        from .workflow import day
        data=request.get_json() or {}
        if not data.get('reason'):raise ValueError('Snooze reason required')
        day(data.get('until'))
        from datetime import datetime
        from zoneinfo import ZoneInfo
        if day(data['until'])<=datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date():raise ValueError('Choose a future reminder date')
        with store.transaction() as c:
            valid=next((r for r in flow.reminders(c,user()) if r['id']==data.get('id')),None)
            if not valid:raise ValueError('Reminder is not active for this role')
            c.execute('INSERT OR REPLACE INTO reminder_actions VALUES (?,?,?,?)',(data['id'],data['until'],data['reason'],user()['id']))
            store.event(c,valid['job_id'],user()['id'],'reminder_snoozed',data)
        return jsonify(success=True)

    @app.get('/api/policy')
    def policy():return jsonify(policy=store.setting('policy',DEFAULT_POLICY))

    @app.put('/api/policy')
    @roles('admin')
    def policy_update():
        from .workflow import day
        data=request.get_json() or {}
        p=dict(DEFAULT_POLICY,**data)
        if not p['working_days'] or any(type(v)!=int or v not in range(7) for v in p['working_days']):raise ValueError('Select working days 0 (Monday) through 6 (Sunday)')
        for k in ['question_days','quote_days','dispatch_days','payment_days']:
            if type(p[k])!=int or not 0<=p[k]<=365:raise ValueError('Deadline intervals must be 0–365 days')
        for value in p['holidays']:day(value)
        with store.transaction() as c:store.set_setting(c,'policy',p);store.event(c,None,user()['id'],'policy_changed',p)
        return jsonify(policy=p)

    @app.get('/api/review')
    @roles('admin','procurement')
    def review():
        from .rfq_identity import facts
        with store.connection() as c:
            messages=[]
            for r in c.execute(f"SELECT id,status,created_at,job_id,{review_sql} AS data FROM messages WHERE status IN ('review','ai_pending') ORDER BY created_at"):
                data=json.loads(r['data']);data['rfq_suggestion']=facts(data)
                messages.append(dict(id=r['id'],status=r['status'],created_at=r['created_at'],**data,job_id=r['job_id']))
            from .rfq_alerts import group_alerts
            alerts=group_alerts(store,c,messages)
            scope=request.args.get('scope','all')
            if scope not in ['all','new']:raise ValueError('Invalid review scope')
            filtered=sorted([m for m in messages if scope!='new' or m.get('new_rfq') and not m.get('job_id')],key=lambda m:(m['created_at'],m['id']))
            cursor=request.args.get('cursor','')
            if cursor:
                row=c.execute('SELECT created_at,id FROM messages WHERE id=?',(cursor,)).fetchone()
                if row:filtered=[m for m in filtered if (m['created_at'],m['id'])>(row['created_at'],row['id'])]
            page=[];size=0
            for m in filtered[:25]:
                value=message_metadata(m,review=True);encoded=len(json.dumps(value).encode())
                if page and size+encoded>2500000:break
                page.append(value);size+=encoded
            next_cursor=page[-1]['id'] if page and len(page)<len(filtered) else None
            return jsonify(messages=page,rfq_alerts=alerts,next_cursor=next_cursor)

    @app.post('/api/review/<mid>')
    @roles('admin','procurement')
    def review_message(mid):
        from .ingestion import approve_message
        with store.transaction() as c:return jsonify(result=approve_message(store,flow,c,mid,request.get_json() or {},user()['id']))

    @app.get('/api/attachments/<digest>')
    def attachment(digest):
        import re
        if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Invalid attachment')
        path=store.blob('attachments',digest)
        if not path.is_file():raise LookupError('Attachment missing')
        with store.connection() as c:
            metadata=None
            for row in c.execute('SELECT data FROM messages'):
                metadata=next((a for a in json.loads(row[0]).get('attachments',[]) if a['hash']==digest),None)
                if metadata:break
        mime=(metadata or {}).get('content_type','application/octet-stream')
        inline=request.args.get('preview')=='1' and mime.startswith('image/') and mime!='image/svg+xml'
        if store.is_cloud:return redirect(path.signed_download(None if inline else (metadata or {}).get('filename',digest)),code=303)
        return send_file(path.download(),as_attachment=not inline,download_name=(metadata or {}).get('filename',digest),mimetype=mime if inline else 'application/octet-stream')

    @app.route('/api/attachment-rules',methods=['GET','PUT'])
    def attachment_rules():
        from .attachment_rules import DEFAULT_RULES
        if request.method=='GET':return jsonify(rules=store.setting('attachment_rules',DEFAULT_RULES))
        if user()['role']!='admin':return jsonify(error='Only the administrator can change backend extraction rules'),403
        data=request.get_json() or {}
        patterns=data.get('patterns',[]);overrides=data.get('overrides',{})
        if not isinstance(patterns,list) or len(patterns)>100 or any(not isinstance(p,str) or len(p)>200 for p in patterns):raise ValueError('Invalid filename patterns')
        import re
        if not isinstance(overrides,dict) or len(overrides)>2000 or any(not re.fullmatch('[a-f0-9]{64}',k) or v not in ['ignore','include'] for k,v in overrides.items()):raise ValueError('Invalid attachment overrides')
        data=dict(ignore_inline=bool(data.get('ignore_inline',True)),patterns=patterns,overrides=overrides)
        with store.transaction() as c:
            store.set_setting(c,'attachment_rules',data)
            store.event(c,None,user()['id'],'attachment_rules_changed',data)
        return jsonify(rules=data)

    @app.get('/api/messages/<mid>/preview')
    def email_preview(mid):
        from .mail_preview import preview_html
        with store.connection() as c:
            row=c.execute('SELECT data FROM messages WHERE id=?',(mid,)).fetchone()
        if not row:raise LookupError('Message missing')
        response=Response(preview_html(json.loads(row[0]),request.script_root),mimetype='text/html')
        response.headers['X-Frame-Options']='SAMEORIGIN'
        response.headers['Content-Security-Policy']="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-popups"
        if store.is_cloud:
            response.headers['Content-Security-Policy']=response.headers['Content-Security-Policy'].replace("img-src 'self' data:","img-src 'self' data: "+os.environ['APMERIN_SUPABASE_URL'].rstrip('/'))
        return response

    @app.get('/api/messages/<mid>/original')
    def original_email(mid):
        import re
        if not re.fullmatch('[a-f0-9]{64}',mid):raise ValueError('Invalid message')
        path=store.blob('original_emails',mid+'.eml')
        if not path.is_file():raise LookupError('Original email unavailable')
        if store.is_cloud:return redirect(path.signed_download('original-email.eml'),code=303)
        return send_file(path.download(),as_attachment=True,download_name='original-email.eml',mimetype='message/rfc822')

    @app.get('/api/attachments/<digest>/pages')
    def document_pages(digest):
        import re,pymupdf
        if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Invalid attachment')
        path=store.blob('attachments',digest)
        if not path.is_file():raise LookupError('Attachment missing')
        with pymupdf.open(stream=path.read_bytes(),filetype='pdf') as doc:
            return jsonify(pages=len(doc))

    @app.get('/api/attachments/<digest>/pages/<int:page>')
    def document_page(digest,page):
        import re,pymupdf
        if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Invalid attachment')
        path=store.blob('attachments',digest)
        if not path.is_file():raise LookupError('Attachment missing')
        with pymupdf.open(stream=path.read_bytes(),filetype='pdf') as doc:
            if page<0 or page>=len(doc):raise ValueError('Invalid page')
            return Response(doc[page].get_pixmap(matrix=pymupdf.Matrix(1.3,1.3)).tobytes('png'),mimetype='image/png')

    @app.get('/api/messages/<mid>')
    def message(mid):
        with store.connection() as c:
            r=c.execute('SELECT data FROM messages WHERE id=?',(mid,)).fetchone()
            if not r:raise LookupError('Message missing')
            return jsonify(message=message_metadata(json.loads(r[0])))

    @app.get('/api/jobs/<jid>/invoice-export')
    @roles('admin','accounting')
    def export(jid):
        with store.connection() as c:text=flow.export_invoice(c,jid)
        return Response('\ufeff'+text,mimetype='text/tab-separated-values',headers={'Content-Disposition':f'attachment; filename="{jid}-accounting.tsv"'})

    @app.get('/api/automation')
    @roles('admin')
    def automation():
        with store.connection() as c:
            states={r['key']:json.loads(r['data']) for r in c.execute('SELECT * FROM worker_state')}
            checkpoints=[dict(r) for r in c.execute('SELECT * FROM checkpoints')]
            usage=[dict(r) for r in c.execute('SELECT * FROM ai_usage')]
            from .ai_credentials import key as ai_key
            from .ai import MODEL
            return jsonify(ai=dict(configured=bool(ai_key(store)),provider='Gemini',model=MODEL),states=states,checkpoints=checkpoints,ai_usage=usage,ai_cap_usd=10,mode=store.setting('automation_mode','review',c))

    @app.put('/api/automation')
    @roles('admin')
    def automation_update():
        mode=(request.get_json() or {}).get('mode')
        if mode not in ['review','automatic']:raise ValueError('Use review or automatic')
        with store.transaction() as c:store.set_setting(c,'automation_mode',mode);store.event(c,None,user()['id'],'automation_mode',dict(mode=mode))
        return jsonify(mode=mode)

    @app.post('/api/jobs/<jid>/attachments')
    def upload_evidence(jid):
        import hashlib
        from werkzeug.utils import secure_filename
        file=request.files.get('file')
        if not file:raise ValueError('Select a document')
        raw=file.read()
        if not raw:raise ValueError('Document is empty')
        digest=hashlib.sha256(raw).hexdigest()
        with store.transaction() as c:
            store.job(c,jid)
            path=store.blob('attachments',digest)
            if not path.exists():path.write_bytes(raw)
            store.add_record(c,jid,'document',dict(hash=digest,filename=secure_filename(file.filename),evidence='attachment:'+digest),user()['id'])
            store.bump(c,jid)
            version=store.job(c,jid)['version']
        return jsonify(hash=digest,version=version)

    @app.get('/api/jobs/<jid>/document/<kind>')
    def document(jid,kind):
        from html import escape
        from decimal import Decimal
        from .workflow import number
        if kind not in ['client_quote','supplier_po']:raise ValueError('Unknown document kind')
        with store.connection() as c:
            job=store.job(c,jid)
            supplier_po=next((r for r in store.records(c,jid,'supplier_po') if r['id']==request.args.get('record')),None) if kind=='supplier_po' else None
            if kind=='supplier_po' and not supplier_po:raise ValueError('Select a verified supplier PO record')
        total=Decimal(0);rows=[]
        for i in job['items']:
            line=next((l for l in supplier_po['lines'] if l['item_id']==i['id']),None) if supplier_po else None
            if supplier_po and line is None:continue
            quantity=line['quantity'] if line else i['quantity']
            price=line.get('unit_cost',0) if line else i['unit_price']
            if supplier_po and 'unit_cost' not in line:raise ValueError('Verify supplier PO unit costs before generating a commercial document')
            value=number(quantity)*number(price);total+=value
            rows.append('<tr>'+''.join('<td>'+escape(str(v))+'</td>' for v in [i.get('part_no') or i.get('item_code',''),i['description'],quantity,i.get('uom','PCS'),price,value])+'</tr>')
        title='Supplier purchase order draft' if supplier_po else 'Client quotation draft'
        currency=supplier_po.get('currency',job['currency']) if supplier_po else job['currency']
        content='<html><head><meta charset="utf-8"><title>'+title+'</title></head><body><h1>AP Merin Services — '+title+'</h1><p>'+escape(job['id']+' / '+job['client_name']+' / '+job['vessel_name'])+'</p><p>Review prices, tax, validity, terms and supplier lead times before issuing.</p><table border="1"><tr><th>Code</th><th>Description</th><th>Quantity</th><th>Unit</th><th>Unit price</th><th>Line total</th></tr>'+''.join(rows)+'</table><p>Total '+escape(currency+' '+str(total))+'</p></body></html>'
        return Response(content,mimetype='text/html')

    @app.get('/api/jobs/<jid>/comparison')
    def comparison(jid):
        from matcher import match_rfq_and_quotation
        from .workflow import number
        rates=json.loads(request.args.get('rates','{}'))
        with store.connection() as c:job=store.job(c,jid);quotes=store.records(c,jid,'supplier_quote')
        result=[]
        for quote in quotes:
            if not quote.get('lines'):continue
            currency=quote.get('currency',job['currency'])
            rate=1 if currency==job['currency'] else rates.get(currency)
            if rate is None:raise ValueError('Provide a reviewed '+currency+' to '+job['currency']+' exchange rate')
            rate=float(number(rate,True));items=[]
            for line in quote['lines']:
                baseline=next(i for i in job['items'] if i['id']==line['item_id'])
                net=number(line['unit_cost'])*(1-number(line.get('discount_percent',0))/100)
                items.append(dict(baseline,quantity=float(number(line['quantity'])),unit_price=float(net),remarks=line.get('remarks','')))
            baseline=[dict(i,quantity=float(number(i['quantity']))) for i in job['items']]
            matched=match_rfq_and_quotation(baseline,items,fx_rate=rate,markup_percent=0,supplier_currency=currency,target_currency=job['currency'],mode='po')
            result.append(dict(supplier=quote['supplier_email'],reference=quote.get('reference',''),currency=currency,fx_rate=rate,lead_time=quote.get('lead_time',''),rows=matched))
        return jsonify(comparison=result,currency=job['currency'],baseline_count=len(job['items']))

    @app.get('/api/biztory-mapping')
    @roles('admin','accounting')
    def biztory_mapping():return jsonify(mapping=store.setting('biztory_mapping',{}),columns=store.setting('biztory_template',[]))

    @app.post('/api/biztory-template')
    @roles('admin')
    def biztory_template():
        import csv,io
        file=request.files.get('file')
        if not file:raise ValueError('Select the current Biztory sample CSV')
        columns=next(csv.reader(io.StringIO(file.read().decode('utf-8-sig'))),[])
        if not columns or len(columns)!=len(set(columns)):raise ValueError('CSV must have unique column headings')
        with store.transaction() as c:store.set_setting(c,'biztory_template',columns);store.set_setting(c,'biztory_mapping',{})
        return jsonify(columns=columns)

    @app.get('/api/jobs/<jid>/draft-template/<purpose>')
    def draft_template(jid,purpose):
        with store.connection() as c:
            job=store.job(c,jid);profile=store.setting('profile:'+user()['id'],{},c)
            suppliers=[r for r in store.records(c,jid) if r['kind'] in ['supplier_rfq','supplier_po']];recipient=suppliers[-1]['supplier_email'] if suppliers else ''
            if purpose=='supplier_rfq':body='Good day, please quote price, availability and lead time:\n'+ '\n'.join(f"{i['description']} | P/N {i.get('part_no','')} | Qty {i['quantity']} {i.get('uom','PCS')}" for i in job['items'])+'\nVessel: '+job['vessel_name']
            elif purpose=='follow_up':body='Good day, please confirm status, promised dispatch date and outstanding requirements for '+job['requisition_no']+'.'
            elif purpose=='client_quote':recipient=job['client_email'];body='Good day, please find our reviewed quotation for '+job['requisition_no']+'.\nConfirm approved pricing, terms and attachments before sending.'
            elif purpose=='payment_follow_up':
                if user()['role']=='procurement':return jsonify(error='Accounting role required'),403
                recipient=job['client_email'];body='Good day, please confirm payment status:\n'+'\n'.join(r['reference']+' | Due '+r['due_date'] for r in store.records(c,jid,'invoice'))
            else:raise ValueError('Unknown template purpose')
        return jsonify(purpose=purpose,to=recipient,subject='['+jid+'] '+purpose.replace('_',' ').title()+' - '+job['vessel_name'],body=body,cc=profile.get('default_cc',''))

    @app.put('/api/biztory-mapping')
    @roles('admin')
    def set_mapping():
        data=request.get_json() or {}
        fields={'job_reference','customer','currency','item_code','description','quantity','unit_price','line_total','export_reference'}
        columns=store.setting('biztory_template',[])
        if not columns:raise ValueError('Import the current Biztory sample CSV headings first')
        if set(data)!=set(columns):raise ValueError('Map every sample heading; use a constant for blank/unused fields')
        for entry in data.values():
            if not isinstance(entry,dict) or (entry.get('field') not in fields and 'constant' not in entry):raise ValueError('Mapping must specify a supported field or constant')
        with store.transaction() as c:store.set_setting(c,'biztory_mapping',data)
        return jsonify(success=True)

    @app.get('/api/jobs/<jid>/biztory-export')
    @roles('admin','accounting')
    def biztory_export(jid):
        import csv,io
        from .workflow import number
        with store.transaction() as c:
            job=store.job(c,jid);ready=flow.finance(c,job)['eligible_quantities'];mapping=store.setting('biztory_mapping',{},c);columns=store.setting('biztory_template',[],c)
            if not mapping or not columns:raise ValueError('Configure the current Biztory CSV mapping first; use TSV until then')
            if not ready:raise ValueError('No uninvoiced delivered quantities')
            versioned_ref=jid+'-V'+str(job['version'])
            out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(columns)
            for i in job['items']:
                if i['id'] not in ready:continue
                fields=dict(job_reference=jid,export_reference=versioned_ref,customer=job['client_name'],currency=job['currency'],item_code=i.get('part_no') or i.get('item_code',''),description=i['description'],quantity=ready[i['id']],unit_price=i['unit_price'],line_total=str(number(ready[i['id']])*number(i['unit_price'])))
                values=[str(fields.get(mapping[col].get('field'),mapping[col].get('constant',''))) for col in columns]
                writer.writerow([("'"+v) if v.startswith(('=','+','-','@')) else v for v in values])
            store.event(c,jid,user()['id'],'biztory_export',dict(reference=versioned_ref,quantities=ready))
        return Response('\ufeff'+out.getvalue(),mimetype='text/csv',headers={'Content-Disposition':f'attachment; filename="{jid}-biztory.csv"'})

    @app.post('/api/jobs/<jid>/send/<rid>')
    @roles('admin','procurement','accounting')
    def approved_send(jid,rid):
        from .sending import send_approved
        data=request.get_json() or {}
        if data.get('approved') is not True:raise ValueError('Explicit staff approval required')
        if user()['role']=='accounting':
            with store.connection() as c:
                draft=next((r for r in store.records(c,jid,'draft') if r['id']==rid),None)
                if not draft or draft.get('purpose')!='payment_follow_up':return jsonify(error='Accounting can send payment follow-ups only'),403
        result=send_approved(store,flow,jid,rid,data.get('version'),user()['id'])
        return jsonify(result=result)

    return app

app=create_app() if __name__=='__main__' else None
if __name__=='__main__':app.run(host='127.0.0.1',port=5010,debug=False)
