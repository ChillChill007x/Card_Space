// ทดสอบหน้าร้านสาธารณะผ่านเบราว์เซอร์: ข้อมูลร้าน การค้นหาการ์ดในร้าน และการเปิดหน้าการ์ด
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const {createStore}=await import('../server/store.js');const {createApp}=await import('../server/app.js');
 const store=await createStore();const server=createApp(store).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const card=(await store.cards())[0];await page.goto(`http://127.0.0.1:${server.address().port}/#/cards/${card.id}`);
 await page.locator('.seller-profile-link').click();await page.locator('.public-shop-card').first().waitFor();
 assert.match(await page.locator('#merchant-profile').innerText(),/รายการที่ขายสำเร็จ/);
 await page.screenshot({path:'.local-runtime/shop-desktop.png',fullPage:true});
 assert.ok(await page.locator('.public-shop-header').evaluate(el=>[...el.children].every(c=>c.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom)));

 await page.getByRole('searchbox',{name:'ค้นหาการ์ดในร้าน'}).fill('not-present-xyz');await page.locator('.public-shop-empty').waitFor();
 await page.reload();await page.locator('.public-shop-card').first().waitFor();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'.local-runtime/shop-mobile.png',fullPage:true});await page.locator('.public-shop-card').first().click();await page.locator('.seller-profile-link').waitFor();await page.locator('.seller-profile-link').scrollIntoViewIfNeeded();await page.screenshot({path:'.local-runtime/seller-mobile.png'});assert.deepEqual(errors,[]);
 console.log('Passed: public seller link, reload, search, mobile layout, return to product, no JavaScript errors');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
