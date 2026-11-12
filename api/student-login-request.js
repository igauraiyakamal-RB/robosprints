const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const K=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
module.exports=async(q,r)=>{
 if(q.method!=='POST')return r.status(405).json({error:'Method not allowed'});
 const email=String(q.body?.email||'').trim().toLowerCase();
 if(!email)return r.status(400).json({error:'Enter your registered email address.'});
 if(!U||!K)return r.status(500).json({error:'Login email service is not configured on the server.'});
 try{
  const x=await fetch(U+'/auth/v1/otp',{method:'POST',headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'},body:JSON.stringify({email,should_create_user:false})});
  const raw=await x.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{}
  if(!x.ok){console.error('Student OTP request failed:',x.status,raw);return r.status(502).json({error:d.msg||d.message||'The login email service rejected this request.'});}
  return r.status(200).json({success:true});
 }catch(e){console.error('Student OTP request failed:',e.message);return r.status(500).json({error:'We could not contact the login email service. Please try again.'});}
};