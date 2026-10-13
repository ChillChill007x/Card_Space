// กำหนด schema ของสมาชิก การ์ด session รูปสินค้า และ ledger เครดิตจำลอง
import mongoose from 'mongoose';

// MongoDB collections; prices and balances use integer satang.
const userSchema = new mongoose.Schema({
  id: { type: String, unique: true }, name: String,
  merchantCode: { type:String, unique:true, sparse:true, immutable:true },
  email: { type: String, unique: true }, passwordHash: String,
  role: { type: String, enum: ['admin', 'merchant', 'customer'], default: 'customer' },
  verification: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
  balance: { type: Number, default: 0 },
  avatar: { type: String, default: '' },
  shippingAddress: { type: new mongoose.Schema({ recipient: String, phone: String, address: String }, { _id: false }), default: null },
  application: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });
const cardSchema = new mongoose.Schema({
  id: { type: String, unique: true }, name: String, category: String, set: String,
  rarity: String, condition: String, price: Number, image: String,
  character: { type:String, default:'' },
  description: { type: String, default: '' }, language: { type: String, default: '' },
  conditionNotes: { type: String, default: '' }, shippingNotes: { type: String, default: '' },
  backImage: { type: String, default: '' },
  detailImage: { type: String, default: '' },
  grading: { type: new mongoose.Schema({ company: { type: String, enum: ['PSA', 'BGS', 'CGC'] }, grade: String, certificate: String }, { _id: false }), default: null },
  sellerId: String, sellerName: String, createdAt: String,
  // ผูกการ์ดกับคำสั่งซื้อที่ยังไม่ยกเลิก การซื้อ/แก้ไข/ลบใช้เงื่อนไขนี้ในคำสั่งเดียวกันกับเอกสาร
  soldOrderId: { type: String, default: null }
});
cardSchema.index({ soldOrderId: 1, sellerId: 1, createdAt: -1 });
export const User = mongoose.model('User', userSchema);
export const Counter = mongoose.model('Counter',new mongoose.Schema({_id:String,value:Number}));
// รายงานเก็บภาพรวมชื่อสินค้า แม้รายการเดิมถูกลบ และไม่เปิดชื่อผู้แจ้งให้ร้านค้า
const reportSchema = new mongoose.Schema({id:{type:String,unique:true},cardId:String,cardName:String,sellerId:String,reporterId:String,reason:String,details:String,status:{type:String,default:'pending'},reviewNote:{type:String,default:''},reviewedBy:String,createdAt:String,updatedAt:String});
reportSchema.index({cardId:1,reporterId:1},{unique:true});
export const Report = mongoose.model('Report',reportSchema);
export const ReceiptProof = mongoose.model('ReceiptProof',new mongoose.Schema({id:{type:String,unique:true},mime:String,bytes:Buffer}));
export const Card = mongoose.model('Card', cardSchema);
// รูปแบบเดิมที่เก็บทุกธุรกรรมในเอกสารเดียว ใช้อ่านเพื่อย้ายข้อมูลครั้งแรกเท่านั้น
export const CommerceState = mongoose.model('CommerceState', new mongoose.Schema({
  _id: String, version: { type: Number, default: 0 }, data: { type: mongoose.Schema.Types.Mixed, default: {} }, migratedAt: Date
}));
// คำสั่งซื้อและรายการเครดิตแยกเป็นเอกสารละรายการ จำนวนเงินทุกจุดเป็นสตางค์
const orderSchema = new mongoose.Schema({
  id: { type: String, unique: true }, buyerId: String, sellerId: String, status: String,
  card: mongoose.Schema.Types.Mixed, total: Number, address: String, tracking: { type: String, default: '' },
  shipmentProofId: String, receiptProofId: String, dispute: mongoose.Schema.Types.Mixed, resolution: mongoose.Schema.Types.Mixed,
  autoCompleted: Boolean, createdAt: String, updatedAt: String, shippedAt: String, completedAt: String
}, { minimize: false });
orderSchema.index({ buyerId: 1, createdAt: -1 });
orderSchema.index({ sellerId: 1, createdAt: -1 });
orderSchema.index({ status: 1, shippedAt: 1 });
export const Order = mongoose.model('Order', orderSchema);
const ledgerSchema = new mongoose.Schema({ id: { type: String, unique: true }, userId: String, amount: Number, type: String, reference: String, createdAt: String });
ledgerSchema.index({ userId: 1, createdAt: -1 });
export const LedgerEntry = mongoose.model('LedgerEntry', ledgerSchema);
// รีวิวร้านค้า: หนึ่งคำสั่งซื้อที่สำเร็จให้คะแนนได้ครั้งเดียว
const reviewSchema = new mongoose.Schema({ id: { type: String, unique: true }, orderId: { type: String, unique: true }, sellerId: String, buyerId: String, buyerName: String, cardName: String, rating: Number, comment: { type: String, default: '' }, createdAt: String });
reviewSchema.index({ sellerId: 1, createdAt: -1 });
export const Review = mongoose.model('Review', reviewSchema);
export const Cart = mongoose.model('Cart', new mongoose.Schema({ _id: String, items: { type: [String], default: [] } }));
// Idempotency-Key ต่อผู้ใช้ เก็บผลลัพธ์เดิมไว้ตอบคำขอซ้ำ
export const CommerceRequest = mongoose.model('CommerceRequest', new mongoose.Schema({
  _id: String, payload: String, status: String, result: mongoose.Schema.Types.Mixed, createdAt: { type: Date, default: Date.now }
}));
// รูปสินค้าสาธารณะเก็บแยกจากหลักฐานยืนยันตัวตน และไม่ใส่ไฟล์ภาพใน snapshot คำสั่งซื้อ
export const Upload = mongoose.model('Upload', new mongoose.Schema({ id: { type: String, unique: true }, ownerId: String, mime: String, bytes: Buffer }, { timestamps: true }));
export const Session = mongoose.model('Session', new mongoose.Schema({ token: { type: String, unique: true }, id: String, expires: { type: Date, expires: 0 } }));
