import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { createCommerce } from '../server/commerce.js';

// ตรวจว่าตะกร้าไม่จองสินค้า และ checkout หลายใบไม่หักเครดิตบางส่วน
test('cart does not reserve stock; checkout is atomic, private and idempotent', async () => {
  const store=await createStore();
  for(const id of ['buyer-a','buyer-b'])await store.addUser({id,role:'customer',balance:10000000});
  const c=createCommerce(store,{enabled:true}),cards=await store.cards(),a=cards[0],b=cards[1];
  await c.addCart('buyer-a',a.id);await c.addCart('buyer-a',b.id);await c.addCart('buyer-a',a.id);
  assert.equal((await c.cart('buyer-a')).count,2);assert.equal((await c.cart('buyer-b')).count,0);
  assert.equal(await c.sold(a.id),false);
  await c.buy('buyer-b',{cardId:a.id,expectedPrice:a.price,address:'Test recipient address 12345'},'direct-buy-123456');
  assert.equal((await c.cart('buyer-a')).items[0].available,false);
  const request={items:[{cardId:a.id,expectedPrice:a.price},{cardId:b.id,expectedPrice:b.price}],address:'Test recipient address 12345'};
  await assert.rejects(c.checkoutCart('buyer-a',request,'cart-checkout-123456'),/ขายไปแล้ว/);
  assert.equal((await store.users())[0].balance,10000000);assert.equal(await c.sold(b.id),false);
  await c.removeCart('buyer-a',a.id);
  const valid={...request,items:[request.items[1]]};
  await assert.rejects(c.checkoutCart('buyer-a',{...valid,items:[{cardId:b.id,expectedPrice:1}]},'cart-price-123456'),/ราคา/);
  const [first,retry]=await Promise.all([c.checkoutCart('buyer-a',valid,'cart-checkout-123456'),c.checkoutCart('buyer-a',valid,'cart-checkout-123456')]);
  assert.equal(first.orders[0].id,retry.orders[0].id);assert.equal((await c.cart('buyer-a')).count,0);
  assert.equal((await store.users())[0].balance,10000000-b.price);
});
// หากเครดิตไม่พอหลังจองการ์ดบางใบแล้ว ต้องคืนการ์ดทุกใบ
test('failed checkout releases every claimed card', async () => {
  const store=await createStore();
  const [a,b]=await store.cards();
  await store.addUser({id:'poor',role:'customer',balance:a.price+b.price});
  // จำลองยอดถูกใช้ไปพร้อมกันหลังตรวจเบื้องต้น: การหักเครดิตแบบมีเงื่อนไขล้มเหลว
  const c=createCommerce({...store,adjustBalance:async()=>null},{enabled:true});
  await c.addCart('poor',a.id);await c.addCart('poor',b.id);
  await assert.rejects(c.checkoutCart('poor',{items:[{cardId:a.id,expectedPrice:a.price},{cardId:b.id,expectedPrice:b.price}],address:'Test recipient address 12345'},'cart-poor-1234567'),/ไม่เพียงพอ/);
  assert.equal(await c.sold(a.id),false);assert.equal(await c.sold(b.id),false);
});
