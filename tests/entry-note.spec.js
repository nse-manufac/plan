// ช่องเลือกเหตุผล (หมายเหตุ) ท้ายแถวในหน้าคีย์ยอดรายวัน — เจ้าของสั่ง 27 ต.ค. 2026
//
// ⚠️ เรื่องที่ไฟล์นี้คุมหนักที่สุด: ช่อง `note` ของ record **ถูกใช้สองหน้าที่**
//    หน้าที่เดิมคือบอก "ที่มาของยอด" (`จากใบส่งสินค้า` · `นำเข้าจากใบส่งงาน`) ซึ่งคอลัมน์
//    แหล่งที่มาในหน้าแก้ไขรายการกับตัวกรองของมันอ่านค่านี้ตรง ๆ
//    ถ้าเหตุผลไปซ้ำกับสองคำนั้น ผลไม่เหมือนกันสองคำ และพังเงียบทั้งคู่
//      ซ้ำกับ `จากใบส่งสินค้า`    → แหล่งที่มาแสดงผิด แต่ยังอยู่ในตัวกรอง "กรอกมือ"
//      ซ้ำกับ `นำเข้าจากใบส่งงาน` → หายจากตัวกรอง "กรอกมือ" ไปเลย (ตัวกรองคัดด้วยคำนี้คำเดียว)
//
// คำตัดสินของเจ้าของ 27 ต.ค. 2026: เลือกเหตุผลได้แม้ยังไม่คีย์ยอด แล้วระบบบันทึกยอดเป็น 0 ให้
// เพราะเหตุผลมักจำเป็นตอน "วันนี้ไม่ได้ผลิต" ซึ่งคือตอนที่ยังไม่มียอด

const { test, expect } = require('@playwright/test');
const { readSaved, waitReady } = require('./app-state');
const { appSource } = require('./app-source');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const DATE = '2026-08-29';
const PN = '9000000002';
const OID = 'PO-B001|' + PN;

const ORDERS = [{
  id: OID, week: 'WK 34', poNo: 'PO-B001', pn: PN, subName: 'TUE-U',
  orderQty: 12000, orderDate: '2026-08-03', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
}];

const rec = (patch = {}) => Object.assign({
  id: 'R1', date: DATE, orderId: OID, process: 'winding', qty: 500, note: '',
  deviceName: 't', createdAt: '2026-08-29T01:00:00.000Z', updatedAt: '2026-08-29T01:00:00.000Z',
  voided: false, _dirty: false
}, patch);

/* ⚠️ ห้ามใช้ forgetSavedOnEveryLoad() ที่นี่ — มันลบ IndexedDB ทุกครั้งที่หน้าโหลด
 *    ซึ่งจะลบสิ่งที่เทส "ต้องรอดการรีเฟรช" เพิ่งบันทึกไป แล้วเทสจะแดงเพราะตัวช่วย ไม่ใช่เพราะโค้ด
 *    Playwright ให้ context ใหม่ต่อเทสอยู่แล้ว IndexedDB จึงว่างตั้งแต่ต้นโดยไม่ต้องลบเอง */
async function open(page, records = []) {
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 'เครื่องวางแผน',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], deliveryLog: [], importHistory: []
  })), [K_STATE, ORDERS, records]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="entry"]');
  await page.fill('#entryDate', DATE);
  await page.waitForTimeout(200);
}

const sel = page => page.locator(`#entryTable select.row-note[data-order="${OID}"]`);
const readState = page => readSaved(page, K_STATE);
const liveRec = async (page, process = 'winding') =>
  (await readState(page)).records.filter(r => r.orderId === OID && r.process === process && r.date === DATE);

/** เลือกเหตุผลแล้วรอให้บันทึก */
async function pick(page, value) {
  await sel(page).selectOption(value);
  await page.waitForTimeout(250);
}

test('เลือกเหตุผลในแถวที่มียอดแล้ว ต้องเขียนลงรายการเดิม ไม่สร้างแถวใหม่', async ({ page }) => {
  await open(page, [rec()]);
  await pick(page, 'เครื่องเสีย');

  const rows = await liveRec(page);
  expect(rows.length, 'ต้องยังมีรายการเดียว — กุญแจ orderId|process|date ไม่เปลี่ยน (A2)').toBe(1);
  expect(rows[0].note).toBe('เครื่องเสีย');
  expect(Number(rows[0].qty), 'ยอดต้องไม่ถูกแตะ').toBe(500);
  expect(rows[0].id, 'ต้องเป็นรายการเดิม').toBe('R1');
  expect(rows[0]._dirty, 'ต้องถูกส่งขึ้นเซิร์ฟเวอร์รอบถัดไป').toBe(true);
});

test('เลือกเหตุผลในแถวที่ยังไม่มียอด ต้องบันทึกยอด 0 ให้ (เจ้าของเลือก 27 ต.ค. 2026)', async ({ page }) => {
  /* ฉากจริงที่คำตัดสินนี้รองรับ: วันนี้เครื่องเสีย ไม่ได้ผลิตเลย แต่ต้องบอกเหตุไว้
   * ผลที่ยอมรับไว้คือเกิดรายการยอด 0 ขึ้นจริง ซึ่งหมายถึง "วันนี้ผลิต 0" ไม่ใช่ "ยังไม่ได้คีย์" */
  await open(page, []);
  await expect(sel(page), 'ยังไม่มีรายการ ก็ต้องเลือกได้').toBeVisible();
  await pick(page, 'ขาดวัตถุดิบ');

  const rows = await liveRec(page);
  expect(rows.length, 'ต้องสร้างรายการให้หนึ่งแถว').toBe(1);
  expect(Number(rows[0].qty), 'ยอดต้องเป็น 0').toBe(0);
  expect(rows[0].note).toBe('ขาดวัตถุดิบ');
  expect(rows[0].deviceName, 'ต้องบันทึกว่าเครื่องไหนกรอก').toBe('เครื่องวางแผน');
  // ยอดสะสมไม่ขยับเพราะบวก 0 — ตัวเลขบนจอต้องไม่เพี้ยนจากการใส่เหตุผล
  expect(await page.locator('#entryTable tbody tr').first().locator('td').nth(6).innerText(),
    'ยอดสะสมต้องยังเป็น 0').toBe('0');
});

test('ไม่เลือกอะไรในแถวที่ยังไม่มียอด ต้องไม่สร้างแถวเปล่า', async ({ page }) => {
  await open(page, []);
  // เลือกค่าว่างทับค่าว่าง — ต้องไม่เกิดอะไรขึ้นเลย
  await pick(page, '');
  expect((await readState(page)).records.length, 'ห้ามมีรายการโผล่มา').toBe(0);
});

test('ล้างเหตุผลได้ และรายการยอด 0 ยังอยู่ ไม่ถูกลบ (B1)', async ({ page }) => {
  await open(page, []);
  await pick(page, 'คนไม่พอ');
  await pick(page, '');

  const rows = await liveRec(page);
  expect(rows.length, 'B1 — ไม่ลบรายการ ต่อให้ไม่เหลือเหตุผล').toBe(1);
  expect(rows[0].note).toBe('');
  expect(Number(rows[0].qty)).toBe(0);
  expect(await sel(page).inputValue(), 'ช่องต้องกลับไปว่าง').toBe('');
});

test('เหตุผลต้องรอดการรีเฟรช และเลือกค้างไว้ให้เห็น', async ({ page }) => {
  await open(page, [rec()]);
  await pick(page, 'งานแก้ไข/ซ่อม');

  await page.reload();
  await waitReady(page);
  await page.click('.tab-btn[data-tab="entry"]');
  await page.fill('#entryDate', DATE);
  await page.waitForTimeout(200);
  expect(await sel(page).inputValue(), 'ต้องเลือกค้างไว้ตามที่บันทึก').toBe('งานแก้ไข/ซ่อม');
});

test('รายการเหตุผล ห้ามซ้ำกับคำที่ระบบใช้บอกที่มาของยอด', async ({ page }) => {
  /* ⚠️ ด่านที่สำคัญที่สุดของใบนี้ · ถ้าเหตุผลไปซ้ำกับคำบอกที่มา ยอดที่คีย์มือจะถูกนับเป็น
   *    ยอดจากใบส่งสินค้า แล้วตัวกรอง "กรอกมือ" ในหน้าแก้ไขรายการจะซ่อนมันไปเลย
   *    อ่านค่าจริงจากหน้าเว็บมาเทียบ ไม่ใช่รายการที่พิมพ์ไว้ในเทส */
  await open(page, []);
  const got = await page.evaluate(() => ({
    notes: ENTRY_NOTES, ship: SOURCE_SHIP_IMPORT, dn: SOURCE_DELIVERY
  }));
  expect(got.notes.length, 'ต้องอ่านรายการจริงได้ ไม่ใช่ลิสต์ว่าง').toBeGreaterThan(3);
  expect(got.notes, 'ห้ามซ้ำกับคำบอกที่มาจากใบส่งสินค้า').not.toContain(got.dn);
  expect(got.notes, 'ห้ามซ้ำกับคำบอกที่มาจากการนำเข้าใบส่งงาน').not.toContain(got.ship);
  expect(new Set(got.notes).size, 'ห้ามมีคำซ้ำกันในรายการ').toBe(got.notes.length);
  // ทุกคำในรายการต้องขึ้นเป็นตัวเลือกจริงบนจอ ไม่ใช่มีแต่ในโค้ด
  const opts = await sel(page).locator('option').allInnerTexts();
  for (const n of got.notes) expect(opts.join('|'), 'ตัวเลือก ' + n).toContain(n);
});

test('เหตุผลต้องไม่ทำให้คอลัมน์แหล่งที่มาในหน้าแก้ไขรายการเพี้ยน', async ({ page }) => {
  /* คอลัมน์นั้นตัดสินจากค่าใน note ตรง ๆ — ยอดที่คีย์มือพร้อมเหตุผล ต้องยังเป็น "กรอกมือ"
   * และตัวกรอง "กรอกมือ" ต้องยังหามันเจอ ไม่ใช่ถูกเหตุผลเขี่ยออกจากตัวกรอง */
  await open(page, [rec()]);
  await pick(page, 'ผลิตเกินแผน');

  await page.selectOption('#recFilterSource', 'manual');
  await page.waitForTimeout(200);
  const row = page.locator('#recordEditorTable tbody tr').first();
  await expect(row, 'ยอดที่คีย์มือพร้อมเหตุผลต้องยังอยู่ในตัวกรองกรอกมือ').toContainText('PO-B001');
  await expect(row, 'และยังต้องขึ้นว่ากรอกมือ').toContainText('กรอกมือ');
});

test('แถวส่งของต้องไม่มีช่องเลือก และต้องเขียน note ของมันไม่ได้', async ({ page }) => {
  /* note ของแถวส่งของคือคำบอกที่มา ทับแล้วแหล่งที่มาเพี้ยน · กฎเดียวกับที่ #110
   * ปิดช่องกรอกยอดของ shipping ไว้ — หน้านี้แสดงผลอย่างเดียว */
  const shipRec = rec({ id: 'R2', process: 'shipping', qty: 100, note: 'จากใบส่งสินค้า' });
  await open(page, [shipRec]);
  await page.click('#procBtn-shipping');
  await page.waitForTimeout(250);

  expect(await page.locator('#entryTable select.row-note').count(),
    'แถวส่งของห้ามมีช่องเลือกเหตุผล').toBe(0);

  // ชั้นที่สอง — เรียกตัวบันทึกตรง ๆ ก็ต้องไม่เขียน
  await page.evaluate(([oid, d]) => saveEntryNote(oid, 'เครื่องเสีย', d), [OID, DATE]);
  await page.waitForTimeout(200);
  const rows = await liveRec(page, 'shipping');
  expect(rows[0].note, 'คำบอกที่มาต้องไม่ถูกทับ').toBe('จากใบส่งสินค้า');
});

test('รายการที่ยกเลิกไว้ ต้องไม่ถูกปลุกด้วยการใส่เหตุผล (B1)', async ({ page }) => {
  /* saveEntryValue ปลุกให้เมื่อพิมพ์ยอดทับ เพราะนั่นคือการกู้คืนโดยเจตนา
   * แต่การใส่เหตุผลไม่ใช่ — ปลุกแล้วยอดที่ถูกยกเลิกจะกลับเข้ายอดสะสมเงียบ ๆ */
  await open(page, [rec({ voided: true })]);
  expect(await page.locator('#entryTable tbody tr').first().locator('td').nth(6).innerText(),
    'ยอดสะสมต้องยังไม่นับรายการที่ยกเลิก').toBe('0');

  await pick(page, 'เครื่องเสีย');
  const rows = await liveRec(page);
  expect(rows[0].voided, 'ต้องยังยกเลิกอยู่').toBe(true);
  expect(rows[0].note, 'และต้องไม่ถูกเขียนเหตุผลลงไป').toBe('');
  expect(await page.locator('#entryTable tbody tr').first().locator('td').nth(6).innerText(),
    'ยอดสะสมต้องไม่ขยับ').toBe('0');
});

test('ค่าเดิมที่ไม่อยู่ในรายการ ต้องยังเลือกค้างและอ่านออก', async ({ page }) => {
  /* เกิดได้จริงเมื่อเครื่องอื่นใช้รายการคนละชุด หรือรายการถูกแก้ทีหลัง
   * ทำให้หายจากจอ = ทำข้อมูลที่คนอื่นบันทึกไว้หายไปเงียบ ๆ */
  await open(page, [rec({ note: 'รอไฟฟ้า' })]);
  expect(await sel(page).inputValue(), 'ต้องยังเลือกค่าเดิมค้างไว้').toBe('รอไฟฟ้า');
  await expect(sel(page), 'และต้องบอกว่าเป็นค่าเดิม').toContainText('ค่าเดิม');

  // และการเลือกค่าอื่นทับต้องทำได้ตามปกติ
  await pick(page, 'คนไม่พอ');
  expect((await liveRec(page))[0].note).toBe('คนไม่พอ');
});

test('คอลัมน์หมายเหตุต้องไม่หุบแล้วกางเวลาสลับขั้น', async ({ page }) => {
  /* แถวส่งของไม่มีช่องเลือก ถ้าช่องว่างของมันกินที่ไม่เท่ากัน คอลัมน์นี้จะหุบตอนสลับไป
   * ขั้นส่งของ แล้วความกว้างที่เหลือไปดันคอลัมน์อื่นขยับทั้งตาราง — คนคีย์ยอดสลับขั้น
   * ไปกลับทั้งวัน จึงเห็นทุกครั้ง · ตระกูลเดียวกับที่ผู้ตรวจ #110 วัดได้ 246 → 207 → 246px
   *
   * ⚠️ วัด <th> ไม่ใช่ <td> — ความกว้างมาจากคอลัมน์ทั้งคอลัมน์ ไม่ใช่เซลล์ใดเซลล์เดียว */
  await open(page, [rec({ id: 'R3', process: 'shipping', qty: 100, note: 'จากใบส่งสินค้า' })]);
  const w = () => page.locator('#entryTable thead th').nth(9).evaluate(el =>
    Math.round(el.getBoundingClientRect().width));

  const before = await w();
  await page.click('#procBtn-shipping');
  await page.waitForTimeout(250);
  const ship = await w();
  await page.click('#procBtn-winding');
  await page.waitForTimeout(250);
  const after = await w();

  expect(before, 'คอลัมน์ต้องกว้างจริง ไม่งั้นเทสนี้ไม่ได้วัดอะไร').toBeGreaterThan(100);
  expect(Math.abs(ship - before), `ขั้นส่งของ ${ship}px vs ขั้นอื่น ${before}px`).toBeLessThanOrEqual(8);
  expect(after, 'สลับกลับมาต้องเท่าเดิม').toBe(before);
});

test('ไล่เหตุผลด้วยลูกศรได้ — โฟกัสต้องไม่หลุดหลังบันทึก (G2)', async ({ page }) => {
  /* ⚠️ Chrome ยิง change **ทุกครั้งที่กดลูกศร** บน select ที่ยังไม่เปิดรายการ
   *    ตัวจับ change วาดตารางใหม่ อิลิเมนต์เดิมจึงหายไปพร้อมโฟกัส
   *    ผลที่ผู้ตรวจ #115 รันเจอ: ลูกศรครั้งแรกบันทึก "เครื่องเสีย" แล้ว activeElement กลายเป็น BODY
   *    ลูกศรครั้งที่สองจึงไม่ถึงช่องนี้อีกเลย = เหตุผลตัวที่ 2–8 เอื้อมไม่ถึงด้วยแป้นพิมพ์
   *    ต้องคว้าเมาส์ และค่าที่ค้างอยู่คือตัวแรกที่เขาไม่ได้ตั้งใจเลือก */
  await open(page, []);
  const notes = await page.evaluate(() => ENTRY_NOTES);

  await sel(page).focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  expect((await liveRec(page))[0].note, 'ลูกศรครั้งแรกได้ตัวแรกของรายการ').toBe(notes[0]);
  expect(await page.evaluate(() => document.activeElement &&
    (document.activeElement.className + '|' + (document.activeElement.dataset.order || ''))),
    'โฟกัสต้องยังอยู่ที่ช่องเดิม ไม่ใช่หลุดไป BODY').toBe('row-note|' + OID);

  // ลูกศรครั้งต่อไปต้องเดินต่อได้จริง ไม่ใช่ค้างอยู่ที่ตัวแรก
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  expect((await liveRec(page))[0].note, 'ต้องเดินไปตัวที่สองได้').toBe(notes[1]);
  expect((await liveRec(page)).length, 'ยังเป็น record เดียว กุญแจเดิม (A2)').toBe(1);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  expect((await liveRec(page))[0].note, 'และไปตัวที่สามได้').toBe(notes[2]);
});

test('แถวที่ยกเลิกไว้ — เลือกเหตุผลเดิมของมันเอง ก็ต้องบอก ไม่ใช่เงียบ', async ({ page }) => {
  /* ด่าน "ค่าไม่เปลี่ยน" เคยมาก่อนด่าน voided · การเลือกค่าที่บังเอิญตรงกับเหตุผลเดิม
   * ของแถวที่ยกเลิกไว้จึงคืนค่าเงียบสนิท ไม่มีข้อความอะไร แล้วช่องเด้งกลับเป็น "— ไม่ระบุ —"
   * เอง (แถวที่ยกเลิกไม่เข้าดัชนี) · เลือกค่าอื่นได้ข้อความเตือน แต่ตัวที่ตรงกับของเก่าไม่ได้
   * = พฤติกรรมสองแบบบนการกดเดียวกัน (ผู้ตรวจ #115 รันเจอ) */
  await open(page, [rec({ voided: true, note: 'เครื่องเสีย' })]);
  await pick(page, 'เครื่องเสีย');            // ค่าเดียวกับของเดิมเป๊ะ

  await expect(page.locator('#toast'), 'ต้องบอกว่าแถวนี้ถูกยกเลิกไว้').toContainText('ถูกยกเลิกไว้');
  const rows = await liveRec(page);
  expect(rows[0].voided, 'ต้องยังยกเลิกอยู่').toBe(true);
  expect(rows.length, 'ห้ามเกิดแถวใหม่').toBe(1);
});

test('เปลี่ยนเหตุผลของรายการที่มีอยู่แล้ว ต้องไม่วาดตารางใหม่ — แต่ตอนเกิดแถวใหม่ต้องวาด', async ({ page }) => {
  /* การกดลูกศรยิง change ทุกครั้ง ต่างจากช่องยอดที่ยิงครั้งเดียวตอนออกจากช่อง
   * ตารางขนาดของจริง (712 ใบ) วาดครั้งละ ~95 ms — ไล่เหตุผลจากตัวแรกถึงตัวท้าย
   * เคยเสียเวลาวาดตารางเปล่า ๆ เจ็ดรอบ ทั้งที่ไม่มีช่องไหนบนตารางเปลี่ยนเลย
   * (ผู้ตรวจ #115 วัดได้ 274 ms ต่อการกดลูกศรหนึ่งครั้งบนตาราง 712 ใบ)
   *
   * วัดด้วย "อิลิเมนต์เดิมยังเป็นอิลิเมนต์เดิมอยู่ไหม" — ตรงกว่าการจับเวลา และไม่แกว่งตามเครื่อง */
  const mark = () => sel(page).evaluate(el => { el.dataset.mark = 'เดิม'; });
  const stillSame = () => sel(page).evaluate(el => el.dataset.mark === 'เดิม');

  // 1) ยังไม่มีรายการ → เลือกแล้วต้องเกิดแถวใหม่ และตารางต้องถูกวาดใหม่จริง
  await open(page, []);
  await mark();
  await pick(page, 'เครื่องเสีย');
  expect(await stillSame(), 'แถวยอด 0 เพิ่งเกิด ช่องยอดวันนี้เปลี่ยน ตารางต้องถูกวาดใหม่').toBe(false);
  // ⚠️ ช่องยอดวันนี้ของขั้นที่ไม่ใช่ส่งของเป็น <input> ค่าจึงอยู่ที่ value ไม่ใช่ข้อความในเซลล์
  expect(await page.locator('#entryTable input.row-input').first().inputValue(),
    'ช่องยอดวันนี้ต้องโชว์ 0 ที่เพิ่งเกิด').toBe('0');

  // 2) มีรายการแล้ว → เปลี่ยนเหตุผลต้องไม่วาดใหม่
  await mark();
  await pick(page, 'คนไม่พอ');
  expect(await stillSame(), 'ไม่มีช่องไหนบนตารางเปลี่ยน ไม่ต้องวาดใหม่').toBe(true);
  expect((await liveRec(page))[0].note, 'แต่ต้องบันทึกจริง').toBe('คนไม่พอ');

  // 3) ถูกปฏิเสธ → ต้องวาดใหม่เพื่อดีดช่องกลับ ไม่ใช่ปล่อยให้จอโชว์ค่าที่ไม่ได้บันทึก
  await page.evaluate(() => { state.records[0].voided = true; });
  await mark();
  await pick(page, 'ขาดวัตถุดิบ');
  expect(await stillSame(), 'ถูกปฏิเสธ ต้องดีดช่องกลับ').toBe(false);
  expect(await sel(page).inputValue(), 'ช่องต้องกลับไปตรงกับข้อมูล').toBe('');
});

test('เปลี่ยนจากค่าเดิมนอกรายการไปค่าในรายการ ตัวเลือก "(ค่าเดิม)" ต้องหายไปจากรายการ', async ({ page }) => {
  /* ตัวเลือก "(ค่าเดิม)" ถูกวาดไว้เฉพาะตอนที่มันเป็นค่าปัจจุบันของแถว
   * ถ้าเปลี่ยนไปค่าอื่นแล้วไม่วาดตารางใหม่ มันจะค้างอยู่ในรายการ แล้วถ้าคนเลือกย้อนกลับไปหามัน
   * จะได้ข้อความ "เหตุผลนี้ไม่อยู่ในรายการ" ทั้งที่มันอยู่บนจอตรงหน้า
   * = จอกับพฤติกรรมไม่ตรงกัน ซึ่งเป็นสิ่งที่การประหยัดการวาดใหม่ต้องไม่สร้างขึ้นมา (ผู้ตรวจ #115) */
  await open(page, [rec({ note: 'รอไฟฟ้า' })]);
  expect((await sel(page).locator('option').allInnerTexts()).join('|'),
    'ตอนแรกต้องมีตัวเลือกค่าเดิมให้เห็น').toContain('ค่าเดิม');

  await pick(page, 'คนไม่พอ');
  expect((await sel(page).locator('option').allInnerTexts()).join('|'),
    'เปลี่ยนไปค่าอื่นแล้ว ตัวเลือกค่าเดิมต้องไม่ค้างอยู่').not.toContain('ค่าเดิม');
  expect((await liveRec(page))[0].note, 'และต้องบันทึกค่าใหม่จริง').toBe('คนไม่พอ');
});

test('ล้างค่าเดิมนอกรายการเป็น "ไม่ระบุ" ตัวเลือก "(ค่าเดิม)" ก็ต้องหายไปเหมือนกัน', async ({ page }) => {
  /* ทางที่สองของเงื่อนไขเดียวกัน — ข้อก่อนหน้าครอบแค่ "เปลี่ยนไปค่าในรายการ"
   * ผู้ตรวจ #115 ชี้ว่าทางล้างค่ายังไม่มีเทสคุม ทั้งที่โค้ดเดียวกันตัดสินทั้งสองทาง */
  await open(page, [rec({ note: 'รอไฟฟ้า' })]);
  await pick(page, '');

  expect((await sel(page).locator('option').allInnerTexts()).join('|'),
    'ล้างแล้ว ตัวเลือกค่าเดิมต้องไม่ค้างอยู่').not.toContain('ค่าเดิม');
  const rows = await liveRec(page);
  expect(rows[0].note, 'เหตุผลต้องว่างจริง').toBe('');
  expect(Number(rows[0].qty), 'ยอดต้องไม่ถูกแตะ').toBe(500);
  expect(rows.length, 'B1 — ไม่ลบแถว').toBe(1);
});

test('ใส่เหตุผลอย่างเดียว ต้องไม่เปลี่ยนชื่อเครื่องที่คีย์ยอด', async ({ page }) => {
  /* คอลัมน์ในหน้าแก้ไขรายการชื่อ "เครื่องที่กรอก" และสิ่งที่คนไปหาคำตอบคือใครคีย์ยอดจำนวนนี้
   * ถ้าอีกคนมาเลือกเหตุผลให้แถวนั้นแล้วชื่อเครื่องเปลี่ยนตาม คำตอบนั้นผิดโดยไม่มีใครรู้
   * ต่างจากการพิมพ์ยอดทับ ซึ่งทับชื่อได้ถูกต้องเพราะคนนั้นคีย์ยอดใหม่จริง (ผู้ตรวจ #115) */
  await open(page, [rec({ deviceName: 'เครื่องไลน์ A' })]);
  await pick(page, 'เครื่องเสีย');

  const rows = await liveRec(page);
  expect(rows[0].deviceName, 'ต้องยังเป็นเครื่องที่คีย์ยอดไว้').toBe('เครื่องไลน์ A');
  expect(rows[0].note, 'แต่เหตุผลต้องถูกบันทึก').toBe('เครื่องเสีย');
});

test('แถวที่เกิดจากการเลือกเหตุผล ยังต้องบันทึกชื่อเครื่องตามปกติ', async ({ page }) => {
  /* คนที่เลือกเหตุผลตอนยังไม่มีรายการ คือคนที่สร้างแถวนั้นขึ้นมาจริง ชื่อเครื่องจึงต้องเป็นของเขา
   *
   * ⚠️ ต้องเป็นเทสแยก ห้ามต่อท้ายข้อข้างบน — เรียก open() รอบสองในเทสเดียวกันจะได้ข้อมูลเก่า
   *    เพราะของที่บันทึกไว้ใน IndexedDB ชนะ seed ใน localStorage (ดูคอมเมนต์ของ open()) */
  await open(page, []);
  await pick(page, 'คนไม่พอ');
  expect((await liveRec(page))[0].deviceName, 'แถวที่สร้างใหม่ต้องมีชื่อเครื่อง').toBe('เครื่องวางแผน');
});

test('คำบอกที่มาของยอด ต้องเทียบผ่านค่าคงที่ ไม่ใช่ข้อความดิบที่กระจายอยู่', async () => {
  /* ⚠️ ด่านนี้คือสิ่งที่ทำให้ด่าน "ห้ามเหตุผลซ้ำกับคำบอกที่มา" มีผลจริง
   *
   *    ด่านนั้นอ่าน ENTRY_NOTES กับ SOURCE_* จากหน้าเว็บมาเทียบกัน — ถ้ามีที่ไหนเทียบ note
   *    กับ **ข้อความดิบ** แทนที่จะใช้ค่าคงที่ วันที่ใครแก้ถ้อยคำในค่าคงที่ ที่นั่นจะหลุดจากกัน
   *    ตัวกรอง "กรอกมือ" จะพังเงียบ ทั้งที่ด่านนั้นยังเขียว (ผู้ตรวจ #115 พบสามจุดในโค้ดเดิม)
   *
   *    อ่านซอร์สที่เบราว์เซอร์โหลดจริง (tests/app-source.js) ย้ายโค้ดไปไฟล์ไหนก็ยังเห็น */
  const src = appSource();
  for (const word of ['นำเข้าจากใบส่งงาน', 'จากใบส่งสินค้า']) {
    const hits = src.split("'" + word + "'").length - 1;
    expect(hits, `"${word}" ต้องมีเป็นข้อความดิบที่เดียว คือบรรทัดที่ประกาศค่าคงที่`).toBe(1);

    /* ⚠️ ด่านข้างบนนับเฉพาะอัญประกาศ**เดี่ยว** — เขียนด้วยอัญประกาศคู่หรือ backtick
     *    มันมองไม่เห็น (ผู้ตรวจ #115 วัดขอบนี้มา) · จะนับทุกแบบก็ไม่ได้ เพราะคอมเมนต์
     *    ในโค้ดอ้างคำพวกนี้ด้วยอัญประกาศคู่อยู่แล้ว แล้วด่านจะแดงเพราะคำอธิบาย ไม่ใช่เพราะโค้ด
     *    จึงเล็งที่อันตรายจริงแทน: **การเปรียบเทียบกับข้อความดิบ** ไม่ว่าจะอัญประกาศแบบไหน */
    const cmp = new RegExp('[=!]==?\\s*[\'"`]' + word, 'g');
    expect((src.match(cmp) || []).join(' · '),
      `ห้ามเทียบ note กับข้อความดิบ "${word}" — ให้ใช้ค่าคงที่`).toBe('');
  }
});

// ── เหตุผลต่อเนื่องข้ามวัน (เจ้าของสั่ง 29 ต.ค. 2026) ──────────────────────
//
// ของเดิมหายทุกครั้งที่เปลี่ยนวัน เพราะหมายเหตุผูกกับกุญแจ orderId|process|date
// ตอนนี้วันที่ยังไม่ได้ใส่เอง จะ **โชว์** เหตุผลล่าสุดที่ยังค้างอยู่ของใบ+ขั้นนั้น
// จนกว่าจะมีคนเลือกใหม่ หรือเลือกคำปิดเรื่อง
//
// ⚠️ เป็นการ "โชว์" ไม่ใช่ "บันทึกซ้ำทุกวัน" — ถ้าบันทึกซ้ำจะเกิดรายการยอด 0
//    ของทุกใบทุกวัน ซึ่งทำให้ข้อมูลบวมและรายงานอ่านว่าผลิต 0 ทั้งที่ไม่มีใครแตะ

/** วันถัดจาก DATE — ใช้ทดสอบการข้ามวัน */
const DAY2 = '2026-08-30';
const DAY0 = '2026-08-28';

/** เลื่อนวันบนจอ แล้วรอให้ตารางวาดใหม่ */
async function goDay(page, d) {
  await page.fill('#entryDate', d);
  await page.waitForTimeout(250);
}

test('เหตุผลของเมื่อวาน ต้องตามมาโชว์ในวันถัดไป พร้อมบอกว่ามาจากวันไหน', async ({ page }) => {
  await open(page, [rec({ note: 'เครื่องเสีย' })]);
  await goDay(page, DAY2);

  const box = sel(page);
  expect(await box.inputValue(), 'ข้อมูลของวันนี้ยังว่าง ค่าที่เลือกจึงต้องเป็นค่าว่าง').toBe('');
  const shown = (await box.locator('option:checked').innerText()).trim();
  expect(shown, 'แต่ต้องเห็นเหตุผลที่ค้างอยู่').toContain('เครื่องเสีย');
  // fmtDateTH คืนปี ค.ศ. ไม่ใช่ พ.ศ.
  expect(shown, 'และต้องบอกว่ามาจากวันไหน').toContain('29/08');   // ป้ายใช้รูปสั้น ตัวเต็มอยู่ใน title
  await expect(box, 'ต้องดูต่างจากของที่ใส่เองวันนี้').toHaveClass(/carried/);

  // ⚠️ แค่ดู ต้องไม่เกิดรายการใหม่ของวันนี้
  const st = await readState(page);
  expect(st.records.length, 'การโชว์ต่อเนื่องต้องไม่บันทึกอะไรเพิ่ม').toBe(1);
  expect(st.records[0].date).toBe(DATE);
});

test('เลือกเหตุผลใหม่ในวันถัดไป ต้องบันทึกของวันนั้น ไม่ไปแก้ของวันเก่า', async ({ page }) => {
  await open(page, [rec({ note: 'เครื่องเสีย' })]);
  await goDay(page, DAY2);
  await pick(page, 'ขาดวัตถุดิบ');

  const st = await readState(page);
  const byDate = {};
  st.records.filter(r => r.orderId === OID).forEach(r => { byDate[r.date] = r; });
  expect(byDate[DATE].note, 'ของวันเก่าต้องไม่ถูกแตะ').toBe('เครื่องเสีย');
  expect(byDate[DAY2].note, 'ของวันใหม่ต้องเป็นค่าที่เพิ่งเลือก').toBe('ขาดวัตถุดิบ');
  expect(Number(byDate[DAY2].qty), 'วันใหม่ยังไม่ได้คีย์ยอด จึงเป็น 0').toBe(0);
});

test('กดปิดเรื่องแล้ว วันถัด ๆ ไปต้องไม่ตามมาอีก', async ({ page }) => {
  await open(page, [rec({ note: 'เครื่องเสีย' })]);
  await goDay(page, DAY2);
  await pick(page, 'เคลียร์แล้ว');

  // วันที่กดปิด ยังเห็นคำปิดอยู่ — เป็นหลักฐานว่าใครปิดเมื่อไหร่
  expect(await sel(page).inputValue(), 'วันที่กดปิดต้องเก็บคำปิดไว้').toBe('เคลียร์แล้ว');

  await goDay(page, '2026-08-31');
  const box = sel(page);
  expect(await box.inputValue(), 'วันถัดไปต้องว่าง').toBe('');
  expect((await box.locator('option:checked').innerText()).trim(),
    'และต้องไม่เห็นเหตุผลเก่าตามมาอีก').toBe('— ไม่ระบุ —');
  await expect(box, 'และต้องไม่ติดป้ายต่อเนื่อง').not.toHaveClass(/carried/);
});

test('ย้อนไปดูวันก่อนหน้า ต้องไม่เห็นเหตุผลที่เพิ่งใส่ทีหลัง (C1)', async ({ page }) => {
  /* ⚠️ ถ้าไม่กรองวัน จอจะเล่าอดีตด้วยข้อมูลของอนาคต — คนย้อนไปดูว่า "วันนั้นเกิดอะไร"
   *    แล้วเห็นเหตุผลที่เพิ่งใส่เมื่อวาน จะสรุปผิดว่าวันนั้นก็เครื่องเสียเหมือนกัน */
  await open(page, [rec({ note: 'เครื่องเสีย' })]);
  await goDay(page, DAY0);

  const box = sel(page);
  expect(await box.inputValue()).toBe('');
  expect((await box.locator('option:checked').innerText()).trim(),
    'วันก่อนหน้าต้องไม่เห็นเหตุผลของวันหลัง').toBe('— ไม่ระบุ —');
});

test('เหตุผลต้องไม่ข้ามขั้นตอน และไม่ข้ามใบ', async ({ page }) => {
  await open(page, [rec({ note: 'เครื่องเสีย' })]);
  await goDay(page, DAY2);
  expect((await sel(page).locator('option:checked').innerText()).trim(),
    'ขั้นเดิมต้องเห็น').toContain('เครื่องเสีย');

  await page.click('#procBtn-assembly');
  await page.waitForTimeout(250);
  expect((await sel(page).locator('option:checked').innerText()).trim(),
    'ขั้นอื่นต้องไม่เห็น').toBe('— ไม่ระบุ —');
});

test('รายการที่ถูกยกเลิก ต้องไม่ส่งเหตุผลต่อไปวันถัดไป (B1)', async ({ page }) => {
  /* ยกเลิกรายการ = ถอนสิ่งที่บันทึกไว้ · ถ้าเหตุผลของมันยังตามไปวันถัด ๆ ไป
   * การยกเลิกก็ไม่มีผลจริงในสายตาคนใช้ */
  await open(page, [rec({ note: 'เครื่องเสีย', voided: true })]);
  await goDay(page, DAY2);
  expect((await sel(page).locator('option:checked').innerText()).trim(),
    'ของที่ยกเลิกไว้ต้องไม่ตามมา').toBe('— ไม่ระบุ —');
});

test('รายการที่คีย์ยอดตามปกติ (หมายเหตุว่าง) ต้องไม่ปิดเรื่องที่ยังค้างอยู่', async ({ page }) => {
  /* ⚠️ กับดักหลักของกติกานี้ — รายการที่เกิดจากการคีย์ยอดมี note ว่าง
   *    ถ้านับว่าว่าง = ปิดเรื่อง เรื่องที่ยังไม่จบจะหายทุกวันที่มีคนคีย์ยอด ซึ่งคือทุกวัน
   *    ต้องปิดด้วยการเลือกคำปิดเท่านั้น */
  await open(page, [rec({ note: 'เครื่องเสีย' }),
                    rec({ id: 'R9', date: DAY2, qty: 300, note: '' })]);
  await goDay(page, '2026-08-31');
  expect((await sel(page).locator('option:checked').innerText()).trim(),
    'เรื่องเดิมต้องยังค้างอยู่').toContain('เครื่องเสีย');
});

test('ใส่เหตุผลของวันนี้เอง ต้องชนะของที่ค้างมา และไม่ติดป้ายต่อเนื่อง', async ({ page }) => {
  await open(page, [rec({ note: 'เครื่องเสีย' }),
                    rec({ id: 'R9', date: DAY2, qty: 300, note: 'คนไม่พอ' })]);
  await goDay(page, DAY2);

  const box = sel(page);
  expect(await box.inputValue(), 'ต้องเป็นของวันนี้').toBe('คนไม่พอ');
  await expect(box, 'ไม่ใช่ของที่สืบทอดมา').not.toHaveClass(/carried/);
});

test('ล้างเหตุผลของวันนี้ เรื่องที่ยังค้างอยู่ต้องกลับมาโชว์ทันที ไม่ต้องสลับวัน', async ({ page }) => {
  /* ⚠️ กรณีที่สี่ที่ต้องวาดตารางใหม่ (ผู้ตรวจ #117 รันเจอ)
   *    ข้อมูลของวันนี้ว่างแล้ว ช่องจึงต้องกลับไปโชว์เรื่องที่ค้างจากวันก่อน
   *    ถ้าไม่วาดใหม่ ช่องค้างเป็น "— ไม่ระบุ —" = จอบอกว่าไม่มีอะไรค้าง ทั้งที่เรื่องเดิมยังไม่ปิด
   *    และคนที่เพิ่งล้างช่องเองคือคนที่อ่านผิดง่ายที่สุด */
  await open(page, [rec({ note: 'เครื่องเสีย' }),
                    rec({ id: 'R9', date: DAY2, qty: 300, note: 'คนไม่พอ' })]);
  await goDay(page, DAY2);
  expect(await sel(page).inputValue(), 'ตั้งต้นเป็นของวันนี้').toBe('คนไม่พอ');

  await pick(page, '');   // ล้างของวันนี้

  const box = sel(page);
  expect((await box.locator('option:checked').innerText()).trim(),
    'ต้องกลับไปโชว์เรื่องที่ค้างทันที').toContain('เครื่องเสีย');
  await expect(box, 'และต้องติดป้ายว่าต่อเนื่อง').toHaveClass(/carried/);
  const rows = (await readState(page)).records.filter(r => r.date === DAY2);
  expect(rows[0].note, 'ข้อมูลของวันนี้ต้องว่างจริง').toBe('');
  expect(Number(rows[0].qty), 'ยอดต้องไม่ถูกแตะ').toBe(300);
});

test('ป้ายสืบทอดต้องอ่านได้จริงบนจอ ไม่ใช่ถูกตัดจนวันที่หาย', async ({ page }) => {
  /* ⚠️ ใบนี้อ้างเองว่า "ต้องบอกด้วยว่ามาจากวันไหน" แต่ผู้ตรวจ #117 วัดแล้วพบว่า
   *    ช่องกว้าง 160px ตัดวันที่ทิ้งเกือบทุกคำ — คำอ้างจึงเหลืออยู่แค่ใน title ที่ต้องเอาเมาส์ไปชี้
   *    วัดความกว้างข้อความจริงด้วยฟอนต์ที่ใช้อยู่ เทียบกับที่ว่างในช่อง (หัก padding กับลูกศร)
   *
   * ⚠️ เหตุผลที่ยาวที่สุด (รองาน/รอชิ้นส่วนจากขั้นก่อน) ยังถูกตัดโดยรู้ตัว — ตัวเต็มอยู่ใน title
   *    ข้อนี้จึงวัดเหตุผลขนาดกลางซึ่งเป็นกรณีส่วนใหญ่ */
  /* ⚠️ ต้องใช้เหตุผลที่ยาวพอจะแยกสองกรณีจริง — วัดมาแล้วป้ายกว้าง 85–209px
   *    ส่วนที่ว่างในช่องคือ ~132px ที่กล่อง 160px และ ~182px ที่ 210px
   *    คำสั้น (ขาดวัตถุดิบ 119px) พอดีทั้งสองกรณี เทสจะเขียวโดยไม่ได้วัดอะไร
   *    'หยุดงาน/วันหยุด' (146px) พอดีเฉพาะกล่องใหญ่ จึงเป็นตัวที่แยกได้ */
  await open(page, [rec({ note: 'หยุดงาน/วันหยุด' })]);
  await goDay(page, DAY2);

  const m = await sel(page).evaluate(el => {
    const cs = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return {
      text: el.options[el.selectedIndex].text,
      w: c.measureText(el.options[el.selectedIndex].text).width,
      // ที่ว่างจริง = ความกว้างใน border ลบ padding สองข้าง ลบที่ของลูกศร select (~20px)
      avail: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20
    };
  });
  expect(m.text, 'ต้องเป็นป้ายสืบทอดที่มีวันที่').toContain('29/08');
  expect(m.w, `ป้าย "${m.text}" กว้าง ${Math.round(m.w)}px แต่ช่องมีที่ ${Math.round(m.avail)}px`)
    .toBeLessThanOrEqual(m.avail);
});

test('เลือกเหตุผลให้วันนี้บนแถวที่คีย์ยอดไว้แล้ว ป้ายสืบทอดต้องหายทันที', async ({ page }) => {
  /* ⚠️ ทางกลับของข้อข้างบน และเป็น **เส้นทางที่คนใช้จริงมากที่สุด**:
   *    คีย์ยอดไว้ก่อน (record มีอยู่ หมายเหตุว่าง) แล้วค่อยใส่เหตุผล
   *    ถ้าไม่วาดใหม่ ช่องจะค้างเป็นตัวเอียงสีจางพร้อม tooltip ของวันเก่า ทั้งที่เป็นของวันนี้แล้ว
   *    (ผู้ตรวจ #117 รันเจอ · ตรวจสไตล์จริงด้วย ไม่ใช่แค่คลาส เพราะคลาสคือสิ่งที่เราตั้งเอง)
   *
   * ⚠️ ต้องเดินผ่านตัวจับ change จริง — เทสที่ยัดสถานะไว้ให้สำเร็จแล้วค่อยวาด
   *    จะไม่เคยแตะเงื่อนไขนี้เลย */
  await open(page, [rec({ note: 'เครื่องเสีย' }),
                    rec({ id: 'R9', date: DAY2, qty: 300, note: '' })]);
  await goDay(page, DAY2);
  await expect(sel(page), 'ตั้งต้นต้องเป็นป้ายสืบทอด').toHaveClass(/carried/);

  await pick(page, 'คนไม่พอ');

  const box = sel(page);
  await expect(box, 'เลือกของวันนี้แล้ว ต้องไม่ใช่ป้ายสืบทอดอีก').not.toHaveClass(/carried/);
  const look = await box.evaluate(el => ({
    italic: getComputedStyle(el).fontStyle,
    title: el.getAttribute('title') || '',
    first: el.options[0].text
  }));
  expect(look.italic, 'ต้องไม่เอียงแล้ว').toBe('normal');
  expect(look.title, 'tooltip ของวันเก่าต้องไม่ค้าง').toBe('');
  expect(look.first, 'ตัวเลือกแรกต้องกลับเป็นไม่ระบุ').toBe('— ไม่ระบุ —');

  const rows = (await readState(page)).records.filter(r => r.date === DAY2);
  expect(rows[0].note).toBe('คนไม่พอ');
  expect(Number(rows[0].qty), 'ยอดต้องไม่ถูกแตะ').toBe(300);
});

test('หมายเหตุที่มีแต่ช่องว่าง ต้องไม่ตามไปวันถัดไป', async ({ page }) => {
  /* ค่านี้ช่องเขียนเองสร้างไม่ได้ มาจากข้อมูลภายนอก (เซลล์ในชีตที่มีสเปซ · การรวมไฟล์)
   * ถ้าไม่ตัด ป้ายจะเป็น "↩    · 29/08" คือเอียงสีจางแต่ไม่มีเหตุผลให้อ่าน
   * แล้วตามไปทุกวันจนกว่าจะมีคนกดปิด — การสืบทอดทำให้ของเสียชิ้นเดียวกวนได้ยาวกว่าเดิมมาก */
  await open(page, [rec({ note: '   ' })]);
  await goDay(page, DAY2);

  const box = sel(page);
  expect((await box.locator('option:checked').innerText()).trim(),
    'ต้องไม่ขึ้นป้ายที่ไม่มีอะไรให้อ่าน').toBe('— ไม่ระบุ —');
  await expect(box, 'และต้องไม่ติดคลาสสืบทอด').not.toHaveClass(/carried/);
});
