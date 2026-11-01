(() => {
  function openMentor(){
    const panel=document.getElementById('mentorLogin');
    if(panel){panel.classList.add('show');location.hash='mentorLogin';return;}
    location.hash='mentorLogin';
  }
  document.addEventListener('click',e=>{
    const a=e.target.closest('a[href="#mentorLogin"]');
    if(a){e.preventDefault();openMentor();}
  });
  window.addEventListener('hashchange',()=>{if(location.hash==='#mentorLogin'){const p=document.getElementById('mentorLogin');if(p)p.classList.add('show');}});
  if(location.hash==='#mentorLogin') setTimeout(openMentor,0);
})();