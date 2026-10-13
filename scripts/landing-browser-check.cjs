// ทดสอบหน้าแนะนำ (landing) ผ่านเบราว์เซอร์: การแสดงผล ภาพเคลื่อนไหว เมนู และ error ใน console
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.push(m.text())});
await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:3001');
const host=page.locator('#entry-landing');await host.locator('.ring-card').first().waitFor({state:'attached'});await page.waitForTimeout(2500);
if(await host.locator('.ring-card').count()!==37)throw Error('Ring missing');
await page.screenshot({path:'tmp/integrated-landing.png'});
const card=host.locator('.ring-card').first();const before=await card.evaluate(e=>e.style.transform);await page.waitForTimeout(350);if(before===await card.evaluate(e=>e.style.transform))throw Error('Not rotating');
await page.mouse.wheel(0,1100);await page.waitForFunction(()=>scrollY>800);await page.locator('#search').fill('Ember');await page.waitForFunction(()=>document.querySelectorAll('#cards>.card').length===1);
await page.locator('#cards>.card').first().hover();await page.locator('#card-preview').waitFor({state:'visible'});await page.keyboard.press('Escape');
await page.locator('#cards>.card').first().click();await page.locator('#product-image').waitFor();if(await host.isVisible())throw Error('Intro shown on detail page');
await page.locator('.breadcrumbs a').first().click();await page.locator('#search').waitFor({state:'visible'});
await page.evaluate(()=>scrollTo(0,0));await host.locator('.cta2').click();await page.waitForFunction(()=>scrollY>=document.querySelector('#entry-landing').offsetHeight-5);
await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(400);await page.screenshot({path:'tmp/integrated-landing-mobile.png'});
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
await host.locator('.burger').click();await host.locator('[data-view="graded"]').click();await page.waitForFunction(()=>document.querySelector('#grading-filter').value==='graded');
await page.evaluate(()=>scrollTo(0,0));await page.emulateMedia({reducedMotion:'reduce'});const still=await card.evaluate(e=>e.style.transform);await page.waitForTimeout(300);if(still!==await card.evaluate(e=>e.style.transform))throw Error('Reduced motion ignored');
if(errors.length)throw Error(errors.join('\n'));console.log('Passed: rotating entry, native wheel scroll, real search/hover/detail, CTA, mobile menu, grade filter, reduced motion and CSP.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
