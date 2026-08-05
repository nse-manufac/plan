# CLAUDE.md — คู่มือสำหรับ AI agent ที่เข้ามาแก้ repo นี้

**อ่าน [INVARIANTS.md](INVARIANTS.md) ให้จบก่อนแตะโค้ดทุกครั้ง** ไฟล์นั้นคือกฎที่ห้ามพัง
ไฟล์นี้คือแผนที่ว่าอะไรอยู่ตรงไหน และทำงานยังไงให้ปลอดภัย

---

## 1. ระบบนี้คืออะไร

ระบบติดตามความคืบหน้าการผลิตตามใบสั่งซื้อ ใช้แทนกระดานไวท์บอร์ด/Excel
ผู้ใช้คือฝ่ายวางแผนและหัวหน้าไลน์ผลิต ใช้บนคอมในโรงงาน ภาษาไทยล้วน

งานหลักที่ระบบทำ:
- **นำเข้าแผนงาน** จากไฟล์ Excel ของลูกค้า
- **คีย์ยอดรายวัน** ว่าแต่ละใบสั่งซื้อเดินไปถึงไหนในแต่ละขั้นตอน
- **Dashboard** แถบความคืบหน้า · สถานะล่าช้า/ใกล้ครบกำหนด · กราฟ
- **นำเข้าใบส่งงาน** เพื่อบันทึกยอดส่งของ
- **รวมข้อมูลจากไฟล์** ที่ export มาจากเครื่องอื่น (มีหน้าจอสรุปก่อนรวม)
- **ออกรายงาน Excel**
- **ซิงค์หลายเครื่อง** ผ่าน Google Sheets (ไม่บังคับ ใช้ offline ได้)

**ขั้นตอนการผลิต 4 ขั้น:** `winding` → `assembly` → `inspection` → `shipping`

---

## 2. Deploy

**push ขึ้น `main` = ขึ้น production ทันที** ผ่าน GitHub Pages
ไม่มี build ไม่มี test runner ไม่มี staging → https://nse-manufac.github.io/plan/

agent **ห้าม push ขึ้น `main` เด็ดขาด** ทุกการแก้ต้องเป็น branch + PR ให้เจ้าของอนุมัติ

---

## 3. Stack

- **JavaScript ล้วน ไม่มี framework** — จัดการ DOM เองด้วย `document.getElementById` + `innerHTML`
  (ต่างจาก repo `store` ที่ใช้ Vue — อย่าเอารูปแบบของอีกอันมาปน)
- **SheetJS (XLSX)** ถูก **vendor ไว้ในไฟล์** ไม่ได้โหลดจาก CDN
- ไม่มี npm ไม่มี bundler ไม่มี TypeScript ไม่มี `<script src>` ภายนอกเลย
- แอปทำงานได้แม้ไม่มีอินเทอร์เน็ต — คุณสมบัตินี้ตั้งใจ ห้ามทำหาย

---

## 4. หาที่แก้ยังไงโดยไม่ต้องอ่านทั้งไฟล์

ไฟล์ยาว ~1,900 บรรทัด แต่ **~800 KB จาก 990 KB เป็นโค้ด SheetJS ที่ vendor ไว้**
อยู่ในบรรทัดยาวมาก ๆ ช่วงกลางไฟล์ (บรรทัดละ 30,000–75,000 ตัวอักษร)

> ⚠️ **ห้ามอ่าน ห้ามแก้ ห้าม format บรรทัดเหล่านั้น** และห้ามอ่านทั้งไฟล์เข้า context
> วิธีเช็กว่าบรรทัดไหนเป็น vendor: ถ้าบรรทัดยาวเกิน 20,000 ตัวอักษร คือ vendor

โค้ดของแอปจริงแบ่งเป็นบล็อกด้วย section banner ค้นด้วย:

```
grep -n "^/\* -\{5,\}" production_plan_tracker.html
```

| Section banner | มีอะไร |
|---|---|
| `Basic helpers` | `normalizeDateOnly` `fmtDateTH` `addDaysISO` `daysBetween` `escapeHtml` `uid` `toast` |
| `Processes` | `PROCESSES` `PREV_PROCESS` `ORDER_DATE_FIELDS` `RECORD_DATE_FIELDS` `normalizeRowDates` |
| `State` | `STORAGE_KEY` `defaultState` `loadState` `saveState` `migrateCorruptedDates` |
| `Google Sheets sync` | `gsApi` `cleanForPush` `doSync` และการ merge ตอน pull |
| `Excel parsing` | อ่านไฟล์แผนงานจากลูกค้า |
| `Cumulative / deadline / status helpers` | `buildCumMap` `buildCumSplitMap` `computeDeadlines` `computeStatus` ← **หัวใจของ A1–A5** |
| `Render: Import tab` | หน้านำเข้า |
| `Import: ใบส่งงาน (Shipping)` | นำเข้าใบส่งงาน |
| `Render: Entry tab` | หน้าคีย์ยอดรายวัน · `saveEntryValue` |
| `Record editor` | แก้ไข/ยกเลิกรายการที่บันทึกแล้ว |
| `Render: Dashboard tab` | ตารางหลัก + กราฟ |
| `Merge logic` | `computeMergePlan` `showMergeModal` `applyMerge` |
| `Excel report export` | ออกรายงาน |
| `Orchestration` / `Event bindings` / `Init` | ผูก event และเริ่มระบบ |

---

## 5. โครงสร้างข้อมูล

เก็บใน localStorage 2 key:

| key | เก็บอะไร |
|---|---|
| `tue_order_tracker_v1` | `state` ทั้งก้อน |
| `tue_order_tracker_sync_v1` | การตั้งค่าเชื่อมต่อ Google Sheets |

**state**

```js
{
  version: 1,
  deviceName: '',
  deadlineOffsets: { winding:10, assembly:17, inspection:24, shipping:28 },  // ซิงค์ข้ามเครื่อง
  chartPref:  { mode:'14', from:'', to:'' },                                 // เครื่องนี้เท่านั้น ห้ามซิงค์
  orders: [], records: [], importHistory: []
}
```

**record — ยอดที่คีย์รายวัน**

```js
{
  id: uid(),
  date,                       // YYYY-MM-DD (วันปฏิทินล้วน)
  orderId, process,           // process ∈ PROCESSES
  qty, note, deviceName,
  createdAt, updatedAt,       // ISO 8601 เต็ม
  voided: false,              // ยกเลิกแบบไม่ลบ
  _dirty: true                // ภายในเครื่องเท่านั้น ห้ามส่งขึ้นเซิร์ฟเวอร์
}
```

**กุญแจประจำตัวของ record คือ `orderId|process|date`** ไม่ใช่ `id` — ดู INVARIANTS A2

---

## 6. ขั้นตอนการทำงานที่ต้องทำตาม

1. **อ่าน INVARIANTS.md** แล้วระบุในหัว PR ว่าการแก้นี้ไปแตะหมวดไหนบ้าง (A–G)
2. **ทำซ้ำอาการก่อน** เขียนใน issue ว่าเกิดจากอะไร บรรทัดไหน ก่อนแก้
3. **แก้ให้เล็กที่สุด** แก้เฉพาะสาเหตุ ห้ามจัดระเบียบโค้ดรอบข้างมาด้วย
   PR ที่ diff เกิน ~80 บรรทัดจะรีวิวตอนพักเที่ยงไม่ทัน ถ้าจำเป็นต้องใหญ่กว่านั้นให้บอกเหตุผลไว้ในหัว PR
4. **ตรวจว่า diff ไม่ไปโดนบรรทัด vendor** — ถ้า diff ใหญ่ผิดปกติ แปลว่าเผลอแตะ SheetJS เข้าแล้ว
5. **หนึ่ง issue = หนึ่ง PR**
6. **เขียนสรุปเป็นภาษาไทย** หัว PR ต้องมี: อาการคืออะไร · เกิดจากอะไร · แก้ยังไง · ต้องทดสอบอะไร
7. **ห้าม push `main` · ห้าม merge เอง · ห้ามแก้ `.github/workflows/` เพื่อข้ามการตรวจ**

---

## 7. หยุดแล้วถามเจ้าของก่อน เมื่อเจอกรณีเหล่านี้

- ต้องเปลี่ยนโครงสร้าง `state` หรือ key ของ localStorage (INVARIANTS E1/E2)
- ต้องเพิ่ม / ลบ / สลับขั้นตอนการผลิต (INVARIANTS A3)
- ต้องเปลี่ยนกุญแจ `orderId|process|date` (INVARIANTS A2)
- ต้องเปลี่ยนวิธี sync หรือ contract กับ Apps Script
  (ผู้ใช้ต้องไป re-deploy Apps Script เอง = ต้องแจ้งล่วงหน้า)
- ต้องเพิ่ม dependency หรือเปลี่ยนวิธีโหลด SheetJS
- แก้ปัญหาไม่ได้โดยไม่ละเมิด INVARIANTS ข้อใดข้อหนึ่ง
- เรื่องที่แจ้งมาไม่ใช่บั๊กของโค้ด แต่เป็นไฟล์นำเข้าผิด หรือผู้ใช้ใช้ผิดวิธี
  → ตอบกลับผู้แจ้งเป็นภาษาไทย แล้วปิด issue ไม่ต้องเปิด PR

---

## 8. ทดสอบยังไง

### 8.1 Smoke test อัตโนมัติ

รันเองทุก PR ผ่าน `.github/workflows/smoke.yml` — **PR ที่เทสแดงห้ามเสนอให้เจ้าของอนุมัติ**

```bash
npm install && npx playwright install chromium && npm test
```

ชื่อเทสอ้างข้อกฎใน `INVARIANTS.md` ตรง ๆ (เช่น `A2 — คีย์ยอดซ้ำ ... ต้องทับของเดิม`)
เทสแดงข้อไหน = ละเมิดกฎข้อนั้น ไปอ่านกฎก่อน อย่าเพิ่งไปแก้เทส

มีเทสหนึ่งข้อที่ **ตัดเน็ตทั้งหมดแล้วตรวจว่าแอปยังใช้งานได้** — เป็นตัวกันไม่ให้ใครเผลอ
เปลี่ยน SheetJS ที่ vendor ไว้ไปเป็น CDN (INVARIANTS F2)

> `package.json` กับ `tests/` เป็น**เครื่องมือตอนพัฒนาเท่านั้น**
> ตัวแอปยังเป็นไฟล์เดียวไม่มี build ไม่มี dependency เหมือนเดิม

**เทสขับผ่าน DOM** เพราะโค้ดแอปห่ออยู่ใน IIFE จึงไม่มีฟังก์ชันไหนหลุดออกมาที่ global
วิธีตรวจผลคืออ่าน `localStorage` และข้อความในตาราง ไม่ใช่เรียกฟังก์ชันตรง ๆ

### 8.2 ทดสอบด้วยมือเพิ่ม (สำหรับสิ่งที่เทสยังไม่ครอบคลุม)

smoke test ครอบการคีย์ยอด/audit trail/วันที่/ออฟไลน์ แต่ **ยังไม่ครอบการนำเข้า Excel และกราฟ**
ถ้า PR แตะส่วนนั้น ให้ทดสอบด้วยมือแล้วเขียนผลใน PR:

1. เปิด `production_plan_tracker.html` ในเบราว์เซอร์ ไม่ต้องตั้งค่า sync
2. นำเข้าไฟล์แผนงานตัวอย่าง
3. **เส้นทางที่ต้องผ่านทุกครั้ง:**
   - คีย์ยอด winding 1 ช่อง → Dashboard อัปเดตยอดสะสมถูกต้อง
   - คีย์ยอดวันเดิม order เดิม ขั้นเดิมซ้ำ → ทับค่าเดิม ไม่เกิดแถวใหม่
   - เคลียร์ช่องให้ว่าง → ค่าเดิมต้องยังอยู่ (ไม่ถูกลบ)
   - พิมพ์ `0` ทับ → ยอดเป็น 0
   - ยกเลิกรายการจาก Record editor → หายจากยอดสะสม แต่ยังอยู่ในรายการ
   - ปรับ `deadlineOffsets` ใน Settings → สีเตือนในตารางเปลี่ยนตาม
   - export Excel → เปิดไฟล์ได้ ตัวเลขตรงกับหน้าจอ
   - refresh หน้า → ข้อมูลทั้งหมดยังอยู่
4. **ทดสอบแบบไม่มีเน็ต** ตัดเน็ตแล้วเปิดไฟล์ ต้องใช้งานได้ครบ
5. เปิด DevTools Console ต้องไม่มี error

---

## 9. คำศัพท์

| คำ | หมายถึง |
|---|---|
| order | ใบสั่งซื้อ 1 ใบ พร้อมยอดที่ต้องผลิต (`orderQty`) |
| record | ยอดที่คีย์ 1 ครั้ง = order + ขั้นตอน + วันเดียว |
| winding | พันขดลวด / ตัดแต่ง — ขั้นแรก |
| assembly | ประกอบ |
| inspection | ตรวจสอบ |
| shipping | ส่งของ — นับเป็นขั้นที่ 4 เพราะทยอยส่งได้ |
| `deadlineOffsets` | จำนวนวันนับจาก `orderDate` ที่แต่ละขั้นต้องเสร็จ |
| ยอดสะสม (cum) | ยอดรวมทุกวันของขั้นนั้นในใบสั่งซื้อนั้น |
| ทันกำหนด / เกินกำหนด | แยกยอดสะสมตามว่าคีย์ก่อนหรือหลัง deadline ของขั้นนั้น |
