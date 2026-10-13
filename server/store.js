// รวมการอ่านเขียนข้อมูล เพื่อให้ API ใช้ได้ทั้ง MongoDB และหน่วยความจำ
import mongoose from 'mongoose';
import { User, Card, Session, CommerceState, Upload, Report, ReceiptProof, Counter, Order, LedgerEntry, Cart, CommerceRequest, Review } from './models.js';
import { seedCards } from './seed.js';

const SAMPLE_SELLER = 'sample-merchant';
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ตัดฟิลด์ภายในของ MongoDB (_id, __v) ก่อนส่งต่อ
const clean = doc => { if (!doc) return doc; const { _id, __v, ...rest } = doc; return rest; };
// ไม่ดึงรหัสผ่านและภาพหลักฐานยืนยันตัวตนในงานทั่วไป
const SAFE_USER = '-_id -__v -passwordHash -application.evidence';

// เงื่อนไขค้นหาการ์ดที่ยังไม่ขาย ใช้ร่วมกันระหว่างตลาด ร้านค้า และสินค้าของฉัน
function cardFilter({ q, category, condition, grading, sellerId }) {
  const filter = { soldOrderId: null };
  if (q) { const re = new RegExp(escapeRegex(q), 'i'); filter.$or = ['name', 'set', 'category', 'character'].map(k => ({ [k]: re })); }
  if (category) filter.category = category;
  if (condition) filter.condition = condition;
  if (grading === 'raw') filter.grading = null;
  else if (grading === 'graded') filter.grading = { $ne: null };
  else if (grading) filter['grading.company'] = grading;
  if (sellerId) filter.sellerId = sellerId;
  return filter;
}
const cardSort = sort => sort === 'price-asc' ? { price: 1 } : sort === 'price-desc' ? { price: -1 } : { createdAt: -1 };
const page = ({ skip = 0, limit = 20 } = {}) => ({ skip, limit });

// A small repository layer keeps routes identical in demo and MongoDB modes.
export async function createStore(uri) {
  if (uri) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Card.init(), Session.init(), Upload.init(), Report.init(), Order.init(), LedgerEntry.init(), Cart.init(), CommerceRequest.init(), Review.init()]);
    // ตัวนับ atomic ทำให้สมัครพร้อมกันได้รหัสไม่ซ้ำ และเติมให้พ่อค้าเก่าเพียงครั้งเดียว
    const existing=await User.find({merchantCode:{$exists:true}}).select('merchantCode').lean();
    const maximum=Math.max(0,...existing.map(u=>Number(u.merchantCode.replace('SELL-',''))||0));
    await Counter.updateOne({_id:'merchant'},{$max:{value:maximum}},{upsert:true});
    // ออกรหัสพ่อค้าถัดไปแบบ atomic เช่น SELL-000012
    const nextCode=async()=>{const counter=await Counter.findByIdAndUpdate('merchant',{$inc:{value:1}},{new:true});return `SELL-${String(counter.value).padStart(6,'0')}`;};
    for(const u of await User.find({role:'merchant',merchantCode:{$exists:false}}).sort({createdAt:1,_id:1}).lean()){
      // ใช้ collection เพื่อเติมฟิลด์ immutable ที่ยังไม่มี โดยไม่เปลี่ยนรหัสที่ถูกกำหนดแล้ว
      await User.collection.updateOne({id:u.id,merchantCode:{$exists:false}},{$set:{merchantCode:await nextCode()}});
    }
    await User.updateMany({ balance: { $exists: false } }, { $set: { balance: 0 } });
    await Card.updateMany({ soldOrderId: { $exists: false } }, { $set: { soldOrderId: null } });
    await migrateLegacyCommerce();
    // ไม่เติมสินค้าตัวอย่างอัตโนมัติ ใช้ `npm run seed:demo` เมื่อต้องการข้อมูลสาธิต
    const approvedSellerIds = async () => [SAMPLE_SELLER, ...await User.find({ role: 'merchant', verification: 'approved' }).distinct('id')];
    // แปลงเงื่อนไขค้นหาคำสั่งซื้อเป็น query ของ MongoDB (รวมค้นด้วยรหัสพ่อค้า)
    const orderQuery = async ({ buyerId, sellerId, status, q }) => {
      const filter = {};
      if (buyerId) filter.buyerId = buyerId;
      if (sellerId) filter.sellerId = sellerId;
      if (status) filter.status = status;
      if (q) {
        const re = new RegExp(escapeRegex(q), 'i');
        const sellers = await User.find({ merchantCode: re }).distinct('id');
        filter.$or = [{ id: new RegExp('^' + escapeRegex(q), 'i') }, { 'card.name': re }, { 'card.sellerName': re }, { tracking: re }, ...(sellers.length ? [{ sellerId: { $in: sellers } }] : [])];
      }
      return filter;
    };
    return {
      mode: 'mongodb', users: () => User.find().lean(), cards: () => Card.find().lean(),
      getUser: id => User.findOne({ id }).select(SAFE_USER).lean(),
      getUserByEmail: email => User.findOne({ email }).select('-_id -__v -application.evidence').lean(),
      usersByIds: ids => User.find({ id: { $in: [...new Set(ids)] } }).select('-_id id name role verification merchantCode').lean(),
      merchants: () => User.find({ role: 'merchant' }).select(SAFE_USER).sort({ createdAt: -1 }).lean(),
      getApplication: async id => (await User.findOne({ id }).select('application').lean())?.application || null,
      updateUser: async (id, fields) => { await User.updateOne({ id }, { $set: fields }); },
      reports: () => Report.find().sort({createdAt:-1}).lean(),
      getReport: id => Report.findOne({ id }).lean(),
      addReceiptProof: p => ReceiptProof.create(p),
      getReceiptProof: id => ReceiptProof.findOne({id}).lean(),
      deleteReceiptProof: id => ReceiptProof.deleteOne({id}),
      addReport: r => Report.create(r),
      reviewReport: (id, fields) => Report.updateOne({id},{$set:fields}),
      addUpload: data => Upload.create(data),
      getUpload: id => Upload.findOne({ id }).lean(),
      addUser: async u => { if(u.role==='merchant')u.merchantCode=await nextCode();else delete u.merchantCode;await User.create(u); },
      saveProfile: async (id, fields) => { await User.updateOne({ id }, { $set: fields }); },
      getSession: token => Session.findOne({ token }).lean(),
      setSession: s => Session.create(s),
      deleteSession: token => Session.deleteOne({ token }),
      // การ์ด: ทุกการเปลี่ยนแปลงหลังวางขายตรวจ soldOrderId ในคำสั่งเดียวกับการเขียน
      getCard: async id => clean(await Card.findOne({ id }).lean()),
      cardsByIds: async ids => (await Card.find({ id: { $in: ids } }).lean()).map(clean),
      searchCards: async ({ readySellersOnly, skip = 0, limit = 0, sort, ...criteria }) => {
        const filter = cardFilter(criteria);
        // ตลาดซ่อนสินค้าของร้านที่ถูกระงับ/ยังไม่อนุมัติ (ใช้คู่กับการค้นหาทั้งตลาดเท่านั้น)
        if (readySellersOnly) filter.sellerId = { $in: await approvedSellerIds() };
        const [items, total] = await Promise.all([Card.find(filter).sort(cardSort(sort)).skip(skip).limit(limit).lean(), Card.countDocuments(filter)]);
        return { items: items.map(clean), total };
      },
      addCard: async c => { await Card.create({ ...c, soldOrderId: null }); },
      updateUnsoldCard: async (id, sellerId, fields) => clean(await Card.findOneAndUpdate({ id, sellerId, soldOrderId: null }, { $set: fields }, { new: true }).lean()),
      deleteUnsoldCard: async (id, sellerId) => (await Card.deleteOne({ id, soldOrderId: null, ...(sellerId ? { sellerId } : {}) })).deletedCount === 1,
      claimCard: async (id, price, orderId) => clean(await Card.findOneAndUpdate({ id, price, soldOrderId: null }, { $set: { soldOrderId: orderId } }, { new: true }).lean()),
      releaseCard: async (id, orderId) => { await Card.updateOne({ id, soldOrderId: orderId }, { $set: { soldOrderId: null } }); },
      // เครดิต: เงื่อนไขยอดอยู่ในคำสั่ง update เดียว จึงไม่ติดลบแม้มีคำขอพร้อมกัน
      adjustBalance: async (id, delta, { max } = {}) => {
        const condition = delta < 0 ? { $gte: -delta } : max !== undefined ? { $lte: max - delta } : undefined;
        const user = await User.findOneAndUpdate({ id, ...(condition ? { balance: condition } : {}) }, { $inc: { balance: delta } }, { new: true }).select('balance').lean();
        return user ? user.balance : null;
      },
      addLedger: async entries => { await LedgerEntry.insertMany(entries); },
      ledger: async (userId, limit) => (await LedgerEntry.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean()).map(clean),
      addOrders: async orders => { await Order.insertMany(orders); },
      getOrder: async id => clean(await Order.findOne({ id }).lean()),
      updateOrder: async (id, condition, fields) => clean(await Order.findOneAndUpdate({ ...condition, id }, { $set: fields }, { new: true }).lean()),
      listOrders: async (criteria, options) => {
        const { skip, limit } = page(options);
        const filter = await orderQuery(criteria), base = await orderQuery({ ...criteria, status: undefined, q: undefined });
        const [items, total, groups] = await Promise.all([Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments(filter), Order.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }])]);
        return { items: items.map(clean), total, counts: Object.fromEntries(groups.map(g => [g._id, g.n])) };
      },
      countOrders: filter => Order.countDocuments(filter),
      overdueOrders: async cutoff => (await Order.find({ status: 'shipped', shippedAt: { $lte: cutoff } }).limit(100).lean()).map(clean),
      // Idempotency: _id ซ้ำหมายถึงมีคำขอเดียวกันอยู่แล้ว
      beginRequest: async (id, payload) => {
        try { await CommerceRequest.create({ _id: id, payload, status: 'pending' }); return null; }
        catch (e) { if (e.code !== 11000) throw e; return await CommerceRequest.findById(id).lean() || { payload, status: 'pending' }; }
      },
      finishRequest: async (id, result) => { await CommerceRequest.updateOne({ _id: id }, { $set: { status: 'done', result } }); },
      abortRequest: async id => { await CommerceRequest.deleteOne({ _id: id, status: 'pending' }); },
      addReview: r => Review.create(r),
      reviewsByOrderIds: async ids => (await Review.find({ orderId: { $in: ids } }).lean()).map(clean),
      sellerReviews: async (sellerId, limit) => {
        const [items, [summary]] = await Promise.all([limit ? Review.find({ sellerId }).sort({ createdAt: -1 }).limit(limit).select('-_id -__v -buyerId').lean() : [],Review.aggregate([{ $match: { sellerId } }, { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }])]);
        return { items, average: summary ? Math.round(summary.average * 10) / 10 : 0, count: summary?.count || 0 };
      },
      countUnreviewed: async buyerId => { const ids = await Order.find({ buyerId, status: 'completed' }).limit(500).distinct('id'); return ids.length - await Review.countDocuments({ orderId: { $in: ids } }); },
      countPendingApplications: () => User.countDocuments({ role: 'merchant', verification: 'pending', 'application.submittedAt': { $exists: true, $ne: null } }),
      countReports: status => Report.countDocuments({ status }),
      getCart: async userId => (await Cart.findById(userId).lean())?.items || [],
      addCart: async (userId, cardId, max) => {
        const doc = await Cart.findOneAndUpdate({ _id: userId, [`items.${max - 1}`]: { $exists: false } }, { $addToSet: { items: cardId } }, { upsert: true, new: true }).lean().catch(e => { if (e.code === 11000) return null; throw e; });
        if (doc) return doc.items.length;
        const items = (await Cart.findById(userId).lean())?.items || [];
        return items.includes(cardId) ? items.length : null;
      },
      removeCart: async (userId, ids) => (await Cart.findOneAndUpdate({ _id: userId }, { $pullAll: { items: ids } }, { new: true }).lean())?.items.length || 0
    };
  }
  // โหมดสาธิตในหน่วยความจำ: ทุกฟังก์ชันตรวจและเขียนในจังหวะเดียว (ไม่มี await คั่น) จึง atomic เช่นเดียวกับ MongoDB
  const users = [], cards = structuredClone(seedCards).map(c => ({ ...c, soldOrderId: null })), uploads = new Map(), reports = [], proofs = new Map();let merchantSequence=0;
  const orders = [], entries = [], requests = new Map(), carts = new Map(), reviews = [];
  // คัดลอกข้อมูลก่อนคืนค่า เพื่อไม่ให้โค้ดภายนอกแก้ข้อมูลในหน่วยความจำโดยตรง
  const copy = value => value && structuredClone(value);
  // คืนสำเนาการ์ดพร้อมค่าเริ่มต้นของ soldOrderId
  const publicCard = c => { if (!c) return c; const card = copy(c); card.soldOrderId ??= null; return card; };
  // ชุดรหัสร้านที่พร้อมขายในโหมดหน่วยความจำ
  const approved = () => new Set([SAMPLE_SELLER, ...users.filter(u => u.role === 'merchant' && u.verification === 'approved').map(u => u.id)]);
  // เงื่อนไขค้นหาการ์ดในโหมดหน่วยความจำ (เทียบเท่า cardFilter ของ MongoDB)
  const matchesCard = (c, { q, category, condition, grading, sellerId }) => {
    const text = q?.toLowerCase();
    return !c.soldOrderId && (!text || ['name', 'set', 'category', 'character'].some(k => String(c[k] || '').toLowerCase().includes(text))) && (!category || c.category === category) && (!condition || c.condition === condition)
      && (!grading || (grading === 'raw' ? !c.grading : grading === 'graded' ? !!c.grading : c.grading?.company === grading)) && (!sellerId || c.sellerId === sellerId);
  };
  // เงื่อนไขค้นหาคำสั่งซื้อในโหมดหน่วยความจำ
  const matchesOrder = (o, { buyerId, sellerId, status, q }) => {
    if ((buyerId && o.buyerId !== buyerId) || (sellerId && o.sellerId !== sellerId) || (status && o.status !== status)) return false;
    if (!q) return true;
    const text = q.toLowerCase(), code = users.find(u => u.id === o.sellerId)?.merchantCode || '';
    return o.id.toLowerCase().startsWith(text) || [o.card.name, o.card.sellerName, o.tracking, code].some(v => String(v || '').toLowerCase().includes(text));
  };
  // แก้ฟิลด์ตาม path แบบ "application.reviewNote" เหมือน $set ของ MongoDB
  const setPath = (target, fields) => { for (const [path, value] of Object.entries(fields)) { const keys = path.split('.'), last = keys.pop(); let node = target; for (const k of keys) node = node[k] ??= {}; node[last] = value; } };
  return { mode: 'demo', users: async () => users, cards: async () => cards,
    getUser: async id => users.find(u => u.id === id) || null,
    getUserByEmail: async email => users.find(u => u.email === email) || null,
    usersByIds: async ids => users.filter(u => ids.includes(u.id)),
    merchants: async () => users.filter(u => u.role === 'merchant').reverse(),
    getApplication: async id => users.find(u => u.id === id)?.application || null,
    updateUser: async (id, fields) => { const user = users.find(u => u.id === id); if (user) setPath(user, fields); },
    addReceiptProof: async p => proofs.set(p.id,p), getReceiptProof: async id => proofs.get(id), deleteReceiptProof: async id => proofs.delete(id),
    reports: async () => [...reports].reverse(),
    getReport: async id => reports.find(r => r.id === id) || null,
    addReport: async r => {if(reports.some(x=>x.cardId===r.cardId&&x.reporterId===r.reporterId))throw Object.assign(new Error('duplicate'),{code:11000});reports.push(r);},
    reviewReport: async (id,fields) => Object.assign(reports.find(r=>r.id===id),fields),
    saveProfile: async (id, fields) => { Object.assign(users.find(u => u.id === id), fields); },
    addUpload: async data => uploads.set(data.id, data), getUpload: async id => uploads.get(id),
    addUser: async u => { if(u.role==='merchant')u.merchantCode=`SELL-${String(++merchantSequence).padStart(6,'0')}`;else delete u.merchantCode;u.balance??=0;users.push(u); },
    getCard: async id => publicCard(cards.find(c => c.id === id)),
    cardsByIds: async ids => cards.filter(c => ids.includes(c.id)).map(publicCard),
    searchCards: async ({ readySellersOnly, skip = 0, limit = 0, sort, ...criteria }) => {
      const ready = readySellersOnly && approved();
      const found = cards.filter(c => matchesCard(c, criteria) && (!ready || ready.has(c.sellerId)));
      if (sort === 'price-asc') found.sort((a, b) => a.price - b.price);
      else if (sort === 'price-desc') found.sort((a, b) => b.price - a.price);
      else found.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return { items: found.slice(skip, limit ? skip + limit : undefined).map(publicCard), total: found.length };
    },
    addCard: async c => { cards.push({ ...c, soldOrderId: null }); },
    updateUnsoldCard: async (id, sellerId, fields) => { const card = cards.find(c => c.id === id && c.sellerId === sellerId && !c.soldOrderId); if (!card) return null; Object.assign(card, fields); return publicCard(card); },
    deleteUnsoldCard: async (id, sellerId) => { const i = cards.findIndex(c => c.id === id && !c.soldOrderId && (!sellerId || c.sellerId === sellerId)); if (i < 0) return false; cards.splice(i, 1); return true; },
    claimCard: async (id, price, orderId) => { const card = cards.find(c => c.id === id && c.price === price && !c.soldOrderId); if (!card) return null; card.soldOrderId = orderId; return publicCard(card); },
    releaseCard: async (id, orderId) => { const card = cards.find(c => c.id === id && c.soldOrderId === orderId); if (card) card.soldOrderId = null; },
    adjustBalance: async (id, delta, { max } = {}) => {
      const user = users.find(u => u.id === id);
      if (!user) return null;
      const next = (user.balance || 0) + delta;
      if (next < 0 || (max !== undefined && delta > 0 && next > max)) return null;
      user.balance = next; return next;
    },
    addLedger: async list => { entries.push(...copy(list)); },
    ledger: async (userId, limit) => entries.filter(e => e.userId === userId).reverse().slice(0, limit).map(copy),
    addOrders: async list => { orders.push(...copy(list)); },
    getOrder: async id => copy(orders.find(o => o.id === id)) || null,
    updateOrder: async (id, condition, fields) => {
      const order = orders.find(o => o.id === id && Object.entries(condition).every(([k, v]) => o[k] === v));
      if (!order) return null;
      Object.assign(order, copy(fields)); return copy(order);
    },
    listOrders: async (criteria, options) => {
      const { skip, limit } = page(options);
      const base = orders.filter(o => matchesOrder(o, { ...criteria, status: undefined, q: undefined })).reverse(), found = base.filter(o => matchesOrder(o, criteria));
      const counts = {}; for (const o of base) counts[o.status] = (counts[o.status] || 0) + 1;
      return { items: found.slice(skip, skip + limit).map(copy), total: found.length, counts };
    },
    countOrders: async filter => orders.filter(o => matchesOrder(o, filter)).length,
    overdueOrders: async cutoff => orders.filter(o => o.status === 'shipped' && o.shippedAt && o.shippedAt <= cutoff).slice(0, 100).map(copy),
    beginRequest: async (id, payload) => { const existing = requests.get(id); if (existing) return existing; requests.set(id, { payload, status: 'pending' }); return null; },
    finishRequest: async (id, result) => { requests.set(id, { ...requests.get(id), status: 'done', result: copy(result) }); },
    abortRequest: async id => { if (requests.get(id)?.status === 'pending') requests.delete(id); },
    addReview: async r => { if (reviews.some(x => x.orderId === r.orderId)) throw Object.assign(new Error('duplicate'), { code: 11000 }); reviews.push(copy(r)); },
    reviewsByOrderIds: async ids => reviews.filter(r => ids.includes(r.orderId)).map(copy),
    sellerReviews: async (sellerId, limit) => {
      const mine = reviews.filter(r => r.sellerId === sellerId), sum = mine.reduce((a, r) => a + r.rating, 0);
      return { items: mine.slice().reverse().slice(0, limit).map(({ buyerId, ...r }) => copy(r)), average: mine.length ? Math.round(sum / mine.length * 10) / 10 : 0, count: mine.length };
    },
    countUnreviewed: async buyerId => orders.filter(o => o.buyerId === buyerId && o.status === 'completed' && !reviews.some(r => r.orderId === o.id)).length,
    countPendingApplications: async () => users.filter(u => u.role === 'merchant' && u.verification === 'pending' && u.application?.submittedAt).length,
    countReports: async status => reports.filter(r => r.status === status).length,
    getCart: async userId => [...(carts.get(userId) || [])],
    addCart: async (userId, cardId, max) => {
      const list = carts.get(userId) || [];
      if (list.includes(cardId)) return list.length;
      if (list.length >= max) return null;
      list.push(cardId); carts.set(userId, list); return list.length;
    },
    removeCart: async (userId, ids) => { const list = (carts.get(userId) || []).filter(id => !ids.includes(id)); carts.set(userId, list); return list.length; }
  };
}

// ย้ายข้อมูลจากเอกสาร CommerceState เดิม (รุ่นก่อนแยก collection) ทำซ้ำได้โดยไม่สร้างข้อมูลซ้ำ
async function migrateLegacyCommerce() {
  const legacy = await CommerceState.findById('simulation').lean();
  const data = legacy?.data;
  if (!data || legacy.migratedAt) return;
  const upserts = (list, key = 'id') => list.map(doc => ({ updateOne: { filter: { [key]: doc[key] }, update: { $setOnInsert: doc }, upsert: true } }));
  const orders = (data.orders || []).map(o => ({ ...o, shippedAt: o.shippedAt || (['shipped', 'completed'].includes(o.status) ? o.updatedAt : undefined) }));
  if (orders.length) await Order.bulkWrite(upserts(orders));
  if (data.entries?.length) await LedgerEntry.bulkWrite(upserts(data.entries));
  for (const [id, balance] of Object.entries(data.balances || {})) await User.updateOne({ id }, { $set: { balance } });
  for (const [userId, items] of Object.entries(data.carts || {})) await Cart.updateOne({ _id: userId }, { $setOnInsert: { items } }, { upsert: true });
  for (const [id, request] of data.requests || []) await CommerceRequest.updateOne({ _id: id }, { $setOnInsert: { payload: request.payload, status: 'done', result: request.result } }, { upsert: true });
  for (const o of orders.filter(o => o.status !== 'cancelled')) await Card.updateOne({ id: o.card.id, soldOrderId: null }, { $set: { soldOrderId: o.id } });
  await CommerceState.updateOne({ _id: 'simulation' }, { $set: { migratedAt: new Date() } });
  console.log(`Migrated legacy commerce data: ${orders.length} orders, ${data.entries?.length || 0} ledger entries`);
}
