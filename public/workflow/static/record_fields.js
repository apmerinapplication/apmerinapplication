'use strict';
function enhanceRecordFields(){
  const choicesByField={clarification_id:'clarification',supplier_po_id:'supplier_po',shipment_id:'shipment',invoice_id:'invoice',draft_id:'draft'};
  for(const [name,kind] of Object.entries(choicesByField)){
    const input=document.querySelector(`#recordFields [name="${name}"]`);if(!input)continue;
    const select=document.createElement('select');select.name=name;select.required=input.required;
    const blank=document.createElement('option');blank.value='';blank.textContent='Select '+pretty(kind);select.append(blank);
    current.records.filter(r=>r.kind===kind).forEach(r=>{const option=document.createElement('option');option.value=r.id;option.textContent=r.reference||r.subject||r.question||r.id;if(input.value===r.id)option.selected=true;select.append(option);});input.replaceWith(select);
  }
  const purpose=document.querySelector('#recordFields [name="purpose"]');
  if(purpose){const select=document.createElement('select');select.name='purpose';select.required=true;const values=account.role==='accounting'?['payment_follow_up']:['supplier_rfq','client_quote','supplier_po','clarification','follow_up'];for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=pretty(value);option.selected=value===purpose.value;select.append(option);}purpose.replaceWith(select);}
  const attachmentInput=document.querySelector('#recordFields [name="attachment_hashes"]');
  if(attachmentInput){const group=document.createElement('fieldset');const title=document.createElement('legend');title.textContent='Attachments to include';group.append(title);const known=new Map();for(const r of current.records)if(r.kind==='document')known.set(r.hash,r.filename);for(const msg of current.messages||[])for(const a of msg.attachments||[])known.set(a.hash,a.filename);for(const [hash,filename] of known){const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.name='selected_attachment';input.value=hash;label.append(input,document.createTextNode(' '+filename));group.append(label);}attachmentInput.parentElement.replaceWith(group);}
}
