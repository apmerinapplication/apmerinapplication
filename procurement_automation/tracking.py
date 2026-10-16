"""Shared shipment evidence and low-frequency official carrier checks. No AI or scraping."""
import hashlib
import json
import os
import re
import urllib.request
import urllib.parse
from datetime import datetime,timedelta,timezone
from .store import now

def setup(c):
    c.executescript('''CREATE TABLE IF NOT EXISTS tracking_shipments(id TEXT PRIMARY KEY,carrier TEXT,kind TEXT,number TEXT,data TEXT);
    CREATE TABLE IF NOT EXISTS tracking_links(shipment_id TEXT,job_id TEXT,evidence TEXT,PRIMARY KEY(shipment_id,job_id,evidence));''')

def carrier(text):
    names=[name for name,pattern in [('DHL',r'\bDHL\b'),('FedEx',r'\bFed\s*Ex\b'),('UPS',r'\bUPS\b')] if re.search(pattern,text,re.I)]
    return names[0] if len(names)==1 else 'Unknown'

def numbers(text):
    found=[]
    for m in re.finditer(r'\b(?:AWB|HAWB|HWB|air\s*way\s*bill|waybill|tracking(?:\s*(?:number|no\.?|id))?)\s*(?:number|no\.?|id)?\s*[:<#=-]?\s*(?:DHL\s*|Fed\s*Ex\s*)?([0-9]{2}[ -][0-9]{4}[ -][0-9]{4}|[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}|[0-9][0-9-]{8,24}[0-9])',text,re.I):
        number=re.sub(r'[^0-9]','',m[1])
        if 10<=len(number)<=22:found.append(('AWB',number,carrier(text[max(0,m.start()-120):m.end()+120]) if carrier(text)=='Unknown' else carrier(text)))
    for m in re.finditer(r'\b(?:B/L|BL|bill of lading)\s*(?:(?:number|no\.?)\s*[:#=-]?|[:#=-])\s*([A-Z0-9][A-Z0-9/-]{5,39})',text,re.I):
        if any(c.isdigit() for c in m[1]):found.append(('BL',m[1].upper(),'Sea freight'))
    return sorted(set(found))

def discover(store):
    with store.transaction() as c:
        jobs=[store.job(c,r[0]) for r in c.execute('SELECT id FROM jobs')]
        for row in c.execute('SELECT id,data,job_id FROM messages'):
            d=json.loads(row['data'])
            text=d.get('subject','')+'\n'+d.get('body','')+'\n'+'\n'.join(e.get('text','') for e in d.get('extractions',[]))
            detections=numbers(text)
            if not detections:continue
            references=set(re.findall(r'\bQ\d{3,12}\b',d.get('subject','')+' '+d.get('body',''),re.I))
            related={row['job_id']} if row['job_id'] else set()
            reference_text=d.get('subject','')+' '+d.get('body','')
            combined=bool(len(references)>1 and (re.search(r'\bQ\d{3,12}\s*(?:and|&|/|,)\s*Q\d{3,12}\b',reference_text,re.I) or re.search(r'combined shipment|consolidated|same (?:AWB|waybill|shipment)|shipped together',reference_text,re.I)))
            if combined or not related and len(references)==1:
                related.update(j['id'] for j in jobs if j.get('company_reference') in references)
            if not related:continue
            for kind,number,provider in detections:
                # Unknown and later identified evidence for the same waybill share one record.
                existing=c.execute('SELECT * FROM tracking_shipments WHERE kind=? AND number=? AND (carrier=? OR carrier=?)',(kind,number,provider,'Unknown')).fetchone()
                if provider=='Unknown':
                    possible=list(c.execute('SELECT * FROM tracking_shipments WHERE kind=? AND number=?',(kind,number)))
                    if len(possible)==1:existing=possible[0]
                    elif len(possible)>1:continue
                sid=existing['id'] if existing else hashlib.sha256((kind+'|'+provider+'|'+number).encode()).hexdigest()[:24]
                if existing and existing['carrier']=='Unknown' and provider!='Unknown':c.execute('UPDATE tracking_shipments SET carrier=? WHERE id=?',(provider,sid))
                if not existing:c.execute('INSERT INTO tracking_shipments VALUES (?,?,?,?,?)',(sid,provider,kind,number,json.dumps(dict(status='Manual update required' if kind=='BL' else 'Not checked',source='email',checked_at=''))))
                for jid in related:c.execute('INSERT OR IGNORE INTO tracking_links VALUES (?,?,?)',(sid,jid,'email:'+row['id']))

def ready(provider):
    return bool(os.environ.get('APMERIN_DHL_TRACKING_KEY')) if provider=='DHL' else bool(os.environ.get('APMERIN_FEDEX_CLIENT_ID') and os.environ.get('APMERIN_FEDEX_CLIENT_SECRET')) if provider=='FedEx' else False

def list_for_job(store,c,jid):
    result=[]
    for r in c.execute('SELECT DISTINCT s.* FROM tracking_shipments s JOIN tracking_links l ON l.shipment_id=s.id WHERE l.job_id=?',(jid,)):
        d=json.loads(r['data']);links=list(c.execute('SELECT job_id,evidence FROM tracking_links WHERE shipment_id=?',(r['id'],)))
        related=[]
        for job_id in sorted({l['job_id'] for l in links}):
            job=store.job(c,job_id);related.append(dict(id=job_id,reference=job.get('company_reference') or job.get('client_reference') or job['requisition_no']))
        url='https://www.dhl.com/my-en/home/tracking.html?tracking-id='+urllib.parse.quote(r['number']) if r['carrier']=='DHL' else 'https://www.fedex.com/fedextrack/?trknbr='+urllib.parse.quote(r['number']) if r['carrier']=='FedEx' else ''
        result.append(dict(id=r['id'],carrier=r['carrier'],kind=r['kind'],number=r['number'],**d,api_ready=ready(r['carrier']),related_jobs=related,evidence=sorted({l['evidence'] for l in links}),tracking_url=url))
    return result

def http_json(url,headers=None,body=None):
    request=urllib.request.Request(url,data=body,headers=headers or {})
    with urllib.request.urlopen(request,timeout=20) as response:return json.loads(response.read(2*1024*1024))

def fetch(provider,number):
    if provider=='DHL':
        result=http_json('https://api-eu.dhl.com/track/shipments?'+urllib.parse.urlencode(dict(trackingNumber=number)),{'DHL-API-Key':os.environ['APMERIN_DHL_TRACKING_KEY']})
        shipments=result.get('shipments',[])
        if len(shipments)!=1:raise ValueError('Carrier returned no unique shipment')
        s=shipments[0];status=s.get('status',{})
        return dict(status=status.get('description') or status.get('status') or status.get('statusCode') or 'Unknown',code=status.get('statusCode',''),event_at=status.get('timestamp',''),eta=s.get('estimatedTimeOfDelivery',''),events=s.get('events',[])[:50],source='DHL API')
    if provider=='FedEx':
        token=http_json('https://apis.fedex.com/oauth/token',{'Content-Type':'application/x-www-form-urlencoded'},urllib.parse.urlencode(dict(grant_type='client_credentials',client_id=os.environ['APMERIN_FEDEX_CLIENT_ID'],client_secret=os.environ['APMERIN_FEDEX_CLIENT_SECRET'])).encode())['access_token']
        result=http_json('https://apis.fedex.com/track/v1/trackingnumbers',{'Content-Type':'application/json','Authorization':'Bearer '+token},json.dumps(dict(includeDetailedScans=True,trackingInfo=[dict(trackingNumberInfo=dict(trackingNumber=number))])).encode())
        results=result.get('output',{}).get('completeTrackResults',[])
        tracks=results[0].get('trackResults',[]) if len(results)==1 else []
        if len(tracks)!=1 or tracks[0].get('error'):raise ValueError('Carrier returned no unique shipment')
        s=tracks[0];status=s.get('latestStatusDetail',{})
        return dict(status=status.get('description') or 'Unknown',code=status.get('code',''),eta=next((v.get('dateTime','') for v in s.get('dateAndTimes',[]) if v.get('type')=='ESTIMATED_DELIVERY'),''),events=s.get('scanEvents',[])[:50],source='FedEx API')
    raise ValueError('This carrier does not have an API configured')

def poll(store):
    # One call per maintenance cycle; shared jobs do not multiply calls. Four-hour caching.
    with store.transaction() as c:
        cutoff=(datetime.now(timezone.utc)-timedelta(hours=4)).isoformat()
        state=c.execute("SELECT data FROM worker_state WHERE key='tracking_poll'").fetchone()
        budget=json.loads(state[0]) if state else {}
        current=datetime.now(timezone.utc)
        if budget.get('day')!=current.date().isoformat():budget=dict(day=current.date().isoformat(),count=0)
        if budget.get('count',0)>=200 or budget.get('at') and current-datetime.fromisoformat(budget['at'])<timedelta(seconds=6):return
        for r in c.execute("SELECT * FROM tracking_shipments WHERE kind='AWB'"):
            d=json.loads(r['data'])
            if not ready(r['carrier']) or d.get('code','').lower() in ['delivered','dl'] or (d.get('checked_at') or '')>cutoff:continue
            sid=r['id'];provider=r['carrier'];number=r['number'];d['checked_at']=now()
            c.execute('UPDATE tracking_shipments SET data=? WHERE id=?',(json.dumps(d),sid))
            budget.update(at=now(),count=budget.get('count',0)+1)
            c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('tracking_poll',json.dumps(budget)));break
        else:return
    try:
        update=fetch(provider,number);d.update(update,checked_at=now(),error='')
    except Exception as exc:d.update(error='Carrier check failed; last successful status retained.',error_type=type(exc).__name__)
    with store.transaction() as c:
        c.execute('UPDATE tracking_shipments SET data=? WHERE id=?',(json.dumps(d),sid))
        store.event(c,None,'tracking worker','tracking_checked',dict(shipment_id=sid,carrier=provider,success=not bool(d.get('error'))))

def manual(store,c,sid,data,actor):
    row=c.execute('SELECT * FROM tracking_shipments WHERE id=?',(sid,)).fetchone()
    if not row:raise LookupError('Shipment not found')
    if row['kind']!='BL':raise ValueError('Manual delivery updates are for bill-of-lading shipments')
    if not str(data.get('status','')).strip() or not str(data.get('evidence','')).strip():raise ValueError('Status and supporting evidence are required')
    if data.get('checked_at')!=json.loads(row['data']).get('checked_at',''):raise RuntimeError('Shipment changed. Reload before saving.')
    d=dict(json.loads(row['data']),status=str(data['status'])[:300],note=str(data['evidence'])[:3000],source='Manual · '+actor,checked_at=now())
    c.execute('UPDATE tracking_shipments SET data=? WHERE id=?',(json.dumps(d),sid))
    for jid in {r[0] for r in c.execute('SELECT job_id FROM tracking_links WHERE shipment_id=?',(sid,))}:store.event(c,jid,actor,'bl_status_updated',dict(shipment_id=sid,status=d['status'],evidence=d['note']))
