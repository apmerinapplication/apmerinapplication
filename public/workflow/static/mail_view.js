/* Original evidence remains accessible regardless of extraction exclusions. */
let evidenceRules={ignore_inline:true,patterns:[],overrides:{}};
function ignoredAttachment(a){
  if(evidenceRules.overrides?.[a.hash])return evidenceRules.overrides?.[a.hash]==='ignore';
  if(/^image\d+/i.test(a.filename)&&a.content_type?.startsWith('image/'))return true;
  if(evidenceRules.ignore_inline&&(a.content_id||a.disposition==='inline'))return true;
  return (evidenceRules.patterns||[]).some(p=>new RegExp('^'+p.replace(/[.+^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*').replaceAll('?','.')+'$','i').test(a.filename));
}
function evidenceAttachment(a){return `<div class="mail-attachment"><a href="${prefix}/api/attachments/${esc(a.hash)}" target="_blank" rel="noopener">📎 ${esc(a.filename)}</a>${a.review_note?`<span class="badge">${esc(a.review_note)}</span>`:''}${a.content_type?.startsWith('image/')&&a.content_type!=='image/svg+xml'?`<details><summary>Preview image</summary><img class="attachment-photo" loading="lazy" src="${prefix}/api/attachments/${a.hash}?preview=1" alt="${esc(a.filename)}"></details>`:''}${/\.pdf$/i.test(a.filename)?`<button data-pdf="${a.hash}" data-title="${esc(a.filename)}">Preview document</button>`:''}</div>`;}
function mailCard(m){const visible=(m.attachments||[]).filter(a=>!ignoredAttachment(a)),hidden=(m.attachments||[]).filter(ignoredAttachment);return `<details class="trial-mail" data-mail="${m.id}"><summary><strong>${esc(m.subject)}</strong><span class="mail-summary-meta">${esc(m.from_header||m.sender)} · ${esc(m.date)}</span></summary><section class="outlook-mail"><header><h3>${esc(m.subject)}</h3><div><b>From:</b> ${esc(m.from_header||m.sender)}</div><div><b>To:</b> ${esc(m.to_header||(m.recipients||[]).join('; '))}</div><div><b>Cc:</b> ${esc(m.cc_header||'—')}</div><div><b>Sent:</b> ${esc(m.date)}</div><a href="${prefix}/api/messages/${m.id}/original">Open original .eml in Outlook</a></header><div class="mail-attachments">${visible.map(evidenceAttachment).join('')}${hidden.length?`<details><summary>${hidden.length} embedded images and other files</summary>${hidden.map(evidenceAttachment).join('')}</details>`:''}</div><p class="muted">Message content, signature and embedded images.</p><div class="email-preview-host" data-email-title="Original email: ${esc(m.subject)}" data-email-src="${prefix}/api/messages/${m.id}/preview"></div><details><summary>Full text and quoted correspondence</summary><pre>${esc(m.body_full||m.body)}</pre></details></section></details>`;}
const supplierNames={'shunkongmarine.com':'Shun Kong Marine','myeong-seong.co.kr':'Myeong Seong','bollfilter.com':'Bollfilter South East Asia','ost.gr':'Oceantech','diomar.gr':'Diomar','jmsgroup.jp':'Japan Marine'};
function domainsFrom(header){return [...new Set((header||'').toLowerCase().match(/@[a-z0-9.-]+\.[a-z]{2,}/g)||[])].map(x=>x.slice(1));}
function supplierPanel(t){
 const groups=new Map();
 for(const m of current.messages){if((!/^rfq\b/i.test(m.subject)&&!(t.rfq_message_ids||[]).includes(m.message_id))||!/@apmerinservices\.com\.my$/i.test(m.sender))continue;for(const d of domainsFrom(m.to_header)){if(d==='apmerinservices.com.my')continue;if(!groups.has(d))groups.set(d,[]);groups.get(d).push(m);}}
 for(const supplier of t.suppliers||[]){if(supplier.domain&&!groups.has(supplier.domain))groups.set(supplier.domain,[]);}
 for(const r of current.records||[]){if(r.kind!=='supplier_rfq')continue;for(const d of domainsFrom(r.supplier_email)){if(!groups.has(d))groups.set(d,[]);}}
 return `<h3>All supplier enquiries · ${groups.size} organisations</h3><p>Statuses are based on the imported correspondence. “No reply found” means no reply in this evidence set.</p>${[...groups].map(([d,rfqs])=>{
 const offer=(t.suppliers||[]).find(s=>s.domain===d||s.name.toLowerCase().includes((supplierNames[d]||d).toLowerCase())||d==='ost.gr'&&s.name.includes('Oceantech'));
 const aliases=offer?.alias_emails||[];
 const history=current.messages.filter(m=>domainsFrom(m.from_header||m.sender).includes(d)||domainsFrom(m.to_header).includes(d)||aliases.includes(m.sender)||(aliases.some(a=>(m.to_header||'').toLowerCase().includes(a)))).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 const replies=history.filter(m=>domainsFrom(m.from_header||m.sender).includes(d)||aliases.includes(m.sender));const last=replies.at(-1);
 let status=last?'Response received · review latest email':'No reply found · follow up';let note='';
 if(offer){status=offer.status==='Selected'?'Selected · shipping documents received · delivery unconfirmed':'Quotation received · '+offer.status;note=offer.note;}
 if(d==='diomar.gr'&&!offer?.current_status){status='Quotation received · shipping address answered · freight quote pending';note='Address requested 10 September and supplied the same day. Final freight amount not found. Supplier not selected.';}
 if(last&&!offer){const text=(last.body||'').split(/\nFrom:|\nSent:/i)[0];if(/(?:please|kindly|could you|can you).{0,100}(?:vessel|datasheet|data sheet|drawing|serial|details|shipping address)/is.test(text)){status='Information requested · response needs review';note=text.slice(0,500);}else if(/offer|quotation|quote/i.test(text)){status='Quotation response received · review document';}}
 if(offer?.current_status){status=offer.current_status;note=offer.note;}
 return `<article class="trial-supplier"><span class="badge">${esc(status)}</span><h3>${esc(offer?.name||supplierNames[d]||d)}</h3><p>${rfqs.length} RFQ email(s) · ${esc([...new Set(rfqs.map(m=>m.to_header))].join(' · ')||d)}</p>${offer?`<strong>${esc(offer.amount)}</strong><p>${esc(offer.terms)}</p>`:''}<p>${esc(note)}</p><small>Latest supplier reply: ${esc(last?.date||'None found')}</small><details><summary>RFQs, clarification requests and replies (${history.length})</summary>${history.map(mailCard).join('')}</details></article>`;
 }).join('')}`;
}
function chosenQuotation(t){
 const docs=[];
 for(const m of current.messages){for(const a of m.attachments||[]){
  if(t.quotation_hashes?(t.quotation_hashes.includes(a.hash)):(/bollfilter\.com$/i.test(m.sender)&&/^QUO[- ]?007078/i.test(a.filename)))docs.push({m,a});
 }}
 docs.sort((a,b)=>Date.parse(b.m.date)-Date.parse(a.m.date));const seen=new Set();const unique=docs.filter(d=>!seen.has(d.a.hash)&&seen.add(d.a.hash));
 return `<section class="chosen-quotation"><h3>${esc(t.quotation_heading||"Chosen supplier · original quotation")}</h3><p>${esc(t.quotation_note||"Bollfilter’s revised quotation is listed first. Compare the document with the extracted amounts below; the supplier invoice remains separate evidence.")}</p>${unique.map(({m,a},i)=>/\.pdf$/i.test(a.filename)?`<button data-pdf="${a.hash}" data-title="${esc(a.filename)} · ${esc(m.date)}">${i===0?'Latest version':'Earlier version'} · ${esc(m.date)} · ${esc(a.filename)}</button>`:`<a class="button" href="${prefix}/api/attachments/${a.hash}" target="_blank" rel="noopener">Open original spreadsheet · ${esc(a.filename)}</a>`).join('')||'<p>Quotation document not found. Review supplier evidence.</p>'}${(t.quotation_message_ids||[]).length?'<h4>Supplier quotations in email</h4>'+current.messages.filter(m=>t.quotation_message_ids.includes(m.id)).map(mailCard).join(''):''}<div id="documentPreview"></div></section>`;
}
async function reopenEvidence(){const tab=document.querySelector('[data-trial-tab].selected')?.dataset.trialTab;await openJob(current.job.id);if(tab)document.querySelector('[data-trial-tab="'+tab+'"]')?.click();}
async function showDocument(hash,title){
 let target=$('documentPreview');
 if(!target||!target.closest('[data-trial-panel="3"]')||target.closest('[data-trial-panel]').hidden){target=document.createElement('section');target.className='document-popup';$('dialogContent').prepend(target);}
 const ticket=String(Date.now())+Math.random();target.dataset.preview=ticket;
 target.innerHTML=`<h3>${esc(title)}</h3><button data-close-preview>Close preview</button><div data-document-content>${loadingMarkup('Preparing document preview…','Rendering the original document. Larger files may take a little longer.')}</div>`;
 target.querySelector('[data-close-preview]').onclick=()=>{target.dataset.preview='';target.innerHTML='';};
 target.scrollIntoView({behavior:'smooth',block:'start'});
 try{
  const result=await api('/attachments/'+hash+'/pages');
  if(!target.isConnected||target.dataset.preview!==ticket)return;
  const content=target.querySelector('[data-document-content]');
  content.innerHTML=`<a href="${prefix}/api/attachments/${hash}" target="_blank" rel="noopener">Download original PDF</a>`;
  for(let i=0;i<result.pages;i++){
   const page=document.createElement('div');page.className='document-page-slot';page.innerHTML=loadingMarkup('Loading page '+(i+1)+'…','');
   const image=document.createElement('img');image.className='document-page';image.alt='Document page '+(i+1);image.hidden=true;
   image.onload=()=>{page.querySelector('.loading-state')?.remove();image.hidden=false;page.classList.add('loaded');};
   image.onerror=()=>{page.querySelector('.loading-state')?.remove();image.remove();const error=document.createElement('p');error.setAttribute('role','alert');error.textContent='Page '+(i+1)+' could not be loaded. ';const retry=document.createElement('button');retry.textContent='Retry preview';retry.onclick=run(()=>showDocument(hash,title));error.append(retry);page.append(error);};
   page.append(image);content.append(page);image.src=prefix+'/api/attachments/'+hash+'/pages/'+i;
  }
  if(!result.pages)content.insertAdjacentHTML('beforeend','<p>No preview pages available. Download the original document above.</p>');
 }catch(error){
  if(target.isConnected&&target.dataset.preview===ticket){const content=target.querySelector('[data-document-content]');content.innerHTML='<p role="alert">'+esc(error.message||'Unable to prepare document preview.')+'</p><button>Try again</button>';content.querySelector('button').onclick=run(()=>showDocument(hash,title));}
 }
}
function loadEmailFrame(frame){
 const host=frame.parentElement;
 let state=host.querySelector(':scope > .email-loading');
 if(!state){state=document.createElement('div');state.className='email-loading';frame.before(state);}
 state.innerHTML=loadingMarkup('Loading original email…','Preparing message content, signature and embedded images.');frame.hidden=true;
 let watchdog;
 frame.onload=()=>{clearTimeout(watchdog);state.remove();frame.hidden=false;};
 frame.onerror=()=>{clearTimeout(watchdog);state.innerHTML='<p role="alert">The email preview could not load.</p><button>Try again</button>';state.querySelector('button').onclick=()=>loadEmailFrame(frame);};
 watchdog=setTimeout(()=>{if(state.isConnected){state.innerHTML='<p role="status">The email preview is taking longer than usual.</p><button>Try again</button>';state.querySelector('button').onclick=()=>loadEmailFrame(frame);}},30000);
 frame.src=frame.dataset.emailSrc;
}
function bindEvidence(){
 document.querySelectorAll('[data-mail]').forEach(d=>d.addEventListener('toggle',()=>{if(d.open){const host=d.querySelector('.email-preview-host[data-email-src]');if(host&&!host.querySelector('iframe')){const f=document.createElement('iframe');f.className='email-frame';f.setAttribute('sandbox','allow-popups');f.title=host.dataset.emailTitle;f.dataset.emailSrc=host.dataset.emailSrc;host.append(f);loadEmailFrame(f);}}}));
 document.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=run(()=>showDocument(b.dataset.pdf,b.dataset.title)));
}
