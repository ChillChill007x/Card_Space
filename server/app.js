// สร้างแอป Express: middleware ความปลอดภัย, session, ตรวจสิทธิ์ตามบทบาท และ REST API ทั้งหมดของ Cardspace
import { readCardImage } from './card-ocr.js';
import express from 'express';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { categories } from './seed.js';
import { createCommerce } from './commerce.js';
import { gradingCompanies, gradesFor } from '../public/grading.js';

// สร้าง salt ใหม่และ hash รหัสผ่านด้วย scrypt ไม่เก็บรหัสผ่านข้อความตรง

// สร้าง salt ใหม่แล้ว hash รหัสผ่านด้วย scrypt (คืนค่า "salt:hash")
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
const publicUser = ({ passwordHash, application, shippingAddress, _id, __v, ...user }) => ({ ...user, verificationSubmitted: !!application?.submittedAt, verificationNote: application?.reviewNote || '' });
const tokenHash = token => createHash('sha256').update(token || '').digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
// เบอร์โทรไทย: ตัดขีด/ช่องว่างออก แล้วต้องเป็นตัวเลข 9–10 หลักขึ้นต้นด้วย 0
const thaiPhone = value => { const digits = typeof value === 'string' ? value.replace(/[\s-]/g, '') : ''; return /^0\d{8,9}$/.test(digits) ? digits : null; };
const SAMPLE_SELLER = 'sample-merchant';
// ตัดฟิลด์ภายในก่อนส่งการ์ดออก API
const publicCard = ({ soldOrderId, _id, __v, ...card }) => card;
const pageQuery = (query, fallback = 20) => ({ page: Math.max(1, Math.min(10000, Number.parseInt(query.page, 10) || 1)), limit: Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || fallback)) });
// รับรูป JPEG/PNG แบบ data URL ตรวจ magic bytes และขนาด แล้วเก็บเป็นหลักฐานส่วนตัว
async function storeProof(store, input, required) {
  if (input === undefined && !required) return null;
  const match=typeof input==='string'&&input.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw fail(400,'แนบรูป JPEG หรือ PNG ก่อนยืนยัน');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>2*1024*1024||!(match[1]==='jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))throw fail(400,'รูปไม่ถูกต้องหรือใหญ่เกิน 2 MB');
  const id=randomUUID();await store.addReceiptProof({id,mime:`image/${match[1]}`,bytes});return id;
}

// Sessions stay on the server; the browser receives only an HttpOnly cookie.
// ประกอบ Express middleware, session, API และสิทธิ์แต่ละบทบาท
export function createApp(store) {
  const app = express(), sessions = new Map(), attempts = new Map();
  const commerce = createCommerce(store);
  app.locals.commerce = commerce;
  app.disable('x-powered-by');
  // ห้ามเบราว์เซอร์/พร็อกซีเก็บ cache ของ API เพราะมีข้อมูลส่วนตัว
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // แปลง body JSON (จำกัด 3 MB เพราะรูปส่งมาเป็น data URL)
  app.use(express.json({ limit: '3mb' }));
  // ตั้ง header ความปลอดภัย (CSP, nosniff) และปฏิเสธคำขอแก้ไขข้อมูลที่มาจากเว็บไซต์อื่น
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ message: 'คำขอข้ามเว็บไซต์ไม่ได้รับอนุญาต' });
    next();
  });
  // อ่าน cookie session แล้วโหลดผู้ใช้ปัจจุบันไว้ที่ req.user
  app.use(async (req, res, next) => {
    const token = req.headers.cookie?.split('; ').find(c => c.startsWith('session='))?.slice(8);
    const session = token && (store.getSession ? await store.getSession(tokenHash(token)) : sessions.get(token));
    if (session && session.expires > Date.now()) req.user = await store.getUser(session.id);
    else if (token) sessions.delete(token);
    req.token = token; next();
  });
  const auth = (req, res, next) => req.user ? next() : next(fail(401, 'กรุณาเข้าสู่ระบบ'));
  const admin = (req, res, next) => req.user?.role === 'admin' ? next() : next(fail(403, 'สำหรับแอดมินเท่านั้น'));
  const merchant = (req, res, next) => req.user?.role === 'merchant' && req.user.verification === 'approved' ? next() : next(fail(403, 'ต้องเป็นพ่อค้าที่ได้รับอนุมัติก่อนลงขาย'));
  // สร้าง session ใหม่ (อายุ 24 ชั่วโมง) และส่ง cookie HttpOnly ให้เบราว์เซอร์
  const sessionFor = async (res, user) => {
    for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
    const token = randomBytes(32).toString('hex');
    const session = { id: user.id, expires: new Date(Date.now() + 86400000) };
    if (store.setSession) await store.setSession({ ...session, token: tokenHash(token) });
    else sessions.set(token, session);
    res.cookie('session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 86400000 });
  };
  // Basic throttling for credential endpoints in this single-process prototype.
  app.use('/api/auth', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    const entry = attempts.get(req.ip) || { count: 0, until: now + 60000 };
    entry.count++; attempts.set(req.ip, entry);
    entry.count > 30 ? next(fail(429, 'ลองใหม่อีกครั้งในหนึ่งนาที')) : next();
  });
  // สถานะระบบสำหรับหน้าเว็บ: โหมดฐานข้อมูล, เปิดซื้อขายสาธิตหรือไม่, จำนวนวันยืนยันอัตโนมัติ, อีเมลติดต่อ
  app.get('/api/status', (req, res) => res.json({ mode: store.mode, paymentsEnabled: false, demoCommerce: commerce.enabled, autoCompleteDays: commerce.autoCompleteDays, contactEmail: process.env.CONTACT_EMAIL || '' }));
  // กระเป๋าเครดิต: ยอดคงเหลือและประวัติรายการ / เติมเครดิตสาธิต (ต้องมี Idempotency-Key)
  app.get('/api/wallet', auth, async (req, res) => res.json({ ...await commerce.wallet(req.user), persistent: !!commerce.persistent }));
  app.post('/api/wallet/topup', auth, async (req, res) => res.json(await commerce.topup(req.user.id, req.body.amount, req.get('Idempotency-Key'))));
  // ตะกร้าแยกตาม session ของผู้ใช้ การเพิ่มรายการไม่จองสินค้า
  app.get('/api/cart', auth, async (req,res) => res.json(await commerce.cart(req.user.id)));
  // ใส่การ์ดลงตะกร้า (ไม่จองสินค้า)
  app.post('/api/cart', auth, async (req,res) => res.json(await commerce.addCart(req.user.id,req.body.cardId)));
  // นำการ์ดออกจากตะกร้า
  app.delete('/api/cart/:id', auth, async (req,res) => res.json(await commerce.removeCart(req.user.id,req.params.id)));
  // ชำระทุกรายการในตะกร้า: ซื้อทั้งหมดหรือไม่ซื้อเลย
  app.post('/api/cart/checkout', auth, async (req,res) => res.status(201).json(await commerce.checkoutCart(req.user.id,req.body,req.get('Idempotency-Key'))));
  // รายการคำสั่งซื้อแบบแบ่งหน้า แยกมุมมองผู้ซื้อ (purchases) / ร้าน (sales) / แอดมิน (admin) พร้อมรหัสพ่อค้าและรีวิว
  app.get('/api/orders', auth, async (req, res) => {
    if (req.query.scope === 'sales' && req.user.role !== 'merchant') throw fail(403, 'สำหรับบัญชีพ่อค้าเท่านั้น');
    if (req.query.scope === 'admin' && req.user.role !== 'admin') throw fail(403, 'สำหรับแอดมินเท่านั้น');
    const status = typeof req.query.status === 'string' && /^[a-z]{1,20}$/.test(req.query.status) ? req.query.status : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const result = await commerce.list(req.user, req.query.scope, { ...pageQuery(req.query), status, q });
    const ids = result.items.map(o => o.id);
    const [users, reviews] = await Promise.all([store.usersByIds(result.items.map(o => o.sellerId)), store.reviewsByOrderIds(ids)]);
    res.json({ ...result, items: result.items.map(o=>{ const review = reviews.find(r => r.orderId === o.id); return {...o,merchantCode:users.find(u=>u.id===o.sellerId)?.merchantCode||'',review:review?{rating:review.rating,comment:review.comment}:null}; }) });
  });
  // ซื้อการ์ด 1 ใบทันที (ต้องมี Idempotency-Key กันกดซ้ำ)
  app.post('/api/orders', auth, async (req, res) => res.status(201).json(await commerce.buy(req.user.id, req.body, req.get('Idempotency-Key'))));
  // หลักฐานรับสินค้าเก็บแยกจาก ledger และให้ดูได้เฉพาะคู่ค้า/แอดมิน
  app.get(['/api/orders/:id/receipt','/api/orders/:id/shipment','/api/orders/:id/dispute'],auth,async(req,res)=>{
    const order=await commerce.order(req.user,req.params.id);
    const kind=req.path.split('/').pop();
    const proofId=kind==='shipment'?order?.shipmentProofId:kind==='dispute'?order?.dispute?.evidenceProofId:order?.receiptProofId;
    if(!proofId)throw fail(404,'ไม่พบหลักฐาน');
    const proof=await store.getReceiptProof(proofId);if(!proof)throw fail(404,'ไม่พบหลักฐาน');
    res.type(proof.mime).send(Buffer.from(proof.bytes));
  });
  // เปลี่ยนสถานะคำสั่งซื้อ: ship / receive / cancel / dispute / respond / resolve (รับรูปหลักฐานก่อนส่งต่อให้ commerce)
  app.patch('/api/orders/:id', auth, async (req, res) => {
    const {action}=req.body;
    const body={action,tracking:req.body.tracking,reason:req.body.reason,details:req.body.details,response:req.body.response,decision:req.body.decision,note:req.body.note};
    let proofId;
    // ตรวจสิทธิ์/สถานะก่อนรับไฟล์ เพื่อไม่เก็บรูปของผู้ที่ไม่มีสิทธิ์ (commerce ตรวจซ้ำอีกครั้งตอนเปลี่ยนสถานะ)
    if(['receive','ship','dispute'].includes(action)){
      const order=await commerce.order(req.user,req.params.id);
      const allowed=action==='ship'?order&&(req.user.role==='admin'||order.sellerId===req.user.id&&req.user.role==='merchant'&&req.user.verification==='approved'):order?.buyerId===req.user.id;
      if(!allowed)throw fail(403,action==='ship'?'เฉพาะพ่อค้าที่อนุมัติหรือแอดมิน':action==='receive'?'เฉพาะผู้ซื้อที่ยืนยันรับสินค้าได้':'เฉพาะผู้ซื้อที่แจ้งปัญหาได้');
      if(order.status!==(action==='ship'?'paid':'shipped'))throw fail(409,action==='ship'?'เปลี่ยนสถานะได้เฉพาะรายการรอจัดส่ง':action==='receive'?'ต้องจัดส่งก่อนยืนยันรับสินค้า':'แจ้งปัญหาได้เฉพาะรายการที่จัดส่งแล้วและยังไม่ยืนยันรับ');
      const field={ship:'shipmentImage',receive:'receiptImage',dispute:'disputeImage'}[action];
      proofId=await storeProof(store,req.body[field],action!=='dispute'||req.body.reason!=='not_received');
      if(proofId)body[{ship:'shipmentProofId',receive:'receiptProofId',dispute:'disputeProofId'}[action]]=proofId;
    }
    try{res.json(await commerce.transition(req.user,req.params.id,body));}catch(e){if(proofId)await store.deleteReceiptProof(proofId);throw e;}
  });
  // ผู้ซื้อให้คะแนนร้านได้ครั้งเดียวต่อคำสั่งซื้อที่สำเร็จแล้ว
  app.post('/api/orders/:id/review', auth, async (req, res) => {
    const order = await commerce.order(req.user, req.params.id);
    if (!order || order.buyerId !== req.user.id) throw fail(403, 'ให้คะแนนได้เฉพาะผู้ซื้อของคำสั่งซื้อนี้');
    if (order.status !== 'completed') throw fail(409, 'ให้คะแนนได้หลังคำสั่งซื้อสำเร็จแล้ว');
    const { rating, comment = '' } = req.body;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || typeof comment !== 'string' || comment.length > 1000) throw fail(400, 'เลือกคะแนน 1–5 ดาว และเขียนความเห็นไม่เกิน 1,000 ตัวอักษร');
    const name = req.user.name.trim();
    const review = { id: randomUUID(), orderId: order.id, sellerId: order.sellerId, buyerId: req.user.id, buyerName: `${[...name][0] || 'ผ'}${'*'.repeat(3)}`, cardName: order.card.name, rating, comment: comment.trim(), createdAt: new Date().toISOString() };
    try { await store.addReview(review); } catch (e) { if (e.code === 11000) throw fail(409, 'คุณให้คะแนนคำสั่งซื้อนี้แล้ว'); throw e; }
    res.status(201).json({ rating, comment: review.comment });
  });
  // การแจ้งเตือนคำนวณจากงานที่ค้างอยู่จริง จึงหายไปเองเมื่อจัดการเสร็จ
  app.get('/api/notifications', auth, async (req, res) => {
    const u = req.user, items = [];
    // เพิ่มรายการแจ้งเตือนเมื่อมีงานค้างมากกว่า 0
    const add = async (count, label, href) => { const n = await count; if (n) items.push({ label, count: n, href }); };
    await add(store.countOrders({ buyerId: u.id, status: 'shipped' }), 'พัสดุจัดส่งแล้ว รอคุณยืนยันรับ', '#/orders/purchases');
    await add(store.countUnreviewed(u.id), 'คำสั่งซื้อที่รอให้คะแนนร้านค้า', '#/orders/purchases');
    if (u.role === 'merchant') {
      await add(store.countOrders({ sellerId: u.id, status: 'paid' }), 'คำสั่งซื้อใหม่รอจัดส่ง', '#/orders/sales');
      await add(store.countOrders({ sellerId: u.id, status: 'disputed' }), 'ข้อพิพาทที่เปิดอยู่ในร้าน', '#/orders/sales');
    }
    if (u.role === 'admin') {
      await add(store.countOrders({ status: 'disputed' }), 'ข้อพิพาทรอแอดมินตัดสิน', '#/orders/admin');
      await add(store.countPendingApplications(), 'คำขอเปิดร้านรอตรวจสอบ', '#/admin');
      await add(store.countReports('pending'), 'รายงานสินค้าใหม่', '#/reports');
    }
    res.json({ items, total: items.reduce((sum, i) => sum + i.count, 0) });
  });
  // รายชื่อหมวดหมู่เกมการ์ด
  app.get('/api/categories', (req, res) => res.json(categories));
  // ผู้แจ้งส่งได้เฉพาะเหตุผลและรายละเอียด ตัวตน/สถานะกำหนดจากเซิร์ฟเวอร์
  app.post('/api/cards/:id/reports',auth,async(req,res)=>{
    if(!['customer','merchant'].includes(req.user.role))throw fail(403,'สำหรับผู้ซื้อและพ่อค้า');
    const card=await store.getCard(req.params.id);
    if(!card)throw fail(404,'ไม่พบสินค้า');
    if(card.sellerId===req.user.id)throw fail(400,'รายการของคุณเอง กรุณาแก้ไขหรือลบผ่านร้านค้าของฉัน');
    const {reason,details}=req.body;
    if(!['counterfeit','misleading','inappropriate','fraud','other'].includes(reason)||typeof details!=='string'||details.trim().length<10||details.length>2000)throw fail(400,'เลือกเหตุผลและอธิบายปัญหา 10–2,000 ตัวอักษร');
    const report={id:randomUUID(),cardId:card.id,cardName:card.name,sellerId:card.sellerId,reporterId:req.user.id,reason,details:details.trim(),status:'pending',reviewNote:'',createdAt:new Date().toISOString()};
    try{await store.addReport(report);}catch(e){if(e.code===11000)throw fail(409,'คุณเคยรายงานสินค้านี้แล้ว แอดมินได้รับข้อมูลแล้ว');throw e;}
    res.status(201).json({id:report.id,status:report.status});
  });
  // แอดมินดูรายงานสินค้าทั้งหมด พร้อมรหัสพ่อค้าของร้านที่ถูกรายงาน
  app.get('/api/admin/reports',auth,admin,async(req,res)=>{const reports=await store.reports(),users=await store.usersByIds(reports.map(r=>r.sellerId));res.json(reports.map(r=>({...r,merchantCode:users.find(u=>u.id===r.sellerId)?.merchantCode||''})));});
  // แอดมินเปลี่ยนสถานะรายงาน (ปิดรายงานต้องระบุผลตรวจสอบ)
  app.patch('/api/admin/reports/:id',auth,admin,async(req,res)=>{
    if(!['pending','reviewing','resolved','dismissed'].includes(req.body.status)||typeof req.body.reviewNote!=='string'||req.body.reviewNote.length>2000||(['resolved','dismissed'].includes(req.body.status)&&!req.body.reviewNote.trim()))throw fail(400,'เลือกสถานะและระบุผลตรวจสอบก่อนปิดรายงาน');
    if(!(await store.getReport(req.params.id)))throw fail(404,'ไม่พบรายงาน');
    await store.reviewReport(req.params.id,{status:req.body.status,reviewNote:req.body.reviewNote.trim(),reviewedBy:req.user.id,updatedAt:new Date().toISOString()});res.json({ok:true});
  });
  // ข้อมูลผู้ใช้ที่เข้าสู่ระบบอยู่ (ไม่มีรหัสผ่านและหลักฐาน) หรือ null
  app.get('/api/auth/me', (req, res) => res.json(req.user ? publicUser(req.user) : null));
  // ข้อมูลโปรไฟล์และที่อยู่ส่วนตัวผูกกับ session เท่านั้น ไม่รับ id หรือสิทธิ์จากผู้ส่ง
  app.get('/api/profile', auth, (req,res) => res.json({ name:req.user.name, email:req.user.email, avatar:req.user.avatar || '', shippingAddress:req.user.shippingAddress || null }));
  // แก้ชื่อ รูปโปรไฟล์ (JPEG) และที่อยู่จัดส่ง ตรวจทุกฟิลด์ก่อนบันทึก
  app.patch('/api/profile', auth, async (req,res) => {
    const fields = {};
    if ('name' in req.body) {
      if(typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length>80) throw fail(400,'กรอกชื่อไม่เกิน 80 ตัวอักษร');
      fields.name=req.body.name.trim();
    }
    if ('avatar' in req.body) {
      const v=req.body.avatar;
      if(typeof v!=='string' || v.length>350000 || (v && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v))) throw fail(400,'รูปโปรไฟล์ไม่ถูกต้องหรือใหญ่เกินไป');
      if(v && !Buffer.from(v.split(',')[1],'base64').subarray(0,3).equals(Buffer.from([255,216,255]))) throw fail(400,'ไฟล์รูปไม่ถูกต้อง');
      fields.avatar=v;
    }
    if ('shippingAddress' in req.body) {
      const a=req.body.shippingAddress;
      if(a===null) fields.shippingAddress=null;
      else {
        if(!a || typeof a.recipient!=='string' || !a.recipient.trim() || a.recipient.length>100 || !thaiPhone(a.phone) || typeof a.address!=='string' || a.address.trim().length<15 || a.address.length>700) throw fail(400,'กรอกชื่อผู้รับ เบอร์โทร (ตัวเลข 9–10 หลัก) และที่อยู่ให้ครบ (ที่อยู่อย่างน้อย 15 ตัวอักษร)');
        fields.shippingAddress={recipient:a.recipient.trim(),phone:thaiPhone(a.phone),address:a.address.trim()};
      }
    }
    await store.saveProfile(req.user.id,fields);
    res.json({ok:true});
  });
  // สมัครสมาชิก (ผู้ซื้อหรือพ่อค้า) แล้วเข้าสู่ระบบทันที
  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, role } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 128 || !['customer', 'merchant'].includes(role)) throw fail(400, 'กรอกข้อมูลให้ครบ และใช้รหัสผ่าน 12–128 ตัวอักษร');
    const normalized = email.trim().toLowerCase();
    if (await store.getUserByEmail(normalized)) throw fail(409, 'อีเมลนี้ถูกใช้งานแล้ว');
    const user = { id: randomUUID(), name: name.trim(), email: normalized, passwordHash: hashPassword(password), role, verification: role === 'merchant' ? 'pending' : 'none', balance: 0 };
    await store.addUser(user); await sessionFor(res, user); res.status(201).json(publicUser(user));
  });
  // เข้าสู่ระบบ: เทียบรหัสผ่านแบบเวลาคงที่ เพื่อไม่ให้เดาได้ว่าอีเมลมีอยู่จริงหรือไม่
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128) throw fail(400, 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง');
    const user = await store.getUserByEmail(email.trim().toLowerCase());
    const [salt, hash] = (user?.passwordHash || hashPassword('dummy-password')).split(':');
    if (!timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64)) || !user) throw fail(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    await sessionFor(res, user); res.json(publicUser(user));
  });
  // ออกจากระบบ: ลบ session และ cookie
  app.post('/api/auth/logout', async (req, res) => { if (store.deleteSession) await store.deleteSession(tokenHash(req.token)); sessions.delete(req.token); res.clearCookie('session'); res.json({ ok: true }); });
  // หน้าร้านสาธารณะ: ข้อมูลร้าน ยอดขายสำเร็จ คะแนนรีวิว และการ์ดที่กำลังขาย
  app.get('/api/merchants/:id', async (req,res) => {
    // อ่านจากฐานข้อมูลโดยตรง ไม่ผูกกับการเปิด/ปิดระบบธุรกรรมสาธิต จึงเปิดได้ใน production
    const id=req.params.id,found=await store.getUser(id),seller=found?.role==='merchant'?found:null;
    const sample=id===SAMPLE_SELLER;
    if(!seller&&!sample)throw fail(404,'ไม่พบร้านค้านี้');
    const approved=sample||seller.verification==='approved';
    const cards=approved?(await store.searchCards({sellerId:id})).items:[];
    res.json({id,name:seller?.application?.shopName||seller?.name||'ร้านตัวอย่าง',avatar:seller?.avatar||'',merchantCode:seller?.merchantCode||'',approved,sample,
      completedCount:await store.countOrders({sellerId:id,status:'completed'}),rating:await store.sellerReviews(id,10),
      cards:cards.map(c=>({id:c.id,name:c.name,image:c.image,price:c.price,category:c.category,character:c.character||''}))});
  });
  // ค้นหา/กรอง/เรียงการ์ดในตลาด หรือการ์ดของร้านตัวเอง (mine=1) แบ่งหน้าได้ด้วย limit/page
  app.get('/api/cards', async (req, res) => {
    const str = v => typeof v === 'string' && v ? v.slice(0, 100) : undefined;
    const mine = !!req.query.mine;
    if (mine && !req.user) return res.json([]);
    // ตลาดแสดงเฉพาะการ์ดของร้านที่พร้อมขาย ส่วน mine แสดงของบัญชีตนเองทุกสถานะร้าน
    const paged = req.query.limit !== undefined ? pageQuery(req.query, 40) : null;
    const { items, total } = await store.searchCards({ q: str(req.query.q), category: str(req.query.category), condition: str(req.query.condition), grading: str(req.query.grading), sort: str(req.query.sort), sellerId: mine ? req.user.id : undefined, readySellersOnly: !mine, ...(paged ? { skip: (paged.page - 1) * paged.limit, limit: paged.limit } : {}) });
    res.setHeader('X-Total-Count', String(total));
    res.json(items.map(publicCard));
  });
  // Whitelist editable fields so clients cannot change ownership or approval.
  app.get('/api/cards/:id', async (req, res) => {
    const card = await store.getCard(req.params.id);
    if (!card) throw fail(404, 'ไม่พบการ์ดนี้ อาจถูกลบออกจากร้านแล้ว');
    const seller = await store.getUser(card.sellerId);
    const sold = !!card.soldOrderId, sellerApproved = seller?.role === 'merchant' && seller.verification === 'approved';
    const { average, count } = await store.sellerReviews(card.sellerId, 0);
    res.json({ ...publicCard(card), merchantCode:seller?.merchantCode||'', sellerAvatar: seller?.avatar || '', sold, sellerApproved, purchasable: !sold && (sellerApproved || card.sellerId === SAMPLE_SELLER), sellerRating: { average, count } });
  });
  // แนะนำการ์ดที่ใกล้เคียง: ตัวละครเดียวกัน > เซ็ตเดียวกัน > ร้านเดียวกัน > ราคาใกล้กัน (เฉพาะที่ยังขายได้)
  app.get('/api/cards/:id/related', async (req, res) => {
    const card = await store.getCard(req.params.id);
    if (!card) throw fail(404, 'ไม่พบการ์ดนี้');
    const words = v => new Set(String(v || '').toLowerCase().split(/[\s,/·]+/).filter(w => w.length > 1));
    const characters = words(card.character), setName = String(card.set || '').split('·')[0].trim().toLowerCase();
    const { items } = await store.searchCards({ category: card.category, readySellersOnly: true, limit: 80 });
    const score = c => [...words(c.character)].filter(w => characters.has(w)).length * 4 + (setName && String(c.set || '').toLowerCase().startsWith(setName) ? 2 : 0) + (c.sellerId === card.sellerId ? 1 : 0) - Math.abs(Math.log((c.price || 1) / (card.price || 1))) / 3;
    const related = items.filter(c => c.id !== card.id).map(c => ({ c, s: score(c) })).sort((a, b) => b.s - a.s).slice(0, 6).map(({ c }) => ({ id: c.id, name: c.name, image: c.image, price: c.price, category: c.category, set: c.set, rarity: c.rarity, character: c.character || '' }));
    res.json(related);
  });
  // ตรวจฟิลด์และเจ้าของรูป แล้วเลือกเฉพาะข้อมูลที่ผู้ขายแก้ไขได้
  async function cardInput(body, ownerId) {
    for (const field of ['name', 'set', 'rarity', 'condition', 'image', 'category']) if (typeof body[field] !== 'string' || !body[field].trim() || body[field].length > 500) throw fail(400, 'กรอกข้อมูลการ์ดให้ครบ');
    if (!categories.includes(body.category) || !['Near Mint', 'Excellent', 'Played'].includes(body.condition) || !Number.isSafeInteger(body.price) || body.price < 100 || body.price > 100000000) throw fail(400, 'หมวดหมู่ สภาพ หรือราคาไม่ถูกต้อง');
    if (!/^https:\/\/[^\s]+$/.test(body.image) && !/^\/art\/[a-z]+\.svg$/.test(body.image) && !/^\/api\/uploads\/[a-f0-9-]{36}$/.test(body.image)) throw fail(400, 'รูปภาพต้องเป็นลิงก์ HTTPS');
    const extra = {};
    if (Object.hasOwn(body, 'grading')) {
      const g = body.grading;
      if (g === null) extra.grading = null;
      else {
        if (!g || typeof g !== 'object' || !gradingCompanies.includes(g.company) || typeof g.grade !== 'string' || !gradesFor(g.company).includes(g.grade) || typeof g.certificate !== 'string' || !/^[A-Za-z0-9-]{3,64}$/.test(g.certificate.trim())) throw fail(400, 'เลือกบริษัท คะแนนเกรด และเลขใบรับรองให้ถูกต้อง');
        extra.grading = { company: g.company, grade: g.grade, certificate: g.certificate.trim() };
      }
    }
    for (const [key, max] of Object.entries({ character: 160, description: 5000, language: 80, conditionNotes: 2000, shippingNotes: 2000, backImage: 500, detailImage: 500 })) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'string' || body[key].length > max) throw fail(400, `ข้อมูล ${key} ยาวเกินกำหนดหรือรูปแบบไม่ถูกต้อง`);
      extra[key] = body[key].trim();
    }
    if (extra.backImage && !/^https:\/\/[^\s]+$/.test(extra.backImage) && !/^\/art\/[a-z]+\.svg$/.test(extra.backImage) && !/^\/api\/uploads\/[a-f0-9-]{36}$/.test(extra.backImage)) throw fail(400, 'รูปด้านหลังต้องเป็นลิงก์ HTTPS');
    if (extra.detailImage && !/^https:\/\/[^\s]+$/.test(extra.detailImage) && !/^\/art\/[a-z]+\.svg$/.test(extra.detailImage) && !/^\/api\/uploads\/[a-f0-9-]{36}$/.test(extra.detailImage)) throw fail(400, 'รูปตำหนิต้องเป็นภาพอัปโหลดหรือลิงก์ HTTPS');
    for (const url of [body.image, extra.backImage, extra.detailImage]) {
      if (url?.startsWith('/api/uploads/')) {
        const upload = await store.getUpload(url.split('/').pop());
        if (!upload || upload.ownerId !== ownerId) throw fail(403, 'ใช้ได้เฉพาะรูปที่คุณอัปโหลด');
      }
    }
    return { ...Object.fromEntries(['name', 'set', 'rarity', 'condition', 'image', 'category', 'price'].map(k => [k, body[k]])), ...extra };
  }
  // พ่อค้าที่อนุมัติแล้วลงขายการ์ดใหม่
  app.post('/api/cards', auth, merchant, async (req, res) => {
    const card = { ...await cardInput(req.body, req.user.id), id: randomUUID(), sellerId: req.user.id, sellerName: req.user.application?.shopName || req.user.name, createdAt: new Date().toISOString() };
    await store.addCard(card); res.status(201).json(card);
  });
  // เจ้าของแก้ไขการ์ดที่ยังไม่ขาย
  app.put('/api/cards/:id', auth, merchant, async (req, res) => {
    const card = await store.getCard(req.params.id);
    if (!card) throw fail(404, 'ไม่พบการ์ด');
    if (card.sellerId !== req.user.id) throw fail(403, 'แก้ไขได้เฉพาะการ์ดของคุณ');
    if (card.soldOrderId) throw fail(409, 'การ์ดที่ขายแล้วไม่สามารถแก้ไขได้');
    // เขียนพร้อมเงื่อนไข "ยังไม่ขาย" ในคำสั่งเดียว หากมีผู้ซื้อตัดหน้า การแก้ไขจะไม่ถูกบันทึก
    const updated = await store.updateUnsoldCard(card.id, req.user.id, await cardInput(req.body, req.user.id));
    if (!updated) throw fail(409, 'การ์ดที่ขายแล้วไม่สามารถแก้ไขได้');
    res.json(publicCard(updated));
  });
  // เจ้าของหรือแอดมินลบการ์ดที่ยังไม่ขาย
  app.delete('/api/cards/:id', auth, async (req, res) => {
    const card = await store.getCard(req.params.id);
    if (!card) throw fail(404, 'ไม่พบการ์ด');
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && !(req.user.role === 'merchant' && req.user.verification === 'approved' && card.sellerId === req.user.id)) throw fail(403, 'ไม่มีสิทธิ์ลบการ์ดนี้');
    // ลบพร้อมเงื่อนไข "ยังไม่ขาย" ในคำสั่งเดียวกับการตรวจ
    if (card.soldOrderId || !(await store.deleteUnsoldCard(card.id, isAdmin ? null : req.user.id))) throw fail(409, 'การ์ดที่ขายแล้วไม่สามารถลบได้');
    res.json({ ok: true });
  });
  // รูปสินค้าสาธารณะ: เฉพาะพ่อค้าที่อนุมัติอัปโหลดได้ ตรวจชนิดและขนาดก่อนเก็บ
  app.post('/api/uploads', auth, merchant, async (req, res) => {
    const data = req.body.data;
    if (typeof data !== 'string' || data.length > 2800000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw fail(400, 'เลือก PNG/JPEG ไม่เกิน 2 MB');
    const bytes = Buffer.from(data.split(',')[1], 'base64');
    const mime = data.slice(5, data.indexOf(';'));
    if (bytes.length > 2097152 || !(mime === 'image/png' ? bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' : bytes.subarray(0,3).toString('hex') === 'ffd8ff')) throw fail(400, 'ชนิดไฟล์ไม่ตรงกับข้อมูลภาพ กรุณาเลือกภาพใหม่เพื่อให้ระบบแปลงรูปก่อนอัปโหลด');
    const id = randomUUID();
    await store.addUpload({ id, ownerId: req.user.id, mime, bytes });
    res.status(201).json({ url: `/api/uploads/${id}` });
  });
  // OCR รับเฉพาะรูปที่ผู้ขายอัปโหลดเอง ไม่ดึง URL ภายนอกและไม่อ่านหลักฐานส่วนตัว
  app.post('/api/uploads/:id/recognize', auth, merchant, async (req, res) => {
    const upload = await store.getUpload(req.params.id);
    if (!upload || upload.ownerId !== req.user.id) throw fail(403, 'อ่านได้เฉพาะรูปสินค้าที่คุณอัปโหลด');
    const bytes = Buffer.isBuffer(upload.bytes) ? upload.bytes : Buffer.from(upload.bytes.buffer);
    res.json(await readCardImage(bytes));
  });
  // ส่งไฟล์รูปสินค้าสาธารณะตามรหัส
  app.get('/api/uploads/:id', async (req, res) => {
    const upload = await store.getUpload(req.params.id);
    if (!upload) throw fail(404, 'ไม่พบรูปภาพ');
    res.type(upload.mime).send(Buffer.isBuffer(upload.bytes) ? upload.bytes : Buffer.from(upload.bytes.buffer));
  });
  // พ่อค้าดูสถานะและข้อมูลยืนยันร้านของตัวเอง (รวมภาพหลักฐาน)
  app.get('/api/merchant/application', auth, async (req, res) => {
    if (req.user.role !== 'merchant') throw fail(403, 'สำหรับพ่อค้าเท่านั้น');
    res.json({ verification: req.user.verification, application: await store.getApplication(req.user.id) });
  });
  // พ่อค้าส่ง/แก้ข้อมูลยืนยันร้านพร้อมภาพหลักฐาน แล้วรอแอดมินตรวจ
  app.post('/api/merchant/application', auth, async (req, res) => {
    if (req.user.role !== 'merchant') throw fail(403, 'สำหรับพ่อค้าเท่านั้น');
    if (req.user.verification === 'approved') throw fail(409, 'บัญชีได้รับอนุมัติแล้ว');
    const fields = {};
    for (const [key, max] of Object.entries({ fullName: 120, shopName: 100, phone: 30, address: 600 })) {
      if (typeof req.body[key] !== 'string' || !req.body[key].trim() || req.body[key].length > max) throw fail(400, 'กรอกข้อมูลยืนยันให้ครบและไม่เกินกำหนด');
      fields[key] = req.body[key].trim();
    }
    fields.phone = thaiPhone(fields.phone);
    if (!fields.phone) throw fail(400, 'เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0');
    const evidence = req.body.evidence;
    if (typeof evidence !== 'string' || evidence.length > 2800000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(evidence)) throw fail(400, 'แนบภาพ PNG หรือ JPEG ไม่เกิน 2 MB');
    const bytes = Buffer.from(evidence.split(',')[1], 'base64');
    const png = evidence.startsWith('data:image/png') && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const jpeg = evidence.startsWith('data:image/jpeg') && bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
    if ((!png && !jpeg) || bytes.length > 2 * 1024 * 1024) throw fail(400, 'ไฟล์ภาพไม่ถูกต้อง');
    const application = { ...fields, evidence, submittedAt: new Date().toISOString(), reviewNote: '', reviewedAt: null };
    await store.updateUser(req.user.id, { application, verification: 'pending' });
    res.json({ verification: 'pending', application });
  });
  // รายการพ่อค้าไม่รวมภาพหลักฐาน แอดมินโหลดภาพทีละรายเมื่อเปิดดู
  app.get('/api/admin/merchants', auth, admin, async (req, res) => res.json((await store.merchants()).map(u => { const { evidence, ...application } = u.application || {}; return { ...publicUser(u), application: u.application ? application : null }; })));
  // แอดมินโหลดภาพหลักฐานของพ่อค้าทีละราย
  app.get('/api/admin/merchants/:id/evidence', auth, admin, async (req, res) => {
    const application = await store.getApplication(req.params.id);
    if (!application?.evidence) throw fail(404, 'ไม่พบหลักฐาน');
    res.json({ evidence: application.evidence });
  });
  // แอดมินอนุมัติหรือขอแก้ไข/ระงับร้าน (ปฏิเสธต้องมีเหตุผล)
  app.patch('/api/admin/merchants/:id', auth, admin, async (req, res) => {
    if (!['approved', 'rejected'].includes(req.body.verification)) throw fail(400, 'สถานะไม่ถูกต้อง');
    const found = await store.getUser(req.params.id), user = found?.role === 'merchant' ? found : null;
    if (!user) throw fail(404, 'ไม่พบพ่อค้า');
    if (req.body.verification === 'approved' && !user.application?.submittedAt) throw fail(409, 'พ่อค้าต้องส่งข้อมูลและหลักฐานก่อนอนุมัติ');
    const note = req.body.reviewNote || '';
    if (typeof note !== 'string' || note.length > 1000 || (req.body.verification === 'rejected' && !note.trim())) throw fail(400, 'กรุณาระบุเหตุผลไม่เกิน 1,000 ตัวอักษร');
    const review = { reviewNote: note.trim(), reviewedAt: new Date().toISOString(), reviewedBy: req.user.id };
    await store.updateUser(user.id, { verification: req.body.verification, ...Object.fromEntries(Object.entries(review).map(([k, v]) => [`application.${k}`, v])) });
    res.json(publicUser({ ...user, verification: req.body.verification, application: { ...user.application, ...review } }));
  });
  // API ที่ไม่มีอยู่จริงตอบ 404 เป็น JSON
  app.use('/api', (req, res) => res.status(404).json({ message: 'ไม่พบ API' }));
  // ส่งไฟล์หน้าเว็บจากโฟลเดอร์ public
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  // ตัวจัดการ error กลาง: ส่งข้อความที่ปลอดภัยให้ผู้ใช้ และ log รายละเอียดฝั่งเซิร์ฟเวอร์
  app.use((error, req, res, next) => { console.error(error.message); res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.status ? error.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่' }); });
  return app;
}
