// เทสหน้ายอดคงคลัง FG
//
// ── สามจำนวนที่ห้ามสับสนกัน ───────────────────────────────────────
//   FG คงเหลือ         Σ inspection − Σ shipping   ของที่อยู่ในคลังตอนนี้
//   ยอดค้างส่งของเรา    Σ (orderQty − shipped)      เรายังติดลูกค้าเท่าไหร่
//   ยอดค้างส่งของ Delta Σ deltaWip จากไฟล์          Delta คิดว่าเราติดเขาเท่าไหร่
//
// FG เทียบกับของ Delta ไม่ได้ เพราะ FG ไม่รวมของที่ยังไม่ได้ผลิต ส่วนยอดค้างส่งรวม
// เทสข้อ "FG ไม่เท่ากับยอดค้างส่ง" มีไว้กันคนเผลอเอามาเทียบผิดคู่ในอนาคต
//
// ⚠️ ไม่มีที่ไหนเก็บยอดคงเหลือไว้เป็นตัวเลข คิดสดจากสมุดทุกครั้ง (กฎเดียวกับ A1)

const { test, expect } = require('@playwright/test');
const { readSaved, waitReady } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const PN_A = '9000000002', PN_B = '9000000004';

const order = (poNo, pn, qty, unit = 'TUE-U') => ({
  id: poNo + '|' + pn, week: 'WK 34', poNo, pn, subName: unit, orderQty: qty,
  orderDate: '2026-08-03', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, process, qty, date = '2026-08-20', extra = {}) => Object.assign({
  id, date, orderId, process, qty, note: '', deviceName: 't',
  createdAt: date + 'T00:00:00.000Z', updatedAt: date + 'T00:00:00.000Z', voided: false, _dirty: false
}, extra);
/** ⚠️ createdAt ต้องต่างกันตามงวด ห้ามให้ทุกแถวเท่ากัน — ดูเหตุผลเต็มใน delivery-note.spec.js */
const deltaRow = (orderId, week, wip, createdAt) => ({
  id: 'DW-' + orderId + '-' + week, orderId, week: String(week), wip, fileName: 'c.xlsx',
  deviceName: 't',
  createdAt: createdAt || weekStamp(week), updatedAt: createdAt || weekStamp(week),
  voided: false, _dirty: false
});
function weekStamp(week){
  return new Date(Date.UTC(2026, 0, 1) + Number(week) * 7 * 86400000).toISOString();
}

async function open(page, orders, records = [], deltaWip = []) {
  await page.addInitScript(([k, o, r, d]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: d, importHistory: []
  })), [K_STATE, orders, records, deltaWip]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="fg"]');
  await page.waitForTimeout(200);
}

/** อ่านแถวของกลุ่มหนึ่งออกมาเป็นข้อความ */
const rowOf = (page, pn, unit) =>
  page.locator(`#fgTable tr.fg-row[data-pn="${pn}"][data-unit="${unit}"]`).innerText();

/** แถวที่กางออกมาใต้แถวของกลุ่ม — ต้องกดแถวนั้นก่อน ไม่งั้นเนื้อในยังไม่ถูกวาด (ดู fgSubRow) */
const subOf = (page, pn, unit) =>
  page.locator(`#fgTable tr.fg-sub[data-pn="${pn}"][data-unit="${unit}"]`);
/** ตารางเทียบราย PO ในแถวที่กางออกมา */
const cmpOf = (page, pn, unit) => subOf(page, pn, unit).locator('table.fg-cmp tbody');

const ORDERS = [
  order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 5000),
  order('PO-B1', PN_A, 3000, 'TUE-H'), order('PO-C1', PN_B, 4000)
];

test('FG คงเหลือ = ยอดที่ผ่าน Inspection ลบยอดที่ส่งออก', async ({ page }) => {
  await open(page, ORDERS, [
    rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000),
    rec('r2', 'PO-A1|' + PN_A, 'shipping', 1200, '2026-08-22'),
    rec('r3', 'PO-A2|' + PN_A, 'inspection', 1500, '2026-08-21')
  ]);
  const r = await rowOf(page, PN_A, 'TUE-U');
  expect(r, 'รับเข้า 3,000 + 1,500').toContain('4,500');
  expect(r, 'ส่งออก 1,200').toContain('1,200');
  expect(r, 'คงเหลือ 4,500 − 1,200').toContain('3,300');
});

test('ยอดที่ยกเลิกแล้วต้องไม่นับ (A1)', async ({ page }) => {
  await open(page, ORDERS, [
    rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000),
    rec('r2', 'PO-A1|' + PN_A, 'inspection', 500, '2026-08-21', { voided: true })
  ]);
  expect(await rowOf(page, PN_A, 'TUE-U'), 'ยอด 500 ที่ยกเลิกต้องไม่ถูกนับ').toContain('3,000');
});

test('ของแต่ละหน่วยต้องไม่ปนกัน', async ({ page }) => {
  await open(page, ORDERS, [
    rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000),
    rec('r2', 'PO-B1|' + PN_A, 'inspection', 900, '2026-08-21')
  ]);
  // P/N เดียวกันแต่คนละหน่วย ต้องเป็นคนละแถวและยอดไม่รวมกัน
  expect(await rowOf(page, PN_A, 'TUE-U')).toContain('3,000');
  const h = await rowOf(page, PN_A, 'TUE-H');
  expect(h).toContain('900');
  expect(h, 'ห้ามเอายอดของอีกหน่วยมารวม').not.toContain('3,900');
});

test('FG คงเหลือ ไม่ใช่จำนวนเดียวกับยอดค้างส่ง', async ({ page }) => {
  // สั่ง 5,000 · ผ่าน Inspection แค่ 3,000 · ส่งไปแล้ว 1,200
  //   FG คงเหลือ  = 3,000 − 1,200 = 1,800   (ของที่อยู่ในคลัง)
  //   ยอดค้างส่ง  = 5,000 − 1,200 = 3,800   (รวมของที่ยังไม่ได้ผลิตอีก 2,000)
  await open(page, [order('PO-A1', PN_A, 5000)], [
    rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000),
    rec('r2', 'PO-A1|' + PN_A, 'shipping', 1200, '2026-08-22')
  ]);
  const r = await rowOf(page, PN_A, 'TUE-U');
  expect(r, 'FG คงเหลือ').toContain('1,800');
  expect(r, 'ยอดค้างส่งของเรา — คนละเลขกับ FG').toContain('3,800');
});

test('ส่งออกมากกว่าที่ผ่าน Inspection ต้องเตือน แต่ห้ามซ่อนหรือครอบยอด', async ({ page }) => {
  // ของจริงมีคีย์ย้อนหลัง ยอดติดลบจึงเกิดได้ — เตือนได้ แต่ห้ามกลบ (แบบเดียวกับ Bin Card v2)
  await open(page, [order('PO-C1', PN_B, 4000)], [
    rec('r1', 'PO-C1|' + PN_B, 'inspection', 400),
    rec('r2', 'PO-C1|' + PN_B, 'shipping', 900, '2026-08-24')
  ]);
  const r = await rowOf(page, PN_B, 'TUE-U');
  expect(r, 'ต้องโชว์ค่าติดลบตามจริง ไม่ครอบเป็น 0').toContain('-500');
  expect(r, 'และต้องเตือน').toContain('ติดลบ');
});

test('เทียบกับ Delta ต้องเทียบเฉพาะใบที่ Delta มีข้อมูล และบอกว่ากี่ใบ', async ({ page }) => {
  // ⚠️ ถ้าเอาผลบวกของ 2 ใบไปเทียบกับยอด Delta ที่มีแค่ใบเดียว จะสรุปว่า "ไม่ตรง" ทั้งที่ทั้งสองฝั่งถูก
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 5000)], [
    rec('r2', 'PO-A1|' + PN_A, 'shipping', 1200, '2026-08-22')
  ], [deltaRow('PO-A1|' + PN_A, 34, 3800)]);

  const r = await rowOf(page, PN_A, 'TUE-U');
  expect(r, 'ยอดค้างของเราทั้งกลุ่ม = 3,800 + 5,000').toContain('8,800');
  expect(r, 'ยอดของ Delta มีแค่ใบเดียว').toContain('3,800');
  expect(r, 'เทียบเฉพาะใบที่ Delta มี จึงตรงเท่าที่เทียบได้').toContain('ตรงเท่าที่เทียบได้');
  expect(r, 'และต้องบอกว่าเทียบได้กี่ใบจากกี่ใบ').toContain('1/2');

  // ⚠️ ห้ามขึ้นว่า "ตรงกันทุกใบ" ตอนที่ยังเทียบไม่ครบ
  //    คนกวาดตาผ่านจะอ่านว่าทุกอย่างเรียบร้อย ทั้งที่ยังมีใบที่ไม่รู้ว่าตรงหรือเปล่า
  expect(r, 'ยังมีใบที่เทียบไม่ได้ ห้ามบอกว่าตรงกันทุกใบ').not.toContain('ตรงกันทุกใบ');
});

/* ⚠️ Delta **ตัดใบที่ส่งครบแล้วออกจากไฟล์งวดใหม่** ไม่ได้ใส่ 0 ให้ (ดู deltaWipOf ใน CLAUDE.md)
      การที่ใบนั้นไม่มียอดของ Delta จึงเป็น "เรื่องปกติ" ไม่ใช่ "ช่องว่างข้อมูล"
      สองข้อนี้ต้องมีคู่กัน — ข้อบน (เทียบได้ 1/2) คุมใบที่ **ยังค้างส่ง** แล้วไม่มีในไฟล์
      ซึ่งต้องฟ้องต่อไป · ข้อนี้คุมใบที่ **ส่งครบแล้ว** ซึ่งต้องไม่ฟ้อง
      แก้ให้ข้อนี้ผ่านด้วยการเลิกนับใบที่ไม่มีในไฟล์ทั้งหมด = ข้อบนแดงทันที */
test('ใบที่ส่งครบแล้วต้องไม่ถูกนับว่า "เทียบไม่ได้" — Delta ตัดใบนั้นออกจากไฟล์เอง', async ({ page }) => {
  // PO-A1 ส่งครบ 5,000/5,000 → ยอดค้าง 0 · Delta ไม่มีแถวให้ ซึ่งถูกต้องตามที่เขาทำไฟล์
  // PO-A2 ยังค้าง 2,500 และอยู่ในไฟล์ตรงกันพอดี → ใบที่ต้องเทียบ เทียบครบแล้วและตรง
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 3000)], [
    rec('i1', 'PO-A1|' + PN_A, 'inspection', 5000),
    rec('s1', 'PO-A1|' + PN_A, 'shipping', 5000),
    rec('i2', 'PO-A2|' + PN_A, 'inspection', 3000),
    rec('s2', 'PO-A2|' + PN_A, 'shipping', 500)
  ], [deltaRow('PO-A2|' + PN_A, 34, 2500)]);

  const r = await rowOf(page, PN_A, 'TUE-U');
  expect(r, 'ยอดค้างที่เหลืออยู่ตรงกับไฟล์ทั้งหมด จึงต้องขึ้นว่าตรงกันทุกใบ')
    .toContain('ตรงกันทุกใบ');
  expect(r, 'ใบที่ส่งครบแล้วไม่ใช่ใบที่ "เทียบไม่ได้"').not.toContain('ตรงเท่าที่เทียบได้');
});

/* ⚠️ ตัวหารของ "เทียบได้ X/Y ใบ" ต้องเป็น **ใบที่ต้องเทียบ** ไม่ใช่ทุกใบในกลุ่ม
      ไม่มีข้อนี้แล้วตัวหารจะกลับไปเป็น g.orders.length ได้โดยไม่มีอะไรจับ — ป้ายจะอ่านว่า
      "เทียบได้ 1/3" ทั้งที่ใบที่สามส่งจบไปแล้วและไม่มีอะไรให้เทียบ (ทดลองแล้วเทสที่มีไม่แดงสักข้อ) */
test('สัดส่วน "เทียบได้" ต้องนับแต่ใบที่ต้องเทียบ ไม่เอาใบที่ส่งครบแล้วมาเป็นตัวหาร', async ({ page }) => {
  // A1 ส่งครบ (ไม่ต้องเทียบ) · A2 ค้าง 2,500 และอยู่ในไฟล์ · A3 ค้าง 1,000 แต่ไม่มีในไฟล์
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 3000), order('PO-A3', PN_A, 1000)], [
    rec('i1', 'PO-A1|' + PN_A, 'inspection', 5000),
    rec('s1', 'PO-A1|' + PN_A, 'shipping', 5000),
    rec('s2', 'PO-A2|' + PN_A, 'shipping', 500)
  ], [deltaRow('PO-A2|' + PN_A, 34, 2500)]);

  const r = await rowOf(page, PN_A, 'TUE-U');
  expect(r, 'ยังมีใบที่ค้างแล้วไม่อยู่ในไฟล์ จึงต้องฟ้องต่อไป').toContain('ตรงเท่าที่เทียบได้');
  expect(r, 'ใบที่ต้องเทียบมีสองใบ เทียบได้แล้วหนึ่ง').toContain('1/2');
  expect(r, 'ห้ามเอาใบที่ส่งครบแล้วมาเป็นตัวหาร').not.toContain('1/3');
});

test('ทุกใบส่งครบแล้วและ Delta ไม่มียอด ต้องบอกว่าไม่มีอะไรต้องเทียบ ไม่ใช่ชวนให้รอข้อมูล', async ({ page }) => {
  // ค่าตั้งต้นของหน้านี้ไม่ซ่อนกลุ่มที่ของหมด กลุ่มแบบนี้จึงโผล่อยู่บนจอจริง
  await open(page, [order('PO-A1', PN_A, 5000)], [
    rec('i1', 'PO-A1|' + PN_A, 'inspection', 5000),
    rec('s1', 'PO-A1|' + PN_A, 'shipping', 5000)
  ], []);
  const r = await rowOf(page, PN_A, 'TUE-U');
  expect(r, '"ยังไม่มียอดของ Delta" อ่านว่ารอข้อมูลอยู่ ซึ่งไม่จริง').not.toContain('ยังไม่มียอดของ Delta');
  expect(r).toContain('ไม่มีอะไรต้องเทียบ');
});

test('เทียบครบทุกใบแล้วตรง ถึงจะขึ้นว่าตรงกันทุกใบ', async ({ page }) => {
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 3000)], [], [
    deltaRow('PO-A1|' + PN_A, 34, 5000),
    deltaRow('PO-A2|' + PN_A, 34, 3000)
  ]);
  const r = await rowOf(page, PN_A, 'TUE-U');
  expect(r, 'ทุกใบมีข้อมูลสองฝั่งและตรงกันหมด').toContain('ตรงกันทุกใบ');
  expect(r, 'ไม่ต้องบอกสัดส่วนเพราะครบอยู่แล้ว').not.toContain('เทียบได้');
});

test('ยอดค้างไม่ตรงกับ Delta ต้องเตือน แต่ห้ามบล็อกอะไร', async ({ page }) => {
  await open(page, [order('PO-A1', PN_A, 5000)], [], [deltaRow('PO-A1|' + PN_A, 34, 4200)]);
  const r = await rowOf(page, PN_A, 'TUE-U');
  expect(r, 'ของเรา 5,000 ของ Delta 4,200 ต่าง +800').toContain('+800');
  expect(await page.locator('#fgSummary').innerText()).toContain('ไม่ตรงกับ Delta');
});

test('กดที่แถวแล้วต้องเห็นการเคลื่อนไหวไล่ตามวันพร้อมยอดสะสม', async ({ page }) => {
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 5000)], [
    rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000, '2026-08-20'),
    rec('r3', 'PO-A2|' + PN_A, 'inspection', 1500, '2026-08-21'),
    rec('r2', 'PO-A1|' + PN_A, 'shipping', 1200, '2026-08-22')
  ]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  await expect(subOf(page, PN_A, 'TUE-U')).toBeVisible();

  // ⚠️ ต้องกดกางกล่องก่อนอ่าน — innerText ของของที่ซ่อนอยู่คืนค่าว่าง
  await subOf(page, PN_A, 'TUE-U').locator('details.fg-moves summary').click();
  const rows = await subOf(page, PN_A, 'TUE-U').locator('table.fg-mv tbody tr').allInnerTexts();
  expect(rows.length, 'สามการเคลื่อนไหว').toBe(3);
  expect(rows[0], 'ยอดสะสมหลังรับเข้าครั้งแรก').toContain('3,000');
  expect(rows[1], 'บวกอีก 1,500').toContain('4,500');
  expect(rows[2], 'หักที่ส่งออก 1,200').toContain('3,300');
});

test('แถวที่กางออกมาต้องบอก PO Date กับ PO qty. ของแต่ละใบ', async ({ page }) => {
  /* เจ้าของขอสองช่องนี้เมื่อ 17 พ.ย. 2569 เพื่อเทียบกับไฟล์ Call In ของ Delta ได้ทีละบรรทัด
     ไฟล์ของเขามีคอลัมน์ PO NO กับ PO QTY อยู่แล้ว จึงใช้คำเดียวกัน ไม่แปลเป็นไทย
     PO Date มาจาก orderDate ช่องเดียวกับที่หน้าคีย์ยอดใช้คิด Aging ไม่ได้เพิ่มข้อมูลใหม่ */
  await open(page, [order('PO-A1', PN_A, 5000)]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);

  const head = await subOf(page, PN_A, 'TUE-U').locator('table.fg-cmp thead').innerText();
  expect(head, 'ใช้คำเดียวกับไฟล์ของ Delta').toContain('PO qty.');
  expect(head).toContain('PO Date');

  const td = cmpOf(page, PN_A, 'TUE-U').locator('tr').first().locator('td');
  expect(await td.nth(1).innerText(), 'วันที่ของใบสั่ง รูปแบบเดียวกับทั้งแอป').toBe('03/08/2026');
  expect(await td.nth(2).innerText(), 'ยอดสั่งของใบนั้น').toBe('5,000');
});

test('ยอดราย PO ที่กางออกมา บวกกันต้องเท่ากับเลขบนแถวของกลุ่ม', async ({ page }) => {
  /* แถวของกลุ่มกับรายการที่กางออกมาอยู่ติดกัน คนจะบวกตามด้วยตาทันที
     ถ้าสองชั้นคิดคนละชุดใบ จะได้เลขไม่ตรงกันโดยไม่มีอะไรฟ้อง แล้วเลิกเชื่อทั้งหน้า
     (หลักเดียวกับแถบข้อมูลย้อนแย้งกับรายการที่กางจากมัน) */
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 3000)], [
    rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000, '2026-08-20'),
    rec('r2', 'PO-A1|' + PN_A, 'shipping',   1200, '2026-08-22'),
    rec('r3', 'PO-A2|' + PN_A, 'inspection', 1500, '2026-08-21')
  ]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);

  const num = s => Number(String(s).replace(/,/g, ''));
  let qtySum = 0, inSum = 0, outSum = 0;
  for(const r of await cmpOf(page, PN_A, 'TUE-U').locator('tr').all()){
    const td = r.locator('td');
    qtySum += num(await td.nth(2).innerText());
    inSum  += num(await td.nth(3).innerText());
    outSum += num(await td.nth(4).innerText());
  }
  expect(qtySum, 'PO qty. ของสองใบรวมกัน').toBe(8000);
  expect(inSum, 'รับเข้ารวม').toBe(4500);
  expect(outSum, 'ส่งออกรวม').toBe(1200);
  expect(await cellOf(page, PN_A, 'TUE-U', 2), 'ต้องตรงกับช่องรับเข้าของแถวกลุ่ม').toBe('4,500');
  expect(await cellOf(page, PN_A, 'TUE-U', 3), 'ต้องตรงกับช่องส่งออกของแถวกลุ่ม').toBe('1,200');
});

test('โหมดพิมพ์ต้องไม่มีลูกศรติดไปหน้าชื่อ P/N', async ({ page }) => {
  /* บนกระดาษไม่มีอะไรให้กด ลูกศรจึงเป็นขยะที่ไปเกาะหน้าชื่อ P/N — ผู้ตรวจ #142 รอบ 3
     รันวัดได้ว่าช่องนั้นมีลูกศรนำหน้าชื่อ P/N ขณะที่ก่อนใบนี้เป็นชื่อ P/N ล้วน
     repo ตัดลูกศรของ .wtexp ทิ้งบนกระดาษอยู่แล้ว ข้อนี้คือกฎเดียวกันของหน้านี้
     ⚠️ ต้องอ่านชื่อ P/N ว่ายังอยู่ด้วย ไม่ใช่วัดแค่ว่าไม่มีลูกศร — ซ่อนทั้งปุ่มก็ผ่านข้อนั้นได้
        แล้วชื่อ P/N หายจากกระดาษเงียบ ๆ ซึ่งแย่กว่ามีลูกศรเกินมาก */
  await open(page, [order('PO-A1', PN_A, 5000)]);
  await page.emulateMedia({ media: 'print' });
  const cell = await page.locator(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"] td`).first().innerText();
  expect(cell, 'ลูกศรต้องไม่ติดไปบนกระดาษ').not.toContain('▶');
  expect(cell, 'แต่ชื่อ P/N ต้องยังพิมพ์ติดครบ').toContain(PN_A);
  await page.emulateMedia({ media: 'screen' });
  expect(await page.locator(`#fgTable tr.fg-row[data-pn="${PN_A}"] .fg-caret`).first().isVisible(),
    'บนจอต้องยังเห็นลูกศร — มันคือสิ่งเดียวที่บอกว่าแถวนี้กดได้').toBe(true);
});
test('โหมดพิมพ์: แถวที่กางต้องไม่พิมพ์ของที่กดไม่ได้ แต่เลขต้องติดครบ', async ({ page }) => {
  /* ผู้ตรวจ #142 รอบ 4 เปิดดูกระดาษจริงแล้วเจอของที่กดไม่ได้อีกสองชิ้นในแถวที่กาง —
     ลูกศรของ <details> หัวกล่องการเคลื่อนไหว และปุ่ม ✎ แก้ ในช่องของ Delta
     🚨 ของที่ต้องไม่หายคือ "เลข" — ยอด Wip bal. อยู่ใน <td> เดียวกับปุ่ม ซ่อนทั้งช่องแล้ว
        เลขที่คนอ่านกระดาษต้องเห็นหายไปด้วย ซึ่งแย่กว่ามีปุ่มเกินมาก (ข้อนี้จึงวัดสองทิศ)
     ⚠️ ลูกศรของ <details> เป็น marker ของเบราว์เซอร์ ไม่ใช่ข้อความ อ่านจาก innerText ไม่เจอ
        จึงวัดที่ `list-style-type` ซึ่งเป็นสิ่งที่ทำให้มันหาย — วัดถัดจากตัวจริงหนึ่งขั้น
        แต่เป็นที่เดียวที่จับได้ด้วยโปรแกรม (ภาพหน้าจอเป็นของคนดู) */
  await open(page, [order('PO-A1', PN_A, 5000)],
    [rec('r1', 'PO-A1|' + PN_A, 'shipping', 1000, '2026-08-28')],
    [deltaRow('PO-A1|' + PN_A, 35, 4000)]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const sub = subOf(page, PN_A, 'TUE-U');
  await sub.locator('details.fg-moves summary').click();
  await expect(sub.locator('.fg-dw-edit'),
    'ฉากนี้ต้องมีปุ่มแก้จริง ไม่งั้นข้อที่วัดปุ่มแก้ไม่ได้ตรวจอะไร').toHaveCount(1);

  await page.emulateMedia({ media: 'print' });
  expect(await sub.locator('.fg-dw-edit').first().isVisible(),
    'ปุ่ม ✎ แก้ ต้องไม่ติดกระดาษ').toBe(false);
  expect(await sub.locator('table.fg-cmp tbody tr td').nth(7).innerText(),
    'แต่ยอด Wip bal. ของ Delta ในช่องเดียวกันต้องยังพิมพ์ติด').toContain('4,000');
  expect(await sub.locator('details.fg-moves > summary')
      .evaluate(el=> getComputedStyle(el).listStyleType),
    'marker ของ <details> ต้องถูกปิดตอนพิมพ์').toBe('none');
  expect(await sub.locator('details.fg-moves > summary').innerText(),
    'แต่หัวกล่องต้องยังพิมพ์ติด มันทำหน้าที่เป็นหัวข้อย่อยบนกระดาษ').toContain('การเคลื่อนไหวรายวัน');

  await page.emulateMedia({ media: 'screen' });
  expect(await sub.locator('.fg-dw-edit').first().isVisible(),
    'บนจอต้องยังกดปุ่มแก้ได้').toBe(true);
});
test('G2 — วาดตารางใหม่ต้องไม่ลากตำแหน่งที่เลื่อนอ่านกลับ (preventScroll)', async ({ page }) => {
  /* el.focus() เปล่า ๆ เลื่อนของที่โฟกัสเข้ามาในจอให้ด้วย และของที่ fgRefocus() คืนโฟกัส
     อยู่ "ใน" .table-wrap ที่คนใช้เลื่อนอ่าน (กรอบ 70vh) → จอเด้งกลับไปที่แถวนั้นเอง
     ผู้ตรวจ #142 รอบ 5 รันวัดได้ 874 → 274 (เด้งขึ้น 600px) กลางที่กำลังอ่าน
     ทริกเกอร์เกิดจริงทุกวัน: renderAll() วาดใหม่ทุกครั้งที่รอบซิงค์ดึงแถวลงมา = ทุกครั้งที่
     เครื่องอื่นคีย์ยอด ขณะที่หน้านี้คือหน้าที่คนนั่งเทียบกับไฟล์ Call In ทีละบรรทัด

     🚨 ต้องวัด scrollTop — เทสข้อโฟกัสข้างบนวัดแค่ activeElement จึงเขียวทั้งก่อนและหลังแก้
     🚨 และต้องวัด "โฟกัสยังอยู่" คู่กันไป ไม่งั้นถอดการคืนโฟกัสทิ้งก็ผ่านข้อนี้ได้
        ซึ่งเป็นการแลกบั๊กหนึ่งกับอีกบั๊กหนึ่ง (ผู้ตรวจรอบ 1 ทักเรื่องโฟกัสตกมาก่อน)
     ⚠️ ต้องมีกลุ่มมากพอให้กรอบเลื่อนได้จริง — 30 กลุ่มที่จอ 1024x700 (กรอบ 70vh ≈ 490px)
        น้อยกว่านี้ตารางไม่ล้นกรอบ scrollTop เป็น 0 ทั้งก่อนและหลัง ด่านจะเขียวเอง */
  await page.setViewportSize({ width: 1024, height: 700 });
  const os = [], rs = [];
  for(let i = 0; i < 30; i++){
    const pn = '9100' + String(i).padStart(6, '0');
    os.push(order('PO-' + i, pn, 5000));
    rs.push(rec('r' + i, 'PO-' + i + '|' + pn, 'inspection', 3000, '2026-08-20'));
    rs.push(rec('s' + i, 'PO-' + i + '|' + pn, 'shipping', 1000, '2026-08-21'));
  }
  await open(page, os, rs);

  const wrap = () => page.evaluate(()=>
    document.getElementById('fgTable').closest('.table-wrap').scrollTop);
  const scrollTo = y => page.evaluate(y=>{
    document.getElementById('fgTable').closest('.table-wrap').scrollTop = y;
  }, y);
  const active = () => page.evaluate(()=>{
    const a = document.activeElement;
    return a.tagName === 'SUMMARY' ? 'summary' : (a.className || a.tagName);
  });

  // ── ฉากที่ 1: กางกลุ่มกลางตาราง กดหัวกล่องการเคลื่อนไหว แล้วเลื่อนลงไปอ่านท้ายกล่อง
  const pn10 = '9100' + String(10).padStart(6, '0');
  await page.click(`#fgTable tr.fg-row[data-pn="${pn10}"][data-unit="TUE-U"]`);
  await subOf(page, pn10, 'TUE-U').locator('details.fg-moves summary').click();
  await scrollTo(700);
  const before1 = await wrap();
  expect(before1, 'กรอบต้องเลื่อนได้จริง ไม่งั้นข้อนี้ไม่ได้วัดอะไร').toBeGreaterThan(300);
  await page.evaluate(()=> renderFg());
  expect(await wrap(), 'ตำแหน่งที่เลื่อนอ่านต้องไม่ขยับ').toBe(before1);
  expect(await active(), 'และโฟกัสต้องยังอยู่ที่หัวกล่องเดิม').toBe('summary');

  // ── ฉากที่ 2: โฟกัสปุ่ม P/N ของแถวแรก แล้วเลื่อนไปท้ายตาราง (ของที่โฟกัสอยู่นอกจอไปแล้ว)
  const pn0 = '9100' + String(0).padStart(6, '0');
  await page.locator(`#fgTable tr.fg-row[data-pn="${pn0}"][data-unit="TUE-U"] .fg-pn`).focus();
  await scrollTo(900);
  const before2 = await wrap();
  expect(before2, 'ต้องเลื่อนไปได้ไกลจริง').toBeGreaterThan(300);
  await page.evaluate(()=> renderFg());
  expect(await wrap(), 'ของที่โฟกัสอยู่นอกจอก็ต้องไม่ลากจอกลับไปหา').toBe(before2);
  expect(await active(), 'โฟกัสยังอยู่ที่ปุ่ม P/N เดิม').toContain('fg-pn');
});
test('เนื้อในของแถวที่พับอยู่ต้องว่าง — ห้ามวาดไว้ล่วงหน้าแล้วซ่อน', async ({ page }) => {
  /* fgMovesHtml() เรียก fgMoves() ซึ่งเดินผ่าน record ทั้งก้อนหนึ่งรอบ **ต่อกลุ่ม**
     ของจริง 180 กลุ่ม × ~14,000 รายการ = จ่ายทุกครั้งที่รอบซิงค์ดึงแถวลงมา โดยไม่มีใครดู
     fgToggle() จึงสร้างเนื้อในตอนกด และล้างทิ้งตอนพับ
     ⚠️ กฎข้อนี้เคยเหลือแต่คอมเมนต์ใน fgSubRow() (ผู้ตรวจ #142 รอบ 3 ทัก) ซึ่ง CLAUDE.md
        เตือนเองว่าเป็นกฎที่หลุดรอบถัดไป — หลักเดียวกับด่านตกกลับของ dayProcess
     🚨 ต้องวัดความยาวของ innerHTML ห้ามใช้ toBeVisible() — ของที่วาดไว้แล้วซ่อนก็ไม่ visible
        เหมือนกัน ด่านจะเขียวทั้งที่ราคายังจ่ายอยู่ ซึ่งเป็นสิ่งเดียวที่กฎข้อนี้มีไว้กัน
     ⚠️ และต้องกางซ้ำรอบสอง — ล้างแล้วสร้างกลับมาไม่ได้ พังหนักกว่าจ่ายแรงเกิน */
  await open(page, [order('PO-A1', PN_A, 5000)],
    [rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000, '2026-08-20')]);
  const row = `#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`;
  // `> td` ไม่ใช่ `td` เฉย ๆ — ตารางราย PO ข้างในมี td ของตัวเองสิบกว่าช่อง (เจอตอนรันครั้งแรก)
  const len = () => subOf(page, PN_A, 'TUE-U').locator(':scope > td').evaluate(el=> el.innerHTML.length);

  expect(await len(), 'ตั้งแต่เปิดมายังไม่มีใครกด ต้องว่าง').toBe(0);
  await page.click(row);
  expect(await len(), 'กดแล้วต้องมีเนื้อในจริง ไม่งั้นข้อนี้วัดของว่างกับของว่าง').toBeGreaterThan(100);
  await page.click(row);
  expect(await len(), 'พับแล้วต้องล้างทิ้ง ไม่ใช่ซ่อนไว้').toBe(0);
  await page.click(row);
  expect(await len(), 'กางซ้ำต้องสร้างกลับมาได้').toBeGreaterThan(100);
});
test('การเคลื่อนไหวรายวันต้องบอก PO Date กับ PO qty. ของใบนั้น ๆ ด้วย', async ({ page }) => {
  /* เจ้าของขอ 18 พ.ย. 2569 — ตารางราย PO ข้างบนมีสองคอลัมน์นี้แล้ว ตารางการเคลื่อนไหวยังไม่มี
     คนที่ไล่ทีละบรรทัดเทียบกับไฟล์ Call In จึงต้องเลื่อนกลับขึ้นไปดูว่าใบนั้นสั่งเท่าไหร่
     ⚠️ ฉากนี้ต้องมี **สองใบที่ `orderDate` และ `orderQty` ต่างกัน** และมี record คนละวัน
        ไม่งั้นการหยิบค่าจากใบผิด (เช่นใบแรกเสมอ) จะให้ผลถูกพอดี แล้วเทสเขียวทั้งที่พัง
     ⚠️ และต้องเรียงคอลัมน์เหมือนตารางราย PO (PO No. → PO Date → PO qty.) เพราะสองตาราง
        อยู่ในแถวเดียวกัน คนกวาดตาลงมาต้องเจอของเดิมที่ตำแหน่งเดิม */
  const osA = order('PO-A1', PN_A, 5000);
  // ยอดสั่งเป็นสตริงโดยเจตนา — เครื่องที่ซิงค์มาได้ค่าแบบนี้ (กฎเดียวกับ synced-numeric)
  const osB = Object.assign(order('PO-A2', PN_A, '1234567'), { orderDate: '2026-09-15' });
  await open(page, [osA, osB], [
    rec('r1', osA.id, 'inspection', 3000, '2026-08-20'),
    rec('r2', osB.id, 'inspection', 1500, '2026-08-21'),
    rec('r3', osA.id, 'shipping',   1200, '2026-08-22')
  ]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const sub = subOf(page, PN_A, 'TUE-U');
  await sub.locator('details.fg-moves summary').click();

  const heads = await sub.locator('table.fg-mv thead th').allInnerTexts();
  expect(heads.slice(0, 6), 'หัวตารางต้องเรียงเหมือนตารางราย PO').toEqual(
    ['วันที่', 'PO No.', 'PO Date', 'PO qty.', 'รับเข้า', 'ส่งออก']);
  /* 🚨 คอลัมน์สุดท้ายต้องบอกว่าเป็นยอดของ "ทั้งกลุ่ม" — ตารางราย PO ข้างบนมีคอลัมน์
     `FG คงเหลือ` ซึ่งเป็นของใบเดียว ส่วนเลขนี้เป็นยอดวิ่งของทุกใบรวมกัน
     แถวนี้มี `PO No.`/`PO qty.` กำกับอยู่ด้วย คนจึงอ่านว่าเป็นของใบนั้นได้ง่าย
     แล้วสรุปว่า "ยอดไม่ตรง" ทั้งที่ทั้งคู่ถูก (ผู้ตรวจ #142 รอบ 10 รันวัดได้ 700 vs 1,200)
     ⚠️ ต้องเป็นข้อความบนจอ ไม่ใช่ `title` — `title` ไม่ติดกระดาษและแป้นพิมพ์อ่านไม่ได้ */
  expect(heads[6].replace(/\s+/g, ' ').trim(), 'หัวคอลัมน์สุดท้ายต้องกำกับว่าเป็นของทั้งกลุ่ม')
    .toBe('คงเหลือ (ทั้งกลุ่ม)');

  const rows = sub.locator('table.fg-mv tbody tr');
  const cells = async i => (await rows.nth(i).locator('td').allInnerTexts()).map(s=> s.trim());
  // เรียงตามวัน: 20 (A1 รับเข้า) · 21 (A2 รับเข้า) · 22 (A1 ส่งออก)
  expect(await cells(0), 'แถวของ PO-A1').toEqual(
    ['20/08/2026', 'PO-A1', '03/08/2026', '5,000', '3,000', '', '3,000']);
  expect(await cells(1), 'แถวของ PO-A2 ต้องได้วันกับยอดของใบตัวเอง ไม่ใช่ของใบแรก').toEqual(
    ['21/08/2026', 'PO-A2', '15/09/2026', '1,234,567', '1,500', '', '4,500']);
  expect(await cells(2), 'แถวส่งออกของ PO-A1 ก็ต้องพก PO Date กับ PO qty. มาด้วย').toEqual(
    ['22/08/2026', 'PO-A1', '03/08/2026', '5,000', '', '1,200', '3,300']);
});
test('ใบที่ไม่มีวันสั่ง — PO Date ต้องเป็นขีดชนิดเดียวกับช่องว่างอื่นในแถว', async ({ page }) => {
  /* `fmtDateTH()` คืน `-` (hyphen) ส่วนช่องว่างอื่นของสองตารางนี้ใช้ `—` (em dash)
     ปล่อยไว้แล้วแถวเดียวมีขีดสองชนิดคนละความยาว (ผู้ตรวจ #142 รอบ 7 ทัก)
     ⚠️ ต้องวัดทั้งสองตาราง — `fgDate()` มีผู้เรียกสองที่ แก้ที่เดียวแล้วอีกที่ค้าง
     ⚠️ และต้องเทียบกับขีดของช่อง `งวด` ในแถวเดียวกันจริง ๆ ไม่ใช่เทียบกับตัวอักษรที่เขียนในเทส
        ไม่งั้นวันหนึ่งที่ช่องนั้นเปลี่ยนขีด เทสจะยังเขียวทั้งที่แถวกลับไปมีสองชนิด */
  const o = Object.assign(order('PO-A1', PN_A, 5000), { orderDate: '' });
  await open(page, [o], [rec('r1', o.id, 'inspection', 3000, '2026-08-20')]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const sub = subOf(page, PN_A, 'TUE-U');

  const cmpTds = sub.locator('table.fg-cmp tbody tr').first().locator('td');
  const weekDash = (await cmpTds.nth(8).innerText()).trim();   // ช่อง `งวด` ของใบที่ไม่มียอดของ Delta
  expect(weekDash, 'ฉากนี้ต้องมีช่องว่างอื่นให้เทียบจริง').toBe('—');
  expect((await cmpTds.nth(1).innerText()).trim(), 'PO Date ของตารางราย PO').toBe(weekDash);

  await sub.locator('details.fg-moves summary').click();
  const mvTds = sub.locator('table.fg-mv tbody tr').first().locator('td');
  expect((await mvTds.nth(2).innerText()).trim(), 'PO Date ของตารางการเคลื่อนไหว').toBe(weekDash);
});
test('record ที่วันที่อ่านไม่ออก — ช่อง วันที่ ก็ต้องเป็นขีดชนิดเดียวกัน', async ({ page }) => {
  /* ช่อง `วันที่` อยู่ติดกับ `PO Date` ในแถวเดียวกัน · แก้แต่ `PO Date` แล้วอาการเดิม
     (ขีดสองชนิดคนละความยาวในแถวเดียว) ย้ายไปอยู่คอลัมน์ข้าง ๆ (ผู้ตรวจ #142 รอบ 8 รันเจอ
     ได้แถว ["-","PO-A1","—","5,000"])
     ⚠️ เกิดได้เฉพาะเมื่อ `record.date` เพี้ยน (ทางชีต หรือรวมข้อมูลจากไฟล์ — ทางเดียวกับที่
        `escape-date.spec.js` จำลอง) ข้อมูลที่คีย์เองช่องนี้ไม่เคยว่าง
     ⚠️ ต้องเป็นสตริงที่ `split('-')` ไม่ได้สามชิ้น ไม่งั้น `fmtDateTH()` คืนค่าที่ประกอบได้
        แล้วไม่มีขีดให้วัด (ลองแล้ว) */
  const o = order('PO-A1', PN_A, 5000);
  await open(page, [o], [rec('r1', o.id, 'inspection', 3000, 'ไม่ใช่วันที่')]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const sub = subOf(page, PN_A, 'TUE-U');
  await sub.locator('details.fg-moves summary').click();

  const tds = sub.locator('table.fg-mv tbody tr').first().locator('td');
  const poDate = (await tds.nth(2).innerText()).trim();
  expect(poDate, 'ฉากนี้ PO Date ต้องมีวันจริง ไม่งั้นไม่ได้เทียบสองชนิด').toBe('03/08/2026');
  expect((await tds.nth(0).innerText()).trim(), 'ช่องวันที่ต้องเป็น em dash ไม่ใช่ hyphen').toBe('—');
});
test('ลากเลือกตัวเลขบนแถวกลุ่ม — แถวที่กางอยู่ต้องไม่หุบ', async ({ page }) => {
  /* เบราว์เซอร์ยิง `click` ให้การลากเมาส์ด้วย และตัวจับผูกไว้ทั้งแถว
     หน้านี้คือหน้าที่คนก๊อปเลขไปเทียบกับไฟล์ Call In ของ Delta ทีละบรรทัด
     ลากคลุมเลขแล้วแถวที่กางอยู่หุบทิ้งทันที = เสียของที่เพิ่งกางกลางที่กำลังอ่าน
     (ผู้ตรวจ #142 รอบ 11 รันวัด · เป็นของใหม่จากใบนี้ ตัวจับเดิมเรียก renderFgCard() ซึ่งกดซ้ำได้)
     ⚠️ ต้องลากด้วยเมาส์จริง (down → move → up) ไม่ใช่ setSelection ด้วยสคริปต์
        ทางสคริปต์ไม่ยิง click จึงไม่มีอะไรให้ด่านกัน
     ⚠️ และต้องวัดว่าได้ข้อความที่เลือกจริง — ลากไม่ติดแล้วด่านจะเขียวเพราะไม่มี selection
        ไม่ใช่เพราะโค้ดถูก */
  await open(page, [order('PO-A1', PN_A, 5000)],
    [rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000, '2026-08-20')]);
  const row = page.locator(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  await row.click();
  await expect(subOf(page, PN_A, 'TUE-U'), 'ต้องกางได้ก่อน').toBeVisible();

  // ลากคลุมเลขในช่อง FG คงเหลือ ของแถวกลุ่ม
  const cell = row.locator('td').nth(4);
  const b = await cell.boundingBox();
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();

  expect((await page.evaluate(()=> document.getSelection().toString())).trim(),
    'ต้องลากเลือกได้จริง ไม่งั้นด่านนี้ไม่ได้ตรวจอะไร').not.toBe('');
  await expect(subOf(page, PN_A, 'TUE-U'), 'แถวที่กางไว้ต้องยังกางอยู่').toBeVisible();
});

test('การเคลื่อนไหววันเดียวกันหลายใบ ต้องเรียงด้วย PO ไม่ใช่ตามลำดับในอาร์เรย์', async ({ page }) => {
  /* ตัวเทียบเดิม (`a.kind==='inspection' ? -1 : 1`) คืน −1 ทั้งสองทิศเมื่อวันกับขั้นเท่ากัน
     = ไม่สอดคล้องกันเอง ลำดับจึงขึ้นกับอัลกอริทึมของ V8 · ผู้ตรวจ #142 รอบ 11 รันวัดได้ **กลับทาง**
     ⚠️ เครื่องที่นำเข้าไฟล์เองกับเครื่องที่ซิงค์มาได้ลำดับในอาร์เรย์คนละแบบ สองคนเปิดเทียบกัน
        จะไล่บรรทัดตรงกันไม่ได้ (กฎเดียวกับรายการใบย้อนแย้งและหน้ายอดรายวันทุกขั้น)
     ⚠️ ต้องใส่ record แบบ **สลับลำดับ** โดยเจตนา ถ้าใส่เรียงตาม PO มาแล้วจะเขียวเองทั้งที่ไม่มีชั้นที่สาม
     ⚠️ และ PO ต้องเป็นเลขล้วนหนึ่งใบ — ค่าที่ซิงค์มาเป็น `number` ได้ แล้ว `localeCompare` ตรง ๆ
        จะ throw ทำให้ทั้งตารางไม่ขึ้น (กฎ cmpText) */
  const os = ['300', 'PO-A2', 'PO-A1'].map(no => order(no, PN_A, 5000));
  await open(page, os, [
    rec('r3', 'PO-A1|' + PN_A, 'inspection', 300, '2026-08-20'),
    rec('r1', '300|' + PN_A,   'inspection', 100, '2026-08-20'),
    rec('r2', 'PO-A2|' + PN_A, 'inspection', 200, '2026-08-20')
  ]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const sub = subOf(page, PN_A, 'TUE-U');
  await sub.locator('details.fg-moves summary').click();

  const rows = sub.locator('table.fg-mv tbody tr');
  const po = async i => (await rows.nth(i).locator('td').nth(1).innerText()).trim();
  expect([await po(0), await po(1), await po(2)], 'เรียงตามรหัส PO').toEqual(['300', 'PO-A1', 'PO-A2']);
  // ยอดวิ่งต้องยังบวกครบทุกรายการ ไม่ว่าจะเรียงอย่างไร
  expect((await rows.nth(2).locator('td').nth(6).innerText()).trim(), 'ยอดวิ่งตัวสุดท้าย').toBe('600');
});
test('กางแถวค้างไว้แล้วหน้าวาดใหม่ ต้องไม่หุบเอง', async ({ page }) => {
  /* renderAll() วาดหน้านี้ใหม่ทุกครั้งที่รอบซิงค์ดึงแถวลงมา ถ้าเปิดแท็บนี้ค้างไว้ — ไม่จำสถานะการกางไว้
     แถวที่คนเพิ่งกางจะหุบเองกลางที่กำลังอ่าน และโฟกัสตกไป BODY (G2)
     ข้อนี้ยิงผ่านช่องค้นหา ซึ่งเรียก renderFg() ตัวเดียวกับที่ซิงค์เรียก */
  await open(page, [order('PO-A1', PN_A, 5000)]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  await subOf(page, PN_A, 'TUE-U').locator('details.fg-moves summary').click();

  await page.fill('#fgSearch', PN_A.slice(0, 4));
  await page.waitForTimeout(150);
  await expect(subOf(page, PN_A, 'TUE-U'), 'แถวที่กางไว้ต้องยังกางอยู่').toBeVisible();
  await expect(subOf(page, PN_A, 'TUE-U').locator('details.fg-moves'),
    'กล่องการเคลื่อนไหวที่เพิ่งเปิดก็ต้องไม่หุบตาม').toHaveAttribute('open', '');
});
test('กางแถวค้างไว้แล้วหน้าวาดใหม่ โฟกัสต้องไม่ตกไป BODY (G2)', async ({ page }) => {
  /* ของที่กดได้ในตารางนี้มีสามชิ้น และทั้งสามอยู่ใน #fgTable ซึ่งถูกเขียนทับทั้งก้อนทุกรอบซิงค์
     ปุ่ม ✎ แก้ เคยอยู่ในการ์ดที่ renderAll() ไม่เคยวาดใหม่ โฟกัสจึงรอด — ย้ายเข้าตารางแล้วไม่รอด
     (ผู้ตรวจ #142 วัดได้ BODY ทั้งปุ่มแก้และหัวกล่องการเคลื่อนไหว)
     🚨 ต้องเรียก renderFg() ตรง ๆ ห้ามยิงผ่านช่องค้นหาเหมือนข้อข้างบน — การพิมพ์ลงช่องนั้น
        ย้ายโฟกัสไปที่ช่องค้นหาเอง ด่านจึงไม่มีฟันเลย · รอบซิงค์ของจริงวาดใหม่โดยไม่แตะโฟกัสใคร */
  await open(page, [order('PO-A1', PN_A, 5000)],
    [rec('r1', 'PO-A1|' + PN_A, 'shipping', 1000, '2026-08-28')],
    [deltaRow('PO-A1|' + PN_A, 35, 4000)]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const sub = subOf(page, PN_A, 'TUE-U');
  await sub.locator('details.fg-moves summary').click();
  await expect(sub.locator('.fg-dw-edit'),
    'ฉากนี้ต้องมีปุ่มแก้จริง ไม่งั้นข้อที่วัดปุ่มแก้ไม่ได้ตรวจอะไร').toHaveCount(1);

  /** โฟกัสของในแถวที่กาง แล้วให้หน้าวาดใหม่ แล้วบอกว่าโฟกัสไปอยู่ที่อะไร */
  const after = async sel => {
    await sub.locator(sel).focus();
    await page.evaluate(()=> renderFg());
    return page.evaluate(()=> {
      const a = document.activeElement;
      return a.tagName === 'SUMMARY' ? 'summary' : (a.className || a.tagName);
    });
  };

  expect(await after('details.fg-moves summary'), 'หัวกล่องการเคลื่อนไหว').toBe('summary');
  expect(await after('.fg-dw-edit'), 'ปุ่ม ✎ แก้').toContain('fg-dw-edit');

  // ปุ่ม P/N อยู่บนแถวของกลุ่ม ไม่ได้อยู่ในแถวที่กาง — ของเดิม ตรึงไว้ไม่ให้หลุดตอนแก้
  await page.locator(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"] .fg-pn`).focus();
  await page.evaluate(()=> renderFg());
  expect(await page.evaluate(()=> document.activeElement.className), 'ปุ่ม P/N').toContain('fg-pn');
});
test('กางแถวแล้วต้องไม่ดันตารางของกลุ่มให้กว้างขึ้น (จอ 819)', async ({ page }) => {
  /* 819 CSS px = จอ 1024 ซูม 125% ซึ่งเครื่องหน้างานตั้งจริง · ตารางกลุ่มพอดีขอบอยู่แล้ว
     ตารางราย PO กว้างกว่านั้น ถ้าไม่รัดไว้มันจะดันตารางกลุ่มให้ล้น แล้วคอลัมน์ `ต่าง`
     ของแถวที่กำลังอ่านเลยขอบไปตอนกาง (ผู้ตรวจ #142 วัดได้ 761 vs 737)
     ที่รัดไว้คือ `#fgTable tr.fg-sub > td{max-width:0}` ตารางราย PO จึงเลื่อนในแถวตัวเองแทน
     ⚠️ ต้องตั้งจอให้แคบจริง — ที่จอกว้าง (วัดที่ 1400) ไม่มีการล้นให้จับ ด่านจะเขียวเอง
     ⚠️ และต้องใช้ข้อมูลยาวแบบของจริง (P/N มีท้าย -REV-C · ยอดเจ็ดหลัก · มีปุ่มแก้ของ Delta) */
  await page.setViewportSize({ width: 819, height: 900 });
  const PN = PN_A + '-REV-C';
  const os = ['TM5267H012', 'TM5267H013', 'TM5267H014'].map(no =>
    Object.assign(order(no, PN, 1234567), { id: no + '|' + PN }));
  const rs = [], dws = [];
  os.forEach((o, i) => {
    rs.push(rec('i' + i, o.id, 'inspection', 1200000 + i, '2026-08-20'));
    // ⚠️ ส่งต้องมากกว่าที่ Delta นับส่งแล้ว (ยอดสั่ง − Wip bal.) ช่องของ Delta จึงมีบรรทัด
    //    "ไฟล์ … − Delta ยังไม่นับ …" ติดมา ซึ่งเป็นตัวที่ทำให้ตารางราย PO กว้างจริงแบบของจริง
    //    ไม่มีบรรทัดนั้นแล้วตารางพอดีขอบเอง ด่านนี้จะเขียวทั้งที่ถอด max-width:0 ออก (ลองแล้ว)
    rs.push(rec('s' + i, o.id, 'shipping', 500000 + i, '2026-08-22'));
    dws.push(deltaRow(o.id, 35, 900000));
  });
  await open(page, os, rs, dws);

  const width = () => page.evaluate(()=> {
    const w = document.getElementById('fgTable').closest('.table-wrap');
    return {scroll: w.scrollWidth, client: w.clientWidth};
  });
  const before = await width();
  expect(before.scroll, 'ก่อนกางต้องพอดีขอบ ไม่งั้นข้อนี้วัดของอื่นอยู่').toBe(before.client);

  await page.click(`#fgTable tr.fg-row[data-pn="${PN}"][data-unit="TUE-U"]`);
  await expect(subOf(page, PN, 'TUE-U').locator('.fg-dw-edit'), 'ฉากนี้ต้องมีปุ่มแก้จริง').toHaveCount(3);
  const after = await width();
  expect(after.scroll, 'กางแล้วตารางกลุ่มต้องไม่กว้างขึ้น').toBe(before.scroll);
});

/* ── ใบที่ยกเลิกแล้วต้องไม่ถูกนับในหน้า FG ────────────────────────────
 *
 * fgRows() ใช้ activeOrders() อยู่แล้วตั้งแต่ #66 แต่ไม่มีเทสข้อไหนตรึงไว้
 * CTO agent ย้อนกลับไปใช้ state.orders ทั้งก้อน แล้วเทส fg ทั้ง 17 ข้อยังเขียว
 *
 * ที่พังคือ "ยอดคงเหลือ FG" ซึ่งเป็นเลขที่คนเอาไปตัดสินใจว่าจะส่งของได้เท่าไหร่
 * ใบที่พิมพ์รหัสผิดแล้วยกเลิกไปแล้ว จะกลับมาบวกยอดรับเข้าของมันเข้าไปด้วย */
test('ใบที่ยกเลิกแล้ว ต้องไม่ถูกนับในยอดคงคลัง FG', async ({ page }) => {
  const live = order('PO-A1', PN_A, 5000);
  const dead = Object.assign(order('PO-A2', PN_A, 5000), { voided: true });

  await open(page, [live, dead], [
    rec('R1', 'PO-A1|' + PN_A, 'inspection', 3000),
    rec('R2', 'PO-A2|' + PN_A, 'inspection', 1500)   // ยอดของใบที่ยกเลิก ต้องไม่ถูกนับ
  ]);

  const row = page.locator(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  await expect(row, 'ยังต้องมีแถวของ P/N นี้ เพราะใบที่ใช้งานอยู่ยังมี').toHaveCount(1);
  expect(await cellOf(page, PN_A, 'TUE-U', 2),
    'รับเข้าต้องนับเฉพาะใบที่ใช้งานอยู่ ไม่รวม 1,500 ของใบที่ยกเลิก').toBe('3,000');
  expect(await cellOf(page, PN_A, 'TUE-U', 4), 'FG คงเหลือต้องเป็น 3,000 ตาม').toBe('3,000');
  expect(await cellOf(page, PN_A, 'TUE-U', 5),
    'ยอดค้างส่งของเราต้องนับเฉพาะใบที่ใช้งานอยู่').toBe('5,000');
});

test('ใบที่ยกเลิกแล้ว ต้องไม่โผล่ในตัวเลือกหน่วยของหน้า FG', async ({ page }) => {
  // ใบเดียวของหน่วย TUE-H และถูกยกเลิกไปแล้ว — หน่วยนั้นต้องไม่มีให้เลือก
  await open(page, [
    order('PO-A1', PN_A, 5000),
    Object.assign(order('PO-H1', PN_B, 400, 'TUE-H'), { voided: true })
  ]);
  const units = await page.locator('#fgUnit option').allInnerTexts();
  expect(units, 'หน่วยที่เหลือแต่ใบที่ยกเลิก ต้องไม่มีให้เลือก').not.toContain('TUE-H');
  expect(units, 'ส่วนหน่วยที่ยังมีใบใช้งานอยู่ ต้องยังอยู่').toContain('TUE-U');
});

test('แถวที่กางต้องเทียบราย PO และบอกว่ายอดของ Delta มาจากงวดไหน', async ({ page }) => {
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 5000)], [],
                   [deltaRow('PO-A1|' + PN_A, 34, 5000)]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);

  const cmp = await cmpOf(page, PN_A, 'TUE-U').innerText();
  expect(cmp, 'ต้องบอกงวดของไฟล์ เพราะ Delta ถามย้อนหลังเป็นราย PO').toContain('wk34');
  expect(cmp, 'ใบที่ Delta ไม่มีข้อมูล ต้องบอกตรง ๆ ว่าไม่มี ไม่ใช่โชว์ 0').toContain('ไม่มี');
});

test('ยอดค้างของ Delta นับเฉพาะงวดล่าสุด — ใบที่ส่งครบแล้ว Delta ตัดออกจากไฟล์ ต้องไม่ค้างยอดของงวดเก่า', async ({ page }) => {
  // เจ้าของเจอ 14 ก.ย. 2026 — Delta ไม่ใส่ 0 ให้ใบที่ส่งครบ แต่ตัดออกจากไฟล์งวดใหม่ไปเลย
  // แถวของงวดก่อนค้างอยู่เป็นประวัติ ถ้าหยิบโดยไม่ดูงวด ยอดค้างของ Delta จะเกินไปตลอด (ดู deltaWipOf)
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 5000)], [
    rec('r1', 'PO-A1|' + PN_A, 'shipping', 5000, '2026-08-22')
  ], [
    deltaRow('PO-A1|' + PN_A, 34, 800),       // งวดเก่า — ตอนนั้นยังค้าง
    deltaRow('PO-A2|' + PN_A, 35, 5000)       // งวดล่าสุด — ไม่มี PO-A1 แล้ว
  ]);

  expect(await cellOf(page, PN_A, 'TUE-U', 6), 'ค้างส่ง (Delta) ต้องเป็นของงวดล่าสุดเท่านั้น ไม่ใช่ 5,800')
    .toBe('5,000');
  /* ⚠️ PO-A1 ส่งครบแล้ว **และ** Delta ตัดออกจากไฟล์งวดล่าสุด = สองฝั่งเห็นตรงกันว่าใบนี้จบแล้ว
        จึงไม่ใช่ใบที่ "เทียบไม่ได้" · ข้อนี้เคยเขียน toContain('1/2') ซึ่งเป็นการจดพฤติกรรมที่
        เจ้าของสั่งให้เลิกทำเมื่อ 6 พ.ย. 2026 (ป้ายเหลืองขึ้นเกือบทุกแถวจนไม่เหลือความหมาย)
        สิ่งที่ข้อนี้มีไว้คุมคือ "ยอดของ Delta ต้องเป็นของงวดล่าสุด" ซึ่งเช็กไว้บรรทัดบนแล้ว */
  expect(await rowOf(page, PN_A, 'TUE-U'), 'ใบที่ยังค้างมีใบเดียวและตรงกับไฟล์งวดล่าสุด')
    .toContain('ตรงกันทุกใบ');

  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const cmp = await cmpOf(page, PN_A, 'TUE-U').innerText();
  expect(cmp, 'ตารางราย PO ต้องไม่อ้างยอดของงวดเก่า').not.toContain('wk34');
});

/* ── หน้า FG หักยอดที่เราส่งแล้วแต่ Delta ยังไม่นับ (เจ้าของเลือก 15 ก.ย. 2026) ─────────────
 *
 * Delta นับส่งแล้ว = ยอดสั่ง − Wip bal. · ส่วนที่เราส่งเกินจากนั้นหักออกจากยอดของ Delta
 * เกณฑ์ของ #87 หักตามวันนำเข้าไฟล์ แล้วพังกับของจริง — ส่งของหลายรอบก่อนวันนำเข้าไฟล์ แต่ไฟล์ยังให้ค้างเต็มยอดสั่ง
 * โปรแกรมจึงไม่หักเลย · ⚠️ ข้อมูลในเทสเป็นเลขสมมติ ห้ามเอาตัวเลขจากภาพหน้าจอของจริงมาใส่ (repo เป็น public) */
test('Delta ยังไม่นับยอดส่งเลย — ยอดของ Delta ต้องหักยอดที่เราส่งทั้งหมด แม้ส่งก่อนวันนำเข้าไฟล์', async ({ page }) => {
  await open(page, [order('PO-A1', PN_A, 6000)], [
    rec('r1', 'PO-A1|' + PN_A, 'shipping', 500, '2026-08-24'),
    rec('r2', 'PO-A1|' + PN_A, 'shipping', 1800, '2026-08-26'),
    rec('r3', 'PO-A1|' + PN_A, 'shipping', 1200, '2026-08-28')
  ], [deltaRow('PO-A1|' + PN_A, 36, 6000, '2026-09-02T05:00:00.000Z')]);   // นำเข้าหลังส่งครบทุกรอบ

  expect(await cellOf(page, PN_A, 'TUE-U', 5), 'ค้างส่ง (เรา) 6,000 − 3,500').toBe('2,500');
  expect(await cellOf(page, PN_A, 'TUE-U', 6), 'ค้างส่ง (Delta) 6,000 − ที่ Delta ยังไม่นับ 3,500').toBe('2,500');
  expect(await rowOf(page, PN_A, 'TUE-U'), 'หักแล้วตรงกันพอดี').toContain('ตรงกันทุกใบ');

  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const cmp = await cmpOf(page, PN_A, 'TUE-U').innerText();
  expect(cmp, 'ตารางราย PO บอกยอดในไฟล์').toContain('ไฟล์ 6,000');
  expect(cmp, 'และบอกว่าหักส่วนที่ Delta ยังไม่นับไปเท่าไหร่').toContain('Delta ยังไม่นับ 3,500');
});

test('Delta นับยอดส่งไปแล้วบางส่วน — หักเฉพาะส่วนที่เราส่งเกินจากที่ Delta นับ', async ({ page }) => {
  // ยอดสั่ง 5,000 · Wip bal. 3,000 = Delta นับส่งแล้ว 2,000 · เราส่ง 3,000 = Delta ยังไม่นับ 1,000
  await open(page, [order('PO-A1', PN_A, 5000)], [
    rec('r1', 'PO-A1|' + PN_A, 'shipping', 2000, '2026-08-28'),
    rec('r2', 'PO-A1|' + PN_A, 'shipping', 1000, '2026-09-03')
  ], [deltaRow('PO-A1|' + PN_A, 35, 3000)]);

  expect(await cellOf(page, PN_A, 'TUE-U', 5), 'ค้างส่ง (เรา) 5,000 − 3,000').toBe('2,000');
  expect(await cellOf(page, PN_A, 'TUE-U', 6), 'ค้างส่ง (Delta) 3,000 − 1,000 ห้ามหัก 2,000 ที่ Delta นับไปแล้วซ้ำ')
    .toBe('2,000');

  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  expect(await cmpOf(page, PN_A, 'TUE-U').innerText()).toContain('Delta ยังไม่นับ 1,000');
});

test('Delta นับยอดส่งมากกว่าที่เราคีย์ — ไม่หักอะไร และยังต้องเห็นว่าต่าง เพราะเราอาจลืมคีย์ยอดส่ง', async ({ page }) => {
  // ยอดสั่ง 5,000 · Wip bal. 1,000 = Delta นับส่งแล้ว 4,000 · เราคีย์ส่งแค่ 3,000
  await open(page, [order('PO-A1', PN_A, 5000)], [
    rec('r1', 'PO-A1|' + PN_A, 'shipping', 3000, '2026-08-28')
  ], [deltaRow('PO-A1|' + PN_A, 35, 1000)]);

  expect(await cellOf(page, PN_A, 'TUE-U', 5), 'ค้างส่ง (เรา) 5,000 − 3,000').toBe('2,000');
  expect(await cellOf(page, PN_A, 'TUE-U', 6), 'ค้างส่ง (Delta) ยังเป็นยอดในไฟล์').toBe('1,000');
  expect(await rowOf(page, PN_A, 'TUE-U'), 'สัญญาณว่าเราอาจลืมคีย์ยอดส่ง ต้องยังอยู่').toContain('+1,000');

  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  expect(await cmpOf(page, PN_A, 'TUE-U').innerText(), 'ไม่มีอะไรให้หัก').not.toContain('ยังไม่นับ');
});

test('ยอดที่แก้มือเป็นฐานของหน้า FG — แล้วค่อยหักส่วนที่ Delta ยังไม่นับ (เจ้าของสั่ง 15 ก.ย. 2026)', async ({ page }) => {
  // ยอดสั่ง 5,000 · ไฟล์ของ Delta ผิดเป็น 5,000 · แก้มือเป็น 3,000 (= Delta นับส่งแล้ว 2,000)
  // เราส่ง 2,500 → Delta ยังไม่นับ 500 → แสดง 2,500 ตรงกับของเรา · เลขสมมติ
  await open(page, [order('PO-A1', PN_A, 5000)], [
    rec('r1', 'PO-A1|' + PN_A, 'shipping', 2500, '2026-08-28')
  ], [Object.assign(deltaRow('PO-A1|' + PN_A, 35, 5000), {
    wipOverride: 3000, overrideNote: 'ทดสอบ', overrideBy: 'หัวหน้าทดสอบ', overrideAt: '2026-09-02T05:00:00.000Z' })]);

  expect(await cellOf(page, PN_A, 'TUE-U', 6), 'ค้างส่ง (Delta) = แก้มือ 3,000 − ยังไม่นับ 500').toBe('2,500');
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);
  const cmp = await cmpOf(page, PN_A, 'TUE-U').innerText();
  expect(cmp, 'ต้องบอกว่าฐานมาจากการแก้มือ ไม่ใช่จากไฟล์').toContain('แก้มือ 3,000 − Delta ยังไม่นับ 500');
  await expect(subOf(page, PN_A, 'TUE-U').locator('.fg-dw-edit'), 'แถวที่กางต้องมีปุ่มแก้').toHaveCount(1);
});

/** อ่านค่าในช่องหนึ่งของแถว — เจาะจงกว่าการดูข้อความทั้งแถว
 *  (เทสรอบแรกใช้ toContain('0') ซึ่งจริงเกือบตลอด เพราะ '5,000' ก็มี '0') */
const cellOf = (page, pn, unit, i) =>
  page.locator(`#fgTable tr.fg-row[data-pn="${pn}"][data-unit="${unit}"] td`).nth(i).innerText();

test('นั่งค้างหน้า FG แล้วซิงค์ดึงข้อมูลใหม่เข้ามา ตัวเลขต้องขยับตาม', async ({ page }) => {
  // แอปซิงค์เบื้องหลังทุก 20 วินาทีถ้าเปิด auto ไว้ — ถ้า renderAll() ไม่วาดหน้านี้ใหม่
  // คนที่จ้องหน้ายอดคงเหลืออยู่จะเห็นเลขเก่าโดยไม่รู้ตัว ซึ่งอันตรายกว่าหน้าอื่น
  // เพราะเป็นเลขที่เอาไปตัดสินใจว่าจะส่งของได้เท่าไหร่
  //
  // ⚠️ แอปซิงค์รอบแรกตั้งแต่ตอนเปิดหน้า ถ้าปล่อยให้ข้อมูลมาตั้งแต่รอบนั้น
  //    เทสจะไม่มีวันเจอสภาพ "ค้างของเก่า" เลย จึงกั้นไว้จนกว่าจะเข้าหน้า FG แล้ว
  await page.clock.install();

  let releaseData = false;
  const pulled = rec('sv1', 'PO-A1|' + PN_A, 'inspection', 2500, '2026-08-26');
  await page.route('**/exec', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const send = releaseData && body.action === 'pullRows' && body.table === 'Records';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, rows: send ? [pulled] : [],
                             serverTime: '2026-08-26T00:00:00.000Z' })
    });
  });

  await page.addInitScript(([k, sk, o]) => {
    localStorage.setItem(k, JSON.stringify({
      version: 1, deviceName: 't',
      deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
      chartPref: { mode: '14', from: '', to: '' },
      orders: o, records: [], deliveryNotes: [], deltaWip: [], importHistory: []
    }));
    localStorage.setItem(sk, JSON.stringify({ url: 'https://example.test/exec', token: 't', auto: true }));
  }, [K_STATE, 'tue_order_tracker_sync_v1', [order('PO-A1', PN_A, 5000)]]);

  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="fg"]');
  await page.waitForTimeout(200);
  expect(await cellOf(page, PN_A, 'TUE-U', 2), 'ยังไม่มีของรับเข้าเลย').toBe('0');

  // ปล่อยข้อมูลหลังจากอยู่บนหน้า FG แล้ว แล้วเดินนาฬิกาให้ตัวจับเวลาซิงค์ทำงาน
  releaseData = true;
  await page.clock.runFor(21000);
  await expect.poll(async () => (await readSaved(page, K_STATE)).records.length,
    { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(200);

  expect(await cellOf(page, PN_A, 'TUE-U', 2),
    'ข้อมูลที่ซิงค์ดึงเข้ามาต้องขึ้นบนหน้านี้ทันที ไม่ใช่รอจนสลับแท็บ').toBe('2,500');
});

/* ── ยอดส่งสะสม: ของที่คีย์ผิดต้องไม่ถูกกลบ ─────────────────────────
 *
 * 2 ก.ย. 2026 (#50) เคยเปลี่ยนคอลัมน์ Shipping ของแดชบอร์ดเป็น FG คงเหลือ
 * เจ้าของสั่งกลับเป็นยอดส่งเมื่อ 12 ก.ย. 2026 · **แท็บแดชบอร์ดถูกลบทั้งแท็บเมื่อ 12 พ.ย. 2569**
 * เทสสามข้อที่อ่านตารางกับการ์ดของหน้านั้นจึงถูกตัดไปพร้อมกัน (ไม่มีจอให้อ่านแล้ว)
 *
 * ⚠️ ข้อที่เหลือไว้คือข้อที่ยังมีความหมาย — **ส่งเกินที่ผ่าน Inspection ต้องฟ้อง ไม่ใช่กลบ**
 *    ตอนเป็นคอลัมน์ FG ช่องนั้นเคยโชว์ติดลบ · ตอนนี้ฟ้องที่แถบข้อมูลย้อนแย้งของหน้ายอดค้างรายวัน
 *    ซึ่งเป็นที่เดียวที่เหลืออยู่ · `computeStatus` กับหน้าใบส่งสินค้ายังใช้ยอดส่งเหมือนเดิม
 */

async function openWt(page, orders, records = []) {
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(300);
}

test('ส่งเกินที่ผ่าน Inspection — ต้องมีที่ฟ้อง ไม่ใช่ถูกกลบให้เท่า Inspection', async ({ page }) => {
  await openWt(page, [order('PO-D1', PN_A, 5000)], [
    rec('r1', 'PO-D1|' + PN_A, 'inspection', 400),
    rec('r2', 'PO-D1|' + PN_A, 'shipping', 900, '2026-08-22')
  ]);
  const bar = await page.locator('#wtAnom').innerText();
  expect(bar, 'ต้องฟ้องว่าใบนี้ยอดย้อนแย้ง').toContain('ข้อมูลย้อนแย้ง');

  await page.click('#wtAnomToggle');
  await page.waitForTimeout(250);
  const row = await page.locator('#wtAnom .wanr').first().innerText();
  expect(row, 'ต้องบอกคู่ขั้นที่เพี้ยนพร้อมยอดจริง ไม่ใช่ยอดที่ถูกครอบ').toContain('900');
  expect(row, 'และบอกว่าขั้นก่อนหน้าอยู่ที่เท่าไหร่').toContain('400');
});

test('G2 — พิมพ์ค้นหาแล้วโฟกัสต้องไม่หลุด', async ({ page }) => {
  await open(page, ORDERS, [rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000)]);
  await page.click('#fgSearch');
  await page.keyboard.type('90000000');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.activeElement.id),
    'ตารางวาดใหม่ทุกตัวอักษร ช่องค้นหาต้องยังถือโฟกัส').toBe('fgSearch');
  expect(await page.inputValue('#fgSearch')).toBe('90000000');
});

// เจ้าของเคาะใน issue #52 ว่าช่องเลือกที่ดึงตัวเลือกจาก subName ต้องเรียกชื่อเดียวกันทุกหน้า
// และให้ใช้คำว่า Sub-Name (ตรงกับหัวคอลัมน์ในไฟล์แผนงาน) — เป็นข้อยกเว้นของ G1 ที่เจ้าของ
// อนุมัติเอง เฉพาะป้ายช่องเลือกกับหัวตาราง ส่วนประโยคอธิบายยังเป็นไทยว่า "หน่วย" ตามเดิม
test('G1 — ป้ายช่องที่ดึงจาก subName ต้องเป็น Sub-Name เหมือนกันทุกหน้า', async ({ page }) => {
  await open(page, ORDERS, [rec('r1', 'PO-A1|' + PN_A, 'inspection', 3000)]);

  const labelOf = id => page.locator('#' + id).locator('xpath=preceding-sibling::label').innerText();

  expect(await labelOf('fgUnit'), 'หน้ายอดคงคลัง FG').toBe('Sub-Name');
  expect(await page.locator('#fgTable thead').innerText(),
    'หัวคอลัมน์ในตาราง FG ต้องเรียกชื่อเดียวกับช่องเลือก').toContain('Sub-Name');

  await page.click('.tab-btn[data-tab="delivery"]');
  await page.waitForTimeout(150);
  expect(await labelOf('dnUnit'), 'หน้าใบส่งสินค้า — จุดที่ผู้ใช้แจ้งเข้ามา').toBe('Sub-Name');
  // ประโยคอธิบายยังต้องเป็นภาษาไทย ห้ามเผลอแทนคำว่า "หน่วย" ทั้งไฟล์
  expect(await page.locator('#view-delivery .desc').first().innerText(),
    'G1 — ประโยคที่ผู้ใช้อ่านต้องยังเป็นภาษาไทย').toContain('หน่วย');

  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(150);
  // แท็บแดชบอร์ดเคยอยู่ในรายการนี้ด้วย ถูกลบทั้งแท็บเมื่อ 12 พ.ย. 2569
  expect(await labelOf('wtSubFilter'), 'หน้ายอดค้างรายวัน').toBe('Sub-Name');
});

test('"ส่งครบแล้ว" ต้องตัดสินจากยอดส่ง ไม่ใช่ FG คงเหลือ — ใบที่ยังไม่ทำอะไรเลย FG ก็เป็น 0', async ({ page }) => {
  /* 🚨 เทสข้อนี้มาแทนข้อ "ตัวกรองซ่อนงานที่ส่งของครบแล้ว" ที่หายไปพร้อมตารางของแดชบอร์ด
     (ผู้ตรวจ #134 รอบ 3 ทักว่าเกณฑ์ที่มันคุมยังมีผู้ใช้อยู่ แต่ไม่มีใครคุมแล้ว)
     เกณฑ์ `computeStatus() === 'done'` ยังตัดสินว่าใบไหนถูกนับในวงกลมของหน้ายอดค้างรายวัน
     🚨 **ฉากต้องแยก "ยอดส่ง" ออกจาก "FG คงเหลือ" ให้ได้คนละคำตอบ** ไม่งั้นเขียวทั้งสองแบบ
        · ใบ D1 ส่งครบ 5,000 → FG = 0 · ส่งครบ = จบ
        · ใบ D2 ยังไม่ทำอะไรเลย → FG = 0 **เหมือนกัน** แต่ยังไม่ส่งสักชิ้น = ยังไม่จบ
        ถ้าใครเผลอเอา FG ไปตัดสินแทนยอดส่ง ใบที่ยังไม่เริ่มทำจะถูกนับว่าเสร็จแล้วทันที */
  await openWt(page, [order('PO-D1', PN_A, 5000), order('PO-D2', PN_B, 5000)], [
    rec('r1', 'PO-D1|' + PN_A, 'inspection', 5000),
    rec('r2', 'PO-D1|' + PN_A, 'shipping', 5000, '2026-08-22')
  ]);
  const mid = await page.locator('#wtDue svg text').first().textContent();
  expect(mid, 'ต้องเหลือใบเดียวที่ยังไม่เสร็จ คือใบที่ยังไม่ส่งสักชิ้น').toBe('1');
});
