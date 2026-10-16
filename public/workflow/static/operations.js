/* Team ownership, reference imports and daily work. */
let allReminders=[];
let lastMailCheck='';
async function checkMail(check=false){if(!account)return;const s=await api('/mail-sync',check?'POST':'GET',check?{check:true}:undefined);const el=$('mailSyncStatus');if(!el)return;const time=s.completed_at?new Intl.DateTimeFormat('en-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}).format(new Date(s.completed_at)):'';el.textContent=s.status==='queued'?'Email check queued…':s.status==='running'?'Checking Inbox and Sent emails…':s.status==='error'?'Email check failed. See Administration or try again.':time?'Emails checked '+time+' · checks every 10 minutes while signed in':'Email monitoring ready · checks on login and every 10 minutes';if(s.serverless&&(s.pending_imports||['queued','running'].includes(s.status)))void cloudTick();if(s.completed_at&&s.completed_at!==lastMailCheck){const hadPrevious=!!lastMailCheck;lastMailCheck=s.completed_at;if(hadPrevious)await refresh();}}
$('checkMailNow').onclick=run(()=>checkMail(true));
const priorSignedIn=signedIn;
signedIn=async function(data){await priorSignedIn(data);if(account){await api('/mail-sync','POST',{check:true});await checkMail();}};
setInterval(()=>{if(account)run(()=>api('/mail-sync','POST',{check:false}))();},60000);
setInterval(()=>{if(account)run(()=>checkMail(true))();},600000);
setInterval(()=>{if(account)run(()=>checkMail())();},10000);
function showImportSuggestions(j){const section=document.createElement('section');section.className='trial-caution';const drafts=j.suggested_items||[];section.innerHTML=`<h3>Imported evidence · review required</h3><p>${current.messages.length} linked emails. Verify the client, vessel, requisition, item quantities and quotation revisions against the originals before using commercial details.</p>${drafts.length?`<p>${drafts.length} item suggestions from labelled RFQ tables.</p><button id="reviewImportedItems">Review suggested items</button>`:'<p>No reliable RFQ item table detected. Use Review RFQ items after checking the original request.</p>'}<details><summary>Locally extracted document content</summary>${current.messages.flatMap(m=>(m.extractions||[]).map(e=>`<article><strong>${esc(m.attachments?.find(a=>a.hash===e.hash)?.filename||'Document')}</strong><p>${esc(m.subject)}</p>${e.text?`<pre>${esc(e.text)}</pre>`:'<p>Scanned document or unsupported file — review the original preview.</p>'}</article>`)).join('')||'<p>No document text found.</p>'}</details>`;$('dialogContent').prepend(section);if($('reviewImportedItems'))$('reviewImportedItems').onclick=editItems;}
function malaysiaToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function filterTasks(reminders){const scope=$('taskScope')?.value||'today',today=malaysiaToday();const filtered=reminders.filter(r=>scope==='team'||r.mine&&(scope==='mine'||r.due_date<=today));if($('taskSummary'))$('taskSummary').textContent=filtered.length+' pending · Malaysia '+today;return filtered;}
$('taskScope').onchange=()=>renderActions(allReminders);
function newJob(){showEditor('Add job card',`<form id="referenceImport"><p>Import an ongoing job from the connected mailbox. Existing references open their current card.</p><label>Client RFQ or AP reference<input name="reference" placeholder="EXP/RFQ/S/26/0062 or Q7113" maxlength="100" required autofocus></label><button class="primary">Find emails and generate card</button></form><p class="muted">Extracted details remain subject to review. Uncertain revisions and documents are kept as evidence.</p><button id="manualJob">Enter a new RFQ manually</button>`);$('manualJob').onclick=manualNewJob;$('referenceImport').onsubmit=run(async e=>{e.preventDefault();const result=await api('/job-imports','POST',Object.fromEntries(new FormData(e.target)));if(result.job_id){await refresh();await openJob(result.job_id);}else{$('editor').close();notify('Import queued. Progress appears above the job cards.');await loadImports();}});}
$('newJob').onclick=newJob;
function addTransferControl(){if(account.role==='accounting'||$('transferJob'))return;const box=document.createElement('div');box.className='transfer-bar';const j=current.job;box.innerHTML=`<span>Responsible: ${esc(users.find(u=>u.id===(j.coverage?.until>=malaysiaToday()?j.coverage.user:j.owner))?.name||'Unassigned')}${j.coverage?.until>=malaysiaToday()?' · covering through '+esc(j.coverage.until):''}</span><button id="transferJob">Transfer / cover job</button>`;$('dialogContent').prepend(box);$('transferJob').onclick=()=>transferForm();}
function transferForm(){const j=current.job;showEditor('Transfer job · '+(j.company_reference||j.client_reference||j.requisition_no||j.id),`<form id="transferForm"><label>Transfer to<select name="owner" required>${choices(users.filter(u=>u.role==='procurement'&&u.active),j.owner)}</select></label><label>Assignment<select id="transferType"><option value="permanent">Permanent transfer</option><option value="cover">Temporary leave coverage</option></select></label><label id="coverDate" hidden>Cover through (Malaysia date, inclusive)<input name="until" type="date" min="${malaysiaToday()}" value="${malaysiaToday()}"></label><label>Handover notes<textarea name="reason" placeholder="Pending questions, supplier deadlines, or leave coverage"></textarea></label><p class="muted">Temporary coverage routes My jobs and tasks to the covering user, then returns them to the original owner after the end date.</p><button class="primary">Save assignment</button><button type="button" id="transferBack">Back</button></form>`);$('transferType').onchange=()=>{$('coverDate').hidden=$('transferType').value!=='cover';};$('transferBack').onclick=run(()=>openJob(j.id));$('transferForm').onsubmit=run(async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if($('transferType').value!=='cover')d.until='';await api('/jobs/'+j.id+'/transfer','POST',{...d,version:j.version});await refresh();await openJob(j.id);notify('Job assignment saved');});}
function renderRfqAlerts(messages){const incoming=messages.filter(m=>m.new_rfq===true&&!m.job_id);$('rfqAlerts').innerHTML=incoming.length?`<article class="rfq-alert"><strong>${incoming.length} new client RFQ(s) awaiting review</strong><p>Review the client request, identify the vessel and assign the job.</p><button id="openNewRfqs">Review new RFQs</button></article>`:'';if($('openNewRfqs'))$('openNewRfqs').onclick=()=>tab('review','new');}
const completedImports=new Map(),seenImportNotices=new Set();
let importNoticeAccount='',importLoadRunning=false,latestImports=[];
function renderImports(imports=[]){
 const live=imports.filter(i=>i.status!=='complete');
 for(const i of live)completedImports.delete(i.reference);
 for(const [ref,item] of completedImports)if(item.until<=Date.now())completedImports.delete(ref);
 const visible=[...live,...Array.from(completedImports.values()).map(v=>v.import)];
 $('importProgress').innerHTML=visible.map(i=>`<article class="import-status"><strong>${esc(i.reference)} · ${esc(pretty(i.status))}</strong><span>${esc(i.message||'Processing email evidence')}</span>${i.job_id?`<button data-import-job="${esc(i.job_id)}" data-import-reference="${esc(i.reference)}">Open card</button>`:['failed','not_found'].includes(i.status)?`<button data-import-retry="${esc(i.reference)}">Retry</button>`:''}${i.status==='complete'?`<button data-dismiss-import="${esc(i.reference)}" aria-label="Dismiss completed import ${esc(i.reference)}">Dismiss</button>`:''}</article>`).join('');
 $('importProgress').querySelectorAll('[data-import-job]').forEach(b=>b.onclick=run(async()=>{completedImports.delete(b.dataset.importReference);renderImports(live);await refresh();await openJob(b.dataset.importJob);}));
 $('importProgress').querySelectorAll('[data-dismiss-import]').forEach(b=>b.onclick=()=>{completedImports.delete(b.dataset.dismissImport);renderImports(live);});
 $('importProgress').querySelectorAll('[data-import-retry]').forEach(b=>b.onclick=run(async()=>{await api('/job-imports','POST',{reference:b.dataset.importRetry});await loadImports();}));
}
async function loadImports(){
 if(!account||account.role==='accounting'||importLoadRunning)return;
 importLoadRunning=true;
 try{
  if(importNoticeAccount!==account.id){completedImports.clear();seenImportNotices.clear();importNoticeAccount=account.id;}
  const data=await api('/job-imports');latestImports=data.imports;const notices=[];
  for(const i of data.imports.filter(i=>i.status==='complete')){
   const key=i.reference+'|'+i.completed_at;
   if(!seenImportNotices.has(key)){seenImportNotices.add(key);completedImports.set(i.reference,{import:i,until:Date.now()+20000});setTimeout(()=>renderImports(latestImports),20000);}
   notices.push({reference:i.reference,completed_at:i.completed_at});
  }
  renderImports(data.imports);
  if(notices.length)await api('/job-imports/seen','POST',{notices});
 }finally{importLoadRunning=false;}
}
setInterval(()=>{if(account)run(loadImports)();},5000);
const baseRenderActions=renderActions;
renderActions=function(reminders){baseRenderActions(reminders);$('actions').querySelectorAll('[data-snooze]').forEach(b=>{const reminder=reminders.find(r=>r.id===b.dataset.snooze);if(!reminder?.id.includes(':review:'))return;const button=document.createElement('button');button.textContent='Complete review';b.after(button);button.onclick=run(async()=>{const detail=await api('/jobs/'+reminder.job_id);showEditor('Complete review task',`<p>${esc(reminder.title)}</p><form id="completeTask"><label>Outcome / evidence<textarea name="evidence" required></textarea></label><p class="muted">Completing a review task does not confirm delivery, invoicing or payment.</p><button>Complete task</button></form>`);$('completeTask').onsubmit=run(async e=>{e.preventDefault();await api('/jobs/'+reminder.job_id+'/review-tasks/'+reminder.id.split(':review:')[1]+'/resolve','POST',{version:detail.job.version,...Object.fromEntries(new FormData(e.target))});$('editor').close();await refresh();});});});};

// A bounded HTTP task replaces local daemon threads on Vercel. The server coalesces tabs/users.
let cloudTickRunning=false;
async function cloudTick(){
 if(cloudTickRunning||!account)return;
 cloudTickRunning=true;
 try{
  const response=await fetch(prefix+'/api/automation/tick',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'});
  const data=await response.json();
  if(!response.ok||data.status==='error')throw new Error(data.error||'Background check failed');
  if(data.changed&&account)await refresh();
 }catch(error){if($('mailSyncStatus'))$('mailSyncStatus').textContent='Email processing needs attention. Check Administration or retry.';}
 finally{cloudTickRunning=false;}
}
