/* Original document prices, shared shipments, and traceable review issues. */
function clientPoText(refs){return (refs||[]).map(p=>p.reference).join(' · ')||'Not received';}
function sourceItemsPanel(){
  return `<h3>Items in the chosen document</h3><label>Price source<select id="priceDocument">${(current.price_documents||[]).map(d=>`<option value="${d.hash}" ${d.hash===current.selected_price_document?'selected':''}>${esc(d.filename)} · ${esc(d.currency)} · ${esc(d.kind)}</option>`).join('')}</select></label><p class="muted">Prices and currency come directly from this document. No currency conversion is applied.</p><div id="sourceDocumentItems"></div>`;
}
function renderSourceDocument(){
  const select=$('priceDocument');if(!select)return;
  const d=(current.price_documents||[]).find(d=>d.hash===select.value),target=$('sourceDocumentItems');
  if(!d){target.innerHTML='<p>No reliable document prices detected. Open the original supplier quotation above.</p>';return;}
  const m=current.messages.find(m=>m.id===d.message_id),a=m?.attachments?.find(a=>a.hash===d.hash);
  target.innerHTML=`<p><strong>${esc(d.currency)}</strong> · ${esc(d.filename)} · ${esc(d.date)}</p>${a?evidenceAttachment(a):''}${d.items.length?`<div class="tablewrap"><table><thead><tr><th>Part</th><th>Description</th><th>Qty in document</th><th>Unit price (${esc(d.currency)})</th><th>Discount</th><th>Line amount (${esc(d.currency)})</th></tr></thead><tbody>${d.items.map(i=>`<tr><td>${esc(i.part_no)}</td><td>${esc(i.description)}</td><td>${esc(i.quantity)}</td><td>${esc(i.unit_price||'Not detected')}</td><td>${esc(i.discount||'See original')}</td><td>${esc(i.line_total||'Not detected')}</td></tr>`).join('')}</tbody></table></div>`:'<p>The item table could not be extracted reliably. Preview the original document to check quantities and prices.</p>'}<p class="muted">Discounts, freight and totals should be checked in the original. These displayed prices do not change the accounting records.</p>`;
  bindEvidence();
}
function flagPanel(){
  const flags=current.review_flags||[];
  return `<h3>Review issues · ${flags.filter(f=>f.status!=='reviewed').length} open</h3>${flags.map(f=>`<article class="trial-flag"><span class="badge">${f.status==='reviewed'?'Reviewed':'Needs review'}</span><strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p>${f.status==='reviewed'?`<p>${esc(f.resolution)} · ${esc(f.reviewed_by)}</p>`:''}<details><summary>Why flagged · original source evidence (${f.sources.length})</summary>${f.sources.map(s=>{const mid=s.evidence?.replace(/^email:/,''),m=current.messages.find(m=>m.id===mid),a=m?.attachments?.find(a=>a.hash===s.document_hash);return `<div>${a?evidenceAttachment(a):''}${m?mailCard(m):`<a href="${prefix}/api/messages/${esc(mid)}/original">Open original email in Outlook</a>`}</div>`;}).join('')}</details>${account.role!=='accounting'?`<button data-flag-review="${f.id}" data-state="${f.status==='reviewed'?'open':'reviewed'}">${f.status==='reviewed'?'Reopen review':'Record review outcome'}</button>`:''}</article>`).join('')||'<p>No source-backed conflicts found in this evidence set.</p>'}${(current.review_notes||[]).length?`<details><summary>General verification notes (${current.review_notes.length})</summary><p class="muted">These are cautions or historical notes without a linked source in this card, rather than detected conflicts.</p>${current.review_notes.map(n=>`<p><strong>${esc(n.title)}</strong> · ${esc(n.detail)}</p>`).join('')}</details>`:''}`;
}
function primaryWaybillEmail(shipment,messages=current.messages){
 const compact=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const number=compact(shipment.number),ids=new Set((shipment.evidence||[]).map(e=>e.replace(/^email:/,'')));
 const matches=[];
 for(const m of messages||[]){
  if(!ids.has(m.id))continue;
  const subject=m.subject||'',body=(m.body||'').slice(0,2500),attachments=m.attachments||[];
  const extracts=(m.extractions||[]).filter(e=>compact(e.text).includes(number));
  if(!compact(subject+' '+body+' '+attachments.map(a=>a.filename).join(' ')).includes(number)&&!extracts.length)continue;
  let score=0;
  if(extracts.some(e=>/waybill|air\s*way\s*bill|\bAWB\b|express worldwide/i.test(e.text||'')))score+=120;
  if(attachments.some(a=>/\bAWB\b|waybill|airway/i.test(a.filename||'')))score+=60;
  if(attachments.some(a=>compact(a.filename).includes(number)))score+=25;
  if(!/@apmerinservices\.com\.my$/i.test(m.sender||'')&&!/@(?:[a-z0-9-]+\.)?(?:dhl|fedex)\.com$/i.test(m.sender||''))score+=45;
  if(/attached.{0,60}(?:shipping doc|awb|waybill)|(?:awb|waybill|shipping doc).{0,60}attached/i.test(body))score+=40;
  if(/\bAWB\b|\bHWB\b|waybill|tracking/i.test(subject))score+=35;
  if(/tracking number|awb number|waybill number/i.test(body))score+=25;
  if(/clearance|customs|notice for shipment|automatic reply|shipment notification/i.test(subject))score-=160;
  if(/payment|debit advi[cs]e|cross.border/i.test(subject))score-=220;
  if(score>0)matches.push({message:m,score});
 }
 matches.sort((a,b)=>b.score-a.score||(Date.parse(a.message.date)||0)-(Date.parse(b.message.date)||0)||a.message.id.localeCompare(b.message.id));
 return matches[0]?.message;
}
function trackingPanel(){
 const approved=current.staff_status?.complete;
 return `<section class="shipment-status"><h3>Delivery</h3>${(current.tracking||[]).map(s=>{
  const source=primaryWaybillEmail(s);
  const email=source?mailCard(source).replace(/(<summary>)[\s\S]*?(<\/summary>)/,'$1View '+(s.kind==='BL'?'BL':'AWB')+' email$2'):'';
  return `<article class="delivery-compact"><div class="delivery-identity"><strong>${esc(s.carrier)}</strong><span>${esc(s.kind)} <b>${esc(s.number)}</b></span><span class="badge">${esc(s.status==='Not checked'?'Tracking not checked':s.status)}</span>${s.tracking_url?`<a href="${esc(s.tracking_url)}" target="_blank" rel="noopener">Track shipment ↗</a>`:''}</div>${email}${(s.related_jobs||[]).length>1?`<p class="muted">Shared shipment: ${s.related_jobs.map(j=>`<button data-related-job="${esc(j.id)}">${esc(j.reference)}</button>`).join(' ')}</p>`:''}${s.kind==='BL'&&account.role!=='accounting'?`<button data-bl-update="${s.id}">Update delivery status</button>`:''}</article>`;
 }).join('')||'<p class="muted">No AWB or BL recorded yet.</p>'}${approved?'<p class="delivery-approved">✓ Received quantities checked and approved</p>':current.staff_status?'<div class="delivery-approve"><button class="primary" id="approveReceipt">Approve delivery</button><small>Confirm the items and received quantities.</small></div>':''}</section>`;
}
function bindDashboardDetails(){
    bindStaffConfirmation();
  if($('priceDocument')){$('priceDocument').onchange=renderSourceDocument;renderSourceDocument();}
  document.querySelectorAll('[data-related-job]').forEach(b=>b.onclick=run(()=>openJob(b.dataset.relatedJob)));
  document.querySelectorAll('[data-flag-review]').forEach(b=>b.onclick=()=>{
    const j=current.job,f=current.review_flags.find(f=>f.id===b.dataset.flagReview),state=b.dataset.state;
    showEditor('Review outcome · '+f.title,`<form id="flagOutcome"><label>Outcome and evidence<textarea name="resolution" required></textarea></label><button>Save review outcome</button><button type="button" id="flagBack">Back to job</button></form>`);
    $('flagBack').onclick=run(()=>openJob(j.id));$('flagOutcome').onsubmit=run(async e=>{e.preventDefault();await api('/jobs/'+j.id+'/flags/'+f.id,'POST',{...Object.fromEntries(new FormData(e.target)),status:state,version:j.version});await openJob(j.id);document.querySelector('[data-trial-tab="5"]')?.click();});
  });
  document.querySelectorAll('[data-bl-update]').forEach(b=>b.onclick=()=>{
    const j=current.job,s=current.tracking.find(s=>s.id===b.dataset.blUpdate);
    showEditor('Bill of lading · '+s.number,`<form id="blStatus"><label>Delivery status<input name="status" required value="${esc(s.status)}"></label><label>Evidence or update notes<textarea name="evidence" required></textarea></label><p>This status applies to all jobs sharing this bill of lading.</p><button>Save status</button><button type="button" id="blBack">Back to job</button></form>`);
    $('blBack').onclick=run(()=>openJob(j.id));$('blStatus').onsubmit=run(async e=>{e.preventDefault();await api('/tracking/'+s.id+'/manual','POST',{...Object.fromEntries(new FormData(e.target)),checked_at:s.checked_at});await openJob(j.id);});
  });
}

function staffStages(t){
  const stages=(t.stages||[]).filter(s=>!['Payment','Payment to supplier','Payment from client'].includes(s.title)).map(s=>s.title==='Delivery'&&current.staff_status?.complete?{...s,status:'Checked and approved',done:true}:s.title==='Invoice'&&current.staff_status?.complete&&Object.keys(current.job.finance.eligible_quantities).length?{...s,status:'Ready to invoice',done:false}:s);
  for(const [party,title] of [['supplier','Payment to supplier'],['client','Payment from client']]){const status=current.staff_status?.payments?.[party]?.status||'Not confirmed';stages.push({title,status,done:status.startsWith('Paid')});}
  return stages;
}
function staffPanel(){
 const status=current.staff_status;if(!status)return '';
 const suggestion=current.job.receipt_suggestion;
 return `<section><h3>Payments</h3>${[['supplier','Payment to supplier'],['client','Payment from client']].map(([party,label])=>`<article class="trial-action"><div><strong>${label}</strong><p>${esc(status.payments[party].status)}</p>${(status.payments[party].evidence_candidates||[]).map(e=>`<details><summary>Payment advice · ${esc(e.currency)} ${esc(e.amount)} · ${esc(e.reference)}</summary><p>${esc(e.status)}</p>${current.messages.filter(m=>m.id===e.message_id).map(mailCard).join('')}</details>`).join('')}${status.payments[party].records.map(r=>`<p>${esc(r.currency)} ${esc(r.amount)} · ${esc(r.document_reference)} · ${esc(r.payment_date)} · ${esc(r.reference)}<br><small>Staff confirmation: ${esc(r.confirmed_by)} · ${esc(r.note)}</small></p>`).join('')}${account.role!=='procurement'?`<button data-staff-payment="${party}">Record ${party==='supplier'?'supplier':'client'} payment</button>`:''}</div></article>`).join('')}</section>`;
}
function bindStaffConfirmation(){
 if($('approveReceipt'))$('approveReceipt').onclick=receiptApprovalForm;
 document.querySelectorAll('[data-staff-payment]').forEach(b=>b.onclick=()=>staffPaymentForm(b.dataset.staffPayment));
}
function receiptApprovalForm(){
 const detail=current,j=detail.job,s=detail.staff_status,suggestion=j.receipt_suggestion||{};
 showEditor('Approve delivery · '+(j.company_reference||j.requisition_no),`<form id="receiptApproval" novalidate>${(detail.tracking||[]).map(shipment=>`<div class="delivery-identity"><strong>${esc(shipment.carrier)}</strong><span>${esc(shipment.kind)} <b>${esc(shipment.number)}</b></span></div>`).join('')}<p>Review the quantities, tick the confirmation boxes, then select Approve received quantities. A typed note is optional.</p><p>Enter only quantities you have checked. Leave missing or unchecked items at zero.</p><label>Receipt date<input type="date" name="received_date" required value="${esc(suggestion.date||malaysiaToday())}"></label>${!s.order_verified?`<label>Client PO reference<input name="order_reference" required value="${esc(detail.client_po_references?.[0]?.reference||'')}"></label><label><input type="checkbox" name="confirm_order" required> I verified the client PO and the ordered quantities shown below.</label>`:''}<div class="tablewrap"><table><tr><th>Item</th><th>Ordered</th><th>Already approved</th><th>Approve now</th></tr>${s.lines.map(l=>`<tr><td>${esc(l.part_no)} ${esc(l.description)}</td><td>${esc(l.ordered)}</td><td>${esc(l.received)}</td><td><input name="qty:${esc(l.id)}" type="number" min="0" max="${esc(l.remaining)}" step="any" value="${esc(l.remaining)}"></td></tr>`).join('')}</table></div><label>Check note (optional)<textarea name="note" placeholder="Add a location or any delivery exceptions"></textarea></label><input type="hidden" name="source_evidence" value="${esc(suggestion.message_id?'email:'+suggestion.message_id:'')}"><label><input type="checkbox" name="confirmed" required> I checked these quantities and their condition and approve them as received.</label><button class="primary">Approve received quantities</button><button type="button" id="receiptBack">Back</button></form>`);
 $('receiptBack').onclick=run(()=>openJob(j.id));$('receiptApproval').onsubmit=run(async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if(!s.order_verified&&d.confirm_order!=='on')throw new Error('Tick the client PO confirmation after checking the order and quantities.');if(d.confirmed!=='on')throw new Error('Tick the received-items confirmation after checking their quantities and condition.');if(!e.target.checkValidity()){e.target.reportValidity();throw new Error('Check the receipt date, PO reference and item quantities.');}d.lines=s.lines.map(l=>({item_id:l.id,quantity:d['qty:'+l.id]})).filter(l=>Number(l.quantity)>0);if(!d.lines.length)throw new Error('Enter at least one received quantity to approve.');d.note=d.note.trim()||'Received quantities and condition checked and approved by '+account.name+'.';d.version=j.version;d.confirmed=true;d.confirm_order=d.confirm_order==='on';const button=e.target.querySelector('button.primary');button.disabled=true;button.textContent='Saving approval…';try{await api('/jobs/'+j.id+'/approve-receipt','POST',d);}catch(error){button.disabled=false;button.textContent='Approve received quantities';throw error;}await refresh();await openJob(j.id);notify('Received quantities approved');});
}
function staffPaymentForm(party){
 const j=current.job,invoices=current.records.filter(r=>r.kind==='invoice'),client=party==='client';
 showEditor(client?'Record payment from client':'Record payment to supplier',`<form id="staffPayment"><p>Record a confirmed payment manually. Email evidence is optional; your confirmation is saved with your name and time.</p>${client&&invoices.length?`<label>Client invoice<select name="invoice_id" required>${choices(invoices.map(r=>({id:r.id,name:r.reference})))}</select></label>`:''}<label>${client?'Client invoice':'Supplier invoice / PO'} reference<input name="document_reference" required></label><label>Payment date<input type="date" name="payment_date" required value="${malaysiaToday()}"></label><label>Amount of this payment<input name="amount" type="number" step="0.01" min="0.01" required></label><label>Currency<input name="currency" maxlength="3" value="${client?esc(j.currency):''}" required></label><label>Payment / bank transaction reference<input name="reference" required></label><label>Status<select name="status"><option value="partial">Partial payment</option><option value="paid">Fully paid</option></select></label><label>Confirmation note<textarea name="note" required placeholder="Payment verified in the bank or accounting system; confirmation details"></textarea></label><label><input type="checkbox" name="confirmed" required> I confirm this payment has ${client?'been received from the client':'settled to the supplier'}.</label><button class="primary">Save payment confirmation</button><button type="button" id="paymentBack">Back</button></form>`);
 $('paymentBack').onclick=run(()=>openJob(j.id));$('staffPayment').onsubmit=run(async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.party=party;d.version=j.version;d.confirmed=d.confirmed==='on';await api('/jobs/'+j.id+'/confirm-payment','POST',d);await refresh();await openJob(j.id);notify('Payment confirmation recorded');});
}
