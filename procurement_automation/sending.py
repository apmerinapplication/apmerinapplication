"""Human-approved mail only. Uncertain SMTP outcomes must never auto-retry."""
import json
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid
from .store import now

def send_approved(store,flow,jid,rid,version,actor):
    username=os.environ.get('APMERIN_SMTP_'+actor.upper()+'_USER') or os.environ.get('APMERIN_SMTP_USER','')
    password=os.environ.get('APMERIN_SMTP_'+actor.upper()+'_PASSWORD') or os.environ.get('APMERIN_SMTP_PASSWORD','')
    host=os.environ.get('APMERIN_SMTP_HOST','')
    if not username or not password or not host:raise ValueError('SMTP not configured. Send the draft in Outlook and record evidence instead.')
    with store.transaction() as c:
        job=flow.check_version(c,jid,version)
        draft=next((r for r in store.records(c,jid,'draft') if r['id']==rid),None)
        if not draft or draft['status']!='draft':raise RuntimeError('Draft already sent, sending, or uncertain; verify Sent mail before taking further action')
        recipients=[v.strip() for v in draft['to'].split(',')]
        if any(not re.fullmatch(r'[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+',v) for v in recipients):raise ValueError('Invalid recipient email')
        profile=store.setting('profile:'+actor,{},c)
        raw_cc=profile.get('default_cc','')
        if isinstance(raw_cc,list):raw_cc=','.join(raw_cc)
        cc=[v.strip() for v in raw_cc.split(',') if v.strip()]
        if any(not re.fullmatch(r'[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+',v) for v in cc):raise ValueError('Invalid configured default CC')
        message=EmailMessage();message['From']=username;message['To']=', '.join(recipients)
        if cc:message['Cc']=', '.join(cc)
        message['Subject']=draft['subject'];message['Message-ID']=make_msgid();message['X-APMerin-Job']=jid;message.set_content(draft['body'])
        add_signature(message,profile.get('signature',''),draft['body'])
        for digest in draft.get('attachments',[]):
            if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Invalid attachment reference')
            path=store.blob('attachments',digest)
            if not path.is_file():raise ValueError('Attachment missing')
            message.add_attachment(path.read_bytes(),maintype='application',subtype='octet-stream',filename=digest)
        draft.update(status='sending',message_id=message['Message-ID'],approved_by=actor,approved_at=now())
        c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(draft),rid));store.bump(c,jid)
        store.event(c,jid,actor,'sending_approved',dict(draft_id=rid,message_id=message['Message-ID']))
    status='uncertain'
    try:
        port=int(os.environ.get('APMERIN_SMTP_PORT','465'))
        if port==465:
            smtp=smtplib.SMTP_SSL(host,port,context=ssl.create_default_context(),timeout=45)
        else:
            smtp=smtplib.SMTP(host,port,timeout=45);smtp.starttls(context=ssl.create_default_context())
        with smtp:
            smtp.login(username,password)
            rejected=smtp.send_message(message)
            if not rejected:status='sent'
    except Exception:pass
    with store.transaction() as c:
        draft['status']=status
        c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(draft),rid));store.bump(c,jid)
        store.event(c,jid,actor,'smtp_'+status,dict(draft_id=rid,message_id=message['Message-ID']))
        if status=='sent':
            # Receipt by SMTP establishes sending, never supplier acknowledgement/delivery.
            store.add_record(c,jid,'sent_confirmation',dict(draft_id=rid,evidence='smtp:'+message['Message-ID']),actor)
    return dict(status=status,message_id=message['Message-ID'],note='Check Sent mail before resending.' if status=='uncertain' else 'SMTP accepted the message.')

def add_signature(message,signature,body):
    if not signature:return
    from bs4 import BeautifulSoup
    from html import escape
    import base64
    soup=BeautifulSoup(signature,'html.parser');images=[]
    for tag in soup.find_all(['script','iframe','object','embed']):tag.decompose()
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr.lower().startswith('on') or str(tag[attr]).lower().startswith('javascript:'):del tag[attr]
        if tag.name=='img' and tag.get('src','').startswith('data:image/'):
            match=re.fullmatch(r'data:image/(png|jpeg|gif);base64,(.+)',tag['src'],re.S)
            if match:
                try:image_bytes=base64.b64decode(match[2],validate=True)
                except ValueError:continue
                cid=make_msgid()
                if len(image_bytes)<=2*1024*1024:images.append((image_bytes,match[1],cid));tag['src']='cid:'+cid[1:-1]
    message.add_alternative('<p>'+escape(body).replace('\n','<br>')+'</p>'+str(soup),subtype='html')
    for content,subtype,cid in images:message.get_payload()[-1].add_related(content,maintype='image',subtype=subtype,cid=cid)
