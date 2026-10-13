// จัดฟอร์มเดิมเป็นพื้นที่เต็มจอ โดยคง validation, OCR และการอัปโหลดเดิม
export function layoutListing(form){
  document.querySelector('#dialog').classList.add('listing-fullscreen');
  const groups=[['photos','01 · รูปสินค้า',['image','backImage','detailImage']],['information','02 · ข้อมูลการ์ด',['name','category','character','set','rarity','language']],['condition','03 · สภาพและเกรด',['condition','gradingCompany','conditionNotes']],['sale','04 · ราคาและการจัดส่ง',['price','description','shippingNotes']]];
  const grid=document.createElement('div');grid.className='listing-sections';
  for(const [id,title,fields] of groups){
    const section=document.createElement('section');section.className='listing-section';section.id='listing-'+id;
    const h=document.createElement('h3');h.textContent=title;section.append(h);
    for(const name of fields){
      const field=form.elements[name];
      if(name==='gradingCompany'){section.append(field.closest('fieldset'));continue;}
      const label=field.closest('label');
      if(id==='photos'){
        const upload=label.nextElementSibling;section.append(upload);
        const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='หรือใช้ลิงก์รูปภาพ';details.append(summary,label);section.append(details);
      }else section.append(label);
    }
    if(id==='photos'){const ocr=form.querySelector('.ocr-panel');if(ocr)section.append(ocr);}
    grid.append(section);
  }
  form.prepend(grid);
  // รูปแบบคำแนะนำแยกตามเกม แต่ยังรับชื่อตัวละครอื่นได้โดยไม่จำกัดรายการ
  const names={'Pokémon':['Pikachu, พิคาชู','Charizard, ลิซาร์ดอน','Psyduck, โคดัก','Eevee, อีวุย','Mewtwo, มิวทู'],'One Piece':['Monkey D. Luffy, ลูฟี่','Roronoa Zoro, โซโล','Nami, นามิ','Sanji, ซันจิ','Shanks, แชงคูส'],'Yu-Gi-Oh!':['Dark Magician','Blue-Eyes White Dragon','Dark Magician Girl']};
  // เติมตัวเลือกชื่อตัวละครที่ใช้บ่อยตามหมวดเกมที่เลือก
  function options(){const list=form.querySelector('#character-options');list.replaceChildren();for(const name of names[form.elements.category.value]||[]){const option=document.createElement('option');option.value=name;list.append(option);}}
  form.elements.category.addEventListener('change',options);options();
  // ช่องลิงก์ที่ซ่อนต้องเปิดได้เมื่อ browser พบข้อผิดพลาดในการกรอก
  form.addEventListener('invalid',e=>{const details=e.target.closest('details');if(details)details.open=true;},true);
}
