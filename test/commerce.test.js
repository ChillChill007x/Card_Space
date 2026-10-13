import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCommerce } from '../server/commerce.js';
import { createStore } from '../server/store.js';

async function setup(options) {
  const store = await createStore();
  const buyer = { id: 'buyer', balance: 500000, role: 'customer' }, other = { id: 'other', balance: 500000, role: 'customer' }, seller = { id: 'seller', balance: 0, role: 'merchant', verification: 'approved' };
  const admin = { id: 'admin', balance: 0, role: 'admin' };
  await store.addUser(buyer); await store.addUser(other); await store.addUser(seller); await store.addUser(admin);
  const card = { id: 'one-card', name: 'Test', sellerId: seller.id, price: 100000, createdAt: new Date().toISOString() };
  await store.addCard(card);
  return { store, buyer, other, seller, admin, service: createCommerce(store, { enabled: true, ...options }), request: { cardId: card.id, expectedPrice: card.price, address: 'Demo Recipient 0000000000 Sample Address 10000' } };
}
const shipAndDeliver = async (service, seller, buyer, request) => {
  const order = await service.buy(buyer.id, request, randomUUID());
  await service.transition(seller, order.id, { action: 'ship', tracking: 'DEMO123', shipmentProofId: 'ship-proof' });
  return order;
};
test('simultaneous purchases cannot sell a single card twice', async () => {
  const { service, buyer, other, request } = await setup();
  const results = await Promise.allSettled([service.buy(buyer.id, request, randomUUID()), service.buy(other.id, request, randomUUID())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(buyer.balance + other.balance, 900000);
});
test('idempotent payment, cancellation and refund; no forged price or self-buy', async () => {
  const { service, buyer, seller, request } = await setup();
  await assert.rejects(service.buy(seller.id, request, randomUUID()), /ตัวเอง/);
  await assert.rejects(service.buy(buyer.id, { ...request, expectedPrice: 1 }, randomUUID()), /ราคา/);
  const key = randomUUID();
  const [a,b] = await Promise.all([service.buy(buyer.id, request, key), service.buy(buyer.id, request, key)]);
  assert.equal(a.id, b.id); assert.equal(buyer.balance, 400000);
  await service.transition(buyer, a.id, { action: 'cancel' });
  assert.equal(buyer.balance, 500000); assert.equal(await service.sold(request.cardId), false);
  await assert.rejects(service.transition(buyer, a.id, { action: 'cancel' }), /ยกเลิกได้เฉพาะ/);
  assert.equal(buyer.balance, 500000);
});
test('shipping permissions, escrow settlement and order visibility', async () => {
  const { service, buyer, seller, other, request } = await setup();
  const order = await service.buy(buyer.id, request, randomUUID());
  assert.equal(seller.balance, 0);
  assert.equal((await service.list(other, 'purchases')).total, 0);
  assert.equal((await service.list(seller, 'sales')).items.length, 1);
  await assert.rejects(service.transition(other, order.id, { action: 'ship', tracking: 'DEMO123' }), /ไม่มีสิทธิ์/);
  await assert.rejects(service.transition(buyer, order.id, { action: 'receive' }), /จัดส่งก่อน/);
  await assert.rejects(service.transition(seller, order.id, { action: 'ship', tracking: 'DEMO123' }), /แนบรูป/);
  await service.transition(seller, order.id, { action: 'ship', tracking: 'DEMO123', shipmentProofId:'test-shipment' });
  await assert.rejects(service.transition(buyer, order.id, { action: 'cancel' }), /ยกเลิกได้เฉพาะ/);
  await assert.rejects(service.transition(buyer, order.id, { action: 'receive' }), /แนบรูป/);
  const receipts = await Promise.allSettled([1, 2].map(() => service.transition(buyer, order.id, { action: 'receive', receiptProofId:'test-proof' })));
  assert.equal(receipts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(seller.balance, 100000);
  await assert.rejects(service.transition(buyer, order.id, { action: 'receive' }));
  assert.equal(seller.balance, 100000);
});
test('topups validate values, prevent duplicate credits and are disabled in production', async () => {
  const { service, buyer, store } = await setup();
  const key = randomUUID();
  await Promise.all([service.topup(buyer.id, 10000, key), service.topup(buyer.id, 10000, key)]);
  assert.equal(buyer.balance, 510000);
  await assert.rejects(service.topup(buyer.id, 20000, key), /รายการอื่น/);
  for (const value of [-100, 0, 1.2, '10000', 1000000001]) await assert.rejects(service.topup(buyer.id, value, randomUUID()));
  const disabled = createCommerce(store, { enabled: false });
  await assert.rejects(disabled.topup(buyer.id, 10000, randomUUID()), /production/);
  await assert.rejects(disabled.buy(buyer.id, {}, randomUUID()), /production/);
  // การอ่านประวัติไม่ผูกกับการเปิดธุรกรรมสาธิต
  assert.equal((await disabled.list(buyer, 'purchases')).total, 0);
});
test('insufficient funds and revoked merchants do not mutate balances', async () => {
  const { service, buyer, seller, request } = await setup();
  buyer.balance = 1;
  await assert.rejects(service.buy(buyer.id, request, randomUUID()), /ไม่เพียงพอ/);
  buyer.balance = 500000; seller.verification = 'rejected';
  await assert.rejects(service.buy(buyer.id, request, randomUUID()), /ระงับ/);
  assert.equal(buyer.balance, 500000); assert.equal(await service.sold(request.cardId), false);
});
test('a purchase and a listing edit/delete cannot both succeed', async () => {
  for (let round = 0; round < 20; round++) {
    const { service, store, buyer, seller, request } = await setup();
    const [purchase, edit] = await Promise.allSettled([service.buy(buyer.id, request, randomUUID()), store.updateUnsoldCard(request.cardId, seller.id, { name: 'Edited name' })]);
    const order = purchase.status === 'fulfilled' ? purchase.value : null, edited = edit.value;
    assert.ok(!(order && edited && order.card.name !== 'Edited name'), 'order snapshot must match the listing');
    if (order) assert.equal(order.card.name, (await store.getCard(request.cardId)).name);
    const [buy2, removed] = await Promise.allSettled([service.buy(buyer.id, request, randomUUID()), store.deleteUnsoldCard(request.cardId, seller.id)]);
    assert.ok(!(buy2.status === 'fulfilled' && removed.value), 'a sold card cannot be deleted');
  }
});
test('buyer dispute: admin refund or release, and only one decision applies', async () => {
  const { service, buyer, seller, admin, other, request, store } = await setup();
  const order = await shipAndDeliver(service, seller, buyer, request);
  await assert.rejects(service.transition(other, order.id, { action: 'dispute', reason: 'damaged', details: 'Card arrived bent', disputeProofId: 'p' }), /ไม่มีสิทธิ์/);
  await assert.rejects(service.transition(buyer, order.id, { action: 'dispute', reason: 'damaged', details: 'Card arrived bent' }), /หลักฐาน/);
  await assert.rejects(service.transition(buyer, order.id, { action: 'dispute', reason: 'bad', details: 'Card arrived bent' }), /ประเภทปัญหา/);
  const disputed = await service.transition(buyer, order.id, { action: 'dispute', reason: 'damaged', details: 'Card arrived bent in half', disputeProofId: 'dispute-proof' });
  assert.equal(disputed.status, 'disputed');
  await assert.rejects(service.transition(buyer, order.id, { action: 'receive', receiptProofId: 'r' }), /จัดส่งก่อน/);
  await assert.rejects(service.transition(seller, order.id, { action: 'resolve', decision: 'release', note: 'seller says fine' }), /แอดมิน/);
  await service.transition(seller, order.id, { action: 'respond', response: 'Packed in a toploader' });
  const decisions = await Promise.allSettled([service.transition(admin, order.id, { action: 'resolve', decision: 'refund', note: 'Photo shows damage' }), service.transition(admin, order.id, { action: 'resolve', decision: 'release', note: 'Seller packed it well' })]);
  assert.equal(decisions.filter(r => r.status === 'fulfilled').length, 1);
  const final = await store.getOrder(order.id);
  assert.equal(buyer.balance + seller.balance, 500000);
  assert.equal(final.status === 'refunded' ? buyer.balance : seller.balance, final.status === 'refunded' ? 500000 : 100000);
  assert.equal(final.dispute.sellerResponse, 'Packed in a toploader');
  assert.equal(await service.sold(request.cardId), true);
});
test('shipped orders without confirmation or dispute auto-complete after the deadline', async () => {
  const { service, buyer, seller, request } = await setup({ autoCompleteDays: 7 });
  const order = await shipAndDeliver(service, seller, buyer, request);
  assert.equal(await service.settleOverdue(Date.now() + 6 * 86400000), 0);
  assert.equal(seller.balance, 0);
  assert.equal(await service.settleOverdue(Date.now() + 8 * 86400000), 1);
  assert.equal(seller.balance, 100000);
  assert.equal(await service.settleOverdue(Date.now() + 9 * 86400000), 0);
  assert.equal((await service.order(buyer, order.id)).autoCompleted, true);
  // ข้อพิพาทที่เปิดอยู่ไม่ถูกยืนยันอัตโนมัติ
  const s2 = await setup({ autoCompleteDays: 7 });
  const o2 = await shipAndDeliver(s2.service, s2.seller, s2.buyer, s2.request);
  await s2.service.transition(s2.buyer, o2.id, { action: 'dispute', reason: 'not_received', details: 'Tracking shows nothing yet' });
  assert.equal(await s2.service.settleOverdue(Date.now() + 30 * 86400000), 0);
  assert.equal(s2.seller.balance, 0);
});
