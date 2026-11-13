// เทสหน้า "ยอดรายวันทุกขั้น" — หน้าอ่านอย่างเดียวที่โชว์ยอดของวันเดียวครบทุกขั้นในแถวเดียว
//
// เจ้าของสั่ง 3 พ.ย. 2026 หลังพบว่าคนอ่านตัวจริง (คุณพ่อของเจ้าของ) ไม่ได้ใช้ Dashboard
// เพราะมันบอกยอดสะสม ตอบไม่ได้ว่า "วันนั้นทำได้เท่าไหร่" ส่วนหน้าบันทึกยอดรายวันตอบได้
// แต่เห็นทีละขั้น ต้องกดไล่ทุกขั้นแล้วจำเลขไว้ในหัว
//
// ⚠️ สองเรื่องที่เป็นหัวใจของใบนี้ และถ้าพังจะพังแบบเงียบ:
//    1. ตัวเลขต้องเป็น "ยอดของวันนั้น" ไม่ใช่ยอดสะสม — ถ้าเผลอใช้ buildCumMap() จอจะดูปกติ
//       ทุกอย่าง แค่ตัวเลขใหญ่กว่าความจริง ซึ่งไม่มีใครจับได้จนไปเทียบกับกระดาษ
//    2. "—" กับ "0" ต้องต่างกัน — "—" คือไม่มีใครคีย์ · "0" คือคีย์ไว้ว่าผลิตศูนย์
//       เขียน `!v` แทน `v==null` เมื่อไหร่ วันที่หยุดงานจะอ่านไม่ต่างจากวันที่ยังไม่ได้คีย์

const { test, expect } = require('@playwright/test');
const { waitReady, readSaved } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const PN = '9000000002';
const D1 = '2026-08-20';
const D2 = '2026-08-21';

const order = (poNo, qty, unit = 'TUE-U', week = 'WK 34') => ({
  id: poNo, week, poNo, pn: PN, subName: unit, orderQty: qty,
  orderDate: '2026-08-01', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, process, qty, date = D1, extra = {}) => Object.assign({
  id, date, orderId, process, qty, note: '', deviceName: 't',
  createdAt: date + 'T00:00:00.000Z', updatedAt: date + 'T00:00:00.000Z',
  voided: false, _dirty: false
}, extra);

/** เปิดหน้า "ยอดรายวันทุกขั้น" แล้วตั้งวันที่ให้ตรงกับข้อมูลที่ใส่ไว้
 *  ⚠️ ต้องตั้ง #dayDate เอง — ค่าตั้งต้นของหน้าคือ "วันนี้" ตามเวลาเครื่อง
 *     ถ้าไม่ตั้ง ตารางจะว่างทุกข้อ แล้วเทสจะเขียวเพราะไม่มีอะไรให้ดู ไม่ใช่เพราะโค้ดถูก */
async function openDaily(page, orders, records = [], date = D1, processes = null) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.addInitScript(([k, o, r, p]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't', processes: p,
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders, records, processes]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="daily"]');
  await page.fill('#dayDate', date);
  await page.waitForTimeout(250);
}

// ลำดับคอลัมน์ — # · สัปดาห์ · PO · P/N · Sub-Name · Order Qty · สะสม · คงเหลือ · ยอดวันนั้น · หมายเหตุ · Order Date · Aging
/* ⚠️ 13 พ.ย. 2569 เจ้าของสั่งเปลี่ยนคอลัมน์สุดท้ายจากป้ายสถานะเป็น Aging แล้วเติม Order Date
      ไว้ข้าง ๆ · สถานะยังอยู่ แต่ไปอยู่ใน `title` ของช่อง Aging ไม่ใช่ข้อความในช่อง */
const COL = { qty: 5, cum: 6, rem: 7, today: 8, note: 9, orderDate: 10, aging: 11 };
const rowOf = (page, po) => page.locator('#dayTable tbody tr', { hasText: po });
const cellOf = (page, po, col) => rowOf(page, po).locator('td').nth(COL[col]);
// แถวรวมมีช่องแรกเป็น colspan="8" ช่องยอดรวมจึงเป็น td ตัวที่ 1
const footTotal = page => page.locator('#dayTable tfoot td').nth(1);

/* ปุ่มขั้นอ้างด้วย "ลำดับ" ไม่ใช่ชื่อ — ชื่อขั้นเปลี่ยนได้จากแผงจัดการขั้น (A3)
   ฝังชื่อไทยไว้ในเทสแล้วเทสจะแดงเพราะเจ้าของเปลี่ยนชื่อ ไม่ใช่เพราะโค้ดพัง */
const PI = { winding: 0, assembly: 1, support: 2, inspection: 3, shipping: 4 };
const procBtn = (page, p) => page.locator('#dayProcBtns button').nth(PI[p]);
async function pick(page, p) {
  await procBtn(page, p).click();
  await page.waitForTimeout(200);
}
/** เลขบนปุ่มของขั้นนั้น (ยอดรวมของวันนั้นทุกขั้น = ครึ่งหนึ่งของเหตุผลที่หน้านี้มีอยู่) */
const procNum = async (page, p) => (await procBtn(page, p).locator('.day-n').innerText()).trim();

const ORDERS = [order('PO-1', 4000), order('PO-2', 5000, 'TUE-H', 'WK 35')];

// ── 1. โครงตาราง: ทุกขั้นพร้อมกัน ───────────────────────────────────

test('ปุ่มขั้นต้องเป็นรายการขั้นชุดเดียวกับหน้าคีย์ยอด', async ({ page }) => {
  // อ่านปุ่มจากหน้าคีย์ยอดเองแล้วเทียบ — ไม่ฝังชื่อขั้นไว้ในเทส
  // เจ้าของเพิ่ม/เปลี่ยนชื่อ/ซ่อนขั้นเมื่อไหร่ สองหน้าต้องเปลี่ยนตามกันทั้งคู่ (A3)
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100)]);
  const dayBtns = (await page.locator('#dayProcBtns button').allInnerTexts())
    .map(t => t.replace(/[\d,—]+\s*$/, '').trim());
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(150);
  const entryBtns = (await page.locator('#procButtons button').allInnerTexts()).map(t => t.trim());
  expect(dayBtns.length).toBeGreaterThanOrEqual(5);
  expect(dayBtns).toEqual(entryBtns);
});

test('ใบเดียวที่คีย์หลายขั้นในวันเดียว — เลขบนปุ่มบอกครบทุกขั้น กดดูได้ทีละขั้น', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100),
    rec('r2', 'PO-1', 'assembly', 80),
    rec('r3', 'PO-1', 'inspection', 70)
  ]);
  // "เห็นทุกขั้นพร้อมกัน" ที่เจ้าของขอ อยู่บนปุ่ม ไม่ใช่ในตาราง
  expect(await procNum(page, 'winding')).toBe('100');
  expect(await procNum(page, 'assembly')).toBe('80');
  expect(await procNum(page, 'inspection')).toBe('70');
  expect(await procNum(page, 'support')).toBe('—');

  // ตารางโชว์ทีละขั้น
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('100');
  await pick(page, 'assembly');
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('80');
  await pick(page, 'inspection');
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('70');
  // ขั้นที่วันนั้นไม่ได้คีย์ — ตารางว่าง ไม่ใช่โชว์ศูนย์
  await pick(page, 'support');
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
});

test('ยอดส่งของที่มาจากใบส่งสินค้า ต้องอ่านได้ที่ขั้นส่งของ', async ({ page }) => {
  // หน้าบันทึกยอดรายวันคีย์ขั้นนี้ไม่ได้ (A2) แต่ "อ่าน" ได้ — หน้านี้เป็นหน้าอ่าน จึงต้องเห็น
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'shipping', 500, D1, { note: 'จากใบส่งสินค้า' })
  ]);
  expect(await procNum(page, 'shipping')).toBe('500');
  await pick(page, 'shipping');
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('500');
  // คำบอกที่มาของยอดต้องอ่านออกบนจอ ไม่ใช่ซ่อนไว้
  expect(await cellOf(page, 'PO-1', 'note').innerText()).toContain('ใบส่งสินค้า');
});

// ── 2. หัวใจข้อที่ 1: ยอดของวันนั้น ไม่ใช่ยอดสะสม ────────────────────

test('ยอดวันนั้นกับยอดสะสมอยู่คนละช่อง และเป็นคนละเลข', async ({ page }) => {
  // คีย์ขั้นเดียวกันสองวัน — สะสมได้ 800 แต่ของวันที่ 21 คือ 300
  // หัวใจของหน้านี้: ถ้าเผลอเอายอดสะสมมาใส่ช่อง "ยอดวันนั้น" จอจะดูปกติทุกอย่าง แค่เลขใหญ่เกินจริง
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 500, D1),
    rec('r2', 'PO-1', 'winding', 300, D2)
  ], D2);
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('300');
  expect(await cellOf(page, 'PO-1', 'cum').innerText()).toBe('800');
  expect(await cellOf(page, 'PO-1', 'rem').innerText()).toBe('3,200');
  expect(await procNum(page, 'winding')).toBe('300');
  expect(await footTotal(page).innerText()).toBe('300');
});

test('เปลี่ยนวันไปวันที่ไม่ได้คีย์ แถวต้องหายไป ไม่ใช่ค้างเลขของวันก่อน', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500, D1)], D1);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);

  await page.fill('#dayDate', '2026-08-25');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
});

// ── 3. หัวใจข้อที่ 2: "—" กับ "0" ต่างกัน ──────────────────────────

test('ยอด 0 ที่มีคนคีย์ไว้ ต้องขึ้นเป็น 0 ไม่ใช่ขีด', async ({ page }) => {
  // record ยอด 0 เกิดได้เองจากการเลือกเหตุผลตอนยังไม่มียอด (เจ้าของเลือก 27 ต.ค. 2026)
  // และมันแปลว่า "วันนี้ผลิต 0" ซึ่งเป็นข้อมูล ไม่ใช่ความว่าง
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 0, D1, { note: 'เครื่องเสีย' })]);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('0');
});

test('ใบที่มีแต่ยอด 0 ต้องนับว่า "วันนั้นมีการคีย์" และขึ้นในตารางตั้งต้น', async ({ page }) => {
  // record ยอด 0 เกิดเองได้จากการเลือกเหตุผลตอนยังไม่มียอด (27 ต.ค. 2026)
  // ถ้านับว่า "ไม่มีการคีย์" ใบที่หยุดงานพร้อมเหตุผลจะหายไปจากหน้านี้ทั้งใบ
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 0, D1, { note: 'เครื่องเสีย' })]);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('0');
  expect(await cellOf(page, 'PO-1', 'note').innerText()).toBe('เครื่องเสีย');
  await expect(rowOf(page, 'PO-2')).toHaveCount(0);
});

// ── 4. สวิตช์ "แสดงทุกใบ" (เจ้าของเลือก 3 พ.ย. 2026) ────────────────

test('ค่าตั้งต้นโชว์เฉพาะใบที่วันนั้นมีการคีย์', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100, D1)]);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);
  await expect(rowOf(page, 'PO-2')).toHaveCount(0);
});

test('ติ๊ก "แสดงทุกใบ" แล้วใบที่ขั้นนั้นวันนั้นไม่ได้คีย์ต้องขึ้น พร้อมขีด', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100)]);
  await expect(rowOf(page, 'PO-2')).toHaveCount(0);
  await page.check('#dayShowAll');
  await page.waitForTimeout(250);
  await expect(rowOf(page, 'PO-2')).toHaveCount(1);
  expect(await cellOf(page, 'PO-2', 'today').innerText()).toBe('—');
  // ยอดสะสมกับคงเหลือยังต้องอ่านได้ แม้วันนั้นไม่ได้คีย์
  expect(await cellOf(page, 'PO-2', 'cum').innerText()).toBe('0');
  expect(await cellOf(page, 'PO-2', 'rem').innerText()).toBe('5,000');
  // ขีดไม่ใช่ศูนย์ — ยอดรวมต้องไม่ขยับ
  expect(await footTotal(page).innerText()).toBe('100');
});

// ── 5. แถวรวมท้ายตาราง ────────────────────────────────────────────

test('แถวรวมท้ายตารางเป็นผลรวมของขั้นที่เลือก และไม่นับช่องที่ไม่มีการคีย์', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 500),
    rec('r2', 'PO-2', 'winding', 1200),
    rec('r3', 'PO-1', 'assembly', 60)
  ]);
  expect(await footTotal(page).innerText()).toBe('1,700');
  await pick(page, 'assembly');
  expect(await footTotal(page).innerText()).toBe('60');
  // ขั้นที่ไม่มีใครทำ — ยอดรวมต้องเป็นขีด ไม่ใช่ 0
  await pick(page, 'support');
  expect(await footTotal(page).innerText()).toBe('—');
});

// ── 6. รายการที่ยกเลิกไว้ (B1) ─────────────────────────────────────

test('รายการที่ยกเลิกไว้ต้องไม่นับ — ทั้งในช่องและในแถวรวม', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100, D1, { voided: true }),
    rec('r2', 'PO-2', 'winding', 250, D1)
  ]);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
  expect(await footTotal(page).innerText()).toBe('250');
});

// ── 7. อ่านอย่างเดียว — เหตุผลครึ่งหนึ่งที่หน้านี้มีอยู่ ──────────────

test('ในตารางต้องไม่มีช่องกรอกหรือช่องเลือกเลย — หน้านี้อ่านอย่างเดียว', async ({ page }) => {
  // หน้าบันทึกยอดรายวันมีช่องกรอกทุกแถว บันทึกทันทีที่ค่าเปลี่ยน และไม่มีด่านกันลูกกลิ้งเมาส์
  // คนที่เปิดมา "ดู" เลื่อนลูกกลิ้งทับช่องแล้วยอดผลิตเปลี่ยนจริง — หน้านี้มีไว้ให้อ่านโดยไม่เสี่ยง
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100, D1)]);
  await page.check('#dayShowAll');
  await page.waitForTimeout(200);
  expect(await page.locator('#dayTable input').count()).toBe(0);
  expect(await page.locator('#dayTable select').count()).toBe(0);
  expect(await page.locator('#dayTable textarea').count()).toBe(0);
  expect(await page.locator('#dayTable [contenteditable]').count()).toBe(0);
});

test('หน้านี้ต้องไม่เขียนข้อมูลลงเครื่องเลย — เล่นตัวกรองทุกตัวแล้ว state ต้องไม่ขยับแม้แต่ตัวอักษร', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100, D1)], D1);
  const before = await readSaved(page, K_STATE, { raw: true });
  await page.check('#dayShowAll');
  await page.fill('#dayDate', D2);
  await page.fill('#daySearch', 'PO-1');
  await page.selectOption('#daySubFilter', 'TUE-U');
  await page.waitForTimeout(250);
  expect(await readSaved(page, K_STATE, { raw: true })).toBe(before);
});

// ── 8. ตัวกรอง ────────────────────────────────────────────────────

test('ค้นหา PO กรองแถวได้ และแถวรวมขยับตามสิ่งที่เห็น', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100, D1),
    rec('r2', 'PO-2', 'winding', 250, D1)
  ]);
  expect(await footTotal(page).innerText()).toBe('350');

  await page.fill('#daySearch', 'PO-2');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
  expect(await footTotal(page).innerText()).toBe('250');
});

test('กรองสัปดาห์กับ Sub-Name ได้ และตัวเลือกมาจากข้อมูลจริง', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100, D1),
    rec('r2', 'PO-2', 'winding', 250, D1)
  ]);
  expect(await page.locator('#daySubFilter option').allInnerTexts())
    .toEqual(['ทั้งหมด', 'TUE-H', 'TUE-U']);

  await page.selectOption('#daySubFilter', 'TUE-H');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
  await expect(rowOf(page, 'PO-2')).toHaveCount(1);

  await page.selectOption('#daySubFilter', '');
  await page.selectOption('#dayWeekFilter', 'WK 34');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);
  await expect(rowOf(page, 'PO-2')).toHaveCount(0);
});

// ── 9. เข้าหน้าแล้วต้องมีของให้ดูทันที ──────────────────────────────

test('กดเข้าแท็บแล้วตารางต้องวาดทันที ไม่ใช่ว่างจนกว่าจะแตะตัวกรอง', async ({ page }) => {
  // ตารางว่างอ่านได้ว่า "วันนั้นไม่มีใครทำอะไร" ซึ่งเป็นคำตอบที่ผิดและไม่มีอะไรฟ้อง
  // (กฎเดียวกับ renderDnLog() ที่ต้องมีทางเรียกครบทุกทาง)
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, ORDERS, [rec('r1', 'PO-1', 'winding', 777, today)]]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="daily"]');
  // ไม่แตะตัวกรองอะไรเลย — วันตั้งต้นของหน้าคือวันนี้
  await expect(page.locator('#dayTable thead th').first()).toBeVisible();
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('777');
});

// ── 8. ข้อความตอนตารางว่าง ต้องตรงกับความจริง และทางที่มันแนะต้องได้ผล ──
//
// ผู้ตรวจ #118 จับสองรอบติด และรอบที่สองจับได้ว่า **เทสของรอบแรกล็อกข้อความผิดไว้เอง**
// (ตรวจแค่ว่ามีคำว่า "ตัวกรอง" ซึ่งเป็นคำที่ผิดในฉากนั้นพอดี)
//
// ⚠️ อย่าเขียนเทสพวกนี้เป็น "มีคำนี้ไหม" อย่างเดียว · ของที่ต้องยืนยันคือ
//    **ทางที่ข้อความแนะ กดแล้วได้ผลจริง** ซึ่งทดสอบได้ด้วยการกดตามแล้วดูว่ามีแถวโผล่

test('ใบที่ตรงตัวกรองมีอยู่ แต่วันนั้นไม่มีใครคีย์ — ห้ามบอกว่าไม่มีใบที่ตรงตัวกรอง', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)]);   // คีย์ไว้เฉพาะ PO-1 (WK 34)
  await page.selectOption('#dayWeekFilter', 'WK 35');                   // PO-2 มีอยู่จริง แต่วันนั้นไม่ได้คีย์
  await page.waitForTimeout(250);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).not.toContain('ไม่มีใบที่ตรงกับตัวกรอง');
  expect(msg).toContain('แสดงทุกใบ');
  expect(msg).toContain('1 ใบ');                                        // บอกจำนวนที่ติ๊กแล้วจะเห็น
});

test('ทางที่ข้อความแนะต้องได้ผล — ติ๊ก "แสดงทุกใบ" แล้วใบนั้นต้องโผล่จริง', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)]);
  await page.selectOption('#dayWeekFilter', 'WK 35');
  await page.waitForTimeout(250);
  await page.check('#dayShowAll');                                      // ทำตามที่ข้อความบอก
  await page.waitForTimeout(250);
  await expect(rowOf(page, 'PO-2')).toHaveCount(1);
  expect(await cellOf(page, 'PO-2', 'today').innerText()).toBe('—');
});

test('ไม่มีใบไหนตรงตัวกรองเลย — ตอนนั้นจึงบอกให้ล้างตัวกรองได้', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)]);
  await page.fill('#daySearch', 'PO-9999');
  await page.waitForTimeout(250);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).toContain('ตัวกรอง');
  expect(msg).not.toContain('แสดงทุกใบ');                               // ติ๊กแล้วก็ยังว่าง จึงห้ามแนะ
});

test('ไม่ได้ตั้งตัวกรอง วันนั้นไม่มีใครคีย์ — บอกจำนวนใบทั้งหมดที่ติ๊กแล้วจะเห็น', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)], D2);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).toContain('แสดงทุกใบ');
  expect(msg).toContain('2 ใบ');
  expect(msg).not.toContain('ตัวกรอง');
});

test('ยังไม่นำเข้าแผนเลย — ห้ามแนะให้ติ๊ก "แสดงทุกใบ" เพราะติ๊กแล้วก็ว่างเหมือนเดิม', async ({ page }) => {
  await openDaily(page, [], []);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).toContain('นำเข้าแผนงาน');
  expect(msg).not.toContain('แสดงทุกใบ');
});

test('ติ๊ก "แสดงทุกใบ" แล้วยังว่าง = ไม่มีบรรทัดแผนงาน ไม่ใช่เรื่องตัวกรอง', async ({ page }) => {
  await openDaily(page, [], []);
  await page.check('#dayShowAll');
  await page.waitForTimeout(250);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).toContain('นำเข้าแผนงาน');
  expect(msg).not.toContain('ตัวกรอง');
});

// ── 9. สองข้อที่ผู้ตรวจ #118 รอบสามทัก — ทั้งคู่เรื่องคนอ่าน ไม่ใช่ตัวเลข ────

test('แถวรวมต้องเห็นได้โดยไม่ต้องเลื่อนไปสุด แม้ตารางยาวเกินกรอบ', async ({ page }) => {
  // กรอบ .table-wrap สูงสุด 70vh · ที่ของจริง 712 ใบ แถวรวมจะหลุดไปใต้ขอบล่าง
  // และยอดรวมของวันนั้นคือหนึ่งในของที่เจ้าของอยากให้คุณพ่ออ่าน
  const many = [];
  const recs = [];
  for (let i = 0; i < 60; i++) {
    many.push(order('PO-' + i, 1000));
    recs.push(rec('r' + i, 'PO-' + i, 'winding', 10));
  }
  await openDaily(page, many, recs);
  await page.setViewportSize({ width: 1400, height: 500 });   // บังคับให้ตารางยาวเกินกรอบ
  await page.waitForTimeout(250);
  // เทียบกับกรอบที่เลื่อน ไม่ใช่กับหน้าจอ — ของที่แก้คือ "ต้องไถ 712 แถวก่อนเจอยอดรวม"
  const seen = await page.evaluate(() => {
    const wrap = document.querySelector('#view-daily .table-wrap');
    wrap.scrollTop = 0;                                   // อยู่หัวตาราง
    const f = document.querySelector('#dayTable tfoot td');
    const w = wrap.getBoundingClientRect(), r = f.getBoundingClientRect();
    return {
      overflows: wrap.scrollHeight > wrap.clientHeight + 5,   // ตารางยาวเกินกรอบจริง
      inside: r.top >= w.top - 1 && r.bottom <= w.bottom + 1  // แถวรวมอยู่ในส่วนที่มองเห็น
    };
  });
  expect(seen.overflows).toBe(true);
  expect(seen.inside).toBe(true);
  expect(await footTotal(page).innerText()).toBe('600');
});

test('คำแนะนำวิธีแก้ยอดต้องบอกข้อยกเว้นของขั้นส่งของ', async ({ page }) => {
  // หน้าคีย์ยอดรายวันไม่มีช่องกรอกของขั้นส่งของ (ปิดไปเมื่อ 23 ต.ค. 2026)
  // ส่งคนไปที่นั่นเฉย ๆ คือให้เขาเดินเกินหนึ่งทอดแล้วค่อยเจอแถบบอกทางที่ปลายทาง
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)]);
  const desc = await page.locator('#view-daily .desc').first().innerText();
  expect(desc).toContain('ส่งของ');
  expect(desc).toContain('ใบส่งสินค้า');
});

// ── 10. สองข้อของผู้ตรวจ #118 รอบสี่ ────────────────────────────────

test('ตอนพิมพ์ แถวรวมต้องไม่ลอยทับแถวข้อมูล', async ({ page }) => {
  // การตรึงแถวรวมไว้ขอบล่าง (รอบสาม) พังตอนพิมพ์ เพราะ @media print ปลด .table-wrap
  // เป็น overflow:visible กรอบที่คุม sticky จึงหายไป แถบไปตรึงที่ขอบหน้าต่างแล้วทับแถวกลางตาราง
  const many = [];
  const recs = [];
  for (let i = 0; i < 60; i++) {
    many.push(order('PO-' + String(i).padStart(3, '0'), 1000));
    recs.push(rec('r' + i, 'PO-' + String(i).padStart(3, '0'), 'winding', 10));
  }
  await openDaily(page, many, recs);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(150);

  const foot = footTotal(page);
  expect(await foot.evaluate(el => getComputedStyle(el).position)).toBe('static');
  // ของที่ผู้ตรวจวัดจริง: แถวรวมต้องอยู่ "ใต้" แถวสุดท้าย ไม่ใช่ลอยค้างกลางตาราง
  const ok = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#dayTable tbody tr')];
    const last = rows[rows.length - 1].getBoundingClientRect();
    const f = document.querySelector('#dayTable tfoot td').getBoundingClientRect();
    return { footTop: Math.round(f.top), lastBottom: Math.round(last.bottom) };
  });
  expect(ok.footTop).toBeGreaterThanOrEqual(ok.lastBottom - 1);

  await page.emulateMedia({ media: 'screen' });
  await page.waitForTimeout(150);
  // บนจอต้องยังตรึงอยู่ — ห้ามแก้กระดาษแล้วทำของบนจอหาย
  expect(await foot.evaluate(el => getComputedStyle(el).position)).toBe('sticky');
});

test('ลำดับแถวต้องตรงกับหน้าบันทึกยอดรายวัน และนิ่งเมื่อวันสั่งซ้ำกัน', async ({ page }) => {
  /* ⚠️ ของจริง orderDate ซ้ำกันทั้งไฟล์ · ถ้าเรียงแค่ week → orderDate ลำดับจะตกไปเป็น
   *    ลำดับในอาร์เรย์ แล้วเครื่องที่นำเข้าเองกับที่ดึงจากเซิร์ฟเวอร์โชว์คนละลำดับ (ผู้ตรวจ #118 รอบห้า)
   *    จึงต้องใส่ใบที่วันสั่งซ้ำกันและเรียงสลับไว้ในอาร์เรย์ ไม่งั้นตัวตัดสินที่สามไม่ถูกใช้เลย */
  const orders = [
    { ...order('PO-C', 1000), orderDate: '2026-08-02' },
    { ...order('PO-A', 1000), orderDate: '2026-08-02' },
    { ...order('PO-B', 1000), orderDate: '2026-08-01' }
  ];
  const recs = ['PO-A', 'PO-B', 'PO-C'].map((po, i) => rec('r' + i, po, 'winding', 10));
  await openDaily(page, orders, recs);
  const onDay = (await page.locator('#dayTable tbody tr td:nth-child(3)').allInnerTexts()).map(s => s.trim());
  expect(onDay).toEqual(['PO-B', 'PO-A', 'PO-C']);

  await page.click('.tab-btn[data-tab="entry"]');
  await page.fill('#entryDate', D1);
  await page.waitForTimeout(250);
  // ทั้งสองหน้าวางคอลัมน์ PO ไว้ช่องที่สามเหมือนกัน
  const onEntry = (await page.locator('#entryTable tbody tr td:nth-child(3)').allInnerTexts()).map(s => s.trim());
  expect(onEntry).toEqual(onDay);
});

// ── 11. แบบ F — แถบปุ่มขั้นทำสองหน้าที่ (เจ้าของเคาะ 4 พ.ย. 2026) ─────
//
// ⚠️ เลขบนปุ่มคือครึ่งหนึ่งของเหตุผลที่หน้านี้มีอยู่ — มันคือ "เห็นทุกขั้นพร้อมกัน"
//    ที่เจ้าของขอตอนแรก ย้ายจากคอลัมน์มาอยู่บนปุ่ม หลังพบว่าทำเป็นคอลัมน์แล้วเป็นกำแพงขีด
//    ถอดเลขออกเมื่อไหร่ หน้านี้เหลือแค่หน้าคีย์ยอดที่กรอกไม่ได้

test('ขั้นที่วันนั้นไม่มีใครคีย์ ต้องยังมีปุ่มและจาง ไม่ใช่ปุ่มหาย', async ({ page }) => {
  // ซ่อนปุ่มแล้วปุ่มจะหาย ๆ โผล่ ๆ ทุกวันจนจำตำแหน่งไม่ได้ ซึ่งแย่กว่าปุ่มที่กดแล้วตารางว่าง
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100)]);
  await expect(procBtn(page, 'support')).toHaveCount(1);
  expect(await procNum(page, 'support')).toBe('—');
  await expect(procBtn(page, 'support').locator('.day-n')).toHaveClass(/zero/);
  await expect(procBtn(page, 'winding').locator('.day-n')).not.toHaveClass(/zero/);
});

test('เลขบนปุ่มต้องตรงกับตารางเสมอ — ขยับตามตัวกรองด้วย', async ({ page }) => {
  // เลขบนปุ่มคิดจากชุดใบที่กรองแล้ว ไม่ใช่ของทั้งโรงงาน ไม่งั้นกดปุ่มแล้วตารางได้คนละเลข
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 500),
    rec('r2', 'PO-2', 'winding', 1200)
  ]);
  expect(await procNum(page, 'winding')).toBe('1,700');
  expect(await footTotal(page).innerText()).toBe('1,700');
  await page.selectOption('#dayWeekFilter', 'WK 35');   // เหลือ PO-2
  await page.waitForTimeout(250);
  expect(await procNum(page, 'winding')).toBe('1,200');
  expect(await footTotal(page).innerText()).toBe('1,200');
});

test('หัวคอลัมน์ยอดสะสมต้องบอกชื่อขั้นที่กำลังดู', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100),
    rec('r2', 'PO-1', 'assembly', 80)
  ]);
  const head = () => page.locator('#dayTable thead th').nth(COL.cum).innerText();
  const first = await head();
  await pick(page, 'assembly');
  const second = await head();
  expect(first).not.toBe(second);
  // ชื่อขั้นต้องมาจากรายการขั้นจริง ไม่ใช่ข้อความฝังไว้ (A3)
  const btnLabel = (await procBtn(page, 'assembly').innerText()).replace(/[\d,—]+\s*$/, '').trim();
  expect(second).toContain(btnLabel.replace(/^\S+\s/, ''));
});

test('ช่อง Aging และสถานะใน title ต้องคิดจาก "วันนี้" ไม่ใช่วันที่เลือก', async ({ page }) => {
  // วันที่เลือกคือ 20 ส.ค. 2026 แต่ทั้งสองอย่างคิดจาก "วันนี้" — ใบที่ยังไม่ส่งต้องแดง
  // ส่วนใบที่ส่งครบต้องเขียว แม้แถวนั้นจะมีแต่ยอด winding ของวันที่เลือก
  // ⚠️ ไม่ผูกกับคำว่า "ล่าช้า X" เพราะลำดับการตัดสินของ computeStatus เป็นของ A5 (ปลายน้ำก่อน)
  //    ผูกคำแล้วเทสจะแดงเวลาใครแก้ A5 ให้ถูกขึ้น ซึ่งไม่ใช่เรื่องของหน้านี้
  //    "ส่งของครบแล้ว" ผูกได้ เพราะเป็นข้อแรกสุดของ computeStatus ไม่ขึ้นกับลำดับขั้น
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100),
    rec('r2', 'PO-2', 'winding', 200),
    rec('r3', 'PO-2', 'shipping', 5000)
  ]);
  await expect(cellOf(page, 'PO-1', 'aging').locator('.badge')).toHaveClass(/red/);
  await expect(cellOf(page, 'PO-2', 'aging').locator('.badge')).toHaveClass(/green/);

  /* ⚠️ สถานะต้องอ่านจาก `title` — อ่าน innerText จะได้ตัวเลขอายุงาน แล้วข้อนี้จะเขียว
        โดยไม่ได้ตรวจสถานะเลย (ข้อนี้เคยเขียวแบบนั้นจริงตอนใบ #135 เปลี่ยนคอลัมน์) */
  await expect(cellOf(page, 'PO-2', 'aging'), 'ใบที่ส่งครบต้องบอกว่าส่งครบ')
    .toHaveAttribute('title', /ส่งของครบแล้ว/);
  await expect(cellOf(page, 'PO-1', 'aging'), 'ใบที่ยังไม่ส่งต้องไม่บอกว่าส่งครบ')
    .not.toHaveAttribute('title', /ส่งของครบแล้ว/);
  const t1 = await cellOf(page, 'PO-1', 'aging').getAttribute('title');
  expect(t1.replace('สถานะของใบนี้ ณ วันนี้:', '').trim().length,
    'title ต้องมีสถานะจริง ไม่ใช่หัวข้อเปล่า').toBeGreaterThan(2);
});

test('คอลัมน์ Order Date ต้องโชว์วันที่สั่งแบบไทย และอ่านคู่กับ Aging ได้', async ({ page }) => {
  /* เจ้าของขอเพิ่มคอลัมน์นี้ 13 พ.ย. 2569 · วางติดกับ Aging เพราะ Aging คือ
     "วันนี้ ลบ วันในช่องนี้" — สองช่องอ่านคู่กันแล้วตรวจกันเองได้ */
  /* ⚠️ ต้องประกอบวันจากเวลา **เครื่อง** ไม่ใช่ `toISOString()` ซึ่งเป็น UTC —
     ไทยเป็น UTC+7 ช่วงเที่ยงคืนถึงเจ็ดโมงเช้า UTC ยังเป็นเมื่อวาน เทสจะแดงเองวันละเจ็ดชั่วโมง
     (แดงจริงตอนรันข้ามเที่ยงคืนคืนวันที่ 13) · แอปใช้ `todayISO()` ซึ่งเป็นเวลาเครื่อง */
  const days = n => {
    const x = new Date(); x.setDate(x.getDate() - n);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const o1 = Object.assign(order('PO-1', 4000), { orderDate: days(12) });
  await openDaily(page, [o1], [rec('r1', 'PO-1', 'winding', 100)]);

  const [yy, mm, dd] = days(12).split('-');
  expect((await cellOf(page, 'PO-1', 'orderDate').innerText()).trim(),
    'ต้องเป็น dd/mm/yyyy แบบเดียวกับที่อื่นในแอป').toBe(`${dd}/${mm}/${yy}`);
  expect((await cellOf(page, 'PO-1', 'aging').innerText()).trim(),
    'Aging ต้องเท่ากับจำนวนวันจากช่อง Order Date ถึงวันนี้').toBe('12');
});

test('A3 — ขั้นที่ถูกซ่อนต้องไม่มีปุ่ม และต้องมีขั้นที่ถูกเลือกอยู่หนึ่งขั้นเสมอ', async ({ page }) => {
  // ⚠️ เทสนี้โหลดหน้าครั้งเดียว — รอบสองแอปไม่อ่าน localStorage แล้ว เพราะย้ายเข้า IndexedDB ไปแล้ว
  //    (ธง :moved) การ addInitScript ทับรอบสองจึงไม่มีผล แล้วเทสจะเขียว/แดงเพราะเหตุผลผิด
  const PROCS = [
    { id: 'winding', label: 'Winding/Trimming', short: 'Winding' },
    { id: 'assembly', label: 'Assembly', short: 'Assembly', hidden: true },
    { id: 'support', label: 'Support', short: 'Support' },
    { id: 'inspection', label: 'Inspection', short: 'Inspection' },
    { id: 'shipping', label: 'ส่งของ (Shipping)', short: 'Shipping' }
  ];
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100),
    rec('r2', 'PO-1', 'assembly', 80)
  ], D1, PROCS);
  const labels = (await page.locator('#dayProcBtns button').allInnerTexts()).join(' ');
  expect(labels).not.toContain('Assembly');
  expect(labels).toContain('Winding');
  // ต้องมีขั้นที่ถูกเลือกอยู่เสมอ — ตั้งต้นเป็นขั้นแรกของสายการผลิต ไม่ใช่ไม่มีปุ่มไหนถูกเลือก
  await expect(page.locator('#dayProcBtns button.primary')).toHaveCount(1);
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('100');
  // ยอดของขั้นที่ซ่อนต้องไม่โผล่มาที่ไหนบนหน้านี้ (ตรงกับที่เหลือของแอป)
  expect(labels).not.toContain('80');
});

test('กดปุ่มขั้นแล้วต้องไม่เขียนข้อมูลลงเครื่อง — ปุ่มเป็นทางใหม่ที่เพิ่มเข้ามา', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100)]);
  const before = await readSaved(page, K_STATE, { raw: true });
  for (const p of ['assembly', 'support', 'inspection', 'shipping', 'winding']) await pick(page, p);
  expect(await readSaved(page, K_STATE, { raw: true })).toBe(before);
});

test('เลือกขั้นที่นี่ต้องไม่ลากหน้าคีย์ยอดของพนักงานไปด้วย (G2)', async ({ page }) => {
  // คนละตัวแปรโดยตั้งใจ — พนักงานกำลังคีย์อยู่ขั้นหนึ่ง คนอ่านเปิดดูอีกขั้น ต้องไม่ชนกัน
  // ⚠️ ต้องดู "หัวคอลัมน์สะสมของหน้าคีย์ยอด" ซึ่งสะท้อนขั้นที่หน้านั้นกำลังคีย์จริง
  //    ไม่ใช่ปุ่มที่ไฮไลต์ — การเข้าแท็บไม่ได้วาดปุ่มใหม่ ปุ่มจึงยังไฮไลต์อันเดิมอยู่ดี
  //    (เขียนแบบนั้นแล้วเทสเขียวทั้งที่ตัวแปรถูกลากไปแล้ว — พิสูจน์ด้วย mutation)
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100),
    rec('r2', 'PO-1', 'inspection', 70)
  ]);
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(250);
  const before = await page.locator('#entryTable thead th').nth(6).innerText();

  await page.click('.tab-btn[data-tab="daily"]');
  await page.waitForTimeout(150);
  await pick(page, 'inspection');
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(250);
  expect(await page.locator('#entryTable thead th').nth(6).innerText()).toBe(before);
  expect(await page.locator('#entryTable tbody tr td').nth(6).innerText()).toBe('100');
});

// ── 12. สองข้อของผู้ตรวจ #118 รอบหก ──────────────────────────────────

test('G3 — ชื่อขั้นที่เป็นสคริปต์ต้องไม่ทำงาน แม้ในข้อความตอนตารางว่าง', async ({ page }) => {
  /* แผงจัดการขั้นให้ตั้งชื่อยาวได้ถึง 40 ตัวและไม่กรองอักขระเลย
   * ชื่อขั้นจึงเป็นค่าที่ซิงค์ข้ามเครื่องมาได้ และต้องผ่าน escapeHtml ทุกที่ที่ลง innerHTML
   * ⚠️ ฟังก์ชันนี้ใช้ procLabel สี่ที่ — ปุ่ม · หัวคอลัมน์ · แถวรวม · ข้อความตอนว่าง
   *    เทสนี้ยิงที่ "ตอนว่าง" เพราะเป็นที่เดียวที่เคยหลุด (ผู้ตรวจ #118 รอบหก) */
  const EVIL = '<img src=x onerror=window.__xss=1>';
  await openDaily(page, ORDERS, [], D1, [
    { id: 'winding', label: EVIL, short: 'W' },
    { id: 'assembly', label: 'Assembly', short: 'Assembly' },
    { id: 'support', label: 'Support', short: 'Support' },
    { id: 'inspection', label: 'Inspection', short: 'Inspection' },
    { id: 'shipping', label: 'ส่งของ (Shipping)', short: 'Shipping' }
  ]);
  // ไม่มีใครคีย์ขั้นนี้เลย → ตกเข้าเส้นทางข้อความตอนตารางว่าง
  await expect(page.locator('#dayTable tbody img')).toHaveCount(0);
  await expect(page.locator('#dayProcBtns img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  // ต้องอ่านชื่อขั้นออกเป็นข้อความล้วน ไม่ใช่หายไปทั้งประโยค
  expect(await page.locator('#dayTable tbody').innerText()).toContain(EVIL);
});

test('เลขบนปุ่มต้องแยก "ไม่มีใครคีย์" ออกจาก "คีย์ไว้ว่าผลิต 0" เหมือนที่ตารางแยก', async ({ page }) => {
  // การแยกนี้คือกฎหลักที่ทั้งหน้ายืนอยู่บนมัน — แถบปุ่มจะขัดกับตารางของตัวเองไม่ได้
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 0, D1, { note: 'เครื่องเสีย' })]);
  expect(await procNum(page, 'winding')).toBe('0');     // มีคนคีย์ไว้ว่าผลิตศูนย์
  expect(await procNum(page, 'assembly')).toBe('—');    // ไม่มีใครคีย์เลย
  // ทั้งสองยังจางเหมือนกัน เพราะทั้งคู่ไม่มียอด — ปุ่มต้องไม่หายไปไหน
  await expect(procBtn(page, 'assembly').locator('.day-n')).toHaveClass(/zero/);
  await expect(procBtn(page, 'winding').locator('.day-n')).toHaveClass(/zero/);
});

test('กดปุ่มขั้นด้วยแป้นพิมพ์แล้วโฟกัสต้องอยู่ที่ปุ่มเดิม ไม่หลุดไปต้นหน้า', async ({ page }) => {
  /* แถบปุ่มถูกวาดใหม่ทั้งแถบทุกครั้ง เพราะเลขบนปุ่มต้องขยับตามวันและตัวกรอง
   * ไม่คืนโฟกัสแล้วคนที่ไล่ด้วย Tab จะตกไป BODY แล้วต้องเริ่มจากต้นหน้าใหม่ทุกครั้ง
   * (หน้าคีย์ยอดไม่เจอปัญหานี้เพราะมันแค่สลับคลาส primary ไม่วาดปุ่มใหม่) */
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100),
    rec('r2', 'PO-1', 'assembly', 80)
  ]);
  await procBtn(page, 'assembly').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    proc: document.activeElement.dataset ? document.activeElement.dataset.proc : null
  }))).toEqual({ tag: 'BUTTON', proc: 'assembly' });
  // และต้องเปลี่ยนขั้นจริง ไม่ใช่คืนโฟกัสแล้วตารางไม่ขยับ
  expect(await cellOf(page, 'PO-1', 'today').innerText()).toBe('80');

  // กดต่อด้วยแป้นพิมพ์ได้เรื่อย ๆ โดยไม่ต้องคว้าเมาส์
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.activeElement.dataset.proc)).toBe('support');
});
