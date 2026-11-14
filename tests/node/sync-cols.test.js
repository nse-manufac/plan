// ลำดับคอลัมน์ของการซิงค์ — **ต่อท้ายได้อย่างเดียว ห้ามแทรกกลาง ห้ามสลับ ห้ามลบ**
//
// ทำไมต้องมีเทสนี้ (เกิดขึ้นจริงแล้ว · พบ 14 พ.ย. 2569):
//   `doPushRows` ฝั่ง Apps Script เขียนแถวด้วย **ตำแหน่ง** (`setValues([toRow(r, cols)])`)
//   ส่วน `sheetOf()` เติมคอลัมน์ที่ชีตยังไม่มี **ต่อท้ายหัวตาราง** เสมอ
//   ลำดับสองฝั่งจึงตรงกันได้ต่อเมื่อ "ของใหม่ต่อท้าย" เหมือนกันทั้งคู่
//
//   ตอนไปแก้ให้ `planSupport` ซิงค์ได้ (issue #17) มีคนแทรกชื่อมันไว้ **กลางรายการ**
//   ขณะที่ชีตของจริงมีมันอยู่ท้าย ๆ → ค่าทุกช่องตั้งแต่จุดนั้นเลื่อนไปหนึ่งช่อง
//   ผลคือ `status` ไปอยู่ใน `importedAt` · ใบสั่ง 398 จาก 876 ใบเพี้ยน และไม่มีอะไรร้องเลย
//
// ⚠️ **ทำไม `tests/sync-contract.spec.js` จับไม่ได้** — มันเทียบ `app.js` กับ `.gs`
//    ซึ่งรอบนั้น **ผิดเหมือนกันทั้งคู่** จึงเขียวมาตลอดหลายเดือน
//    ของที่ต้องคุมคือ "ลำดับเทียบกับอดีตของตัวเอง" ไม่ใช่ "สองไฟล์ตรงกัน"
//
// 📌 **เพิ่มคอลัมน์ใหม่ต้องทำสามอย่างพร้อมกัน**
//    1. ต่อท้ายใน `.gs`   2. ต่อท้ายใน `app.js`   3. ต่อท้ายใน FROZEN ข้างล่าง
//    ถ้าขั้นที่ 3 รู้สึกว่า "ต้องแก้ตรงกลาง" แปลว่ากำลังจะทำผิดแบบเดิม — หยุดแล้วอ่านหัวไฟล์นี้ใหม่

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/* ลำดับ ณ 14 พ.ย. 2569 — ตรงกับหัวตารางจริงในชีต production
   (ยืนยันจาก `readObjects()` ซึ่งอ่าน `vals[0]` คือแถวหัวตาราง แล้วสร้างวัตถุตามลำดับนั้น
    ไฟล์ export ของเจ้าของจึงสะท้อนหัวตารางจริง และทั้ง 876 ใบมีลำดับเดียวกันหมด) */
const FROZEN = {
  Orders: ['id', 'week', 'poNo', 'pn', 'subName', 'osc', 'pc', 'orderQty', 'orderDate',
    'planWinding', 'planAssembly', 'planInspection', 'status', 'importedAt', 'updatedAt',
    'planSupport', 'voided'],
  Records: ['id', 'date', 'orderId', 'process', 'qty', 'note', 'deviceName',
    'createdAt', 'updatedAt', 'voided', 'batchId'],
  DeliveryNotes: ['id', 'date', 'unit', 'orderId', 'pn', 'perBox', 'boxes', 'remainder',
    'remark', 'billNo', 'deviceName', 'createdAt', 'updatedAt', 'voided'],
  DeltaWip: ['id', 'orderId', 'week', 'wip', 'fileName', 'deviceName', 'createdAt', 'updatedAt',
    'voided', 'wipOverride', 'overrideNote', 'overrideBy', 'overrideAt'],
  DeliveryLog: ['id', 'no', 'date', 'unit', 'week', 'groups', 'lines', 'qty',
    'deviceName', 'createdAt', 'updatedAt', 'voided']
};

const GS_NAME = {
  Orders: 'ORDER_COLS', Records: 'RECORD_COLS', DeliveryNotes: 'DELIVERY_COLS',
  DeltaWip: 'DELTAWIP_COLS', DeliveryLog: 'DELIVERYLOG_COLS'
};

const strings = block => [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);

/** รายการคอลัมน์ของทุกตารางจาก SYNC_COLS ใน app.js */
function appCols() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const i = src.indexOf('const SYNC_COLS = {');
  assert.ok(i > 0, 'หา SYNC_COLS ใน app.js ไม่เจอ — ชื่อเปลี่ยนไปแล้วหรือย้ายไฟล์?');
  const blk = src.slice(i, src.indexOf('\n};', i));
  const out = {};
  for (const m of blk.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) out[m[1]] = strings(m[2]);
  return out;
}

/** รายการคอลัมน์ของทุกตารางจากค่าคงที่ใน google-apps-script.gs */
function gsCols() {
  const src = fs.readFileSync(path.join(ROOT, 'google-apps-script.gs'), 'utf8');
  const out = {};
  for (const [table, name] of Object.entries(GS_NAME)) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
    assert.ok(m, 'หา ' + name + ' ใน .gs ไม่เจอ');
    out[table] = strings(m[1]);
  }
  return out;
}

for (const [table, frozen] of Object.entries(FROZEN)) {
  test(`${table} — ลำดับคอลัมน์ต้องต่อท้ายอย่างเดียว (app.js)`, () => {
    const now = appCols()[table];
    assert.ok(now, `SYNC_COLS ไม่มีตาราง ${table}`);
    assert.deepEqual(now.slice(0, frozen.length), frozen,
      `ลำดับคอลัมน์ของ ${table} เปลี่ยนไปจากที่ชีตจริงใช้อยู่ — ของใหม่ต้องต่อท้าย ห้ามแทรกกลาง\n` +
      `ชีตใช้  : ${frozen.join(' ')}\nโค้ดใช้ : ${now.join(' ')}`);
  });

  test(`${table} — ลำดับคอลัมน์ต้องต่อท้ายอย่างเดียว (.gs)`, () => {
    const now = gsCols()[table];
    assert.deepEqual(now.slice(0, frozen.length), frozen,
      `ลำดับคอลัมน์ของ ${table} ใน Apps Script เปลี่ยนไปจากที่ชีตจริงใช้อยู่`);
  });
}

test('สองไฟล์ต้องประกาศลำดับเดียวกันเป๊ะ', () => {
  const a = appCols(), g = gsCols();
  for (const table of Object.keys(FROZEN)) {
    assert.deepEqual(a[table], g[table],
      `${table}: app.js กับ .gs ประกาศคอลัมน์ไม่ตรงกัน`);
  }
});

/* ⚠️ ข้อนี้คุม "ความตั้งใจ" ของ FROZEN เอง — ถ้าวันหนึ่งมีคนแก้ FROZEN ให้ตรงกับโค้ดที่ผิด
   เพื่อให้เทสเขียว ข้อข้างบนก็จะไร้ความหมายทันที · ตรึงสิ่งที่พังจริงเอาไว้ตรง ๆ */
test('planSupport ต้องอยู่ก่อน voided เสมอ — จุดที่เคยพังมาแล้ว', () => {
  for (const [name, cols] of [['FROZEN', FROZEN.Orders], ['app.js', appCols().Orders],
    ['.gs', gsCols().Orders]]) {
    assert.equal(cols[cols.indexOf('planSupport') + 1], 'voided',
      `${name}: planSupport ต้องอยู่ติดก่อน voided (หัวตารางจริงในชีตเป็นแบบนั้น)`);
    assert.ok(cols.indexOf('planSupport') > cols.indexOf('updatedAt'),
      `${name}: planSupport ต้องอยู่ "หลัง" updatedAt ไม่ใช่กลางกลุ่มวันแผน`);
  }
});
