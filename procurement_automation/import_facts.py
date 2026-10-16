"""Generate dashboard facts from local document layouts with source provenance."""
import json
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from .document_facts import table_items
from .store import now

def stamp(data):
    try:return parsedate_to_datetime(data['date']).isoformat()
    except (ValueError,TypeError,KeyError):return ''

def enrich(store,ref,jid,actor):
    with store.connection() as c:
        job=store.job(c,jid)
        rows=[dict(r,data=json.loads(r['data'])) for r in c.execute('SELECT * FROM messages WHERE job_id=?',(jid,))]
    rows.sort(key=lambda r:stamp(r['data']))
    docs=[];seen=set();flags=[]
    for row in rows:
        data=row['data']
        for ext in data.get('extractions',[]):
            if ext['hash'] in seen:continue
            seen.add(ext['hash'])
            a=next((a for a in data['attachments'] if a['hash']==ext['hash']),{})
            text=ext.get('text','');refs=set(re.findall(r'\bQ\d{3,12}\b',a.get('filename','')+' '+text,re.I))
            refs={v.upper() for v in refs}
            refs={v for v in refs if re.fullmatch(r'Q\d{4}',v) or v==job.get('company_reference','').upper() or re.match(r'(?:PO|QTN|INV|DO)[-_]',a.get('filename',''),re.I)}
            if refs and refs!={job.get('company_reference','').upper()}:
                flags.append(dict(title='Separate / shared job document',detail=a.get('filename','Document')+' refers to '+', '.join(sorted(refs))+'. Excluded from quantities and finance comparisons.'))
                for other in rows:
                    for attachment in other['data']['attachments']:
                        if attachment['hash']==ext['hash']:attachment['review_note']='Separate/shared job document: '+', '.join(sorted(refs))+'; excluded from comparison'
                continue
            name=a.get('filename','');upper=text.upper();kind='document'
            internal=data['sender'].endswith('@apmerinservices.com.my')
            if re.match(r'QTN[-_]',name,re.I):kind='client_quote'
            elif re.match(r'PO[-_]',name,re.I):kind='supplier_po'
            elif re.match(r'(?:INVOICE_)?INV[-_]',name,re.I) and internal and not re.match(r'INV[-_]PO[-_]',name,re.I):kind='client_invoice'
            elif 'PURCHASE ORDER' in upper[:600] and not upper.startswith('AP MERIN'):kind='client_po'
            elif 'SUPPLIER INVOICE ENTRY' in upper:kind='client_invoice_submission'
            elif not internal and (re.search(r'quotation|quote|offer',name,re.I) or re.search(r'(?:attached|enclosed).{0,35}(?:quotation|offer)|(?:quotation|offer).{0,35}(?:attached|enclosed)',data['body'],re.I)):kind='supplier_quote'
            elif re.search(r'proforma|invoice',name,re.I) and not internal:kind='supplier_invoice'
            elif re.search(r'rfq|requisition',name,re.I):kind='client_rfq'
            doc=dict(ext,filename=name,kind=kind,evidence='email:'+row['id'],date=data['date'],message=row['id'],sender=data['sender'])
            docs.append(doc)
    def first(kind):return next((d for d in docs if d['kind']==kind),None)
    quote=first('client_quote');po=first('client_po');supplier_po=first('supplier_po');invoice=first('client_invoice')
    primary=quote or po or first('client_rfq')
    updates={}
    if primary:
        fields=primary.get('fields',{})
        currency_match=re.search(r'\((USD|MYR|SGD|EUR|JPY|GBP)\)|\bCurrency\s*[:\n ]+\s*(USD|MYR|SGD|EUR|JPY|GBP)\b',primary['text'],re.I)
        if currency_match:
            source_currency=(currency_match[1] or currency_match[2]).upper()
            with store.connection() as c:commercial=any(r['kind'] in ['client_po','supplier_po','invoice','payment'] for r in store.records(c,jid))
            if not commercial:updates['currency']=source_currency
            elif source_currency!=job.get('currency'):flags.append(dict(title='Currency conflict',detail='Document currency '+source_currency+' differs from recorded '+job.get('currency','')+'. Review before changing commercial records.'))
        if fields.get('vessel'):updates['vessel_name']=fields['vessel']
        if fields.get('requisition'):updates['requisition_no']=fields['requisition']
        text=primary['text']
        entity=re.search(r'(?:QUOTE TO|BILL TO)\s*\n([^\n,]+)',text,re.I)
        if entity:updates['client_name']=entity[1].strip().upper()
        else:
            entity=re.search(r'^([^\n]+(?:BERHAD|SDN BHD))',text,re.I)
            if entity:updates['client_name']=entity[1].strip()
        before=text.split('QUOTE TO')[0]
        addresses=re.findall(r'[\w.+-]+@[\w.-]+\.[a-z]{2,}',before,re.I)
        client_addresses=[a for a in addresses if not a.lower().endswith('@apmerinservices.com.my')]
        if client_addresses:updates['client_email']=client_addresses[-1].lower()
    item_doc=po or first('client_rfq') or quote
    items=table_items(item_doc.get('tables',[])) if item_doc else []
    goods=[i for i in items if not re.search(r'freight|packing|handling|shipping cost|forwarding',i['description'],re.I)]
    if goods and not job['items']:
        updates['items']=[dict(i,id='import-'+str(n),unit_price=i['unit_price'] or '0',source_evidence=item_doc['evidence'],source_document=item_doc['hash'],review_required=True) for n,i in enumerate(goods)]
    display_items=updates.get('items') or job['items']
    supplier_rows=table_items(supplier_po.get('tables',[])) if supplier_po else []
    supplier_currency_match=re.search(r'\((USD|MYR|SGD|EUR|JPY|GBP)\)',supplier_po.get('text','')) if supplier_po else None
    supplier_currency=supplier_currency_match[1] if supplier_currency_match else '—'
    def supplier_total(item):
        matches=[r for r in supplier_rows if re.sub(r'\s+',' ',r['description']).casefold()==re.sub(r'\s+',' ',item['description']).casefold() and r['unit_price'] and float(r['quantity'])==float(item['quantity'])]
        return float(matches[0]['unit_price'])*float(matches[0]['quantity']) if len(matches)==1 else None

    suppliers=[];supplier_domains=set();rfq_ids=[]
    for row in rows:
        d=row['data']
        if not d['sender'].endswith('@apmerinservices.com.my') or not re.match(r'^(?:(?:re|fw|fwd):\s*)*rfq\b',d['subject'],re.I):continue
        rfq_ids.append(d['message_id'])
        supplier_domains.update(a.split('@')[-1] for a in d['recipients'] if '@' in a and not a.endswith('@apmerinservices.com.my'))
    for domain in sorted(supplier_domains):
        replies=[r['data'] for r in rows if r['data']['sender'].endswith('@'+domain)]
        offered=any(d['kind']=='supplier_quote' and d['sender'].endswith('@'+domain) for d in docs)
        if replies and any(re.search(r'unit price|find.*offer|attached.*quotation',r['body'],re.I) for r in replies):offered=True
        current_status='Quotation received · review terms' if offered else 'Response received · review latest email' if replies else 'RFQ sent · no reply found'
        if replies and re.search(r'not available to provide|unable to quote|cannot (?:offer|quote)|no offer',replies[-1]['body'],re.I):current_status='Unable to quote / supply'
        if supplier_po:
            order_mail=next((r['data'] for r in rows if r['id']==supplier_po['message']),{})
            if any(a.endswith('@'+domain) for a in order_mail.get('recipients',[])):current_status='Supplier PO issued · verify shipment and delivery'
        suppliers.append(dict(name=domain,domain=domain,status='Response received' if replies else 'No reply found',current_status=current_status,amount='',terms='',note='See original emails and document previews for the latest response.'))
    title=(primary or {}).get('fields',{}).get('title') or 'Imported procurement job'
    awbs=[]
    for row in rows:
        for value in re.findall(r'\b(?:AWB|HWB)\s*[:< #-]*\s*(\d{10,12})',row['data']['subject']+' '+row['data']['body'],re.I):
            if value not in awbs:awbs.append(value)
    facts=[]
    for label,doc in [('Client quotation',quote),('Client purchase order',po),('Supplier purchase order',supplier_po),('Client invoice',invoice)]:
        if doc:facts.append([label,doc.get('fields',{}).get('reference') or doc['filename'],('Total '+doc['fields']['total']+' · ' if doc.get('fields',{}).get('total') else '')+'Document evidence · '+doc['date']])
    if awbs:facts.append(['Shipping evidence',', '.join(awbs),'Tracking documents do not confirm delivery.'])
    flags.append(dict(title='Delivery and settlement verification',detail='Document and email evidence is imported. Confirm signed receipt and reconcile invoices / payment references in Biztory before recording delivery or settlement.'))
    if any(d.get('needs_vision') for d in docs):flags.append(dict(title='Scanned documents',detail='Some documents require visual review; no unreadable quantities or values were inferred.'))
    actions=[dict(tag='REVIEW',title='Verify imported document facts',detail='Check item quantities, purchase orders, delivery evidence and Biztory invoice/payment references.',owner=job.get('owner',''),finance=False)]
    summary=dict(description=title,handler=job.get('owner',''),reviewed_at='AUTOMATIC IMPORT',email_count=len(rows),document_count=len(docs),rfq_message_ids=rfq_ids,suppliers=suppliers,quotation_hashes=[d['hash'] for d in docs if d['kind']=='supplier_quote'],quotation_message_ids=[r['id'] for r in rows if not r['data']['sender'].endswith('@apmerinservices.com.my') and re.search(r'unit price|find.*offer|attached.*quotation',r['data']['body'][:500],re.I)],quotation_heading='Original supplier offers',quotation_note='Original supplier offers; purchase order evidence is listed separately.',client_currency=updates.get('currency',job.get('currency','MYR')),supplier_currency=supplier_currency,quantity_heading='Qty in client PO' if po else 'Qty in source document',items=[dict(part_no=i.get('part_no',''),description=i['description'],ordered_quantity=i['quantity'],client_net_line=(float(i['unit_price'])*float(i['quantity']) if i.get('unit_price') else None),supplier_net_line=supplier_total(i),receipt='Requires delivery verification') for i in display_items],item_totals='Quantities and prices were extracted from '+(item_doc['filename'] if item_doc else 'available evidence')+'. Freight remains a separate line.'+(' Supplier net amounts come from '+supplier_po['filename']+'.' if supplier_po else ''),facts=facts,stages=[dict(title=label,status='Document found' if doc else 'Needs verification',done=bool(doc)) for label,doc in [('Quote',quote),('Client PO',po),('Supplier PO',supplier_po),('Invoice',invoice)]]+[dict(title='Delivery',status='Verify receipt',done=False),dict(title='Payment',status='Verify settlement',done=False)],timeline=[dict(date=r['data']['date'],title=r['data']['subject'],detail=r['data']['body'][:350],evidence='email:'+r['id']) for r in rows],flags=flags,actions=actions,resolved_requests='Review the supplier correspondence for completed clarification requests.',caution='Extracted document facts are shown below. Delivery and payment confirmations require separate evidence.',card_fulfilment='Supplier PO document found · verify delivery' if supplier_po else 'Client PO document found' if po else 'Order evidence not found',card_finance='Client invoice document found · reconcile Biztory' if invoice else 'Invoice evidence not found')
    updates['import_summary']=summary
    with store.transaction() as c:
        latest=store.job(c,jid)
        # Preserve staff assignments, handover notes and records; only fill unset import fields.
        for key,value in updates.items():
            if key=='import_summary' or key=='currency' or key=='items' and not latest.get('items') or key not in ['items','currency'] and (not latest.get(key) or 'pending review' in str(latest[key]) or (key=='requisition_no' and latest[key]==ref)):latest[key]=value
        saved={k:v for k,v in latest.items() if k not in ['id','version','created_at','updated_at']}
        c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(saved),jid));store.bump(c,jid)
        for row in rows:c.execute('UPDATE messages SET data=? WHERE id=?',(json.dumps(row['data']),row['id']))
        store.event(c,jid,actor,'import_document_facts_updated',dict(reference=ref,documents=len(docs),items=len(display_items)))
    return jid
