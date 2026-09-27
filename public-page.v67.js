// Public pages use document links; reserve section highlighting for hash links.
function updateActiveNav(){
  const currentPath=window.location.pathname==='/'?'/index.html':window.location.pathname;
  document.querySelectorAll('.nav-links a,.mobile-menu a').forEach(link=>{
    const href=link.getAttribute('href');
    const active=href===currentPath;
    link.classList.toggle('nav-active',active);
    if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
}
updateActiveNav();
function getTheme(){
  try{const saved=localStorage.getItem('occulert-theme');if(saved==='light'||saved==='dark')return saved}catch(error){}
  try{return window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(error){return 'dark'}
}
function setTheme(t){document.documentElement.setAttribute('data-theme',t);try{localStorage.setItem('occulert-theme',t);}catch(error){}const icon=t==='light'?'☀️':'🌙';const themeButton=document.getElementById('themeToggle');if(themeButton)themeButton.textContent=icon;const mob=document.getElementById('themeToggleMobile');if(mob)mob.textContent=icon+(t==='light'?' Light Mode':' Dark Mode');document.querySelector('meta[name="theme-color"]')?.setAttribute('content',t==='light'?'#f0f4f8':'#0a0e1a')}
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
if(scrollTopBtn){
  window.addEventListener('scroll',()=>{scrollTopBtn.classList.toggle('visible',window.scrollY>400)},{passive:true});
  scrollTopBtn.addEventListener('click',()=>{
    const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({top:0,behavior:reduceMotion?'auto':'smooth'});
    document.querySelector('main')?.focus({preventScroll:true});
  });
}
function setFaqOpen(item,open){
  const button=item.querySelector('.faq-q'),answer=item.querySelector('.faq-a');
  if(!button||!answer)return;
  item.classList.toggle('open',open);
  button.setAttribute('aria-expanded',String(open));
  answer.hidden=!open;
}
document.querySelectorAll('.faq-item').forEach((item,index)=>{
  const button=item.querySelector('.faq-q'),answer=item.querySelector('.faq-a');
  if(!button||!answer)return;
  button.id=button.id||`faq-question-${index+1}`;
  answer.id=answer.id||`faq-answer-${index+1}`;
  button.setAttribute('aria-controls',answer.id);
  answer.setAttribute('role','region');
  answer.setAttribute('aria-labelledby',button.id);
  setFaqOpen(item,false);
  button.addEventListener('click',()=>{
    const open=button.getAttribute('aria-expanded')!=='true';
    document.querySelectorAll('.faq-item').forEach(other=>setFaqOpen(other,false));
    setFaqOpen(item,open);
  });
});
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
