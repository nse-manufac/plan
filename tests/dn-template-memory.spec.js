// เครื่องนี้จำฟอร์ม FM-ST-07 ที่เลือกไว้ ไม่ให้ต้องหาไฟล์ใหม่ทุกครั้งที่เปิดโปรแกรม
//
// ⚠️ เทสในไฟล์นี้ **ห้ามใช้ forgetSavedOnEveryLoad()** — ตัวนั้นลบ IndexedDB ทุกครั้งที่หน้าโหลด
//    ซึ่งจะลบฟอร์มที่จำไว้ไปด้วย แล้วเทสจะเขียวเพราะไม่มีอะไรให้กู้ ไม่ใช่เพราะโค้ดถูก
//    Playwright ให้ context ใหม่ต่อเทสอยู่แล้ว IndexedDB จึงว่างตั้งแต่ต้นโดยไม่ต้องลบเอง
//
// คำถามของเจ้าของ (25 ต.ค. 2026): "จำไว้แล้วจะได้ไฟล์เหมือนเดิมทุกครั้งมั้ย เรื่องโลโก้กับขนาด cell"
// ข้อ "ไฟล์หลังรีโหลดต้องเท่ากันถึงระดับไบต์" ข้างล่างคือคำตอบที่พิสูจน์ด้วยการรัน ไม่ใช่ด้วยการอธิบาย

const { test, expect } = require('@playwright/test');
const { waitReady, IDB_NAME, IDB_STORE } = require('./app-state');
const fs = require('fs');
const JSZip = require('jszip');
const { deliveryFormWorkbook } = require('./fixtures');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const TPL_KEY = K_STATE + ':dnTemplate';
const DATE = '2026-08-29';
const PN = '9000000002';

const ORDERS = [{
  id: 'PO-B001|' + PN, week: 'WK 34', poNo: 'PO-B001', pn: PN, subName: 'TUE-U',
  orderQty: 12000, orderDate: '2026-08-03', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
}];

/** รอให้แอปลองกู้ฟอร์มที่จำไว้เสร็จ — ได้หรือไม่ได้ก็ตาม */
const waitTpl = page => expect.poll(
  () => page.evaluate(() => document.documentElement.dataset.dnTplReady === '1'),
  { message: 'แอปยังไม่ลองกู้ฟอร์มที่จำไว้' }).toBe(true);

async function open(page) {
  await page.addInitScript(([k, o]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: o, records: [], deliveryNotes: [], deltaWip: [], deliveryLog: [], importHistory: []
  })), [K_STATE, ORDERS]);
  await page.goto(APP);
  await waitReady(page);
  await waitTpl(page);
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.fill('#dnDate', DATE);
  await page.waitForTimeout(150);
  await page.selectOption('#dnUnit', 'TUE-U');
  await page.waitForTimeout(150);
}

async function pickTemplate(page) {
  const src = await deliveryFormWorkbook(['TUE-U', 'TUE-H']);
  await page.setInputFiles('#dnTemplateInput', {
    name: 'FM-ST-07.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: src });
  await expect(page.locator('#btnDnExport')).toBeEnabled();
  return src;
}

/** กรอกยอดให้ออกใบได้ */
async function fill(page) {
  const a = page.locator(`#dnTable input.dn-alloc[data-order="PO-B001|${PN}"]`);
  await a.fill('100'); await a.press('Tab'); await page.waitForTimeout(150);
  const b = page.locator(`#dnTable input.dn-pack[data-pn="${PN}"][data-f="perBox"]`);
  await b.fill('50'); await b.press('Tab'); await page.waitForTimeout(150);
}

const exportFile = async page => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnDnExport')]);
  return fs.readFileSync(await dl.path());
};

test('เลือกฟอร์มแล้วต้องยังใช้ได้หลังรีเฟรช โดยไม่ต้องเลือกไฟล์ใหม่', async ({ page }) => {
  await open(page);
  await expect(page.locator('#btnDnExport'), 'ยังไม่เลือกฟอร์ม ต้องกดออกใบไม่ได้').toBeDisabled();
  await pickTemplate(page);

  await page.reload();
  await waitReady(page);
  await waitTpl(page);

  await expect(page.locator('#btnDnExport'), 'ฟอร์มที่จำไว้ต้องถูกกู้คืนเอง').toBeEnabled();
  // ⚠️ รีโหลดแล้วแท็บกลับไปหน้านำเข้า · #dnTplInfo อยู่ในแท็บใบส่งสินค้า จึงต้องกดเข้าไปก่อนเช็กว่ามองเห็น
  await page.click('.tab-btn[data-tab="delivery"]');
  await expect(page.locator('#dnTplInfo')).toBeVisible();
  expect(await page.locator('#dnTplInfoText').innerText(), 'ต้องบอกชื่อไฟล์ที่จำไว้')
    .toContain('FM-ST-07.xlsx');
});

test('ไฟล์ที่ออกหลังรีเฟรช ต้องเท่ากับก่อนรีเฟรชถึงระดับไบต์ — โลโก้ ขนาดคอลัมน์ merge ครบ', async ({ page }) => {
  /* คำถามของเจ้าของ: จำเทมเพลตไว้แล้วไฟล์จะเพี้ยนไหม
   *
   * ไม่เพี้ยน เพราะไม่มีอะไรสร้างไฟล์ใหม่ — เก็บไบต์ดิบ แล้ว JSZip.loadAsync() ไบต์เดิม
   * ได้ zip เดิม แล้ว fillDeliveryForm() แก้ช่องเดิม · ปัญหาโลโก้หายเป็นเรื่องของ ExcelJS
   * ที่เขียนไฟล์ใหม่ทั้งไฟล์ ซึ่งเส้นทางนี้ไม่ได้ใช้
   *
   * แต่ข้อนี้ไม่เชื่อคำอธิบาย — มันแกะไฟล์ทั้งสองแล้วเทียบเนื้อทุก entry
   * ถ้า IndexedDB ทำไบต์เพี้ยน หรือมีใครเปลี่ยนไปเก็บเป็นข้อความ/base64 ข้อนี้จะแดงทันที
   *
   * ⚠️ เทียบ "ไบต์ทั้งไฟล์" ตรง ๆ ไม่ได้ — JSZip ประทับ **เวลาปัจจุบัน** ลง entry ที่เขียนทับ
   *    สองไฟล์ที่ออกคนละวินาทีจึงต่างกันที่ metadata ทั้งที่เนื้อเหมือนกันเป๊ะ
   *    เคยเขียนแบบนั้นแล้วแดงแบบสุ่ม ขึ้นกับว่าสองรอบห่างกันข้ามวินาทีหรือไม่ */
  await open(page);
  await pickTemplate(page);
  await fill(page);
  const before = await exportFile(page);

  await page.reload();
  await waitReady(page);
  await waitTpl(page);
  await page.click('.tab-btn[data-tab="delivery"]');
  await page.fill('#dnDate', DATE);
  await page.waitForTimeout(150);
  await page.selectOption('#dnUnit', 'TUE-U');
  await page.waitForTimeout(200);

  await expect(page.locator('#btnDnExport')).toBeEnabled();
  const after = await exportFile(page);

  expect(before.length, 'ต้องได้ไฟล์จริง ไม่ใช่ไฟล์ว่าง').toBeGreaterThan(1000);

  const za = await JSZip.loadAsync(before), zb = await JSZip.loadAsync(after);
  const names = z => Object.keys(z.files).filter(n => !z.files[n].dir).sort();
  expect(names(zb), 'ส่วนประกอบของไฟล์ต้องครบเท่าเดิม ไม่หายไม่เพิ่ม').toEqual(names(za));

  const diff = [];
  for (const n of names(za)) {
    const a = await za.file(n).async('base64'), b = await zb.file(n).async('base64');
    if (a !== b) diff.push(n);
  }
  expect(diff, 'ทุกส่วนของไฟล์ต้องเหมือนเดิม รวม xl/drawings (โลโก้) และความกว้างคอลัมน์').toEqual([]);

  // กันเทสเปล่า — ไฟล์ต้องมีโลโก้กับผังคอลัมน์ให้เทียบจริง ไม่ใช่ zip เปล่าสองอัน
  expect(names(za).length, 'ไฟล์ต้องมีหลายส่วนให้เทียบ').toBeGreaterThan(3);
  expect(names(za).some(n => n.startsWith('xl/worksheets/')), 'ต้องมีชีตอยู่จริง').toBe(true);
});

test('ล้างฟอร์มที่จำไว้ แล้วรีเฟรช ต้องกลับไปต้องเลือกไฟล์ใหม่', async ({ page }) => {
  await open(page);
  await pickTemplate(page);

  page.once('dialog', d => d.accept());
  await page.click('#btnDnTplForget');
  await page.waitForTimeout(300);
  await expect(page.locator('#btnDnExport'), 'ล้างแล้วต้องกดออกใบไม่ได้ทันที').toBeDisabled();
  await expect(page.locator('#dnTplInfo')).toBeHidden();

  await page.reload();
  await waitReady(page);
  await waitTpl(page);
  await expect(page.locator('#btnDnExport'), 'ล้างแล้วต้องไม่ถูกกู้คืนกลับมา').toBeDisabled();
});

test('ฟอร์มที่จำไว้เสีย ต้องแค่ "ไม่มีฟอร์ม" ไม่ใช่เปิดโปรแกรมไม่ได้', async ({ page }) => {
  /* ⚠️ กฎเดียวกับ #100 — ของพังตอนเปิดหน้าต้องไม่ลากทั้งหน้าไปด้วย
   *    ยัดขยะลงคีย์ของเทมเพลตโดยตรง แล้วดูว่าหน้ายังเปิดได้ ข้อมูลยังอยู่ */
  await open(page);
  await page.evaluate(async ([db, store, key]) => {
    await new Promise((ok, fail) => {
      const r = indexedDB.open(db);
      r.onerror = () => fail(r.error);
      r.onsuccess = () => {
        const d = r.result;
        const put = d.transaction(store, 'readwrite').objectStore(store)
          .put({ buf: new Uint8Array([1, 2, 3]).buffer, fileName: 'พัง.xlsx', savedAt: '2026-10-25T00:00:00.000Z' }, key);
        put.onsuccess = () => { d.close(); ok(); };
        put.onerror = () => { d.close(); fail(put.error); };
      };
    });
  }, [IDB_NAME, IDB_STORE, TPL_KEY]);

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.reload();
  await waitReady(page);
  await waitTpl(page);

  await expect(page.locator('#btnDnExport'), 'ฟอร์มเสีย = ไม่มีฟอร์ม').toBeDisabled();
  await page.click('.tab-btn[data-tab="delivery"]');
  await expect(page.locator('#view-delivery'), 'หน้าต้องยังใช้งานได้').toHaveClass(/active/);
  expect(errors, 'ฟอร์มเสียต้องไม่ทำให้หน้าพัง').toEqual([]);
});
