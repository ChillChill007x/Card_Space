// รัน OCR กับรูปตัวอย่างในเครื่องหลายไฟล์ แล้วบันทึกผลไว้เปรียบเทียบความแม่นยำ
import {readFile,writeFile} from 'node:fs/promises';import {readCardImage} from '../server/card-ocr.js';
for(const name of ['CHARIZAD FRONT.webp','s-l1600.webp','s-l1600.png','CHARIZAD BLACK.webp','s-l1600 (1).webp','s-l16001.png']){const result=await readCardImage(await readFile('C:/Users/PC/Downloads/'+name));console.log(name,JSON.stringify(result.suggestions));await writeFile('tmp/ocr-'+name+'.json',JSON.stringify(result,null,2));}
