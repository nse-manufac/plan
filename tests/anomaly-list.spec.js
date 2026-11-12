// เทสรายการใบที่ข้อมูลย้อนแย้ง — `anomalyListHtml()` · แถบ `#wtAnom` ของหน้ายอดค้างรายวัน
//
// ⚠️ ไฟล์นี้แยกออกมาจาก tests/dashboard.spec.js เมื่อ 12 พ.ย. 2569 ตอนลบแท็บ Dashboard ทั้งแท็บ
//    ของที่ตรวจไม่ได้เปลี่ยนเลย — เปลี่ยนแค่ "กล่องไหนบนจอ" เพราะรายการย้อนแย้งย้ายบ้าน
//    แถบของแดชบอร์ดใช้ `.wanom` / `#wanomToggle` · ของหน้านี้ใช้ `.wtanom` / `#wtAnomToggle`
//    ส่วนตัวรายการ (`.wanl` `.wanh` `.wanr`) เป็นของเดิมทั้งหมด เพราะเป็นฟังก์ชันเดียวกัน

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

async function pickSub(page, unit) {
  await page.selectOption('#wtSubFilter', unit);
  await page.waitForTimeout(250);
}

/* ───────── รายการใบที่ข้อมูลย้อนแย้ง (เจ้าของขอ 8 พ.ย. 2026) ─────────
 * แถบเตือนบอกแค่ "22 PO" ซึ่งตามต่อไม่ได้ — ของจริงบนเครื่องเจ้าของมี 22 ใบ
 * และไม่มีทางรู้ว่าใบไหน · รายการใต้แถบคือส่วนที่ทำให้ตามต่อได้ */

/** ใบที่ยอดขั้นหลังมากกว่าขั้นหน้า = ย้อนแย้ง */
const anomRecs = (po, pairs) => Object.entries(pairs).map(([proc, qty], i) =>
  rec(po + '-' + proc, po + '|' + PN, proc, qty, isoAgo(10 + i)));

async function openAnomList(page) {
  await page.click('#wtAnomToggle');
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
  await openWt(page,
    [order('PO-BAD', 5000, 'TUE-U'), order('PO-OK', 5000, 'TUE-U')],
    [...anomRecs('PO-BAD', { winding: 1500, assembly: 2000 }),
     ...anomRecs('PO-OK',  { winding: 2000, assembly: 1500 })]);

  await expect(page.locator('.wtanom')).toContainText('ข้อมูลย้อนแย้ง 1 ใบ');
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
  await openWt(page, [order('PO-M', 9000, 'TUE-U')],
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
  await openWt(page, [order('PO-V', 9000, 'TUE-U')], recs);
  await openAnomList(page);

  const txt = await rowText(page, 'PO-V');
  /* ⚠️ ไม่ข้ามรายการที่ยกเลิก แล้วช่องนี้จะชี้ไปที่รายการที่ไม่ได้ทำให้เกิดปัญหา
     คนเปิดไปดูแล้วเห็นว่ามันถูกลบไปแล้ว จึงสรุปว่าแถบเตือนเพี้ยน */
  expect(txt, 'ต้องเป็นวันของรายการที่ยังอยู่').toContain(fmtDateTH(isoAgo(8)));
  expect(txt).not.toContain(fmtDateTH(isoAgo(1)));
  expect(txt).toContain('เครื่องไลน์ A');
});

test('กดเลข PO ต้องเด้งไปหน้าแก้ไขรายการ และล้างตัวกรองที่ค้างอยู่ให้ด้วย', async ({ page }) => {
  await openWt(page, [order('PO-J', 9000, 'TUE-U')],
    anomRecs('PO-J', { winding: 100, assembly: 500 }));

  /* ตัวกรองที่ค้างจากการใช้ครั้งก่อน — ฉากจริงคือคนเพิ่งไปดูยอดของวันหนึ่งมา
     ⚠️ ไม่ล้าง แล้วตารางจะว่าง คนอ่านว่า "ใบนี้ไม่มีรายการ" ทั้งที่ถูกกรองทิ้ง
        ซึ่งแย่กว่าไม่มีปุ่มนี้เลย เพราะมันตอบผิดแทนที่จะไม่ตอบ */
  await page.click('.tab-btn[data-tab="entry"]');
  await page.fill('#recFilterDate', isoAgo(99));
  await page.selectOption('#recFilterProcess', 'inspection');
  await page.click('.tab-btn[data-tab="wiptrend"]');

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
  await openWt(page,
    [order('PO-U9', 5000, 'TUE-U'), order('PO-H9', 5000, 'TUE-H')],
    [...anomRecs('PO-U9', { winding: 100, assembly: 500 }),
     ...anomRecs('PO-H9', { winding: 100, assembly: 500 })]);

  await openAnomList(page);
  await expect(page.locator('.wanr')).toHaveCount(2);

  await pickSub(page, 'TUE-U');
  /* ⚠️ รายการต้องหุบตามตัวกรอง ไม่ใช่คิดจาก activeOrders() ทั้งก้อน
     ไม่งั้นแถบบอก 1 PO แต่กางออกมาได้ 2 แถว = คนเลิกเชื่อทั้งแถบ */
  await expect(page.locator('.wtanom')).toContainText('ข้อมูลย้อนแย้ง 1 ใบ');
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
  await openWt(page, [o], [
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
  await openWt(page, [order('PO-W', 9000, 'TUE-U')],
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
  await openWt(page, [order('PO-N', 9000, 'TUE-U')],
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
  await openWt(page, [order('PO-F', 9000, 'TUE-U')],
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
  await openWt(page, [
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
  await openWt(page, [num('TM5267H902', 9000000002), num('TM5267H902', 9000000003)], [
    r('TM5267H902|9000000002', 'winding', 100, isoAgo(9)),
    r('TM5267H902|9000000002', 'assembly', 500, isoAgo(8)),
    r('TM5267H902|9000000003', 'winding', 100, isoAgo(9)),
    r('TM5267H902|9000000003', 'assembly', 500, isoAgo(8))
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
  await openWt(page, [order('PO-H2', 9000, 'TUE-U')], [
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

test('G2 — โฟกัสบนปุ่มเลข PO ต้องไม่ตกไป BODY ตอนหน้าถูกวาดใหม่', async ({ page }) => {
  /* ⚠️ ซิงค์อัตโนมัติวาดแดชบอร์ดใหม่ทุก 20 วิ · คนที่ Tab มาค้างบนปุ่มเลข PO
     จะตกไป BODY เองโดยไม่ได้กดอะไรเลย แล้วต้อง Tab จากต้นหน้าใหม่ (ผู้ตรวจ #127 รอบ 5)
     ปุ่มกาง (#wtAnomToggle) มีตัวคืนโฟกัสมาตั้งแต่รอบ 1 แต่ปุ่มในแถวไม่มี */
  await openWt(page, [order('PO-R1', 9000, 'TUE-U'), order('PO-R2', 9000, 'TUE-U')], [
    ...anomRecs('PO-R1', { winding: 100, assembly: 900 }),
    ...anomRecs('PO-R2', { winding: 100, assembly: 400 })
  ]);
  await openAnomList(page);

  await page.locator('[data-anom-po="PO-R2"]').focus();
  // วาดใหม่แบบเดียวกับที่รอบซิงค์ทำ
  await page.evaluate(() => renderWipTrend());

  expect(await page.evaluate(() => {
    const a = document.activeElement;
    return a && a.dataset ? (a.dataset.anomPo || a.tagName) : 'NONE';
  }), 'ต้องกลับมาที่ปุ่มเดิม ไม่ใช่ปุ่มแรกและไม่ใช่ BODY').toBe('PO-R2');
});

test('G2 — โฟกัสบนปุ่มกางก็ต้องไม่ตกไป BODY ตอนหน้าถูกวาดใหม่', async ({ page }) => {
  /* ปุ่มกางมีตัวคืนโฟกัสมาตั้งแต่รอบ 1 แต่ **ไม่เคยมีเทสจับ** — ปุ่มในแถวมีแล้ว
     ผู้ตรวจ #127 รอบ 6 ทักว่าการรื้อบล็อกนั้นครั้งถัดไปจะไม่มีอะไรฟ้อง */
  await openWt(page, [order('PO-T1', 9000, 'TUE-U')],
    anomRecs('PO-T1', { winding: 100, assembly: 500 }));

  await page.locator('#wtAnomToggle').focus();
  await page.evaluate(() => renderWipTrend());   // แบบเดียวกับที่รอบซิงค์ทำทุก 20 วิ

  expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
    .toBe('wtAnomToggle');
});

