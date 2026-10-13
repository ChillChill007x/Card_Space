import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, hashPassword } from '../server/app.js';
import { createStore } from '../server/store.js';

test('registration, approval, ownership and listing lifecycle', async () => {
  const store = await createStore();
  await store.addUser({ id: 'admin-test', name: 'Admin', email: 'admin@test.local', passwordHash: hashPassword('test-password-123'), role: 'admin', verification: 'none', balance: 0 });
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(path, method = 'GET', body, cookie = '') {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    assert.equal((await call('/cards?q=ember')).body.length, 1);
    assert.equal((await call('/cards?category=One%20Piece')).body.length, 2);
    assert.equal((await call('/cards', 'POST', {})).status, 401);
    assert.equal((await call('/auth/register', 'POST', { name: 'Bad', email: 'bad@test.local', password: 'test-password-123', role: 'admin' })).status, 400);
    const seller = await call('/auth/register', 'POST', { name: 'Seller', email: 'seller@test.local', password: 'test-password-123', role: 'merchant' });
    assert.equal(seller.status, 201); assert.equal(seller.body.passwordHash, undefined);
    const card = { name: 'Test card', category: 'Pokémon', set: 'Test set', rarity: 'SR', condition: 'Near Mint', price: 12500, image: '/art/fire.svg' };
    assert.equal((await call('/cards', 'POST', card, seller.cookie)).status, 403);
    assert.equal((await call('/admin/merchants', 'GET', null, seller.cookie)).status, 403);
    const admin = await call('/auth/login', 'POST', { email: 'admin@test.local', password: 'test-password-123' });
    assert.equal(admin.status, 200);
    assert.equal((await call(`/admin/merchants/${seller.body.id}`, 'PATCH', { verification: 'approved' }, admin.cookie)).status, 409);
    const application = { fullName: 'Test Seller', shopName: 'Test Shop', phone: '0812345678', address: 'Test address', evidence: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
    assert.equal((await call('/merchant/application', 'POST', application, seller.cookie)).status, 200);
    assert.equal((await call('/auth/me', 'GET', null, seller.cookie)).body.application, undefined);
    assert.equal((await call(`/admin/merchants/${seller.body.id}`, 'PATCH', { verification: 'approved' }, admin.cookie)).status, 200);
    const listing = await call('/cards', 'POST', { ...card, sellerId: 'forged' }, seller.cookie);
    assert.equal(listing.status, 201); assert.equal(listing.body.sellerId, seller.body.id);
    const description = 'รายละเอียดหลายบรรทัด\n' + 'การ์ดตัวอย่าง '.repeat(60);
    const updated = await call(`/cards/${listing.body.id}`, 'PUT', { ...card, description, language: 'ไทย', conditionNotes: 'รอยมุมเล็กน้อย', shippingNotes: 'ซองแข็ง', backImage: '/art/moon.svg' }, seller.cookie);
    assert.equal(updated.status, 200);
    const detail = (await call(`/cards/${listing.body.id}`)).body;
    assert.equal(detail.description, description.trim());
    assert.equal(detail.backImage, '/art/moon.svg');
    assert.equal(detail.sellerApproved, true);
    assert.equal(detail.sold, false);
    const graded = { company: 'PSA', grade: '10', certificate: 'TEST-12345' };
    assert.equal((await call(`/cards/${listing.body.id}`, 'PUT', { ...card, grading: graded }, seller.cookie)).status, 200);
    assert.deepEqual((await call(`/cards/${listing.body.id}`)).body.grading, graded);
    assert.equal((await call('/cards?grading=PSA')).body.length, 1);
    assert.equal((await call('/cards?grading=raw')).body.some(c => c.id === listing.body.id), false);
    for (const grading of [{ ...graded, grade: '9.5' }, { ...graded, grade: '11' }, { ...graded, certificate: '' }, { ...graded, company: 'fake' }]) {
      assert.equal((await call('/cards', 'POST', { ...card, grading }, seller.cookie)).status, 400);
    }
    assert.equal((await call(`/cards/${listing.body.id}`, 'PUT', { ...card, grading: null }, seller.cookie)).status, 200);
    assert.equal((await call(`/cards/${listing.body.id}`)).body.grading, null);
    assert.equal((await call('/cards/not-existing')).status, 404);
    assert.equal((await call('/cards', 'POST', { ...card, description: 'x'.repeat(5001) }, seller.cookie)).status, 400);
    assert.equal((await call('/cards', 'POST', { ...card, backImage: 'javascript:alert(1)' }, seller.cookie)).status, 400);
    const customer = await call('/auth/register', 'POST', { name: 'Buyer', email: 'buyer@test.local', password: 'test-password-123', role: 'customer' });
    assert.equal((await call(`/cards/${listing.body.id}`, 'DELETE', null, customer.cookie)).status, 403);
    assert.equal((await call(`/cards/${listing.body.id}`, 'PUT', { ...card, price: 25000 }, seller.cookie)).body.price, 25000);
    assert.equal((await call('/cards', 'POST', { ...card, image: 'javascript:alert(1)' }, seller.cookie)).status, 400);
    await call(`/admin/merchants/${seller.body.id}`, 'PATCH', { verification: 'rejected', reviewNote: 'Please correct your proof' }, admin.cookie);
    assert.equal((await call('/cards', 'POST', card, seller.cookie)).status, 403);
    assert.equal((await call(`/cards/${listing.body.id}`, 'DELETE', null, admin.cookie)).status, 200);
    await call('/auth/logout', 'POST', {}, seller.cookie);
    assert.equal((await call('/auth/me', 'GET', null, seller.cookie)).body, null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
