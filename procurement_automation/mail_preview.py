"""Render retained email HTML without scripts, remote tracking or active content."""
import re
from html import escape
from bs4 import BeautifulSoup

def preview_html(data,prefix=''):
    html=data.get('body_html') or '<pre>'+escape(data.get('body_full',data.get('body','')))+' </pre>'
    soup=BeautifulSoup(html,'html.parser')
    for tag in soup.find_all(['script','iframe','object','embed','form','input','button','link','meta','base','svg','math','video','audio']):tag.decompose()
    cid={a.get('content_id','').strip('<>'):a['hash'] for a in data.get('attachments',[]) if a.get('content_type','').startswith('image/')}
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr.lower().startswith('on') or attr.lower() in ['srcset','background','action','formaction']:del tag[attr]
        if tag.has_attr('style') and re.search(r'url\s*\(|@import|expression\s*\(',tag['style'],re.I):del tag['style']
        if tag.name=='style' and re.search(r'url\s*\(|@import|expression\s*\(',tag.get_text(),re.I):tag.decompose();continue
        if tag.name=='img':
            src=tag.get('src','');key=src[4:].strip('<>') if src.lower().startswith('cid:') else ''
            if key in cid:tag['src']=prefix+'/api/attachments/'+cid[key]+'?preview=1'
            else:tag.replace_with(soup.new_string('[External or unavailable image: '+tag.get('alt','image')+']'))
        if tag.name=='a':
            href=tag.get('href','')
            if not href.lower().startswith(('https://','http://','mailto:')):tag.attrs.pop('href',None)
            tag['target']='_blank';tag['rel']='noopener noreferrer'
    return '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:20px;font-family:Calibri,Arial,sans-serif;color:#222;background:white}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}</style></head><body>'+str(soup)+'</body></html>'
