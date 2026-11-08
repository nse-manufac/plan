// เครื่องที่ดึงข้อมูลจากเซิร์ฟเวอร์ได้ค่าบางช่องเป็น "ตัวเลข" ไม่ใช่ข้อความ
//
// ── ทำไมถึงเกิด ───────────────────────────────────────────────────
// Apps Script อ่านชีตด้วย getValues() ซึ่งคืน "ค่าดิบของเซลล์" — ช่องที่ดูเป็นตัวเลข
// (P/N · สัปดาห์ที่ชื่อชีตเป็นเลขล้วน · รหัส PO ที่เป็นเลขล้วน) กลับมาเป็น number
// ฝั่งเซิร์ฟเวอร์แปลงกลับเป็นสตริงให้เฉพาะคอลัมน์วันที่ (DATE_ONLY_COLS) กับ timestamp
//
// เครื่องที่นำเข้าไฟล์ Excel เองได้สตริงเสมอ จึงไม่เคยเจอ — บั๊กแบบนี้โผล่เฉพาะเครื่องที่ซิงค์มา
// ซึ่ง CLAUDE.md §8.2 เขียนไว้ว่าเป็นมุมที่ "เทสยังตรวจแทนตาไม่ได้" มาตั้งแต่ 1 ก.ย. 2026
//
// ── ทำไมถึงร้ายแรง ───────────────────────────────────────────────
// ตัวเลขไม่มีเมธอด localeCompare → throw ตอนเรียงลำดับ
// ซึ่งเกิดกลางการวาดจอ ผลคือ **ทั้งตารางไม่ขึ้นเลย** ไม่ใช่แค่แถวเดียวหาย
// สองหน้าที่โดนคือหน้าที่พนักงานคีย์ทั้งวัน กับหน้าที่คนอ่านข้อมูลตัวจริงใช้
//
// ── กฎการเขียนเทสในไฟล์นี้ ────────────────────────────────────────
// ⚠️ ต้องมี **สองใบขึ้นไป** ไม่งั้น comparator ไม่ถูกเรียกเลย แล้วเทสเขียวเองทั้งที่โค้ดพัง
//    (บทเรียนจาก #119 ที่ CLAUDE.md เขียนไว้ตรง ๆ · เจอซ้ำอีกครั้งตอน #127)
// ⚠️ และตัวเรียงมีหลายชั้น — ชั้นแรกตัดสินได้แล้วชั้นหลังจะไม่ถูกเรียก
//    fixture จึงจงใจให้ week กับ orderDate **เท่ากันทุกใบ** เพื่อให้ไหลลงไปถึงชั้น poNo
//    และให้ subName เท่ากัน เพื่อให้หน้า FG ไหลลงไปถึงชั้น P/N

const { test, expect } = require('@playwright/test');
const { readSaved, waitReady } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

/** ใบสั่งแบบที่ "ซิงค์มา" — week กับ pn เป็น number ตามที่ getValues() คืนมาจริง */
const synced = (poNo, pn, week = 34) => ({
  id: poNo + '|' + pn, week, poNo, pn, subName: 'TUE-U', orderQty: 1000,
  orderDate: '2026-08-03', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, process, qty, date) => ({
  id, date, orderId, process, qty, note: '', deviceName: 't',
  createdAt: date + 'T00:00:00.000Z', updatedAt: date + 'T00:00:00.000Z', voided: false, _dirty: false
});

/* week กับ orderDate เท่ากันทุกใบ -> ตัวเรียงต้องไหลลงไปถึงชั้น poNo
   และใบที่สามมี poNo เป็นตัวเลขด้วย เพื่อให้ชั้นนั้นเจอของจริง */
const ORDERS = [
  synced('TM5267H001', 9000000002),
  synced('TM5267H002', 9000000003),
  synced(5267003, 9000000004)
];
const TODAY = (() => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
})();
const RECORDS = ORDERS.flatMap((o, i) => [
  rec('w' + i, o.id, 'winding', 500, TODAY),
  rec('i' + i, o.id, 'inspection', 300, TODAY),
  rec('s' + i, o.id, 'shipping', 100, TODAY)
]);

/** เปิดหน้าพร้อมข้อมูลที่ซิงค์มา และดักทุก error ที่หลุดออกมาจากหน้า */
async function openSynced(page) {
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(([k, o, r]) => localStorage.getItem(k) || localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, ORDERS, RECORDS]);
  await page.goto(APP);
  await waitReady(page);
  return errs;
}

const openTab = async (page, tab) => {
  await page.click(`.tab-btn[data-tab="${tab}"]`);
  await page.waitForTimeout(150);
};

test('ข้อมูลที่ซิงค์มาเป็นตัวเลข ต้องไม่ทำให้สคริปต์ตายตั้งแต่เปิดหน้า', async ({ page }) => {
  const errs = await openSynced(page);
  expect(errs, 'throw ตอนวาดจอ = ทั้งตารางไม่ขึ้น ไม่ใช่แค่แถวเดียวหาย').toEqual([]);
  // ข้อมูลต้องไม่ถูกแตะเลย — เทสนี้ไม่ได้เปลี่ยนอะไร
  const saved = await readSaved(page, K_STATE);
  expect(saved.orders).toHaveLength(3);
});

test('หน้าคีย์ยอดรายวัน — ตารางต้องขึ้นครบทุกใบ ไม่ใช่ตารางว่าง', async ({ page }) => {
  const errs = await openSynced(page);
  await openTab(page, 'entry');
  expect(errs).toEqual([]);
  await expect(page.locator('#entryTable tbody tr')).toHaveCount(3);
});

test('หน้ายอดรายวันทุกขั้น — ตารางต้องขึ้นครบทุกใบ (หน้าที่คนอ่านข้อมูลตัวจริงใช้)', async ({ page }) => {
  const errs = await openSynced(page);
  await openTab(page, 'daily');
  expect(errs).toEqual([]);
  await expect(page.locator('#dayTable tbody tr')).toHaveCount(3);
});

test('ลำดับแถวของสองหน้านั้นต้องตรงกัน แม้ค่าจะเป็นตัวเลข', async ({ page }) => {
  /* CLAUDE.md เขียนไว้ว่าสองหน้านี้ต้องเรียงเหมือนกันเสมอ เพราะคนเปิดเทียบกันต้องไล่บรรทัดตรงกันได้
     ⚠️ ข้อนี้มีค่าก็ต่อเมื่อสองหน้าโชว์ครบทั้งสามใบ — ถ้าทั้งคู่ว่างก็ "ตรงกัน" เหมือนกัน
        จึงต้องมีข้อข้างบนคุมจำนวนแถวไว้ด้วย */
  await openSynced(page);
  await openTab(page, 'entry');
  /* ⚠️ ต้องเป็นคอลัมน์ PO No. (ที่ 3) ไม่ใช่ "สัปดาห์" (ที่ 2) ซึ่งเท่ากันทุกแถวใน fixture นี้
     เทียบคอลัมน์ที่ทุกแถวเหมือนกัน = เขียวเสมอไม่ว่าลำดับจะสลับยังไง (พลาดมาแล้วตอนเขียนครั้งแรก) */
  const a = await page.locator('#entryTable tbody tr td:nth-child(3)').allInnerTexts();
  await openTab(page, 'daily');
  const b = await page.locator('#dayTable tbody tr td:nth-child(3)').allInnerTexts();
  expect(a.length).toBe(3);
  expect(b).toEqual(a);
});

test('หน้ายอดคงคลัง FG — ต้องจัดกลุ่มและเรียงได้แม้ P/N เป็นตัวเลข', async ({ page }) => {
  const errs = await openSynced(page);
  await openTab(page, 'fg');
  expect(errs).toEqual([]);
  // สามใบคนละ P/N หน่วยเดียวกัน -> สามกลุ่ม และตัวเรียงต้องไหลลงไปถึงชั้น P/N
  await expect(page.locator('#fgTable tbody tr')).toHaveCount(3);
});

test('หน้าใบส่งสินค้า — ต้องขึ้นกลุ่มได้แม้ค่าเป็นตัวเลข', async ({ page }) => {
  const errs = await openSynced(page);
  await openTab(page, 'delivery');
  expect(errs).toEqual([]);
  await expect(page.locator('#dnTable tbody tr').first()).toBeVisible();
});

test('Dashboard — ต้องวาดได้แม้ค่าเป็นตัวเลข', async ({ page }) => {
  const errs = await openSynced(page);
  await openTab(page, 'dashboard');
  expect(errs).toEqual([]);
  await expect(page.locator('#dashTable tbody tr')).toHaveCount(3);
});

test('ตัวเรียงชั้นที่สาม (poNo) ก็ต้องทนตัวเลข ไม่ใช่แค่ชั้นแรก', async ({ page }) => {
  /* ⚠️ ตัวเรียงสามชั้น — ชั้นแรก (week) ตัดสินได้แล้วชั้นหลังจะไม่ถูกเรียกเลย
     fixture หลักของไฟล์นี้ให้ week เท่ากันอยู่แล้ว แต่ถ้าวันหนึ่งมีคนแก้ fixture
     ให้ week ต่างกัน ข้อนี้จะเป็นตัวเดียวที่ยังยืนยันชั้น poNo ได้
     จึงแยกฉากของตัวเองไว้ โดยให้ **ทุกชั้นก่อนหน้าเสมอกัน** */
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const same = (poNo, pn) => ({
    id: poNo + '|' + pn, week: 'WK 34', poNo, pn, subName: 'TUE-U', orderQty: 1000,
    orderDate: '2026-08-03', status: 'active',
    importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
  });
  // week กับ orderDate เป็นสตริงและเท่ากัน -> สองชั้นแรกคืน 0 -> ชั้น poNo ต้องทำงาน
  const orders = [same(5267002, '9000000002'), same(5267001, '9000000003')];

  await page.addInitScript(([k, o]) => localStorage.getItem(k) || localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: [], deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders]);
  await page.goto(APP);
  await waitReady(page);
  await openTab(page, 'entry');

  expect(errs, 'ชั้น poNo ก็ throw ได้เหมือนชั้น week').toEqual([]);
  await expect(page.locator('#entryTable tbody tr')).toHaveCount(2);
  // และต้องเรียงถูกจริง ไม่ใช่แค่ไม่ตาย
  const po = await page.locator('#entryTable tbody tr td:nth-child(3)').allInnerTexts();
  expect(po.map(x => x.trim())).toEqual(['5267001', '5267002']);
});
