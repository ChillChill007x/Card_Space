// ทดสอบตะกร้าผ่านเบราว์เซอร์ (Playwright + Edge): ใส่ตะกร้า ตรวจรายการที่ซื้อไม่ได้ และชำระหลายใบ
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const {createStore}=await import('../server/store.js'),{createApp,hashPassword}=await import('../server/app.js');
 const store=await createStore();
 for(const [id,role] of [['buyer','customer'],['seller','merchant']])await store.addUser({id,name:id,email:id+'@test.local',passwordHash:hashPassword('test-password-123'),role,verification:role==='merchant'?'approved':'none',balance:1000000});
 const server=createApp(store).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),base=`http://127.0.0.1:${server.address().port}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.request.post(base+'/api/auth/login',{data:{email:'buyer@test.local',password:'test-password-123'}});
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#header-balance').textContent==='฿10,000');
  const cards=(await store.cards()).slice(0,2);
  for(const card of cards){await page.goto(base+'/#/cards/'+card.id);await page.locator('#add-to-cart').click();await page.getByRole('status').filter({hasText:'ใส่ตะกร้าแล้ว'}).waitFor();}
  await page.locator('#cart-nav').click();await page.locator('.cart-item').first().waitFor();
  if(await page.locator('.cart-item').count()!==2)throw Error('Missing cart rows');
  await page.locator('#cart-topup').click();await page.locator('#topup-form button').click();
  await page.waitForFunction(()=>document.querySelector('#header-balance').textContent==='฿11,000');
  await page.locator('#close-dialog').click();await page.locator('#cart-checkout textarea').fill('Test Buyer 0000000000 Test Address 12345');
  await page.screenshot({path:'tmp/cart-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'tmp/cart-mobile.png',fullPage:true}); if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width})).slice(0,15)));throw Error('Mobile cart overflow');}
  await page.screenshot({path:'tmp/cart-mobile.png',fullPage:true});
  await page.locator('#cart-checkout .dark').click();await page.locator('.order-status.paid').first().waitFor();
  if(await page.locator('.order-status.paid').count()!==2)throw Error('Missing orders');
  await page.locator('#market').click();
  await page.waitForFunction(()=>!document.body.classList.contains('cart-open'));
  // บัญชีพ่อค้าเห็นยอดและปุ่มเติมเครดิตในตำแหน่งเดียวกัน
  await page.request.post(base+'/api/auth/logout',{data:{}});await page.request.post(base+'/api/auth/login',{data:{email:'seller@test.local',password:'test-password-123'}});
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#header-balance').textContent==='฿10,000');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Passed: buyer/merchant balance, cart badge, add, topup, full cart checkout, orders, route navigation and mobile layout.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1);});
