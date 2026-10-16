"""Local PDF layout extraction. Source content is data, never instructions."""
import re
from decimal import Decimal,InvalidOperation

LABELS={'vessel':['vessel name','ship name'],'requisition':['rf number','our rfq number','requisition no','requisition number'],'reference':['ref no','po number','invoice number'],'date':['date','purchase order date','invoice date'],'title':['rf title','requisition title'],'terms':['delivery terms'],'total':['total','total cost'],'due_date':['invoice due date']}

def labelled_fields(blocks):
    result={}
    for block in blocks:
        lines=[v.strip().strip(':').strip() for v in block.splitlines() if v.strip().strip(':').strip()]
        for key,labels in LABELS.items():
            for i,line in enumerate(lines[:-1]):
                if line.lower() in labels:
                    value=lines[i+1]
                    if value.lower() in {l for ls in LABELS.values() for l in ls}|{'delivery date','details','quotation','purchase order'}:continue
                    result.setdefault(key,value)
    return result

def amount(value):
    try:
        n=Decimal(str(value).replace(',','').strip())
        return str(n) if n.is_finite() and n>=0 else ''
    except InvalidOperation:return ''

def table_items(tables):
    result=[]
    for table in tables:
        columns=None
        for cells in table:
            cells=[str(c or '').strip() for c in cells]
            labels=[re.sub(r'\s+',' ',v.lower()) for v in cells]
            desc=next((i for i,v in enumerate(labels) if v in ['description','item name','item description']),None)
            qty=next((i for i,v in enumerate(labels) if v in ['qty','quantity',"q'ty",'po qty','po qty unit','qty unit']),None)
            if desc is not None and qty is not None:
                columns=dict(description=desc,quantity=qty,part_no=next((i for i,v in enumerate(labels) if v in ['part no','part number','code','item code','spec.']),None),unit_price=next((i for i,v in enumerate(labels) if v in ['price','unit cost','unit price','u/price']),None),line_total=next((i for i,v in enumerate(labels) if ('amount' in v.replace(' ','') and 'tax' not in v) or v=='cost'),None));continue
            if not columns or max(i for i in columns.values() if i is not None)>=len(cells):continue
            q=re.match(r'^(\d+(?:\.\d+)?)\s*(?:[A-Z]+)?$',cells[columns['quantity']],re.I)
            description=cells[columns['description']]
            if not q or Decimal(q[1])<=0 or not description:continue
            part=cells[columns['part_no']] if columns['part_no'] is not None else ''
            m=re.search(r'Part Number\s*:\s*([^\n]+)',description,re.I)
            if m:part=m[1].strip()
            result.append(dict(description=description.split('\nItem Code:')[0].strip(),quantity=q[1],part_no=part,unit_price=amount(cells[columns['unit_price']]) if columns['unit_price'] is not None else '',line_total=amount(cells[columns['line_total']]) if columns['line_total'] is not None else ''))
    return result
