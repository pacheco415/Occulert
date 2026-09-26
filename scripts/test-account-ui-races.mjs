import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => readFileSync(new URL(`../${name}.v60.js`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const session = id => ({ access_token: 'access-' + id, refresh_token: 'refresh-' + id, expires_at: Math.floor(Date.now()/1000)+3600, user: { id, email: id+'@example.com' } });
function element(id) {
  const classes = new Set(['securityForms','createCard','inviteCard','listCard','inviteLinkBox','passkeySetup'].includes(id)?['hidden']:[]), listeners = new Map();
  return { id,value:'',textContent:'',innerHTML:'',href:'#',disabled:false,dataset:{},className:'',
    classList:{ add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,force){if(force===undefined?!classes.has(name):force)classes.add(name);else classes.delete(name)} },
    setAttribute(k,v){this[k]=String(v)},getAttribute(){return 'dark'},addEventListener(name,fn){listeners.set(name,fn)},dispatch(name,event={}){listeners.get(name)?.(event)},focus(){},select(){},listeners,
  };
}
async function boot(page='account-page-2', initial='A') {
  const store = new Map(), elements = new Map(), listeners = new Map(), calls = [], timers=[];
  const hooks = { fetch:null, passkeys:null }, el = id => {if(!elements.has(id))elements.set(id,element(id));return elements.get(id)};
  store.set('occulert-auth',JSON.stringify(session(initial)));store.set('occulert-profile',JSON.stringify({uid:initial,driverId:initial,name:'Private '+initial,email:initial+'@example.com',company:'Company '+initial,role:'driver',authenticated:true}));
  const context = { console,URL,URLSearchParams,Response,AbortController,setTimeout(fn,ms){const timer=setTimeout(fn,ms);timers.push(timer);return timer},clearTimeout,
    document:{documentElement:element('html'),getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},hidden:false},
    location:{origin:'https://www.occulert.com',pathname:'/account.html',search:'',hash:''},history:{replaceState(){}},matchMedia:()=>({matches:false}),isSecureContext:true,
    navigator:{platform:'fixture',userAgent:'fixture',credentials:{},clipboard:{async writeText(value){calls.push({action:'copy',value})}}},
    confirm:()=>true,prompt:()=> 'new name',
    localStorage:{ get length(){return store.size},key:i=>[...store.keys()][i],getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn)},
    fetch(url,options={}){
      const call={url:String(url),options};calls.push(call);
      if(url==='/api/public-config')return new Response(JSON.stringify({supabase:{configured:true,url:'https://example.supabase.co',anonKey:'fixture-public'}}));
      if(hooks.fetch){const result=hooks.fetch(call);if(result)return result}
      const owner=String(options.headers?.Authorization||'').replace('Bearer access-','');
      let body={ok:true};
      if(url==='/api/fleets')body={ok:true,fleet:{id:'fleet-'+owner,company_name:'Fleet '+owner}};
      if(url==='/api/fleet-invitations'&&(!options.method||options.method==='GET'))body={ok:true,invitations:[{id:'11111111-1111-4111-8111-111111111111',email:'Private-'+owner+'@example.com',created_at:'2026-01-01',expires_at:'2099-01-01'}]};
      if(url==='/api/fleet-invitations'&&options.method==='POST')body={ok:true,invitation:{id:'fixture',email:'new-'+owner+'@example.com',accept_path:'/accept-invite.html#token=secret-'+owner}};
      return new Response(JSON.stringify(body));
    },
  };
  context.window=context;vm.createContext(context);vm.runInContext(source('occulert-backend'),context);vm.runInContext(source('auth-helper'),context);
  context.OcculertPasskeys={isSupported:()=>true,message:()=> 'mapped',canRetry:()=>false,async list(){const owner=context.OcculertBackend.currentUser()?.id;calls.push({action:'list-passkeys',owner});return hooks.passkeys?hooks.passkeys(owner):[{id:'11111111-1111-4111-8111-111111111111',friendly_name:'Private key '+owner}]},async register(){calls.push({action:'register'})},async remove(){calls.push({action:'remove'})},async rename(){calls.push({action:'rename'})},async retry(){calls.push({action:'retry'})},async signOutLocal(){}};
  vm.runInContext(source(page),context,{filename:page+'.v60.js'});await tick();await tick();
  return {context,backend:context.OcculertBackend,store,calls,hooks,el,cleanup(){timers.forEach(clearTimeout)},switchTo(id,event=true){if(id)store.set('occulert-auth',JSON.stringify(session(id)));else store.delete('occulert-auth');if(event)for(const fn of listeners.get('storage')||[])fn({key:'occulert-auth'})},storageEvent(key='occulert-auth'){for(const fn of listeners.get('storage')||[])fn({key})}};
}
const preventDefault=()=>{};

for(const next of ['B',null]) test(`Account clears A identity, credentials and passkeys immediately on ${next||'signout'} storage event with hung verification`,async()=>{
  const b=await boot();try{
    assert.match(b.el('securityIntro').textContent,/A@example/);assert.match(b.el('passkeyList').innerHTML,/Private key A/);
    b.el('newPassword').value='private-password';b.el('deleteConfirmation').value='DELETE';
    b.backend.getSession=()=>new Promise(()=>{});b.switchTo(next);
    assert.doesNotMatch(b.el('profileBox').innerHTML,/Private A|A@example/);assert.doesNotMatch(b.el('securityIntro').textContent,/A@example/);assert.doesNotMatch(b.el('passkeyList').innerHTML,/Private key A/);
    for(const id of ['newEmail','newPassword','deleteConfirmation','name','company'])assert.equal(b.el(id).value,'');
    assert.equal(b.el('securityForms').classList.contains('hidden'),true);assert.equal(b.el('deleteAccountBtn').disabled,true);
  }finally{b.cleanup()}
});

for(const method of ['changeEmail','changePassword','deleteAccount','registerPasskey','renamePasskey','removePasskey'])test(`Account ${method} preflight rejects B without a storage event while A is displayed`,async()=>{
  const b=await boot();try{
    b.el('newEmail').value='A@example.com';b.el('newPassword').value='private-password';b.el('deleteConfirmation').value='DELETE';
    b.calls.length=0;b.backend.getSession=()=>new Promise(()=>{});b.switchTo('B',false);
    await b.context[method](method.includes('Passkey')?'11111111-1111-4111-8111-111111111111':{preventDefault});
    assert.equal(b.calls.length,0);assert.equal(b.el('newEmail').value,'');assert.equal(b.el('newPassword').value,'');assert.doesNotMatch(b.el('profileBox').innerHTML,/Private A/);
  }finally{b.cleanup()}
});

test('Account discards late A passkey list and safely rebuilds B without borrowing A profile',async()=>{
  const b=await boot();try{
    const pending=deferred();b.hooks.passkeys=()=>pending.promise;const old=b.context.loadPasskeys();await tick();b.hooks.passkeys=null;b.switchTo('B');await tick();await tick();
    pending.resolve([{id:'11111111-1111-4111-8111-111111111111',friendly_name:'old secret A'}]);await old;
    assert.match(b.el('securityIntro').textContent,/B@example/);assert.equal(b.el('newEmail').value,'B@example.com');assert.doesNotMatch(b.el('profileBox').innerHTML,/Private A|Company A/);assert.doesNotMatch(b.el('passkeyList').innerHTML,/old secret A|Private key A/);
  }finally{b.cleanup()}
});

test('Late A deletion cannot sign out B, wipe B storage, show success or redirect',async()=>{
  const b=await boot();try{
    const pending=deferred();b.backend.deleteAccount=()=>pending.promise;b.el('deleteConfirmation').value='DELETE';const old=b.context.deleteAccount({preventDefault});await tick();b.switchTo('B');await tick();
    b.store.set('occulert-session-history','B-private-history');pending.resolve({ok:true});await old;
    assert.equal(b.backend.currentUser().id,'B');assert.equal(b.store.get('occulert-session-history'),'B-private-history');assert.doesNotMatch(b.el('deleteStatus').textContent,/permanently deleted/);assert.notEqual(b.context.location.href,'/login.html');
  }finally{b.cleanup()}
});

for(const next of ['B',null])test(`Fleet setup immediately clears A invitations, bearer link and mailto on ${next||'signout'}`,async()=>{
  const b=await boot('fleet-onboarding-page-1');try{
    await b.context.createInvite({preventDefault});assert.match(b.el('inviteLink').value,/secret-A/);assert.match(b.el('inviteList').innerHTML,/Private-A/);
    b.backend.getSession=()=>new Promise(()=>{});b.switchTo(next);
    assert.equal(b.el('inviteLink').value,'');assert.equal(b.el('emailInvite').href,'#');assert.equal(b.el('inviteList').innerHTML,'');assert.equal(b.el('driverEmail').value,'');assert.doesNotMatch(b.el('pageStatus').textContent,/Fleet A/);
    assert.equal(b.el('inviteCard').classList.contains('hidden'),true);assert.equal(b.el('listCard').classList.contains('hidden'),true);
  }finally{b.cleanup()}
});

for(const method of ['createFleet','createInvite','resendInvite','revokeInvite','copyInvite'])test(`Fleet ${method} preflight sends no B action from a stale A view without event`,async()=>{
  const b=await boot('fleet-onboarding-page-1');try{
    b.el('driverEmail').value='A-private@example.com';b.el('inviteLink').value='https://www.occulert.com/#secret-A';b.calls.length=0;b.backend.getSession=()=>new Promise(()=>{});b.switchTo('B',false);
    await b.context[method](method==='resendInvite'||method==='revokeInvite'?'11111111-1111-4111-8111-111111111111':{preventDefault});assert.equal(b.calls.length,0);assert.equal(b.el('inviteLink').value,'');assert.equal(b.el('emailInvite').href,'#');
  }finally{b.cleanup()}
});

test('Fleet ignores old create/link/list results after B verification and rebuilds only B data',async()=>{
  const b=await boot('fleet-onboarding-page-1');try{
    const pending=deferred();b.backend.createFleetInvitation=()=>pending.promise;const old=b.context.createInvite({preventDefault});await tick();b.switchTo('B');await tick();await tick();
    pending.resolve({ok:true,body:{invitation:{email:'old-private-A@example.com',accept_path:'/accept-invite.html#token=old-secret-A'}}});await old;
    assert.match(b.el('fleetName').textContent,/Fleet B/);assert.match(b.el('inviteList').innerHTML,/Private-B/);assert.doesNotMatch(b.el('inviteList').innerHTML,/Private-A/);assert.equal(b.el('inviteLink').value,'');assert.equal(b.el('emailInvite').href,'#');
  }finally{b.cleanup()}
});

for(const next of ['B',null])test(`Login clears A profile and enrollment immediately on ${next||'signout'} with hung verification`,async()=>{
  const b=await boot('login-page-1');try{
    assert.match(b.el('profileBox').innerHTML,/A@example/);b.context.openPasskeySetup();b.el('password').value='A-password';
    b.backend.getSession=()=>new Promise(()=>{});b.switchTo(next);
    assert.doesNotMatch(b.el('profileBox').innerHTML,/Private A|A@example|Company A/);assert.equal(b.el('profileActions').innerHTML,'');assert.equal(b.el('passkeySetupEmail').textContent,'');assert.equal(b.el('password').value,'');assert.equal(b.el('passkeySetup').classList.contains('hidden'),true);assert.equal(b.el('createPasskeyBtn').disabled,true);
  }finally{b.cleanup()}
});

test('Login late profile sync cannot save A profile after B and B view uses B identity',async()=>{
  const b=await boot('login-page-1');try{
    const pending=deferred();b.backend.ensureDriverProfile=()=>pending.promise;const old=b.context.retryProfileSync();await tick();b.switchTo('B');await tick();await tick();
    b.store.set('occulert-profile',JSON.stringify({uid:'B',name:'B profile'}));pending.resolve({ok:true});await old;
    assert.equal(JSON.parse(b.store.get('occulert-profile')).uid,'B');assert.match(b.el('profileBox').innerHTML,/B@example/);assert.doesNotMatch(b.el('profileBox').innerHTML,/Private A|Company A/);
  }finally{b.cleanup()}
});

test('Login rejects pending password success and enrollment action after account switch',async()=>{
  const b=await boot('login-page-1');try{
    const pending=deferred();b.context.OcculertAuth.signInEmail=()=>pending.promise;b.el('email').value='A@example.com';b.el('password').value='fixture-password';
    const old=b.context.submitAuth({preventDefault});await tick();b.switchTo('B');await tick();pending.resolve({uid:'A',email:'A@example.com'});await old;
    assert.match(b.el('profileBox').innerHTML,/B@example/);assert.doesNotMatch(b.el('status').textContent,/Signed in\./);
    b.backend.getSession=()=>new Promise(()=>{});b.switchTo(null,false);b.calls.length=0;await b.context.createProfilePasskey();assert.equal(b.calls.length,0);
  }finally{b.cleanup()}
});

test('modal confirmation and prompt cannot submit for B after A was displayed',async()=>{
  for(const method of ['deleteAccount','removePasskey','renamePasskey']){
    const b=await boot();try{
      b.el('deleteConfirmation').value='DELETE';b.calls.length=0;b.backend.getSession=()=>new Promise(()=>{});
      b.context.confirm=()=>{b.switchTo('B',false);return true};b.context.prompt=()=>{b.switchTo('B',false);return 'rename'};
      await b.context[method](method==='deleteAccount'?{preventDefault}:'11111111-1111-4111-8111-111111111111');
      assert.equal(b.calls.length,0);assert.equal(b.el('securityForms').classList.contains('hidden'),true);
    }finally{b.cleanup()}
  }
});

for(const page of ['account-page-2','fleet-onboarding-page-1','login-page-1'])test(`${page} same-owner new tokens invalidate stale view and late results`,async()=>{
  const b=await boot(page);try{
    const pending=deferred();b.backend.getSession=()=>pending.promise;
    const rotated={...session('A'),access_token:'rotated-A',refresh_token:'rotated-refresh-A'};b.store.set('occulert-auth',JSON.stringify(rotated));b.storageEvent();
    const privateNode=page==='account-page-2'?'profileBox':page==='login-page-1'?'profileBox':'inviteList';assert.doesNotMatch(b.el(privateNode).innerHTML,/Private A|Private-A|A@example/);
    pending.resolve(rotated);await tick();await tick();
    if(page==='account-page-2')assert.match(b.el('securityIntro').textContent,/A@example/);
    else if(page==='login-page-1')assert.match(b.el('profileBox').innerHTML,/A@example/);
    else assert.match(b.el('fleetName').textContent,/Fleet/);
  }finally{b.cleanup()}
});

test('legitimate credential request that refreshes tokens re-verifies and restores usable controls',async()=>{
  const b=await boot();try{
    b.backend.updatePassword=async()=>{b.backend.adoptSession({...session('A'),access_token:'refreshed-A'});return {ok:true}};
    b.el('newPassword').value='fixture-password';await b.context.changePassword({preventDefault});await tick();await tick();
    assert.equal(b.el('newPassword').value,'');assert.equal(b.el('passwordBtn').disabled,false);assert.match(b.el('securityIntro').textContent,/A@example/);
  }finally{b.cleanup()}
});
