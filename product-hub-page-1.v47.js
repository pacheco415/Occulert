function getTheme(){return localStorage.getItem('occulert-theme')||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}
function setTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('occulert-theme',t);const btn=document.getElementById('themeToggle');if(btn)btn.textContent=t==='light'?'☀️':'🌙';document.querySelector('meta[name="theme-color"]')?.setAttribute('content',t==='light'?'#f0f4f8':'#0a0e1a')}
function toggleTheme(){setTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light')}
setTheme(getTheme());
document.getElementById('themeToggle')?.addEventListener('click',toggleTheme);
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
