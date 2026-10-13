// อ่านข้อความจากรูปการ์ด (OCR) ด้วย tesseract.js ในเครื่อง เพื่อเสนอชื่อการ์ด เซ็ต ภาษา และข้อมูลเกรดให้ผู้ขายตรวจเอง
import { createWorker } from 'tesseract.js';
import english from '@tesseract.js-data/eng';
import japanese from '@tesseract.js-data/jpn';
import sharp from 'sharp';
import { gradesFor } from '../public/grading.js';

// แยกข้อความที่อ่านได้เป็นข้อเสนอเท่านั้น ไม่ประเมินสภาพ/ราคา/เกรดจากภาพงานศิลป์
export function parseCardText(text) {
  text=text.replace(/[—–~]/g,'-').replace(/GEM\s+MT\b/gi,'GEM MINT');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const result = {};
  const company = text.match(/\b(PSA|BGS|CGC)\b/i)?.[1]?.toUpperCase();
  if (company) result.gradingCompany = company;
  if (/POK[EÉ]MON/i.test(text)) result.category = 'Pokémon';
  else if (/YU[ -]?GI[ -]?OH/i.test(text)) result.category = 'Yu-Gi-Oh!';
  else if (/ONE PIECE/i.test(text)) result.category = 'One Piece';
  const named = text.match(/(?:CARD NAME|NAME)\s*[:：]\s*([^\n]+)/i)?.[1];
  const cleaned=lines.map(line=>line.replace(/\s+(?:GEM\s+MINT|MINT|#\d+).*$/i,'').trim());
  const candidate = named || cleaned.find(line => /^[A-Z][A-Za-z '\-]{3,65}(?:\s+(?:ex|EX|GX|V|VMAX))?$/.test(line) && !/POK.MON|MINT|GRADE|CERT|PROMO|TRAINER|BASIC|ENERGY|HP|BECKETT|AUTHENTIC|COLLECT|EDITION|PSA|CGC|BGS|GUARANTY|COPYRIGHT|GAME FREAK|RETREAT|WEAKNESS|RESISTANCE|ILLUS|MUNCH|VAN GOGH/i.test(line));
  if (candidate) result.name = candidate.trim();
  const set = text.match(/(?:SET|SERIES)\s*[:：]\s*([^\n]+)/i)?.[1];
  const number = text.match(/\b([A-Z]{0,3}\d{1,3}\s*\/\s*[A-Z]{0,3}\d{1,3})\b/i)?.[1];
  const promo = lines.find(line => /PROMO|VAN GOGH|SCARLET\s*(?:&|AND)?\s*VIOLET|SWORD\s*(?:&|AND)?\s*SHIELD/i.test(line));
  if (set || number || promo) result.set = [set || promo, number].filter(Boolean).join(' · ').slice(0,500);
  if (company) {
    const grade = text.match(/(?:GEM\s*(?:MINT|MT)|PRISTINE|MINT|GRADE|NM[ -]?MT|EX[ -]?MT)\s*[:：-]?\s*(10|[1-9](?:\.5)?)(?![\d.])/i)?.[1];
    if (grade && gradesFor(company).includes(grade)) result.gradingGrade = grade;
    const certificate = text.match(/(?:CERT(?:IFICATE)?(?:\s*(?:NO\.?|NUMBER|#))?)\b\s*[:：#-]?\s*([A-Z0-9-]{3,64})/i)?.[1] || text.match(/(?<![\d])\b\d{8,12}\b(?![\d])/)?.[0];
    if (certificate) result.gradingCertificate = certificate;
  }
  if (/JAPANESE|JPN\b|[ぁ-んァ-ヶ]/i.test(text)) result.language = 'ญี่ปุ่น';
  else if (/ENGLISH|ENG\b/i.test(text)) result.language = 'อังกฤษ';
  return result;
}

let busy = false;
const MIN_SIDE = 200;
// อ่านฉลากส่วนบนก่อนเพื่อไม่ให้ HP/คำอธิบายท่าทับชื่อและเกรด; โมเดลติดตั้งในเครื่อง
export async function readCardImage(bytes) {
  if(busy)throw Object.assign(new Error('กำลังอ่านรูปอื่นอยู่ กรุณาลองใหม่อีกสักครู่'),{status:429});
  busy=true;let worker,timer;
  try {
    // ขั้นตอน OCR ทั้งหมด (ถูกจำกัดเวลา 90 วินาทีด้านล่าง)
    const task=async()=>{
      const source=await sharp(bytes,{limitInputPixels:25000000}).rotate().png().toBuffer();
      const meta=await sharp(source).metadata();
      // รูปเล็กเกินไปจะตัดส่วนฉลากได้ไม่กี่พิกเซล (หรือเป็นศูนย์) และอ่านข้อความไม่ได้อยู่แล้ว
      if(!(meta.width>=MIN_SIDE&&meta.height>=MIN_SIDE))throw Object.assign(new Error(`รูปเล็กเกินไป (${meta.width||0}×${meta.height||0} พิกเซล) กรุณาเลือกรูปที่ชัดกว่า ด้านสั้นอย่างน้อย ${MIN_SIDE} พิกเซล`),{status:400});
      // ตัดส่วนของรูปตามสัดส่วน (0–1) และขยายเป็นกว้าง 1600px ให้อ่านง่ายขึ้น
      const crop=async(x,y,w,h)=>{
        const left=Math.min(meta.width-1,Math.round(meta.width*x)),top=Math.min(meta.height-1,Math.round(meta.height*y));
        return sharp(source).extract({left,top,width:Math.max(1,Math.min(meta.width-left,Math.round(meta.width*w))),height:Math.max(1,Math.min(meta.height-top,Math.round(meta.height*h)))}).resize({width:1600}).png().toBuffer();
      };
      const label=await crop(.08,.05,.84,.19);
      worker=await createWorker('eng',1,{langPath:english.langPath,gzip:true,cacheMethod:'none'});
      await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1',user_defined_dpi:'300'});
      let top=(await worker.recognize(label)).data;
      await worker.setParameters({tessedit_pageseg_mode:'11'});
      const gradeArea=(await worker.recognize(await crop(.67,.09,.25,.115))).data;
      const full=(await worker.recognize(source)).data;
      if(meta.width>meta.height)top=full;
      await worker.terminate();worker=null;
      worker=await createWorker('jpn',1,{langPath:japanese.langPath,gzip:true,cacheMethod:'none'});
      await worker.setParameters({tessedit_pageseg_mode:'11'});
      const jp=(await worker.recognize(source)).data;
      const suggestions={...parseCardText(full.text),...parseCardText(top.text)};
      const warnings=[];
      const pixels=await sharp(label).raw().toBuffer({resolveWithObject:true});let red=0;for(let i=0;i<pixels.data.length;i+=pixels.info.channels)if(pixels.data[i]>130&&pixels.data[i]>pixels.data[i+1]*1.6&&pixels.data[i]>pixels.data[i+2]*1.4)red++;
      const psaLayout=red/(pixels.info.width*pixels.info.height)>.015 && /(?:GEM\s*(?:MT|MINT)|\bMINT\b)/i.test(top.text);
      const labelText=top.text+'\n'+gradeArea.text+(psaLayout?'\nPSA':'');
      // ข้อมูลเกรด/ใบรับรองใช้เฉพาะฉลาก ไม่ใช้ข้อความท่าหรือ HP บนตัวการ์ด
      for(const k of ['gradingCompany','gradingGrade','gradingCertificate'])delete suggestions[k];
      const slab=parseCardText(labelText);
      if(psaLayout&&!/\bPSA\b/.test(top.text))warnings.push('PSA เป็นข้อเสนอจากรูปแบบฉลากสีแดง กรุณาตรวจบริษัทด้วยตนเอง');
      if(slab.gradingCompany&&!slab.gradingGrade){const gradeText=gradeArea.text+' '+top.text.split(/MINT|GEM MT/i).slice(1).join(' ');const g=gradeText.split(/\s+/).find(v=>gradesFor(slab.gradingCompany).includes(v));if(g)slab.gradingGrade=g;}
      for(const k of ['gradingCompany','gradingGrade','gradingCertificate'])if(slab[k])suggestions[k]=slab[k];
      if(/[ぁ-んァ-ヶ]{2,}/.test(jp.text)||/JPN|JAPANESE/i.test(top.text))suggestions.language='ญี่ปุ่น';
      if(!/MINT|GEM MT|GRADE|NAME:|HP\s*\d/i.test(top.text+' '+full.text)){delete suggestions.name;delete suggestions.set;}
      if(suggestions.set)suggestions.set=suggestions.set.replace(/^(?:ill|Il|BM)\s+/,'').replace(/[|§£]+/g,'').replace(/\s+/g,' ').trim();
      if(!suggestions.set&&/\b(?:19|20)\d{2} POKEMON GAME/i.test(top.text))suggestions.set=top.text.match(/\b(?:19|20)\d{2} POKEMON GAME/i)[0];
      if(!suggestions.name&&!slab.gradingCompany&&suggestions.language==='ญี่ปุ่น'){const name=jp.text.split(/\r?\n/).map(l=>l.replace(/\s/g,'')).find(l=>/^[ァ-ヶー]{3,15}(?:ex|EX|V)?$/.test(l)&&l.replace(/ー/g,'').length>=3&&l.replace(/ー/g,'').length/l.length>.8&&! /ポケモン|トレーナー|エネルギー|イラスト/.test(l));if(name)suggestions.name=name;}
      return {warnings,text:`[ฉลาก]\n${top.text}\n[คะแนนบนฉลาก]\n${gradeArea.text}\n[การ์ด]\n${full.text}\n[ญี่ปุ่น]\n${jp.text}`.slice(0,12000),confidence:top.confidence,suggestions};
    };
    return await Promise.race([task(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('อ่านรูปนานเกินไป ลองถ่ายเฉพาะฉลากให้ชัดขึ้น'),{status:408})),90000);})]);
  }finally{clearTimeout(timer);if(worker)await worker.terminate();busy=false;}
}
