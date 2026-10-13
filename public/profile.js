// หน้าโปรไฟล์ทุกบทบาท ที่อยู่เก็บแยกจากข้อมูลบัญชีที่ API อื่นแสดง
export function initProfile({api,state,escapeHTML:esc,updateUser,authForm,toast}) {
  const host=document.createElement('section');host.id='profile-page';host.hidden=true;document.querySelector('.main-nav').after(host);
  let generation=0,owner=null;
  // โหลดและแสดงหน้าโปรไฟล์เมื่อ URL เป็น #/profile
  async function route(){
    const request=++generation;owner=state.user?.id;const active=location.hash==='#/profile';
    host.hidden=!active;document.body.classList.toggle('profile-open',active);
    if(!active){host.replaceChildren();return;}
    document.querySelector('#dialog').close();
    if(!state.user){host.innerHTML='<h1>โปรไฟล์ของฉัน</h1><button class="dark">เข้าสู่ระบบ</button>';host.querySelector('button').onclick=()=>authForm();return;}
    host.innerHTML='<p role="status">กำลังโหลดโปรไฟล์…</p>';
    try{
      const p=await api('/profile');if(request!==generation)return;
      let avatar=p.avatar;const a=p.shippingAddress||{};
      host.innerHTML=`<p class="eyebrow">MY ACCOUNT</p><h1>โปรไฟล์ของฉัน</h1><p>จัดการข้อมูลและที่อยู่จัดส่งสำหรับการซื้อครั้งถัดไป</p><div class="profile-grid"><form id="profile-form" class="profile-panel"><h2>ข้อมูลส่วนตัว</h2><img id="profile-avatar" src="${esc(avatar||'/art/placeholder.svg')}" alt="รูปโปรไฟล์"><label>เปลี่ยนรูปโปรไฟล์<input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp"></label><p>PNG / JPEG / WebP ไม่เกิน 10 MB</p><button type="button" class="text-button" id="remove-avatar">ลบรูป</button><label>ชื่อที่แสดง<input name="name" maxlength="80" required value="${esc(p.name)}"></label><p>อีเมล: ${esc(p.email)}</p><p>บทบาท: ${esc({admin:'แอดมิน',merchant:'พ่อค้า',customer:'ผู้ซื้อ'}[state.user.role])}</p><p class="error" role="alert"></p><button class="dark" type="submit">บันทึกโปรไฟล์</button></form><form id="address-form" class="profile-panel"><h2>ที่อยู่จัดส่งหลัก</h2><p>บันทึก 1 ที่อยู่ต่อบัญชี และแก้ไขได้ก่อนชำระเงิน</p><label>ชื่อผู้รับ<input name="recipient" maxlength="100" required value="${esc(a.recipient||'')}"></label><label>เบอร์โทร<input name="phone" required type="tel" inputmode="numeric" data-digits pattern="0[0-9]{8,9}" title="ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0" placeholder="0812345678" value="${esc((a.phone||'').replace(/\D/g,''))}"></label><label>ที่อยู่และรหัสไปรษณีย์<textarea name="address" minlength="15" maxlength="700" rows="5" required>${esc(a.address||'')}</textarea></label><p class="error" role="alert"></p><button class="dark">บันทึกที่อยู่</button><button class="secondary" type="button" id="remove-address">ลบที่อยู่</button></form></div>`;
      const form=host.querySelector('#profile-form'),addressForm=host.querySelector('#address-form');
      host.querySelector('#avatar-file').onchange=async e=>{
        const file=e.target.files[0];if(!file)return;const button=form.querySelector('[type=submit]');button.disabled=true;
        try{if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('เลือกรูป PNG / JPEG / WebP ไม่เกิน 10 MB');
          const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,256,256);const size=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);bitmap.close();avatar=canvas.toDataURL('image/jpeg',.85);host.querySelector('#profile-avatar').src=avatar;form.querySelector('.error').textContent='';
        }catch(err){form.querySelector('.error').textContent=err.message;}finally{button.disabled=false;}
      };
      host.querySelector('#remove-avatar').onclick=()=>{avatar='';host.querySelector('#profile-avatar').src='/art/placeholder.svg';};
      form.onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{const name=new FormData(form).get('name');await api('/profile','PATCH',{name,avatar});state.user=await api('/auth/me');updateUser();toast('บันทึกโปรไฟล์แล้ว');}catch(err){form.querySelector('.error').textContent=err.message;}finally{e.submitter.disabled=false;}};
      addressForm.onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{await api('/profile','PATCH',{shippingAddress:Object.fromEntries(new FormData(addressForm))});toast('บันทึกที่อยู่แล้ว');addressForm.querySelector('.error').textContent='';}catch(err){addressForm.querySelector('.error').textContent=err.message;}finally{e.submitter.disabled=false;}};
      host.querySelector('#remove-address').onclick=async()=>{try{await api('/profile','PATCH',{shippingAddress:null});await route();toast('ลบที่อยู่แล้ว');}catch(err){addressForm.querySelector('.error').textContent=err.message;}};
    }catch(err){if(request===generation)host.innerHTML=`<p class="error">${esc(err.message)}</p>`;}
  }
  for(const event of ['hashchange','popstate','app-route-change'])addEventListener(event,route);
  addEventListener('account-changed',()=>{if(owner!==state.user?.id)route();});
  return {refresh:route,open:()=>{if(location.hash==='#/profile')route();else location.hash='/profile';}};
}
