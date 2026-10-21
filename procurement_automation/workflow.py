"""Evidence-backed workflow, independent sourcing/fulfilment/finance and reminders."""
import csv
import io
import json
import re
import uuid
from datetime import datetime, date, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo
from .store import now

ROLES = {'admin','procurement','accounting'}
SOURCING = ['rfq_received','rfq_sent','quotes_received','comparison','client_quote_sent','awarded','lost','cancelled']
FULFILMENT = ['not_ordered','client_po_verified','supplier_po_sent','acknowledged','part_dispatched','dispatched','part_delivered','delivered']
DEFAULT_POLICY = dict(question_days=1,quote_days=2,dispatch_days=3,payment_days=3,working_days=[0,1,2,3,4],holidays=[])

def effective_owner(job,today=None):
    today=today or datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date()
    coverage=job.get('coverage',{})
    return coverage['user'] if coverage.get('user') and day(coverage['until'])>=today else job.get('owner','')

def number(value, positive=False):
    try:
        n = Decimal(str(value))
    except (InvalidOperation,ValueError):
        raise ValueError('Invalid number')
    if not n.is_finite() or n < 0 or (positive and n == 0):
        raise ValueError('Number must be finite and positive' if positive else 'Number must be finite and nonnegative')
    return n

def day(value):
    return date.fromisoformat(str(value)[:10])

def workday(value, count, policy):
    d = day(value)
    while count:
        d += timedelta(days=1)
        if d.weekday() in policy['working_days'] and d.isoformat() not in policy['holidays']:
            count -= 1
    return d

class Workflow:
    def __init__(self, store):
        self.store = store

    def create(self,c,data,actor):
        required = ['client_name','client_email','vessel_name','requisition_no']
        clean = {k:str(data.get(k,'')).strip() for k in required+['owner','port_location','currency','rfq_due_date','notes','client_reference']}
        clean['client_reference']=clean['client_reference'] or clean['requisition_no']
        if any(not clean[k] for k in required):
            raise ValueError('Client, client email, vessel and requisition are required')
        if '@' not in clean['client_email']:
            raise ValueError('Client email is required')
        if clean['owner'] and not c.execute("SELECT 1 FROM users WHERE id=? AND active=1 AND role='procurement'",(clean['owner'],)).fetchone():
            raise ValueError('Owner must be an active procurement user')
        if clean['rfq_due_date']:
            day(clean['rfq_due_date'])
        for r in c.execute('SELECT data FROM jobs'):
            other = json.loads(r[0])
            if all(other[k].casefold()==clean[k].casefold() for k in ['client_email','vessel_name','requisition_no']):
                raise ValueError('A job already exists for this client, vessel and requisition')
        items = []
        for item in data.get('items',[]):
            if not str(item.get('description','')).strip():
                raise ValueError('Every item requires a description')
            items.append(dict(item,id=uuid.uuid4().hex,quantity=str(number(item['quantity'],True)),unit_price=str(number(item.get('unit_price',0)))))
        clean.update(items=items,currency=clean['currency'] or 'MYR',sourcing='rfq_received',fulfilment='not_ordered')
        jid = 'JC-'+datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).strftime('%y')+'-'+uuid.uuid4().hex[:8].upper()
        c.execute('INSERT INTO jobs VALUES (?,?,?,?,?)',(jid,1,json.dumps(clean),now(),now()))
        self.store.event(c,jid,actor,'created',clean)
        return self.store.job(c,jid)

    def check_version(self,c,jid,version):
        job = self.store.job(c,jid)
        if version != job['version']:
            raise RuntimeError('Job changed. Reload before saving.')
        return job

    def update(self,c,jid,data,actor):
        job = self.check_version(c,jid,data.get('version'))
        original_owner=job.get('owner','')
        for key in ['owner','notes','port_location','rfq_due_date','client_name','client_email','vessel_name','requisition_no']:
            if key in data:
                job[key] = str(data[key]).strip()
        if 'owner' in data and job.get('owner')!=original_owner:job['coverage']={}
        if any(key in data and not job[key] for key in ['client_name','vessel_name','requisition_no']):raise ValueError('Client, vessel and requisition must not be blank')
        if 'client_email' in data and '@' not in job['client_email']:raise ValueError('Enter a valid client email')
        if job.get('rfq_due_date'):
            day(job['rfq_due_date'])
        if job.get('owner') and not c.execute("SELECT 1 FROM users WHERE id=? AND role='procurement' AND active=1",(job['owner'],)).fetchone():
            raise ValueError('Owner must be an active procurement user')
        for key,values in [('sourcing',SOURCING)]:
            if key in data:
                if data[key] not in values:
                    raise ValueError('Unknown stage')
                if data[key] == 'client_quote_sent' and not any(r.get('status')=='sent' and r.get('purpose')=='client_quote' for r in self.store.records(c,jid,'draft')):
                    raise ValueError('Record confirmed quotation sending first')
                job[key]=data[key]
        saved = {k:v for k,v in job.items() if k not in ['id','version','created_at','updated_at','finance']}
        c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(saved),jid))
        self.store.bump(c,jid)
        self.store.event(c,jid,actor,'updated',data)
        return self.store.job(c,jid)

    def quantities(self,c,job):
        delivered = {i['id']:Decimal(0) for i in job['items']}
        invoiced = dict(delivered)
        for r in self.store.records(c,job['id'],'delivery'):
            for line in r['lines']:
                delivered[line['item_id']] += number(line['quantity'])
        for r in self.store.records(c,job['id'],'invoice'):
            for line in r['lines']:
                invoiced[line['item_id']] += number(line['quantity'])
        return delivered,invoiced

    def transfer(self,c,jid,data,actor):
        job=self.check_version(c,jid,data.get('version'))
        target=str(data.get('owner',''))
        if not c.execute("SELECT 1 FROM users WHERE id=? AND active=1 AND role='procurement'",(target,)).fetchone():raise ValueError('Choose an active procurement user')
        until=data.get('until','')
        if until and day(until)<datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date():raise ValueError('Coverage end date must be today or later')
        previous=job.get('owner','')
        if until:job['coverage']=dict(user=target,until=until,reason=str(data.get('reason','')))
        else:job.update(owner=target,coverage={})
        saved={k:v for k,v in job.items() if k not in ['id','version','created_at','updated_at','finance']}
        c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(saved),jid));self.store.bump(c,jid)
        self.store.event(c,jid,actor,'job_transferred',dict(previous=previous,owner=target,until=until,reason=data.get('reason','')))
        return self.store.job(c,jid)

    def ordered(self,c,job,kind='client_po'):
        totals={i['id']:Decimal(0) for i in job['items']}
        for record in self.store.records(c,job['id'],kind):
            for line in record.get('lines',[]):totals[line['item_id']]+=number(line['quantity'])
        return totals

    def record(self,c,jid,kind,data,actor):
        job=self.check_version(c,jid,data.get('version'))
        payload={k:v for k,v in data.items() if k!='version'}
        if kind=='clarification':
            if not payload.get('question'):
                raise ValueError('Question required')
            payload.update(status='pending',received_at=now())
        elif kind=='answer':
            original=next((r for r in self.store.records(c,jid,'clarification') if r['id']==payload.get('clarification_id')),None)
            if not original or not payload.get('answer') or not payload.get('evidence'):
                raise ValueError('Question, answer and sent-email evidence required')
        elif kind=='supplier_rfq':
            if not all(payload.get(k) for k in ['supplier_email','evidence']):
                raise ValueError('Supplier email and confirmed sending evidence required')
            payload.setdefault('sent_date',now()[:10]);day(payload['sent_date'])
            if job['sourcing']=='rfq_received':job['sourcing']='rfq_sent'
        elif kind=='supplier_quote':
            if not payload.get('supplier_email') or not payload.get('evidence'):
                raise ValueError('Supplier and quotation evidence required')
            if payload.get('lines'):
                self.validate_lines(job,payload)
                for line in payload['lines']:
                    line['unit_cost']=str(number(line.get('unit_cost')))
                    discount=number(line.get('discount_percent',0))
                    if discount>100:raise ValueError('Discount cannot exceed 100%')
                    line['discount_percent']=str(discount)
                payload['currency']=str(payload.get('currency',job['currency'])).upper()
            if job['sourcing'] not in ['awarded','lost','cancelled']:job['sourcing']='quotes_received'
        elif kind=='supplier_update':
            po=next((r for r in self.store.records(c,jid,'supplier_po') if r['id']==payload.get('supplier_po_id')),None)
            if not po or not payload.get('evidence'):raise ValueError('Supplier PO and acknowledgement/date evidence required')
            if payload.get('dispatch_date'):
                day(payload['dispatch_date']);po['dispatch_date']=payload['dispatch_date']
            po['acknowledged_at']=now()
            c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(po),po['id']))
            if job['fulfilment']=='supplier_po_sent':job['fulfilment']='acknowledged'
        elif kind in ['client_po','supplier_po','shipment']:
            if not payload.get('reference') or not payload.get('evidence'):
                raise ValueError('Reference and document evidence required')
            if kind=='client_po':
                self.validate_lines(job,payload)
                totals=self.ordered(c,job)
                for line in payload['lines']:
                    item=next(i for i in job['items'] if i['id']==line['item_id'])
                    if totals[item['id']]+number(line['quantity'])>number(item['quantity']):raise ValueError('Client order exceeds RFQ quantity; review revised RFQ first')
                job['fulfilment']='client_po_verified'
            if kind=='supplier_po':
                if not self.store.records(c,jid,'client_po'):
                    raise ValueError('Verify client PO first')
                if not payload.get('supplier_email'):
                    raise ValueError('Supplier email required')
                self.validate_lines(job,payload)
                ordered=self.ordered(c,job);allocated=self.ordered(c,job,'supplier_po')
                for line in payload['lines']:
                    if allocated[line['item_id']]+number(line['quantity'])>ordered[line['item_id']]:raise ValueError('Supplier allocation exceeds verified client order')
                    if 'unit_cost' in line:line['unit_cost']=str(number(line['unit_cost']))
                if not payload.get('dispatch_date'):
                    payload['dispatch_date']=''
                else:
                    day(payload['dispatch_date'])
                job['fulfilment']='supplier_po_sent'
            if kind=='shipment':
                if not self.store.records(c,jid,'supplier_po'):
                    raise ValueError('Record supplier PO first')
                if payload.get('eta'):
                    day(payload['eta'])
                self.validate_lines(job,payload)
                po=next((r for r in self.store.records(c,jid,'supplier_po') if r['id']==payload.get('supplier_po_id')),None)
                if not po:raise ValueError('Select the supplier PO for this shipment')
                limits={l['item_id']:number(l['quantity']) for l in po['lines']}
                shipped={k:Decimal(0) for k in limits}
                for r in self.store.records(c,jid,'shipment'):
                    if r.get('supplier_po_id')==po['id']:
                        for line in r['lines']:shipped[line['item_id']]+=number(line['quantity'])
                for line in payload['lines']:
                    if line['item_id'] not in limits or shipped[line['item_id']]+number(line['quantity'])>limits[line['item_id']]:raise ValueError('Shipment exceeds supplier PO quantity')
                job['fulfilment']='part_dispatched'
        elif kind=='delivery':
            if not self.store.records(c,jid,'client_po'):
                raise ValueError('Verified client PO required')
            if not payload.get('evidence'):
                raise ValueError('Verified proof of delivery required')
            delivered,_=self.quantities(c,job)
            self.validate_lines(job,payload)
            ordered=self.ordered(c,job)
            for line in payload['lines']:
                item=next(i for i in job['items'] if i['id']==line['item_id'])
                if delivered[item['id']]+number(line['quantity'])>ordered[item['id']]:
                    raise ValueError('Delivered quantity exceeds ordered quantity')
                delivered[item['id']]+=number(line['quantity'])
            if payload.get('shipment_id'):
                shipment=next((r for r in self.store.records(c,jid,'shipment') if r['id']==payload['shipment_id']),None)
                if not shipment:raise ValueError('Shipment not found')
                limits={l['item_id']:number(l['quantity']) for l in shipment['lines']}
                received={k:Decimal(0) for k in limits}
                for r in self.store.records(c,jid,'delivery'):
                    if r.get('shipment_id')==shipment['id']:
                        for line in r['lines']:received[line['item_id']]+=number(line['quantity'])
                if any(l['item_id'] not in limits or received[l['item_id']]+number(l['quantity'])>limits[l['item_id']] for l in payload['lines']):raise ValueError('Delivery exceeds shipment quantity')
            job['fulfilment']='delivered' if all(delivered[k]==quantity for k,quantity in ordered.items()) else 'part_delivered'
        elif kind=='invoice':
            self.validate_lines(job,payload)
            if not all(payload.get(k) for k in ['reference','invoice_date','due_date','evidence']):
                raise ValueError('Biztory invoice reference, dates and evidence required')
            day(payload['invoice_date']);day(payload['due_date'])
            if day(payload['due_date'])<day(payload['invoice_date']):
                raise ValueError('Due date precedes invoice date')
            for r in c.execute("SELECT data FROM records WHERE kind='invoice'"):
                if json.loads(r[0])['reference']==payload['reference']:
                    raise ValueError('Invoice reference already recorded')
            delivered,invoiced=self.quantities(c,job)
            for line in payload['lines']:
                if number(line['quantity'])>delivered[line['item_id']]-invoiced[line['item_id']]:
                    raise ValueError('Invoice exceeds confirmed uninvoiced delivery')
            payload['amount']=str(number(payload.get('amount'),True).quantize(Decimal('0.01')))
        elif kind=='payment':
            invoice=next((r for r in self.store.records(c,jid,'invoice') if r['id']==payload.get('invoice_id')),None)
            if not invoice or not payload.get('reference') or not payload.get('evidence'):
                raise ValueError('Invoice, payment reference and confirmed Biztory/bank evidence required')
            payments=self.store.records(c,jid,'payment')
            if any(r.get('reference')==payload['reference'] for r in payments):
                raise ValueError('Payment reference already recorded')
            amount=number(payload.get('amount'),True)
            total=sum((number(r['amount']) for r in payments if r['invoice_id']==invoice['id']),Decimal(0))
            if amount+total>number(invoice['amount']):
                raise ValueError('Payment exceeds outstanding balance')
            payload['amount']=str(amount.quantize(Decimal('0.01')))
        elif kind=='draft':
            if not all(payload.get(k) for k in ['to','subject','body','purpose']):
                raise ValueError('Recipient, subject, body and purpose required')
            if any('\n' in str(payload[k]) or '\r' in str(payload[k]) for k in ['to','subject']):
                raise ValueError('Invalid email header')
            payload['status']='draft'
        elif kind=='sent_confirmation':
            draft=next((r for r in self.store.records(c,jid,'draft') if r['id']==payload.get('draft_id')),None)
            if not draft or not payload.get('evidence'):
                raise ValueError('Draft and sent-mail evidence required')
            draft['status']='sent'
            c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(draft),draft['id']))
            if draft['purpose']=='client_quote':
                job['sourcing']='client_quote_sent'
        else:
            raise ValueError('Unknown record type')
        rid=self.store.add_record(c,jid,kind,payload,actor)
        job['fulfilment']=self.fulfilment(c,job)
        saved={k:v for k,v in job.items() if k not in ['id','version','created_at','updated_at','finance']}
        c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(saved),jid))
        self.store.bump(c,jid)
        return rid

    def fulfilment(self,c,job):
        ordered=self.ordered(c,job)
        if not any(ordered.values()):return 'not_ordered'
        delivered,_=self.quantities(c,job)
        if any(delivered.values()):return 'delivered' if all(delivered[k]==v for k,v in ordered.items()) else 'part_delivered'
        shipped={k:Decimal(0) for k in ordered}
        for r in self.store.records(c,job['id'],'shipment'):
            for line in r['lines']:shipped[line['item_id']]+=number(line['quantity'])
        if any(shipped.values()):return 'dispatched' if all(shipped[k]==v for k,v in ordered.items()) else 'part_dispatched'
        pos=self.store.records(c,job['id'],'supplier_po')
        if any(r.get('acknowledged_at') for r in pos):return 'acknowledged'
        return 'supplier_po_sent' if pos else 'client_po_verified'

    def validate_lines(self,job,payload):
        if not payload.get('lines'):
            raise ValueError('At least one item quantity required')
        ids={i['id'] for i in job['items']}
        seen=set()
        for line in payload['lines']:
            if line.get('item_id') not in ids or line['item_id'] in seen:
                raise ValueError('Unknown or duplicate item')
            seen.add(line['item_id'])
            line['quantity']=str(number(line.get('quantity'),True))

    def finance(self,c,job):
        delivered,invoiced=self.quantities(c,job)
        invoices=self.store.records(c,job['id'],'invoice')
        payments=self.store.records(c,job['id'],'payment')
        outstanding=Decimal(0)
        overdue=False
        today=datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date()
        for invoice in invoices:
            paid=sum((number(p['amount']) for p in payments if p['invoice_id']==invoice['id']),Decimal(0))
            balance=number(invoice['amount'])-paid
            outstanding+=balance
            overdue|=balance>0 and day(invoice['due_date'])<today
        ready={k:str(delivered[k]-invoiced[k]) for k in delivered if delivered[k]>invoiced[k]}
        return dict(eligible_quantities=ready,outstanding=str(outstanding),status='overdue' if overdue else ('ready_to_invoice' if ready else ('invoiced' if outstanding else ('settled' if invoices else 'unbilled'))))

    def reminders(self,c,user,today=None):
        today=today or datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date()
        policy=self.store.setting('policy',DEFAULT_POLICY,c)
        result=[]
        def add(job,key,title,due,finance=False,evidence=''):
            if finance and user['role']=='procurement':return
            if not finance and user['role']=='accounting':return
            rid=job['id']+':'+key
            action=c.reminder_actions.get(rid) if hasattr(c,'reminder_actions') else c.execute('SELECT * FROM reminder_actions WHERE id=?',(rid,)).fetchone()
            if action and action['until_date'] and day(action['until_date'])>today:return
            owner=effective_owner(job,today)
            result.append(dict(id=rid,job_id=job['id'],title=title,due_date=str(due),overdue=due<today,owner='accounting' if finance else owner,mine=user['role']=='admin' or finance or owner==user['id'],escalated=due<today,evidence=evidence))
        for row in c.execute('SELECT id FROM jobs'):
            job=self.store.job(c,row[0])
            if job['sourcing'] in ['lost','cancelled']:continue
            records=self.store.records(c,job['id'])
            quotes=[r for r in records if r['kind']=='supplier_quote']
            if quotes and job['sourcing'] in ['rfq_received','rfq_sent','quotes_received','comparison']:
                title='Review imported supplier quotation and client quote status' if quotes[0].get('review_required') else 'Supplier quotation received — prepare client quote or wait for more offers'
                due=datetime.fromisoformat(quotes[0]['created_at']).astimezone(ZoneInfo('Asia/Kuala_Lumpur')).date()
                add(job,'quote_client',title,due,evidence=quotes[0].get('evidence',''))
            for task in records:
                if task['kind']=='review_task' and not task.get('resolved'):
                    add(job,'review:'+task['id'],task['title'],day(task['due_date']),bool(task.get('finance')),task.get('evidence',''))
            answered={r.get('clarification_id') for r in records if r['kind']=='answer'}
            for r in records:
                if r['kind']=='clarification' and r['id'] not in answered:
                    add(job,'question:'+r['id'],r['question'],workday(r['received_at'],policy['question_days'],policy),evidence=r.get('evidence',''))
                if r['kind']=='supplier_rfq' and not any(q['kind']=='supplier_quote' and q.get('supplier_email')==r['supplier_email'] and q['created_at']>=r['created_at'] for q in records):
                    due=workday(r['sent_date'],policy['quote_days'],policy)
                    if job.get('rfq_due_date'):due=min(due,day(job['rfq_due_date']))
                    add(job,'quote:'+r['id'],'Chase quotation: '+r['supplier_email'],due,evidence=r.get('evidence',''))
                if r['kind']=='supplier_po' and job['fulfilment']!='delivered':
                    shipped_totals={line['item_id']:Decimal(0) for line in r['lines']}
                    for q in records:
                        if q['kind']=='shipment' and q.get('supplier_po_id')==r['id']:
                            for line in q['lines']:shipped_totals[line['item_id']]+=number(line['quantity'])
                    shipped=all(shipped_totals[line['item_id']]>=number(line['quantity']) for line in r['lines'])
                    if not shipped:
                        due=day(r['dispatch_date'])-timedelta(days=policy['dispatch_days']) if r.get('dispatch_date') else today
                        if due<=today:add(job,'dispatch:'+r['id'],'Confirm dispatch: '+r['reference'] if r.get('dispatch_date') else 'Request promised dispatch date: '+r['reference'],due,evidence=r.get('evidence',''))
                if r['kind']=='shipment' and r.get('eta') and day(r['eta'])<=today:
                    received={line['item_id']:Decimal(0) for line in r['lines']}
                    for d in records:
                        if d['kind']=='delivery' and d.get('shipment_id')==r['id']:
                            for line in d['lines']:received[line['item_id']]+=number(line['quantity'])
                    if any(received[line['item_id']]<number(line['quantity']) for line in r['lines']):add(job,'eta:'+r['id'],'Confirm arrival/delivery: '+r['reference'],day(r['eta']),evidence=r.get('evidence',''))
                if r['kind']=='invoice':
                    paid=sum((number(p['amount']) for p in records if p['kind']=='payment' and p['invoice_id']==r['id']),Decimal(0))
                    if paid<number(r['amount']) and day(r['due_date'])-timedelta(days=policy['payment_days'])<=today:
                        add(job,'payment:'+r['id'],'Collect payment: '+r['reference'],day(r['due_date']),True,r.get('evidence',''))
            if self.finance(c,job)['eligible_quantities']:
                add(job,'invoice','Prepare Biztory invoice for delivered items',today,True)
            if not job.get('owner'):add(job,'owner','Assign a procurement owner',today)
        return sorted(result,key=lambda r:(not r['overdue'],not r['mine'],r['due_date']))

    def export_invoice(self,c,jid):
        job=self.store.job(c,jid)
        ready=self.finance(c,job)['eligible_quantities']
        if not ready:raise ValueError('No confirmed uninvoiced delivered quantities')
        out=io.StringIO(newline='')
        writer=csv.writer(out,delimiter='\t')
        writer.writerow(['Job reference','Customer','Currency','Item code','Description','Quantity','Unit price','Line total'])
        for i in job['items']:
            if i['id'] in ready:
                values=[jid,job['client_name'],job['currency'],i.get('part_no') or i.get('item_code',''),i['description'],ready[i['id']],i['unit_price'],str(number(ready[i['id']])*number(i['unit_price']))]
                writer.writerow([("'"+str(v)) if str(v).startswith(('=','+','-','@')) else v for v in values])
        return out.getvalue()
