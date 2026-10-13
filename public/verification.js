// จัดการส่งข้อมูลยืนยันของพ่อค้าและแสดงเหตุผลที่ต้องแก้ไข หลักฐานอ่านผ่าน API ที่ตรวจสิทธิ์
export function initVerification({ api, modal, escapeHTML: esc, state, updateUser, toast }) {
  const $ = s => document.querySelector(s);
  const statuses = { pending: 'รอตรวจสอบ', approved: 'อนุมัติแล้ว', rejected: 'ต้องแก้ไข / ถูกระงับ' };
  const panel=document.createElement('section');panel.id='shop-verification';panel.hidden=true;$('#shop-tools').after(panel);
  let generation=0;
  // สถานะร้านและสำเนาข้อมูลที่ส่ง เปิดดูได้โดยไม่ต้องส่งแบบฟอร์มซ้ำ
  async function shopStatus(){
    const request=++generation;panel.hidden=location.hash!=='#/shop'||state.user?.role!=='merchant';
    if(panel.hidden){panel.replaceChildren();return;}
    panel.innerHTML='<p>กำลังตรวจสถานะร้าน…</p>';
    try{
      const data=await api('/merchant/application');if(request!==generation)return;
      const a=data.application||{},waiting=data.verification==='pending'&&!!a.submittedAt;
      state.user.verification=data.verification;state.user.verificationSubmitted=!!a.submittedAt;state.user.verificationNote=a.reviewNote||'';
      $('#new-listing').disabled=data.verification!=='approved';
      panel.innerHTML=`<div class="shop-status-heading"><div><span class="status-pill ${esc(data.verification)}">${a.submittedAt?statuses[data.verification]:'ยังไม่ส่งข้อมูลยืนยัน'}</span><p class="merchant-code">รหัสพ่อค้า: ${esc(state.user.merchantCode || '—')}</p><h2>${esc(a.shopName||'เตรียมเปิดร้านของคุณ')}</h2><p>${waiting?'ส่งข้อมูลแล้ว ไม่ต้องส่งซ้ำ ระหว่างนี้สามารถตรวจสอบข้อมูลและสถานะร้านได้':data.verification==='approved'?'ร้านได้รับอนุมัติแล้ว พร้อมลงขายการ์ด':'กรอกหรือแก้ไขข้อมูลยืนยันเพื่อให้แอดมินตรวจสอบ'}</p></div><button class="secondary" id="shop-status-refresh">ตรวจสถานะอีกครั้ง</button></div>${a.reviewNote?`<p class="demo-notice">ข้อความจากแอดมิน: ${esc(a.reviewNote)}</p>`:''}${a.submittedAt?`<details><summary>ตรวจสอบข้อมูลที่ส่งแล้ว</summary><dl>${[['fullName','ชื่อผู้สมัคร'],['shopName','ชื่อร้าน'],['phone','เบอร์โทร'],['address','ที่อยู่'],['submittedAt','วันที่ส่ง']].map(([k,l])=>`<dt>${l}</dt><dd>${esc(k==='submittedAt'?new Date(a[k]).toLocaleString('th-TH'):a[k]||'')}</dd>`).join('')}</dl><img class="verification-proof" src="${esc(a.evidence)}" alt="หลักฐานที่ส่งตรวจสอบ"></details>`:''}${!waiting&&data.verification!=='approved'?'<button class="dark" id="shop-verify-edit">กรอก / แก้ไขข้อมูลยืนยัน</button>':''}`;
      $('#shop-status-refresh').onclick=async()=>{await shopStatus();dispatchEvent(new Event('app-route-change'));};
      if($('#shop-verify-edit'))$('#shop-verify-edit').onclick=application;
    }catch(e){if(request===generation)panel.innerHTML=`<p class="error">${esc(e.message)}</p>`;}
  }
  for(const event of ['hashchange','popstate','app-route-change','account-changed'])addEventListener(event,shopStatus);
  // โหลดสถานะล่าสุดและส่งข้อมูลพร้อมหลักฐานไปตรวจสอบ
  async function application() {
    try {
      const data = await api('/merchant/application');
      state.user.verification = data.verification;
      const a = data.application || {};
      state.user.verificationSubmitted = !!a.submittedAt; state.user.verificationNote = a.reviewNote || ''; updateUser();
      if(data.verification==='pending'&&a.submittedAt){$('#dialog').close();if(location.hash==='#/shop')await shopStatus();else location.hash='/shop';return;}
      modal(`<h2>ยืนยันบัญชีพ่อค้า</h2><p>${a.submittedAt ? statuses[data.verification] : 'ส่งข้อมูลเพื่อเปิดร้าน'} — ส่งข้อมูล → แอดมินตรวจสอบ → ลงขาย</p>${a.reviewNote ? `<p class="demo-notice">ข้อความจากแอดมิน: ${esc(a.reviewNote)}</p>` : ''}<form id="verification-form">${[['fullName','ชื่อ–นามสกุล',120],['shopName','ชื่อร้าน',100],['phone','เบอร์โทร',30],['address','ที่อยู่สำหรับติดต่อ',600]].map(([key,label,max]) => `<label>${label}<input name="${key}" ${key === 'phone' ? 'type="tel" inputmode="numeric" data-digits pattern="0[0-9]{8,9}" title="ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0" placeholder="0812345678"' : `maxlength="${max}"`} required value="${esc(key === 'phone' ? (a[key] || '').replace(/\D/g, '') : a[key] || '')}" ${data.verification === 'approved' ? 'disabled' : ''}></label>`).join('')}<p>หลักฐานตัวตนแสดงเฉพาะเจ้าของบัญชีและแอดมิน กรุณาปิดข้อมูลที่ไม่จำเป็น เช่น เลขบัตรและข้อมูลอ่อนไหว สำหรับการทดลองให้ใช้ข้อมูลและภาพสมมติ</p>${data.verification !== 'approved' ? '<label>ภาพหลักฐาน PNG / JPEG ไม่เกิน 2 MB<input name="proof" type="file" accept="image/png,image/jpeg" required></label><button class="dark">ส่งให้แอดมินตรวจสอบ</button>' : ''}<p id="verification-error" class="error" role="alert"></p></form>`);
      $('#verification-form').onsubmit = async event => {
        event.preventDefault(); const button = event.submitter; button.disabled = true;
        try {
          const form = new FormData(event.target), file = form.get('proof');
          if (!file?.size || file.size > 2 * 1024 * 1024 || !['image/png','image/jpeg'].includes(file.type)) throw Error('เลือกภาพ PNG / JPEG ไม่เกิน 2 MB');
          const evidence = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('อ่านไฟล์ไม่สำเร็จ')); reader.readAsDataURL(file); });
          form.delete('proof');
          await api('/merchant/application', 'POST', { ...Object.fromEntries(form), evidence });
          // ส่งสำเร็จแล้วปิดฟอร์ม ไม่เปิดใหม่จนผู้ใช้เข้าไปตรวจสถานะเอง
          state.user.verification = 'pending';
          state.user.verificationSubmitted = true;
          state.user.verificationNote = '';
          updateUser();
          $('#dialog').close();
          toast('ส่งข้อมูลยืนยันแล้ว กรุณารอแอดมินตรวจสอบ');
        } catch(e) { $('#verification-error').textContent = e.message; button.disabled = false; }
      };
    } catch(e) { modal(`<h2>โหลดข้อมูลไม่สำเร็จ</h2><p>${esc(e.message)}</p>`); }
  }
  return { application, shopStatus };
}
