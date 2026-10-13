// ทดสอบหน้าโปรไฟล์ของทั้ง 3 บทบาทผ่านเบราว์เซอร์: แก้ชื่อ รูปโปรไฟล์ และที่อยู่จัดส่ง
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const {createStore}=await import('../server/store.js'),{createApp,hashPassword}=await import('../server/app.js');
 const store=await createStore(),password='profile-test-password';
 for(const role of ['customer','merchant','admin'])await store.addUser({id:role,name:role,email:role+'@test.local',role,verification:role==='merchant'?'approved':'none',passwordHash:hashPassword(password),balance:1000000});
 await store.addCard({id:'profile-card',name:'Profile Card',sellerId:'merchant',sellerName:'Test Shop',image:'/art/fire.svg',category:'Pokémon',set:'Test',condition:'Near Mint',rarity:'SR',price:10000,createdAt:new Date().toISOString()});
 const server=createApp(store).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const base=`http://127.0.0.1:${server.address().port}`,page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 assert.equal((await page.request.get(base+'/api/profile')).status(),401);
 for(const role of ['customer','merchant','admin']){
 await page.request.post(base+'/api/auth/login',{data:{email:role+'@test.local',password}});
 await page.goto(base+'/#/profile');await page.reload();await page.locator('#profile-form').waitFor();
 await page.locator('#account').click();await page.locator('#account-menu').waitFor();
 assert.equal(await page.locator('dialog[open]').count(),0);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#account-menu').isVisible(),false);
 await page.locator('#account').click();await page.locator('#account-profile').click();await page.locator('#profile-form').waitFor();
 assert.equal(await page.locator('#account-menu').isVisible(),false);
 assert.equal(await page.locator('#address-form [name=address]').inputValue(),'');
 await page.locator('#profile-form [name=name]').fill('Updated '+role);
 const png=await page.screenshot();await page.locator('#avatar-file').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
 await page.waitForFunction(()=>document.querySelector('#profile-avatar').src.startsWith('data:image/jpeg'));
 await page.locator('#profile-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#account').textContent.includes('Updated'));
 await page.locator('#address-form [name=recipient]').fill('Recipient '+role);
 await page.locator('#address-form [name=phone]').fill('0812345678');await page.locator('#address-form [name=address]').fill('123 Sample Road Bangkok 10100');
 await page.locator('#address-form button.dark').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent==='บันทึกที่อยู่แล้ว');
 await page.reload();await page.locator('#address-form').waitFor();assert.equal(await page.locator('#address-form [name=phone]').inputValue(),'0812345678');
 assert.ok((await page.request.get(base+'/api/profile').then(r=>r.json())).avatar.startsWith('data:image/jpeg'));
 if(role==='merchant'){
 const detail=await page.request.get(base+'/api/cards/profile-card').then(r=>r.json());assert.ok(detail.sellerAvatar.startsWith('data:image/jpeg'));assert.equal(detail.shippingAddress,undefined);assert.equal(detail.email,undefined);
 await page.goto(base+'/#/cards/profile-card');await page.locator('.seller-avatar img').waitFor();
 assert.ok((await page.locator('.seller-avatar img').getAttribute('src')).startsWith('data:image/jpeg'));
 }
 await page.request.patch(base+'/api/profile',{data:{role:'admin',verification:'approved',id:'admin'}});
 assert.equal((await page.request.get(base+'/api/auth/me').then(r=>r.json())).role,role);
 assert.equal((await page.request.patch(base+'/api/profile',{data:{shippingAddress:{recipient:'X'}}})).status(),400);
 if(role==='customer'){
 await page.goto(base+'/#/cards/sample-5');await page.locator('#buy-card').click();await page.locator('#checkout-form').waitFor();assert.equal(await page.locator('[name=recipient]').inputValue(),'Recipient customer');
 await page.request.post(base+'/api/cart',{data:{cardId:'sample-5'}});await page.goto(base+'/#/cart');await page.locator('#cart-checkout').waitFor();assert.match(await page.locator('#cart-checkout textarea').inputValue(),/Recipient customer/);
 }
 await page.goto(base+'/#/profile');await page.locator('#profile-form').waitFor();await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'tmp/profile-mobile.png',fullPage:true});
 await page.locator('#remove-address').click();await page.waitForFunction(()=>document.querySelector('#address-form [name=address]')?.value==='');
 await page.request.post(base+'/api/auth/logout');
 }
 assert.deepEqual(errors,[]);console.log('Passed: all roles profile/avatar, address persistence across reload, privacy, protected roles, checkout and cart autofill, removal, mobile.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
