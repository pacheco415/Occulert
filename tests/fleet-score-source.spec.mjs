import { test, expect } from '@playwright/test';
import { assetByStem } from '../scripts/lib/current-assets.mjs';

test('driver scores identify recorded methods and leave unknown metadata unclassified', async ({ page }) => {
  const records = [
      { name:'Web Driver', detectorPipeline:'web_mediapipe_ear' },
      { name:'iPhone Driver', detectorPipeline:'ios_mlkit_eye_probability' },
      { name:'Android Driver', detectorPipeline:'android_mlkit_eye_probability' },
      { name:'Legacy Driver' },
      { name:'Invalid Driver', detectorPipeline:'<img src=x onerror=alert(1)>' },
  ];
  const started = new Date().toISOString();
  const summary = {
    fleet: { id:'fixture-fleet',company_name:'Fixture fleet' },
    drivers: records.map((row,i) => ({ id:String(i),name:row.name })),
    sessions: records.map((row,i) => ({ id:'session-'+i,driver_id:String(i),started_at:started,ended_at:null,safety_score:80,detector_pipeline:row.detectorPipeline })),
    events: [],
  };
  await page.route(`**/${assetByStem('occulert-backend.js')}`, route => route.fulfill({
    contentType:'application/javascript',body:`window.OcculertBackend={
      currentUser:()=>({id:'fixture-owner'}),
      getSession:async()=>({user:{id:'fixture-owner'}}),
      getFleetSummary:async()=>({ok:true,status:200,body:${JSON.stringify(summary)}})
    };`,
  }));
  await page.goto('/fleet-dashboard.html');
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');
  await expect(page.locator('.score-source')).toHaveText([
    'Web camera (MediaPipe EAR)', 'iPhone (ML Kit eye probability)',
    'Android (ML Kit eye probability)', 'Not recorded', 'Not recorded',
  ]);
  await expect(page.locator('#scoreComparisonNote')).toContainText('Compare trends within the same recorded source');
  await expect(page.locator('#drivers img')).toHaveCount(0);
});
