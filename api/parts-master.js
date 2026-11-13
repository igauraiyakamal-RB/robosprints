const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
async function sb(path,opt={}){const r=await fetch(U+path,{...opt,headers:{...H,...(opt.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw Error((d&&d.message)||t||'Database request failed');return d}
async function actor(req){const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token){const e=new Error('Please log in.');e.status=401;throw e}const r=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}}),u=await r.json();if(!r.ok||!u?.id){const e=new Error('Please log in.');e.status=401;throw e}const p=(await sb('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(u.id)+'&select=id,role,approval_status'))[0];if(!p){const e=new Error('Profile not found.');e.status=403;throw e}return p}
module.exports=async(req,res)=>{try{
 const a=await actor(req),role=a.role;
 if(req.method==='GET'){
  const q=String(req.query?.q||'').trim();
  let path='/rest/v1/parts_catalog?active=eq.true&pricing_status=eq.approved&select=id,name,description,sku,sale_price,stock_on_hand,reorder_level';
  if(q)path+='&name=ilike.*'+encodeURIComponent(q)+'*';
  const parts=await sb(path+'&order=name.asc');
  return res.json({success:true,parts});
 }
 if(req.method==='POST'&&req.body?.action==='request_part'){
  if(role!=='mentor')return res.status(403).json({error:'Only Mentors can raise a new technical part requirement.'});
  const b=req.body||{};
  if(!String(b.requested_name||'').trim())return res.status(400).json({error:'Part name is required.'});
  const rows=await sb('/rest/v1/part_requirements',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({mentor_id:a.id,project_id:b.project_id||null,requested_name:String(b.requested_name).trim(),specification:String(b.specification||'').trim()||null,quantity:Math.max(1,Number(b.quantity)||1)})});
  return res.json({success:true,requirement:rows[0]});
 }
 if(req.method==='POST'&&req.body?.action==='propose_part'){
  if(role!=='purchase_manager')return res.status(403).json({error:'Purchase Manager access required.'});
  const b=req.body||{};if(!String(b.name||'').trim())return res.status(400).json({error:'Part name is required.'});
  const rows=await sb('/rest/v1/parts_catalog',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({name:String(b.name).trim(),description:b.description||null,sku:b.sku||null,active:false,pricing_status:'pending_approval',proposed_cost_price:Number(b.cost_price)||0,proposed_sale_price:Number(b.sale_price)||0,proposed_by:a.id,proposed_at:new Date().toISOString(),stock_on_hand:Number(b.stock_on_hand)||0,reorder_level:Number(b.reorder_level)||0,supplier_name:b.supplier_name||null})});
  return res.json({success:true,part:rows[0]});
 }
 if(req.method==='PATCH'){
  const b=req.body||{};
  if(b.action==='propose_price'){
   if(role!=='purchase_manager')return res.status(403).json({error:'Purchase Manager access required.'});
   await sb('/rest/v1/parts_catalog?id=eq.'+encodeURIComponent(b.part_id),{method:'PATCH',body:JSON.stringify({proposed_cost_price:Number(b.cost_price),proposed_sale_price:Number(b.sale_price),pricing_status:'pending_approval',proposed_by:a.id,proposed_at:new Date().toISOString()})});
   return res.json({success:true,message:'Pricing sent to Business Manager for approval.'});
  }
  if(b.action==='approve_price'){
   if(role!=='business_manager')return res.status(403).json({error:'Business Manager approval required.'});
   const part=(await sb('/rest/v1/parts_catalog?id=eq.'+encodeURIComponent(b.part_id)+'&select=proposed_cost_price,proposed_sale_price'))[0];
   if(!part||Number(part.proposed_sale_price)<=Number(part.proposed_cost_price))return res.status(400).json({error:'Sale price must be greater than cost price.'});
   await sb('/rest/v1/parts_catalog?id=eq.'+encodeURIComponent(b.part_id),{method:'PATCH',body:JSON.stringify({cost_price:part.proposed_cost_price,sale_price:part.proposed_sale_price,price:part.proposed_sale_price,pricing_status:'approved',active:true,approved_by:a.id,approved_at:new Date().toISOString()})});
   return res.json({success:true,message:'Price approved and made live.'});
  }
 }
 res.status(405).json({error:'Method not allowed'});
}catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Unable to process parts request.'})}};