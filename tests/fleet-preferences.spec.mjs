import {test,expect} from '@playwright/test';
const key=(owner,fleet)=>'occulert-fleet-view-v1:'+JSON.stringify([owner,fleet]);
async function fixture(page){
 await page.addInitScript(()=>{if(!localStorage.getItem('occulert-auth'))localStorage.setItem('occulert-auth',JSON.stringify({access_token:'fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner-1'}}))});
 let fleet='fleet-1';
 await page.route('**/api/fleet-summary*',route=>route.fulfill({json:{ok:true,fleet:{id:fleet,company_name:'Fixture'},drivers:[],sessions:[],events:[]}}));
 await page.route('**/api/fleet-followups*',route=>route.fulfill({json:{ok:true,sessions:[]}}));
 await page.goto('/fleet-dashboard.html');await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');
 return value=>{fleet=value};
}
test('view choices survive reload without persisting driver search',async({page})=>{
 await fixture(page);await page.locator('#riskFilter').selectOption('watch');await page.locator('#sortMode').selectOption('alerts');await page.locator('#driverSearch').fill('Personal driver');
 const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key('owner-1','fleet-1'));expect(stored).toEqual({version:1,risk:'watch',sort:'alerts'});
 await page.reload();await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');await expect(page.locator('#riskFilter')).toHaveValue('watch');await expect(page.locator('#sortMode')).toHaveValue('alerts');await expect(page.locator('#driverSearch')).toHaveValue('');
});
test('account changes and sign-out reset view choices and search',async({page})=>{
 await fixture(page);await page.locator('#riskFilter').selectOption('danger');await page.locator('#driverSearch').fill('Private');
 await page.evaluate(()=>{let auth=JSON.parse(localStorage.getItem('occulert-auth'));auth.user.id='owner-2';localStorage.setItem('occulert-auth',JSON.stringify(auth));window.dispatchEvent(new StorageEvent('storage',{key:'occulert-auth'}))});
 await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');await expect(page.locator('#riskFilter')).toHaveValue('all');await expect(page.locator('#driverSearch')).toHaveValue('');
 await page.locator('#sortMode').selectOption('score');await page.evaluate(()=>{localStorage.removeItem('occulert-auth');window.dispatchEvent(new StorageEvent('storage',{key:'occulert-auth'}))});await expect(page.locator('#sortMode')).toHaveValue('risk');
});
test('a different confirmed fleet cannot inherit previous fleet filters',async({page})=>{
 const changeFleet=await fixture(page);await page.locator('#riskFilter').selectOption('stale');changeFleet('fleet-2');await page.locator('#refreshNow').click();await expect(page.locator('#refreshNow')).toBeEnabled();await expect(page.locator('#riskFilter')).toHaveValue('all');
});
test('malformed preferences and blocked storage preserve a usable dashboard',async({page})=>{
 await page.addInitScript(k=>{localStorage.setItem(k,JSON.stringify({version:1,risk:'gps',sort:'<script>'}))},key('owner-1','fleet-1'));await fixture(page);await expect(page.locator('#riskFilter')).toHaveValue('all');await expect(page.locator('#sortMode')).toHaveValue('risk');
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('blocked')}});await page.locator('#riskFilter').selectOption('watch');await expect(page.locator('#riskFilter')).toHaveValue('watch');await expect(page.locator('#drivers')).toBeVisible();
});
