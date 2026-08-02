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
if(menuBtn&&mobileMenu){menuBtn.addEventListener('click',()=>{const open=mobileMenu.classList.toggle('open');menuBtn.classList.toggle('open',open)});mobileMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{mobileMenu.classList.remove('open');menuBtn.classList.remove('open')}))}
const scrollTopBtn=document.getElementById('scrollTop');
window.addEventListener('scroll',()=>{scrollTopBtn.classList.toggle('visible',window.scrollY>400)});
scrollTopBtn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
document.querySelectorAll('.faq-q').forEach(btn=>{btn.addEventListener('click',()=>{const item=btn.parentElement;const wasOpen=item.classList.contains('open');document.querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'));if(!wasOpen)item.classList.add('open')})});
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
