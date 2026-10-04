import {test,expect} from '@playwright/test';
const endTime='2026-10-03T12:00:00.000Z';
async function seed(page){await page.addInitScript(({endTime})=>{
  localStorage.setItem('occulert-auth',JSON.stringify({access_token:'owner-token',refresh_token:'owner-refresh',expires_at:9999999999,user:{id:'owner-a'}}));
  localStorage.setItem('occulert-session-history',JSON.stringify([{id:'local-one',localRecordId:'local-one',historyVersion:1,savedAt:endTime,alerts:1}]));
  localStorage.setItem('occulert-cloud-outbox',JSON.stringify([{ownerId:'owner-a',sessionId:'cloud-one',localSessionId:'local-one',endedAt:endTime,stats:{average_fatigue:20,max_fatigue:40,safety_score:70,alert_count:1,head_nod_count:0}}]));
},{endTime});}
test('browser History lists pending summaries and sends only after explicit permission and retry',async({page})=>{
  await seed(page);const writes=[];
  await page.route('**/api/sessions',route=>{
    expect(route.request().method()).toBe('PATCH');expect(route.request().headers().authorization).toBe('Bearer owner-token');
    writes.push(route.request().postDataJSON());
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session:{id:'cloud-one',ended_at:endTime}})});
  });
  await page.goto('/session-history.html');
  await expect(page.locator('#table')).toContainText('Cloud summary pending');
  await expect(page.locator('#historyCloudRetry')).toBeDisabled();expect(writes).toHaveLength(0);
  await page.locator('#historyCloudConsent').check();
  await expect(page.locator('#historyCloudRetry')).toBeEnabled();expect(writes).toHaveLength(0);
  await page.locator('#historyCloudRetry').click();
  await expect(page.locator('#table')).toContainText('Cloud summary confirmed');
  expect(writes).toHaveLength(1);expect(writes[0].ended_at).toBe(endTime);
  expect(Object.keys(writes[0]).sort()).toEqual(['session_id','ended_at','average_fatigue','max_fatigue','safety_score','alert_count','head_nod_count'].sort());
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('occulert-cloud-outbox')))).toEqual([]);
});
test('browser History consent revocation cancels late local acknowledgement',async({page})=>{
  await seed(page);let release,requested;const held=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{requested=resolve});
  await page.route('**/api/sessions',async route=>{requested();await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session:{id:'cloud-one',ended_at:endTime}})}).catch(()=>{});});
  await page.goto('/session-history.html');
  await page.locator('#historyCloudConsent').check();await page.locator('#historyCloudRetry').click();await started;
  await expect(page.locator('#historyCloudRetry')).toBeDisabled();
  await page.locator('#historyCloudConsent').uncheck();release();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-cloud-outbox')).length)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-session-history'))[0].cloudSynced)).toBeUndefined();
  await expect(page.locator('#historyCloudRetry')).toBeDisabled();
});


test('browser History keeps a matching open-session response pending until an ended row is confirmed',async({page})=>{
 await seed(page);let confirmed=false;const writes=[];
 await page.route('**/api/sessions',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session:{id:'cloud-one',ended_at:confirmed?endTime:null}})});});
 await page.goto('/session-history.html');await page.locator('#historyCloudConsent').check();await page.locator('#historyCloudRetry').click();
 await expect(page.locator('#historyCloudStatus')).toContainText('1 pending cloud summaries');await expect(page.locator('#table')).toContainText('Cloud summary pending');
 expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('occulert-cloud-outbox')))).toHaveLength(1);
 expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('occulert-session-history')))[0].cloudSynced).toBeUndefined();
 confirmed=true;await page.locator('#historyCloudRetry').click();await expect(page.locator('#table')).toContainText('Cloud summary confirmed');
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
});


test('a different account cannot confirm or remove an in-flight owner summary',async({page})=>{
  await seed(page);let release,requested;const held=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{requested=resolve});const writes=[];
  await page.route('**/api/sessions',async route=>{writes.push(route.request().headers().authorization);requested();await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session:{id:'cloud-one',ended_at:endTime}})}).catch(()=>{});});
  await page.goto('/session-history.html');await page.locator('#historyCloudConsent').check();await page.locator('#historyCloudRetry').click();await started;
  await page.evaluate(()=>{window.OcculertBackend.adoptSession({access_token:'other-token',refresh_token:'other-refresh',expires_at:9999999999,user:{id:'owner-b'}});window.dispatchEvent(new StorageEvent('storage',{key:'occulert-auth'}));});
  await expect(page.locator('#historyCloudConsent')).not.toBeChecked();release();
  await expect.poll(()=>page.evaluate(()=>cloudFlight===null)).toBe(true);
  expect(writes).toEqual(['Bearer owner-token']);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-cloud-outbox')).map(row=>row.ownerId))).toEqual(['owner-a']);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-session-history'))[0].cloudSynced)).toBeUndefined();
  await expect(page.locator('#historyCloudStatus')).toContainText('0 pending cloud summaries');await expect(page.locator('#historyCloudRetry')).toBeDisabled();
});

test('leaving History prevents a late summary response from changing its local copy',async({page})=>{
  await seed(page);let release,requested;const held=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{requested=resolve});
  await page.route('**/api/sessions',async route=>{requested();await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session:{id:'cloud-one',ended_at:endTime}})}).catch(()=>{});});
  await page.goto('/session-history.html');await page.locator('#historyCloudConsent').check();await page.locator('#historyCloudRetry').click();await started;
  await page.goto('/privacy.html');release();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-cloud-outbox')).length)).toBe(1);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-session-history'))[0].cloudSynced)).toBeUndefined();
});

test('revoking permission preserves another owner queue and reports storage deletion failure',async({page})=>{
  await seed(page);const writes=[];await page.route('**/api/sessions',route=>{writes.push(route.request().postDataJSON());return route.abort();});
  await page.goto('/session-history.html');
  const raw=await page.evaluate(()=>{const rows=JSON.parse(localStorage.getItem('occulert-cloud-outbox'));rows.push({...rows[0],ownerId:'owner-b',sessionId:'other-cloud'});const raw=JSON.stringify(rows);localStorage.setItem('occulert-cloud-outbox',raw);window.dispatchEvent(new StorageEvent('storage',{key:'occulert-cloud-outbox'}));const save=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='occulert-cloud-outbox')throw Error('quota denied');return save.call(this,key,value)};return raw;});
  await expect(page.locator('#historyCloudStatus')).toContainText('1 pending cloud summaries');await page.locator('#historyCloudConsent').check();await page.locator('#historyCloudConsent').uncheck();
  await expect(page.locator('#historyCloudStatus')).toContainText('pending data could not be removed');await expect(page.locator('#historyCloudRetry')).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem('occulert-cloud-outbox'))).toBe(raw);expect(writes).toEqual([]);
});

test('an unreadable queue stays unchanged and cannot be retried',async({page})=>{
  await seed(page);const raw='[{"ownerId":"owner-a"},null]',writes=[];
  await page.route('**/api/sessions',route=>{writes.push(route.request().method());return route.abort();});await page.goto('/session-history.html');
  await page.evaluate(raw=>{localStorage.setItem('occulert-cloud-outbox',raw);window.dispatchEvent(new StorageEvent('storage',{key:'occulert-cloud-outbox'}));},raw);
  await expect(page.locator('#historyCloudStatus')).toContainText('could not be read');await page.locator('#historyCloudConsent').check();await expect(page.locator('#historyCloudRetry')).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem('occulert-cloud-outbox'))).toBe(raw);expect(writes).toEqual([]);
});

test('cloud confirmation does not recreate a local copy deleted during the retry',async({page})=>{
  await seed(page);let release,requested;const held=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{requested=resolve});
  await page.route('**/api/sessions',async route=>{requested();await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session:{id:'cloud-one',ended_at:endTime}})});});
  await page.goto('/session-history.html');await page.locator('#historyCloudConsent').check();await page.locator('#historyCloudRetry').click();await started;
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Clear local history',exact:true}).click();release();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-cloud-outbox')).length)).toBe(0);
  expect(await page.evaluate(()=>localStorage.getItem('occulert-session-history'))).toBeNull();await expect(page.locator('#sessions')).toHaveText('0');
});


test('turning retries off removes only the current owner entries',async({page})=>{
  await seed(page);await page.goto('/session-history.html');
  await page.evaluate(()=>{const rows=JSON.parse(localStorage.getItem('occulert-cloud-outbox'));rows.push({...rows[0],ownerId:'owner-b',sessionId:'other-cloud'});localStorage.setItem('occulert-cloud-outbox',JSON.stringify(rows));window.dispatchEvent(new StorageEvent('storage',{key:'occulert-cloud-outbox'}));});
  await page.locator('#historyCloudConsent').check();await page.locator('#historyCloudConsent').uncheck();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-cloud-outbox')).map(row=>({ownerId:row.ownerId,sessionId:row.sessionId})))).toEqual([{ownerId:'owner-b',sessionId:'other-cloud'}]);
  await expect(page.locator('#historyCloudStatus')).toContainText('0 pending cloud summaries');await expect(page.locator('#historyCloudRetry')).toBeDisabled();
});
