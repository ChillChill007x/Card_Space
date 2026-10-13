// จุดเริ่มต้นของหน้าเว็บ: หน้าตลาดการ์ด การค้นหา/กรอง เมนูบัญชี ฟอร์มลงขาย และเชื่อมโมดูลย่อยทุกหน้าเข้ากับ API
import { initMerchantProfile } from './merchant-profile.js';
import { layoutListing } from './listing-layout.js';
import { initReports } from './reports.js';
import { initProfile } from './profile.js';
import { initCart } from './cart.js';
// ควบคุมหน้าตลาด บัญชี แบบฟอร์มสินค้า และเชื่อม module ย่อยเข้ากับ API
import { initAdmin } from './admin.js';
import { bindListingUploads } from './uploads.js';
import { initVerification } from './verification.js';
import { gradingCompanies, gradesFor, gradeText } from './grading.js';
import { initProduct } from './product.js';
import { createCardPreview } from './preview.js';
import { initCommerce } from './commerce.js';
import { initPages } from './pages.js';
import { initNotifications } from './notifications.js';
const $ = s => document.querySelector(s);
const state = { user: null, cards: [], categories: [], category: '', mine: false, request: 0 };
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `฿${(n / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
const preview = createCardPreview({ escapeHTML, money, bindCardTilt, open: c => showCard(c) });
// Animate the artwork only. Stable hit bounds avoid jitter as the image tilts.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// ผูกเอฟเฟกต์เอียง 3D และแสงสะท้อนตามตำแหน่งเมาส์ ให้การ์ด (ปิดเองบนจอสัมผัสและเมื่อผู้ใช้ลดการเคลื่อนไหว)
function bindCardTilt(card, area = card, surface = card.querySelector('.card-surface')) {
  const imageArea = card.querySelector('.card-art') || area;
  let frame = 0, bounds, x = 0, y = 0;
  // คืนการ์ดเป็นท่าปกติ
  const reset = () => {
    cancelAnimationFrame(frame); frame = 0;
    card.classList.remove('is-tilting');
    ['--rx', '--ry', '--lift', '--scale', '--mx', '--my'].forEach(key => surface.style.removeProperty(key));
  };
  // คำนวณมุมเอียงจากตำแหน่งเมาส์ แล้วอัปเดตในเฟรมถัดไป
  const move = event => {
    // Trust the actual event: hybrid touch laptops may report pointer:coarse
    // even while a mouse is connected.
    if (event.pointerType === 'touch' || reducedMotion.matches) { reset(); return; }
    bounds = imageArea.getBoundingClientRect();
    x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0; card.classList.add('is-tilting');
      surface.style.setProperty('--rx', `${(0.5 - y) * 32}deg`);
      surface.style.setProperty('--ry', `${(x - 0.5) * 40}deg`);
      surface.style.setProperty('--lift', '-9px');
      surface.style.setProperty('--scale', '1.06');
      surface.style.setProperty('--mx', `${x * 100}%`);
      surface.style.setProperty('--my', `${y * 100}%`);
    });
  };
  area.addEventListener('pointerenter', move);
  area.addEventListener('pointermove', move);
  ['pointerleave', 'pointercancel', 'pointerdown'].forEach(type => area.addEventListener(type, reset));
}
// Hero artwork shares the same interaction as marketplace cards. The wrapper
// keeps its resting rotation and stable pointer bounds separate from the tilt.
document.querySelectorAll('.hero-card').forEach(img => {
  const wrapper = document.createElement('div');
  wrapper.className = img.className.replace('hero-card', 'hero-tilt');
  const surface = document.createElement('div');
  surface.className = 'card-surface';
  img.before(wrapper); wrapper.append(surface); surface.append(img);
  img.className = 'hero-image'; img.draggable = false;
  bindCardTilt(wrapper, wrapper, surface);
});
// ช่องตัวเลขล้วน (เช่น เบอร์โทร) ตัดขีด ช่องว่าง และอักขระอื่นออกทันทีที่พิมพ์หรือวาง
document.addEventListener('input', event => { if (event.target.matches?.('input[data-digits]')) { const v = event.target.value.replace(/\D/g, ''); if (v !== event.target.value) event.target.value = v; } });
// Search shortcut ignores fields and dialogs, so typing in forms is unaffected.
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !$('#dialog').open && !event.target.closest('input, textarea, select, [contenteditable]')) {
    event.preventDefault(); $('#search').focus();
  }
});
// เรียก REST API พร้อม session cookie และแปลงข้อผิดพลาดเป็นข้อความให้หน้าจอ
async function api(path, method = 'GET', data, idempotencyKey) {
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.message || 'เกิดข้อผิดพลาด'); if (method !== 'GET' && !path.startsWith('/auth/')) dispatchEvent(new Event('commerce-changed')); return result;
}
// แสดงข้อความผลลัพธ์ชั่วคราวและยกเลิก timer เก่า
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 4000); }
// เปิดหน้าต่างแบบฟอร์มโดยปิด hover preview ก่อน
function modal(html) { $('#dialog').classList.remove('listing-fullscreen'); preview.hide(); $('#dialog-content').innerHTML = html; if (!$('#dialog').open) $('#dialog').showModal(); }
$('#close-dialog').onclick = () => $('#dialog').close();
$('#dialog').addEventListener('click', event => { if (event.target === $('#dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
// อัปเดตบัญชีและแถบขั้นตอนเปิดร้าน โดยไม่แสดงหลักฐานส่วนตัวบนหน้าตลาด
function updateUser() {
  state.authLoaded = true;
  $('#admin-nav').hidden = state.user?.role !== 'admin';
  $('#reports-nav').hidden = state.user?.role !== 'admin';
  // แสดงเครื่องมือขายเฉพาะพ่อค้า และล้างหน้าร้านเมื่อเปลี่ยนบัญชี
  document.querySelectorAll('[data-merchant-only]').forEach(el => { el.hidden = state.user?.role !== 'merchant'; });
  syncShopView();
  commerce.refreshHeader();
  dispatchEvent(new Event('account-changed'));
  $('#account').innerHTML = state.user ? `${state.user.avatar ? `<img class="account-avatar" src="${escapeHTML(state.user.avatar)}" alt="">` : ''}${escapeHTML(state.user.name)} ▾` : 'เข้าสู่ระบบ ↗';
  let banner = $('#merchant-status');
  if (!banner) { banner=document.createElement('section'); banner.id='merchant-status'; $('.main-nav').after(banner); }
  banner.hidden = state.user?.role !== 'merchant';
  if (banner.hidden) { banner.innerHTML=''; return; }
  const u=state.user;
  const next = u.verification === 'approved' ? 'ร้านพร้อมแล้ว — ลงขายการ์ดหรือจัดการรายการในร้านได้เลย' : u.verification === 'rejected' ? `ต้องแก้ไข / ถูกระงับ — ${u.verificationNote || 'เปิดข้อมูลยืนยันเพื่อดูเหตุผลจากแอดมิน'}` : u.verificationSubmitted ? 'ส่งหลักฐานแล้ว — รอแอดมินตรวจสอบ เปิดดูสถานะล่าสุดได้ที่นี่' : 'เริ่มเปิดร้าน — กรอกข้อมูลและแนบหลักฐานเพื่อให้แอดมินตรวจสอบ';
  banner.innerHTML=`<div><strong>${escapeHTML(next)}</strong><p>1. ส่งข้อมูล → 2. ตรวจสอบ → 3. เปิดขาย</p></div><button class="secondary" id="merchant-next">${u.verification === 'approved' ? 'เปิดร้านของฉัน' : 'ข้อมูลยืนยัน / ตรวจสถานะ'}</button>`;
  $('#merchant-next').onclick=()=>$('#my-shop').click();
}
// สร้างปุ่มหมวดหมู่และโหลดรายการตามหมวดที่เลือก
function renderCategories() {
  $('#categories').innerHTML = ['', ...state.categories].map((c, i) => `<button class="category ${state.category === c ? 'active' : ''}" data-category="${escapeHTML(c)}" aria-pressed="${state.category === c}">${['▦', '◉', '✧', '⚑', '♧'][i]} &nbsp; ${escapeHTML(c || 'ทั้งหมด')}</button>`).join('');
  $('#categories').querySelectorAll('button').forEach(b => b.onclick = () => { state.category = b.dataset.category; renderCategories(); loadCards(); });
}
// Debounced search and a request counter prevent stale responses replacing newer filters.
async function loadCards() {
  preview.hide();
  const request = ++state.request;
  const params = new URLSearchParams({ q: $('#search').value, category: state.category, condition: $('#condition').value, grading: $('#grading-filter').value, sort: $('#sort').value, ...(state.mine ? { mine: '1' } : {}) });
  $('#count').textContent = 'กำลังโหลด...';
  try {
    if (state.mine && (state.user?.role !== 'merchant' || state.user.verification !== 'approved')) { $('#count').textContent=''; $('#cards').innerHTML='<div class="empty">ร้านยังไม่เปิดขาย — ตรวจสอบสถานะการยืนยันด้านบน เมื่อได้รับอนุมัติจะลงขายการ์ดได้</div>'; return; }
    const cards = await api(`/cards?${params}`); if (request !== state.request) return; state.cards = cards;
    $('#count').textContent = `พบ ${cards.length} รายการ`;
    $('#catalog-title').textContent = state.mine ? 'การ์ดในร้านของฉัน' : 'ค้นพบการ์ดใบถัดไป';
    $('#cards').innerHTML = cards.length ? cards.map(c => `${state.mine ? '<article class="shop-listing">' : ''}<button class="card" data-id="${c.id}" aria-label="ดูรายละเอียด ${escapeHTML(c.name)}"><div class="card-art"><div class="card-surface"><img src="${escapeHTML(c.image)}" alt="${escapeHTML(c.name)}" loading="lazy"></div><span class="view-indicator" aria-hidden="true">↗</span><span class="rarity">${escapeHTML(c.rarity)}</span>${c.grading ? `<span class="grade-badge">${escapeHTML(gradeText(c))}</span>` : ''}</div><div class="card-body"><span class="card-category">${escapeHTML(c.category)}</span><h3>${escapeHTML(c.name)}</h3><div class="card-set">${escapeHTML(c.set)}</div><div class="card-price-row"><span class="price">${money(c.price)}</span><span class="condition">${escapeHTML(c.condition)}</span></div><div class="seller"><span>◉</span> ${escapeHTML(c.sellerName)}${c.id.startsWith('sample-') ? ' · ตัวอย่าง' : ''}</div></div></button>${state.mine ? `<div class="shop-card-actions"><button class="secondary" data-shop-edit="${escapeHTML(c.id)}">แก้ไขรายการ</button><button class="text-button" data-shop-delete="${escapeHTML(c.id)}">ลบ</button></div></article>` : ''}`).join('') : '<div class="empty">ไม่พบการ์ดที่ตรงกับเงื่อนไข<br><br>ลองเปลี่ยนคำค้นหรือกดล้างตัวกรอง</div>';
    $('#cards').querySelectorAll('.card').forEach(el => { const card = cards.find(c => c.id === el.dataset.id); el.onclick = () => showCard(card); bindCardTilt(el); preview.bind(el, card); });
    $('#cards').querySelectorAll('[data-shop-edit]').forEach(b=>b.onclick=()=>listingForm(cards.find(c=>c.id===b.dataset.shopEdit)));
    $('#cards').querySelectorAll('[data-shop-delete]').forEach(b=>b.onclick=()=>deleteListing(cards.find(c=>c.id===b.dataset.shopDelete)));
    $('#cards').querySelectorAll('img').forEach(el => el.onerror = () => { el.onerror = null; el.src = '/art/placeholder.svg'; });
  } catch (error) { if (request !== state.request) return; $('#count').textContent = 'โหลดไม่สำเร็จ'; $('#cards').innerHTML = `<div class="empty">${escapeHTML(error.message)}<br><button id="retry" class="text-button">ลองใหม่</button></div>`; $('#retry').onclick = loadCards; }
}
let timer; $('#search').oninput = () => { if (document.body.classList.contains('product-open')) product.home(); clearTimeout(timer); timer = setTimeout(loadCards, 200); };
$('#grading-filter').onchange = $('#condition').onchange = $('#sort').onchange = loadCards;
$('#reset').onclick = () => { state.category = ''; $('#search').value = ''; $('#condition').value = ''; $('#grading-filter').value = ''; $('#sort').value = 'newest'; renderCategories(); loadCards(); };
$('#explore').onclick = () => $('#catalog').scrollIntoView({ behavior: 'smooth' });
$('#market').onclick = () => { product.home(); state.mine = false; loadCards(); $('#catalog').scrollIntoView({ behavior: 'smooth' }); };
// เปิดรายละเอียดสินค้าแบบเต็มหน้า
function showCard(c) { preview.hide(); product.show(c); }
// ให้ยืนยันก่อนลบและโหลดตลาดใหม่เมื่อสำเร็จ
function deleteListing(c) {
  modal(`<h2>ลบรายการนี้?</h2><p>${escapeHTML(c.name)}</p><button class="dark" id="confirm-delete">ยืนยันลบรายการ</button><p class="error" id="form-error"></p>`);
  $('#confirm-delete').onclick = async () => { try { await api(`/cards/${c.id}`, 'DELETE'); $('#dialog').close(); if(location.hash !== '#/shop') product.home(); toast('ลบรายการแล้ว'); loadCards(); } catch(e) { $('#form-error').textContent = e.message; } };
}
// แสดงฟอร์มสมัครหรือเข้าสู่ระบบและอัปเดตบัญชีที่ใช้งาน
function authForm(register = false, merchant = false) {
  modal(`<p class="eyebrow">WELCOME TO CARDSPACE</p><h2>${register ? 'เริ่มต้นคอลเลกชันของคุณ' : 'ยินดีต้อนรับกลับมา'}</h2><form id="auth-form">${register ? '<label>ชื่อที่แสดง<input name="name" required maxlength="80" autocomplete="name"></label>' : ''}<label>อีเมล<input name="email" type="email" required autocomplete="email"></label><label>รหัสผ่าน${register ? ' (อย่างน้อย 12 ตัวอักษร)' : ''}<input name="password" type="password" required ${register ? 'minlength="12"' : ''} maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}"></label>${register ? `<label>ประเภทบัญชี<select name="role"><option value="customer">นักสะสม / ผู้ซื้อ</option><option value="merchant" ${merchant ? 'selected' : ''}>พ่อค้า (รอแอดมินอนุมัติ)</option></select></label>` : ''}<div class="error" id="form-error" role="alert"></div><button class="dark" type="submit">${register ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</button></form><button class="text-button" id="switch-auth">${register ? 'มีบัญชีแล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครสมาชิก'}</button>`);
  $('#switch-auth').onclick = () => authForm(!register, merchant);
  $('#auth-form').onsubmit = async event => { event.preventDefault(); const submit = event.submitter; submit.disabled = true; try { state.user = await api(`/auth/${register ? 'register' : 'login'}`, 'POST', Object.fromEntries(new FormData(event.target))); updateUser(); $('#dialog').close(); if (location.hash.startsWith('#/cards/')) product.refresh(); toast(register && state.user.role === 'merchant' ? 'สมัครแล้ว กรุณารอแอดมินอนุมัติ' : 'เข้าสู่ระบบแล้ว'); loadCards(); } catch (e) { $('#form-error').textContent = e.message; } finally { submit.disabled = false; } };
}
// เมนูบัญชีคลี่ใต้ปุ่ม ปิดเมื่อเลือกเมนู คลิกข้างนอก หรือกด Escape
const accountMenu=document.createElement('div');accountMenu.id='account-menu';accountMenu.hidden=true;
$('.account').append(accountMenu);
$('#account').setAttribute('aria-controls','account-menu');$('#account').setAttribute('aria-expanded','false');
// ปิดเมนูบัญชี และคืน focus ให้ปุ่มเมื่อปิดด้วยคีย์บอร์ด
function closeAccountMenu(restoreFocus=false){accountMenu.hidden=true;accountMenu.replaceChildren();$('#account').setAttribute('aria-expanded','false');if(restoreFocus)$('#account').focus();}
document.addEventListener('click',event=>{if(!accountMenu.contains(event.target)&&!$('#account').contains(event.target))closeAccountMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!accountMenu.hidden)closeAccountMenu(true);});
document.addEventListener('focusin',event=>{if(!accountMenu.hidden&&!accountMenu.contains(event.target)&&!$('#account').contains(event.target))closeAccountMenu();});
addEventListener('account-changed',()=>closeAccountMenu());
addEventListener('hashchange',()=>closeAccountMenu());
$('#account').onclick = () => {
  if (!state.user) return authForm();
  if (!accountMenu.hidden) return closeAccountMenu();
  accountMenu.innerHTML = `<h2>${escapeHTML(state.user.name)}</h2><p>${escapeHTML(state.user.email)}<br>บทบาท: ${escapeHTML({ admin: 'แอดมิน', merchant: 'พ่อค้า', customer: 'ผู้ซื้อ' }[state.user.role])}${state.user.role === 'merchant' ? `<br>สถานะ: ${escapeHTML({ pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่ผ่านการอนุมัติ' }[state.user.verification])}` : ''}</p>${state.user.role === 'admin' ? '<button class="dark" id="admin">จัดการพ่อค้า</button>' : ''}${state.user.role === 'merchant' ? '<button class="dark" id="account-shop">ร้านค้าของฉัน</button> <button class="secondary" id="verification">ข้อมูลยืนยันพ่อค้า</button>' : ''}<br><button class="secondary" id="account-profile">โปรไฟล์และที่อยู่ของฉัน</button><br><button class="text-button" id="logout">ออกจากระบบ</button>`;
  accountMenu.querySelector('p').after($('#account-profile'));
  // ทางเข้าคำสั่งซื้อในเมนูบัญชี ใช้หน้าร่วมกับปุ่มบนแถบหลัก
  const accountOrders=document.createElement('button');accountOrders.id='account-orders';accountOrders.textContent='คำสั่งซื้อ';
  $('#account-profile').after(accountOrders);
  accountOrders.onclick=()=>commerce.orders('purchases');
  if(state.user.avatar){const img=document.createElement('img');img.className='account-avatar';img.src=state.user.avatar;img.alt='';accountMenu.querySelector('h2').prepend(img);}
  accountMenu.hidden=false;$('#account').setAttribute('aria-expanded','true');
  $('#logout').onclick = async () => { try { await api('/auth/logout', 'POST'); state.user = null; state.mine = false; updateUser(); if (['#/admin','#/cart','#/shop'].includes(location.hash)) location.hash = '/'; $('#dialog').close(); if (location.hash.startsWith('#/cards/')) product.refresh(); loadCards(); } catch(e) { toast(e.message); } };
  $('#account-profile').onclick = profile.open;
  accountMenu.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>closeAccountMenu(false)));
  accountMenu.querySelector('button')?.focus();
  if ($('#admin')) $('#admin').onclick = adminPanel;
  if ($('#verification')) $('#verification').onclick = verification.application;
  if ($('#account-shop')) $('#account-shop').onclick = () => $('#my-shop').click();
};
// ตรวจบทบาทและสถานะพ่อค้าก่อนเปิดแบบฟอร์มลงขาย
function sell() {
  if (!state.user) return authForm(true, true);
  if (state.user.role !== 'merchant') return modal('<h2>สำหรับบัญชีพ่อค้า</h2><p>บัญชีปัจจุบันไม่ได้เป็นพ่อค้า ในต้นแบบนี้เลือกประเภทพ่อค้าเมื่อสมัครสมาชิกใหม่</p>');
  if (state.user.verification === 'pending' && state.user.verificationSubmitted) return $('#my-shop').click();
  if (state.user.verification !== 'approved') return verification.application();
  // สร้างและแก้ไขรายการ รวมรูป เกรด รายละเอียด และตรวจข้อมูลก่อนส่ง
  listingForm();
}
$('#sell').onclick = sell;
$('#header-sell').onclick = sell;
// เข้าหน้ารายการของร้านโดยตรง ไม่เปิดเมนูคั่นกลาง
$('#my-shop').onclick = () => {
  if (!state.user || state.user.role !== 'merchant') return sell();
  $('#dialog').close();
  state.category=''; $('#search').value=''; $('#condition').value=''; $('#grading-filter').value=''; $('#sort').value='newest'; renderCategories();
  if (location.hash === '#/shop') { syncShopView(); loadCards(); }
  else location.hash='/shop';
  window.scrollTo(0,0);
};
// ใช้ catalog เดิมเป็นหน้าจัดการร้าน พร้อม URL ที่เปิดตรงและใช้ Back/Forward ได้
function syncShopView() {
  // บัญชีที่ไม่ใช่พ่อค้าเปิด #/shop จะเห็นคำอธิบายจาก pages.js แทนการเด้งกลับหน้าแรกเงียบ ๆ
  state.mine = location.hash === '#/shop' && (!state.authLoaded || state.user?.role === 'merchant');
  document.body.classList.toggle('shop-open',state.mine);
  $('#shop-tools').hidden = !state.mine;
  $('#new-listing').disabled = state.user?.verification !== 'approved';
  $('#my-shop').classList.toggle('nav-active',state.mine);
  $('#market').classList.toggle('nav-active',!state.mine && !location.hash.startsWith('#/orders/') && !['#/admin','#/profile','#/cart','#/reports'].includes(location.hash));
  $('#catalog-title').textContent = state.mine ? 'การ์ดในร้านของฉัน' : 'ค้นพบการ์ดใบถัดไป';
}
const shopTools=document.createElement('section');shopTools.id='shop-tools';shopTools.hidden=true;
shopTools.innerHTML='<div><p class="eyebrow">MY SHOP</p><h1>จัดการร้านค้าของฉัน</h1><p>ดูรายการ แก้ไขราคาและข้อมูล หรือลงขายเพิ่มได้จากหน้านี้</p></div><div class="shop-toolbar"><button id="new-listing" class="dark">＋ ลงขายการ์ด</button><button id="shop-orders" class="secondary">คำสั่งซื้อในร้าน</button></div>';
$('#catalog').before(shopTools);
$('#new-listing').onclick=sell;
$('#shop-orders').onclick=()=>commerce.orders('sales');
for(const event of ['hashchange','popstate','app-route-change'])addEventListener(event,()=>{syncShopView();loadCards();});

// เปิดฟอร์มลงขาย/แก้ไขการ์ด: รูป ตัวละคร เกรด ราคา รายละเอียด แล้วส่งไป POST/PUT /api/cards
function listingForm(card = {}) {
  const input = (label, name, value = '', type = 'text') => `<label>${label}<input name="${name}" value="${escapeHTML(value)}" type="${type}" required ${type === 'number' ? 'min="1" max="1000000" step="0.01"' : 'maxlength="500"'}></label>`;
  modal(`<h2>${card.id ? 'แก้ไขรายการ' : 'ลงขายการ์ด'}</h2><form id="listing-form">${input('ชื่อการ์ด', 'name', card.name)}<label>ประเภท<select name="category">${state.categories.map(c => `<option ${c === card.category ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('')}</select></label><label>ตัวละคร (ค้นหาได้)<input name="character" maxlength="160" list="character-options" value="${escapeHTML(card.character || '')}" placeholder="เช่น Pikachu / พิคาชู หรือ Monkey D. Luffy / ลูฟี่"><datalist id="character-options"></datalist><small>พิมพ์ชื่อเองได้ หลายตัวละครหรือชื่อไทย/อังกฤษคั่นด้วยเครื่องหมายจุลภาค</small></label>${input('เซ็ต / รหัสการ์ด', 'set', card.set)}${input('ระดับความหายาก', 'rarity', card.rarity)}<label>สภาพที่ผู้ขายระบุ<select name="condition">${['Near Mint', 'Excellent', 'Played'].map(c => `<option ${c === card.condition ? 'selected' : ''}>${c}</option>`).join('')}</select></label><fieldset class="grading-form"><legend>การประเมินเกรด</legend><label>บริษัทให้เกรด<select name="gradingCompany"><option value="">ไม่ส่งเกรด / Raw</option>${gradingCompanies.map(company => `<option ${card.grading?.company === company ? 'selected' : ''}>${company}</option>`).join('')}</select></label><div id="grading-fields"><label>คะแนนตามฉลาก<select name="gradingGrade"></select></label><label>เลขใบรับรอง<input name="gradingCertificate" maxlength="64" pattern="[A-Za-z0-9\\-]{3,64}" value="${escapeHTML(card.grading?.certificate || '')}" placeholder="กรอกเลขตามฉลากจริง"></label><p>ข้อมูลตามผู้ขายระบุ เว็บไซต์ยังไม่ได้ตรวจสอบใบรับรองกับบริษัทให้เกรด รองรับเกรดตัวเลขเท่านั้น</p></div></fieldset>${input('ราคา (บาท)', 'price', card.price ? card.price / 100 : '', 'number')}${input('ลิงก์รูปด้านหน้า HTTPS', 'image', card.image)}<label>ลิงก์รูปด้านหลัง (ไม่บังคับ)<input name="backImage" maxlength="500" value="${escapeHTML(card.backImage || '')}"></label><label>ลิงก์รูปตำหนิ / รายละเอียด (ไม่บังคับ)<input name="detailImage" maxlength="500" value="${escapeHTML(card.detailImage || '')}"></label><label>ภาษาการ์ด<input name="language" maxlength="80" value="${escapeHTML(card.language || '')}" placeholder="เช่น ไทย ญี่ปุ่น อังกฤษ"></label><label>คำอธิบายเพิ่มเติม<textarea name="description" rows="5" maxlength="5000" placeholder="รายละเอียดการ์ด จุดเด่น และสิ่งที่ผู้ซื้อควรทราบ">${escapeHTML(card.description || '')}</textarea></label><label>สภาพและตำหนิ<textarea name="conditionNotes" rows="3" maxlength="2000">${escapeHTML(card.conditionNotes || '')}</textarea></label><label>การแพ็กและระยะเวลาเตรียมจัดส่ง<textarea name="shippingNotes" rows="3" maxlength="2000">${escapeHTML(card.shippingNotes || '')}</textarea></label><div class="error" id="form-error" role="alert"></div><button class="dark">บันทึกรายการ</button></form>`);
  const uploadImages = bindListingUploads($('#listing-form'), api);
  layoutListing($('#listing-form'));
  const companyField = $('#listing-form [name="gradingCompany"]');
  const gradeField = $('#listing-form [name="gradingGrade"]');
  const certificateField = $('#listing-form [name="gradingCertificate"]');
  // แสดงช่องคะแนน/เลขใบรับรองเมื่อเลือกบริษัทให้เกรด และเติมตัวเลือกคะแนนตามบริษัท
  const updateGradeFields = (selected = '') => {
    const graded = !!companyField.value;
    $('#grading-fields').hidden = !graded;
    gradeField.disabled = certificateField.disabled = !graded;
    gradeField.required = certificateField.required = graded;
    gradeField.innerHTML = '<option value="">เลือกคะแนน</option>' + gradesFor(companyField.value).map(g => `<option ${g === selected ? 'selected' : ''}>${g}</option>`).join('');
  };
  companyField.onchange = () => updateGradeFields();
  updateGradeFields(card.grading?.grade);
  $('#listing-form').onsubmit = async event => { event.preventDefault(); event.submitter.disabled = true; try { await uploadImages(); } catch(e) { $('#form-error').textContent = e.message; event.submitter.disabled = false; return; } const data = Object.fromEntries(new FormData(event.target)); data.price = Math.round(Number(data.price) * 100); data.grading = data.gradingCompany ? { company: data.gradingCompany, grade: data.gradingGrade, certificate: data.gradingCertificate } : null; delete data.gradingCompany; delete data.gradingGrade; delete data.gradingCertificate; try { await api(`/cards${card.id ? `/${card.id}` : ''}`, card.id ? 'PUT' : 'POST', data); $('#dialog').close(); toast('บันทึกรายการแล้ว'); loadCards(); if (location.hash.startsWith('#/cards/')) product.refresh(); if (location.hash === '#/admin') admin.refresh(); } catch(e) { $('#form-error').textContent = e.message; event.submitter.disabled = false; } };
}
const reports = initReports({api,state,modal,escapeHTML,toast});
$('#reports-nav').onclick=reports.open;
initMerchantProfile({api,money,escapeHTML});
const profile = initProfile({api,state,escapeHTML,updateUser,authForm,toast});
const verification = initVerification({ api, modal, escapeHTML, state, updateUser, toast });
const admin = initAdmin({ api, state, escapeHTML, onChanged: loadCards });
const adminPanel = () => admin.open();
$('#admin-nav').onclick = adminPanel;
const product = initProduct({ report:reports.report, state, api, money, escapeHTML, bindCardTilt, checkout: c => commerce.checkout(c), addToCart: c => cart.add(c), edit: listingForm, remove: deleteListing, loadCards });
const commerce = initCommerce({ state, api, modal, toast, money, escapeHTML, authForm, loadCards, checkoutView: product.checkoutView, onPurchased: product.home, refreshProduct: product.refresh });
const cart = initCart({ api, state, money, escapeHTML, authForm, toast, loadCards, wallet: commerce.wallet, orders: commerce.orders });
$('#cart-nav').onclick = cart.open;
const pages = initPages({ api, state, escapeHTML, authForm });
initNotifications({ api, state, escapeHTML });
try { const [categories, user, status] = await Promise.all([api('/categories'), api('/auth/me'), api('/status')]); state.categories = categories; state.user = user; $('#mode').textContent = status.mode === 'demo' ? 'โหมดสาธิต · ข้อมูลรีเซ็ตเมื่อปิดเซิร์ฟเวอร์' : 'เชื่อมต่อ MongoDB'; updateUser(); renderCategories(); syncShopView(); await loadCards(); await product.refresh(); await admin.refresh(); await cart.refresh(); await commerce.refreshOrders(); await profile.refresh(); await reports.refresh(); await verification.shopStatus(); pages.refresh(); } catch(e) { $('#count').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณารีเฟรช'; toast(e.message); }

// เมื่อสลับกลับมาจากบัญชีแอดมิน ให้พ่อค้าเห็นผลอนุมัติล่าสุดโดยไม่ต้องออกเข้าใหม่
addEventListener('focus', async () => { try { state.user = await api('/auth/me'); updateUser(); } catch {} });
