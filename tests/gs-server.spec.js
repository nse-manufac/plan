// เทสสคริปต์ฝั่ง Google Sheets — โหลด google-apps-script.gs มารันจริงบนชีตปลอม
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────
// โค้ดฝั่งนั้นอยู่บนเครื่องของ Google แก้แล้วต้องกดดีพลอยถึงจะเห็นผล
// ถ้ารอเจอบั๊กตอนใช้จริง แปลว่าเจอตอนข้อมูลของพนักงานหายไปแล้ว
// ก่อนหน้านี้ทั้งไฟล์นั้นมีแต่ sync-contract.spec.js ที่อ่านซอร์สมาเทียบชื่อคอลัมน์
// ซึ่งจับได้แค่ "ชื่อไม่ตรง" จับ "พฤติกรรมผิด" ไม่ได้เลย
//
// เขียนเป็นไฟล์ของ Playwright เพราะ CI รัน `npx playwright test` อย่างเดียว
// เทสที่ CI ไม่ได้รันคือเทสที่ไม่มีอยู่จริง · ข้อพวกนี้ไม่ต้องใช้เบราว์เซอร์

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ชีตปลอมกับตัวโหลดสคริปต์อยู่ใน fake-gs.js — process-admin.spec.js ใช้ตัวเดียวกันตอบหน้าเว็บ
const { loadGs } = require('./fake-gs');
// ซอร์สของแอปต้องอ่านผ่านตัวช่วย — เห็นทุกไฟล์ที่หน้าโหลด ไม่ใช่แค่ HTML (CLAUDE.md §3.1 ข้อ 7)
const { appSource } = require('./app-source');

const ORDER = (id, updatedAt) => ({ id, week: 'W36', poNo: 'PO-' + id, pn: 'PN-' + id,
  subName: 'TUE-U', orderQty: 100, orderDate: '2026-09-01', status: 'active',
  importedAt: updatedAt, updatedAt });

/* ── ตัวแก้มือ Wip bal. ของ Delta — คอลัมน์ใหม่ต้องต่อท้ายชีตเดิมโดยไม่ทำข้อมูลเดิมเหลื่อม ────────
 *
 * เจ้าของสั่ง 15 ก.ย. 2026 · ชีต DeltaWip ของจริงมีข้อมูลอยู่แล้วด้วยหัวตาราง 9 คอลัมน์
 * doPushRows เขียนแถวตามตำแหน่ง ส่วน sheetOf เติมหัวที่ขาดต่อท้าย — ถ้าวันหนึ่งมีคนแทรกคอลัมน์
 * ไว้กลางรายการ ทุกแถวที่เขียนใหม่จะเหลื่อมคอลัมน์โดยไม่มี error · เลขในเทสเป็นเลขสมมติ */
const OLD_DELTAWIP_HEAD = ['id','orderId','week','wip','fileName','deviceName','createdAt','updatedAt','voided'];

test('DeltaWip — ชีตเดิม 9 คอลัมน์ได้หัวของตัวแก้มือต่อท้าย และข้อมูลเดิมไม่เหลื่อม', async () => {
  const { api, book } = loadGs();
  const sheet = book.insertSheet('DeltaWip');
  sheet.rows[0] = OLD_DELTAWIP_HEAD.slice();
  sheet.rows[1] = ['DW1', 'PO-1|PN-1', '36', 500, 'c.xlsx', 'A',
                   '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'FALSE'];

  const res = api.doPushRows('DeltaWip', [{
    id: 'DW2', orderId: 'PO-2|PN-2', week: '36', wip: 800, fileName: 'c.xlsx', deviceName: 'B',
    createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', voided: false,
    wipOverride: 650, overrideNote: 'เทียบใบส่งของแล้ว Delta นับขาดหนึ่งรอบ', overrideBy: 'หัวหน้าทดสอบ',
    overrideAt: '2026-09-03T01:02:03.000Z'
  }], 'B');
  expect(res.ok, res.error).toBe(true);

  expect(sheet.rows[0], 'หัวของตัวแก้มือต้องต่อท้ายหัวเดิม ไม่แทรกกลาง')
    .toEqual([...OLD_DELTAWIP_HEAD, 'wipOverride', 'overrideNote', 'overrideBy', 'overrideAt']);
  expect(sheet.rows[1].slice(0, 4), 'แถวเดิมต้องไม่ถูกแตะ').toEqual(['DW1', 'PO-1|PN-1', '36', 500]);

  const rows = api.doPullRows('DeltaWip', '').rows;
  const old = rows.find(r => r.id === 'DW1');
  const neu = rows.find(r => r.id === 'DW2');
  expect(old.wip, 'ยอดของแถวเดิมต้องอยู่ช่องเดิม').toBe(500);
  expect(old.wipOverride, 'แถวเดิมไม่มีการแก้มือ ต้องว่าง ไม่ใช่ 0').toBe('');
  expect(neu.wip, 'ยอดจากไฟล์ของ Delta ต้องไม่ถูกทับด้วยยอดที่แก้').toBe(800);
  expect(neu.wipOverride).toBe(650);
  expect(neu.overrideNote).toBe('เทียบใบส่งของแล้ว Delta นับขาดหนึ่งรอบ');
  expect(neu.overrideBy).toBe('หัวหน้าทดสอบ');
  expect(neu.overrideAt).toBe('2026-09-03T01:02:03.000Z');
});

test('DeltaWip — เครื่องแอปรุ่นเก่าส่งแถวเดิมขึ้นมา ยอดที่แก้มือไว้ต้องไม่ถูกล้าง', async () => {
  // แอปรุ่นเก่าไม่รู้จักคอลัมน์ตัวแก้มือ cleanForPush จึงไม่ส่งช่องพวกนี้ (ไม่ใช่ส่งค่าว่าง)
  const { api } = loadGs();
  const base = { id: 'DW1', orderId: 'PO-1|PN-1', week: '36', wip: 500, fileName: 'c.xlsx', deviceName: 'A',
    createdAt: '2026-09-01T00:00:00.000Z', voided: false };
  api.doPushRows('DeltaWip', [Object.assign({}, base, { wipOverride: 450, overrideNote: 'ทดสอบ',
    overrideBy: 'หัวหน้าทดสอบ', overrideAt: '2026-09-03T01:02:03.000Z' })], 'A');

  api.doPushRows('DeltaWip', [Object.assign({}, base, { wip: 520, fileName: 'c2.xlsx' })], 'OLD');   // รุ่นเก่า

  const row = api.doPullRows('DeltaWip', '').rows[0];
  expect(row.wip, 'ยอดจากไฟล์อัปเดตตามปกติ').toBe(520);
  expect(row.wipOverride, 'ยอดที่แก้มือต้องยังอยู่').toBe(450);
  expect(row.overrideBy).toBe('หัวหน้าทดสอบ');
  expect(row.overrideNote).toBe('ทดสอบ');
  expect(row.overrideAt).toBe('2026-09-03T01:02:03.000Z');
});

test('DeltaWip — แอปรุ่นใหม่ส่งช่องตัวแก้มือเป็นค่าว่างมาตรง ๆ ต้องล้างได้ (ยกเลิกการแก้)', async () => {
  const { api } = loadGs();
  const base = { id: 'DW1', orderId: 'PO-1|PN-1', week: '36', wip: 500, voided: false,
    createdAt: '2026-09-01T00:00:00.000Z' };
  api.doPushRows('DeltaWip', [Object.assign({}, base, { wipOverride: 450, overrideNote: 'ทดสอบ',
    overrideBy: 'หัวหน้าทดสอบ', overrideAt: '2026-09-03T01:02:03.000Z' })], 'A');
  api.doPushRows('DeltaWip', [Object.assign({}, base, { wipOverride: null, overrideNote: '',
    overrideBy: '', overrideAt: '' })], 'A');

  const row = api.doPullRows('DeltaWip', '').rows[0];
  expect(row.wipOverride, 'ยกเลิกแล้วต้องว่าง').toBe('');
  expect(row.overrideBy).toBe('');
});

test('DeltaWip — เวลาที่แก้มือที่ชีตแปลงเป็นวันที่ ต้องกลับมาเป็น ISO', async () => {
  const { api, book } = loadGs();
  api.doPushRows('DeltaWip', [{ id: 'DW1', orderId: 'PO-1|PN-1', week: '36', wip: 500, voided: false,
    createdAt: '2026-09-01T00:00:00.000Z', wipOverride: 450, overrideNote: 'ทดสอบ', overrideBy: 'ทดสอบ',
    overrideAt: '2026-09-03T01:02:03.000Z' }], 'A');
  const sheet = book.getSheetByName('DeltaWip');
  const col = sheet.rows[0].indexOf('overrideAt');
  sheet.rows[1][col] = new Date('2026-09-03T01:02:03.000Z');     // จำลอง Sheets แปลงชนิดเอง
  const row = api.doPullRows('DeltaWip', '').rows[0];
  expect(row.overrideAt, 'ต้องได้สตริง ISO ไม่ใช่ Date object').toBe('2026-09-03T01:02:03.000Z');
});

/* ── ช่องโหว่เวลา — ข้อที่ทำให้ข้อมูลหายจากเครื่องหนึ่งถาวร ────────────
 *
 * เหตุการณ์จริงที่กันอยู่:
 *   เครื่อง A กด push 300 ใบ — doPushRows ประทับ stamp ตอนเริ่ม
 *   แล้วเขียนทีละแถวซึ่งกินเวลาหลายวินาที
 *   เครื่อง B ซิงค์อัตโนมัติทุก 20 วินาที ดึงระหว่างนั้นพอดี ได้ไปครึ่งเดียว
 *   ถ้า pull ประทับเวลา "ตอนอ่านเสร็จ" B จะได้เวลาที่ใหม่กว่าแถวที่ A ยังเขียนไม่ถึง
 *   B เก็บเวลานั้นเป็น lastPull รอบหน้า -> แถวที่เหลือของ A เก่ากว่า since ตลอดไป
 *   = B ไม่ได้รับใบพวกนั้นอีกเลย จนกว่าจะมีคนไปแก้มัน */
test('pull ต้องไม่ประทับเวลาที่ใหม่กว่าของที่มันเห็น', async () => {
  let tick = 0;
  const stamp = n => '2026-09-06T00:00:' + String(n).padStart(2, '0') + '.000Z';
  class FakeDate {
    constructor() { this.n = ++tick; }
    toISOString() { return stamp(this.n); }
  }
  const { api, book } = loadGs({ Date: FakeDate });
  api.doPushRows('Orders', [ORDER('O1', '2026-09-01T00:00:00.000Z')], 'A');

  // ให้ทุกการอ่านชีตเดินนาฬิกา = การอ่านกินเวลาเหมือนของจริง
  for (const sh of book.sheets.values()) sh.onRead = () => { tick++; };

  const before = tick;
  const got = api.doPullRows('Orders', '');
  expect(got.rows.length, 'ต้องได้แถวที่มีอยู่').toBe(1);
  expect(got.serverTime <= stamp(before + 1),
    `serverTime ต้องไม่ใหม่กว่าเวลาตอนเริ่มดึง — ได้ ${got.serverTime} แต่เริ่มดึงตอน ${stamp(before + 1)}`)
    .toBe(true);
});

test('pull ต้องจับล็อกตัวเดียวกับ push และบอกเมื่อไม่ว่าง', async () => {
  const free = loadGs();
  const taken0 = free.locks.taken;
  free.api.doPullRows('Orders', '');
  expect(free.locks.taken, 'pull ต้องจับล็อกด้วย ไม่งั้นอ่านเจอชีตที่ push เขียนไปครึ่งเดียว')
    .toBeGreaterThan(taken0);

  const busy = loadGs({ lockFree: false });
  const r = busy.api.doPullRows('Orders', '');
  expect(r.ok, 'ล็อกไม่ว่างต้องไม่คืนข้อมูลครึ่ง ๆ กลาง ๆ').toBe(false);
});

/* ⚠️ แถวที่ประทับเวลาชนกับ serverTime ของรอบก่อนพอดี ต้องถูกส่งซ้ำ ไม่ใช่ถูกข้าม
 *    ของเดิมใช้ ">" แถวที่ชนพอดีจึงหายตลอดกาล · ส่งซ้ำเสียแค่แบนด์วิดท์ */
test('แถวที่เวลาชนกับ since พอดี ต้องยังถูกส่งมา ไม่ใช่หายไปเลย', async () => {
  const { api } = loadGs();
  const T = '2026-09-06T05:00:00.000Z';
  api.doPushRows('Orders', [ORDER('O1', T)], 'A');
  const written = api.doPullRows('Orders', '').rows[0].updatedAt;

  const got = api.doPullRows('Orders', written);
  expect(got.rows.map(r => r.id), 'แถวที่เวลาเท่ากับ since เป๊ะ ต้องยังถูกส่งมา').toContain('O1');

  expect(api.doPullRows('Orders', '2099-01-01T00:00:00.000Z').rows.length,
    'แต่เวลาที่ไกลกว่านั้นต้องได้ศูนย์แถว ไม่ใช่ส่งทั้งตารางทุกครั้ง').toBe(0);
});

/* ── นาฬิกา "ดึงมาถึงไหนแล้ว" ต้องถูกล้างครบทุกตัว และล้างที่เดียว ──────
 *
 * เคยเขียนรายชื่อนาฬิกาซ้ำสามที่ (ปุ่มกู้ · ปุ่มลบข้อมูลทั้งหมด · defaultSyncCfg)
 * พอเพิ่มตาราง DeliveryNotes กับ DeltaWip เข้ามา เติมไม่ครบทั้งสามที่:
 *   - ปุ่มกู้ล้างแค่ 2 ใน 4  -> ทางกู้ทางเดียวกู้ได้ครึ่งเดียว
 *   - ปุ่มลบข้อมูลทั้งหมดล้างแค่ 2 ใน 4 ทั้งที่ defaultState() ล้างทุกตาราง
 *     -> ใบส่งสินค้ากับยอดของ Delta หายถาวรจากเครื่องนั้น ทั้งที่เซิร์ฟเวอร์ยังมีครบ
 *   - defaultSyncCfg ไม่ประกาศ lastPullDeltaWip เลย
 *
 * เทสสองข้อนี้จึงคุมสองเรื่อง: ล้าง "ครบ" และล้าง "ที่เดียว"
 * ข้อหลังสำคัญกว่า เพราะมันกันการเกิดซ้ำครั้งที่สี่ ไม่ใช่แค่ปะครั้งนี้ */
test('นาฬิกาซิงค์ต้องถูกประกาศครบ และล้างครบทุกตัว', async () => {
  const APP = appSource();

  /* รายชื่อที่ถือว่าเป็นความจริง คือ "นาฬิกาที่ doSync ใช้จริง" ไม่ใช่ที่ประกาศไว้
   * เพราะของที่ "ใช้แต่ไม่ได้ประกาศ" คือบั๊กชนิดที่เทสข้อนี้ต้องจับ */
  /* ⚠️ คลาสตัวอักษรต้องรับ ; และช่องว่างด้วย · ของเดิมรับแค่ [=)},]
   *    ถ้าวันหน้ามีคนเขียน `const s = syncCfg.lastPullX;` เทสจะมองไม่เห็นชื่อนั้น
   *    แล้วบั๊กแบบ #70 (นาฬิกาที่ใช้แต่ไม่ได้ประกาศ) จะหลุดได้อีก (ผู้ตรวจทักไว้ใน #71) */
  const used = [...new Set([...APP.matchAll(/syncCfg\.lastPull([A-Za-z]+)\s*[=)},;\s]/g)]
    .map(m => m[1]))].sort();
  expect(used.length, 'ต้องหานาฬิกาที่ doSync ใช้เจอ').toBeGreaterThan(0);

  const dflt = /function defaultSyncCfg\(\)\{([\s\S]*?)\n\}/.exec(APP);
  expect(dflt, 'ต้องหา defaultSyncCfg เจอ').not.toBeNull();
  const declared = [...new Set([...dflt[1].matchAll(/lastPull([A-Za-z]+)\s*:/g)].map(m => m[1]))].sort();
  expect(declared, 'ทุกนาฬิกาที่ใช้ ต้องถูกประกาศใน defaultSyncCfg ด้วย').toEqual(used);

  // ตัวล้างต้องกวาดทุกคีย์ที่ขึ้นต้นด้วย lastPull ไม่ใช่ไล่ชื่อทีละตัว
  const reset = /function resetPullClocks\(\)\{([\s\S]*?)\n\}/.exec(APP);
  expect(reset, 'ต้องมี resetPullClocks เป็นตัวกลาง').not.toBeNull();
  expect(reset[1], 'ต้องกวาดทุกคีย์ที่ขึ้นต้นด้วย lastPull ไม่ใช่เขียนชื่อทีละตัว')
    .toMatch(/lastPull/);
});

test('saveSyncCfg ต้องเก็บนาฬิกาด้วยการกวาดคีย์ ไม่ใช่แจกแจงชื่อเอง', async () => {
  /* ⚠️ ที่ที่สี่ที่เคยมีรายชื่อนาฬิกาซ้ำ · ลืมเติมชื่อที่นี่เมื่อไหร่ นาฬิกาตัวนั้น
   *    จะไม่ถูกเก็บลง localStorage = รีเซ็ตทุกครั้งที่เปิดโปรแกรม แล้วดึงทั้งกระดาน
   *    ลงมาใหม่ทุกวันโดยไม่มีใครสังเกต (ผู้ตรวจทักไว้ใน #71) */
  const APP = appSource();
  const fn = /function saveSyncCfg\(\)\{([\s\S]*?)\n\}/.exec(APP);
  expect(fn, 'ต้องหา saveSyncCfg เจอ').not.toBeNull();

  const named = [...fn[1].matchAll(/lastPull[A-Za-z]+/g)].map(m => m[0]);
  expect(named,
    'saveSyncCfg ยังแจกแจงชื่อนาฬิกาเอง — ให้กวาดคีย์ที่ขึ้นต้นด้วย lastPull แทน').toEqual([]);
  expect(fn[1], 'และต้องกวาดคีย์จริง ๆ').toMatch(/lastPull/);
});

test('ห้ามล้างนาฬิกาซิงค์ที่อื่นนอกจาก resetPullClocks', async () => {
  const APP = appSource();

  // ทุกที่ที่เซ็ตนาฬิกาเป็นค่าว่าง ต้องอยู่ในตัวกลางตัวเดียวเท่านั้น
  const assigns = [...APP.matchAll(/syncCfg\.lastPull[A-Za-z]*\s*=\s*''/g)];
  expect(assigns.length,
    'มีการล้างนาฬิกาแบบเขียนชื่อเองอยู่ — ย้ายไปใช้ resetPullClocks() ' +
    'ไม่งั้นวันหนึ่งจะเติมไม่ครบอีก (เกิดมาแล้วสองที่)').toBe(0);
});

/* ── ช่อง voided ต้องกลับมาเป็น boolean ทุกตาราง ─────────────────────────
 *
 * เดิมแปลงเฉพาะ Records · ตารางอื่นส่งค่าในเซลล์ออกไปตรง ๆ
 * ถ้าคอลัมน์กลายเป็นข้อความ (คนแก้ชีตมือ หรือ format เพี้ยน) สตริง 'FALSE' เป็น truthy ฝั่งแอป
 * → ทุกแถวของตารางนั้นกลายเป็นยกเลิกในทุกเครื่องหลังซิงค์ = จอว่างทั้งระบบ
 * (CTO เจอตอนประเมิน 7 ก.ย. 2026 · เจ้าของให้รวบไว้กับการ redeploy รอบถัดไป) */
for (const table of ['Orders', 'Records', 'DeliveryNotes', 'DeltaWip']) {
  test(`${table} — voided ที่เป็นข้อความในชีต ต้องกลับมาเป็น boolean`, async () => {
    const { api, book } = loadGs();
    api.doPushRows(table, [{ id: 'X1', voided: false }], 'A');
    const sheet = book.getSheetByName(table);
    const col = sheet.rows[0].indexOf('voided');
    expect(col, 'ต้องมีคอลัมน์ voided').toBeGreaterThan(-1);
    for (const [cell, want] of [['FALSE', false], ['TRUE', true], ['', false], [false, false], [true, true]]) {
      sheet.rows[1][col] = cell;          // เหมือนคนพิมพ์ทับ หรือ format ของคอลัมน์เพี้ยน
      expect(api.doPullRows(table, '').rows[0].voided, `เซลล์ ${JSON.stringify(cell)}`).toBe(want);
    }
  });

  test(`${table} — push แล้ว pull ต้องได้ voided ตรงกับที่ส่ง`, async () => {
    const { api } = loadGs();
    api.doPushRows(table, [{ id: 'X1', voided: true }, { id: 'X2', voided: false }], 'A');
    const rows = api.doPullRows(table, '').rows;
    expect(rows.find(r => r.id === 'X1').voided).toBe(true);
    expect(rows.find(r => r.id === 'X2').voided).toBe(false);
  });
}

/* ── ตั้งค่ากลาง: รายการขั้นการผลิต ─────────────────────────────────────
 *
 * เจ้าของสั่ง 12 ก.ย. 2026 ให้เพิ่มขั้นได้จากในโปรแกรม และซิงค์ไปทุกเครื่อง
 * ด่านที่สำคัญที่สุดคือ "ห้ามลบขั้น" — เครื่องที่เปิดหน้าค้างไว้ก่อนมีคนเพิ่มขั้น
 * จะส่งรายการเก่าที่ไม่มีขั้นใหม่ขึ้นมา ถ้าเซิร์ฟเวอร์รับ ขั้นใหม่จะหายจากทุกเครื่อง
 * แล้วยอดของขั้นนั้นไม่ถูกนับอีกเลยโดยไม่มีอะไรฟ้อง */
const P = (id, label = id) => ({ id, label });
const BASE5 = ['winding', 'assembly', 'support', 'inspection', 'shipping'].map(id => P(id));
const WITH_COATING = [P('winding'), P('coating', 'Coating'), P('assembly'), P('support'), P('inspection'), P('shipping')];

test('ตั้งค่ากลาง — เก็บรายการขั้นแล้วดึงกลับมาได้ครบ', async () => {
  const { api } = loadGs();
  const r = api.doPushSettings({ processes: WITH_COATING });
  expect(r.ok, r.error).toBe(true);
  const got = api.doPullSettings();
  expect(got.processes).toEqual(WITH_COATING);
  expect(got.setupVersion, 'ต้องบอกเวลาที่ตั้งค่าล่าสุด').toBeTruthy();
});

test('ตั้งค่ากลาง — เครื่องรุ่นเก่าที่ส่งแค่วันกำหนดส่ง ต้องไม่ทำรายการขั้นหาย', async () => {
  const { api } = loadGs();
  api.doPushSettings({ processes: WITH_COATING });
  expect(api.doPushSettings({ deadlineOffsets: { winding: 12 } }).ok).toBe(true);
  const got = api.doPullSettings();
  expect(got.processes, 'รายการขั้นยังอยู่').toEqual(WITH_COATING);
  expect(got.deadlineOffsets).toEqual({ winding: 12 });
});

test('ตั้งค่ากลาง — ยังไม่เคยเก็บอะไร ต้องคืน null ไม่ใช่ error', async () => {
  const { api } = loadGs();
  const got = api.doPullSettings();
  expect(got.ok).toBe(true);
  expect(got.processes).toBeNull();
  expect(got.deadlineOffsets).toBeNull();
});

test('ห้ามลบขั้น — รายการเก่าที่ไม่มีขั้นที่เพิ่มไปแล้ว ต้องถูกปฏิเสธ และของเดิมไม่เปลี่ยน', async () => {
  const { api } = loadGs();
  api.doPushSettings({ processes: WITH_COATING });
  const r = api.doPushSettings({ processes: BASE5 });
  expect(r.ok, 'เครื่องที่ค้างรุ่นก่อนต้องทับขั้นใหม่ไม่ได้').toBe(false);
  expect(r.error).toContain('coating');
  expect(api.doPullSettings().processes).toEqual(WITH_COATING);
});

test('ห้ามลบห้าขั้นเดิม — แม้ยังไม่เคยเก็บรายการขั้นลงชีตก็ตาม', async () => {
  const { api } = loadGs();
  const r = api.doPushSettings({ processes: BASE5.filter(p => p.id !== 'support') });
  expect(r.ok).toBe(false);
  expect(r.error).toContain('support');
  expect(api.doPullSettings().processes).toBeNull();
});

test('Inspection กับ ส่งของ ต้องอยู่ท้ายสุดตามลำดับ', async () => {
  const { api } = loadGs();
  const swapped = [P('winding'), P('assembly'), P('support'), P('shipping'), P('inspection')];
  expect(api.doPushSettings({ processes: swapped }).ok, 'สลับสองขั้นท้าย').toBe(false);
  const afterShip = [...BASE5, P('coating')];
  expect(api.doPushSettings({ processes: afterShip }).ok, 'เพิ่มขั้นต่อท้ายส่งของ').toBe(false);
  expect(api.doPushSettings({ processes: WITH_COATING }).ok, 'แทรกก่อน Inspection ได้').toBe(true);
});

test('รหัสขั้นต้องถูกรูปแบบและไม่ซ้ำ ชื่อต้องไม่ว่าง', async () => {
  const { api } = loadGs();
  const bad = [
    [[P('winding'), P('Coat ing'), ...BASE5.slice(1)], 'รหัสมีช่องว่างหรือตัวใหญ่'],
    [[P('winding'), P('<b>'), ...BASE5.slice(1)], 'รหัสมีอักขระพิเศษ'],
    [[P('winding'), P('coating'), P('coating'), ...BASE5.slice(1)], 'รหัสซ้ำ'],
    [[P('winding'), P('coating', '   '), ...BASE5.slice(1)], 'ชื่อว่าง'],
    [[P('winding'), P('coating', 'ก'.repeat(41)), ...BASE5.slice(1)], 'ชื่อยาวเกิน'],
    [[], 'รายการว่าง'],
    ['not-a-list', 'ไม่ใช่รายการ']
  ];
  for (const [processes, why] of bad) {
    expect(api.doPushSettings({ processes }).ok, why).toBe(false);
  }
  expect(api.doPullSettings().processes, 'ต้องไม่มีอะไรถูกเก็บ').toBeNull();
});

test('ผิดข้อเดียวต้องไม่มีอะไรถูกเขียน — วันกำหนดส่งที่ส่งมาพร้อมกันต้องไม่ถูกเก็บ', async () => {
  const { api } = loadGs();
  const r = api.doPushSettings({ deadlineOffsets: { winding: 99 }, processes: BASE5.slice(1) });
  expect(r.ok).toBe(false);
  expect(api.doPullSettings().deadlineOffsets, 'ครึ่งเดียวผ่านไม่ได้').toBeNull();
});

test('ข้อมูลรหัสหัวหน้า — เก็บแล้วดึงกลับมาได้ตามที่ส่ง', async () => {
  const { api } = loadGs();
  const admin = { hash: 'abc123', salt: 's1', setBy: 'เครื่องหัวหน้า', setAt: '2026-09-13T00:00:00.000Z' };
  expect(api.doPushSettings({ processAdmin: admin }).ok).toBe(true);
  expect(api.doPullSettings().processAdmin).toEqual(admin);
});

test('ตั้งค่ากลาง — ล็อกไม่ว่างต้องไม่เขียนอะไรเลย', async () => {
  const busy = loadGs({ lockFree: false });
  expect(busy.api.doPushSettings({ processes: WITH_COATING }).ok).toBe(false);
});
