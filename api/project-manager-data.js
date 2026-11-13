const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:'Bearer '+K};
async function q(path){const r=await fetch(U+path,{headers:H});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t);return d}
module.exports=async(req,res)=>{
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({error:'Login required'});
 try{
  const a=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}}),u=await a.json();if(!a.ok||!u?.id)return res.status(401).json({error:'Login required'});
  const me=(await q('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(u.id)+'&select=role,approval_status'))[0];
  if(!me||me.role!=='project_manager'||me.approval_status!=='approved')return res.status(403).json({error:'Project Manager access required'});
  const [students,journeys,orders,items,projects]=await Promise.all([
   q('/rest/v1/user_profiles?role=eq.student&select=id,full_name,email,phone,membership_status,membership_expires_at,created_at&order=created_at.desc'),
   q('/rest/v1/student_project_journeys?select=id,student_id,project_id,current_stage,created_at,last_opened_at,completed_at'),
   q('/rest/v1/orders?select=id,student_id,project_id,status,total,delivery_address,phone,created_at,updated_at,paid_at&order=created_at.desc'),
   q('/rest/v1/order_items?select=order_id,name,quantity,unit_price'),
   q('/rest/v1/projects?select=id,title,level')
  ]);
  const pm=Object.fromEntries(projects.map(x=>[x.id,x])),byStudent={};
  students.forEach(s=>byStudent[s.id]={...s,journeys:[],orders:[]});
  journeys.forEach(j=>{if(byStudent[j.student_id])byStudent[j.student_id].journeys.push({...j,project:pm[j.project_id]||null})});
  orders.forEach(o=>{if(byStudent[o.student_id])byStudent[o.student_id].orders.push({...o,project:pm[o.project_id]||null,items:items.filter(i=>i.order_id===o.id)})});
  res.json({success:true,students:Object.values(byStudent),orders:orders.map(o=>({...o,project:pm[o.project_id]||null,student:students.find(s=>s.id===o.student_id)||null,items:items.filter(i=>i.order_id===o.id)}))});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Unable to load operations data'})}
};