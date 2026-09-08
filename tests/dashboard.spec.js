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
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
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

/** ยอดของ process หนึ่งในวันนี้ ที่กราฟวาดออกมาจริง — อ่านจาก <title> ของแท่ง */
async function barToday(page, process) {
  // <title> ใน SVG ไม่ถูกวาดออกจอ innerText จึงว่าง ต้องอ่าน textContent ตรง ๆ
  const titles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#chartWrap svg title'), t => t.textContent));
  const hit = titles.find(t => t.startsWith(todayISO() + ' ' + process + ':'));
  return hit ? Number(hit.split(':')[1].trim()) : null;
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

test('ช่วงยาว แท่งต้องไม่ถูกบีบ — ยอมให้กว้างเกินกล่องแล้วเลื่อนดูแทน', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openDash(page, ORDERS, RECORDS);
  await page.selectOption('#chartRange', '90');
  await page.waitForTimeout(150);
  const { wrap, svg } = await chartWidths(page);
  expect(svg, '90 วัน ต้องกว้างอย่างน้อยวันละ 14px เท่าของเดิม').toBeGreaterThanOrEqual(90 * 14);
  expect(svg, 'และต้องกว้างเกินกล่อง เพื่อให้ .chart-wrap เลื่อนดูได้').toBeGreaterThan(wrap);
});

test('แท่งต้องโตตามช่วงที่เลือก ไม่ใช่ผอมเท่าเดิมทุกช่วง', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openDash(page, ORDERS, RECORDS);
  const barW = async () => page.evaluate(() =>
    Number(document.querySelector('#chartWrap svg rect').getAttribute('width')));

  await page.selectOption('#chartRange', '7');
  await page.waitForTimeout(150);
  const wide = await barW();
  await page.selectOption('#chartRange', '90');
  await page.waitForTimeout(150);
  const narrow = await barW();
  expect(wide, 'ช่วง 7 วันมีที่ว่างเหลือเฟือ แท่งต้องหนากว่าเพดานเดิม 12px')
    .toBeGreaterThan(12);
  expect(wide, 'และต้องหนากว่าตอนเลือกช่วงยาว').toBeGreaterThan(narrow);
});
