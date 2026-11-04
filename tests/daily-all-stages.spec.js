// เทสหน้า "ยอดรายวันทุกขั้น" — หน้าอ่านอย่างเดียวที่โชว์ยอดของวันเดียวครบทุกขั้นในแถวเดียว
//
// เจ้าของสั่ง 3 พ.ย. 2026 หลังพบว่าคนอ่านตัวจริง (คุณพ่อของเจ้าของ) ไม่ได้ใช้ Dashboard
// เพราะมันบอกยอดสะสม ตอบไม่ได้ว่า "วันนั้นทำได้เท่าไหร่" ส่วนหน้าบันทึกยอดรายวันตอบได้
// แต่เห็นทีละขั้น ต้องกดไล่ทุกขั้นแล้วจำเลขไว้ในหัว
//
// ⚠️ สองเรื่องที่เป็นหัวใจของใบนี้ และถ้าพังจะพังแบบเงียบ:
//    1. ตัวเลขต้องเป็น "ยอดของวันนั้น" ไม่ใช่ยอดสะสม — ถ้าเผลอใช้ buildCumMap() จอจะดูปกติ
//       ทุกอย่าง แค่ตัวเลขใหญ่กว่าความจริง ซึ่งไม่มีใครจับได้จนไปเทียบกับกระดาษ
//    2. "—" กับ "0" ต้องต่างกัน — "—" คือไม่มีใครคีย์ · "0" คือคีย์ไว้ว่าผลิตศูนย์
//       เขียน `!v` แทน `v==null` เมื่อไหร่ วันที่หยุดงานจะอ่านไม่ต่างจากวันที่ยังไม่ได้คีย์

const { test, expect } = require('@playwright/test');
const { waitReady, readSaved } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const PN = '9000000002';
const D1 = '2026-08-20';
const D2 = '2026-08-21';

const order = (poNo, qty, unit = 'TUE-U', week = 'WK 34') => ({
  id: poNo, week, poNo, pn: PN, subName: unit, orderQty: qty,
  orderDate: '2026-08-01', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, process, qty, date = D1, extra = {}) => Object.assign({
  id, date, orderId, process, qty, note: '', deviceName: 't',
  createdAt: date + 'T00:00:00.000Z', updatedAt: date + 'T00:00:00.000Z',
  voided: false, _dirty: false
}, extra);

/** เปิดหน้า "ยอดรายวันทุกขั้น" แล้วตั้งวันที่ให้ตรงกับข้อมูลที่ใส่ไว้
 *  ⚠️ ต้องตั้ง #dayDate เอง — ค่าตั้งต้นของหน้าคือ "วันนี้" ตามเวลาเครื่อง
 *     ถ้าไม่ตั้ง ตารางจะว่างทุกข้อ แล้วเทสจะเขียวเพราะไม่มีอะไรให้ดู ไม่ใช่เพราะโค้ดถูก */
async function openDaily(page, orders, records = [], date = D1) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="daily"]');
  await page.fill('#dayDate', date);
  await page.waitForTimeout(250);
}

// ลำดับคอลัมน์ — # · สัปดาห์ · PO · P/N · Sub-Name · Order Qty · แล้วต่อด้วยทุกขั้น
const COL = { qty: 5, winding: 6, assembly: 7, support: 8, inspection: 9, shipping: 10 };
const rowOf = (page, po) => page.locator('#dayTable tbody tr', { hasText: po });
const cellOf = (page, po, col) => rowOf(page, po).locator('td').nth(COL[col]);
// แถวรวมมีช่องแรกเป็น colspan="6" คลุมคอลัมน์ชื่อใบทั้งหมด ช่องของขั้นจึงเริ่มที่ td ตัวที่ 1
const footOf = (page, col) => page.locator('#dayTable tfoot td').nth(COL[col] - 5);

const ORDERS = [order('PO-1', 4000), order('PO-2', 5000, 'TUE-H', 'WK 35')];

// ── 1. โครงตาราง: ทุกขั้นพร้อมกัน ───────────────────────────────────

test('ทุกขั้นเป็นคอลัมน์ของตัวเอง — หัวคอลัมน์ต้องตรงกับที่หน้า Dashboard ใช้', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100)]);

  // อ่านหัวคอลัมน์ของขั้นมาจากหน้า Dashboard เองแล้วเทียบ — ไม่ฝังข้อความไว้ในเทส
  // ถ้าวันหนึ่งเจ้าของเปลี่ยนชื่อขั้น สองหน้าต้องเปลี่ยนตามกันทั้งคู่ (A3)
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForTimeout(150);
  const dashHeads = await page.locator('#dashTable thead th').allInnerTexts();
  await page.click('.tab-btn[data-tab="daily"]');
  await page.waitForTimeout(150);
  const dayHeads = await page.locator('#dayTable thead th').allInnerTexts();

  // Dashboard: Item No. · สัปดาห์ · PO · P/N · Sub-Name · Order Qty · Order Date · Aging · [ขั้น] · สถานะ
  const dashProcHeads = dashHeads.slice(8, dashHeads.length - 1);
  const dayProcHeads = dayHeads.slice(6);
  expect(dayProcHeads.length).toBeGreaterThanOrEqual(5);
  expect(dayProcHeads).toEqual(dashProcHeads);
});

test('ใบเดียวที่คีย์หลายขั้นในวันเดียว ต้องเห็นครบทุกขั้นในแถวเดียว', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100),
    rec('r2', 'PO-1', 'assembly', 80),
    rec('r3', 'PO-1', 'inspection', 70)
  ]);
  expect(await cellOf(page, 'PO-1', 'winding').innerText()).toBe('100');
  expect(await cellOf(page, 'PO-1', 'assembly').innerText()).toBe('80');
  expect(await cellOf(page, 'PO-1', 'inspection').innerText()).toBe('70');
  // ขั้นที่ไม่ได้คีย์ในวันนั้นต้องเป็นขีด ไม่ใช่ศูนย์
  expect(await cellOf(page, 'PO-1', 'support').innerText()).toBe('—');
});

test('ยอดส่งของที่มาจากใบส่งสินค้า ต้องขึ้นในคอลัมน์ส่งของด้วย', async ({ page }) => {
  // หน้าบันทึกยอดรายวันคีย์ขั้นนี้ไม่ได้ (A2) แต่ "อ่าน" ได้ — หน้านี้เป็นหน้าอ่าน จึงต้องเห็น
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'shipping', 500, D1, { note: 'จากใบส่งสินค้า' })
  ]);
  expect(await cellOf(page, 'PO-1', 'shipping').innerText()).toBe('500');
});

// ── 2. หัวใจข้อที่ 1: ยอดของวันนั้น ไม่ใช่ยอดสะสม ────────────────────

test('ตัวเลขต้องเป็นยอดของวันที่เลือก ไม่ใช่ยอดสะสม', async ({ page }) => {
  // คีย์ขั้นเดียวกันสองวัน — สะสมได้ 800 แต่ของวันที่ 21 คือ 300
  const records = [
    rec('r1', 'PO-1', 'winding', 500, D1),
    rec('r2', 'PO-1', 'winding', 300, D2)
  ];
  await openDaily(page, ORDERS, records, D2);
  expect(await cellOf(page, 'PO-1', 'winding').innerText()).toBe('300');

  await page.fill('#dayDate', D1);
  await page.waitForTimeout(200);
  expect(await cellOf(page, 'PO-1', 'winding').innerText()).toBe('500');
});

test('เปลี่ยนวันไปวันที่ไม่ได้คีย์ แถวต้องหายไป ไม่ใช่ค้างเลขของวันก่อน', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500, D1)], D1);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);

  await page.fill('#dayDate', '2026-08-25');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
});

// ── 3. หัวใจข้อที่ 2: "—" กับ "0" ต่างกัน ──────────────────────────

test('ยอด 0 ที่มีคนคีย์ไว้ ต้องขึ้นเป็น 0 ไม่ใช่ขีด', async ({ page }) => {
  // record ยอด 0 เกิดได้เองจากการเลือกเหตุผลตอนยังไม่มียอด (เจ้าของเลือก 27 ต.ค. 2026)
  // และมันแปลว่า "วันนี้ผลิต 0" ซึ่งเป็นข้อมูล ไม่ใช่ความว่าง
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 0, D1, { note: 'เครื่องเสีย' })]);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);
  expect(await cellOf(page, 'PO-1', 'winding').innerText()).toBe('0');
});

test('ใบที่มีแต่ยอด 0 ต้องนับว่า "วันนั้นมีการคีย์" และขึ้นในตารางตั้งต้น', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-2', 'assembly', 0, D1)]);
  await expect(rowOf(page, 'PO-2')).toHaveCount(1);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
});

// ── 4. สวิตช์ "แสดงทุกใบ" (เจ้าของเลือก 3 พ.ย. 2026) ────────────────

test('ค่าตั้งต้นโชว์เฉพาะใบที่วันนั้นมีการคีย์', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100, D1)]);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);
  await expect(rowOf(page, 'PO-2')).toHaveCount(0);
});

test('ติ๊ก "แสดงทุกใบ" แล้วใบที่วันนั้นไม่ได้คีย์ต้องขึ้น พร้อมขีดทุกขั้น', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100, D1)]);
  await page.check('#dayShowAll');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-2')).toHaveCount(1);
  expect(await cellOf(page, 'PO-2', 'winding').innerText()).toBe('—');
  expect(await cellOf(page, 'PO-2', 'inspection').innerText()).toBe('—');
  // ใบที่คีย์ไว้ยังอยู่และยังถูก
  expect(await cellOf(page, 'PO-1', 'winding').innerText()).toBe('100');
});

// ── 5. แถวรวมท้ายตาราง ────────────────────────────────────────────

test('แถวรวมท้ายตารางเป็นผลรวมของวันนั้นต่อขั้น และไม่นับช่องที่ไม่มีการคีย์', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100, D1),
    rec('r2', 'PO-2', 'winding', 250, D1),
    rec('r3', 'PO-1', 'assembly', 40, D1),
    rec('r4', 'PO-1', 'winding', 999, D2)      // วันอื่น ต้องไม่ถูกนับ
  ]);
  expect(await footOf(page, 'winding').innerText()).toBe('350');
  expect(await footOf(page, 'assembly').innerText()).toBe('40');
  expect(await footOf(page, 'support').innerText()).toBe('—');
});

// ── 6. รายการที่ยกเลิกไว้ (B1) ─────────────────────────────────────

test('รายการที่ยกเลิกไว้ต้องไม่นับ — ทั้งในช่องและในแถวรวม', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100, D1, { voided: true }),
    rec('r2', 'PO-2', 'winding', 250, D1)
  ]);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
  expect(await footOf(page, 'winding').innerText()).toBe('250');
});

// ── 7. อ่านอย่างเดียว — เหตุผลครึ่งหนึ่งที่หน้านี้มีอยู่ ──────────────

test('ในตารางต้องไม่มีช่องกรอกหรือช่องเลือกเลย — หน้านี้อ่านอย่างเดียว', async ({ page }) => {
  // หน้าบันทึกยอดรายวันมีช่องกรอกทุกแถว บันทึกทันทีที่ค่าเปลี่ยน และไม่มีด่านกันลูกกลิ้งเมาส์
  // คนที่เปิดมา "ดู" เลื่อนลูกกลิ้งทับช่องแล้วยอดผลิตเปลี่ยนจริง — หน้านี้มีไว้ให้อ่านโดยไม่เสี่ยง
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100, D1)]);
  await page.check('#dayShowAll');
  await page.waitForTimeout(200);
  expect(await page.locator('#dayTable input').count()).toBe(0);
  expect(await page.locator('#dayTable select').count()).toBe(0);
  expect(await page.locator('#dayTable textarea').count()).toBe(0);
  expect(await page.locator('#dayTable [contenteditable]').count()).toBe(0);
});

test('หน้านี้ต้องไม่เขียนข้อมูลลงเครื่องเลย — เล่นตัวกรองทุกตัวแล้ว state ต้องไม่ขยับแม้แต่ตัวอักษร', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 100, D1)], D1);
  const before = await readSaved(page, K_STATE, { raw: true });
  await page.check('#dayShowAll');
  await page.fill('#dayDate', D2);
  await page.fill('#daySearch', 'PO-1');
  await page.selectOption('#daySubFilter', 'TUE-U');
  await page.waitForTimeout(250);
  expect(await readSaved(page, K_STATE, { raw: true })).toBe(before);
});

// ── 8. ตัวกรอง ────────────────────────────────────────────────────

test('ค้นหา PO กรองแถวได้ และแถวรวมขยับตามสิ่งที่เห็น', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100, D1),
    rec('r2', 'PO-2', 'winding', 250, D1)
  ]);
  expect(await footOf(page, 'winding').innerText()).toBe('350');

  await page.fill('#daySearch', 'PO-2');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
  expect(await footOf(page, 'winding').innerText()).toBe('250');
});

test('กรองสัปดาห์กับ Sub-Name ได้ และตัวเลือกมาจากข้อมูลจริง', async ({ page }) => {
  await openDaily(page, ORDERS, [
    rec('r1', 'PO-1', 'winding', 100, D1),
    rec('r2', 'PO-2', 'winding', 250, D1)
  ]);
  expect(await page.locator('#daySubFilter option').allInnerTexts())
    .toEqual(['ทั้งหมด', 'TUE-H', 'TUE-U']);

  await page.selectOption('#daySubFilter', 'TUE-H');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-1')).toHaveCount(0);
  await expect(rowOf(page, 'PO-2')).toHaveCount(1);

  await page.selectOption('#daySubFilter', '');
  await page.selectOption('#dayWeekFilter', 'WK 34');
  await page.waitForTimeout(200);
  await expect(rowOf(page, 'PO-1')).toHaveCount(1);
  await expect(rowOf(page, 'PO-2')).toHaveCount(0);
});

// ── 9. เข้าหน้าแล้วต้องมีของให้ดูทันที ──────────────────────────────

test('กดเข้าแท็บแล้วตารางต้องวาดทันที ไม่ใช่ว่างจนกว่าจะแตะตัวกรอง', async ({ page }) => {
  // ตารางว่างอ่านได้ว่า "วันนั้นไม่มีใครทำอะไร" ซึ่งเป็นคำตอบที่ผิดและไม่มีอะไรฟ้อง
  // (กฎเดียวกับ renderDnLog() ที่ต้องมีทางเรียกครบทุกทาง)
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, ORDERS, [rec('r1', 'PO-1', 'winding', 777, today)]]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="daily"]');
  // ไม่แตะตัวกรองอะไรเลย — วันตั้งต้นของหน้าคือวันนี้
  await expect(page.locator('#dayTable thead th').first()).toBeVisible();
  expect(await cellOf(page, 'PO-1', 'winding').innerText()).toBe('777');
});

// ── 8. ข้อความตอนตารางว่าง ต้องตรงกับความจริง และทางที่มันแนะต้องได้ผล ──
//
// ผู้ตรวจ #118 จับสองรอบติด และรอบที่สองจับได้ว่า **เทสของรอบแรกล็อกข้อความผิดไว้เอง**
// (ตรวจแค่ว่ามีคำว่า "ตัวกรอง" ซึ่งเป็นคำที่ผิดในฉากนั้นพอดี)
//
// ⚠️ อย่าเขียนเทสพวกนี้เป็น "มีคำนี้ไหม" อย่างเดียว · ของที่ต้องยืนยันคือ
//    **ทางที่ข้อความแนะ กดแล้วได้ผลจริง** ซึ่งทดสอบได้ด้วยการกดตามแล้วดูว่ามีแถวโผล่

test('ใบที่ตรงตัวกรองมีอยู่ แต่วันนั้นไม่มีใครคีย์ — ห้ามบอกว่าไม่มีใบที่ตรงตัวกรอง', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)]);   // คีย์ไว้เฉพาะ PO-1 (WK 34)
  await page.selectOption('#dayWeekFilter', 'WK 35');                   // PO-2 มีอยู่จริง แต่วันนั้นไม่ได้คีย์
  await page.waitForTimeout(250);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).not.toContain('ไม่มีใบที่ตรงกับตัวกรอง');
  expect(msg).toContain('แสดงทุกใบ');
  expect(msg).toContain('1 ใบ');                                        // บอกจำนวนที่ติ๊กแล้วจะเห็น
});

test('ทางที่ข้อความแนะต้องได้ผล — ติ๊ก "แสดงทุกใบ" แล้วใบนั้นต้องโผล่จริง', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)]);
  await page.selectOption('#dayWeekFilter', 'WK 35');
  await page.waitForTimeout(250);
  await page.check('#dayShowAll');                                      // ทำตามที่ข้อความบอก
  await page.waitForTimeout(250);
  await expect(rowOf(page, 'PO-2')).toHaveCount(1);
  expect(await cellOf(page, 'PO-2', 'winding').innerText()).toBe('—');
});

test('ไม่มีใบไหนตรงตัวกรองเลย — ตอนนั้นจึงบอกให้ล้างตัวกรองได้', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)]);
  await page.fill('#daySearch', 'PO-9999');
  await page.waitForTimeout(250);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).toContain('ตัวกรอง');
  expect(msg).not.toContain('แสดงทุกใบ');                               // ติ๊กแล้วก็ยังว่าง จึงห้ามแนะ
});

test('ไม่ได้ตั้งตัวกรอง วันนั้นไม่มีใครคีย์ — บอกจำนวนใบทั้งหมดที่ติ๊กแล้วจะเห็น', async ({ page }) => {
  await openDaily(page, ORDERS, [rec('r1', 'PO-1', 'winding', 500)], D2);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).toContain('แสดงทุกใบ');
  expect(msg).toContain('2 ใบ');
  expect(msg).not.toContain('ตัวกรอง');
});

test('ยังไม่นำเข้าแผนเลย — ห้ามแนะให้ติ๊ก "แสดงทุกใบ" เพราะติ๊กแล้วก็ว่างเหมือนเดิม', async ({ page }) => {
  await openDaily(page, [], []);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).toContain('นำเข้าแผนงาน');
  expect(msg).not.toContain('แสดงทุกใบ');
});

test('ติ๊ก "แสดงทุกใบ" แล้วยังว่าง = ไม่มีบรรทัดแผนงาน ไม่ใช่เรื่องตัวกรอง', async ({ page }) => {
  await openDaily(page, [], []);
  await page.check('#dayShowAll');
  await page.waitForTimeout(250);
  const msg = await page.locator('#dayTable tbody').innerText();
  expect(msg).toContain('นำเข้าแผนงาน');
  expect(msg).not.toContain('ตัวกรอง');
});
