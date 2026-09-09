// เทสหน้าตาของหน้าบันทึกยอดผลิตประจำวัน (เจ้าของขอเมื่อ 9 ก.ย. 2026)
//
// สามเรื่องที่ขอมา
//   1. ยุบคอลัมน์ "สะสม" กับ "คงเหลือ" ไปเป็นแถบสถานะใต้ยอด Order Qty
//   2. คอลัมน์กว้างเกินไปตอนไม่ได้กรอง — ตารางยืดเต็มจอ 1400px โดยไม่ได้ข้อมูลเพิ่ม
//   3. ตัวอักษรใหญ่ขึ้นให้คนสายตายาวอ่านได้
//
// ⚠️ ข้อ 3 ต้องอยู่แค่หน้านี้ · หน้าใบส่งสินค้ามี 16 คอลัมน์และเพิ่งแก้เรื่องล้นจอบนมือถือ
//    ไปเมื่อ 4 ก.ย. 2026 — มีเทสคุมไว้ข้างล่างว่าตัวอักษรต้องไม่รั่วไปหน้านั้น

const { test, expect } = require('@playwright/test');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const PN = '9000000002';

const order = (poNo, qty, unit = 'TUE-U') => ({
  id: poNo, week: 'WK 34', poNo, pn: PN, subName: unit, orderQty: qty,
  orderDate: '2026-08-03', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, process, qty) => ({
  id, date: '2026-08-20', orderId, process, qty, note: '', deviceName: 't',
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  voided: false, _dirty: false
});

async function openEntry(page, orders, records = [], width = 1400) {
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(250);
}

const ORDERS = [order('PO-1', 4000), order('PO-2', 5000, 'TUE-H')];
const rowOf = (page, po) => page.locator('#entryTable tbody tr', { hasText: po });

// ── 1. ยุบสองคอลัมน์เป็นแถบสถานะ ───────────────────────────────────

test('ตารางต้องเหลือ 6 คอลัมน์ — ไม่มีคอลัมน์สะสมกับคงเหลือแยกอีกแล้ว', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  expect(await page.locator('#entryTable thead th').count(), 'เดิม 8 คอลัมน์').toBe(6);
  expect(await rowOf(page, 'PO-1').locator('td').count()).toBe(6);
});

test('ยอดสะสมกับคงเหลือต้องยังอยู่ครบ แค่ย้ายไปใต้ Order Qty', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  const cell = rowOf(page, 'PO-1').locator('td').nth(4);
  expect(await cell.locator('.qty-main').innerText(), 'ยอดแผน').toBe('4,000');
  expect(await cell.locator('b.cum').innerText(), 'สะสม').toBe('1,000');
  expect(await cell.locator('b.rem').innerText(), 'คงเหลือ 4,000 − 1,000').toBe('3,000');
});

test('แถบต้องยาวตามสัดส่วนที่ทำได้จริง', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  const pct = await rowOf(page, 'PO-1').locator('.seg-on')
    .evaluate(el => el.style.width);
  expect(pct, '1,000 จาก 4,000 = 25%').toBe('25%');
});

test('ทำครบขั้นนี้แล้วแถบต้องเต็มและเป็นสีเขียว', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 4000)]);
  const bar = rowOf(page, 'PO-1').locator('.progress');
  expect(await bar.getAttribute('class'), 'ต้องติดคลาส done').toContain('done');
  expect(await rowOf(page, 'PO-1').locator('b.rem').innerText()).toBe('0');
});

test('คีย์เกินยอดแผน — แถบต้องไม่ล้น แต่ยอดสะสมต้องบอกความจริง', async ({ page }) => {
  // ⚠️ สะสมไม่ครอบ · ใบที่คีย์เกินต้องเห็นว่าเกิน ไม่ใช่ถูกกลบให้เท่ายอดแผน
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 5200)]);
  expect(await rowOf(page, 'PO-1').locator('.seg-on').evaluate(el => el.style.width))
    .toBe('100%');
  expect(await rowOf(page, 'PO-1').locator('b.cum').innerText(), 'สะสมตามจริง').toBe('5,200');
  expect(await rowOf(page, 'PO-1').locator('b.rem').innerText(), 'คงเหลือครอบที่ 0').toBe('0');
});

test('หัวตารางต้องบอกว่าแถบเป็นของขั้นไหน', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  const th = await page.locator('#entryTable thead th').nth(4).innerText();
  // แถบเต็มแปลว่าเสร็จ "ขั้นที่กำลังคีย์" ไม่ใช่เสร็จทั้งใบ ถ้าไม่บอกขั้นไว้จะอ่านผิดทันที
  expect(th, 'ตอนอยู่ขั้น Winding').toContain('Winding');
  await page.click('#procBtn-inspection');
  await page.waitForTimeout(200);
  expect(await page.locator('#entryTable thead th').nth(4).innerText(), 'สลับขั้นแล้วต้องเปลี่ยนตาม')
    .toContain('Inspection');
});

test('ป้ายเตือนยอดสะสมเกินขั้นก่อนหน้า ต้องยังอยู่', async ({ page }) => {
  // คีย์ Assembly มากกว่า Winding — เดิมป้ายอยู่ในคอลัมน์สะสมที่ถูกยุบไปแล้ว
  await openEntry(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 500), rec('r2', 'PO-1', 'assembly', 900)
  ]);
  await page.click('#procBtn-assembly');
  await page.waitForTimeout(200);
  expect(await rowOf(page, 'PO-1').locator('.qty-note .badge.amber').count(),
    'ไม่มีป้ายเตือน = คีย์ข้ามขั้นแล้วไม่มีอะไรฟ้อง').toBe(1);
});

// ── 2. ความกว้างของตาราง ───────────────────────────────────────────

test('จอกว้าง ตารางต้องไม่ยืดจนคอลัมน์ละ 200px', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)], 1400);
  const w = await page.locator('#entryTable').evaluate(el => el.getBoundingClientRect().width);
  expect(w, 'ตารางต้องถูกคุมความกว้างไว้').toBeLessThanOrEqual(920);
  const panel = await page.locator('#view-entry .panel').first()
    .evaluate(el => el.getBoundingClientRect().width);
  expect(panel, 'และแผงต้องยังกว้างกว่าตาราง ไม่งั้นเทสนี้ไม่ได้พิสูจน์อะไร').toBeGreaterThan(1000);
});

test('จอแคบ ตารางต้องยังใช้พื้นที่เต็มเหมือนเดิม', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)], 780);
  const { table, wrap } = await page.evaluate(() => ({
    table: document.getElementById('entryTable').getBoundingClientRect().width,
    wrap: document.querySelector('#view-entry .table-wrap').getBoundingClientRect().width
  }));
  expect(table, 'การคุมความกว้างต้องไม่ทำให้จอแคบเสียพื้นที่ไปเปล่า ๆ')
    .toBeGreaterThanOrEqual(wrap - 1);
});

// ── 3. ตัวใหญ่อ่านง่าย ─────────────────────────────────────────────

const fontOf = (page, sel) => page.locator(sel).first()
  .evaluate(el => parseFloat(getComputedStyle(el).fontSize));

test('ตัวอักษรในตารางต้องใหญ่ขึ้นจากเดิม (13px)', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  expect(await fontOf(page, '#entryTable td'), 'ตัวตาราง').toBeGreaterThanOrEqual(15);
  expect(await fontOf(page, '#entryTable .row-input'), 'ช่องกรอกยอด — ตัวที่คนจ้องมากที่สุด')
    .toBeGreaterThanOrEqual(18);
  expect(await fontOf(page, '#entryTable .qty-main'), 'ยอดแผน').toBeGreaterThanOrEqual(17);
  expect(await fontOf(page, '#view-entry .field label'), 'ป้ายกำกับช่องกรอง')
    .toBeGreaterThanOrEqual(14);
});

test('บนมือถือ ตัวต้องยังใหญ่ แต่ต้องไม่ต้องเลื่อนไกลกว่าเดิม', async ({ page }) => {
  /* ก่อนขยายตัวอักษร ตารางนี้กว้าง 574px บนจอ 390px · ขยายฟอนต์ดื้อ ๆ แล้วพุ่งเป็น 711px
     คนที่ต้องใช้ตัวใหญ่คือคนกลุ่มเดียวกับที่ถือมือถือ — จะแลกความอ่านง่ายกับการเลื่อนไม่ได้
     ทางออกคือบีบ "ระยะห่าง" คืนบนจอแคบ ไม่ใช่บีบตัวอักษร */
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)], 390);
  const w = await page.locator('#entryTable').evaluate(el => el.scrollWidth);
  expect(w, 'ต้องไม่กว้างกว่าของเดิมอย่างมีนัย').toBeLessThanOrEqual(600);
  expect(await fontOf(page, '#entryTable .row-input'), 'และช่องกรอกต้องยังตัวใหญ่เท่าเดิม')
    .toBeGreaterThanOrEqual(18);
});

test('ตัวใหญ่ต้องไม่รั่วไปหน้าอื่น', async ({ page }) => {
  /* ⚠️ ใบส่งสินค้ามี 16 คอลัมน์ · เคยล้นจอบนมือถือจนอ่านไม่ได้ แก้ไปเมื่อ 4 ก.ย. 2026
     ถ้าใครขยายตัวอักษรรวมทั้งแอปเมื่อไหร่ ตารางนั้นจะล้นกลับมาโดยไม่มีอะไรฟ้อง */
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.waitForTimeout(250);
  expect(await page.locator('#dnTable').evaluate(el => parseFloat(getComputedStyle(el).fontSize)),
    'ตารางใบส่งสินค้าต้องเท่าเดิม').toBeLessThanOrEqual(13);
});
