// Smoke test ผูกกับ INVARIANTS.md — ชื่อเทสอ้างข้อกฎตรง ๆ
// เทสที่แดงจะบอกได้ทันทีว่าละเมิดกฎข้อไหน ไม่ต้องไปไล่อ่าน diff
//
// ── ทำไมเทสนี้ขับผ่าน DOM ไม่ใช่เรียกฟังก์ชันตรง ๆ ──────────────────
// เดิมโค้ดทั้งหมดของแอปถูกห่ออยู่ใน IIFE จึงเรียกฟังก์ชันจากเทสไม่ได้เลย
// ตั้งแต่ใบ 02 ของการแยกไฟล์ (CLAUDE.md §3.1) ไม่มีเปลือกแล้ว ฟังก์ชันระดับบนสุดอยู่ที่ global
// แต่เทสชุดนี้ยังขับผ่าน DOM ต่อโดยตั้งใจ: seed localStorage → กดปุ่มจริง → ตรวจผลจาก localStorage และ DOM
// ซึ่งเป็นการทดสอบที่ใกล้เคียงกับสิ่งที่ผู้ใช้เจอจริง · กฎล้วนใน core/ ให้เทสด้วย node แทน (tests/node/)

const { test, expect } = require('@playwright/test');
// ซอร์สของแอปอ่านผ่านตัวช่วยเท่านั้น — appHtml() สำหรับเรื่องของ HTML เอง (เลขรุ่น)
// appSource() สำหรับ "ต้องมี/ต้องไม่มี X ในแอป" ซึ่งต้องเห็นทุกไฟล์ที่หน้าโหลด (CLAUDE.md §3.1 ข้อ 7)
const { appHtml, appSource } = require('./app-source');
const { readSaved, waitReady } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const TEST_DATE = '2026-08-03';

function seedState(records = [], orders = null) {
  return {
    version: 1,
    deviceName: 'test',
    deadlineOffsets: { winding: 10, assembly: 17, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: orders || [
      { id: 'O1', week: 'W31', poNo: 'PO-1', pn: 'PN-1', orderQty: 100,
        orderDate: '2026-08-01', status: 'active',
        importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false },
      { id: 'O2', week: 'W31', poNo: 'PO-2', pn: 'PN-2', orderQty: 50,
        orderDate: '2026-08-01', status: 'active',
        importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }
    ],
    records,
    importHistory: []
  };
}

/* ── ยกเลิกใบสั่งที่นำเข้าผิด ──────────────────────────────────────────
 *
 * พนักงานแจ้ง 5 ก.ย. 2026 — นำเข้าแผนแล้วรหัส PO ผิด หรือลูกค้ายกเลิก PO ทีหลัง
 * แล้วลบใบนั้นไม่ได้เลย ค้างอยู่บนทุกหน้าตลอดไป
 *
 * ⚠️ ยกเลิก ไม่ใช่ลบ (B1) — แถวต้องยังอยู่ใน state.orders พร้อม _dirty
 *    ลบออกจาก array เฉย ๆ รอบซิงค์ถัดไปจะดึงกลับมาจากเซิร์ฟเวอร์ */

async function openImportTab(page, orders) {
  await openApp(page, [], orders);
  await page.click('.tab-btn[data-tab="import"]');
  await page.waitForTimeout(100);
}

const voidRowPos = page => page.$$eval('#orderVoidTable tbody tr td:first-child',
  t => t.map(x => x.textContent.trim()));

test('ยกเลิกใบสั่ง — ต้องพิมพ์ค้นหาก่อน แล้วกดยกเลิกได้', async ({ page }) => {
  await openImportTab(page);
  expect(await voidRowPos(page), 'ยังไม่พิมพ์อะไร ต้องไม่ไล่ใบสั่งทั้งหมดออกมาให้กดผิด')
    .toEqual(['พิมพ์ PO หรือ P/N ที่ต้องการยกเลิกก่อน']);

  await page.fill('#voidSearch', 'PO-1');
  await page.waitForTimeout(150);
  expect(await voidRowPos(page)).toEqual(['PO-1']);

  page.once('dialog', d => d.accept());
  await page.click('#orderVoidTable [data-void]');
  await page.waitForTimeout(200);

  const orders = (await readSaved(page, K_STATE)).orders;
  expect(orders.length, 'B1 — แถวต้องยังอยู่ ไม่ใช่ splice ทิ้ง').toBe(2);
  const o1 = orders.find(o => o.id === 'O1');
  expect(o1.voided, 'ต้องถูกทำเครื่องหมายว่ายกเลิก').toBe(true);
  expect(o1._dirty, 'ต้องถูกมาร์คให้ซิงค์ขึ้นไป').toBe(true);
});

test('ใบสั่งที่ยกเลิกแล้ว ต้องหายจากหน้ายอดค้างรายวันและหน้าบันทึกยอดรายวัน', async ({ page }) => {
  const orders = seedState().orders.map(o =>
    o.id === 'O1' ? Object.assign({}, o, { voided: true }) : o);
  await openApp(page, [], orders);

  /* ⚠️ ข้อนี้เคยอ่านที่ตารางของแดชบอร์ด ซึ่งถูกลบทั้งแท็บเมื่อ 12 พ.ย. 2569
     หน้ายอดค้างรายวันก็เดินผ่าน activeOrders() เหมือนกัน · กราฟ PO นับเป็น "ใบ" จึงเห็นความต่างได้ชัด */
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(300);
  const po = await page.locator('#wtPo rect[data-proc="winding"] title').textContent();
  expect(po, 'เหลือใบเดียว ไม่นับใบที่ยกเลิก').toContain('1 ใบ');

  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(150);
  const entry = await page.$$eval('#entryTable tbody tr', t => t.map(x => x.textContent));
  expect(entry.join(' '), 'หน้าบันทึกยอดรายวันต้องไม่มีใบที่ยกเลิก').not.toContain('PO-1');
});

test('ยอดที่เคยคีย์ไว้ต้องไม่ถูกลบ และยังตามที่มาได้ว่าเป็นของใบไหน', async ({ page }) => {
  /* ⚠️ orderById ต้องมองเห็นใบที่ยกเลิกด้วย ไม่งั้นหน้าแก้ไข/ลบรายการจะโชว์ PO เป็น "?"
   *    แล้วคนตามไม่ได้ว่ายอดนั้นของใบไหน — กู้คืนก็ไม่รู้ว่าต้องกู้ใบอะไร */
  const orders = seedState().orders.map(o =>
    o.id === 'O1' ? Object.assign({}, o, { voided: true }) : o);
  await openApp(page, [rec('R1', 'O1', 'winding', TEST_DATE, 30)], orders);

  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(150);
  const rows = await page.$$eval('#recordEditorTable tbody tr', t => t.map(x => x.textContent));
  expect(rows.join(' '), 'ยอดต้องยังอยู่ในตารางแก้ไข/ลบรายการ').toContain('PO-1');
  expect(rows.join(' '), 'และต้องไม่กลายเป็นเครื่องหมายคำถาม').not.toContain('?');
});

test('กู้คืนใบสั่งที่ยกเลิกแล้ว ต้องกลับมาครบเหมือนเดิม', async ({ page }) => {
  const orders = seedState().orders.map(o =>
    o.id === 'O1' ? Object.assign({}, o, { voided: true }) : o);
  await openImportTab(page, orders);

  await page.fill('#voidSearch', 'PO-1');
  await page.waitForTimeout(150);
  expect(await voidRowPos(page), 'ยังไม่ติ๊กแสดงใบที่ยกเลิก ต้องไม่เห็น')
    .toEqual(['ไม่พบใบสั่งที่ตรงกับที่ค้นหา']);

  await page.check('#voidShowVoided');
  await page.waitForTimeout(150);
  expect(await voidRowPos(page)).toEqual(['PO-1']);

  await page.click('#orderVoidTable [data-unvoid]');
  await page.waitForTimeout(200);

  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(200);
  const entry = await page.$$eval('#entryTable tbody tr', t => t.map(x => x.textContent));
  expect(entry.join(' '), 'กู้คืนแล้วต้องกลับมาในหน้าคีย์ยอด').toContain('PO-1');
});

/** วันของ N วันก่อน ในรูปแบบ YYYY-MM-DD ตามนาฬิกาเครื่อง — ให้ตรงกับ todayISO() ของแอป */
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function rec(id, orderId, process, date, qty, voided = false) {
  return {
    id, date, orderId, process, qty, note: '', deviceName: 'test',
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    voided, _dirty: false
  };
}

async function openApp(page, records = [], orders = null) {
  await page.addInitScript(([key, st]) => {
    localStorage.setItem(key, JSON.stringify(st));
  }, [K_STATE, seedState(records, orders)]);
  await page.goto(APP);
  await waitReady(page);
  await page.waitForSelector('.tab-btn[data-tab="entry"]');
}

/** เข้าหน้าคีย์ยอด เลือกขั้นตอน และตั้งวันที่ให้แน่นอน */
async function gotoEntry(page, process = 'winding', date = TEST_DATE) {
  await page.click('.tab-btn[data-tab="entry"]');
  await page.click(`#procBtn-${process}`);
  await page.fill('#entryDate', date);
  await page.waitForTimeout(100);
}

async function typeQty(page, orderId, value) {
  const input = page.locator(`#entryTable input.row-input[data-order="${orderId}"]`);
  await input.fill(String(value));
  await input.press('Tab');          // change event ยิงตอนออกจากช่อง
  await page.waitForTimeout(150);
}

/* ── D3 · ของที่ยังไม่ได้ส่งขึ้น ห้ามถูกทับ ──────────────────────────────
 *
 * INVARIANTS เขียนไว้ว่า "ละเมิดข้อนี้ = ยอดที่พนักงานคีย์ไว้หายโดยไม่มีใครรู้"
 * แต่ก่อนหน้านี้ไม่มีเทสข้อไหนคุมเลย — fixture ทุกไฟล์ตั้ง _dirty:false หมด
 * ลองถอด `if(local._dirty) continue` ออกจาก mergeRowsInto แล้วเทสทั้ง 182 ข้อยังเขียว
 *
 * ── จังหวะที่ทำให้เกิดจริง ────────────────────────────────────────────
 * doSync คำนวณรายชื่อแถวที่จะ push "ครั้งเดียว" ตอนต้น แล้วค่อย await
 * ถ้าพนักงานคีย์ยอดระหว่างที่ push ก้อนนั้นยังไม่กลับมา แถวที่เพิ่งคีย์
 * จะไม่ได้อยู่ในก้อนที่ push และยังเป็น _dirty อยู่ตอนที่ pull ลงมา merge
 * ถ้าไม่มีด่าน D3 ยอดที่เพิ่งคีย์จะถูกของบนเซิร์ฟเวอร์ทับทันที
 *
 * เทสนี้สร้างจังหวะนั้นตรง ๆ ด้วยการ "ค้าง" คำตอบของ push ไว้
 * แล้วคีย์ยอดระหว่างนั้น ก่อนปล่อยให้ sync เดินต่อ */
test('D3 — ยอดที่คีย์ระหว่างซิงค์ ต้องไม่ถูกของบนเซิร์ฟเวอร์ทับ', async ({ page }) => {
  await page.clock.install();

  const ORDERS = [{ id: 'O1', week: 'W31', poNo: 'PO-1', pn: 'PN-1', orderQty: 1000,
    orderDate: '2026-08-01', status: 'active', subName: 'TUE-U',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }];

  // R1 ซิงค์ไปแล้ว (จะถูกคีย์ทับระหว่าง push ค้าง) · R2 ยังไม่ได้ส่ง (ไว้บังคับให้เกิด push)
  const R1 = rec('R1', 'O1', 'winding', TEST_DATE, 100);
  const R2 = Object.assign(rec('R2', 'O1', 'assembly', TEST_DATE, 50), { _dirty: true });

  /* สิ่งที่เซิร์ฟเวอร์จะส่งกลับมา — แถวเดียวกับ R1 แต่ยอดต่างและเวลาใหม่กว่ามาก
   *
   * ⚠️ ส่งแถวใหม่ SV1 มาด้วย เพื่อใช้เป็น "สัญญาณว่า merge ทำงานเสร็จแล้ว"
   *    เทสรอบแรกไม่มีตัวนี้ แล้วรอด้วยการ poll ว่า qty เป็น 700 ซึ่งเป็นจริง
   *    ตั้งแต่ตอนพิมพ์เสร็จ — เทสจึงจบก่อนที่ pull จะมาถึงด้วยซ้ำ
   *    ถอดด่าน D3 ออกแล้วยังเขียว = ไม่ได้ตรวจอะไรเลย (พิสูจน์ด้วยการย้อนโค้ดแล้ว) */
  const fromServer = Object.assign(rec('R1', 'O1', 'winding', TEST_DATE, 999),
    { updatedAt: '2099-01-01T00:00:00.000Z' });
  const marker = Object.assign(rec('SV1', 'O1', 'support', TEST_DATE, 7),
    { updatedAt: '2099-01-01T00:00:00.000Z' });

  let releasePush;
  const pushHeld = new Promise(res => { releasePush = res; });
  let pushSeen = false;

  await page.route('**/exec', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action === 'pushRows' && body.table === 'Records') {
      pushSeen = true;
      await pushHeld;                    // ค้างไว้ให้ทันคีย์ยอดระหว่างนี้
    }
    const rows = (body.action === 'pullRows' && body.table === 'Records') ? [fromServer, marker] : [];
    await route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ ok: true, rows, serverTime: '2026-08-26T00:00:00.000Z' }) });
  });

  await page.addInitScript(([k, sk, st]) => {
    localStorage.setItem(k, JSON.stringify(st));
    localStorage.setItem(sk, JSON.stringify({ url: 'https://example.test/exec', token: 't', auto: true }));
  }, [K_STATE, 'tue_order_tracker_sync_v1',
      Object.assign(seedState([R1, R2], ORDERS), { deliveryNotes: [], deltaWip: [] })]);

  await page.goto(APP);
  await waitReady(page);
  await page.click('.tab-btn[data-tab="entry"]');
  await page.fill('#entryDate', TEST_DATE);
  await page.waitForTimeout(150);

  // เดินนาฬิกาให้ตัวจับเวลาซิงค์ทำงาน แล้วรอจนแน่ใจว่า push ถูกยิงและกำลังค้างอยู่
  await page.clock.runFor(21000);
  await expect.poll(() => pushSeen, { timeout: 5000 }).toBe(true);

  // ระหว่างที่ push ยังค้าง พนักงานคีย์ยอดของ R1 ทับ — แถวนี้จึงเป็น _dirty
  // และไม่ได้อยู่ในก้อนที่กำลัง push
  await typeQty(page, 'O1', 700);
  expect((await readRecords(page)).find(r => r.id === 'R1')._dirty,
    'แถวที่เพิ่งคีย์ต้องเป็น _dirty และไม่ได้อยู่ในก้อนที่กำลัง push').toBe(true);

  releasePush();

  // รอจนแถวใหม่จากเซิร์ฟเวอร์โผล่ = merge ทำงานจบแล้วจริง ค่อยตรวจว่า R1 รอดไหม
  await expect.poll(async () =>
    (await readSaved(page, K_STATE)).records.some(r => r.id === 'SV1'),
    { timeout: 5000, message: 'merge ต้องทำงานจริง ไม่งั้นเทสนี้ไม่ได้ตรวจอะไรเลย' }).toBe(true);

  const r1 = (await readRecords(page)).find(r => r.id === 'R1');
  expect(r1.qty, 'ยอดที่พนักงานคีย์ต้องอยู่ ไม่ใช่ถูกของบนเซิร์ฟเวอร์ทับ').toBe(700);
  expect(r1.updatedAt, 'และต้องไม่รับเวลาของเซิร์ฟเวอร์มาด้วย').not.toBe('2099-01-01T00:00:00.000Z');
});

function readRecords(page) {
  return readSaved(page, K_STATE).then(s => s.records);
}

// ────────────────────────────────────────────────────────────────────

test('แอปเปิดขึ้นได้ ไม่มี error ที่ทำให้ใช้งานไม่ได้', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push('uncaught: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await openApp(page);
  await gotoEntry(page);

  await expect(page.locator(`#entryTable input.row-input[data-order="O1"]`)).toBeVisible();
  expect(errors, 'มี error ตอนเปิดแอป').toEqual([]);
});

test('F2 — แอปต้องทำงานได้โดยไม่ต้องต่ออินเทอร์เน็ต', async ({ page }) => {
  const blocked = [];
  // ตัดทุก request ที่ออกนอกเครื่อง — ถ้าแอปพึ่ง CDN อยู่จะพังทันที
  await page.route('**', route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:8124') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    blocked.push(url);
    return route.abort();
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await openApp(page);
  await gotoEntry(page);
  await typeQty(page, 'O1', 7);

  const records = await readRecords(page);
  expect(errors, 'แอปพังตอนไม่มีเน็ต — แปลว่ามี dependency ภายนอกหลุดเข้ามา').toEqual([]);
  expect(records, 'บันทึกยอดไม่ได้ตอนออฟไลน์').toHaveLength(1);
  expect(blocked, `แอปพยายามเรียกไฟล์จากภายนอก: ${blocked.join(', ')}`).toEqual([]);
});

test('A2 — คีย์ยอดซ้ำ order + ขั้นตอน + วันเดียวกัน ต้องทับของเดิม ไม่เกิดแถวใหม่', async ({ page }) => {
  await openApp(page);
  await gotoEntry(page);

  await typeQty(page, 'O1', 10);
  expect(await readRecords(page)).toHaveLength(1);

  await typeQty(page, 'O1', 25);
  const records = await readRecords(page);

  expect(records, 'คีย์ทับต้องไม่สร้างแถวใหม่ — กุญแจคือ orderId|process|date').toHaveLength(1);
  expect(records[0].qty).toBe(25);
  expect(records[0].orderId).toBe('O1');
  expect(records[0].process).toBe('winding');
  expect(records[0].date).toBe(TEST_DATE);
});

test('A2 — คนละ order หรือคนละขั้นตอน ต้องแยกแถวกัน', async ({ page }) => {
  await openApp(page);

  await gotoEntry(page, 'winding');
  await typeQty(page, 'O1', 10);
  await typeQty(page, 'O2', 20);

  await gotoEntry(page, 'assembly');
  await typeQty(page, 'O1', 5);

  const records = await readRecords(page);
  expect(records).toHaveLength(3);
  const key = r => `${r.orderId}|${r.process}`;
  expect(records.map(key).sort()).toEqual(['O1|assembly', 'O1|winding', 'O2|winding']);
});

test('B2 — เคลียร์ช่องให้ว่าง ต้องไม่ลบข้อมูลที่บันทึกไว้', async ({ page }) => {
  await openApp(page);
  await gotoEntry(page);

  await typeQty(page, 'O1', 42);
  expect((await readRecords(page))[0].qty).toBe(42);

  await typeQty(page, 'O1', '');          // เคลียร์ช่อง
  const records = await readRecords(page);

  expect(records, 'เคลียร์ช่องแล้วรายการต้องยังอยู่ (ถ้าจะแก้ให้พิมพ์ 0 ทับ)').toHaveLength(1);
  expect(records[0].qty, 'ค่าเดิมต้องไม่ถูกเปลี่ยน').toBe(42);
});

test('B2 — พิมพ์ 0 ทับ ต้องเปลี่ยนค่าเป็น 0 ได้จริง', async ({ page }) => {
  await openApp(page);
  await gotoEntry(page);

  await typeQty(page, 'O1', 42);
  await typeQty(page, 'O1', 0);

  const records = await readRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0].qty).toBe(0);
});

test('A1 + B1 — รายการที่ยกเลิกแล้วต้องไม่ถูกนับในยอดสะสม แต่ต้องยังอยู่ในระบบ', async ({ page }) => {
  await openApp(page, [
    rec('R1', 'O1', 'winding', '2026-08-01', 30),
    rec('R2', 'O1', 'winding', '2026-08-02', 70, true)   // ยกเลิกแล้ว — ห้ามนับ
  ]);
  await gotoEntry(page, 'winding');

  /* ยอดสะสมย้ายไปอยู่ใต้แถบสถานะในช่อง Order Qty แล้ว (9 ก.ย. 2026)
     อ่านผ่าน .cum ไม่ใช่ลำดับคอลัมน์ — ลำดับเปลี่ยนได้อีก แต่ความหมายของ .cum ไม่เปลี่ยน */
  const cum = await page.locator('#entryTable tbody tr', { has: page.locator('input[data-order="O1"]') })
    .locator('.cum').innerText();

  expect(cum.trim(), 'ยอดสะสมต้องเป็น 30 — รายการที่ยกเลิกไม่ถูกนับ').toBe('30');

  const records = await readRecords(page);
  expect(records, 'รายการที่ยกเลิกต้องยังอยู่ ไม่ถูกลบ (ไม่งั้น sync จะดึงกลับมาใหม่)').toHaveLength(2);
  expect(records.find(r => r.id === 'R2').voided).toBe(true);
});

test('B3 — พิมพ์ค่าใหม่ทับรายการที่ยกเลิกไปแล้ว ต้องกู้คืนรายการนั้น', async ({ page }) => {
  await openApp(page, [rec('R1', 'O1', 'winding', TEST_DATE, 30, true)]);
  await gotoEntry(page, 'winding');

  await typeQty(page, 'O1', 55);

  const records = await readRecords(page);
  expect(records, 'ต้องกู้แถวเดิม ไม่ใช่สร้างแถวใหม่').toHaveLength(1);
  expect(records[0].voided, 'พิมพ์ทับแล้วต้อง un-void').toBe(false);
  expect(records[0].qty).toBe(55);
});

test('C1 — วันปฏิทินต้องเป็น YYYY-MM-DD ส่วน timestamp ต้องคงเวลาเต็มไว้', async ({ page }) => {
  await openApp(page);
  await gotoEntry(page);
  await typeQty(page, 'O1', 12);

  const r = (await readRecords(page))[0];
  expect(r.date, 'ฟิลด์ date ต้องเป็นวันปฏิทินล้วน').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(r.createdAt, 'createdAt ต้องเป็น ISO เต็ม ห้ามถูก normalize ตัดเวลาทิ้ง')
    .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  expect(r.updatedAt, 'updatedAt ต้องเป็น ISO เต็ม ห้ามถูก normalize ตัดเวลาทิ้ง')
    .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('E3 — ถ้าข้อมูลใน localStorage เสีย แอปต้องยังเปิดขึ้น ไม่ค้าง', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(k => localStorage.setItem(k, '{ นี่ไม่ใช่ JSON'), K_STATE);
  await page.goto(APP);
  await waitReady(page);

  await expect(page.locator('.tab-btn[data-tab="entry"]')).toBeVisible();
  expect(errors, 'JSON เสียแล้วแอปต้อง fallback เป็น defaultState ไม่ใช่พังทั้งหน้า').toEqual([]);
});

test('F4 — หน้าจอต้องโชว์เลขรุ่นที่ตรงกับ <meta name="app-version">', async ({ page }) => {
  const src = appHtml();
  const m = /<meta\s+name="app-version"\s+content="([^"]*)"/i.exec(src);
  expect(m, 'ไม่พบ <meta name="app-version"> ในไฟล์แอป').not.toBeNull();
  expect(m[1], 'เลขรุ่นต้องเป็นรูปแบบ YYYY-MM-DD.ลำดับ').toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);

  await openApp(page);
  await expect(page.locator('#appVersion'), 'ผู้ใช้ต้องอ่านเลขรุ่นจากหัวจอได้เลย ไม่ต้องกดอะไรลึก ๆ')
    .toHaveText(m[1]);
});

test('F4 — เจอรุ่นใหม่บนเซิร์ฟเวอร์ ต้องขึ้นแถบให้คนกดเอง ห้ามโหลดหน้าใหม่เอง', async ({ page }) => {
  // ดักเฉพาะคำขอที่แอปยิงไปเช็กรุ่น (มี _v= กันแคช) แล้วตอบเป็นไฟล์ที่เลขรุ่นใหม่กว่า
  await page.route(
    url => url.searchParams.has('_v'),
    route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<meta name="app-version" content="2099-12-31.9">'
    })
  );

  await openApp(page);
  await page.evaluate(() => { window.__notReloaded = true; });

  await expect(page.locator('#updateBadge'), 'มีรุ่นใหม่แล้วต้องขึ้นแถบบอกที่หัวจอ').toBeVisible();
  expect(await page.locator('.modal:visible').count(), 'ห้ามมี modal เด้งมาขวางหน้าคีย์ยอด (G2)').toBe(0);
  expect(await page.evaluate(() => window.__notReloaded === true),
    'ห้ามโหลดหน้าใหม่เอง ต้องรอให้คนกดปุ่ม').toBe(true);

  // กดปุ่มแล้วต้องโหลดใหม่แบบข้ามแคช (ไม่งั้นเบราว์เซอร์หยิบไฟล์เก่ากลับมาให้อีก)
  // ยอดที่คีย์ค้างไว้ถูกบันทึกตอนกดปุ่ม เพราะการกดทำให้ออกจากช่องกรอกก่อน
  await gotoEntry(page);
  await typeQty(page, 'O1', 9);
  expect(await readRecords(page), 'ยอดต้องถูกบันทึกก่อนโหลดหน้าใหม่').toHaveLength(1);
  await page.click('#updateBadge');
  await page.waitForURL(/_v=/);
});

test('F4 + F2 — เช็กรุ่นไม่ได้ (เน็ตหลุด) ต้องเงียบ ไม่ทำให้แอปใช้งานไม่ได้', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(url => url.searchParams.has('_v'), route => route.abort());

  await openApp(page);
  await gotoEntry(page);
  await typeQty(page, 'O1', 8);

  expect(errors, 'เช็กรุ่นไม่ได้ต้องไม่โยน error ออกมา').toEqual([]);
  expect(await readRecords(page), 'เช็กรุ่นไม่ได้ต้องยังคีย์ยอดได้ตามปกติ').toHaveLength(1);
  await expect(page.locator('#updateBadge'), 'เช็กไม่ได้ = ห้ามเดาว่ามีรุ่นใหม่').toBeHidden();
});

/* ── ตัวกรอง Sub-Name ที่หน้าบันทึกยอดรายวัน ────────────────────────────
 * ผู้ใช้ขอ 4 ก.ย. 2026 — คีย์ยอดทีละหน่วยจะได้ไม่ต้องเลื่อนผ่านใบของหน่วยอื่น */

const ENTRY_SUB_ORDERS = [
  { id: 'H1', week: 'W31', poNo: 'TM5267H179', pn: 'PN-1', subName: 'TUE-H', orderQty: 100,
    orderDate: '2026-08-01', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false },
  { id: 'U1', week: 'W31', poNo: 'TM5267U176', pn: 'PN-2', subName: 'TUE-U', orderQty: 200,
    orderDate: '2026-08-02', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false },
  // ⚠️ ใบที่ Sub-Name ว่าง (รหัส PO ตัดสินไม่ได้) ต้องไม่ไปโผล่ในกลุ่มไหน
  { id: 'X1', week: 'W31', poNo: 'TM5267HU80', pn: 'PN-3', subName: '', orderQty: 300,
    orderDate: '2026-08-03', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false },
  /* ⚠️ ใบที่ค่าที่เก็บไว้ "ขัดกับ" ตัวอักษรใน PO — รหัสมี H แต่ Sub-Name เป็น TUE-U
   *    เป็นสภาพจริงของใบที่นำเข้าก่อน 4 ก.ย. 2026 และยังไม่ได้กดปุ่มคำนวณใหม่
   *    ตัวกรองต้องใช้ "ค่าที่เก็บไว้" ให้ตรงกับหน้าอื่นที่จับกลุ่มด้วย Sub-Name (ใบส่งสินค้า · FG)
   *    ถ้าไปเดาจากรหัส PO ตรงนี้ ใบเดียวกันจะอยู่คนละกลุ่มในแต่ละหน้า */
  { id: 'D1', week: 'W31', poNo: 'TM5267H901', pn: 'PN-4', subName: 'TUE-U', orderQty: 400,
    orderDate: '2026-08-04', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }
];

test('หน้าบันทึกยอดรายวันกรองตาม Sub-Name ได้', async ({ page }) => {
  await openApp(page, [], ENTRY_SUB_ORDERS);
  await gotoEntry(page);

  const pos = () => page.$$eval('#entryTable tbody tr td:nth-child(3)',
    t => t.map(x => x.innerText.trim()));
  const opts = await page.$$eval('#entrySubFilter option', o => o.map(x => x.value));
  expect(opts, 'รายชื่อต้องมาจากข้อมูลจริง ไม่ fix ไว้ในโค้ด')
    .toEqual(['', 'TUE-H', 'TUE-U']);

  expect(await pos(), 'ยังไม่กรอง ต้องเห็นครบทุกใบ')
    .toEqual(['TM5267H179', 'TM5267U176', 'TM5267HU80', 'TM5267H901']);

  await page.selectOption('#entrySubFilter', 'TUE-H');
  await page.waitForTimeout(150);
  expect(await pos(), 'เลือก TUE-H ต้องเหลือเฉพาะใบของหน่วยนั้น')
    .toEqual(['TM5267H179']);

  await page.selectOption('#entrySubFilter', 'TUE-U');
  await page.waitForTimeout(150);
  expect(await pos(), 'ต้องใช้ค่าที่เก็บไว้ ไม่ใช่เดาจากรหัส PO — และใบที่ว่างต้องไม่ปนมา')
    .toEqual(['TM5267U176', 'TM5267H901']);

  await page.selectOption('#entrySubFilter', '');
  await page.waitForTimeout(150);
  expect((await pos()).length, 'เลือกทั้งหมดแล้วต้องกลับมาครบ').toBe(4);
});

test('ตัวกรอง Sub-Name ใช้ร่วมกับตัวกรองอื่นได้ ไม่ทับกัน', async ({ page }) => {
  await openApp(page, [], ENTRY_SUB_ORDERS);
  await gotoEntry(page);

  await page.selectOption('#entrySubFilter', 'TUE-H');
  await page.fill('#entrySearch', 'PN-2');       // PN-2 เป็นของ TUE-U
  await page.waitForTimeout(150);

  const rows = await page.$$eval('#entryTable tbody tr td:nth-child(3)',
    t => t.map(x => x.innerText.trim()));
  expect(rows, 'สองตัวกรองต้องตัดร่วมกัน ไม่ใช่ตัวใดตัวหนึ่งชนะ').toEqual([]);
});

/** เข้าหน้ายอดรายวันทุกขั้น แล้วรอให้ตารางขึ้นครบ
 *  ⚠️ เดิมชื่อ gotoDashboard() — แท็บแดชบอร์ดถูกลบทั้งแท็บเมื่อ 12 พ.ย. 2569
 *     เทสที่เคยพึ่งตารางของหน้านั้นย้ายมาอ่านตารางของหน้านี้แทน */
async function gotoDaily(page) {
  await page.click('.tab-btn[data-tab="daily"]');
  await page.locator('#dayShowAll').setChecked(true);
  await page.waitForSelector('#dayTable tbody tr');
}

/* ── Item No. (เดิมอยู่ที่แท็บแดชบอร์ดซึ่งถูกลบแล้ว) ───────────────────
 *
 * ผู้ใช้ขอ 4 ก.ย. 2026 — ไว้ชี้กันตอนคุยหรือตอนถือกระดาษที่พิมพ์ออกมา ("ดูแถวที่ 12")
 *
 * ⚠️ ความหมายคือ "ลำดับของแถวที่เห็นอยู่ตอนนี้" ไม่ใช่เลขประจำใบสั่ง
 *    ต้องนับหลังกรองและเรียงแล้ว ถ้าไปนับจากลำดับในข้อมูล เลขบนจอจะกระโดด
 *    (1 5 9) หรือสลับกัน แล้วชี้กันไม่รู้เรื่อง
 *
 * ⚠️ ข้อมูลตั้งต้นของเทสต้อง "เรียงไม่ตรงกับที่แสดง" ไม่งั้นเทสผ่านทั้งสองแบบ
 *    เขียนรอบแรกใช้ข้อมูลตั้งต้นปกติซึ่งเรียงตรงกันพอดี ย้อนโค้ดแล้วยังเขียว
 *    ตารางเรียงตาม (สัปดาห์ แล้ววันสั่ง) จึงใส่ข้อมูลมาสลับกับลำดับนั้น */
const DASH_ORDERS = [
  // ลำดับในอาร์เรย์: C, A, B — แต่ตารางจะเรียงเป็น A, B, C
  { id: 'O3', week: 'W33', poNo: 'PO-3', pn: 'PN-3', orderQty: 30,
    orderDate: '2026-08-03', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false },
  { id: 'O1', week: 'W31', poNo: 'PO-1', pn: 'PN-1', orderQty: 100,
    orderDate: '2026-08-01', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false },
  { id: 'O2', week: 'W32', poNo: 'PO-2', pn: 'PN-2', orderQty: 50,
    orderDate: '2026-08-02', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }
];

/* ⚠️ เทส 'Dashboard มีคอลัมน์ Item No. ที่นับตามแถวที่เห็นจริง' ถูกลบไปพร้อมตารางของแดชบอร์ด
   เมื่อ 12 พ.ย. 2569 · คอลัมน์ Item No. (ลำดับของแถวที่เห็นอยู่ตอนนี้ ไว้ชี้กันตอนถือกระดาษ)
   ไม่มีจออื่นที่ทำแบบนั้น — ถ้าวันหนึ่งมีตารางใหม่ที่ต้องชี้กันด้วยเลขแถว ให้เอากฎข้างบนมาใช้ซ้ำ */

test('F2 — ปุ่มพิมพ์ต้องเรียกการพิมพ์ของเบราว์เซอร์ ไม่พึ่งไลบรารีทำ PDF', async ({ page }) => {
  // ⚠️ ปุ่มพิมพ์ของแดชบอร์ดหายไปพร้อมแท็บนั้น · ที่เหลือคือปุ่มของกล่องแก้ไข/ลบรายการ
  await openApp(page);
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(200);

  // แทน window.print ชั่วคราว เพราะ headless เปิดกล่องพิมพ์จริงไม่ได้
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('#btnPrintRecords');

  expect(await page.evaluate(() => window.__printed), 'กดปุ่มแล้วต้องสั่งพิมพ์ด้วย window.print()').toBe(1);
  const src = appSource();
  expect(src, 'ห้ามเพิ่มไลบรารีทำ PDF — ต้องเป็นไฟล์เดียวที่เปิดออฟไลน์ได้').not.toMatch(/jsPDF|html2canvas|html2pdf/i);
});

test('F4 + G1 — หัวกระดาษตอนพิมพ์ต้องบอกตัวกรองที่เลือก วันที่พิมพ์ และเลขรุ่น เป็นภาษาไทย', async ({ page }) => {
  const m = /<meta\s+name="app-version"\s+content="([^"]*)"/i.exec(appHtml());

  /* ⚠️ หัวกระดาษของแดชบอร์ดหายไปพร้อมแท็บนั้นเมื่อ 12 พ.ย. 2569
     ที่เหลือคือหัวกระดาษของกล่องแก้ไข/ลบรายการ ซึ่งเป็นกฎเดียวกันทุกข้อ —
     กระดาษต้องบอกว่ากรองอะไรอยู่ · พิมพ์เมื่อไหร่ · รุ่นไหน */
  await openApp(page);
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(200);
  await page.selectOption('#recFilterProcess', 'winding');
  await page.fill('#recFilterSearch', 'PO-1');

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));   // Ctrl+P ก็ต้องได้หัวกระดาษ

  const header = page.locator('#recPrintHeader');
  await expect(header, 'หัวกระดาษต้องโผล่ตอนพิมพ์').toBeVisible();
  const meta = await page.locator('#recPrintMeta').innerText();
  expect(meta, 'ต้องบอกว่ากรองขั้นอะไรอยู่ ไม่งั้นไม่รู้ว่ากระดาษแผ่นนี้คือข้อมูลชุดไหน').toContain('Winding');
  expect(meta, 'ต้องบอกคำค้นที่กรองอยู่').toContain('PO-1');
  expect(meta, 'ต้องบอกวันที่พิมพ์ กันคนหยิบกระดาษเก่าไปใช้').toContain('พิมพ์เมื่อ');
  expect(meta, 'ต้องบอกเลขรุ่นของโปรแกรมบนกระดาษด้วย').toContain(m[1]);
});

test('G1 — ตอนพิมพ์ต้องซ่อนเมนู/ปุ่ม/ตัวกรอง พิมพ์ตารางครบทุกแถว และคงสีของป้ายไว้', async ({ page }) => {
  await openApp(page);
  /* ป้ายที่มีสีบนหน้า "ยอดรายวันทุกขั้น" คือป้าย **Aging** ตั้งแต่ 13 พ.ย. 2569
   * (ก่อนหน้านั้นเป็นป้ายสถานะ ซึ่งย้ายมาจากแดชบอร์ดเมื่อ 4 พ.ย. 2026 แล้วถูกแทนด้วย Aging)
   * ⚠️ สถานะยังอยู่ แต่ไปอยู่ใน `title` ของช่อง ซึ่ง **ไม่ติดกระดาษ** — ผลพ่วงที่เจ้าของรับไว้
   *    ข้อนี้จึงคุมได้แค่สีของป้ายที่ยังพิมพ์ออกมา ไม่ได้คุมว่าสถานะติดกระดาษ
   * กฎพิมพ์สีเป็นกฎร่วมของทุกหน้า
   * ⚠️ ต้องเตรียมหน้านั้นไว้ "ก่อน" เข้าโหมดพิมพ์ เพราะโหมดพิมพ์ซ่อนแถบเมนูกับตัวกรอง
   *    คลิกแท็บหรือติ๊กสวิตช์ตอนนั้นไม่ได้เลย (เทสค้างจนหมดเวลา ไม่ใช่แดงแบบอ่านรู้เรื่อง) */
  await gotoDaily(page);
  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('header.topbar'), 'แถบหัวจอไม่ควรติดไปบนกระดาษ').toBeHidden();
  await expect(page.locator('nav.tabs'), 'แถบเมนูไม่ควรติดไปบนกระดาษ').toBeHidden();
  await expect(page.locator('#view-daily .filters').first(), 'ช่องตัวกรองไม่ควรติดไปบนกระดาษ').toBeHidden();
  await expect(page.locator('#btnPrintRecords'), 'ปุ่มพิมพ์เองก็ไม่ควรติดไปบนกระดาษ').toBeHidden();

  const maxH = await page.locator('#view-daily .table-wrap').evaluate(el => getComputedStyle(el).maxHeight);
  expect(maxH, 'ต้องปลดล็อกความสูงตาราง ไม่งั้นพิมพ์ได้แค่แถวที่มองเห็นบนจอ').toBe('none');

  const colorAdjust = el => el.evaluate(e => getComputedStyle(e).getPropertyValue('print-color-adjust')
    || getComputedStyle(e).getPropertyValue('-webkit-print-color-adjust'));
  expect(await colorAdjust(page.locator('#dayTable .badge').first()),
    'ป้าย Aging เขียว/เหลือง/แดง ต้องพิมพ์สีออกมา').toBe('exact');
  expect(await colorAdjust(page.locator('#dayTable tbody td').first()),
    'ช่องอื่นในตารางก็ต้องถูกบังคับให้พิมพ์สีเหมือนกัน ไม่ใช่เฉพาะช่องที่มีป้าย').toBe('exact');
});

test('F3 — ห้ามมี URL ของ Apps Script หรือ token ฝังอยู่ในไฟล์', () => {
  const src = appSource();
  expect(src, 'พบ deployment URL จริงฝังในไฟล์ — repo นี้เป็น public')
    .not.toMatch(/AKfyc[A-Za-z0-9_-]{20,}/);
  expect(src, 'พบ GitHub token ฝังในไฟล์').not.toMatch(/gh[pousr]_[A-Za-z0-9]{30,}/);
  expect(src, 'พบ GitHub PAT ฝังในไฟล์').not.toMatch(/github_pat_[A-Za-z0-9_]{30,}/);
});

// ── กล่องยืนยันเมื่อยอดสะสมจะเกิน Order Qty (issue #10) ─────────────
// Playwright ปิดกล่อง dialog ให้อัตโนมัติแบบ "ยกเลิก" ถ้าไม่ผูก handler เอง
// จึงต้องผูก page.on('dialog') ทุกเทสในกลุ่มนี้ ไม่งั้นผลจะกลายเป็น "ไม่บันทึก" หมด
function captureDialogs(page, accept) {
  const msgs = [];
  page.on('dialog', async d => { msgs.push(d.message()); await (accept ? d.accept() : d.dismiss()); });
  return msgs;
}

test('D3/D7 — ยอดสะสมจะเกิน Order Qty ต้องถามก่อน และเมื่อยืนยันแล้วต้องบันทึกให้ ห้ามทิ้งยอด', async ({ page }) => {
  await openApp(page, [rec('R1', 'O1', 'winding', '2026-08-02', 80)]);
  const msgs = captureDialogs(page, true);
  await gotoEntry(page);

  await typeQty(page, 'O1', 30);   // 80 + 30 = 110 > Order Qty 100

  expect(msgs, 'ยอดสะสมจะเกิน Order Qty แต่ไม่มีกล่องถามยืนยัน').toHaveLength(1);
  expect(msgs[0], 'กล่องต้องบอก PO ให้รู้ว่าใบไหน').toContain('PO-1');
  expect(msgs[0], 'กล่องต้องบอกว่ายอดสะสมจะกลายเป็นเท่าไหร่').toContain('110');
  expect(msgs[0], 'กล่องต้องบอก Order Qty ของใบนั้น').toContain('100');

  const records = await readRecords(page);
  const today = records.filter(r => r.date === TEST_DATE && !r.voided);
  expect(today, 'กดยืนยันแล้วต้องบันทึกให้ — ห้ามทิ้งยอดที่พนักงานคีย์').toHaveLength(1);
  expect(today[0].qty).toBe(30);
});

test('B2 — กดยกเลิกในกล่องยืนยัน ต้องไม่บันทึก และของเดิมต้องไม่ถูกแตะ', async ({ page }) => {
  await openApp(page, [rec('R1', 'O1', 'winding', '2026-08-02', 80)]);
  captureDialogs(page, false);
  await gotoEntry(page);

  await typeQty(page, 'O1', 30);

  const records = await readRecords(page);
  expect(records, 'กดยกเลิกแล้วยังบันทึกแถวใหม่ให้').toHaveLength(1);
  expect(records[0].qty, 'ยอดเดิมของวันอื่นต้องไม่ถูกแตะ').toBe(80);
  await expect(page.locator('#entryTable input.row-input[data-order="O1"]'),
    'กดยกเลิกแล้ว ช่องกรอกต้องวาดกลับเป็นค่าเดิม').toHaveValue('');
});

test('G2 — คีย์ทับยอดเดิมของวันเดียวกันแล้วยังไม่เกิน Order Qty ต้องไม่มีกล่องเด้งมาขัดจังหวะ', async ({ page }) => {
  // ยอดสะสมเดิม 90 มาจาก record ของวันนี้เอง — คีย์ 95 ทับคือ "แทนที่" ได้ 95 ไม่ใช่ 185
  await openApp(page, [rec('R1', 'O1', 'winding', TEST_DATE, 90)]);
  const msgs = captureDialogs(page, false);
  await gotoEntry(page);

  await typeQty(page, 'O1', 95);
  await typeQty(page, 'O2', 20);   // ใบปกติที่ไม่เกิน ก็ต้องไม่เด้งเช่นกัน

  expect(msgs, 'กล่องเด้งทั้งที่ยอดไม่เกิน Order Qty — ลืมหักยอดเดิมของวันนั้นออก').toEqual([]);
  const records = await readRecords(page);
  expect(records.find(r => r.id === 'R1').qty, 'ต้องบันทึกทับให้ตามปกติ').toBe(95);
});

test('G2 — กด Enter ไล่คีย์ทีละแถว โฟกัสต้องกระโดดไปแถวถัดไปได้ แม้กล่องยืนยันจะเด้งขึ้นมา', async ({ page }) => {
  await openApp(page);
  captureDialogs(page, true);
  await gotoEntry(page);

  const input = page.locator('#entryTable input.row-input[data-order="O1"]');
  await input.fill('150');          // เกิน Order Qty 100 → กล่องเด้ง
  await input.press('Enter');
  await page.waitForTimeout(300);

  const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.order);
  expect(focused, 'กล่องยืนยันแย่งโฟกัสไป แล้วไม่คืนให้แถวถัดไป — คีย์รัว ๆ ต่อไม่ได้').toBe('O2');
});

// ── ขั้น support (issue #17) ────────────────────────────────────────
// เจ้าของอนุมัติให้แทรกขั้นที่ 3 ระหว่าง Assembly กับ Inspection
// กำหนดวันของขั้นนี้ยัง "ไม่ตั้งค่า" (deadlineOffsets.support = null) รอเจ้าของไปใส่เองที่หน้าตั้งค่า

test('A3 — ขั้น support ต้องคีย์ยอดแยกจากขั้นอื่นได้ และขั้นก่อนหน้าของมันคือ assembly', async ({ page }) => {
  await openApp(page, [rec('R1', 'O1', 'assembly', TEST_DATE, 10)]);

  await gotoEntry(page, 'support');
  await expect(page.locator('#entryTable thead'), 'หัวตารางต้องบอกว่ากำลังคีย์ขั้น Support')
    .toContainText('สะสม Support');
  await typeQty(page, 'O1', 40);

  const records = await readRecords(page);
  expect(records, 'ยอด support ต้องเป็นแถวใหม่ ไม่ทับยอด assembly ของวันเดียวกัน').toHaveLength(2);
  const sup = records.find(r => r.process === 'support');
  expect(sup, 'ไม่พบ record ของขั้น support').toBeTruthy();
  expect(sup.qty).toBe(40);
  expect(sup.date).toBe(TEST_DATE);
  expect(records.find(r => r.id === 'R1').qty, 'ยอด assembly เดิมต้องไม่ถูกแตะ').toBe(10);

  // support สะสม 40 > assembly สะสม 10 → ต้องเตือนผิดลำดับ (PREV_PROCESS.support === 'assembly')
  await expect(page.locator('#entryTable tbody tr').first(),
    'ยอด support เกินขั้นก่อนหน้า (assembly) ต้องขึ้นเตือน').toContainText('⚠');
});

test('A3 + E2 — state เก่าที่ยังไม่มี deadlineOffsets.support ต้องเปิดได้ และแถบปุ่มขั้นต้องมี Support', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // seedState() ไม่มีคีย์ support เลย = ข้อมูลที่บันทึกไว้ก่อนจะมีขั้นนี้
  // ⚠️ ใบต้องยังไม่เลยกำหนดขั้นไหนเลย (สั่งเมื่อวาน · ขั้นอื่นตั้งไว้ 10–28 วัน) เพราะ A5
  //    รายงานขั้นปลายน้ำก่อน · ใช้ใบของ seedState (สั่ง ส.ค.) แล้วได้ "เกินกำหนดส่งของ"
  //    คำว่า "ล่าช้า Support" จึงไม่โผล่ทั้งที่ตัดสินผิด = เทสเขียวทั้งที่พัง (ทดลองแล้ว)
  await openApp(page, [rec('R1', 'O1', 'support', TEST_DATE, 30)], [
    { id: 'O1', week: 'W31', poNo: 'PO-1', pn: 'PN-1', orderQty: 100,
      orderDate: isoDaysAgo(1), status: 'active',
      importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }
  ]);
  await gotoDaily(page);

  /* ⚠️ เคยดูที่คอลัมน์กับการ์ดของแดชบอร์ด ซึ่งถูกลบทั้งแท็บเมื่อ 12 พ.ย. 2569
     ที่เหลือคือแถบปุ่มเลือกขั้นของหน้านี้ ซึ่งวาดจาก PROCESSES เหมือนกัน */
  await expect(page.locator('#dayProcBtns'), 'แถบปุ่มต้องมีขั้น Support').toContainText('Support');

  // ยังไม่ตั้งค่า → ห้ามตัดสินว่าล่าช้า Support (A4: ห้ามเดาเลขวันแทนเจ้าของ)
  // ถ้าเผลอตีความ null เป็น orderDate + 0 ทุกใบจะกลายเป็นล่าช้าทันทีตั้งแต่วันสั่ง
  // ⚠️ ต้องอ่านที่หน้า "ยอดรายวันทุกขั้น" — ป้ายสถานะอยู่ที่นั่น เคยเช็กที่ตารางแดชบอร์ด
  //    จึงเป็นจริงเสมอโดยไม่ได้ตรวจอะไรเลย (ผู้ตรวจ #119 รันพิสูจน์)
  const st = (await dayStatuses(page)).join(' ');
  // ⚠️ ต้องมี assertion ฝั่งบวกคู่ไว้ด้วย — ลำพัง not.toContain จะเขียวเองถ้าตารางวาดศูนย์แถว
  expect(st, 'ต้องมีแถวให้ตรวจจริง').toContain('กำลังดำเนินการ');
  expect(st, 'Support ยังไม่กำหนดวัน ห้ามตัดสินว่าล่าช้า').not.toContain('ล่าช้า Support');
  expect(errors, 'state เก่าที่ไม่มีคีย์ support ต้องเปิดได้ ไม่พัง').toEqual([]);
});

test('A4 — ตั้งค่า Support (+วัน) แล้วกำหนดวันต้องนับจาก Order Date · เว้นว่างต้องกลับเป็นไม่กำหนด', async ({ page }) => {
  // เจ้าของเอาคอลัมน์ Deadline ออกจากหน้าจอแล้ว จึงตรวจการนับวันผ่าน "ป้ายสถานะ"
  // ซึ่งเป็นผลจริงที่ผู้ใช้เห็น และคมกว่าเดิมเพราะล็อกขอบเขตคร่อมวันนี้พอดี
  //   สั่งมา 30 วัน · Support +29 = ครบกำหนดเมื่อวาน → ต้องล่าช้า
  //                 · Support +31 = ครบกำหนดพรุ่งนี้ → ต้องยังไม่ล่าช้า
  // ขั้นอื่นตั้งไว้ +200 วัน เพื่อไม่ให้ไปชิงป้ายล่าช้าไปก่อน (computeStatus คืนขั้นแรกที่เลย)
  await openApp(page, [], [
    { id: 'O1', week: 'W31', poNo: 'PO-1', pn: 'PN-1', orderQty: 100,
      orderDate: isoDaysAgo(30), status: 'active',
      importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }
  ]);

  const setOffsets = async sup => {
    await page.click('.tab-btn[data-tab="data"]');
    for (const [id, v] of [['offW', '200'], ['offA', '200'], ['offI', '200'], ['offS', '200'], ['offSup', sup]]) {
      await page.fill('#' + id, v);
    }
    await page.click('#btnSaveSettings');
    await gotoDaily(page);
  };

  await setOffsets('29');
  expect((await dayStatuses(page)).join(' '), 'ครบกำหนดไปแล้วเมื่อวาน ต้องขึ้นล่าช้า Support')
    .toContain('ล่าช้า Support');

  await page.click('.tab-btn[data-tab="data"]');
  await expect(page.locator('#offSup'), 'ค่าที่บันทึกไว้ต้องกลับมาโชว์ในช่องตั้งค่า').toHaveValue('29');

  await setOffsets('31');
  expect((await dayStatuses(page)).join(' '), 'ยังไม่ถึงกำหนด (อีก 1 วัน) ห้ามตัดสินว่าล่าช้า — พลาดข้างนี้แปลว่านับวันเกินไปหนึ่ง')
    .not.toContain('ล่าช้า Support');

  await setOffsets('');
  const off = (await readSaved(page, K_STATE)).deadlineOffsets;
  expect(off.support, 'เว้นช่องว่างต้องเก็บเป็น null (ยังไม่กำหนด) ไม่ใช่ 0 ที่จะทำให้ทุกใบเลยกำหนดทันที')
    .toBeNull();
  expect((await dayStatuses(page)).join(' '), 'ไม่กำหนดวันแล้วต้องเลิกตัดสินว่าล่าช้า')
    .not.toContain('ล่าช้า Support');
});

// ── ตัวกรอง "ค้างอยู่ที่ขั้น" ในตารางของแท็บแดชบอร์ดเดิม (issue #21) ───
// นิยาม "ค้าง" ที่ผู้ใช้ยืนยัน = ผ่านขั้นก่อนหน้ามาแล้วแต่ขั้นนี้ยังไม่ครบ
// ต้องเป็นสูตรเดียวกับการ์ด WIP ด้านบน ไม่งั้นการ์ดกับรายการจะบอกคนละยอด

/* ⚠️ ตัวกรอง "ค้างอยู่ที่ขั้น" กับตารางราย P/N หายไปพร้อมแท็บแดชบอร์ดเมื่อ 12 พ.ย. 2569
   แต่ **สูตรที่มันใช้ยังอยู่ครบ** และย้ายไปแสดงผลที่กราฟยอดค้างรายวันของหน้ายอดค้างรายวัน
   ซึ่งคิด "ขั้นก่อนหน้า ลบ ขั้นนี้" ต่อใบแล้วบวกกัน (`wipDailySeries()`) — เป็นสูตรเดียวกัน
   สามข้อข้างล่างจึงอ่านค่าจากแท่งของกราฟนั้นแทน · ค่าที่คาดคำนวณจากสองใบใน seedState()
   (O1 = PN-1 100 ชิ้น · O2 = PN-2 50 ชิ้น) */

/** ยอดค้างหน้าขั้นหนึ่ง ณ วันล่าสุดของกราฟ — อ่านจาก <title> เพราะนั่นคือตัวเลขจริง */
async function wipNow(page, proc) {
  const v = await page.$$eval(`#wtWip rect[data-proc="${proc}"] title`,
    els => els.map(e => Number(e.textContent.split(': ').pop().replace(/,/g, ''))));
  return v[v.length - 1];
}

async function gotoWipTrend(page) {
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForSelector('#wtWip svg');
  await page.waitForTimeout(150);
}

test('A3 — ของค้างต้องเป็นของที่ผ่านขั้นก่อนหน้าแล้ว แต่ขั้นนี้ยังไม่ครบ', async ({ page }) => {
  // O1 (100 ชิ้น) เดินถึง Inspection ครบแล้ว ยังไม่ส่งของ → ของ 100 ค้างหน้าส่งของ
  // O2 (50 ชิ้น) พัน winding ครบแล้ว ยังไม่ประกอบ → ของ 50 ค้างหน้า Assembly
  await openApp(page, [
    rec('R1', 'O1', 'winding', TEST_DATE, 100),
    rec('R2', 'O1', 'assembly', TEST_DATE, 100),
    rec('R3', 'O1', 'support', TEST_DATE, 100),
    rec('R4', 'O1', 'inspection', TEST_DATE, 100),
    rec('R5', 'O2', 'winding', TEST_DATE, 50)
  ]);
  await gotoWipTrend(page);

  expect(await wipNow(page, 'winding'), 'ทั้งสองใบพัน winding ครบแล้ว ไม่เหลือค้างหน้าขั้นแรก').toBe(0);
  expect(await wipNow(page, 'assembly'), 'เหลือ 50 ของ O2 ที่ยังไม่ประกอบ').toBe(50);
  expect(await wipNow(page, 'support'), 'ไม่มีใบไหนค้างหน้า Support — ของที่ผ่านไปแล้วห้ามถูกนับซ้ำ').toBe(0);
  expect(await wipNow(page, 'shipping'), 'ตรวจครบแล้วแต่ยังไม่ส่ง = 100 ของ O1').toBe(100);
});

test('A1 — ยอดที่ถูกยกเลิกไปแล้ว ต้องไม่ถูกนับว่าค้างอยู่หน้าขั้นถัดไป', async ({ page }) => {
  // ยอด winding ของ O2 ถูกยกเลิก → เท่ากับยังไม่ได้เริ่มผลิต ห้ามนับว่าค้างหน้า Assembly
  await openApp(page, [rec('R1', 'O2', 'winding', TEST_DATE, 50, true)]);
  await gotoWipTrend(page);

  expect(await wipNow(page, 'assembly'), 'ยอดที่ยกเลิกแล้วห้ามทำให้ของไปกองหน้าขั้นถัดไป').toBe(0);
  expect(await wipNow(page, 'winding'), 'ทั้งสองใบยังไม่มียอดที่ใช้ได้ = ของทั้งหมดยังค้างหน้าขั้นแรก').toBe(150);
});

test('A1 — ยอดที่คีย์เกิน Order Qty ต้องไม่กลายเป็นของค้างที่ไม่มีจริง', async ({ page }) => {
  // O1 สั่ง 100 แต่คีย์ winding ไป 120 และประกอบครบ 100 แล้ว → ไม่ควรเหลือค้าง 20
  await openApp(page, [
    rec('R1', 'O1', 'winding', TEST_DATE, 120),
    rec('R2', 'O1', 'assembly', TEST_DATE, 100)
  ]);
  await gotoWipTrend(page);

  expect(await wipNow(page, 'assembly'), 'ยอดส่วนที่เกิน Order Qty ต้องถูกครอบก่อน ไม่งั้นได้ของค้าง 20 ที่ไม่มีจริง').toBe(0);
  expect(await wipNow(page, 'winding'), 'เหลือ 50 ของ O2 ที่ยังไม่เริ่ม').toBe(50);
});

// ── พิมพ์กล่อง "แก้ไข / ลบรายการที่บันทึกแล้ว" = รายงานยอดที่คีย์ในวันที่เลือก (issue #25) ──

async function gotoRecordEditor(page) {
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForSelector('#recordEditorTable tbody tr');
}

function recDateColumn(page) {
  return page.locator('#recordEditorTable tbody tr td:nth-child(2)').allInnerTexts();
}

test('F2 + F4 + G1 — ปุ่มพิมพ์ในกล่องรายการที่บันทึกแล้ว ต้องสั่งพิมพ์ และหัวกระดาษต้องบอกวันของยอด เวลาพิมพ์ และเลขรุ่น', async ({ page }) => {
  const m = /<meta\s+name="app-version"\s+content="([^"]*)"/i.exec(appHtml());

  await openApp(page, [rec('R1', 'O1', 'winding', TEST_DATE, 10)]);
  await gotoRecordEditor(page);

  // แทน window.print ชั่วคราว เพราะ headless เปิดกล่องพิมพ์จริงไม่ได้
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.fill('#recFilterDate', TEST_DATE);
  await page.selectOption('#recFilterProcess', 'winding');
  await page.click('#btnPrintRecords');
  expect(await page.evaluate(() => window.__printed), 'กดปุ่มแล้วต้องสั่งพิมพ์ด้วย window.print()').toBe(1);

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));   // Ctrl+P ก็ต้องได้หัวกระดาษ

  await expect(page.locator('#recPrintHeader'), 'หัวกระดาษของกล่องนี้ต้องโผล่ตอนพิมพ์').toBeVisible();
  const meta = await page.locator('#recPrintMeta').innerText();
  expect(meta, 'ต้องบอกว่ากระดาษแผ่นนี้เป็นยอดของวันไหน ไม่งั้นหยิบไปใช้ผิดวัน').toContain('03/08/2026');
  expect(meta, 'ต้องบอกตัวกรอง Process ที่เลือกอยู่').toContain('Winding');
  expect(meta, 'ต้องบอกวันที่พิมพ์ กันคนหยิบกระดาษเก่าไปใช้').toContain('พิมพ์เมื่อ');
  expect(meta, 'ต้องบอกเลขรุ่นของโปรแกรมบนกระดาษด้วย').toContain(m[1]);
});

test('พิมพ์แล้วต้องเหลือแค่ของที่ต้องอ่านบนกระดาษ — กล่องรายการที่บันทึกแล้ว ต้องเหลือแค่ตาราง ไม่มีฟอร์มคีย์ยอด ช่องติ๊ก หรือปุ่มลบ', async ({ page }) => {
  await openApp(page, [rec('R1', 'O1', 'winding', TEST_DATE, 10)]);
  await gotoRecordEditor(page);
  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('#entryTable'), 'ฟอร์มคีย์ยอดไม่ควรติดไปบนกระดาษรายงาน').toBeHidden();
  await expect(page.locator('#btnPrintRecords'), 'ปุ่มพิมพ์เองก็ไม่ควรติดไปบนกระดาษ').toBeHidden();
  await expect(page.locator('#recordEditorTable .rec-chk').first(), 'ช่องติ๊กเลือกแถวใช้บนกระดาษไม่ได้').toBeHidden();
  await expect(page.locator('#recordEditorTable [data-delete]').first(), 'ปุ่มลบใช้บนกระดาษไม่ได้').toBeHidden();
  await expect(page.locator('#recordEditorTable .rec-qty-input').first(), 'ยอดต้องยังพิมพ์ออกมาเห็นเป็นตัวเลข').toBeVisible();
});

test('C3 — เลือกวันที่ย้อนหลังในกล่องรายการที่บันทึกแล้ว ต้องเหลือเฉพาะยอดของวันนั้น', async ({ page }) => {
  await openApp(page, [
    rec('R1', 'O1', 'winding', TEST_DATE, 10),
    rec('R2', 'O2', 'winding', '2026-07-20', 20)
  ]);
  await gotoRecordEditor(page);

  expect(await recDateColumn(page), 'ยังไม่เลือกวัน ต้องเห็นครบทุกวันเหมือนเดิม').toEqual(['03/08/2026', '20/07/2026']);

  await page.fill('#recFilterDate', '2026-07-20');
  await page.waitForTimeout(100);
  expect(await recDateColumn(page), 'เลือกวันย้อนหลังแล้วต้องเหลือเฉพาะยอดของวันนั้น').toEqual(['20/07/2026']);
});

test('กระดาษต้องไม่ขาดหายเงียบ ๆ — เลือกวันที่เจาะจงแล้ว ต้องไม่ตัดที่ 300 แถว ไม่งั้นกระดาษที่พิมพ์ขาดหายโดยไม่มีใครรู้', async ({ page }) => {
  // วันเดียวคีย์ 320 รายการ (ยอดคนละ order/ขั้น ไม่ชน A2) — กระดาษต้องได้ครบใบ
  const many = [];
  for (let i = 0; i < 320; i++) {
    many.push(rec('R' + i, i % 2 ? 'O1' : 'O2', 'winding', TEST_DATE, i));
  }
  many.push(rec('OLD', 'O1', 'winding', '2026-07-20', 5));
  await openApp(page, many);
  await gotoRecordEditor(page);

  const rowCount = () => page.locator('#recordEditorTable tbody tr').count();
  expect(await rowCount(), 'ไม่เลือกวัน ยังคงตัดที่ 300 แถวเหมือนเดิม').toBe(300);

  await page.fill('#recFilterDate', TEST_DATE);
  await page.waitForTimeout(150);
  expect(await rowCount(), 'เลือกวันเจาะจงแล้วต้องได้ครบทุกแถวของวันนั้น').toBe(320);
  await expect(page.locator('#recordEditorTable + .muted'), 'ไม่มีการตัดแถวแล้ว ก็ไม่ต้องมีข้อความว่าแสดงไม่ครบ').toHaveCount(0);
});

// ── Aging · ซ่อนงานที่ส่งของครบแล้ว · เลิกแสดง deadline รายขั้น ────────

/* ⚠️ ช่อง Aging อยู่ที่หน้าคีย์ยอด ไม่ใช่แดชบอร์ด — ย้ายเมื่อ 5 พ.ย. 2026
 * แดชบอร์ดรวมเป็นราย P/N แล้ว อายุงานของกลุ่มไม่มีความหมาย (P/N เดียวมีหลายใบ หลายวันสั่ง)
 * หน้าคีย์ยอดเป็นราย PO และใช้ agingCell กับ computeStatus ตัวเดียวกัน จึงเป็นบ้านที่ตรงกว่า */
async function agingColumn(page) {
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(250);
  return page.locator('#entryTable tbody tr td[data-aging]').allInnerTexts();
}

test('C1 + C3 — Aging ต้องเป็นจำนวนวันนับจาก Order Date ถึงวันนี้ ไม่ใช่วันที่', async ({ page }) => {
  // ไม่ hardcode ตัวเลข เพราะ "วันนี้" เดินทุกวัน — นับถอยจากวันนี้จริงแทน
  await openApp(page, [], [
    { id: 'O1', week: 'W31', poNo: 'PO-1', pn: 'PN-1', orderQty: 100,
      orderDate: isoDaysAgo(12), status: 'active',
      importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false },
    { id: 'O2', week: 'W31', poNo: 'PO-2', pn: 'PN-2', orderQty: 50,
      orderDate: isoDaysAgo(0), status: 'active',
      importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }
  ]);
  await gotoDaily(page);

  expect(await agingColumn(page), 'สั่งมา 12 วันต้องได้ 12 · สั่งวันนี้ต้องได้ 0 ไม่ใช่ช่องว่าง')
    .toEqual(['12', '0']);
});

test('C1 — ใบที่ไม่มี Order Date ต้องขึ้นขีด ไม่ใช่ NaN', async ({ page }) => {
  // ใบที่มาจากการนำเข้าใบส่งงานอาจไม่มีวันสั่ง — ห้ามให้ตัวเลขขยะโผล่บนหน้าจอ
  await openApp(page, [], [
    { id: 'O1', week: 'ใบส่งงาน', poNo: 'PO-1', pn: 'PN-1', orderQty: 100,
      orderDate: null, status: 'active',
      importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }
  ]);
  await gotoDaily(page);

  expect(await agingColumn(page), 'ไม่มีวันสั่ง = คำนวณอายุงานไม่ได้ ต้องบอกตรง ๆ ว่าไม่มี').toEqual(['—']);
});

/** สีของช่อง Aging แต่ละแถว — '' แปลว่าไม่ได้ระบายสี (อ่านที่หน้าคีย์ยอด) */
async function agingColors(page) {
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(250);
  return page.locator('#entryTable tbody tr td[data-aging]').evaluateAll(
    tds => tds.map(td => {
      const b = td.querySelector('.badge');
      return b ? b.className.replace('badge', '').trim() : '';
    }));
}

/** ใบเดียว ตั้งวันสั่งย้อนหลังได้ตามใจ — ใช้ตรวจสีช่อง Aging */
function agingOrder(id, daysAgo) {
  return { id, week: 'W31', poNo: `PO-${id}`, pn: `PN-${id}`, orderQty: 100,
    orderDate: isoDaysAgo(daysAgo), status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false };
}

/* ── A5 · ลำดับการตัดสินสถานะ ห้ามสลับ ────────────────────────────────
 *
 * INVARIANTS A5 สั่งว่า computeStatus ต้องไล่จาก "ปลายน้ำขึ้นต้นน้ำ"
 *   ส่งของครบ -> เกินกำหนดส่งของ -> Inspection -> Support -> Assembly -> Winding -> ใกล้ครบ -> ปกติ
 * เพื่อให้รายงานสถานะที่ "แย่ที่สุด" ก่อน
 *
 * แต่ก่อนหน้านี้ไม่มีเทสข้อไหนคุมลำดับเลย — สลับ if ของ Inspection กับ Assembly
 * แล้วเทสทั้งชุดยังเขียว (CTO agent พิสูจน์ด้วย mutation แล้ว)
 *
 * ใบที่ค้างหลายขั้นพร้อมกันเป็นเรื่องปกติของงานจริง ถ้ารายงานขั้นต้นน้ำก่อน
 * คนอ่านจะคิดว่าปัญหาอยู่ที่ Assembly แล้วไปเร่งผิดจุด ทั้งที่ของค้างที่ Inspection
 *
 * ⚠️ ค่า deadlineOffsets ของ seedState คือ winding 10 · assembly 17 · inspection 24 · shipping 28
 *    วันสั่งซื้อจึงถูกเลือกให้ "วันนี้" ตกอยู่ระหว่างกำหนด Inspection กับกำหนดส่งของพอดี */
/* ช่องสถานะคือ td สุดท้ายของแถว — ไม่มี data-* ให้เกาะ จึงเจาะด้วย :last-child
 * (เขียนเป็น td[data-status] ไว้ครั้งแรก ซึ่งไม่มีอยู่จริง แล้วได้สตริงว่างกลับมา
 *  ถ้าใช้ not.toContain อย่างเดียว เทสจะเขียวตลอดไปโดยไม่ได้ตรวจอะไร) */
/* ⚠️ ย้ายไปอ่านที่หน้า "ยอดรายวันทุกขั้น" เมื่อ 5 พ.ย. 2026 — แดชบอร์ดรวมเป็นราย P/N แล้ว
 *    จึงไม่มีแถวราย PO ให้เกาะ · หน้านั้นเป็นราย PO และใช้ computeStatus ตัวเดียวกัน
 *    จึงเป็นบ้านที่ตรงกว่าแดชบอร์ดตั้งแต่แรก · ต้องติ้ก "แสดงทุกใบ" ก่อน
 *    เพราะตั้งต้นหน้านั้นโชว์เพาะใบที่ขั้นนั้นวันนั้นมีการคีย์ */
/* ⚠️ เดิมชื่อ `dashStatuses()` — เปลี่ยนเมื่อ 13 พ.ย. 2569 ตอนที่ชื่อ "Dashboard"
 *    ย้ายไปเป็นของแท็บยอดค้างรายวัน · ชื่อเดิมอ่านแล้วเข้าใจว่าอ่านป้ายจากแท็บนั้น
 *    ทั้งที่มันอ่านจากหน้า "ยอดรายวันทุกขั้น" (`#dayTable`) */
const dayStatuses = async page => {
  await page.click('.tab-btn[data-tab="daily"]');
  await page.waitForTimeout(150);
  await page.locator('#dayShowAll').setChecked(true);
  await page.waitForTimeout(250);
  /* ⚠️ อ่านจาก `title` ของช่อง ไม่ใช่ข้อความในช่อง — 13 พ.ย. 2569 เจ้าของสั่งเปลี่ยน
     คอลัมน์สุดท้ายของหน้านี้จากป้ายสถานะเป็น Aging · สถานะยังถูกคิดและยังลง DOM
     แต่ไปอยู่ใน `title` แทน · อ่าน innerText ต่อไปจะได้ตัวเลขอายุงาน แล้วทุก
     `not.toContain('ล่าช้า ...')` จะเขียวเองทันทีโดยไม่ได้ตรวจอะไร (A4 · A5) */
  return page.locator('#dayTable tbody tr td:last-child')
    .evaluateAll(tds => tds.map(td => td.title));
};

function lateOrder(id, daysAgo, qty = 100) {
  return { id, week: 'W31', poNo: 'PO-' + id, pn: 'PN-' + id, orderQty: qty,
    orderDate: isoDaysAgo(daysAgo), status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false };
}

test('A5 — ค้างทั้ง Assembly และ Inspection ต้องรายงาน Inspection ซึ่งอยู่ปลายน้ำกว่า', async ({ page }) => {
  // สั่งมา 26 วัน: กำหนด Assembly (17) และ Inspection (24) เลยมาแล้ว แต่กำหนดส่ง (28) ยังไม่ถึง
  await openApp(page, [], [lateOrder('O1', 26)]);
  await gotoDaily(page);

  const st = (await dayStatuses(page)).join(' ');
  expect(st, 'ต้องรายงานขั้นที่อยู่ปลายน้ำที่สุดที่ยังค้าง').toContain('ล่าช้า Inspection');
  expect(st, 'ห้ามรายงานขั้นต้นน้ำก่อน — คนจะไปเร่งผิดจุด').not.toContain('ล่าช้า Assembly');
});

test('A5 — เกินกำหนดส่งของ ต้องมาก่อนความล่าช้าของทุกขั้น', async ({ page }) => {
  // สั่งมา 40 วัน: เลยกำหนดทุกขั้นรวมทั้งกำหนดส่ง
  await openApp(page, [], [lateOrder('O1', 40)]);
  await gotoDaily(page);

  const st = (await dayStatuses(page)).join(' ');
  expect(st, 'ปลายน้ำสุดคือกำหนดส่งของ ต้องรายงานอันนี้').toContain('เกินกำหนดส่งของ');
  expect(st, 'และต้องไม่รายงานขั้นอื่นแทน').not.toContain('ล่าช้า');
});

test('A5 — ส่งของครบแล้ว ต้องชนะทุกอย่าง แม้เลยกำหนดทุกขั้น', async ({ page }) => {
  await openApp(page, [rec('R1', 'O1', 'shipping', isoDaysAgo(1), 100)], [lateOrder('O1', 40)]);

  const st = (await dayStatuses(page)).join(' ');
  expect(st, 'ส่งครบแล้วคืองานจบ ไม่ใช่งานที่เกินกำหนด').toContain('ส่งของครบแล้ว');
  expect(st, 'ห้ามรายงานว่าเกินกำหนด').not.toContain('เกินกำหนด');
});

/* ── แถบ ทัน/เกิน ของแท็บแดชบอร์ดเดิม — **ลบทั้งกลุ่ม 12 พ.ย. 2569** ─────
 *
 * แถบสองสี · ป้าย "⚠ คีย์เกินยอดสั่ง" · การครอบยอดแยกทัน/เกิน อยู่ในตารางของแดชบอร์ดทั้งหมด
 * ซึ่งถูกลบทั้งแท็บ · `buildCumSplitMap()` จึงไม่เหลือผู้ใช้และถูกลบตามไปด้วย
 * **ไม่มีจอไหนในโปรแกรมแสดงยอดแยกทันกำหนด/เกินกำหนดอีกแล้ว**
 * ถ้าวันหนึ่งเจ้าของอยากได้กลับมา สามกฎที่เคยคุมไว้คือ (ยกมาเพื่อให้เขียนเทสใหม่ได้ครบ)
 *   · **วันครบกำหนดพอดี = ยังทัน** (`r.date <= dl`) ไม่ใช่เกิน — วันนั้นคือวันที่คนเร่งงานกันมากที่สุด
 *   · ยอดแยกทัน/เกิน ต้องครอบที่ยอดสั่ง **ต่อใบ ทั้งสองด้าน** เหมือนยอดสะสม
 *     (ถอดด้านใดด้านหนึ่งออกแล้วเทสของอีกด้านยังเขียว — ต้องมีเทสคู่กันเสมอ)
 *   · ครอบแล้วห้ามกลบเงียบ — ต้องมีป้ายฟ้องว่ามีใบคีย์เกิน **และใบที่ไม่เกินต้องไม่ขึ้นป้าย**
 */

test('A4 — สีช่อง Aging ต้องมาจาก deadlineOffsets.shipping ไม่ใช่เลขตายตัว', async ({ page }) => {
  // seedState ตั้ง shipping = 28 → ค้างเกิน 28 วันแดง · เหลือถึงกำหนด ≤3 วันเหลือง · นอกนั้นเขียว
  // เรียงตาม orderDate จากเก่าไปใหม่ → 30, 26, 5 วัน
  await openApp(page, [], [agingOrder('O1', 30), agingOrder('O2', 26), agingOrder('O3', 5)]);
  await gotoDaily(page);

  expect(await agingColumn(page), 'ตัวเลขอายุงานต้องไม่เปลี่ยนเพราะการระบายสี').toEqual(['30', '26', '5']);
  expect(await agingColors(page), 'ค้างเกินกำหนดส่งของต้องแดง · ใกล้ถึงกำหนดต้องเหลือง · ยังสบายต้องเขียว')
    .toEqual(['red', 'amber', 'green']);
});

test('A4 — ยังไม่ตั้งจำนวนวันกำหนดส่งของ ช่อง Aging ต้องไม่ระบายสี ห้ามเดาว่าเป็น 0', async ({ page }) => {
  // shipping = null คือ "ยังไม่กำหนด" ถ้าเผลอตีความเป็น 0 ทุกใบจะแดงตั้งแต่วันสั่ง
  const st = seedState([], [agingOrder('O1', 30), agingOrder('O2', 1)]);
  st.deadlineOffsets.shipping = null;
  await page.addInitScript(([key, s]) => {
    localStorage.setItem(key, JSON.stringify(s));
  }, [K_STATE, st]);
  await page.goto(APP);
  await waitReady(page);
  await page.waitForSelector('.tab-btn[data-tab="entry"]');
  await gotoDaily(page);

  expect(await agingColumn(page), 'ตัวเลขยังต้องขึ้นตามปกติ').toEqual(['30', '1']);
  expect(await agingColors(page), 'ไม่มีเกณฑ์ให้เทียบ ก็ห้ามตัดสินว่าช้าหรือไม่ช้า').toEqual(['', '']);
});

test('A5 — ใบที่ส่งของครบแล้ว ช่อง Aging ต้องเขียว ไม่ขัดกับสถานะของใบ', async ({ page }) => {
  /* ค้างมา 30 วันก็จริง แต่ส่งครบแล้ว = งานจบ ถ้าขึ้นแดงจะขัดกับสถานะ `ส่งของครบแล้ว`
     ⚠️ อ่านที่หน้าคีย์ยอด (`agingColors` ผูกกับ `#entryTable`) · สถานะไม่ได้โชว์บนหน้านั้น
        แต่ `agingCell()` รับ `st.code` ไปตัดสินสีอยู่ จึงเป็นที่ที่กฎนี้มีผลจริง
        ส่วนหน้ายอดรายวันทุกขั้นมีทั้งสองอย่างในช่องเดียวกัน — คุมไว้ที่
        `daily-all-stages.spec.js` ข้อ "ช่อง Aging และสถานะใน title ต้องคิดจากวันนี้" */
  await openApp(page, [rec('R1', 'O1', 'shipping', TEST_DATE, 100)], [agingOrder('O1', 30)]);

  expect(await agingColors(page), 'งานที่จบแล้วต้องเขียว ไม่ใช่แดง').toEqual(['green']);
});

test('A1 — ยอดส่งที่ถูกยกเลิกแล้ว ต้องไม่ทำให้ใบนั้นถูกนับว่าส่งครบ', async ({ page }) => {
  await openApp(page, [rec('R1', 'O1', 'shipping', TEST_DATE, 100, true)]);
  await gotoWipTrend(page);

  // ยอดส่งที่ยกเลิกไม่นับ ของของใบนี้จึงยังค้างอยู่ในสายทั้งก้อน (100 + 50 ของอีกใบ)
  expect(await wipNow(page, 'winding'), 'ยอดที่ยกเลิกไม่นับ ใบนี้ยังไม่ส่ง').toBe(150);
  const st = (await dayStatuses(page)).join(' ');
  expect(st, 'และต้องไม่ขึ้นว่าส่งของครบแล้ว').not.toContain('ส่งของครบแล้ว');
});

/* ⚠️ เทสสามข้อที่เคยอยู่ตรงนี้ถูกลบพร้อมของที่มันตรวจเมื่อ 12 พ.ย. 2569 —
   'ซ่อนงานที่ส่งของครบแล้ว' · 'ตัวกรองสองตัวต้องไม่ขัดกันเงียบ ๆ' ·
   'กระดาษต้องบอกว่ากรองอะไรไว้' ล้วนเป็นตัวกรองกับหัวกระดาษของแท็บแดชบอร์ด
   กฎที่มันคุมไว้ (ตัวกรองสองตัวต้องไม่ขัดกันเงียบ ๆ · กระดาษต้องบอกว่าซ่อนอะไรอยู่)
   ยังใช้ได้กับทุกหน้าที่มีตัวกรอง — เอาไปเขียนใหม่ได้ถ้ามีหน้าไหนเพิ่มตัวกรองแบบนั้น */

test('เจ้าของสั่งเอา deadline รายขั้นออกจากหน้าจอ — คอลัมน์ Aging อยู่ที่หน้าคีย์ยอด', async ({ page }) => {
  /* ⚠️ ครึ่งแรกของข้อนี้ (ตารางแดชบอร์ดต้องไม่มีคอลัมน์ Deadline หลงเหลือ
     และหัวกับแถวต้องมีคอลัมน์เท่ากัน) หายไปพร้อมแท็บนั้นเมื่อ 12 พ.ย. 2569
     ที่เหลือและยังต้องคุมคือ **คอลัมน์ Aging อยู่ที่หน้าคีย์ยอด ซึ่งเป็นราย PO**
     (ย้ายมาเมื่อ 4 พ.ย. 2026) · ไฟล์ Excel ยังต้องมี deadline เหมือนเดิม
     คุมด้วย excel.spec.js ("หัวคอลัมน์ต้องมี Deadline ครบ") */
  await openApp(page);
  await page.click('.tab-btn[data-tab="entry"]');
  await page.waitForTimeout(200);
  const head = await page.locator('#entryTable thead').innerText();
  expect(head, 'คอลัมน์อายุงานต้องอยู่ที่หน้าคีย์ยอด ซึ่งเป็นราย PO').toContain('Aging');
  expect(head, 'เจ้าของสั่งเอาวันครบกำหนดรายขั้นออกจากหน้าจอแล้ว').not.toContain('Deadline');
});
