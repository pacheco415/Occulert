import {test,expect} from '@playwright/test';

test('pixel EAR is explicitly selected, remains local, and reacts to actual video resize events',async({page})=>{
 await page.goto('/app.html?ear-units=pixels');
 await expect(page.locator('#pixelEarNotice')).toBeVisible();await expect(page.locator('#cloudConsent')).toBeDisabled();
 const result=await page.evaluate(async()=>{
  let width=360,height=480;
  Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>width});Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>height});
  running=true;observeEARGeometry();calibrating=false;calibrated=true;calibrationSamples=[.3];
  width=480;height=360;video.dispatchEvent(new Event('resize'));
  await initCloud();
  return{ready:!!window.OcculertEARGeometry,calibrating,calibrated,samples:calibrationSamples.length,remaining:calibrationUntil-Date.now(),cloudReady,version:fleetPayload().appVersion};
 });
 expect(result.ready).toBe(true);expect(result.calibrating).toBe(true);expect(result.calibrated).toBe(false);expect(result.samples).toBe(0);expect(result.remaining).toBeGreaterThan(3000);expect(result.cloudReady).toBe(false);expect(result.version).toBe('web-v72');
});

test('ordinary driver loads keep their released thresholds and cloud consent controls',async({page})=>{
 await page.goto('/app.html');await expect(page.locator('#pixelEarNotice')).toBeHidden();await expect(page.locator('#cloudConsent')).toBeEnabled();
 expect(await page.evaluate(()=>({mode:PIXEL_EAR_EXPERIMENT,closed:eyeClosedThreshold,watch:eyeWatchThreshold}))).toEqual({mode:false,closed:.18,watch:.22});
});
