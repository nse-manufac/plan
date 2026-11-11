// เทสหน้า "ยอดค้างรายวัน" — แท็บแยกที่เจ้าของสั่งเมื่อ 9 พ.ย. 2026
//
// ⚠️ สามกราฟบนหน้านี้ใช้ชุดขั้นไม่เท่ากันโดยตั้งใจ
//    PO และ ยอดผลิตรายวัน = ทุกขั้น · ยอดค้างรายวัน = เฉพาะขั้นในสาย (A3 · A5)
//    ถ้ามีใครทำให้ทั้งสามใช้ชุดเดียวกัน จะมีข้อหนึ่งในไฟล์นี้แดง

const { test, expect } = require('@playwright/test');
const { readSaved, waitReady } = require('./app-state');

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

test('ตัวกรอง Sub-Name ของหน้านี้เองต้องคุมทั้งหน้า ไม่ใช่แค่กราฟเดียว', async ({ page }) => {
  /* เจ้าของสั่ง 11 พ.ย. 2569 ให้ย้ายช่องมาไว้บนหน้านี้ ("ดูทีละ sub อยู่แล้ว")
     ⚠️ ต้องคุม **ทุกที่** — กราฟยอดค้าง · กราฟ PO · โดนัทสถานะเวลา
        ถ้าบางที่กรองบางที่ไม่กรอง คนเอาสองที่มาเทียบจะสรุปว่ายอดไม่ตรง ทั้งที่ทั้งคู่ถูก
        (หลักเดียวกับที่แดชบอร์ดถูกทำให้ทั้งหน้าใช้ค่าเดียวกันเมื่อ 8 ก.ย. 2026)
     ⚠️ ของแดชบอร์ดต้อง **ไม่** คุมหน้านี้อีกแล้ว ไม่งั้นมีสองช่องที่ขัดกันได้ */
  const a = order('AA-1', 1000, '2026-08-01T00:00:00.000Z');
  const b = Object.assign(order('BB-1', 500, '2026-08-01T00:00:00.000Z'), { subName: 'TUE-H' });
  await open(page, [a, b]);
  expect((await wipOf(page, 'winding'))[13], 'ยังไม่กรอง = ทั้งสองหน่วย').toBe(1500);
  const dueAll = await page.locator('#wtDue svg text').first().textContent();
  expect(dueAll, 'โดนัทต้องนับสองใบตอนยังไม่กรอง').toBe('2');

  await page.selectOption('#wtSubFilter', 'TUE-U');
  await page.waitForTimeout(300);
  expect((await wipOf(page, 'winding'))[13], 'กรองแล้วต้องเหลือหน่วยเดียว').toBe(1000);
  expect(await page.locator('#wtDue svg text').first().textContent(),
    'โดนัทต้องกรองตามด้วย ไม่ใช่ค้างที่ยอดรวม').toBe('1');
  expect(await page.locator('#wtPo rect[data-proc="winding"] title').textContent(),
    'กราฟ PO ต้องกรองตามด้วย').toContain('1 ใบ');

  // ของแดชบอร์ดต้องไม่มีผลกับหน้านี้แล้ว
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.selectOption('#dashSubFilter', 'TUE-H');
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(350);
  expect((await wipOf(page, 'winding'))[13], 'ต้องยังเป็นหน่วยที่เลือกไว้บนหน้านี้').toBe(1000);
});

/* ───────── ช่วงยาว: รวมรายสัปดาห์ ───────── */

test('รวมรายสัปดาห์ต้องเอา "ค่าของวันสุดท้าย" ไม่ใช่ผลบวกทั้งสัปดาห์', async ({ page }) => {
  /* ⚠️ ยอดค้างเป็นของที่กองอยู่ ไม่ใช่ของที่ทำได้ · บวกเจ็ดวันเข้าด้วยกันได้เลขที่สูงกว่า
     ความจริงเจ็ดเท่าและไม่มีความหมายอะไรเลย · เปลี่ยนไปใช้ bucketWeekly() แล้วข้อนี้แดง */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  // ช่วงยาวกว่า CHART_DAILY_MAX (21 วัน) เพื่อบังคับให้รวมรายสัปดาห์
  // ช่วงวันเป็นของ section นี้เอง ไม่ใช่ของแดชบอร์ดแล้ว (เจ้าของสั่ง 11 พ.ย. 2569)
  await page.fill('#wtWipFrom', isoAgo(60));
  await page.fill('#wtWipTo', isoAgo(0));
  await page.waitForTimeout(350);

  await expect(page.locator('#wtCaption')).toContainText('รวมรายสัปดาห์');
  const vals = await wipOf(page, 'winding');
  expect(vals.length, 'ต้องยุบเหลือไม่กี่แท่ง ไม่ใช่ 61 แท่ง').toBeLessThan(15);
  expect(Math.max(...vals), 'ของค้างคงที่ 1,000 ทุกวัน รวมรายสัปดาห์แล้วต้องยังเป็น 1,000').toBe(1000);
});

/* ───────── หน้าจอ ───────── */

test('หน้านี้ต้องไม่เขียนข้อมูล — เล่นตัวกรองทุกตัวแล้ว state ต้องไม่ขยับแม้แต่ตัวอักษร', async ({ page }) => {
  /* ⚠️ ข้อนี้เคยเขียนว่า "ห้ามมีช่องกรอกใด ๆ" ซึ่งใช้ไม่ได้แล้วตั้งแต่หน้านี้มีตัวกรองของตัวเอง
     (เจ้าของสั่ง 11 พ.ย. 2569) · **แต่เจตนาเดิมยังอยู่ครบและสำคัญกว่าเดิม**:
     คนที่เปิดมา "ดู" ต้องเปลี่ยนข้อมูลด้วยความบังเอิญไม่ได้
     สิ่งที่ต้องกันคือ "ช่องที่เขียนลง state" ไม่ใช่ "ช่องทุกชนิด" — ตัวกรองเปลี่ยนแค่สิ่งที่แสดง
     จึงเปลี่ยนมาวัดที่ state ตรง ๆ แบบเดียวกับเทสของหน้ายอดรายวันทุกขั้น
     ⚠️ ห้ามถอยกลับไปนับจำนวน input — มันเขียวได้ทั้งที่มีใครเผลอต่อช่องเข้ากับ saveState() */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z'),
    Object.assign(order('BB-1', 500, '2026-08-01T00:00:00.000Z'), { subName: 'TUE-H' })],
    [rec('r1', 'AA-1|' + PN, 'winding', 100, isoAgo(2))]);
  const before = JSON.stringify(await readSaved(page, K_STATE));

  await page.selectOption('#wtSubFilter', 'TUE-U');
  await page.click('.wtrng[data-rng="wip"] button[data-days="30"]');
  await page.click('.wtrng[data-rng="daily"] button[data-days="7"]');
  await page.fill('#wtWipFrom', isoAgo(40));
  await page.click('.wtseg button[data-view="wip"][data-mode="cards"]');
  await page.click('.wtseg button[data-view="daily"][data-mode="cards"]');
  await page.click('#wtWipLegend .legend-item >> nth=0');
  await page.waitForTimeout(400);

  expect(JSON.stringify(await readSaved(page, K_STATE)),
    'เล่นตัวกรองแล้วข้อมูลที่เก็บไว้ต้องเหมือนเดิมเป๊ะ').toBe(before);
});

test('ตารางและกราฟต้องไม่มีช่องกรอกข้อมูล — ตัวกรองเท่านั้นที่เป็นช่องได้', async ({ page }) => {
  /* กันคนเผลอเอาช่องคีย์ยอดมาใส่หน้าอ่านอย่างเดียว · ตัวกรองอยู่ใน .wtsub กับ .wtrng เท่านั้น */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  const n = await page.locator('#wtWip input, #wtWip select, #wtWip textarea, #wtWip [contenteditable],'
    + ' #wtDaily input, #wtDaily select, #wtDaily textarea, #wtDaily [contenteditable],'
    + ' #wtPo input, #wtPo select, #wtDue input, #wtDue select').count();
  expect(n, 'ในกราฟกับตารางต้องไม่มีช่องกรอก').toBe(0);
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

/* ───────── สิ่งที่ผู้ตรวจ #131 จับได้ ───────── */

test('G3 — สีของขั้นที่ซิงค์มาต้องแตก attribute ของแท่งไม่ได้', async ({ page }) => {
  /* ⚠️ สีของขั้นที่ไม่ใช่ห้าขั้นตั้งต้นมาจากรายการที่ซิงค์มา และ validProcessList() ไม่ตรวจช่อง color เลย
     ผู้ตรวจรันพิสูจน์บนใบนี้ว่า `#111" data-pwned="yes` ปิด attribute แล้วแทรกของใหม่ได้จริง
     ⚠️ ข้อนี้ไม่ได้ปิดรู CSS (`;background-image:url(...)`) ซึ่งต้องกรองที่ต้นทาง — เป็นใบแยกตาม CLAUDE.md */
  const evil = [
    { id: 'winding', label: 'Winding/Trimming' },
    { id: 'evil', label: 'ขั้นร้าย', short: 'ร้าย', color: '#111" data-pwned="yes' },
    { id: 'assembly', label: 'Assembly' },
    { id: 'support', label: 'Support' },
    { id: 'inspection', label: 'Inspection' },
    { id: 'shipping', label: 'ส่งของ (Shipping)' }
  ];
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')],
    [rec('e1', 'AA-1|' + PN, 'evil', 10, isoAgo(3))], evil);

  for (const box of ['wtPo', 'wtWip', 'wtDaily']) {
    expect(await page.locator(`#${box} [data-pwned]`).count(),
      box + ' ต้องไม่มี attribute ที่ถูกแทรกเข้ามา').toBe(0);
  }
});

test('ย่อหน้าต่างแล้วกราฟของหน้านี้ต้องวาดใหม่ ไม่ใช่ค้างความกว้างเดิม', async ({ page }) => {
  /* ⚠️ ตัวจับ resize ของเดิมดูแค่ #chartWrap · หน้านี้คิดความกว้างจากกล่องเหมือนกัน
     ไม่วาดใหม่แล้วหมุนมือถือหรือย่อหน้าต่างจะต้องเลื่อนจอดู ทั้งที่กราฟแดชบอร์ดไม่ต้อง */
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  const wide = await page.locator('#wtWip svg').getAttribute('width');

  await page.setViewportSize({ width: 420, height: 900 });
  await page.waitForTimeout(500);   // ตัวจับ resize หน่วง 150ms
  const narrow = await page.locator('#wtWip svg').getAttribute('width');
  expect(Number(narrow), `ย่อแล้วต้องแคบลง · กว้าง ${wide} → ${narrow}`).toBeLessThan(Number(wide));
});

test('ใบย้อนแย้งต้องมีแถบฟ้องบนหน้านี้ เพราะเลขจะไม่ตรงกับบัญชีของค้างบนแดชบอร์ด', async ({ page }) => {
  /* ⚠️ สองหน้าใช้สูตรต่างกันจริงเฉพาะใบย้อนแย้ง — หน้านี้ไล่ต่อเนื่องต่อใบ แดชบอร์ดลบที่ยอดรวม
     แดชบอร์ดมีแถบเหลืองฟ้องอยู่แล้ว ถ้าหน้านี้เงียบ คนที่เอาสองหน้ามาเทียบตอนเลือกว่าจะปิดอันไหน
     จะสรุปว่า "ยอดไม่ตรง" ทั้งที่ทั้งคู่ถูกในนิยามของตัวเอง (ผู้ตรวจ #131) */
  // ⚠️ เรียก open() สองครั้งในข้อเดียวไม่ได้ — addInitScript สะสม ตัวแรกจะหว่าน state เดิมคืนทุกครั้งที่โหลดหน้า
  await open(page, [order('BAD-1', 100, '2026-08-01T00:00:00.000Z')],
    [rec('a1', 'BAD-1|' + PN, 'assembly', 100, isoAgo(3))]);   // คีย์ assembly ทั้งที่ไม่เคยคีย์ winding
  // ⚠️ อ่าน display ตรง ๆ ไม่ใช่ toBeVisible() — กล่องว่างที่ยังถูกวาดอยู่ Playwright นับว่า "ซ่อน"
  //    ข้อนี้จึงเขียวทั้งที่แถบไม่เคยถูกซ่อนจริง (เจอตอน mutation ของใบนี้เอง)
  expect(await page.locator('#wtAnom').evaluate(el => getComputedStyle(el).display)).not.toBe('none');
  await expect(page.locator('#wtAnom')).toContainText('1 ใบ');
});

test('ไม่มีใบย้อนแย้ง แถบนั้นต้องไม่ขึ้น', async ({ page }) => {
  /* แถบที่ขึ้นตลอดเวลาคือแถบที่ไม่มีใครอ่าน — หลักเดียวกับแถบส่งของไม่ได้ของหน้าคีย์ยอด */
  await open(page, [order('OK-1', 100, '2026-08-01T00:00:00.000Z')],
    [rec('w1', 'OK-1|' + PN, 'winding', 50, isoAgo(3))]);
  expect(await page.locator('#wtAnom').evaluate(el => getComputedStyle(el).display),
    'แถบที่ขึ้นตลอดเวลาคือแถบที่ไม่มีใครอ่าน').toBe('none');
});

test('แถบฟ้องต้องบอกว่าแถบบนแดชบอร์ดนับคนละชุด ไม่งั้นส่งคนไปหาใบที่หาไม่เจอ', async ({ page }) => {
  /* ⚠️ แถบบนแดชบอร์ดนับจาก dashFilteredRows() ซึ่งติ๊ก "ซ่อนงานที่ส่งของครบแล้ว" ไว้เป็นค่าตั้งต้น
     ส่วนแถบนี้นับทุกใบที่ยังไม่ยกเลิก · ผู้ตรวจรันวัดได้ว่าหน้าใหม่ขึ้น 1 ใบ ขณะที่แดชบอร์ดไม่มีแถบเลย
     แถบที่ชี้ไปหาของที่หาไม่เจอ เป็นอาการเดียวกับที่แถบนี้มาเพื่อป้องกัน (ผู้ตรวจ #131 รอบ 2) */
  await open(page, [order('BAD-1', 100, '2026-08-01T00:00:00.000Z')],
    [rec('a1', 'BAD-1|' + PN, 'assembly', 100, isoAgo(3))]);
  const t = await page.locator('#wtAnom').innerText();
  expect(t, 'ต้องบอกว่าแดชบอร์ดคิดคนละเกณฑ์ จึงได้คนละเลข').toContain('ได้เลขต่างจากหน้านี้');

  /* ⚠️ ข้อนี้เคยบังคับให้แถบเขียนว่า "ไล่ดูรายใบได้ที่แดชบอร์ด" เพราะหน้านี้กางรายการไม่ได้
     เจ้าของสั่งให้กางได้ในหน้านี้เมื่อ 11 พ.ย. 2569 ประโยคนั้นจึงกลายเป็นการส่งคนไปผิดที่
     สิ่งที่ต้องคุมแทนคือ **กางแล้วเห็นใบจริง** ซึ่งเป็นหลักประกันที่แรงกว่าเดิม */
  await page.click('#wtAnomToggle');
  await page.waitForTimeout(250);
  await expect(page.locator('#wtAnom .wanl'), 'กางแล้วต้องมีรายการ').toBeVisible();
  await expect(page.locator('#wtAnom .wanl')).toContainText('BAD-1');
});

/* ⚠️ **ต้องตรึงโซนเวลาไว้ที่กรุงเทพ ห้ามพึ่งโซนเวลาของเครื่องที่รัน**
   CI รันใน UTC ซึ่งเป็นโซนที่อาการนี้ไม่เกิดเลย · ฉบับแรกของข้อนี้ใช้ test.skip() เมื่ออยู่ UTC
   ผลคือ **ข้ามทุกครั้งบน CI** ท่อจึงไม่คุ้มครองอะไร (ผู้ตรวจ #131 รอบ 3 จับได้)
   ตรึงที่ Asia/Bangkok แล้วมันคุมได้จริงทุกเครื่อง และตรงกับโซนเวลาของหน้างานด้วย */
test.describe('โซนเวลาหน้างาน', () => {
  test.use({ timezoneId: 'Asia/Bangkok' });

  test('importedAt เป็นเวลา UTC ต้องแปลงเป็นวันตามปฏิทินของเครื่องก่อนเทียบ', async ({ page }) => {
    /* ⚠️ ไทยเป็น UTC+7 · ใบที่นำเข้าตอน 06:30 เช้าวันนี้ตามเวลาไทย = 23:30 UTC ของเมื่อวาน
       ตัดสิบตัวแรกตรง ๆ จะได้วันของเมื่อวาน แล้วใบโผล่ในกราฟเร็วกว่าจริงหนึ่งวัน
       ⚠️ วันที่ทั้งหมดต้องคิดจากนาฬิกา**ในเบราว์เซอร์** ไม่ใช่ของ node ที่รันเทส
          สองอันนี้คนละโซนเวลากันแล้ว ตั้งแต่ตรึง timezoneId */
    const [today, twoAgo, utcIso] = await page.evaluate(() => {
      const p = n => String(n).padStart(2, '0');
      const day = d => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      const now = new Date();
      const back = n => { const d = new Date(); d.setDate(d.getDate() - n); return day(d); };
      // 23:30 UTC ของวันก่อนหน้า = 06:30 เช้าวันนี้ตามเวลาไทย
      const utc = new Date(back(1) + 'T23:30:00.000Z');
      return [day(now), back(2), utc.toISOString()];
    });
    expect(utcIso.slice(0, 10), 'ฉากนี้ต้องเป็นฉากที่วัน UTC ไม่ตรงกับวันของเครื่อง').not.toBe(today);

    await open(page, [
      order('OLD-1', 300, '2026-08-01T00:00:00.000Z'),
      order('NEW-1', 700, utcIso)
    ]);
    const vals = await wipOf(page, 'winding');
    // ช่วง 14 วัน: index 12 = เมื่อวาน (วันตาม UTC) · index 13 = วันนี้ (วันตามปฏิทินไทย)
    expect(vals[12], 'วัน UTC ของ timestamp — ใบใหม่ยังไม่ควรมา').toBe(300);
    expect(vals[13], 'วันตามปฏิทินเครื่อง — ใบใหม่ต้องมาวันนี้').toBe(1000);
    expect(twoAgo).toBeTruthy();
  });
});

test('กราฟยอดค้างกับกราฟยอดผลิตต้องไม่ขัดกันเอง เมื่อ importedAt ใหม่กว่ายอดที่คีย์ไว้', async ({ page }) => {
  /* ⚠️ เครื่องที่สองนำเข้าไฟล์แผนเองก่อนเคยซิงค์ใบนั้นลงมา จะได้ importedAt เป็นวันนี้
     แล้ว push ทับทุกเครื่อง · ใบนั้นจึงมียอดที่คีย์ไว้เมื่อห้าวันก่อน แต่ importedAt เป็นวันนี้
     ถ้ายึด importedAt อย่างเดียว กราฟยอดค้างขึ้นศูนย์ทั้งแถบ ขณะที่กราฟยอดผลิตข้างล่าง
     ขึ้นยอดของวันนั้น = สองกราฟที่วางคู่กันมาเพื่ออ่านด้วยกัน ขัดกันเอง (ผู้ตรวจ #131 รอบ 5) */
  await open(page, [order('AA-1', 1000, new Date().toISOString())],
    [rec('w1', 'AA-1|' + PN, 'winding', 300, isoAgo(5))]);

  // ช่วง 14 วัน: index = 13 − (จำนวนวันที่ย้อนหลัง) · record อยู่ที่ isoAgo(5) = index 8
  const vals = await wipOf(page, 'winding');
  expect(vals[8], 'วันที่กราฟยอดผลิตขึ้น 300 กราฟยอดค้างต้องขึ้นด้วย ไม่ใช่ยังเป็นศูนย์').toBe(700);
  expect(vals[13], 'และค้างอยู่อย่างนั้นจนวันนี้').toBe(700);
  /* ⚠️ ก่อนวันที่มี record ยังเป็นศูนย์ และนั่นถูก — ไม่มีหลักฐานว่าใบนี้มีอยู่ตอนนั้น
     กฎคือ "วันที่นำเข้า หรือวันของ record แรกสุด แล้วแต่อันไหนก่อน" ไม่ใช่ "ย้อนไปตลอดกาล" */
  expect(vals[7], 'ก่อนหน้านั้นยังไม่มีหลักฐานว่าใบนี้มีอยู่').toBe(0);
});

test('C1 ยังอยู่ — ใบที่เพิ่งนำเข้าและยังไม่เคยคีย์อะไร ต้องไม่โผล่ย้อนหลัง', async ({ page }) => {
  /* ⚠️ ด่าน C1 ต้องไม่ถูกปลดไปพร้อมกับการแก้ข้างบน · ใบที่ไม่มี record เลย ยังยึด importedAt เหมือนเดิม */
  await open(page, [
    order('OLD-1', 300, '2026-08-01T00:00:00.000Z'),
    order('NEW-1', 700, isoAgo(2) + 'T00:00:00.000Z')
  ]);
  const vals = await wipOf(page, 'winding');
  expect(vals[10], 'ใบใหม่ที่ยังไม่เคยคีย์อะไร ต้องไม่โผล่ก่อนวันนำเข้า').toBe(300);
  expect(vals[11]).toBe(1000);
});

test('นาฬิกาเครื่องอื่นล้ำ ทำให้ importedAt เป็นวันหน้า ใบนั้นต้องไม่หายจากกราฟ', async ({ page }) => {
  /* ⚠️ เครื่องที่นาฬิกาล้ำแล้วนำเข้าไฟล์แผน จะได้ importedAt เป็นวันหน้า แล้ว push ทับทุกเครื่อง
     ถ้าไม่ครอบที่วันนี้ ใบนั้นหายจากกราฟทั้งแถบรวมวันนี้ ขณะที่หัวเลข "ยังไม่ได้ส่ง" บนแดชบอร์ด
     ยังนับมันอยู่ — เป็นคู่เลขที่เจ้าของจะเอามาเทียบตอนเลือกว่าจะเก็บหน้าไหน (ผู้ตรวจ #131 รอบ 6) */
  const future = new Date();
  future.setDate(future.getDate() + 3);
  await open(page, [
    order('OLD-1', 300, '2026-08-01T00:00:00.000Z'),
    order('AHEAD-1', 700, future.toISOString())
  ]);
  const vals = await wipOf(page, 'winding');
  expect(vals[13], 'วันนี้ต้องนับใบที่ importedAt ล้ำไปข้างหน้าด้วย').toBe(1000);
  /* ⚠️ ครอบที่ "วันนี้" ไม่ใช่ย้อนไปตลอดกาล — เราไม่รู้ว่าจริง ๆ ใบนี้ถูกนำเข้าเมื่อไหร่
     รู้แค่ว่าอย่างช้าที่สุดคือวันนี้ · เมื่อวานจึงยังเป็น 300 และนั่นถูก */
  expect(vals[12], 'เมื่อวานยังไม่มีหลักฐานว่าใบนี้มีอยู่').toBe(300);
});

/* ───────── ช่วงวันแยกของแต่ละ section (เจ้าของสั่ง 11 พ.ย. 2569) ───────── */

const dailyOf = (page, proc) => page.$$eval(`#wtDaily rect[data-proc="${proc}"] title`,
  els => els.map(e => Number(e.textContent.split(': ').pop().replace(/,/g, ''))));

test('ยอดผลิตรวมรายสัปดาห์ต้องเป็น "ผลบวก" — คนละสูตรกับยอดค้าง', async ({ page }) => {
  /* 🚨 ข้อนี้กับข้อ "ยอดค้างต้องเอาค่าของวันสุดท้าย" เป็นคู่กัน และต้องมีทั้งคู่
     ถ้ามีใครทำให้สองกราฟใช้สูตรเดียวกัน จะมีข้อหนึ่งในสองข้อนี้แดงเสมอ
     ยอดผลิตเป็น "ของที่ทำได้" จึงบวกได้ · ยอดค้างเป็น "ของที่กองอยู่" บวกแล้วสูงเกินจริงเจ็ดเท่า */
  const recs = [];
  for (let d = 59; d >= 0; d--) recs.push(rec('w' + d, 'AA-1|' + PN, 'winding', 10, isoAgo(d)));
  await open(page, [order('AA-1', 100000, '2026-01-01T00:00:00.000Z')], recs);
  await page.fill('#wtDailyFrom', isoAgo(60));
  await page.fill('#wtDailyTo', isoAgo(0));
  await page.waitForTimeout(350);

  await expect(page.locator('#wtDailyCaption')).toContainText('รวมรายสัปดาห์');
  const vals = await dailyOf(page, 'winding');
  expect(vals.length, 'ต้องยุบเหลือไม่กี่แท่ง').toBeLessThan(15);
  // คีย์วันละ 10 ทุกวัน · สัปดาห์เต็มต้องได้ 70 ไม่ใช่ 10
  expect(Math.max(...vals), 'สัปดาห์เต็ม = 7 วัน × 10 = 70').toBe(70);
});

test('ช่วงวันของสองกราฟล่างแยกกันจริง และต้องขึ้นแถบเตือนเมื่อตั้งไม่เท่ากัน', async ({ page }) => {
  /* ⚠️ สองกราฟนี้ถูกวางคู่กันเพื่อ "กวาดตาลงมาอ่านทีละวัน" — ตั้งช่วงไม่เท่ากันแล้วคอลัมน์ไม่ตรงกัน
     การอ่านคู่กันกลายเป็นการอ่านผิด · แถบเตือนจึงเป็นส่วนหนึ่งของฟีเจอร์ ไม่ใช่ของแต่ง */
  await open(page, [order('AA-1', 1000, '2026-01-01T00:00:00.000Z')]);
  await expect(page.locator('#wtDiff'), 'ตั้งต้นสองช่วงเท่ากัน ต้องไม่มีแถบ').toBeHidden();

  await page.click('.wtrng[data-rng="daily"] button[data-days="30"]');
  await page.waitForTimeout(300);
  await expect(page.locator('#wtDiff'), 'ตั้งไม่เท่ากันต้องฟ้อง').toBeVisible();
  await expect(page.locator('#wtDiff')).toContainText('ไม่เท่ากัน');
  expect(await page.locator('#wtCaption').innerText(), 'กราฟยอดค้างต้องยังเป็น 14 วัน').toContain('14 วัน');
  expect(await page.locator('#wtDailyCaption').innerText(), 'กราฟยอดผลิตต้องเป็น 30 วัน').toContain('30 วัน');

  await page.click('.wtrng[data-rng="wip"] button[data-days="30"]');
  await page.waitForTimeout(300);
  await expect(page.locator('#wtDiff'), 'ตั้งกลับให้เท่ากันแล้วแถบต้องหายเอง').toBeHidden();
});

test('ช่วงวันกลับข้างต้องฟ้อง ไม่ใช่โชว์กราฟว่าง', async ({ page }) => {
  /* กราฟว่างเฉย ๆ อ่านได้ว่า "ช่วงนี้ไม่มีใครทำอะไร" ซึ่งคนละเรื่องกับ "ช่วงที่ไม่มีอยู่จริง" */
  await open(page, [order('AA-1', 1000, '2026-01-01T00:00:00.000Z')]);
  await page.fill('#wtWipFrom', isoAgo(2));
  await page.fill('#wtWipTo', isoAgo(20));
  await page.waitForTimeout(300);
  await expect(page.locator('#wtWip')).toContainText('กลับข้าง');
});

/* ───────── ป้ายตัวเลขตอนเอาเมาส์ชี้ ───────── */

test('<title> ของแท่งต้องยังอยู่ แต่แท่งต้องไม่รับเมาส์ ไม่งั้นป้ายของเบราว์เซอร์มาแข่ง', async ({ page }) => {
  /* ⚠️ <title> คือชื่อสำหรับโปรแกรมอ่านหน้าจอ และเทสทั้งไฟล์นี้อ่านค่าจริงจากตรงนั้น — ห้ามถอด
     ที่กันไม่ให้มันโผล่มาแข่งกับป้ายของเราคือ pointer-events:none บนแท่ง
     ถอด CSS บรรทัดนั้นออกแล้วข้อนี้แดง (ลองแล้ว) */
  const recs = [];
  for (let d = 5; d >= 0; d--) recs.push(rec('w' + d, 'AA-1|' + PN, 'winding', 10, isoAgo(d)));
  await open(page, [order('AA-1', 1000, '2026-01-01T00:00:00.000Z')], recs);
  expect(await page.locator('#wtWip rect[data-proc="winding"] title').count(),
    '<title> ต้องยังอยู่ทุกแท่ง').toBeGreaterThan(0);
  const pe = await page.locator('#wtWip rect[data-proc="winding"]').first()
    .evaluate(el => getComputedStyle(el).pointerEvents);
  expect(pe, 'แท่งต้องไม่รับเมาส์').toBe('none');
});

test('ชี้ที่กราฟแล้วต้องมีป้ายตัวเลขขึ้น และบอกทุกขั้นของวันนั้น', async ({ page }) => {
  /* เจ้าของขอ "ตัวเลขตัวใหญ่ ๆ ให้คนแก่อ่านง่าย" · ช่องรับเมาส์เป็นทั้งคอลัมน์ของวัน
     ไม่ใช่ทีละแท่ง เพราะแท่งกว้างไม่กี่พิกเซล จิ้มไม่โดน */
  const recs = [];
  for (let d = 5; d >= 0; d--) recs.push(rec('w' + d, 'AA-1|' + PN, 'winding', 10, isoAgo(d)));
  await open(page, [order('AA-1', 1000, '2026-01-01T00:00:00.000Z')], recs);
  await expect(page.locator('#wtTip')).toBeHidden();

  const hit = page.locator('#wtWip rect.wthit').last();
  /* ⚠️ ต้องชี้สองครั้ง — ครั้งแรก Playwright เลื่อนหน้าให้เห็นก่อน แล้วเหตุการณ์ scroll
     ที่ตามมาทีหลังจะสั่งซ่อนป้าย (ซึ่งถูกแล้ว ป้ายเป็น position:fixed ถ้าไม่ซ่อนจะลอยหลุดจากแท่ง) */
  await hit.hover();
  await page.waitForTimeout(150);
  await hit.hover();
  await page.waitForTimeout(150);
  await expect(page.locator('#wtTip'), 'ชี้แล้วต้องมีป้าย').toBeVisible();
  const txt = await page.locator('#wtTip').innerText();
  expect(txt, 'ต้องบอกทุกขั้นที่กราฟนั้นวาด ไม่ใช่ขั้นเดียว').toContain('Winding');
  expect(txt, 'ต้องบอกหน่วย').toContain('ชิ้น');
});

/* ───────── โดนัทสถานะเวลา ───────── */

test('โดนัทต้องแบ่งตามสถานะเวลา ไม่ใช่ตามขั้น — ขั้นเดียวกันจะได้ไม่มีเลขสองตัว', async ({ page }) => {
  /* 🔒 เจ้าของทักเอง 11 พ.ย. 2569: ถ้าแบ่งตามขั้น Trimming จะขึ้นเลขหนึ่งที่กราฟแท่ง
     และอีกเลขหนึ่งที่โดนัท คนที่ไม่ได้อ่านคำกำกับจะสรุปว่า "ยอดไม่ตรง" แล้วเลิกเชื่อทั้งหน้า
     ⚠️ ข้อนี้คุมไว้ว่าฝั่งขวาต้องไม่มีชื่อขั้นโผล่เป็นยอดรวม — เปลี่ยนกลับไปแบ่งตามขั้นแล้วแดง */
  await open(page, [order('AA-1', 1000, '2026-01-01T00:00:00.000Z')]);
  const right = await page.locator('#wtDueList').innerText();
  for (const s of ['Winding', 'Assembly', 'Support', 'Inspection']) {
    expect(right, `ฝั่งขวาต้องไม่มีชื่อขั้น "${s}" เป็นยอดรวม`).not.toContain(s);
  }
  expect(right, 'ต้องแบ่งตามสถานะเวลา (A5)').toContain('ล่าช้า');

  /* 🚨 ห้ามกลับไปยืนยันว่า "เลขกลางวง >= ทุกแท่งทางซ้าย" — **ไม่จริง**
     โดนัทนับใบที่ยังส่งของไม่ครบ ส่วนแท่งนับรายขั้นของทุกใบรวมใบที่ส่งครบแล้ว
     ผู้ตรวจ #132 รันสองฉากที่กลางวงเป็น 0 ขณะที่แท่งเป็น 1 · เทสเดิมเขียวเพราะ fixture สะอาด
     จึงให้ความมั่นใจเกินจริง ซึ่งอันตรายกว่าไม่มีเทส · ที่ต้องคุมคือ **ข้อความบนจอต้องไม่ชวนให้เทียบ** */
  const desc = await page.locator('#view-wiptrend .wtpair section').nth(1).locator('.desc').innerText();
  expect(desc, 'ต้องบอกว่าไม่ใช่ชุดใบเดียวกับแท่งทางซ้าย').toContain('ไม่ใช่ชุดใบเดียวกับแท่งทางซ้าย');
  expect(desc, 'ต้องไม่สัญญาว่าเอามาเทียบกันได้').not.toContain('มากกว่าหรือเท่ากับทุกแท่ง');
});

/* ───────── ของที่ผู้ตรวจ #132 จับได้ — ทุกข้อพิสูจน์แล้วว่าแดงถ้าถอดการแก้ออก ───────── */

test('กดเลข PO ในรายการย้อนแย้ง ต้องพาไปหน้าแก้ไขรายการของใบนั้นจริง', async ({ page }) => {
  /* 🚨 `anomalyListHtml()` วาดปุ่มที่มี title สัญญาว่าจะพาไป แต่ตัวจับคลิกของแดชบอร์ด
     ผูกกับ #wipCards เท่านั้น · กล่องของหน้านี้ต้องผูกเอง
     ไม่ผูก = ปุ่มหน้าตาเป็นลิงก์ที่กดแล้วเงียบ ซึ่งลบล้างข้อ "ตามต่อได้" ที่เป็นเหตุผลของแถบนี้ */
  await open(page, [order('BAD-1', 1000, '2026-08-01T00:00:00.000Z')],
    [rec('a1', 'BAD-1|' + PN, 'assembly', 100, isoAgo(3))]);
  await page.click('#wtAnomToggle');
  await page.waitForTimeout(200);
  await page.click('#wtAnom [data-anom-po]');
  await page.waitForTimeout(300);

  // หน้าแก้ไขรายการอยู่ในแท็บเดียวกับหน้าคีย์ยอด (#view-entry)
  expect(await page.locator('#view-entry').getAttribute('class'),
    'ต้องสลับไปแท็บที่มีหน้าแก้ไขรายการ').toContain('active');
  expect(await page.inputValue('#recFilterSearch'),
    'ต้องใส่เลข PO ลงช่องค้นหาให้ด้วย').toBe('BAD-1');
});

test('G3 — สีขั้นที่ซิงค์มาต้องแตก attribute ในป้ายตอนเอาเมาส์ชี้ไม่ได้', async ({ page }) => {
  /* ⚠️ ค่าที่อ่านกลับจาก dataset เป็นค่าดิบ — ที่ escape ไว้ตอนเขียน attribute
     ถูกเบราว์เซอร์ถอดกลับให้แล้ว ต้อง escape ซ้ำตอนเอาลง innerHTML
     ผู้ตรวจ #132 รันพิสูจน์ว่าสคริปต์ทำงานจริง */
  const evil = [
    { id: 'winding', label: 'Winding/Trimming' },
    { id: 'evil', label: 'ขั้นร้าย', short: 'ร้าย', color: '#111"><b data-pwned="yes"></b><i x="' },
    { id: 'assembly', label: 'Assembly' },
    { id: 'support', label: 'Support' },
    { id: 'inspection', label: 'Inspection' },
    { id: 'shipping', label: 'ส่งของ (Shipping)' }
  ];
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')],
    [rec('e1', 'AA-1|' + PN, 'evil', 10, isoAgo(3))], evil);

  /* ⚠️ ต้องชี้ **แท่งของขั้นที่ใส่สีร้ายไว้** ไม่ใช่แท่งแรก — แท่งแรกคือ Winding ซึ่งสีปกติ
     ชี้ผิดแท่งแล้ว payload ไม่เคยถูกวาด เทสจะเขียวทั้งที่ถอดการแก้ออก (เจอเองตอนลองถอด) */
  const hit = page.locator('#wtPo rect.wthit[data-wt-name="ขั้นร้าย"]');
  await hit.hover();
  await page.waitForTimeout(150);
  await hit.hover();
  await page.waitForTimeout(150);
  expect(await page.locator('#wtTip [data-pwned]').count(),
    'ป้ายต้องไม่มี element ที่ถูกแทรกเข้ามา').toBe(0);
});

test('ปิดขั้นจนไม่เหลือสักขั้นไม่ได้ — ไม่งั้นปุ่มขีดฆ่าหมดแต่กราฟยังวาดครบ', async ({ page }) => {
  /* ด่านตกกลับใน wtProcs() กันกราฟเปล่าไว้ก็จริง แต่ทำให้จอขัดกับตัวเอง
     ทุกปุ่ม aria-pressed=false ขณะที่กราฟยังวาดครบทุกขั้น (ผู้ตรวจ #132 รันเจอ) */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  const btns = page.locator('#wtWipLegend .legend-item');
  const n = await btns.count();
  for (let i = 0; i < n; i++) { await btns.nth(i).click(); await page.waitForTimeout(80); }

  const onCount = await page.locator('#wtWipLegend .legend-item[aria-pressed="true"]').count();
  expect(onCount, 'ต้องเหลือเปิดอยู่อย่างน้อยหนึ่งขั้น').toBeGreaterThanOrEqual(1);
  const drawn = await procsIn(page, 'wtWip');
  expect(drawn.length, 'จำนวนขั้นที่วาดต้องตรงกับจำนวนปุ่มที่ยังเปิดอยู่').toBe(onCount);
});

test('รายการย้อนแย้งต้องได้เต็มความกว้างของแถบ ไม่ใช่เศษที่เหลือจากข้อความข้าง ๆ', async ({ page }) => {
  /* แถบเป็น flex แนวนอน · รายการที่ต่อเข้าไปข้างในจะกลายเป็น flex item ที่ถูกบีบ
     ผู้ตรวจ #132 วัดได้ 247px ที่จอ 800 (= จอ 1024 ซูม 125% ซึ่งหน้างานตั้งจริง) เหลือเห็น 2 จาก 7 คอลัมน์ */
  await page.setViewportSize({ width: 800, height: 900 });
  await open(page, [order('BAD-1', 1000, '2026-08-01T00:00:00.000Z')],
    [rec('a1', 'BAD-1|' + PN, 'assembly', 100, isoAgo(3))]);
  await page.click('#wtAnomToggle');
  await page.waitForTimeout(250);
  const [outer, inner] = await page.evaluate(() => {
    const a = document.getElementById('wtAnom'), l = a.querySelector('.wanl');
    return [a.clientWidth, l ? l.clientWidth : 0];
  });
  expect(inner, 'ต้องได้เกือบเต็มความกว้างของแถบ').toBeGreaterThan(outer * 0.9);
});

test('แถวในกล่องใบที่ล่าช้าต้องอ่านได้ครบที่จอ 1024 — P/N ห้ามเบียด “ค้างที่” หาย', async ({ page }) => {
  /* 🚨 ก่อนแก้ แถวเป็นสามคอลัมน์ `auto 1fr auto` และ PO กับจำนวนวันเป็น nowrap ทั้งคู่
     ช่องกลางจึงเป็นช่องเดียวที่ยอมหาย · พอเติม P/N เข้าไป "ค้างที่ <ขั้น>" ก็ถูกตัดหาย
     ผู้ตรวจ #132 รอบ 11 วัดที่ viewport 1024 (จอหน้างาน): ช่องมี 199px แต่ต้องใช้ 207–268px
     ไม่มี title และไม่มีแถบเลื่อน จึงอ่านส่วนที่หายไม่ได้เลย
     ⚠️ ช่วงที่โดนคือ ~900–1100px เท่านั้น — ต่ำกว่า 900 ตกเป็นคอลัมน์เดียว · 1440 กว้างพอ
        ฉากนี้จึงต้องตั้ง viewport ที่ 1024 เป๊ะ ไม่งั้นเขียวเองโดยไม่ได้ตรวจอะไร
     ⚠️ P/N ของ fixture ยาว 10 ตัว ซึ่งเป็นความยาวของ P/N จริงในชุดเทสนี้ */
  await page.setViewportSize({ width: 1024, height: 900 });
  // รหัส PO ของจริงยาว ~10 ตัว ไม่ใช่ AA-1 — PO สั้นทำให้เหลือที่พอ แล้วเทสเขียวเองโดยไม่ได้ตรวจอะไร
  const o = Object.assign(order('TM5201U101', 100, '2026-01-01T00:00:00.000Z'), { orderDate: isoAgo(30) });
  await open(page, [o]);

  /* ⚠️ วัด **โครงสร้าง** ไม่ใช่แค่ "ถูกตัดไหม" — การถูกตัดขึ้นกับความยาวของ P/N · รหัส PO
     และชื่อขั้น ซึ่งตั้งเองได้ทั้งหมด · fixture ที่สั้นพอดีจะเขียวเองทั้งที่โครงยังผิด (เจอเองตอนเขียน)
     สิ่งที่ต้องคุมคือ "บรรทัดล่างกินเต็มแถวของตัวเอง" ซึ่งทำให้ไม่มีอะไรมาแย่งที่ได้เลย */
  const m = await page.locator('#wtLate .wtlr').first().evaluate(row => {
    const wh = row.querySelector('.wh'), po = row.querySelector('.po');
    return { txt: wh.textContent, title: wh.getAttribute('title'),
      clipped: wh.scrollWidth > wh.clientWidth + 1,
      ownLine: wh.getBoundingClientRect().top > po.getBoundingClientRect().top + 2,
      fullWidth: wh.getBoundingClientRect().width > row.getBoundingClientRect().width - 2 };
  });
  expect(m.txt, 'ต้องมี P/N').toContain(PN);
  expect(m.txt, 'ต้องมี "ค้างที่" ครบ').toContain('ค้างที่ Winding');
  expect(m.ownLine, 'ต้องอยู่บรรทัดของตัวเอง ไม่แย่งที่กับ PO และจำนวนวัน').toBe(true);
  expect(m.fullWidth, 'ต้องกินเต็มความกว้างของแถว').toBe(true);
  expect(m.clipped, 'ข้อความต้องไม่ถูกตัด').toBe(false);
  expect(m.title, 'ต้องมี title เป็นตาข่ายชั้นสอง').toBe(m.txt);
});

test('กราฟ PO ต้องเห็นครบทุกขั้นในกรอบที่จอ 1024 แม้มีเจ็ดขั้น', async ({ page }) => {
  /* ⚠️ ใบนี้ย่อกราฟเหลือครึ่งจอตามที่เจ้าของสั่ง กล่องจึงเหลือ ~455px
     ของเดิมกินช่องละ 110px → 7 ขั้นกิน 770px แล้ว Inspection กับ ส่งของ **อยู่นอกกรอบตั้งแต่เปิดมา**
     มีแถบเลื่อนให้ก็จริง แต่กราฟนี้เป็นภาพนิ่งที่มีไว้กวาดตาครั้งเดียวของคนอ่านอายุ 60+
     และแท่งส่งของคือแท่งที่ตอบว่ายังส่งไม่ครบกี่ใบ (ผู้ตรวจ #132 รอบ 8 วัดได้ 770 ใน 462)
     ⚠️ ต้องตรวจป้ายทับกันด้วย — ลดความกว้างอย่างเดียวแล้วชื่อเต็มจะทับช่องข้าง ๆ แทน
        (เจอเองตอนวัด จึงเปลี่ยนแกนไปใช้ชื่อสั้น · ชื่อเต็มยังอยู่ที่คำอธิบายสีและป้ายตอนชี้)
     ⚠️ สายการผลิตจริงมี 7 ขั้น (ห้าขั้นตั้งต้น + Core Grinding + Trimming ที่เจ้าของเพิ่มเอง)
        ฉาก 5 ขั้นไม่พอจับ เพราะยังอยู่ในกรอบแม้คิดช่องละ 110px */
  await page.setViewportSize({ width: 1024, height: 900 });
  const seven = [
    { id: 'core_grinding', label: 'CORE GRINDING', short: 'Core', hidden: false, icon: '🔹', color: '#8e24aa' },
    { id: 'winding', label: 'Winding/Trimming', short: 'Winding', hidden: false },
    { id: 'trimming', label: 'Trimming', short: 'Trim', hidden: false, icon: '🔹', color: '#008300' },
    { id: 'assembly', label: 'Assembly', short: 'Assembly', hidden: false },
    { id: 'support', label: 'Support', short: 'Support', hidden: false },
    { id: 'inspection', label: 'Inspection', short: 'Inspection', hidden: false },
    { id: 'shipping', label: 'ส่งของ (Shipping)', short: 'Shipping', hidden: false }
  ];
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')], [], seven);

  const m = await page.evaluate(() => {
    const box = document.getElementById('wtPo'), svg = box.querySelector('svg');
    const br = box.getBoundingClientRect();
    const t = [...svg.querySelectorAll('text')].map(e => ({ s: e.textContent, y: +e.getAttribute('y'), r: e.getBoundingClientRect() }));
    const maxY = Math.max(...t.map(x => x.y));
    const axis = t.filter(x => x.y === maxY).sort((a, b) => a.r.left - b.r.left);
    let overlap = 0;
    for (let i = 1; i < axis.length; i++) if (axis[i].r.left < axis[i - 1].r.right - 0.5) overlap++;
    return { n: axis.length, overlap, scroll: box.scrollWidth - box.clientWidth,
      inside: axis.every(x => x.r.left >= br.left - 1 && x.r.right <= br.right + 1) };
  });
  expect(m.n, 'ต้องมีป้ายครบเจ็ดขั้น').toBe(7);
  expect(m.scroll, 'ต้องไม่ต้องเลื่อนเพื่อดูให้ครบ').toBe(0);
  expect(m.inside, 'ทุกป้ายต้องอยู่ในกรอบ').toBe(true);
  expect(m.overlap, 'ป้ายต้องไม่ทับกัน').toBe(0);
});

test('รายการขั้นเปลี่ยนกลางทาง — คำอธิบายสีต้องไม่ขัดกับกราฟ', async ({ page }) => {
  /* 🚨 คำอธิบายสีวาดจาก wtHidden ส่วนกราฟวาดจากชุดที่ wtProcs() คืน · สองอย่างต้องตรงกันเสมอ
     ขั้นที่ถูกซ่อนจากแผงจัดการขั้นทีหลัง (มาทางซิงค์) จะค้างใน Set แล้วนับรวมในด่าน
     "ต้องเหลืออย่างน้อยหนึ่งขั้น" ทั้งที่ไม่มีขั้นนั้นอยู่จริง · และถ้าทุกขั้นที่เหลือถูกซ่อนหมด
     กราฟจะตกกลับไปวาดครบ ขณะที่ปุ่มขีดฆ่าทั้งแถว (ผู้ตรวจ #132 รอบ 6 รันเจอ)
     ⚠️ ฉากนี้ยัด wtHidden ตรง ๆ เพราะทางจริงต้องให้เครื่องอื่นซ่อนขั้นแล้วซิงค์มา
        ซึ่งจำลองในเทสหน้าเดียวไม่ได้ · สิ่งที่คุมคือ "จอต้องไม่ขัดกับตัวเอง" ไม่ใช่ทางที่มันเกิด */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  await page.evaluate(() => {
    MAIN_PROCESSES.forEach(p => wtHidden.wip.add(p));
    wtHidden.wip.add('ขั้นที่ไม่มีอยู่แล้ว');
    wtDrawSection('wip');
  });
  await page.waitForTimeout(200);

  const on = await page.locator('#wtWipLegend .legend-item[aria-pressed="true"]').count();
  const drawn = await procsIn(page, 'wtWip');
  expect(drawn.length, 'กราฟต้องวาดอย่างน้อยหนึ่งขั้น').toBeGreaterThan(0);
  expect(on, 'ปุ่มที่ "เปิด" ต้องเท่ากับจำนวนขั้นที่วาดจริง').toBe(drawn.length);
  expect(await page.evaluate(() => wtHidden.wip.has('ขั้นที่ไม่มีอยู่แล้ว')),
    'id ที่ไม่มีในรายการขั้นแล้วต้องถูกล้างออก').toBe(false);
});

test('การ์ดแยกรายขั้นต้องเลื่อนลงสุดให้ — คำกำกับเขียนว่าแถวล่างสุดคือล่าสุด', async ({ page }) => {
  /* ⚠️ การ์ดสูงได้ไม่เกิน 360px ช่วง 15–21 วันจึงล้น แล้วเปิดมาเห็นวันเก่าสุด
     ซึ่งขัดกับคำกำกับใต้การ์ด และต้องเลื่อนแยกทีละใบ (ผู้ตรวจ #132 รอบ 6 วัดได้ scrollTop 0)
     ปุ่มสำเร็จรูปไม่โดน (7/14 วันสั้นพอ · 30/90 วันกลายเป็นรายสัปดาห์) ช่องกรอกเองถึงจะโดน */
  const recs = [];
  for (let d = 20; d >= 0; d--) recs.push(rec('w' + d, 'AA-1|' + PN, 'winding', 10, isoAgo(d)));
  await open(page, [order('AA-1', 100000, '2026-01-01T00:00:00.000Z')], recs);
  await page.fill('#wtWipFrom', isoAgo(20));
  await page.fill('#wtWipTo', isoAgo(0));
  await page.click('.wtseg button[data-view="wip"][data-mode="cards"]');
  await page.waitForTimeout(300);

  const box = await page.locator('#wtWip .wtcard .rows').first()
    .evaluate(el => ({ st: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(box.sh, 'ฉากนี้ต้องล้นจริง ไม่งั้นข้อนี้ไม่ได้ตรวจอะไร').toBeGreaterThan(box.ch);
  expect(box.st, 'ต้องเลื่อนลงสุดให้แล้ว').toBeGreaterThan(box.sh - box.ch - 2);
});

test('กล่องใบที่ล่าช้าต้องเรียงจากล่าช้ามากไปน้อยจริง — ใบที่หนักสุดห้ามถูกเบียดออก', async ({ page }) => {
  /* 🚨 เลขบนแถวทำสองหน้าที่: แสดงผล **และ** เป็นกุญแจเรียง จึงต้องเทียบข้ามแถวได้
     ถ้านับจากกำหนดของ "ขั้นที่ทำให้ late" (ปลายน้ำสุด) แต่ละแถวจะนับจากฐานคนละอัน —
     ใบที่เลยกำหนดส่งแล้วเพิ่งเริ่มนับใหม่จาก 1 ส่วนใบที่เพิ่งเลยขั้นต้นน้ำโตได้ 6-7 วันเสมอ
     ผลคือกล่องเรียงกลับทางกับความจริง และกล่องตัดที่ 5 แถว ใบที่หนักสุดจึงหายไปทั้งใบ
     (ผู้ตรวจ #132 รอบ 5 รันพิสูจน์ · เป็นผลข้างเคียงของตัวแก้ในรอบ 4 เอง)
     ฉากนี้ลอกจากที่ผู้ตรวจรัน: สามใบไม่คีย์อะไรเลย อายุ 16 · 23 · 30 วัน */
  const mk = (po, days) => Object.assign(order(po, 100, '2026-01-01T00:00:00.000Z'), { orderDate: isoAgo(days) });
  await open(page, [mk('AA-1', 16), mk('DD-1', 23), mk('BB-1', 30)]);

  const pos = await page.$$eval('#wtLate .wtlr .po', els => els.map(e => e.textContent));
  expect(pos, 'ต้องเรียงใบที่ล่าช้านานสุดขึ้นก่อน').toEqual(['BB-1', 'DD-1', 'AA-1']);

  // กำหนดของ Winding คือ +10 วัน จึงเลยมา 20 · 13 · 6 วัน ตามลำดับ และเทียบกันได้ทุกแถว
  const days = await page.$$eval('#wtLate .wtlr .dd',
    els => els.map(e => Number((e.textContent.match(/มา\s*([\d,]+)\s*วัน/) || [])[1].replace(/,/g, ''))));
  expect(days, 'จำนวนวันต้องนับจากฐานเดียวกันทุกแถว').toEqual([20, 13, 6]);
});

test('กล่องใบที่ล่าช้าต้องบอก P/N — PO เดียวกันคนละ P/N ห้ามได้สองแถวที่อ่านเหมือนกันทุกตัวอักษร', async ({ page }) => {
  /* ผู้ตรวจ #132 รอบ 10 รันได้สองแถว `1001 · TUE-U · ค้างที่ Winding · เลยกำหนด Winding มา 89 วัน` ซ้ำกันเป๊ะ
     กล่องตัดที่ 5 แถว จึงเสียช่องไปกับของที่ดูเหมือนซ้ำ · กฎเดียวกับ data-anom-row = poNo|pn
     ⚠️ ฉากต้องเป็น PO เดียวกัน อายุเท่ากัน — ไม่งั้นช่องจำนวนวันต่างกันเอง แล้วเทสเขียวทั้งที่ไม่มี P/N */
  const mk = (pn) => Object.assign(order('SAME-1', 100, '2026-01-01T00:00:00.000Z'),
    { id: 'SAME-1|' + pn, pn, orderDate: isoAgo(30) });
  await open(page, [mk('PN-A'), mk('PN-B')]);

  const rows = await page.$$eval('#wtLate .wtlr', els => els.map(e => e.textContent));
  expect(rows.length, 'ต้องขึ้นทั้งสองใบ').toBe(2);
  expect(rows[0], 'สองแถวต้องแยกกันออกด้วยตา').not.toBe(rows[1]);
  expect(rows.join('\n')).toContain('PN-A');
  expect(rows.join('\n')).toContain('PN-B');
});

test('จำนวนวันในกล่องใบที่ล่าช้าต้องไม่ติดลบ — คิดจากกำหนดของขั้นที่ทำให้ล่าช้า ไม่ใช่กำหนดส่ง', async ({ page }) => {
  /* 🚨 ใบเข้ากล่องนี้ด้วยเกณฑ์ "ขั้นไหนขั้นหนึ่งเลยกำหนดของขั้นนั้น" (A5)
     ค่าตั้งต้นคือ winding 10 วัน · shipping 28 วัน จึงมีช่วง 18 วันที่ใบล่าช้าแล้ว
     แต่ยังไม่ถึงกำหนดส่ง · คิดจากกำหนดส่งแล้วได้ "เลยมา −13 วัน" (ผู้ตรวจ #132 รอบ 4)
     ⚠️ ฉากนี้ต้องเป็นใบที่ **ยังไม่ถึงกำหนดส่ง** ถึงจะจับได้ — ใบเก่ากว่า 28 วันเป็นบวกอยู่แล้ว
     ซึ่งเป็นเหตุผลที่สามรอบก่อนไม่เจอ */
  const o = Object.assign(order('AA-1', 100, '2026-01-01T00:00:00.000Z'), { orderDate: isoAgo(15) });
  await open(page, [o]);
  /* ⚠️ อ่านเฉพาะช่องจำนวนวัน ไม่ใช่ทั้งแถว — รหัส PO มีขีดอยู่ในตัว (AA-1)
     จับทั้งแถวแล้ว regex ติดลบจะแดงจากรหัส PO เอง (เจอเองตอนเขียนเทสนี้) */
  const dd = await page.locator('#wtLate .wtlr .dd').first().innerText();

  expect(dd, 'ต้องไม่มีเลขติดลบ').not.toMatch(/-\s*\d/);
  expect(dd, 'ต้องบอกว่าเลยกำหนดของขั้นไหน').toContain('เลยกำหนด Winding');
  // สั่งมา 15 วัน · กำหนดของ Winding คือ +10 วัน → เลยมา 5 วัน
  expect(dd, 'ต้องได้ 5 วัน').toContain('มา 5 วัน');
});

test('เปอร์เซ็นต์ในโดนัทต้องรวมได้ 100 — หน้านี้เขียนกำกับว่าผลรวมตรงกับเลขกลางวง', async ({ page }) => {
  /* ⚠️ ปัดทีละแถวแล้วรวมได้ 99 (3 ใบแบ่ง 3 ช่อง ได้ 33+33+33) บนหน้าที่เขียนว่า
     "รวม N ใบ — เท่ากับเลขกลางวงพอดี" จะกลายเป็นจอที่ขัดกับตัวเอง (ผู้ตรวจ #132 รอบ 3)
     ฉากนี้จงใจให้ได้ช่องละ 1 ใบพอดี ซึ่งเป็นฉากที่การปัดแบบเดิมพัง */
  const mk = (po, days) => Object.assign(order(po, 100, '2026-01-01T00:00:00.000Z'), { orderDate: isoAgo(days) });
  const late = mk('LATE-1', 40);          // เลยกำหนดส่งแล้ว
  const soon = mk('SOON-1', 26);          // ใกล้ครบกำหนด — ต้องคีย์ทุกขั้นครบ ไม่งั้นโดนตัดสินล่าช้าก่อน
  const okk  = mk('OK-1', 1);             // ยังมีเวลา
  const recs = ['winding', 'assembly', 'support', 'inspection']
    .map((p, i) => rec('s' + i, 'SOON-1|' + PN, p, 100, isoAgo(3)));
  await open(page, [late, soon, okk], recs);

  expect(await page.locator('#wtDue svg text').first().textContent(), 'ต้องได้สามใบ').toBe('3');
  const pcts = await page.$$eval('#wtDueList .pc', els => els.map(e => Number(e.textContent.replace('%', ''))));
  expect(pcts.length, 'ต้องมีสามช่อง').toBe(3);
  expect(pcts.reduce((a, b) => a + b, 0), 'ผลรวมต้องเป็น 100 พอดี').toBe(100);
});

test('หัวหน้าต้องไม่เขียนว่า "แสดงครบทุกขั้นเสมอ" — ตอนนี้กดปิดขั้นเองได้แล้ว', async ({ page }) => {
  /* ⚠️ ประโยคเดิมจริงตอนที่หน้านี้ยังไม่มีปุ่มปิดขั้นของตัวเอง · ใบนี้เพิ่มปุ่มนั้นเข้ามา
     คำว่า "เสมอ" จึงขัดกับสิ่งที่ตาเห็นทันทีที่คนกดปิดขั้นไปหนึ่งขั้น (ผู้ตรวจ #132 รอบ 3) */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  const head = await page.locator('#view-wiptrend .panel').first().locator('.desc').innerText();
  expect(head, 'ต้องไม่สัญญาว่าแสดงครบทุกขั้นเสมอ').not.toContain('แสดงครบทุกขั้นเสมอ');
  expect(head, 'ต้องยังบอกว่าไม่ฟังการซ่อนขั้นของแดชบอร์ด').toContain('ไม่ฟังการซ่อนขั้นของแดชบอร์ด');
});

test('G2 — โฟกัสบนปุ่มคำอธิบายสีต้องไม่ตกไป BODY เมื่อหน้าวาดใหม่เอง', async ({ page }) => {
  /* ⚠️ ซิงค์อัตโนมัติเรียก renderWipTrend() ทุก 20 วิ · คนที่ Tab มาค้างบนชื่อขั้นจะตกไป BODY
     เองโดยไม่ได้กดอะไร แล้วต้อง Tab จากต้นหน้าใหม่ · การคืนโฟกัสต้องอยู่ใน wtLegend()
     ไม่ใช่ในตัวจับคลิก ไม่งั้นครอบแค่เส้นทางที่คนกดเอง (ผู้ตรวจ #132 รอบ 2 วัดได้) */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  await page.locator('#wtWipLegend .legend-item').first().focus();
  const before = await page.evaluate(() => document.activeElement.dataset.proc || document.activeElement.tagName);
  await page.evaluate(() => renderWipTrend());
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => document.activeElement.dataset.proc || document.activeElement.tagName);
  expect(after, 'ต้องยังอยู่ที่ปุ่มขั้นเดิม').toBe(before);
});

test('ช่วงวันที่ใช้ไม่ได้ ต้องไม่ให้แถบเทียบช่วงอ้างวันที่เก่าที่ไม่ตรงกับช่องบนจอ', async ({ page }) => {
  /* จอที่อ้างวันที่ซึ่งไม่ตรงกับช่องข้าง ๆ คือจอโกหก — แย่กว่าไม่บอกอะไรเลย */
  await open(page, [order('AA-1', 1000, '2026-08-01T00:00:00.000Z')]);
  await page.click('.wtrng[data-rng="daily"] button[data-days="30"]');
  await page.waitForTimeout(250);
  await expect(page.locator('#wtDiff'), 'ตั้งไม่เท่ากันต้องฟ้องก่อน').toBeVisible();

  // ทำให้ช่วงของกราฟยอดค้างใช้ไม่ได้
  await page.fill('#wtWipFrom', isoAgo(2));
  await page.fill('#wtWipTo', isoAgo(20));
  await page.waitForTimeout(250);
  await expect(page.locator('#wtWip'), 'ฝั่งที่ผิดต้องบอกเหตุผลของตัวเอง').toContainText('กลับข้าง');
  await expect(page.locator('#wtDiff'), 'แถบเทียบช่วงต้องเงียบ ไม่ใช่อ้างช่วงเก่า').toBeHidden();
});
