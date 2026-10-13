import { gradeText } from './grading.js';
// A non-modal hover preview: moving from the card into the preview keeps it open.
export function createCardPreview({ escapeHTML: esc, money, bindCardTilt, open }) {
  const panel = document.createElement('section');
  panel.id = 'card-preview'; panel.hidden = true;
  panel.setAttribute('aria-label', 'พรีวิวการ์ด');
  document.body.append(panel);
  let source = null, showTimer, hideTimer;
  // ปิดพรีวิวและคืน focus เมื่อผู้ใช้ยังอยู่ในพรีวิว
  function hide() {
    clearTimeout(showTimer); clearTimeout(hideTimer);
    if (panel.contains(document.activeElement)) source?.focus({ preventScroll: true });
    clearTimeout(showTimer); clearTimeout(hideTimer);
    panel.classList.remove('is-tilting');
    panel.hidden = true; source = null;
  }
  // หน่วงการปิดเพื่อให้ย้ายเมาส์จากการ์ดเข้าแผงพรีวิวได้
  function scheduleHide() {
    clearTimeout(showTimer); clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!panel.matches(':hover') && !panel.contains(document.activeElement) && !source?.matches(':hover') && source !== document.activeElement) hide();
    }, 160);
  }
  // สร้างพรีวิวและจัดตำแหน่งให้อยู่ในขอบหน้าจอ
  function show(button, card) {
    if (!button.isConnected || document.querySelector('#dialog').open || document.body.classList.contains('product-open') || innerWidth < 680) return;
    source = button;
    panel.innerHTML = `<button class="preview-close" aria-label="ปิดพรีวิว">×</button><a class="preview-link" href="#/cards/${encodeURIComponent(card.id)}"><div class="preview-stage"><div class="card-surface"><img src="${esc(card.image)}" alt="${esc(card.name)}" draggable="false"></div></div><div class="preview-info"><p>${esc(card.category)}</p><h2>${esc(card.name)}</h2><span class="preview-set">${esc(card.set)}</span>${card.grading ? `<span class="preview-grade">${esc(gradeText(card))} · ผู้ขายระบุ</span>` : ''}<span class="preview-condition">${esc(card.rarity)} · ${esc(card.condition)}</span><span class="preview-seller">ร้าน ${esc(card.sellerName)}</span><strong>${money(card.price)}</strong><span class="preview-action">ดูรายละเอียดเต็มหน้า ↗</span></div></a>`;
    panel.hidden = false;
    // Place beside the source where possible, and clamp inside the viewport.
    const box = button.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight;
    let left = box.right + 12;
    if (left + width > innerWidth - 12) left = box.left - width - 12;
    if (left < 12) left = Math.min(innerWidth - width - 12, Math.max(12, box.left));
    const top = Math.max(12, Math.min(innerHeight - height - 12, box.top + 12));
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
    panel.querySelector('.preview-close').onclick = hide;
    panel.querySelector('.preview-link').onclick = event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); hide(); open(card);
    };
    const img = panel.querySelector('img');
    img.onerror = () => { img.onerror = null; img.src = '/art/placeholder.svg'; };
    bindCardTilt(panel, panel.querySelector('.preview-link'), panel.querySelector('.card-surface'));
  }
  // ผูก pointer และ keyboard focus ของการ์ดกับพรีวิว
  function bind(button, card) {
    // หน่วงเวลาก่อนแสดงพรีวิว เพื่อไม่ให้กระพริบเมื่อเลื่อนเมาส์ผ่านเร็ว ๆ
    const schedule = event => {
      if (event.type === 'pointerenter' && event.pointerType === 'touch') return;
      clearTimeout(showTimer); clearTimeout(hideTimer);
      showTimer = setTimeout(() => show(button, card), 280);
    };
    button.addEventListener('pointerenter', schedule);
    button.addEventListener('pointerleave', scheduleHide);
    button.addEventListener('focus', schedule);
    button.addEventListener('blur', scheduleHide);
    button.addEventListener('pointerdown', hide);
  }
  panel.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  panel.addEventListener('pointerleave', scheduleHide);
  panel.addEventListener('focusout', scheduleHide);
  addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  addEventListener('scroll', () => { if (!panel.hidden) hide(); }, { passive: true });
  addEventListener('resize', hide);
  addEventListener('hashchange', hide);
  addEventListener('popstate', hide);
  return { bind, hide };
}
