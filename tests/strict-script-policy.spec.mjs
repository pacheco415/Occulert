import {test,expect} from '@playwright/test';
test('CSP blocks injected inline scripts and event attributes while sign-in controls still work',async({page})=>{
 await page.addInitScript(()=>{window.policyViolations=[];document.addEventListener('securitypolicyviolation',event=>policyViolations.push(event.effectiveDirective))});
 const response=await page.goto('/login.html');const policy=response.headers()['content-security-policy'];
 expect(policy.match(/script-src ([^;]+)/)[1]).not.toContain("'unsafe-inline'");
 await page.locator('#signUpModeBtn').click();
 await expect(page.locator('#profileFields')).toBeVisible();
 await page.evaluate(()=>{const script=document.createElement('script');script.textContent='window.injectedScriptRan=true';document.body.appendChild(script);const button=document.createElement('button');button.id='injectedHandler';button.textContent='Injected action';button.setAttribute('onclick','window.injectedHandlerRan=true');document.body.appendChild(button)});
 await page.locator('#injectedHandler').click();
 await expect.poll(()=>page.evaluate(()=>policyViolations.length)).toBeGreaterThanOrEqual(2);
 expect(await page.evaluate(()=>Boolean(window.injectedScriptRan||window.injectedHandlerRan))).toBe(false);
});
test('external homepage bootstrap preserves recovery fragments before account setup',async({page})=>{
 await page.route('**/account.html?recovery=1',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Recovery handoff fixture</title><h1>Recovery handoff</h1>'}));
 await page.goto('/#access_token=synthetic-recovery-token&type=recovery');
 await expect(page).toHaveURL(/\/account\.html\?recovery=1#access_token=synthetic-recovery-token&type=recovery$/);
});
test('generated dashboard actions pass encoded driver identity through listeners under CSP',async({page})=>{
 await page.goto('/fleet-dashboard.html');
 await page.evaluate(()=>{window.copiedDriverArgument=null;window.copyDriver=id=>{window.copiedDriverArgument=id};const button=document.createElement('button');button.id='generatedCopy';button.dataset.pageAction='copy-driver';button.dataset.driverArg=encodeURIComponent('driver-\"<unsafe>');button.textContent='Copy generated driver';document.body.appendChild(button)});
 await page.locator('#generatedCopy').click();expect(await page.evaluate(()=>copiedDriverArgument)).toBe(encodeURIComponent('driver-"<unsafe>'));
 expect(await page.locator('[onclick],[onsubmit],[onchange],[oninput],[ontoggle],[onload]').count()).toBe(0);
});
