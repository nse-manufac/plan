// ลำดับคอลัมน์ของการซิงค์ — **ต่อท้ายได้อย่างเดียว ห้ามแทรกกลาง ห้ามสลับ ห้ามลบ**
//
// ทำไมต้องมีเทสนี้ (เกิดขึ้นจริงแล้ว · พบ 14 พ.ย. 2569):
//   `doPushRows` ฝั่ง Apps Script เขียนแถวด้วย **ตำแหน่ง** (`setValues([toRow(r, cols)])`)
//   ส่วน `sheetOf()` เติมคอลัมน์ที่ชีตยังไม่มี **ต่อท้ายหัวตาราง** เสมอ
//   ลำดับสองฝั่งจึงตรงกันได้ต่อเมื่อ "ของใหม่ต่อท้าย" เหมือนกันทั้งคู่
//
//   ตอนไปแก้ให้ `planSupport` ซิงค์ได้ (issue #17) มีคนแทรกชื่อมันไว้ **กลางรายการ**
//   ขณะที่ชีตของจริงมีมันอยู่ท้าย ๆ → ค่าทุกช่องตั้งแต่จุดนั้นเลื่อนไปหนึ่งช่อง
//   ผลคือ `status` ไปอยู่ใน `importedAt` · ใบสั่ง 441 จาก 918 ใบเพี้ยน และไม่มีอะไรร้องเลย
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

/* ลำดับ ณ 14 พ.ย. 2569
 *
 * ⚠️ **ระดับความมั่นใจของแต่ละตารางไม่เท่ากัน — อย่าอ่านรวมว่า "ยืนยันหมดแล้ว"**
 * · `Orders` **ยืนยันกับของจริง** — `readObjects()` อ่าน `vals[0]` คือแถวหัวตารางจริง
 *   แล้วสร้างวัตถุตามลำดับนั้น ไฟล์ export ของเจ้าของจึงสะท้อนหัวตาราง และทั้ง 876 ใบลำดับเดียวกันหมด
 * · อีกสี่ตาราง **ยังไม่เคยเทียบกับชีตจริง** และ "ประวัติ" หนักแน่นไม่เท่ากัน —
 *   ผู้ตรวจ #136 รอบ 10 ไล่ประวัติ `.gs` ทุกคอมมิตแล้วได้สามระดับ:
 *     `DeliveryLog`   ถูกสร้างหลัง `.gs` เข้า repo → ตรวจย้อนได้เต็ม
 *     `DeltaWip`      เติมคอลัมน์ในยุค repo ครั้งเดียว และเป็นการต่อท้ายจริง
 *     `Records` · `DeliveryNotes`  **ไม่เคยมีคอลัมน์เพิ่มเลยตั้งแต่ `.gs` เข้า repo**
 *                     → ประวัติไม่ได้ยืนยันอะไรให้สองตารางนี้
 *   ที่พอเบาใจคือถ้าสองตารางนั้นเลื่อน `qty` จะไปอยู่ในช่อง `note` = เห็นทันที
 *   ต่างจาก `Orders` ที่เลื่อนไปโดนคอลัมน์ที่ไม่มีใครอ่านบนจอ จึงเงียบได้หลายเดือน
 *   **ถ้าวันหนึ่งพบว่าตารางไหนเพี้ยนอยู่ก่อน การตรึงแบบนี้คือการตรึงของผิดเอาไว้**
 *   วิธีตรวจคือ export แล้วดูลำดับคีย์ของตารางนั้น เหมือนที่ทำกับ `Orders` */
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

const strings = block => [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);

/* ⚠️ **ชื่อตารางฝั่ง `.gs` ต้องอ่านจาก `ROW_TABLES` ห้ามฮาร์ดโค้ดไว้ในไฟล์นี้**
   ของเดิมมีตาราง `GS_NAME` อยู่ตรงนี้ ซึ่งแปลว่าตารางที่หกที่ใครเพิ่มเข้า `.gs`
   จะไม่มีวันถูกเห็นโดยไฟล์นี้เลย = ด่านเขียวเพราะไม่ได้ตรวจ (ผู้ตรวจ #136 รอบ 9) */
function gsNames() {
  const src = fs.readFileSync(path.join(ROOT, 'google-apps-script.gs'), 'utf8');
  const m = src.match(/var\s+ROW_TABLES\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, 'หา ROW_TABLES ใน .gs ไม่เจอ');
  const out = {};
  for (const p of m[1].matchAll(/(\w+)\s*:\s*(\w+)/g)) out[p[1]] = p[2];
  return out;
}

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
  for (const [table, name] of Object.entries(gsNames())) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
    assert.ok(m, 'หา ' + name + ' ใน .gs ไม่เจอ');
    out[table] = strings(m[1]);
  }
  return out;
}

/* 🚨 **เทียบทั้งอาเรย์ ห้ามใช้ `now.slice(0, frozen.length)`**
   ของเดิมเทียบแค่ส่วนหัว → ต่อท้ายคอลัมน์ใหม่ใน `.gs`+`app.js` **โดยไม่แก้ `FROZEN`** แล้วด่านเขียว
   ซึ่งแปลว่าคอลัมน์ตัวนั้น **ไม่เคยถูกตรึงเลย** · ใบถัดไปแทรกของใหม่ไว้ "ก่อน" ตัวนั้นได้โดยไม่มีอะไรฟ้อง
   = บั๊กคลาสเดียวกับที่ใบนี้มาแก้ (ผู้ตรวจ #136 รอบ 5 รันพิสูจน์ว่าเขียวทุกข้อ)
   เทียบทั้งอาเรย์ยังต่อท้ายได้เหมือนเดิม แค่บังคับให้แก้ `FROZEN` ในใบเดียวกัน
   ซึ่งเป็นสิ่งที่หัวไฟล์นี้สั่งไว้อยู่แล้ว — ของที่เหลือแต่คำสั่งคือของที่หลุดรอบถัดไป */
for (const [table, frozen] of Object.entries(FROZEN)) {
  test(`${table} — ลำดับคอลัมน์ต้องตรงกับที่ชีตใช้อยู่ ของใหม่ต่อท้ายพร้อมแก้ FROZEN (app.js)`, () => {
    const now = appCols()[table];
    assert.ok(now, `SYNC_COLS ไม่มีตาราง ${table}`);
    assert.deepEqual(now, frozen,
      `ลำดับคอลัมน์ของ ${table} ไม่ตรงกับที่ชีตจริงใช้อยู่ — ของใหม่ต้องต่อท้าย ห้ามแทรกกลาง\n` +
      `และถ้าต่อท้ายจริง ต้องต่อท้ายใน FROZEN ของไฟล์นี้ในใบเดียวกันด้วย\n` +
      `FROZEN : ${frozen.join(' ')}\nโค้ดใช้ : ${now.join(' ')}`);
  });

  test(`${table} — ลำดับคอลัมน์ต้องตรงกับที่ชีตใช้อยู่ ของใหม่ต่อท้ายพร้อมแก้ FROZEN (.gs)`, () => {
    const now = gsCols()[table];
    assert.deepEqual(now, frozen,
      `ลำดับคอลัมน์ของ ${table} ใน Apps Script ไม่ตรงกับ FROZEN\n` +
      `FROZEN : ${frozen.join(' ')}\nโค้ดใช้ : ${now.join(' ')}`);
  });
}

/* 🚨 **ต้องเทียบ "ชุดชื่อตาราง" ทั้งสองทิศด้วย ไม่ใช่วนเฉพาะคีย์ของ FROZEN**
   ลูปข้างบนเดินจาก `FROZEN` เป็นตัวตั้ง จึงมีรูสองทาง และ **ผู้ตรวจ #136 รอบ 9 รันพิสูจน์ทั้งคู่**
   · เพิ่ม **ตารางที่หก** ครบทั้ง `.gs` + `app.js` โดยไม่แตะ `FROZEN` → เขียวหมด
     แปลว่าตารางนั้น **ไม่เคยถูกตรึงเลย** ใบถัดไปแทรกคอลัมน์กลางรายการของมันได้โดยไม่มีอะไรฟ้อง
   · **ลบตารางออกจาก `FROZEN`** → เขียวหมดเหมือนกัน เงียบ ๆ แค่จำนวนข้อหายไปสอง
   เป็นรูคลาสเดียวกับที่รอบ 5 จับได้ (`now.slice(0, frozen.length)`) — ด่านที่ "เขียวเพราะไม่ได้ตรวจ" */
test('ชื่อตารางใน FROZEN ต้องตรงกับที่โค้ดประกาศ ครบทั้งสองทิศ', () => {
  const frozen = Object.keys(FROZEN).sort();
  for (const [name, cols] of [['app.js', appCols()], ['.gs', gsCols()]]) {
    assert.deepEqual(Object.keys(cols).sort(), frozen,
      `${name} ประกาศตารางไม่ตรงกับ FROZEN — เพิ่มตารางใหม่ต้องเพิ่มใน FROZEN ด้วยในใบเดียวกัน\n` +
      `FROZEN : ${frozen.join(' ')}\nโค้ดใช้ : ${Object.keys(cols).sort().join(' ')}`);
  }
});

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
