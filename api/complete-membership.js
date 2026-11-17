const crypto=require('crypto');

const SB_URL=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers(extra={}){return {apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY,'Content-Type':'application/json',...extra};}
async function sb(path,opt={}){
  const r=await fetch(SB_URL+path,{...opt,headers:headers(opt.headers||{})});
  const text=await r.text(); let data=null; try{data=text?JSON.parse(text):null}catch{}
  if(!r.ok){const e=new Error((data&&data.message)||text||'Supabase request failed');e.status=r.status;throw e}
  return data;
}
function expiryFor(plan){const d=new Date(); if(plan==='1 Month')d.setMonth(d.getMonth()+1); else if(plan==='3 Months')d.setMonth(d.getMonth()+3); else if(plan==='6 Months')d.setMonth(d.getMonth()+6); else d.setFullYear(d.getFullYear()+1); return d.toISOString();}
function verifyPayment(body){
  const {razorpay_payment_id,razorpay_order_id,razorpay_signature}=body;
  if(!process.env.RAZORPAY_KEY_SECRET)return false;
  const generated=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');
  const a=Buffer.from(String(razorpay_signature),'utf8'),b=Buffer.from(generated,'utf8');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function attachValidProjectJourney(studentId,projectId,studentPhone){
  if(!projectId)return null;
  // A stale project id must never roll back an already verified membership.
  const projects=await sb('/rest/v1/projects?id=eq.'+encodeURIComponent(projectId)+'&status=eq.published&select=id&limit=1');
  if(!projects||!projects.length){console.warn('Membership project link skipped: project does not exist',projectId);return null;}
  const journeys=await sb('/rest/v1/student_project_journeys?student_id=eq.'+encodeURIComponent(studentId)+'&project_id=eq.'+encodeURIComponent(projectId)+'&select=id&limit=1');
  if(!journeys.length){
    await sb('/rest/v1/student_project_journeys',{method:'POST',body:JSON.stringify({student_id:studentId,project_id:projectId,current_stage:1,phone:studentPhone||null,membership_status:'active'})});
  }
  return projectId;
}
async function ensureMembershipTransaction(membership,student,plan,amount,paymentId){
  const existing=await sb('/rest/v1/business_transactions?payment_reference=eq.'+encodeURIComponent(paymentId)+'&select=id&limit=1');
  if(existing&&existing.length)return existing[0];
  const rows=await sb('/rest/v1/business_transactions',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({transaction_type:'income',category:'membership',source_type:'membership',source_id:membership.id,description:'RoboSprints '+plan+' membership - '+student.fullName,gross_amount:Number(amount),discount_amount:0,net_amount:Number(amount),status:'recorded',payment_reference:paymentId})
  });
  return rows&&rows[0];
}
async function syncProfileMembership(profileId,membershipId,plan,student,preserve={}){
  const rows=await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(profileId),{
    method:'PATCH',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      membership_id:membershipId,membership_status:'active',approval_status:'approved',
      membership_started_at:preserve.membership_started_at||new Date().toISOString(),membership_expires_at:preserve.membership_expires_at||expiryFor(plan),
      full_name:student.fullName,phone:student.phone,whatsapp_no:student.phone,
      city:student.city||null,profile_completed:true,updated_at:new Date().toISOString()
    })
  });
  if(!rows||!rows.length)throw new Error('Student profile membership details could not be saved');
  return rows[0];
}

module.exports=async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!SB_URL||!SERVICE_KEY)return res.status(500).json({error:'Membership service is not configured.'});
  try{
    const {razorpay_payment_id,razorpay_order_id,razorpay_signature,student={},plan,amount,project_id}=req.body||{};
    if(!razorpay_payment_id||!razorpay_order_id||!razorpay_signature||!student.fullName||!student.email||!student.phone||!plan||!amount)
      return res.status(400).json({error:'Missing membership details'});
    if(!verifyPayment({razorpay_payment_id,razorpay_order_id,razorpay_signature}))
      return res.status(400).json({error:'Payment signature verification failed'});

    // Idempotency: a retry after a partial failure repairs the profile and project link
    // instead of attempting to charge or create a duplicate membership.
    const existing=await sb('/rest/v1/memberships?razorpay_payment_id=eq.'+encodeURIComponent(razorpay_payment_id)+'&select=*');
    if(existing&&existing.length){
      const m=existing[0];
      const profiles=await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(m.user_id)+'&select=*');
      const profile=profiles&&profiles[0];
      if(!profile)throw new Error('Paid membership exists but its student profile is missing');
      await syncProfileMembership(profile.id,m.membership_id||('RS-'+Date.now()),m.plan_name||plan,student,profile);
      try{await ensureMembershipTransaction(m,student,m.plan_name||plan,m.amount||amount,razorpay_payment_id);}catch(e){console.error('Membership transaction repair warning:',e.message);}
      let linkedProject=null;
      try{linkedProject=await attachValidProjectJourney(profile.id,project_id,student.phone);}catch(e){console.error('Project journey warning:',e.message);}
      return res.status(200).json({success:true,already_processed:true,membership_id:m.membership_id||profile.membership_id,student_id:profile.id,project_id:linkedProject,journey_url:linkedProject?'/student-dashboard.html?project='+encodeURIComponent(linkedProject):'/#projects'});
    }

    const expectedPrices={'1 Month':99,'3 Months':450,'6 Months':750,'Full Year':999};
    if(!Object.prototype.hasOwnProperty.call(expectedPrices,plan)||Number(amount)!==expectedPrices[plan])return res.status(400).json({error:'Membership plan amount does not match the current published price.'});

    const email=String(student.email).trim().toLowerCase();
    let profiles=await sb('/rest/v1/user_profiles?email=eq.'+encodeURIComponent(email)+'&select=*');
    let profile=profiles[0];

    if(!profile){
      const tempPassword=crypto.randomBytes(24).toString('base64url')+'Aa1!';
      const created=await sb('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password:tempPassword,email_confirm:true,user_metadata:{full_name:student.fullName,phone:student.phone}})});
      const uid=created.id;
      const rows=await sb('/rest/v1/user_profiles?on_conflict=id',{
        method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},
        body:JSON.stringify({id:uid,full_name:student.fullName,email,phone:student.phone,whatsapp_no:student.phone,city:student.city||null,role:'student',approval_status:'approved',membership_status:'active',membership_started_at:new Date().toISOString(),membership_expires_at:expiryFor(plan),profile_completed:true})
      });
      profile=rows&&rows[0];
      if(!profile){const check=await sb('/rest/v1/user_profiles?id=eq.'+uid+'&select=*');profile=check[0];}
    }else{
      const rows=await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(profile.id),{
        method:'PATCH',headers:{Prefer:'return=representation'},
        body:JSON.stringify({full_name:student.fullName,phone:student.phone,whatsapp_no:student.phone,city:student.city||profile.city||null,approval_status:'approved',membership_status:'active',membership_started_at:new Date().toISOString(),membership_expires_at:expiryFor(plan),profile_completed:true,updated_at:new Date().toISOString()})
      });
      profile=rows&&rows[0]||profile;
    }
    if(!profile||!profile.id)throw new Error('Student profile could not be created');

    const membershipId='RS-'+Date.now();
    const membershipRows=await sb('/rest/v1/memberships',{
      method:'POST',headers:{Prefer:'return=representation'},
      body:JSON.stringify({user_id:profile.id,membership_id:membershipId,plan_name:plan,amount:Number(amount),currency:'INR',status:'active',payment_provider:'razorpay',razorpay_order_id,razorpay_payment_id,transaction_id:razorpay_payment_id,activated_at:new Date().toISOString()})
    });
    const membership=membershipRows&&membershipRows[0];
    if(!membership)throw new Error('Membership record could not be created');

    await syncProfileMembership(profile.id,membershipId,plan,student);
    let linkedProject=null;
    try{linkedProject=await attachValidProjectJourney(profile.id,project_id,student.phone);}catch(e){console.error('Project journey warning:',e.message);}

    // Reporting and notifications must never block an already activated student.
    try{await ensureMembershipTransaction(membership,student,plan,amount,razorpay_payment_id);}catch(e){console.error('Business transaction warning:',e.message);}
    try{
      const recipients=await sb('/rest/v1/user_profiles?role=in.(project_manager,accounts_manager,business_manager,admin)&approval_status=eq.approved&select=id,role');
      let mentorId=null,projectTitle='';
      if(linkedProject){const pr=await sb('/rest/v1/projects?id=eq.'+encodeURIComponent(linkedProject)+'&select=mentor_id,title');if(pr[0]){mentorId=pr[0].mentor_id;projectTitle=pr[0].title||'';}}
      if(mentorId)recipients.push({id:mentorId,role:'mentor'});
      for(const x of recipients.filter(x=>x.id)){
        await sb('/rest/v1/notifications',{method:'POST',body:JSON.stringify({user_id:x.id,title:x.role==='mentor'?'New student assigned to your project':'New membership payment received',message:x.role==='mentor'?student.fullName+' has joined '+projectTitle+'.':student.fullName+' purchased the '+plan+' plan for ₹'+Number(amount)+'.',type:'payment'})});
      }
    }catch(e){console.error('Notification warning:',e.message);}

    return res.status(200).json({success:true,membership_id:membership.membership_id,student_id:profile.id,project_id:linkedProject,journey_url:linkedProject?'/student-dashboard.html?project='+encodeURIComponent(linkedProject):'/#projects'});
  }catch(e){
    console.error('Membership completion failed:',e.message);
    return res.status(500).json({error:'Payment was verified, but membership activation needs attention. Please contact RoboSprints support with your payment ID.'});
  }
};