// แบบแจ้งปัญหาสินค้าและหน้าตรวจสอบสำหรับแอดมิน ใช้ข้อมูลตามสิทธิ์จาก API
export function initReports({api,state,modal,escapeHTML:esc,toast}){
  const reasons={counterfeit:'สงสัยสินค้าปลอม',misleading:'รูปหรือรายละเอียดไม่ตรง',inappropriate:'เนื้อหาไม่เหมาะสม',fraud:'สงสัยหลอกลวง',other:'ปัญหาอื่น ๆ'};
  const statuses={pending:'รอตรวจสอบ',reviewing:'กำลังตรวจสอบ',resolved:'ดำเนินการแล้ว',dismissed:'ปิดโดยไม่ดำเนินการ'};
  const host=document.createElement('section');host.id='reports-page';host.hidden=true;document.querySelector('.main-nav').after(host);let generation=0;
  // เปิดฟอร์มรายงานสินค้า แล้วส่งไป POST /api/cards/:id/reports
  function report(card){
    modal(`<h2>รายงานสินค้า</h2><p>${esc(card.name)}</p><p>ข้อมูลจะส่งให้แอดมินตรวจสอบ การรายงานไม่ยกเลิกคำสั่งซื้อหรือคืนเครดิตอัตโนมัติ</p><form id="report-form"><label>เหตุผล<select name="reason" required><option value="">เลือกเหตุผล</option>${Object.entries(reasons).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>รายละเอียดปัญหา<textarea name="details" rows="5" minlength="10" maxlength="2000" required placeholder="อธิบายสิ่งที่พบ เพื่อช่วยให้แอดมินตรวจสอบได้"></textarea></label><p class="error" role="alert"></p><button class="dark">ส่งรายงาน</button></form>`);
    const form=document.querySelector('#report-form');form.onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{await api(`/cards/${encodeURIComponent(card.id)}/reports`,'POST',Object.fromEntries(new FormData(form)));document.querySelector('#dialog').close();toast('ส่งรายงานให้แอดมินแล้ว');}catch(err){form.querySelector('.error').textContent=err.message;e.submitter.disabled=false;}};
  }
  // หน้ารายงานสินค้าของแอดมิน (#/reports): โหลดรายการ
  async function route(){
    const request=++generation,active=location.hash==='#/reports';host.hidden=!active;document.body.classList.toggle('reports-open',active);document.querySelector('#reports-nav').classList.toggle('nav-active',active);
    if(!active){host.replaceChildren();return;}
    host.innerHTML='<p>กำลังโหลดรายงาน…</p>';
    try{const rows=await api('/admin/reports');if(request!==generation)return;
      host.innerHTML=`<p class="eyebrow">PRODUCT REPORTS</p><h1>รายงานสินค้า</h1><p>ตรวจสอบข้อเท็จจริงก่อนดำเนินการกับสินค้า การเปลี่ยนสถานะรายงานไม่ลบสินค้าหรือระงับร้านอัตโนมัติ</p><div class="admin-tools"><select id="report-filter" aria-label="กรองรายงาน"><option value="">ทั้งหมด (${rows.length})</option>${Object.entries(statuses).map(([k,v])=>`<option value="${k}">${v} (${rows.filter(r=>r.status===k).length})</option>`).join('')}</select><button class="secondary" id="report-refresh">รีเฟรช</button></div><div class="admin-grid" id="report-list"></div>`;
      // แสดงรายงานตามตัวกรองสถานะ พร้อมฟอร์มเปลี่ยนสถานะ
      function render(){const filter=host.querySelector('#report-filter').value;host.querySelector('#report-list').innerHTML=rows.filter(r=>!filter||r.status===filter).map(r=>`<article class="admin-row"><span class="status-pill">${statuses[r.status]}</span><h2>${esc(r.cardName)}</h2><p>รหัสพ่อค้า: ${esc(r.merchantCode || 'ร้านตัวอย่าง')}</p><p>${esc(new Date(r.createdAt).toLocaleString('th-TH'))} · ${reasons[r.reason]}</p><p class="preserve-lines">${esc(r.details)}</p><a href="#/cards/${encodeURIComponent(r.cardId)}">เปิดสินค้าที่ถูกรายงาน ↗</a><form data-report="${esc(r.id)}"><label>สถานะ<select name="status">${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${r.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label>ผลตรวจสอบ / หมายเหตุ<textarea name="reviewNote" maxlength="2000" rows="3">${esc(r.reviewNote||'')}</textarea></label><p class="error" role="alert"></p><button class="dark">บันทึกผลตรวจสอบ</button></form></article>`).join('')||'<p class="empty">ไม่มีรายงานในสถานะนี้</p>';
        host.querySelectorAll('form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{await api(`/admin/reports/${f.dataset.report}`,'PATCH',Object.fromEntries(new FormData(f)));toast('บันทึกผลตรวจสอบแล้ว');await route();}catch(err){f.querySelector('.error').textContent=err.message;e.submitter.disabled=false;}});
      }render();host.querySelector('#report-filter').onchange=render;host.querySelector('#report-refresh').onclick=route;
    }catch(err){if(request===generation)host.innerHTML=`<h1>เปิดรายงานไม่ได้</h1><p class="error">${esc(err.message)}</p><a href="#/">กลับตลาด</a>`;}
  }
  for(const event of ['hashchange','popstate','app-route-change','account-changed'])addEventListener(event,route);
  return {report,refresh:route,open:()=>{if(location.hash==='#/reports')route();else location.hash='/reports';}};
}
