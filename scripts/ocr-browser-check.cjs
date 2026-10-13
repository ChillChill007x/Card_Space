// ทดสอบปุ่มอ่านข้อมูลจากรูป (OCR) ในฟอร์มลงขายผ่านเบราว์เซอร์
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const { createStore } = await import('../server/store.js');
  const { createApp, hashPassword } = await import('../server/app.js');
  const store = await createStore();
  await store.addUser({ id:'ocr-seller', name:'OCR Seller', email:'ocr@test.local', passwordHash:hashPassword('test-password-123'), role:'merchant', verification:'approved', balance:0 });
  const server=createApp(store).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base=`http://127.0.0.1:${server.address().port}`;
    await page.request.post(base+'/api/auth/login',{data:{email:'ocr@test.local',password:'test-password-123'}});
    await page.goto(base); await page.locator('#header-sell').click();
    const data=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=1400;c.height=800;
      const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='48px Arial';
      ['PSA','POKEMON','NAME: PIKACHU','SET: VAN GOGH PROMO','GEM MINT 10','CERT: 12345678','ENGLISH'].forEach((line,i)=>x.fillText(line,60,85+i*90));
      return c.toDataURL('image/webp',.95).split(',')[1];
    });
    // จำลอง WebP ที่ถูกตั้งนามสกุล JPEG ซึ่งระบบเดิมปฏิเสธแม้แสดง preview ได้
    await page.locator('#listing-form input[type=file]').first().setInputFiles({name:'card.jpg',mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')});
    await page.waitForFunction(()=>document.querySelector('[name=image]').value.startsWith('/api/uploads/'));
    const url=await page.locator('[name=image]').inputValue();
    const uploaded=await page.request.get(base+url);
    if(!uploaded.headers()['content-type'].includes('image/jpeg'))throw Error('Photo was not normalized');
    await page.getByRole('button',{name:'ใช้ข้อมูลที่เลือก'}).waitFor({timeout:60000});
    await page.getByRole('button',{name:'ใช้ข้อมูลที่เลือก'}).click();
    for(const [key,value] of Object.entries({name:'PIKACHU',set:'VAN GOGH PROMO',gradingCompany:'PSA',gradingGrade:'10',gradingCertificate:'12345678'})){
      if(await page.locator(`[name=${key}]`).inputValue()!==value)throw Error(`OCR field mismatch: ${key}`);
    }
    await page.locator('[name=rarity]').fill('Promo');await page.locator('[name=price]').fill('100');
    await page.locator('#listing-form > button.dark').click();
    await page.waitForFunction(()=>!document.querySelector('#dialog').open);
    if(!(await store.cards()).some(c=>c.name==='PIKACHU'&&c.grading?.grade==='10'))throw Error('Listing not saved');
    if(errors.length)throw Error(errors.join('\n'));
    console.log('Passed: mismatched WebP/JPEG normalization, immediate URL fill, real local OCR, reviewed autofill, graded listing save.');
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1);});
