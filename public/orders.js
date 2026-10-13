import { gradeText } from './grading.js';

// ศูนย์คำสั่งซื้อแบบเต็มหน้า แยกมุมมองผู้ซื้อ/ร้านค้า และดำเนินการในรายการเดิม
// กรอง/ค้นหา/แบ่งหน้าที่เซิร์ฟเวอร์ จึงไม่ต้องโหลดประวัติทั้งหมดมาที่หน้าเว็บ
export function initOrders({ api, state, money, escapeHTML: esc, authForm, toast, loadCards }) {
  const host=document.createElement('section');host.id='orders-page';host.hidden=true;document.querySelector('.main-nav').after(host);
  const labels={paid:'รอจัดส่ง',shipped:'จัดส่งแล้ว',disputed:'มีข้อพิพาท',completed:'สำเร็จ',refunded:'คืนเครดิตแล้ว',cancelled:'ยกเลิก'};
  const reasons={not_received:'ไม่ได้รับสินค้า',not_as_described:'สินค้าไม่ตรงปก',damaged:'สินค้าเสียหาย',other:'ปัญหาอื่น'};
  const date=s=>new Date(s).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'});
  const PAGE=20;
  let data=[],total=0,counts={},page=1,pages=1,scope='purchases',filter='',query='',generation=0,owner=null,searchTimer;
  const proof=(o,kind,summary,cls='')=>`<details class="receipt-evidence ${cls}"><summary>${summary}</summary><a href="/api/orders/${encodeURIComponent(o.id)}/${kind}" target="_blank" rel="noopener"><img src="/api/orders/${encodeURIComponent(o.id)}/${kind}" alt="${summary} ${esc(o.card.name)}" loading="lazy"></a></details>`;
  // ข้อความบอกขั้นตอนถัดไปของคำสั่งซื้อ ตามสถานะและบทบาทของผู้ดู
  function guidance(o,{seller,buyer}) {
    if(o.status==='paid')return seller?'แพ็กสินค้าและแจ้งเลขพัสดุเมื่อจัดส่ง':'รอร้านค้าแจ้งจัดส่ง คุณยังยกเลิกและรับเครดิตคืนได้';
    if(o.status==='shipped'){const due=o.autoCompleteAt?` · ระบบจะยืนยันรับอัตโนมัติ ${date(o.autoCompleteAt)} หากไม่มีการแจ้งปัญหา`:'';return (buyer?'ตรวจสอบสินค้าแล้วกดยืนยันรับ หรือแจ้งปัญหาหากสินค้าไม่ตรงปก เสียหาย หรือไม่ได้รับ':'รอผู้ซื้อยืนยันรับสินค้า')+due;}
    if(o.status==='disputed')return 'แอดมินกำลังตรวจข้อพิพาท เครดิตถูกพักไว้จนกว่าจะตัดสิน';
    if(o.status==='refunded')return 'แอดมินตัดสินคืนเครดิตให้ผู้ซื้อแล้ว';
    if(o.status==='completed')return o.autoCompleted?'ยืนยันรับอัตโนมัติเมื่อครบกำหนด และโอนเครดิตให้ผู้ขายแล้ว':o.resolution?'แอดมินตัดสินโอนเครดิตให้ผู้ขายแล้ว':'ยืนยันรับสินค้าและบันทึกรายได้เรียบร้อย';
    return 'คืนเครดิตให้ผู้ซื้อเรียบร้อย';
  }
  // กล่องรายละเอียดข้อพิพาท คำชี้แจงผู้ขาย และผลตัดสิน
  function disputeBlock(o) {
    if(!o.dispute)return '';
    const d=o.dispute;
    return `<div class="order-dispute"><strong>ข้อพิพาท: ${esc(reasons[d.reason]||d.reason)}</strong><small>แจ้งเมื่อ ${esc(date(d.openedAt))}</small><p class="preserve-lines">${esc(d.details)}</p>${d.sellerResponse?`<p class="preserve-lines"><b>คำชี้แจงผู้ขาย:</b> ${esc(d.sellerResponse)}</p>`:''}${o.resolution?`<p class="preserve-lines"><b>ผลตัดสิน (${o.resolution.decision==='refund'?'คืนเครดิตผู้ซื้อ':'โอนให้ผู้ขาย'}):</b> ${esc(o.resolution.note)}</p>`:''}${d.evidenceProofId?proof(o,'dispute','ดูรูปหลักฐานจากผู้ซื้อ'):''}</div>`;
  }
  // สร้าง HTML ของคำสั่งซื้อหนึ่งรายการ พร้อมปุ่มที่ผู้ใช้คนนี้กดได้
  function record(o) {
    const seller=o.sellerId===state.user.id, buyer=o.buyerId===state.user.id, admin=state.user.role==='admin';
    const step=['paid','shipped','completed'].indexOf(o.status==='disputed'?'shipped':o.status);
    const actions=[
      o.status==='paid'&&(seller&&state.user.verification==='approved'||admin)?['ship','dark','แจ้งจัดส่ง']:null,
      o.status==='shipped'&&buyer?['receive','dark','ยืนยันรับสินค้า']:null,
      o.status==='shipped'&&buyer?['dispute','secondary','แจ้งปัญหา']:null,
      o.status==='disputed'&&seller&&!o.dispute?.sellerResponse?['respond','secondary','ชี้แจงข้อพิพาท']:null,
      o.status==='disputed'&&admin?['resolve','dark','ตัดสินข้อพิพาท']:null,
      o.status==='completed'&&buyer&&!o.review?['review','dark','ให้คะแนนร้านค้า']:null,
      o.status==='paid'&&(buyer||admin)?['cancel','text-button','ยกเลิกและคืนเครดิต']:null
    ].filter(Boolean).map(([action,cls,label])=>`<button class="${cls}" data-action="${action}" data-order="${esc(o.id)}">${label}</button>`).join('');
    return `<article class="order-record" data-record="${esc(o.id)}"><div class="order-record-head"><span>#${esc(o.id.slice(0,8))} <small>· ${esc(date(o.createdAt))}</small></span><span class="order-status ${o.status}">${labels[o.status]||esc(o.status)}</span></div><div class="order-record-product"><img src="${esc(o.card.image)}" alt="${esc(o.card.name)}"><div><p class="order-shop">${esc(o.card.sellerName)} ${o.merchantCode?`· ${esc(o.merchantCode)}`:''}</p><h2>${esc(o.card.name)}</h2><p>${esc(gradeText(o.card))} · ${esc(o.card.condition)} · 1 ใบ</p></div><div class="order-record-total"><small>ยอดชำระ</small><strong>${money(o.total)}</strong></div></div><div class="order-progress ${['cancelled','refunded'].includes(o.status)?'cancelled':''}">${['ชำระแล้ว','จัดส่ง','รับสินค้า'].map((s,i)=>`<span class="${step>=0&&i<=step?'done':''}"><b>${i+1}</b>${s}</span>`).join('')}</div><p class="order-guidance">${esc(guidance(o,{seller,buyer}))}</p>${o.tracking?`<div class="order-tracking">เลขพัสดุ <strong>${esc(o.tracking)}</strong></div>`:''}${disputeBlock(o)}${o.review?`<p class="order-review">คะแนนของคุณ <b aria-label="${o.review.rating} ดาว">${'★'.repeat(o.review.rating)}${'☆'.repeat(5-o.review.rating)}</b>${o.review.comment?` — ${esc(o.review.comment)}`:''}</p>`:''}<div class="order-record-bottom"><details><summary>ข้อมูลจัดส่งและเลขคำสั่งซื้อ</summary><p class="address-text">${esc(o.address)}</p><small>${esc(o.id)}</small></details><div class="order-actions">${actions}</div></div>${o.shipmentProofId?proof(o,'shipment','ดูรูปสินค้าก่อนจัดส่งจากผู้ขาย','shipment-evidence'):''}${o.receiptProofId?proof(o,'receipt','ดูรูปยืนยันรับสินค้า'):''}<div class="order-editor"></div></article>`;
  }
  // อัปเดตเฉพาะรายการเมื่อค้นหา เพื่อไม่รบกวน focus ของช่องค้นหา
  function renderList() {
    const list=host.querySelector('.order-list');if(!list)return;
    host.querySelector('#order-count').textContent=`${total} รายการ`;
    const filtered=filter||query;
    list.innerHTML=data.length?data.map(record).join('')+(page<pages?'<button class="secondary" id="more-orders">โหลดเพิ่ม</button>':''):`<div class="orders-empty"><div class="empty-order-icon">▤</div><h2>${filtered?'ไม่พบรายการที่ตรงกับตัวกรอง':scope==='sales'?'ยังไม่มีคำสั่งซื้อในร้าน':'ยังไม่มีคำสั่งซื้อ'}</h2><p>${filtered?'ลองเปลี่ยนคำค้นหรือเลือกสถานะทั้งหมด':scope==='sales'?'เมื่อมีคนซื้อการ์ด รายการรอจัดส่งจะแสดงที่นี่':'เลือกการ์ดที่ชอบ แล้วติดตามสถานะได้จากหน้านี้'}</p>${filtered?'<button class="secondary" id="clear-order-filters">ล้างตัวกรอง</button>':`<a class="dark" href="${scope==='sales'?'#/shop':'#/'}">${scope==='sales'?'จัดการร้านค้าของฉัน':'สำรวจการ์ด'}</a>`}</div>`;
    list.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.onerror=null;img.src='/art/placeholder.svg';});
    list.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>edit(b.dataset.order,b.dataset.action));
    list.querySelector('#clear-order-filters')?.addEventListener('click',()=>{filter='';query='';load();});
    list.querySelector('#more-orders')?.addEventListener('click',e=>{e.target.disabled=true;load(page+1);});
  }
  // ย่อรูปในเบราว์เซอร์เป็น JPEG ก่อนส่ง เพื่อให้อยู่ในขนาดที่เซิร์ฟเวอร์รับ
  async function shrink(file) {
    if(file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('เลือกรูป PNG / JPEG / WebP ไม่เกิน 10 MB');
    const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const image=canvas.toDataURL('image/jpeg',.8);if(image.length>2700000)throw Error('รูปใหญ่เกินไป กรุณาเลือกรูปอื่น');return image;
  }
  const forms={
    ship:{title:'แจ้งการจัดส่ง',hint:'แนบรูปสินค้าหรือพัสดุก่อนจัดส่ง พร้อมบริษัทขนส่งและเลขพัสดุ',submit:'บันทึกเลขพัสดุ',image:'shipmentImage',required:true,fields:'<label>บริษัทขนส่ง / เลขพัสดุ<input name="tracking" required minlength="3" maxlength="100" placeholder="เช่น Demo Express / DEMO123456"></label>'},
    receive:{title:'ยืนยันว่าได้รับการ์ดแล้ว?',hint:'เครดิตจำลองจะโอนให้ผู้ขายเมื่อยืนยัน หากสินค้ามีปัญหาให้ใช้ปุ่ม "แจ้งปัญหา" แทน',submit:'ยืนยันรับสินค้า',image:'receiptImage',required:true,fields:''},
    dispute:{title:'แจ้งปัญหาคำสั่งซื้อ',hint:'เครดิตจะยังไม่โอนให้ผู้ขาย แอดมินจะตรวจหลักฐานของทั้งสองฝ่ายแล้วตัดสินคืนเครดิตหรือโอนให้ผู้ขาย',submit:'ส่งเรื่องให้แอดมิน',image:'disputeImage',required:false,fields:`<label>ประเภทปัญหา<select name="reason" required>${Object.entries(reasons).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>รายละเอียด (10–2,000 ตัวอักษร)<textarea name="details" required minlength="10" maxlength="2000" rows="4" placeholder="อธิบายสิ่งที่พบ เช่น มุมการ์ดหัก หรือพัสดุไม่มาถึง"></textarea></label>`},
    respond:{title:'ชี้แจงข้อพิพาท',hint:'คำชี้แจงจะแสดงให้ผู้ซื้อและแอดมินเห็น',submit:'ส่งคำชี้แจง',fields:'<label>คำชี้แจง (5–2,000 ตัวอักษร)<textarea name="response" required minlength="5" maxlength="2000" rows="4"></textarea></label>'},
    resolve:{title:'ตัดสินข้อพิพาท',hint:'ตรวจรูปและคำชี้แจงก่อนตัดสิน ผลนี้เปลี่ยนภายหลังไม่ได้ การ์ดจะไม่กลับไปวางขายอัตโนมัติ',submit:'บันทึกผลตัดสิน',fields:'<label>ผลการตัดสิน<select name="decision" required><option value="refund">คืนเครดิตให้ผู้ซื้อ</option><option value="release">โอนเครดิตให้ผู้ขาย</option></select></label><label>เหตุผล (5–2,000 ตัวอักษร)<textarea name="note" required minlength="5" maxlength="2000" rows="3"></textarea></label>'},
    review:{title:'ให้คะแนนร้านค้า',hint:'คะแนนและความเห็นจะแสดงในหน้าร้าน โดยแสดงชื่อของคุณแบบย่อ ให้คะแนนได้ครั้งเดียวต่อคำสั่งซื้อ',submit:'ส่งคะแนน',fields:`<fieldset class="star-input"><legend>คะแนน</legend>${[5,4,3,2,1].map(n=>`<input type="radio" name="rating" id="star-${n}" value="${n}" ${n===5?'checked':''}><label for="star-${n}" title="${n} ดาว">★</label>`).join('')}</fieldset><label>ความเห็น (ไม่บังคับ ไม่เกิน 1,000 ตัวอักษร)<textarea name="comment" maxlength="1000" rows="3" placeholder="เช่น แพ็กดี ส่งไว สินค้าตรงปก"></textarea></label>`},
    cancel:{title:'ยกเลิกคำสั่งซื้อนี้?',hint:'เครดิตจะคืนเข้ากระเป๋าและการ์ดจะกลับไปวางขาย',submit:'ยืนยันยกเลิก',fields:''}
  };
  // ยืนยันการดำเนินการในแถวเดิม ป้องกันกดรับ/ยกเลิกโดยไม่ตั้งใจและไม่เปิด modal ซ้อน
  function edit(id,action) {
    host.querySelectorAll('.order-editor').forEach(el=>el.replaceChildren());
    const form=forms[action],record=[...host.querySelectorAll('[data-record]')].find(el=>el.dataset.record===id),editor=record.querySelector('.order-editor');
    const upload=form.image?`<label>รูปสินค้า / พัสดุ ${form.required?'(จำเป็น)':'(จำเป็น ยกเว้นกรณีไม่ได้รับสินค้า)'}<input type="file" name="receipt" accept="image/jpeg,image/png,image/webp" ${form.required?'required':''}></label><p>ถ่ายภาพหรือเลือกจากอุปกรณ์ ไม่เกิน 10 MB · ผู้ซื้อ ผู้ขาย และแอดมินดูหลักฐานได้</p><img class="receipt-preview" hidden alt="ตัวอย่างหลักฐาน">`:'';
    editor.innerHTML=`<form id="order-action-form"><h3>${form.title}</h3><p>${form.hint}</p>${form.fields}${upload}<p class="error" role="alert"></p><button class="dark">${form.submit}</button><button type="button" class="secondary" id="cancel-order-action">กลับ</button></form>`;
    editor.querySelector('#cancel-order-action').onclick=()=>editor.replaceChildren();
    let image='';
    const fileInput=editor.querySelector('[name=receipt]');
    if(fileInput)fileInput.onchange=async()=>{
      image='';const preview=editor.querySelector('.receipt-preview');preview.hidden=true;const submit=editor.querySelector('button.dark');submit.disabled=true;
      try{const file=fileInput.files[0];if(!file)return;image=await shrink(file);preview.src=image;preview.hidden=false;editor.querySelector('.error').textContent='';}
      catch(e){editor.querySelector('.error').textContent=e.message;}finally{submit.disabled=false;}
    };
    editor.querySelector('input,select,textarea,button').focus({preventScroll:true});
    editor.querySelector('form').onsubmit=async event=>{
      event.preventDefault();event.submitter.disabled=true;
      const values=Object.fromEntries(new FormData(event.target));delete values.receipt;
      try {
        const needsImage=form.required||(action==='dispute'&&values.reason!=='not_received');
        if(needsImage&&!image)throw Error('เลือกรูปและรอให้โหลดเสร็จก่อนยืนยัน');
        if(action==='review')await api(`/orders/${id}/review`,'POST',{rating:Number(values.rating),comment:values.comment||''});
        else await api(`/orders/${id}`,'PATCH',{action,...values,...(form.image&&image?{[form.image]:image}:{})});
        toast('อัปเดตคำสั่งซื้อแล้ว');loadCards();await route();
      }
      catch(e){editor.querySelector('.error').textContent=e.message;event.submitter.disabled=false;}
    };
  }
  // วาดหน้าคำสั่งซื้อทั้งหน้า: หัวข้อ แท็บมุมมอง แท็บสถานะ และช่องค้นหา
  function render() {
    host.innerHTML=`<div class="orders-heading"><div><p class="eyebrow">ORDER CENTER</p><h1>${scope==='sales'?'คำสั่งซื้อในร้าน':scope==='admin'?'คำสั่งซื้อทั้งหมด':'การซื้อของฉัน'}</h1><p>ติดตามสถานะและจัดการคำสั่งซื้อได้ในหน้าเดียว</p></div><button class="secondary" id="reload-orders">↻ รีเฟรช</button></div><div class="orders-scope"><button data-scope="purchases" class="${scope==='purchases'?'selected':''}">การซื้อของฉัน</button>${state.user.role==='merchant'?`<button data-scope="sales" class="${scope==='sales'?'selected':''}">รายการขายในร้าน</button>`:''}${state.user.role==='admin'?`<button data-scope="admin" class="${scope==='admin'?'selected':''}">ทั้งหมด</button>`:''}</div><div class="orders-status-tabs">${[['','ทั้งหมด'],...Object.entries(labels)].map(([value,label])=>`<button data-status-filter="${value}" aria-pressed="${filter===value}" class="${filter===value?'selected':''}">${label}<b>${value?counts[value]||0:Object.values(counts).reduce((a,b)=>a+b,0)}</b></button>`).join('')}</div><div class="orders-search"><input type="search" id="order-search" placeholder="ค้นหาชื่อการ์ด ร้านค้า เลขคำสั่งซื้อ หรือเลขพัสดุ" aria-label="ค้นหาคำสั่งซื้อ"><span id="order-count" aria-live="polite"></span></div><div class="order-list"></div><p class="orders-demo">เครดิตจำลอง · ไม่มีการชำระเงินหรือจัดส่งจริง</p>`;
    host.querySelector('#order-search').value=query;
    host.querySelector('#order-search').oninput=e=>{query=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(1,false),300);};
    host.querySelector('#reload-orders').onclick=route;
    host.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>open(b.dataset.scope));
    host.querySelectorAll('[data-status-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.statusFilter;load();});
    renderList();
  }
  // โหลดหน้าแรกเมื่อเปลี่ยนตัวกรอง หรือหน้าถัดไปต่อท้ายรายการเดิม
  async function load(next=1,full=true) {
    const request=++generation;
    const params=new URLSearchParams({scope,page:String(next),limit:String(PAGE)});
    if(filter)params.set('status',filter);if(query.trim())params.set('q',query.trim());
    try {
      const result=await api(`/orders?${params}`);if(request!==generation)return;
      data=next===1?result.items:[...data,...result.items];total=result.total;counts=result.counts;page=result.page;pages=result.pages;
      full?render():renderList();
    } catch(e){if(request===generation){if(next===1)host.innerHTML=`<h1>โหลดคำสั่งซื้อไม่สำเร็จ</h1><p class="error">${esc(e.message)}</p><button class="secondary" id="retry-orders">ลองใหม่</button>`;else toast(e.message);host.querySelector('#retry-orders')?.addEventListener('click',route);}}
  }
  // URL เก็บมุมมองคำสั่งซื้อ รองรับ refresh และปุ่มย้อนกลับ พร้อมล้างข้อมูลเมื่อสลับบัญชี
  async function route() {
    // มุมมองร้าน/แอดมินเปิดได้เฉพาะบทบาทนั้น บัญชีอื่น (เช่น หลังสลับบัญชี) กลับไปที่การซื้อของตนเอง
    if (state.authLoaded && state.user && ((location.hash === '#/orders/sales' && state.user.role !== 'merchant') || (location.hash === '#/orders/admin' && state.user.role !== 'admin'))) {
      location.replace('#/orders/purchases');return;
    }
    const match=location.hash.match(/^#\/orders\/(purchases|sales|admin)$/),active=!!match;
    host.hidden=!active;document.body.classList.toggle('orders-open',active);document.querySelector('#orders-nav').classList.toggle('nav-active',active);
    if(!active){++generation;host.innerHTML='';data=[];return;}
    document.querySelector('#dialog').close();
    if(scope!==match[1]||owner!==state.user?.id){filter='';query='';}scope=match[1];owner=state.user?.id;
    if(!state.user){++generation;host.innerHTML='<h1>คำสั่งซื้อ</h1><p>เข้าสู่ระบบเพื่อดูคำสั่งซื้อของคุณ</p><button class="dark">เข้าสู่ระบบ</button>';host.querySelector('button').onclick=()=>authForm();return;}
    host.innerHTML='<p role="status">กำลังโหลดคำสั่งซื้อ…</p>';
    await load();
  }
  // เปิดหน้าคำสั่งซื้อตามมุมมองที่เลือก
  function open(next='purchases') {filter='';query='';if(location.hash===`#/orders/${next}`)return route();location.hash=`/orders/${next}`;window.scrollTo(0,0);}
  for(const e of ['hashchange','popstate','app-route-change'])addEventListener(e,route);
  addEventListener('account-changed',()=>{if(owner!==state.user?.id)route();});
  return {open,refresh:route};
}
