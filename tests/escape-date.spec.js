// เทสว่าค่าวันที่ที่เพี้ยนไปลง innerHTML ไม่ได้ — INVARIANTS G3
//
// ── ทำไมวันที่ถึงเป็นช่องโหว่ได้ ───────────────────────────────────
// ทุกค่าที่คนพิมพ์ (PO No. · P/N · Sub-Name) ผ่าน escapeHtml() อยู่แล้ว
// แต่ค่าวันที่ถูกวางลง `<td>` ผ่าน fmtDateTH() เปล่า ๆ เพราะ "วันที่เป็นตัวเลข จะเพี้ยนได้ยังไง"
//
// มันเพี้ยนได้ — normalizeDateOnly() คืนค่าเดิมให้สตริงที่ไม่ใช่รูปวันที่ ไม่ได้ทิ้งและไม่ได้แปลง
// ค่าจึงผ่าน prepareState() มาถึงจอครบ · และ fmtDateTH() เอามา split('-') แล้วประกอบใหม่เป็น
// `${d}/${m}/${y}` — ค่าที่ลงท้ายด้วย `-08-03` จึงโผล่ทั้งก้อนที่ตำแหน่ง ${y}
//
// ── ค่าเพี้ยนเข้ามาได้ทางไหน ───────────────────────────────────────
// ไม่ใช่ทางไฟล์แผน Excel — excelValueToISO() โยนทิ้งเป็น null ให้สตริงที่ new Date() อ่านไม่ออก
// ทางที่เข้าได้คือ **ชีตฝั่งเซิร์ฟเวอร์** (pull ตอนซิงค์) และ **รวมข้อมูลจากไฟล์** (applyMerge)
// ทั้งสองทางเขียนลง state ตรง ๆ แล้วผ่าน normalizeRowDates() ซึ่งคืนค่าเดิม
// เทสชุดนี้จึงหว่าน state ที่เพี้ยนแล้วเปิดหน้า — เส้นทางเดียวกับเครื่องที่เพิ่ง pull ของนั้นมา
//
// ⚠️ ห้ามแก้เป็นให้ fmtDateTH() escape ในตัวเอง — มันถูกใช้กับ textContent ด้วย
//    (คำบรรยายกราฟ · หัวกระดาษที่พิมพ์) ที่นั่น `&amp;` จะโผล่ให้คนอ่านเห็น

const { test, expect } = require('@playwright/test');
const { forgetSavedOnEveryLoad, waitReady } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

/* ⚠️ ต้องลงท้าย `-08-03` และห้ามมี `-` อื่นในก้อนหน้า — fmtDateTH() ตัดด้วย split('-')
   แล้วต้องได้สามชิ้นพอดี ไม่งั้นมันคืน '-' แล้วเทสจะเขียวเพราะ payload ไม่ทำงาน ไม่ใช่เพราะโค้ดถูก */
const EVIL = '<img src=x onerror="window.__pwned=1">-08-03';
/** สิ่งที่ต้องเห็นบนจอถ้า escape ถูก — ตัวหนังสือล้วน ไม่ใช่ช่องว่าง (การ "ทิ้งค่า" ก็ผิด คนจะไม่รู้ว่าข้อมูลพัง) */
const SHOWN = '03/08/<img src=x onerror="window.__pwned=1">';

const order = (poNo, pn, qty, orderDate, unit = 'TUE-U') => ({
  id: poNo + '|' + pn, week: 'WK 34', poNo, pn, subName: unit, orderQty: qty, orderDate,
  status: 'active', importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, process, qty, date) => ({
  id, date, orderId, process, qty, note: '', deviceName: 't',
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', voided: false, _dirty: false
});

async function open(page, orders, records = []) {
  await forgetSavedOnEveryLoad(page);
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], deliveryLog: [], importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await waitReady(page);
}

/** สคริปต์ไม่วิ่ง และไม่มีแท็กที่ยัดมาโผล่เป็น element จริงในหน้า */
async function expectNotPwned(page, where) {
  expect(await page.evaluate(() => window.__pwned), `สคริปต์ที่ยัดมาวิ่งแล้ว (${where})`).toBeUndefined();
  expect(await page.locator('img').count(), `<img> ที่ยัดมากลายเป็น element จริง (${where})`).toBe(0);
}

test('G3 — เปิดหน้าแล้วค่าวันที่ที่เพี้ยนต้องไม่กลายเป็นสคริปต์ (ยังไม่ได้กดอะไรเลย)', async ({ page }) => {
  /* ⚠️ ห้ามกดแท็บหรือปุ่มอะไรก่อน assert — นี่คือใจความของเทสข้อนี้
     renderAll() ตอนเปิดหน้าวาดตาราง Dashboard กับตารางแก้ไข/ลบรายการทันที
     ขณะที่แท็บ import ยัง active อยู่ ยังไม่มีใครกดอะไรเลย */
  await open(page, [order('TM5267H179', '2870327301', 800, EVIL)],
                   [rec('R1', 'TM5267H179|2870327301', 'winding', 100, EVIL)]);
  await expectNotPwned(page, 'ตอนเปิดหน้า');

  // และต้องเห็นค่าเพี้ยนนั้นเป็นตัวหนังสือจริง ๆ ไม่ใช่หายไปเฉย ๆ — ค่าที่พังต้องพังให้เห็น
  await expect(page.locator('#dashTable tbody tr').first()).toContainText(SHOWN);
  await expect(page.locator('#recordEditorTable tbody tr').first()).toContainText(SHOWN);
});

test('G3 — ตารางยกเลิกใบสั่ง', async ({ page }) => {
  await open(page, [order('TM5267H179', '2870327301', 800, EVIL)]);
  // ตารางนี้ว่างไว้จนมีคนพิมพ์ค้นหา (ไม่ได้วาดตอนเปิดหน้าเหมือนสองตารางข้างบน)
  await page.fill('#voidSearch', 'TM5267H179');
  await expect(page.locator('#orderVoidTable tbody tr').first()).toContainText(SHOWN);
  await expectNotPwned(page, 'ตารางยกเลิกใบสั่ง');
});

test('G3 — การ์ดยอดคงคลัง FG', async ({ page }) => {
  const o = order('TM5267H179', '2870327301', 800, '2026-08-03');
  await open(page, [o], [rec('R1', o.id, 'inspection', 500, EVIL)]);
  await page.click('.tab-btn[data-tab="fg"]');
  await page.click('#fgTable tr.fg-row[data-pn="2870327301"][data-unit="TUE-U"]');
  await expect(page.locator('#fgCardTable tbody tr').first()).toContainText(SHOWN);
  await expectNotPwned(page, 'การ์ด FG');
});

test('G3 — หน้าจอใบส่งสินค้า', async ({ page }) => {
  await open(page, [order('TM5267H179', '2870327301', 800, EVIL)]);
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.selectOption('#dnUnit', 'TUE-U');
  await expect(page.locator('#dnTable tbody tr').first()).toContainText(SHOWN);
  await expectNotPwned(page, 'หน้าใบส่งสินค้า');
});
