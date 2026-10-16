/* Evidence review presentation for imported trial job cards. */
const standardOpenJob=openJob;
let jobOpenSequence=0;
openJob=async function(id){
  const request=++jobOpenSequence;
  showEditor('Opening job card', '<div class="job-loading" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><h3>Loading job card…</h3><p>Preparing job details and email evidence.</p></div>');
  const revision=editorRevision;
  let rendering=false;
  try {
  const [detail,rules]=await Promise.all([api('/jobs/'+encodeURIComponent(id)),api('/attachment-rules')]);
  if(request!==jobOpenSequence||revision!==editorRevision||!$('editor').open)return;
  evidenceRules=rules.rules;
  rendering=true;
  await standardOpenJob(id,detail);
  const j=current.job,t=j.trial_review||j.import_summary;if(!t){if($('emailEvidence'))$('emailEvidence').innerHTML=current.messages.map(mailCard).join('');const suppliers=document.createElement('details');suppliers.innerHTML='<summary>All suppliers and response status</summary>'+supplierPanel({suppliers:[]});$('dialogContent').prepend(suppliers);if(j.import_review)showImportSuggestions(j);const panel=document.createElement("section");panel.innerHTML=trackingPanel()+staffPanel()+flagPanel();$("dialogContent").prepend(panel);bindEvidence();bindDashboardDetails();return;}
  t.email_count=current.messages.length;
  t.document_count=new Set(current.messages.flatMap(m=>(m.extractions||[]).map(d=>d.hash))).size;
  $('dialogTitle').textContent=(j.company_reference||j.client_reference||j.requisition_no||j.id)+' · '+j.vessel_name;
  const existing=document.createElement('details');existing.className='trial-tools';existing.innerHTML='<summary>Job editing and activity history</summary>';
  while($('dialogContent').firstChild)existing.append($('dialogContent').firstChild);
  $('dialogContent').innerHTML=`<section class="trial-overview"><p class="trial-caption">${j.import_summary?"MAILBOX IMPORT":"LIVE MAILBOX TRIAL"} · ${esc(j.company_reference||j.client_reference||j.requisition_no||j.id)} · ${esc(t.reviewed_at||"6 OCT 2026")}</p><h2>${esc(t.description||"Main engine filter spares")}</h2><p>${esc(j.client_name)} · Client RFQ ${esc(j.requisition_no)} · Client PO ${esc(clientPoText(current.client_po_references))} · Responsible ${esc(users.find(u=>u.id===(j.coverage?.until>=malaysiaToday()?j.coverage.user:j.owner))?.name||t.handler)}</p><div class="trial-progress">${staffStages(t).map(s=>`<div class="${s.done?'complete':'waiting'}"><span>${s.done?'✓':'○'}</span><strong>${esc(s.title)}</strong><small>${esc(s.status)}</small></div>`).join('')}</div><div class="trial-facts">${(t.facts||[['Client PO','26-0006-1','MYR 5,338.10'],['Supplier order','PO-BFS-Q6994','SGD 1,330.78 final invoice'],['Shipping','DHL 6115765320','1 parcel · 2.2 kg'],['Review coverage',t.email_count+' emails',t.document_count+' document versions · 6 cross-job emails excluded']]).map(([a,b,c])=>`<article><small>${esc(a)}</small><strong>${esc(b)}</strong><p>${esc(c)}</p></article>`).join('')}</div><div class="trial-caution">${esc(t.caution||"Delivery and client payment remain unconfirmed. Shipping documents do not confirm receipt. No AP client invoice or client settlement was found in this mailbox.")}</div><nav class="trial-nav">${['Overview','Timeline','Suppliers','Items','Evidence','Review flags'].map((n,i)=>`<button data-trial-tab="${i}" class="${i===0?'selected':''}">${n}</button>`).join('')}</nav><div data-trial-panel="0">${trackingPanel()}${staffPanel()}<h3>Next actions</h3>${t.actions.map(a=>`<article class="trial-action"><span class="trial-priority">${esc(a.tag)}</span><div><strong>${esc(a.title)}</strong><p>${esc(a.detail)}</p><small>${esc(a.finance?'Accounting':users.find(u=>u.id===(j.coverage?.until>=malaysiaToday()?j.coverage.user:j.owner))?.name||a.owner)} · See My day for deadline</small></div></article>`).join('')}<h3>Resolved requests</h3><p>${esc(t.resolved_requests||"✓ Diomar shipping address supplied 10 September · ✓ DHL AWB received 29 September · ✓ Supplier final invoice received 30 September")}</p><p class="muted">Original emails and documents remain available for verification.</p></div><div data-trial-panel="1" hidden><h3>Job timeline</h3>${t.timeline.map(e=>`<article class="trial-event"><small>${esc(e.date)}</small><div><strong>${esc(e.title)}</strong><p>${esc(e.detail)}</p></div></article>`).join('')}</div><div data-trial-panel="2" hidden>${supplierPanel(t)}</div><div data-trial-panel="3" hidden>${chosenQuotation(t)}${sourceItemsPanel()}</div><div data-trial-panel="4" hidden><h3>Original email evidence</h3><p>${t.email_count} emails with full correspondence, signatures and original attachments.</p>${current.messages.slice().sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).map(mailCard).join('')}</div><div data-trial-panel="5" hidden>${flagPanel()}</div></section>`;
  $('dialogContent').append(existing);
  const transfer=existing.querySelector('.transfer-bar');if(transfer)$('dialogContent').prepend(transfer);else addTransferControl();
  if(j.import_review&&account.role!=='accounting'){const button=document.createElement('button');button.textContent='Refresh imported details';button.onclick=run(async()=>{await api('/jobs/'+j.id+'/refresh-import','POST',{version:j.version});notify('Refreshing emails and document details for '+(j.company_reference||j.client_reference||j.requisition_no));});$('dialogContent').prepend(button);}
  bindEvidence();bindDashboardDetails();
  $('dialogContent').querySelectorAll('[data-trial-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-trial-panel]').forEach(p=>p.hidden=p.dataset.trialPanel!==b.dataset.trialTab);document.querySelectorAll('[data-trial-tab]').forEach(p=>p.classList.toggle('selected',p===b));});
  } catch(error){
    if(request===jobOpenSequence&&(revision===editorRevision||rendering)&&$('editor').open){
      showEditor('Unable to open job card', '<p role="alert">'+esc(error.message||'Job details could not be loaded.')+'</p><button id="retryJobCard">Try again</button>');
      $('retryJobCard').onclick=run(()=>openJob(id));
    }
    throw error;
  }
};
