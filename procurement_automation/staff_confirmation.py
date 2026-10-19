"""Audited staff receipt approval and payments recorded without email evidence."""
import json,re
from datetime import datetime
from zoneinfo import ZoneInfo
from .store import now
from .workflow import number,day

def summary(store,flow,c,job,messages=None):
    ordered=flow.ordered(c,job);verified=any(ordered.values());received,_=flow.quantities(c,job)
    lines=[dict(id=i['id'],description=i['description'],part_no=i.get('part_no',''),ordered=str(ordered[i['id']] if verified else number(i['quantity'])),received=str(received[i['id']]),remaining=str((ordered[i['id']] if verified else number(i['quantity']))-received[i['id']])) for i in job['items']]
    payments=store.records(c,job['id'],'manual_payment_confirmation');states={}
    for party in ['supplier','client']:
        last={}
        for r in payments:
            if r['party']==party:last[r['document_reference']]=r
        states[party]=dict(status='Paid · staff confirmed' if last and all(r['status']=='paid' for r in last.values()) else 'Partial payment · staff recorded' if last else 'Not confirmed',records=list(last.values()))
    from .payment_evidence import candidates
    states['supplier']['evidence_candidates']=candidates(store,c,job['id'],messages)
    if not states['supplier']['records'] and states['supplier']['evidence_candidates']:states['supplier']['status']='Payment advice found · confirm settlement'
    invoices=store.records(c,job['id'],'invoice')
    if invoices:
        f=flow.finance(c,job);states['client']['status']='Paid' if number(f['outstanding'])==0 else 'Outstanding '+f['outstanding']+' '+job['currency']
    return dict(order_verified=verified,lines=lines,complete=verified and bool(lines) and all(number(l['remaining'])==0 for l in lines),payments=states)

def approve(store,flow,c,jid,data,actor):
    job=flow.check_version(c,jid,data.get('version'))
    if data.get('confirmed') is not True:raise ValueError('Confirm you checked the received quantities and condition')
    if not str(data.get('note','')).strip():raise ValueError('Receipt check note is required')
    receipt_date=data.get('received_date','');day(receipt_date)
    if day(receipt_date)>datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date():raise ValueError('Receipt date cannot be in the future')
    lines=data.get('lines',[]);flow.validate_lines(job,dict(lines=lines))
    for line in lines:number(line['quantity'],True)
    evidence='Staff receipt check on '+receipt_date+': '+str(data['note']).strip()
    if data.get('source_evidence'):evidence+=' | '+str(data['source_evidence'])
    if not store.records(c,jid,'client_po'):
        if data.get('confirm_order') is not True or not str(data.get('order_reference','')).strip():raise ValueError('Verify the client PO reference and ordered quantities first')
        flow.record(c,jid,'client_po',dict(version=job['version'],reference=str(data['order_reference']).strip(),evidence='Staff verified client order: '+evidence,lines=[dict(item_id=i['id'],quantity=i['quantity']) for i in job['items']]),actor)
        job=store.job(c,jid)
    rid=flow.record(c,jid,'delivery',dict(version=job['version'],lines=lines,evidence=evidence,received_date=receipt_date,approval_source='staff'),actor)
    # Resolve only the contents-check task on full completion, preserving other tasks.
    job=store.job(c,jid)
    if job['fulfilment']=='delivered':
        for task in store.records(c,jid,'review_task'):
            if task.get('title')=='Verify Q6994 received quantities and condition':
                task.update(resolved=True,resolved_by=actor,resolved_at=now(),resolution=evidence)
                c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(task),task['id']))
        s=job.get('trial_review') or job.get('import_summary')
        if s:
            s['actions']=[a for a in s.get('actions',[]) if a.get('tag')!='RECEIPT CHECK']
            s['caution']='Received quantities and condition confirmed by '+actor+' on '+receipt_date+'. Invoice and payment statuses are tracked separately.'
            c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps({k:v for k,v in job.items() if k not in ['id','version','created_at','updated_at']}),jid))
    if job['fulfilment']=='delivered':
        from .dashboard_details import details
        messages=[dict(id=r['id'],**json.loads(r['data'])) for r in c.execute('SELECT id,data FROM messages WHERE job_id=?',(jid,))]
        for flag in details(store,c,job,store.records(c,jid),messages)['review_flags']:
            if flag['title']=='Received contents are unchecked':
                c.execute('INSERT OR REPLACE INTO review_flag_actions VALUES (?,?,?)',(jid,flag['id'],json.dumps(dict(status='reviewed',resolution=evidence,actor=actor,reviewed_at=now()))))
    return rid

def payment(store,flow,c,jid,data,actor):
    job=flow.check_version(c,jid,data.get('version'))
    party=data.get('party');status=data.get('status')
    if party not in ['client','supplier'] or status not in ['partial','paid']:raise ValueError('Choose payment direction and status')
    if data.get('confirmed') is not True:raise ValueError('Confirm the payment was received or settled')
    for field in ['document_reference','reference','payment_date','currency','note']:
        if not str(data.get(field,'')).strip():raise ValueError('Payment date, document/payment references, currency and confirmation note are required')
    day(data['payment_date'])
    if day(data['payment_date'])>datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date():raise ValueError('Payment date cannot be in the future')
    if not re.fullmatch('[A-Za-z]{3}',data['currency']):raise ValueError('Use a three-letter currency code')
    amount=number(data.get('amount'),True)
    previous=store.records(c,jid,'manual_payment_confirmation')
    if any(r['party']==party and r['reference']==data['reference'] for r in previous):raise ValueError('This payment reference is already recorded')
    payload={k:data[k] for k in ['party','status','document_reference','reference','payment_date','currency','note']};payload.update(amount=str(amount),currency=data['currency'].upper(),source='Staff confirmation',confirmed_by=actor,confirmed_at=now())
    if party=='client' and store.records(c,jid,'invoice'):
        invoice=next((r for r in store.records(c,jid,'invoice') if r['id']==data.get('invoice_id')),None)
        if not invoice:raise ValueError('Select the client invoice receiving this payment')
        if payload['currency']!=invoice.get('currency',job['currency']).upper():raise ValueError('Payment currency must match the invoice currency')
        paid=sum(number(r['amount']) for r in store.records(c,jid,'payment') if r['invoice_id']==invoice['id'])
        if status=='paid' and amount+paid!=number(invoice['amount']):raise ValueError('This amount does not settle the invoice balance; choose Partial payment')
        flow.record(c,jid,'payment',dict(version=job['version'],invoice_id=invoice['id'],reference=payload['reference'],amount=payload['amount'],evidence='Staff confirmed payment: '+payload['note'],payment_date=payload['payment_date']),actor)
        payload['invoice_id']=invoice['id']
    rid=store.add_record(c,jid,'manual_payment_confirmation',payload,actor);store.bump(c,jid)
    return rid
