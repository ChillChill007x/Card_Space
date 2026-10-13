# Cardspace — โครงสร้างข้อมูล (JSON Map) และ API Map

ตลาดซื้อขายการ์ดสะสมทีละใบ ใช้เครดิตสาธิตแทนเงินจริง
อัปเดตล่าสุด: 14 ตุลาคม 2569 (ตรงกับโค้ดใน `server/models.js` และ `server/app.js`)

## เครื่องมือที่ใช้

| ส่วน | เครื่องมือ | หน้าที่ |
|---|---|---|
| Back-end | Node.js + **Express 5** | REST API, session, ตรวจสิทธิ์ |
| ฐานข้อมูล | **MongoDB** (ดูข้อมูลด้วย MongoDB Compass) ผ่าน Mongoose 8 | เก็บข้อมูลทุก collection |
| Front-end | HTML, CSS, JavaScript (ES Modules) เรียก API ด้วย `fetch` | หน้าเว็บแบบ single page ใช้ hash route เช่น `#/cards/:id` |
| ประมวลผลภาพ | sharp, tesseract.js (OCR ภาษาอังกฤษ/ญี่ปุ่น ติดตั้งในเครื่อง) | ย่อ/ตรวจรูป และอ่านชื่อการ์ด/เกรดจากรูป |
| ความปลอดภัย | scrypt (hash รหัสผ่าน), cookie HttpOnly + SameSite, CSP | ไม่เก็บรหัสผ่านตรง ๆ และไม่ให้ JavaScript อ่าน session |

## ผู้ใช้งาน 3 บทบาท

| บทบาท | ทำอะไรได้ |
|---|---|
| บุคคลทั่วไป (ไม่เข้าสู่ระบบ) | ดู ค้นหา กรองการ์ด ดูหน้าร้าน รีวิว และการ์ดแนะนำ สมัครสมาชิก |
| **ผู้ซื้อ** (`customer`) | เติมเครดิตสาธิต ตะกร้า ซื้อ ยกเลิก ยืนยันรับ แจ้งปัญหา ให้คะแนนร้าน รายงานสินค้า จัดการโปรไฟล์/ที่อยู่ |
| **พ่อค้า** (`merchant`) | ทุกอย่างของผู้ซื้อ + ส่งหลักฐานเปิดร้าน แล้ว (เมื่อได้รับอนุมัติ) เพิ่ม/แก้ไข/ลบการ์ด อัปโหลดรูป อ่านรูปด้วย OCR แจ้งจัดส่ง ชี้แจงข้อพิพาท |
| **แอดมิน** (`admin`) | อนุมัติ/ระงับร้าน ลบสินค้า ตรวจรายงานสินค้า ดูคำสั่งซื้อทั้งหมด ยกเลิก/แจ้งจัดส่งแทน และตัดสินข้อพิพาท |

---

## JSON Map (โครงสร้างข้อมูลใน MongoDB)

ข้อกำหนดร่วม: ทุกเอกสารมี `id` แบบ UUID (unique) ใช้อ้างอิงข้ามกัน **เงินทุกจุดเป็นจำนวนเต็มหน่วยสตางค์** (เช่น `12500` = 125 บาท) วันเวลาเป็น ISO 8601

### ความสัมพันธ์ระหว่าง collection

```text
users ──< cards (sellerId)              users ──< orders (buyerId, sellerId)
cards ──o orders (cards.soldOrderId → orders.id, orders.card = สำเนาการ์ดตอนซื้อ)
orders ──o reviews (orderId unique)     users ──< ledgerentries (userId)
users ──o carts (_id = userId)          cards ──< reports (cardId)
uploads (รูปสินค้าสาธารณะ)              receiptproofs (รูปหลักฐานส่วนตัวของคำสั่งซื้อ)
```

### 1. `users` — สมาชิก

```json
{
  "id": "3f714a39-be7d-4d07-8381-dbe5466605e9",
  "name": "Seller One",
  "email": "seller@example.com",
  "passwordHash": "<salt>:<scrypt-hash>",
  "role": "merchant",
  "verification": "approved",
  "merchantCode": "SELL-000001",
  "balance": 150000,
  "avatar": "data:image/jpeg;base64,...",
  "shippingAddress": { "recipient": "Seller One", "phone": "0812345678", "address": "123 ถนนมิตรภาพ ขอนแก่น 40000" },
  "application": {
    "fullName": "ชื่อ นามสกุล", "shopName": "Pika House", "phone": "0812345678", "address": "...",
    "evidence": "data:image/png;base64,...", "submittedAt": "2026-10-12T08:00:00.000Z",
    "reviewNote": "", "reviewedAt": "2026-10-12T09:00:00.000Z", "reviewedBy": "<admin id>"
  },
  "createdAt": "2026-10-12T08:00:00.000Z", "updatedAt": "2026-10-12T09:00:00.000Z"
}
```

- `role`: `customer` | `merchant` | `admin` — สมัครเองได้แค่ `customer` หรือ `merchant`
- `verification`: `none` | `pending` | `approved` | `rejected` — ลงขายได้เมื่อ `approved` เท่านั้น
- `merchantCode`: รหัสพ่อค้า `SELL-xxxxxx` ไม่ซ้ำ และแก้ไขไม่ได้ (นับจาก collection `counters`)
- `application.evidence`: ภาพหลักฐาน ดูได้เฉพาะเจ้าของและแอดมิน และไม่ถูกดึงในงานทั่วไป

### 2. `cards` — การ์ดที่วางขาย (1 เอกสาร = การ์ด 1 ใบ)

```json
{
  "id": "0073abf2-8853-48f2-b7ce-0b1d93c2ae2b",
  "name": "Pikachu Promo", "category": "Pokémon", "character": "Pikachu, พิคาชู",
  "set": "Electric dreams · 025/165", "rarity": "SR", "language": "ญี่ปุ่น",
  "condition": "Near Mint", "conditionNotes": "มุมขวาบนมีรอยเล็กน้อย",
  "grading": { "company": "PSA", "grade": "10", "certificate": "12345678" },
  "price": 35000,
  "image": "/api/uploads/fa2afc9e-...", "backImage": "", "detailImage": "",
  "description": "รายละเอียดเพิ่มเติม", "shippingNotes": "ใส่ toploader + กล่องแข็ง",
  "sellerId": "<users.id>", "sellerName": "Pika House",
  "createdAt": "2026-10-13T10:00:00.000Z",
  "soldOrderId": null
}
```

- `category`: `Pokémon` | `Yu-Gi-Oh!` | `One Piece` | `Magic: The Gathering`
- `condition`: `Near Mint` | `Excellent` | `Played`
- `grading`: `null` = การ์ดดิบ (Raw), หรือ `{company: PSA|BGS|CGC, grade, certificate}`
- `soldOrderId`: `null` = ยังขายได้ / มีค่า = ผูกกับคำสั่งซื้อนั้น การซื้อ การแก้ไข และการลบตรวจค่านี้ในคำสั่งเดียวกับการเขียน จึงไม่เกิดกรณีขายซ้ำหรือแก้ข้อมูลหลังขาย

### 3. `orders` — คำสั่งซื้อ

```json
{
  "id": "d658e119-5a59-44c2-b5bb-4dc9b206cd7e",
  "buyerId": "<users.id>", "sellerId": "<users.id>",
  "card": { "id": "...", "name": "Pikachu Promo", "price": 35000, "image": "...", "condition": "Near Mint", "grading": null, "sellerName": "Pika House" },
  "total": 35000,
  "address": "ผู้ซื้อ\n0812345678\n99 ถนนมิตรภาพ ขอนแก่น 40000",
  "status": "disputed",
  "tracking": "Kerry KEX123456",
  "shipmentProofId": "<receiptproofs.id>", "receiptProofId": null,
  "dispute": {
    "reason": "damaged", "details": "มุมการ์ดหักตอนได้รับ", "evidenceProofId": "<receiptproofs.id>",
    "openedAt": "...", "sellerResponse": "แพ็กใน toploader แล้ว", "respondedAt": "..."
  },
  "resolution": { "decision": "refund", "note": "รูปยืนยันความเสียหาย", "by": "<admin id>", "at": "..." },
  "autoCompleted": false,
  "createdAt": "...", "updatedAt": "...", "shippedAt": "...", "completedAt": null
}
```

- `card` เป็น **สำเนาของการ์ดตอนซื้อ** ราคาและชื่อในคำสั่งซื้อจึงไม่เปลี่ยนตามรายการภายหลัง
- `dispute.reason`: `not_received` | `not_as_described` | `damaged` | `other`
- `resolution.decision`: `refund` (คืนเครดิตผู้ซื้อ) | `release` (โอนให้ผู้ขาย)

**สถานะคำสั่งซื้อ (`status`)**

```text
paid (ชำระแล้ว รอจัดส่ง) ──ship──> shipped (จัดส่งแล้ว) ──receive / ครบ 7 วัน──> completed (สำเร็จ, โอนเครดิตผู้ขาย)
  │                                   │
  └─cancel─> cancelled                └─dispute─> disputed ──resolve: release─> completed
             (คืนเครดิต, การ์ดกลับมาขาย)                    └─resolve: refund──> refunded (คืนเครดิตผู้ซื้อ)
```

### 4. `ledgerentries` — ประวัติเครดิต (1 เอกสาร = 1 รายการเคลื่อนไหว)

```json
{ "id": "...", "userId": "<users.id>", "amount": -35000, "type": "purchase", "reference": "<orders.id>", "createdAt": "..." }
```

- `type`: `topup` (+ เติมเครดิต) | `purchase` (− ซื้อ) | `refund` (+ คืนเครดิต) | `sale` (+ รายได้ผู้ขาย)
- ผลรวม `amount` ของผู้ใช้หนึ่งคน = `users.balance`

### 5. `reviews` — คะแนนร้านค้า

```json
{ "id": "...", "orderId": "<orders.id>", "sellerId": "<users.id>", "buyerId": "<users.id>", "buyerName": "ม***", "cardName": "Pikachu Promo", "rating": 5, "comment": "ส่งไว แพ็กดีมาก", "createdAt": "..." }
```

- `orderId` unique: หนึ่งคำสั่งซื้อที่สำเร็จแล้วให้คะแนนได้ครั้งเดียว (1–5 ดาว)

### 6. `carts` — ตะกร้า (ไม่จองสินค้า)

```json
{ "_id": "<users.id>", "items": ["<cards.id>", "<cards.id>"] }
```

### 7. `reports` — รายงานสินค้าผิดปกติ

```json
{ "id": "...", "cardId": "<cards.id>", "cardName": "...", "sellerId": "<users.id>", "reporterId": "<users.id>", "reason": "misleading", "details": "รูปไม่ตรงกับรายละเอียด", "status": "pending", "reviewNote": "", "reviewedBy": null, "createdAt": "...", "updatedAt": "..." }
```

- `reason`: `counterfeit` | `misleading` | `inappropriate` | `fraud` | `other`
- `status`: `pending` | `reviewing` | `resolved` | `dismissed`
- `(cardId, reporterId)` unique: ผู้ใช้หนึ่งคนรายงานสินค้าเดิมซ้ำไม่ได้

### 8. collection เสริม

| Collection | ตัวอย่าง | หน้าที่ |
|---|---|---|
| `uploads` | `{ "id", "ownerId", "mime": "image/png", "bytes": <Binary> }` | รูปสินค้าสาธารณะ (หน้า/หลัง/ตำหนิ) |
| `receiptproofs` | `{ "id", "mime", "bytes": <Binary> }` | รูปหลักฐานจัดส่ง/รับสินค้า/ข้อพิพาท ดูได้เฉพาะคู่ค้าและแอดมิน |
| `sessions` | `{ "token": "<sha256>", "id": "<users.id>", "expires": Date }` | session เข้าสู่ระบบ เก็บ token แบบ hash หมดอายุเองใน 24 ชั่วโมง (TTL index) |
| `commercerequests` | `{ "_id": "<userId>:<Idempotency-Key>", "payload", "status": "done", "result" }` | กันกดซื้อ/เติมเครดิตซ้ำ: คำขอเดิมได้ผลลัพธ์เดิม |
| `counters` | `{ "_id": "merchant", "value": 12 }` | ตัวนับสร้างรหัสพ่อค้าไม่ซ้ำ |
| `commercestates` | (รูปแบบเก่า) | ใช้ย้ายข้อมูลรุ่นเดิมครั้งแรกเท่านั้น |

---

## API Map

- Base URL: `http://localhost:3000/api` — รับส่ง JSON
- ยืนยันตัวตนด้วย cookie `session` (HttpOnly) ที่ได้จากสมัคร/เข้าสู่ระบบ
- ข้อผิดพลาด: `{ "message": "คำอธิบายภาษาไทย" }` พร้อม HTTP status `400` (ข้อมูลไม่ถูกต้อง), `401` (ยังไม่เข้าสู่ระบบ), `403` (ไม่มีสิทธิ์), `404` (ไม่พบ), `409` (สถานะไม่ตรง เช่น ขายไปแล้ว), `429` (ส่งคำขอถี่เกินไป)
- คำขอที่เกี่ยวกับเงินต้องส่ง header `Idempotency-Key` (16–80 ตัวอักษร) ส่งซ้ำด้วยคีย์เดิมจะได้ผลเดิม ไม่หักเงินซ้ำ

สิทธิ์: 🌐 ทุกคน · 🔑 เข้าสู่ระบบแล้ว · 🛒 ผู้ซื้อของรายการนั้น · 🏪 พ่อค้าที่อนุมัติแล้ว · 🛡️ แอดมิน

### ระบบและบัญชี

| Method | Endpoint | สิทธิ์ | Request | Response |
|---|---|---|---|---|
| GET | `/status` | 🌐 | – | `{mode, demoCommerce, autoCompleteDays, contactEmail}` |
| GET | `/categories` | 🌐 | – | `["Pokémon", ...]` |
| POST | `/auth/register` | 🌐 | `{name, email, password (12–128), role: customer\|merchant}` | ข้อมูลผู้ใช้ (ไม่มีรหัสผ่าน) + ตั้ง cookie |
| POST | `/auth/login` | 🌐 | `{email, password}` | ข้อมูลผู้ใช้ + ตั้ง cookie |
| POST | `/auth/logout` | 🌐 | – | `{ok: true}` |
| GET | `/auth/me` | 🌐 | – | ผู้ใช้ปัจจุบัน หรือ `null` |
| GET | `/profile` | 🔑 | – | `{name, email, avatar, shippingAddress}` |
| PATCH | `/profile` | 🔑 | `{name?, avatar?, shippingAddress?: {recipient, phone (0 + 8–9 หลัก), address}}` | `{ok: true}` |
| GET | `/notifications` | 🔑 | – | `{items: [{label, count, href}], total}` งานที่ค้างตามบทบาท |

### การ์ด (ค้นหา / เพิ่ม / แก้ไข / ลบ)

| Method | Endpoint | สิทธิ์ | Request | Response |
|---|---|---|---|---|
| GET | `/cards` | 🌐 | query: `q, category, condition, grading (raw\|graded\|PSA\|BGS\|CGC), sort (newest\|price-asc\|price-desc), mine=1, page, limit` | `[card]` (ตลาดแสดงเฉพาะร้านที่พร้อมขายและการ์ดที่ยังไม่ขาย) + header `X-Total-Count` |
| GET | `/cards/:id` | 🌐 | – | `card + {sold, purchasable, sellerApproved, merchantCode, sellerAvatar, sellerRating: {average, count}}` |
| GET | `/cards/:id/related` | 🌐 | – | การ์ดแนะนำสูงสุด 6 ใบ (ตัวละคร → เซ็ต → ร้าน → ราคาใกล้) |
| POST | `/cards` | 🏪 | `{name, category, set, rarity, condition, price, image, character?, grading?, description?, language?, conditionNotes?, shippingNotes?, backImage?, detailImage?}` | `201` card ที่สร้าง |
| PUT | `/cards/:id` | 🏪 เจ้าของ | ฟิลด์เดียวกับ POST | card ที่แก้ไข (`409` ถ้าขายไปแล้ว) |
| DELETE | `/cards/:id` | 🏪 เจ้าของ / 🛡️ | – | `{ok: true}` (`409` ถ้าขายไปแล้ว) |
| POST | `/uploads` | 🏪 | `{data: "data:image/png;base64,..."}` ≤ 2 MB | `201 {url: "/api/uploads/:id"}` |
| GET | `/uploads/:id` | 🌐 | – | ไฟล์รูป (image/png, image/jpeg) |
| POST | `/uploads/:id/recognize` | 🏪 เจ้าของรูป | – | `{suggestions: {name, set, category, language, gradingCompany, gradingGrade, gradingCertificate}, warnings, text, confidence}` (OCR) |
| POST | `/cards/:id/reports` | 🔑 ผู้ซื้อ/พ่อค้า | `{reason, details (10–2,000)}` | `201 {id, status}` |

### ร้านค้าและการยืนยันพ่อค้า

| Method | Endpoint | สิทธิ์ | Request | Response |
|---|---|---|---|---|
| GET | `/merchants/:id` | 🌐 | – | `{id, name, avatar, merchantCode, approved, completedCount, rating: {average, count, items}, cards}` |
| GET | `/merchant/application` | 🔑 พ่อค้า | – | `{verification, application}` |
| POST | `/merchant/application` | 🔑 พ่อค้า | `{fullName, shopName, phone, address, evidence: data URL รูป}` | `{verification: "pending", application}` |

### กระเป๋าเครดิตและตะกร้า

| Method | Endpoint | สิทธิ์ | Request | Response |
|---|---|---|---|---|
| GET | `/wallet` | 🔑 | – | `{enabled, persistent, balance, entries: [ledger ล่าสุด 100 รายการ]}` |
| POST | `/wallet/topup` | 🔑 + Idempotency-Key | `{amount}` (10,000–1,000,000,000 สตางค์) | `{balance}` |
| GET | `/cart` | 🔑 | – | `{items: [{cardId, card, available, reason}], count}` |
| POST | `/cart` | 🔑 | `{cardId}` | `{count}` (สูงสุด 50 รายการ, ไม่จองสินค้า) |
| DELETE | `/cart/:id` | 🔑 | – | `{count}` |
| POST | `/cart/checkout` | 🔑 + Idempotency-Key | `{items: [{cardId, expectedPrice}], address}` | `201 {orders, total, balance}` ซื้อทั้งหมดหรือไม่ซื้อเลย |

### คำสั่งซื้อ รีวิว และข้อพิพาท

| Method | Endpoint | สิทธิ์ | Request | Response |
|---|---|---|---|---|
| POST | `/orders` | 🔑 + Idempotency-Key | `{cardId, expectedPrice, address}` | `201` order |
| GET | `/orders` | 🔑 | query: `scope (purchases\|sales\|admin), status, q, page, limit (≤100)` | `{items, total, counts: {สถานะ: จำนวน}, page, pages}` |
| PATCH | `/orders/:id` | ตาม action | ดูตาราง action ด้านล่าง | order หลังเปลี่ยนสถานะ |
| GET | `/orders/:id/shipment` · `/receipt` · `/dispute` | 🔑 คู่ค้า/🛡️ | – | รูปหลักฐานจัดส่ง / รับสินค้า / ข้อพิพาท |
| POST | `/orders/:id/review` | 🛒 (status `completed`) | `{rating: 1–5, comment? (≤1,000)}` | `201 {rating, comment}` |

**`PATCH /orders/:id` — action ที่รองรับ**

| action | ผู้มีสิทธิ์ | สถานะก่อน → หลัง | ข้อมูลที่ต้องส่ง | ผลทางเครดิต |
|---|---|---|---|---|
| `ship` | 🏪 ผู้ขาย / 🛡️ | `paid` → `shipped` | `tracking`, `shipmentImage` | – |
| `cancel` | 🛒 / 🛡️ | `paid` → `cancelled` | – | คืนผู้ซื้อ, การ์ดกลับมาขาย |
| `receive` | 🛒 | `shipped` → `completed` | `receiptImage` | โอนให้ผู้ขาย |
| `dispute` | 🛒 | `shipped` → `disputed` | `reason`, `details`, `disputeImage` (ยกเว้น `not_received`) | พักไว้ |
| `respond` | ผู้ขาย | `disputed` (คงเดิม) | `response` | – |
| `resolve` | 🛡️ | `disputed` → `refunded` / `completed` | `decision: refund\|release`, `note` | คืนผู้ซื้อ / โอนให้ผู้ขาย |
| (อัตโนมัติ) | ระบบ (ทุกชั่วโมง) | `shipped` เกิน 7 วัน → `completed` | – | โอนให้ผู้ขาย |

### แอดมิน

| Method | Endpoint | สิทธิ์ | Request | Response |
|---|---|---|---|---|
| GET | `/admin/merchants` | 🛡️ | – | รายชื่อพ่อค้า + ข้อมูลใบสมัคร (ไม่รวมภาพหลักฐาน) |
| GET | `/admin/merchants/:id/evidence` | 🛡️ | – | `{evidence}` ภาพหลักฐานของพ่อค้ารายนั้น |
| PATCH | `/admin/merchants/:id` | 🛡️ | `{verification: approved\|rejected, reviewNote}` (ปฏิเสธต้องมีเหตุผล) | ข้อมูลพ่อค้าหลังตรวจ |
| GET | `/admin/reports` | 🛡️ | – | รายงานสินค้าทั้งหมด |
| PATCH | `/admin/reports/:id` | 🛡️ | `{status, reviewNote}` | `{ok: true}` |

---

## หน้าเว็บ (hash route)

| URL | หน้า |
|---|---|
| `#/` | ตลาดการ์ด (ค้นหา/กรอง) |
| `#/cards/:id`, `#/cards/:id/checkout` | รายละเอียดการ์ด, หน้ายืนยันซื้อ |
| `#/cart` | ตะกร้า |
| `#/orders/purchases`, `#/orders/sales`, `#/orders/admin` | คำสั่งซื้อของผู้ซื้อ / ร้าน / ทั้งหมด |
| `#/shop` | จัดการร้านค้าของฉัน (พ่อค้า) |
| `#/merchants/:id` | หน้าร้านสาธารณะ พร้อมรีวิว |
| `#/profile` | โปรไฟล์และที่อยู่ |
| `#/admin`, `#/reports` | จัดการพ่อค้า, รายงานสินค้า (แอดมิน) |
| `#/help`, `#/terms`, `#/contact` | วิธีใช้งาน, เงื่อนไขการซื้อขาย / การแจ้งปัญหา, ติดต่อ |
| อื่น ๆ | หน้า "ไม่พบหน้านี้" (404) |
