"""Explicit setup/import/export commands. No legacy data is modified."""
import argparse
import getpass
import json
import sqlite3
from pathlib import Path
from werkzeug.security import generate_password_hash
from .store import Store,now
from .workflow import Workflow

def seed(store):
    names=[('admin','Administrator','admin'),('suga','Suga','procurement'),('kirthana','Kirthana','procurement'),('navin','Navin','procurement'),('accounting','Nurul','accounting')]
    with store.transaction() as c:
        for uid,name,role in names:
            if c.execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone():continue
            password=getpass.getpass('Set a unique password (12+ characters) for '+name+': ')
            if len(password)<12:raise ValueError('Password must have at least 12 characters')
            c.execute('INSERT INTO users VALUES (?,?,?,?,1)',(uid,name,role,generate_password_hash(password)))

def import_legacy(store,path):
    # SQLite read-only source, explicit invocation, idempotent source mapping.
    source=sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)
    source.row_factory=sqlite3.Row
    flow=Workflow(store);count=0
    try:
        cards=source.execute("SELECT * FROM job_cards WHERE current_stage NOT IN ('closed','cancelled','lost')").fetchall()
        with store.transaction() as c:
            imported=store.setting('legacy_imports',{},c)
            for row in cards:
                key=str(Path(path).resolve())+':'+row['id']
                if key in imported:continue
                old=dict(row)
                items=[dict(i) for i in source.execute('SELECT * FROM job_card_items WHERE job_card_id=?',(old['id'],))]
                payload=dict(client_name=old.get('client_name') or 'Unconfirmed client',client_email=old.get('client_email') or 'unconfirmed@invalid.local',vessel_name=old.get('vessel_name') or 'Unconfirmed vessel',requisition_no=old.get('requisition_no') or old['id'],notes='Imported '+old['id']+'; verify stages, quantities and financial evidence before use.',items=[dict(description=i.get('description') or 'Unconfirmed item',quantity=i.get('quantity') or 1,unit_price=i.get('unit_price') or 0,part_no=i.get('part_no',''),item_code=i.get('item_code','')) for i in items])
                job=None
                for existing in c.execute('SELECT id FROM jobs'):
                    candidate=store.job(c,existing[0])
                    if all(str(candidate[k]).casefold()==str(payload[k]).casefold() for k in ['client_email','vessel_name','requisition_no']):job=candidate;break
                if job is None:job=flow.create(c,payload,'migration')
                store.event(c,job['id'],'migration','legacy_record',old)
                for table in ['job_card_events','job_card_clarifications','job_card_logistics']:
                    if source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone():
                        for r in source.execute('SELECT * FROM '+table+' WHERE job_card_id=?',(old['id'],)):
                            store.event(c,job['id'],'migration',table,dict(r))
                imported[key]=job['id'];count+=1
            store.set_setting(c,'legacy_imports',imported)
    finally:source.close()
    return count

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['init-users','import-legacy','client-allowlist','import-eml','biztory-template','import-profiles','import-contacts']);p.add_argument('value',nargs='?');p.add_argument('--job-id');a=p.parse_args();store=Store()
    if a.command=='init-users':seed(store)
    elif a.command=='import-legacy':print('Imported active jobs:',import_legacy(store,a.value))
    elif a.command=='client-allowlist':
        with store.transaction() as c:store.set_setting(c,'client_emails',[v.strip().lower() for v in a.value.split(',')])
    elif a.command=='import-eml':
        from .ingestion import ingest,approve_message
        path=Path(a.value)
        files=sorted(path.glob('*.eml')) if path.is_dir() else [path]
        for index,file in enumerate(files,1):
            raw=file.read_bytes();ingest(store,Workflow(store),raw,'history:'+str(path),'INBOX','eml',index,live_monitor=False)
        print('Imported emails to review:',len(files))
    elif a.command=='biztory-template':
        import csv
        with open(a.value,encoding='utf-8-sig',newline='') as f:columns=next(csv.reader(f))
        with store.transaction() as c:store.set_setting(c,'biztory_template',columns)
        print('Stored Biztory sample columns. Configure field mapping through admin API before CSV export.')
    elif a.command=='import-profiles':
        bundle=json.loads(Path(a.value).read_text(encoding='utf-8'));signatures=bundle.get('signatures',{});count=0
        with store.transaction() as c:
            for profile in bundle.get('users',[])+([bundle['admin']] if isinstance(bundle.get('admin'),dict) else []):
                name=profile.get('name','').lower();uid=next((v for v in ['suga','kirthana','navin'] if v in name),'admin' if profile.get('isAdmin') else None)
                if not uid:continue
                signature=signatures.get(profile.get('signatureKey',''),'')
                if isinstance(signature,dict):signature=signature.get('html','')
                store.set_setting(c,'profile:'+uid,dict(email=profile.get('email',''),default_cc=profile.get('defaultCc',''),signature=str(signature or profile.get('signature',''))));count+=1
        print('Imported signatures/default CCs without passwords or sessions:',count)
    elif a.command=='import-contacts':
        bundle=json.loads(Path(a.value).read_text(encoding='utf-8'));contacts=bundle if isinstance(bundle,list) else bundle.get('contacts',[])
        clean=[{k:row.get(k,'') for k in ['name','email','company','notes']} for row in contacts]
        with store.transaction() as c:store.set_setting(c,'contacts',clean)
        print('Imported contacts:',len(clean))

if __name__=='__main__':main()
