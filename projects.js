(() => {
  const SUPABASE_URL='https://ymndslqkhuubgoxxkuei.supabase.co';
  const SUPABASE_KEY='sb_publishable_u9d-jX_yxaofcUIw1Ou6lg__GaE3sPa';
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  async function load(){
    const grid=document.querySelector('.projects');
    if(!grid) return;
    grid.innerHTML='<div class="projectItem" style="grid-column:1/-1"><h3>Loading live RoboSprints projects…</h3><p>Fetching projects created by mentors.</p></div>';
    try{
      const r=await fetch(SUPABASE_URL+'/rest/v1/projects?select=*&status=eq.published&order=created_at.desc',{
        headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,Accept:'application/json'},
        cache:'no-store'
      });
      if(!r.ok) throw new Error('Database returned '+r.status);
      const projects=await r.json();
      window.roboSprintsProjects=Array.isArray(projects)?projects:[];
      if(!window.roboSprintsProjects.length){
        grid.innerHTML='<div class="projectItem" style="grid-column:1/-1"><h3>No live projects available yet</h3><p>Mentor-created projects will appear here automatically.</p></div>';
        return;
      }
      grid.innerHTML=window.roboSprintsProjects.map((p,i)=>'<article class="project '+(i===0?'main':i%2?'iot':'code')+'" data-live-project="'+esc(p.id)+'" style="cursor:pointer"><div class="emoji">'+(i===0?'🤖':i%2?'📡':'⚡')+'</div><span class="badge">'+esc((p.level||'PROJECT').toUpperCase())+'</span><h3>'+esc(p.title)+'</h3><p>'+esc(p.intro||'Explore this RoboSprints project.')+'</p><div class="arrow">VIEW PROJECT →</div></article>').join('');
      grid.querySelectorAll('[data-live-project]').forEach(el=>el.addEventListener('click',()=>open(el.dataset.liveProject)));
    }catch(e){
      console.error('RoboSprints project loading failed',e);
      grid.innerHTML='<div class="projectItem" style="grid-column:1/-1"><h3>Unable to load live projects</h3><p>Please refresh and try again.</p><button id="retryProjects">Try again</button></div>';
      const b=document.getElementById('retryProjects'); if(b)b.onclick=load;
    }
  }
  function open(id){
    const p=(window.roboSprintsProjects||[]).find(x=>String(x.id)===String(id));
    if(!p) return;
    if(typeof window.openDynamicProject==='function'){ window.cachedProjects=window.roboSprintsProjects; window.openDynamicProject(id); return; }
    const modal=document.getElementById('projectModal');
    if(modal){ modal.classList.add('show'); const h=modal.querySelector('h2'); if(h)h.textContent=p.title; }
  }
  window.loadRoboSprintsProjects=load;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load);
  else load();
})();