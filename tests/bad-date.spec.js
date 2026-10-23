// วันที่สั่งที่เป็นไปไม่ได้ · ปุ่ม "ดึงข้อมูลใหม่ทั้งหมด" ต้องซ่อมเครื่องที่ค่าเพี้ยนได้จริง
//
// เคสจริง ต.ค. 2026: เครื่องหนึ่งที่ดูอย่างเดียวถือ orderDate ปี 1901 (= ยอดสั่ง 379 อ่านเป็นเลขวันที่ของ Excel)
// ทั้งที่ชีตกับเครื่องอื่นเป็นปี 2026 · Aging ขึ้นหลักหมื่นวัน · กดดึงข้อมูลใหม่ทั้งหมดแล้วไม่มีอะไรเกิดขึ้น
// เพราะเวลาแก้ล่าสุดในเครื่องไม่เก่ากว่าเซิร์ฟเวอร์ — mergeRowsInto จึงไม่ยอมทับ
//
// หน้าเว็บคุยกับ google-apps-script.gs ตัวจริงบนชีตปลอม (fake-gs.js) แบบเดียวกับ process-admin.spec.js

const { test, expect } = require('@playwright/test');
const { readSaved, forgetSavedOnEveryLoad, waitReady } = require('./app-state');
const { loadGs } = require('./fake-gs');
const { planWorkbook } = require('./fixtures');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const K_SYNC = 'tue_order_tracker_sync_v1';
const BAD = '1901-01-13';   // excelSerialToISO(379)

const daysAgo = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const OFFSETS = { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 };
// ข้อมูลสมมุติ — ห้ามใช้รหัส PO จริง (repo นี้เปิดสาธารณะ)
const ORDER = { id: 'ZZ-1|PN-1', week: 'WK 42', poNo: 'ZZ-1', pn: 'PN-1', subName: 'TUE-H', osc: '', pc: '',
  orderQty: 379, orderDate: daysAgo(3), planWinding: '', planAssembly: '', planSupport: '', planInspection: '',
  status: 'active', importedAt: '2026-10-20T00:00:00.000Z', voided: false };

/** ชีตมีใบที่วันที่ถูก · คืนเวลาแก้ล่าสุดที่เซิร์ฟเวอร์ประทับไว้ */
function seedServer(gs) {
  const r = gs.api.doPushRows('Orders', [Object.assign({}, ORDER)], 'เครื่องนำเข้า');
  if (!r.ok) throw new Error(r.error);
  return r.serverTime;
}
const serverOrder = gs => gs.api.doPullRows('Orders', '').rows.find(o => o.id === ORDER.id);

async function serve(page, gs) {
  const net = { calls: [] };
  await page.route('**/exec', async route => {
    const raw = route.request().postData() || '{}';
    net.calls.push(JSON.parse(raw));
    const out = gs.api.doPost({ postData: { contents: raw }, parameter: {} });
    await route.fulfill({ contentType: 'application/json', body: out.body });
  });
  return net;
}

/** เปิดหน้าแบบเครื่องที่ถือแถวในเครื่องไว้แล้ว และต่อชีตอยู่ */
async function open(page, gs, local) {
  const net = await serve(page, gs);
  await page.addInitScript(([k, sk, st, cfg]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(k, JSON.stringify(st));
    localStorage.setItem(sk, JSON.stringify(cfg));
  }, [K_STATE, K_SYNC, {
    version: 1, deviceName: 'เครื่องดูอย่างเดียว', deadlineOffsets: OFFSETS,
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: [local], records: [], deliveryNotes: [], deltaWip: [], importHistory: []
  }, { url: 'https://example.test/exec', token: gs.api.TOKEN, auto: true }]);
  await page.goto(APP);
  await waitReady(page);
  await expect.poll(() => net.calls.some(c => c.action === 'pullSettings')).toBe(true);
  await page.waitForTimeout(300);
  return net;
}

const localOrder = page => readSaved(page, K_STATE).then(s => s.orders.find(o => o.id === ORDER.id));
const pushedOrders = net => net.calls.filter(c => c.action === 'pushRows' && c.table === 'Orders');
async function dashRow(page) {
  await page.click('.tab-btn[data-tab="dashboard"]');
  const tr = page.locator('#dashTable tbody tr', { hasText: ORDER.poNo });
  return { aging: tr.locator('td[data-aging]'), row: tr };
}
async function pressPullAll(page) {
  page.once('dialog', d => d.accept());
  await page.click('.tab-btn[data-tab="data"]');
  await page.click('#btnGsResetPull');
}

test('D3 + ปุ่มดึงข้อมูลใหม่ทั้งหมด — แถวที่ค่าไม่ตรงชีตต้องถูกซ่อม แม้เวลาแก้ล่าสุดเท่ากับเซิร์ฟเวอร์', async ({ page }) => {
  const gs = loadGs();
  const stamp = seedServer(gs);
  // สภาพเครื่องที่เจอจริง: ไม่ได้รอส่ง · เวลาเท่ากับของชีต · แต่วันที่เพี้ยน
  const net = await open(page, gs, Object.assign({}, ORDER, { orderDate: BAD, updatedAt: stamp, _dirty: false }));

  expect((await localOrder(page)).orderDate, 'ซิงค์ปกติไม่ทับ — นี่คืออาการที่เครื่องหน้างานเจอ').toBe(BAD);
  const { aging, row } = await dashRow(page);
  await expect(aging, 'ต้องบอกว่าวันที่ผิด ไม่ใช่ตัวเลขหลักหมื่น').toHaveText('วันที่ผิด');
  await expect(row, 'วันที่ผิดห้ามเอาไปตัดสินล่าช้า').toContainText('วันที่สั่งผิด');
  await expect(row).not.toContainText('ล่าช้า');

  await pressPullAll(page);
  await expect.poll(async () => (await localOrder(page)).orderDate, 'กดปุ่มแล้วต้องได้ค่าตามชีต').toBe(ORDER.orderDate);
  expect((await localOrder(page))._dirty).toBe(false);
  expect(pushedOrders(net), 'ค่าผิดต้องไม่ถูกส่งขึ้นไปทับชีต').toEqual([]);
  expect(serverOrder(gs).orderDate).toBe(ORDER.orderDate);

  await page.click('.tab-btn[data-tab="dashboard"]');
  await expect(aging).toHaveText('3');
});

test('D3 — ปุ่มดึงข้อมูลใหม่ทั้งหมดต้องไม่ทับแถวที่ยังรอส่ง · ใบที่วันที่ผิดไม่ถูกส่งขึ้นชีต', async ({ page }) => {
  const gs = loadGs();
  const stamp = seedServer(gs);
  const net = await open(page, gs, Object.assign({}, ORDER, { orderDate: BAD, updatedAt: stamp, _dirty: true }));

  await pressPullAll(page);
  await expect.poll(() => net.calls.filter(c => c.action === 'pullRows' && c.table === 'Orders' && !c.since).length,
    'ต้องดึงทั้งตารางจริง').toBeGreaterThan(0);
  await page.waitForTimeout(300);

  const o = await localOrder(page);
  expect(o._dirty, 'ยังรอส่งอยู่ = ห้ามทับ (D3)').toBe(true);
  expect(o.orderDate).toBe(BAD);
  expect(pushedOrders(net), 'วันที่ผิดต้องค้างในเครื่อง ไม่กระจายไปทุกเครื่อง').toEqual([]);
  expect(serverOrder(gs).orderDate).toBe(ORDER.orderDate);
  await expect(page.locator('#syncLabel'), 'ต้องเห็นว่ายังมีของค้าง ไม่ใช่ขึ้นว่าซิงค์แล้ว').toContainText('รอส่ง 1');
});

test('ใบที่ยังรอส่งและวันที่ถูก ต้องส่งขึ้นตามปกติ — ด่านวันที่ผิดต้องไม่กันของดี', async ({ page }) => {
  const gs = loadGs();
  const stamp = seedServer(gs);
  const net = await open(page, gs, Object.assign({}, ORDER, { orderQty: 500, updatedAt: stamp, _dirty: true }));

  await expect.poll(() => pushedOrders(net).length).toBe(1);
  expect(serverOrder(gs).orderQty).toBe(500);
  expect((await localOrder(page))._dirty).toBe(false);
});

test('นำเข้าไฟล์แผนที่วันที่เป็นไปไม่ได้ — หน้าตรวจก่อนนำเข้าต้องเตือนก่อนกดยืนยัน', async ({ page }) => {
  await forgetSavedOnEveryLoad(page);
  await page.addInitScript(k => localStorage.removeItem(k), K_STATE);
  await page.goto(APP);
  await waitReady(page);
  await page.setInputFiles('#fileInput', { name: 'แผน.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await planWorkbook([
      { pn: 'PN-1', poNo: 'ZZ-1', orderDate: BAD, qty: 379 },
      { pn: 'PN-2', poNo: 'ZZ-2', orderDate: daysAgo(3), qty: 100 }
    ]) });
  await expect(page.locator('#btnParseSheet')).toBeEnabled();
  await page.click('#btnParseSheet');
  await expect(page.locator('#previewPanel')).toBeVisible();
  await expect(page.locator('#previewSummary')).toContainText('มี 1 รายการที่วันที่เป็นไปไม่ได้');
  await expect(page.locator('#previewTable tbody tr', { hasText: 'ZZ-1' }).locator('.badge.red', { hasText: BAD })).toBeVisible();
});
