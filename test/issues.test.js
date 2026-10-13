import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createApp, hashPassword } from '../server/app.js';
import { createStore } from '../server/store.js';
import { readCardImage } from '../server/card-ocr.js';

async function boot(store) {
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body, cookie = '', key) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  return { server, call };
}
// สร้างพ่อค้าที่อนุมัติแล้วพร้อมการ์ดหนึ่งใบ
async function merchantWithCard(store, call, email) {
  const seller = await call('/auth/register', 'POST', { name: 'Seller', email, password: 'test-password-123', role: 'merchant' });
  await store.updateUser(seller.body.id, { verification: 'approved', application: { shopName: 'Shop', submittedAt: new Date().toISOString() } });
  const card = { name: 'Race card', category: 'Pokémon', set: 'TEST', rarity: 'SR', condition: 'Near Mint', price: 10000, image: '/art/fire.svg' };
  const listing = await call('/cards', 'POST', card, seller.cookie);
  return { seller, card, listing: listing.body };
}

test('storefront and order history stay readable in production; transactions stay disabled', async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const store = await createStore();
  const { server, call } = await boot(store);
  try {
    const { seller, listing } = await merchantWithCard(store, call, 'prod-seller@test.local');
    const shop = await call(`/merchants/${seller.body.id}`);
    assert.equal(shop.status, 200);
    assert.ok(shop.body.cards.some(c => c.id === listing.id));
    assert.equal((await call('/merchants/sample-merchant')).status, 200);
    assert.equal((await call('/orders', 'GET', null, seller.cookie)).status, 200);
    assert.equal((await call('/wallet/topup', 'POST', { amount: 10000 }, seller.cookie, 'prod-topup-1234567')).status, 409);
  } finally { await new Promise(r => server.close(r)); process.env.NODE_ENV = previous; }
});

test('listings of suspended merchants are hidden from the market and not purchasable', async () => {
  const store = await createStore();
  const { server, call } = await boot(store);
  try {
    const { seller, listing } = await merchantWithCard(store, call, 'suspend@test.local');
    assert.ok((await call('/cards')).body.some(c => c.id === listing.id));
    await store.updateUser(seller.body.id, { verification: 'rejected' });
    assert.ok(!(await call('/cards')).body.some(c => c.id === listing.id));
    assert.ok(!(await call('/cards?q=race')).body.some(c => c.id === listing.id));
    const detail = (await call(`/cards/${listing.id}`)).body;
    assert.equal(detail.purchasable, false);
    assert.equal(detail.soldOrderId, undefined);
    assert.ok((await call('/cards?mine=1', 'GET', null, seller.cookie)).body.some(c => c.id === listing.id));
    assert.equal((await call('/cards?limit=2&page=1')).body.length, 2);
  } finally { await new Promise(r => server.close(r)); }
});

test('HTTP purchase racing an edit or delete never leaves a mismatched order', async () => {
  const store = await createStore();
  await store.addUser({ id: 'admin', name: 'Admin', email: 'admin@race.local', passwordHash: hashPassword('test-password-123'), role: 'admin', verification: 'none', balance: 0 });
  const { server, call } = await boot(store);
  try {
    const buyer = await call('/auth/register', 'POST', { name: 'Buyer', email: 'buyer@race.local', password: 'test-password-123', role: 'customer' });
    await call('/wallet/topup', 'POST', { amount: 10000000 }, buyer.cookie, 'race-topup-12345678');
    for (let i = 0; i < 8; i++) {
      const { seller, card, listing } = await merchantWithCard(store, call, `race${i}@test.local`);
      const [bought, edited] = await Promise.all([
        call('/orders', 'POST', { cardId: listing.id, expectedPrice: card.price, address: 'Race recipient 0812345678 Bangkok' }, buyer.cookie, `race-buy-${i}-12345678`),
        call(`/cards/${listing.id}`, 'PUT', { ...card, name: 'Renamed after sale?' }, seller.cookie)
      ]);
      assert.ok(!(bought.status === 201 && edited.status === 200 && bought.body.card.name !== 'Renamed after sale?'));
      if (bought.status === 201) {
        assert.equal(bought.body.card.name, (await call(`/cards/${listing.id}`)).body.name);
        assert.equal((await call(`/cards/${listing.id}`, 'DELETE', null, seller.cookie)).status, 409);
      }
    }
  } finally { await new Promise(r => server.close(r)); }
});

test('server refuses to start without MONGODB_URI unless --demo is given', () => {
  const { MONGODB_URI, ...env } = process.env;
  const script = fileURLToPath(new URL('../server/index.js', import.meta.url));
  const result = spawnSync(process.execPath, [script], { env: { ...env, PORT: '0' }, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MONGODB_URI/);
});

test('OCR rejects images too small to crop instead of failing inside sharp', async () => {
  const tiny = await sharp({ create: { width: 40, height: 12, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(readCardImage(tiny), e => e.status === 400 && /เล็กเกินไป/.test(e.message));
});
