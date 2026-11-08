// เทสหน้า Dashboard — ตัวกรอง Sub-Name คุมทั้งหน้า · กราฟเต็มความกว้างทุกช่วงเวลา
//
// ⚠️ ก่อน 8 ก.ย. 2026 ตัวกรอง Sub-Name คุมแค่ตารางรายใบ การ์ดสรุปกับกราฟเป็นยอดรวมทุกหน่วย
//    ทั้งที่ช่องกรองบอกว่าเลือกหน่วยไว้ คนอ่านที่เอาการ์ดไปเทียบกับตารางจึงสรุปว่ายอดไม่ตรง
//    ทั้งที่ทั้งสองฝั่งถูก — เทสในไฟล์นี้กันไม่ให้ส่วนใดส่วนหนึ่งหลุดออกจากตัวกรองอีก

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
  await waitReady(page);
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

// ── รวมเป็นราย P/N — เจ้าของสั่ง 5 พ.ย. 2026 ────────────────────────
//
// "ข้อมูลเยอะเกินไปเกินกว่าที่จะเรียกการมองภาพรวม" — หนึ่งแถว = หนึ่ง P/N ต่อหนึ่งหน่วย
// กุญแจกลุ่มเหมือน fgRows() ทุกตัวอักษร เพราะเป็นคำถามเดียวกัน ("ของรุ่นนี้ของหน่วยนี้")

/** ใบสั่งที่กำหนด P/N กับยอดเองได้ รวมถึง "ชนิดข้อมูล" ของสองค่านั้น — order() ข้างบนตรึง PN ไว้ตัวเดียว */
const orderPn = (poNo, pn, qty, unit = 'TUE-U') => ({
  id: poNo + '|' + pn, week: 'WK 34', poNo, pn, subName: unit, orderQty: qty,
  orderDate: '2026-08-03', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
/** ทุกแถวบนตาราง — เกาะ data-pn ไม่ใช่ข้อความในช่อง (ช่องนั้นมีป้าย ⚠ ผิดลำดับ ปนได้) */
const dashGroups = page => page.locator('#dashTable tbody tr').evaluateAll(trs => trs.map(tr => {
  const td = tr.querySelectorAll('td');
  return { pn: td[1].dataset.pn, unit: td[2].innerText.trim(),
           n: td[3].innerText.trim(), qty: td[4].innerText.trim(),
           winding: td[5].innerText.trim() };
}));

test('สองใบของ P/N เดียวกันในหน่วยเดียวกัน ต้องรวมเป็นแถวเดียว', async ({ page }) => {
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100), orderPn('ZZ-2', 'PN-A', 100)]);
  const g = await dashGroups(page);
  expect(g.length, 'สองใบต้องเหลือแถวเดียว').toBe(1);
  expect(g[0].n, 'ช่อง "ใบ" บอกว่ารวมมาจากกี่ใบ').toBe('2');
  expect(g[0].qty, 'ยอดสั่งรวมของทั้งกลุ่ม').toBe('200');
});

test('ยอดสะสมต้องครอบ min(สะสม, ยอดสั่ง) ต่อใบ ก่อนบวกกัน — ให้ตรงกับการ์ด WIP', async ({ page }) => {
  // ใบแรกคีย์เกินยอดสั่ง (150 จาก 100) · ใบที่สอง 50 จาก 100
  // ครอบต่อใบ → 100 + 50 = 150 · ถ้าบวกก่อนแล้วค่อยครอบจะได้ 200/200 = เต็มทั้งที่ยังไม่เสร็จ
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100), orderPn('ZZ-2', 'PN-A', 100)],
    [rec('r1', 'ZZ-1|PN-A', 'winding', 150), rec('r2', 'ZZ-2|PN-A', 'winding', 50)]);
  const g = await dashGroups(page);
  expect(g[0].winding).toContain('150/200');
  expect(await page.locator('#wipCards').innerText(), 'ต้องตรงกับบัญชีของค้างรายขั้น').toContain('150');
});

test('P/N เดียวกันแต่คนละหน่วย ต้องเป็นคนละแถว ยอดห้ามปนกัน', async ({ page }) => {
  // P/N เดียวอยู่สองนิติบุคคลได้ — รวมข้ามหน่วยแล้วยอดของสองบริษัทปนกัน
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100, 'TUE-U'), orderPn('ZZ-2', 'PN-A', 700, 'TUE-H')]);
  const g = await dashGroups(page);
  expect(g.map(x => [x.unit, x.qty])).toEqual([['TUE-H', '700'], ['TUE-U', '100']]);
});

test('P/N ที่เป็นตัวเลขกับที่เป็นข้อความ ต้องรวมกันได้และยังเรียงแถวได้ (เครื่องที่ซิงค์มา)', async ({ page }) => {
  /* เครื่องที่รับข้อมูลจากการซิงค์ได้ P/N เป็นตัวเลข ส่วนเครื่องที่นำเข้าไฟล์เองได้เป็นข้อความ
     (บั๊กที่เจอ 1 ก.ย. 2026) — โค้ดจึงแปลงเป็นข้อความก่อนทำกุญแจ แบบเดียวกับ fgRows()

     ⚠️ ฉากต้องเป็น "P/N เป็นตัวเลขทุกใบ และมีสองกลุ่มขึ้นไป" ไม่งั้นข้อนี้ไม่ได้ตรวจอะไรเลย
        · กุญแจ `pn + '|' + unit` JS แปลงเลขเป็นข้อความให้เองตอนต่อสตริง สองใบจึงรวมกันอยู่ดี
        · `escapeHtml()` ก็ครอบ String() ไว้แล้ว ช่องบนจอจึงออกมาเหมือนกัน
        สิ่งที่ String() กันจริงคือ `a.pn.localeCompare(b.pn)` ตอนเรียงแถว — ตัวเลขไม่มีเมธอดนี้
        ทั้งตารางจึงว่างทั้งหน้า · และเครื่องที่ซิงค์มาได้ตัวเลข **ทุกใบ** (มาจากชีตเดียวกัน)
        ฉากนี้จึงเป็นของจริง ไม่ใช่ฉากที่แต่งให้พัง
        (ฉบับแรกของเทสข้อนี้ใช้กลุ่มเดียว ถอด String() ออกแล้วยังเขียว — รันพิสูจน์แล้ว) */
  await openDash(page, [orderPn('ZZ-1', 9000000002, 100), orderPn('ZZ-2', '9000000002', 100),
    orderPn('ZZ-3', 9000000004, 700)]);
  const g = await dashGroups(page);
  expect(g.map(x => [x.pn, x.n, x.qty]), 'P/N เดียวต้องเป็นแถวเดียว และเรียงได้')
    .toEqual([['9000000002', '2', '200'], ['9000000004', '1', '700']]);
});

test('ยอดสั่งที่เป็นข้อความต้องบวกเป็นเลข ไม่ใช่ต่อสตริง (ผู้ตรวจ #119)', async ({ page }) => {
  // เหตุผลเดียวกับ P/N ข้างบน — '100' + 100 ได้ '100100' ไม่ใช่ 200
  // ตอนเป็นแถวราย PO ไม่เคยโผล่ เพราะ numFmt() แปลงให้ก่อนแสดงทีละใบ
  await openDash(page, [orderPn('ZZ-1', 'PN-A', '100'), orderPn('ZZ-2', 'PN-A', 100)],
    [rec('r1', 'ZZ-1|PN-A', 'winding', 150), rec('r2', 'ZZ-2|PN-A', 'winding', 50)]);
  const g = await dashGroups(page);
  expect(g[0].qty, 'ต้องเป็น 200 ไม่ใช่ 100,100').toBe('200');
  expect(g[0].winding, 'แถบความคืบหน้าก็ต้องเทียบกับ 200').toContain('150/200');
});

test('ตารางราย P/N ต้องยังกรองตาม Sub-Name เหมือนเดิม', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  await pickSub(page, 'TUE-U');
  // สองใบนี้ P/N เดียวกัน ต่างกันที่หน่วย — แดชบอร์ดรวมแถวด้วย P/N + Sub-Name
  // จึงยังเป็นสองแถว และตัวกรองต้องเหลือแถวของหน่วยที่เลือกเท่านั้น
  const body = await page.locator('#dashTable tbody').innerText();
  expect(body).toContain('TUE-U');
  expect(body, 'แถวของอีกหน่วยต้องหายไป').not.toContain('TUE-H');
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
  await waitReady(page);
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

test('หัวกระดาษต้องบอกช่วงวันด้วย — ช่องเลือกช่วงไม่พิมพ์ติดไป', async ({ page }) => {
  /* ⚠️ ช่วงวันเป็นตัวกรองเดียวบนหน้านี้ที่ **ติ๊กค่าตั้งต้นมาให้โดยไม่มีใครเลือก** ("วันนี้")
        และ .row.filters ถูกซ่อนตอนพิมพ์ · คนที่ถือกระดาษหน้ากลางจะเห็นเลขตัวใหญ่ทุกช่อง
        โดยไม่มีอะไรบอกว่าเป็นของวันไหน (ผู้ตรวจ #120 รันพิสูจน์)
        คำอธิบายใต้หัวแผงพิมพ์ติดไปและเขียนว่า "ยอดที่คีย์ในช่วงวันที่เลือก" แต่ไม่บอกช่วง */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100)], [rec('r1', 'ZZ-1|PN-A', 'winding', 40)]);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  expect(await page.locator('#printMeta').innerText(), 'ต้องมีช่วงวันบนหัวกระดาษ')
    .toContain('ยอดในช่วง: ' + fmtDateTH(todayISO()));

  // เลือกช่วงอื่นแล้วหัวกระดาษต้องตามไปด้วย ไม่ค้างที่ "วันนี้"
  await page.click('#dashPresets button[data-range="all"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  expect(await page.locator('#printMeta').innerText()).toContain('ยอดในช่วง: (ทุกวัน)');
});

// ── การ์ดสรุปต้องนับชุดเดียวกับตาราง — เจ้าของสั่ง 5 พ.ย. 2026 ──────────
//
// ผู้ตรวจ #119 วัดได้ว่าการ์ด "ยอดแผนรวม" กับคอลัมน์ "ยอดสั่งรวม" ต่างกัน (200 กับ 100)
// ตั้งแต่เปิดโปรแกรม เพราะการ์ดกรองแค่ Sub-Name แต่ตารางกรองครบทุกช่อง
// และ "ซ่อนงานที่ส่งของครบแล้ว" ติ๊กไว้เป็นค่าตั้งต้น
//
// ⚠️ ต้องเทียบ "การ์ดกับตาราง" ไม่ใช่ "การ์ดกับเลขที่เขียนไว้ในเทส" — เลขตายตัวจะเขียว
//    ทั้งที่สองที่บนจอขัดกัน ถ้าวันหนึ่งมีคนเปลี่ยนนิยามของฝั่งตารางไปอีกทาง

/** ป้าย → ค่า ทั้งหัวตัวเลขรวม (.wh) และแถวของค้างรายขั้น (.wlr)
 *  หน่วยอยู่ใน <small> ท้ายค่า จึงหยิบเฉพาะ childNodes[0] เหมือนเดิม */
const cardVals = page => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('#wipCards .wh > div').forEach(el => {
    out[el.querySelector('.k').textContent.trim()] =
      el.querySelector('.v').childNodes[0].textContent.trim();
  });
  document.querySelectorAll('#wipCards .wlr').forEach(el => {
    out[el.querySelector('.nm').textContent.trim()] = el.querySelector('.q').textContent.trim();
  });
  return out;
});
const PLAN_CARD = 'ยอดแผนรวม';

test('การ์ดต้องไม่นับใบที่ตารางซ่อนไว้เพราะส่งของครบแล้ว', async ({ page }) => {
  /* ⚠️ ยอดส่งต้องลงวันเก่า ไม่ใช่วันนี้ — ตั้งแต่ 7 พ.ย. 2026 ใบที่มียอดในช่วงวันที่เลือก
        ไม่ถูกซ่อน (เจ้าของเคาะ) · ลงวันนี้แล้วใบนั้นจะไม่ถูกซ่อน แล้วข้อนี้จะตรวจคนละเรื่อง */
  await openDash(page,
    [orderPn('ZZ-1', 'PN-A', 100), orderPn('ZZ-2', 'PN-A', 100)],
    [rec('s1', 'ZZ-2|PN-A', 'shipping', 100, isoAgo(20))]);
  const rows = await dashGroups(page);
  expect(rows.map(r => [r.n, r.qty]), 'ค่าตั้งต้นซ่อนใบที่ส่งครบ จึงเหลือใบเดียว').toEqual([['1', '100']]);
  expect((await cardVals(page))[PLAN_CARD], 'การ์ดต้องได้เลขเดียวกับคอลัมน์ยอดสั่งรวม')
    .toBe(rows[0].qty);
  expect(await page.locator('#wipScopeNote').innerText(), 'และต้องบอกว่ากำลังนับกี่ใบ')
    .toContain('1 ใบ');

  // ปลดติ๊กแล้วสองที่ต้องขยับพร้อมกัน = พิสูจน์ว่าช่องนี้วาดการ์ดใหม่ด้วย ไม่ใช่แค่ตาราง
  await page.locator('#dashHideDone').setChecked(false);
  await page.waitForTimeout(200);
  const rows2 = await dashGroups(page);
  expect(rows2.map(r => [r.n, r.qty]), 'ปลดติ๊กแล้วเห็นครบสองใบ').toEqual([['2', '200']]);
  expect((await cardVals(page))[PLAN_CARD], 'การ์ดต้องตามมาด้วย').toBe(rows2[0].qty);
});

/* ⚠️ ต้องไล่ **ทุกช่อง** ตามชื่อข้อ — ผู้ตรวจ #119 รอบหกทักว่าข้อนี้เคยครอบแค่ `สัปดาห์`
      กับ `ค้นหา` ส่วน `สถานะ` กับ `ค้างอยู่ที่ขั้น` (สองช่องที่ #119 เพิ่งผูกใหม่) ไม่มีใครคุม
   ⚠️ ทุกช่องต้องเทียบกับเลขที่ **ไม่ใช่ 0 และต่างกัน** — ถ้าทุกฉากจบที่ 0 การ์ดที่พังจนขึ้น 0
      ตลอดจะผ่านได้ · ZZ-2 จึงสั่งเมื่อวาน (สถานะปกติ) และคีย์ winding ครบแล้ว (ค้างที่ assembly)
      ส่วน ZZ-1 สั่ง ส.ค. (เกินกำหนด) และยังไม่คีย์อะไร (ค้างที่ "ยังไม่เริ่มผลิต") */
test('เปลี่ยนตัวกรองช่องไหนก็ต้องวาดการ์ดใหม่', async ({ page }) => {
  await openDash(page, [
    orderPn('ZZ-1', 'PN-A', 100),
    { ...orderPn('ZZ-2', 'PN-B', 700), week: 'WK 35', orderDate: isoAgo(1) }
  ], [rec('w2', 'ZZ-2|PN-B', 'winding', 700)]);
  expect((await cardVals(page))[PLAN_CARD], 'ยังไม่กรอง = สองใบรวมกัน').toBe('800');

  await page.selectOption('#dashWeekFilter', 'WK 35');
  await page.waitForTimeout(200);
  expect((await dashGroups(page)).map(r => r.qty), 'ตารางเหลือใบของสัปดาห์นั้น').toEqual(['700']);
  expect((await cardVals(page))[PLAN_CARD], 'การ์ดต้องขยับตาม ไม่ค้างที่ยอดรวมทุกสัปดาห์')
    .toBe('700');

  await page.fill('#dashSearch', 'ไม่มีใบนี้');
  await page.waitForTimeout(250);
  expect((await cardVals(page))[PLAN_CARD], 'ช่องค้นหาก็ต้องวาดการ์ดใหม่ (ช่องนี้ยิง input ไม่ใช่ change)')
    .toBe('0');

  // ล้างสองช่องบนก่อน แล้วไล่สองช่องที่เหลือทีละช่อง
  await page.fill('#dashSearch', '');
  await page.selectOption('#dashWeekFilter', '');
  await page.waitForTimeout(250);

  await page.selectOption('#dashStatusFilter', 'late');
  await page.waitForTimeout(200);
  expect((await dashGroups(page)).map(r => r.qty), 'ตารางเหลือใบที่เกินกำหนด').toEqual(['100']);
  expect((await cardVals(page))[PLAN_CARD], 'ช่องสถานะก็ต้องวาดการ์ดใหม่').toBe('100');

  await page.selectOption('#dashStatusFilter', '');
  await page.selectOption('#dashWipFilter', 'assembly');
  await page.waitForTimeout(200);
  expect((await dashGroups(page)).map(r => r.qty), 'ตารางเหลือใบที่ค้างหน้า Assembly').toEqual(['700']);
  expect((await cardVals(page))[PLAN_CARD], 'ช่องค้างอยู่ที่ขั้นก็ต้องวาดการ์ดใหม่').toBe('700');
});

// ── ช่วงวัน "ยอดในช่วง" บนแดชบอร์ด (เจ้าของสั่ง 5 พ.ย. 2026 · ใบ 2/2 ของการโละหน้านี้) ──
//
// ⚠️ ช่องของแต่ละขั้นมีสองเลขคนละฐานเวลาโดยตั้งใจ (เจ้าของเลือกแบบ G1):
//    เลขตัวใหญ่ = ยอดที่คีย์ในช่วงวันที่เลือก · บรรทัดล่าง + แถบ = ยอดสะสมทั้งหมดเทียบยอดสั่ง
//    เทสในกลุ่มนี้ต้องแยกสองเลขนั้นออกจากกันทุกข้อ ไม่ใช่เทียบ innerText ของช่องรวม ๆ
//    ไม่งั้นเลขหนึ่งพังแล้วอีกเลขกลบไว้ได้

/** [เลขตัวใหญ่ (ยอดในช่วง), บรรทัดล่าง (สะสม/ยอดสั่ง)] ของช่องขั้นแรกในแถวแรก */
const dashRangeCell = (page, nth = 5) =>
  page.locator('#dashTable tbody tr').first().locator('td').nth(nth)
    .evaluate(td => [td.querySelector('.rq').innerText.trim(), td.querySelector('.small').innerText.trim()]);

/** แถวรวมท้ายตาราง — [ข้อความบอกช่วง, ยอดรวมของทุกขั้นเรียงตามคอลัมน์] */
const dashFoot = page => page.locator('#dashTable tfoot td').evaluateAll(
  tds => [tds[0].innerText.trim(), tds.slice(1).map(td => td.innerText.trim())]);

test('ช่วงวันตั้งต้นเป็น "วันนี้" และเลขตัวใหญ่คือยอดของช่วงนั้น ไม่ใช่ยอดสะสม', async ({ page }) => {
  // คีย์ไว้สองวัน: วันนี้ 40 · เมื่อวาน 60 → สะสม 100 แต่ยอดของวันนี้คือ 40
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 500)], [
    rec('r1', 'ZZ-1|PN-A', 'winding', 40),
    rec('r2', 'ZZ-1|PN-A', 'winding', 60, isoAgo(1))
  ]);
  expect(await page.inputValue('#dashFrom'), 'ตั้งต้นที่วันนี้ทั้งสองช่อง').toBe(todayISO());
  expect(await page.inputValue('#dashTo')).toBe(todayISO());
  await expect(page.locator('#dashPresets button[data-range="today"]'),
    'ปุ่มที่ตรงกับช่วงต้องไฮไลต์ ไม่งั้นจอไม่บอกว่ากำลังยึดช่วงไหน').toHaveClass(/primary/);
  expect(await dashRangeCell(page), 'เลขตัวใหญ่ = ยอดวันนี้ · บรรทัดล่าง = สะสมทั้งหมด')
    .toEqual(['40', '100/500']);
});

test('เลือก "ทั้งหมด" แล้วเลขตัวใหญ่ต้องเป็นยอดรวมทุกวัน ส่วนยอดสะสมไม่ขยับ', async ({ page }) => {
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 500)], [
    rec('r1', 'ZZ-1|PN-A', 'winding', 40),
    rec('r2', 'ZZ-1|PN-A', 'winding', 60, isoAgo(1))
  ]);
  await page.click('#dashPresets button[data-range="all"]');
  await page.waitForTimeout(200);
  expect(await page.inputValue('#dashFrom'), '"ทั้งหมด" = ล้างช่องวันที่ ไม่ใช่ใส่วันเก่าสุด').toBe('');
  expect(await dashRangeCell(page)).toEqual(['100', '100/500']);
  await expect(page.locator('#dashPresets button[data-range="today"]')).not.toHaveClass(/primary/);
});

test('ช่วงที่ไม่มียอดต้องขึ้น "—" ไม่ใช่ 0 ทั้งในช่องและในแถวรวม', async ({ page }) => {
  /* "—" กับ "0" อ่านไม่เหมือนกัน · 0 ชวนให้เข้าใจว่าคีย์ไว้ว่าผลิตศูนย์
     ส่วนช่องที่ไม่มียอดในช่วงนี้แปลว่า "ช่วงนี้ไม่มีการคีย์ของขั้นนี้"
     ⚠️ ต้องเช็กแถวรวมคู่ไปด้วย — ผู้ตรวจ #120 จับได้ว่าช่องขึ้น "—" แต่แถวรวมเขียน "0"
        ในคอลัมน์เดียวกัน · ค่าตั้งต้นคือ "วันนี้" จึงเจอทุกเช้าที่ยังไม่มีใครคีย์ */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 500)],
    [rec('r1', 'ZZ-1|PN-A', 'winding', 60, isoAgo(3))]);
  expect(await dashRangeCell(page), 'ยอดของเมื่อสามวันก่อนไม่อยู่ในช่วง "วันนี้"')
    .toEqual(['—', '60/500']);
  const [, totals] = await dashFoot(page);
  expect(totals.every(v => v === '—'), 'ทุกขั้นไม่มีใครคีย์วันนี้ แถวรวมต้องเป็นขีดทั้งแถว')
    .toBe(true);
});

test('ยอดที่คีย์ไว้เป็น 0 จริง ต้องขึ้น 0 ไม่ใช่ "—" ทั้งในช่องและในแถวรวม', async ({ page }) => {
  /* ⚠️ ข้อนี้คือคู่ตรงข้ามของข้อบน และต้องมีคู่กัน — ถ้าเขียนเงื่อนไขเป็น `!v` แทน `== null`
        ข้อบนจะยังเขียวแต่ข้อนี้แดง · record ยอด 0 เกิดขึ้นเองได้จากการเลือกเหตุผล
        ตอนยังไม่มียอดในหน้าคีย์ยอด (27 ต.ค. 2026) = "วันนี้ผลิต 0" ซึ่งคนละเรื่องกับ
        "ยังไม่ได้คีย์" คนละขั้ว (กฎที่เจ้าของเคาะไว้ให้หน้ายอดรายวันทุกขั้น) */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 500)],
    [rec('r1', 'ZZ-1|PN-A', 'winding', 0)]);
  expect(await dashRangeCell(page), 'มีคนคีย์ไว้ว่าวันนี้ผลิต 0 จึงต้องเห็นเลข 0')
    .toEqual(['0', '0/500']);
  const [, totals] = await dashFoot(page);
  expect(totals[0], 'แถวรวมของขั้นที่มีคนคีย์ 0 ต้องเป็น 0 ไม่ใช่ขีด').toBe('0');
  expect(totals[1], 'ขั้นที่ไม่มีใครคีย์เลยยังเป็นขีด').toBe('—');
});

test('ยังไม่มีใบสั่งเลย แถวรวมต้องไม่ยืนยันว่าทำได้ 0', async ({ page }) => {
  // ผู้ตรวจ #120: ตารางขึ้น "ยังไม่มีข้อมูล" แต่แถวรวมเขียน 0 ทุกขั้น
  await openDash(page, [], []);
  const [, totals] = await dashFoot(page);
  expect(totals.every(v => v === '—'), 'ไม่มีใบให้นับ ก็ไม่มีอะไรจะยืนยัน').toBe(true);
});

test('แถวรวมท้ายตารางต้องเป็นยอดในช่วง และบอกช่วงที่กำลังนับ', async ({ page }) => {
  // สอง P/N คนละแถว คีย์วันนี้ 40 กับ 30 → รวม 70 · ของเมื่อวานต้องไม่ถูกนับ
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 500), orderPn('ZZ-2', 'PN-B', 500)], [
    rec('r1', 'ZZ-1|PN-A', 'winding', 40),
    rec('r2', 'ZZ-2|PN-B', 'winding', 30),
    rec('r3', 'ZZ-1|PN-A', 'winding', 900, isoAgo(1))
  ]);
  const [label, totals] = await dashFoot(page);
  expect(totals[0], 'รวมแต่ยอดของวันนี้').toBe('70');
  expect(label, 'ต้องบอกวันที่ที่กำลังนับ ไม่ใช่เลขรวมลอย ๆ').toContain(fmtDateTH(todayISO()));

  await page.click('#dashPresets button[data-range="all"]');
  await page.waitForTimeout(200);
  const [label2, totals2] = await dashFoot(page);
  expect(totals2[0], 'เลือกทั้งหมดแล้วต้องรวมของเมื่อวานด้วย').toBe('970');
  expect(label2, 'ช่วงที่ไม่จำกัดต้องเขียนเป็นคำ ไม่ใช่เว้นว่าง').toContain('ทุกวัน');
});

test('แถวรวมต้องเขียนว่านับกี่ใบ เพราะมันนับแต่ใบที่ผ่านตัวกรอง', async ({ page }) => {
  /* ⚠️ ข้อนี้ไม่ได้รับรองว่าเลขในแถวรวมคือ "ทั้งโรงงาน" — มันบังคับว่าแถวรวม **ต้องเขียนกำกับ
        ว่านับกี่ใบ** แบบเดียวกับ #wipScopeNote ของการ์ด · ไม่มีข้อความกำกับ "—" จะอ่านว่า
        ไม่มีใครคีย์ ซึ่งขัดกับคำอธิบายบนหน้าเดียวกัน (ผู้ตรวจ #120 รันพิสูจน์)
        ⚠️ ฉากเดิมของข้อนี้ใช้ "ซ่อนงานที่ส่งของครบแล้ว" เป็นตัวตัดแถว ซึ่งเจ้าของเคาะเมื่อ
           7 พ.ย. 2026 ให้เลิกตัดใบที่มียอดในช่วง — ย้ายมาใช้ตัวกรองสัปดาห์ที่ยังตัดตามเดิม */
  await openDash(page, [
    orderPn('ZZ-1', 'PN-A', 100),
    { ...orderPn('ZZ-2', 'PN-B', 500), week: 'WK 35' }
  ], [rec('a1', 'ZZ-1|PN-A', 'winding', 40), rec('b1', 'ZZ-2|PN-B', 'winding', 7)]);
  const [label, totals] = await dashFoot(page);
  expect(label, 'ยังไม่กรอง = สองใบ').toContain('นับเฉพาะ 2 ใบ');
  expect(totals[0]).toBe('47');

  await page.selectOption('#dashWeekFilter', 'WK 35');
  await page.waitForTimeout(250);
  const [label2, totals2] = await dashFoot(page);
  expect(label2, 'กรองแล้วจำนวนใบต้องขยับตาม').toContain('นับเฉพาะ 1 ใบ');
  expect(totals2[0], 'และยอดรวมต้องเป็นของใบที่เหลือเท่านั้น').toBe('7');
});

test('ใบที่ส่งครบแล้วแต่มียอดในช่วง ต้องไม่ถูก "ซ่อนงานที่ส่งของครบแล้ว" ตัดออก', async ({ page }) => {
  /* เจ้าของเคาะ 7 พ.ย. 2026 — ตัวกรองนี้มีไว้ซ่อนงานที่จบแล้วและไม่ขยับอีก
     ใบที่ส่งครบ *วันนี้* คือใบที่ทำงานเยอะที่สุดของวัน ซ่อนแล้วแถวรวมอ่านว่าทำได้ 7 จาก 107
     ⚠️ ต้องเช็กทั้งสามที่ — แถว · แถวรวม · การ์ด — เพราะทั้งสามอ่าน dashFilteredRows() ตัวเดียว
        ถ้าวันหนึ่งมีใครย้ายเงื่อนไขไปไว้ที่ renderDashTable การ์ดจะขัดกับตารางทันที (กฎจาก #119) */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100), orderPn('ZZ-2', 'PN-B', 500)], [
    rec('a1', 'ZZ-1|PN-A', 'winding', 100), rec('a2', 'ZZ-1|PN-A', 'assembly', 100),
    rec('a3', 'ZZ-1|PN-A', 'support', 100), rec('a4', 'ZZ-1|PN-A', 'inspection', 100),
    rec('a5', 'ZZ-1|PN-A', 'shipping', 100),
    rec('b1', 'ZZ-2|PN-B', 'winding', 7)
  ]);
  expect((await dashGroups(page)).length, 'ใบที่ส่งครบวันนี้ต้องยังอยู่บนจอ').toBe(2);
  const [label, totals] = await dashFoot(page);
  expect(totals[0], 'แถวรวมต้องได้ 107 ไม่ใช่ 7').toBe('107');
  expect(totals[1], 'ขั้นอื่นต้องไม่ขึ้นขีดทั้งที่วันนี้คีย์ครบ').toBe('100');
  expect(label, 'ขอบเขตต้องบอกว่านับสองใบ').toContain('นับเฉพาะ 2 ใบ');
  expect((await cardVals(page))[PLAN_CARD], 'การ์ดต้องนับชุดเดียวกับตาราง').toBe('600');
});

test('ใบที่ส่งครบแล้วและไม่มียอดในช่วง ต้องยังถูกซ่อนตามเดิม', async ({ page }) => {
  /* ⚠️ ต้องมีคู่กับข้อบน — ไม่งั้นการเลิกซ่อนทั้งหมดก็ผ่านข้อบนได้
        ตัวกรองนี้เป็นค่าตั้งต้นที่เจ้าของเลือกไว้ตั้งแต่ #119 การทำให้มันไม่ทำงานเลยคือของคนละเรื่อง */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100), orderPn('ZZ-2', 'PN-B', 500)], [
    rec('a5', 'ZZ-1|PN-A', 'shipping', 100, isoAgo(20)),
    rec('b1', 'ZZ-2|PN-B', 'winding', 7)
  ]);
  const rows = await dashGroups(page);
  expect(rows.length, 'ใบที่ส่งครบไปนานแล้วต้องยังถูกซ่อน').toBe(1);
  expect(rows[0].qty).toBe('500');
});

test('ป้ายช่องติ๊กกับหัวกระดาษต้องเขียนข้อยกเว้นไว้ด้วย ไม่ใช่ "ซ่อนงานที่ส่งของครบแล้ว" เฉย ๆ', async ({ page }) => {
  /* คู่กับสองข้อบน — พฤติกรรมถูกแล้วแต่คำที่เขียนไว้กลับทางกัน
     ใบที่ส่งครบวันนี้ยังนับอยู่ในแถวรวม แต่กระดาษพิมพ์ว่า "ซ่อนงานที่ส่งของครบแล้ว"
     คนอ่านกระดาษไม่มีทางรู้ว่าใบนั้นยังอยู่ (ผู้ตรวจ #122 รันพิสูจน์ ค้างสามรอบ) */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100)], [
    rec('a1', 'ZZ-1|PN-A', 'shipping', 100)
  ]);
  expect((await dashGroups(page)).length, 'ใบที่ส่งครบวันนี้ยังอยู่บนจอ').toBe(1);

  const labelText = await page.locator('label:has(#dashHideDone)').innerText();
  expect(labelText, 'ป้ายบนจอต้องเขียนข้อยกเว้นไว้').toContain('มียอดในช่วง');
  const title = await page.locator('label:has(#dashHideDone)').getAttribute('title');
  expect(title || '', 'title ต้องขยายความต่อ').toContain('ช่วงวันที่เลือก');

  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const meta = await page.locator('#printMeta').innerText();
  expect(meta, 'หัวกระดาษต้องเขียนข้อยกเว้นเหมือนกัน').toContain('เว้นใบที่มียอดในช่วง');
});

test('การ์ดของขั้นสุดท้ายชื่อ "ยอด FG คงคลัง" และต้องเขียนกำกับว่าเลขคนละเกณฑ์กับหน้า FG', async ({ page }) => {
  /* เจ้าของสั่งเปลี่ยนชื่อ 7 พ.ย. 2026 จาก "WIP รอส่งของ" ซึ่งอ่านไม่ออกว่าเป็นของในคลัง
     ⚠️ พอชื่อซ้ำกับหน้ายอดคงคลัง FG แล้ว **ต้องมี title กำกับ** เพราะเลขสองที่ไม่เท่ากันได้
        การ์ดครอบที่ยอดสั่งต่อใบและไม่ติดลบ · หน้า FG โชว์ยอดดิบโดยตั้งใจ (fgRows)
        ชื่อเดียวกันที่ไม่บอกว่าคนละเกณฑ์ = คนเอามาเทียบแล้วสรุปว่ายอดไม่ตรง ทั้งที่ทั้งคู่ถูก */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100)], [
    rec('i1', 'ZZ-1|PN-A', 'inspection', 80), rec('s1', 'ZZ-1|PN-A', 'shipping', 30)
  ]);
  const cards = await page.locator('#wipCards').innerText();
  expect(cards, 'ชื่อใหม่ตามที่เจ้าของสั่ง').toContain('ยอด FG คงคลัง');
  expect(cards, 'ชื่อเดิมต้องไม่เหลือ').not.toContain('WIP รอส่งของ');
  expect((await cardVals(page))['ยอด FG คงคลัง'],
    'ยอด = ผ่าน Inspection 80 − ส่งแล้ว 30').toBe('50');
  // นิยามย้ายไปอยู่ใน title แล้ว (เจ้าของสั่งเอาวงเล็บออกจากป้าย 7 พ.ย. 2026) — ต้องยังอ่านได้
  expect(cards, 'ป้ายบนการ์ดต้องสั้น ไม่มีวงเล็บนิยามแล้ว').not.toContain('เสร็จ Inspection แต่ยังไม่ส่ง');

  const title = await page.locator('#wipCards .wlr .nm')
    .filter({ hasText: 'ยอด FG คงคลัง' }).getAttribute('title');
  expect(title, 'ต้องบอกว่าทำไมอาจไม่ตรงกับหน้ายอดคงคลัง FG').toContain('FG คงเหลือ');
});

test('จำนวน PO บนแถวของค้าง ต้องตรงกับจำนวน "ใบ" ที่ตัวกรอง "ค้างอยู่ที่ขั้น" กรองออกมา', async ({ page }) => {
  /* เลขสองที่นี้มาจากสูตรเดียวกัน (wipQtyAtStage) โดยตั้งใจ — คนที่อ่านเลขบนแถว
     แล้วอยากรู้ว่าเป็นใบไหน ต้องกดกรองแล้วได้จำนวนเท่ากันเสมอ ไม่งั้นเลขนั้นตามต่อไม่ได้
     ⚠️ **หน่วยที่ต้องเท่ากันคือ "ใบ" ไม่ใช่ "แถว"** — ตารางรวมเป็นราย P/N มาตั้งแต่ 5 พ.ย. 2026
     สองใบของ P/N เดียวกันจึงเหลือแถวเดียว · fixture ข้อนี้จึงจงใจให้ ZZ-1 กับ ZZ-2 ใช้ P/N เดียวกัน
     เพื่อให้ "จำนวนแถว" กับ "จำนวนใบ" ไม่เท่ากัน ถ้าใช้ P/N คนละตัวเทสจะเขียวเองโดยไม่ได้ตรวจอะไร
     ⚠️ คอลัมน์ชิ้นหักที่ยอดรวม ส่วนการนับ PO หักทีละใบ — คนละเกณฑ์โดยตั้งใจ จึงต้องมีเทสคุมข้อนี้ไว้ */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100), orderPn('ZZ-2', 'PN-A', 100), orderPn('ZZ-3', 'PN-B', 100)], [
    rec('a1', 'ZZ-1|PN-A', 'winding', 100), rec('a2', 'ZZ-1|PN-A', 'assembly', 40),
    rec('b1', 'ZZ-2|PN-A', 'winding', 100), rec('b2', 'ZZ-2|PN-A', 'assembly', 30)
  ]);
  const poCell = label => page.locator('#wipCards .wlr', { hasText: label }).locator('.q').nth(1);
  expect(await poCell('ยังไม่เริ่มผลิต').innerText(), 'ZZ-3 ใบเดียวที่ยังไม่เริ่ม').toBe('1');
  expect(await poCell('WIP ค้างหน้า Assembly').innerText(), 'ZZ-1 กับ ZZ-2 ค้างหน้า Assembly ทั้งคู่').toBe('2');

  await page.selectOption('#dashWipFilter', 'assembly');
  await page.waitForTimeout(200);
  const g = await dashGroups(page);
  expect(g.length, 'สองใบของ P/N เดียวกัน ตารางรวมเหลือแถวเดียว — แถวจึงไม่ใช่หน่วยที่เทียบกับ PO').toBe(1);
  expect(g.reduce((s, r) => s + Number(r.n.replace(/,/g, '')), 0),
    'คอลัมน์ "ใบ" รวมกันต้องเท่าเลข PO บนแถว ไม่งั้นเลขนั้นตามต่อไม่ได้').toBe(2);
  expect(await page.locator('#wipScopeNote').innerText(),
    'ข้อความใต้การ์ดก็ต้องบอกจำนวนเดียวกัน').toContain('2 ใบ');
});

test('ช่วงวันกลับข้าง (จาก > ถึง) ต้องฟ้อง ไม่ใช่โชว์ขีดทั้งแถวเฉย ๆ', async ({ page }) => {
  // ช่วงที่ไม่มีวันไหนเข้าได้เลย · ถ้าไม่บอก จะอ่านว่า "ช่วงนี้ไม่มีใครทำอะไร" ซึ่งคนละเรื่อง
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100)], [rec('r1', 'ZZ-1|PN-A', 'winding', 10)]);
  await page.fill('#dashFrom', todayISO());
  await page.fill('#dashTo', isoAgo(5));
  await page.waitForTimeout(250);
  const [label, totals] = await dashFoot(page);
  expect(label, 'ต้องบอกตรง ๆ ว่าช่วงกลับข้าง').toContain('ช่วงกลับข้าง');
  expect(totals.every(v => v === '—'), 'และยังเป็นขีดทั้งแถวตามจริง').toBe(true);
});

test('ใบที่ยังไม่จบ ช่วงวันต้องไม่ตัดทิ้ง และการ์ดต้องนับชุดเดียวกับตาราง', async ({ page }) => {
  /* ⚠️ ข้อนี้คือกฎที่ #119 ใช้สามรอบแก้ — การ์ดกับตารางต้องนับใบชุดเดียวกัน
        ช่วงวันเป็นเรื่องของ "ยอด" ไม่ใช่ "ใบ"
        ⚠️ fixture ของข้อนี้ไม่มีใบที่ส่งครบโดยตั้งใจ เพราะใบที่ส่งครบ **ขยับตามช่วงได้**
        ตามที่เจ้าของเคาะเมื่อ 7 พ.ย. 2026 · ข้อยกเว้นนั้นคุมด้วยเทส "ใบที่ส่งครบแล้วแต่มียอดในช่วง ..." */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100), orderPn('ZZ-2', 'PN-B', 700)],
    [rec('r1', 'ZZ-1|PN-A', 'winding', 10, isoAgo(30))]);
  const rows = await dashGroups(page);
  expect(rows.length, 'ไม่มีใบไหนคีย์ยอดในช่วง "วันนี้" แต่ทุกแถวต้องยังอยู่').toBe(2);
  expect((await cardVals(page))[PLAN_CARD], 'การ์ดต้องเท่ากับยอดสั่งรวมของทุกแถวเหมือนเดิม')
    .toBe('800');

  await page.click('#dashPresets button[data-range="all"]');
  await page.waitForTimeout(200);
  expect((await dashGroups(page)).length, 'เปลี่ยนช่วงแล้วจำนวนแถวต้องไม่เปลี่ยน').toBe(2);
  expect((await cardVals(page))[PLAN_CARD], 'และการ์ดต้องไม่ขยับตามช่วงวัน').toBe('800');
});

test('ยอดในช่วงต้องไม่ถูกครอบที่ยอดสั่ง ต่างจากยอดสะสม', async ({ page }) => {
  /* ยอดสะสม = "เดินไปถึงไหนของใบนี้" จึงครอบที่ยอดสั่ง (กฎจาก #119)
     ยอดในช่วง = "ช่วงนี้ทำได้เท่าไหร่" ซึ่งเกินยอดสั่งได้จริง ครอบแล้วจะโกหกว่าทำได้น้อยกว่าจริง */
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 100)],
    [rec('r1', 'ZZ-1|PN-A', 'winding', 150)]);
  expect(await dashRangeCell(page), 'เลขตัวใหญ่ 150 ไม่ครอบ · บรรทัดล่าง 100/100 ครอบ')
    .toEqual(['150', '100/100']);
});

test('ยอดสั่งที่เป็นข้อความ การ์ดต้องบวกเป็นเลข', async ({ page }) => {
  await openDash(page, [orderPn('ZZ-1', 'PN-A', '100'), orderPn('ZZ-2', 'PN-A', 100)]);
  const rows = await dashGroups(page);
  expect(rows[0].qty, 'ฝั่งตารางถูกอยู่แล้ว').toBe('200');
  /* การ์ดนี้บวกยอดหลายใบมาตั้งแต่ต้น `0 + '100'` ได้ `'0100'` ไม่ใช่ 100
     ผิดเงียบมาตลอดเพราะยังไม่มีคอลัมน์ไหนให้เอามาเทียบ */
  expect((await cardVals(page))[PLAN_CARD], 'การ์ดต้องได้เลขเดียวกับตาราง').toBe(rows[0].qty);
});

/* G3 — สีของขั้นมาจากรายการที่ซิงค์มา และแผงจัดการขั้นไม่กรองอักขระ
 * ค่าที่ลง innerHTML ต้องผ่าน escapeHtml() ทุกที่ รวมที่อยู่ใน attribute ของ style
 * ไม่งั้น `#111" onmouseover="…` ปิด attribute แล้วแทรก attribute ใหม่ได้ (ผู้ตรวจ #123 รันพิสูจน์)
 * ⚠️ ต้องใช้ขั้นที่ "ไม่ใช่ห้าขั้นตั้งต้น" — สีของห้าขั้นนั้นมาจากโค้ดเสมอ ที่ซิงค์มาทับไม่ได้
 * 🚨 **ข้อนี้คุมแค่การแตก attribute ไม่ได้คุม CSS** — `escapeHtml()` ไม่กัน `;` หรือ `url(...)`
 *    สีที่ซิงค์มาจึงยังสั่งให้เบราว์เซอร์ยิงคำขอออกนอกเครือข่ายได้ = ข้อมูลหลุดออกโรงงาน (ผู้ตรวจ #123 รอบ 5 รันพิสูจน์)
 *    ทางแก้คือกรองรูปแบบ `#rrggbb` ที่ต้นทาง — เป็นใบแยก ดู CLAUDE.md */
test('G3 — สีของขั้นที่ซิงค์มาต้องไม่กลายเป็น attribute บนบัญชีของค้าง', async ({ page }) => {
  const EVIL = '#111" onmouseover="window.__pwned=1';
  const procs = [
    { id: 'winding', label: 'Winding/Trimming', short: 'Winding', hidden: false },
    { id: 'assembly', label: 'Assembly', short: 'Assembly', hidden: false },
    { id: 'evilstage', label: 'ขั้นทดสอบ', short: 'ทดสอบ', color: EVIL, hidden: false },
    { id: 'support', label: 'Support', short: 'Support', hidden: false },
    { id: 'inspection', label: 'Inspection', short: 'Inspection', hidden: false },
    { id: 'shipping', label: 'ส่งของ (Shipping)', short: 'Shipping', hidden: false }
  ];
  await page.addInitScript(([k, o, r, p]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' }, processes: p,
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, ORDERS, RECORDS, procs]);
  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForTimeout(250);

  // ขั้นที่ซิงค์มาต้องมีแถวของตัวเองจริง ไม่งั้นเทสนี้เขียวเองโดยไม่ได้ตรวจอะไร
  await expect(page.locator('#wipCards .wlr', { hasText: 'ค้างหน้า ทดสอบ' })).toHaveCount(1);

  const swatch = page.locator('#wipCards .wlr i.t').nth(2);
  expect(await swatch.getAttribute('onmouseover'), 'สีที่ซิงค์มาแตก attribute ออกมาได้').toBeNull();
  await swatch.hover();
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();

  const bar = page.locator('#wipCards .wlr .b span').nth(2);
  expect(await bar.getAttribute('onmouseover'), 'แถบสัดส่วนก็แตก attribute ออกมาได้').toBeNull();
});

/* แถบสัดส่วนคือเหตุผลหลักที่ใบนี้เปลี่ยนการ์ดเป็นบัญชี — ทุกแถบเริ่มที่เส้นเดียวกันจึงเทียบด้วยตาได้
 * ⚠️ ตัวหารต้องเป็น "ยังไม่ได้ส่ง" (left) ไม่ใช่ยอดแผนรวม · บรรทัดกำกับบนจอเขียนเลขตัวหารไว้ตรง ๆ
 *    เปลี่ยนตัวหารแล้วจอจะขัดกับคำกำกับของตัวเองแบบเงียบ ๆ (ผู้ตรวจ #123 รอบ 7 รันพิสูจน์ว่า
 *    ก่อนมีข้อนี้ ทั้งชุดยังเขียวทั้งที่เปอร์เซ็นต์ผิดทุกแถว) */
test('แถบสัดส่วนต้องคิดจาก "ยังไม่ได้ส่ง" ไม่ใช่ยอดแผนรวม และเลขต้องตรงกับความกว้างแถบ', async ({ page }) => {
  // ยอดแผนรวม 300 · ส่งแล้ว 50 · ยังไม่ได้ส่ง 250 — สามเลขนี้ต่างกันหมด ตัวหารผิดจึงเห็นทันที
  await openDash(page, [orderPn('ZZ-1', 'PN-A', 200), orderPn('ZZ-2', 'PN-B', 100)], [
    rec('r1', 'ZZ-1|PN-A', 'winding', 200), rec('r2', 'ZZ-1|PN-A', 'assembly', 200),
    rec('r3', 'ZZ-1|PN-A', 'support', 200), rec('r4', 'ZZ-1|PN-A', 'inspection', 200),
    rec('r5', 'ZZ-1|PN-A', 'shipping', 50)
  ]);
  const row = label => page.locator('#wipCards .wlr', { hasText: label });
  const pct = label => row(label).locator('.q').nth(2).innerText();

  // 100/250 = 40.0% · ถ้าหารด้วย 300 จะได้ 33.3%
  expect(await pct('ยังไม่เริ่มผลิต'), 'ZZ-2 ทั้งใบ = 100 ชิ้น จาก 250').toBe('40.0%');
  // 150/250 = 60.0% · ถ้าหารด้วย 300 จะได้ 50.0%
  expect(await pct('ยอด FG คงคลัง'), 'ZZ-1 ผ่าน Inspection 200 ส่งแล้ว 50').toBe('60.0%');

  // ความกว้างแถบต้องเป็นเลขเดียวกับตัวหนังสือ ไม่ใช่คนละฐาน
  // ⚠️ เบราว์เซอร์ตัด `.0` ทิ้ง (`40.0%` → `40%`) จึงต้องเทียบเป็นตัวเลข ห้ามเทียบข้อความ
  const barW = async label => parseFloat(
    await row(label).locator('.b span').evaluate(el => el.style.width));
  expect(await barW('ยังไม่เริ่มผลิต'), 'แถบกับเลขต้องมาจากตัวเดียวกัน').toBeCloseTo(40, 1);
  expect(await barW('ยอด FG คงคลัง')).toBeCloseTo(60, 1);

  // บรรทัดกำกับต้องบอกตัวหารตัวจริง ไม่งั้นคนอ่านเทียบเองไม่ได้
  expect(await page.locator('#wipCards .wlt').innerText(), 'ต้องบอกว่าเปอร์เซ็นต์คิดจากเลขไหน')
    .toContain('250');
});

/* คำอธิบายใต้หัวข้อเป็นสิ่งเดียวที่บอกคนอ่านว่าเลขบนหน้านี้มาจากฐานเวลาไหน
 * ⚠️ ไม่มีเทสไหนเคยอ่านมันเลย ประโยค "ช่วงวันไม่แตะการ์ดสรุป" จึงค้างผิดมาตั้งแต่ #122
 *    (ข้อยกเว้นของ "ซ่อนงานที่ส่งของครบแล้ว" ทำให้ชุดใบขยับตามช่วงวัน) โดยไม่มีอะไรฟ้อง
 *    และคำว่า "การ์ดสรุป" ก็ชี้ไปที่ของที่ถอดออกไปแล้ว — ผู้ตรวจ #123 รอบ 8-9 จับได้ทั้งสองข้อ */
test('คำอธิบายบนแดชบอร์ดต้องไม่ชี้ไปที่ของที่ไม่มีแล้ว และต้องบอกว่าบัญชีของค้างเป็นยอดสะสม', async ({ page }) => {
  await openDash(page, ORDERS, RECORDS);
  const desc = await page.locator('#view-dashboard .panel .desc').first().innerText();

  expect(desc, 'การ์ดสรุปถูกแทนด้วยบัญชีของค้างแล้ว คนอ่านจะหาการ์ดไม่เจอ').not.toContain('การ์ด');
  // ชื่อช่องติ๊กที่ประโยคอ้างถึง ต้องมีอยู่บนหน้าจริง ไม่ใช่ชื่อที่เปลี่ยนไปแล้ว
  expect(desc).toContain('ซ่อนงานที่ส่งของครบแล้ว');
  await expect(page.locator('label', { hasText: 'ซ่อนงานที่ส่งของครบแล้ว' }).first()).toBeVisible();
  /* กับดัก "สองเลขคนละฐานเวลา" — ต้องเขียนไว้ว่าบัญชีของค้างไม่ใช่ยอดของช่วงวัน
     ⚠️ ต้องมัดสองคำนี้เข้าด้วยกัน — คำว่า "ยอดสะสม" เพียงคำเดียวมีอยู่ก่อนแล้วในย่อหน้าเดียวกัน
     (บรรทัดล่างกับแถบของตาราง) เทสจะเขียวเองทันที — ลองถอดประโยคของบัญชีออกแล้วเทสยังเขียว (พิสูจน์แล้ว) */
  expect(desc, 'ไม่งั้นคนอ่านจะนึกว่าบัญชีรายขั้นเป็นเลขของช่วงวันที่เลือก')
    .toMatch(/บัญชีของค้าง[^·]*ยอดสะสม/);
});

/* ───────── รายการใบที่ข้อมูลย้อนแย้ง (เจ้าของขอ 8 พ.ย. 2026) ─────────
 * แถบเตือนบอกแค่ "22 PO" ซึ่งตามต่อไม่ได้ — ของจริงบนเครื่องเจ้าของมี 22 ใบ
 * และไม่มีทางรู้ว่าใบไหน · รายการใต้แถบคือส่วนที่ทำให้ตามต่อได้ */

/** ใบที่ยอดขั้นหลังมากกว่าขั้นหน้า = ย้อนแย้ง */
const anomRecs = (po, pairs) => Object.entries(pairs).map(([proc, qty], i) =>
  rec(po + '-' + proc, po + '|' + PN, proc, qty, isoAgo(10 + i)));

async function openAnomList(page) {
  await page.click('#wanomToggle');
  await expect(page.locator('.wanl')).toBeVisible();
}

/** ข้อความในแถว — แปลงเว้นวรรคไม่ตัดบรรทัดเป็นเว้นวรรคธรรมดาก่อนเทียบ
 *  แอปมัดหน่วยไว้ **สองชั้น**: \u00A0 ระหว่างคำกับเลข และ `<u>` + CSS `nowrap` รอบทั้งหน่วย
 *  ชั้นแรกกันไม่ให้ "เกิน" ขาดจาก "400" แม้ CSS ไม่ทำงาน · ชั้นสองกันหน่วยหลายคำอย่าง
 *  "30/10/2026 · 1,332" ซึ่ง \u00A0 อย่างเดียวไม่พอ
 *  ⚠️ **การแปลงนี้จำเป็น ห้ามถอด** — วัดแล้ว innerText คืน \u00A0 ออกมาจริง (ไม่ได้ถูก normalize)
 *     ถอดแล้วเทสจะแดงเพราะเรื่องการจัดหน้า ไม่ใช่เพราะเลขผิด ซึ่งคนละเรื่องกับที่ข้อนี้ตรวจ
 *     (ผู้ตรวจ #127 รอบ 2 ทักว่าแอปเลิกใช้ \u00A0 แล้ว — รันวัดเองแล้วไม่จริง ยังใช้อยู่ทั้งสองชั้น) */
const rowOf = (page, po) => page.locator(`[data-anom-row="${po}|${PN}"]`);
const rowText = async (page, po) =>
  (await rowOf(page, po).innerText()).replace(/\u00A0/g, ' ');

test('รายการย้อนแย้งต้องบอกคู่ขั้นที่เพี้ยนและส่วนต่าง ไม่ใช่แค่จำนวนใบ', async ({ page }) => {
  await openDash(page,
    [order('PO-BAD', 5000, 'TUE-U'), order('PO-OK', 5000, 'TUE-U')],
    [...anomRecs('PO-BAD', { winding: 1500, assembly: 2000 }),
     ...anomRecs('PO-OK',  { winding: 2000, assembly: 1500 })]);

  await expect(page.locator('.wanom')).toContainText('ข้อมูลย้อนแย้ง 1 PO');
  await openAnomList(page);

  // มีแถวเดียว และเป็นใบที่เพี้ยนจริง ไม่ใช่ใบที่ยอดถูกลำดับ
  await expect(page.locator('.wanr')).toHaveCount(1);
  const txt = await rowText(page, 'PO-BAD');
  expect(txt).toContain('Assembly 2,000');
  expect(txt).toContain('Winding 1,500');
  /* ⚠️ ส่วนต่างต้องเป็น cur − bef · สลับทางได้ −500 ซึ่งอ่านว่า "ขาด" แทนที่จะเป็น "เกิน"
     แล้วคนจะไปไล่หายอดที่หายไป ทั้งที่ของจริงคือมีคนคีย์เกิน */
  expect(txt, 'ต้องบอกส่วนต่างเป็นบวก ไม่ใช่เลขติดลบ').toContain('เกิน 500');
  // ข้อมูลประจำใบที่ใช้ตามต่อ
  expect(txt).toContain('TUE-U');
  expect(txt).toContain('WK 34');
  expect(txt).toContain('5,000');
});

test('ใบที่เพี้ยนหลายคู่ ต้องขึ้นครบทุกคู่ ไม่ใช่คู่แรกคู่เดียว', async ({ page }) => {
  await openDash(page, [order('PO-M', 9000, 'TUE-U')],
    anomRecs('PO-M', { winding: 100, assembly: 500, support: 900 }));
  await openAnomList(page);

  const txt = await rowText(page, 'PO-M');
  /* ⚠️ เขียน .find() แทนการเก็บทุกคู่ แล้วใบที่พังหลายจุดจะโชว์จุดเดียว
     คนแก้จุดนั้นเสร็จแล้วคิดว่าจบ รอบหน้าป้ายขึ้นอีก โดยไม่รู้ว่ายังมีอีกคู่ */
  expect(txt, 'คู่ Assembly > Winding').toContain('Assembly 500');
  expect(txt, 'คู่ Support > Assembly').toContain('Support 900');
  expect(txt).toContain('เกิน 400');
});

test('ยอดล่าสุดของขั้นที่เพี้ยน ต้องข้ามรายการที่ยกเลิกไปแล้ว', async ({ page }) => {
  const recs = [
    rec('w', 'PO-V|' + PN, 'winding', 100, isoAgo(9)),
    rec('a-เก่า', 'PO-V|' + PN, 'assembly', 500, isoAgo(8)),
    // รายการล่าสุด แต่ถูกยกเลิกแล้ว จึงไม่ได้อยู่ในยอดสะสมที่ทำให้ย้อนแย้ง
    Object.assign(rec('a-ยกเลิก', 'PO-V|' + PN, 'assembly', 9999, isoAgo(1)), { voided: true })
  ];
  recs[1].deviceName = 'เครื่องไลน์ A';
  await openDash(page, [order('PO-V', 9000, 'TUE-U')], recs);
  await openAnomList(page);

  const txt = await rowText(page, 'PO-V');
  /* ⚠️ ไม่ข้ามรายการที่ยกเลิก แล้วช่องนี้จะชี้ไปที่รายการที่ไม่ได้ทำให้เกิดปัญหา
     คนเปิดไปดูแล้วเห็นว่ามันถูกลบไปแล้ว จึงสรุปว่าแถบเตือนเพี้ยน */
  expect(txt, 'ต้องเป็นวันของรายการที่ยังอยู่').toContain(fmtDateTH(isoAgo(8)));
  expect(txt).not.toContain(fmtDateTH(isoAgo(1)));
  expect(txt).toContain('เครื่องไลน์ A');
});

test('กดเลข PO ต้องเด้งไปหน้าแก้ไขรายการ และล้างตัวกรองที่ค้างอยู่ให้ด้วย', async ({ page }) => {
  await openDash(page, [order('PO-J', 9000, 'TUE-U')],
    anomRecs('PO-J', { winding: 100, assembly: 500 }));

  /* ตัวกรองที่ค้างจากการใช้ครั้งก่อน — ฉากจริงคือคนเพิ่งไปดูยอดของวันหนึ่งมา
     ⚠️ ไม่ล้าง แล้วตารางจะว่าง คนอ่านว่า "ใบนี้ไม่มีรายการ" ทั้งที่ถูกกรองทิ้ง
        ซึ่งแย่กว่าไม่มีปุ่มนี้เลย เพราะมันตอบผิดแทนที่จะไม่ตอบ */
  await page.click('.tab-btn[data-tab="entry"]');
  await page.fill('#recFilterDate', isoAgo(99));
  await page.selectOption('#recFilterProcess', 'inspection');
  await page.click('.tab-btn[data-tab="dashboard"]');

  await openAnomList(page);
  await page.click('[data-anom-po="PO-J"]');

  await expect(page.locator('.tab-btn[data-tab="entry"]')).toHaveClass(/active/);
  expect(await page.inputValue('#recFilterDate')).toBe('');
  expect(await page.inputValue('#recFilterProcess')).toBe('');
  expect(await page.inputValue('#recFilterSearch')).toBe('PO-J');
  // ต้องเห็นรายการของใบนั้นจริง ไม่ใช่ตารางว่าง
  await expect(page.locator('#recordEditorTable tbody tr')).toHaveCount(2);
});

test('รายการย้อนแย้งต้องนับชุดใบเดียวกับตัวกรองของหน้า (กฎจาก #119)', async ({ page }) => {
  await openDash(page,
    [order('PO-U9', 5000, 'TUE-U'), order('PO-H9', 5000, 'TUE-H')],
    [...anomRecs('PO-U9', { winding: 100, assembly: 500 }),
     ...anomRecs('PO-H9', { winding: 100, assembly: 500 })]);

  await openAnomList(page);
  await expect(page.locator('.wanr')).toHaveCount(2);

  await pickSub(page, 'TUE-U');
  /* ⚠️ รายการต้องหุบตามตัวกรอง ไม่ใช่คิดจาก activeOrders() ทั้งก้อน
     ไม่งั้นแถบบอก 1 PO แต่กางออกมาได้ 2 แถว = คนเลิกเชื่อทั้งแถบ */
  await expect(page.locator('.wanom')).toContainText('ข้อมูลย้อนแย้ง 1 PO');
  await expect(page.locator('.wanr'), 'เลขบนแถบกับจำนวนแถวต้องตรงกันเสมอ').toHaveCount(1);
  await expect(rowOf(page, 'PO-U9')).toBeVisible();

  /* ⚠️ และต้องไม่หุบเองตอนเปลี่ยนตัวกรอง — แถบถูกวาดใหม่ทั้งก้อนทุกครั้ง
     ถ้าเก็บสถานะเปิด/ปิดไว้ในฟังก์ชัน รายการจะหายทุกครั้งที่คนขยับตัวกรอง */
  await expect(page.locator('.wanl')).toBeVisible();
});

test('G3 — PO และ P/N ที่ซิงค์มาต้องไม่กลายเป็น attribute หรือแท็กบนรายการย้อนแย้ง', async ({ page }) => {
  /* ⚠️ สองช่องนี้ลง innerHTML คนละที่ และพังคนละแบบ — ต้องยิงทั้งคู่
     · poNo  -> ลง **attribute** (data-anom-po และ data-anom-row ผ่าน id) -> หลุดเป็น onmouseover ได้
     · pn    -> ลง **เนื้อข้อความ** -> หลุดเป็นแท็ก <img onerror> ได้
     เทสรอบแรกของใบนี้ยิง pn แล้วไปตรวจ attribute ซึ่งเกิดจากเนื้อข้อความไม่ได้เลย
     จึงเขียวเองโดยไม่ได้ตรวจอะไร (ถอด escapeHtml ของ pn ออกแล้วยังเขียว — พิสูจน์แล้ว) */
  const evilPo = 'P" onmouseover="window.__anomAttr=1';
  const evilPn = '<img src=x onerror="window.__anomTag=1">';
  const o = order(evilPo, 5000, 'TUE-U');
  o.pn = evilPn;
  await openDash(page, [o], [
    rec('w', o.id, 'winding', 100, isoAgo(9)),
    rec('a', o.id, 'assembly', 500, isoAgo(8))
  ]);
  await openAnomList(page);

  const row = page.locator('.wanr').first();
  expect(await row.getAttribute('onmouseover'), 'poNo หลุดเป็น attribute').toBeNull();
  expect(await row.locator('img').count(), 'pn หลุดเป็นแท็ก').toBe(0);
  await row.hover();
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__anomAttr)).toBeUndefined();
  expect(await page.evaluate(() => window.__anomTag)).toBeUndefined();
  // และต้องยังอ่านค่าจริงได้ ไม่ใช่ถูกกลืนหาย
  await expect(row).toContainText(evilPn);
});

test('จอแคบต้องไม่ตัดบรรทัดกลางหน่วย — เลขต้องติดกับคำของมัน', async ({ page }) => {
  /* ⚠️ ที่ 1024 px คอลัมน์แคบลงจนข้อความตัดบรรทัด · ตอนแรกเขียนเป็นเว้นวรรคธรรมดา
     แล้ว "เกิน" กับ "252" ไปคนละบรรทัด และชื่อเครื่องขาดจากวันที่ (รันเห็นเองก่อนเปิดใบ)
     เลขที่ลอยอยู่คนละบรรทัดกับคู่ของมัน อ่านผิดคู่ได้ ซึ่งบนหน้าที่มีไว้ไล่ของผิดคือเรื่องใหญ่
     แก้ด้วยการห่อแต่ละหน่วยด้วย <u> ที่ nowrap แล้วปล่อยให้ย้ายทั้งก้อนแทนที่จะแตกกลางคำ */
  await page.setViewportSize({ width: 1024, height: 900 });
  await openDash(page, [order('PO-W', 9000, 'TUE-U')],
    anomRecs('PO-W', { winding: 100, assembly: 500, support: 900 }));
  await openAnomList(page);

  const units = page.locator('.wanr u');
  expect(await units.count(), 'ทุกหน่วยต้องถูกห่อไว้').toBeGreaterThanOrEqual(3);
  for (const u of await units.all()) {
    expect(await u.evaluate(el => getComputedStyle(el).whiteSpace),
      'หน่วยที่แตกกลางคำได้ = เลขไปอยู่คนละบรรทัดกับคำของมัน').toBe('nowrap');
  }
  /* ขั้นที่เพี้ยนต้องหนา **ทุกคู่** ไม่ใช่เฉพาะคู่แรก
     ⚠️ ฉากนี้ต้องมีสองคู่เท่านั้น — คู่เดียวจะเขียวเองถ้ามีคนกลับไปเขียน CSS เป็น u:first-child
        เพราะตัวที่ควรหนาก็เป็นลูกคนแรกพอดี (ลองแล้ว: เปลี่ยนกลับแล้วฉากคู่เดียวยังเขียว) */
  const hi = page.locator('.wanr u.hi');
  expect(await hi.count(), 'สองคู่ = ต้องมีสองตัว').toBe(2);
  for (const el of await hi.all()) {
    expect(await el.evaluate(x => Number(getComputedStyle(x).fontWeight))).toBeGreaterThan(500);
  }

  // และต้องไม่ดันหน้าให้เลื่อนแนวนอน
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('จอแคบจนตารางล้น ต้องเลื่อนไปอ่านได้ ห้ามตัดคอลัมน์หายเงียบ ๆ', async ({ page }) => {
  /* ⚠️ ของเดิม .wanl{overflow:hidden} ตัดคอลัมน์ขวาสุด ("ยอดล่าสุดของขั้นนั้น") หายทั้งคอลัมน์
     โดยไม่มีแถบเลื่อนและไม่มีอะไรฟ้อง (ผู้ตรวจ #127 วัดได้ที่ 800 CSS px)
     ทางที่เจอจริงไม่ใช่จอเล็ก แต่คือ **ซูมเบราว์เซอร์ 125% บนจอ 1024** ซึ่งเครื่องหน้างานตั้งกันจริง
     ⚠️ เทสเดิมของใบนี้วัด scrollWidth ของ "ทั้งหน้า" ซึ่งเขียวเสมอ เพราะ overflow:hidden
        กันไม่ให้หน้าล้นอยู่แล้ว — มันซ่อนของหาย ไม่ได้ทำให้หน้าเลื่อน ต้องวัดที่กล่องเอง */
  await page.setViewportSize({ width: 760, height: 900 });
  await openDash(page, [order('PO-N', 9000, 'TUE-U')],
    anomRecs('PO-N', { winding: 100, assembly: 500 }));
  await openAnomList(page);

  const box = page.locator('.wanl');
  const m = await box.evaluate(el => ({
    over: el.scrollWidth > el.clientWidth,
    x: getComputedStyle(el).overflowX
  }));
  expect(m.over, 'ฉากนี้ต้องแคบจนล้นจริง ไม่งั้นเทสไม่ได้ตรวจอะไร').toBe(true);
  expect(['auto', 'scroll'], 'ล้นแล้วต้องเลื่อนไปอ่านได้ ไม่ใช่ถูกตัดทิ้ง').toContain(m.x);

  // และเลื่อนแล้วต้องถึงคอลัมน์สุดท้ายจริง
  await box.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await box.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
});

test('G2 — กดเลข PO แล้วโฟกัสต้องไปอยู่ที่ช่องค้นหา ไม่ตกไป BODY', async ({ page }) => {
  /* ⚠️ ปุ่มที่เพิ่งกดถูกซ่อนไปพร้อมแท็บแดชบอร์ด โฟกัสจึงตกไป BODY
     คนไล่ด้วยแป้นพิมพ์ต้อง Tab จากต้นหน้า entry ใหม่ทุกครั้ง (ผู้ตรวจ #127 รันพิสูจน์)
     ช่องค้นหาคือที่ที่เขากำลังจะทำงานต่อพอดี — กฎเดียวกับ #dayProcBtns · pendingFocusOrderId */
  await openDash(page, [order('PO-F', 9000, 'TUE-U')],
    anomRecs('PO-F', { winding: 100, assembly: 500 }));
  await openAnomList(page);

  // กดด้วยแป้นพิมพ์ ซึ่งเป็นเส้นทางที่ปัญหานี้เกิด
  await page.locator('[data-anom-po="PO-F"]').focus();
  await page.keyboard.press('Enter');

  expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
    .toBe('recFilterSearch');
});

test('ลำดับแถวต้องเรียงเอง เกินมากสุดขึ้นก่อน ไม่ใช่ตามลำดับใน state.orders', async ({ page }) => {
  /* ⚠️ ของเดิมเรียงตามลำดับใน state.orders · เครื่องที่นำเข้าไฟล์เองกับเครื่องที่ซิงค์มา
     ได้คนละลำดับ คนสองคนเปิดเทียบกันจะไล่บรรทัดตรงกันไม่ได้ (ผู้ตรวจ #127 รันได้ ZZZ ก่อน AAA)
     fixture จงใจใส่ใบที่เกินน้อยไว้ "ก่อน" ในอาร์เรย์ ถ้าไม่เรียงจะได้ลำดับกลับกัน */
  await openDash(page, [
    order('PO-A1', 9000, 'TUE-U'), order('PO-B1', 9000, 'TUE-U'), order('PO-C1', 9000, 'TUE-U')
  ], [
    ...anomRecs('PO-A1', { winding: 100, assembly: 150 }),   // เกิน 50
    ...anomRecs('PO-B1', { winding: 100, assembly: 900 }),   // เกิน 800
    ...anomRecs('PO-C1', { winding: 100, assembly: 400 })    // เกิน 300
  ]);
  await openAnomList(page);

  const ids = await page.locator('.wanr').evaluateAll(els => els.map(e => e.dataset.anomRow));
  expect(ids, 'เกินมากสุดต้องอยู่บนสุด').toEqual(
    ['PO-B1', 'PO-C1', 'PO-A1'].map(x => x + '|' + PN));
});

test('เครื่องที่ซิงค์มาได้ P/N เป็นตัวเลข รายการต้องไม่พังทั้งก้อน', async ({ page }) => {
  /* ⚠️ กับดักเดิมของ repo นี้ — ตัวเลขไม่มีเมธอด localeCompare พอเอาไปเรียงแล้ว throw
     **ทั้งรายการหายทั้งก้อน** ไม่ใช่แค่แถวเดียว (บั๊กแบบเดียวกับตารางราย P/N ใน CLAUDE.md)
     ⚠️ ต้องมี **สองใบขึ้นไป** ไม่งั้น comparator ไม่ถูกเรียกเลย แล้วเทสเขียวเองทั้งที่โค้ดพัง
        (บทเรียนจาก #119 ที่ CLAUDE.md เขียนไว้ตรง ๆ) */
  const num = (po, pn) => ({
    /* week เป็นสตริงตามของจริง — ตอนนำเข้าได้มาจากชื่อชีต ("WK 34") จึงไม่เคยเป็นตัวเลข
       ⚠️ ใส่ week เป็นตัวเลขแล้ว renderEntryTable()/renderDayTable() จะ throw ตั้งแต่โหลดหน้า
          (`(a.week||'').localeCompare` · มีมาก่อนใบนี้ ยกเป็นงานแยกแล้ว) ซึ่งคนละเรื่องกับที่ข้อนี้ตรวจ */
    id: po + '|' + pn, week: 'WK 34', poNo: po, pn, subName: 'TUE-U', orderQty: 9000,
    orderDate: '2026-08-03', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
  });
  const r = (id, proc, qty, d) => ({
    id: id + proc, date: d, orderId: id, process: proc, qty, note: '', deviceName: 't',
    createdAt: '', updatedAt: '', voided: false, _dirty: false
  });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  /* poNo เป็นสตริงตามของจริง (รหัส PO มีตัวอักษรเสมอ) · P/N เป็นตัวเลข ซึ่งเป็นเคสที่
     CLAUDE.md บันทึกไว้ว่าเกิดจริงบนเครื่องที่ซิงค์มา
     ⚠️ ใส่ poNo เป็นตัวเลขด้วยแล้ว renderEntryTable()/renderDayTable() จะ throw ตั้งแต่โหลดหน้า
        (`(a.poNo||'').localeCompare` · เป็นบั๊กที่มีมาก่อนใบนี้ ยกเป็นงานแยกแล้ว) */
  /* ⚠️ **สองใบต้องเกินเท่ากัน และ PO เดียวกัน** ไม่งั้นตัวเรียงไม่เคยไปถึงการเทียบ P/N เลย
        แล้วเทสเขียวเองทั้งที่ถอด String() ออก (ลองแล้ว M12 ไม่แดง จึงเปลี่ยนฉากเป็นแบบนี้)
        ฉากนี้ยังตรงกับของจริงด้วย — PO เดียวกันคนละ P/N มีได้สองใบ (ผู้ตรวจ #127 รอบ 2) */
  await openDash(page, [num('TM2609H001', 9000000002), num('TM2609H001', 9000000003)], [
    r('TM2609H001|9000000002', 'winding', 100, isoAgo(9)),
    r('TM2609H001|9000000002', 'assembly', 500, isoAgo(8)),
    r('TM2609H001|9000000003', 'winding', 100, isoAgo(9)),
    r('TM2609H001|9000000003', 'assembly', 500, isoAgo(8))
  ]);
  await openAnomList(page);

  expect(errs, 'ตัวเลขต้องไม่ทำให้สคริปต์ตาย').toEqual([]);
  await expect(page.locator('.wanr')).toHaveCount(2);
  // เกินเท่ากัน · PO เดียวกัน -> ตัดสินด้วย P/N ซึ่งเป็นตัวเลข = เส้นทางที่ String() กันไว้
  await expect(page.locator('.wanr').first()).toContainText('9000000002');
  await expect(page.locator('.wanr').last()).toContainText('9000000003');
});

test('หัวคอลัมน์ขวาสุดต้องบอกว่าเป็น "รายการ" ไม่ใช่ "ยอด" ซึ่งอ่านเป็นยอดสะสมได้', async ({ page }) => {
  /* ⚠️ เลขในช่องนั้นคือยอดของ record ล่าสุด ไม่ใช่ยอดสะสม · คอลัมน์ข้าง ๆ เขียน "(สะสม)" กำกับไว้
     คนจึงอ่านช่องนี้เป็นสะสมได้ง่าย แล้วสรุปว่าเลขสองช่องขัดกัน ทั้งที่คนละความหมาย
     บนหน้าที่มีไว้ไล่เลขผิด การอ่านผิดคู่คือเรื่องใหญ่ (ผู้ตรวจ #127 รอบ 2) */
  await openDash(page, [order('PO-H2', 9000, 'TUE-U')], [
    rec('w', 'PO-H2|' + PN, 'winding', 100, isoAgo(9)),
    rec('a1', 'PO-H2|' + PN, 'assembly', 400, isoAgo(8)),
    rec('a2', 'PO-H2|' + PN, 'assembly', 50, isoAgo(7))
  ]);
  await openAnomList(page);

  const head = await page.locator('.wanh').innerText();
  expect(head).toContain('รายการล่าสุด');
  expect(head, 'คำว่า "ยอดล่าสุด" อ่านเป็นยอดสะสมได้').not.toContain('ยอดล่าสุด');

  const txt = await rowText(page, 'PO-H2');
  expect(txt, 'ช่องซ้ายเป็นยอดสะสม').toContain('Assembly 450');
  expect(txt, 'ช่องขวาเป็นรายการล่าสุด ไม่ใช่สะสม').toContain(fmtDateTH(isoAgo(7)));
});
