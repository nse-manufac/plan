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
async function open(page, rowsOnSheet) {
  const gs = loadGs();
  const r = gs.api.doPushRows('Orders', rowsOnSheet.map(o => Object.assign({}, o)), 'ชีตตั้งต้น');
  expect(r.ok, 'เตรียมชีตปลอมไม่สำเร็จ: ' + JSON.stringify(r)).toBeTruthy();
  const sheet = gs.book.getSheetByName('Orders');
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = head.indexOf('updatedAt') + 1;
  expect(col, 'ชีตปลอมไม่มีคอลัมน์ updatedAt').toBeGreaterThan(0);
  rowsOnSheet.forEach((row, i) => sheet.getRange(2 + i, col).setValue(row.updatedAt));

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
    orders: [], records: [], deliveryNotes: [], deltaWip: [], deliveryLog: [], importHistory: []
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

/* คลายแล้วต้องมาร์ครอส่ง ไม่งั้นค่าที่ถูกอยู่แค่ในเครื่อง ชีตยังเพี้ยนต่อไป
   ⚠️ ตรวจที่ "ถูก push ขึ้นไปแล้ว" ไม่ใช่ที่ธง `_dirty` — ธงถูกล้างทันทีที่ push สำเร็จ
   ดูที่ค่าบนชีตจึงเป็นการวัดผลลัพธ์จริง ไม่ใช่สถานะชั่วคราวที่อาจหลุดจังหวะ */
test('คลายแล้วต้องดันค่าที่ถูกขึ้นชีตเอง โดยไม่มีใครกดอะไร', async ({ page }) => {
  // ⚠️ ตัวคลายทำงาน "หลัง" ขั้น push ของรอบซิงค์นั้นแล้ว การดันขึ้นจึงเกิดที่รอบถัดไป (ทุก 20 วิ)
  //    ข้อนี้จึงต้องรอข้ามหนึ่งรอบจริง ๆ — เป็นเหตุผลเดียวที่ขยายเวลาของข้อนี้ ไม่ใช่เพราะเครื่องช้า
  test.setTimeout(70_000);
  const gs = await open(page, [SHIFTED]);
  await pulled(page, TRUE_ROW.id);
  await expect.poll(() => {
    const res = gs.api.doPullRows('Orders', '');
    const row = ((res.rows) || []).find(r => r.id === TRUE_ROW.id);
    return row ? row.importedAt : null;
  }, { message: 'ชีตไม่เคยได้ค่าที่คลายแล้ว', timeout: 45000 }).toBe(TRUE_ROW.importedAt);

  const res = gs.api.doPullRows('Orders', '');
  const row = res.rows.find(r => r.id === TRUE_ROW.id);
  expect(row.status).toBe('active');
  expect(row.planInspection).toBe(TRUE_ROW.planInspection);
});

test('แถวปกติที่มาถึงทาง pull ต้องไม่ถูกแตะ', async ({ page }) => {
  await open(page, [TRUE_ROW]);
  const o = await pulled(page, TRUE_ROW.id);
  expect(four(o)).toEqual(four(TRUE_ROW));
  expect(o.updatedAt).toBe(TRUE_ROW.updatedAt);   // แถวปกติไม่ถูกมาร์ครอส่ง จึงไม่มีอะไรมาเขียนทับ
});
