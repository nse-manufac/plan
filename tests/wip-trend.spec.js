// เทสหน้า "ยอดค้างรายวัน" — แท็บแยกที่เจ้าของสั่งเมื่อ 9 พ.ย. 2026
//
// ⚠️ สามกราฟบนหน้านี้ใช้ชุดขั้นไม่เท่ากันโดยตั้งใจ
//    PO และ ยอดผลิตรายวัน = ทุกขั้น · ยอดค้างรายวัน = เฉพาะขั้นในสาย (A3 · A5)
//    ถ้ามีใครทำให้ทั้งสามใช้ชุดเดียวกัน จะมีข้อหนึ่งในไฟล์นี้แดง

const { test, expect } = require('@playwright/test');
const { waitReady } = require('./app-state');

const K_STATE = 'tue_order_tracker_v1';
const PN = '9000000002';

/** ISO ของวันที่ n วันก่อน — ต้องตรงกับ todayISO() ของแอป ไม่งั้นวันตกนอกช่วงกราฟ */
function isoAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const order = (poNo, qty, importedAt) => ({
  id: poNo + '|' + PN, week: 'WK 34', poNo, pn: PN, subName: 'TUE-U', orderQty: qty,
  orderDate: '2026-08-03', status: 'active',
  importedAt, updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, process, qty, date) => ({
  id, date, orderId, process, qty, note: '', deviceName: 't',
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  voided: false, _dirty: false
});

async function open(page, orders, records = [], processes = null) {
  await page.addInitScript(([k, o, r, pl]) => localStorage.getItem(k) || localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' }, processes: pl,
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders, records, processes]);
  await page.goto('/production_plan_tracker.html');
  await waitReady(page);
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(350);
}

/** ค่าของขั้นหนึ่งในกราฟยอดค้าง เรียงตามวัน — อ่านจาก <title> เพราะนั่นคือตัวเลขจริง
 *  ⚠️ อ่านความสูงของแท่งแทนไม่ได้ ความสูงถูกหารด้วยค่าสูงสุดของกราฟ จึงพิสูจน์ค่าจริงไม่ได้ */
const wipOf = (page, proc) => page.$$eval(`#wtWip rect[data-proc="${proc}"] title`,
  els => els.map(e => Number(e.textContent.split(': ').pop().replace(/,/g, ''))));

const procsIn = (page, box) => page.$$eval(`#${box} rect[data-proc]`,
  els => [...new Set(els.map(e => e.dataset.proc))]);

/* ───────── ยอดค้างเดินตามสมุดยอดจริง ───────── */

test('ยอดค้างหน้าขั้นแรก = ยอดสั่ง ลบ ยอดสะสม และลดลงทุกวันที่คีย์', async ({ page }) => {
  const recs = [];
  for (let d = 5; d >= 0; d--) recs.push(rec('w' + d, 'AA-1|' + PN, 'winding', 100, isoAgo(d)));
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')], recs);

  const vals = await wipOf(page, 'winding');
  expect(vals.length, 'ต้องมีแท่งครบทุกวันในช่วง').toBe(14);
  expect(vals[0], 'วันแรกยังไม่มีใครคีย์ ของค้างต้องเท่ากับยอดสั่งทั้งใบ').toBe(1000);
  expect(vals[vals.length - 1], 'คีย์ไป 6 วัน วันละ 100 เหลือค้าง 400').toBe(400);
  // ต้องลดลงเรื่อย ๆ ไม่ใช่ลงทีเดียวตอนท้าย — พิสูจน์ว่าเดินทีละวันจริง
  expect(vals[8]).toBeGreaterThan(vals[11]);
  expect(vals[11]).toBeGreaterThan(vals[13]);
});

test('ยอดค้างหน้าขั้นถัดไป = ยอดสะสมของขั้นก่อนหน้า ลบ ยอดสะสมของขั้นนั้น', async ({ page }) => {
  const recs = [
    rec('w1', 'AA-1|' + PN, 'winding', 500, isoAgo(5)),
    rec('a1', 'AA-1|' + PN, 'assembly', 200, isoAgo(3))
  ];
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')], recs);

  const asm = await wipOf(page, 'assembly');
  expect(asm[0], 'ก่อนมีใครคีย์ ไม่มีอะไรไหลมาถึงขั้นนี้').toBe(0);
  expect(asm[9], 'หลังคีย์ winding 500 แต่ยังไม่คีย์ assembly → ค้าง 500').toBe(500);
  expect(asm[13], '500 − 200 = 300').toBe(300);
});

test('C1 — ใบที่เพิ่งนำเข้า ต้องไม่โผล่เป็นของค้างของวันก่อนหน้าที่มันยังไม่มีอยู่', async ({ page }) => {
  /* ⚠️ ข้อนี้คือเหตุผลที่ wipDailySeries ต้องกรองด้วย importedAt
     ถอดด่านนั้นออกแล้วใบใหม่จะย้อนไปโผล่ตั้งแต่วันแรกของกราฟ ทำให้จอเล่าอดีตผิด
     และเส้นทั้งเส้นจะกระโดดใหม่ทุกครั้งที่มีคนนำเข้าไฟล์แผน (พิสูจน์แล้ว: ถอดออก → ข้อนี้แดง) */
  await open(page, [
    order('OLD-1', 300, '2026-08-01T00:00:00.000Z'),
    order('NEW-1', 700, isoAgo(2) + 'T00:00:00.000Z')
  ]);

  const vals = await wipOf(page, 'winding');
  expect(vals[0], 'วันแรกของช่วง มีแต่ใบเก่า').toBe(300);
  // ช่วง 14 วัน: index = 13 − (จำนวนวันที่ย้อนหลัง) · ใบใหม่นำเข้า isoAgo(2) จึงเริ่มนับที่ index 11
  expect(vals[10], 'วันก่อนที่ใบใหม่จะถูกนำเข้า ก็ยังมีแต่ใบเก่า').toBe(300);
  expect(vals[11], 'วันที่นำเข้าใบใหม่ ของค้างต้องเพิ่มขึ้นทั้งก้อน').toBe(1000);
  expect(vals[13]).toBe(1000);
});

test('ใบที่คีย์เกินยอดสั่ง ต้องไม่ทำให้ยอดค้างของขั้นถัดไปติดลบหรือหายไป', async ({ page }) => {
  /* ⚠️ ไม่ครอบ Math.min(สะสม, orderQty) ต่อใบแล้ว ขั้นถัดไปจะได้ค่าติดลบ
     ซึ่ง SVG วาดเป็นความสูงติดลบ = แท่งหายไปเฉย ๆ โดยไม่มีอะไรฟ้อง */
  const recs = [
    rec('w1', 'AA-1|' + PN, 'winding', 400, isoAgo(5)),
    rec('a1', 'AA-1|' + PN, 'assembly', 900, isoAgo(4))   // เกินทั้งขั้นก่อนหน้าและยอดสั่ง
  ];
  await open(page, [order('AA-1', 500, '2026-08-01T00:00:00.000Z')], recs);

  const asm = await wipOf(page, 'assembly');
  const sup = await wipOf(page, 'support');
  expect(Math.min(...asm), 'ห้ามติดลบ').toBeGreaterThanOrEqual(0);
  expect(Math.min(...sup), 'ห้ามติดลบ').toBeGreaterThanOrEqual(0);
  expect(asm[13], 'ขั้นก่อนหน้าส่งมาได้มากสุด 400 และคีย์ไปแล้วเกินนั้น จึงไม่เหลือค้าง').toBe(0);
  expect(sup[13], 'ยอดที่ครอบแล้วของ assembly คือ 400 ทั้งก้อนจึงค้างหน้า support').toBe(400);
});

test('รายการที่ยกเลิกแล้วต้องไม่ถูกนับเป็นยอดที่ทำเสร็จ', async ({ page }) => {
  const recs = [
    rec('w1', 'AA-1|' + PN, 'winding', 300, isoAgo(5)),
    Object.assign(rec('w2', 'AA-1|' + PN, 'winding', 400, isoAgo(4)), { voided: true })
  ];
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')], recs);
  expect((await wipOf(page, 'winding'))[13], '1000 − 300 (แถวที่ยกเลิกไม่นับ)').toBe(700);
});

/* ───────── ชุดขั้นของแต่ละกราฟ ───────── */

const STANDALONE = [
  { id: 'winding', label: 'Winding/Trimming' },
  { id: 'repair', label: 'ซ่อม', short: 'ซ่อม', standalone: true },
  { id: 'assembly', label: 'Assembly' },
  { id: 'support', label: 'Support' },
  { id: 'inspection', label: 'Inspection' },
  { id: 'shipping', label: 'ส่งของ (Shipping)' }
];

test('A3 — ขั้นนับแยกต้องมีในกราฟ PO และกราฟยอดผลิต แต่ต้องไม่มีในกราฟยอดค้าง', async ({ page }) => {
  /* ⚠️ ของค้างคิดจาก "ขั้นก่อนหน้า ลบ ขั้นนี้" ซึ่งขั้นนับแยกไม่มีขั้นก่อนหน้า
     และไม่ได้ส่งต่อให้ขั้นไหน · เอามาใส่เมื่อไหร่ ยอดของมันจะไปแทรกกลางสาย
     แล้วดูดของที่ควรค้างหน้า Assembly ไปเป็นของมันเอง

     ⚠️ **ต้องตรวจค่าในแท่ง ไม่ใช่แค่ว่ามีแท่งอยู่** — ตัววาดไล่ตาม PROCESSES เสมอ
        ขั้นที่หายไปจากข้อมูลจึงยังได้แท่งสูงศูนย์ ซึ่งนับว่า "มีแท่ง" เหมือนเดิม
        (เวอร์ชันแรกของข้อนี้ตรวจแค่การมีอยู่ แล้วเขียวทั้งที่สลับ MAIN_PROCESSES/PROCESSES — พิสูจน์แล้ว) */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')], [
    rec('w1', 'AA-1|' + PN, 'winding', 400, isoAgo(5)),
    rec('r1', 'AA-1|' + PN, 'repair', 50, isoAgo(3))
  ], STANDALONE);

  expect(await procsIn(page, 'wtPo'), 'กราฟ PO ต้องมีขั้นนับแยก').toContain('repair');
  expect(await procsIn(page, 'wtDaily'), 'กราฟยอดผลิตต้องมีขั้นนับแยก').toContain('repair');
  expect(await procsIn(page, 'wtWip'), 'กราฟยอดค้างต้องไม่มีขั้นนับแยก').not.toContain('repair');

  // ยอดของขั้นนับแยกต้องไม่ไปแตะยอดค้างของสาย — 400 ที่ผ่าน winding ต้องค้างหน้า assembly ครบ
  expect((await wipOf(page, 'assembly'))[13],
    'ยอดของขั้นนับแยกต้องไม่ถูกหักออกจากของที่ค้างหน้า Assembly').toBe(400);

  // และขั้นนับแยกต้องถูกนับในกราฟ PO จริง ไม่ใช่ได้แท่งศูนย์เพราะไม่มีข้อมูลของมัน
  const repairPo = await page.$$eval('#wtPo rect[data-proc="repair"] title',
    els => Number(els[0].textContent.split(': ')[1].replace(/[^0-9]/g, '')));
  expect(repairPo, 'ใบนี้ยังทำขั้นนับแยกไม่เสร็จ จึงต้องนับเป็น 1 ใบ').toBe(1);
});

test('จำนวน PO ต้องนับด้วยเกณฑ์เดียวกับ "ซ่อนที่เสร็จแล้ว" ของหน้าคีย์ยอดรายวัน', async ({ page }) => {
  /* เจ้าของสั่งให้เลขนี้ตรงกับจำนวนแถวที่ต้องกรอกจริง (9 พ.ย. 2026)
     เกณฑ์ของหน้านั้นคือ `cum >= orderQty` ถือว่าเสร็จ — ข้อนี้ยึดเกณฑ์เดียวกันเป๊ะ */
  await open(page, [
    order('DONE-1', 100, '2026-08-01T00:00:00.000Z'),   // winding ครบแล้ว
    order('PART-1', 100, '2026-08-01T00:00:00.000Z'),   // winding ยังไม่ครบ
    order('NONE-1', 100, '2026-08-01T00:00:00.000Z')    // ยังไม่เริ่ม
  ], [
    rec('d1', 'DONE-1|' + PN, 'winding', 100, isoAgo(3)),
    rec('p1', 'PART-1|' + PN, 'winding', 99, isoAgo(3))
  ]);

  const po = await page.$$eval('#wtPo rect[data-proc] title',
    els => Object.fromEntries(els.map(e => {
      const t = e.textContent;
      return [t.slice(0, t.indexOf(' ยังไม่เสร็จ')), Number(t.split(': ')[1].replace(/[^0-9]/g, ''))];
    })));
  expect(po['Winding/Trimming'], 'เหลือสองใบที่ยังทำ winding ไม่เสร็จ').toBe(2);
  expect(po['Assembly'], 'ยังไม่มีใครทำ assembly เลย ครบทั้งสามใบ').toBe(3);
});

test('ตัวกรอง Sub-Name ของแดชบอร์ดต้องคุมทั้งสามกราฟ', async ({ page }) => {
  const a = order('AA-1', 1000, '2026-08-01T00:00:00.000Z');
  const b = Object.assign(order('BB-1', 500, '2026-08-01T00:00:00.000Z'), { subName: 'TUE-H' });
  await open(page, [a, b]);
  expect((await wipOf(page, 'winding'))[13], 'ยังไม่กรอง = ทั้งสองหน่วย').toBe(1500);

  // ช่องกรองอยู่ในแท็บแดชบอร์ด (Sub-Name คุมทั้งหน้ามาตั้งแต่ 8 ก.ย. 2026) ต้องไปเปลี่ยนที่นั่น
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.selectOption('#dashSubFilter', 'TUE-U');
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(350);
  expect((await wipOf(page, 'winding'))[13], 'กรองแล้วต้องเหลือหน่วยเดียว').toBe(1000);
});

/* ───────── ช่วงยาว: รวมรายสัปดาห์ ───────── */

test('รวมรายสัปดาห์ต้องเอา "ค่าของวันสุดท้าย" ไม่ใช่ผลบวกทั้งสัปดาห์', async ({ page }) => {
  /* ⚠️ ยอดค้างเป็นของที่กองอยู่ ไม่ใช่ของที่ทำได้ · บวกเจ็ดวันเข้าด้วยกันได้เลขที่สูงกว่า
     ความจริงเจ็ดเท่าและไม่มีความหมายอะไรเลย · เปลี่ยนไปใช้ bucketWeekly() แล้วข้อนี้แดง */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  // ช่วงยาวกว่า CHART_DAILY_MAX (21 วัน) เพื่อบังคับให้รวมรายสัปดาห์
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.selectOption('#chartRange', 'custom');
  await page.fill('#chartFrom', isoAgo(60));
  await page.fill('#chartTo', isoAgo(0));
  await page.waitForTimeout(250);
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(350);

  await expect(page.locator('#wtCaption')).toContainText('รวมรายสัปดาห์');
  const vals = await wipOf(page, 'winding');
  expect(vals.length, 'ต้องยุบเหลือไม่กี่แท่ง ไม่ใช่ 61 แท่ง').toBeLessThan(15);
  expect(Math.max(...vals), 'ของค้างคงที่ 1,000 ทุกวัน รวมรายสัปดาห์แล้วต้องยังเป็น 1,000').toBe(1000);
});

/* ───────── หน้าจอ ───────── */

test('หน้านี้ต้องอ่านอย่างเดียว — ห้ามมีช่องกรอกใด ๆ', async ({ page }) => {
  /* กฎเดียวกับหน้ายอดรายวันทุกขั้น — คนที่เปิดมา "ดู" ต้องเปลี่ยนข้อมูลด้วยความบังเอิญไม่ได้ */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  expect(await page.locator('#view-wiptrend input, #view-wiptrend select, #view-wiptrend textarea,'
    + ' #view-wiptrend [contenteditable]').count()).toBe(0);
});

test('จอมือถือ — ต้องไม่ล้นแนวนอน', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  const recs = [];
  for (let d = 13; d >= 0; d--) recs.push(rec('w' + d, 'AA-1|' + PN, 'winding', 50, isoAgo(d)));
  await open(page, [order('AA-1', 5000, '2026-08-01T00:00:00.000Z')], recs);
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('ยังไม่มีใบสั่งเลย ต้องไม่พังและไม่มี NaN', async ({ page }) => {
  await open(page, [], []);
  const txt = await page.locator('#view-wiptrend').innerHTML();
  expect(txt).not.toContain('NaN');
  expect(txt).not.toContain('Infinity');
});
