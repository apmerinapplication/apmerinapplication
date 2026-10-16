"""Portable source bundle with an explicit allowlist and no runtime credentials/data."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

def strip_legacy_credentials(text):
    # Existing standalone assets embed old default profile passwords. Cloud copies must not.
    text=re.sub(r'((?:[\"\']?(?:password|smtp_password|api_key)[\"\']?)\s*[:=]\s*)([\"\'])(?:\\.|(?!\2).)*?\2',lambda m:m[1]+m[2]+m[2],text,flags=re.I)
    text=re.sub(r'((?:passwordInput|passInput)\s*={2,3}\s*|(?:\bpassword|\bsmtp_password)\s*\|\|\s*)([\"\'])(?:\\.|(?!\2).)*?\2',lambda m:m[1]+m[2]+m[2],text,flags=re.I)
    return re.sub(r"(const DEFAULT_PASS\s*=\s*)'[^']*'",r"\1''",text)

def build(output=None):
    root=Path(__file__).resolve().parent.parent
    output=Path(output or root/'deployment/AP_Merin_Shared_Workflow_Source.zip')
    singles=['app.py','shared_wsgi.py','matcher.py','extractor.py','gemini_vision.py','quotation_comparator.py','sync_manager.py','.dockerignore','Launch_Procurement_Automation.bat']
    files=[root/v for v in singles]
    for directory in ['templates','static','procurement_automation','deployment']:
        for path in (root/directory).rglob('*'):
            if not path.is_file() or '__pycache__' in path.parts or 'shared_data' in path.parts or 'ssh' in path.parts:continue
            if path.suffix.lower() in ['.py','.js','.css','.html','.md','.txt','.yaml'] or path.name in ['Dockerfile','Caddyfile','server.env.example']:
                if path.name in ['server.env','.env']:continue
                files.append(path)
    files.append(root/'email_automation/mailer.py')
    manifest={}
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(set(files)):
            name=path.relative_to(root).as_posix()
            raw=path.read_bytes()
            if name in ['sync_manager.py','static/email_studio.js','static/app.js']:
                raw=strip_legacy_credentials(raw.decode('utf-8')).encode('utf-8')
            archive.writestr(name,raw);manifest[name]=hashlib.sha256(raw).hexdigest()
        archive.writestr('SOURCE_MANIFEST.json',json.dumps(manifest,indent=2))
    return output,len(manifest)

if __name__=='__main__':
    output,count=build();print('Credential-free source package:',output,'files:',count)
