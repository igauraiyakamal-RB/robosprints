const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
async function q(path,opt={}){const r=await fetch(U+path,{...opt,headers:{...H,...(opt.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t||'Database request failed');return d}
async function currentUser(token){const a=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}}),user=await a.json();if(!a.ok||!user?.id){const e=new Error('Please log in.');e.status=401;throw e}return user}
const fields=['full_name','class_name','school_name','address_line1','address_line2','landmark','city','state','postal_code','country','phone','whatsapp_no'];
module.exports=async(req,res)=>{
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({error:'Please log in.'});
 try{
  const user=await currentUser(token);
  const actor=(await q('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(user.id)+'&select=id,role,approval_status'))[0]||{};
  const scope=String(req.query?.scope||'');
  if(scope==='parts'){
   if(req.method==='GET'){
    if(String(req.query?.view||'')==='requirements'){
     if(!['purchase_manager','project_manager','business_manager'].includes(actor.role))return res.status(403).json({error:'Manager access required.'});
     const [projectParts,projects]=await Promise.all([
      q('/rest/v1/project_parts?select=project_id,name,description,sort_order&order=project_id,sort_order.asc'),
      q('/rest/v1/projects?select=id,title,status,created_at&order=created_at.desc')
     ]);
     const pm=Object.fromEntries(projects.map(p=>[p.id,p]));
     let requirements=[];
     try{requirements=await q('/rest/v1/part_requirements?select=*&order=created_at.desc')}catch(e){console.warn('Optional part_requirements table unavailable:',e.message)}
     const liveProjectParts=projectParts.filter(x=>pm[x.project_id]&&!['draft','rejected','archived','deleted'].includes(String(pm[x.project_id].status||'').toLowerCase())).map(x=>{const req=requirements.find(r=>r.project_id===x.project_id&&String(r.requested_name||'').trim().toLowerCase()===String(x.name||'').trim().toLowerCase());return {...x,quantity:Number(req?.quantity||1),project_title:pm[x.project_id].title,project_status:pm[x.project_id].status,source:'project'}});
     return res.json({success:true,requirements,project_parts:liveProjectParts});
    }
    const qq=String(req.query?.q||'').trim();let path='/rest/v1/parts_catalog?active=eq.true&pricing_status=eq.approved&select=id,name,description,sku,sale_price,stock_on_hand,reorder_level';
    if(qq)path+='&name=ilike.*'+encodeURIComponent(qq)+'*';return res.json({success:true,parts:await q(path+'&order=name.asc')});
   }
   const b=req.body||{};
   if(req.method==='POST'&&b.action==='review_project_change_request'){
    if(actor.role!=='project_manager'||actor.approval_status!=='approved')return res.status(403).json({error:'Approved Project Manager access required.'});
    const requestId=String(b.request_id||'');
    const change=(await q('/rest/v1/project_change_requests?id=eq.'+encodeURIComponent(requestId)+'&select=id,project_id,mentor_id,request_type,proposed_data,status'))[0];
    if(!change||change.status!=='pending')return res.status(404).json({error:'Pending project change request not found.'});
    if(b.approve!==true){
     await q('/rest/v1/project_change_requests?id=eq.'+encodeURIComponent(requestId),{method:'PATCH',body:JSON.stringify({status:'rejected',reviewed_at:new Date().toISOString(),reviewed_by:user.id})});
     return res.json({success:true,status:'rejected'});
    }
    if(change.request_type==='delete'){
     await q('/rest/v1/project_parts?project_id=eq.'+encodeURIComponent(change.project_id),{method:'DELETE'});
     await q('/rest/v1/part_requirements?project_id=eq.'+encodeURIComponent(change.project_id),{method:'DELETE'});
     await q('/rest/v1/projects?id=eq.'+encodeURIComponent(change.project_id),{method:'DELETE'});
    }else if(change.request_type==='edit'){
     const data=change.proposed_data||{},project={...(data.project||{})};delete project.mentor_id;delete project.id;
     if(Object.keys(project).length)await q('/rest/v1/projects?id=eq.'+encodeURIComponent(change.project_id),{method:'PATCH',body:JSON.stringify(project)});
     const parts=Array.isArray(data.parts)?data.parts:[];
     if(parts.length>40)return res.status(400).json({error:'A project can contain at most 40 parts.'});
     const normalized=parts.map((x,i)=>({name:String(x.name||'').trim(),description:String(x.description||'').trim()||null,quantity:Math.max(1,Math.min(999,Number(x.quantity)||1)),sort_order:i})).filter(x=>x.name);
     await q('/rest/v1/project_parts?project_id=eq.'+encodeURIComponent(change.project_id),{method:'DELETE'});
     await q('/rest/v1/part_requirements?project_id=eq.'+encodeURIComponent(change.project_id),{method:'DELETE'});
     if(normalized.length){
      const catalog=await q('/rest/v1/parts_catalog?active=eq.true&select=id,name&order=name.asc');
      const byName=Object.fromEntries(catalog.map(x=>[String(x.name||'').trim().toLowerCase(),x.id]));
     const catalogNames=new Set(Object.keys(byName));
      await q('/rest/v1/project_parts',{method:'POST',body:JSON.stringify(normalized.map(x=>({project_id:change.project_id,name:x.name,description:x.description,sort_order:x.sort_order,price:0,is_core:true,catalog_part_id:byName[x.name.toLowerCase()]||null})))});
      await q('/rest/v1/part_requirements',{method:'POST',body:JSON.stringify(normalized.map(x=>({mentor_id:change.mentor_id,project_id:change.project_id,requested_name:x.name,specification:x.description,quantity:x.quantity,status:byName[x.name.toLowerCase()]?'catalog_available':'pending_purchase'})))});
     }
    }else return res.status(400).json({error:'Unsupported project change request type.'});
    await q('/rest/v1/project_change_requests?id=eq.'+encodeURIComponent(requestId),{method:'PATCH',body:JSON.stringify({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:user.id})});
    return res.json({success:true,status:'approved'});
   }
   if(req.method==='POST'&&b.action==='save_project_parts'){
    if(actor.role!=='mentor'||actor.approval_status!=='approved')return res.status(403).json({error:'Approved Mentor access required.'});
    const projectId=String(b.project_id||'');
    const project=(await q('/rest/v1/projects?id=eq.'+encodeURIComponent(projectId)+'&select=id,mentor_id,status'))[0];
    if(!project||project.mentor_id!==user.id)return res.status(403).json({error:'This project does not belong to the signed-in Mentor.'});
    if(!['draft','pending'].includes(String(project.status||'')))return res.status(409).json({error:'Parts can only be changed while the project is a draft or awaiting approval.'});
    const input=Array.isArray(b.parts)?b.parts:[];
    if(input.length>40)return res.status(400).json({error:'A project can contain at most 40 parts.'});
    const normalized=input.map((x,i)=>({name:String(x.name||'').trim(),description:String(x.description||'').trim()||null,quantity:Math.max(1,Math.min(999,Number(x.quantity)||1)),sort_order:i})).filter(x=>x.name);
    await q('/rest/v1/project_parts?project_id=eq.'+encodeURIComponent(projectId),{method:'DELETE'});
    if(normalized.length){
     const catalog=await q('/rest/v1/parts_catalog?active=eq.true&select=id,name&order=name.asc');
     const byName=Object.fromEntries(catalog.map(x=>[String(x.name||'').trim().toLowerCase(),x.id]));
     const rows=normalized.map(x=>({project_id:projectId,name:x.name,description:x.description,sort_order:x.sort_order,price:0,is_core:true,catalog_part_id:byName[x.name.toLowerCase()]||null}));
     await q('/rest/v1/project_parts',{method:'POST',body:JSON.stringify(rows)});
     await q('/rest/v1/part_requirements?project_id=eq.'+encodeURIComponent(projectId),{method:'DELETE'});
     await q('/rest/v1/part_requirements',{method:'POST',body:JSON.stringify(normalized.map(x=>({mentor_id:user.id,project_id:projectId,requested_name:x.name,specification:x.description,quantity:x.quantity,status:byName[x.name.toLowerCase()]?'catalog_available':'pending_purchase'})))});
    }else{
     await q('/rest/v1/part_requirements?project_id=eq.'+encodeURIComponent(projectId),{method:'DELETE'});
    }
    return res.json({success:true,saved_parts:normalized.length,unmatched_parts:normalized.filter(x=>!catalogNames.has(x.name.toLowerCase())).length});
   }
   if(req.method==='POST'&&b.action==='request_part'){if(actor.role!=='mentor')return res.status(403).json({error:'Only Mentors can raise technical part requirements.'});const rows=await q('/rest/v1/part_requirements',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({mentor_id:actor.id,project_id:b.project_id||null,requested_name:String(b.requested_name||'').trim(),specification:b.specification||null,quantity:Math.max(1,Number(b.quantity)||1)})});return res.json({success:true,requirement:rows[0]})}
   if(req.method==='POST'&&b.action==='propose_part'){if(actor.role!=='purchase_manager')return res.status(403).json({error:'Purchase Manager access required.'});const rows=await q('/rest/v1/parts_catalog',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({name:b.name,description:b.description||null,active:false,pricing_status:'pending_approval',proposed_cost_price:Number(b.cost_price)||0,proposed_sale_price:Number(b.sale_price)||0,proposed_by:actor.id,proposed_at:new Date().toISOString(),stock_on_hand:Number(b.stock_on_hand)||0,reorder_level:Number(b.reorder_level)||0,supplier_name:b.supplier_name||null})});return res.json({success:true,part:rows[0]})}
   if(req.method==='PATCH'&&b.action==='propose_price'){if(actor.role!=='purchase_manager')return res.status(403).json({error:'Purchase Manager access required.'});await q('/rest/v1/parts_catalog?id=eq.'+encodeURIComponent(b.part_id),{method:'PATCH',body:JSON.stringify({proposed_cost_price:Number(b.cost_price),proposed_sale_price:Number(b.sale_price),pricing_status:'pending_approval',proposed_by:actor.id,proposed_at:new Date().toISOString()})});return res.json({success:true,message:'Pricing sent for Business Manager approval.'})}
   if(req.method==='PATCH'&&b.action==='approve_price'){if(actor.role!=='business_manager')return res.status(403).json({error:'Business Manager approval required.'});const part=(await q('/rest/v1/parts_catalog?id=eq.'+encodeURIComponent(b.part_id)+'&select=proposed_cost_price,proposed_sale_price'))[0];if(!part||Number(part.proposed_sale_price)<=Number(part.proposed_cost_price))return res.status(400).json({error:'Sale price must be greater than cost price.'});await q('/rest/v1/parts_catalog?id=eq.'+encodeURIComponent(b.part_id),{method:'PATCH',body:JSON.stringify({cost_price:part.proposed_cost_price,sale_price:part.proposed_sale_price,price:part.proposed_sale_price,pricing_status:'approved',active:true,approved_by:actor.id,approved_at:new Date().toISOString()})});return res.json({success:true,message:'Price approved and live.'})}
   return res.status(405).json({error:'Method not allowed'});
  }
  if(scope==='analytics'){
   if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
   if(!['business_manager','accounts_manager'].includes(actor.role))return res.status(403).json({error:'Business or Accounts Manager access required.'});
   const [memberships,orders,items]=await Promise.all([q('/rest/v1/memberships?status=eq.paid&select=id,plan_name,amount,created_at,razorpay_payment_id'),q('/rest/v1/orders?status=in.(paid,paid_pending_dispatch,processing,dispatched,delivered)&select=id,total,status,paid_at,razorpay_payment_id'),q('/rest/v1/order_items?select=order_id,part_id,quantity,unit_price')]);
   const ids=[...new Set(items.map(i=>i.part_id).filter(Boolean))];const parts=ids.length?await q('/rest/v1/parts_catalog?id=in.('+ids.join(',')+')&select=id,cost_price'):[];const costs=Object.fromEntries(parts.map(x=>[x.id,Number(x.cost_price||0)]));const mc=memberships.reduce((s,x)=>s+Number(x.amount||0),0),pc=orders.reduce((s,x)=>s+Number(x.total||0),0),cost=items.reduce((s,x)=>s+Number(x.quantity||0)*costs[x.part_id],0);return res.json({success:true,summary:{membership_collection:mc,membership_count:memberships.length,parts_collection:pc,parts_order_count:orders.length,total_gross_collection:mc+pc,estimated_parts_cost:cost,estimated_parts_gross_profit:pc-cost},memberships,orders});
  }
  if(req.method==='PATCH'){
   const body=req.body||{},update={};for(const f of fields)if(Object.prototype.hasOwnProperty.call(body,f))update[f]=String(body[f]||'').trim()||null;
   if(update.full_name!==undefined&&update.full_name===null)return res.status(400).json({error:'Name is required.'});
   update.profile_completed=!!(update.full_name&&update.class_name&&update.school_name&&update.address_line1&&update.phone);
   update.updated_at=new Date().toISOString();
   const rows=await q('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(user.id),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(update)});
   const p=rows[0]||{};return res.json({success:true,name:p.full_name||'Member Student',profile:p});
  }
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const select='full_name,class_name,school_name,address_line1,address_line2,landmark,city,state,postal_code,country,phone,whatsapp_no,membership_status,membership_expires_at,membership_id,profile_completed,role,approval_status';
  const p=(await q('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(user.id)+'&select='+encodeURIComponent(select)))[0]||{};
  if(String(req.query?.manager||'')==='1'){
   if(p.role!=='project_manager'||p.approval_status!=='approved')return res.status(403).json({error:'Project Manager access required'});
   const [students,journeys,orders,items,projects]=await Promise.all([q('/rest/v1/user_profiles?role=eq.student&select=id,full_name,email,phone,membership_status,membership_expires_at,created_at&order=created_at.desc'),q('/rest/v1/student_project_journeys?select=id,student_id,project_id,current_stage,created_at,last_opened_at,completed_at'),q('/rest/v1/orders?select=id,student_id,project_id,status,total,delivery_address,phone,created_at,updated_at,paid_at&order=created_at.desc'),q('/rest/v1/order_items?select=order_id,name,quantity,unit_price'),q('/rest/v1/projects?select=id,title,level')]);
   const pm=Object.fromEntries(projects.map(x=>[x.id,x])),by=Object.fromEntries(students.map(s=>[s.id,{...s,journeys:[],orders:[]}]));journeys.forEach(j=>by[j.student_id]?.journeys.push({...j,project:pm[j.project_id]||null}));orders.forEach(o=>by[o.student_id]?.orders.push({...o,project:pm[o.project_id]||null,items:items.filter(i=>i.order_id===o.id)}));
   return res.json({success:true,students:Object.values(by),orders:orders.map(o=>({...o,project:pm[o.project_id]||null,student:students.find(s=>s.id===o.student_id)||null,items:items.filter(i=>i.order_id===o.id)}))});
  }
  const name=p.full_name||user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split('@')[0]||'Member Student';
  res.json({success:true,name,profile:p,email:user.email||null});
 }catch(e){console.error(e.message);res.status(e.status||500).json({error:e.message||'Unable to load profile.'})}
};