// เทสการอ่าน/เขียนไฟล์ Excel — ทางเข้าออกของข้อมูลทั้งหมดในแอปนี้
//
// ── ทำไมเพิ่งมามีเทส ─────────────────────────────────────────────
// การนำเข้าแผนงาน การนำเข้าใบส่งงาน และการ export รายงาน ไม่เคยมีเทสคุมเลย
// ทั้งที่เป็นทางเดียวที่ข้อมูลเข้าสู่ระบบ เขียนชุดนี้ไว้ก่อนเปลี่ยนไลบรารีอ่าน Excel
// เพื่อให้พิสูจน์ได้ว่า "ผลลัพธ์เหมือนเดิมทุกช่อง" ไม่ใช่เชื่อว่าเหมือน
//
// ไฟล์ทดสอบถูกประกอบขึ้นเองใน tests/fixtures.js — ห้ามเอาไฟล์ธุรกิจจริงเข้า repo (INVARIANTS F3)

const { test, expect } = require('@playwright/test');
const { planWorkbook, shipWorkbook, readWorkbook } = require('./fixtures');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

async function openBlank(page) {
  await page.addInitScript(k => localStorage.removeItem(k), K_STATE);
  await page.goto(APP);
  await page.waitForSelector('.tab-btn[data-tab="entry"]');
}

const upload = (page, sel, buf, name) =>
  page.setInputFiles(sel, { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });

const orders = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)).orders, K_STATE);
const records = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)).records, K_STATE);

const PLAN_ROWS = [
  { pn: '2870327301', poNo: 'TM5267H179', orderDate: '2026-07-29', qty: 800,
    planWinding: '2026-08-08', planAssembly: '2026-08-15', planInspection: '2026-08-22', planSupport: '2026-08-18' },
  { pn: '2870501700', poNo: 'TM5267H176', orderDate: '2026-07-30', qty: 5000, subName: 'TUE-U' },
  { pn: '2870537602', poNo: 'TM5267H378', orderDate: '2026-07-31', qty: 200 }
];

// ── นำเข้าแผนงานรายสัปดาห์ ─────────────────────────────────────────

test('C1 + C3 — นำเข้าแผนแล้ววันที่ทุกช่องต้องเป็น YYYY-MM-DD ไม่เลื่อนวัน', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook(PLAN_ROWS), 'แผน.xlsx');
  await expect(page.locator('#btnParseSheet')).toBeEnabled();
  await page.click('#btnParseSheet');
  await expect(page.locator('#previewPanel')).toBeVisible();
  await page.click('#btnConfirmImport');

  const got = await orders(page);
  expect(got.length, 'ต้องได้ครบทุกบรรทัดที่มี PO และยอด').toBe(3);

  const a = got.find(o => o.poNo === 'TM5267H179');
  expect(a.orderDate, 'วันสั่งซื้อต้องตรงวัน ไม่ใช่เลื่อนไปวันก่อนหน้าเพราะ timezone').toBe('2026-07-29');
  expect(a.planWinding).toBe('2026-08-08');
  expect(a.planAssembly).toBe('2026-08-15');
  expect(a.planInspection).toBe('2026-08-22');
  expect(a.planSupport, 'คอลัมน์ Support หาจากข้อความหัวตาราง ไม่ได้ fix ตำแหน่ง (issue #17)').toBe('2026-08-18');
  expect(a.pn).toBe('2870327301');
  expect(a.orderQty).toBe(800);
  expect(a.subName).toBe('TUE-H');
  expect(a.id, 'กุญแจของ order คือ PO|P/N').toBe('TM5267H179|2870327301');

  expect(got.find(o => o.poNo === 'TM5267H176').subName).toBe('TUE-U');
});

// เทสข้างบนรันบนเครื่องที่อยู่ UTC หรือ UTC+7 ซึ่งบังเอิญได้วันเดียวกันทั้งสองวิธีอ่าน
// จึงพิสูจน์ไม่ได้ว่าโค้ดอ่านด้วย UTC getters จริง ต้องมีเครื่องที่อยู่ "หลัง" UTC มายืนยัน
test.describe('เครื่องที่อยู่หลัง UTC', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('C1 — วันที่จาก Excel ต้องไม่เลื่อนถอยหนึ่งวัน บนเครื่องที่เขตเวลาอยู่หลัง UTC', async ({ page }) => {
    // ตัวอ่าน Excel สร้าง Date ของช่องวันที่ไว้ที่เที่ยงคืน UTC เสมอ ปิดพฤติกรรมนี้ไม่ได้
    // ถ้าใครเผลอเปลี่ยน excelValueToISO กลับไปอ่านด้วย getters ตามเขตเวลาเครื่อง
    // เครื่องที่อยู่หลัง UTC จะได้วันก่อนหน้าไปหนึ่งวัน — ทั้งวันสั่งซื้อและวันแผนทุกขั้น
    await openBlank(page);
    await upload(page, '#fileInput', await planWorkbook(PLAN_ROWS), 'แผน.xlsx');
    await page.click('#btnParseSheet');
    await page.click('#btnConfirmImport');

    const a = (await orders(page)).find(o => o.poNo === 'TM5267H179');
    expect(a.orderDate, 'วันสั่งซื้อต้องเป็นวันเดียวกับที่อยู่ในไฟล์ ไม่ใช่ถอยไปหนึ่งวัน').toBe('2026-07-29');
    expect(a.planWinding).toBe('2026-08-08');
    expect(a.planSupport).toBe('2026-08-18');
  });
});

test('นำเข้าต้องคัดแถวที่ใช้ไม่ได้ออก — แถวที่ไม่มี PO หรือยอดเป็นศูนย์/ติดลบ ต้องถูกข้าม ไม่ใช่เข้ามาเป็นใบเปล่า', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook([
    PLAN_ROWS[0],
    { pn: '2870501700', poNo: '', orderDate: '2026-07-30', qty: 5000 },   // ไม่มี PO
    { pn: '', poNo: 'TM5267H999', orderDate: '2026-07-30', qty: 5000 },   // ไม่มี P/N
    { pn: '2870537602', poNo: 'TM5267H378', orderDate: '2026-07-31', qty: 0 },     // ยอด 0
    { pn: '2870537603', poNo: 'TM5267H379', orderDate: '2026-07-31', qty: -5 }     // ยอดติดลบ
  ]), 'แผน.xlsx');
  await page.click('#btnParseSheet');
  await page.click('#btnConfirmImport');

  const got = await orders(page);
  expect(got.map(o => o.poNo), 'เหลือเฉพาะแถวที่มีทั้ง PO, P/N และยอดมากกว่าศูนย์').toEqual(['TM5267H179']);
});

test('กุญแจของใบสั่งต้องไม่ชนกัน — PO กับ P/N ซ้ำกันในชีตเดียว ต้องแยกเป็นคนละใบ ไม่ทับกัน', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook([
    { pn: '2870327301', poNo: 'TM5267H179', orderDate: '2026-07-29', qty: 800 },
    { pn: '2870327301', poNo: 'TM5267H179', orderDate: '2026-07-29', qty: 300 }
  ]), 'แผน.xlsx');
  await page.click('#btnParseSheet');
  await page.click('#btnConfirmImport');

  const got = await orders(page);
  expect(got.map(o => o.id), 'ใบที่สองต้องได้กุญแจใหม่ ไม่งั้นยอดจะหายไปหนึ่งใบเงียบ ๆ')
    .toEqual(['TM5267H179|2870327301', 'TM5267H179|2870327301-2']);
  expect(got.map(o => o.orderQty)).toEqual([800, 300]);
});

test('ชีตที่ซ่อนคือของที่เขาตั้งใจเก็บไว้ — ต้องติดป้ายบอก และห้ามถูกเลือกให้อัตโนมัติ', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook(PLAN_ROWS), 'แผน.xlsx');
  await expect(page.locator('#sheetSelect')).toBeEnabled();

  const opts = await page.locator('#sheetSelect option').allInnerTexts();
  expect(opts.some(t => t.includes('WK 99') && t.includes('(ซ่อน)')),
    'ชีตที่ซ่อนต้องมีป้ายกำกับ ไม่งั้นคนเลือกไปโดยไม่รู้ว่ามันเป็นของเก่าที่ถูกซ่อนไว้').toBe(true);
  expect(await page.locator('#sheetSelect').inputValue(),
    'เลือกอัตโนมัติต้องข้ามชีตที่ซ่อน แม้เลข WK จะสูงกว่า').toBe('WK 30  26-29.7.26');
});

// ── นำเข้าใบส่งงาน TPP-UNION ────────────────────────────────────────

test('A2 — นำเข้าใบส่งงานแล้วต้องได้ยอด shipping ตรงกับคอลัมน์ จำนวน/PCS', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook(PLAN_ROWS), 'แผน.xlsx');
  await page.click('#btnParseSheet');
  await page.click('#btnConfirmImport');

  await upload(page, '#shipFileInput', await shipWorkbook([
    { unit: 'TUE-U', lines: [{ pn: '2870327301', poNo: 'TM5267H179', orderDate: '2026-07-29', orderQty: 800, qty: 500 }] },
    { unit: 'TUE-H', lines: [{ pn: '2870501700', poNo: 'TM5267H176', orderDate: '2026-07-30', orderQty: 5000, qty: 1200 }] }
  ]), 'ใบส่งงาน.xlsx');
  await expect(page.locator('#shipPreviewPanel')).toBeVisible();
  await page.fill('#shipDate', '2026-08-29');
  await page.click('#btnConfirmShipImport');

  const rs = await records(page);
  const ship = rs.filter(r => r.process === 'shipping' && !r.voided);
  expect(ship.length, 'ต้องได้บรรทัดละหนึ่ง record').toBe(2);
  expect(ship.every(r => r.date === '2026-08-29'), 'ทุก record ต้องลงวันที่ที่เลือกไว้').toBe(true);
  expect(ship.find(r => r.orderId === 'TM5267H179|2870327301').qty).toBe(500);
  expect(ship.find(r => r.orderId === 'TM5267H176|2870501700').qty).toBe(1200);
  expect(ship.every(r => r.note === 'นำเข้าจากใบส่งงาน'), 'ต้องมีที่มากำกับไว้ ไม่งั้นแยกจากยอดที่คีย์มือไม่ออก').toBe(true);
});

test('ชีตที่ซ่อนคือของที่เขาตั้งใจเก็บไว้ — ใบส่งงานชีตที่ซ่อนต้องไม่ถูกอ่านเข้ามา', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook(PLAN_ROWS), 'แผน.xlsx');
  await page.click('#btnParseSheet');
  await page.click('#btnConfirmImport');

  await upload(page, '#shipFileInput', await shipWorkbook([
    { unit: 'TUE-U', lines: [{ pn: '2870327301', poNo: 'TM5267H179', orderDate: '2026-07-29', orderQty: 800, qty: 500 }] }
  ]), 'ใบส่งงาน.xlsx');
  await expect(page.locator('#shipPreviewPanel')).toBeVisible();

  const preview = await page.locator('#shipPreviewTable').innerText();
  expect(preview, 'ชีตที่ซ่อนคือของเก่าที่เขาตั้งใจเก็บไว้ ห้ามดึงยอดออกมาใช้').not.toContain('TMHIDDEN');
});

// ── ออกไฟล์รายงาน ──────────────────────────────────────────────────

test('G1 — ปุ่ม Export ต้องได้ไฟล์ Excel สองชีตที่ชื่อเป็นภาษาไทย และมียอดจริงอยู่ข้างใน', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook(PLAN_ROWS), 'แผน.xlsx');
  await page.click('#btnParseSheet');
  await page.click('#btnConfirmImport');

  await page.click('.tab-btn[data-tab="data"]');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnExportExcel')
  ]);
  expect(download.suggestedFilename(), 'ชื่อไฟล์ต้องบอกว่าเป็นรายงานของวันไหน').toMatch(/^รายงาน_production_\d{4}-\d{2}-\d{2}\.xlsx$/);

  const fs = require('fs');
  const sheets = await readWorkbook(fs.readFileSync(await download.path()));
  expect(Object.keys(sheets), 'ต้องมีสองชีตชื่อเดิม เปลี่ยนชื่อชีตแปลว่าไฟล์ที่ส่งต่อไปข้างนอกเปลี่ยนรูปแบบ')
    .toEqual(['สรุป WIP', 'บันทึกรายวัน']);

  const wip = sheets['สรุป WIP'];
  expect(wip[0], 'หัวคอลัมน์ต้องมี Deadline ครบ — เอาออกจากหน้าจอแล้วแต่ไฟล์ยังต้องมี').toContain('Deadline Winding');
  const body = wip.slice(1).map(r => String(r[wip[0].indexOf('PO No.')]));
  expect(body.sort(), 'ทุกใบที่นำเข้าต้องอยู่ในไฟล์').toEqual(['TM5267H176', 'TM5267H179', 'TM5267H378']);
});
