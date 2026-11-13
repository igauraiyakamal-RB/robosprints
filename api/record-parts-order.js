const crypto=require('crypto');
const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
async function req(path,opt={}){const r=await fetch(U+path,{...opt,headers:{...H,...(opt.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t||'Database request failed');return d}
module.exports=async(reqq,res)=>{
 if(reqq.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const token=String(reqq.headers.authorization||'').replace(/^Bearer\s+/i,'');
 const b=reqq.body||{},project_id=String(b.project_id||''),address=String(b.address||'').trim(),phone=String(b.phone||'').trim();
 const indexes=Array.isArray(b.missing_indexes)?[...new Set(b.missing_indexes.map(Number).filter(Number.isInteger))]:[];
 if(!token||!project_id||!address||!phone||!indexes.length)return res.status(400).json({error:'Complete order details are required.'});
 try{
  const au=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}}),user=await au.json();
  if(!au.ok||!user?.id)return res.status(401).json({error:'Please log in again.'});
  const sig=String(b.razorpay_signature||''),oid=String(b.razorpay_order_id||''),pid=String(b.razorpay_payment_id||'');
  if(!sig||!oid||!pid)return res.status(400).json({error:'Payment verification details are missing.'});
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(oid+'|'+pid).digest('hex');
  if(expected.length!==sig.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))return res.status(400).json({error:'Payment signature verification failed.'});
  const parts=await req('/rest/v1/project_parts?project_id=eq.'+encodeURIComponent(project_id)+'&order=sort_order.asc&select=id,name,price');
  const selected=indexes.filter(i=>i>=0&&i<parts.length).map(i=>parts[i]);
  if(!selected.length)return res.status(400).json({error:'Selected parts are no longer available.'});
  const total=selected.reduce((s,p)=>s+Number(p.price||0),0);
  const existing=await req('/rest/v1/orders?razorpay_payment_id=eq.'+encodeURIComponent(pid)+'&select=id&limit=1');
  if(existing[0])return res.json({success:true,order_id:existing[0].id,already_recorded:true});
  const rows=await req('/rest/v1/orders',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({student_id:user.id,project_id,status:'paid_pending_dispatch',total,delivery_address:{address},phone,razorpay_order_id:oid,razorpay_payment_id:pid,paid_at:new Date().toISOString()})});
  const order=rows[0];
  await req('/rest/v1/order_items',{method:'POST',body:JSON.stringify(selected.map(p=>({order_id:order.id,part_id:p.id,name:p.name,quantity:1,unit_price:Number(p.price||0)})))});
  try{await req('/rest/v1/business_transactions',{method:'POST',body:JSON.stringify({transaction_date:new Date().toISOString().slice(0,10),transaction_type:'income',category:'parts_sale',source_type:'order',source_id:order.id,description:'Parts order payment',gross_amount:total,discount_amount:0,net_amount:total,status:'paid',payment_reference:pid,created_by:user.id})})}catch(e){console.warn('Finance ledger sync:',e.message)}
  res.json({success:true,order_id:order.id,status:order.status,total});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Unable to record the order.'})}
};