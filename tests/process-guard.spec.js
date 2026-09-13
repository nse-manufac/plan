// ตัวเตือนยอดของขั้นที่โปรแกรมรุ่นนี้ไม่รู้จัก
//
// เจ้าของสั่งเมื่อ 12 ก.ย. 2026 ให้เพิ่มขั้นการผลิตได้จากในโปรแกรม และซิงค์ไปทุกเครื่อง
// ใบนี้มาก่อนตัวจัดการขั้น — เครื่องที่ยังค้างรุ่นเก่าตอนมีคนเพิ่มขั้นใหม่ ต้องรู้ตัวว่ายอดบนจอขาด
// ไม่งั้นการ์ด WIP ตาราง กราฟ จะต่ำกว่าเครื่องอื่นเงียบ ๆ เพราะตัวคิดยอดข้ามขั้นที่ไม่รู้จักทิ้ง

const { test, expect } = require('@playwright/test');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

const order = { id: 'PO-1|PN-1', week: 'WK 37', poNo: 'PO-1', pn: 'PN-1', subName: 'TUE-U', orderQty: 1000,
  orderDate: '2026-09-01', status: 'active', importedAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z', _dirty: false };
const rec = (id, process, qty, extra = {}) => ({ id, date: '2026-09-05', orderId: order.id, process, qty,
  note: '', deviceName: 't', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
  voided: false, _dirty: false, ...extra });

async function open(page, records) {
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: [o], records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, order, records]);
  await page.goto(APP);
  await page.waitForTimeout(300);
}
const warn = page => page.locator('#unknownProcessWarn');

test('ไม่มียอดของขั้นแปลกหน้า — ต้องไม่มีแถบเตือน', async ({ page }) => {
  await open(page, [rec('r1', 'winding', 500), rec('r2', 'shipping', 100)]);
  await expect(warn(page)).toBeHidden();
});

test('มียอดของขั้นที่รุ่นนี้ไม่รู้จัก — ต้องขึ้นแถบเตือนพร้อมชื่อขั้นและจำนวนรายการ', async ({ page }) => {
  await open(page, [rec('r1', 'winding', 500), rec('r2', 'coating', 300), rec('r3', 'coating', 200)]);
  await expect(warn(page)).toBeVisible();
  await expect(warn(page)).toContainText('coating');
  await expect(warn(page), 'นับเป็นรายการ ไม่ใช่ผลรวมชิ้น').toContainText('2 รายการ');
  await expect(warn(page)).toContainText('รุ่นเก่า');
});

test('แถบเตือนต้องเห็นได้ทุกหน้า ไม่ใช่แค่ Dashboard', async ({ page }) => {
  await open(page, [rec('r1', 'coating', 300)]);
  for (const tab of ['entry', 'delivery', 'fg', 'dashboard', 'data']) {
    await page.click(`.tab-btn[data-tab="${tab}"]`);
    await expect(warn(page), 'หน้า ' + tab).toBeVisible();
  }
});

test('ยอดของขั้นแปลกหน้าที่ยกเลิกไปแล้ว — ต้องไม่เตือน', async ({ page }) => {
  await open(page, [rec('r1', 'coating', 300, { voided: true })]);
  await expect(warn(page)).toBeHidden();
});

test('ยอดของขั้นที่รู้จักยังต้องนับถูก — แถบเตือนต้องไม่ไปแตะตัวคิดยอด', async ({ page }) => {
  await open(page, [rec('r1', 'winding', 500), rec('r2', 'coating', 300)]);
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForTimeout(200);
  const row = await page.locator('#dashTable tbody tr', { hasText: 'PO-1' }).innerText();
  expect(row, 'Winding ยังเป็น 500').toContain('500/1,000');
});

test('ชื่อขั้นจากข้อมูลที่ซิงค์มา ต้องขึ้นเป็นข้อความ ไม่ถูกตีความเป็น HTML', async ({ page }) => {
  // ชื่อขั้นจะมาจากหน้าจัดการขั้นในเครื่องอื่น — ใครพิมพ์อะไรไว้ก็ต้องไม่รันเป็นโค้ดบนเครื่องนี้
  await open(page, [rec('r1', '<img src=x onerror="window.__pwned=1">', 1)]);
  await expect(warn(page)).toBeVisible();
  expect(await page.locator('#unknownProcessWarn img').count(), 'ต้องไม่มี element ถูกสร้าง').toBe(0);
  expect(await page.evaluate(() => window.__pwned), 'ต้องไม่รันโค้ด').toBeUndefined();
});

test('ปุ่มโหลดรุ่นใหม่ ต้องโหลดหน้าแบบข้าม cache', async ({ page }) => {
  await open(page, [rec('r1', 'coating', 300)]);
  await Promise.all([
    page.waitForURL(/\?_v=\d+/),
    page.click('#btnProcessWarnReload')
  ]);
});
