// เครื่องนี้จำฟอร์ม FM-ST-07 ที่เลือกไว้ ไม่ให้ต้องหาไฟล์ใหม่ทุกครั้งที่เปิดโปรแกรม
//
// ⚠️ เทสในไฟล์นี้ **ห้ามใช้ forgetSavedOnEveryLoad()** — ตัวนั้นลบ IndexedDB ทุกครั้งที่หน้าโหลด
//    ซึ่งจะลบฟอร์มที่จำไว้ไปด้วย แล้วเทสจะเขียวเพราะไม่มีอะไรให้กู้ ไม่ใช่เพราะโค้ดถูก
//    Playwright ให้ context ใหม่ต่อเทสอยู่แล้ว IndexedDB จึงว่างตั้งแต่ต้นโดยไม่ต้องลบเอง
//
// คำถามของเจ้าของ (25 ต.ค. 2026): "จำไว้แล้วจะได้ไฟล์เหมือนเดิมทุกครั้งมั้ย เรื่องโลโก้กับขนาด cell"
// ข้อ "ไฟล์หลังรีโหลดต้องเท่ากันถึงระดับไบต์" ข้างล่างคือคำตอบที่พิสูจน์ด้วยการรัน ไม่ใช่ด้วยการอธิบาย

const { test, expect } = require('@playwright/test');
const { waitReady, readSaved, IDB_NAME, IDB_STORE } = require('./app-state');
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
  /* ฟอร์มที่จำไว้ไม่เติมเลข WK ให้ (ตั้งใจ — ดูข้อข้างล่าง) จึงต้องพิมพ์เอง
   * ใช้เลขเดียวกับที่ฟอร์มเติมให้รอบแรก เพื่อให้เทียบไฟล์กันได้จริง */
  await page.fill('#dnWeek', '34');

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

test('ฟอร์มที่จำไว้ต้องไม่เติมเลข WK ให้เอง — ด่านบังคับกรอก WK ต้องยังทำงาน', async ({ page }) => {
  /* ⚠️ เจตนาเดิมของการเติม WK จากฟอร์มคือ "ไฟล์ที่เพิ่งหยิบมาคือฟอร์มของสัปดาห์นี้"
   *    ซึ่งไม่จริงกับไฟล์ที่ค้างอยู่ในเครื่องมาหลายสัปดาห์
   *
   *    ถ้าเติมให้ทุกครั้งที่เปิดโปรแกรม ด่าน "กรอกเลขสัปดาห์ (WK) ก่อนครับ" จะไม่มีโอกาส
   *    ทำงานอีกเลย แล้ว WK ของสัปดาห์เก่าจะไหลลงกระดาษที่ส่ง Delta เองโดยไม่มีใครพิมพ์
   *    (ผู้ตรวจ #112 รันเจอ — เดิมเปิดใหม่ = ช่องว่าง = ถูกบังคับให้คิดเรื่อง WK หนึ่งครั้งต่อรอบ) */
  await open(page);
  await pickTemplate(page);
  expect(await page.inputValue('#dnWeek'), 'ไฟล์ที่เพิ่งเลือกยังเติม WK ให้เหมือนเดิม').toBe('34');

  await page.reload();
  await waitReady(page);
  await waitTpl(page);
  await page.click('.tab-btn[data-tab="delivery"]');

  await expect(page.locator('#btnDnExport'), 'ฟอร์มยังถูกจำไว้').toBeEnabled();
  expect(await page.inputValue('#dnWeek'), 'ฟอร์มที่จำไว้ต้องไม่เติม WK ให้').toBe('');
});

test('เครื่องที่จำฟอร์มให้ไม่ได้ ต้องบอกตรง ๆ ไม่ใช่ขึ้นว่าจำไว้แล้ว', async ({ page }) => {
  /* ⚠️ ข้อนี้กลับด้านกับเจตนาของใบนี้ถ้าทำผิด — ใบนี้มีไว้เพื่อ "ห้ามจำเงียบ ๆ"
   *    การขึ้นว่า "จำฟอร์มไว้แล้ว" ตอนที่จำไม่สำเร็จ แย่กว่าไม่ขึ้นอะไรเลย
   *    เพราะคนจะเชื่อแล้วไม่พกไฟล์มาวันรุ่งขึ้น (ผู้ตรวจ #112 รันเจอ)
   *
   *    จำลองเครื่องที่เปิด IndexedDB ไม่ได้ (เส้นทางสำรองตาม E3) ด้วยการให้ open() ล้มเสมอ */
  /* โยนทิ้งตั้งแต่ open() — openStateDb() ห่อไว้ใน new Promise การโยนในนั้นคือ reject
   * bootState() จึงตก catch แล้วตั้ง stateDb = null และถอยไปใช้ localStorage ตามเส้นทางจริง
   * (ยังไม่มีธง :moved เพราะ context ใหม่ แอปจึงยังเปิดได้ ไม่ใช่ปฏิเสธบูต) */
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new Error('จำลองเครื่องที่เปิด IndexedDB ไม่ได้'); };
  });
  await open(page);
  await pickTemplate(page);

  const txt = await page.locator('#dnTplInfoText').innerText();
  expect(txt, 'ห้ามบอกว่าจำไว้แล้ว').not.toContain('จำฟอร์มไว้แล้ว');
  expect(txt, 'ต้องบอกว่าจำให้ไม่ได้').toContain('จำไว้ให้ไม่ได้');
  expect(txt, 'ต้องบอกผลที่ตามมา').toContain('ต้องเลือกไฟล์ฟอร์มอีกครั้ง');
  await expect(page.locator('#btnDnTplForget'), 'ไม่มีอะไรให้ล้าง').toBeHidden();
  await expect(page.locator('#btnDnExport'), 'รอบนี้ยังออกใบได้ตามปกติ').toBeEnabled();
});

test('เลือกไฟล์ .xls มาทับ ต้องไม่ทำให้ฟอร์มที่จำไว้หายไปจากจอ', async ({ page }) => {
  /* ผู้ตรวจ #112 ทักสองรอบติด — รอบแรกผมใส่ restoreDnTemplate() ไว้แค่ที่ catch ของการแกะ zip
   * แต่ทาง .xls กับทาง "กดยกเลิกหน้าต่างเลือกไฟล์" ออกก่อนถึงตรงนั้น
   * ของยังอยู่ในฐานข้อมูล แต่หายจากจอ แล้วคนต้องไปรีเฟรชเอง */
  await open(page);
  await pickTemplate(page);
  await expect(page.locator('#btnDnExport')).toBeEnabled();

  await page.setInputFiles('#dnTemplateInput', { name: 'เก่า.xls',
    mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('ไม่ใช่ xlsx') });
  await page.waitForTimeout(400);

  await expect(page.locator('#btnDnExport'), 'ฟอร์มที่จำไว้ต้องถูกดึงกลับมา').toBeEnabled();
  expect(await page.locator('#dnTplInfoText').innerText()).toContain('FM-ST-07.xlsx');
});

test('ล้างข้อมูลทั้งหมด ต้องไม่ลบฟอร์มที่จำไว้ และกล่องยืนยันต้องบอกไว้', async ({ page }) => {
  /* 🔒 เจ้าของเคาะเมื่อ 25 ต.ค. 2026 — ฟอร์มเปล่าของบริษัทไม่ใช่ข้อมูลธุรกิจ จึงไม่ถูกลบ
   *    เทสนี้ล็อกคำตัดสินไว้ ไม่ให้ใครมา "แก้" ทีหลังเพราะเห็นว่าปุ่มเขียนว่าลบทั้งหมด
   *    (ผู้ตรวจ #112 ทักเรื่องคำกับของไม่ตรงกัน — แก้ที่คำ ไม่ใช่ที่ของ) */
  await open(page);
  await pickTemplate(page);

  const asked = [];
  page.on('dialog', d => { asked.push(d.message()); d.accept(); });
  await page.click('.tab-btn[data-tab="data"]');
  await page.click('#btnClearAll');
  await page.waitForTimeout(500);

  expect(asked.length, 'ต้องถามยืนยันสองชั้นเหมือนเดิม').toBe(2);
  expect(asked[1], 'กล่องยืนยันต้องบอกว่าฟอร์มไม่ถูกลบ').toContain('จะไม่ถูกลบ');
  expect(asked[1], 'ต้องบอกว่าล้างฟอร์มได้ที่ไหน').toContain('ล้างฟอร์มที่จำไว้');

  await page.reload();
  await waitReady(page);
  await waitTpl(page);
  await expect(page.locator('#btnDnExport'), 'ฟอร์มที่จำไว้ต้องยังอยู่').toBeEnabled();

  /* ⚠️ ข้อนี้ต้องยืนยันด้วยว่าปุ่ม "ลบข้อมูลทั้งหมด" ยังลบข้อมูลจริง
   *    ถ้าล็อกแค่ว่าฟอร์มรอด วันที่ปุ่มพังเทสข้อนี้จะยังเขียว (ผู้ตรวจ #112 ทัก) */
  const left = await readSaved(page, K_STATE);
  expect(left.orders, 'ใบสั่งต้องถูกลบจริง').toEqual([]);
});
