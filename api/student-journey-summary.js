const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:'Bearer '+K};
module.exports=async(req,res)=>{
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token)return res.status(401).json({error:'Please log in.'});
 try{
  const a=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}}),user=await a.json();
  if(!a.ok||!user?.id)return res.status(401).json({error:'Please log in.'});
  const start=new Date();start.setDate(1);start.setHours(0,0,0,0);
  const r=await fetch(U+'/rest/v1/student_project_journeys?student_id=eq.'+encodeURIComponent(user.id)+'&created_at=gte.'+encodeURIComponent(start.toISOString())+'&select=id,project_id,created_at,current_stage&order=last_opened_at.desc',{headers:H});
  if(!r.ok)throw Error(await r.text());const journeys=await r.json();
  res.json({success:true,used:journeys.length,limit:4,remaining:Math.max(0,4-journeys.length),journeys});
 }catch(e){console.error(e.message);res.status(500).json({error:'Could not load your journey summary.'})}
};