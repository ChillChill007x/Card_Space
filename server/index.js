// เริ่มเซิร์ฟเวอร์ เลือกฐานข้อมูล และสร้างแอดมินจาก environment หากยังไม่มี
import { createStore } from './store.js';
import { createApp, hashPassword } from './app.js';
import { randomUUID } from 'node:crypto';

const demo = process.argv.includes('--demo');
if (demo && process.env.NODE_ENV === 'production') throw new Error('Demo mode is disabled in production');
// หน่วยความจำใช้ได้เฉพาะเมื่อสั่ง --demo โดยตั้งใจ ป้องกันลืมไฟล์ตั้งค่าแล้วข้อมูลหายเมื่อปิดเซิร์ฟเวอร์
if (!demo && !process.env.MONGODB_URI) {
  console.error('ไม่พบ MONGODB_URI: ตั้งค่าในไฟล์ .env (ดู .env.example) หรือใช้ `npm run demo` หากต้องการโหมดสาธิตที่ข้อมูลหายเมื่อปิดเซิร์ฟเวอร์');
  process.exit(1);
}
const store = await createStore(demo ? undefined : process.env.MONGODB_URI);
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must have at least 12 characters');
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  if (!(await store.getUserByEmail(email))) await store.addUser({ id: randomUUID(), name: 'Administrator', email, passwordHash: hashPassword(process.env.ADMIN_PASSWORD), role: 'admin', verification: 'none', balance: 0 });
}
const port = process.env.PORT || 3000;
const app = createApp(store);
// ยืนยันรับอัตโนมัติสำหรับรายการที่จัดส่งแล้วเกินกำหนดและไม่มีการแจ้งปัญหา
const settle = () => app.locals.commerce.settleOverdue().then(n => { if (n) console.log(`Auto-completed ${n} overdue orders`); }, e => console.error('Auto-complete failed:', e.message));
settle(); setInterval(settle, 60 * 60 * 1000);
app.listen(port, '127.0.0.1', () => console.log(`Cardspace: http://localhost:${port} (${store.mode})`));
