"""Reversible extraction exclusions. Originals are always retained."""
from fnmatch import fnmatchcase
import re
DEFAULT_RULES={'ignore_inline':True,'patterns':[],'overrides':{}}

def ignored(attachment,rules):
    override=rules.get('overrides',{}).get(attachment['hash'])
    if override is not None:return override=='ignore'
    if attachment.get('content_type','').startswith('image/') and re.match(r'^image\d+',attachment.get('filename',''),re.I):return True
    if rules.get('ignore_inline',True) and (attachment.get('content_id') or attachment.get('disposition')=='inline'):return True
    return any(fnmatchcase(attachment.get('filename','').lower(),p.lower()) for p in rules.get('patterns',[]))
