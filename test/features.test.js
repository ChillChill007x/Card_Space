import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, hashPassword } from '../server/app.js';
import { createStore } from '../server/store.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function boot() {
  const store = await createStore();
  await store.addUser({ id: 'admin', name: 'Admin', email: 'admin@f.local', passwordHash: hashPassword('test-password-123'), role: 'admin', verification: 'none', balance: 0 });
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body, cookie = '', key) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  return { store, server, call };
}

test('buyer reviews a completed order once; rating shows on shop and product; notifications track pending work', async () => {
  const { store, server, call } = await boot();
  try {
    const admin = await call('/auth/login', 'POST', { email: 'admin@f.local', password: 'test-password-123' });
    const seller = await call('/auth/register', 'POST', { name: 'Seller', email: 's@f.local', password: 'test-password-123', role: 'merchant' });
    await call('/merchant/application', 'POST', { fullName: 'S', shopName: 'Review Shop', phone: '0812345678', address: 'Somewhere 123', evidence: png }, seller.cookie);
    assert.ok((await call('/notifications', 'GET', null, admin.cookie)).body.items.some(i => i.href === '#/admin'));
    await call(`/admin/merchants/${seller.body.id}`, 'PATCH', { verification: 'approved' }, admin.cookie);
    const card = (await call('/cards', 'POST', { name: 'Review card', category: 'Pokémon', set: 'TEST', rarity: 'SR', condition: 'Near Mint', price: 10000, image: '/art/fire.svg', character: 'Pikachu' }, seller.cookie)).body;
    const buyer = await call('/auth/register', 'POST', { name: 'Somchai', email: 'b@f.local', password: 'test-password-123', role: 'customer' });
    await call('/wallet/topup', 'POST', { amount: 100000 }, buyer.cookie, 'feature-topup-1234567');
    const order = (await call('/orders', 'POST', { cardId: card.id, expectedPrice: 10000, address: 'Somchai 0812345678 Bangkok' }, buyer.cookie, 'feature-buy-123456789')).body;
    const sellerNote = (await call('/notifications', 'GET', null, seller.cookie)).body;
    assert.deepEqual(sellerNote.items.find(i => i.href === '#/orders/sales'), { label: 'คำสั่งซื้อใหม่รอจัดส่ง', count: 1, href: '#/orders/sales' });
    assert.equal((await call(`/orders/${order.id}/review`, 'POST', { rating: 5 }, buyer.cookie)).status, 409);
    await call(`/orders/${order.id}`, 'PATCH', { action: 'ship', tracking: 'TRACK 1', shipmentImage: png }, seller.cookie);
    assert.equal((await call('/notifications', 'GET', null, seller.cookie)).body.total, 0);
    assert.equal((await call('/notifications', 'GET', null, buyer.cookie)).body.items[0].count, 1);
    await call(`/orders/${order.id}`, 'PATCH', { action: 'receive', receiptImage: png }, buyer.cookie);
    assert.ok((await call('/notifications', 'GET', null, buyer.cookie)).body.items.some(i => /ให้คะแนน/.test(i.label)));
    assert.equal((await call(`/orders/${order.id}/review`, 'POST', { rating: 5 }, seller.cookie)).status, 403);
    assert.equal((await call(`/orders/${order.id}/review`, 'POST', { rating: 6 }, buyer.cookie)).status, 400);
    const reviews = await Promise.all([1, 2].map(() => call(`/orders/${order.id}/review`, 'POST', { rating: 4, comment: 'แพ็กดี ส่งไว' }, buyer.cookie)));
    assert.deepEqual(reviews.map(r => r.status).sort(), [201, 409]);
    assert.equal((await call('/notifications', 'GET', null, buyer.cookie)).body.total, 0);
    const shop = (await call(`/merchants/${seller.body.id}`)).body;
    assert.equal(shop.rating.average, 4); assert.equal(shop.rating.count, 1);
    assert.equal(shop.rating.items[0].buyerName, 'S***');
    assert.equal(shop.rating.items[0].buyerId, undefined);
    assert.deepEqual((await call(`/cards/${card.id}`)).body.sellerRating, { average: 4, count: 1 });
    assert.equal((await call('/orders', 'GET', null, buyer.cookie)).body.items[0].review.rating, 4);
  } finally { await new Promise(r => server.close(r)); }
});

test('related cards favour the same character, exclude sold cards and the card itself', async () => {
  const { store, server, call } = await boot();
  try {
    const base = { category: 'Pokémon', set: 'Base', rarity: 'R', condition: 'Near Mint', image: '/art/fire.svg', sellerId: 'sample-merchant', sellerName: 'Sample', createdAt: new Date().toISOString() };
    await store.addCard({ ...base, id: 'pika-1', name: 'Pikachu A', character: 'Pikachu', price: 1000 });
    await store.addCard({ ...base, id: 'pika-2', name: 'Pikachu B', character: 'Pikachu', price: 1200 });
    await store.addCard({ ...base, id: 'pika-sold', name: 'Pikachu C', character: 'Pikachu', price: 1100 });
    await store.claimCard('pika-sold', 1100, 'some-order');
    const related = (await call('/cards/pika-1/related')).body;
    assert.equal(related[0].id, 'pika-2');
    assert.ok(related.length <= 6);
    assert.ok(!related.some(c => c.id === 'pika-1' || c.id === 'pika-sold'));
    assert.ok(related.every(c => c.category === 'Pokémon'));
    assert.equal((await call('/cards/missing/related')).status, 404);
  } finally { await new Promise(r => server.close(r)); }
});

test('phone numbers accept Thai digits only; dashes and spaces are stripped', async () => {
  const { server, call } = await boot();
  try {
    const user = await call('/auth/register', 'POST', { name: 'Phone', email: 'phone@f.local', password: 'test-password-123', role: 'merchant' });
    const address = phone => ({ shippingAddress: { recipient: 'Phone', phone, address: '123 Test Road Bangkok 10100' } });
    assert.equal((await call('/profile', 'PATCH', address('081-234 5678'), user.cookie)).status, 200);
    assert.equal((await call('/profile', 'GET', null, user.cookie)).body.shippingAddress.phone, '0812345678');
    assert.equal((await call('/profile', 'PATCH', address('021234567'), user.cookie)).status, 200);
    for (const bad of ['abc12345678', '+66812345678', '(081)2345678', '12345', '08123456789']) assert.equal((await call('/profile', 'PATCH', address(bad), user.cookie)).status, 400, bad);
    const application = { fullName: 'P', shopName: 'Phone Shop', address: 'Somewhere 123', evidence: png };
    assert.equal((await call('/merchant/application', 'POST', { ...application, phone: '+66 81 234 5678' }, user.cookie)).status, 400);
    assert.equal((await call('/merchant/application', 'POST', { ...application, phone: '081-234-5678' }, user.cookie)).body.application.phone, '0812345678');
  } finally { await new Promise(r => server.close(r)); }
});
