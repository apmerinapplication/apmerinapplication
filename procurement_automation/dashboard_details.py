"""Document-native prices and review issues with explicit source links."""
import hashlib
import json
import re
from email.utils import parsedate_to_datetime
from .document_facts import table_items,amount

def printed_amount(value):
    value=str(value).strip()
    if re.fullmatch(r'\d{1,3}(?:\.\d{3})*,\d{2,4}',value):value=value.replace('.','').replace(',','.')
    return amount(value)

def price_rows(ext):
    rows=table_items(ext.get('tables',[]))
    if rows:return rows
    text='\n'.join(line.strip() for line in ext.get('text','').splitlines() if line.strip())
    # Unruled PDF tables: require the printed column headings and a complete row.
    if re.search(r'Item Code / Description\nQuantity\nUnit price\nDisc\.\nAmount',text,re.I):
        pattern=r'(?m)^\d+\.\n([A-Z0-9-]+)\n(\d+(?:\.\d+)?)\n(PCS|LOT|SET|EA)\n([\d,.]+)\n(?:(\d+(?:\.\d+)?%)\n)?([\d,.]+)\n(.+)$'
        for m in re.finditer(pattern,text):rows.append(dict(part_no=m[1],quantity=m[2],unit=m[3],unit_price=printed_amount(m[4]),discount=m[5] or '',line_total=printed_amount(m[6]),description=m[7]))
    elif 'QUOTATION LIST' in text and re.search(r'U/price.*\([A-Z]{3}\)',text,re.I|re.S):
        pattern=r'(?m)^([^\n]+)\n(\d+(?:[.,]\d+)?)\n(PCS|PC|SET|EA|NOS|LOT)\n([^\n]*(?:WEEKS|DAYS|W/DAYS|STOCK)[^\n]*)\n([\d.,]+)\n([\d.,]+)$'
        for m in re.finditer(pattern,text,re.I):
            part=re.search(r'\b(?:\d{5,}|[A-Z]{1,4}-\d+)\b',m[1])
            rows.append(dict(description=m[1],part_no=part[0] if part else '',quantity=m[2],unit=m[3],unit_price=printed_amount(m[5]),line_total=printed_amount(m[6])))
    return rows

def document_currency(text):
    match=re.search(r'(?:U/price|Unit\s*price|Unit\s*cost)\s*\(?\s*(MYR|SGD|USD|EUR|GBP|JPY|CNY|RMB|AUD|IDR)\b|TOTAL AMOUNT/(MYR|SGD|USD|EUR|GBP|JPY|CNY|RMB|AUD|IDR)\b',text,re.I)
    if match:return (match[1] or match[2]).upper()
    codes=set(re.findall(r'\b(?:MYR|SGD|USD|EUR|GBP|JPY|CNY|RMB|AUD|IDR)\b',text,re.I))
    if len(codes)==1:return next(iter(codes)).upper()
    match=re.search(r'\bCurrency\s*[:\n ]+([A-Z]{3})\b',text,re.I)
    return match[1].upper() if match else 'Not detected'

def details(store,c,job,records,messages,references_only=False):
    summary=job.get('trial_review') or job.get('import_summary') or {}
    docs=[];seen=set();client_pos=[];detected=[]
    company_refs={json.loads(r[0]).get('company_reference','').upper() for r in c.execute('SELECT data FROM jobs')}
    for r in records:
        if r['kind']=='client_po' and r.get('reference'):client_pos.append(dict(reference=r['reference'],evidence=r.get('evidence',''),verified=True))
    for fact in summary.get('facts',[]):
        if re.search(r'client.*(?:PO|purchase order)',fact[0],re.I):client_pos.append(dict(reference=fact[1],evidence='',verified=False))
    for m in messages:
        for ext in m.get('extractions',[]):
            a=next((a for a in m.get('attachments',[]) if a['hash']==ext['hash']),None)
            if not a or a['hash'] in seen:continue
            seen.add(a['hash']);text=ext.get('text','');name=a['filename']
            refs={v.upper() for v in re.findall(r'\bQ\d{3,12}\b',name+' '+text,re.I)}
            # Vendor offer IDs such as Q2026070901 are not AP Merin job references.
            refs={v for v in refs if v in company_refs or re.fullmatch(r'Q\d{4}',v) or re.match(r'(?:PO|QTN|INV|DO)[-_]',name,re.I)}
            foreign=bool(job.get('company_reference') and refs and refs!={job['company_reference'].upper()})
            if foreign:detected.append(dict(title='Document references another job',detail=name+' refers to '+', '.join(sorted(refs))+'. Check the original before using these quantities or prices.',evidence='email:'+m['id'],document_hash=a['hash'],filename=name))
            kind='supplier document' if not m['sender'].endswith('@apmerinservices.com.my') else 'AP document'
            if 'PURCHASE ORDER' in text[:600].upper() and not re.match(r'(?:PO|QTN|INV)[-_]',name,re.I) and not text.lstrip().upper().startswith('AP MERIN'):
                kind='client PO';reference=ext.get('fields',{}).get('reference')
                if not reference:
                    match=re.search(r'PURCHASE ORDER\s*(?:NO\.?|NUMBER)\s*[:#]\s*([A-Z0-9][A-Z0-9./_-]{2,99})',text,re.I)
                    if match:reference=match[1]
                if reference:client_pos.append(dict(reference=reference,evidence='email:'+m['id'],document_hash=a['hash'],verified=False))
            if references_only:continue
            if re.search(r'quotation|quote|offer|^(?:QUO|QTN)[-_ ]',name,re.I):kind='supplier quotation' if not m['sender'].endswith('@apmerinservices.com.my') else 'client quotation'
            rows=price_rows(ext)
            if (rows or 'quotation' in kind) and not a.get('review_note') and not foreign:
                docs.append(dict(hash=a['hash'],filename=name,message_id=m['id'],sender=m['sender'],kind=kind,date=m.get('date',''),currency=document_currency(text),items=rows,evidence='email:'+m['id']))
    unique_po={p['reference']:p for p in client_pos}
    # The dashboard list needs PO references, not document price parsing and flag scans.
    if references_only:return dict(client_po_references=list(unique_po.values()))
    def date_key(d):
        try:return parsedate_to_datetime(d['date']).timestamp()
        except (ValueError,TypeError,KeyError,OverflowError):return 0
    docs.sort(key=date_key,reverse=True)
    # Original extraction flags can carry exact provenance. Older curated notes are matched
    # only by explicit reference / amount / distinctive source phrases, never invented IDs.
    flags=[];notes=[]
    source_rows=[]
    for m in messages:
        source_rows.append((m,dict(evidence='email:'+m['id']),m.get('subject','')+'\n'+m.get('body','')))
        for ext in m.get('extractions',[]):
            a=next((a for a in m.get('attachments',[]) if a['hash']==ext['hash']),{})
            source_rows.append((m,dict(evidence='email:'+m['id'],document_hash=ext['hash'],filename=a.get('filename','')),a.get('filename','')+'\n'+ext.get('text','')))
    raw_flags=list(summary.get('flags',[]))+detected
    raw_flags.extend(dict(title='Email reference conflict',detail=m['reference_review'],evidence='email:'+m['id']) for m in messages if m.get('reference_review'))
    for f in raw_flags:
        links=[]
        if f.get('evidence'):links.append({k:f[k] for k in ['evidence','document_hash','filename'] if f.get(k)})
        tokens=re.findall(r'\bQ\d{3,12}\b|\b\d{1,3}(?:,\d{3})*\.\d{2}\b|\b\d{7,12}\b',f.get('detail',''),re.I)
        tokens=[t for t in tokens if t.upper()!=job.get('company_reference','').upper()]
        title=f.get('title','').lower()
        anchors=[]
        if 'delivery terms' in title or 'terms' in title:anchors=['DAP','DDP']
        if 'alternative part' in title:
            anchors=['2703599'];tokens=[t for t in tokens if t!='2703603']
        if 'billing' in title:anchors=['M&G Sutera 8']
        for m,link,text in source_rows:
            if f.get('evidence'):continue
            if f.get('document_hash') and f['document_hash']==link.get('document_hash') or any(re.search(r'(?<!\w)'+re.escape(t)+r'(?!\w)',text,re.I) for t in tokens+anchors):links.append(link)
        unique={(l.get('evidence'),l.get('document_hash')):l for l in links}
        # General cautions are guidance, not evidence of a detected conflict.
        generic=bool(re.search(r'evidence limits|verification|scanned documents',title))
        if not unique or generic:
            notes.append(dict(title=f.get('title','Review note'),detail=f.get('detail','')));continue
        fid=hashlib.sha256((f.get('title','')+'|'+f.get('detail','')).encode()).hexdigest()[:20]
        row=c.execute('SELECT data FROM review_flag_actions WHERE job_id=? AND flag_id=?',(job['id'],fid)).fetchone()
        action=json.loads(row[0]) if row else {}
        flags.append(dict(f,id=fid,sources=list(unique.values()),**action))
    hashes=summary.get('quotation_hashes') or []
    preferred=next((d['hash'] for d in docs if d['hash'] in hashes),None)
    selected=[s.get('name','').lower() for s in summary.get('suppliers',[]) if s.get('status')=='Selected']
    if not preferred and selected:
        preferred=next((d['hash'] for d in docs if d['kind']=='supplier quotation' and any(d['sender'].split('@')[-1].split('.')[0] in name for name in selected)),None)
    if not preferred:preferred=next((d['hash'] for d in docs if d['kind']=='supplier quotation'),None)
    if not preferred:preferred=next((d['hash'] for d in docs if d['kind']=='supplier document'),None)
    return dict(client_po_references=list(unique_po.values()),price_documents=docs,selected_price_document=preferred or (docs[0]['hash'] if docs else ''),review_flags=flags,review_notes=notes)
