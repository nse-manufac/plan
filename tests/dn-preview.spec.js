// หน้าดูรายละเอียดใบส่งสินค้าที่ออกไปแล้ว — ต้องอ่านได้โดย "ไม่มีไฟล์ฟอร์ม FM-ST-07"
//
// เจ้าของถามเมื่อ 25 ต.ค. 2026: คนที่ไม่มีเทมเพลตในมือจะตามดูใบที่ออกไปแล้วได้มั้ย
// เส้นทางเดิมมีทางเดียวคือกดเลขที่ใบเพื่อ "ออกไฟล์ซ้ำ" ซึ่งติดด่าน dnTemplate ตั้งแต่บรรทัดแรก
//
// ⚠️ เทสทุกข้อในไฟล์นี้ **ห้ามเลือกไฟล์ฟอร์ม** — ถ้าข้อไหนเลือก ข้อนั้นเลิกทดสอบสิ่งที่ใบนี้มีอยู่
//    จึงยืนยันด้วย #btnDnExport ที่ยัง disabled ในข้อแรก ว่าสภาพแวดล้อมคือ "ไม่มีฟอร์ม" จริง
//
// ⚠️ อีกเรื่องที่ไฟล์นี้คุม: หน้านี้คิดตัวเลขใหม่จากข้อมูลวันนี้ ไม่ใช่สำเนาของกระดาษ
//    ตัวเลขที่เพี้ยนได้เงียบที่สุดจึงเป็น Wip bal. ของ Delta กับยอดที่ถูกแก้หลังออกใบ

const { test, expect } = require('@playwright/test');
const { forgetSavedOnEveryLoad, waitReady } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const DATE = '2026-08-29';
const PN_B = '9000000002';
const NO = 'TUEU-260829';

const order = (poNo, pn, qty, orderDate, unit = 'TUE-U') => ({
  id: poNo + '|' + pn, week: 'WK 34', poNo, pn, subName: unit, orderQty: qty, orderDate,
  status: 'active', importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});

// P/N เดียวที่ครอบสองใบสั่ง — โครงเดียวกับใบจริง และทำให้จับการรวมช่องบรรจุได้
const ORDERS = [
  order('PO-B001', PN_B, 12000, '2026-08-03'),
  order('PO-B055', PN_B, 12000, '2026-08-10')
];

/** แถว log ของใบที่ออกไปแล้ว — รูปเดียวกับที่ logDeliveryIssue() เขียน */
const logRow = (patch = {}) => Object.assign({
  id: 'LOG-1', no: NO, date: DATE, unit: 'TUE-U', week: '34',
  groups: 1, lines: 1, qty: 100, deviceName: 'เครื่องวางแผน',
  createdAt: '2026-08-29T03:00:00.000Z', updatedAt: '2026-08-29T03:00:00.000Z',
  voided: false, _dirty: false
}, patch);

const deltaRow = (orderId, week, wip) => ({
  id: 'DW-' + orderId + '-' + week, orderId, week: String(week), wip, fileName: 'callin.xlsx',
  deviceName: 't', createdAt: '2026-08-2' + (week - 30) + 'T00:00:00.000Z',
  updatedAt: '2026-08-2' + (week - 30) + 'T00:00:00.000Z', voided: false, _dirty: false
});

async function open(page, { log = [logRow()], deltaWip = [] } = {}) {
  await forgetSavedOnEveryLoad(page);
  await page.addInitScript(([k, o, dlog, dw]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: [], deliveryNotes: [], deltaWip: dw, deliveryLog: dlog, importHistory: []
  })), [K_STATE, ORDERS, log, deltaWip]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.fill('#dnDate', DATE);
  await page.waitForTimeout(150);
  await page.selectOption('#dnUnit', 'TUE-U');
  await page.waitForTimeout(150);
}

/** ตัดยอดเข้าใบสั่ง / กรอกยอดบรรจุ — ผ่านจอจริง ไม่ยัดลงข้อมูลเอง */
async function alloc(page, orderId, value) {
  const i = page.locator(`#dnTable input.dn-alloc[data-order="${orderId}"]`);
  await i.fill(String(value)); await i.press('Tab'); await page.waitForTimeout(150);
}
async function pack(page, pn, field, value) {
  const i = page.locator(`#dnTable input.dn-pack[data-pn="${pn}"][data-f="${field}"]`);
  await i.fill(String(value)); await i.press('Tab'); await page.waitForTimeout(150);
}

/** ยอดปกติของใบในเทสนี้: ส่ง 100 ชิ้น กล่องละ 50 → 2 กล่อง เศษ 0 */
async function normalIssue(page) {
  await alloc(page, 'PO-B001|' + PN_B, 100);
  await pack(page, PN_B, 'perBox', 50);
}

async function preview(page) {
  await page.click('#dnLogTable [data-dn-preview]');
  await expect(page.locator('#dnPreviewModal'), 'กล่องรายละเอียดต้องเปิดขึ้นมา').toBeVisible();
  return page.locator('#dnPreviewBody');
}

test('ดูรายละเอียดใบที่ออกไปแล้วได้ โดยไม่ต้องมีไฟล์ฟอร์ม', async ({ page }) => {
  await open(page);
  await normalIssue(page);

  /* ด่านกันเทสเปล่า — ยืนยันว่าเทสนี้อยู่ในสภาพ "ไม่มีฟอร์ม" จริง
   * ถ้าวันหนึ่งมีใครเติมการเลือกฟอร์มเข้ามาใน open() ข้อนี้จะแดงทันที
   * ไม่ปล่อยให้เขียวต่อไปโดยที่เลิกทดสอบคำถามของเจ้าของแล้ว */
  await expect(page.locator('#btnDnExport'), 'เทสนี้ต้องไม่มีฟอร์ม — ปุ่มออกใบต้องกดไม่ได้').toBeDisabled();

  const body = await preview(page);
  await expect(page.locator('#dnPreviewTitle')).toContainText(NO);
  // ช่องเดียวกับบนกระดาษ FM-ST-07 ทุกช่อง
  await expect(body, 'P/N').toContainText(PN_B);
  await expect(body, 'PO No.').toContainText('PO-B001');
  await expect(body, 'PO QTY').toContainText('12,000');
  await expect(body, 'ยอดส่งงาน').toContainText('100');
  const cells = await body.locator('table#dnPreviewTable tbody tr').first()
    .locator('td').allInnerTexts();
  expect(cells.slice(5), 'ยอดส่งงาน · ต่อกล่อง · กล่อง · เศษ · จำนวน/PCS')
    .toEqual(['100', '50', '2', '0', '100', '']);
  // ต้องบอกให้ชัดว่านี่ไม่ใช่สำเนาของกระดาษ ไม่งั้นคนที่ไม่มีฟอร์มจะไม่มีทางรู้
  await expect(body).toContainText('ไม่ใช่สำเนาของกระดาษ');
});

test('Wip bal. ที่ Delta ไม่ได้ให้ยอดมา ต้องเว้นว่าง ห้ามโชว์ 0', async ({ page }) => {
  /* ช่อง Wip bal. ในไฟล์ Call In เว้นว่างได้ (ไฟล์จริงของ WK 35 มี 39 ใบ) = "ไม่ได้บอกว่าค้างเท่าไหร่"
   * กระดาษเว้นช่องนั้นไว้ (fillDeliveryForm → clearCell) หน้านี้จึงต้องเว้นด้วย
   * เลข 0 แปลว่า "Delta บอกว่าไม่ค้างแล้ว" ซึ่งเป็นข้อมูลคนละเรื่องกันคนละทิศ */
  await open(page, { deltaWip: [deltaRow('PO-B001|' + PN_B, 34, null)] });
  await normalIssue(page);

  const body = await preview(page);
  const wip = (await body.locator('table#dnPreviewTable tbody tr').first()
    .locator('td').allInnerTexts())[4];
  expect(wip, 'Delta ไม่ได้ให้ยอด ต้องเว้นว่าง').toBe('—');
});

test('Wip bal. ที่ Delta ให้มา ต้องเป็นยอดของ Delta ไม่ใช่ยอดค้างที่เราคิดเอง', async ({ page }) => {
  // ของเรา: สั่ง 12,000 ส่งไป 100 → ค้างตามบัญชีเรา 11,900 · ของ Delta: 7,500
  await open(page, { deltaWip: [deltaRow('PO-B001|' + PN_B, 34, 7500)] });
  await normalIssue(page);

  const body = await preview(page);
  const wip = (await body.locator('table#dnPreviewTable tbody tr').first()
    .locator('td').allInnerTexts())[4];
  expect(wip, 'ต้องเป็นยอดของ Delta').toBe('7,500');
  await expect(body, 'ยอดค้างของเราต้องไม่หลุดมาอยู่ช่องนี้').not.toContainText('11,900');

  /* ⚠️ ช่องนี้เป็นยอดของ "งวดล่าสุดที่นำเข้าไว้" ไม่ใช่ของ WK ที่เขียนบนใบ (deltaWipOf)
   *    เลข WK ที่อยู่เหนือตารางจึงอ่านได้ว่าทั้งตารางเป็นของงวดนั้น ซึ่งไม่จริงเฉพาะช่องนี้
   *    ต้องเขียนบอกไว้ ไม่ใช่ปล่อยให้คนอ่านเอาเลขไปเทียบกับงวดผิด (ผู้ตรวจ #113 รอบ 4) */
  await expect(body, 'ต้องบอกว่าเลข WK เป็นของใบ').toContainText('WK บนใบ');
  await expect(body, 'และบอกว่า Wip bal. เป็นของงวดล่าสุด').toContainText('ไม่ใช่ของ WK ที่เขียนบนใบ');
});

test('ยอดถูกแก้หลังออกใบ ต้องขึ้นป้ายและบอกทั้งสองเลข', async ({ page }) => {
  // log บันทึกไว้ว่าออกใบด้วยยอดรวม 100 · วันนี้เหลือ 80
  await open(page);
  await alloc(page, 'PO-B001|' + PN_B, 80);
  await pack(page, PN_B, 'perBox', 50);

  const body = await preview(page);
  await expect(body).toContainText('ข้อมูลเปลี่ยนหลังออกใบ');
  await expect(body, 'ต้องบอกยอดตอนออกใบ').toContainText('100');
  await expect(body, 'และยอดวันนี้').toContainText('80');
});

test('แถวที่ไม่ได้บันทึกยอดรวมไว้ ต้องบอกว่าเทียบไม่ได้ ไม่ใช่ "เท่ากับตอนออกใบ"', async ({ page }) => {
  /* แถวที่ซิงค์มาจากเครื่องรุ่นก่อนไม่มี qty · dnLogStale() คืน false ทั้งกรณี "เท่ากัน"
   * และกรณี "ไม่มีอะไรให้เทียบ" ถ้าหน้านี้เชื่อค่านั้นตรง ๆ จะประกาศว่าข้อมูลยังตรงกับกระดาษ
   * ทั้งที่ไม่มีหลักฐานอะไรเลย — คำรับรองที่ว่างเปล่าแย่กว่าบอกว่าไม่รู้ */
  const noQty = logRow();
  delete noQty.qty;
  await open(page, { log: [noQty] });
  await alloc(page, 'PO-B001|' + PN_B, 80);
  await pack(page, PN_B, 'perBox', 50);

  const body = await preview(page);
  await expect(body).toContainText('เทียบไม่ได้');
  await expect(body, 'ห้ามรับรองว่าเท่ากับตอนออกใบ').not.toContainText('เท่ากับตอนออกใบ');
});

test('ยอดถูกแก้เป็น 0 หลังออกใบ ต้องบอกว่าไม่เหลือยอดบรรจุ ไม่ใช่ตารางเปล่า', async ({ page }) => {
  await open(page);
  // ไม่ตัดยอดเข้าใบเลย = สภาพเดียวกับที่ยอดถูกแก้เป็น 0 หรือใบสั่งถูกยกเลิกหลังออกใบ
  const body = await preview(page);
  await expect(body).toContainText('ไม่เหลือยอดบรรจุของใบนี้แล้ว');
  /* ⚠️ ห้ามชี้สาเหตุที่หน้านี้ยังไม่รู้ · สภาพนี้เกิดจากการซิงค์ที่ยังมาไม่ถึงได้ด้วย
   *    (doSync() ดึง DeliveryLog ก่อน Orders/Records และบล็อกนั้นมี try/catch ของตัวเอง)
   *    และหน้านี้ทำมาเพื่อคนที่นั่งเครื่องอื่น ซึ่งเจอสภาพนั้นง่ายที่สุด (ผู้ตรวจ #113 รอบ 2) */
  await expect(body, 'ต้องบอกสาเหตุให้ครบ ไม่ใช่เฉพาะที่เดาได้ง่าย').toContainText('ยังไม่ซิงค์มาถึงเครื่องนี้');
  /* ⚠️ สาเหตุที่สี่ — ใบถูกย้ายหน่วย · deliveryGroups() กรองด้วย o.subName === unit
   *    ปุ่ม "คำนวณ Sub-Name ใหม่" กับการนำเข้าไฟล์แผนทับย้ายหน่วยได้ทั้งคู่ โดยไม่แตะยอดอะไรเลย
   *    (เจ้าของกดของจริง 25 ต.ค. 2026 · ผู้ตรวจ #113 รอบ 5 รันพิสูจน์ว่าข้อความไปโทษผิดเรื่อง) */
  await expect(body, 'ต้องมีสาเหตุเรื่องย้ายหน่วยด้วย').toContainText('ย้ายหน่วย');
  expect(await body.locator('table#dnPreviewTable').count(),
    'ไม่ควรวาดตารางเปล่าทิ้งไว้ให้เข้าใจผิดว่าใบนี้ไม่มีของ').toBe(0);
});

test('กล่องกับเศษไม่ตรงยอด ต้องเตือนที่หน้านี้ด้วย — คนที่ไม่มีฟอร์มกดดูเหตุไม่ได้', async ({ page }) => {
  /* ด่านนี้คือเหตุที่พบบ่อยที่สุดที่ทำให้ออกไฟล์ซ้ำไม่ได้ (writeDeliveryFile)
   * แต่ข้อความของมันโผล่ตอนกดออกไฟล์ ซึ่งคนที่ไม่มีฟอร์มกดไม่ได้ตั้งแต่ต้น */
  await open(page);
  await normalIssue(page);
  await pack(page, PN_B, 'boxes', 1);          // 1 × 50 = 50 แต่คีย์ส่งไว้ 100

  const body = await preview(page);
  await expect(body).toContainText('กล่องกับเศษไม่ตรงกับยอด');
  await expect(body, 'ต้องบอกทั้งยอดที่กระดาษจะพิมพ์และยอดที่คีย์ไว้').toContainText('50');
  await expect(body).toContainText('100');
});

test('ใบที่ติ๊กไว้ของวันอื่น ต้องไม่ไหลมาโชว์บนใบนี้', async ({ page }) => {
  /* ช่องติ๊ก (dnExtraRows) เป็นสถานะของวัน+หน่วยที่เลือกอยู่บนจอ ล้างเมื่อเปลี่ยนวัน
   * แต่หน้านี้ทำงานกับวันของแถว log ซึ่งมักไม่ใช่วันเดียวกัน
   * ตระกูลเดียวกับที่ผู้ตรวจ #103 รันเจอบนเส้นทางออกไฟล์ซ้ำ */
  await open(page);
  await normalIssue(page);

  await page.fill('#dnDate', '2026-08-30');
  await page.waitForTimeout(250);
  const extra = page.locator('#dnTable input.dn-include[data-order="PO-B055|' + PN_B + '"]');
  await expect(extra, 'ต้องมีช่องติ๊กของ PO-B055 ให้ติ๊ก ไม่งั้นเทสนี้ไม่ได้ทดสอบอะไร').toHaveCount(1);
  await extra.check();
  await page.waitForTimeout(250);

  const body = await preview(page);
  await expect(body, 'ใบเดิมมีแต่ PO-B001').toContainText('PO-B001');
  await expect(body, 'PO-B055 ติ๊กไว้ในวันอื่น ต้องไม่โผล่บนใบนี้').not.toContainText('PO-B055');
});

test('ป้ายหัวคอลัมน์ทุกช่อง ต้องเป็นคำที่มีใช้จริงบนกระดาษหรือบนจอใบส่งสินค้า', async ({ page }) => {
  /* หน้านี้มีไว้ให้คนเทียบกับกระดาษ จึงห้ามมีป้ายที่ไม่มีใครในสายใบส่งสินค้าใช้
   * "Order Q'ty" เป็นป้ายของไฟล์แผนงานฝั่งลูกค้า (PLAN_HEAD) ซึ่งเป็นเอกสารคนละใบ
   *
   * ⚠️ เกณฑ์คือ "มีอยู่บนกระดาษ **หรือ** บนจอ" ไม่ใช่ "ตรงทั้งสองที่" — สองที่นั้นใช้คำ
   *    ไม่เหมือนกันทุกช่อง (กระดาษ `ยอดส่งงาน` จอ `จำนวนที่ส่ง` · กระดาษ `จำนวนต่อกล่อง`
   *    จอ `ต่อกล่อง`) จึงไม่มีชุดคำที่ตรงทั้งคู่ได้เลย (ผู้ตรวจ #113 รอบ 2 ทักข้อนี้ถูก)
   *
   * ⚠️ อ่านสองแหล่งนั้นมาเทียบ ไม่ใช่เทียบกับรายการที่พิมพ์ไว้ในเทส · รายการที่พิมพ์เองจะ
   *    เขียวต่อไปทั้งที่ป้ายบนกระดาษเปลี่ยนไปแล้ว ซึ่งคือบั๊กที่เทสนี้มีไว้จับ */
  await open(page);
  await normalIssue(page);

  const paper = await page.evaluate(() => DN_HEAD.map(h => h[0]));   // ป้ายบนฟอร์ม FM-ST-07
  const screen = await page.locator('#dnTable thead').innerText();   // ป้ายบนจอที่พนักงานคีย์ทุกวัน
  expect(paper.length, 'ต้องอ่านป้ายจากกระดาษได้จริง ไม่ใช่ลิสต์ว่าง').toBeGreaterThan(5);

  const body = await preview(page);
  const labels = await body.locator('table#dnPreviewTable thead th').allInnerTexts();
  expect(labels.length, 'ต้องมี 11 ช่องเท่ากระดาษ').toBe(11);
  for (const th of labels) {
    expect(paper.includes(th) || screen.includes(th),
      `ป้าย "${th}" ไม่มีใช้ทั้งบนกระดาษและบนจอ`).toBe(true);
  }
  // ช่องที่ผู้ตรวจทักรอบแรก ตรึงไว้ตรง ๆ อีกชั้น
  expect(labels, 'ป้ายยอดสั่งต้องเป็น PO QTY').toContain('PO QTY');
  expect(labels, "ห้ามใช้ Order Q'ty ซึ่งเป็นป้ายของไฟล์แผนงาน").not.toContain("Order Q'ty");
});

test('ปิดกล่องได้ทั้งปุ่มปิดและคลิกฉากหลัง', async ({ page }) => {
  // รูปแบบเดียวกับ mergeModal · ของเดิมมีแต่ปุ่ม (ผู้ตรวจ #113)
  await open(page);
  await normalIssue(page);

  await preview(page);
  await page.click('#dnPreviewCloseBtn');
  await expect(page.locator('#dnPreviewModal'), 'ปุ่มปิดต้องปิดได้').toBeHidden();

  await preview(page);
  // คลิกมุมซ้ายบนของฉากหลัง — ตัวกล่องอยู่กลางจอ จึงไม่โดนกล่อง
  await page.locator('#dnPreviewModal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#dnPreviewModal'), 'คลิกฉากหลังต้องปิดได้').toBeHidden();
});

/** ยัดค่าเพี้ยนลงข้อมูลแล้วเปิดหน้าใบส่งสินค้า — ใช้กับสองเทส G3 ข้างล่าง */
async function openDirty(page, { orders, log }) {
  await forgetSavedOnEveryLoad(page);
  await page.addInitScript(([k, o, dlog]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: [], deliveryNotes: [], deltaWip: [], deliveryLog: dlog, importHistory: []
  })), [K_STATE, orders, log]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.fill('#dnDate', DATE);
  await page.waitForTimeout(150);
  await page.selectOption('#dnUnit', 'TUE-U');
  await page.waitForTimeout(150);
}

const PAYLOAD = '<img src=x onerror="window.__pwned=1">';

test('G3 — วันที่ของแถว log ที่เพี้ยนมาจากการซิงค์ ต้องไม่กลายเป็น HTML ที่รันได้', async ({ page }) => {
  /* ผู้ตรวจ #113 รอบ 3 รันพิสูจน์ว่าโค้ดเดิมของใบนี้รัน onerror ได้จริง
   *
   * ⚠️ fmtDateTH() ไม่ใช่ตัวทำให้ปลอดภัย — normalizeDateOnly() คืนค่าเดิมให้สตริงที่ไม่ใช่
   *    รูปวันที่ ค่าเพี้ยนจากชีต DeliveryLog จึงไหลผ่าน prepareState() กับการ pull
   *    มาถึง innerHTML ได้ครบ · ใบนี้เป็นที่แรกที่วาด deliveryLog.date ลงจอ จึงเป็นรูที่ใบนี้สร้างเอง
   *
   * ⚠️ ใบสั่งในเทสนี้ต้อง **สะอาด** · ถ้าใส่ค่าเพี้ยนใน orderDate ด้วย หน้าอื่นที่ยังไม่ escape
   *    จะยิงตั้งแต่เปิดหน้า (วัดแล้ว: __pwned = 1 ตอนแท็บ import ยัง active โดยไม่ต้องกดอะไร)
   *    แล้ว window.__pwned จะเลิกบอกอะไรเกี่ยวกับหน้านี้ — เทสจะแดงเพราะรูของคนอื่น */
  await openDirty(page, { orders: ORDERS, log: [logRow({ date: PAYLOAD + "-08-29" })] });
  await normalIssue(page);

  const body = await preview(page);
  await expect(body, 'ต้องวาดวันที่ของแถวนั้นออกมาจริง ไม่ใช่ข้ามไปเงียบ ๆ').toContainText('onerror');
  expect(await page.evaluate(() => window.__pwned), 'ห้ามรันโค้ดจากค่าในข้อมูล').toBeUndefined();
  expect(await body.locator('img').count(), 'ห้ามมี <img> หลุดเข้า DOM').toBe(0);
});

test('G3 — ช่อง Order Date ของแต่ละบรรทัดก็ต้อง escape', async ({ page }) => {
  /* เส้นทางที่สองในฟังก์ชันเดียวกัน · ค่ามาจากไฟล์แผนงานที่นำเข้า
   *
   * ⚠️ ข้อนี้วัดด้วย window.__pwned ไม่ได้ เพราะ fmtDateTH() ลง innerHTML แบบไม่ escape
   *    ยังมีอีก 6 จุดในหน้าอื่น (app.js:1930 1987 2244 2456 2848 3418) ซึ่งยิงตั้งแต่เปิดหน้า
   *    เป็นรูเก่า ไม่ใช่ของใบนี้ และแยกเป็นงานของตัวเองแล้ว
   *    จึงวัดที่ช่องของหน้านี้ตรง ๆ ว่าเนื้อถูก escape ไว้จริง */
  const dirty = [Object.assign({}, ORDERS[0], { orderDate: PAYLOAD + "-08-03" }), ORDERS[1]];
  await openDirty(page, { orders: dirty, log: [logRow()] });
  await normalIssue(page);

  const body = await preview(page);
  const cell = body.locator('table#dnPreviewTable tbody tr').first().locator('td').nth(2);
  const html = await cell.evaluate(el => el.innerHTML);
  expect(html, 'ต้องเก็บไว้เป็นข้อความที่ถูก escape').toContain('&lt;img');
  expect(html, 'ห้ามเหลือแท็กจริง').not.toContain('<img');
  expect(await body.locator('img').count(), 'ห้ามมี <img> จากช่อง Order Date').toBe(0);
});

test('จำนวนบรรทัดต่างจากตอนออกใบ ต้องบอก แม้ยอดรวมจะเท่าเดิม', async ({ page }) => {
  /* ยอดรวมเท่าเดิมไม่ได้แปลว่ากระดาษเหมือนเดิม — ใบที่ถูกติ๊กให้ขึ้นกระดาษทั้งที่ไม่ได้ส่งของ
   * มี alloc = 0 จึงบวกยอดเป็นศูนย์ ตัวเทียบยอดรวมมองไม่เห็นโดยออกแบบ (#103)
   * ใบนี้เป็นที่แรกที่วางสองเลขนี้ไว้ใกล้กัน จึงต้องไม่ปล่อยให้ขัดกันเงียบ ๆ
   * (ผู้ตรวจ #113 รอบ 5 รันเจอ: log บอก 2 บรรทัด กล่องโชว์ 1 พร้อมคำว่า "เท่ากับตอนออกใบ") */
  await open(page, { log: [logRow({ lines: 2 })] });   // ตอนออกใบมี 2 บรรทัด — ใบหนึ่งติ๊กให้โผล่
  await normalIssue(page);                             // วันนี้เหลือบรรทัดที่มียอดจริงใบเดียว

  const body = await preview(page);
  await expect(body, 'ยอดรวมยังเท่าเดิมจริง').toContainText('เท่ากับตอนออกใบ');
  await expect(body, 'แต่ต้องบอกว่าจำนวนบรรทัดไม่เท่า').toContainText('จำนวนบรรทัดไม่เท่าตอนออกใบ');
  const txt = await body.innerText();
  expect(txt, 'ต้องบอกทั้งสองเลข').toMatch(/ตอนออกใบ\s*2\s*บรรทัด/);
  expect(txt, 'และเลขของวันนี้').toMatch(/วันนี้\s*1\s*บรรทัด/);

  // แถวที่ไม่ได้บันทึก lines ไว้ (ซิงค์มาจากเครื่องรุ่นก่อน) ต้องไม่ขึ้นป้ายนี้แบบมั่ว
  const noLines = logRow();
  delete noLines.lines;
  await open(page, { log: [noLines] });
  await normalIssue(page);
  const body2 = await preview(page);
  await expect(body2, 'ไม่มีอะไรให้เทียบ ต้องไม่ขึ้นป้าย').not.toContainText('จำนวนบรรทัดไม่เท่า');

  /* ⚠️ ค่าที่ซิงค์กลับมาอาจเป็นสตริง · สตริงว่างให้ 0 และสตริงอื่นให้ NaN ซึ่งไม่เท่ากับ
   *    จำนวนบรรทัดวันนี้เสมอ → ป้ายจะขึ้นพร้อม "ตอนออกใบ 0 บรรทัด" ที่ไม่มีใครเคยออกใบด้วย
   *    (ผู้ตรวจ #113 รอบ 6 ทักจากการอ่าน) */
  for (const bad of ['', 'ไม่ทราบ']) {
    await open(page, { log: [logRow({ lines: bad })] });
    await normalIssue(page);
    const b = await preview(page);
    await expect(b, `lines = ${JSON.stringify(bad)} ต้องไม่ขึ้นป้าย`)
      .not.toContainText('จำนวนบรรทัดไม่เท่า');
  }
});
