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
async function boot(page='account-page-2', initial='A', options={}) {
  const store = new Map(), elements = new Map(), listeners = new Map(), documentListeners = new Map(), calls = [], timers=[];
  const hooks = { fetch:null, passkeys:null, otp:null }, el = id => {if(!elements.has(id))elements.set(id,element(id));return elements.get(id)};
  if(initial){store.set('occulert-auth',JSON.stringify(session(initial)));store.set('occulert-profile',JSON.stringify({uid:initial,driverId:initial,name:'Private '+initial,email:initial+'@example.com',company:'Company '+initial,role:'driver',authenticated:true}));}
  const context = { console,URL,URLSearchParams,Response,AbortController,setTimeout(fn,ms){const timer=setTimeout(fn,ms);timers.push(timer);return timer},clearTimeout,
    document:{documentElement:element('html'),getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(name,fn){if(!documentListeners.has(name))documentListeners.set(name,[]);documentListeners.get(name).push(fn)},hidden:false},
    location:{origin:'https://www.occulert.com',pathname:'/account.html',search:'',hash:''},history:{replaceState(){}},matchMedia:()=>({matches:false}),isSecureContext:true,
    navigator:{platform:'fixture',userAgent:'fixture',credentials:{},clipboard:{async writeText(value){calls.push({action:'copy',value})}}},
    confirm:()=>true,prompt:()=> 'new name',
    localStorage:{ get length(){return store.size},key:i=>[...store.keys()][i],getItem(key){if(options.blockStorage||options.blockTheme&&key==='occulert-theme')throw new Error('fixture storage unavailable');return store.get(key)??null},setItem(key,value){if(options.blockStorage||options.blockTheme&&key==='occulert-theme')throw new Error('fixture storage unavailable');store.set(key,String(value))},removeItem:key=>store.delete(key)},
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
  const sdk={createClient(){return {auth:{async signInWithOtp(value){calls.push({action:'otp',value});return hooks.otp?hooks.otp(value):{error:null}}}}}};
  context.OcculertSupabaseLoader={load:async()=>sdk,retry:async()=>sdk};
  vm.runInContext(source('passwordless-auth'),context);
  context.OcculertPasskeys={isSupported:()=>true,message:()=> 'mapped',canRetry:()=>false,async list(){const owner=context.OcculertBackend.currentUser()?.id;calls.push({action:'list-passkeys',owner});return hooks.passkeys?hooks.passkeys(owner):[{id:'11111111-1111-4111-8111-111111111111',friendly_name:'Private key '+owner}]},async register(){calls.push({action:'register'})},async remove(){calls.push({action:'remove'})},async rename(){calls.push({action:'rename'})},async retry(){calls.push({action:'retry'})},async signOutLocal(){}};
  vm.runInContext(source(page),context,{filename:page+'.v60.js'});await tick();await tick();
  return {context,backend:context.OcculertBackend,store,calls,hooks,el,cleanup(){timers.forEach(clearTimeout)},switchTo(id,event=true){if(id)store.set('occulert-auth',JSON.stringify(session(id)));else store.delete('occulert-auth');if(event)for(const fn of listeners.get('storage')||[])fn({key:'occulert-auth'})},storageEvent(key='occulert-auth'){for(const fn of listeners.get('storage')||[])fn({key})},focusEvent(){for(const fn of listeners.get('focus')||[])fn()},visibilityEvent(){context.document.hidden=false;for(const fn of documentListeners.get('visibilitychange')||[])fn()}};
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

for(const mode of ['signup','email'])test(`failed ${mode} email request preserves inputs and actual auth context for the next submit`,async()=>{
  const b=await boot('login-page-1',null);try{
    b.context.showAuthMode(mode);b.el('email').value='new@example.com';b.el('name').value='New driver';b.el('company').value='New company';b.el('vehicle').value='New vehicle';
    let attempts=0;b.hooks.otp=()=>({error:++attempts===1?{status:500}:null});
    const before=b.backend.captureAuthContext();await b.context.submitAuth({preventDefault});
    assert.equal(attempts,1);assert.equal(b.backend.isAuthContextCurrent(before),false,'actual passwordless beginAuthAttempt advances revision');
    assert.match(b.el('status').textContent,/could not be sent/);assert.equal(b.el('email').value,'new@example.com');assert.equal(b.el('submitBtn').disabled,false);
    assert.equal(b.el('name').value,'New driver');assert.equal(b.el('company').value,'New company');assert.equal(b.el('vehicle').value,'New vehicle');
    await b.context.submitAuth({preventDefault});assert.equal(attempts,2);assert.match(b.el('status').textContent,/Check your email/);assert.equal(b.el('email').value,'new@example.com');
    const requests=b.calls.filter(call=>call.action==='otp');assert.equal(requests[1].value.email,'new@example.com');
    if(mode==='signup')assert.equal(requests[1].value.options.data.name,'New driver');
  }finally{b.cleanup()}
});

for(const change of ['account','same-owner-token','signout','storage-event'])test(`failed email request cannot rebind stale inputs after ${change}`,async()=>{
  const b=await boot('login-page-1');try{
    b.context.showAuthMode('email');b.el('email').value='private-A@example.com';const pending=deferred();b.hooks.otp=()=>pending.promise;
    const old=b.context.submitAuth({preventDefault});await tick();assert.equal(b.calls.filter(call=>call.action==='otp').length,1);
    b.backend.getSession=()=>new Promise(()=>{});
    if(change==='account')b.switchTo('B',false);
    else if(change==='same-owner-token')b.backend.adoptSession({...session('A'),access_token:'rotated-A',refresh_token:'rotated-refresh-A'});
    else if(change==='signout')b.backend.signOut();
    else b.switchTo('B');
    pending.resolve({error:{status:500}});await old;
    assert.equal(b.el('email').value,'');assert.doesNotMatch(b.el('status').textContent,/could not be sent|Check your email/);assert.equal(b.el('submitBtn').disabled,true);
    await b.context.submitAuth({preventDefault});assert.equal(b.calls.filter(call=>call.action==='otp').length,1,'no retry using stale inputs or owner');
  }finally{b.cleanup()}
});

for(const blockStorage of [false,true])test(`Account boots when ${blockStorage?'all storage':'optional theme storage'} throws without exposing unverifiable identity`,async()=>{
  const b=await boot('account-page-2','A',{blockTheme:true,blockStorage});try{
    assert.equal(typeof b.context.accountActionContext,'function');assert.doesNotThrow(()=>b.el('themeToggle').dispatch('click'));
    if(blockStorage){
      assert.equal(b.backend.currentUser(),null);assert.doesNotMatch(b.el('profileBox').innerHTML,/Private A|A@example/);assert.equal(b.el('securityForms').classList.contains('hidden'),true);assert.equal(b.el('deleteAccountBtn').disabled,true);
      b.calls.length=0;b.el('newPassword').value='fixture-password';await b.context.changePassword({preventDefault});assert.equal(b.calls.length,0);
    }else{
      assert.match(b.el('securityIntro').textContent,/A@example/);assert.equal(b.el('passwordBtn').disabled,false);assert.equal(b.el('newEmail').value,'A@example.com');
    }
  }finally{b.cleanup()}
});

test('failed password sign-in keeps credentials usable after the real backend advances its attempt revision',async()=>{
  const b=await boot('login-page-1',null);try{
    b.el('email').value='new@example.com';b.el('password').value='fixture-password';let attempts=0;
    b.hooks.fetch=call=>String(call.url).includes('/auth/v1/token')?(attempts++,new Response(JSON.stringify({error:'invalid_grant'}),{status:400})):null;
    await b.context.submitAuth({preventDefault});const error=b.el('status').textContent;assert.ok(error);assert.equal(b.el('email').value,'new@example.com');assert.equal(b.el('password').value,'fixture-password');
    await b.context.submitAuth({preventDefault});assert.equal(attempts,2);assert.equal(b.el('status').textContent,error);assert.equal(b.el('submitBtn').disabled,false);
  }finally{b.cleanup()}
});

test('failed passkey sign-in can retry after the actual helper starts a new auth attempt',async()=>{
  const b=await boot('login-page-1',null);try{
    b.el('email').value='new@example.com';b.el('password').value='fixture-password';let attempts=0;
    b.context.OcculertPasskeys.signIn=async attempt=>{attempts++;b.backend.requireAuthContext(attempt);throw new Error('fixture ceremony cancelled')};
    const before=b.backend.captureAuthContext();await b.context.signInPasskey(false);
    assert.equal(b.backend.isAuthContextCurrent(before),false);assert.equal(b.el('passkeyStatus').textContent,'mapped');assert.equal(b.el('email').value,'new@example.com');assert.equal(b.el('password').value,'fixture-password');
    await b.context.signInPasskey(false);assert.equal(attempts,2);assert.equal(b.el('passkeyStatus').textContent,'mapped');assert.equal(b.el('passkeySignInBtn').disabled,false);
  }finally{b.cleanup()}
});

for(const kind of ['password','email-link','passkey'])test(`old ${kind} failure cannot retain a separate newer auth intent with unchanged tokens`,async()=>{
  const b=await boot('login-page-1',null);try{
    b.el('email').value='old@example.com';b.el('password').value='fixture-password';const pending=deferred();
    if(kind==='password')b.hooks.fetch=call=>String(call.url).includes('/auth/v1/token')?pending.promise:null;
    if(kind==='email-link'){b.context.showAuthMode('email');b.hooks.otp=()=>pending.promise}
    if(kind==='passkey')b.context.OcculertPasskeys.signIn=async attempt=>{await pending.promise;b.backend.requireAuthContext(attempt);throw new Error('fixture cancellation')};
    const old=kind==='passkey'?b.context.signInPasskey(false):b.context.submitAuth({preventDefault});await tick();
    const external=b.backend.beginAuthAttempt();
    pending.resolve(kind==='password'?new Response(JSON.stringify({error:'invalid_grant'}),{status:400}):{error:{status:500}});await old;
    assert.equal(b.backend.isAuthContextCurrent(external),true,'old UI may not supersede or adopt the newer intent');
    assert.equal(vm.runInContext('loginContext',b.context),null);assert.equal(b.el('email').value,'');assert.equal(b.el('password').value,'');
    assert.equal(b.el('submitBtn').disabled,true);assert.equal(b.el('passkeySignInBtn').disabled,true);assert.doesNotMatch(b.el('status').textContent,/auth_session_changed|Signed in\.|Check your email/);
  }finally{b.cleanup()}
});

test('email-link success cannot rebind a separate newer auth intent without token changes',async()=>{
  const b=await boot('login-page-1',null);try{
    b.context.showAuthMode('email');b.el('email').value='old@example.com';const pending=deferred();b.hooks.otp=()=>pending.promise;
    const old=b.context.submitAuth({preventDefault});await tick();const external=b.backend.beginAuthAttempt();pending.resolve({error:null});await old;
    assert.equal(b.backend.isAuthContextCurrent(external),true);assert.equal(vm.runInContext('loginContext',b.context),null);assert.equal(b.el('email').value,'');assert.equal(b.el('submitBtn').disabled,true);assert.doesNotMatch(b.el('status').textContent,/Check your email/);
  }finally{b.cleanup()}
});

for(const[first,second]of[['password','password'],['password','passkey'],['passkey','password'],['passkey','passkey']])test(`synchronous pending guard prevents duplicate ${first} then ${second} entry`,async()=>{
  const b=await boot('login-page-1',null);try{
    b.el('email').value='new@example.com';b.el('password').value='fixture-password';const pending=deferred();let passwordCalls=0,passkeyCalls=0;
    b.hooks.fetch=call=>String(call.url).includes('/auth/v1/token')?(passwordCalls++,pending.promise):null;
    b.context.OcculertPasskeys.signIn=async attempt=>{passkeyCalls++;await pending.promise;b.backend.requireAuthContext(attempt);throw new Error('fixture cancellation')};
    const invoke=kind=>kind==='password'?b.context.submitAuth({preventDefault}):b.context.signInPasskey(false);
    const old=invoke(first),attempt=b.backend.captureAuthContext();await invoke(second);await tick();
    assert.equal(b.backend.isAuthContextCurrent(attempt),true);assert.equal(passwordCalls+passkeyCalls,1);assert.equal(b.el('email').value,'new@example.com');assert.equal(b.el('submitBtn').disabled,true);
    pending.resolve(first==='password'?new Response(JSON.stringify({error:'invalid_grant'}),{status:400}):null);await old;
    assert.equal(b.el('submitBtn').disabled,false);assert.equal(b.el('email').value,'new@example.com');assert.equal(passwordCalls+passkeyCalls,1);
  }finally{b.cleanup()}
});

test('old generation finally cannot release a newer pending login action',async()=>{
  const b=await boot('login-page-1',null);try{
    const oldResponse=deferred(),newResponse=deferred();let calls=0;b.hooks.fetch=call=>String(call.url).includes('/auth/v1/token')?(++calls===1?oldResponse:newResponse).promise:null;
    b.el('email').value='old@example.com';b.el('password').value='old-password';const old=b.context.submitAuth({preventDefault});await tick();
    b.switchTo(null);await tick();b.el('email').value='new@example.com';b.el('password').value='new-password';const fresh=b.context.submitAuth({preventDefault});await tick();
    const currentAction=vm.runInContext('loginPendingAction',b.context);oldResponse.resolve(new Response(JSON.stringify({error:'invalid_grant'}),{status:400}));await old;
    assert.equal(vm.runInContext('loginPendingAction',b.context),currentAction);assert.equal(b.el('email').value,'new@example.com');assert.equal(b.el('password').value,'new-password');assert.equal(b.el('submitBtn').disabled,true);assert.equal(b.el('status').textContent,'');
    newResponse.resolve(new Response(JSON.stringify({error:'invalid_grant'}),{status:400}));await fresh;assert.equal(b.el('submitBtn').disabled,false);assert.equal(b.el('email').value,'new@example.com');
  }finally{b.cleanup()}
});

for(const kind of ['password','passkey'])test(`healthy ${kind} helper adoption remains usable after its own successful revision change`,async()=>{
  const b=await boot('login-page-1',null);try{
    b.el('email').value='new@example.com';b.el('password').value='fixture-password';const verified={...session('new'),user:{...session('new').user,user_metadata:{name:'New driver'}}};
    b.hooks.fetch=call=>String(call.url).includes('/auth/v1/token')?new Response(JSON.stringify(verified)):null;
    b.context.OcculertPasskeys.signIn=async attempt=>{b.backend.adoptSession(verified,attempt);return verified.user};
    const before=b.backend.captureAuthContext();await(kind==='password'?b.context.submitAuth({preventDefault}):b.context.signInPasskey(false));
    assert.equal(b.backend.isAuthContextCurrent(before),false);assert.equal(b.backend.currentUser().id,'new');assert.match(b.el('profileBox').innerHTML,/new@example/);assert.equal(b.el('submitBtn').disabled,false);assert.equal(b.el('passkeySignInBtn').disabled,false);
    assert.match(b.el(kind==='password'?'status':'passkeyStatus').textContent,/Signed in/);
  }finally{b.cleanup()}
});

for(const kind of ['password','email-link','passkey'])test(`focus and visibility preserve the page's exact pending ${kind} attempt and healthy completion`,async()=>{
  const b=await boot('login-page-1',null);try{
    b.el('email').value='new@example.com';b.el('password').value='fixture-password';const pending=deferred(),verified=session('new');
    if(kind==='password')b.hooks.fetch=call=>String(call.url).includes('/auth/v1/token')?pending.promise:null;
    if(kind==='email-link'){b.context.showAuthMode('email');b.hooks.otp=()=>pending.promise}
    if(kind==='passkey')b.context.OcculertPasskeys.signIn=async attempt=>{await pending.promise;b.backend.adoptSession(verified,attempt);return verified.user};
    const old=kind==='passkey'?b.context.signInPasskey(false):b.context.submitAuth({preventDefault});await tick();
    const action=vm.runInContext('loginPendingAction',b.context),attempt=b.backend.captureAuthContext();b.focusEvent();b.visibilityEvent();await tick();
    assert.equal(vm.runInContext('loginPendingAction',b.context),action);assert.equal(b.backend.isAuthContextCurrent(attempt),true);assert.equal(b.el('email').value,'new@example.com');assert.equal(b.el('password').value,'fixture-password');assert.equal(b.el('submitBtn').disabled,true);
    pending.resolve(kind==='password'?new Response(JSON.stringify(verified)):{error:null});await old;
    assert.equal(b.el('submitBtn').disabled,false);
    if(kind==='email-link')assert.match(b.el('status').textContent,/Check your email/);
    else{assert.equal(b.backend.currentUser().id,'new');assert.match(b.el(kind==='password'?'status':'passkeyStatus').textContent,/Signed in/)}
  }finally{b.cleanup()}
});

for(const event of ['focus','visibility'])for(const change of ['newer-intent','account','same-owner-token'])test(`${event} still clears a superseded pending action after ${change}`,async()=>{
  const b=await boot('login-page-1');try{
    b.el('email').value='old@example.com';b.el('password').value='fixture-password';const pending=deferred();b.hooks.fetch=call=>String(call.url).includes('/auth/v1/token')?pending.promise:null;
    const old=b.context.submitAuth({preventDefault});await tick();b.backend.getSession=()=>new Promise(()=>{});
    if(change==='newer-intent')b.backend.beginAuthAttempt();else if(change==='account')b.switchTo('B',false);else b.backend.adoptSession({...session('A'),access_token:'replacement-A',refresh_token:'replacement-refresh-A'});
    if(event==='focus')b.focusEvent();else b.visibilityEvent();
    assert.equal(b.el('email').value,'');assert.equal(b.el('password').value,'');assert.equal(vm.runInContext('loginPendingAction',b.context),null);assert.equal(b.el('submitBtn').disabled,true);
    pending.resolve(new Response(JSON.stringify({error:'invalid_grant'}),{status:400}));await old;
    assert.equal(b.el('submitBtn').disabled,true);assert.equal(b.el('status').textContent,'');
  }finally{b.cleanup()}
});
