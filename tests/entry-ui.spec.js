// เทสหน้าตาของหน้าบันทึกยอดผลิตประจำวัน
//
// 9 ก.ย. 2026 (#80) เจ้าของขอ — ยุบสะสม/คงเหลือเป็นแถบใต้ Order Qty · คุมความกว้าง 900px · ตัวใหญ่อ่านง่าย
// 12 ก.ย. 2026 เจ้าของสั่งใหม่ — แยกสะสม/คงเหลือกลับเป็นคอลัมน์ของตัวเอง · เพิ่มคอลัมน์ Aging · ตารางเต็มกรอบ
// ตัวใหญ่อ่านง่ายยังคงไว้
//
// ⚠️ ตัวใหญ่ต้องอยู่แค่หน้านี้ · หน้าใบส่งสินค้ามี 16 คอลัมน์และเพิ่งแก้เรื่องล้นจอบนมือถือ
//    ไปเมื่อ 4 ก.ย. 2026 — มีเทสคุมไว้ข้างล่างว่าตัวอักษรต้องไม่รั่วไปหน้านั้น

const { test, expect } = require('@playwright/test');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const PN = '9000000002';

/** วันที่ย้อนหลัง n วันตามเวลาเครื่อง — แอปนับ Aging ถึง "วันนี้" ตามเวลาเครื่องเหมือนกัน */
const daysAgo = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const order = (poNo, qty, unit = 'TUE-U', orderDate = daysAgo(10)) => ({
  id: poNo, week: 'WK 34', poNo, pn: PN, subName: unit, orderQty: qty,
  orderDate, status: 'active',
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
// ลำดับคอลัมน์ — # · สัปดาห์ · PO · P/N · Order Qty · Aging · สะสม · คงเหลือ · ยอดวันนี้
const COL = { qty: 4, aging: 5, cum: 6, rem: 7 };
const cellOf = (page, po, col) => rowOf(page, po).locator('td').nth(COL[col]);
const th = (page, col) => page.locator('#entryTable thead th').nth(COL[col]).innerText();

// ── 1. สะสมกับคงเหลือเป็นคอลัมน์ของตัวเอง ─────────────────────────────

test('ตารางมี 9 คอลัมน์ — Order Qty · Aging · สะสม · คงเหลือ แยกคอลัมน์กัน', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  expect(await page.locator('#entryTable thead th').count(), 'ช่วงที่ยุบเป็นแถบเหลือ 6').toBe(9);
  expect(await rowOf(page, 'PO-1').locator('td').count()).toBe(9);
  expect(await th(page, 'aging')).toContain('Aging');
  expect(await th(page, 'cum')).toContain('สะสม');
  expect(await th(page, 'rem')).toContain('คงเหลือ');
});

test('ยอดแผน สะสม คงเหลือ อยู่คนละคอลัมน์และตัวเลขถูก', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  expect(await cellOf(page, 'PO-1', 'qty').innerText(), 'ยอดแผน').toBe('4,000');
  expect(await cellOf(page, 'PO-1', 'cum').innerText(), 'สะสม').toBe('1,000');
  expect(await cellOf(page, 'PO-1', 'rem').innerText(), 'คงเหลือ 4,000 − 1,000').toBe('3,000');
  expect(await rowOf(page, 'PO-1').locator('.progress').count(), 'แถบใต้ Order Qty ต้องไม่อยู่แล้ว').toBe(0);
});

test('คีย์เกินยอดแผน — สะสมต้องบอกความจริง คงเหลือครอบที่ 0', async ({ page }) => {
  // ⚠️ สะสมไม่ครอบ · ใบที่คีย์เกินต้องเห็นว่าเกิน ไม่ใช่ถูกกลบให้เท่ายอดแผน
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 5200)]);
  expect(await cellOf(page, 'PO-1', 'cum').innerText(), 'สะสมตามจริง').toBe('5,200');
  expect(await cellOf(page, 'PO-1', 'rem').innerText(), 'คงเหลือครอบที่ 0').toBe('0');
});

test('หัวคอลัมน์สะสมต้องบอกว่าเป็นของขั้นไหน', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  expect(await th(page, 'cum'), 'ตอนอยู่ขั้น Winding').toContain('Winding');
  await page.click('#procBtn-inspection');
  await page.waitForTimeout(200);
  expect(await th(page, 'cum'), 'สลับขั้นแล้วต้องเปลี่ยนตาม').toContain('Inspection');
});

test('ป้ายเตือนยอดสะสมเกินขั้นก่อนหน้า ต้องอยู่ในคอลัมน์สะสม', async ({ page }) => {
  // คีย์ Assembly มากกว่า Winding
  await openEntry(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 500), rec('r2', 'PO-1', 'assembly', 900)
  ]);
  await page.click('#procBtn-assembly');
  await page.waitForTimeout(200);
  expect(await cellOf(page, 'PO-1', 'cum').locator('.badge.amber').count(),
    'ไม่มีป้ายเตือน = คีย์ข้ามขั้นแล้วไม่มีอะไรฟ้อง').toBe(1);
});

// ── 2. คอลัมน์ Aging ───────────────────────────────────────────────

test('Aging = จำนวนวันนับจากวันสั่งถึงวันนี้ และสีตามเกณฑ์กำหนดส่งของ', async ({ page }) => {
  // เกณฑ์ส่งของ 28 วัน — เกิน 28 แดง · เหลือไม่เกิน 3 วันเหลือง · ที่เหลือเขียว (เหมือน Dashboard)
  await openEntry(page, [
    order('PO-NEW', 1000, 'TUE-U', daysAgo(10)),
    order('PO-NEAR', 1000, 'TUE-U', daysAgo(26)),
    order('PO-LATE', 1000, 'TUE-U', daysAgo(40))
  ]);
  const badge = po => cellOf(page, po, 'aging').locator('.badge');
  expect(await cellOf(page, 'PO-NEW', 'aging').innerText()).toBe('10');
  expect(await badge('PO-NEW').getAttribute('class')).toContain('green');
  expect(await cellOf(page, 'PO-NEAR', 'aging').innerText()).toBe('26');
  expect(await badge('PO-NEAR').getAttribute('class'), 'เหลือ 2 วัน').toContain('amber');
  expect(await cellOf(page, 'PO-LATE', 'aging').innerText()).toBe('40');
  expect(await badge('PO-LATE').getAttribute('class'), 'เกินกำหนด').toContain('red');
});

test('Aging บนหน้านี้ต้องตรงกับ Dashboard ทั้งตัวเลขและสี', async ({ page }) => {
  // สองหน้าคิดคนละที่เมื่อไหร่ ใบเดียวกันจะขึ้นอายุงานไม่ตรงกัน แล้วคนจะเลิกเชื่อทั้งสองหน้า
  const orders = [order('PO-A', 1000, 'TUE-U', daysAgo(26)), order('PO-B', 1000, 'TUE-U', daysAgo(40))];
  await openEntry(page, orders);
  const entry = {};
  for (const po of ['PO-A', 'PO-B']) entry[po] = await cellOf(page, po, 'aging').innerHTML();
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForTimeout(250);
  for (const po of ['PO-A', 'PO-B']) {
    const dash = await page.locator('#dashTable tbody tr', { hasText: po }).locator('td[data-aging]').innerHTML();
    expect(entry[po], po).toBe(dash);
  }
});

test('Aging ต้องนับถึงวันนี้ ไม่ใช่วันที่เลือกคีย์ย้อนหลัง', async ({ page }) => {
  // คีย์ย้อนหลังเป็นเรื่องปกติ ถ้า Aging ขยับตามวันที่เลือก จะไม่ตรงกับ Dashboard
  await openEntry(page, [order('PO-1', 1000, 'TUE-U', daysAgo(10))]);
  await page.fill('#entryDate', daysAgo(5));
  await page.waitForTimeout(250);
  expect(await cellOf(page, 'PO-1', 'aging').innerText()).toBe('10');
});

test('ใบที่ไม่มีวันสั่ง — Aging ต้องขึ้นขีด ไม่ใช่ตัวเลขขยะ', async ({ page }) => {
  await openEntry(page, [order('PO-1', 1000, 'TUE-U', '')]);
  expect(await cellOf(page, 'PO-1', 'aging').innerText()).toBe('—');
});

// ── 3. ความกว้างของตาราง ───────────────────────────────────────────

test('จอกว้าง ตารางต้องเต็มกรอบ ไม่ถูกคุมไว้ 900px อีกแล้ว', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)], 1400);
  const { table, wrap } = await page.evaluate(() => ({
    table: document.getElementById('entryTable').getBoundingClientRect().width,
    wrap: document.querySelector('#view-entry .table-wrap').getBoundingClientRect().width
  }));
  expect(wrap, 'กรอบต้องกว้างกว่า 900 ไม่งั้นเทสนี้ไม่ได้พิสูจน์อะไร').toBeGreaterThan(1000);
  expect(table, 'ตารางต้องเต็มกรอบ').toBeGreaterThanOrEqual(wrap - 1);
});

test('จอแคบ ตารางต้องยังใช้พื้นที่เต็ม', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)], 780);
  const { table, wrap } = await page.evaluate(() => ({
    table: document.getElementById('entryTable').getBoundingClientRect().width,
    wrap: document.querySelector('#view-entry .table-wrap').getBoundingClientRect().width
  }));
  expect(table).toBeGreaterThanOrEqual(wrap - 1);
});

// ── 4. ตัวใหญ่อ่านง่าย ─────────────────────────────────────────────

const fontOf = (page, sel) => page.locator(sel).first()
  .evaluate(el => parseFloat(getComputedStyle(el).fontSize));

test('ตัวอักษรในตารางต้องใหญ่กว่าตารางปกติของแอป (13px)', async ({ page }) => {
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)]);
  expect(await fontOf(page, '#entryTable td'), 'ตัวตาราง').toBeGreaterThanOrEqual(15);
  expect(await fontOf(page, '#entryTable .row-input'), 'ช่องกรอกยอด — ตัวที่คนจ้องมากที่สุด')
    .toBeGreaterThanOrEqual(18);
  expect(await fontOf(page, '#view-entry .field label'), 'ป้ายกำกับช่องกรอง')
    .toBeGreaterThanOrEqual(14);
});

test('บนมือถือ ตัวต้องยังใหญ่ และตารางเลื่อนในกรอบของตัวเอง ไม่ดันทั้งหน้าให้เลื่อน', async ({ page }) => {
  // 9 คอลัมน์ตัวใหญ่ไม่พอดีจอ 390px อยู่แล้ว — ที่รับไม่ได้คือทั้งหน้าเลื่อนแนวนอนตาม
  await openEntry(page, ORDERS, [rec('r1', 'PO-1', 'winding', 1000)], 390);
  expect(await fontOf(page, '#entryTable .row-input'), 'ช่องกรอกต้องยังตัวใหญ่')
    .toBeGreaterThanOrEqual(18);
  const { page: pageW, view } = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth, view: window.innerWidth
  }));
  expect(pageW, 'ทั้งหน้าต้องไม่กว้างกว่าจอ').toBeLessThanOrEqual(view + 1);
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
