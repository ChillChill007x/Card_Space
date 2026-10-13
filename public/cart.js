// ตะกร้าเต็มหน้า: รายการอยู่ในบัญชี แต่ไม่กันสินค้าไว้จนกว่าจะชำระสำเร็จ
export function initCart({ api, state, money, escapeHTML: esc, authForm, toast, loadCards, wallet, orders }) {
  const host=document.createElement('section');host.id='cart-page';host.hidden=true;document.querySelector('.main-nav').after(host);
  let generation=0, key=crypto.randomUUID(), address='', addressOwner=null;
  // ใส่การ์ดลงตะกร้า (ต้องเข้าสู่ระบบก่อน)
  async function add(card) {
    if(!state.user)return authForm();
    try { await api('/cart','POST',{cardId:card.id});toast('ใส่ตะกร้าแล้ว · ยังไม่จองสินค้า'); }
    catch(e){toast(e.message);}
  }
  // โหลดราคาและสต็อกใหม่ทุกครั้ง แสดงรายการที่ซื้อไม่ได้โดยไม่ลบทิ้งเอง
  async function route() {
    const request=++generation, active=location.hash==='#/cart';
    if(addressOwner!==state.user?.id){address='';addressOwner=state.user?.id;}
    document.body.classList.toggle('cart-open',active);host.hidden=!active;
    if(!active){host.innerHTML='';return;}
    if(!state.user){address='';host.innerHTML='<h1>ตะกร้าของคุณ</h1><p>เข้าสู่ระบบเพื่อเก็บรายการที่สนใจ</p><button class="dark" id="cart-login">เข้าสู่ระบบ</button>';host.querySelector('button').onclick=()=>authForm();return;}
    const userId=state.user.id;
    host.innerHTML='<p role="status">กำลังตรวจตะกร้า…</p>';
    try {
      const [cart,balance,profile]=await Promise.all([api('/cart'),api('/wallet'),api('/profile')]);
      if(request!==generation || userId!==state.user?.id)return;
      const saved=profile.shippingAddress;
      if(!address && saved)address=`${saved.recipient}\n${saved.phone}\n${saved.address}`;
      const available=cart.items.filter(i=>i.available), total=available.reduce((sum,i)=>sum+i.card.price,0);
      key=crypto.randomUUID();
      host.innerHTML=`<a class="back-market" href="#/">← เลือกการ์ดเพิ่ม</a><p class="eyebrow">YOUR COLLECTION STARTS HERE</p><h1>ตะกร้าของคุณ <small>${cart.count} รายการ</small></h1><p class="cart-notice">ใส่ตะกร้าไว้ก่อนได้ แต่ยังไม่จองสินค้า คนอื่นยังซื้อได้จนกว่าคุณจะชำระสำเร็จ</p><div class="cart-layout"><div class="cart-items">${cart.items.map(i=>`<article class="cart-item ${i.available?'':'unavailable'}">${i.card?`<a href="#/cards/${encodeURIComponent(i.cardId)}"><img src="${esc(i.card.image)}" alt="${esc(i.card.name)}"></a><div><h2><a href="#/cards/${encodeURIComponent(i.cardId)}">${esc(i.card.name)}</a></h2><p>ร้าน ${esc(i.card.sellerName)}</p><strong>${money(i.card.price)}</strong><p>${i.available?'พร้อมซื้อ · 1 ใบ':esc(i.reason)}</p></div>`:'<div><h2>รายการไม่พร้อมใช้งาน</h2><p>ผู้ขายลบการ์ดนี้แล้ว</p></div>'}<button class="text-button" data-remove="${esc(i.cardId)}" aria-label="นำ ${esc(i.card?.name || 'รายการ')} ออกจากตะกร้า">นำออก</button></article>`).join('') || '<div class="empty">ยังไม่มีการ์ดในตะกร้า<br>เปิดรายละเอียดการ์ดแล้วกด “ใส่ตะกร้า”</div>'}</div><aside class="cart-summary"><h2>สรุปยอด</h2><div class="cart-totals"><span>รายการที่ซื้อได้</span><strong>${available.length} ใบ</strong><span>เครดิตคงเหลือ</span><strong id="cart-balance">${money(balance.balance)}</strong><span>ยอดชำระรวม</span><strong id="cart-total">${money(total)}</strong></div>${cart.count>available.length?'<p>รายการที่ขายแล้วหรือไม่พร้อมซื้อจะไม่รวมในยอดชำระ</p>':''}<button type="button" class="secondary" id="cart-topup">เติมเครดิต</button><button type="button" class="text-button" id="cart-refresh">ตรวจยอด / รายการอีกครั้ง</button><p><a href="#/profile">บันทึก / แก้ไขที่อยู่ในโปรไฟล์</a></p><form id="cart-checkout"><label>ชื่อผู้รับ เบอร์โทร และที่อยู่จัดส่งสาธิต<textarea name="address" rows="4" minlength="15" maxlength="1000" required placeholder="กรอกข้อมูลสมมติสำหรับทดลองจัดส่ง">${esc(address)}</textarea></label><p class="error" id="cart-error" role="alert"></p><button class="dark" ${!available.length || total>balance.balance || !balance.enabled?'disabled':''}>ชำระ ${money(total)} ด้วยเครดิต</button>${total>balance.balance?'<p>เครดิตไม่พอ กรุณาเติมเครดิตแล้วตรวจยอดอีกครั้ง</p>':''}</form><small>เครดิตจำลอง ไม่มีการเรียกเก็บเงินจริง</small></aside></div>`;
      host.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.onerror=null;img.src='/art/placeholder.svg';});
      host.querySelector('textarea').oninput=e=>{address=e.target.value;key=crypto.randomUUID();};
      host.querySelector('#cart-topup').onclick=wallet;
      host.querySelector('#cart-refresh').onclick=route;
      host.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{
        b.disabled=true;try{await api('/cart/'+encodeURIComponent(b.dataset.remove),'DELETE');await route();}catch(e){host.querySelector('#cart-error').textContent=e.message;b.disabled=false;}
      });
      host.querySelector('form').onsubmit=async e=>{
        e.preventDefault();e.submitter.disabled=true;
        try {
          await api('/cart/checkout','POST',{items:available.map(i=>({cardId:i.cardId,expectedPrice:i.card.price})),address},key);
          address='';toast('ชำระสำเร็จด้วยเครดิตจำลอง');await loadCards();await route();await orders('purchases');
        } catch(error){const el=host.querySelector('#cart-error');if(el)el.textContent=error.message;e.submitter.disabled=false;}
      };
    } catch(e){if(request===generation)host.innerHTML=`<p class="error">${esc(e.message)}</p><a href="#/">กลับตลาด</a>`;}
  }
  addEventListener('account-changed',()=>{if(addressOwner!==state.user?.id)route();});
  addEventListener('app-route-change',route);
  addEventListener('hashchange',route);addEventListener('popstate',route);
  document.querySelector('#dialog').addEventListener('close',()=>{if(location.hash==='#/cart')route();});
  return {add,refresh:route,open:()=>{if(location.hash==='#/cart')route();else location.hash='/cart';}};
}
