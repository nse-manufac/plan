/* ด่านงวดของการนำเข้าไฟล์ Call In
 *
 * ปัญหาที่ใบนี้มาแก้ — currentDeltaWeek() เป็นค่าเดียวของทั้งแอป ไม่แยกตามหน่วย
 * นำเข้าไฟล์ของงวดอื่นจึงทำให้ยอดของ "ทุกหน่วย" ตกด่านงวดพร้อมกัน
 * และกดนำเข้าไฟล์เดิมซ้ำกู้คืนไม่ได้ เพราะ saveDeltaWip() อัปเดตแถวเดิมทับที่เดิม
 * โดยไม่บัมป์ createdAt ส่วน deltaWipNewer() ตัดสินด้วย createdAt ก่อน
 *
 * ⚠️ Playwright ปิดกล่อง confirm ให้เองเป็นค่าตั้งต้น = กดยกเลิก
 *    ข้อที่ต้องการ "กดตกลง" ต้องผูก page.once('dialog', ...) เอง
 */
const { test, expect } = require('@playwright/test');
const { readSaved, waitReady } = require('./app-state');
const { callInWorkbook } = require('./fixtures');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

const order = (poNo, pn, subName) => ({
  id: poNo + '|' + pn, week: 'W47', poNo, pn, subName, orderQty: 300,
  orderDate: '2026-07-06', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});

/* รหัส PO ของเทสห้ามขึ้นต้น TM2… (F3 — repo นี้เป็น public) */
const H1 = order('TM52AH001', '9100000070', 'TUE-H');
const H2 = order('TM52AH002', '9100000071', 'TUE-H');
const A1 = order('TM52AA001', '9100000080', 'TUE-A');

const row = (o, wip) => ({ pn: o.pn, poNo: o.poNo, orderDate: '2026-07-06', qty: o.orderQty, wip });

async function openWith(page, orders) {
  await page.addInitScript(([k, o]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' }, orders: o, records: [], importHistory: []
  })), [K_STATE, orders]);
  await page.goto(APP);
  await waitReady(page);
  await page.waitForSelector('.tab-btn[data-tab="data"]');
  await page.click('.tab-btn[data-tab="data"]');
}

/** อัปโหลด → เลือกชีต → เทียบยอด (ยังไม่กดเก็บ) */
async function scan(page, rows, sheetName) {
  await page.setInputFiles('#callInFileInput', {
    name: 'callin.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await callInWorkbook(rows, { sheetName })
  });
  await expect(page.locator('#btnCallInScan')).toBeEnabled();
  await page.selectOption('#callInSheet', sheetName);
  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
}

/** เทียบยอดแล้วกดเก็บ · accept=true คือกดตกลงในกล่องยืนยัน (ถ้ามี) · คืนข้อความในกล่อง */
async function save(page, rows, sheetName, accept = true) {
  await scan(page, rows, sheetName);
  let msg = null;
  page.on('dialog', d => { msg = d.message(); accept ? d.accept() : d.dismiss(); });
  await page.click('#btnDeltaWipSave');
  await page.waitForTimeout(250);
  page.removeAllListeners('dialog');
  return msg;
}

/** ยอดที่ "มองเห็นจริง" ของแต่ละใบ — ถามแอปผ่านด่านงวดเดียวกับที่จอใช้ */
const seen = page => page.evaluate(() => ({
  week: currentDeltaWeek(),
  H1: (deltaWipOf('TM52AH001|9100000070') || {}).wip ?? null,
  H2: (deltaWipOf('TM52AH002|9100000071') || {}).wip ?? null,
  A1: (deltaWipOf('TM52AA001|9100000080') || {}).wip ?? null
}));

test('งวดเดียวกัน ต้องไม่ถามอะไรเลย และเก็บได้ทั้งสองหน่วย', async ({ page }) => {
  await openWith(page, [H1, H2, A1]);
  expect(await save(page, [row(H1, 111), row(H2, 222)], 'X-FRM wk47')).toBe(null);
  expect(await save(page, [row(A1, 333)], 'X-FRM3M4 wk47'),
    'งวดตรงกัน = ไม่มีอะไรจะเสีย ห้ามถาม').toBe(null);
  expect(await seen(page)).toEqual({ week: '47', H1: 111, H2: 222, A1: 333 });
});

test('ยังไม่เคยนำเข้าเลย ต้องไม่ถาม — ไม่มีงวดไหนถูกยึดไว้ จึงไม่มีอะไรจะเสีย', async ({ page }) => {
  await openWith(page, [H1, A1]);
  expect(await save(page, [row(A1, 333)], 'X-FRM3M4 wk46')).toBe(null);
  expect((await seen(page)).A1).toBe(333);
});

test('งวดต่างกัน ต้องถามก่อน และต้องบอกจำนวนใบของหน่วยอื่นที่จะเสียยอด', async ({ page }) => {
  await openWith(page, [H1, H2, A1]);
  await save(page, [row(H1, 111), row(H2, 222)], 'X-FRM wk47');

  const msg = await save(page, [row(A1, 333)], 'X-FRM3M4 wk46', false);
  expect(msg, 'ต้องมีกล่องยืนยัน').not.toBe(null);
  expect(msg).toContain('wk47');
  expect(msg).toContain('wk46');
  /* 🚨 เลขต้องเป็น 2 ไม่ใช่ 3 — ใบของหน่วยที่อยู่ในชีตนี้ไม่ได้เสียอะไร มันได้แถวใหม่ทันที */
  expect(msg, 'ต้องนับเฉพาะใบของหน่วยอื่นที่เห็นยอดอยู่ตอนนี้').toContain('2 ใบ');
  expect(msg, 'ต้องบอกว่ากู้คืนด้วยการนำเข้าไฟล์เดิมซ้ำไม่ได้').toContain('กู้คืนไม่ได้');
});

test('กดยกเลิกในกล่องยืนยัน ต้องไม่เขียนอะไรลงข้อมูลเลย', async ({ page }) => {
  await openWith(page, [H1, H2, A1]);
  await save(page, [row(H1, 111), row(H2, 222)], 'X-FRM wk47');
  const before = await readSaved(page, K_STATE);

  await save(page, [row(A1, 333)], 'X-FRM3M4 wk46', false);

  expect(await seen(page), 'ยอดของ H ต้องอยู่ครบเหมือนไม่มีอะไรเกิดขึ้น')
    .toEqual({ week: '47', H1: 111, H2: 222, A1: null });
  const after = await readSaved(page, K_STATE);
  expect(JSON.stringify(after.deltaWip), 'กดยกเลิกแล้ว deltaWip ต้องไม่ขยับแม้แต่ตัวอักษร')
    .toBe(JSON.stringify(before.deltaWip));
});

test('กดตกลง ต้องเก็บจริง และยอดของหน่วยอื่นหายไปตามที่กล่องเตือนไว้', async ({ page }) => {
  await openWith(page, [H1, H2, A1]);
  await save(page, [row(H1, 111), row(H2, 222)], 'X-FRM wk47');
  await save(page, [row(A1, 333)], 'X-FRM3M4 wk46', true);
  expect(await seen(page)).toEqual({ week: '46', H1: null, H2: null, A1: 333 });
});

test('หน้าเทียบยอดต้องเตือนเรื่องงวด "ก่อน" กดเก็บ ไม่ใช่ตอนกด', async ({ page }) => {
  await openWith(page, [H1, H2, A1]);
  await save(page, [row(H1, 111), row(H2, 222)], 'X-FRM wk47');

  await scan(page, [row(A1, 333)], 'X-FRM3M4 wk46');
  const sum = await page.locator('#callInSummary').innerText();
  expect(sum, 'ต้องบอกว่างวดไม่ตรง').toContain('งวดไม่ตรงกับที่ยึดอยู่');
  expect(sum).toContain('wk47');
  expect(sum).toContain('wk46');
  expect(sum, 'ต้องบอกจำนวนใบที่จะเสียยอดด้วย').toContain('2 ใบ');

  // งวดตรงกันต้องไม่มีคำเตือน แต่ยังต้องบอกงวดของไฟล์
  await scan(page, [row(A1, 333)], 'X-FRM3M4 wk47');
  const ok = await page.locator('#callInSummary').innerText();
  expect(ok).not.toContain('งวดไม่ตรงกับที่ยึดอยู่');
  expect(ok).toContain('wk47');
});

test('หน้ายอดคงคลัง FG ต้องบอกงวดที่ยึดอยู่ — คอลัมน์ Delta ว่างต้องอธิบายตัวเองได้', async ({ page }) => {
  await openWith(page, [H1, H2, A1]);
  await save(page, [row(H1, 111), row(H2, 222)], 'X-FRM wk47');
  await page.click('.tab-btn[data-tab="fg"]');
  await expect(page.locator('#fgSummary')).toContainText('ยึดยอด Delta จากไฟล์งวด wk47');
});

test('ใบของหน่วยเดียวกันที่ Delta ตัดออกจากงวดใหม่ ต้องไม่ถาม — มันหายตามการออกแบบ', async ({ page }) => {
  /* 🚨 ข้อนี้คือเส้นแบ่งของด่าน · Delta ตัดใบที่ส่งครบออกจากไฟล์งวดใหม่ทุกสัปดาห์
     ใบพวกนั้นต้องหายจากจอ นั่นคือเหตุผลทั้งหมดที่ deltaWipOf() มีด่านงวด
     ถ้าด่านนี้นับมันด้วย กล่องจะเด้งทุกสัปดาห์ด้วยเลขที่เป็นเรื่องปกติ
     แล้วคนจะกดผ่านโดยไม่อ่าน ซึ่งทำให้ด่านนี้ไร้ค่าในวันที่มันสำคัญจริง */
  await openWith(page, [H1, H2, A1]);
  await save(page, [row(H1, 111), row(H2, 222)], 'X-FRM wk47');

  // งวดใหม่ของหน่วยเดียวกัน — Delta ตัด H2 ออกเพราะส่งครบแล้ว
  expect(await save(page, [row(H1, 90)], 'X-FRM wk48'),
    'หน่วยเดียวกันถูกตัดออก = เรื่องปกติของทุกสัปดาห์ ห้ามถาม').toBe(null);

  /* H2 หายจริง และนั่นถูกต้อง — ด่านเลือกไม่เตือนเรื่องนี้โดยเจตนา ไม่ใช่เพราะมองไม่เห็น */
  expect(await seen(page)).toEqual({ week: '48', H1: 90, H2: null, A1: null });
});
