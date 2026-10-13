// หน้าข้อมูลทั่วไป (วิธีใช้งาน เงื่อนไข ติดต่อ) และหน้า "ไม่พบหน้านี้" สำหรับลิงก์ที่ไม่มีอยู่จริง
export function initPages({ api, state, escapeHTML: esc, authForm }) {
  const host = document.createElement('section'); host.id = 'info-page'; host.hidden = true;
  document.querySelector('.main-nav').after(host);
  let status = { autoCompleteDays: 7, contactEmail: '' };
  api('/status').then(s => { status = s; if (!host.hidden) route(); }).catch(() => {});
  // route ที่โมดูลอื่นรับผิดชอบอยู่แล้ว
  const known = /^(#\/?)?$|^#\/(shop|admin|reports|profile|cart|help|terms|contact)$|^#\/orders\/(purchases|sales|admin)$|^#\/cards\/[^/]+(\/checkout)?$|^#\/merchants\/[^/]+$/;
  const step = (title, text) => `<li><strong>${title}</strong><span>${text}</span></li>`;
  const pages = {
    '#/help': () => `<p class="eyebrow">HOW IT WORKS</p><h1>วิธีใช้งาน Cardspace</h1><p class="info-lead">ตลาดซื้อขายการ์ดสะสมทีละใบ ใช้เครดิตสาธิตแทนเงินจริง</p>
      <div class="info-columns"><section class="info-card"><h2>สำหรับผู้ซื้อ</h2><ol class="info-steps">
        ${step('ค้นหาการ์ด', 'พิมพ์ชื่อการ์ด ตัวละคร หรือเซ็ต แล้วกรองตามเกม สภาพ และบริษัทให้เกรด')}
        ${step('เติมเครดิตสาธิต', 'กดกล่อง "เครดิตคงเหลือ" ด้านบน เครดิตไม่มีมูลค่าจริง')}
        ${step('ซื้อทันทีหรือใส่ตะกร้า', 'ตะกร้าไม่จองสินค้า ใครชำระก่อนได้ก่อน ระบบตรวจราคาและสต็อกอีกครั้งตอนชำระ')}
        ${step('ติดตามคำสั่งซื้อ', 'เมนู "คำสั่งซื้อ" แสดงสถานะ เลขพัสดุ และรูปสินค้าก่อนจัดส่ง')}
        ${step('ยืนยันรับหรือแจ้งปัญหา', `ถ่ายรูปสินค้าที่ได้รับแล้วกดยืนยัน หากไม่ได้รับ ไม่ตรงปก หรือเสียหาย ให้กด "แจ้งปัญหา" ภายใน ${status.autoCompleteDays} วันหลังจัดส่ง`)}
        ${step('ให้คะแนนร้านค้า', 'หลังคำสั่งซื้อสำเร็จ ให้ดาวและความเห็นเพื่อช่วยผู้ซื้อคนถัดไป')}
      </ol></section><section class="info-card"><h2>สำหรับพ่อค้า</h2><ol class="info-steps">
        ${step('สมัครบัญชีพ่อค้า', 'เลือกประเภท "พ่อค้า" ตอนสมัครสมาชิก')}
        ${step('ส่งข้อมูลยืนยันร้าน', 'กรอกชื่อร้าน เบอร์โทร ที่อยู่ และแนบหลักฐาน รอแอดมินอนุมัติ')}
        ${step('ลงขายการ์ด', 'อัปโหลดรูปหน้า/หลัง ระบบช่วยอ่านชื่อและเกรดจากรูปได้ แต่ควรตรวจซ้ำทุกครั้ง')}
        ${step('แจ้งจัดส่ง', 'เมื่อมีคำสั่งซื้อ แนบรูปพัสดุและเลขพัสดุใน "คำสั่งซื้อในร้าน"')}
        ${step('รับเครดิต', `เครดิตเข้ากระเป๋าเมื่อผู้ซื้อยืนยันรับ หรือยืนยันอัตโนมัติเมื่อครบ ${status.autoCompleteDays} วันโดยไม่มีการแจ้งปัญหา`)}
      </ol></section></div><p class="info-links"><a href="#/terms">อ่านเงื่อนไขการซื้อขาย</a> · <a href="#/contact">ติดต่อเรา</a></p>`,
    '#/terms': () => `<p class="eyebrow">TERMS</p><h1>เงื่อนไขการซื้อขาย และการแจ้งปัญหา</h1><p class="info-lead">ระบบนี้เป็นต้นแบบเพื่อการศึกษา ใช้เครดิตสาธิตที่ไม่มีมูลค่าจริง และไม่มีการจัดส่งจริง</p>
      <section class="info-card"><h2>การซื้อขาย</h2><ul>
        <li>หนึ่งรายการคือการ์ดหนึ่งใบ ราคาและข้อมูลในคำสั่งซื้อบันทึกตามที่เห็นตอนชำระ</li>
        <li>ร้านค้าต้องผ่านการยืนยันตัวตนจากแอดมินก่อนลงขาย ร้านที่ถูกระงับจะไม่แสดงสินค้าในตลาด</li>
        <li>สภาพการ์ดและเกรดเป็นข้อมูลที่ผู้ขายระบุ เว็บไซต์ยังไม่ได้ยืนยันใบรับรองกับบริษัทให้เกรด</li>
        <li>การ์ดที่ขายแล้วแก้ไขหรือลบไม่ได้</li>
      </ul></section>
      <section class="info-card"><h2>การยกเลิกและคืนเครดิต</h2><ul>
        <li>ผู้ซื้อยกเลิกได้ก่อนผู้ขายแจ้งจัดส่ง เครดิตคืนเต็มจำนวนทันทีและการ์ดกลับไปวางขาย</li>
        <li>เครดิตของผู้ซื้อถูกพักไว้ และโอนให้ผู้ขายเมื่อผู้ซื้อยืนยันรับสินค้า</li>
        <li>หากผู้ซื้อไม่ยืนยันรับและไม่แจ้งปัญหาภายใน ${status.autoCompleteDays} วันหลังจัดส่ง ระบบจะยืนยันรับอัตโนมัติ</li>
      </ul></section>
      <section class="info-card"><h2>การแจ้งปัญหา (ข้อพิพาท)</h2><ol>
        <li>ผู้ซื้อกด "แจ้งปัญหา" ในคำสั่งซื้อที่จัดส่งแล้ว เลือกประเภท: ไม่ได้รับสินค้า / ไม่ตรงปก / เสียหาย / อื่น ๆ</li>
        <li>แนบรูปหลักฐาน (ยกเว้นกรณีไม่ได้รับสินค้า) และอธิบายรายละเอียด</li>
        <li>ผู้ขายส่งคำชี้แจงได้หนึ่งครั้ง ผู้ซื้อ ผู้ขาย และแอดมินเห็นข้อมูลเดียวกัน</li>
        <li>แอดมินตัดสิน "คืนเครดิตผู้ซื้อ" หรือ "โอนให้ผู้ขาย" พร้อมเหตุผล ผลตัดสินเปลี่ยนภายหลังไม่ได้</li>
      </ol></section>
      <section class="info-card"><h2>สินค้าที่ไม่อนุญาต</h2><ul>
        <li>การ์ดปลอม การ์ดพิมพ์ซ้ำที่ไม่แจ้ง หรือรูปที่ไม่ใช่สินค้าจริง</li>
        <li>ข้อมูลที่ทำให้เข้าใจผิด เนื้อหาไม่เหมาะสม หรือการหลอกลวง — ผู้ใช้กด "รายงานสินค้า" ในหน้าการ์ดได้</li>
      </ul></section>`,
    '#/contact': () => `<p class="eyebrow">CONTACT</p><h1>ติดต่อเรา</h1><p class="info-lead">เลือกช่องทางที่ตรงกับเรื่องของคุณ เพื่อให้แอดมินเห็นข้อมูลที่เกี่ยวข้องครบในที่เดียว</p>
      <div class="info-columns">
        <section class="info-card"><h2>ปัญหาเกี่ยวกับคำสั่งซื้อ</h2><p>ไม่ได้รับสินค้า สินค้าไม่ตรงปก หรือเสียหาย — เปิดคำสั่งซื้อแล้วกด "แจ้งปัญหา" แอดมินจะตรวจหลักฐานและตัดสินคืนเครดิต</p><a class="secondary" href="#/orders/purchases">ไปที่คำสั่งซื้อ</a></section>
        <section class="info-card"><h2>พบสินค้าผิดปกติ</h2><p>การ์ดปลอม ข้อมูลไม่ตรง หรือเนื้อหาไม่เหมาะสม — เปิดหน้าการ์ดแล้วกด "⚑ รายงานสินค้า"</p><a class="secondary" href="#/">ไปที่ตลาดการ์ด</a></section>
        <section class="info-card"><h2>เรื่องอื่น ๆ</h2>${status.contactEmail ? `<p>ส่งอีเมลถึงผู้ดูแลระบบ</p><a class="dark" href="mailto:${esc(status.contactEmail)}">${esc(status.contactEmail)}</a>` : '<p>ผู้ดูแลยังไม่ได้ตั้งอีเมลติดต่อ (ตั้งค่า CONTACT_EMAIL ในไฟล์ .env)</p>'}</section>
      </div><p class="info-links"><a href="#/help">วิธีใช้งาน</a> · <a href="#/terms">เงื่อนไขการซื้อขาย</a></p>`
  };
  // แสดงหน้าข้อมูล/หน้า 404 ตาม URL หรือซ่อนเมื่อเป็นหน้าที่โมดูลอื่นรับผิดชอบ
  function route() {
    const hash = location.hash;
    let html = null;
    if (pages[hash]) html = pages[hash]();
    else if (hash === '#/shop' && state.authLoaded && state.user?.role !== 'merchant') html = `<div class="info-empty"><p class="eyebrow">MERCHANT ONLY</p><h1>หน้านี้สำหรับบัญชีพ่อค้า</h1><p>${state.user ? 'บัญชีที่ใช้อยู่เป็นบัญชีผู้ซื้อ หากต้องการขายการ์ด ให้สมัครบัญชีพ่อค้าใหม่' : 'เข้าสู่ระบบด้วยบัญชีพ่อค้าเพื่อจัดการร้านค้า'}</p>${state.user ? '' : '<button class="dark" id="info-login">เข้าสู่ระบบ</button>'}<a class="secondary" href="#/">กลับตลาดการ์ด</a></div>`;
    else if (!known.test(hash)) html = `<div class="info-empty"><p class="eyebrow">404</p><h1>ไม่พบหน้านี้</h1><p>ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว</p><a class="dark" href="#/">กลับตลาดการ์ด</a><a class="secondary" href="#/help">วิธีใช้งาน</a></div>`;
    const active = html !== null;
    host.hidden = !active; document.body.classList.toggle('info-open', active);
    if (!active) { host.innerHTML = ''; return; }
    host.innerHTML = html; document.querySelector('#dialog').close(); window.scrollTo(0, 0);
    document.querySelector('#market').classList.remove('nav-active');
    host.querySelector('#info-login')?.addEventListener('click', () => authForm());
    const heading = host.querySelector('h1'); heading.tabIndex = -1; heading.focus({ preventScroll: true });
  }
  for (const e of ['hashchange', 'popstate', 'app-route-change', 'account-changed']) addEventListener(e, route);
  return { refresh: route };
}
