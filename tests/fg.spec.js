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
const deltaRow = (orderId, week, wip) => ({
  id: 'DW-' + orderId + '-' + week, orderId, week: String(week), wip, fileName: 'c.xlsx',
  deviceName: 't', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  voided: false, _dirty: false
});

async function open(page, orders, records = [], deltaWip = []) {
  await page.addInitScript(([k, o, r, d]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: d, importHistory: []
  })), [K_STATE, orders, records, deltaWip]);
  await page.goto(APP);
  await page.click('.tab-btn[data-tab="fg"]');
  await page.waitForTimeout(200);
}

/** อ่านแถวของกลุ่มหนึ่งออกมาเป็นข้อความ */
const rowOf = (page, pn, unit) =>
  page.locator(`#fgTable tr.fg-row[data-pn="${pn}"][data-unit="${unit}"]`).innerText();

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
  await expect(page.locator('#fgCardPanel')).toBeVisible();

  const rows = await page.locator('#fgCardTable tbody tr').allInnerTexts();
  expect(rows.length, 'สามการเคลื่อนไหว').toBe(3);
  expect(rows[0], 'ยอดสะสมหลังรับเข้าครั้งแรก').toContain('3,000');
  expect(rows[1], 'บวกอีก 1,500').toContain('4,500');
  expect(rows[2], 'หักที่ส่งออก 1,200').toContain('3,300');
});

test('การ์ดต้องเทียบราย PO และบอกว่ายอดของ Delta มาจากงวดไหน', async ({ page }) => {
  await open(page, [order('PO-A1', PN_A, 5000), order('PO-A2', PN_A, 5000)], [],
                   [deltaRow('PO-A1|' + PN_A, 34, 5000)]);
  await page.click(`#fgTable tr.fg-row[data-pn="${PN_A}"][data-unit="TUE-U"]`);

  const cmp = await page.locator('#fgCardCmp tbody').innerText();
  expect(cmp, 'ต้องบอกงวดของไฟล์ เพราะ Delta ถามย้อนหลังเป็นราย PO').toContain('wk34');
  expect(cmp, 'ใบที่ Delta ไม่มีข้อมูล ต้องบอกตรง ๆ ว่าไม่มี ไม่ใช่โชว์ 0').toContain('ไม่มี');
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
  await page.click('.tab-btn[data-tab="fg"]');
  await page.waitForTimeout(200);
  expect(await cellOf(page, PN_A, 'TUE-U', 2), 'ยังไม่มีของรับเข้าเลย').toBe('0');

  // ปล่อยข้อมูลหลังจากอยู่บนหน้า FG แล้ว แล้วเดินนาฬิกาให้ตัวจับเวลาซิงค์ทำงาน
  releaseData = true;
  await page.clock.runFor(21000);
  await expect.poll(() => page.evaluate(k => JSON.parse(localStorage.getItem(k)).records.length, K_STATE),
    { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(200);

  expect(await cellOf(page, PN_A, 'TUE-U', 2),
    'ข้อมูลที่ซิงค์ดึงเข้ามาต้องขึ้นบนหน้านี้ทันที ไม่ใช่รอจนสลับแท็บ').toBe('2,500');
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
