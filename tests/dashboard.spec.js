// เทสหน้า Dashboard — ตัวกรอง Sub-Name คุมทั้งหน้า · กราฟเต็มความกว้างทุกช่วงเวลา
//
// ⚠️ ก่อน 8 ก.ย. 2026 ตัวกรอง Sub-Name คุมแค่ตารางรายใบ การ์ดสรุปกับกราฟเป็นยอดรวมทุกหน่วย
//    ทั้งที่ช่องกรองบอกว่าเลือกหน่วยไว้ คนอ่านที่เอาการ์ดไปเทียบกับตารางจึงสรุปว่ายอดไม่ตรง
//    ทั้งที่ทั้งสองฝั่งถูก — เทสในไฟล์นี้กันไม่ให้ส่วนใดส่วนหนึ่งหลุดออกจากตัวกรองอีก

const { test, expect } = require('@playwright/test');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const PN = '9000000002';

/** วันนี้ตามเวลาเครื่อง — ต้องตรงกับ todayISO() ของแอป ไม่งั้นยอดจะตกนอกช่วงกราฟ */
function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

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

async function openDash(page, orders, records = []) {
  // ⚠️ ตั้งค่าเริ่มต้นเฉพาะตอนยังว่าง · addInitScript ทำงานทุกครั้งที่โหลดหน้า
  //    ถ้าเขียนทับทุกครั้ง เทสที่ reload เพื่อพิสูจน์ว่า "จำค่าไว้" จะพิสูจน์ไม่ได้เลย
  await page.addInitScript(([k, o, r]) => localStorage.getItem(k) || localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForTimeout(200);
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
  Array.from(document.querySelectorAll('#chartWrap svg title'), t => t.textContent));

/** ยอดของ process หนึ่งในวันนี้ ที่กราฟวาดออกมาจริง */
async function barToday(page, process) {
  const hit = (await titlesOf(page)).find(t => t.startsWith(todayISO() + ' ' + LABELS[process] + ': '));
  return hit ? Number(hit.split(': ')[1].replace(/,/g, '')) : null;
}

async function pickSub(page, unit) {
  await page.selectOption('#dashSubFilter', unit);
  await page.waitForTimeout(200);
}

test('การ์ดสรุปต้องนับเฉพาะ Sub-Name ที่เลือก', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  expect(await page.locator('#wipCards').innerText(), 'ยังไม่กรอง = ยอดแผนรวมสองใบ')
    .toContain('10,000');

  await pickSub(page, 'TUE-U');
  const cards = await page.locator('#wipCards').innerText();
  expect(cards, 'เลือกหน่วยแล้วต้องเหลือยอดแผนของหน่วยนั้นใบเดียว').toContain('5,000');
  expect(cards, 'ยอดรวมทุกหน่วยต้องไม่โผล่ค้างอยู่บนการ์ด').not.toContain('10,000');
  expect(await page.locator('#wipScopeNote').innerText(), 'ต้องบอกด้วยว่าการ์ดกำลังนับของหน่วยไหน')
    .toContain('TUE-U');
});

test('กราฟต้องนับเฉพาะ Sub-Name ที่เลือก', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  expect(await barToday(page, 'winding'), 'ยังไม่กรอง = 300 + 70').toBe(370);

  await pickSub(page, 'TUE-U');
  expect(await barToday(page, 'winding'), 'เลือก TUE-U แล้วต้องเหลือ 300').toBe(300);
  expect(await page.locator('#chartRangeCaption').innerText(), 'คำอธิบายใต้กราฟต้องบอกหน่วยที่กรองอยู่')
    .toContain('TUE-U');

  await pickSub(page, 'TUE-H');
  expect(await barToday(page, 'winding'), 'สลับหน่วยแล้วต้องเหลือ 70').toBe(70);

  await pickSub(page, '');
  expect(await barToday(page, 'winding'), 'กลับไป "ทั้งหมด" ต้องได้ยอดรวมคืนครบ').toBe(370);
});

test('ตารางรายใบต้องยังกรองตาม Sub-Name เหมือนเดิม', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  await pickSub(page, 'TUE-U');
  const body = await page.locator('#dashTable tbody').innerText();
  expect(body).toContain('PO-U1');
  expect(body, 'ใบของอีกหน่วยต้องหายไป').not.toContain('PO-H1');
});

/** ความกว้างที่กราฟวาดจริง เทียบกับกล่องที่มันอยู่ */
async function chartWidths(page) {
  return page.evaluate(() => {
    const wrap = document.getElementById('chartWrap');
    const svg = wrap.querySelector('svg');
    return { wrap: wrap.clientWidth, svg: Number(svg.getAttribute('width')) };
  });
}

/** วัดว่ากลุ่มแท่งของหนึ่งช่องกินพื้นที่กี่ % ของช่องนั้น
 *  ที่เหลือคือช่องว่างระหว่างวัน ซึ่งเป็นสิ่งเดียวที่ทำให้ตาแยกกลุ่มออกจากกัน */
async function groupFill(page) {
  return page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('#chartWrap svg rect[data-proc]'));
    const n = new Set(bars.map(b => b.getAttribute('data-proc'))).size;
    const first = bars.slice(0, n).map(b => Number(b.getAttribute('x')));
    const wBar = Number(bars[0].getAttribute('width'));
    const span = Math.max(...first) + wBar - Math.min(...first);
    const svgW = Number(document.querySelector('#chartWrap svg').getAttribute('width'));
    const slotW = (svgW - 44) / (bars.length / n);   // padL = 44
    return span / slotW;
  });
}

/** จำนวนกลุ่ม (ช่อง) ที่กราฟวาด */
const slotCount = page => page.evaluate(() => {
  const bars = Array.from(document.querySelectorAll('#chartWrap svg rect[data-proc]'));
  return bars.length / new Set(bars.map(b => b.getAttribute('data-proc'))).size;
});

test('ช่วงสั้น กราฟต้องกว้างเต็มกล่อง ไม่ใช่ค้างที่ 600px', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openDash(page, ORDERS, RECORDS);
  for (const days of ['7', '14', '21']) {
    await page.selectOption('#chartRange', days);
    await page.waitForTimeout(150);
    const { wrap, svg } = await chartWidths(page);
    expect(wrap, 'กล่องต้องกว้างกว่าเพดานเดิม ไม่งั้นเทสนี้ไม่ได้พิสูจน์อะไร').toBeGreaterThan(600);
    // ปัดเศษความกว้างทำให้ต่างได้ 1px ยอมได้ แต่ห้ามเหลือช่องว่างเป็นสิบ ๆ px
    expect(svg, `ช่วง ${days} วัน ต้องเต็มกล่อง`).toBeGreaterThanOrEqual(wrap - 1);
  }
});

test('แท่งต้องโตตามช่วงที่เลือก ไม่ใช่ผอมเท่าเดิมทุกช่วง', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openDash(page, ORDERS, RECORDS);
  const barW = async () => page.evaluate(() =>
    Number(document.querySelector('#chartWrap svg rect[data-proc]').getAttribute('width')));

  await page.selectOption('#chartRange', '7');
  await page.waitForTimeout(150);
  const wide = await barW();
  await page.selectOption('#chartRange', '21');
  await page.waitForTimeout(150);
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
  await openDash(page, ORDERS, RECORDS);
  const fill = await groupFill(page);
  expect(fill, 'กลุ่มต้องกินไม่เกิน 80% ของช่อง ที่เหลือเป็นช่องว่างให้ตาแยกวัน')
    .toBeLessThan(0.8);
  expect(fill, 'แต่ก็ต้องไม่เว้นจนแท่งลีบเกินจำเป็น').toBeGreaterThan(0.6);
});

test('ต้องมีแถบพื้นหลังสลับช่อง ช่วยแยกกลุ่มตอนแท่งเตี้ย', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  const bands = await page.evaluate(() =>
    document.querySelectorAll('#chartWrap svg rect:not([data-proc])').length);
  expect(bands, 'ช่วง 14 วัน ต้องมีแถบสลับ 7 แถบ').toBe(7);
});

test('ช่วงยาวต้องรวมเป็นรายสัปดาห์ ไม่ใช่วาดรายวัน 90 แท่ง', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await openDash(page, ORDERS, RECORDS);

  await page.selectOption('#chartRange', '21');
  await page.waitForTimeout(150);
  expect(await slotCount(page), '21 วัน ยังวาดรายวันเหมือนเดิม').toBe(21);

  await page.selectOption('#chartRange', '90');
  await page.waitForTimeout(150);
  const slots = await slotCount(page);
  expect(slots, '90 วัน ต้องเหลือ 13-14 กลุ่ม (สัปดาห์หัวท้ายอาจไม่เต็ม)')
    .toBeLessThanOrEqual(14);
  expect(slots, 'และต้องไม่น้อยกว่า 13 สัปดาห์').toBeGreaterThanOrEqual(13);

  const { wrap, svg } = await chartWidths(page);
  expect(svg, 'รวมแล้วต้องเต็มกล่องพอดี ไม่ต้องเลื่อนดูอีก').toBe(wrap);

  const caption = await page.locator('#chartRangeCaption').innerText();
  expect(caption, 'ต้องบอกว่ารวมรายสัปดาห์ ไม่งั้นคนอ่านจะคิดว่าเป็นยอดรายวัน')
    .toContain('รายสัปดาห์');
  expect(caption, 'และยังบอกจำนวนวันจริงของช่วงที่เลือก').toContain('90 วัน');
});

test('รวมรายสัปดาห์แล้วยอดต้องไม่หายไปไหน', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  // ยอด winding วันละ 100 ติดกัน 12 วัน = 1,200 ไม่ว่าจะวาดรายวันหรือรายสัปดาห์
  const recs = [];
  for (let d = 0; d < 12; d++) recs.push(rec('w' + d, 'PO-U1|' + PN, 'winding', 100, isoAgo(d)));
  await openDash(page, ORDERS, recs);
  const sumWinding = async () => {
    const titles = await titlesOf(page);
    return titles.filter(t => t.includes(LABELS.winding + ': '))
      .reduce((a, t) => a + Number(t.split(': ')[1].replace(/,/g, '')), 0);
  };
  await page.selectOption('#chartRange', '21');
  await page.waitForTimeout(150);
  expect(await sumWinding(), 'รายวัน 12 วัน วันละ 100').toBe(1200);
  await page.selectOption('#chartRange', '30');
  await page.waitForTimeout(150);
  expect(await sumWinding(), 'รวมรายสัปดาห์แล้วยอดรวมต้องเท่าเดิมเป๊ะ').toBe(1200);
});

test('แท่งรายสัปดาห์ต้องบอกช่วงวันจริงของมัน', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  await page.selectOption('#chartRange', '30');
  await page.waitForTimeout(150);
  const titles = await titlesOf(page);
  // สัปดาห์หัวท้ายไม่เต็ม ถ้าไม่บอกช่วงวัน คนอ่านจะนึกว่าเป็นสัปดาห์เต็มทุกแท่ง
  expect(titles.some(t => /\d{2}\/\d{2}\/\d{4}–\d{2}\/\d{2}\/\d{4}/.test(t)),
    'tooltip ต้องเป็นช่วงวัน ไม่ใช่วันเดียว').toBe(true);
});

test('สัปดาห์ต้องยึดวันจันทร์จริง ไม่ใช่นับเจ็ดวันจากวันแรกของช่วง', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  /* ถ้านับทีละเจ็ดวันจากวันแรกของช่วง แท่งสุดท้ายของช่วง 30 กับ 60 วันจะกินคนละชุดวัน
     (30 กับ 60 ต่างกัน 30 วัน ซึ่งไม่ใช่พหุคูณของ 7) — เอามาเทียบกันไม่ได้เลย */
  const lastSpan = async days => {
    await page.selectOption('#chartRange', days);
    await page.waitForTimeout(150);
    const titles = await titlesOf(page);
    return titles[titles.length - 1].split(' ')[0];
  };
  expect(await lastSpan('60'), 'แท่งสุดท้ายต้องเป็นสัปดาห์เดียวกันเสมอ ไม่ว่าเลือกช่วงไหน')
    .toBe(await lastSpan('30'));
});

test('ซ่อนขั้นที่ยอดสูงสุดแล้ว สเกลต้องขยับตาม', async ({ page }) => {
  // ถ้าสเกลยังคิดจากขั้นที่ซ่อนไปแล้ว แท่งที่เหลือจะเตี้ยติดพื้นเหมือนเดิม
  // ทั้งที่จุดประสงค์ของการกดซ่อนคือขอดูขั้นที่เหลือให้ชัดขึ้น
  await openDash(page, [order('PO-U1', 5000, 'TUE-U')], [
    rec('big', 'PO-U1|' + PN, 'winding', 5000),
    rec('small', 'PO-U1|' + PN, 'inspection', 100)
  ]);
  // ต้องเอาแท่งที่สูงที่สุดของขั้นนั้น ไม่ใช่แท่งแรก — วันที่ไม่มียอดสูงเป็น 0 ทุกแท่ง
  const heightOf = proc => page.evaluate(p => Math.max(...Array.from(
    document.querySelectorAll(`#chartWrap svg rect[data-proc="${p}"]`),
    el => Number(el.getAttribute('height')))), proc);

  const before = await heightOf('inspection');
  await page.click('.legend-item[data-proc="winding"]');
  await page.waitForTimeout(150);
  expect(await heightOf('inspection'), 'ปิดขั้นที่สูงสุดแล้ว แท่งที่เหลือต้องสูงขึ้นชัดเจน')
    .toBeGreaterThan(before * 5);
});

test('กดคำอธิบายสีแล้วต้องซ่อน/แสดงขั้นนั้นได้', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openDash(page, ORDERS, RECORDS);
  const barsOf = proc => page.locator(`#chartWrap svg rect[data-proc="${proc}"]`).count();
  const anyBarW = () => page.evaluate(() =>
    Number(document.querySelector('#chartWrap svg rect[data-proc]').getAttribute('width')));

  const before = await anyBarW();
  expect(await barsOf('assembly'), 'ตอนแรกต้องมีครบทุกขั้น').toBeGreaterThan(0);

  await page.click('.legend-item[data-proc="assembly"]');
  await page.waitForTimeout(150);
  expect(await barsOf('assembly'), 'กดแล้วขั้นนั้นต้องหายจากกราฟ').toBe(0);
  expect(await barsOf('winding'), 'ขั้นอื่นต้องยังอยู่').toBeGreaterThan(0);
  expect(await anyBarW(), 'และแท่งที่เหลือต้องหนาขึ้น เพราะมีที่ว่างมากขึ้น')
    .toBeGreaterThan(before);

  await page.click('.legend-item[data-proc="assembly"]');
  await page.waitForTimeout(150);
  expect(await barsOf('assembly'), 'กดซ้ำต้องกลับมา').toBeGreaterThan(0);
});

test('ขั้นที่ซ่อนไว้ต้องอยู่ข้ามการเปลี่ยนช่วงเวลาและข้ามการเปิดใหม่', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  await page.click('.legend-item[data-proc="support"]');
  await page.waitForTimeout(150);

  await page.selectOption('#chartRange', '7');
  await page.waitForTimeout(150);
  expect(await page.locator('#chartWrap svg rect[data-proc="support"]').count(),
    'เปลี่ยนช่วงเวลาแล้วขั้นที่ซ่อนไว้ต้องไม่เด้งกลับ').toBe(0);

  await page.reload();
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForTimeout(300);
  expect(await page.locator('#chartWrap svg rect[data-proc="support"]').count(),
    'เปิดโปรแกรมใหม่ก็ต้องจำไว้').toBe(0);
  expect(await page.locator('.legend-item[data-proc="support"]').getAttribute('class'),
    'และปุ่มต้องแสดงว่าปิดอยู่').toContain('off');
});

test('ห้ามซ่อนจนไม่เหลือสักขั้น', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  for (const proc of ['winding', 'assembly', 'support', 'inspection', 'shipping']) {
    await page.click(`.legend-item[data-proc="${proc}"]`);
    await page.waitForTimeout(80);
  }
  const bars = await page.locator('#chartWrap svg rect[data-proc]').count();
  expect(bars, 'กราฟเปล่าจะถูกอ่านว่า "ช่วงนี้ไม่มียอด" ซึ่งไม่จริง').toBeGreaterThan(0);
  expect(await page.locator('#chartWrap svg rect[data-proc="shipping"]').count(),
    'ขั้นสุดท้ายที่กดต้องยังอยู่').toBeGreaterThan(0);
  /* ⚠️ ต้องปฏิเสธการกดตั้งแต่แรก ไม่ใช่ปล่อยให้ปิดครบแล้วค่อยไปแสดงทั้งห้าขั้นแทน
     ถ้าปุ่มบอกว่าปิดหมดแล้วแต่กราฟแสดงครบทุกขั้น คนใช้จะเลิกเชื่อปุ่มไปเลย */
  expect(await page.locator('.legend-item.off').count(),
    'ปุ่มต้องเหลืออย่างน้อยหนึ่งขั้นที่ยังเปิดอยู่').toBeLessThanOrEqual(4);
  expect(await page.locator('.legend-item[data-proc="shipping"]').getAttribute('class'),
    'และขั้นสุดท้ายที่กดต้องไม่ถูกทำเครื่องหมายว่าปิด').not.toContain('off');
});

test('พิมพ์ตอนซ่อนขั้นอยู่ หัวกระดาษต้องบอกว่าซ่อนอะไร', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  await page.click('.legend-item[data-proc="inspection"]');
  await page.waitForTimeout(150);
  // ยิงผ่านเหตุการณ์จริงของเบราว์เซอร์ แทนการเรียกฟังก์ชันตรง ๆ — ครอบเส้นทางที่คนกด Ctrl+P ด้วย
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const meta = await page.locator('#printMeta').innerText();
  expect(meta, 'ไม่งั้นคนอ่านกระดาษจะสรุปว่าขั้นนั้นไม่มียอดเลย').toContain('Inspection');
});
