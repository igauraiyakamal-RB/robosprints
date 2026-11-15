const SB_URL=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const base={apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY,'Content-Type':'application/json'};
async function sb(path,opt={}){const r=await fetch(SB_URL+path,{...opt,headers:{...base,...(opt.headers||{})}});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t||'Request failed');return d;}
async function actor(req){const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)throw Error('Please log in.');const u=await fetch(SB_URL+'/auth/v1/user',{headers:{apikey:SERVICE_KEY,Authorization:'Bearer '+token}});if(!u.ok)throw Error('Invalid session.');const user=await u.json();const p=(await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(user.id)+'&select=role,approval_status'))[0];if(!p||!['business_manager','admin'].includes(p.role)||p.approval_status!=='approved')throw Error('Business Manager access required.');return user;}
module.exports=async(req,res)=>{
 if(!SB_URL||!SERVICE_KEY)return res.status(500).json({error:'Application service is not configured.'});
 try{await actor(req);
 if(req.method==='GET'){
  const rows=await sb('/rest/v1/user_profiles?role=eq.mentor&approval_status=eq.pending&select=id,full_name,email,phone,whatsapp_no,city,created_at&order=created_at.desc');
  const users=await sb('/auth/v1/admin/users?per_page=1000');
  const map=new Map((users.users||users||[]).map(u=>[u.id,u.user_metadata&&u.user_metadata.mentor_application||{}]));
  return res.status(200).json({applications:rows.map(x=>({...x,application:map.get(x.id)||{}}))});
 }
 if(req.method==='POST'){
  const {id,action}=req.body||{};if(!id||!['approve','reject'].includes(action))return res.status(400).json({error:'Invalid action.'});
  if(action==='approve'){
   await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({approval_status:'approved',updated_at:new Date().toISOString()})});
   await sb('/auth/v1/admin/generate_link',{method:'POST',body:JSON.stringify({type:'recovery',email:(await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(id)+'&select=email'))[0].email,options:{redirect_to:'https://www.robosprints.in/reset-password.html'}}).catch(()=>({}));
   return res.status(200).json({success:true,message:'Mentor approved. The applicant can now set a password and access Mentor Studio.'});
  }
  await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({approval_status:'rejected',updated_at:new Date().toISOString()})});
  return res.status(200).json({success:true,message:'Mentor application rejected.'});
 }
 return res.status(405).json({error:'Method not allowed'});
 }catch(e){return res.status(403).json({error:e.message||'Request failed'});}
};