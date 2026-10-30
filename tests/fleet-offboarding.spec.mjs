import { test, expect } from '@playwright/test';
import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';
const fleet='55555555-5555-4555-8555-555555555555',driver='44444444-4444-4444-8444-444444444444';
async function auth(page,user='fixture-user') {
  await page.addInitScript(user=>localStorage.setItem('occulert-auth',JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,email:'fixture@example.invalid'}})),user);
  await page.route('**/api/public-config',route=>route.fulfill({json:{ok:true,supabase:{configured:false}}}));
  await page.route('**/api/fleets',route=>route.fulfill({json:{ok:true,fleet:null}}));
}
test('leave requires confirmation, preserves controls on uncertainty and hides after confirmation',async({page})=>{
  await auth(page);let writes=0;
  await page.route('**/api/fleet-membership',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{ok:true,membership:{id:driver,fleet_id:fleet}}});
    writes++;expect(route.request().headers().authorization).toBe('Bearer fixture-token');expect(route.request().postDataJSON()).toEqual({confirm:true,fleet_id:fleet});
    return route.fulfill({status:writes===1?502:200,json:writes===1?{ok:false,error:'supabase_error'}:{ok:true,left:true,driver_id:driver}});
  });
  await page.goto('/account.html');await expect(page.locator('#leaveFleetBtn')).toBeVisible();
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#leaveFleetBtn').click();expect(writes).toBe(0);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#leaveFleetBtn').click();await expect(page.locator('#fleetMembershipStatus')).toContainText('could not be confirmed');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#leaveFleetBtn').click();await expect(page.locator('#fleetMembershipPanel')).toBeHidden();expect(writes).toBe(2);
});
test('disabled offboarding exposes no leave control',async({page})=>{
  await auth(page);await page.route('**/api/fleet-membership',route=>route.fulfill({status:501,json:{ok:false,error:'offboarding_not_enabled'}}));
  await page.goto('/account.html');await expect(page.locator('#fleetMembershipPanel')).toBeHidden();
});
test('owner removal confirms the selected protected driver and refreshes the roster',async({page})=>{
  await auth(page,'manager-1');let removed=false,writes=0;
  await page.route('**/api/fleet-membership',route=>route.fulfill({json:{ok:true,membership:null}}));
  await page.route('**/api/fleet-summary*',route=>route.fulfill({json:{ok:true,fleet:{id:fleet,company_name:'Fixture Fleet',plan:'trial'},drivers:removed?[]:[{id:driver,name:'Fixture Driver',active:true}],sessions:[],events:[],telemetry_trust:'unverified_client_report'}}));
  await page.route('**/api/fleet-drivers',route=>{writes++;expect(route.request().method()).toBe('DELETE');expect(route.request().postDataJSON()).toEqual({driver_id:driver,fleet_id:fleet,confirm:true});removed=true;return route.fulfill({json:{ok:true,removed:true,driver_id:driver}});});
  await page.goto('/fleet-dashboard.html');const button=page.getByRole('button',{name:'Remove from fleet',exact:true});await expect(button).toBeVisible();
  page.once('dialog',dialog=>dialog.dismiss());await button.click();expect(writes).toBe(0);
  page.once('dialog',dialog=>dialog.accept());await button.click();await expect(button).toHaveCount(0);expect(writes).toBe(1);
});
test('a delayed leave response cannot repaint a replacement account',async({page})=>{
  await auth(page);let resolveWrite;const requested=new Promise(resolve=>resolveWrite=resolve);let release;const waiting=new Promise(resolve=>release=resolve);
  await page.route('**/api/fleet-membership',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{ok:true,membership:route.request().headers().authorization==='Bearer replacement-token'?null:{id:driver,fleet_id:fleet}}});
    resolveWrite();await waiting;await route.fulfill({json:{ok:true,left:true,driver_id:driver}});
  });
  await page.goto('/account.html');await expect(page.locator('#leaveFleetBtn')).toBeVisible();page.once('dialog',dialog=>dialog.accept());await page.locator('#leaveFleetBtn').click();await requested;
  await page.evaluate(()=>{localStorage.setItem('occulert-auth',JSON.stringify({access_token:'replacement-token',refresh_token:'replacement-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'replacement-user',email:'replacement@example.invalid'}}));window.dispatchEvent(new StorageEvent('storage',{key:'occulert-auth'}));});
  await expect(page.locator('#fleetMembershipPanel')).toBeHidden();const responded=page.waitForResponse(response=>response.url().endsWith('/api/fleet-membership')&&response.request().method()==='POST');release();await responded;await expect(page.locator('#fleetMembershipStatus')).toHaveText('');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-auth')).user.id)).toBe('replacement-user');
});

test('same-tab sign-out immediately hides destructive controls', async ({ page }) => {
  await auth(page); let writes = 0;
  await page.route('**/api/fleet-membership', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({ json: { ok: true, membership: { id: driver, fleet_id: fleet } } });
  });
  await page.goto('/account.html'); await expect(page.locator('#leaveFleetBtn')).toBeVisible();
  await page.evaluate(() => window.OcculertBackend.signOut());
  await expect(page.locator('#fleetMembershipPanel')).toBeHidden();
  expect(writes).toBe(0);
});

test('an old membership lookup cannot reveal controls for a replacement account', async ({ page }) => {
  await auth(page); let release, requested;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  await page.route('**/api/fleet-membership', async route => {
    if (route.request().headers().authorization === 'Bearer replacement-token') {
      return route.fulfill({ json: { ok: true, membership: null } });
    }
    requested(); await waiting;
    await route.fulfill({ json: { ok: true, membership: { id: driver, fleet_id: fleet } } });
  });
  await page.goto('/account.html'); await started;
  await page.evaluate(() => window.OcculertBackend.adoptSession({ access_token: 'replacement-token', refresh_token: 'replacement-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'replacement-user', email: 'replacement@example.invalid' } }));
  const responded = page.waitForResponse(response => response.url().endsWith('/api/fleet-membership') && response.request().headers().authorization === 'Bearer fixture-token');
  release(); await responded;
  await expect(page.locator('#fleetMembershipPanel')).toBeHidden();
  expect(await page.evaluate(() => window.OcculertBackend.currentUser().id)).toBe('replacement-user');
});

test('cancellation explains ongoing-session attribution and sends no mutation', async ({ page }) => {
  await auth(page); let writes = 0;
  await page.route('**/api/fleet-membership', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({ json: { ok: true, membership: { id: driver, fleet_id: fleet } } });
  });
  await page.goto('/account.html'); await expect(page.locator('#leaveFleetBtn')).toBeVisible();
  let confirmation;
  page.once('dialog', dialog => { confirmation = dialog.message(); return dialog.dismiss(); });
  await page.locator('#leaveFleetBtn').click();
  expect(confirmation).toContain('drive already running'); expect(confirmation).toContain('later alerts');
  expect(writes).toBe(0); await expect(page.locator('#leaveFleetBtn')).toBeEnabled();
});

test('routine token refresh preserves the displayed consent context and uses the refreshed bearer', async ({ page }) => {
  await auth(page);
  await page.route('**/api/public-config', route => route.fulfill({ json: { ok: true, supabase: {
    configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-fixture',
  } } }));
  await page.route('**/auth/v1/token?grant_type=refresh_token', route => route.fulfill({ json: {
    access_token: 'refreshed-token', refresh_token: 'refreshed-refresh', expires_in: 3600,
    user: { id: 'fixture-user', email: 'fixture@example.invalid' },
  } }));
  let lookups = 0, writes = 0;
  await page.route('**/api/fleet-membership', route => {
    if (route.request().method() === 'GET') {
      lookups++;
      return route.fulfill({ json: { ok: true, membership: { id: driver, fleet_id: fleet } } });
    }
    writes++; expect(route.request().headers().authorization).toBe('Bearer refreshed-token');
    return route.fulfill({ json: { ok: true, left: true, driver_id: driver } });
  });
  await page.goto('/account.html'); await expect(page.locator('#leaveFleetBtn')).toBeVisible();
  await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('occulert-auth'));
    saved.expires_at = 0; localStorage.setItem('occulert-auth', JSON.stringify(saved));
    await window.OcculertBackend.getSession();
  });
  await expect(page.locator('#leaveFleetBtn')).toBeVisible(); expect(lookups).toBe(1);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#leaveFleetBtn').click();
  await expect(page.locator('#fleetMembershipPanel')).toBeHidden(); expect(writes).toBe(1);
});
