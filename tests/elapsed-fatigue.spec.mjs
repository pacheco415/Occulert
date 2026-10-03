import {test,expect} from '@playwright/test';

test('elapsed timing requires the explicit flag and stays local',async({page})=>{
 const requests=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/sessions')requests.push(request.url());});
 await page.goto('/app.html?fatigue-timing=elapsed');
 await expect(page.locator('#timingExperimentNotice')).toBeVisible();
 await expect(page.locator('#cloudConsent')).toBeDisabled();
 await expect(page.locator('#cloudConsent')).not.toBeChecked();
 const result=await page.evaluate(async()=>{
   await initCloud();return{mode:ELAPSED_FATIGUE_EXPERIMENT,cloudReady,payload:fleetPayload()};
 });
 expect(result.mode).toBe(true);expect(result.cloudReady).toBe(false);
 expect(result.payload.fatigueTiming).toBe('elapsed-135ms-experiment');
 expect(result.payload.cloudConsent).toBe(false);expect(requests).toEqual([]);
});

test('default driver behavior retains the released frame accumulator',async({page})=>{
 await page.goto('/app.html');
 await expect(page.locator('#timingExperimentNotice')).toBeHidden();
 await expect(page.locator('#cloudConsent')).toBeEnabled();
 expect(await page.evaluate(()=>({mode:ELAPSED_FATIGUE_EXPERIMENT,scale:fatigueFrameScale(0,true),version:fleetPayload().appVersion}))).toEqual({mode:false,scale:1,version:'web-v71'});
});
