function getTheme(){
  try{const saved=localStorage.getItem('occulert-theme');if(saved==='light'||saved==='dark')return saved}catch(error){}
  try{return window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(error){return 'dark'}
}
function setTheme(theme){
  document.documentElement.setAttribute('data-theme',theme);
  try{localStorage.setItem('occulert-theme',theme);}catch(error){}
  const button=document.getElementById('themeToggle');
  if(button){
    const nextTheme=theme==='light'?'dark':'light';
    button.textContent=theme==='light'?'☀️':'🌙';
    button.setAttribute('aria-label',`Use ${nextTheme} theme`);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#f0f4f8':'#0a0e1a');
}
function toggleTheme(){setTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light')}
if(document.getElementById('themeToggle')){
  setTheme(getTheme());
  document.getElementById('themeToggle').addEventListener('click',toggleTheme);
}
document.querySelectorAll('.skip-link[href^="#"]').forEach(link=>link.addEventListener('click',event=>{
  const target=document.querySelector(link.getAttribute('href'));
  if(!target)return;
  event.preventDefault();
  requestAnimationFrame(()=>{
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'start'});
  });
}));
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
