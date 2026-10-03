import {test,expect} from '@playwright/test';
test('local History keeps missing values unknown in cards, totals and CSV',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('occulert-session-history',JSON.stringify([
    {id:'zero',name:'Zero record',alerts:0,headNods:0,safetyScore:0,avgFatigue:0,maxFatigue:0,savedAt:'2026-10-03T12:00:00Z'},
    {id:'partial',name:'Partial record',alerts:2,headNods:1.5,safetyScore:101,avgFatigue:false,maxFatigue:null,savedAt:'2026-02-30T12:00:00Z',recoveredInterrupted:true,unknown:{keep:true}}
  ])));
  await page.goto('/session-history.html');
  await expect(page.locator('#alerts')).toHaveText('2');
  await expect(page.locator('#nods')).toHaveText('0 (partial)');
  await expect(page.locator('#avgScore')).toHaveText('0');
  await expect(page.locator('#table')).toContainText('Partial session');
  await expect(page.locator('#table')).toContainText('-- head nods');
  await expect(page.locator('#table')).not.toContainText('Invalid Date');
  const csv=await page.evaluate(()=>buildCSV());
  expect(csv).not.toContain('2026-02-30');
  expect(csv).not.toContain('false');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-session-history')));
  expect(stored[1].headNods).toBe(1.5);
  expect(stored[1].savedAt).toBe('2026-02-30T12:00:00Z');
  expect(stored[1].unknown).toEqual({keep:true});
});
