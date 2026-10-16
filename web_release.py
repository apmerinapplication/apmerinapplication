"""Build and verify the web-only Vercel release from an explicit source allowlist."""
import hashlib
import json
import re
import zipfile
from pathlib import Path
from prepare_web_assets import prepare, asset_bytes

ROOT=Path(__file__).resolve().parent
OUTPUT=ROOT/'deployment/AP_Merin_Web_Vercel.zip'


def sources():
    names=json.loads((ROOT/'deployment/web_source_allowlist.json').read_text(encoding='utf-8'))
    if len(names)!=len(set(names)):raise ValueError('Duplicate web allowlist entry')
    for name in names:
        p=Path(name)
        if p.is_absolute() or '..' in p.parts or p.suffix in ['.sqlite','.dpapi','.exe','.lnk','.zip','.bat','.command','.vbs'] or any(v in p.parts for v in ['scratch','shared_data','uploads','netlify','dist','build']):
            raise ValueError('Disallowed web source: '+name)
        if not (ROOT/p).is_file():raise ValueError('Missing web source: '+name)
    return names


def build():
    names=sources();public=prepare(ROOT);manifest={}
    with zipfile.ZipFile(OUTPUT,'w',zipfile.ZIP_DEFLATED) as z:
        for name in sorted(names+public):
            raw=asset_bytes(ROOT/name)
            # The public CDN and fallback Flask route must serve the same safe bytes.
            z.writestr(name,raw);manifest[name]=hashlib.sha256(raw).hexdigest()
        z.writestr('SOURCE_MANIFEST.json',json.dumps(manifest,indent=2))
    verify()
    return OUTPUT


def verify():
    names=set(sources())
    with zipfile.ZipFile(OUTPUT) as z:
        if z.testzip() is not None:raise ValueError('ZIP integrity failure')
        manifest=json.loads(z.read('SOURCE_MANIFEST.json'))
        public={('public/'+n if n.startswith('static/') else n.replace('procurement_automation/static/','public/workflow/static/',1)) for n in names if n.startswith(('static/','procurement_automation/static/'))}
        assert set(z.namelist())==names|public|{'SOURCE_MANIFEST.json'},'Unexpected archive entry'
        for name,digest in manifest.items():
            raw=z.read(name);assert hashlib.sha256(raw).hexdigest()==digest,'Manifest mismatch'
            source=name.replace('public/workflow/static/','procurement_automation/static/',1) if name.startswith('public/workflow/static/') else name.removeprefix('public/') if name.startswith('public/static/') else name
            assert raw==asset_bytes(ROOT/source),'Package does not match current web source: '+name
            if name.endswith(('.py','.js','.html','.json','.example','.toml')):
                assert not re.search(rb'AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{30,}',raw),'Private key found in package'
            if name.startswith(('public/','static/')) and name.endswith('.js'):
                assert not re.search(rb'generativelanguage\.googleapis\.com|x-goog-api-key',raw),'Browser Gemini transport found'
        example=z.read('deployment/web.env.example').decode()
        for line in example.splitlines():
            if '=' in line and not line.startswith('#'):
                name,value=line.split('=',1)
                if any(token in name for token in ['KEY','SECRET','PASSWORD','DATABASE_URL']):assert not value.strip(),'Nonblank secret example'
        assert z.read('pyproject.toml').decode().find('entrypoint = "main:app"')>=0
        assert 'desktop_app.py' not in manifest
    print('PASS: web ZIP integrity, exact allowlist, manifest, server-only Gemini, blank secrets; no company records or desktop files.')

if __name__=='__main__':print('Web-only release:',build())
