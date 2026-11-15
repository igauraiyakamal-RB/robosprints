const crypto=require('crypto');
const SB_URL=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const h={apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY,'Content-Type':'application/json'};
async function sb(path,opt={}){const r=await fetch(SB_URL+path,{...opt,headers:{...h,...(opt.headers||{})}});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t||'Database request failed');return d;}
module.exports=async(req,res)=>{
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!SB_URL||!SERVICE_KEY)return res.status(500).json({error:'Application service is not configured.'});
 try{
  const b=req.body||{};
  const required=['full_name','email','phone','city','experience_level','education','expertise','motivation'];
  for(const k of required)if(!String(b[k]||'').trim())return res.status(400).json({error:'Please complete all required fields.'});
  const email=String(b.email).trim().toLowerCase();
  const existing=await sb('/rest/v1/user_profiles?email=eq.'+encodeURIComponent(email)+'&select=id,role,approval_status');
  if(existing[0])return res.status(409).json({error:'An application or account already exists for this email.'});
  const password=crypto.randomBytes(24).toString('base64url')+'Aa1!';
  const created=await sb('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password,email_confirm:false,user_metadata:{full_name:b.full_name,phone:b.phone,mentor_application:{city:b.city,education:b.education,organisation:b.organisation||'',experience_years:b.experience_years||'',experience_level:b.experience_level,expertise:b.expertise,project_ideas:b.project_ideas||'',availability:b.availability||'',linkedin:b.linkedin||'',motivation:b.motivation,submitted_at:new Date().toISOString()}}})});
  await sb('/rest/v1/user_profiles',{method:'POST',body:JSON.stringify({id:created.id,full_name:b.full_name,email,phone:b.phone,whatsapp_no:b.whatsapp||b.phone,city:b.city,role:'mentor',approval_status:'pending',profile_completed:false})});
  return res.status(200).json({success:true,message:'Your mentor application has been submitted for RoboSprints business review.'});
 }catch(e){console.error('Mentor application:',e.message);return res.status(500).json({error:e.message||'Could not submit your application.'});}
};