"""Durable reference imports, read-only IMAP and conservative evidence cards."""
import imaplib
import json
import os
import re
import ssl
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from email.utils import parsedate_to_datetime
from .store import now
from .ingestion import ingest,extract_attachment
from .attachment_rules import ignored,DEFAULT_RULES

def reference(value):
    value=str(value).strip().upper()
    if not re.fullmatch(r'[A-Z0-9][A-Z0-9 ./_-]{2,99}',value) or not any(c.isdigit() for c in value):raise ValueError('Enter a client RFQ reference such as EXP/RFQ/S/26/0062, RN 26-0011 or an AP reference such as Q7113')
    return value

def existing(store,c,ref):
    matches=[store.job(c,r[0]) for r in c.execute('SELECT id FROM jobs') if ref in [str(store.job(c,r[0]).get(k,'')).upper() for k in ['company_reference','client_reference','requisition_no']]]
    if len(matches)>1:raise ValueError('This client reference belongs to multiple jobs. Open the correct vessel card or use its AP reference.')
    return matches[0] if matches else None

def mailbox_configs():
    configs=json.loads(os.environ.get('APMERIN_MAILBOXES','[]'))
    # Explicit local trial bridge; production uses server environment secrets only.
    if not configs and os.environ.get('APMERIN_TRIAL')=='1':
        root=Path(__file__).resolve().parents[1]
        profiles=json.loads((root/'ap_merin_user_profiles.json').read_text(encoding='utf-8-sig'))
        cfg=json.loads((root/'email_automation/config.json').read_text(encoding='utf-8-sig'))
        profile=next(u for u in profiles['users'] if u.get('email','').lower()=='suga@apmerinservices.com.my')
        os.environ['APMERIN_TRIAL_MAIL_SECRET']=profile['password']
        configs=[dict(id='suga',username=profile['email'],host=cfg.get('imap_host') or cfg['smtp_host'],password_env='APMERIN_TRIAL_MAIL_SECRET',folders=['INBOX','Sent Items'])]
        from .local_mailboxes import accounting_config
        accounting=accounting_config(root,cfg.get('imap_host') or cfg['smtp_host'])
        if accounting:configs.append(accounting)
    return configs

def select_import_mailboxes(actor,configs):
    """Select a person's mailbox and Nurul, never substitute another staff member."""
    own=next((cfg for cfg in configs if cfg.get('user_id',cfg.get('id'))==actor),None)
    accounting=next((cfg for cfg in configs if cfg.get('id') in ['nurul','accounting'] or cfg.get('username','').lower()=='nurul@apmerinservices.com.my'),None)
    missing=[]
    if not own:missing.append(actor)
    if not accounting:missing.append('Nurul (accounting)')
    if missing:raise ValueError('Connect the mailbox for '+', '.join(missing)+' before scanning this job. Both the responsible user and Nurul must be available.')
    return [own]+([accounting] if accounting['id']!=own['id'] else [])


def import_mailboxes(data,actor):
    configs=mailbox_configs()
    if not data.get('mailbox_ids'):
        return select_import_mailboxes(data.get('mailbox_user',actor),configs)
    indexed={cfg['id']:cfg for cfg in configs}
    missing=[uid for uid in data['mailbox_ids'] if uid not in indexed]
    if missing:raise ValueError('Required import mailbox is no longer connected: '+', '.join(missing))
    return [indexed[uid] for uid in data['mailbox_ids']]


def queue(store,ref,actor,refresh=False,mailbox_user=None):
    ref=reference(ref)
    with store.transaction() as c:
        job=existing(store,c,ref)
        row=c.execute('SELECT * FROM job_imports WHERE reference=?',(ref,)).fetchone()
        resumable=store.is_cloud and row and row['status']=='failed' and json.loads(row['data']).get('cursor')
        if job and not refresh and not resumable:return dict(reference=ref,status='complete',job_id=job['id'],message='Existing job opened; no duplicate created.')
        if row and (row['status'] in ['queued','running'] or row['status']=='complete' and not refresh):return dict(reference=ref,status=row['status'],**json.loads(row['data']))
        resume=json.loads(row['data']) if store.is_cloud and row and row['status']=='failed' and not refresh else {}
        scan_user=resume.get('mailbox_user') or mailbox_user or actor
        if scan_user!=actor and not resume.get('mailbox_user'):
            admin=c.execute("SELECT 1 FROM users WHERE id=? AND role='admin' AND active=1",(actor,)).fetchone()
            target=c.execute("SELECT 1 FROM users WHERE id=? AND role='procurement' AND active=1",(scan_user,)).fetchone()
            if not admin or not target:raise ValueError('Only an administrator can select another procurement mailbox')
        selected=import_mailboxes(resume,scan_user) if resume.get('mailbox_ids') else select_import_mailboxes(scan_user,mailbox_configs())
        labels=[cfg.get('name') or ('Nurul' if cfg['id'] in ['nurul','accounting'] else scan_user.title()) for cfg in selected]
        resume.update(mailbox_user=scan_user,mailbox_ids=[cfg['id'] for cfg in selected],mailbox_names=labels,message='Queued to scan '+' + '.join(labels),job_id=job['id'] if job else resume.get('job_id'))
        c.execute('INSERT OR REPLACE INTO job_imports VALUES (?,?,?,?,?)',(ref,actor,'queued',json.dumps(resume),now()))
        store.event(c,None,actor,'reference_import_requested',dict(reference=ref))
    return dict(reference=ref,status='queued',**resume)

def state(store,ref,status,**data):
    with store.transaction() as c:c.execute('UPDATE job_imports SET status=?,data=?,updated_at=? WHERE reference=?',(status,json.dumps(data),now(),ref))

def rfq_items(text):
    """Only labelled tabular RFQ rows; never infer quantities from prose or prices."""
    columns=None;result=[]
    for line in text.splitlines():
        cells=[v.strip() for v in re.split(r'\t|\|',line)]
        if len(cells)<3:continue
        labels=[v.lower() for v in cells]
        qty=next((i for i,v in enumerate(labels) if v in ['qty','quantity','requested quantity']),None)
        desc=next((i for i,v in enumerate(labels) if v in ['description','item description','item']),None)
        if qty is not None and desc is not None:
            part=next((i for i,v in enumerate(labels) if v in ['part no','part no.','part number','part','item code']),None)
            columns=(qty,desc,part);continue
        if columns:
            q,d,p=columns
            if max(q,d,p or 0)>=len(cells):continue
            if not re.fullmatch(r'\d+(?:\.\d+)?',cells[q]) or float(cells[q])<=0 or not cells[d]:continue
            result.append(dict(description=cells[d],quantity=cells[q],part_no=cells[p] if p is not None else '',unit_price='0'))
    return result[:200]

def run_pending(store,flow):
    from datetime import timedelta,timezone
    # Recover a worker crash without losing already-ingested evidence.
    with store.transaction() as c:c.execute("UPDATE job_imports SET status='queued' WHERE status='running' AND updated_at<?",((datetime.now(timezone.utc)-timedelta(minutes=10)).isoformat(),))
    with store.connection() as c:pending=[dict(r) for r in c.execute("SELECT * FROM job_imports WHERE status='queued' ORDER BY updated_at LIMIT 1")]
    for task in pending:
        ref=task['reference']
        with store.transaction() as c:
            if not c.execute("UPDATE job_imports SET status='running',updated_at=? WHERE reference=? AND status='queued'",(now(),ref)).rowcount:continue
        try:
            count=0
            task_data=json.loads(task['data'])
            for cfg in import_mailboxes(task_data,task['actor']):
                password=os.environ.get(cfg['password_env'],'')
                if not password:raise ValueError('Missing mailbox secret')
                state(store,ref,'running',**dict(task_data,message='Connecting to '+cfg['id']+' mailbox',email_occurrences=count))
                with imaplib.IMAP4_SSL(cfg['host'],int(cfg.get('port',993)),ssl_context=ssl.create_default_context(),timeout=180) as mail:
                    mail.login(cfg['username'],password)
                    folders=cfg.get('folders',['INBOX','Sent'])
                    if os.environ.get('APMERIN_TRIAL')=='1':
                        status,listing=mail.list()
                        if status!='OK':raise RuntimeError('Folder discovery failed')
                        folders=[]
                        for line in listing or []:
                            match=re.match(rb'\((.*?)\)\s+(?:"[^"]*"|NIL)\s+(.+)$',line)
                            if match and b'\\Noselect' not in match[1]:folders.append(match[2].decode())
                    terms=[ref]
                    for term in terms:
                        for folder in folders:
                            state(store,ref,'running',**dict(task_data,message='Searching '+cfg['id']+' · '+folder.strip('"'),email_occurrences=count))
                            selected=folder if folder.startswith('"') else '"'+folder.replace('"','')+'"'
                            if mail.select(selected,readonly=True)[0]!='OK':raise RuntimeError('Folder unavailable')
                            validity=mail.response('UIDVALIDITY')[1][0].decode()
                            search_key='SUBJECT' if re.fullmatch(r'Q[0-9]{3,12}',term) else 'TEXT'
                            status,values=mail.uid('SEARCH',None,search_key,'"'+term+'"')
                            if status!='OK':raise RuntimeError('Search failed')
                            for uid in (values[0] or b'').split():
                                status,parts=mail.uid('FETCH',uid,'(BODY.PEEK[])')
                                if status!='OK':raise RuntimeError('Fetch failed')
                                raw=next(p[1] for p in parts if isinstance(p,tuple))
                                ingest(store,flow,raw,cfg['id'],folder.strip('"'),validity,int(uid),live_monitor=False);count+=1
                            state(store,ref,'running',**dict(task_data,message='Searching mailbox folders',email_occurrences=count))
                        if term==ref:
                            discovered=assemble(store,flow,ref,task['actor'],owner=task_data.get('mailbox_user'))
                            if discovered:
                                with store.connection() as c:job=store.job(c,discovered)
                                for related in [job.get('requisition_no',''),job.get('company_reference',''),job.get('client_reference','')]:
                                    if related and related not in terms and len(related)<100 and re.fullmatch(r'[A-Za-z0-9 ./_-]+',related):terms.append(related)
            result=assemble(store,flow,ref,task['actor'],owner=task_data.get('mailbox_user'))
            state(store,ref,'complete' if result else 'not_found',**dict(task_data,message='Evidence card ready; review extracted details before commercial use.' if result else 'No exact reference found in email subjects. Check reference or mailbox access.',job_id=result or task_data.get('job_id'),email_occurrences=count))
        except Exception as exc:
            state(store,ref,'failed',**dict(json.loads(task['data']),message='Import interrupted. Both required mailboxes must complete. Check mailbox connectivity and retry; saved emails are retained.',error_type=type(exc).__name__))

def assemble(store,flow,ref,actor,owner=None):
    pattern=re.compile(r'(?<!\w)'+re.escape(ref)+r'(?!\w)',re.I)
    with store.connection() as c:
        found=existing(store,c,ref)
        rows=[]
        client_ref=not re.fullmatch(r'Q[0-9]{3,12}',ref)
        for r in c.execute('SELECT * FROM messages'):
            data=json.loads(r['data'])
            text=data['subject']+('\n'+data.get('body_full',data.get('body','')) if client_ref else '')
            if pattern.search(text) or found and r['job_id']==found['id']:rows.append(dict(r))
    if not rows:return None
    # All uncertain facts stay evidence-only; wrong/copy references require staff review.
    for row in rows:
        data=json.loads(row['data']);extracts=[]
        for a in data.get('attachments',[]):
            if ignored(a,store.setting('attachment_rules',DEFAULT_RULES)):continue
            try:extracts.append(dict(hash=a['hash'],**extract_attachment(store,a['hash'],a['filename'])))
            except Exception:extracts.append(dict(hash=a['hash'],text='',needs_vision=True))
        data.update(extractions=extracts,extracted=True)
        with store.transaction() as c:c.execute('UPDATE messages SET data=? WHERE id=?',(json.dumps(data),row['id']))
        row['data']=json.dumps(data)
    with store.connection() as c:found=existing(store,c,ref)
    if found:
        # Existing manually created cards also receive exact, unambiguous evidence.
        # Do not move evidence already assigned to another job or overwrite staff facts.
        with store.transaction() as c:
            for row in rows:
                data=json.loads(row['data'])
                if not row['job_id'] and not any(v!=found['id'] for v in data.get('candidates',[])):
                    c.execute('UPDATE messages SET job_id=? WHERE id=? AND job_id IS NULL',(found['id'],row['id']))
        if found.get('import_review'):
            from .import_facts import enrich
            return enrich(store,ref,found['id'],actor)
        return found['id']
    facts=[json.loads(r['data']) for r in rows]
    vessels=set();requisitions=set()
    from .rfq_identity import facts as identity_facts
    for data in facts:
        identity=identity_facts(data)
        if identity['requisition_no']:requisitions.add(identity['requisition_no'])
        text=data['subject']+'\n'+data['body']
        for m in re.finditer(r'(?:vessel(?: name)?|m/v|mv)\s*[:.-]\s*([^\n,;]{3,60})',text,re.I):vessels.add(m[1].strip())
        if identity['vessel_name'] and identity['vessel_name'] not in {v.upper() for v in vessels}:vessels.add(identity['vessel_name'])
        for m in re.finditer(r'(?:requisition(?: no\.?)?|req(?: no\.?)?)\s*[:#-]\s*([\w][\w./-]{3,})',text,re.I):requisitions.add(m[1])
    clients=store.setting('client_emails',[])
    rfqs=[d for d in facts if d.get('direction')=='received' and re.search(r'\brfq\b|requisition|request for quot(?:e|ation)',d['subject'],re.I) and (d['sender'] in clients or identity_facts(d)['requisition_no']==ref and identity_facts(d)['vessel_name'])]
    scopes={(d['sender'].split('@')[-1],identity_facts(d)['vessel_name'],identity_facts(d)['requisition_no']) for d in rfqs if identity_facts(d)['vessel_name']}
    if len(scopes)>1:raise ValueError('Multiple client/vessel RFQs use this reference. Review the source emails and select the correct vessel.')
    suggestions=[];seen=set()
    for row,data in zip(rows,facts):
        if data not in rfqs and not (data.get('direction')=='sent' and re.match(r'^rfq\b',data['subject'],re.I)):continue
        texts=[data['body']]+[e.get('text','') for e in data.get('extractions',[])]
        for text in texts:
            for item in rfq_items(text):
                key=(item['part_no'],item['description'],item['quantity'])
                if key in seen:continue
                seen.add(key);suggestions.append(dict(item,evidence='email:'+row['id']))
    with store.transaction() as c:
        job=existing(store,c,ref)
        if job:return job['id']
        responsible=owner or actor
        owner=responsible if c.execute("SELECT 1 FROM users WHERE id=? AND role='procurement' AND active=1",(responsible,)).fetchone() else ''
        jid='JC-'+datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).strftime('%y')+'-'+uuid.uuid4().hex[:8].upper()
        payload=dict(company_reference=ref,client_name='Client details pending review',client_email='',vessel_name='Vessel pending review',requisition_no=ref,owner=owner,currency='MYR',items=[],sourcing='rfq_received',fulfilment='not_ordered',rfq_due_date='',notes='Reference import: review original RFQ, parties, quantities, quotation revisions and cross-job references. Commercial facts are not confirmed by email classification.',import_review=True)
        if not re.fullmatch(r'Q[0-9]{3,12}',ref):
            payload.pop('company_reference');payload['client_reference']=ref
        if len(vessels)==1:payload['vessel_name']=next(iter(vessels))
        if len(requisitions)==1:payload['requisition_no']=next(iter(requisitions))
        if rfqs:
            identity=identity_facts(rfqs[0]);payload.update(client_email=rfqs[0]['sender'],client_name=identity['client_name'],vessel_name=identity['vessel_name'] or payload['vessel_name'],requisition_no=identity['requisition_no'] or payload['requisition_no'])
        payload.setdefault('client_reference',payload['requisition_no'])
        payload['import_suggestions']=dict(vessels=sorted(vessels),requisitions=sorted(requisitions),message_count=len(rows))
        payload['suggested_items']=suggestions
        c.execute('INSERT INTO jobs VALUES (?,?,?,?,?)',(jid,1,json.dumps(payload),now(),now()))
        for row in rows:
            if row['job_id'] and row['job_id']!=jid:continue
            c.execute('UPDATE messages SET job_id=? WHERE id=?',(jid,row['id']))
            data=json.loads(row['data'])
            # Classification is a proposed task, not a confirmed commercial transition.
            if data.get('direction')=='received' and data.get('event')=='supplier_quote':
                store.add_record(c,jid,'supplier_quote',dict(supplier_email=data['sender'],evidence='email:'+row['id'],subject=data['subject'],review_required=True),'import worker')
            if data.get('direction')=='sent' and re.match(r'^rfq\b',data['subject'],re.I):
                try:sent_date=parsedate_to_datetime(data['date']).astimezone(ZoneInfo('Asia/Kuala_Lumpur')).date().isoformat()
                except (ValueError,TypeError,OverflowError):continue
                for address in data.get('recipients',[]):
                    if address.endswith('@apmerinservices.com.my'):continue
                    store.add_record(c,jid,'supplier_rfq',dict(supplier_email=address,sent_date=sent_date,evidence='email:'+row['id'],review_required=True),'import worker')
        store.add_record(c,jid,'review_task',dict(title='Review imported RFQ and commercial evidence',due_date=datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date().isoformat(),finance=False,resolved=False,evidence='Reference '+ref),'import worker')
        store.event(c,jid,actor,'reference_imported',dict(reference=ref,messages=len(rows)))
    from .import_facts import enrich
    from .rfq_identity import reconcile
    reconcile(store,flow)
    return enrich(store,ref,jid,actor)
