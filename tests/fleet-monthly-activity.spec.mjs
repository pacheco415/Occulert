import { test, expect } from '@playwright/test';
import { assetByStem } from '../scripts/lib/current-assets.mjs';

for(const {count,month,asOf,shownAsOf} of [
  ...[0,73,null].map(count=>({count,month:'2026-11',asOf:'2026-11-07T14:00:00Z',shownAsOf:'Nov 7, 6:00 AM PST'})),
  {count:3,month:'2026-10',asOf:'2026-11-01T06:59:59Z',shownAsOf:'Oct 31, 11:59 PM PDT'},
  {count:4,month:'2026-11',asOf:'2026-12-01T07:59:59Z',shownAsOf:'Nov 30, 11:59 PM PST'},
]){
  test(`monthly activity shows server total ${count} for ${month} separately from the recent snapshot`,async({page})=>{
    const monthly=count===null?null:{version:1,definition:'completed_session_v1',timezone:'America/Los_Angeles',
      month,as_of:asOf,active_drivers:count};
    await page.route(`**/${assetByStem('occulert-backend.js')}`,route=>route.fulfill({
      contentType:'application/javascript',body:`window.OcculertBackend={
        currentUser:()=>({id:'fixture-owner'}),getSession:async()=>({user:{id:'fixture-owner'}}),
        getFleetSummary:async()=>({ok:true,status:200,body:${JSON.stringify({
          fleet:{id:'fixture-fleet',company_name:'Fixture'},drivers:[],sessions:[],events:[],
          monthly_activity:monthly,
        })}})};`,
    }));
    await page.goto('/fleet-dashboard.html');
    const node=page.locator('#monthlyActivity');
    await expect(node).toBeVisible();
    await expect(node).toContainText(count===null?'Monthly active drivers: unavailable':`Monthly active drivers: ${count} · ${month} (Pacific time)`);
    if(count!==null){await expect(node).toContainText(`As of ${shownAsOf}.`);await expect(node).not.toContainText(asOf);}
    await expect(page.locator('.dashboard-kpis .label').first()).toHaveText('Active roster drivers');
    await page.evaluate(()=>{window.OcculertBackend.currentUser=()=>null;window.dispatchEvent(new StorageEvent('storage',{key:'occulert-auth'}));});
    await expect(node).toBeHidden();
    await expect(node).not.toContainText(month);
  });
}
