"""Client-first RFQ identity and evidence-backed sent-mail reconciliation, without AI."""
import json
import re
from datetime import datetime
from email.utils import parseaddr, parsedate_to_datetime
from zoneinfo import ZoneInfo
from .store import now

INTERNAL = '@apmerinservices.com.my'

def normalize(value):
    return re.sub(r'\s+', ' ', str(value or '').strip()).upper()

def contains(text, value):
    return bool(value and re.search(r'(?<![\w])'+re.escape(value)+r'(?![\w])', text, re.I))

def labelled_identity(text):
    # Spreadsheet extraction uses tabs for cells and CRLF for email lines.
    text=str(text or '').replace('\r\n','\n').replace('\r','\n')
    req=re.search(r'\b(?:rfq\s*(?:number|no\.?|ref(?:erence)?)|rf\s*(?:number|no\.?)|requisition(?:\s*(?:number|no\.?|ref(?:erence)?))?|req\s*no\.?)\s*[:#=-]\s*([A-Z0-9][A-Z0-9./_-]{2,99})',text,re.I)
    vessel=re.search(r'\b(?:vessel(?:\s*name)?|m/v|mv)[ \t]*[:=-][ \t]*([^\n\t;,]{2,80})',text,re.I)
    name=normalize(vessel[1]) if vessel else ''
    name=re.split(r'\s*/\s*RN\b|\s+RFQ\b',name)[0].strip()
    return dict(requisition_no=normalize(req[1]) if req and any(ch.isdigit() for ch in req[1]) else '',vessel_name=name)


def facts(data):
    subject=data.get('subject','')
    values=labelled_identity(subject+'\n'+data.get('body',''))
    # Read original requisition text as well as pre-labelled parser fields.
    # Conflicting attachment values remain blank for staff review.
    candidates={'requisition_no':set(),'vessel_name':set()}
    for ext in data.get('extractions',[]):
        parsed=labelled_identity(ext.get('text',''));fields=ext.get('fields',{})
        for key,field in [('requisition_no','requisition'),('vessel_name','vessel')]:
            for value in [fields.get(field),parsed[key]]:
                if value:candidates[key].add(normalize(value))
    for key in candidates:
        if not values[key] and len(candidates[key])==1:values[key]=next(iter(candidates[key]))
    if not values['requisition_no'] and not candidates['requisition_no']:
        req=re.search(r'\bRN\s*[:#]?\s*(\d{2}R?-\d{3,5}(?:\s*-\s*\d+)?)',subject,re.I)
        if not req:
            req=re.search(r'\bRFQ\s+([A-Z0-9][A-Z0-9./_-]{2,99})',subject,re.I)
            if req and not any(ch.isdigit() for ch in req[1]):req=None
        values['requisition_no']=normalize(req[1]) if req else ''
    if not values['vessel_name'] and not candidates['vessel_name']:
        vessel=re.search(r'\b(?:for\s+ship|vessel)\s+([^\n;]{2,80})(?=;\s*RFQ|\n|$)',subject,re.I)
        if not vessel:vessel=re.search(r'((?:JM |MV |MT )[A-Z0-9 ]{2,60})\s*[:/]\s*RN\b',subject,re.I)
        values['vessel_name']=normalize(vessel[1]) if vessel else ''
    values['client_email']=parseaddr(data.get('sender',''))[1] or data.get('sender','')
    body=data.get('body','').replace('\r','\n')
    # A legal company line in the sender's signature identifies the requester;
    # a requisition's "Client's Name" may name their own customer instead.
    signature=re.split(r'\b(?:best regards|kind regards|regards|thanks and regards)\b',body,flags=re.I)[-1]
    signature=signature.split('-----Original Message-----')[0]
    company=re.search(r'^\s*([A-Z][^\n\t]{2,110}\b(?:Sdn\.?[ \t]+Bhd\.?|Berhad|Pte\.?[ \t]+Ltd\.?|Limited|Ltd\.?))\s*$',signature,re.I|re.M) if signature!=body else None
    values['client_name']=company[1].strip() if company else parseaddr(data.get('from_header',''))[0] or values['client_email'].split('@')[-1]
    return values

def same_job(job, identity):
    return (normalize(job.get('requisition_no'))==normalize(identity.get('requisition_no'))
            and normalize(job.get('vessel_name'))==normalize(identity.get('vessel_name'))
            and job.get('client_email','').lower().split('@')[-1]==identity.get('client_email','').lower().split('@')[-1])

def supplier_request(data):
    return bool(re.search(r'\b(?:please|kindly)\s+(?:quote\b|(?:provide|submit|send)\b.{0,45}\b(?:quotation|quote|offer)\b)|\brequest for quot(?:e|ation)\b',data.get('body',''),re.I|re.S)
                or re.match(r'^\s*RFQ\b',data.get('subject',''),re.I))

def acknowledgement(data):
    return bool(re.search(r'\b(?:acknowledge(?:d)?|received|receipt)\b.{0,80}\b(?:RFQ|enquiry|inquiry|request|requisition)\b|\b(?:RFQ|enquiry|inquiry|request)\b.{0,80}\b(?:received|acknowledged)\b|thank you for your (?:RFQ|enquiry|inquiry|request)\b.{0,120}\b(?:revert|checking|working|quotation|quote)\b',data.get('body',''),re.I|re.S))

def save_job(store,c,job):
    c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps({k:v for k,v in job.items() if k not in ['id','version','created_at','updated_at']}),job['id']))
    store.bump(c,job['id'])

def bind_company_reference(store,c,job,data,mid):
    # Only our outgoing quotation to the client's domain can establish our Q reference.
    if data.get('direction')!='sent' or not data.get('sender','').endswith(INTERNAL):return
    identity=facts(data)
    if identity['vessel_name'] and identity['vessel_name']!=normalize(job.get('vessel_name')) or identity['requisition_no'] and identity['requisition_no']!=normalize(job.get('requisition_no')):
        data['reference_review']='Quotation vessel / client RFQ conflicts with the linked job.'
        return
    domain=job.get('client_email','').split('@')[-1]
    if not domain or not any(a.endswith('@'+domain) for a in data.get('recipients',[])):return
    text=data.get('subject','')+' '+ ' '.join(a.get('filename','') for a in data.get('attachments',[]))
    refs=set(re.findall(r'\bQ\d{3,12}\b',text,re.I))
    if not re.search(r'\b(?:QTN|quotation|quote)\b',text,re.I) or not refs:return
    refs={r.upper() for r in refs}
    conflict=len(refs)!=1 or job.get('company_reference') and job['company_reference'].upper() not in refs
    if not conflict:
        ref=next(iter(refs))
        conflict=any(r[0]!=job['id'] and normalize(json.loads(r[1]).get('company_reference'))==ref for r in c.execute('SELECT id,data FROM jobs'))
    if conflict:
        data['reference_review']='Conflicting AP quotation references; review before assignment.'
        return
    if not job.get('company_reference'):
        job['company_reference']=ref
        save_job(store,c,job)
        store.event(c,job['id'],'email worker','company_reference_assigned',dict(reference=ref,evidence='email:'+mid))

def reconcile(store,flow):
    """Live sent actions only. Historical imports do not create unrelated legacy jobs."""
    with store.transaction() as c:
        rows=[dict(r,data=json.loads(r['data'])) for r in c.execute("SELECT * FROM messages WHERE status!='ignored'")]
        incoming=[]
        for r in rows:
            if r['data'].get('direction')=='received' and (r['data'].get('event')=='rfq' or re.match(r'^\s*Request for quot(?:e|ation)\b',r['data'].get('subject',''),re.I)) and not r['data'].get('sender','').endswith(INTERNAL):
                r['identity']=facts(r['data'])
                if r['identity']['requisition_no'] and r['identity']['vessel_name']:incoming.append(r)
        for sent in rows:
            d=sent['data']
            if d.get('direction')!='sent' or not d.get('sender','').endswith(INTERNAL):continue
            if sent['job_id']:
                job=store.job(c,sent['job_id']);bind_company_reference(store,c,job,d,sent['id'])
                c.execute('UPDATE messages SET data=? WHERE id=?',(json.dumps(d),sent['id']))
            if not d.get('live_monitor') or d.get('auto_job_processed'):continue
            identity=facts(d);refs=set(d.get('references',[]))
            matches=[r for r in incoming if (sent['job_id'] and r['job_id']==sent['job_id']) or (r['message_id'] and r['message_id'] in refs) or
                     (contains(d.get('subject','')+'\n'+d.get('body',''),r['identity']['requisition_no']) and identity['vessel_name'] and identity['vessel_name']==r['identity']['vessel_name']) or
                     (identity['requisition_no'] and identity['requisition_no']==r['identity']['requisition_no'] and identity['vessel_name'] and identity['vessel_name']==r['identity']['vessel_name'])]
            identities={tuple(r['identity'][k] for k in ['client_email','vessel_name','requisition_no']) for r in matches}
            # Different contacts in the same company are allowed, different vessels/references are not.
            scopes={(email.split('@')[-1],vessel,req) for email,vessel,req in identities}
            if len(scopes)!=1:continue
            original=matches[0];f=original['identity']
            if not f['requisition_no'] or not f['vessel_name']:continue
            client_domain=f['client_email'].split('@')[-1]
            to_client=any(a.endswith('@'+client_domain) for a in d.get('recipients',[]))
            to_supplier=any('@' in a and not a.endswith(INTERNAL) and not a.endswith('@'+client_domain) for a in d.get('recipients',[]))
            ack=to_client and acknowledgement(d)
            rfq=to_supplier and supplier_request(d)
            # Thread replies must not override an explicit conflicting vessel/reference.
            if identity['vessel_name'] and identity['vessel_name']!=f['vessel_name']:continue
            if identity['requisition_no'] and identity['requisition_no']!=f['requisition_no']:continue
            jobs=[store.job(c,r[0]) for r in c.execute('SELECT id FROM jobs')]
            candidates=[j for j in jobs if same_job(j,f)]
            linked={r['job_id'] for r in matches if r['job_id']}
            if len(candidates)>1 or len(linked)>1:continue
            job=store.job(c,next(iter(linked))) if linked else candidates[0] if candidates else None
            if job and not same_job(job,f):continue
            if not (ack or rfq):
                if job and to_client:
                    prior=job.get('company_reference')
                    bind_company_reference(store,c,job,d,sent['id'])
                    if job.get('company_reference') and not prior:
                        d.update(auto_job_processed=True,candidates=[job['id']])
                        c.execute("UPDATE messages SET job_id=?,status='linked',data=? WHERE id=?",(job['id'],json.dumps(d),sent['id']))
                    elif d.get('reference_review'):
                        c.execute('UPDATE messages SET data=? WHERE id=?',(json.dumps(d),sent['id']))
                continue
            if not job:
                local=d['sender'].split('@')[0]
                owner=next((r[0] for r in c.execute("SELECT id,name FROM users WHERE active=1 AND role='procurement'") if r[0].lower() in [local,d.get('mailbox_owner','')] or r[1].lower()==local or store.setting('profile:'+r[0],{},c).get('email','').lower()==d['sender']),'')
                from .job_import import rfq_items
                from .document_facts import table_items
                items=rfq_items(original['data'].get('body',''));seen={(i.get('part_no',''),i['description'],i['quantity']) for i in items}
                for ext in original['data'].get('extractions',[]):
                    for item in table_items(ext.get('tables',[]))+rfq_items(ext.get('text','')):
                        key=(item.get('part_no',''),item['description'],item['quantity'])
                        if key not in seen:seen.add(key);items.append(dict(item,unit_price=item.get('unit_price') or '0',source_document=ext.get('hash')))
                items=[dict(i,source_evidence='email:'+original['id'],review_required=True) for i in items]
                job=flow.create(c,dict(f,client_reference=f['requisition_no'],owner=owner,items=items,notes='Created from staff sent-mail evidence. Review RFQ items and original correspondence.'),'email worker')
                store.event(c,job['id'],'email worker','rfq_job_auto_created',dict(trigger='supplier_rfq' if rfq else 'acknowledgement',evidence='email:'+sent['id'],client_rfq='email:'+original['id']))
                store.add_record(c,job['id'],'review_task',dict(title='Verify RFQ items and client details',due_date=datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date().isoformat(),finance=False,resolved=False,evidence='email:'+original['id']),'email worker')
            for r in matches+[sent]:
                c.execute("UPDATE messages SET job_id=?,status='linked' WHERE id=? AND (job_id IS NULL OR job_id=?)",(job['id'],r['id'],job['id']))
                r['job_id']=job['id']
            if rfq:
                try:date=parsedate_to_datetime(d['date']).astimezone(ZoneInfo('Asia/Kuala_Lumpur')).date().isoformat()
                except (ValueError,TypeError,KeyError,OverflowError):date=datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date().isoformat()
                for address in set(d.get('recipients',[])):
                    if '@' in address and not address.endswith(INTERNAL) and not address.endswith('@'+client_domain):
                        if not any(r.get('supplier_email')==address and r.get('evidence')=='email:'+sent['id'] for r in store.records(c,job['id'],'supplier_rfq')):
                            store.add_record(c,job['id'],'supplier_rfq',dict(supplier_email=address,sent_date=date,evidence='email:'+sent['id']),'email worker')
                if job['sourcing']=='rfq_received':job['sourcing']='rfq_sent';save_job(store,c,job)
            else:store.event(c,job['id'],'email worker','client_rfq_acknowledged',dict(evidence='email:'+sent['id']))
            d.update(auto_job_processed=True,new_rfq=False,candidates=[job['id']])
            c.execute('UPDATE messages SET data=? WHERE id=?',(json.dumps(d),sent['id']))
