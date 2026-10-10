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
const menuBtn=document.getElementById('menuBtn'),mobileMenu=document.getElementById('mobileMenu');
function setMobileMenu(open,{restoreFocus=false}={}){
  if(!menuBtn||!mobileMenu)return;
  mobileMenu.classList.toggle('open',open);
  mobileMenu.setAttribute('aria-hidden',String(!open));
  menuBtn.classList.toggle('open',open);
  menuBtn.setAttribute('aria-expanded',String(open));
  menuBtn.setAttribute('aria-label',open?'Close menu':'Open menu');
  if(restoreFocus)menuBtn.focus();
}
document.getElementById('themeToggleMobile')?.addEventListener('click',()=>{toggleTheme();setMobileMenu(false)});
if(menuBtn&&mobileMenu){
  menuBtn.addEventListener('click',()=>setMobileMenu(!mobileMenu.classList.contains('open')));
  mobileMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setMobileMenu(false)));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&mobileMenu.classList.contains('open'))setMobileMenu(false,{restoreFocus:true});
  });
  document.addEventListener('pointerdown',event=>{
    if(!mobileMenu.classList.contains('open')||menuBtn.contains(event.target)||mobileMenu.contains(event.target))return;
    setMobileMenu(false);
  });
}
const scrollTopBtn=document.getElementById('scrollTop');
window.addEventListener('scroll',()=>{scrollTopBtn.classList.toggle('visible',window.scrollY>400)});
scrollTopBtn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
document.querySelectorAll('.faq-q').forEach(btn=>{
  btn.setAttribute('aria-expanded','false');
  btn.addEventListener('click',()=>{
    const item=btn.parentElement;
    const wasOpen=item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(other=>{
      other.classList.remove('open');
      other.querySelector('.faq-q')?.setAttribute('aria-expanded','false');
    });
    if(!wasOpen){item.classList.add('open');btn.setAttribute('aria-expanded','true')}
  });
});
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
