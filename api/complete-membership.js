const crypto=require('crypto');

const SB_URL=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers(extra={}){return {apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY,'Content-Type':'application/json',...extra};}
async function sb(path,opt={}){const r=await fetch(SB_URL+path,{...opt,headers:headers(opt.headers||{})});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{}if(!r.ok){const e=new Error((data&&data.message)||text||'Supabase request failed');e.status=r.status;throw e}return data;}
function expiryFor(plan){const now=new Date();if(plan==='1 Month')now.setMonth(now.getMonth()+1);else if(plan==='3 Months')now.setMonth(now.getMonth()+3);else if(plan==='6 Months')now.setMonth(now.getMonth()+6);else now.setFullYear(now.getFullYear()+1);return now.toISOString();}
module.exports=async(req,res)=>{
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!SB_URL||!SERVICE_KEY)return res.status(500).json({error:'Membership service is not configured. Please contact RoboSprints support.'});
 try{
  const {razorpay_payment_id,razorpay_order_id,razorpay_signature,student={},plan,amount,project_id}=req.body||{};
  if(!razorpay_payment_id||!razorpay_order_id||!razorpay_signature||!student.fullName||!student.email||!student.phone||!plan||!amount)return res.status(400).json({error:'Missing membership details'});
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');
  const supplied=Buffer.from(String(razorpay_signature),'utf8'),generated=Buffer.from(expected,'utf8');
  if(!process.env.RAZORPAY_KEY_SECRET||supplied.length!==generated.length||!crypto.timingSafeEqual(supplied,generated))return res.status(400).json({error:'Payment signature verification failed'});

  const existing=await sb('/rest/v1/memberships?razorpay_payment_id=eq.'+encodeURIComponent(razorpay_payment_id)+'&select=*');
  if(existing&&existing.length){return res.status(200).json({success:true,membership:existing[0],already_processed:true});}

  const email=String(student.email).trim().toLowerCase();
  let profiles=await sb('/rest/v1/user_profiles?email=eq.'+encodeURIComponent(email)+'&select=*');
  let profile=profiles[0];
  if(!profile){
   const tempPassword=crypto.randomBytes(24).toString('base64url')+'Aa1!';
   const created=await sb('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password:tempPassword,email_confirm:true,user_metadata:{full_name:student.fullName,phone:student.phone}})});
   const uid=created.id;
   const inserted=await sb('/rest/v1/user_profiles',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({id:uid,full_name:student.fullName,email,phone:student.phone,whatsapp_no:student.phone,city:student.city||null,role:'student',approval_status:'approved',membership_status:'active',membership_started_at:new Date().toISOString(),membership_expires_at:expiryFor(plan),profile_completed:true})});
   profile=inserted[0];
   // Send a password-recovery email so the student can set a personal password.
   await fetch(SB_URL+'/auth/v1/recover',{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY||SERVICE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email})}).catch(()=>null);
  }else{
   await sb('/rest/v1/user_profiles?id=eq.'+profile.id,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({full_name:student.fullName,phone:student.phone,whatsapp_no:student.phone,city:student.city||profile.city||null,membership_status:'active',membership_started_at:new Date().toISOString(),membership_expires_at:expiryFor(plan),updated_at:new Date().toISOString()})});
  }

  const membershipRows=await sb('/rest/v1/memberships',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:profile.id,membership_id:'RS-'+Date.now(),plan_name:plan,amount:Number(amount),currency:'INR',status:'active',payment_provider:'razorpay',razorpay_order_id,razorpay_payment_id,transaction_id:razorpay_payment_id,activated_at:new Date().toISOString()})});
  const membership=membershipRows[0];

  if(project_id){
   const journeys=await sb('/rest/v1/student_project_journeys?student_id=eq.'+profile.id+'&project_id=eq.'+project_id+'&select=id');
   if(!journeys.length)await sb('/rest/v1/student_project_journeys',{method:'POST',body:JSON.stringify({student_id:profile.id,project_id,current_stage:1,phone:student.phone,membership_status:'active'})});
  }

  await sb('/rest/v1/business_transactions',{method:'POST',body:JSON.stringify({transaction_type:'income',category:'membership',source_type:'membership',source_id:membership.id,description:'RoboSprints '+plan+' membership - '+student.fullName,gross_amount:Number(amount),discount_amount:0,net_amount:Number(amount),status:'recorded',payment_reference:razorpay_payment_id})});

  const recipients=await sb('/rest/v1/user_profiles?role=in.(project_manager,accounts_manager,business_manager)&approval_status=eq.approved&select=id,role');
  let mentorId=null,projectTitle='';
  if(project_id){const pr=await sb('/rest/v1/projects?id=eq.'+project_id+'&select=mentor_id,title');if(pr[0]){mentorId=pr[0].mentor_id;projectTitle=pr[0].title||'';}}
  if(mentorId)recipients.push({id:mentorId,role:'mentor'});
  const notifications=recipients.filter(x=>x.id).map(x=>({user_id:x.id,title:x.role==='mentor'?'New student assigned to your project':'New membership payment received',message:x.role==='mentor'?student.fullName+' has joined '+projectTitle+'.':student.fullName+' purchased the '+plan+' plan for ₹'+Number(amount)+'.',type:'payment'}));
  for(const n of notifications)await sb('/rest/v1/notifications',{method:'POST',body:JSON.stringify(n)});

  return res.status(200).json({success:true,membership_id:membership.id,student_id:profile.id,project_id:project_id||null,journey_url:project_id?'/student-dashboard.html?project='+encodeURIComponent(project_id):'/student-dashboard.html'});
 }catch(e){console.error('Membership completion failed:',e.message);return res.status(500).json({error:'Payment was verified, but membership activation needs attention. Please contact RoboSprints support with your payment ID.'});}
};
