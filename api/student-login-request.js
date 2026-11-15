const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const K=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports=async(q,r)=>{
 if(q.method!=='POST')return r.status(405).json({error:'Method not allowed'});
 const email=String(q.body?.email||'').trim().toLowerCase();
 if(!email)return r.status(400).json({error:'Enter your registered membership email address.'});
 if(!U||!K)return r.status(500).json({error:'Login email service is not configured on the server.'});

 try{
  // IMPORTANT: Check the real membership before requesting an OTP.
  const profile=await fetch(U+'/rest/v1/user_profiles?select=id,email&email=eq.'+encodeURIComponent(email)+'&limit=1',{
   headers:{apikey:K,Authorization:'Bearer '+K}
  });
  const profiles=await profile.json();
  if(!profile.ok)throw Error('Unable to check membership registration.');
  if(!Array.isArray(profiles)||!profiles[0]){
   return r.status(404).json({error:'No registered RoboSprints student account was found for this email. No OTP has been sent.'});
  }

  const userId=profiles[0].id;
  const membership=await fetch(U+'/rest/v1/memberships?select=id,status,activated_at&user_id=eq.'+encodeURIComponent(userId)+'&limit=1',{
   headers:{apikey:K,Authorization:'Bearer '+K}
  });
  const memberships=await membership.json();
  if(!membership.ok)throw Error('Unable to check membership status.');
  if(!Array.isArray(memberships)||!memberships[0]){
   return r.status(404).json({error:'No active RoboSprints membership was found for this email. No OTP has been sent.'});
  }

  const status=String(memberships[0].status||'').toLowerCase();
  if(status && !['active','paid','completed','confirmed'].includes(status)){
   return r.status(403).json({error:'Your RoboSprints membership is not active. No OTP has been sent.'});
  }

  // Only a registered student with a valid membership reaches the OTP service.
  const x=await fetch(U+'/auth/v1/otp',{method:'POST',headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'},body:JSON.stringify({email,should_create_user:false})});
  const raw=await x.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{}
  if(!x.ok){console.error('Student OTP request failed:',x.status,raw);return r.status(502).json({error:d.msg||d.message||'The login email service rejected this request.'});}
  return r.status(200).json({success:true});
 }catch(e){
  console.error('Student login request failed:',e.message);
  return r.status(500).json({error:'We could not verify your membership. No OTP has been sent.'});
 }
};