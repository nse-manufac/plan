// เทสรูปร่างของกราฟแท่งกลุ่ม — `drawGroupedBars()` · `bucketWeekly()`
//
// ⚠️ ไฟล์นี้แยกออกมาจาก tests/dashboard.spec.js เมื่อ 12 พ.ย. 2569 ตอนลบแท็บ Dashboard ทั้งแท็บ
//    ฟังก์ชันที่ตรวจยังเป็นตัวเดิมทุกบรรทัด เปลี่ยนแค่กราฟที่เอามาวัด —
//    จากกราฟของแดชบอร์ด (`#chartWrap`) มาเป็นกราฟยอดผลิตรายวันของหน้ายอดค้างรายวัน (`#wtDaily`)
//    ซึ่งตอนนี้เป็นผู้เรียก `drawGroupedBars()` รายเดียวที่เหลืออยู่
// ⚠️ ช่วงวันของหน้านี้เป็นช่องกรอกวัน ไม่ใช่ช่องเลือกแบบของแดชบอร์ด จึงมี setDays() แทน selectOption

const { test, expect } = require('@playwright/test');
const { waitReady } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const PN = '9000000002';

/** วันนี้ตามเวลาเครื่อง — ต้องตรงกับ todayISO() ของแอป ไม่งั้นยอดจะตกนอกช่วงกราฟ */
function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** dd/mm/yyyy — ต้องตรงกับ fmtDateTH() ของแอป (ใช้เทียบข้อความบอกช่วงวัน) */
const fmtDateTH = iso => iso.split('-').reverse().join('/');

/** ISO ของวันที่ n วันก่อน */
function isoAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const order = (poNo, qty, unit) => ({
  id: poNo + '|' + PN, week: 'WK 34', poNo, pn: PN, subName: unit, orderQty: qty,
  orderDate: '2026-08-03', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, process, qty, date) => ({
  id, date: date || todayISO(), orderId, process, qty, note: '', deviceName: 't',
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  voided: false, _dirty: false
});

/** เปิดโปรแกรมแล้วเข้าแท็บยอดค้างรายวัน
 *  ⚠️ ตั้งค่าเริ่มต้นเฉพาะตอนยังว่าง · addInitScript ทำงานทุกครั้งที่โหลดหน้า
 *     ถ้าเขียนทับทุกครั้ง เทสที่ reload เพื่อพิสูจน์ว่า "จำค่าไว้" จะพิสูจน์ไม่ได้เลย */
async function openWt(page, orders, records = []) {
  await page.addInitScript(([k, o, r]) => localStorage.getItem(k) || localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(250);
}

const ORDERS = [order('PO-U1', 5000, 'TUE-U'), order('PO-H1', 5000, 'TUE-H')];
const RECORDS = [
  rec('r1', 'PO-U1|' + PN, 'winding', 300),
  rec('r2', 'PO-H1|' + PN, 'winding', 70)
];

const LABELS = {
  winding: 'Winding/Trimming', assembly: 'Assembly', support: 'Support',
  inspection: 'Inspection', shipping: 'ส่งของ (Shipping)'
};

/** <title> ของแท่งทุกแท่ง — ใน SVG ไม่ถูกวาดออกจอ innerText จึงว่าง ต้องอ่าน textContent ตรง ๆ */
const titlesOf = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#wtDaily svg title'), t => t.textContent));

/** ตั้งช่วงวันของกราฟยอดผลิตรายวัน = n วันล่าสุด (รวมวันนี้) */
async function setDays(page, n) {
  await page.fill('#wtDailyFrom', isoAgo(Number(n) - 1));
  await page.fill('#wtDailyTo', todayISO());
  await page.waitForTimeout(250);
}

/** ความกว้างที่กราฟวาดจริง เทียบกับกล่องที่มันอยู่ */
async function chartWidths(page) {
  return page.evaluate(() => {
    const wrap = document.getElementById('wtDaily');
    const svg = wrap.querySelector('svg');
    return { wrap: wrap.clientWidth, svg: Number(svg.getAttribute('width')) };
  });
}

/** วัดว่ากลุ่มแท่งของหนึ่งช่องกินพื้นที่กี่ % ของช่องนั้น
 *  ที่เหลือคือช่องว่างระหว่างวัน ซึ่งเป็นสิ่งเดียวที่ทำให้ตาแยกกลุ่มออกจากกัน */
async function groupFill(page) {
  return page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('#wtDaily svg rect[data-proc]'));
    const n = new Set(bars.map(b => b.getAttribute('data-proc'))).size;
    const first = bars.slice(0, n).map(b => Number(b.getAttribute('x')));
    const wBar = Number(bars[0].getAttribute('width'));
    const span = Math.max(...first) + wBar - Math.min(...first);
    const svgW = Number(document.querySelector('#wtDaily svg').getAttribute('width'));
    const slotW = (svgW - 44) / (bars.length / n);   // padL = 44
    return span / slotW;
  });
}

/** จำนวนกลุ่ม (ช่อง) ที่กราฟวาด */
const slotCount = page => page.evaluate(() => {
  const bars = Array.from(document.querySelectorAll('#wtDaily svg rect[data-proc]'));
  return bars.length / new Set(bars.map(b => b.getAttribute('data-proc'))).size;
});

test('ช่วงสั้น กราฟต้องกว้างเต็มกล่อง ไม่ใช่ค้างที่ 600px', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openWt(page, ORDERS, RECORDS);
  for (const days of ['7', '14', '21']) {
    await setDays(page, days);
    const { wrap, svg } = await chartWidths(page);
    expect(wrap, 'กล่องต้องกว้างกว่าเพดานเดิม ไม่งั้นเทสนี้ไม่ได้พิสูจน์อะไร').toBeGreaterThan(600);
    // ปัดเศษความกว้างทำให้ต่างได้ 1px ยอมได้ แต่ห้ามเหลือช่องว่างเป็นสิบ ๆ px
    expect(svg, `ช่วง ${days} วัน ต้องเต็มกล่อง`).toBeGreaterThanOrEqual(wrap - 1);
  }
});

test('แท่งต้องโตตามช่วงที่เลือก ไม่ใช่ผอมเท่าเดิมทุกช่วง', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openWt(page, ORDERS, RECORDS);
  const barW = async () => page.evaluate(() =>
    Number(document.querySelector('#wtDaily svg rect[data-proc]').getAttribute('width')));

  await setDays(page, 7);
  const wide = await barW();
  await setDays(page, 21);
  const narrow = await barW();
  expect(wide, 'ช่วง 7 วันมีที่ว่างเหลือเฟือ แท่งต้องหนากว่าเพดานเดิม 12px')
    .toBeGreaterThan(12);
  expect(wide, 'และต้องหนากว่าตอนเลือกช่วงยาว').toBeGreaterThan(narrow);
});

// ── อ่านง่ายขึ้น (เจ้าของแจ้งเมื่อ 8 ก.ย. 2026 ว่ากราฟดูติดกันไปหมด) ────────────
//
// สาเหตุจริงคือกลุ่มแท่งกินพื้นที่ 93% ของช่องแต่ละวัน เหลือช่องว่างระหว่างวันแค่ 6.7%
// ตาจึงแยกไม่ออกว่าแท่งไหนเป็นของวันไหน แก้สามทาง: เว้นช่องว่าง · รวมรายสัปดาห์ · ซ่อนขั้นได้

test('ต้องมีช่องว่างระหว่างวันจริง ๆ ไม่ใช่แท่งติดกันเป็นพืด', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openWt(page, ORDERS, RECORDS);
  const fill = await groupFill(page);
  expect(fill, 'กลุ่มต้องกินไม่เกิน 80% ของช่อง ที่เหลือเป็นช่องว่างให้ตาแยกวัน')
    .toBeLessThan(0.8);
  expect(fill, 'แต่ก็ต้องไม่เว้นจนแท่งลีบเกินจำเป็น').toBeGreaterThan(0.6);
});

test('ต้องมีแถบพื้นหลังสลับช่อง ช่วยแยกกลุ่มตอนแท่งเตี้ย', async ({ page }) => {
  await openWt(page, ORDERS, RECORDS);
  const bands = await page.evaluate(() =>
    document.querySelectorAll('#wtDaily svg rect:not([data-proc]):not(.wthit)').length);
  expect(bands, 'ช่วง 14 วัน ต้องมีแถบสลับ 7 แถบ').toBe(7);
});

test('ช่วงยาวต้องรวมเป็นรายสัปดาห์ ไม่ใช่วาดรายวัน 90 แท่ง', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await openWt(page, ORDERS, RECORDS);

  await setDays(page, 21);
  expect(await slotCount(page), '21 วัน ยังวาดรายวันเหมือนเดิม').toBe(21);

  await setDays(page, 90);
  const slots = await slotCount(page);
  expect(slots, '90 วัน ต้องเหลือ 13-14 กลุ่ม (สัปดาห์หัวท้ายอาจไม่เต็ม)')
    .toBeLessThanOrEqual(14);
  expect(slots, 'และต้องไม่น้อยกว่า 13 สัปดาห์').toBeGreaterThanOrEqual(13);

  const { wrap, svg } = await chartWidths(page);
  expect(svg, 'รวมแล้วต้องเต็มกล่องพอดี ไม่ต้องเลื่อนดูอีก').toBe(wrap);

  const caption = await page.locator('#wtDailyCaption').innerText();
  expect(caption, 'ต้องบอกว่ารวมรายสัปดาห์ ไม่งั้นคนอ่านจะคิดว่าเป็นยอดรายวัน')
    .toContain('รายสัปดาห์');
  expect(caption, 'และยังบอกจำนวนวันจริงของช่วงที่เลือก').toContain('90 วัน');
});

test('รวมรายสัปดาห์แล้วยอดต้องไม่หายไปไหน', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  // ยอด winding วันละ 100 ติดกัน 12 วัน = 1,200 ไม่ว่าจะวาดรายวันหรือรายสัปดาห์
  const recs = [];
  for (let d = 0; d < 12; d++) recs.push(rec('w' + d, 'PO-U1|' + PN, 'winding', 100, isoAgo(d)));
  await openWt(page, ORDERS, recs);
  const sumWinding = async () => {
    const titles = await titlesOf(page);
    return titles.filter(t => t.includes(LABELS.winding + ': '))
      .reduce((a, t) => a + Number(t.split(': ')[1].replace(/,/g, '')), 0);
  };
  await setDays(page, 21);
  expect(await sumWinding(), 'รายวัน 12 วัน วันละ 100').toBe(1200);
  await setDays(page, 30);
  expect(await sumWinding(), 'รวมรายสัปดาห์แล้วยอดรวมต้องเท่าเดิมเป๊ะ').toBe(1200);
});

test('แท่งรายสัปดาห์ต้องบอกช่วงวันจริงของมัน', async ({ page }) => {
  await openWt(page, ORDERS, RECORDS);
  await setDays(page, 30);
  const titles = await titlesOf(page);
  // สัปดาห์หัวท้ายไม่เต็ม ถ้าไม่บอกช่วงวัน คนอ่านจะนึกว่าเป็นสัปดาห์เต็มทุกแท่ง
  expect(titles.some(t => /\d{2}\/\d{2}\/\d{4}–\d{2}\/\d{2}\/\d{4}/.test(t)),
    'tooltip ต้องเป็นช่วงวัน ไม่ใช่วันเดียว').toBe(true);
});

test('สัปดาห์ต้องยึดวันจันทร์จริง ไม่ใช่นับเจ็ดวันจากวันแรกของช่วง', async ({ page }) => {
  await openWt(page, ORDERS, RECORDS);
  /* ถ้านับทีละเจ็ดวันจากวันแรกของช่วง แท่งสุดท้ายของช่วง 30 กับ 60 วันจะกินคนละชุดวัน
     (30 กับ 60 ต่างกัน 30 วัน ซึ่งไม่ใช่พหุคูณของ 7) — เอามาเทียบกันไม่ได้เลย */
  const lastSpan = async days => {
    await setDays(page, days);
    const titles = await titlesOf(page);
    return titles[titles.length - 1].split(' ')[0];
  };
  expect(await lastSpan('60'), 'แท่งสุดท้ายต้องเป็นสัปดาห์เดียวกันเสมอ ไม่ว่าเลือกช่วงไหน')
    .toBe(await lastSpan('30'));
});

