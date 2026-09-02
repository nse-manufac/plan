// เทสหน้าจอใบส่งสินค้า และการกรอกฟอร์ม FM-ST-07
//
// ⚠️ ทิศทางของตัวเลข (เปลี่ยน 31 ส.ค. 2026 ตามที่พนักงานเสนอหลังลองใช้จริง)
//    คนกรอก "จำนวนที่ส่ง" ของแต่ละ PO · ยอดรวมของกลุ่ม P/N คือผลบวก
//    แล้วโปรแกรมแบ่งเป็นกล่องกับเศษให้จาก ต่อกล่อง ที่กรอกไว้
//
//    ช่อง "กล่อง" ในฟอร์มหมายถึงกล่องที่เต็ม "เศษ" คือชิ้นที่เหลือ ไม่ใช่กล่องที่เหลือ
//    เพราะ Excel คิดเอง จำนวน/PCS = ต่อกล่อง × กล่อง + เศษ และนั่นคือจำนวนที่ลูกค้านับ
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
/** ค่าที่โปรแกรมเติมให้ในช่องกล่อง/เศษ */
const boxOf = (page, pn, f) => page.inputValue(`#dnTable input.dn-pack[data-pn="${pn}"][data-f="${f}"]`);
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

test('โปรแกรมแบ่งกล่องกับเศษให้จากผลบวกของทุก PO ในกลุ่ม', async ({ page }) => {
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await alloc(page, 'PO-B055|' + PN_B, 507);        // รวม 1,507
  await pack(page, PN_B, 'perBox', 50);

  expect(await boxOf(page, PN_B, 'boxes'), '1,507 ÷ 50 = 30 กล่องเต็ม').toBe('30');
  expect(await boxOf(page, PN_B, 'remainder'), 'เหลือ 7 ชิ้น').toBe('7');
  expect(await leftCell(page, PN_B)).toContain('ยอดตรง');
});

test('แก้ยอดของ PO แล้วกล่องกับเศษต้องขยับตาม ไม่ต้องไปแก้เอง', async ({ page }) => {
  await open(page);
  await pack(page, PN_B, 'perBox', 50);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  expect(await boxOf(page, PN_B, 'boxes')).toBe('20');

  await alloc(page, 'PO-B001|' + PN_B, 1225);
  expect(await boxOf(page, PN_B, 'boxes'), '1,225 ÷ 50 = 24 กล่องเต็ม').toBe('24');
  expect(await boxOf(page, PN_B, 'remainder'), 'เหลือ 25 ชิ้น').toBe('25');
});

test('ยังไม่ได้กรอกต่อกล่อง — ทุกชิ้นต้องเป็นเศษ ยอดบนกระดาษจึงยังถูก', async ({ page }) => {
  // ผลคูณ 0 × 0 + 1000 = 1000 ใบที่ออกก่อนกรอกต่อกล่องจึงมีจำนวนถูก แค่ไม่บอกว่าแบ่งกี่กล่อง
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  expect(await boxOf(page, PN_B, 'remainder')).toBe('1000');
  expect(await leftCell(page, PN_B), 'ยอดยังตรง ไม่ใช่สถานะผิด').toContain('ยอดตรง');
});

// ── แก้กล่องเอง — กรณีไม่ปกติ ที่เจ้าของสั่งให้ทำได้แต่ต้องล็อกยอดรวม ──

test('แก้กล่องเองแล้วผลคูณยังตรงยอด ต้องยอมให้ทำ และจำไว้ว่าคนแก้เอง', async ({ page }) => {
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 100);
  await pack(page, PN_B, 'perBox', 50);            // อัตโนมัติได้ 2 กล่อง 0 เศษ
  expect(await boxOf(page, PN_B, 'boxes')).toBe('2');

  await pack(page, PN_B, 'boxes', 1);              // 1 × 50 + 50 = 100 ยังตรง
  await pack(page, PN_B, 'remainder', 50);
  expect(await leftCell(page, PN_B)).toContain('แก้กล่องเอง');

  // ต้องไม่ถูกคิดใหม่ทับเงียบ ๆ ตอนแตะยอดของ PO อีกครั้ง
  await alloc(page, 'PO-B001|' + PN_B, 100);
  expect(await boxOf(page, PN_B, 'boxes'), 'ของที่คนตั้งใจแก้ไว้ต้องอยู่').toBe('1');
});

test('แก้กล่องเองแล้วผลคูณไม่ตรงยอด ต้องขึ้นแดงและออกใบไม่ได้', async ({ page }) => {
  // นี่คือกรณีที่กระดาษจะแจ้งลูกค้าคนละจำนวนกับของที่ส่งจริง
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 100);
  await pack(page, PN_B, 'perBox', 50);
  await pack(page, PN_B, 'boxes', 3);              // 3 × 50 + 0 = 150 เกินไป 50

  expect(await leftCell(page, PN_B)).toContain('ไม่ตรงยอด');
  expect(await page.locator('#dnSummary').innerText()).toContain('ออกใบไม่ได้');

  const src = await deliveryFormWorkbook(['TUE-U', 'TUE-H']);
  await page.setInputFiles('#dnTemplateInput', { name: 'FM-ST-07.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: src });
  await expect(page.locator('#btnDnExport')).toBeEnabled();

  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.click('#btnDnExport');
  await page.waitForTimeout(600);

  expect(downloaded, 'ต้องไม่ได้ไฟล์ออกมาเลย ไม่ใช่แค่ถามแล้วให้กดผ่าน').toBe(false);
  expect(dialogs.join(' '), 'และต้องบอกว่ากลุ่มไหน ต่างกันเท่าไหร่').toContain('P/N ' + PN_B);
  expect(dialogs.join(' ')).toContain('150');
});

test('ปุ่มคำนวณให้ ต้องพากลับออกจากโหมดแก้กล่องเองได้', async ({ page }) => {
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 100);
  await pack(page, PN_B, 'perBox', 50);
  await pack(page, PN_B, 'boxes', 3);
  expect(await leftCell(page, PN_B)).toContain('ไม่ตรงยอด');

  await page.click(`#dnTable td[data-left="${PN_B}"] .dn-recalc`);
  await page.waitForTimeout(200);

  expect(await boxOf(page, PN_B, 'boxes')).toBe('2');
  expect(await boxOf(page, PN_B, 'remainder')).toBe('0');
  expect(await leftCell(page, PN_B)).toContain('ยอดตรง');
});

test('ช่อง Remark ต้องกรอกได้ และลงไปในไฟล์', async ({ page }) => {
  // ช่องนี้เคยมีในโครงข้อมูลและเขียนลงคอลัมน์ U ให้อยู่แล้ว แต่ไม่มีที่ให้กรอกบนจอเลย
  // เป็นทางออกของกรณีแพ็คไม่เต็มหลายกล่อง ซึ่งฟอร์มแสดงด้วยตัวเลขไม่ได้
  await open(page);
  await fillGroupB(page);
  const i = page.locator(`#dnTable input.dn-pack[data-pn="${PN_B}"][data-f="remark"]`);
  await i.fill('แพ็ค 3 กล่องไม่เต็ม'); await i.press('Tab');
  await page.waitForTimeout(150);

  expect((await readState(page)).deliveryNotes[0].remark).toBe('แพ็ค 3 กล่องไม่เต็ม');
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  expect(xml, 'ต้องไปโผล่ในช่อง Remark ของใบ').toContain('แพ็ค 3 กล่องไม่เต็ม');
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

// ── P/N ที่มาจากการซิงค์เป็น "ตัวเลข" ไม่ใช่ข้อความ ──────────────
//
// พนักงานเจอของจริง 1 ก.ย. 2026 บนมือถือ — กรอกจำนวนราย PO และต่อกล่องแล้ว
// กล่องไม่ขึ้น · ยอดรวมของกลุ่มเป็น "—" · และพอรีเฟรช ต่อกล่องที่กรอกไว้ก็หายไป
//
// เพราะ P/N เข้ามาได้สองทางที่ให้ชนิดข้อมูลไม่เหมือนกัน
//   นำเข้าไฟล์ Excel → String(...).trim() จึงเป็นข้อความ
//   ซิงค์จาก Google Sheets → คัดลอกมาตรง ๆ ชีตเก็บเป็นตัวเลข ก็ได้ตัวเลข
// ส่วนค่าที่อ่านกลับจาก DOM เป็นข้อความเสมอ · เทียบด้วย === จึงไม่มีวันตรงกัน
//
// ⚠️ fixture ของเทสทุกข้อข้างบนใช้ P/N เป็นข้อความ บั๊กนี้จึงลอดไปได้ทั้งชุด
//    เทสสองข้อนี้จงใจใช้ตัวเลข เพื่อเดินเส้นทางเดียวกับเครื่องที่รับข้อมูลจากการซิงค์

const PN_SYNCED = 9000000002;   // ไม่มีเครื่องหมายคำพูด — เป็นตัวเลขจริง ๆ
const syncedOrders = [
  { ...order('PO-B001', String(PN_SYNCED), 2000, '2026-08-03'), pn: PN_SYNCED },
  { ...order('PO-B055', String(PN_SYNCED), 2000, '2026-08-10'), pn: PN_SYNCED }
];

test('P/N ที่เป็นตัวเลข — กรอกยอดแล้วกล่องต้องขึ้น และยอดรวมต้องไม่เป็น "—"', async ({ page }) => {
  await open(page, syncedOrders);
  await alloc(page, 'PO-B001|' + PN_SYNCED, 388);
  await alloc(page, 'PO-B055|' + PN_SYNCED, 458);        // รวม 846
  await pack(page, PN_SYNCED, 'perBox', 43);             // 846 ÷ 43 = 19 เศษ 29

  expect(await page.locator(`#dnTable td[data-pcs="${PN_SYNCED}"]`).innerText(),
    'ยอดรวมของกลุ่มต้องขึ้นทันที ไม่ใช่ขีด').toBe('846');
  expect(await boxOf(page, PN_SYNCED, 'boxes')).toBe('19');
  expect(await boxOf(page, PN_SYNCED, 'remainder')).toBe('29');
  expect(await leftCell(page, PN_SYNCED)).toContain('ยอดตรง');
});

test('P/N ที่เป็นตัวเลข — ต่อกล่องที่กรอกไว้ต้องไม่หายตอนรีเฟรช', async ({ page }) => {
  await open(page, syncedOrders);
  await alloc(page, 'PO-B001|' + PN_SYNCED, 388);
  await pack(page, PN_SYNCED, 'perBox', 43);

  // ⚠️ open() หว่าน state ตั้งต้นด้วย addInitScript ซึ่งทำงานใหม่ทุกครั้งที่โหลดหน้า
  //    ถ้า reload เฉย ๆ ของที่เพิ่งบันทึกจะถูกทับด้วยค่าตั้งต้น แล้วเทสจะฟ้องผิดจุด
  //    จึงหว่านสิ่งที่บันทึกไว้จริงทับเข้าไปอีกชั้น ให้เหมือนเปิดแอปใหม่พร้อมข้อมูลเดิม
  const saved = await readState(page);
  await page.addInitScript(([k, st]) => localStorage.setItem(k, JSON.stringify(st)), [K_STATE, saved]);
  await page.reload();
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.fill('#dnDate', DATE);
  await page.waitForTimeout(150);
  await page.selectOption('#dnUnit', 'TUE-U');
  await page.waitForTimeout(200);

  expect(await boxOf(page, PN_SYNCED, 'perBox'), 'ต่อกล่องต้องยังอยู่').toBe('43');
  expect(await page.locator(`#dnTable td[data-pcs="${PN_SYNCED}"]`).innerText()).toBe('388');
});

// ── Wip bal. บนกระดาษต้องเป็นยอดของ Delta ────────────────────────
//
// เจ้าของสั่ง 1 ก.ย. 2026 — เลขในช่อง Wip bal. ของใบส่งสินค้าต้องตรงกับที่ลูกค้าถืออยู่
// ไม่ใช่ตรงกับบัญชีเรา จึงดึงมาจากไฟล์ Call In ที่ Delta ส่งมารายสัปดาห์
//
// ⚠️ แต่ "จอ" กับ "กระดาษ" ต้องใช้คนละเลข — ถ้าเอายอดของ Delta ไปใช้กับตัวกรองบนจอด้วย
//    PO ที่ไม่มีในไฟล์ของ Delta จะหายไปจากหน้าจอจนส่งของใบนั้นไม่ได้เลย

const deltaRow = (orderId, week, wip) => ({
  id: 'DW-' + orderId + '-' + week, orderId, week: String(week), wip, fileName: 'callin.xlsx',
  deviceName: 't', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  voided: false, _dirty: false
});

/** เปิดหน้าใบส่งสินค้าพร้อมยอดของ Delta ที่เตรียมไว้ */
async function openWithDelta(page, deltaWip, orders = ORDERS, records = []) {
  await page.addInitScript(([k, o, r, d]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: d, importHistory: []
  })), [K_STATE, orders, records, deltaWip]);
  await page.goto(APP);
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.fill('#dnDate', DATE);
  await page.waitForTimeout(150);
  await page.selectOption('#dnUnit', 'TUE-U');
  await page.waitForTimeout(150);
}

test('ช่อง Wip bal. บนกระดาษต้องเป็นยอดของ Delta ไม่ใช่ยอดที่เราคิดเอง', async ({ page }) => {
  // ของเรา: สั่ง 12,000 ยังไม่ส่งอะไรเลย → ยอดค้างของเรา = 12,000
  // ของ Delta: บอกว่าค้าง 7,500 — เลขบนกระดาษต้องเป็น 7,500
  await openWithDelta(page, [deltaRow('PO-B001|' + PN_B, 34, 7500)]);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await pack(page, PN_B, 'perBox', 50);

  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  const at = ref => (new RegExp('<c r="' + ref + '"[^>]*>[^<]*<v>([^<]*)</v>').exec(xml) || [])[1];

  expect(at('G10'), 'ต้องเป็นยอดของ Delta').toBe('7500');
  expect(at('G10'), 'ต้องไม่ใช่ยอดที่เราคิดเอง').not.toBe('12000');
});

test('PO ที่ไม่มีในไฟล์ของ Delta ต้องยังอยู่บนจอ และช่อง Wip bal. บนกระดาษเว้นว่าง', async ({ page }) => {
  // นี่คือกับดักหลักของใบนี้ — ถ้าเอายอด Delta ไปใช้กับตัวกรอง ใบนี้จะหายไปจนส่งของไม่ได้
  await openWithDelta(page, []);          // Delta ไม่มีข้อมูลสักใบ

  expect(await page.locator('#dnTable input.dn-alloc').count(),
    'ทุกใบต้องยังอยู่บนจอ ไม่งั้นคีย์ยอดส่งไม่ได้เลย').toBe(3);
  await expect(page.locator('#dnTable'), 'และต้องบอกว่าใบไหนไม่มียอดของ Delta')
    .toContainText('ไม่มียอด Delta');

  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await pack(page, PN_B, 'perBox', 50);
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');

  const g10 = (new RegExp('<c r="G10"[^>]*>.*?</c>').exec(xml) || [])[0] || '';
  expect(g10, 'ห้ามเดาด้วยยอดของเรา ต้องเว้นว่าง').not.toMatch(/<v>[^<]+<\/v>/);
});

test('ตัดยอดเข้าใบเกินยอดสั่ง ต้องเตือน — คำเตือนนี้ตายมาตลอดจนถึง 2 ก.ย. 2026', async ({ page }) => {
  // wipBalance() ครอบไม่ให้ติดลบ โค้ดเดิมเอา alloc บวกกลับเข้าไปเพื่อหายอด "ก่อนส่ง"
  // พอส่งเกินยอดสั่ง ค่าที่ครอบแล้วเป็น 0 บวก alloc กลับจึงได้เท่ากับ alloc พอดี
  // เงื่อนไข alloc > wip เลยเป็นเท็จเสมอ — สั่ง 1,000 ตัดเข้าใบ 3,000 ก็เงียบสนิท
  await open(page, [order('PO-X1', PN_B, 1000, '2026-08-03')]);
  await alloc(page, 'PO-X1|' + PN_B, 3000);

  const row = await page.locator('#dnTable tbody tr').filter({ hasText: 'PO-X1' }).innerText();
  expect(row, 'สั่ง 1,000 ตัดเข้าใบ 3,000 ต้องเตือน').toContain('เกิน');
  expect(row, 'และยอดค้างก่อนส่งต้องเป็น 1,000 ไม่ใช่ 3,000').toContain('ค้างส่ง 1,000');
});

test('ตัดยอดพอดียอดสั่ง ต้องไม่เตือน', async ({ page }) => {
  await open(page, [order('PO-X1', PN_B, 1000, '2026-08-03')]);
  await alloc(page, 'PO-X1|' + PN_B, 1000);
  const row = await page.locator('#dnTable tbody tr').filter({ hasText: 'PO-X1' }).innerText();
  expect(row, 'ส่งพอดี ไม่ใช่เกิน').not.toContain('เกิน');
});

// ── ติ๊ก "ใส่ในใบ" สำหรับ PO ที่รอบนี้ไม่ได้ส่งของ ─────────────────
//
// เจ้าของเจอกรณีจริง 3 ก.ย. 2026 — ของรอบนั้นตัดเข้าใบอื่นไปหมดแล้ว
// แต่มีอีกใบที่ Delta ยังค้างและอยากให้ปรากฏบนกระดาษ
// ใส่จำนวนให้ใบนั้นไม่ได้เพราะยอดส่งจะเกินของจริง จึงต้องเลือกด้วยมือ
//
// ⚠️ ตั้งใจไม่เก็บลงข้อมูลและไม่ซิงค์ — เหตุผลของเจ้าของคือคนที่ปริ้นคือคนที่เซฟไฟล์อยู่แล้ว
//    และถ้าติ๊กค้างข้ามวัน พนักงานจะเลิกตรวจสอบว่ารอบนี้ควรใส่ใบไหนบ้าง

const tick = async (page, orderId) => {
  await page.locator(`#dnTable input.dn-include[data-order="${orderId}"]`).check();
  await page.waitForTimeout(150);
};

test('ติ๊กใส่ในใบ — PO ที่ไม่ได้ส่งรอบนี้ต้องขึ้นบนกระดาษได้', async ({ page }) => {
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await pack(page, PN_B, 'perBox', 50);

  // ยังไม่ติ๊ก — ใบที่ไม่ได้ส่งต้องไม่อยู่บนกระดาษ (พฤติกรรมเดิมจาก #43)
  let xml = await (await JSZip.loadAsync((await exportForm(page)).out))
    .file('xl/worksheets/sheet1.xml').async('string');
  expect(xml, 'ยังไม่ติ๊ก ต้องไม่ขึ้น').not.toContain('PO-B055');

  await tick(page, 'PO-B055|' + PN_B);
  xml = await (await JSZip.loadAsync((await exportForm(page)).out))
    .file('xl/worksheets/sheet1.xml').async('string');
  expect(xml, 'ติ๊กแล้วต้องขึ้นบนกระดาษ').toContain('PO-B055');
  expect(xml, 'ใบที่ส่งจริงยังอยู่').toContain('PO-B001');
});

test('ติ๊กแล้วยอดส่งต้องไม่ขยับ — ไม่ใช่การบันทึกว่าส่งของ', async ({ page }) => {
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  const before = ships(await readState(page)).length;

  await tick(page, 'PO-B055|' + PN_B);
  const after = ships(await readState(page));
  expect(after.length, 'ติ๊กแล้วต้องไม่เกิด record ยอดส่งใหม่').toBe(before);
  expect(after.reduce((n, r) => n + r.qty, 0), 'ยอดรวมต้องเท่าเดิม').toBe(1000);
});

test('เปลี่ยนวันที่แล้วติ๊กต้องถูกล้าง — ใบใหม่ต้องตัดสินใจใหม่', async ({ page }) => {
  await open(page);
  await tick(page, 'PO-B055|' + PN_B);
  expect(await page.locator(`#dnTable input.dn-include[data-order="PO-B055|${PN_B}"]`).isChecked())
    .toBe(true);

  await page.fill('#dnDate', '2026-08-30');
  await page.waitForTimeout(250);
  expect(await page.locator(`#dnTable input.dn-include[data-order="PO-B055|${PN_B}"]`).isChecked(),
    'ติ๊กของวันก่อนต้องไม่ค้างมาวันใหม่').toBe(false);
});

test('แถวที่มีจำนวนแล้ว ต้องติ๊กค้างและกดไม่ได้', async ({ page }) => {
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  const box = page.locator(`#dnTable tr:has-text("PO-B001") input[type="checkbox"]`).first();
  expect(await box.isChecked(), 'มีจำนวนแล้วขึ้นในใบอยู่แล้ว').toBe(true);
  expect(await box.isDisabled(), 'และต้องกดปลดไม่ได้').toBe(true);
});

test('ใบที่เราส่งครบแล้ว แต่ Delta ยังค้าง ต้องยังขึ้นให้ส่งของได้', async ({ page }) => {
  // พนักงานเจอของจริง 2 ก.ย. 2026 — ตัดยอดส่งครบไปแล้ว แถวจึงหายจากหน้าจอ
  // แต่ Delta ยังบันทึกว่าค้างอยู่และยังรอของใบนั้น จึงใส่ลงใบส่งของไม่ได้เลย
  const shippedOut = [{
    id: 'S-full', date: '2026-08-20', orderId: 'PO-B001|' + PN_B, process: 'shipping',
    qty: 12000, note: '', deviceName: 't',
    createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
    voided: false, _dirty: false
  }];

  // ไม่มียอดของ Delta → แถวต้องหายตามเดิม
  await openWithDelta(page, [], ORDERS, shippedOut);
  expect(await page.locator('#dnTable input.dn-alloc[data-order="PO-B001|' + PN_B + '"]').count(),
    'ส่งครบแล้วและ Delta ไม่ได้ค้าง ต้องไม่ขึ้น').toBe(0);

  // Delta ยังค้าง 500 → แถวต้องกลับมา
  await openWithDelta(page, [deltaRow('PO-B001|' + PN_B, 34, 500)], ORDERS, shippedOut);
  expect(await page.locator('#dnTable input.dn-alloc[data-order="PO-B001|' + PN_B + '"]').count(),
    'Delta ยังค้าง ต้องขึ้นให้ส่งของได้').toBe(1);

  const row = await page.locator('#dnTable tbody tr').filter({ hasText: 'PO-B001' }).innerText();
  expect(row, 'และต้องบอกว่าทำไมแถวนี้ถึงโผล่มา').toContain('Delta ยังค้าง');
});

test('แถวที่โผล่เพราะ Delta ยังค้าง ต้องไม่ขึ้น "เกิน" ทุกจำนวนที่คีย์', async ({ page }) => {
  // ยอดค้างฝั่งเราเป็น 0 ถ้าวัด "เกิน" กับของเราอย่างเดียว ทุกจำนวนจะขึ้นเกินหมด
  // กลายเป็นเสียงรบกวนบนแถวที่เพิ่งตั้งใจให้โผล่มา
  const shippedOut = [{
    id: 'S-full', date: '2026-08-20', orderId: 'PO-B001|' + PN_B, process: 'shipping',
    qty: 12000, note: '', deviceName: 't',
    createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
    voided: false, _dirty: false
  }];
  await openWithDelta(page, [deltaRow('PO-B001|' + PN_B, 34, 500)], ORDERS, shippedOut);

  await alloc(page, 'PO-B001|' + PN_B, 500);
  let row = await page.locator('#dnTable tbody tr').filter({ hasText: 'PO-B001' }).innerText();
  expect(row, 'ส่งเท่าที่ Delta ค้าง ต้องไม่เตือนว่าเกิน').not.toContain('เกิน');

  await alloc(page, 'PO-B001|' + PN_B, 900);
  row = await page.locator('#dnTable tbody tr').filter({ hasText: 'PO-B001' }).innerText();
  expect(row, 'มากกว่าที่ทั้งสองฝั่งคิดว่าค้าง ถึงจะเตือน').toContain('เกิน');
});

test('ยอดของ Delta ต้องไม่ถูกใช้ตัดแถวทิ้ง — ใช้เพิ่มแถวได้อย่างเดียว', async ({ page }) => {
  // กับดักที่กลับทิศได้ง่ายเวลามีคนมาแก้ตัวกรองรอบหน้า
  // ใบที่เรายังค้างส่งอยู่ แต่ Delta ไม่มีข้อมูล ต้องยังอยู่บนจอเสมอ
  await openWithDelta(page, [deltaRow('PO-B001|' + PN_B, 34, 500)]);
  expect(await page.locator('#dnTable input.dn-alloc').count(),
    'ใบที่ Delta ไม่มีข้อมูลต้องไม่หายไปไหน').toBe(3);
});

test('มีหลายงวด ต้องใช้งวดที่ใหม่กว่า และบอกบนจอว่างวดไหน', async ({ page }) => {
  await openWithDelta(page, [
    deltaRow('PO-B001|' + PN_B, 33, 9000),
    deltaRow('PO-B001|' + PN_B, 35, 4200),
    deltaRow('PO-B001|' + PN_B, 34, 7500)
  ]);
  await expect(page.locator('#dnTable tbody tr').filter({ hasText: 'PO-B001' }))
    .toContainText('wk35');

  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await pack(page, PN_B, 'perBox', 50);
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  const at = ref => (new RegExp('<c r="' + ref + '"[^>]*>[^<]*<v>([^<]*)</v>').exec(xml) || [])[1];
  expect(at('G10'), 'งวด 35 ใหม่กว่า 34 และ 33').toBe('4200');
});

test('ยอดที่ยกเลิกแล้วต้องไม่ถูกหยิบมาใช้', async ({ page }) => {
  await openWithDelta(page, [
    Object.assign(deltaRow('PO-B001|' + PN_B, 35, 4200), { voided: true }),
    deltaRow('PO-B001|' + PN_B, 34, 7500)
  ]);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await pack(page, PN_B, 'perBox', 50);
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');
  const at = ref => (new RegExp('<c r="' + ref + '"[^>]*>[^<]*<v>([^<]*)</v>').exec(xml) || [])[1];
  expect(at('G10'), 'ต้องข้ามงวดที่ยกเลิกไปใช้งวด 34').toBe('7500');
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
  await alloc(page, 'PO-B001|' + PN_B, 1500);
  await alloc(page, 'PO-A004|' + PN_A, 70);

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
  await alloc(page, 'PO-A004|' + PN_A, 70);
  await pack(page, PN_A, 'perBox', 10);

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

/** กรอกครบหนึ่งกลุ่มสองใบ — กรอกยอดราย PO แล้วโปรแกรมแบ่งกล่องให้เอง (รวม 1,500 = 30 กล่อง) */
async function fillGroupB(page) {
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await alloc(page, 'PO-B055|' + PN_B, 500);
  await pack(page, PN_B, 'perBox', 50);
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

test('ใบสั่งที่ไม่ได้ส่งวันนี้ ต้องไม่มีบรรทัดบนกระดาษ', async ({ page }) => {
  // เจ้าของแจ้ง 1 ก.ย. 2026 — ใบส่งของดึงมาทุก PO ของ P/N ที่ส่ง แม้ใบนั้นจะส่ง 0
  // ใบส่งสินค้าคือรายการ "ของที่ส่งไปกับรอบนี้" ไม่ใช่รายการใบสั่งที่ยังค้าง
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);      // ส่งใบเดียวจากสองใบของกลุ่ม
  await pack(page, PN_B, 'perBox', 50);

  expect(await page.locator('#dnTable input.dn-alloc').count(),
    'บนจอต้องยังเห็นครบทุกใบ ไม่งั้นไม่มีช่องให้กรอก').toBe(3);

  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');

  expect(xml, 'ใบที่ส่งจริงต้องอยู่').toContain('PO-B001');
  expect(xml, 'ใบที่ส่ง 0 ต้องไม่มีบรรทัด').not.toContain('PO-B055');
  expect(xml, 'กลุ่มอื่นที่ไม่ได้ส่งเลยก็ต้องไม่มี').not.toContain('PO-A004');
});

test('กลุ่มที่เหลือใบเดียวหลังกรองแล้ว ต้องไม่ merge ช่องบรรจุ', async ({ page }) => {
  // merge คร่อมสองแถวทั้งที่มีบรรทัดเดียว จะทำให้ใบเสียและดูเหมือนใบที่ไม่ได้ส่งก็อยู่ในรอบนี้
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await pack(page, PN_B, 'perBox', 50);
  const { out } = await exportForm(page);
  const xml = await (await JSZip.loadAsync(out)).file('xl/worksheets/sheet1.xml').async('string');

  for (const c of ['M', 'N', 'O', 'P']) {
    expect(xml, 'ไม่ควรมี merge ของคอลัมน์ ' + c + ' เพราะเหลือแถวเดียว')
      .not.toContain('<mergeCell ref="' + c + '10:' + c + '11"/>');
  }
  expect(xml, 'ยอดบรรจุยังต้องลงแถวแรก').toMatch(/<c r="M10"[^>]*>[^<]*<v>50<\/v>/);
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

test('BUG — กรอกยอดครบแล้ว ยอดในไฟล์ต้องไม่กลายเป็น 0', async ({ page }) => {
  // เดิมเทสข้อนี้กรอกยอดบรรจุตรง ๆ เพราะตอนนั้นยังกรอกแบบนั้นได้
  // ตอนนี้ยอดรวมมาจากผลบวกของ PO จึงกรอกให้ได้ 1,507 เท่าเดิม แล้วตรวจสิ่งเดิมทุกอย่าง
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 1000);
  await alloc(page, 'PO-B055|' + PN_B, 507);   // รวม 1,507 ชิ้น
  await pack(page, PN_B, 'perBox', 50);

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
