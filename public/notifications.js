// กระดิ่งแจ้งเตือนบนแถบบน: แสดงงานที่ค้างอยู่ (รอจัดส่ง รอยืนยันรับ ข้อพิพาท ฯลฯ) จากเซิร์ฟเวอร์
export function initNotifications({ api, state, escapeHTML: esc }) {
  const $ = s => document.querySelector(s);
  const button = document.createElement('button');
  button.id = 'notify-nav'; button.className = 'secondary'; button.hidden = true;
  button.setAttribute('aria-haspopup', 'true'); button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<span aria-hidden="true">🔔</span><span class="notify-badge" hidden></span>';
  const panel = document.createElement('div'); panel.id = 'notify-panel'; panel.hidden = true;
  $('#cart-nav').before(button); $('.account').append(panel);
  const ordersBadge = document.createElement('span'); ordersBadge.className = 'nav-badge'; ordersBadge.hidden = true;
  $('#orders-nav').append(ordersBadge);
  let data = { items: [], total: 0 }, generation = 0;
  // ปิดแผงการแจ้งเตือน
  const close = () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  // อัปเดตตัวเลขบนกระดิ่ง/เมนูคำสั่งซื้อ และรายการในแผง
  function render() {
    const badge = button.querySelector('.notify-badge');
    badge.hidden = !data.total; badge.textContent = data.total > 99 ? '99+' : data.total;
    button.setAttribute('aria-label', data.total ? `การแจ้งเตือน ${data.total} รายการ` : 'การแจ้งเตือน');
    const orders = data.items.filter(i => i.href.startsWith('#/orders/')).reduce((sum, i) => sum + i.count, 0);
    ordersBadge.hidden = !orders; ordersBadge.textContent = orders;
    panel.innerHTML = `<h2>การแจ้งเตือน</h2>${data.items.length ? data.items.map(i => `<a href="${esc(i.href)}"><span>${esc(i.label)}</span><b>${i.count}</b></a>`).join('') : '<p>ไม่มีรายการที่ต้องจัดการ</p>'}`;
    panel.querySelectorAll('a').forEach(a => a.onclick = close);
  }
  // โหลดการแจ้งเตือนล่าสุดจาก /api/notifications (ซ่อนกระดิ่งเมื่อยังไม่เข้าสู่ระบบ)
  async function refresh() {
    const request = ++generation;
    button.hidden = !state.user;
    if (!state.user) { data = { items: [], total: 0 }; render(); close(); return; }
    try { const result = await api('/notifications'); if (request === generation) { data = result; render(); } } catch {}
  }
  button.onclick = () => { if (!panel.hidden) return close(); panel.hidden = false; button.setAttribute('aria-expanded', 'true'); refresh(); };
  document.addEventListener('click', e => { if (!panel.contains(e.target) && !button.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { close(); button.focus(); } });
  addEventListener('hashchange', close);
  for (const e of ['account-changed', 'commerce-changed', 'focus', 'hashchange']) addEventListener(e, refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  return { refresh };
}
