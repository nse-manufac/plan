// เทสหน้าจอใบส่งสินค้า และการกรอกฟอร์ม FM-ST-07
//
// หน้านี้เป็นที่แรกที่ "การคีย์ของพนักงาน" ไปสร้าง record ยอดส่งของให้เอง
// ถ้ายอดคิดผิด Dashboard · การ์ด WIP · และยอดที่ส่งลูกค้าจะผิดตามกันหมดโดยไม่มีใครรู้

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const JSZip = require('jszip');
const { deliveryFormWorkbook } = require('./fixtures');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const DATE = '2026-08-29';

const order = (poNo, pn, qty, orderDate, unit = 'TUE-U') => ({
  id: poNo + '|' + pn, week: 'WK 34', poNo, pn, subName: unit, orderQty: qty, orderDate,
  status: 'active', importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});

const ORDERS = [
  order('PO-A001', '9000000001', 12000, '2026-08-03'),
  order('PO-A004', '9000000004', 9000, '2026-08-05'),
  order('PO-B070', '9000000070', 200, '2026-07-20', 'TUE-H')
];

async function open(page, orders = ORDERS, records = [], unit = 'TUE-U') {
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.fill('#dnDate', DATE);
  await page.waitForTimeout(150);
  // หน่วยเริ่มต้นคือตัวแรกตามตัวอักษร ต้องเลือกให้ตรงกับใบที่จะคีย์ก่อน
  if (unit) { await page.selectOption('#dnUnit', unit); await page.waitForTimeout(150); }
}

/** กรอกช่องหนึ่งแล้วรอให้บันทึก — ไม่มีปุ่มบันทึก บันทึกตอนออกจากช่อง (INVARIANTS G2) */
async function key(page, orderId, field, value) {
  const i = page.locator(`#dnTable input[data-order="${orderId}"][data-f="${field}"]`);
  await i.fill(String(value));
  await i.press('Tab');
  await page.waitForTimeout(150);
}

const readState = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), K_STATE);
const col = (page, n) => page.locator(`#dnTable tbody tr td:nth-child(${n})`).allInnerTexts();

test('A2 — คีย์ยอดบรรจุแล้วต้องเกิดยอดส่งของในสมุดให้เอง หนึ่งใบต่อหนึ่งวัน', async ({ page }) => {
  await open(page);
  await key(page, 'PO-A001|9000000001', 'perBox', 50);
  await key(page, 'PO-A001|9000000001', 'boxes', 30);

  const st = await readState(page);
  const ship = st.records.filter(r => r.process === 'shipping' && !r.voided);
  expect(ship.length, 'หนึ่ง order + shipping + หนึ่งวัน = หนึ่ง record').toBe(1);
  expect(ship[0].qty, '50 × 30 + 0 = 1,500 — สูตรเดียวกับในฟอร์ม').toBe(1500);
  expect(ship[0].date).toBe(DATE);
  expect(ship[0].note, 'ต้องบอกที่มาไว้ ไม่งั้นแยกจากยอดที่คีย์มือไม่ออก').toBe('จากใบส่งสินค้า');
});

test('A2 — แก้ตัวเลขที่พิมพ์ผิด ยอดต้องคิดใหม่ทั้งก้อน ไม่ใช่บวกทบ', async ({ page }) => {
  // ถ้าบวกทบ ยอดจะเบิ้ลทุกครั้งที่คนแก้ค่า และจับไม่ได้เลยจนกว่าจะสิ้นเดือน
  await open(page);
  await key(page, 'PO-A001|9000000001', 'perBox', 50);
  await key(page, 'PO-A001|9000000001', 'boxes', 30);
  await key(page, 'PO-A001|9000000001', 'boxes', 10);    // แก้ใหม่

  const st = await readState(page);
  const ship = st.records.filter(r => r.process === 'shipping' && !r.voided);
  expect(ship.length, 'ยังต้องมี record เดียว').toBe(1);
  expect(ship[0].qty, '50 × 10 = 500 ไม่ใช่ 1,500 + 500').toBe(500);
});

test('Wip bal. บนใบต้องเป็นยอดค้างก่อนส่งรอบนี้ ไม่ใช่หลังส่ง', async ({ page }) => {
  // ในฟอร์มมีสูตร W = G − P (ค้าง ลบ ที่ส่งรอบนี้ = เหลือเท่าไหร่)
  // ถ้า G เป็นยอดหลังหักไปแล้ว สูตรนั้นจะหักซ้ำสองรอบและอ่านไม่ได้ความ
  await open(page);
  await key(page, 'PO-A001|9000000001', 'perBox', 50);
  await key(page, 'PO-A001|9000000001', 'boxes', 30);

  const wip = (await col(page, 6))[0];
  const pcs = (await col(page, 10))[0];
  expect(wip, 'ยังต้องเป็นยอดเต็มของใบ ไม่ถูกหักด้วยของที่กำลังจะส่ง').toBe('12,000');
  expect(pcs).toBe('1,500');
});

test('G2 — ตัวเลือกหน่วยต้องไม่มี "ทั้งหมด" เพราะใบหนึ่งใบเป็นของหน่วยเดียว', async ({ page }) => {
  await open(page, ORDERS, [], null);
  const opts = await page.locator('#dnUnit option').allInnerTexts();
  expect(opts, 'ถ้ามี "ทั้งหมด" ตารางจะว่างตั้งแต่เปิดหน้าโดยไม่มีอะไรบอกว่าทำไม')
    .toEqual(['TUE-H', 'TUE-U']);
  expect(await page.locator('#dnUnit').inputValue(), 'ต้องเลือกหน่วยแรกให้เลย').toBe('TUE-H');
});

test('A1 — ใบที่ส่งครบแล้วต้องหายจากรายการ แต่บรรทัดที่คีย์วันนี้ต้องยังอยู่ให้แก้ได้', async ({ page }) => {
  await open(page, ORDERS, [{
    id: 'S1', date: '2026-08-20', orderId: 'PO-A004|9000000004', process: 'shipping', qty: 9000,
    note: '', deviceName: 't', createdAt: 'x', updatedAt: 'x', voided: false, _dirty: false
  }]);
  expect(await col(page, 2), 'ใบที่ส่งครบไปแล้วไม่ต้องโผล่มาให้กรอกอีก').toEqual(['PO-A001']);

  await key(page, 'PO-A001|9000000001', 'perBox', 1);
  await key(page, 'PO-A001|9000000001', 'boxes', 12000);
  expect(await col(page, 2), 'ส่งครบแล้วแต่เป็นบรรทัดของวันนี้ ต้องยังอยู่ให้แก้ตัวเลขที่พิมพ์ผิดได้')
    .toEqual(['PO-A001']);
});

// ── ออกไฟล์ฟอร์ม FM-ST-07 ──────────────────────────────────────────

async function exportForm(page, opts = {}) {
  const src = await deliveryFormWorkbook(['TUE-U', 'TUE-H'], opts);
  await page.setInputFiles('#dnTemplateInput',
    { name: 'FM-ST-07.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: src });
  await expect(page.locator('#btnDnExport')).toBeEnabled();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnDnExport')]);
  return { src, out: fs.readFileSync(await dl.path()) };
}

test('ไฟล์ของผู้ใช้ต้องไม่ถูกทำลาย — ออกใบแล้วทุกส่วนของฟอร์มต้องอยู่ครบ เปลี่ยนแค่ชีตเดียว', async ({ page }) => {
  await open(page);
  await key(page, 'PO-A001|9000000001', 'perBox', 50);
  await key(page, 'PO-A001|9000000001', 'boxes', 30);

  const { src, out } = await exportForm(page);
  const za = await JSZip.loadAsync(src), zb = await JSZip.loadAsync(out);
  const names = z => Object.keys(z.files).filter(n => !z.files[n].dir).sort();
  expect(names(zb), 'ห้ามมีส่วนไหนของไฟล์หายไปหรือโผล่เพิ่ม').toEqual(names(za));

  const changed = [];
  for (const n of names(za)) {
    if (await za.file(n).async('string') !== await zb.file(n).async('string')) changed.push(n);
  }
  expect(changed, 'ต้องแตะชีตของหน่วยที่ออกใบเท่านั้น').toEqual(['xl/worksheets/sheet1.xml']);

  expect(out.length / src.length, 'ต้องยังบีบอัดอยู่ ไม่ใช่พองขึ้นหลายเท่า').toBeLessThan(1.3);
});

test('ห้ามแตะสูตรของฟอร์ม — Aging · จำนวน/PCS · Fail · ยอดรวมท้ายตาราง ต้องรอดครบ', async ({ page }) => {
  await open(page);
  await key(page, 'PO-A001|9000000001', 'perBox', 50);
  await key(page, 'PO-A001|9000000001', 'boxes', 30);

  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');

  expect((xml.match(/<f>TODAY\(\)-E\d+<\/f>/g) || []).length, 'สูตร Aging ต้องอยู่ครบ 86 แถว').toBe(86);
  expect((xml.match(/<f>M\d+\*N\d+\+O\d+<\/f>/g) || []).length, 'สูตร จำนวน/PCS ต้องอยู่ครบ').toBe(86);
  expect((xml.match(/<f>G\d+-P\d+<\/f>/g) || []).length, 'สูตร Fail ต้องอยู่ครบ').toBe(86);
  expect(xml, 'ยอดรวมท้ายตารางต้องไม่ถูกแตะ').toContain('SUM(P10:P95)');

  const at = ref => (new RegExp('<c r="' + ref + '"[^>]*>\\s*<v>([^<]*)</v>').exec(xml) || [])[1];
  expect(at('F10'), 'PO QTY').toBe('12000');
  expect(at('G10'), 'Wip bal. ต้องเป็นยอดก่อนส่งรอบนี้ ไม่งั้นสูตร Fail หักซ้ำสองรอบ').toBe('12000');
  expect(at('M10')).toBe('50');
  expect(at('N10')).toBe('30');
  expect(xml, 'หัวใบต้องบอกหน่วยและวันที่ของใบนี้').toContain('Date___29/8/26__(WK 34)');
});

test('แถวที่เหลือจากใบครั้งก่อนต้องถูกล้าง ไม่ให้ของเก่าปนมาในใบใหม่', async ({ page }) => {
  await open(page);
  await key(page, 'PO-A001|9000000001', 'perBox', 50);
  await key(page, 'PO-A001|9000000001', 'boxes', 30);

  const { out } = await exportForm(page, { stale: true });
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  expect(xml, 'ข้อความของใบครั้งก่อนต้องหายไป').not.toContain('ของเก่าที่ต้องหาย');
  expect(xml, 'และตัวเลขบรรจุของเก่าก็ต้องไม่ค้าง').not.toContain('<v>999</v>');
});

test('G2 — กด Tab ไล่คีย์ทีละช่อง โฟกัสต้องไม่หลุด', async ({ page }) => {
  // change ยิงตอนกด Tab ซึ่งเบราว์เซอร์ย้ายโฟกัสไปช่องถัดไปแล้ว
  // ถ้าโค้ดวาดตารางใหม่ทั้งใบตรงนั้น ช่องที่เพิ่งได้โฟกัสจะถูกทิ้ง
  // แล้วพนักงานต้องคลิกทีละช่องทั้งวัน
  await open(page);
  const first = page.locator(`#dnTable input[data-order="PO-A001|9000000001"][data-f="perBox"]`);
  await first.fill('50');
  await first.press('Tab');
  await page.waitForTimeout(200);

  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el && el.dataset ? { f: el.dataset.f, order: el.dataset.order } : null;
  });
  expect(focused, 'โฟกัสต้องอยู่ที่ช่องถัดไปของแถวเดิม ไม่ใช่หลุดไปที่ body')
    .toEqual({ f: 'boxes', order: 'PO-A001|9000000001' });

  // และค่าที่เพิ่งคีย์ต้องถูกบันทึกไปแล้วจริง ไม่ใช่แค่โฟกัสไม่หลุด
  const st = await readState(page);
  expect(st.deliveryNotes[0].perBox).toBe(50);
});

test('ช่องวันที่ที่แอปสร้างขึ้นใหม่ ต้องได้รูปแบบวันที่ ไม่ใช่โชว์เป็นเลขดิบ', async ({ page }) => {
  // ฟอร์มจริงมีบางแถวที่ยังไม่มีช่องนั้นอยู่เลย แอปต้องสร้างขึ้นมาเอง
  // ช่องใหม่ที่ไม่มีรูปแบบจะโชว์ 46237 แทน 03/08/2026 ซึ่งอ่านไม่รู้เรื่องบนกระดาษ
  await open(page);
  await key(page, 'PO-A001|9000000001', 'perBox', 50);
  await key(page, 'PO-A001|9000000001', 'boxes', 30);
  await key(page, 'PO-A004|9000000004', 'perBox', 10);
  await key(page, 'PO-A004|9000000004', 'boxes', 5);

  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  const styleAt = ref => (new RegExp('<c r="' + ref + '"[^>]*s="([0-9]+)"').exec(xml) || [])[1];

  expect(styleAt('E10'), 'แถวแรกมีรูปแบบอยู่แล้ว ต้องไม่ถูกทำหาย').toBeTruthy();
  expect(styleAt('E11'), 'แถวที่สองแอปสร้างช่องขึ้นใหม่ ต้องหยิบรูปแบบของคอลัมน์เดียวกันมาใช้')
    .toBe(styleAt('E10'));
});
