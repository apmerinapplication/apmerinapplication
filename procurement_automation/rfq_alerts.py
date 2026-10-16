"""One alert per live, recent, unhandled client request; supplier replies are not new RFQs."""
import json
import re
from datetime import datetime,timedelta,timezone
from email.utils import parsedate_to_datetime
from .rfq_identity import facts,normalize

def request_key(data):
    identity=facts(data)
    req=identity['requisition_no']
    if not req:
        match=re.search(r'\b(?:RN\s*[:#-]?\s*)?(\d{2}R?-\d{3,5}(?:\s*-\s*\d+)?)\b',data['subject'],re.I)
        if match:req=re.sub(r'\s+','',match[1]).upper()
    subject=re.sub(r'^(?:(?:re|fw|fwd|sv):\s*|\(ACK\)\s*)+','',data['subject'],flags=re.I).strip().upper()
    return (data.get('sender','').split('@')[-1],identity['vessel_name'],req or subject)

def group_alerts(store,c,messages,at=None):
    at=at or datetime.now(timezone.utc)
    jobs=[store.job(c,r[0]) for r in c.execute('SELECT id FROM jobs')]
    clients=set(store.setting('client_emails',[],c))|{j.get('client_email','').lower() for j in jobs if '@' in j.get('client_email','')}
    client_domains={a.split('@')[-1] for a in clients}
    suppliers={json.loads(r[0]).get('supplier_email','').lower() for r in c.execute("SELECT data FROM records WHERE kind IN ('supplier_rfq','supplier_po','supplier_quote')")}
    # Outgoing RFQ recipients identify suppliers even before a job has been reviewed.
    supplier_sql="jsonb_build_object('direction',data::jsonb->'direction','subject',data::jsonb->'subject','recipients',data::jsonb->'recipients')::text AS data" if store.is_cloud else 'data'
    for r in c.execute('SELECT '+supplier_sql+' FROM messages'):
        d=json.loads(r[0])
        if d.get('direction')=='sent' and re.match(r'^RFQ\b',d.get('subject',''),re.I):
            suppliers.update(a for a in (d.get('recipients') or []) if not a.endswith('@apmerinservices.com.my') and a.split('@')[-1] not in client_domains)
    supplier_domains={a.split('@')[-1] for a in suppliers if '@' in a}
    groups={}
    for m in messages:
        m['new_rfq']=False
        if m.get('job_id') or m.get('candidates') or m.get('direction')!='received' or m.get('live_monitor') is not True:continue
        sender=m.get('sender','')
        if sender.endswith('@apmerinservices.com.my') or sender in suppliers or sender.split('@')[-1] in supplier_domains-client_domains:continue
        try:
            date=parsedate_to_datetime(m['date']) if m.get('date') else datetime.fromisoformat(m['created_at'])
            if date.tzinfo is None:date=date.replace(tzinfo=timezone.utc)
        except (ValueError,TypeError,KeyError,OverflowError):continue
        if date<at-timedelta(days=int(store.setting('new_rfq_days',14,c))) or date>at+timedelta(days=1):continue
        reply=bool(m.get('references') or re.match(r'^\s*(?:re|sv):',m['subject'],re.I))
        explicit=bool(re.search(r'need a quotation|please (?:quote|provide.{0,30}quotation)|invitation to tender|request for quot(?:e|ation)',m.get('body',''),re.I))
        if not explicit and m.get('event')!='rfq' and not re.search(r'\b(?:RFQ|requisition|invitation to tender|request for quot(?:e|ation))\b',m['subject'],re.I):continue
        if reply and (m['sender'].split('@')[-1] not in client_domains or not explicit):continue
        if not explicit and m['sender'].split('@')[-1] not in client_domains and not re.match(r'^\s*(?:RFQ\b|request for quot(?:e|ation))',m['subject'],re.I):continue
        key=request_key(m)
        # A source thread already represented by a job cannot become a second RFQ alert.
        if any(normalize(j.get('client_reference') or j.get('requisition_no'))==normalize(key[2]) and j.get('client_email','').split('@')[-1]==key[0] for j in jobs):continue
        groups.setdefault(key,[]).append(m)
    alerts=[]
    for grouped in groups.values():
        first=min(grouped,key=lambda m:m.get('date') or m.get('created_at',''))
        first['new_rfq']=True
        first['rfq_group_count']=len(grouped)
        alerts.append(dict(id=first['id'],subject=first['subject'],date=first['date'],email_count=len(grouped)))
    return alerts
