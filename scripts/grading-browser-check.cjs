// ทดสอบฟอร์มเกรด PSA/BGS/CGC ผ่านเบราว์เซอร์: เพิ่ม/แก้ไขเกรด การกรอง และการล้างใบรับรองเมื่อเปลี่ยนเป็น Raw
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const { createStore } = await import('../server/store.js');
  const { createApp, hashPassword } = await import('../server/app.js');
  const store = await createStore();
  await store.addUser({ id:'grade-seller', name:'Grading Seller', email:'grade@test.local', passwordHash:hashPassword('test-password-123'), role:'merchant', verification:'approved', balance:0 });
  await store.addCard({ id:'grade-card', name:'Grading Test Card', category:'Pokémon', set:'TEST001', rarity:'SR', condition:'Near Mint', price:10000, image:'/art/fire.svg', sellerId:'grade-seller', sellerName:'Grading Seller', createdAt:new Date().toISOString() });
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening',r));
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  try {
    const page = await browser.newPage(); const errors=[];page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('.card').first().waitFor();
    await page.locator('#account').click();
    await page.locator('[name="email"]').fill('grade@test.local');
    await page.locator('[name="password"]').fill('test-password-123');
    await page.locator('#auth-form .dark').click();
    await page.waitForFunction(()=>document.querySelector('#account').textContent.includes('Grading Seller'));
    await page.locator('[data-id="grade-card"]').click();
    await page.locator('#edit').click();
    await page.locator('[name="gradingCompany"]').selectOption('PSA');
    if (await page.locator('[name="gradingGrade"] option[value="9.5"]').count()) throw Error('Invalid PSA option');
    await page.locator('[name="gradingGrade"]').selectOption({label:'10'});
    await page.locator('[name="gradingCertificate"]').fill('TEST-123456');
    await page.locator('#listing-form .dark').click();
    await page.waitForFunction(()=>document.querySelector('.grading-panel')?.textContent.includes('PSA 10'));
    if (!(await page.locator('.grading-panel').textContent()).includes('TEST-123456')) throw Error('Missing certificate');
    await page.locator('.breadcrumbs a').first().click();
    await page.locator('#grading-filter').selectOption('PSA');
    await page.waitForFunction(()=>document.querySelectorAll('.card').length===1);
    await page.locator('.card').hover();
    await page.locator('.preview-grade').waitFor({state:'visible'});
    if (!(await page.locator('.preview-grade').textContent()).includes('PSA 10')) throw Error('Missing preview grade');
    await page.keyboard.press('Escape');
    await page.locator('.card').click();
    await page.locator('#edit').click();
    await page.locator('[name="gradingCompany"]').selectOption('');
    await page.locator('#listing-form .dark').click();
    await page.waitForFunction(()=>document.querySelector('.grading-panel')?.textContent.includes('ไม่ส่งเกรด'));
    if ((await store.cards()).find(c=>c.id==='grade-card').grading !== null) throw Error('Certificate persisted after reset to Raw');
    await page.setViewportSize({width:390,height:844});
    if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Mobile overflow');
    if(errors.length)throw Error(errors.join('\n'));
    console.log('Passed: seller form, save PSA grade/certificate, filtering, preview, full-page details, reset to Raw, mobile layout.');
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exit(1);});
