// Shadow DOM isolates the cinematic intro from the existing marketplace styles.
export async function initLanding(navigate) {
  const host = document.querySelector('#entry-landing');
  try {
    const response = await fetch('/landing.html');
    if (!response.ok) throw new Error('Landing unavailable');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = await response.text();
    const $ = s => root.querySelector(s), stage = $('.stage'), canvas = $('.canvas'), ring = $('.ring'), nav = $('.nav'), motion = $('.motion');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const art = ['fire','moon','ocean','magic','forest','electric'];
    const names = ['Ember Dragon EX','Lunar Guardian','Ocean Captain','Celestial Sorcerer','Forest Familiar','Thunder Fox'];
    for (const [id, count, blur, lo, hi] of [['stA',150,0,.05,.3],['stB',18,1.2,.35,.7]]) {
      $('#'+id).style.boxShadow = Array.from({length:count}, () => `${Math.random()*100}vw ${Math.random()*100}vh ${blur}px 0 rgba(255,255,255,${lo+Math.random()*(hi-lo)})`).join(',');
    }
    // Tangent planes on a cylinder; perspective equals its radius.
    const R = 891, step = 360/37;
    const cards = Array.from({length:37}, (_,i) => {
      const el = document.createElement('div'); el.className = 'ring-card';
      el.innerHTML = `<div class="slab"><div class="slab-label"><div><b>CARDSPACE</b>CONCEPT DISPLAY<br>${names[i%6].toUpperCase()}</div><strong>✦</strong></div><img src="/art/${art[i%6]}.svg" alt=""><div class="slab-caption">THE COLLECTOR'S EDITION</div></div><div class="edge"></div>`;
      ring.append(el); return el;
    });
    let phase=-2, last=0, frame=0, visible=true, paused=false;
    // สุ่มตำแหน่งดาว/อนุภาคพื้นหลังใหม่ตามขนาดจอ
    function place() {
      cards.forEach((el,i) => {
        const a=((i*step+phase)%360+540)%360-180;
        if(Math.abs(a)>42){el.style.visibility='hidden';return;}
        el.style.visibility='visible'; const r=a*Math.PI/180,c=Math.cos(r);
        el.style.transform=`translate3d(${R*Math.sin(r)}px,0,${R*(1-c)}px) rotateY(${-a}deg)`;
        el.style.filter=`brightness(${.84+.5*(1/c-1)})`;
      });
    }
    // ภาพเคลื่อนไหวทำงานเฉพาะเมื่อมองเห็นหน้า และผู้ใช้ไม่ได้ขอลดการเคลื่อนไหว
    function running(){return visible&&!document.hidden&&!paused&&!reduced.matches;}
    // วาดภาพเคลื่อนไหวหนึ่งเฟรม
    function tick(t){frame=0;if(!running())return;const dt=last?Math.min((t-last)/1000,.05):0;last=t;phase-=4.5*dt;place();frame=requestAnimationFrame(tick);}
    // เริ่มหรือหยุดภาพเคลื่อนไหวตามสถานะหน้า
    function sync(){cancelAnimationFrame(frame);frame=0;last=0;motion.hidden=reduced.matches;if(running())frame=requestAnimationFrame(tick);}
    motion.onclick=()=>{paused=!paused;motion.textContent=paused?'▷':'Ⅱ';motion.setAttribute('aria-pressed',String(paused));motion.setAttribute('aria-label',paused?'เล่นการหมุน':'หยุดการหมุน');sync();};
    new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();}).observe(host);
    document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
    // ปิดเมนูบนมือถือ
    function closeMenu(){nav.classList.remove('open');$('.burger').setAttribute('aria-expanded','false');}
    $('.burger').onclick=()=>$('.burger').setAttribute('aria-expanded',String(nav.classList.toggle('open')));
    root.addEventListener('click',e=>{if(!nav.contains(e.target))closeMenu();});
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();$('.burger').focus();}});
    // ปิดเมนูแล้วไปยังส่วนที่เลือก
    function go(kind){closeMenu();navigate(kind);}
    root.querySelectorAll('[data-view]').forEach(a=>a.onclick=e=>{e.preventDefault();go(a.dataset.view);});
    $('.wm').onclick=e=>{e.preventDefault();closeMenu();host.scrollIntoView({behavior:reduced.matches?'instant':'smooth'});};
    $('.browser').onclick=()=>go('market');
    $('.browser').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go('market');}};
    $('#shopHero').src='/art/fire.svg';
    $('.mini-grid').innerHTML=names.slice(0,4).map((name,i)=>`<div class="mini-card"><div class="mini-art"><img src="/art/${art[i]}.svg" alt="${name} ภาพตัวอย่าง"></div><strong>${name}</strong><span>สำรวจรายละเอียดในตลาดการ์ด</span></div>`).join('');
    root.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.onerror=null;img.style.visibility='hidden';});
    // ปรับขนาด canvas เมื่อเปลี่ยนขนาดหน้าต่าง
    function resize(){
      const vw=host.clientWidth,vh=stage.clientHeight;if(!vw)return;
      if(vw<=700){for(const v of ['--k','--fill','--stshift','--sshift','--rs'])canvas.style.removeProperty(v);closeMenu();place();return;}
      const tablet=vw<=1080;let W=1172;
      if(tablet){W=920+(vw-701)*(1172-920)/(1080-701);if(vh>vw*1.15)W=Math.min(W,900);}
      // Keep the browser mock bleeding below the intro without trapping scroll.
      const k=Math.min(vw/W,vh/560);let fill=Math.max(0,vh/k-657),ss=0,rs=1,st=0;
      if(tablet&&fill>0){const ramp=Math.min(1,(1080-vw)/120);ss=Math.min(fill*.55,420)*ramp;rs=1+Math.min(fill/1100,.75)*ramp;st=Math.max(0,(219.5-125*rs+ss)/2-28)*ramp;fill-=ss;}
      for(const [key,value] of Object.entries({'--k':k,'--fill':fill+'px','--sshift':ss+'px','--stshift':st+'px','--rs':rs}))canvas.style.setProperty(key,value);
      closeMenu();place();
    }
    new ResizeObserver(resize).observe(host);resize();place();sync();
    if(!reduced.matches){stage.classList.add('intro');setTimeout(()=>stage.classList.remove('intro'),2400);}
  } catch(error) { host.hidden=true; console.warn(error.message); }
}
