// คลายคอลัมน์ที่เลื่อนให้แถวที่ "เพิ่งดึงลงมา" ด้วย ไม่ใช่เฉพาะแถวที่นอนอยู่ในเครื่องแล้ว
//
// ── ทำไมต้องมีผู้เรียกที่สอง ──────────────────────────────────────
// ตัวคลายตัวแรกอยู่ใน `prepareState()` ซึ่งวิ่งตอน **เปิดโปรแกรม** · แถวที่ไม่เคยมีอยู่ในเครื่องไหนเลย
// จะมาถึงทาง **pull** เท่านั้น และ `mergeRowsInto()` เก็บมันด้วย `_dirty:false`
// ถ้ามีแต่ตัวแรก คนต้อง **รีโหลดหน้า** หลังกด "ดึงรายการทั้งหมดใหม่" ตัวคลายถึงจะเห็น
// — ซึ่งเป็นขั้นที่คนลืม และเจ้าของบอกไว้ตั้งแต่ต้นว่าไล่สั่งทีละเครื่องไม่ไหว
//
// ของจริงมีช่องว่างนี้จริง: ชีตมีใบที่เลื่อน **441 ใบ** แต่สำเนาในเครื่องเจ้าของมี **398 ใบ**
// ต่างกัน 43 ใบ เพราะ pull แบบ `since` ไม่เคยส่งแถวพวกนั้นมา (ผู้ตรวจ #136 รอบ 13 ทัก)
//
// ── วิธีทดสอบ ─────────────────────────────────────────────────────
// เอา `google-apps-script.gs` ตัวจริงมารันบนชีตปลอม แล้วให้หน้าเว็บคุยกับมัน
// เครื่องเริ่มจาก **ไม่มีใบสั่งเลย** แถวที่เพี้ยนจึงมาถึงทาง pull ทางเดียว และไม่มีการรีโหลดหน้า

const { test, expect } = require('@playwright/test');
const { readSaved, waitReady } = require('./app-state');
const { loadGs } = require('./fake-gs');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const K_SYNC = 'tue_order_tracker_sync_v1';
const OFFSETS = { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 };

/** ค่าจริงของใบ — ห้าช่องท้ายอยู่ที่เดิมของมัน */
const TRUE_ROW = {
  id: 'TM5271H201|PN-Z', week: 38, poNo: 'TM5271H201', pn: 'PN-Z', subName: 'TUE-H',
  osc: '', pc: '', orderQty: 500, orderDate: '2026-09-14',
  planWinding: '2026-09-17', planAssembly: '2026-09-19',
  planSupport: '', planInspection: '2026-09-21', status: 'active',
  importedAt: '2026-09-15T02:11:09.004Z', updatedAt: '2026-09-18T06:40:00.000Z', voided: false
};

/** หมุนห้าช่องไปข้างหน้าหนึ่งตำแหน่ง = สิ่งที่ค้างอยู่บนชีตจริงสำหรับใบที่เลื่อน */
const SHIFTED = Object.assign({}, TRUE_ROW, {
  planInspection: TRUE_ROW.planSupport, status: TRUE_ROW.planInspection,
  importedAt: TRUE_ROW.status, updatedAt: TRUE_ROW.importedAt, planSupport: TRUE_ROW.updatedAt
});

/* เทียบสี่ช่องที่เก็บ **ข้อมูลของใบ** ไม่รวม updatedAt ซึ่งเป็นนาฬิกาของการซิงค์
   · ค่าที่คลายได้เป็น **วันล้วน** เพราะ mergeRowsInto ตัด planSupport ตั้งแต่ตอน pull
   · และพอ push สำเร็จ ทั้งเซิร์ฟเวอร์และ doSync เขียน serverTime ทับ (D4) จึงตรึงไว้เทียบไม่ได้ */
const FOUR = ['planSupport', 'planInspection', 'status', 'importedAt'];
const four = o => Object.fromEntries(FOUR.map(k => [k, o[k]]));

/** เปิดหน้าโดยเครื่องยังไม่มีใบสั่งเลย ต่อซิงค์เข้ากับ .gs ตัวจริงบนชีตปลอมที่มีแถวเพี้ยนรออยู่
 *
 * 🚨 **ต้องเขียนช่อง `updatedAt` ลงชีตเองหลัง push ห้ามพึ่งค่าที่ส่งไป**
 *    `doPushRows` ฝั่งเซิร์ฟเวอร์ประทับ `updatedAt` ใหม่ทุกแถวที่เขียน (D4) ซึ่งสำหรับใบที่เลื่อน
 *    คือช่องที่ถือ `importedAt` **ตัวจริง** อยู่ · ปล่อยไว้แล้ว fixture จะกลายเป็น "วันนำเข้า = วันนี้"
 *    แล้วข้อที่เทียบ `importedAt` จะแดงด้วยเหตุที่ไม่เกี่ยวกับตัวคลายเลย
 * 🚨 **และต้องส่ง "สำเนา" ให้ doPushRows ไม่ใช่ตัว fixture เอง**
 *    มันเขียน `updatedAt` ทับ **ลงในอ็อบเจกต์ที่รับมา** ไม่ใช่แค่ลงชีต · ส่งตัวจริงไปแล้วค่าที่ตั้งใจ
 *    จะ seed หายตั้งแต่ก่อนได้ใช้ แล้วบรรทัดข้างล่างจะ "เขียนค่าของเซิร์ฟเวอร์ทับด้วยค่าของเซิร์ฟเวอร์"
 *    ซึ่งดูเหมือนทำงานแต่ไม่ได้ทำอะไรเลย (เจอเองตอนเขียนเทส เสียเวลาไปหลายรอบ) */
async function open(page, rowsOnSheet, ordersInDevice = []) {
  const gs = loadGs();
  if(rowsOnSheet.length){
  const r = gs.api.doPushRows('Orders', rowsOnSheet.map(o => Object.assign({}, o)), 'ชีตตั้งต้น');
  expect(r.ok, 'เตรียมชีตปลอมไม่สำเร็จ: ' + JSON.stringify(r)).toBeTruthy();
  const sheet = gs.book.getSheetByName('Orders');
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = head.indexOf('updatedAt') + 1;
  expect(col, 'ชีตปลอมไม่มีคอลัมน์ updatedAt').toBeGreaterThan(0);
  rowsOnSheet.forEach((row, i) => sheet.getRange(2 + i, col).setValue(row.updatedAt));
  }

  await page.route('**/exec', async route => {
    const raw = route.request().postData() || '{}';
    const out = gs.api.doPost({ postData: { contents: raw }, parameter: {} });
    await route.fulfill({ contentType: 'application/json', body: out.body });
  });
  await page.addInitScript(([k, sk, st, cfg]) => {
    indexedDB.deleteDatabase('tue_order_tracker');
    localStorage.setItem(k, JSON.stringify(st));
    localStorage.setItem(sk, JSON.stringify(cfg));
  }, [K_STATE, K_SYNC, {
    version: 1, deviceName: 'เครื่องทดสอบ', deadlineOffsets: OFFSETS,
    chartPref: { mode: '14', from: '', to: '' },
    orders: ordersInDevice, records: [], deliveryNotes: [], deltaWip: [], deliveryLog: [], importHistory: []
  }, { url: 'https://example.test/exec', token: gs.api.TOKEN, auto: true }]);

  await page.goto(APP);
  await waitReady(page);
  return gs;
}

/** รอจนแถวนั้นมาถึงเครื่อง แล้วคืนค่าที่บันทึกไว้ — ไม่มีการรีโหลดหน้าระหว่างทาง */
async function pulled(page, id) {
  let got = null;
  await expect.poll(async () => {
    const st = await readSaved(page, K_STATE);
    got = (st && st.orders || []).find(o => o.id === id) || null;
    return !!got;
  }, { message: 'แถวจากชีตไม่เคยมาถึงเครื่อง', timeout: 15000 }).toBe(true);
  return got;
}

test('แถวที่เลื่อนซึ่งมาถึงทาง pull ต้องถูกคลายทันที ไม่ต้องรีโหลดหน้า', async ({ page }) => {
  await open(page, [SHIFTED]);
  const o = await pulled(page, TRUE_ROW.id);
  expect(four(o)).toEqual(four(TRUE_ROW));
});

/* 🚨 **ตัวคลายห้ามแตะชีต** — มันซ่อมเฉพาะสิ่งที่เครื่องนี้แสดง
   ฉบับแรกของใบนี้มาร์ค `_dirty` เพื่อดันขึ้นไป ซึ่งทำให้ **สำเนาเก่าในเครื่องชนะของล่าสุดบนชีต**
   (push มาก่อน pull · และ `mergeRowsInto()` ไม่ทับแถวที่ `_dirty`) · ข้อข้างล่างคือฉากที่ผู้ตรวจรันเจอ */
test('ตัวคลายต้องไม่แตะชีตเลย — ชีตซ่อมที่ต้นทาง', async ({ page }) => {
  test.setTimeout(70_000);
  const gs = await open(page, [SHIFTED]);
  await pulled(page, TRUE_ROW.id);
  await page.waitForTimeout(25_000);        // ข้ามรอบซิงค์อัตโนมัติไปหนึ่งรอบเต็ม (ทุก 20 วิ)
  const row = gs.api.doPullRows('Orders', '').rows.find(r => r.id === TRUE_ROW.id);
  expect(row.importedAt, 'ชีตถูกเขียนทับ ทั้งที่ตัวคลายไม่ควรแตะ').toBe(SHIFTED.importedAt);
});

/* 🚨 ฉากที่ฉบับแรกของใบนี้ทำพัง — เครื่องที่ปิดไว้นานแล้วเพิ่งเปิด ถือสำเนาที่ **เก่ากว่า** ชีต
   (เกิดได้จริงเพราะช่วงที่บั๊กอยู่ คอลัมน์ `updatedAt` บนชีตไม่ขยับ การยกเลิกใบจึงไม่เคยไหลไปเครื่องอื่น)
   ถ้าตัวคลายมาร์ค `_dirty` สำเนาเก่านั้นจะถูก push ทับของล่าสุด = **ใบที่ยกเลิกไว้กลับมาเอง** */
test('สำเนาเก่าในเครื่องต้องไม่ทับของล่าสุดบนชีต — ใบที่ยกเลิกต้องไม่ฟื้น', async ({ page }) => {
  test.setTimeout(70_000);
  const LATEST = Object.assign({}, TRUE_ROW, { orderQty: 2000, voided: true });
  const STALE = Object.assign({}, SHIFTED, { orderQty: 1000, voided: false, _dirty: false });
  const gs = await open(page, [LATEST], [STALE]);
  await page.waitForTimeout(25_000);
  const row = gs.api.doPullRows('Orders', '').rows.find(r => r.id === TRUE_ROW.id);
  expect(Number(row.orderQty), 'ยอดสั่งล่าสุดบนชีตถูกสำเนาเก่าทับ').toBe(2000);
  expect(String(row.voided).toLowerCase(), 'ใบที่ยกเลิกไว้ฟื้นกลับมา').toBe('true');
});

test('แถวปกติที่มาถึงทาง pull ต้องไม่ถูกแตะ', async ({ page }) => {
  await open(page, [TRUE_ROW]);
  const o = await pulled(page, TRUE_ROW.id);
  expect(four(o)).toEqual(four(TRUE_ROW));
  expect(o.updatedAt).toBe(TRUE_ROW.updatedAt);   // แถวปกติไม่ถูกมาร์ครอส่ง จึงไม่มีอะไรมาเขียนทับ
});

/* 🚨 **รวมข้อมูลจากไฟล์ — ทางที่แถวเลื่อนกลายเป็น `_dirty` "ระหว่างที่โปรแกรมเปิดอยู่"**
   `applyMerge()` ติด `_dirty:true` แล้วเรียก `doSync()` ทันที · `doSync()` **push ก่อน**
   แล้วเขียน `o.updatedAt = serverTime` ทับ **ช่องที่ถือ `importedAt` ตัวจริงของใบที่เลื่อน**
   ตัวคลายที่วิ่งทีหลัง (หลัง `mergeRowsInto`) จึงหยิบ serverTime ไปใส่ `importedAt` = วันนำเข้าหายถาวร
   ตอนบูตไม่เจอรูนี้ เพราะ `prepareState()` คลายไปก่อน `doSync()` แล้ว
   `importedAt` คือฐานของกราฟยอดค้างรายวัน (C1) และค่าผิดกระจายต่อไปทุกเครื่องที่ pull แถวนั้น
   (ผู้ตรวจ #138 รันพิสูจน์ · ตัวแก้คือผู้เรียกที่ **ต้น `doSync()` ก่อนบล็อก push**) */
test('รวมข้อมูลจากไฟล์ที่มีแถวเลื่อน — importedAt ตัวจริงต้องไม่ถูก serverTime ทับ', async ({ page }) => {
  test.setTimeout(70_000);
  await open(page, []);
  await page.click('.tab-btn[data-tab="data"]');
  await page.setInputFiles('#mergeFileInput', {
    name: 'merge.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ orders: [SHIFTED], records: [] }), 'utf8')
  });
  await page.click('#mergeConfirmBtn');
  // รอจนรอบซิงค์คลายให้เสร็จ — ตอน applyMerge บันทึกครั้งแรก แถวยังเป็นรูปที่เลื่อนอยู่
  // อ่านเร็วกว่านั้นจะเจอรูปกลางทาง แล้วเทสจะแดงด้วยเหตุที่ไม่ใช่สิ่งที่ข้อนี้คุม
  let o = null;
  await expect.poll(async () => {
    o = await pulled(page, TRUE_ROW.id);
    return o.importedAt !== 'active';
  }, { message: 'ตัวคลายไม่เคยทำงานกับแถวที่รวมมาจากไฟล์', timeout: 45000 }).toBe(true);
  expect(o.importedAt, 'วันนำเข้าตัวจริงถูก serverTime ทับ').toBe(TRUE_ROW.importedAt);
  expect(o.status).toBe('active');
  expect(o.planInspection).toBe(TRUE_ROW.planInspection);
});
