// เทสการเทียบยอด Wip bal. กับไฟล์ Call In ของ Delta
//
// ── หน้านี้เคยเป็นอะไร และตอนนี้เป็นอะไร ──────────────────────────
// เดิมเป็นตัวกรอกฟอร์ม Call In ให้ Delta — เจ้าของแจ้ง 1 ก.ย. 2026 ว่าสร้างมาจากความเข้าใจผิด
// ไม่ได้ใช้ จึงถอดตัวเขียนไฟล์ออก เหลือเฉพาะการอ่านและเทียบยอด
//
// ตัวเทียบยอดสำคัญขึ้นกว่าเดิม ไม่ใช่น้อยลง — เพราะยอด Wip bal. บนใบส่งสินค้า
// กำลังจะเปลี่ยนไปใช้เลขของ Delta หน้านี้จึงเป็นที่เดียวที่จะรู้ว่า
// ข้อมูลการผลิตของเรากับบัญชีของ Delta เริ่มห่างกันแล้ว
//
// ⚠️ เทสสามข้อที่เคยตรวจว่า "ไฟล์ของผู้ใช้ต้องไม่ถูกทำลาย" ถูกลบไปพร้อมตัวเขียนไฟล์
//    การคุ้มกันแบบเดียวกันยังอยู่ครบใน delivery-note.spec.js ซึ่งยังเขียนไฟล์จริงอยู่

const { test, expect } = require('@playwright/test');
const { callInWorkbook } = require('./fixtures');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

const order = (poNo, pn, qty) => ({
  id: poNo + '|' + pn, week: 'W34', poNo, pn, subName: 'TUE-U', orderQty: qty,
  orderDate: '2026-07-06', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const shipped = (id, orderId, qty) => ({
  id, date: '2026-08-20', orderId, process: 'shipping', qty, note: '', deviceName: 't',
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', voided: false, _dirty: false
});

async function openWith(page, orders, records = []) {
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' }, orders: o, records: r, importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await page.waitForSelector('.tab-btn[data-tab="data"]');
  await page.click('.tab-btn[data-tab="data"]');
}

/** อัปโหลดไฟล์ → เลือกชีต → กดเทียบยอด */
async function scan(page, buf, sheet) {
  await page.setInputFiles('#callInFileInput',
    { name: 'callin.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });
  await expect(page.locator('#btnCallInScan')).toBeEnabled();
  if (sheet) await page.selectOption('#callInSheet', sheet);
  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
}

/** ข้อความในแถวของ PO นั้นบนตารางผลเทียบ */
const rowOf = (page, po) => page.locator('#callInTable tbody tr').filter({ hasText: po }).innerText();

const ROWS = [
  { pn: '9100000041', poNo: 'PO-C041', orderDate: '2026-07-06', qty: 300, wip: 300, commit: 111 },
  { pn: '9100000040', poNo: 'PO-C040', orderDate: '2026-07-06', qty: 300, wip: 300, commit: 222 },
  { pn: '9100009999', poNo: 'PO-NOTINAPP', orderDate: '2026-07-06', qty: 500, wip: 500, commit: 333 }
];
const ORDERS = [order('PO-C041', '9100000041', 300), order('PO-C040', '9100000040', 300)];

test('A1 — ยอดค้างของเราต้องเป็น PO QTY ลบยอดส่งสะสม และไม่นับยอดที่ถูกยกเลิก', async ({ page }) => {
  // เทสข้อนี้เคยตรวจผ่านไฟล์ที่ดาวน์โหลดมา ตอนนี้ไม่มีไฟล์แล้ว จึงตรวจที่ตารางผลเทียบแทน
  // สิ่งที่คุ้มยังเป็นเรื่องเดียวกัน คือสูตรของยอดค้าง ซึ่งเป็นเลขที่เอาไปเถียงกับ Delta
  await openWith(page, ORDERS, [
    shipped('S1', 'PO-C041|9100000041', 120),
    shipped('S2', 'PO-C040|9100000040', 300),
    Object.assign(shipped('S3', 'PO-C041|9100000041', 50), { voided: true, date: '2026-08-21' })
  ]);
  await scan(page, await callInWorkbook(ROWS));

  const r41 = await rowOf(page, 'PO-C041');
  expect(r41, 'สั่ง 300 ส่งแล้ว 120 (ยอดที่ยกเลิก 50 ห้ามนับ) ยอดเราต้องเหลือ 180').toContain('180');
  expect(r41, 'และต้องโชว์ยอดของ Delta คู่กันให้เห็นว่าต่างกัน').toContain('300');

  const r40 = await rowOf(page, 'PO-C040');
  expect(r40, 'ส่งครบแล้วยอดเราต้องเป็น 0').toContain('0');
});

test('ยอดที่ตรงกันแล้วต้องไม่ขึ้นในตาราง — ตารางนี้มีไว้ดูเฉพาะที่ต่าง', async ({ page }) => {
  // ไฟล์บอก 300 เราก็ 300 ทั้งสองใบ ไม่มีอะไรต้องคุยกับ Delta
  await openWith(page, ORDERS);
  await scan(page, await callInWorkbook(ROWS));

  const body = await page.locator('#callInTable tbody').innerText();
  expect(body, 'ใบที่ยอดตรงกันไม่ต้องโผล่').not.toContain('PO-C041');
  expect(await page.locator('#callInSummary').innerText()).toContain('ยอดไม่ตรงกัน 0 แถว');
});

test('ต้องรายงานทั้งสองทิศ — PO ที่มีเฉพาะฝั่ง Delta และที่มีเฉพาะฝั่งเรา', async ({ page }) => {
  await openWith(page, ORDERS.concat([order('PO-C099', '9100000099', 700)]),
                 [shipped('S1', 'PO-C041|9100000041', 120)]);
  await scan(page, await callInWorkbook(ROWS));

  const summary = await page.locator('#callInSummary').innerText();
  expect(summary, 'ใบที่เรารู้จัก แต่ Delta ไม่มี').toContain('Delta ไม่มี');
  expect(summary, 'ใบที่ Delta รู้จัก แต่เราไม่มี').toContain('Delta รู้จัก เราไม่รู้จัก');

  await expect(page.locator('#callInTable'), 'และต้องบอกว่าเป็นใบไหน').toContainText('PO-C099');
  await expect(page.locator('#callInTable')).toContainText('PO-NOTINAPP');
});

test('PO QTY ไม่ตรงกัน ต้องเตือนแยกจากยอดค้างไม่ตรง เพราะร้ายแรงกว่า', async ({ page }) => {
  // ยอดสั่งคนละเลข แปลว่าสองฝั่งมองใบสั่งเดียวกันไม่เหมือนกันตั้งแต่ต้น
  await openWith(page, [order('PO-C041', '9100000041', 250), ORDERS[1]]);
  await scan(page, await callInWorkbook(ROWS));

  expect(await page.locator('#callInSummary').innerText()).toContain('PO QTY ไม่ตรงกัน');
});

test('หน้านี้ต้องอ่านอย่างเดียว — ห้ามมีปุ่มที่เขียนไฟล์หรือแก้ข้อมูล', async ({ page }) => {
  // เจ้าของสั่งถอดตัวสร้างไฟล์ออก ถ้ามีใครใส่กลับมาโดยไม่ได้ถาม เทสข้อนี้จะจับได้
  await openWith(page, ORDERS, [shipped('S1', 'PO-C041|9100000041', 120)]);
  const before = await page.evaluate(k => localStorage.getItem(k), K_STATE);
  await scan(page, await callInWorkbook(ROWS));

  expect(await page.locator('#btnCallInApply').count(), 'ปุ่มกรอกไฟล์ต้องไม่มีแล้ว').toBe(0);
  expect(await page.evaluate(k => localStorage.getItem(k), K_STATE),
    'เทียบยอดแล้วข้อมูลในเครื่องต้องไม่เปลี่ยนแม้แต่ตัวอักษรเดียว').toBe(before);
});

test('ช่อง Wip ที่ Delta เว้นว่าง แปลว่า "ไม่รู้" ห้ามเก็บเป็น 0', async ({ page }) => {
  // Number('') ได้ 0 และ isFinite(0) เป็นจริง — เช็กแค่ isFinite ช่องว่างจะกลายเป็น 0
  // แล้วกระดาษจะพิมพ์ 0 ส่งถึงลูกค้า ซึ่งอ่านว่า "ไม่มีของค้างแล้ว" ทั้งที่ความจริงคือไม่รู้
  const rows = [
    { pn: '9100000041', poNo: 'PO-C041', orderDate: '2026-07-06', qty: 300, wip: 180, commit: 111 },
    { pn: '9100000040', poNo: 'PO-C040', orderDate: '2026-07-06', qty: 300, commit: 222 }  // ← เว้นว่าง
  ];
  await openWith(page, ORDERS);
  await scan(page, await callInWorkbook(rows), 'X-FRM wk34');
  await page.click('#btnDeltaWipSave');
  await page.waitForTimeout(200);

  const kept = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).deltaWip, K_STATE);
  expect(kept.map(d => d.orderId), 'เก็บเฉพาะใบที่ Delta กรอกยอดไว้จริง')
    .toEqual(['PO-C041|9100000041']);
  expect(kept[0].wip).toBe(180);
});

test('G1 — เลือกชีตผิดต้องขึ้นข้อความภาษาไทยบอกตรง ๆ ไม่ใช่เงียบหรือเขียนมั่ว', async ({ page }) => {
  await openWith(page, ORDERS);
  await page.setInputFiles('#callInFileInput',
    { name: 'callin.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await callInWorkbook(ROWS) });
  await expect(page.locator('#btnCallInScan')).toBeEnabled();
  await page.selectOption('#callInSheet', 'อีกชีตที่ห้ามแตะ');
  await page.click('#btnCallInScan');

  await expect(page.locator('#toast'), 'ชีตที่ไม่มีหัวตาราง P/N ต้องขึ้นข้อความบอก').toContainText('P/N');
  await expect(page.locator('#callInPreviewPanel'), 'และต้องไม่เปิดหน้าผลเทียบให้ดูต่อ').toBeHidden();
});

// ── คอลัมน์ Wip bal. ต้องหาจากข้อความหัวตาราง ไม่ใช่ตัวอักษรตายตัว ────────────
//
// ของจริงเคยถูกแทรกคอลัมน์ใหม่เข้ามาจนเลื่อนจาก E ไป F มาแล้ว (พบ 3 ก.ย. 2026)
// ถ้ายังยึด E ต่อไป จะอ่านเลขของคอลัมน์ Aging มาใส่เป็น Wip balance แบบเงียบ ๆ
// เพราะ Aging ก็เป็นตัวเลขเหมือนกัน ไม่มีอะไรฟ้องว่าอ่านผิดคอลัมน์

test('B1 — คอลัมน์ Wip bal. เลื่อนไปคอลัมน์อื่น ต้องยังอ่านค่าถูก ไม่ใช่ไปอ่านคอลัมน์ Aging', async ({ page }) => {
  const rows = [{ pn: '9100000041', poNo: 'PO-C041', orderDate: '2026-07-06', qty: 300, wip: 777, commit: 1 }];
  await openWith(page, [order('PO-C041', '9100000041', 300)],
    [shipped('S1', 'PO-C041|9100000041', 300)]);  // ยอดค้างของเราเป็น 0 → ไม่เท่า 777 แน่นอน
  await scan(page, await callInWorkbook(rows, { wipCol: 6 }));  // F แทน E

  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
  const text = await rowOf(page, 'PO-C041');
  expect(text, 'ต้องอ่านได้ 777 จากคอลัมน์ F ไม่ใช่ค่าจากคอลัมน์ Aging ข้าง ๆ').toContain('777');
});

test('B2 — หัวตารางเขียนว่า Wip Balance (ไม่มีจุด ตัวพิมพ์ใหญ่ต่าง) ต้องยังจับคู่ได้แม้เลื่อนคอลัมน์ด้วย', async ({ page }) => {
  // ผสมทั้งเลื่อนคอลัมน์และเปลี่ยนคำที่ใช้ — กันไม่ให้เทสผ่านเพราะบังเอิญคอลัมน์ตรงกับของเดิม (E)
  const rows = [{ pn: '9100000041', poNo: 'PO-C041', orderDate: '2026-07-06', qty: 300, wip: 555, commit: 1 }];
  await openWith(page, [order('PO-C041', '9100000041', 300)],
    [shipped('S1', 'PO-C041|9100000041', 300)]);
  await scan(page, await callInWorkbook(rows, { wipCol: 6, wipHeader: 'WIP BALANCE' }));

  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
  expect(await rowOf(page, 'PO-C041')).toContain('555');
});

test('B3 — ไม่มีหัวตาราง Wip bal. ในชีตเลย ต้องขึ้นข้อความบอก ไม่ใช่เดาคอลัมน์เอง', async ({ page }) => {
  const rows = [{ pn: '9100000041', poNo: 'PO-C041', orderDate: '2026-07-06', qty: 300, wip: 300, commit: 1 }];
  await openWith(page, ORDERS);
  await page.setInputFiles('#callInFileInput',
    { name: 'callin.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await callInWorkbook(rows, { wipHeader: 'ยอดคงเหลือ' }) });
  await expect(page.locator('#btnCallInScan')).toBeEnabled();
  await page.click('#btnCallInScan');

  await expect(page.locator('#toast'), 'ต้องบอกว่าหาหัวตาราง Wip bal. ไม่เจอ').toContainText('Wip bal.');
  await expect(page.locator('#callInPreviewPanel')).toBeHidden();
});
