"""Identify supplier payment advice without treating submitted transfers as settled."""
import json,re

def candidates(store,c,jid):
    found=[];seen=set();job=store.job(c,jid)
    for row in c.execute('SELECT id,data FROM messages WHERE job_id=?',(jid,)):
        data=json.loads(row['data'])
        if not re.search(r'cross[ -]+border[ -]+payment|payment[ -]+debit[ -]+advi[cs]e',data.get('subject',''),re.I):continue
        if not data.get('sender','').lower().endswith('@apmerinservices.com.my'):continue
        for ext in data.get('extractions',[]):
            attachment=next((a for a in data.get('attachments',[]) if a['hash']==ext.get('hash')),None)
            if not attachment or ext['hash'] in seen:continue
            text=ext.get('text','')
            if not re.search(r'telegraphic transfer|transaction details|payment (?:debit )?advi[cs]e',text+'\n'+attachment['filename'],re.I):continue
            refs={r.upper() for r in re.findall(r'\bQ\d{4}\b',text+' '+attachment['filename'],re.I)}
            if refs and job.get('company_reference') and job['company_reference'].upper() not in refs:continue
            seen.add(ext['hash'])
            pending=bool(re.search(r'sent for approval|sent to bank|status\s*:?\s*(?:created|pending)|awaiting approval',text,re.I))
            amount=re.search(r'Amount\s*\[FCY\]\s*:\s*([\d,]+\.\d{2})',text,re.I)
            if not amount:amount=re.search(r'\bAmount\s*\n\s*(?:MYR|SGD|USD|EUR)?\s*([\d,]+\.\d{2})',text,re.I)
            currency=re.search(r'Currency\s*:\s*([A-Z]{3})',text,re.I)
            ref=re.search(r'(?:AOB Reference No|Reference No\.?)[ \t]*[:\n]\s*([A-Z0-9-]{6,})',text,re.I)
            found.append(dict(message_id=row['id'],document_hash=ext['hash'],filename=attachment['filename'],date=data.get('date',''),subject=data.get('subject',''),status='Advice submitted · settlement needs confirmation' if pending else 'Payment advice found · verify settlement',amount=amount[1].replace(',','') if amount else '',currency=currency[1].upper() if currency else '',reference=ref[1] if ref else ''))
    return found
