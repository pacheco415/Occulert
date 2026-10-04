import { test, expect } from '@playwright/test';
import { assetByStem } from '../scripts/lib/current-assets.mjs';

async function bootLocal(page, metrics) {
  await page.route(`**/${assetByStem('occulert-backend.js')}`, route => route.fulfill({
    contentType: 'application/javascript', body: 'window.OcculertBackend={currentUser:()=>null,getSession:async()=>null};',
  }));
  await page.addInitScript(metrics => {
    localStorage.setItem('occulert-live-session', JSON.stringify({
      id:'record',driverId:'driver',name:'Recorded driver',status:'SAFE',safetyScore:90,
      lastUpdate:new Date().toISOString(),...metrics,
    }));
    window.fixtureClipboard=[];
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.fixtureClipboard.push(text)}});
  }, metrics);
  await page.goto('/fleet-dashboard.html');
  await expect(page.locator('#cloudStatus')).toContainText('Not signed in. Showing same-browser local data only');
  await expect(page.locator('.driver-metrics')).toBeVisible();
}

test('unrecorded and invalid dashboard measurements stay unknown in rows, copy and CSV', async ({page}) => {
  await bootLocal(page, {fatigue:null,confidence:false,perclos:'not a measurement'});
  const metrics=page.locator('.driver-metrics');
  await expect(metrics).toContainText('Fatigue --');
  await expect(metrics).toContainText('Confidence --');
  await expect(metrics).toContainText('PERCLOS --');
  await page.locator('.driver-actions button').click();
  expect(await page.evaluate(()=>window.fixtureClipboard[0])).toContain('fatigue --');
  const csv=await page.evaluate(()=>{
    let captured='';requestDashboardCSVDownload=(value)=>{captured=value};exportFleetCSV();return captured;
  });
  const values=csv.split('\n')[1].split(',');
  expect(values[3]).toBe('""'); expect(values[4]).toBe('""'); expect(values[6]).toBe('""');
});

test('recorded zero remains distinct from unknown dashboard measurements', async ({page}) => {
  await bootLocal(page, {fatigue:0,confidence:0,perclos:0});
  await expect(page.locator('.driver-metrics')).toContainText('Fatigue 0/100');
  await expect(page.locator('.driver-metrics')).toContainText('Confidence 0%');
  await expect(page.locator('.driver-metrics')).toContainText('PERCLOS 0%');
  const values=await page.evaluate(()=>normalize({fatigue:Infinity,confidence:101,perclos:-1}));
  expect(values.fatigue).toBeNull();expect(values.confidence).toBeNull();expect(values.perclos).toBeNull();
});

const persistedScores = [
  {name:'false',metrics:{safetyScore:false},score:null},
  {name:'true',metrics:{safetyScore:true},score:null},
  {name:'an empty array',metrics:{safetyScore:[]},score:null},
  {name:'a numeric array',metrics:{safetyScore:[95]},score:null},
  {name:'an object flagged as recorded',metrics:{safetyScore:{value:95},hasSafetyScore:true},score:null},
  {name:'text flagged as recorded',metrics:{safetyScore:'not a score',hasSafetyScore:true},score:null},
  {name:'false flagged as recorded',metrics:{safetyScore:false,hasSafetyScore:true},score:null},
  {name:'an array flagged as recorded',metrics:{safetyScore:[],hasSafetyScore:true},score:null},
  {name:'a recorded zero',metrics:{safetyScore:0},score:0},
  {name:'a numeric-string zero',metrics:{safetyScore:'0'},score:0},
  {name:'a numeric-string score',metrics:{safetyScore:'72.5'},score:72.5},
  {name:'zero explicitly marked missing',metrics:{safetyScore:0,hasSafetyScore:false},score:null},
];

for (const {name,metrics,score} of persistedScores) {
  test(`persisted local score ${name} stays truthful in rows, copy and CSV`, async ({page}) => {
    await bootLocal(page, {...metrics,detectorPipeline:'web_mediapipe_ear'});
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-live-session')));
    expect(saved.safetyScore).toEqual(metrics.safetyScore);
    if ('hasSafetyScore' in metrics) expect(saved.hasSafetyScore).toBe(metrics.hasSafetyScore);
    await expect(page.locator('.driver-state .pill').first()).toHaveText('SAFE');
    await expect(page.locator('.driver-score strong')).toHaveText(score===null?'--':String(score));
    if (score===null) await expect(page.locator('.score-source')).toHaveCount(0);
    else await expect(page.locator('.score-source')).toHaveText('Web camera (MediaPipe EAR)');
    await page.locator('.driver-actions button').click();
    expect(await page.evaluate(()=>window.fixtureClipboard[0])).toContain(
      score===null?'Score not recorded':`Score ${score}/100`,
    );
    const csv=await page.evaluate(()=>{
      let captured='';requestDashboardCSVDownload=(value)=>{captured=value};exportFleetCSV();return captured;
    });
    expect(csv.split('\n')[1].split(',')[2]).toBe(`"${score===null?'':score}"`);
  });
}

test('protected summaries do not imply confidence or PERCLOS measurements', async ({page}) => {
  await bootLocal(page, {});
  const model=await page.evaluate(()=>{
    const raw=rowsFromFleet({drivers:[{id:'protected',name:'Fleet driver'}],sessions:[{
      driver_id:'protected',started_at:new Date().toISOString(),max_fatigue:0,safety_score:90,
    }]})[0];
    const row=normalize(raw);return{row,html:driverRow(row)};
  });
  expect(model.row.fatigue).toBe(0);
  expect(model.row.confidence).toBeNull();expect(model.row.perclos).toBeNull();
  expect(model.html).toContain('Fatigue 0/100');
  expect(model.html).toContain('Confidence --');expect(model.html).toContain('PERCLOS --');
});
