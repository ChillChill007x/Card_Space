// ตรวจระบบกับ MongoDB จริงบนฐานทดสอบแยก (cardspace_test_*) ครอบคลุมการย้ายข้อมูล การซื้อพร้อมกัน ข้อพิพาท รีวิว และการคงข้อมูลหลังรีสตาร์ต แล้วลบฐานทดสอบทิ้ง
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createStore } from '../server/store.js';
import { createApp, hashPassword } from '../server/app.js';

// Uses only a new disposable database, never the configured application database.
const db = `cardspace_test_${Date.now()}`;
const uri = `mongodb://127.0.0.1:27017/${db}`;
let server;
// เปิด store + app บนพอร์ตสุ่ม (เรียกซ้ำเพื่อจำลองการรีสตาร์ตเซิร์ฟเวอร์)
async function boot() {
  const store = await createStore(uri);
  server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  return store;
}
// เรียก API พร้อม cookie แล้วคืน status, body และ cookie ใหม่
async function call(path, method = 'GET', body, cookie = '') {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
try {
  // จำลองฐานข้อมูลรุ่นเดิมที่เก็บธุรกรรมทั้งหมดในเอกสาร CommerceState เดียว
  await mongoose.connect(uri);
  const legacyOrder = { id: 'legacy-order', buyerId: 'legacy-buyer', sellerId: 'sample-merchant', card: { id: 'legacy-card', name: 'Legacy', price: 5000 }, total: 5000, address: 'Legacy address 1234567', status: 'shipped', tracking: 'OLD1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
  await mongoose.connection.collection('users').insertOne({ id: 'legacy-buyer', name: 'Legacy', email: 'legacy@test.local', role: 'customer', verification: 'none', balance: 0 });
  await mongoose.connection.collection('cards').insertOne({ id: 'legacy-card', name: 'Legacy', price: 5000, sellerId: 'sample-merchant', createdAt: '2026-10-01T00:00:00.000Z' });
  await mongoose.connection.collection('commercestates').insertOne({ _id: 'simulation', version: 3, data: { orders: [legacyOrder], entries: [{ id: 'legacy-entry', userId: 'legacy-buyer', amount: -5000, type: 'purchase', reference: 'legacy-order', createdAt: '2026-10-01T00:00:00.000Z' }], balances: { 'legacy-buyer': 95000 }, carts: { 'legacy-buyer': ['sample-2'] }, requests: [] } });
  await mongoose.disconnect();
  const store = await boot();
  assert.equal((await store.getUser('legacy-buyer')).balance, 95000);
  assert.equal((await store.getCard('legacy-card')).soldOrderId, 'legacy-order');
  assert.equal((await store.getOrder('legacy-order')).shippedAt, legacyOrder.updatedAt);
  assert.equal((await store.ledger('legacy-buyer', 10)).length, 1);
  assert.deepEqual(await store.getCart('legacy-buyer'), ['sample-2']);
  assert.equal(await store.getCard('sample-1'), null, 'sample cards must not be auto-seeded');
  await store.addUser({ id: 'admin', name: 'Admin', email: 'admin@test.local', passwordHash: hashPassword('test-password-123'), role: 'admin', verification: 'none' });
  const seller = await call('/auth/register', 'POST', { name: 'Seller', email: 'seller@test.local', password: 'test-password-123', role: 'merchant' });
  assert.match(seller.body.merchantCode,/^SELL-\d{6,}$/);
  const others=await Promise.all([1,2].map(i=>call('/auth/register','POST',{name:'Merchant '+i,email:`merchant${i}@test.local`,password:'test-password-123',role:'merchant'})));
  assert.equal(new Set([seller,...others].map(r=>r.body.merchantCode)).size,3);
  await call('/profile','PATCH',{name:'Renamed Seller',merchantCode:'SELL-999999'},seller.cookie);
  assert.equal((await call('/auth/me','GET',null,seller.cookie)).body.merchantCode,seller.body.merchantCode);
  const admin = await call('/auth/login', 'POST', { email: 'admin@test.local', password: 'test-password-123' });
  const buyer = await call('/auth/register', 'POST', { name: 'Buyer', email: 'buyer@test.local', password: 'test-password-123', role: 'customer' });
  const savedAddress={recipient:'Buyer',phone:'0812345678',address:'123 Test Road Bangkok 10100'};
  assert.equal((await call('/profile','PATCH',{name:'Saved Buyer',shippingAddress:savedAddress},buyer.cookie)).status,200);
  const application = { fullName: 'Test Seller', shopName: 'Test Shop', phone: '0812345678', address: 'Test address', evidence: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
  assert.equal((await call('/merchant/application', 'POST', application, buyer.cookie)).status, 403);
  assert.equal((await call('/merchant/application', 'POST', { ...application, evidence: 'data:image/png;base64,YmFk' }, seller.cookie)).status, 400);
  assert.equal((await call('/merchant/application', 'POST', application, seller.cookie)).status, 200);
  assert.equal((await call(`/admin/merchants/${seller.body.id}`, 'PATCH', { verification: 'approved' }, seller.cookie)).status, 403);
  assert.equal((await call(`/admin/merchants/${seller.body.id}`, 'PATCH', { verification: 'rejected' }, admin.cookie)).status, 400);
  await call(`/admin/merchants/${seller.body.id}`, 'PATCH', { verification: 'rejected', reviewNote: 'Upload clearer proof' }, admin.cookie);
  assert.equal((await call('/merchant/application', 'GET', null, seller.cookie)).body.application.reviewNote, 'Upload clearer proof');
  await call('/merchant/application', 'POST', application, seller.cookie);
  assert.equal((await call(`/admin/merchants/${seller.body.id}`, 'PATCH', { verification: 'approved' }, admin.cookie)).status, 200);
  const card = { name: 'Persistent card', category: 'Pokémon', set: 'TEST', rarity: 'SR', condition: 'Near Mint', price: 15000, image: '/art/fire.svg', backImage: '/art/moon.svg', grading: { company: 'PSA', grade: '10', certificate: 'TEST-123' } };
  const listing = await call('/cards', 'POST', card, seller.cookie);
  assert.equal(listing.status, 201);
  assert.equal((await call(`/cards/${listing.body.id}`,'PUT',{...card,character:'Pikachu, พิคาชู'},seller.cookie)).status,200);
  const report = await call(`/cards/${listing.body.id}/reports`,'POST',{reason:'misleading',details:'Test report description for persistence'},buyer.cookie);
  assert.equal(report.status,201);
  assert.equal((await call(`/cards/${listing.body.id}/reports`,'POST',{reason:'other',details:'Duplicate concurrent record prevention'},buyer.cookie)).status,409);
  assert.equal((await call(`/admin/reports/${report.body.id}`,'PATCH',{status:'reviewing',reviewNote:'Checking details'},admin.cookie)).status,200);
  const uploaded = await call('/uploads', 'POST', { data: application.evidence }, seller.cookie);
  assert.equal(uploaded.status, 201);
  assert.equal((await call('/uploads', 'POST', { data: application.evidence }, buyer.cookie)).status, 403);
  const uploadUrl = uploaded.body.url;
  assert.equal((await call(`/cards/${listing.body.id}`, 'PUT', { ...card, character:'Pikachu, พิคาชู', image: uploadUrl }, seller.cookie)).status, 200);
  // ใส่ Idempotency-Key ผ่าน helper ใหม่ เพื่อทดสอบคำขอซ้ำและการแข่งขันจริง
  const transact = async (path, data, cookie, key) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method:'POST', headers:{'Content-Type':'application/json',cookie,'Idempotency-Key':key}, body:JSON.stringify(data) });
    return { status:r.status, body:await r.json() };
  };
  const deposits = await Promise.all([1,2].map(() => transact('/wallet/topup',{amount:100000},buyer.cookie,'deposit-test-12345')));
  assert.ok(deposits.every(r=>r.status===200));
  assert.equal((await call('/wallet','GET',null,buyer.cookie)).body.balance,100000);
  await transact('/wallet/topup',{amount:100000},admin.cookie,'deposit-admin-12345');
  const purchase = {cardId:listing.body.id,expectedPrice:15000,address:'Test recipient and address 123456'};
  const race = await Promise.all([transact('/orders',purchase,buyer.cookie,'purchase-buyer-12345'),transact('/orders',purchase,admin.cookie,'purchase-admin-12345')]);
  assert.equal(race.filter(r=>r.status===201).length,1);
  assert.equal(race.filter(r=>r.status===409).length,1);
  const order = race.find(r=>r.status===201).body;
  assert.equal((await call(`/orders/${order.id}`,'PATCH',{action:'cancel'},admin.cookie)).status,200);
  assert.equal((await call('/wallet','GET',null,buyer.cookie)).body.balance,100000);
  const completed = await transact('/orders',purchase,buyer.cookie,'purchase-second-12345');
  assert.equal(completed.status,201);
  assert.equal((await call(`/orders/${completed.body.id}`,'PATCH',{action:'ship',tracking:'TEST 123'},buyer.cookie)).status,403);
  await call(`/orders/${completed.body.id}`,'PATCH',{action:'ship',tracking:'TEST 123',shipmentImage:application.evidence},seller.cookie);
  const receipts = await Promise.all([1,2].map(()=>call(`/orders/${completed.body.id}`,'PATCH',{action:'receive',receiptImage:application.evidence},buyer.cookie)));
  assert.equal(receipts.filter(r=>r.status===200).length,1);
  const receiptUrl=()=>`http://127.0.0.1:${server.address().port}/api/orders/${completed.body.id}/receipt`;
  assert.equal((await fetch(receiptUrl())).status,401);
  const shipmentUrl=()=>receiptUrl().replace('/receipt','/shipment');
  assert.equal((await fetch(shipmentUrl())).status,401);
  for(const cookie of [buyer.cookie,seller.cookie,admin.cookie])assert.equal((await fetch(shipmentUrl(),{headers:{cookie}})).status,200);
  for(const cookie of [buyer.cookie,seller.cookie,admin.cookie])assert.equal((await fetch(receiptUrl(),{headers:{cookie}})).status,200);
  const stranger=await call('/auth/register','POST',{name:'Other',email:'other@test.local',password:'test-password-123',role:'customer'});
  assert.equal((await fetch(receiptUrl(),{headers:{cookie:stranger.cookie}})).status,404);
  assert.equal((await fetch(shipmentUrl(),{headers:{cookie:stranger.cookie}})).status,404);
  assert.equal((await call('/wallet','GET',null,seller.cookie)).body.balance,15000);
  for (const [id,price] of [['cart-one',1000],['cart-two',2000]]) {
    await store.addCard({ ...card, id, price, sellerId:'sample-merchant', sellerName:'Sample', createdAt:new Date().toISOString() });
    assert.equal((await call('/cart','POST',{cardId:id},buyer.cookie)).status,200);
  }
  // Simulate a merchant created before readable merchant codes existed.
  await mongoose.connection.collection('users').updateOne({id:others[0].body.id},{$unset:{merchantCode:''}});
  await new Promise(r => server.close(r)); server = null;
  await mongoose.disconnect();
  await boot();
  const migrated=(await call('/auth/me','GET',null,others[0].cookie)).body.merchantCode;
  assert.match(migrated,/^SELL-\d{6,}$/);
  assert.ok(![seller,...others].some(r=>r.body.merchantCode===migrated));
  assert.equal((await call('/auth/me','GET',null,seller.cookie)).body.merchantCode,seller.body.merchantCode);
  assert.equal((await fetch(shipmentUrl(),{headers:{cookie:buyer.cookie}})).status,200);
  assert.equal((await fetch(receiptUrl(),{headers:{cookie:buyer.cookie}})).status,200);
  const savedReports=await call('/admin/reports','GET',null,admin.cookie);
  assert.equal(savedReports.body.find(r=>r.id===report.body.id).status,'reviewing');
  assert.deepEqual((await call('/profile','GET',null,buyer.cookie)).body.shippingAddress,savedAddress);
  assert.equal((await call('/profile','GET',null,buyer.cookie)).body.name,'Saved Buyer');
  assert.equal((await call('/profile','GET',null,seller.cookie)).body.shippingAddress,null);
  assert.equal((await call('/auth/me', 'GET', null, seller.cookie)).body.verification, 'approved');
  assert.equal((await call('/auth/me', 'GET', null, seller.cookie)).body.application, undefined);
  assert.equal((await call('/merchant/application', 'GET', null, seller.cookie)).body.application.evidence, application.evidence);
  const detail = await call(`/cards/${listing.body.id}`);
  assert.equal(detail.body.merchantCode,seller.body.merchantCode);
  const shop=(await call(`/merchants/${seller.body.id}`)).body;
  assert.equal(shop.completedCount,1);
  assert.equal(shop.merchantCode,seller.body.merchantCode);
  assert.ok(!shop.cards.some(c=>c.id===listing.body.id));
  assert.deepEqual(Object.keys(shop).sort(),['id','name','avatar','merchantCode','approved','sample','completedCount','rating','cards'].sort());
  assert.equal((await call(`/merchants/${buyer.body.id}`)).status,404);
  assert.equal(detail.body.character,'Pikachu, พิคาชู');
  assert.equal(detail.body.sellerName, 'Test Shop');
  assert.equal(detail.body.grading.grade, '10');
  assert.equal(detail.body.application, undefined);
  assert.equal((await call(`/cards/${listing.body.id}`, 'PUT', { ...card, price: 20000 }, seller.cookie)).status, 409);
  assert.equal((await call('/wallet','GET',null,buyer.cookie)).body.balance,85000);
  assert.equal((await call('/wallet','GET',null,seller.cookie)).body.balance,15000);
  assert.equal((await call('/orders','GET',null,buyer.cookie)).body.items.some(o=>o.status==='completed'),true);
  assert.equal((await transact('/orders',purchase,buyer.cookie,'purchase-second-12345')).body.id,completed.body.id);
  const imageResponse=await fetch(`http://127.0.0.1:${server.address().port}${uploadUrl}`);
  assert.equal(imageResponse.headers.get('content-type'),'image/png');
  assert.ok((await imageResponse.arrayBuffer()).byteLength > 20);
  assert.equal((await call('/cart','GET',null,buyer.cookie)).body.count,2);
  assert.equal((await call('/cart','GET',null,seller.cookie)).body.count,0);
  const cartBody={items:[{cardId:'cart-one',expectedPrice:1000},{cardId:'cart-two',expectedPrice:2000}],address:'Test buyer 0000000000 test address'};
  const paidCart=await Promise.all([1,2].map(()=>transact('/cart/checkout',cartBody,buyer.cookie,'cart-persist-123456')));
  assert.ok(paidCart.every(r=>r.status===201));
  assert.equal(paidCart[0].body.orders[0].id,paidCart[1].body.orders[0].id);
  assert.equal((await call('/wallet','GET',null,buyer.cookie)).body.balance,82000);
  assert.equal((await call('/cart','GET',null,buyer.cookie)).body.count,0);
  // ซื้อแข่งกับแก้ไข/ลบบน MongoDB: ห้ามสำเร็จทั้งคู่จนชื่อในคำสั่งซื้อกับหน้าสินค้าไม่ตรงกัน
  await transact('/wallet/topup',{amount:1000000},buyer.cookie,'race-topup-mongo-1234');
  for(let i=0;i<10;i++){
    const raceCard=(await call('/cards','POST',{...card,grading:null,name:`Race ${i}`,price:1000},seller.cookie)).body;
    const [bought,edited,removed]=await Promise.all([transact('/orders',{cardId:raceCard.id,expectedPrice:1000,address:'Race address 0812345678'},buyer.cookie,`race-mongo-${i}-12345678`),call(`/cards/${raceCard.id}`,'PUT',{...card,grading:null,name:`Edited ${i}`,price:1000},seller.cookie),call(`/cards/${raceCard.id}`,'DELETE',null,seller.cookie)]);
    if(bought.status===201){
      assert.notEqual(removed.status,200);
      const live=(await call(`/cards/${raceCard.id}`)).body;
      assert.equal(bought.body.card.name,live.name);
      assert.equal(live.sold,true);
    }
  }
  // ข้อพิพาทหลังจัดส่ง: แจ้งปัญหา → ผู้ขายชี้แจง → แอดมินคืนเครดิต
  const before=(await call('/wallet','GET',null,buyer.cookie)).body.balance;
  const disputeCard=(await call('/cards','POST',{...card,grading:null,name:'Dispute card',price:3000},seller.cookie)).body;
  const disputed=(await transact('/orders',{cardId:disputeCard.id,expectedPrice:3000,address:'Dispute address 0812345678'},buyer.cookie,'dispute-buy-12345678')).body;
  await call(`/orders/${disputed.id}`,'PATCH',{action:'ship',tracking:'DISPUTE 1',shipmentImage:application.evidence},seller.cookie);
  assert.equal((await call(`/orders/${disputed.id}`,'PATCH',{action:'dispute',reason:'damaged',details:'Corner is torn on arrival'},buyer.cookie)).status,400);
  assert.equal((await call(`/orders/${disputed.id}`,'PATCH',{action:'dispute',reason:'damaged',details:'Corner is torn on arrival',disputeImage:application.evidence},buyer.cookie)).status,200);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/orders/${disputed.id}/dispute`,{headers:{cookie:seller.cookie}})).status,200);
  assert.equal((await call(`/orders/${disputed.id}`,'PATCH',{action:'respond',response:'Packed with a toploader'},seller.cookie)).status,200);
  const decisions=await Promise.all(['refund','release'].map(decision=>call(`/orders/${disputed.id}`,'PATCH',{action:'resolve',decision,note:'Reviewed both photos'},admin.cookie)));
  assert.equal(decisions.filter(r=>r.status===200).length,1);
  const winner=decisions.find(r=>r.status===200).body.status;
  assert.equal((await call('/wallet','GET',null,buyer.cookie)).body.balance,winner==='refunded'?before:before-3000);
  const listed=(await call('/orders?scope=admin&status=refunded&limit=5','GET',null,admin.cookie)).body;
  assert.equal(listed.items.length,winner==='refunded'?1:0);
  assert.ok(listed.counts.completed>=1);
  // รีวิวร้าน การแจ้งเตือน และการ์ดแนะนำบน MongoDB
  assert.ok((await call('/notifications','GET',null,buyer.cookie)).body.items.some(i=>/ให้คะแนน/.test(i.label)));
  assert.equal((await call(`/orders/${completed.body.id}/review`,'POST',{rating:5,comment:'Great'},buyer.cookie)).status,201);
  assert.equal((await call(`/orders/${completed.body.id}/review`,'POST',{rating:1},buyer.cookie)).status,409);
  const rated=(await call(`/merchants/${seller.body.id}`)).body.rating;
  assert.equal(rated.count,1);assert.equal(rated.average,5);assert.equal(rated.items[0].buyerId,undefined);
  assert.deepEqual((await call(`/cards/${listing.body.id}`)).body.sellerRating,{average:5,count:1});
  assert.equal((await call('/notifications','GET',null,admin.cookie)).body.items.find(i=>i.href==='#/orders/admin'),undefined);
  assert.equal((await call(`/cards/${listing.body.id}/related`)).status,200);
  await call('/auth/logout', 'POST', {}, seller.cookie);
  assert.equal((await call('/auth/me', 'GET', null, seller.cookie)).body, null);
  console.log('Passed: legacy CommerceState migration, no auto-seeding, purchase vs edit/delete races, disputes with admin decision, MongoDB persistence across app/repository restart, sessions/logout, proof privacy, reject/resubmit/approve, uploads, atomic concurrent purchases, idempotency, refunds, settlement and restart persistence.');
} finally {
  if (server) await new Promise(r => server.close(r));
  if (mongoose.connection.name === db && /^cardspace_test_\d+$/.test(db)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
