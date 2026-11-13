const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
async function q(path,opt={}){const r=await fetch(U+path,{...opt,headers:{...H,...(opt.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t||'Database request failed');return d}
async function currentUser(token){const a=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}}),user=await a.json();if(!a.ok||!user?.id){const e=new Error('Please log in.');e.status=401;throw e}return user}
const fields=['full_name','class_name','school_name','address_line1','address_line2','landmark','city','state','postal_code','country','phone','whatsapp_no'];
module.exports=async(req,res)=>{
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({error:'Please log in.'});
 try{
  const user=await currentUser(token);
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