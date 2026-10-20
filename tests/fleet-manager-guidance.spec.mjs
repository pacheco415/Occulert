import {test,expect} from '@playwright/test';

const ago=minutes=>new Date(Date.now()-minutes*60_000).toISOString();
function summary(){return {
  ok:true,fleet:{id:'fleet-1',company_name:'Support Transit'},
  drivers:[{id:'zero',name:'Zero Score',active:true},{id:'unknown',name:'Unknown Score',active:true},
    {id:'missing',name:'New Driver',active:true},{id:'older',name:'Older Record',active:true},
    {id:'inactive',name:'Inactive Driver',active:false}],
  sessions:[{id:'zero-session',driver_id:'zero',started_at:ago(2),ended_at:ago(1),safety_score:0,alert_count:0},
    {id:'unknown-session',driver_id:'unknown',started_at:ago(2),ended_at:null,safety_score:null,alert_count:0},
    {id:'older-session',driver_id:'older',started_at:ago(20),ended_at:ago(10),safety_score:90,alert_count:0},
    {id:'inactive-session',driver_id:'inactive',started_at:ago(2),ended_at:null,safety_score:1,alert_count:3}],
  events:[],telemetry_trust:'unverified_client_report',
  privacy:{includes_location:false,includes_personal_media:false,includes_raw_motion:false},
};}
async function fixture(page,{failInitially=false}={}){
  await page.addInitScript(()=>localStorage.setItem('occulert-auth',JSON.stringify({access_token:'fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner-1'}})));
  let fails=failInitially;
  await page.route('**/api/fleet-summary*',route=>fails?route.fulfill({status:503,json:{error:'temporarily_unavailable'}}):route.fulfill({json:summary()}));
  await page.route('**/api/fleet-followups*',route=>route.fulfill({json:{ok:true,sessions:[]}}));
  await page.route('**/api/fleet-period-report*',route=>route.fulfill({status:503,json:{error:'temporarily_unavailable'}}));
  await page.goto('/fleet-dashboard.html');
  await expect(page.locator('#cloudStatus')).toContainText(failInitially?'unavailable':'Protected connection active');
  return value=>{fails=value};
}

test('manager priorities explain zero, unknown scores and coverage without implying live availability',async({page})=>{
  await fixture(page);
  const queue=page.locator('#actionQueue'),coverage=page.locator('#rosterSummary');
  await expect(queue.locator('.ops-row').first()).toContainText('Priority review: Zero Score');
  await expect(queue.locator('.ops-row').first()).toContainText('score 0');
  await expect(queue.locator('.ops-row').filter({hasText:'Unknown Score'})).toContainText('unknown, not zero');
  await expect(queue.locator('.ops-row').filter({hasText:'New Driver'})).toContainText('voluntary sharing while parked');
  await expect(queue.locator('.ops-row').filter({hasText:'Older Record'})).toContainText('does not show current driving status');
  await expect(queue).not.toContainText('Inactive Driver');
  await expect(coverage.locator('.ops-row').filter({hasText:'Active drivers'})).toContainText('4');
  await expect(coverage.locator('.ops-row').filter({hasText:'With a loaded session'})).toContainText('3/4');
  await expect(coverage.locator('.ops-row').filter({hasText:'Latest score missing'})).toContainText('1');
  await expect(coverage).not.toContainText('Live coverage');
  await expect(page.locator('#kpiDriversSub')).toContainText('availability unknown');
  await expect(page.locator('#rosterManageLink')).toHaveAttribute('href','/fleet-onboarding.html');
  await expect(page.locator('#coverageHistoryLink')).toHaveAttribute('href','/fleet-history.html');
  await expect(page.locator('.driver-actions a').first()).toHaveAttribute('href','/fleet-history.html');
  expect(await page.locator('.ops-primary').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.launch-panel'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.locator('#sortMode').selectOption('updated');
  await page.evaluate(()=>render());
  await expect(queue.locator('.ops-row').first()).toContainText('Zero Score');
  await queue.locator('.ops-row').filter({hasText:'New Driver'}).getByRole('button',{name:'Open driver'}).click();
  await expect(page.locator('[data-driver-key="missing"]')).toBeFocused();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('a failed protected refresh keeps records but replaces reassurance with retry guidance',async({page})=>{
  const setFailure=await fixture(page);setFailure(true);
  await page.locator('#refreshNow').click();
  await expect(page.locator('#cloudStatus')).toContainText('Connection interrupted');
  await expect(page.locator('#actionQueue .ops-row').first()).toContainText('Refresh needed');
  await expect(page.locator('#actionQueue .ops-row').first()).toContainText('current status is unknown');
  await expect(page.locator('#actionQueue')).not.toContainText('No urgent fleet actions');
  await expect(page.locator('#rosterSummary')).toContainText('Last loaded records');
  await expect(page.locator('#drivers')).toContainText('Zero Score');
  setFailure(false);await page.locator('#refreshNow').click();
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');
  await expect(page.locator('#actionQueue')).not.toContainText('Refresh needed');
});

test('an initial failure keeps protected coverage unavailable rather than reporting zero',async({page})=>{
  const setFailure=await fixture(page,{failInitially:true});
  await expect(page.locator('#actionQueue')).toContainText('Driver status and coverage are unknown');
  await expect(page.locator('#rosterSummary')).toContainText('Unavailable');
  await expect(page.locator('#actionQueue')).not.toContainText('No flagged records');
  setFailure(false);await page.locator('#refreshNow').click();
  await expect(page.locator('#rosterSummary')).toContainText('3/4');
});

test('sign-out clears manager guidance and protected driver names',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{localStorage.removeItem('occulert-auth');window.dispatchEvent(new StorageEvent('storage',{key:'occulert-auth'}))});
  await expect(page.locator('#cloudStatus')).toContainText('Not signed in');
  await expect(page.locator('#actionQueueNote')).toContainText('Local preview only');
  await expect(page.locator('#actionQueue')).not.toContainText('Zero Score');
  await expect(page.locator('#rosterSummary')).not.toContainText('Support Transit');
});
