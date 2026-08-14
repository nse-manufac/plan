// Smoke test ผูกกับ INVARIANTS.md — ชื่อเทสอ้างข้อกฎตรง ๆ
// เทสที่แดงจะบอกได้ทันทีว่าละเมิดกฎข้อไหน ไม่ต้องไปไล่อ่าน diff
//
// ── ทำไมเทสนี้ขับผ่าน DOM ไม่ใช่เรียกฟังก์ชันตรง ๆ ──────────────────
// โค้ดทั้งหมดของแอปถูกห่ออยู่ใน IIFE  (function(){ ... })();
// ทำให้ state / buildCumMap / saveEntryValue ไม่ถูก export ออกมาที่ global เลย
// เทสจึงต้อง: seed localStorage → กดปุ่มจริง → ตรวจผลจาก localStorage และ DOM
// ซึ่งเป็นการทดสอบที่ใกล้เคียงกับสิ่งที่ผู้ใช้เจอจริงอยู่แล้ว
//
// ถ้าวันหนึ่งอยากได้เทสที่ลึกกว่านี้ ค่อยพิจารณา export ฟังก์ชันออกมาตอน test เท่านั้น
// แต่ต้องให้เจ้าของอนุมัติก่อน เพราะเป็นการแก้ไฟล์แอปจริง

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP = '/production_plan_tracker.html';
const APP_FILE = path.resolve(__dirname, '..', 'production_plan_tracker.html');
const K_STATE = 'tue_order_tracker_v1';
const TEST_DATE = '2026-08-03';

function seedState(records = []) {
  return {
    version: 1,
    deviceName: 'test',
    deadlineOffsets: { winding: 10, assembly: 17, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: [
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

function rec(id, orderId, process, date, qty, voided = false) {
  return {
    id, date, orderId, process, qty, note: '', deviceName: 'test',
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    voided, _dirty: false
  };
}

async function openApp(page, records = []) {
  await page.addInitScript(([key, st]) => {
    localStorage.setItem(key, JSON.stringify(st));
  }, [K_STATE, seedState(records)]);
  await page.goto(APP);
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

function readRecords(page) {
  return page.evaluate(k => JSON.parse(localStorage.getItem(k)).records, K_STATE);
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

  // คอลัมน์ที่ 6 ของตารางคือ "สะสม" (#, สัปดาห์, PO No., P/N, Order Qty, สะสม, คงเหลือ, ยอดวันนี้)
  const cum = await page.locator('#entryTable tbody tr', { has: page.locator('input[data-order="O1"]') })
    .locator('td').nth(5).innerText();

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

  await expect(page.locator('.tab-btn[data-tab="entry"]')).toBeVisible();
  expect(errors, 'JSON เสียแล้วแอปต้อง fallback เป็น defaultState ไม่ใช่พังทั้งหน้า').toEqual([]);
});

test('F4 — หน้าจอต้องโชว์เลขรุ่นที่ตรงกับ <meta name="app-version">', async ({ page }) => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
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

/** เข้าหน้า Dashboard แล้วรอให้ตารางสถานะขึ้นครบ */
async function gotoDashboard(page) {
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForSelector('#dashTable tbody tr');
}

test('F2 — ปุ่มพิมพ์ต้องเรียกการพิมพ์ของเบราว์เซอร์ ไม่พึ่งไลบรารีทำ PDF', async ({ page }) => {
  await openApp(page);
  await gotoDashboard(page);

  // แทน window.print ชั่วคราว เพราะ headless เปิดกล่องพิมพ์จริงไม่ได้
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('#btnPrintDash');

  expect(await page.evaluate(() => window.__printed), 'กดปุ่มแล้วต้องสั่งพิมพ์ด้วย window.print()').toBe(1);
  const src = fs.readFileSync(APP_FILE, 'utf8');
  expect(src, 'ห้ามเพิ่มไลบรารีทำ PDF — ต้องเป็นไฟล์เดียวที่เปิดออฟไลน์ได้').not.toMatch(/jsPDF|html2canvas|html2pdf/i);
});

test('F4 + G1 — หัวกระดาษตอนพิมพ์ต้องบอกตัวกรองที่เลือก วันที่พิมพ์ และเลขรุ่น เป็นภาษาไทย', async ({ page }) => {
  const m = /<meta\s+name="app-version"\s+content="([^"]*)"/i.exec(fs.readFileSync(APP_FILE, 'utf8'));

  await openApp(page);
  await gotoDashboard(page);
  await page.selectOption('#dashStatusFilter', 'late');
  await page.fill('#dashSearch', 'PO-1');

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));   // Ctrl+P ก็ต้องได้หัวกระดาษ

  const header = page.locator('#printHeader');
  await expect(header, 'หัวกระดาษต้องโผล่ตอนพิมพ์').toBeVisible();
  const meta = await page.locator('#printMeta').innerText();
  expect(meta, 'ต้องบอกว่ากรองสถานะอะไรอยู่ ไม่งั้นไม่รู้ว่ากระดาษแผ่นนี้คือข้อมูลชุดไหน').toContain('ล่าช้า/เกินกำหนด');
  expect(meta, 'ต้องบอกคำค้นที่กรองอยู่').toContain('PO-1');
  expect(meta, 'ต้องบอกวันที่พิมพ์ กันคนหยิบกระดาษเก่าไปใช้').toContain('พิมพ์เมื่อ');
  expect(meta, 'ต้องบอกเลขรุ่นของโปรแกรมบนกระดาษด้วย').toContain(m[1]);
});

test('G1 — ตอนพิมพ์ต้องซ่อนเมนู/ปุ่ม/ตัวกรอง พิมพ์ตารางครบทุกแถว และคงสีสถานะไว้', async ({ page }) => {
  await openApp(page);
  await gotoDashboard(page);
  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('header.topbar'), 'แถบหัวจอไม่ควรติดไปบนกระดาษ').toBeHidden();
  await expect(page.locator('nav.tabs'), 'แถบเมนู 4 แท็บไม่ควรติดไปบนกระดาษ').toBeHidden();
  await expect(page.locator('#view-dashboard .filters'), 'ช่องตัวกรองไม่ควรติดไปบนกระดาษ').toBeHidden();
  await expect(page.locator('#btnPrintDash'), 'ปุ่มพิมพ์เองก็ไม่ควรติดไปบนกระดาษ').toBeHidden();

  const maxH = await page.locator('#view-dashboard .table-wrap').evaluate(el => getComputedStyle(el).maxHeight);
  expect(maxH, 'ต้องปลดล็อกความสูงตาราง ไม่งั้นพิมพ์ได้แค่แถวที่มองเห็นบนจอ').toBe('none');

  const colorAdjust = el => el.evaluate(e => getComputedStyle(e).getPropertyValue('print-color-adjust')
    || getComputedStyle(e).getPropertyValue('-webkit-print-color-adjust'));
  expect(await colorAdjust(page.locator('#dashTable .badge').first()),
    'ป้ายสถานะ ล่าช้า/ใกล้ครบกำหนด ต้องพิมพ์สีออกมา').toBe('exact');
  expect(await colorAdjust(page.locator('#dashTable tbody td').first()),
    'ช่องวันครบกำหนด (เขียว/เหลือง/แดง) ต้องพิมพ์สีออกมาเหมือนกัน').toBe('exact');
});

test('F3 — ห้ามมี URL ของ Apps Script หรือ token ฝังอยู่ในไฟล์', () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
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

/** เซลล์ "Deadline Support" ของแถวแรกในตาราง Dashboard (td ลำดับที่ 14) */
function supportDeadlineCell(page) {
  return page.locator('#dashTable tbody tr').first().locator('td').nth(13);
}

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

test('A3 + E2 — state เก่าที่ยังไม่มี deadlineOffsets.support ต้องเปิดได้ และ Dashboard ต้องมีคอลัมน์ Support', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // seedState() ไม่มีคีย์ support เลย = ข้อมูลที่บันทึกไว้ก่อนจะมีขั้นนี้
  await openApp(page, [rec('R1', 'O1', 'support', TEST_DATE, 30)]);
  await gotoDashboard(page);

  const head = await page.locator('#dashTable thead').innerText();
  expect(head, 'ตาราง Dashboard ต้องมีคอลัมน์ของขั้น Support').toContain('Support');
  await expect(page.locator('#wipCards'), 'ต้องมีการ์ด WIP ค้างหน้า Support').toContainText('WIP ค้างหน้า Support');

  // ยังไม่ตั้งค่า → ไม่มีกำหนดวัน และห้ามตัดสินว่าล่าช้า Support (A4: ห้ามเดาเลขวันแทนเจ้าของ)
  await expect(supportDeadlineCell(page), 'ยังไม่ตั้งค่า Support (+วัน) ต้องแสดงเป็น "-" ไม่ใช่วันสั่งซื้อ')
    .toHaveText('-');
  await expect(page.locator('#dashTable tbody')).not.toContainText('ล่าช้า Support');
  expect(errors, 'state เก่าที่ไม่มีคีย์ support ต้องเปิดได้ ไม่พัง').toEqual([]);
});

test('A4 — ตั้งค่า Support (+วัน) แล้วกำหนดวันต้องนับจาก Order Date · เว้นว่างต้องกลับเป็นไม่กำหนด', async ({ page }) => {
  await openApp(page);

  await page.click('.tab-btn[data-tab="data"]');
  await page.fill('#offSup', '20');
  await page.click('#btnSaveSettings');
  await gotoDashboard(page);
  // O1 สั่งซื้อ 2026-08-01 + 20 วัน = 2026-08-21
  await expect(supportDeadlineCell(page), 'กำหนดวัน Support ต้องเป็น orderDate + deadlineOffsets.support')
    .toHaveText('21/08/2026');

  await page.click('.tab-btn[data-tab="data"]');
  await expect(page.locator('#offSup'), 'ค่าที่บันทึกไว้ต้องกลับมาโชว์ในช่องตั้งค่า').toHaveValue('20');
  await page.fill('#offSup', '');
  await page.click('#btnSaveSettings');
  await gotoDashboard(page);

  const off = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).deadlineOffsets, K_STATE);
  expect(off.support, 'เว้นช่องว่างต้องเก็บเป็น null (ยังไม่กำหนด) ไม่ใช่ 0 ที่จะทำให้ทุกใบเลยกำหนดทันที')
    .toBeNull();
  await expect(supportDeadlineCell(page), 'ไม่กำหนดวันแล้วต้องกลับไปแสดง "-"').toHaveText('-');
});
