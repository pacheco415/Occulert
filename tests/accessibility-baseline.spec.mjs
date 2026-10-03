import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {writeFile} from 'node:fs/promises';
const pages=['about','accept-invite','account','app','driver-profiles','faq','features','fleet-dashboard','fleet-display','fleet-history','fleet-onboarding','fleet-pricing','how-it-works','index','install','login','pilot-guide','pilot-leads','pilot-signup','privacy','product-hub','safety','session-history','support'];
test.use({viewport:{width:390,height:844}});
for(const theme of ['dark','light'])for(const name of pages)test(`automated WCAG baseline: /${name}.html signed out on mobile (${theme})`,async({page},testInfo)=>{
 await page.addInitScript(theme=>localStorage.setItem('occulert-theme',theme),theme);
 await page.emulateMedia({colorScheme:theme});
 await page.goto('/'+name+'.html',{waitUntil:'load'});
 await page.getByRole('heading',{level:1}).first().waitFor();
 await page.evaluate(()=>document.fonts.ready);
 // Theme changes animate colors. Inspect the settled state, preserving real
 // transitions rather than injecting styles that would hide accessibility bugs.
 await page.evaluate(async()=>{const finite=document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime));await Promise.allSettled(finite.map(animation=>animation.finished))});
 const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 const summary={page:name+'.html',requestedTheme:theme,actualTheme:await page.evaluate(()=>document.documentElement.getAttribute('data-theme')),viewport:{width:390,height:844},engine:testInfo.project.name,axeVersion:results.testEngine.version,violations:results.violations.map(({id,impact,description,helpUrl,nodes})=>({id,impact,description,helpUrl,targets:nodes.map(node=>node.target),details:nodes.map(node=>node.failureSummary)})),incomplete:results.incomplete.map(({id,nodes})=>({id,targets:nodes.map(node=>node.target)})),computedFailures:await page.evaluate(targets=>targets.map(selector=>{const element=document.querySelector(selector);if(!element)return {selector,missing:true};const style=getComputedStyle(element),rect=element.getBoundingClientRect();return {selector,color:style.color,background:style.backgroundColor,textFill:style.webkitTextFillColor,display:style.display,width:rect.width,height:rect.height}}),results.violations.flatMap(rule=>rule.nodes.map(node=>node.target[0]))),manualReviewRequired:true};
 const reportPath=testInfo.outputPath('accessibility-report.json');await writeFile(reportPath,JSON.stringify(summary,null,2));
 await testInfo.attach('accessibility-report',{path:reportPath,contentType:'application/json'});
 expect(summary.violations,JSON.stringify(summary.violations,null,2)).toEqual([]);
});
