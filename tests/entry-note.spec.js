// ช่องเลือกเหตุผล (หมายเหตุ) ท้ายแถวในหน้าคีย์ยอดรายวัน — เจ้าของสั่ง 27 ต.ค. 2026
//
// ⚠️ เรื่องที่ไฟล์นี้คุมหนักที่สุด: ช่อง `note` ของ record **ถูกใช้สองหน้าที่**
//    หน้าที่เดิมคือบอก "ที่มาของยอด" (`จากใบส่งสินค้า` · `นำเข้าจากใบส่งงาน`) ซึ่งคอลัมน์
//    แหล่งที่มาในหน้าแก้ไขรายการกับตัวกรองของมันอ่านค่านี้ตรง ๆ
//    ถ้าเหตุผลไปซ้ำกับสองคำนั้น ยอดที่พนักงานคีย์มือจะถูกนับเป็นยอดจากใบส่งสินค้า
//    แล้วตัวกรอง "กรอกมือ" จะซ่อนมันไปเลย — เป็นความพังแบบเงียบที่ตามหาไม่เจอ
//
// คำตัดสินของเจ้าของ 27 ต.ค. 2026: เลือกเหตุผลได้แม้ยังไม่คีย์ยอด แล้วระบบบันทึกยอดเป็น 0 ให้
// เพราะเหตุผลมักจำเป็นตอน "วันนี้ไม่ได้ผลิต" ซึ่งคือตอนที่ยังไม่มียอด

const { test, expect } = require('@playwright/test');
const { readSaved, waitReady } = require('./app-state');

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
