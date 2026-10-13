import { initOrders } from './orders.js';
import { gradeText } from './grading.js';
// Wallet and order screens use the existing modal and authenticated API client.
export function initCommerce({ state, api, modal, toast, money, escapeHTML: esc, authForm, loadCards, checkoutView, onPurchased, refreshProduct }) {
  const $ = s => document.querySelector(s);
  const date = value => new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    const labels = { topup: 'เติมเครดิตสาธิต', purchase: 'ซื้อการ์ด', sale: 'รายได้จากการขาย', refund: 'คืนเครดิต' };
  const notice = '<p class="demo-notice">โหมดสาธิต · เครดิตไม่มีมูลค่าจริง ไม่มีการชำระเงินหรือจัดส่งจริง เครดิตนี้ใช้ทดลองระบบเท่านั้น</p>';
  // แสดง error ในฟอร์มที่เปิดอยู่ หรือเป็น toast ถ้าไม่มีฟอร์ม
  const onError = e => { const el = $('#commerce-error'); if (el) el.textContent = e.message; else toast(e.message); };
  const showError = '<p id="commerce-error" class="error" role="alert"></p>';
  let headerGeneration=0;
  // แสดงยอดเดียวกันสำหรับผู้ซื้อและพ่อค้า อ่านจาก ledger จริงแทน balance เก่าใน session
  async function refreshHeader() {
    const request=++headerGeneration, userId=state.user?.id;
    if(!userId){$('#header-balance').textContent='เข้าสู่ระบบ';$('#cart-count').textContent='0';return;}
    try {
      const [wallet,cart]=await Promise.all([api('/wallet'),api('/cart')]);
      if(request!==headerGeneration || state.user?.id!==userId)return;
      $('#header-balance').textContent=money(wallet.balance);$('#cart-count').textContent=cart.count;
      state.user.balance=wallet.balance;
    } catch { if(request===headerGeneration)$('#header-balance').textContent='ตรวจยอดอีกครั้ง'; }
  }
  addEventListener('commerce-changed',refreshHeader);
  addEventListener('focus',refreshHeader);
  // โหลดเครดิตและประวัติ พร้อมฟอร์มเติมเครดิตจำลองที่ป้องกันคำขอซ้ำ
  async function wallet() {
    if (!state.user) return authForm();
    try {
      const data = await api('/wallet');
      if (!data.enabled) return modal('<h2>กระเป๋าเงิน</h2><p>ระบบเครดิตจำลองปิดอยู่ในสภาพแวดล้อมนี้</p>');
      state.user.balance = data.balance;
      modal(`<p class="eyebrow">YOUR WALLET</p><h2>กระเป๋าเครดิต</h2>${notice}<p>${data.persistent ? 'บันทึกเครดิตและประวัติใน MongoDB' : 'โหมดหน่วยความจำ: ข้อมูลหายเมื่อรีสตาร์ต'}</p><div class="balance-panel"><span>เครดิตสาธิตคงเหลือ</span><strong>${money(data.balance)}</strong></div><form id="topup-form"><label>เติมเครดิตสาธิต (100–10,000,000 บาท)<input name="amount" type="number" min="100" max="10000000" step="1" value="1000" required></label>${showError}<button class="dark">เติมเครดิตสาธิต</button></form><h3 class="subheading">ประวัติรายการ</h3><div class="ledger">${data.entries.length ? data.entries.map(e => `<div class="ledger-row"><div><strong>${labels[e.type] || esc(e.type)}</strong><small>${esc(date(e.createdAt))}</small></div><b class="${e.amount > 0 ? 'credit' : 'debit'}">${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}</b></div>`).join('') : '<p>ยังไม่มีรายการเคลื่อนไหว</p>'}</div>`);
      let key = crypto.randomUUID();
      $('#topup-form').onsubmit = async event => {
        event.preventDefault(); const button = event.submitter; button.disabled = true;
        try { await api('/wallet/topup', 'POST', { amount: Math.round(Number(new FormData(event.target).get('amount')) * 100) }, key); toast('เติมเครดิตสาธิตแล้ว'); await wallet(); }
        catch(e) { onError(e); button.disabled = false; }
      };
      $('#topup-form input').oninput = () => { key = crypto.randomUUID(); };
    } catch(e) { toast(e.message); }
  }
  // ตรวจยอดและแสดงหน้าซื้อ ส่งราคาที่เห็นให้เซิร์ฟเวอร์ตรวจอีกครั้ง
  async function checkout(card) {
    if (!state.user) {
      checkoutView(card, `<h1>เข้าสู่ระบบเพื่อซื้อการ์ด</h1><p>เข้าสู่ระบบหรือสมัครสมาชิก แล้วกลับมายืนยันรายการนี้ได้ทันที</p><button class="dark" id="checkout-login">เข้าสู่ระบบ / สมัครสมาชิก</button>`);
      if ($('#checkout-login')) $('#checkout-login').onclick = () => authForm();
      return;
    }
    try {
      const [data, profileData] = await Promise.all([api('/wallet'),api('/profile')]);
      if (!data.enabled) return checkoutView(card, '<h1>ยังไม่เปิดซื้อจริง</h1><p>ทดลองซื้อได้ในโหมดสาธิตเท่านั้น</p>');
      const enough = data.balance >= card.price;
      const mounted = checkoutView(card, `<p class="eyebrow">ONE STEP CLOSER TO YOUR COLLECTION</p><h1>ยืนยันซื้อการ์ด</h1>${notice}<div class="checkout-layout"><section class="checkout-address"><h2>01 &nbsp; ข้อมูลผู้รับ</h2><p>กรอกข้อมูลสมมติสำหรับทดลองขั้นตอนจัดส่ง</p>${enough ? `<form id="checkout-form"><div class="address-fields"><label>ชื่อผู้รับ<input name="recipient" autocomplete="name" required maxlength="100" placeholder="ชื่อ–นามสกุลสมมติ"></label><label>เบอร์ติดต่อ<input name="phone" autocomplete="tel" required type="tel" inputmode="numeric" data-digits pattern="0[0-9]{8,9}" title="ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0" placeholder="0812345678"></label></div><label>ที่อยู่จัดส่ง<textarea name="address" rows="4" minlength="15" maxlength="700" required placeholder="บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด และรหัสไปรษณีย์สมมติ"></textarea></label><label class="save-address"><input type="checkbox" name="saveAddress"> บันทึกเป็นที่อยู่หลักสำหรับครั้งถัดไป</label><a href="#/profile">จัดการที่อยู่ในโปรไฟล์</a><div class="checkout-policy"><strong>การจัดส่งสาธิต · ไม่มีค่าจัดส่ง</strong><p>ผู้ขายจะแจ้งเลขพัสดุในคำสั่งซื้อ ยกเลิกและคืนเครดิตได้ก่อนแจ้งจัดส่ง</p></div>${showError}<button class="dark">ยืนยันซื้อด้วยเครดิตสาธิต ${money(card.price)}</button></form>` : '<div class="checkout-policy"><h3>เครดิตไม่เพียงพอ</h3><p>เติมเครดิตแล้วกลับมาตรวจยอดอีกครั้ง</p><button id="checkout-topup" class="dark">เติมเครดิตสาธิต</button><button id="checkout-refresh" class="secondary">ตรวจยอดอีกครั้ง</button></div>'}</section><aside class="checkout-receipt"><h2>02 &nbsp; สรุปรายการ</h2><div class="checkout-card"><img src="${esc(card.image)}" alt="${esc(card.name)}"><div><strong>${esc(card.name)}</strong><p>${esc(card.condition)} · ${esc(gradeText(card))} · 1 ใบ<br>ร้าน ${esc(card.sellerName)}</p><b class="price">${money(card.price)}</b></div></div><div class="checkout-summary"><span>เครดิตคงเหลือ</span><b>${money(data.balance)}</b><span>ค่าจัดส่งสาธิต</span><b>ฟรี</b><span>ยอดรวม</span><b>${money(card.price)}</b><span>เครดิตหลังซื้อ</span><b>${enough ? money(data.balance - card.price) : 'เครดิตไม่เพียงพอ'}</b></div><a class="back-market" href="#/cards/${encodeURIComponent(card.id)}">← กลับไปดูรายละเอียดการ์ด</a></aside></div>`);
      if (!mounted) return;
      const img = $('#product-page .checkout-card img'); img.onerror = () => { img.onerror = null; img.src = '/art/placeholder.svg'; };
      if (!enough) { $('#checkout-topup').onclick = wallet; $('#checkout-refresh').onclick = refreshProduct; return; }
      const saved=profileData.shippingAddress;
      if(saved)for(const k of ['recipient','phone','address'])$('#checkout-form').elements[k].value=k==='phone'?saved[k].replace(/\D/g,''):saved[k];
      let key = crypto.randomUUID();
      $('#checkout-form').oninput = () => { key = crypto.randomUUID(); };
      $('#checkout-form').onsubmit = async event => {
        event.preventDefault(); const button = event.submitter; button.disabled = true;
        try {
          const fields = new FormData(event.target);
          if(fields.get('saveAddress'))await api('/profile','PATCH',{shippingAddress:{recipient:fields.get('recipient'),phone:fields.get('phone'),address:fields.get('address')}});
          const address = `${fields.get('recipient')}\n${fields.get('phone')}\n${fields.get('address')}`;
          await api('/orders', 'POST', { cardId: card.id, expectedPrice: card.price, address }, key);
          toast('ซื้อสำเร็จด้วยเครดิตสาธิต'); onPurchased(); loadCards(); await orders('purchases');
        } catch(e) { onError(e); button.disabled = false; }
      };
    } catch(e) { toast(e.message); }
  }
  const orderPage=initOrders({ api, state, money, escapeHTML:esc, authForm, toast, loadCards });
  const orders=scope=>orderPage.open(scope);
  $('#wallet').onclick = wallet;
  $('#orders-nav').onclick = () => orders();
  return { checkout, orders, wallet, refreshHeader, refreshOrders:orderPage.refresh };
}
