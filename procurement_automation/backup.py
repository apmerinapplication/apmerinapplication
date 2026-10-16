"""Portable encrypted online backups and verified restore to an empty directory."""
import argparse
import base64
import io
import json
import os
import sqlite3
import subprocess
import tempfile
import zipfile
from datetime import datetime,timezone
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .store import Store,now

def encryption_key():
    raw=base64.urlsafe_b64decode(os.environ.get('APMERIN_BACKUP_KEY',''))
    if len(raw)!=32:raise ValueError('APMERIN_BACKUP_KEY must be a base64-encoded 32-byte key; store it independently')
    return raw

def make_backup(store,output,upload=False):
    key=encryption_key()
    with tempfile.TemporaryDirectory() as temp:
        snapshot=Path(temp)/'workflow.sqlite'
        with store.connection() as source:
            target=sqlite3.connect(snapshot)
            try:source.backup(target)
            finally:target.close()
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.write(snapshot,'workflow.sqlite')
            if (store.directory/'session.key').exists():archive.write(store.directory/'session.key','session.key')
            for file in (store.directory/'attachments').glob('*'):
                if file.is_file():archive.write(file,'attachments/'+file.name)
            for file in (store.directory/'original_emails').glob('*.eml'):
                if file.is_file():archive.write(file,'original_emails/'+file.name)
        nonce=os.urandom(12)
        encrypted=b'APMERIN1'+nonce+AESGCM(key).encrypt(nonce,buffer.getvalue(),b'APMERIN1')
        output=Path(output);output.mkdir(parents=True,exist_ok=True)
        file=output/('apmerin-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.enc')
        file.write_bytes(encrypted)
        os.chmod(file,0o600)
        if upload:
            destination=os.environ.get('APMERIN_BACKUP_DESTINATION','')
            if not destination or destination.startswith('-') or ':' not in destination:raise ValueError('Configure an off-server SCP destination user@host:/directory/')
            subprocess.run(['scp','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',str(file),destination],check=True,timeout=120,capture_output=True)
        with store.transaction() as c:c.execute('INSERT OR REPLACE INTO worker_state VALUES (?,?)',('backup',json.dumps(dict(at=now(),filename=file.name,offsite_uploaded=upload))))
        return file

def restore(file,directory):
    directory=Path(directory)
    if directory.exists() and any(directory.iterdir()):raise ValueError('Restore requires an empty directory; existing production files will not be overwritten')
    raw=Path(file).read_bytes()
    if raw[:8]!=b'APMERIN1':raise ValueError('Unknown backup format')
    plain=AESGCM(encryption_key()).decrypt(raw[8:20],raw[20:],b'APMERIN1')
    with zipfile.ZipFile(io.BytesIO(plain)) as archive:
        for name in archive.namelist():
            path=Path(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or (name not in ['workflow.sqlite','session.key'] and not (name.startswith(('attachments/','original_emails/')) and len(path.parts)==2)):
                raise ValueError('Unsafe archive path')
        # Validate before touching the destination.
        with tempfile.TemporaryDirectory() as temp:
            archive.extractall(temp)
            c=sqlite3.connect(Path(temp)/'workflow.sqlite')
            try:
                if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Backup database integrity check failed')
                if c.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('Backup database has orphaned records')
            finally:c.close()
            import shutil
            directory.mkdir(parents=True,exist_ok=True)
            for src in Path(temp).iterdir():
                if src.is_dir():shutil.copytree(src,directory/src.name)
                else:shutil.copy2(src,directory/src.name)
    return directory

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['create','restore','key']);p.add_argument('--file');p.add_argument('--directory');p.add_argument('--upload',action='store_true');a=p.parse_args()
    if a.command=='key':print(base64.urlsafe_b64encode(os.urandom(32)).decode())
    elif a.command=='create':print(make_backup(Store(),a.directory or os.environ.get('APMERIN_BACKUP_DIR','backups'),a.upload))
    else:print(restore(a.file,a.directory))

if __name__=='__main__':main()
