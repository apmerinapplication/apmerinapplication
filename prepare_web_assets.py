"""Stage only explicitly listed web assets, with server-only Gemini transport."""
import json
import re
from pathlib import Path
from procurement_automation.package import strip_legacy_credentials

GEMINI_TRANSPORT="""// Web deployment: Gemini credentials exist only on the authenticated server.
function getApiKey(){return '';}
async function setApiKey(){throw new Error('Configure Gemini in Vercel server settings.');}
async function callGeminiApi(parts, unused='', kind='quote'){
  const authResponse=await fetch('/workflow/api/session');
  const auth=await authResponse.json();
  if(!auth.user)throw new Error('Sign in to the shared dashboard first.');
  const response=await fetch('/workflow/api/worksheet/extract',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':auth.csrf},body:JSON.stringify({parts,kind})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Extraction failed.');
  return data.items;
}
"""


def asset_bytes(path):
    raw=path.read_bytes()
    if path.name in ['app.js','email_studio.js','sync_manager.py']:
        return strip_legacy_credentials(raw.decode('utf-8')).encode('utf-8')
    if path.name=='index.html' and path.parent.name=='templates':
        text=re.sub(r'<p[^>]*>\s*Default Access:.*?</p>','',raw.decode('utf-8'),flags=re.S)
        return text.encode('utf-8')
    if path.name=='gemini_engine.js':
        text=raw.decode('utf-8');text=text[text.index('function getExtractionPrompt'):]
        text=text.replace('const promptText = getExtractionPrompt(docType);',"const promptText = ''; ")
        text=text.replace('callGeminiApi(parts)',"callGeminiApi(parts, '', docType)")
        return (GEMINI_TRANSPORT+text).encode('utf-8')
    return raw


def prepare(root=None):
    root=Path(root or Path(__file__).resolve().parent)
    files=json.loads((root/'deployment/web_source_allowlist.json').read_text(encoding='utf-8'))
    written=[]
    for name in files:
        if name.startswith('static/'):target='public/'+name
        elif name.startswith('procurement_automation/static/'):target=name.replace('procurement_automation/static/','public/workflow/static/',1)
        else:continue
        path=root/target;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(asset_bytes(root/name));written.append(target)
    return written

if __name__=='__main__':prepare()
