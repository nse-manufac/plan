// เทสว่าค่าที่เพี้ยนไปลง "แอตทริบิวต์" ใน innerHTML ไม่ได้ — INVARIANTS G3
//
// ── ต่างจาก tests/escape-date.spec.js ยังไง ───────────────────────
// ไฟล์นั้นคุมค่าที่ลงเป็น "เนื้อข้อความ" ใน <td> · ไฟล์นี้คุมค่าที่ลงเป็น "ค่าของแอตทริบิวต์"
// (`data-id="${...}"` · `value="${...}"`) ซึ่งพังได้ด้วยอัญประกาศเดี่ยวตัวเดียว ไม่ต้องมี `<` เลย
// ค่าที่มี `"` ปิดแอตทริบิวต์นั้นก่อนกำหนด แล้วที่เหลือกลายเป็นแอตทริบิวต์ใหม่ของ element เดิม
//
// ── ทำไมแอตทริบิวต์ร้ายกว่าที่คิด ─────────────────────────────────
// นอกจากสคริปต์วิ่ง ยังมีผลที่ไม่มีอะไรฟ้องเลย: ค่าที่ถูกตัดสั้นลงกลายเป็นกุญแจที่ผิด
// `data-delete="R1" ...` ทำให้ dataset.delete เหลือแค่ `R1` ซึ่งอาจเป็น id ของ **รายการอื่น**
// กดลบแถวที่เพี้ยน → voidRecords(['R1']) → ไปยกเลิกรายการที่ไม่เกี่ยวข้องแทน
// คนกดเห็นว่า "ลบแล้ว" แต่ลบผิดใบ · เทสนี้จึงวัดสองอย่าง: สคริปต์ไม่วิ่ง **และ** ลบถูกแถว
//
// ── ค่าเพี้ยนเข้ามาได้ทางไหน ───────────────────────────────────────
// ไม่ใช่ทางไฟล์แผน Excel — ที่นั่น id ถูกสร้างจาก uid() และ qty ผ่าน Number()
// ทางที่เข้าได้คือ **ชีตฝั่งเซิร์ฟเวอร์** (pull ตอนซิงค์) และ **รวมข้อมูลจากไฟล์** (applyMerge)
// ทั้งสองทางเขียน id/qty ลง state ตรง ๆ โดยไม่แปลงชนิด
//
// กล่องสรุปก่อนรวมข้อมูลร้ายกว่านั้นอีก เพราะ **ไม่ต้องมี state เพี้ยนมาก่อนเลย**
// ไฟล์ JSON ที่ยัดมาใบเดียวพอ: Number('<img…>') = NaN ไม่เท่ากับยอดในเครื่อง → เข้าช่อง "ขัดแย้งกัน"
// → วาดลง innerHTML ทันที · สคริปต์วิ่งตอนกล่องเด้ง **ก่อน** คนกด "ยืนยันรวมข้อมูล"

const { test, expect } = require('@playwright/test');
const { forgetSavedOnEveryLoad, waitReady, readSaved } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

/* ⚠️ ต้องขึ้นต้นด้วย `"` และต้องมี id ของรายการอื่นอยู่ข้างหน้า (`R1`)
   ไม่งั้นเทส "ลบถูกแถว" จะเขียวเพราะ dataset หาอะไรไม่เจอ ไม่ใช่เพราะโค้ดถูก */
const EVIL_ID = 'R1" autofocus onfocus="window.__pwned=1';
const EVIL_QTY = '100" autofocus onfocus="window.__pwned=1';
/** ปิดอัญประกาศแล้วแตกเป็นแท็กจริง — ใช้กับที่ที่ค่าลงเป็นเนื้อข้อความ (กล่องสรุปก่อนรวมข้อมูล) */
const EVIL_TAG = '<img src=x onerror="window.__pwned=1">';

const order = (poNo, pn, qty) => ({
  id: poNo + '|' + pn, week: 'WK 34', poNo, pn, subName: 'TUE-U', orderQty: qty, orderDate: '2026-08-03',
  status: 'active', importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const rec = (id, orderId, qty, date) => ({
  id, date, orderId, process: 'winding', qty, note: '', deviceName: 't',
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', voided: false, _dirty: false
});

async function open(page, orders, records = []) {
  await forgetSavedOnEveryLoad(page);
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: r, deliveryNotes: [], deltaWip: [], deliveryLog: [], importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await waitReady(page);
}

/** สคริปต์ไม่วิ่ง และไม่มีแอตทริบิวต์ที่ยัดมาเกาะอยู่บน element จริง */
async function expectNotPwned(page, where) {
  expect(await page.evaluate(() => window.__pwned), `สคริปต์ที่ยัดมาวิ่งแล้ว (${where})`).toBeUndefined();
  expect(await page.locator('[onfocus]').count(), `onfocus ที่ยัดมาเกาะบน element จริง (${where})`).toBe(0);
}

/* สองใบสองแถว — แถวที่ id เพี้ยนอยู่บนสุด (เรียงวันที่ใหม่ก่อน) และมีแถว id `R1` อยู่ข้างล่างให้เผลอไปลบ */
const ORDER_A = order('TM5267H179', '2870327301', 800);
const ORDER_B = order('TM5267H180', '2870327302', 800);
const twoRows = () => [rec('R1', ORDER_A.id, 100, '2026-08-20'), rec(EVIL_ID, ORDER_B.id, 200, '2026-08-21')];

async function openRecordEditor(page, records) {
  await open(page, [ORDER_A, ORDER_B], records);
  await page.click('.tab-btn[data-tab="entry"]');
  await expect(page.locator('#recordEditorTable tbody tr')).toHaveCount(records.length);
}

test('G3 — record.id ที่เพี้ยนต้องไม่กลายเป็นสคริปต์ตอนกดเข้าช่องจำนวน', async ({ page }) => {
  await openRecordEditor(page, twoRows());
  // ท่าปกติของคนคีย์: กดเข้าช่องจำนวนในตารางแก้ไข/ลบรายการเพื่อแก้ยอดที่คีย์ผิด
  await page.click('#recordEditorTable tbody tr:first-child .rec-qty-input');
  await expectNotPwned(page, 'ช่องจำนวนในตารางแก้ไข/ลบรายการ');
});

test('G3 — กดลบแถวที่ id เพี้ยน ต้องลบแถวนั้น ไม่ใช่แถวอื่น', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await openRecordEditor(page, twoRows());
  await page.click('#recordEditorTable tbody tr:first-child [data-delete]');

  const voidedOf = async id => {
    const st = await readSaved(page, K_STATE);
    return (st.records.find(r => r.id === id) || {}).voided;
  };
  await expect.poll(() => voidedOf(EVIL_ID), { message: 'แถวที่กดลบต้องถูกยกเลิก' }).toBe(true);
  expect(await voidedOf('R1'), 'แถวที่ไม่ได้กดต้องไม่ถูกยกเลิก (id ที่ถูกตัดสั้นไปตรงกับใบนี้)').toBe(false);
});

test('G3 — ติ๊กแถวที่ id เพี้ยนแล้วกด "ลบรายการที่เลือก" ต้องลบแถวนั้น', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await openRecordEditor(page, twoRows());
  await page.click('#recordEditorTable tbody tr:first-child .rec-chk');
  await page.click('#btnRecDeleteSelected');

  const st = await readSaved(page, K_STATE);
  const voidedIds = st.records.filter(r => r.voided).map(r => r.id);
  expect(voidedIds, 'ต้องยกเลิกเฉพาะแถวที่ติ๊ก').toEqual([EVIL_ID]);
});

test('G3 — record.qty ที่เพี้ยนต้องไม่กลายเป็นสคริปต์ผ่าน value ของช่องจำนวน', async ({ page }) => {
  await openRecordEditor(page, [rec('R1', ORDER_A.id, EVIL_QTY, '2026-08-20')]);
  await page.click('#recordEditorTable tbody tr:first-child .rec-qty-input');
  await expectNotPwned(page, 'value ของช่องจำนวน');
});

test('G3 — กล่องสรุปก่อนรวมข้อมูล: วันที่กับยอดที่เพี้ยนต้องไม่วิ่งตอนกล่องเด้ง', async ({ page }) => {
  // ยอดในเครื่องเป็นตัวเลขปกติ ไม่มีอะไรเพี้ยนค้างอยู่เลย — ของเพี้ยนมาจากไฟล์ที่เพิ่งเลือกทั้งหมด
  await open(page, [ORDER_A], [rec('R1', ORDER_A.id, 100, EVIL_TAG)]);
  await page.click('.tab-btn[data-tab="data"]');

  /* กุญแจของ record คือ orderId|process|date (A2) — วันต้องตรงกันทั้งสองฝั่งถึงจะนับเป็น "ขัดแย้งกัน"
     ยอดต่างกันจึงเข้าช่องขัดแย้ง · updatedAt ใหม่กว่าทำให้ฝั่งไฟล์เป็นผู้ชนะ ค่าจึงโผล่ทั้งช่อง "vs" และช่อง "ใช้" */
  const incoming = {
    orders: [ORDER_A],
    records: [Object.assign(rec('R9', ORDER_A.id, EVIL_TAG, EVIL_TAG), { updatedAt: '2026-09-01T00:00:00.000Z' })]
  };
  await page.setInputFiles('#mergeFileInput', {
    name: 'merge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming))
  });

  await expect(page.locator('#mergeModal')).toHaveClass(/show/);
  await expect(page.locator('#mergeSummary')).toContainText('ขัดแย้งกัน 1 รายการ');
  expect(await page.locator('#mergeSummary img').count(), 'แท็กที่ยัดมากลายเป็น element จริงในกล่องสรุป').toBe(0);
  expect(await page.evaluate(() => window.__pwned), 'สคริปต์วิ่งตอนกล่องสรุปเด้ง ก่อนกดยืนยันรวมข้อมูล').toBeUndefined();
  // และค่าที่เพี้ยนต้องอ่านออกเป็นตัวหนังสือ ไม่ใช่หายไปเฉย ๆ — คนตัดสินใจกดยืนยันจากตัวเลขในกล่องนี้
  await expect(page.locator('#mergeSummary')).toContainText(EVIL_TAG);
});
