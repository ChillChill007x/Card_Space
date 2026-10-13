// เติมการ์ดตัวอย่างลง MongoDB เมื่อสั่งเท่านั้น (เซิร์ฟเวอร์ไม่เติมเองตอนเริ่ม)
// ใช้ id เดิม จึงรันซ้ำได้โดยไม่สร้างซ้ำ และไม่นำรายการที่ลบไปแล้วกลับมาหากไม่ได้สั่ง
import mongoose from 'mongoose';
import { Card } from '../server/models.js';
import { seedCards } from '../server/seed.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required (see .env.example)');
await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
try {
  const result = await Card.bulkWrite(seedCards.map(card => ({ updateOne: { filter: { id: card.id }, update: { $setOnInsert: { ...card, soldOrderId: null } }, upsert: true } })));
  console.log(`Demo cards added: ${result.upsertedCount} (already present: ${seedCards.length - result.upsertedCount})`);
} finally { await mongoose.disconnect(); }
