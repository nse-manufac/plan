// เทสหน้าจอใบส่งสินค้า และการกรอกฟอร์ม FM-ST-07
//
// ⚠️ หน่วยของการกรอกคือ P/N ไม่ใช่ PO — ตรงกับใบจริงที่ใช้อยู่หน้างาน
//    ของถูกบรรจุรวมกันตาม P/N (ช่องต่อกล่อง/กล่อง/เศษ ถูก merge ข้ามแถวในใบจริง)
//    แล้ว "คน" เป็นคนตัดยอดเข้าใบสั่งแต่ละใบเอง — ระบบห้ามเฉลี่ยให้
//
// หน้านี้เป็นที่แรกที่การคีย์ของพนักงานไปสร้าง record ยอดส่งของ
// ถ้ายอดคิดผิด Dashboard · การ์ด WIP · และยอดที่ส่งลูกค้าจะผิดตามกันหมดโดยไม่มีใครรู้

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const JSZip = require('jszip');
const { deliveryFormWorkbook } = require('./fixtures');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const DATE = '2026-08-29';
const PN_A = '9000000004', PN_B = '9000000002';

const order = (poNo, pn, qty, orderDate, unit = 'TUE-U') => ({
  id: poNo + '|' + pn, week: 'WK 34', poNo, pn, subName: unit, orderQty: qty, orderDate,
  status: 'active', importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});

// สอง P/N — ตัวหนึ่งครอบสองใบสั่ง อีกตัวครอบใบเดียว เลียนโครงของใบจริง
const ORDERS = [
  order('PO-B001', PN_B, 12000, '2026-08-03'),
  order('PO-B055', PN_B, 12000, '2026-08-10'),
  order('PO-A004', PN_A, 9000, '2026-08-05'),
  order('PO-H070', '9000000070', 200, '2026-07-20', 'TUE-H')
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
  if (unit) { await page.selectOption('#dnUnit', unit); await page.waitForTimeout(150); }
}

/** กรอกยอดบรรจุของกลุ่ม P/N — บันทึกตอนออกจากช่อง ไม่มีปุ่มบันทึก (INVARIANTS G2) */
async function pack(page, pn, field, value) {
  const i = page.locator(`#dnTable input.dn-pack[data-pn="${pn}"][data-f="${field}"]`);
  await i.fill(String(value)); await i.press('Tab'); await page.waitForTimeout(150);
}
/** ตัดยอดเข้าใบสั่งใบหนึ่ง */
async function alloc(page, orderId, value) {
  const i = page.locator(`#dnTable input.dn-alloc[data-order="${orderId}"]`);
  await i.fill(String(value)); await i.press('Tab'); await page.waitForTimeout(150);
}

const readState = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), K_STATE);
const leftCell = (page, pn) => page.locator(`#dnTable td[data-left="${pn}"]`).innerText();
const ships = st => st.records.filter(r => r.process === 'shipping' && !r.voided);

test('จัดกลุ่มตาม P/N — ยอดบรรจุกรอกครั้งเดียวต่อกลุ่ม ไม่ใช่ต่อใบสั่ง', async ({ page }) => {
  await open(page);
  expect(await page.locator('#dnTable tr.dn-group').count(), 'สอง P/N = สองหัวกลุ่ม').toBe(2);
  expect(await page.locator('#dnTable input.dn-pack[data-f="perBox"]').count(),
    'ช่องต่อกล่องต้องมีกลุ่มละช่องเดียว ไม่ใช่ใบสั่งละช่อง').toBe(2);
  expect(await page.locator('#dnTable input.dn-alloc').count(), 'ช่องตัดเข้าใบมีทุกใบสั่ง').toBe(3);
});

test('A2 — คนตัดยอดเข้าใบเอง ระบบต้องไม่เฉลี่ยให้ และลงเป็น record หนึ่งใบต่อวัน', async ({ page }) => {
  await open(page);
  await pack(page, PN_B, 'perBox', 50);
  await pack(page, PN_B, 'boxes', 30);           // รวม 1,500

  let st = await readState(page);
  expect(ships(st).length, 'กรอกยอดบรรจุอย่างเดียว ต้องยังไม่มียอดส่งของใบไหนเลย').toBe(0);

  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await alloc(page, 'PO-B055|' + PN_B, 500);

  st = await readState(page);
  const s = ships(st);
  expect(s.length).toBe(2);
  expect(s.find(r => r.orderId === 'PO-B001|' + PN_B).qty, 'ตามที่คนใส่ ไม่ใช่ที่ระบบเฉลี่ย').toBe(1000);
  expect(s.find(r => r.orderId === 'PO-B055|' + PN_B).qty).toBe(500);
  expect(s.every(r => r.note === 'จากใบส่งสินค้า'), 'ต้องบอกที่มา ไม่งั้นแยกจากยอดที่คีย์มือไม่ออก').toBe(true);
});

test('A2 — แก้ตัวเลขที่พิมพ์ผิด ต้องเขียนทับ ไม่ใช่บวกทบ', async ({ page }) => {
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await alloc(page, 'PO-B001|' + PN_B, 400);

  const s = ships(await readState(page));
  expect(s.length, 'ยังต้องมี record เดียวของใบนั้น').toBe(1);
  expect(s[0].qty, '400 ไม่ใช่ 1,400').toBe(400);
});

test('ยอดบรรจุกับยอดที่ตัดเข้าใบไม่ตรงกัน ต้องเห็นบนจอ ไม่ใช่รู้ตอนใบออกไปแล้ว', async ({ page }) => {
  await open(page);
  await pack(page, PN_B, 'perBox', 50);
  await pack(page, PN_B, 'boxes', 30);
  expect(await leftCell(page, PN_B), 'ยังไม่ได้ตัดเข้าใบเลย').toContain('เหลือต้องตัดอีก');

  await alloc(page, 'PO-B001|' + PN_B, 1500);
  expect(await leftCell(page, PN_B), 'ตัดครบพอดี').toContain('ตัดครบแล้ว');

  await alloc(page, 'PO-B055|' + PN_B, 100);
  expect(await leftCell(page, PN_B), 'ตัดเกินยอดที่บรรจุ ต้องเตือน').toContain('เกิน');
});

test('Wip bal. ต้องเป็นยอดค้างก่อนส่งรอบนี้ ไม่ใช่หลังส่ง', async ({ page }) => {
  // ในฟอร์มมีสูตร W = G − P (ค้าง ลบ ที่ส่งรอบนี้) ถ้า G หักไปแล้วจะหักซ้ำสองรอบ
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 5000);
  const row = await page.locator('#dnTable tbody tr').filter({ hasText: 'PO-B001' }).innerText();
  expect(row, 'ยังต้องเป็นยอดเต็มของใบ').toContain('12,000');
});

test('G2 — ตัวเลือกหน่วยต้องไม่มี "ทั้งหมด" เพราะใบหนึ่งใบเป็นของหน่วยเดียว', async ({ page }) => {
  await open(page, ORDERS, [], null);
  expect(await page.locator('#dnUnit option').allInnerTexts()).toEqual(['TUE-H', 'TUE-U']);
  expect(await page.locator('#dnUnit').inputValue()).toBe('TUE-H');
});

test('G2 — กด Tab ไล่คีย์ทีละช่อง โฟกัสต้องไม่หลุด', async ({ page }) => {
  // change ยิงตอนกด Tab ซึ่งโฟกัสย้ายไปช่องถัดไปแล้ว ถ้าวาดตารางใหม่ทั้งใบ ช่องนั้นจะถูกทิ้ง
  await open(page);
  const i = page.locator(`#dnTable input.dn-pack[data-pn="${PN_B}"][data-f="perBox"]`);
  await i.fill('50'); await i.press('Tab'); await page.waitForTimeout(200);

  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el && el.dataset ? { f: el.dataset.f, pn: el.dataset.pn } : null;
  });
  expect(focused, 'โฟกัสต้องอยู่ช่องถัดไปของกลุ่มเดิม').toEqual({ f: 'boxes', pn: PN_B });
  expect((await readState(page)).deliveryNotes[0].perBox, 'และค่าต้องถูกบันทึกจริง').toBe(50);
});

// ── ค้นหา ─────────────────────────────────────
//
// พนักงานแจ้ง 31 ส.ค. 2026 ว่าไล่หา PO กับ P/N ในรายการยาว ๆ ลำบาก
// ตัวค้นหานี้กรองแค่สิ่งที่เห็น ไม่ได้กรองสิ่งที่ลงไปในไฟล์ — เทสข้อ "ออกใบไม่สนใจตัวค้นหา" คือข้อสำคัญที่สุด

const search = async (page, q) => {
  await page.fill('#dnSearch', q);
  await page.waitForTimeout(150);
};

test('ค้นหาด้วย P/N — เจอกลุ่มเดียว ที่เหลือถูกซ่อน', async ({ page }) => {
  await open(page);
  await search(page, PN_A);
  expect(await page.locator('#dnTable tr.dn-group').count()).toBe(1);
  expect(await page.locator('#dnTable tbody').innerText()).toContain('PO-A004');
});

test('ค้นหาด้วย PO — ต้องโชว์ทั้งกลุ่มของ P/N นั้น ไม่ใช่เฉพาะใบที่ตรงกับคำค้น', async ({ page }) => {
  // ยอดบรรจุเป็นของทั้งกลุ่ม ถ้าซ่อนใบพี่น้องไป ช่อง "เหลือต้องตัดอีก" จะดูเหมือนกรอกผิดทั้งที่ถูก
  // แล้วคนจะไปแก้ตัวเลขที่ถูกอยู่แล้วให้ผิด
  await open(page);
  await search(page, 'PO-B001');
  const body = await page.locator('#dnTable tbody').innerText();
  expect(body, 'ใบที่ค้นหา').toContain('PO-B001');
  expect(body, 'ใบพี่น้องใน P/N เดียวกันต้องอยู่ด้วย').toContain('PO-B055');
  expect(body, 'ส่วนกลุ่มอื่นต้องหายไป').not.toContain('PO-A004');
});

test('ค้นหาแบบพิมพ์บางส่วน และไม่สนตัวพิมพ์เล็กใหญ่', async ({ page }) => {
  await open(page);
  await search(page, 'b055');
  expect(await page.locator('#dnTable tbody').innerText()).toContain('PO-B055');
  await search(page, '0004');
  expect(await page.locator('#dnTable tbody').innerText()).toContain('PO-A004');
});

test('หาไม่เจอ ต้องบอกว่าหาอะไรอยู่ ไม่ใช่ตารางว่างเปล่าเฉย ๆ', async ({ page }) => {
  await open(page);
  await search(page, 'ไม่มีจริง');
  expect(await page.locator('#dnTable tbody').innerText()).toContain('ไม่พบ');
  expect(await page.locator('#dnTable tbody').innerText()).toContain('ไม่มีจริง');
});

test('ยอดรวมกับจำนวนกลุ่มต้องเป็นของทั้งวัน ไม่ใช่เฉพาะที่ค้นหาเจอ', async ({ page }) => {
  // ถ้านับตามที่เห็น คนจะกดออกใบโดยเข้าใจว่ากรอกไปเท่าที่เห็น
  await open(page);
  await pack(page, PN_B, 'perBox', 50);
  await pack(page, PN_B, 'boxes', 30);           // 1,500
  await pack(page, PN_A, 'perBox', 10);
  await pack(page, PN_A, 'boxes', 7);            // 70

  await search(page, PN_A);
  const sum = await page.locator('#dnSummary').innerText();
  expect(sum, 'ยอดรวมต้องเป็นของทั้งวัน').toContain('1,570');
  expect(sum, 'จำนวนกลุ่มต้องเป็นของทั้งวัน').toContain('2 กลุ่ม P/N');
  expect(sum, 'ต้องบอกว่าซ่อนอะไรไว้บ้าง').toContain('ซ่อนอยู่ 1 กลุ่ม');
  expect(sum, 'และต้องบอกว่ากลุ่มที่ซ่อนไว้มีคนกรอกไปแล้ว').toContain('กรอกไว้แล้ว 1 กลุ่ม');
});

test('ออกใบต้องไม่สนใจตัวค้นหา — ของที่ถูกซ่อนต้องยังลงในไฟล์', async ({ page }) => {
  await open(page);
  await fillGroupB(page);
  await pack(page, PN_A, 'perBox', 10);
  await pack(page, PN_A, 'boxes', 7);
  await alloc(page, 'PO-A004|' + PN_A, 70);

  await search(page, PN_A);                       // ซ่อนกลุ่ม B ไว้
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  expect(xml, 'กลุ่มที่ค้นหาเจอ').toContain('PO-A004');
  expect(xml, 'กลุ่มที่ถูกซ่อนก็ต้องอยู่ในไฟล์ด้วย').toContain('PO-B001');
  expect(xml, 'ครบทุกใบของกลุ่มที่ถูกซ่อน').toContain('PO-B055');
});

test('G2 — พิมพ์ในช่องค้นหาแล้วโฟกัสต้องไม่หลุด', async ({ page }) => {
  await open(page);
  await page.click('#dnSearch');
  await page.keyboard.type('PO-B0');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.activeElement.id),
    'ตารางวาดใหม่ทุกตัวอักษร ช่องค้นหาต้องยังถือโฟกัสอยู่').toBe('dnSearch');
  expect(await page.inputValue('#dnSearch'), 'และตัวอักษรต้องครบ ไม่หายระหว่างพิมพ์').toBe('PO-B0');
});

test('เลข Item ต้องเป็นลำดับจริงของทั้งวัน ไม่ใช่ลำดับที่เห็นตอนกรอง', async ({ page }) => {
  // เลขนี้ตรงกับเลขบรรทัดบนกระดาษที่ปริ้นออกมา ถ้าเปลี่ยนตามตัวกรองจะอ้างอิงกันไม่ได้
  await open(page);
  const before = await page.locator('#dnTable tbody tr').filter({ hasText: 'PO-A004' }).innerText();
  await search(page, PN_A);
  const after = await page.locator('#dnTable tbody tr').filter({ hasText: 'PO-A004' }).innerText();
  expect(after.split(String.fromCharCode(9))[0]).toBe(before.split(String.fromCharCode(9))[0]);
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

/** กรอกครบหนึ่งกลุ่มสองใบ ให้ยอดตรงกัน จะได้ไม่มีกล่องยืนยันมาขวาง */
async function fillGroupB(page) {
  await pack(page, PN_B, 'perBox', 50);
  await pack(page, PN_B, 'boxes', 30);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await alloc(page, 'PO-B055|' + PN_B, 500);
}

test('ไฟล์ของผู้ใช้ต้องไม่ถูกทำลาย — ออกใบแล้วทุกส่วนของฟอร์มต้องอยู่ครบ เปลี่ยนแค่ชีตเดียว', async ({ page }) => {
  await open(page);
  await fillGroupB(page);
  const { src, out } = await exportForm(page);

  const za = await JSZip.loadAsync(src), zb = await JSZip.loadAsync(out);
  const names = z => Object.keys(z.files).filter(n => !z.files[n].dir).sort();
  expect(names(zb), 'ห้ามมีส่วนไหนของไฟล์หายไปหรือโผล่เพิ่ม').toEqual(names(za));

  const changed = [];
  for (const n of names(za)) {
    if (await za.file(n).async('string') !== await zb.file(n).async('string')) changed.push(n);
  }
  // workbook.xml เปลี่ยนเพราะต้องสั่งให้ Excel คิดสูตรใหม่ตอนเปิด (ตั้งค่าเดียว ไม่แตะชีตอื่น)
  expect(changed, 'ต้องแตะชีตของหน่วยที่ออกใบเท่านั้น')
    .toEqual(['xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  expect(out.length / src.length, 'ต้องยังบีบอัดอยู่').toBeLessThan(1.3);
});

test('ยอดบรรจุต้องลงแถวแรกของกลุ่มเท่านั้น และ merge ข้ามแถวให้เหมือนที่ทำมือ', async ({ page }) => {
  await open(page);
  await fillGroupB(page);
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  const at = ref => (new RegExp('<c r="' + ref + '"[^>]*>[^<]*<v>([^<]*)</v>').exec(xml) || [])[1];

  expect(at('M10'), 'ยอดบรรจุอยู่แถวแรกของกลุ่ม').toBe('50');
  expect(at('N10')).toBe('30');
  expect(at('M11'), 'แถวที่สองของกลุ่มต้องเว้นว่าง ไม่งั้นยอดรวมท้ายตารางจะนับซ้ำ').toBeUndefined();

  for (const c of ['M', 'N', 'O', 'P']) {
    expect(xml, 'ต้อง merge คอลัมน์ ' + c + ' ข้ามแถวของกลุ่ม')
      .toContain('<mergeCell ref="' + c + '10:' + c + '11"/>');
  }
  expect(xml, 'PO ของแต่ละแถวยังต่างกัน').toContain('PO-B001');
  expect(xml, 'PO ของแต่ละแถวยังต่างกัน').toContain('PO-B055');
});

test('ห้ามแตะสูตรของฟอร์ม — Aging · จำนวน/PCS · Fail · ยอดรวมท้ายตาราง ต้องรอดครบ', async ({ page }) => {
  await open(page);
  await fillGroupB(page);
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');

  expect((xml.match(/<f>TODAY\(\)-E\d+<\/f>/g) || []).length, 'สูตร Aging ต้องอยู่ครบ 86 แถว').toBe(86);
  expect((xml.match(/<f>M\d+\*N\d+\+O\d+<\/f>/g) || []).length, 'สูตร จำนวน/PCS ต้องอยู่ครบ').toBe(86);
  expect((xml.match(/<f>G\d+-P\d+<\/f>/g) || []).length, 'สูตร Fail ต้องอยู่ครบ').toBe(86);
  expect(xml, 'ยอดรวมท้ายตารางต้องไม่ถูกแตะ').toContain('SUM(P10:P95)');
  expect(xml, 'หัวใบต้องบอกสัปดาห์ของใบนี้').toContain('(WK 34)');
});

// ── สูตรต้องถูกคิดใหม่ ไม่ใช่โชว์ค่าที่แคชไว้ ────────────────────
//
// พนักงานเจอของจริง 31 ส.ค. 2026 — กรอกยอดบรรจุครบแต่ใบที่ปริ้นออกมามีจำนวนเป็น 0
// เพราะฟอร์มเก็บ <f>M10*N10+O10</f><v>0</v> ไว้ แล้ว Excel โชว์เลข 0 ที่แคชไว้ตัวนั้น
// อาการเงียบสนิท ไฟล์เปิดได้ ไม่มี error สูตรก็ยังอยู่ครบ

test('BUG — กรอกยอดบรรจุแล้วยังไม่ตัดเข้าใบ ยอดในไฟล์ต้องไม่กลายเป็น 0', async ({ page }) => {
  page.on('dialog', d => d.accept());          // จะมีกล่องเตือนว่ายังตัดเข้าใบไม่ครบ
  await open(page);
  await pack(page, PN_B, 'perBox', 50);
  await pack(page, PN_B, 'boxes', 30);
  await pack(page, PN_B, 'remainder', 7);      // 1,507 ชิ้น

  expect(await page.locator(`#dnTable td[data-pcs="${PN_B}"]`).innerText(),
    'บนจอคิดถูกอยู่แล้ว — ที่พังคือตอนออกไฟล์').toBe('1,507');

  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  const cell = ref => (new RegExp('<c r="' + ref + '"[^>]*>.*?</c>').exec(xml) || [])[0] || '';

  expect(cell('P10'), 'ช่องจำนวน/PCS ต้องไม่มีค่าเก่าค้างอยู่ ไม่งั้น Excel โชว์เลขนั้น')
    .not.toMatch(/<v>[^<]*<\/v>/);
  expect(cell('P10'), 'แต่สูตรต้องยังอยู่').toContain('<f>M10*N10+O10</f>');
  expect(cell('P96'), 'ยอดรวมท้ายตารางก็ต้องไม่ค้างค่าเก่า').not.toMatch(/<v>[^<]*<\/v>/);
});

test('ไม่มีช่องสูตรไหนในชีตที่เราเขียนทับ ที่ยังค้างค่าเก่าไว้', async ({ page }) => {
  await open(page);
  await fillGroupB(page);
  const { src, out } = await exportForm(page);

  const cached = xml => (xml.match(/<c[^>]*>(?:(?!<\/c>).)*?<f[^>]*>(?:(?!<\/c>).)*?<v>/g) || []).length;
  const before = await (await JSZip.loadAsync(src)).file('xl/worksheets/sheet1.xml').async('string');
  const after  = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');

  expect(cached(before), 'fixture ต้องมีค่าที่แคชไว้จริง ไม่งั้นเทสนี้ไม่ได้พิสูจน์อะไรเลย')
    .toBeGreaterThan(0);
  expect(cached(after), 'ออกไฟล์แล้วต้องไม่เหลือช่องสูตรที่ค้างค่าเก่า').toBe(0);
});

test('ต้องสั่ง Excel ให้คิดสูตรใหม่ทั้งไฟล์ตอนเปิด', async ({ page }) => {
  await open(page);
  await fillGroupB(page);
  const { out } = await exportForm(page);
  const wb = await (await JSZip.loadAsync(out)).file('xl/workbook.xml').async('string');
  expect(wb, 'คลุมสูตรในชีตอื่นที่อ้างถึงชีตที่เราแก้ด้วย').toContain('fullCalcOnLoad="1"');
  expect(wb, 'calcCompleted ที่ค้างอยู่ต้องถูกเอาออก ไม่ให้สถานะขัดกันเอง')
    .not.toContain('calcCompleted');
});

test('แถวและ merge ที่เหลือจากใบครั้งก่อนต้องถูกล้าง ไม่ให้ของเก่าปนมาในใบใหม่', async ({ page }) => {
  await open(page);
  await fillGroupB(page);
  const { out } = await exportForm(page, { stale: true });
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  expect(xml, 'ข้อความของใบครั้งก่อนต้องหายไป').not.toContain('ของเก่าที่ต้องหาย');
  expect(xml, 'ตัวเลขบรรจุของเก่าก็ต้องไม่ค้าง').not.toContain('<v>999</v>');
});

test('ช่องวันที่ที่แอปสร้างขึ้นใหม่ ต้องได้รูปแบบวันที่ ไม่ใช่โชว์เป็นเลขดิบ', async ({ page }) => {
  await open(page);
  await fillGroupB(page);
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  const styleAt = ref => (new RegExp('<c r="' + ref + '"[^>]*s="([0-9]+)"').exec(xml) || [])[1];

  expect(styleAt('E10'), 'แถวแรกมีรูปแบบอยู่แล้ว ต้องไม่ถูกทำหาย').toBeTruthy();
  expect(styleAt('E11'), 'แถวที่สองแอปสร้างช่องขึ้นใหม่ ต้องหยิบรูปแบบของคอลัมน์เดียวกันมาใช้')
    .toBe(styleAt('E10'));
});

test('ยอดส่งของต้องมาจากใบส่งสินค้าทางเดียว — ไม่มีการนำเข้าจากไฟล์ใบส่งงานอีกแล้ว', async ({ page }) => {
  // ตอนนี้โปรแกรมออกใบส่งสินค้าเอง การนำเข้าไฟล์ที่คนอื่นทำมาจึงกลายเป็นยอดคนละชุด
  // ที่เขียนทับกันเงียบ ๆ เพราะใช้กุญแจ orderId|shipping|date เดียวกัน
  await open(page, ORDERS, [], null);
  await page.click('.tab-btn[data-tab="import"]');

  await expect(page.locator('#shipFileInput'), 'ช่องเลือกไฟล์ใบส่งงานต้องไม่มีแล้ว').toHaveCount(0);
  await expect(page.locator('#btnConfirmShipImport'), 'ปุ่มยืนยันนำเข้ายอดส่งต้องไม่มีแล้ว').toHaveCount(0);
  await expect(page.locator('#view-import'), 'ต้องบอกคนใช้ว่ายอดส่งของย้ายไปอยู่ที่ไหน')
    .toContainText('ใบส่งสินค้า');
});

test('B1 — ยอดที่เคยนำเข้าจากใบส่งงานไว้ ต้องยังอยู่ครบและยังบอกที่มาได้', async ({ page }) => {
  // เอาความสามารถออก ไม่ใช่เอาข้อมูลของพนักงานออก
  await open(page, ORDERS, [{
    id: 'OLD1', date: '2026-08-20', orderId: 'PO-B001|' + PN_B, process: 'shipping', qty: 300,
    note: 'นำเข้าจากใบส่งงาน', deviceName: 't', batchId: 'B1',
    createdAt: 'x', updatedAt: 'x', voided: false, _dirty: false
  }], null);

  await page.click('.tab-btn[data-tab="entry"]');
  await page.fill('#recFilterDate', '2026-08-20');
  await page.waitForTimeout(200);
  await expect(page.locator('#recordEditorTable'), 'ป้ายแหล่งที่มาต้องยังบอกว่ามาจากใบส่งงาน')
    .toContainText('ใบส่งงาน');

  const st = await readState(page);
  expect(st.records.length, 'ข้อมูลเดิมต้องไม่หายไปไหน').toBe(1);
});

test('A1 — ใบที่ส่งครบแล้วต้องหายจากรายการ แต่บรรทัดที่คีย์วันนี้ต้องยังอยู่ให้แก้ได้', async ({ page }) => {
  // เทสข้อนี้เคยมีแล้วหายไปตอนเขียนไฟล์ใหม่ให้เข้ากับการจัดกลุ่มตาม P/N
  // ผู้ตรวจจับได้ว่าพฤติกรรมยังอยู่ในโค้ดแต่ไม่มีอะไรคุมแล้ว
  await open(page, ORDERS, [{
    id: 'S1', date: '2026-08-20', orderId: 'PO-A004|' + PN_A, process: 'shipping', qty: 9000,
    note: '', deviceName: 't', createdAt: 'x', updatedAt: 'x', voided: false, _dirty: false
  }]);
  expect(await page.locator('#dnTable input.dn-alloc').count(),
    'ใบที่ส่งครบไปแล้วไม่ต้องโผล่มาให้กรอกอีก เหลือแค่สองใบของอีก P/N').toBe(2);

  // คีย์จนครบยอดของใบหนึ่งในวันนี้ แถวต้องยังอยู่ให้แก้ตัวเลขที่พิมพ์ผิดได้
  await alloc(page, 'PO-B001|' + PN_B, 12000);
  expect(await page.locator(`#dnTable input.dn-alloc[data-order="PO-B001|${PN_B}"]`).count(),
    'ส่งครบแล้วแต่เป็นบรรทัดของวันนี้ ต้องยังอยู่').toBe(1);
  expect(await page.locator(`#dnTable input.dn-alloc[data-order="PO-B001|${PN_B}"]`).inputValue())
    .toBe('12000');
});
