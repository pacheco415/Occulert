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
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session:{id:'cloud-one'}})});
  });
  await page.goto('/session-history.html');
  await expect(page.locator('#table')).toContainText('Cloud summary pending');
  await expect(page.locator('#historyCloudRetry')).toBeDisabled();expect(writes).toHaveLength(0);
  await page.locator('#historyCloudConsent').check();
  await expect(page.locator('#historyCloudRetry')).toBeEnabled();expect(writes).toHaveLength(0);
  await page.locator('#historyCloudRetry').click();
  await expect(page.locator('#table')).toContainText('Cloud summary confirmed');
  expect(writes).toHaveLength(1);expect(writes[0].ended_at).toBe(endTime);
  expect(writes[0]).not.toHaveProperty('latitude');expect(writes[0]).not.toHaveProperty('ownerId');
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('occulert-cloud-outbox')))).toEqual([]);
});
test('browser History consent revocation cancels late local acknowledgement',async({page})=>{
  await seed(page);let release,requested;const held=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{requested=resolve});
  await page.route('**/api/sessions',async route=>{requested();await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session:{id:'cloud-one'}})}).catch(()=>{});});
  await page.goto('/session-history.html');
  await page.locator('#historyCloudConsent').check();await page.locator('#historyCloudRetry').click();await started;
  await expect(page.locator('#historyCloudRetry')).toBeDisabled();
  await page.locator('#historyCloudConsent').uncheck();release();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-cloud-outbox')).length)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-session-history'))[0].cloudSynced)).toBeUndefined();
  await expect(page.locator('#historyCloudRetry')).toBeDisabled();
});
