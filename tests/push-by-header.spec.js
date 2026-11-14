// เขียนลงชีตด้วย "ชื่อคอลัมน์" ไม่ใช่ "ตำแหน่งใน ORDER_COLS" — รากของบั๊กคอลัมน์เลื่อน
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────
// `doPushRows` เคยเขียนแถวโดยเรียงค่าตามลำดับของ `cols` แล้วยัดลงคอลัมน์ที่ 1..cols.length
// ซึ่งถูกเฉพาะตอนลำดับใน `cols` ตรงกับหัวตารางของชีตเป๊ะ ๆ
// ส่วน `sheetOf()` เติมคอลัมน์ที่ขาด **ต่อท้าย** หัวตารางเสมอ สองฝั่งจึงหลุดกันได้ง่าย
// พอ `planSupport` ถูกแทรกไว้กลางรายการ (issue #17) ค่าทุกช่องตั้งแต่จุดนั้นเลื่อนไปหนึ่งคอลัมน์
// **เงียบ ๆ ไม่มี error** — ข้อมูล 441 จาก 918 ใบเพี้ยนอยู่หลายเดือน (พบ 14 พ.ย. 2569)
//
// #136 แก้ด้วยการเรียง `ORDER_COLS` ให้ตรงกับหัวตารางของ production
// ใบนี้แก้ที่ราก: แมปด้วยชื่อ จึง **ถูกกับหัวตารางทุกแบบ** ไม่ต้องรู้ว่าชีตไหนเรียงยังไง
//
// ⚠️ ฉากที่สำคัญที่สุดคือ "หัวตารางลำดับเก่า" — สเปรดชีตที่ถูกสร้างระหว่าง 2 ก.ย. 2026
//    ถึงก่อน deploy ใบนี้จะมีหัวตารางแบบนั้น (ชีตทดลอง/สำรอง) · #136 อย่างเดียวจะทำให้ชีตแบบนั้น
//    เหลื่อม **กลับทาง** · ใบนี้ทำให้ทั้งสองแบบถูกพร้อมกัน

const { test, expect } = require('@playwright/test');
const { loadGs } = require('./fake-gs');

/** หัวตารางสองแบบที่มีอยู่จริง — ต่างกันแค่ตำแหน่งของ planSupport */
const HEAD_PROD = ['id', 'week', 'poNo', 'pn', 'subName', 'osc', 'pc', 'orderQty', 'orderDate',
  'planWinding', 'planAssembly', 'planInspection', 'status', 'importedAt', 'updatedAt',
  'planSupport', 'voided'];
const HEAD_OLD = ['id', 'week', 'poNo', 'pn', 'subName', 'osc', 'pc', 'orderQty', 'orderDate',
  'planWinding', 'planAssembly', 'planSupport', 'planInspection', 'status', 'importedAt',
  'updatedAt', 'voided'];

const ORDER = {
  id: 'PO-1|PN-1', week: 'WK 45', poNo: 'PO-1', pn: 'PN-1', subName: 'TUE-U',
  osc: 'ก', pc: 'ข', orderQty: 500, orderDate: '2026-11-04',
  planWinding: '2026-11-07', planAssembly: '2026-11-09', planSupport: '2026-11-10',
  planInspection: '2026-11-12', status: 'active', importedAt: '2026-11-04T01:00:00.000Z',
  voided: false
};

/** อ่านแถวที่เขียนลงชีตกลับมาเป็นวัตถุ โดยใช้หัวตารางของชีตนั้นเอง */
const rowAsObject = (sheet, r) => Object.fromEntries(
  sheet.rows[0].map((name, i) => [String(name), sheet.rows[r][i]]));

for (const [name, head] of [['หัวตารางของ production', HEAD_PROD], ['หัวตารางลำดับเก่า', HEAD_OLD]]) {
  test(`${name} — ทุกค่าต้องลงคอลัมน์ของตัวเอง ไม่เหลื่อมสักช่อง`, async () => {
    const { api, book } = loadGs();
    const sheet = book.insertSheet('Orders');
    sheet.rows[0] = head.slice();

    const res = api.doPushRows('Orders', [Object.assign({}, ORDER)], 'เครื่องทดสอบ');
    expect(res.ok, 'push ต้องสำเร็จ').toBe(true);

    const got = rowAsObject(sheet, 1);
    /* ⚠️ เช็กทีละช่องที่เคยเลื่อน ไม่ใช่เช็กรวม — ถ้าเลื่อนหนึ่งช่องแล้วเช็กรวม
       ข้อความ error จะบอกแค่ว่า "ไม่ตรง" ไม่ได้บอกว่าเลื่อนไปทางไหน */
    expect(got.planSupport, 'planSupport').toBe('2026-11-10');
    expect(got.planInspection, 'planInspection').toBe('2026-11-12');
    expect(got.status, 'status ต้องเป็น active ไม่ใช่วันที่').toBe('active');
    expect(String(got.importedAt), 'importedAt ต้องเป็นเวลา ไม่ใช่คำว่า active')
      .toMatch(/^\d{4}-\d\d-\d\dT/);
    /* `updatedAt` ถูกเซิร์ฟเวอร์ประทับใหม่ทุกครั้งที่ push (D4) — ต้องเป็นเวลา ไม่ใช่วันแผน */
    expect(String(got.updatedAt), 'updatedAt ต้องเป็นเวลาที่เซิร์ฟเวอร์ประทับ')
      .toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(got.orderQty, 'orderQty').toBe(500);

    // และ pull กลับมาต้องได้ค่าเดิมครบ ไม่ใช่แค่ "ลงช่องถูก"
    const back = api.doPullRows('Orders', '').rows[0];
    expect(back.status).toBe('active');
    expect(back.planSupport).toBe('2026-11-10');
    expect(back.planInspection).toBe('2026-11-12');
  });
}

test('แก้แถวเดิมบนหัวตารางลำดับเก่า ก็ต้องไม่เหลื่อม', async () => {
  const { api, book } = loadGs();
  const sheet = book.insertSheet('Orders');
  sheet.rows[0] = HEAD_OLD.slice();
  api.doPushRows('Orders', [Object.assign({}, ORDER)], 'ก');

  // รอบสอง: แถวเดิม (upsert ด้วย id) แก้ยอดสั่ง
  api.doPushRows('Orders', [Object.assign({}, ORDER, { orderQty: 999 })], 'ก');

  expect(sheet.rows.length, 'ต้องเป็นการทับแถวเดิม ไม่ใช่เพิ่มแถวใหม่').toBe(2);
  const got = rowAsObject(sheet, 1);
  expect(got.orderQty).toBe(999);
  expect(got.status, 'ค่าอื่นต้องไม่เลื่อนตามการแก้').toBe('active');
  expect(got.planSupport).toBe('2026-11-10');
});

test('คอลัมน์ที่คนเติมมือไว้ในชีต ต้องไม่ถูกล้างตอน push ทับ', async () => {
  /* ⚠️ ของเดิมเขียนทับแค่คอลัมน์ที่ 1..cols.length จึงไม่เคยแตะคอลัมน์ที่คนเติมท้าย
     ใบนี้เขียนเต็มความกว้างของหัวตาราง ถ้าไม่ระวังจะล้างของคนอื่นทิ้ง
     (ยังไม่มีคอลัมน์แบบนี้ในชีตจริง แต่เป็นของที่ต้องกันไว้ก่อน ไม่ใช่หลังจากหายไปแล้ว) */
  const { api, book } = loadGs();
  const sheet = book.insertSheet('Orders');
  sheet.rows[0] = HEAD_PROD.concat(['หมายเหตุของฝ่ายวางแผน']);
  api.doPushRows('Orders', [Object.assign({}, ORDER)], 'ก');

  const note = 'ห้ามลบ';
  sheet.rows[1][HEAD_PROD.length] = note;              // คนไปพิมพ์ไว้เองในชีต
  api.doPushRows('Orders', [Object.assign({}, ORDER, { orderQty: 777 })], 'ก');

  const got = rowAsObject(sheet, 1);
  expect(got.orderQty, 'ของเราต้องถูกเขียนทับตามปกติ').toBe(777);
  expect(got['หมายเหตุของฝ่ายวางแผน'], 'คอลัมน์ที่ไม่ใช่ของเราต้องคงอยู่').toBe(note);
});

test('ตารางอื่นที่หัวตารางตรงกับ cols อยู่แล้ว ต้องไม่เปลี่ยนพฤติกรรม', async () => {
  /* กันการแก้เกินขอบเขต — Records ไม่เคยเลื่อน และต้องยังทำงานเหมือนเดิมทุกอย่าง */
  const { api, book } = loadGs();
  const sheet = book.insertSheet('Records');
  const res = api.doPushRows('Records', [{
    id: 'R1', date: '2026-11-10', orderId: 'PO-1|PN-1', process: 'winding', qty: 120,
    note: '', createdAt: '2026-11-10T01:00:00.000Z', voided: false
  }], 'เครื่อง ก');
  expect(res.ok).toBe(true);
  const back = api.doPullRows('Records', '').rows[0];
  expect(back.qty).toBe(120);
  expect(back.process).toBe('winding');
  expect(back.deviceName, 'ชื่อเครื่องต้องถูกเติมให้เหมือนเดิม').toBe('เครื่อง ก');
  expect(back.voided).toBe(false);
  expect(sheet.rows[0]).toEqual(['id', 'date', 'orderId', 'process', 'qty', 'note',
    'deviceName', 'createdAt', 'updatedAt', 'voided', 'batchId']);
});
