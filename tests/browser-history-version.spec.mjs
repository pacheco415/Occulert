import {test,expect} from '@playwright/test';
const key='occulert-session-history';
test('valid browser history migration commits stable IDs and preserves original fields across reload',async({page})=>{
 const original=[{savedAt:'2026-10-03T10:00:00Z',unknown:{keep:true},safetyScore:72},{savedAt:'2026-10-03T10:00:00Z'}];
 await page.addInitScript(({key,original})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(original))},{key,original});
 await page.goto('/session-history.html');await expect(page.locator('#sessions')).toHaveText('2');
 const first=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
 expect(first[0].localRecordId).toBeTruthy();expect(first[1].localRecordId).not.toBe(first[0].localRecordId);expect(first.map(({localRecordId,historyVersion,...row})=>row)).toEqual(original);
 await page.reload();await expect(page.locator('#sessions')).toHaveText('2');expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)).toEqual(first);
});
test('unreadable browser history stays preserved and is disclosed instead of appearing empty',async({page})=>{
 const raw='[{"unknown":"preserve"},null]';await page.addInitScript(({key,raw})=>localStorage.setItem(key,raw),{key,raw});
 await page.goto('/session-history.html');await expect(page.getByRole('heading',{name:'Local history unavailable'})).toBeVisible();await expect(page.locator('#sessions')).toHaveText('--');
 await page.getByRole('button',{name:'Refresh',exact:true}).click();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw);
});
test('failed browser history migration does not expose transient IDs or overwrite saved data',async({page})=>{
 const raw='[{"savedAt":"2026-10-03T10:00:00Z","unknown":42}]';
 await page.addInitScript(({key,raw})=>{localStorage.setItem(key,raw);const original=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===key)throw Error('quota denied');return original.call(this,name,value)}},{key,raw});
 await page.goto('/session-history.html');await expect(page.getByRole('heading',{name:'Local history unavailable'})).toBeVisible();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw);
});
