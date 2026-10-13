// หน้าร้านสาธารณะ (#/merchants/:id): ข้อมูลร้าน สถิติ คะแนนรีวิว การ์ดที่กำลังขาย และรีวิวจากผู้ซื้อ
export function initMerchantProfile({api,money,escapeHTML:esc}) {
  const host=document.createElement('section');host.id='merchant-profile';host.hidden=true;
  document.querySelector('.main-nav').after(host);let generation=0;
  // โหลดข้อมูลร้านเมื่อ URL เป็น #/merchants/:id และกันผลลัพธ์เก่าทับหน้าที่เปิดใหม่
  async function route(){
    const request=++generation,match=location.hash.match(/^#\/merchants\/([^/]+)$/);
    host.hidden=!match;document.body.classList.toggle('merchant-profile-open',!!match);
    if(!match)return;
    host.innerHTML='<p role="status">กำลังโหลดร้านค้า…</p>';window.scrollTo(0,0);
    try{
      const shop=await api(`/merchants/${match[1]}`);if(request!==generation)return;
      host.innerHTML=`<a href="#/">← สำรวจการ์ด</a><section class="public-shop-header" aria-label="ข้อมูลร้านค้า"><div class="public-shop-identity"><div class="public-shop-avatar">${shop.avatar?`<img src="${esc(shop.avatar)}" alt="รูปโปรไฟล์ร้าน">`:esc(shop.name.slice(0,1))}</div><div><p class="eyebrow">SELLER PROFILE</p><h1>${esc(shop.name)}</h1><p>${esc(shop.merchantCode||'ร้านตัวอย่างสำหรับสาธิต')}</p><span class="public-shop-status">${shop.approved?'พร้อมขาย':'ร้านค้ายังไม่พร้อมขาย'}</span></div></div><div class="public-shop-stats"><div><strong>${shop.rating.count?shop.rating.average.toFixed(1):'–'}</strong><span>${shop.rating.count?`คะแนนร้าน (${shop.rating.count} รีวิว)`:'ยังไม่มีรีวิว'}</span></div><div><strong>${shop.completedCount}</strong><span>รายการที่ขายสำเร็จ</span></div><div><strong>${shop.cards.length}</strong><span>การ์ดที่กำลังขาย</span></div></div><p class="public-shop-note">ยอดขายนับจากรายการที่ผู้ซื้อยืนยันรับแล้ว · ข้อมูลจากระบบเครดิตสาธิต</p></section><div class="public-shop-toolbar"><div><h2>การ์ดในร้าน <span class="public-shop-count">${shop.cards.length}</span></h2><p>เลือกดูการ์ดที่กำลังวางขายจากร้านนี้</p></div><input type="search" aria-label="ค้นหาการ์ดในร้าน" placeholder="ค้นหาชื่อการ์ดหรือตัวละคร"></div><div class="public-shop-grid"></div>`;
      const grid=host.querySelector('.public-shop-grid');
      // แสดงการ์ดในร้านตามคำค้นในหน้าร้าน
      function render(q=''){const cards=shop.cards.filter(c=>`${c.name} ${c.character} ${c.category}`.toLowerCase().includes(q.toLowerCase()));grid.innerHTML=cards.length?cards.map(c=>`<a class="public-shop-card" href="#/cards/${encodeURIComponent(c.id)}"><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy"><small>${esc(c.category)}</small><h3>${esc(c.name)}</h3><strong>${money(c.price)}</strong><span>ดูการ์ด ↗</span></a>`).join(''):'<p class="public-shop-empty">'+(q?'ไม่พบการ์ดที่ตรงกับคำค้น':'ร้านนี้ยังไม่มีการ์ดที่พร้อมขาย')+'</p>';}
      render();host.querySelector('input').oninput=e=>render(e.target.value);
      // รีวิวล่าสุดจากผู้ซื้อที่ได้รับสินค้าแล้ว (ซ่อนชื่อเต็มของผู้ซื้อ)
      const reviews=document.createElement('section');reviews.className='shop-reviews';
      const stars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
      reviews.innerHTML=`<h2>รีวิวจากผู้ซื้อ</h2>${shop.rating.items.length?shop.rating.items.map(r=>`<article><div><b aria-label="${r.rating} ดาว">${stars(r.rating)}</b><small>${esc(r.buyerName)} · ${esc(new Date(r.createdAt).toLocaleDateString('th-TH',{dateStyle:'medium'}))}</small></div><p class="review-card">ซื้อ ${esc(r.cardName)}</p>${r.comment?`<p class="preserve-lines">${esc(r.comment)}</p>`:''}</article>`).join(''):'<p class="public-shop-empty">ยังไม่มีรีวิว — รีวิวจะแสดงหลังผู้ซื้อได้รับสินค้าและให้คะแนน</p>'}`;
      host.append(reviews);
    }catch(e){if(request===generation)host.innerHTML=`<h1>เปิดร้านค้าไม่ได้</h1><p role="alert">${esc(e.message)}</p><a href="#/">กลับตลาดการ์ด</a>`;}
  }
  addEventListener('hashchange',route);addEventListener('popstate',route);addEventListener('app-route-change',route);route();
}
