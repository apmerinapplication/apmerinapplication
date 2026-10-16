/* Shared feedback for asynchronous work; background polling stays unobtrusive. */
'use strict';
const pendingWork=new Map();
let workSequence=0,workTimer;
function loadingMarkup(title,detail='Please wait while we prepare this view.'){
  return `<div class="loading-state" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><div><strong>${esc(title)}</strong><p>${esc(detail)}</p></div></div>`;
}
function renderPendingWork(){
  clearTimeout(workTimer);
  let status=document.getElementById('workStatus');
  if(!status){status=document.createElement('div');status.id='workStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');document.body.append(status);}
  const active=[...pendingWork.values()].filter(v=>Date.now()-v.at>=350);
  status.hidden=!active.length;
  if(active.length){const latest=active.at(-1);if(status.dataset.label!==latest.label){status.innerHTML='<span class="loading-spinner" aria-hidden="true"></span><span></span>';status.lastElementChild.textContent=latest.label;status.dataset.label=latest.label;}const dialog=document.getElementById('editor'),parent=dialog?.open?dialog:document.body;if(status.parentElement!==parent)parent.append(status);}
  if(pendingWork.size)workTimer=setTimeout(renderPendingWork,150);
}
function beginLoading(label){const token=++workSequence;pendingWork.set(token,{label,at:Date.now()});renderPendingWork();return ()=>{pendingWork.delete(token);renderPendingWork();};}
function requestLoadingLabel(path,method){
  if(path.includes('/pages'))return 'Preparing document preview…';
  if(path.includes('/login')||path.includes('/session'))return 'Opening your workspace…';
  if(path.includes('refresh-import'))return 'Starting job refresh…';
  if(path.includes('approve-receipt'))return 'Saving delivery approval…';
  if(path.includes('confirm-payment'))return 'Saving payment confirmation…';
  if(path.includes('/send/'))return 'Sending approved email…';
  if(path.includes('mail-sync'))return 'Checking email sync…';
  if(path.includes('job-imports'))return 'Checking job import progress…';
  return method==='GET'?'Loading workspace information…':'Saving changes…';
}
async function withActionFeedback(event,action){
  const button=event?.submitter||(event?.currentTarget?.tagName==='BUTTON'?event.currentTarget:null);
  if(button?.disabled)return;
  let old,disabled;
  if(button){old=button.innerHTML;disabled=button.disabled;button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="loading-spinner" aria-hidden="true"></span> Please wait…';}
  const end=beginLoading(event?.type==='submit'?'Saving your changes…':'Working on your request…');
  try{return await action(event);}finally{end();if(button){button.innerHTML=old;button.disabled=disabled;button.removeAttribute('aria-busy');}}
}
