// Active nav highlighting
function updateActiveNav(){
  const sections=['features','how-it-works','install','about','faq'];
  const scrollY=window.scrollY+120;
  let active='';
  sections.forEach(id=>{
    const el=document.getElementById(id);
    if(el&&scrollY>=el.offsetTop)active=id;
  });
  document.querySelectorAll('.nav-links a').forEach(a=>{
    const href=a.getAttribute('href');
    a.classList.toggle('nav-active',href==='#'+active);
  });
}
window.addEventListener('scroll',updateActiveNav,{passive:true});
updateActiveNav();
function getTheme(){return localStorage.getItem('occulert-theme')||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}
function setTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('occulert-theme',t);const icon=t==='light'?'☀️':'🌙';document.getElementById('themeToggle').textContent=icon;const mob=document.getElementById('themeToggleMobile');if(mob)mob.textContent=icon+(t==='light'?' Light Mode':' Dark Mode');document.querySelector('meta[name="theme-color"]')?.setAttribute('content',t==='light'?'#f0f4f8':'#0a0e1a')}
function toggleTheme(){setTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light')}
setTheme(getTheme());
document.getElementById('themeToggle')?.addEventListener('click',toggleTheme);
document.getElementById('themeToggleMobile')?.addEventListener('click',()=>{toggleTheme();mobileMenu.classList.remove('open');menuBtn.classList.remove('open')});
const menuBtn=document.getElementById('menuBtn'),mobileMenu=document.getElementById('mobileMenu');
const siteNav=document.getElementById('siteNav');
if(menuBtn&&mobileMenu){menuBtn.addEventListener('click',()=>{const open=mobileMenu.classList.toggle('open');menuBtn.classList.toggle('open',open);siteNav?.classList.remove('nav-hidden')});mobileMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{mobileMenu.classList.remove('open');menuBtn.classList.remove('open')}))}
if(siteNav){
  let previousScrollY=window.scrollY;
  let navFramePending=false;
  function updateNavVisibility(){
    const nextScrollY=window.scrollY;
    const movingDown=nextScrollY>previousScrollY+4;
    const movingUp=nextScrollY<previousScrollY-4;
    const keepVisible=nextScrollY<96||movingUp||mobileMenu?.classList.contains('open')||siteNav.matches(':focus-within');
    if(keepVisible)siteNav.classList.remove('nav-hidden');
    else if(movingDown)siteNav.classList.add('nav-hidden');
    previousScrollY=nextScrollY;
    navFramePending=false;
  }
  window.addEventListener('scroll',()=>{
    if(navFramePending)return;
    navFramePending=true;
    window.requestAnimationFrame(updateNavVisibility);
  },{passive:true});
}
const scrollTopBtn=document.getElementById('scrollTop');
function updateScrollTopVisibility(){
  const journey=document.getElementById('safetyJourney');
  const journeyBottom=journey?journey.offsetTop+journey.offsetHeight:520;
  scrollTopBtn.classList.toggle('visible',window.scrollY>Math.max(520,journeyBottom-120));
}
window.addEventListener('scroll',updateScrollTopVisibility,{passive:true});
updateScrollTopVisibility();
scrollTopBtn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
document.querySelectorAll('.faq-q').forEach(btn=>{btn.addEventListener('click',()=>{const item=btn.parentElement;const wasOpen=item.classList.contains('open');document.querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'));if(!wasOpen)item.classList.add('open')})});

const safetyJourney=document.getElementById('safetyJourney');
if(safetyJourney){
  const journeyButtons=[...safetyJourney.querySelectorAll('[data-journey-step]')];
  const journeyCopies=[...safetyJourney.querySelectorAll('[data-journey-copy]')];
  const journeyMotion=document.getElementById('journeyMotion');
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let journeyStage=0;
  let journeyPaused=reduceMotion.matches;
  let journeyTimer=null;

  function selectJourneyStage(next,{focus=false,restart=false}={}){
    journeyStage=(Number(next)+journeyButtons.length)%journeyButtons.length;
    safetyJourney.dataset.stage=String(journeyStage);
    journeyButtons.forEach((button,index)=>{
      const active=index===journeyStage;
      button.setAttribute('aria-selected',String(active));
      button.tabIndex=active?0:-1;
      if(active&&focus)button.focus();
    });
    journeyCopies.forEach((copy,index)=>{
      const active=index===journeyStage;
      copy.hidden=!active;
      copy.classList.toggle('is-active',active);
    });
    if(restart&&!journeyPaused)startJourneyTimer();
  }

  function startJourneyTimer(){
    window.clearInterval(journeyTimer);
    journeyTimer=journeyPaused?null:window.setInterval(()=>selectJourneyStage(journeyStage+1),5200);
  }

  function renderJourneyMotion(){
    journeyMotion.textContent=journeyPaused?'Play motion':'Pause motion';
    journeyMotion.setAttribute('aria-pressed',String(journeyPaused));
  }

  journeyButtons.forEach((button,index)=>{
    button.addEventListener('click',()=>selectJourneyStage(index,{restart:true}));
    button.addEventListener('keydown',event=>{
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
      event.preventDefault();
      selectJourneyStage(journeyStage+(event.key==='ArrowRight'?1:-1),{focus:true,restart:true});
    });
  });
  journeyMotion.addEventListener('click',()=>{
    journeyPaused=!journeyPaused;
    renderJourneyMotion();
    startJourneyTimer();
  });
  safetyJourney.addEventListener('pointermove',event=>{
    if(reduceMotion.matches||event.pointerType==='touch')return;
    const box=safetyJourney.getBoundingClientRect();
    safetyJourney.style.setProperty('--journey-tilt-y',`${((event.clientX-box.left)/box.width-.5)*5}deg`);
    safetyJourney.style.setProperty('--journey-tilt-x',`${(2-((event.clientY-box.top)/box.height-.5)*4)}deg`);
  });
  safetyJourney.addEventListener('pointerleave',()=>{
    safetyJourney.style.removeProperty('--journey-tilt-x');
    safetyJourney.style.removeProperty('--journey-tilt-y');
  });
  reduceMotion.addEventListener?.('change',event=>{
    if(event.matches){journeyPaused=true;renderJourneyMotion();startJourneyTimer()}
  });
  renderJourneyMotion();
  selectJourneyStage(0);
  startJourneyTimer();
}
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
