/* Only the authenticated shared deployment adds this bridge. Legacy standalone remains unchanged. */
(async()=>{
  if(location.pathname!=='/quotation')return;
  const sessionResponse=await fetch('/workflow/api/session');
  const auth=await sessionResponse.json();
  if(!auth.user){location.href='/workflow/';return;}
  const badge=document.getElementById('activeUserBadge');
  if(badge)badge.textContent=auth.user.name+' · '+auth.user.role;
  for(const id of ['tabModeEmail','tabModeCompare','btnOpenSyncModal','btnOpenSettings','btnLogout']){
    const control=document.getElementById(id);if(control)control.style.setProperty('display','none','important');
  }
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,options={})=>{
    const url=typeof input==='string'?input:input.url;
    if(new URL(url,location.href).origin===location.origin){
      const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
      headers.set('X-CSRF-Token',auth.csrf);options={...options,headers};
    }
    return originalFetch(input,options);
  };
  const banner=document.createElement('div');
  banner.style.cssText='background:#123039;color:white;padding:12px;display:flex;gap:18px;align-items:center;position:sticky;top:0;z-index:9999';
  const link=document.createElement('a');link.href='/workflow/';link.textContent='← Shared job cards';link.style.color='white';banner.append(link);
  const button=document.createElement('button');button.textContent='Save this worksheet as a job';button.style.cssText='background:white;color:#123039;padding:8px;border-radius:6px';banner.append(button);document.body.prepend(banner);
  button.onclick=async()=>{
    try{
      if(typeof rfqItems==='undefined'||!rfqItems.length)throw new Error('Load the client RFQ first.');
      const details=window.prompt('Client name | client email | vessel | requisition reference');if(!details)return;
      const [client_name,client_email,vessel_name,requisition_no]=details.split('|').map(v=>v.trim());
      const items=rfqItems.map((item,index)=>{
        const matched=typeof matchedItems!=='undefined'?matchedItems[index]:null;
        return {...item,description:item.description||item.name||'Item '+(index+1),quantity:item.quantity||item.qty||1,part_no:item.part_no||'',item_code:item.item_code||'',uom:item.uom||'PCS',unit_price:matched?.price_target??matched?.price_myr??0};
      });
      const jobsResponse=await fetch('/workflow/api/jobs');const existingJobs=(await jobsResponse.json()).jobs;
      const existing=existingJobs.find(j=>j.client_email.toLowerCase()===client_email.toLowerCase()&&j.vessel_name.toLowerCase()===vessel_name.toLowerCase()&&j.requisition_no.toLowerCase()===requisition_no.toLowerCase());
      if(existing){
        if(!window.confirm('Update the RFQ worksheet items in '+existing.id+'? Commercially allocated items cannot be replaced.'))return;
        const response=await fetch('/workflow/api/jobs/'+existing.id+'/items',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:existing.version,items})});
        const data=await response.json();if(!response.ok)throw new Error(data.error);window.alert('Updated '+existing.id);return;
      }
      const response=await fetch('/workflow/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name,client_email,vessel_name,requisition_no,owner:auth.user.role==='procurement'?auth.user.id:'',currency:typeof targetCurrency!=='undefined'?targetCurrency:'MYR',items})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      window.alert('Created '+data.job.id+'. Review the item prices and quantities in job cards.');
    }catch(error){window.alert(error.message);}
  };
})();
