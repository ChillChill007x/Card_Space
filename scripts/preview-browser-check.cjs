// ทดสอบการ์ดพรีวิวเมื่อชี้เมาส์บนตลาด และเอฟเฟกต์เอียง 3D ผ่านเบราว์เซอร์
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
    await page.goto(base);
    const card = page.locator('.card').first();
    await card.hover();
    await page.locator('#card-preview').waitFor({ state: 'visible' });
    if (await page.locator('dialog[open]').count()) throw Error('Hover must not open a modal');
    if (page.url().includes('#/cards/')) throw Error('Hover navigated to full page');
    const panel = page.locator('#card-preview');
    const bounds = await panel.boundingBox();
    if (bounds.x < 0 || bounds.x + bounds.width > 1440 || bounds.y + bounds.height > 1000) throw Error('Preview outside viewport');
    await panel.locator('.preview-action').hover();
    await page.waitForTimeout(250);
    if (!(await panel.isVisible())) throw Error('Preview closes when moving into it');
    await page.screenshot({ path: 'tmp/hover-preview.png' });
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await page.mouse.move(1,1); await card.hover();
    await panel.waitFor({ state: 'visible' });
    await panel.locator('.preview-link').click();
    await page.locator('#product-image').waitFor();
    await panel.waitFor({ state: 'hidden' });
    await page.locator('.breadcrumbs a').first().click();
    await card.hover(); await panel.waitFor({ state: 'visible' });
    await card.click();
    await page.locator('#product-image').waitFor();
    if (await page.locator('dialog[open]').count()) throw Error('Click must use full page');
    const mobile = await browser.newPage({ viewport: { width:390, height:844 }, isMobile:true, hasTouch:true });
    await mobile.goto(base); await mobile.locator('.card').first().tap();
    await mobile.locator('#product-image').waitFor();
    if (await mobile.locator('#card-preview').isVisible()) throw Error('Touch preview blocked direct navigation');
    if (errors.length) throw Error(errors.join('\n'));
    console.log('Passed: hover preview, pointer transfer, Escape, preview link, direct click full page, touch direct navigation.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
