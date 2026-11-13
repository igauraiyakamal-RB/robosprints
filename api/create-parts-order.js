const Razorpay=require('razorpay');
const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
async function sb(path,opt={}){const r=await fetch(U+path,{...opt,headers:{...H,...(opt.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t||'Database request failed');return d}
module.exports=async(req,res)=>{
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,''),project_id=String(req.body?.project_id||'').trim(),missing=Array.isArray(req.body?.missing_indexes)?req.body.missing_indexes:[];
 if(!token||!project_id)return res.status(400).json({error:'Student session and project are required.'});
 if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)return res.status(500).json({error:'Payment configuration unavailable.'});
 try{
  const ur=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}}),user=await ur.json();
  if(!ur.ok||!user?.id)return res.status(401).json({error:'Please log in again before payment.'});
  const profile=(await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(user.id)+'&select=role,membership_status'))[0];
  if(!profile||profile.role!=='student'||profile.membership_status!=='active')return res.status(403).json({error:'An active student membership is required.'});
  const parts=await sb('/rest/v1/project_parts?project_id=eq.'+encodeURIComponent(project_id)+'&order=sort_order.asc&select=id,name,price');
  const indexes=[...new Set(missing.map(Number).filter(i=>Number.isInteger(i)&&i>=0&&i<parts.length))];
  if(!indexes.length)return res.status(400).json({error:'Please select at least one missing part.'});
  const items=indexes.map(i=>parts[i]),amount=items.reduce((s,p)=>s+Math.round(Number(p.price||0)*100),0);
  if(!Number.isInteger(amount)||amount<100)return res.status(400).json({error:'The selected parts do not have a valid price.'});
  const razorpay=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
  const order=await razorpay.orders.create({amount,currency:'INR',receipt:'parts_'+Date.now(),notes:{project_id,student_id:user.id}});
  res.json({success:true,key_id:process.env.RAZORPAY_KEY_ID,order_id:order.id,amount:order.amount,currency:order.currency,items});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Could not start payment.'})}
};