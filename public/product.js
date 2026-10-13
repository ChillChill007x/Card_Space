import { gradeText } from './grading.js';
// Hash routes are shareable and reloadable without special server rewrites.
export function initProduct({ report, state, api, money, escapeHTML: esc, bindCardTilt, checkout, addToCart, edit, remove, loadCards }) {
  const $ = s => document.querySelector(s);
  const view = document.createElement('section');
  view.id = 'product-page'; view.hidden = true;
  $('.main-nav').after(view);
  let generation = 0, homeScroll = 0, active = null;
  const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
  const date = value => new Date(value).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  // เปลี่ยน URL แบบไม่โหลดหน้าใหม่ และจำตำแหน่งเลื่อนของหน้าตลาดไว้กลับมา
  const navigate = hash => {
    if (!document.body.classList.contains('product-open')) homeScroll = scrollY;
    if (location.hash !== hash) history.pushState(null, '', hash);
    dispatchEvent(new Event('app-route-change'));
    return route();
  };
  const home = () => navigate('#/');
  const breadcrumbs = (c, payment = false) => `<nav class="breadcrumbs" aria-label="ตำแหน่งหน้า"><a href="#/">ตลาดการ์ด</a><span>/</span>${payment ? `<a href="#/cards/${encodeURIComponent(c.id)}">${esc(c.name)}</a><span>/</span><span>ยืนยันการซื้อ</span>` : `<span>${esc(c.category)}</span><span>/</span><span>${esc(c.name)}</span>`}</nav>`;
  // ติดตั้งภาพทดแทนเมื่อรูปสินค้าโหลดไม่สำเร็จ
  function images() {
    view.querySelectorAll('img').forEach(img => { img.onerror = () => { img.onerror = null; img.src = '/art/placeholder.svg'; }; });
  }
  // ย้าย focus ไปหัวข้อเพื่อช่วยผู้ใช้คีย์บอร์ดและ screen reader
  function focusHeading() { const heading = view.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }
  // แสดงสินค้าและปุ่มตามสิทธิ์ พร้อมภาพหน้า/หลังและเอฟเฟกต์ 3D
  function render(c) {
    const owner = state.user?.id === c.sellerId && state.user?.verification === 'approved';
    const sample = c.id.startsWith('sample-');
    const conditionText = { 'Near Mint': 'สภาพโดยรวมใกล้เคียงใหม่', Excellent: 'อาจมีร่องรอยใช้งานเล็กน้อย', Played: 'มีร่องรอยจากการใช้งาน' }[c.condition] || c.condition;
    view.innerHTML = `${breadcrumbs(c)}<div class="product-layout"><div class="product-gallery"><div class="product-stage"><span class="gallery-label">CARD VIEW <b>3D</b></span><div class="card-surface"><img id="product-image" src="${esc(c.image)}" alt="ด้านหน้าของ ${esc(c.name)}" draggable="false"></div><span class="gallery-corner">✦</span></div><div class="gallery-bottom"><div class="image-tabs"><button class="selected" data-side="front" aria-pressed="true"><img src="${esc(c.image)}" alt="">ด้านหน้า</button>${c.backImage ? `<button data-side="back" aria-pressed="false"><img src="${esc(c.backImage)}" alt="">ด้านหลัง</button>` : '<span class="missing-back">ร้านค้ายังไม่ได้เพิ่มภาพด้านหลัง</span>'}${c.detailImage ? `<button data-side="detail" aria-pressed="false"><img src="${esc(c.detailImage)}" alt="">ตำหนิ / รายละเอียด</button>` : ''}</div><p class="tilt-tip">↗ ขยับเมาส์เพื่อดูมุมเอียงและแสงสะท้อน</p></div><div class="image-disclaimer">${sample ? 'ภาพแนวคิดสำหรับสาธิต ไม่ใช่ภาพการ์ดจริง' : 'ภาพจากผู้ขาย · เอฟเฟกต์ 3D เป็นการเอียงภาพ ไม่ใช่ภาพสแกนตัวสินค้า'}</div></div><div class="product-info"><div class="product-tags"><span>${esc(c.category)}</span><span>${esc(c.rarity)}</span><span class="availability">${c.sold ? 'ขายแล้ว' : c.purchasable ? 'พร้อมขาย · 1 ใบ' : 'ยังไม่พร้อมขาย'}</span></div><h1>${esc(c.name)}</h1><p class="product-set">${esc(c.set)}</p><div class="grading-panel"><span class="grade-badge">${esc(gradeText(c))}</span>${c.grading ? `<div><strong>เลขใบรับรอง ${esc(c.grading.certificate)}</strong><p>ผู้ขายเป็นผู้ระบุเกรด · เว็บไซต์ยังไม่ได้ยืนยันใบรับรอง</p></div>` : '<p>การ์ดดิบ (Raw) · ไม่มีข้อมูลการประเมินจากบริษัทให้เกรด</p>'}</div><div class="product-price"><strong>${money(c.price)}</strong><span>ราคาต่อ 1 ใบ</span></div><div class="condition-box"><span class="condition-icon">◇</span><div><strong>${esc(c.condition)}</strong><p>${esc(conditionText)} · ตามที่ผู้ขายระบุ</p></div></div><dl class="product-specs">${c.character?`<div><dt>ตัวละคร</dt><dd>${esc(c.character)}</dd></div>`:''}<div><dt>ประเภทการ์ด</dt><dd>${esc(c.category)}</dd></div><div><dt>ความหายาก</dt><dd>${esc(c.rarity)}</dd></div><div><dt>ภาษา</dt><dd>${esc(c.language || 'ผู้ขายยังไม่ระบุ')}</dd></div><div><dt>จำนวน</dt><dd>1 ใบ / รายการ</dd></div></dl><div class="product-actions">${c.sold ? '<button class="dark" disabled>การ์ดใบนี้ขายแล้ว</button>' : !c.purchasable && state.user?.id !== c.sellerId ? '<button class="dark" disabled>ร้านค้านี้ยังไม่พร้อมขาย</button>' : state.user?.id !== c.sellerId ? '<button id="buy-card" class="dark">ซื้อทันที <span>↗</span></button><button id="add-to-cart" class="secondary">＋ ใส่ตะกร้า</button>' : ''}${owner && !c.sold ? '<button id="edit" class="secondary">แก้ไขรายละเอียด</button>' : ''}${(owner || state.user?.role === 'admin') && !c.sold ? '<button id="delete" class="text-button">ลบรายการ</button>' : ''}</div><p class="purchase-disclaimer">เครดิตสาธิตเท่านั้น · ยังไม่รับเงินจริงหรือจัดส่งจริง</p><div class="seller-panel"><div class="seller-avatar">${c.sellerAvatar ? `<img src="${esc(c.sellerAvatar)}" alt="รูปโปรไฟล์ร้าน ${esc(c.sellerName)}">` : esc(c.sellerName.slice(0,1).toUpperCase())}</div><div><small>วางขายโดย</small><strong>${esc(c.sellerName)}</strong>${c.merchantCode?`<span>รหัสพ่อค้า: ${esc(c.merchantCode)}</span>`:''}<span>${sample ? 'ร้านตัวอย่างสำหรับสาธิต' : c.sellerApproved ? 'บัญชีพ่อค้าได้รับอนุมัติ' : 'ร้านค้ายังไม่พร้อมทำรายการ'}</span>${c.sellerRating?.count ? `<span class="seller-rating" aria-label="คะแนนร้าน ${c.sellerRating.average} จาก 5"><b>${stars(c.sellerRating.average)}</b> ${c.sellerRating.average.toFixed(1)} · ${c.sellerRating.count} รีวิว</span>` : '<span class="seller-rating">ยังไม่มีรีวิว</span>'}</div></div></div></div><div class="product-details"><section class="detail-panel"><p class="eyebrow">ABOUT THIS CARD</p><h2>รายละเอียดการ์ด</h2><p class="preserve-lines">${esc(c.description || (sample ? 'รายการตัวอย่างสำหรับทดลองค้นหา ดูภาพ และซื้อด้วยเครดิตสาธิต\nภาพและชื่อการ์ดเป็นข้อมูลสมมติ ไม่ใช่สินค้าในสต็อกจริง' : 'ผู้ขายยังไม่ได้เพิ่มคำอธิบายเพิ่มเติม'))}</p><dl class="detail-meta"><div><dt>เซ็ต / รหัสการ์ด</dt><dd>${esc(c.set)}</dd></div><div><dt>ลงขายเมื่อ</dt><dd>${esc(date(c.createdAt))}</dd></div><div><dt>รหัสรายการ</dt><dd>${esc(c.id)}</dd></div></dl><h3>สภาพและตำหนิ</h3><p class="preserve-lines">${esc(c.conditionNotes || 'ผู้ขายยังไม่ได้ระบุรายละเอียดตำหนิ โปรดตรวจภาพด้านหน้าและด้านหลังก่อนตัดสินใจ')}</p></section><section class="detail-panel shipping-panel"><p class="eyebrow">BEFORE YOU CHECK OUT</p><h2>การจัดส่งและการซื้อ</h2><p class="preserve-lines">${esc(c.shippingNotes || 'ผู้ขายยังไม่ได้ระบุข้อมูลการแพ็กหรือระยะเวลาเตรียมสินค้า')}</p><ol><li><strong>ชำระด้วยเครดิตสาธิต</strong><span>ตรวจยอดคงเหลือและข้อมูลผู้รับในหน้าซื้อ</span></li><li><strong>รอผู้ขายแจ้งเลขพัสดุ</strong><span>ติดตามสถานะได้ในเมนูคำสั่งซื้อ</span></li><li><strong>ยืนยันเมื่อได้รับสินค้า</strong><span>ระบบจะโอนเครดิตสาธิตให้พ่อค้า</span></li></ol><p class="demo-notice">ค่าจัดส่งสาธิตฟรี ยกเลิกและคืนเครดิตได้ก่อนผู้ขายแจ้งจัดส่ง ยังไม่มีการส่งสินค้าจริง</p></section></div><section class="related-cards" aria-labelledby="related-title"><p class="eyebrow">YOU MAY ALSO LIKE</p><h2 id="related-title">การ์ดที่คุณอาจสนใจ</h2><div class="related-grid"><p class="related-empty">กำลังหาการ์ดที่ใกล้เคียง…</p></div></section><a class="back-market" href="#/">← กลับไปสำรวจการ์ดอื่น</a>`;
    loadRelated(c);
    const sellerPanel=view.querySelector('.seller-panel');
    const sellerLink=document.createElement('a');sellerLink.className=sellerPanel.className+' seller-profile-link';sellerLink.href=`#/merchants/${encodeURIComponent(c.sellerId)}`;sellerLink.innerHTML=sellerPanel.innerHTML+'<span class="seller-visit">ดูร้านค้า ↗</span>';sellerPanel.replaceWith(sellerLink);sellerLink.children[1].classList.add('seller-profile-info');
    bindCardTilt($('.product-stage'), $('.product-stage'), $('.product-stage .card-surface'));
    view.querySelectorAll('[data-side]').forEach(button => button.onclick = () => {
      const side = button.dataset.side;
      $('#product-image').src = { front:c.image, back:c.backImage, detail:c.detailImage }[side];
      $('#product-image').alt = `${{ front:'ด้านหน้า', back:'ด้านหลัง', detail:'ตำหนิ / รายละเอียด' }[side]}ของ ${c.name}`;
      view.querySelectorAll('[data-side]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    });
    if ($('#buy-card')) $('#buy-card').onclick = () => navigate(`#/cards/${encodeURIComponent(c.id)}/checkout`);
    if ($('#add-to-cart')) $('#add-to-cart').onclick = () => addToCart(c);
    if ($('#edit')) $('#edit').onclick = () => edit(c);
    if ($('#delete')) $('#delete').onclick = () => remove(c);
    if(['customer','merchant'].includes(state.user?.role)&&state.user.id!==c.sellerId){const button=document.createElement('button');button.id='report-product';button.className='text-button';button.textContent='⚑ รายงานสินค้า';button.onclick=()=>report(c);view.querySelector('.seller-panel').after(button);}
    images(); focusHeading();
  }
  // การ์ดแนะนำโหลดแยกหลังหน้าแสดงแล้ว ไม่หน่วงการเปิดหน้าสินค้า
  async function loadRelated(c) {
    const request = generation, grid = view.querySelector('.related-grid');
    try {
      const cards = await api(`/cards/${encodeURIComponent(c.id)}/related`);
      if (request !== generation || !grid.isConnected) return;
      if (!cards.length) { grid.closest('section').remove(); return; }
      grid.innerHTML = cards.map(r => `<a class="related-card" href="#/cards/${encodeURIComponent(r.id)}"><img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy"><small>${esc(r.rarity)} · ${esc(r.category)}</small><strong>${esc(r.name)}</strong><span>${money(r.price)}</span></a>`).join('');
      grid.querySelectorAll('img').forEach(img => { img.onerror = () => { img.onerror = null; img.src = '/art/placeholder.svg'; }; });
    } catch { if (request === generation && grid.isConnected) grid.closest('section').remove(); }
  }
  // อ่าน hash แล้วโหลดสินค้า ป้องกันผลลัพธ์เก่าทับหน้าที่เปิดใหม่
  async function route() {
    const request = ++generation;
    const match = location.hash.match(/^#\/cards\/([^/]+)(\/checkout)?$/);
    $('#dialog').close();
    if (!match) {
      const wasOpen = document.body.classList.contains('product-open');
      active = null; view.hidden = true; document.body.classList.remove('product-open');
      document.title = 'Cardspace — ค้นพบการ์ดใบถัดไป';
      if (wasOpen) { loadCards(); window.scrollTo(0, homeScroll); }
      return;
    }
    document.body.classList.add('product-open'); view.hidden = false;
    view.innerHTML = '<div class="product-loading" role="status">กำลังโหลดรายละเอียดการ์ด…</div>';
    window.scrollTo(0, 0);
    try {
      const c = await api(`/cards/${match[1]}`);
      if (request !== generation) return;
      active = c; document.title = `${c.name} — Cardspace`;
      if (match[2] && c.purchasable && state.user?.id !== c.sellerId) await checkout(c);
      else render(c);
    } catch(e) {
      if (request !== generation) return;
      view.innerHTML = `<div class="product-loading"><h1>เปิดรายการนี้ไม่ได้</h1><p>${esc(e.message)}</p><a class="dark" href="#/">กลับตลาดการ์ด</a></div>`; focusHeading();
    }
  }
  // แสดงหน้าซื้อเฉพาะเมื่อ route และสินค้าปัจจุบันยังตรงกัน
  function checkoutView(c, html) {
    if (!location.hash.endsWith('/checkout') || active?.id !== c.id) return false;
    view.innerHTML = `${breadcrumbs(c, true)}<div class="checkout-page">${html}</div>`;
    images(); focusHeading(); return true;
  }
  addEventListener('hashchange', route);
  addEventListener('popstate', route);
  return { show: c => navigate(`#/cards/${encodeURIComponent(c.id)}`), home, refresh: route, checkoutView };
}
