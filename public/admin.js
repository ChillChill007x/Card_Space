// หน้าผู้ดูแลแบบเต็มหน้า ใช้ hash route เดียวกับระบบสินค้า รองรับ Back/Forward และลิงก์ตรง
export function initAdmin({ api, state, escapeHTML: esc, onChanged }) {
  const host = document.createElement('section'); host.id = 'admin-page'; host.hidden = true;
  document.querySelector('.main-nav').after(host);
  let users = [], filter = '', query = '', generation = 0, owner = null;
  const evidence = new Map();
  const status = u => u.verification === 'pending' && !u.application?.submittedAt ? 'draft' : u.verification;
  const labels = { draft:'ยังไม่ส่งข้อมูล', pending:'รอตรวจสอบ', approved:'อนุมัติแล้ว', rejected:'ขอแก้ไข / ระงับ' };
  // กรองในหน้าผู้ดูแลเท่านั้น ข้อมูลหลักฐานยังถูกควบคุมสิทธิ์โดย API
  function render() {
    const shown = users.filter(u => (!filter || status(u) === filter) && `${u.merchantCode || ''} ${u.name} ${u.email} ${u.application?.shopName || ''}`.toLowerCase().includes(query.toLowerCase()));
    host.innerHTML = `<a href="#/" class="back-market">← กลับตลาดการ์ด</a><p class="eyebrow">ADMIN WORKSPACE</p><h1>จัดการบัญชีพ่อค้า</h1><p>ตรวจหลักฐานก่อนเปิดสิทธิ์ลงขาย และแจ้งเหตุผลเมื่อขอแก้ไขหรือระงับ</p><div class="admin-summary">${Object.entries(labels).map(([key,label]) => `<button data-filter="${key}" class="${filter === key ? 'selected' : ''}"><strong>${users.filter(u=>status(u)===key).length}</strong>${label}</button>`).join('')}</div><div class="admin-tools"><input id="admin-search" type="search" placeholder="ค้นหารหัสพ่อค้า ชื่อร้าน ผู้สมัคร หรืออีเมล" aria-label="ค้นหาพ่อค้า"><button data-filter="" class="secondary">ทั้งหมด</button><button id="admin-reload" class="secondary">รีเฟรช</button></div><p class="error" role="alert" id="review-error"></p><div class="admin-grid">${shown.map(u => `<article class="admin-row"><span class="status-pill ${status(u)}">${labels[status(u)]}</span><h2>${esc(u.application?.shopName || u.name)}</h2><p><strong>${esc(u.merchantCode || '')}</strong><br>${esc(u.email)}</p>${u.application?.submittedAt ? `<dl>${[['fullName','ผู้สมัคร'],['phone','โทรศัพท์'],['address','ที่อยู่'],['submittedAt','ส่งเมื่อ']].map(([k,l])=>`<dt>${l}</dt><dd>${esc(k === 'submittedAt' ? new Date(u.application[k]).toLocaleString('th-TH') : u.application[k] || '')}</dd>`).join('')}</dl><details data-evidence="${esc(u.id)}"><summary>เปิดดูหลักฐาน</summary><p class="evidence-status">กำลังโหลดหลักฐาน…</p><img class="verification-proof" hidden alt="หลักฐานยืนยันของผู้สมัคร"></details>` : '<p>รอพ่อค้ากรอกข้อมูลและแนบหลักฐาน ยังอนุมัติไม่ได้</p>'}<label>เหตุผล / ข้อความถึงพ่อค้า<textarea data-note="${esc(u.id)}" maxlength="1000" placeholder="ระบุสิ่งที่ต้องแก้ไข">${esc(u.application?.reviewNote || '')}</textarea></label><div class="admin-actions"><button class="dark" data-id="${esc(u.id)}" data-status="approved" ${!u.application?.submittedAt || u.verification === 'approved' ? 'disabled' : ''}>อนุมัติเปิดร้าน</button><button class="secondary" data-id="${esc(u.id)}" data-status="rejected">ขอแก้ไข / ระงับ</button></div></article>`).join('') || '<div class="empty">ไม่มีร้านค้าที่ตรงกับเงื่อนไขนี้</div>'}</div>`;
    const search = host.querySelector('#admin-search'); search.value = query;
    search.oninput = () => { const pos = search.selectionStart; query = search.value; render(); const el=host.querySelector('#admin-search'); el.focus(); if (pos !== null) try { el.setSelectionRange(pos,pos); } catch {} };
    host.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; render(); });
    // โหลดภาพหลักฐานทีละรายเมื่อเปิดดู ไม่ส่งภาพทั้งหมดมากับรายการพ่อค้า
    host.querySelectorAll('[data-evidence]').forEach(d => d.ontoggle = async () => {
      if (!d.open || !d.querySelector('img').hidden) return;
      const id = d.dataset.evidence, note = d.querySelector('.evidence-status');
      try { if (!evidence.has(id)) evidence.set(id, (await api(`/admin/merchants/${encodeURIComponent(id)}/evidence`)).evidence); const img = d.querySelector('img'); img.src = evidence.get(id); img.hidden = false; note.remove(); }
      catch(e) { note.textContent = e.message; }
    });
    host.querySelector('#admin-reload').onclick = route;
    host.querySelectorAll('[data-status]').forEach(b => b.onclick = async () => {
      const note = b.closest('article').querySelector('textarea').value;
      if (b.dataset.status === 'rejected' && !note.trim()) { host.querySelector('#review-error').textContent='กรุณาระบุเหตุผลเพื่อให้พ่อค้าทราบขั้นตอนถัดไป'; return; }
      b.disabled = true;
      try { await api(`/admin/merchants/${b.dataset.id}`, 'PATCH', { verification:b.dataset.status, reviewNote:note }); onChanged(); await route(); }
      catch(e) { host.querySelector('#review-error').textContent=e.message; b.disabled=false; }
    });
  }
  // โหลดใหม่ทุกครั้งที่เข้าหน้าและล้างหลักฐานเมื่อออกจากหน้า/ออกจากระบบ
  async function route() {
    owner = state.user?.id;
    const request = ++generation, active = location.hash === '#/admin';
    document.querySelector('#admin-nav').classList.toggle('nav-active',active);
    document.body.classList.toggle('admin-open',active); host.hidden=!active;
    if (!active) { host.innerHTML=''; users=[]; evidence.clear(); return; }
    document.querySelector('#dialog').close(); window.scrollTo(0,0);
    host.innerHTML='<p role="status">กำลังตรวจสอบสิทธิ์…</p>';
    try { const data=await api('/admin/merchants'); if(request!==generation)return; users=data; render(); }
    catch(e) { if(request===generation)host.innerHTML=`<h1>เปิดหน้าผู้ดูแลไม่ได้</h1><p>${esc(e.message)}</p><a href="#/">กลับหน้าหลัก</a>`; }
  }
  addEventListener('app-route-change',route);
  addEventListener('account-changed',()=>{if(owner!==state.user?.id){users=[];evidence.clear();filter='';query='';route();}});
  addEventListener('hashchange',route); addEventListener('popstate',route);
  return { open: () => { if(location.hash==='#/admin')route();else location.hash='/admin'; }, refresh:route };
}
