import { test, expect } from '@playwright/test';

test('driver scores identify recorded methods and leave unknown metadata unclassified', async ({ page }) => {
  await page.goto('/fleet-dashboard.html');
  await page.evaluate(() => {
    document.getElementById('drivers').innerHTML = [
      { name:'Web Driver', detectorPipeline:'web_mediapipe_ear' },
      { name:'iPhone Driver', detectorPipeline:'ios_mlkit_eye_probability' },
      { name:'Android Driver', detectorPipeline:'android_mlkit_eye_probability' },
      { name:'Legacy Driver' },
      { name:'Invalid Driver', detectorPipeline:'<img src=x onerror=alert(1)>' },
    ].map((row, i) => driverRow(normalize({ ...row, driverId:String(i), hasSession:true, safetyScore:80, lastUpdate:new Date().toISOString() }))).join('');
  });
  await expect(page.locator('.score-source')).toHaveText([
    'Web camera (MediaPipe EAR)', 'iPhone (ML Kit eye probability)',
    'Android (ML Kit eye probability)', 'Not recorded', 'Not recorded',
  ]);
  await expect(page.locator('#scoreComparisonNote')).toContainText('Compare trends within the same recorded source');
  await expect(page.locator('#drivers img')).toHaveCount(0);
});
