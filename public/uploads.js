// แปลงภาพที่เบราว์เซอร์เปิดได้เป็น JPEG จริงก่อนส่ง ป้องกันนามสกุลกับเนื้อไฟล์ไม่ตรงกัน
async function normalizePhoto(file) {
  if (file.size > 10 * 1024 * 1024) throw Error('รูปต้นฉบับต้องไม่เกิน 10 MB');
  const source = await new Promise((resolve,reject) => { const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(Error('อ่านไฟล์ไม่สำเร็จ')); r.readAsDataURL(file); });
  const image = await new Promise((resolve,reject) => { const img=new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(Error('เปิดไฟล์ภาพนี้ไม่ได้ กรุณาใช้ PNG, JPEG หรือ WebP')); img.src=source; });
  const scale=Math.min(1,2200/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [.92,.82,.7,.55]) {
    const data=canvas.toDataURL('image/jpeg',quality);
    if(data.length<2750000)return data;
  }
  throw Error('ภาพยังใหญ่เกินไป กรุณาย่อภาพแล้วเลือกใหม่');
}

// แสดงข้อมูลที่ OCR อ่านได้ให้เลือกก่อนใช้ ไม่เขียนทับข้อมูลที่ผู้ใช้กรอกโดยอัตโนมัติ
function createRecognition(form, api) {
  const box=document.createElement('section'); box.className='ocr-panel';
  const title=document.createElement('strong'); title.textContent='ช่วยกรอกข้อมูลจากรูป';
  const note=document.createElement('p'); note.textContent='อ่านอังกฤษ ญี่ปุ่น และฉลาก PSA/CGC/BGS · ใช้ภาพด้านหน้าที่เห็นป้ายชัด ตรวจทุกช่องก่อนใช้ ไม่ใช่การตรวจสอบใบรับรอง';
  const button=document.createElement('button'); button.type='button'; button.className='secondary'; button.textContent='อ่านข้อมูลจากรูปด้านหน้า';
  const status=document.createElement('p'); status.setAttribute('role','status');
  const results=document.createElement('div');
  box.append(title,note,button,status,results); form.prepend(box);
  let generation=0;
  const labels={name:'ชื่อการ์ด',category:'ประเภท',set:'เซ็ต / รหัส',language:'ภาษา',gradingCompany:'บริษัทเกรด',gradingGrade:'คะแนนเกรด',gradingCertificate:'เลขใบรับรอง'};
  // ส่งรูปด้านหน้าไป OCR แล้วให้ผู้ขายเลือกข้อมูลที่จะใช้
  async function read() {
    const url=form.elements.image.value;
    if(!/^\/api\/uploads\/[a-f0-9-]{36}$/.test(url)){status.textContent='อัปโหลดรูปด้านหน้าจากเครื่องก่อน แล้วจึงอ่านข้อมูลได้';return;}
    const request=++generation;
    button.disabled=true; status.textContent='กำลังอ่านข้อความจากรูป…'; results.replaceChildren();
    try {
      const data=await api(url.replace('/api','')+'/recognize','POST',{});
      if(request!==generation || !form.isConnected || form.elements.image.value!==url)return;
      const fields=Object.entries(data.suggestions).filter(([key,value])=>labels[key] && value);
      status.textContent=fields.length?'อ่านได้บางส่วน เลือกข้อมูลที่ต้องการใช้และตรวจให้ตรงกับการ์ดจริง':'ยังอ่านข้อความสำคัญไม่ได้ ลองรูปที่ชัดขึ้นหรือกรอกเองได้เลย';
      for(const warning of data.warnings||[]){const p=document.createElement('p');p.textContent=warning;results.append(p);}
      for(const [key,value] of fields){
        const label=document.createElement('label');label.className='ocr-choice';
        const check=document.createElement('input');check.type='checkbox';check.dataset.field=key;check.value=value;check.checked=!form.elements[key]?.value && !(key.startsWith('grading')&&(data.warnings||[]).length);
        const span=document.createElement('span');span.textContent=labels[key]+': '+value;label.append(check,span);results.append(label);
      }
      if(fields.length){
        const apply=document.createElement('button');apply.type='button';apply.className='secondary';apply.textContent='ใช้ข้อมูลที่เลือก';
        apply.onclick=()=>{
          for(const check of results.querySelectorAll('input:checked')){
            const key=check.dataset.field, field=form.elements[key];if(!field)continue;
            if(['gradingGrade','gradingCertificate'].includes(key) && form.elements.gradingCompany.value!==data.suggestions.gradingCompany)continue;
            if(field.tagName==='SELECT' && ![...field.options].some(o=>o.value===check.value))continue;
            field.value=check.value;field.dispatchEvent(new Event('change',{bubbles:true}));
          }
          status.textContent='เติมข้อมูลที่เลือกแล้ว กรุณาตรวจชื่อ เซ็ต เกรด และเลขใบรับรองก่อนบันทึก';
        };results.append(apply);
      }
      const details=document.createElement('details'), summary=document.createElement('summary'), raw=document.createElement('pre');
      summary.textContent='ดูข้อความที่อ่านได้';raw.textContent=data.text || 'ไม่พบข้อความ';details.append(summary,raw);results.append(details);
    } catch(e){if(request===generation)status.textContent=e.message;}
    finally{if(request===generation)button.disabled=false;}
  }
  button.onclick=read;
  return { read, reset:()=>{generation++;button.disabled=false;results.replaceChildren();status.textContent='';} };
}

// อัปโหลดทันทีเมื่อเลือกรูป เติม URL อัตโนมัติ และใช้ generation ป้องกันรูปเก่าทับรูปที่เลือกใหม่
export function bindListingUploads(form, api) {
  const pending=new Map(), recognition=createRecognition(form,api);
  for(const name of ['image','backImage','detailImage']){
    const field=form.elements[name],label=document.createElement('label');
    label.textContent={image:'อัปโหลดรูปด้านหน้า',backImage:'อัปโหลดรูปด้านหลัง',detailImage:'อัปโหลดรูปตำหนิ / รายละเอียด'}[name]+' (PNG/JPEG/WebP สูงสุด 10 MB ระบบย่อให้)';
    const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';
    const preview=document.createElement('img');preview.className='listing-preview';preview.hidden=!field.value;if(field.value)preview.src=field.value;
    const status=document.createElement('span');status.setAttribute('role','status');label.append(file,preview,status);field.closest('label').after(label);
    let generation=0;
    file.onchange=()=>{
      const selected=file.files[0],request=++generation;file.setCustomValidity('');
      if(name==='image')recognition.reset();
      if(!selected)return;
      status.textContent='กำลังแปลงและอัปโหลดรูป…';file.setCustomValidity('กรุณารออัปโหลดรูปให้เสร็จ');
      // ย่อ/แปลงรูปในเบราว์เซอร์แล้วอัปโหลด เก็บ promise ไว้ให้ปุ่มบันทึกรอจนเสร็จ
      const task=(async()=>{
        try{
          const data=await normalizePhoto(selected);if(request!==generation)return;
          preview.src=data;preview.hidden=false;
          const uploaded=await api('/uploads','POST',{data});if(request!==generation || !form.isConnected)return;
          field.value=uploaded.url;field.required=name==='image';file.setCustomValidity('');status.textContent='อัปโหลดสำเร็จ เติมช่องรูปให้แล้ว';
          if(name==='image')recognition.read();
        }catch(e){if(request===generation){status.textContent=e.message;file.setCustomValidity(e.message);}}
      })();pending.set(name,task);
    };
    field.oninput=()=>{generation++;file.value='';file.setCustomValidity('');status.textContent='';preview.src=field.value;preview.hidden=!field.value;if(name==='image')recognition.reset();};
  }
  return async()=>{await Promise.all(pending.values());if(!form.checkValidity())throw Error('กรุณาตรวจรูปและข้อมูลที่ยังไม่ครบ');};
}
