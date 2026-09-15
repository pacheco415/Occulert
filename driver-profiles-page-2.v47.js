function get(){try{return JSON.parse(localStorage.getItem('occulert-drivers')||'[]')}catch(e){return[]}}
function set(v){localStorage.setItem('occulert-drivers',JSON.stringify(v))}
function initials(n){return(n||'D').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function render(){let d=get();document.getElementById('drivers').innerHTML=d.length?d.map((x,i)=>`<div class="driver"><div class="avatar">${esc(initials(x.name))}</div><div><strong>${esc(x.name)}</strong><br><span class="muted">${esc(x.route||'No route set')}</span></div><div><span class="pill ${x.status==='Inactive'?'danger':''}">${esc(x.status)}</span><br><button class="btn" style="margin-top:8px;padding:6px 9px" onclick="removeDriver(${i})">Remove</button></div></div>`).join(''):'<p class="muted">No drivers yet.</p>'}
function addDriver(){let name=document.getElementById('name').value.trim();if(!name)return alert('Add a driver name');let route=document.getElementById('route').value.trim(),status=document.getElementById('status').value,d=get();d.unshift({id:'DRV-'+Date.now(),name,route,status,createdAt:new Date().toISOString()});set(d);document.getElementById('name').value='';document.getElementById('route').value='';render()}
function removeDriver(i){let d=get();d.splice(i,1);set(d);render()}
function seedDrivers(){set([{id:'DRV-1',name:'Marcus T.',route:'North Bay Delivery Route',status:'Active'},{id:'DRV-2',name:'Jordan M.',route:'Bay Bridge Eastbound',status:'Active'},{id:'DRV-3',name:'Alicia S.',route:'Oakland Delivery Loop',status:'Training'}]);render()}
render();
