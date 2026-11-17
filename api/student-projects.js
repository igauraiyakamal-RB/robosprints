const U=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
async function read(path){
 const r=await fetch(U+path,{headers:H}),t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{}
 if(!r.ok)throw Error((d&&d.message)||t||'Unable to load student projects');
 return d;
}
module.exports=async(req,res)=>{
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!U||!K)return res.status(500).json({error:'Project catalogue is not configured.'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token)return res.status(401).json({error:'Please log in to view your projects.'});
 try{
  const auth=await fetch(U+'/auth/v1/user',{headers:{apikey:K,Authorization:'Bearer '+token}});
  const user=await auth.json();
  if(!auth.ok||!user?.id)return res.status(401).json({error:'Your session has expired. Please log in again.'});
  const profiles=await read('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(user.id)+'&select=id,role,membership_status,membership_expires_at,full_name');
  const profile=profiles[0];
  if(!profile||profile.role!=='student')return res.status(403).json({error:'A student account is required.'});
  if(profile.membership_status!=='active'||(profile.membership_expires_at&&new Date(profile.membership_expires_at)<new Date()))return res.status(403).json({error:'Your membership is not active. Please renew to explore projects.',code:'membership_expired'});
  const memberships=await read('/rest/v1/memberships?user_id=eq.'+encodeURIComponent(user.id)+'&status=eq.active&order=activated_at.desc&limit=1&select=plan_name,membership_id');
  const membership=memberships[0];
  if(!membership?.plan_name)return res.status(403).json({error:'We could not find an active membership plan for your account.'});
  const [projects,rules,journeys]=await Promise.all([
   read('/rest/v1/projects?status=eq.published&select=*&order=created_at.desc'),
   read('/rest/v1/project_access_rules?select=project_level,allowed_plans'),
   read('/rest/v1/student_project_journeys?student_id=eq.'+encodeURIComponent(user.id)+'&select=project_id,current_stage,updated_at,created_at&order=updated_at.desc')
  ]);
  const allowedByLevel={};
  for(const rule of rules||[]){const level=String(rule.project_level||'').trim().toLowerCase();allowedByLevel[level]=Array.isArray(rule.allowed_plans)?rule.allowed_plans:[];}
  const startedByProject={};
  for(const j of journeys||[])if(j.project_id&&!startedByProject[j.project_id])startedByProject[j.project_id]=j;
  const eligible=(projects||[]).filter(p=>{
   let level=String(p.level||'beginner').trim().toLowerCase();if(level==='advance')level='advanced';
   return (allowedByLevel[level]||[]).includes(membership.plan_name);
  }).map(p=>{
   const journey=startedByProject[p.id]||null;
   return {
    id:p.id,title:p.title||'Untitled project',level:p.level||'Beginner',
    domain:p.domain||p.category||p.subject||'Robotics & Engineering',
    description:p.description||p.short_description||p.project_description||'Explore this hands-on learning project.',
    image_url:p.image_url||p.thumbnail_url||p.cover_image||p.banner_url||null,
    video_url:p.video_url||p.youtube_url||p.project_video_url||null,
    mentor_name:p.mentor_name||p.instructor_name||null,
    journey_started:!!journey,current_stage:journey?.current_stage||null
   };
  });
  return res.status(200).json({success:true,student:{name:profile.full_name||user.email||'Student'},membership:{plan:membership.plan_name,membership_id:membership.membership_id},projects:eligible,journeys_used:(journeys||[]).filter(j=>j.created_at&&new Date(j.created_at)>=new Date(new Date().getFullYear(),new Date().getMonth(),1)).length});
 }catch(e){console.error('Student project catalogue error:',e.message);return res.status(500).json({error:'We could not load the project catalogue. Please refresh or log in again.'});}
};