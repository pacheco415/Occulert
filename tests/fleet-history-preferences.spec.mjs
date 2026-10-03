import {test,expect} from '@playwright/test';
const OWNER='11111111-1111-4111-8111-111111111111', FLEET='22222222-2222-4222-8222-222222222222';
const KEY=`occulert-history-view-v1:${OWNER}:${FLEET}`;
async function fixture(page, period='30') {
  await page.addInitScript(({OWNER,KEY,period})=>{
    if (!localStorage.getItem('occulert-auth')) localStorage.setItem('occulert-auth',JSON.stringify({access_token:'test-manager',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:OWNER}}));
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY,JSON.stringify({version:1,period,completion:'completed',sort:'alerts',from:'',to:''}));
  },{OWNER,KEY,period});
  const requests=[];
  await page.route('**/api/fleet-session-history*',route=>{
    const params=new URL(route.request().url()).searchParams; requests.push(route.request().url());
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,fleet:{id:FLEET,company_name:'Test fleet'},sessions:[],drivers:[],driver_filter_complete:true,filters:{driver_id:params.get('driver_id'),from:params.get('from'),to:params.get('to')},has_more:false,next_cursor:null,telemetry_trust:'unverified_client_report',privacy:{includes_location:false,includes_personal_media:false,includes_raw_motion:false}})});
  });
  return requests;
}
test('fleet History restores owner preferences, re-queries dates and clears deliberately',async({page})=>{
  const requests=await fixture(page);
  await page.goto('/fleet-history.html');
  await expect(page.locator('#historyFilters')).toBeEnabled();
  await expect.poll(()=>requests.length).toBe(2);
  expect(new URL(requests[0]).searchParams.get('from')).toBeNull();
  expect(new URL(requests[1]).searchParams.get('from')).toBeTruthy();
  await expect(page.locator('#historyPeriod')).toHaveValue('30');
  await expect(page.locator('#historyCompletion')).toHaveValue('completed');
  await expect(page.locator('#historySort')).toHaveValue('alerts');
  await page.locator('#historyPeriod').selectOption('7');
  await expect.poll(()=>requests.length).toBe(3);
  await expect(page.locator('#historyFilters')).toBeEnabled();
  await page.reload();
  await expect.poll(()=>requests.length).toBe(5);
  await expect(page.locator('#historyPeriod')).toHaveValue('7');
  await expect(page.locator('#historyFilters')).toBeEnabled();
  await page.locator('#historyClearFilters').click();
  await expect(page.locator('#historyPeriod')).toHaveValue('all');
  await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
  await expect(page.locator('#historyPreferenceStatus')).toContainText('cleared');
});
test('fleet History ignores invalid saved dates and clears its view on account changes',async({page})=>{
  await fixture(page,'custom');
  await page.goto('/fleet-history.html');
  await expect(page.locator('#historyFilters')).toBeEnabled();
  await expect(page.locator('#historyPeriod')).toHaveValue('all');
  await page.locator('#historySort').selectOption('duration');
  await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)).sort,KEY)).toBe('duration');
  await page.evaluate(()=>{ localStorage.removeItem('occulert-auth'); window.dispatchEvent(new StorageEvent('storage',{key:'occulert-auth'})); });
  await expect(page.locator('#historyFilters')).toHaveAttribute('disabled','');
  await expect(page.locator('#historySort')).toBeDisabled();
  await expect(page.locator('#historySort')).toHaveValue('newest');
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
});

test('fleet History invalid ranges remain editable and recover without a page reload',async({page})=>{
 await fixture(page,'all');await page.goto('/fleet-history.html');await expect(page.locator('#historyFilters')).toBeEnabled();
 await page.locator('#historyPeriod').selectOption('custom');
 await page.locator('#historyFrom').fill('2099-01-01');await page.locator('#historyFrom').dispatchEvent('change');
 await expect(page.locator('#historyDateStatus')).toContainText('today or earlier');
 await expect(page.locator('#historyFrom')).toBeEnabled();
 await page.locator('#historyFrom').fill('2026-01-01');await page.locator('#historyFrom').dispatchEvent('change');
 await expect(page.locator('#historyFilters')).toBeEnabled();
 await expect(page.locator('#historyDateStatus')).not.toContainText('today or earlier');
});
