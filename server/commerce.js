// ระบบซื้อขายด้วยเครดิตสาธิต: เติมเครดิต ตะกร้า ซื้อ จัดส่ง ยืนยันรับ ยกเลิก ข้อพิพาท และยืนยันรับอัตโนมัติ
import { randomUUID } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const SAMPLE_SELLER = 'sample-merchant';
const CART_LIMIT = 50;
export const DISPUTE_REASONS = { not_received: 'ไม่ได้รับสินค้า', not_as_described: 'สินค้าไม่ตรงปก', damaged: 'สินค้าเสียหาย', other: 'ปัญหาอื่น' };

// เครดิตจำลองเท่านั้น: คำสั่งซื้อ/รายการเครดิต/ตะกร้าเป็นเอกสารแยก และทุกจุดที่แข่งกันได้ใช้ update แบบมีเงื่อนไขในเอกสารเดียว
// - การ์ด: claimCard/updateUnsoldCard/deleteUnsoldCard ตรวจ soldOrderId พร้อมการเขียน
// - เครดิต: adjustBalance ตรวจยอดพร้อม $inc
// - สถานะคำสั่งซื้อ: updateOrder ระบุสถานะเดิมที่คาดไว้ ผู้ชนะมีเพียงคำขอเดียว
// MongoDB standalone ไม่มี transaction ข้ามเอกสาร หากขั้นใดล้มเหลวจะคืนสถานะขั้นก่อนหน้าในโปรเซสเดียวกัน
export function createCommerce(store, { enabled = process.env.NODE_ENV !== 'production', autoCompleteDays = Number(process.env.AUTO_COMPLETE_DAYS) || 7 } = {}) {
  // ธุรกรรมที่เปลี่ยนเครดิตทำได้เฉพาะเมื่อเปิดโหมดสาธิต (ไม่ใช่ production)
  const requireEnabled = () => { if (!enabled) throw fail(409, 'ระบบซื้อและเติมเครดิตสาธิตปิดในสภาพแวดล้อม production ยังไม่รองรับเงินจริง'); };
  // สร้างรายการ ledger หนึ่งรายการ
  const entry = (userId, amount, type, reference) => ({ id: randomUUID(), userId, amount, type, reference, createdAt: now() });
  const autoCompleteAt = o => o.shippedAt ? new Date(Date.parse(o.shippedAt) + autoCompleteDays * 86400000).toISOString() : null;
  const present = o => o && ({ ...o, autoCompleteAt: o.status === 'shipped' ? autoCompleteAt(o) : null });
  // ร้านพร้อมขายเมื่อเป็นพ่อค้าที่อนุมัติแล้ว (หรือร้านตัวอย่าง)
  const sellerReady = async sellerId => {
    if (sellerId === SAMPLE_SELLER) return true;
    const seller = await store.getUser(sellerId);
    return seller?.role === 'merchant' && seller.verification === 'approved';
  };
  // ลงบัญชีเครดิตเข้าและบันทึก ledger (รายได้ผู้ขาย/คืนผู้ซื้อ)
  const credit = async (userId, amount, type, reference) => {
    if (!userId || userId === SAMPLE_SELLER || !(await store.getUser(userId))) return;
    await store.adjustBalance(userId, amount);
    await store.addLedger([entry(userId, amount, type, reference)]);
  };
  // Idempotency-Key: คำขอแรกทำงาน คำขอซ้ำรอผลเดิม ส่วนคำขอที่ล้มเหลวจะถูกลบเพื่อให้ลองใหม่ได้
  async function once(userId, key, payload, run) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw fail(400, 'คำขอต้องมีรหัสป้องกันการทำรายการซ้ำ');
    const id = `${userId}:${key}`;
    for (let attempt = 0; attempt < 300; attempt++) {
      const existing = await store.beginRequest(id, payload);
      if (!existing) {
        let result;
        try { result = await run(); } catch (e) { await store.abortRequest(id); throw e; }
        await store.finishRequest(id, result); return result;
      }
      if (existing.payload !== payload) throw fail(409, 'รหัสคำขอนี้ถูกใช้กับรายการอื่นแล้ว');
      if (existing.status === 'done') return existing.result;
      await sleep(30);
    }
    throw fail(409, 'คำขอเดิมยังดำเนินการไม่เสร็จ กรุณาตรวจประวัติก่อนลองใหม่');
  }
  // ซื้อหลายใบแบบทั้งหมดหรือไม่ซื้อเลย: จองการ์ดทีละใบด้วยเงื่อนไขราคา/ยังไม่ขาย แล้วหักเครดิต หากล้มเหลวคืนการ์ดที่จองไว้
  async function purchase(userId, items, address, text) {
    const buyer = await store.getUser(userId);
    if (!buyer) throw fail(401, 'กรุณาเข้าสู่ระบบ');
    const cards = await store.cardsByIds(items.map(i => i.cardId));
    for (const item of items) {
      const card = cards.find(c => c.id === item.cardId);
      if (!card || card.soldOrderId) throw fail(409, text.sold);
      if (card.sellerId === userId) throw fail(400, text.own);
      if (!(await sellerReady(card.sellerId))) throw fail(409, text.seller);
      if (card.price !== item.expectedPrice) throw fail(409, text.price);
    }
    const total = items.reduce((sum, i) => sum + i.expectedPrice, 0);
    if ((buyer.balance || 0) < total) throw fail(400, text.funds);
    const time = now(), orders = items.map(() => ({ id: randomUUID() })), claimed = [];
    let balance;
    try {
      for (const [i, item] of items.entries()) {
        const card = await store.claimCard(item.cardId, item.expectedPrice, orders[i].id);
        if (!card) { const current = await store.getCard(item.cardId); throw fail(409, !current || current.soldOrderId ? text.sold : text.price); }
        claimed.push(i);
        const { soldOrderId, ...snapshot } = card;
        orders[i] = { id: orders[i].id, buyerId: userId, sellerId: card.sellerId, card: snapshot, total: card.price, address, status: 'paid', tracking: '', createdAt: time, updatedAt: time };
      }
      balance = await store.adjustBalance(userId, -total);
      if (balance === null) throw fail(400, text.funds);
    } catch (e) {
      for (const i of claimed) await store.releaseCard(items[i].cardId, orders[i].id);
      throw e;
    }
    await store.addOrders(orders);
    await store.addLedger(orders.map(o => entry(userId, -o.total, 'purchase', o.id)));
    return { orders, total, balance };
  }
  const single = { sold: 'การ์ดใบนี้ถูกขายหรือไม่มีอยู่แล้ว', own: 'ไม่สามารถซื้อการ์ดของตัวเองได้', seller: 'ร้านค้านี้ยังไม่ได้รับอนุมัติหรือถูกระงับ', price: 'ราคาการ์ดเปลี่ยนแล้ว กรุณาปิดหน้าต่างและโหลดรายการใหม่', funds: 'เครดิตไม่เพียงพอ กรุณาเติมเครดิตสาธิตก่อน' };
  const cartText = { sold: 'มีการ์ดที่ขายไปแล้วหรือถูกลบ กรุณารีเฟรชตะกร้า ยังไม่มีการหักเครดิต', own: 'ไม่สามารถซื้อการ์ดของตัวเอง', seller: 'ร้านค้าไม่พร้อมขาย กรุณาตรวจตะกร้าใหม่', price: 'ราคาการ์ดเปลี่ยน กรุณาตรวจยอดใหม่ ยังไม่มีการหักเครดิต', funds: 'เครดิตไม่เพียงพอ กรุณาเติมเครดิตก่อน' };
  // โอนเครดิตให้ผู้ขายหลังสถานะเปลี่ยนเป็นสำเร็จ (ผู้ชนะ updateOrder เท่านั้นที่เรียก)
  const payout = order => credit(order.sellerId, order.total, 'sale', order.id);
  const refund = order => credit(order.buyerId, order.total, 'refund', order.id);
  const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;

  return {
    enabled, persistent: store.mode === 'mongodb', autoCompleteDays,
    // คืนเฉพาะยอดและ ledger ล่าสุดของผู้ใช้ที่เข้าสู่ระบบ
    async wallet(user) {
      if (!enabled) return { enabled, balance: 0, entries: [] };
      const [fresh, entries] = await Promise.all([store.getUser(user.id), store.ledger(user.id, 100)]);
      return { enabled, balance: fresh?.balance || 0, entries };
    },
    // เพิ่มเครดิตจำลองและบันทึก idempotency เพื่อไม่เติมซ้ำ
    async topup(userId, amount, key) {
      requireEnabled();
      if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 1000000000) throw fail(400, 'เติมเครดิตได้ครั้งละ 100–10,000,000 บาทสาธิต');
      return once(userId, key, `topup:${amount}`, async () => {
        const balance = await store.adjustBalance(userId, amount, { max: 10000000000 });
        if (balance === null) throw fail(400, 'ยอดเครดิตสาธิตสูงสุด 100,000,000 บาท');
        await store.addLedger([entry(userId, amount, 'topup', 'เครดิตสาธิต')]);
        return { balance };
      });
    },
    // ตรวจราคา เครดิต ผู้ขาย และสินค้า ก่อนหักเครดิตและสร้างคำสั่งซื้อ
    async buy(userId, body, key) {
      requireEnabled();
      const { cardId, expectedPrice, address } = body;
      if (typeof cardId !== 'string' || !Number.isSafeInteger(expectedPrice) || typeof address !== 'string' || address.trim().length < 15 || address.length > 1000) throw fail(400, 'กรอกชื่อผู้รับ เบอร์ติดต่อ และที่อยู่ให้ครบ (15–1,000 ตัวอักษร)');
      const payload = JSON.stringify({ cardId, expectedPrice, address: address.trim() });
      return once(userId, key, payload, async () => (await purchase(userId, [{ cardId, expectedPrice }], address.trim(), single)).orders[0]);
    },
    // ตะกร้าเป็นเพียงรายการที่สนใจ ไม่เปลี่ยนสต็อกและไม่หักเครดิต
    async cart(userId) {
      const ids = await store.getCart(userId), cards = await store.cardsByIds(ids);
      const ready = new Map();
      for (const sellerId of new Set(cards.map(c => c.sellerId))) ready.set(sellerId, await sellerReady(sellerId));
      const items = ids.map(cardId => {
        const found = cards.find(c => c.id === cardId), card = found && (({ soldOrderId, ...c }) => c)(found);
        const reason = !found ? 'รายการถูกลบแล้ว' : found.soldOrderId ? 'มีคนซื้อไปแล้ว' : found.sellerId === userId ? 'เป็นการ์ดของคุณเอง' : !ready.get(found.sellerId) ? 'ร้านค้ายังไม่พร้อมขาย' : '';
        return { cardId, card: card || null, available: !reason, reason };
      });
      return { items, count: items.length };
    },
    // ใส่ตะกร้าได้เฉพาะการ์ดของคนอื่นที่ยังไม่ขาย
    async addCart(userId, cardId) {
      if (typeof cardId !== 'string') throw fail(400, 'รหัสการ์ดไม่ถูกต้อง');
      const card = await store.getCard(cardId);
      if (!card) throw fail(404, 'ไม่พบการ์ด');
      if (card.sellerId === userId) throw fail(400, 'ไม่สามารถใส่การ์ดของตัวเองในตะกร้า');
      if (card.soldOrderId) throw fail(409, 'การ์ดใบนี้ขายแล้ว');
      const count = await store.addCart(userId, cardId, CART_LIMIT);
      if (count === null) throw fail(400, `ตะกร้าเก็บได้สูงสุด ${CART_LIMIT} รายการ`);
      return { count };
    },
    async removeCart(userId, cardId) { return { count: await store.removeCart(userId, [cardId]) }; },
    // ตรวจทุกรายการก่อนหักเครดิต: หากแม้แต่หนึ่งใบขายไป/ราคาเปลี่ยน จะไม่ซื้อบางส่วน
    async checkoutCart(userId, body, key) {
      requireEnabled();
      const { items, address } = body;
      if (!Array.isArray(items) || !items.length || items.length > CART_LIMIT || items.some(i => !i || typeof i.cardId !== 'string' || !Number.isSafeInteger(i.expectedPrice)) || new Set(items.map(i=>i.cardId)).size !== items.length || typeof address !== 'string' || address.trim().length < 15 || address.length > 1000) throw fail(400, 'ตรวจรายการและกรอกชื่อ เบอร์โทร ที่อยู่ให้ครบ');
      const payload = JSON.stringify({ cart: items, address: address.trim() });
      return once(userId, key, payload, async () => {
        const inCart = await store.getCart(userId);
        if (items.some(i => !inCart.includes(i.cardId))) throw fail(409, 'ตะกร้าเปลี่ยนแล้ว กรุณาตรวจรายการใหม่');
        const result = await purchase(userId, items.map(({ cardId, expectedPrice }) => ({ cardId, expectedPrice })), address.trim(), cartText);
        await store.removeCart(userId, items.map(i => i.cardId));
        return result;
      });
    },
    // ระบุว่าการ์ดผูกกับคำสั่งซื้อที่ยังไม่ถูกยกเลิกหรือไม่
    async sold(cardId) { return !!(await store.getCard(cardId))?.soldOrderId; },
    // อ่านประวัติได้เสมอ (รวม production) แบ่งหน้าและนับตามสถานะจากฐานข้อมูล
    async list(user, scope, { page = 1, limit = 20, status, q } = {}) {
      const criteria = scope === 'sales' ? { sellerId: user.id } : scope === 'admin' && user.role === 'admin' ? {} : { buyerId: user.id };
      const result = await store.listOrders({ ...criteria, status, q }, { skip: (page - 1) * limit, limit });
      return { ...result, items: result.items.map(present), page, pages: Math.max(1, Math.ceil(result.total / limit)) };
    },
    // คืนคำสั่งซื้อเฉพาะคู่ค้าหรือแอดมิน
    async order(user, id) {
      const order = await store.getOrder(id);
      return order && (order.buyerId === user.id || order.sellerId === user.id || user.role === 'admin') ? present(order) : null;
    },
    // ตรวจสิทธิ์และสถานะ แล้วเปลี่ยนสถานะแบบมีเงื่อนไข ก่อนโอน/คืนเครดิต
    async transition(user, id, body) {
      requireEnabled();
      const order = await store.getOrder(id);
      if (!order) throw fail(404, 'ไม่พบคำสั่งซื้อ');
      const isBuyer = order.buyerId === user.id, isSeller = order.sellerId === user.id, isAdmin = user.role === 'admin';
      if (!isBuyer && !isSeller && !isAdmin) throw fail(403, 'ไม่มีสิทธิ์จัดการคำสั่งซื้อนี้');
      const { action, tracking } = body, time = now();
      // เปลี่ยนสถานะแบบมีเงื่อนไข: สำเร็จเฉพาะเมื่อสถานะปัจจุบันยังเป็น from (กันกดพร้อมกัน)
      const change = async (from, fields, message) => {
        const updated = await store.updateOrder(id, { status: from }, { ...fields, updatedAt: time });
        if (!updated) throw fail(409, message);
        return updated;
      };
      if (action === 'ship') {
        if (!(isSeller && user.verification === 'approved') && !isAdmin) throw fail(403, 'เฉพาะพ่อค้าที่อนุมัติหรือแอดมิน');
        if (order.status !== 'paid') throw fail(409, 'เปลี่ยนสถานะได้เฉพาะรายการรอจัดส่ง');
        if (typeof tracking !== 'string' || tracking.trim().length < 3 || tracking.length > 100) throw fail(400, 'ระบุบริษัทขนส่งและเลขพัสดุ (3–100 ตัวอักษร)');
        if (typeof body.shipmentProofId !== 'string' || !body.shipmentProofId) throw fail(400, 'แนบรูปสินค้าหรือพัสดุก่อนแจ้งจัดส่ง');
        return present(await change('paid', { status: 'shipped', tracking: tracking.trim(), shipmentProofId: body.shipmentProofId, shippedAt: time }, 'เปลี่ยนสถานะได้เฉพาะรายการรอจัดส่ง'));
      }
      if (action === 'receive') {
        if (!isBuyer) throw fail(403, 'เฉพาะผู้ซื้อที่ยืนยันรับสินค้าได้');
        if (order.status !== 'shipped') throw fail(409, 'ต้องจัดส่งก่อนยืนยันรับสินค้า');
        if (typeof body.receiptProofId !== 'string' || !body.receiptProofId) throw fail(400, 'แนบรูปสินค้าที่ได้รับก่อนยืนยัน');
        const updated = await change('shipped', { status: 'completed', receiptProofId: body.receiptProofId, completedAt: time }, 'ต้องจัดส่งก่อนยืนยันรับสินค้า');
        await payout(updated); return present(updated);
      }
      if (action === 'cancel') {
        if (!isBuyer && !isAdmin) throw fail(403, 'เฉพาะผู้ซื้อหรือแอดมินที่ยกเลิกได้');
        if (order.status !== 'paid') throw fail(409, 'ยกเลิกได้เฉพาะรายการที่ยังไม่จัดส่ง');
        const updated = await change('paid', { status: 'cancelled' }, 'ยกเลิกได้เฉพาะรายการที่ยังไม่จัดส่ง');
        await refund(updated); await store.releaseCard(updated.card.id, updated.id);
        return present(updated);
      }
      // ผู้ซื้อแจ้งปัญหาหลังจัดส่งและก่อนครบกำหนดยืนยันอัตโนมัติ เครดิตถูกพักไว้จนแอดมินตัดสิน
      if (action === 'dispute') {
        if (!isBuyer) throw fail(403, 'เฉพาะผู้ซื้อที่แจ้งปัญหาได้');
        if (order.status !== 'shipped') throw fail(409, 'แจ้งปัญหาได้เฉพาะรายการที่จัดส่งแล้วและยังไม่ยืนยันรับ');
        if (autoCompleteAt(order) && autoCompleteAt(order) < time) throw fail(409, 'เลยกำหนดแจ้งปัญหาแล้ว รายการนี้กำลังยืนยันรับอัตโนมัติ');
        if (!Object.hasOwn(DISPUTE_REASONS, body.reason) || !text(body.details, 10, 2000)) throw fail(400, 'เลือกประเภทปัญหาและอธิบายรายละเอียด 10–2,000 ตัวอักษร');
        if (body.reason !== 'not_received' && (typeof body.disputeProofId !== 'string' || !body.disputeProofId)) throw fail(400, 'แนบรูปหลักฐานสินค้าที่มีปัญหา');
        const dispute = { reason: body.reason, details: body.details.trim(), evidenceProofId: body.disputeProofId || null, openedAt: time, sellerResponse: '', respondedAt: null };
        return present(await change('shipped', { status: 'disputed', dispute }, 'แจ้งปัญหาได้เฉพาะรายการที่จัดส่งแล้วและยังไม่ยืนยันรับ'));
      }
      if (action === 'respond') {
        if (!isSeller) throw fail(403, 'เฉพาะผู้ขายที่ตอบข้อพิพาทได้');
        if (order.status !== 'disputed') throw fail(409, 'ไม่มีข้อพิพาทที่รอตอบ');
        if (!text(body.response, 5, 2000)) throw fail(400, 'ระบุคำชี้แจง 5–2,000 ตัวอักษร');
        return present(await change('disputed', { dispute: { ...order.dispute, sellerResponse: body.response.trim(), respondedAt: time } }, 'ข้อพิพาทถูกปิดแล้ว'));
      }
      // แอดมินตัดสิน: คืนเครดิตผู้ซื้อ หรือโอนให้ผู้ขาย (การ์ดไม่กลับมาวางขายอัตโนมัติ)
      if (action === 'resolve') {
        if (!isAdmin) throw fail(403, 'สำหรับแอดมินเท่านั้น');
        if (order.status !== 'disputed') throw fail(409, 'ไม่มีข้อพิพาทที่รอตัดสิน');
        if (!['refund', 'release'].includes(body.decision) || !text(body.note, 5, 2000)) throw fail(400, 'เลือกผลการตัดสินและระบุเหตุผล 5–2,000 ตัวอักษร');
        const refunded = body.decision === 'refund';
        const updated = await change('disputed', { status: refunded ? 'refunded' : 'completed', resolution: { decision: body.decision, note: body.note.trim(), by: user.id, at: time }, ...(refunded ? {} : { completedAt: time }) }, 'ข้อพิพาทถูกตัดสินไปแล้ว');
        await (refunded ? refund(updated) : payout(updated));
        return present(updated);
      }
      throw fail(400, 'การดำเนินการไม่ถูกต้อง');
    },
    // ผู้ซื้อไม่ยืนยันรับและไม่แจ้งปัญหาภายในกำหนด → ยืนยันอัตโนมัติและโอนเครดิตให้ผู้ขาย
    async settleOverdue(at = Date.now()) {
      if (!enabled) return 0;
      const cutoff = new Date(at - autoCompleteDays * 86400000).toISOString(), time = new Date(at).toISOString();
      let settled = 0;
      for (const order of await store.overdueOrders(cutoff)) {
        const updated = await store.updateOrder(order.id, { status: 'shipped' }, { status: 'completed', autoCompleted: true, completedAt: time, updatedAt: time });
        if (updated) { await payout(updated); settled++; }
      }
      return settled;
    }
  };
}
