// เทสการกรอกฟอร์ม Daily Call In
//
// ── สิ่งที่เทสชุดนี้คุ้มอยู่จริง ๆ ────────────────────────────────
// ไฟล์ Call In ตัวจริงมีสูตร VLOOKUP ข้ามไฟล์ 698 สูตร คอมเมนต์ในเซลล์ ค่าตั้งเครื่องพิมพ์
// และคอลัมน์ commit ตามวันที่ที่คนวางแผนกรอกเอง — ของพวกนี้แอปไม่รู้จักสักอย่าง
// ถ้าวันหนึ่งมีคนเปลี่ยนวิธีเขียนไฟล์ไปเป็น "อ่านทั้งไฟล์แล้วเขียนใหม่" ของพวกนั้นจะหายเงียบ ๆ
// เทสข้อ "ทุกส่วนของไฟล์ต้องอยู่ครบ" คือด่านที่จะจับเรื่องนั้นได้

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const JSZip = require('jszip');
const { callInWorkbook } = require('./fixtures');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

const order = (poNo, pn, qty) => ({
  id: poNo + '|' + pn, week: 'W34', poNo, pn, subName: 'TUE-U', orderQty: qty,
  orderDate: '2026-07-06', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});
const shipped = (id, orderId, qty) => ({
  id, date: '2026-08-20', orderId, process: 'shipping', qty, note: '', deviceName: 't',
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', voided: false, _dirty: false
});

async function openWith(page, orders, records = []) {
  await page.addInitScript(([k, o, r]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' }, orders: o, records: r, importHistory: []
  })), [K_STATE, orders, records]);
  await page.goto(APP);
  await page.waitForSelector('.tab-btn[data-tab="data"]');
  await page.click('.tab-btn[data-tab="data"]');
}

/** อัปโหลดไฟล์ → เลือกชีต → กดตรวจ */
async function scan(page, buf, sheet) {
  await page.setInputFiles('#callInFileInput',
    { name: 'callin.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });
  await expect(page.locator('#btnCallInScan')).toBeEnabled();
  if (sheet) await page.selectOption('#callInSheet', sheet);
  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
}

async function apply(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnCallInApply')]);
  return fs.readFileSync(await dl.path());
}

const ROWS = [
  { pn: '2877686000', poNo: 'TM4267U041', orderDate: '2026-07-06', qty: 300, wip: 300, commit: 111 },
  { pn: '2877686400', poNo: 'TM4267U040', orderDate: '2026-07-06', qty: 300, wip: 300, commit: 222 },
  { pn: '9999999999', poNo: 'TMNOTINAPP', orderDate: '2026-07-06', qty: 500, wip: 500, commit: 333 }
];
const ORDERS = [order('TM4267U041', '2877686000', 300), order('TM4267U040', '2877686400', 300)];

test('A1 — Wip bal. ต้องเป็น PO QTY ลบยอดส่งสะสม และไม่นับยอดที่ถูกยกเลิก', async ({ page }) => {
  await openWith(page, ORDERS, [
    shipped('S1', 'TM4267U041|2877686000', 120),
    shipped('S2', 'TM4267U040|2877686400', 300),
    Object.assign(shipped('S3', 'TM4267U041|2877686000', 50), { voided: true, date: '2026-08-21' })
  ]);
  await scan(page, await callInWorkbook(ROWS));
  const out = await apply(page);

  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const at = ref => (new RegExp('<c r="' + ref + '"[^>]*>\\s*<v>([^<]*)</v>').exec(xml) || [])[1];

  expect(at('E7'), 'สั่ง 300 ส่งแล้ว 120 (ยอดที่ยกเลิก 50 ห้ามนับ) ต้องเหลือ 180').toBe('180');
  expect(at('E8'), 'ส่งครบแล้วต้องเป็น 0 ไม่ใช่ค่าเดิมที่ค้างอยู่').toBe('0');
  expect(at('E9'), 'แถวที่ไม่มีใบนั้นในแอป ห้ามแตะ ต้องยังเป็น 500').toBe('500');
});

test('F2 — กรอกแล้วทุกส่วนของไฟล์ต้องอยู่ครบ มีเพียงชีตที่กรอกเท่านั้นที่เปลี่ยน', async ({ page }) => {
  const src = await callInWorkbook(ROWS);
  await openWith(page, ORDERS, [shipped('S1', 'TM4267U041|2877686000', 120)]);
  await scan(page, src);
  const out = await apply(page);

  const za = await JSZip.loadAsync(src), zb = await JSZip.loadAsync(out);
  const names = z => Object.keys(z.files).filter(n => !z.files[n].dir).sort();
  expect(names(zb), 'ห้ามมีส่วนไหนของไฟล์หายไปหรือโผล่เพิ่ม').toEqual(names(za));

  const changed = [];
  for (const n of names(za)) {
    const a = await za.file(n).async('string');
    const b = await zb.file(n).async('string');
    if (a !== b) changed.push(n);
  }
  expect(changed, 'ต้องแตะชีตเดียวเท่านั้น ส่วนที่เหลือห้ามถูกเขียนใหม่').toEqual(['xl/worksheets/sheet1.xml']);
});

test('F2 — ไฟล์ที่ได้กลับมาต้องไม่บวม เพราะต้องส่งเข้าเมลให้ลูกค้าทุกวัน', async ({ page }) => {
  // ⚠️ เคยพลาดมาแล้ว: JSZip ไม่บีบอัดถ้าไม่สั่ง ไฟล์จริง 191 KB โตเป็น 1 MB
  //    เนื้อหาเหมือนเดิมทุกช่อง เปิดได้ปกติ ไม่มี error — จับไม่ได้เลยถ้าดูแต่เนื้อหา
  const src = await callInWorkbook(ROWS);
  await openWith(page, ORDERS, [shipped('S1', 'TM4267U041|2877686000', 120)]);
  await scan(page, src);
  const out = await apply(page);

  expect(out.length / src.length,
    `ไฟล์ออก ${out.length} ไบต์ จากไฟล์เข้า ${src.length} ไบต์ — โตผิดปกติแปลว่าลืมสั่งบีบอัด`)
    .toBeLessThan(1.3);
});

test('A1 — สูตรและคอลัมน์ที่คนกรอกเอง ต้องรอดมาครบ', async ({ page }) => {
  await openWith(page, ORDERS, [shipped('S1', 'TM4267U041|2877686000', 120)]);
  await scan(page, await callInWorkbook(ROWS));
  const zip = await JSZip.loadAsync(await apply(page));
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');

  expect((xml.match(/<f>TODAY\(\)-C\d+<\/f>/g) || []).length,
    'สูตร Aging ประจำแถวต้องอยู่ครบทุกแถว').toBe(ROWS.length);
  expect(xml, 'คอลัมน์ commit ที่คนวางแผนกรอกไว้ ห้ามหาย').toContain('<v>111</v>');
  expect(xml, 'คอลัมน์ commit ของแถวที่แอปไม่รู้จักก็ห้ามหาย').toContain('<v>333</v>');

  const other = await zip.file('xl/worksheets/sheet2.xml').async('string');
  expect(other, 'ชีตอื่นในไฟล์เดียวกันต้องไม่ถูกแตะเลย').toContain('B2*2');
});

test('G1 — ใบที่ยังส่งไม่ครบแต่ไม่มีแถวในไฟล์ ต้องบอกให้คนไปเพิ่มเอง ห้ามเพิ่มแถวให้', async ({ page }) => {
  // ใบที่สามไม่มีอยู่ในไฟล์ — แถวใหม่ที่แอปสร้างจะไม่มีสูตรประจำแถว ยอดรวมท้ายตารางจะผิด
  await openWith(page, ORDERS.concat([order('TM4268U099', '2870000000', 700)]),
                 [shipped('S1', 'TM4267U041|2877686000', 120)]);
  await scan(page, await callInWorkbook(ROWS));

  const summary = await page.locator('#callInSummary').innerText();
  expect(summary, 'ต้องบอกจำนวนใบที่ต้องไปเพิ่มแถวเอง').toContain('ต้องเพิ่มแถวเอง');
  await expect(page.locator('#callInTable'), 'และต้องบอกว่าเป็นใบไหน พร้อมยอดที่ควรใส่')
    .toContainText('TM4268U099');

  const zip = await JSZip.loadAsync(await apply(page));
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  expect(xml, 'ห้ามแอบเพิ่มแถวใหม่ลงไปในไฟล์').not.toContain('TM4268U099');
});

test('G2 — เลือกชีตผิดต้องบอกตรง ๆ ไม่ใช่เงียบหรือเขียนมั่ว', async ({ page }) => {
  await openWith(page, ORDERS);
  await page.setInputFiles('#callInFileInput',
    { name: 'callin.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await callInWorkbook(ROWS) });
  await expect(page.locator('#btnCallInScan')).toBeEnabled();
  await page.selectOption('#callInSheet', 'อีกชีตที่ห้ามแตะ');
  await page.click('#btnCallInScan');

  await expect(page.locator('#toast'), 'ชีตที่ไม่มีหัวตาราง P/N ต้องขึ้นข้อความบอก').toContainText('P/N');
  await expect(page.locator('#callInPreviewPanel'), 'และต้องไม่เปิดหน้าตรวจให้กดกรอกต่อ').toBeHidden();
});
