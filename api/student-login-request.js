const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminHeaders={apikey:SERVICE||ANON,Authorization:'Bearer '+(SERVICE||ANON),'Content-Type':'application/json'};
module.exports=async(q,r)=>{
 const action=String(q.body?.action||q.query?.action||'request');
 if(q.method==='POST'&&action==='verify'){
  const email=String(q.body?.email||'').trim().toLowerCase(),token=String(q.body?.token||'').trim();
  if(!email||!token)return r.status(400).json({error:'Email and verification code are required.'});
  try{const a=await fetch(U+'/auth/v1/verify',{method:'POST',headers:adminHeaders,body:JSON.stringify({email,token,type:'email'})}),d=await a.json();if(!a.ok||!d.user?.id)throw Error('Invalid or expired verification code.');const uid=d.user.id;
   const m=await fetch(U+'/rest/v1/memberships?user_id=eq.'+encodeURIComponent(uid)+'&status=eq.active&limit=1&select=membership_id',{headers:adminHeaders}).then(x=>x.json());if(!m.length)return r.status(403).json({error:'No active RoboSprints membership was found.'});
   const j=await fetch(U+'/rest/v1/student_project_journeys?student_id=eq.'+encodeURIComponent(uid)+'&order=updated_at.desc&limit=1&select=project_id,current_stage',{headers:adminHeaders}).then(x=>x.json());const z=j[0];
   return r.json({success:true,membership_id:m[0].membership_id,access_token:d.access_token||d.session?.access_token||null,journey_url:z?.project_id?'/student-dashboard.html?project='+encodeURIComponent(z.project_id):'/'});
  }catch(e){return r.status(400).json({error:e.message||'Login could not be completed.'});}
 }
 if(q.method!=='POST')return r.status(405).json({error:'Method not allowed'});
 const email=String(q.body?.email||'').trim().toLowerCase();if(!email)return r.status(400).json({error:'Enter your registered membership email address.'});if(!U||!ANON)return r.status(500).json({error:'Login email service is not configured on the server.'});
 try{const profile=await fetch(U+'/rest/v1/user_profiles?select=id,email&email=eq.'+encodeURIComponent(email)+'&limit=1',{headers:adminHeaders});const profiles=await profile.json();if(!profile.ok)throw Error('Unable to check membership registration.');if(!profiles[0])return r.status(404).json({error:'No registered RoboSprints student account was found for this email. No OTP has been sent.'});
  const membership=await fetch(U+'/rest/v1/memberships?select=id,status&user_id=eq.'+encodeURIComponent(profiles[0].id)+'&limit=1',{headers:adminHeaders}),memberships=await membership.json();if(!membership.ok)throw Error('Unable to check membership status.');if(!memberships[0])return r.status(404).json({error:'No active RoboSprints membership was found for this email. No OTP has been sent.'});
  const status=String(memberships[0].status||'').toLowerCase();if(status&&!['active','paid','completed','confirmed'].includes(status))return r.status(403).json({error:'Your RoboSprints membership is not active. No OTP has been sent.'});
  const x=await fetch(U+'/auth/v1/otp',{method:'POST',headers:{apikey:ANON,Authorization:'Bearer '+ANON,'Content-Type':'application/json'},body:JSON.stringify({email,should_create_user:false})}),raw=await x.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{}if(!x.ok)return r.status(502).json({error:d.msg||d.message||'The login email service rejected this request.'});return r.status(200).json({success:true});
 }catch(e){console.error('Student login request failed:',e.message);return r.status(500).json({error:'We could not verify your membership. No OTP has been sent.'});}
};