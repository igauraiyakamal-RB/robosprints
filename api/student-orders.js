const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:'Bearer '+K};
async function q(path){const r=await fetch(U+path,{headers:H});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t||'Database request failed');return d}
module.exports=async(req,res)=>{
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({error:'Please log in.'});
 try{
  const a=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}}),user=await a.json();if(!a.ok||!user?.id)return res.status(401).json({error:'Please log in.'});
  const orders=await q('/rest/v1/orders?student_id=eq.'+encodeURIComponent(user.id)+'&select=id,project_id,status,total,delivery_address,phone,created_at,updated_at,paid_at,razorpay_payment_id&order=created_at.desc');
  const ids=[...new Set(orders.map(x=>x.project_id).filter(Boolean))],projects=ids.length?await q('/rest/v1/projects?select=id,title&id=in.('+ids.join(',')+')'):[];
  const items=orders.length?await q('/rest/v1/order_items?select=order_id,name,quantity,unit_price&order_id=in.('+orders.map(x=>x.id).join(',')+')'):[];
  const names=Object.fromEntries(projects.map(x=>[x.id,x.title]));
  res.json({success:true,orders:orders.map(o=>({...o,project_title:names[o.project_id]||'Project',items:items.filter(i=>i.order_id===o.id)}))});
 }catch(e){console.error(e.message);res.status(500).json({error:'Unable to load your orders.'})}
};