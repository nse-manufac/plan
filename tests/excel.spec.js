// เทสการอ่าน/เขียนไฟล์ Excel — ทางเข้าออกของข้อมูลทั้งหมดในแอปนี้
//
// ── ทำไมเพิ่งมามีเทส ─────────────────────────────────────────────
// การนำเข้าแผนงาน การนำเข้าใบส่งงาน และการ export รายงาน ไม่เคยมีเทสคุมเลย
// ทั้งที่เป็นทางเดียวที่ข้อมูลเข้าสู่ระบบ เขียนชุดนี้ไว้ก่อนเปลี่ยนไลบรารีอ่าน Excel
// เพื่อให้พิสูจน์ได้ว่า "ผลลัพธ์เหมือนเดิมทุกช่อง" ไม่ใช่เชื่อว่าเหมือน
//
// ไฟล์ทดสอบถูกประกอบขึ้นเองใน tests/fixtures.js — ห้ามเอาไฟล์ธุรกิจจริงเข้า repo (INVARIANTS F3)

const { test, expect } = require('@playwright/test');
const { planWorkbook, readWorkbook } = require('./fixtures');

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

/** นำเข้าแผนหนึ่งรอบเต็ม — รอทุกจังหวะแทนการกดรัว ๆ
 *
 *  ⚠️ เขียนครั้งแรกเป็น click ติดกันสามที ผ่านในเครื่องแต่ตกใน CI ซึ่งช้ากว่า
 *     เพราะกด "ยืนยันนำเข้า" ตั้งแต่แผงตัวอย่างยังไม่ทันขึ้น */
async function importPlan(page, rows) {
  await upload(page, '#fileInput', await planWorkbook(rows), 'แผน.xlsx');
  await expect(page.locator('#btnParseSheet')).toBeEnabled();
  await page.click('#btnParseSheet');
  await expect(page.locator('#previewPanel')).toBeVisible();
  await page.click('#btnConfirmImport');
  await expect(page.locator('#previewPanel')).toBeHidden();
}

test('นำเข้าไฟล์แผนทับ ต้องไม่ปลุกใบที่ยกเลิกไปแล้วให้กลับมา', async ({ page }) => {
  /* ⚠️ ไฟล์แผนของ Delta ยังมี PO ที่เขายกเลิกไปแล้วอยู่ได้ ถ้านำเข้าแล้วปลุกกลับมา
   *    การยกเลิกจะไร้ความหมายทันทีในสัปดาห์ถัดไป
   *
   * ⚠️ ข้อนี้ต้องขับผ่านปุ่มนำเข้าจริง ห้ามเลียนแบบ Object.assign ในตัวเทส
   *    เขียนแบบเลียนแบบไว้ครั้งแรก ผู้ตรวจทักว่ามันเทสตรรกะที่ตัวเทสเขียนเอง
   *    ไม่ใช่ตรรกะของแอป · ถ้าปุ่มนำเข้าเปลี่ยนวิธีทำงาน เทสจะยังเขียวอยู่ดี */
  await openBlank(page);
  await importPlan(page, PLAN_ROWS);

  // ยกเลิกใบหนึ่งผ่านหน้าจอจริง
  await page.click('.tab-btn[data-tab="import"]');
  await page.fill('#voidSearch', 'TM5267H179');
  await page.waitForTimeout(150);
  page.once('dialog', d => d.accept());
  await page.click('#orderVoidTable [data-void]');
  await page.waitForTimeout(200);

  // แล้วนำเข้าไฟล์เดิมทับ โดยยอดเปลี่ยนไป
  await importPlan(page, PLAN_ROWS.map(r =>
    r.poNo === 'TM5267H179' ? Object.assign({}, r, { qty: 999 }) : r));

  const o = (await orders(page)).find(x => x.poNo === 'TM5267H179');
  expect(o.orderQty, 'ยอดต้องถูกอัปเดตตามไฟล์').toBe(999);
  expect(o.voided, 'แต่ต้องยังยกเลิกอยู่ ไม่ถูกปลุกกลับมา').toBe(true);

  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForTimeout(150);
  const dash = await page.$$eval('#dashTable tbody tr', t => t.map(x => x.textContent).join(' '));
  expect(dash, 'และต้องไม่โผล่กลับมาบน Dashboard').not.toContain('TM5267H179');
});

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

  // แถวนี้คอลัมน์ C เขียนว่า TUE-U แต่รหัส PO มีตัว H — ตั้งแต่ 4 ก.ย. 2026 รหัส PO ชนะ
  expect(got.find(o => o.poNo === 'TM5267H176').subName,
    'Sub-Name ต้องมาจากตัวอักษรในรหัส PO ไม่ใช่คอลัมน์ C').toBe('TUE-H');
});

/* ── Sub-Name มาจากตัวอักษรในรหัส PO ───────────────────────────────────
 *
 * เจ้าของสั่ง 4 ก.ย. 2026 — คอลัมน์ C ไม่มีหัวตารางในไฟล์จริง จึงหาจากหัวตารางไม่ได้
 * และสำรวจไฟล์จริงพบ 89 แถวที่คอลัมน์ C ขัดกับตัวอักษรใน PO
 * เจ้าของยืนยันว่า "ตัวอักษรใน PO ถูก คอลัมน์ C พิมพ์ผิด" การเปลี่ยนนี้จึงเป็นการแก้ให้ถูก */
test('Sub-Name อ่านจากตัวอักษรในรหัส PO — H เป็น TUE-H · U เป็น TUE-U', async ({ page }) => {
  await openBlank(page);
  // คอลัมน์ C ใส่ค่าที่ขัดกับรหัส PO ทุกแถว เพื่อพิสูจน์ว่ามันถูกเมินจริง
  await upload(page, '#fileInput', await planWorkbook([
    { pn: '1000000001', poNo: 'TM5267H179', orderDate: '2026-07-29', qty: 100, subName: 'TUE-U' },
    { pn: '1000000002', poNo: 'TM5267U176', orderDate: '2026-07-29', qty: 200, subName: 'TUE-H' },
    { pn: '1000000003', poNo: 'TM5267HH78', orderDate: '2026-07-29', qty: 300, subName: 'DLG-H' },
    { pn: '1000000004', poNo: 'TM5267UU80', orderDate: '2026-07-29', qty: 400, subName: '' }
  ]), 'แผน.xlsx');
  await page.click('#btnParseSheet');
  await expect(page.locator('#previewPanel')).toBeVisible();
  await page.click('#btnConfirmImport');

  const by = {};
  (await orders(page)).forEach(o => { by[o.poNo] = o.subName; });
  expect(by['TM5267H179']).toBe('TUE-H');
  expect(by['TM5267U176']).toBe('TUE-U');
  expect(by['TM5267HH78'], 'ตัวซ้ำก็ยังเป็นหน่วยเดียวกัน').toBe('TUE-H');
  expect(by['TM5267UU80']).toBe('TUE-U');
});

test('รหัส PO ที่มีทั้ง U และ H หรือไม่มีเลย ต้องเว้นว่าง และเตือนก่อนนำเข้า', async ({ page }) => {
  // ⚠️ เดาข้างใดข้างหนึ่งไม่ได้ — ใบส่งสินค้าแยกตามหน่วย เดาผิดแล้วของไปออกใบผิดหน่วย
  //    โดยไม่มีใครรู้ ปล่อยว่างแล้วเตือน ดีกว่าเดาแล้วเงียบ
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook([
    { pn: '1000000001', poNo: 'TM5267HU79', orderDate: '2026-07-29', qty: 100 },  // มีทั้งคู่
    { pn: '1000000002', poNo: 'TM5267XX76', orderDate: '2026-07-29', qty: 200 },  // ไม่มีเลย
    { pn: '1000000003', poNo: 'TM5267H378', orderDate: '2026-07-29', qty: 300 }   // ปกติ
  ]), 'แผน.xlsx');
  await page.click('#btnParseSheet');
  await expect(page.locator('#previewPanel')).toBeVisible();

  await expect(page.locator('#previewSummary'), 'ต้องบอกจำนวนแถวที่บอกหน่วยไม่ได้')
    .toContainText('2 รายการที่บอกหน่วยไม่ได้');
  await expect(page.locator('#previewTable')).toContainText('หาไม่เจอ');

  await page.click('#btnConfirmImport');
  const by = {};
  (await orders(page)).forEach(o => { by[o.poNo] = o.subName; });
  expect(by['TM5267HU79'], 'มีทั้ง U และ H = ตัดสินไม่ได้').toBe('');
  expect(by['TM5267XX76'], 'ไม่มีทั้งคู่ = ตัดสินไม่ได้').toBe('');
  expect(by['TM5267H378'], 'แถวที่ชัดเจนต้องไม่พลอยเสียไปด้วย').toBe('TUE-H');
});

/* ── คอลัมน์อื่นหาจากหัวตาราง ไม่ใช่ตำแหน่งตายตัว ────────────────────────
 *
 * ไฟล์จริงมีสองผังปนกัน (สำรวจ 4 ก.ย. 2026)
 *   WK 15+   L = Open Q'ty  · M/N/O = วันแผน
 *   WK 1-14  L = Order Q'ty · M = Open Q'ty · N/O = Rev.
 * โค้ดเดิมอ่าน L เป็นยอดและ M/N/O เป็นวันแผนตายตัว ผังเก่าจึงได้ยอดจากคนละช่อง
 * และได้ "วันแผน" ที่แปลงมาจากตัวเลขจำนวน โดยไม่มีอะไรฟ้อง */
test('ผังคอลัมน์เก่า — ยอดต้องมาจาก Open Q\'ty และวันแผนต้องว่าง ไม่ใช่วันที่มั่ว', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook([
    { pn: '1000000001', poNo: 'TM5267H179', orderDate: '2026-07-29', qty: 800, orderQtyOld: 999 }
  ], { layout: 'old' }), 'แผนเก่า.xlsx');
  await page.click('#btnParseSheet');
  await expect(page.locator('#previewPanel')).toBeVisible();
  await page.click('#btnConfirmImport');

  const a = (await orders(page))[0];
  expect(a.orderQty, "ต้องอ่านจากช่อง Open Q'ty ไม่ใช่ Order Q'ty ที่อยู่ซ้ายมือ").toBe(800);
  expect(a.planWinding, 'ผังเก่าไม่มีคอลัมน์วันแผน ต้องเป็น null ไม่ใช่วันที่ที่แปลงจากตัวเลขจำนวน')
    .toBeNull();
  expect(a.planAssembly).toBeNull();
  expect(a.planInspection).toBeNull();
});

test('แทรกคอลัมน์ใหม่เข้ามา ทุกช่องต้องยังอ่านถูก', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook([
    { pn: '1000000001', poNo: 'TM5267H179', orderDate: '2026-07-29', qty: 800,
      planWinding: '2026-08-08', planAssembly: '2026-08-15', planInspection: '2026-08-22' }
  ], { shift: 3 }), 'แผนเลื่อน.xlsx');
  await page.click('#btnParseSheet');
  await expect(page.locator('#previewPanel')).toBeVisible();
  await page.click('#btnConfirmImport');

  const a = (await orders(page))[0];
  expect(a.pn).toBe('1000000001');
  expect(a.orderQty).toBe(800);
  expect(a.orderDate).toBe('2026-07-29');
  expect(a.planWinding).toBe('2026-08-08');
  expect(a.planInspection).toBe('2026-08-22');
});

test('ขาดคอลัมน์ที่จำเป็น ต้องฟ้อง ไม่ใช่เดาตำแหน่งแล้วนำเข้าผิดเงียบ ๆ', async ({ page }) => {
  await openBlank(page);
  await upload(page, '#fileInput', await planWorkbook([
    { pn: '1000000001', poNo: 'TM5267H179', orderDate: '2026-07-29', qty: 800 }
  ], { dropHead: ["Open Q'ty"] }), 'แผนขาดหัว.xlsx');
  await page.click('#btnParseSheet');

  await expect(page.locator('#toast'), 'ต้องบอกว่าขาดคอลัมน์ไหน').toContainText("Open Q'ty");
  await expect(page.locator('#previewPanel'), 'และต้องไม่เปิดหน้าตรวจให้กดยืนยันต่อ').toBeHidden();
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


/* ── ปุ่มคำนวณ Sub-Name ใหม่จากรหัส PO ────────────────────────────────
 *
 * ของที่นำเข้าไว้ก่อน 4 ก.ย. 2026 ได้ Sub-Name จากคอลัมน์ C ซึ่งมีที่พิมพ์ผิดปนอยู่
 * สำรวจไฟล์จริงพบ 84 แถว (ไม่นับ DLG-H อีก 498) ที่ขัดกับตัวอักษรใน PO
 * ปุ่มนี้แก้ให้โดยไม่ต้องนำเข้าไฟล์ซ้ำ ซึ่งจะทับยอดสั่งกับวันแผนไปด้วย */

const seedOrders = (page, orders) => page.addInitScript(([k, o]) => {
  localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: [], deliveryNotes: [], importHistory: []
  }));
}, [K_STATE, orders]);

const ord = (poNo, subName, extra = {}) => Object.assign({
  id: poNo + '|9000000001', poNo, pn: '9000000001', subName, week: 'WK 30',
  orderQty: 1000, orderDate: '2026-08-01', planWinding: '2026-08-08',
  status: 'active', importedAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
}, extra);

test('ปุ่มคำนวณ Sub-Name ใหม่ — แก้ที่พิมพ์ผิด แตะเฉพาะช่อง Sub-Name', async ({ page }) => {
  await seedOrders(page, [
    ord('TM5267H179', 'TUE-U'),   // คอลัมน์ C ผิด -> ต้องเป็น TUE-H
    ord('TM5267U176', 'TUE-H'),   // คอลัมน์ C ผิด -> ต้องเป็น TUE-U
    ord('TM5267H378', 'TUE-H'),   // ถูกอยู่แล้ว
    ord('TM5267HU80', 'TUE-H')    // ตัดสินไม่ได้ -> ห้ามแตะ
  ]);
  await page.goto(APP);
  await page.waitForSelector('.tab-btn[data-tab="data"]');
  await page.click('.tab-btn[data-tab="data"]');
  page.on('dialog', d => d.accept());
  await page.click('#btnRecalcSubName');
  await page.waitForTimeout(300);

  const got = {};
  (await orders(page)).forEach(o => { got[o.poNo] = o; });
  expect(got['TM5267H179'].subName, 'PO มี H ต้องเป็น TUE-H').toBe('TUE-H');
  expect(got['TM5267U176'].subName, 'PO มี U ต้องเป็น TUE-U').toBe('TUE-U');
  expect(got['TM5267H378'].subName, 'ที่ถูกอยู่แล้วต้องคงเดิม').toBe('TUE-H');
  expect(got['TM5267HU80'].subName,
    'ตัดสินไม่ได้ต้องไม่แตะ ไม่ใช่ล้างเป็นค่าว่าง ไม่งั้นใบนี้จะหายจากหน้าใบส่งสินค้า').toBe('TUE-H');

  // ⚠️ ห้ามแตะอย่างอื่น — นี่คือเหตุผลที่มีปุ่มนี้แทนการให้ไปนำเข้าไฟล์ซ้ำ
  const a = got['TM5267H179'];
  expect(a.orderQty, 'ยอดสั่งต้องไม่ถูกแตะ').toBe(1000);
  expect(a.orderDate).toBe('2026-08-01');
  expect(a.planWinding, 'วันแผนต้องไม่ถูกแตะ').toBe('2026-08-08');

  expect(got['TM5267H378'].updatedAt,
    'ใบที่ไม่ได้เปลี่ยน ต้องไม่ถูกทำให้ dirty ให้ซิงค์ขึ้นไปโดยไม่จำเป็น')
    .toBe('2026-08-01T00:00:00.000Z');
  expect(a._dirty, 'ใบที่เปลี่ยนต้องถูกทำเครื่องหมายให้ซิงค์').toBe(true);
});

test('ไม่มีใบไหนต้องเปลี่ยน ต้องบอกแล้วจบ ไม่ไปแตะข้อมูล', async ({ page }) => {
  await seedOrders(page, [ord('TM5267H179', 'TUE-H'), ord('TM5267U176', 'TUE-U')]);
  await page.goto(APP);
  await page.click('.tab-btn[data-tab="data"]');
  let asked = false;
  page.on('dialog', d => { asked = true; d.accept(); });
  await page.click('#btnRecalcSubName');
  await page.waitForTimeout(250);

  expect(asked, 'ไม่มีอะไรต้องเปลี่ยน ต้องไม่ถามยืนยัน').toBe(false);
  await expect(page.locator('#toast')).toContainText('ไม่มีใบไหนต้องเปลี่ยน');
  const all = await orders(page);
  expect(all.every(o => o._dirty === false), 'ต้องไม่ทำให้ใบไหน dirty').toBe(true);
});

test('กดยกเลิกตอนถามยืนยัน ต้องไม่เปลี่ยนอะไรเลย', async ({ page }) => {
  await seedOrders(page, [ord('TM5267H179', 'TUE-U')]);
  await page.goto(APP);
  await page.click('.tab-btn[data-tab="data"]');
  page.on('dialog', d => d.dismiss());
  await page.click('#btnRecalcSubName');
  await page.waitForTimeout(250);

  const a = (await orders(page))[0];
  expect(a.subName, 'กดยกเลิกแล้วต้องคงค่าเดิม').toBe('TUE-U');
  expect(a._dirty).toBe(false);
});
