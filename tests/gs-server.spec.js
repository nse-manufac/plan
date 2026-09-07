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

const GS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'google-apps-script.gs'), 'utf8');

/* ── ชีตปลอม: จำลองเฉพาะที่สคริปต์เรียกใช้จริง ──────────────────────
 *
 * ⚠️ setValues แปลงข้อความที่หน้าตาเหมือนตัวเลขให้เป็นตัวเลข เหมือนที่ชีตจริงทำ
 *    ถ้าจำลองไม่เหมือน เทสจะเขียวทั้งที่ของจริงเพี้ยน — รหัสวัตถุดิบกับเวลา ISO
 *    เคยโดนแปลงมาแล้ว จึงต้องมี setNumberFormat('@') คุมอยู่ */
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.fmt = {}; this.onRead = null; }
  _at(r, c) { return (this.rows[r - 1] || [])[c - 1]; }
  getLastRow() {
    for (let i = this.rows.length; i >= 1; i--) {
      if ((this.rows[i - 1] || []).some(v => v !== '' && v !== null && v !== undefined)) return i;
    }
    return 0;
  }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0); }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  setFrozenRows() { return this; }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      getValues() {
        if (s.onRead) s.onRead();          // จำลองว่าการอ่านชีตจริงกินเวลา
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) {
            const v = s._at(r + i, c + j);
            row.push(v === undefined ? '' : v);
          }
          out.push(row);
        }
        return out;
      },
      setValues(vals) {
        vals.forEach((row, i) => {
          const ri = r + i - 1;
          if (!s.rows[ri]) s.rows[ri] = [];
          row.forEach((v, j) => {
            const isText = s.fmt[(c + j) + ''] === '@';
            s.rows[ri][c + j - 1] =
              (!isText && typeof v === 'string' && v !== '' && isFinite(Number(v))) ? Number(v) : v;
          });
        });
        return this;
      },
      setFontWeight() { return this; },
      setNumberFormat(f) { for (let j = 0; j < nc; j++) s.fmt[(c + j) + ''] = f; return this; }
    };
  }
}

class FakeBook {
  constructor() { this.sheets = new Map(); }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.set(n, s); return s; }
  getName() { return 'ทดสอบ'; }
  getSpreadsheetTimeZone() { return 'Asia/Bangkok'; }
}

/** โหลดสคริปต์จริงมารันในสโคปที่เราคุมได้
 *  opts.Date        — นาฬิกาปลอม ใช้พิสูจน์ว่าประทับเวลาตอนไหน
 *  opts.lockFree    — false เพื่อจำลองว่ามีเครื่องอื่นถือล็อกอยู่ */
function loadGs(opts = {}) {
  const book = new FakeBook();
  const locks = { taken: 0, free: opts.lockFree !== false };
  const SpreadsheetApp = { getActiveSpreadsheet: () => book, flush() {} };
  const LockService = { getScriptLock: () => ({
    tryLock: () => { locks.taken++; return locks.free; }, releaseLock() {} }) };
  const ContentService = { MimeType: { JSON: 'json' },
    createTextOutput: t => ({ setMimeType: () => ({ body: t }) }) };
  const Utilities = { formatDate: (d) => d.toISOString().slice(0, 10) };

  const fn = new Function('SpreadsheetApp', 'LockService', 'ContentService', 'Utilities', 'Date',
    GS_SRC + '\n;return { doPullRows: doPullRows, doPushRows: doPushRows };');
  const api = fn(SpreadsheetApp, LockService, ContentService, Utilities, opts.Date || Date);
  return { api, book, locks };
}

const ORDER = (id, updatedAt) => ({ id, week: 'W36', poNo: 'PO-' + id, pn: 'PN-' + id,
  subName: 'TUE-U', orderQty: 100, orderDate: '2026-09-01', status: 'active',
  importedAt: updatedAt, updatedAt });

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
  const APP = fs.readFileSync(
    path.join(__dirname, '..', 'production_plan_tracker.html'), 'utf8');

  /* รายชื่อที่ถือว่าเป็นความจริง คือ "นาฬิกาที่ doSync ใช้จริง" ไม่ใช่ที่ประกาศไว้
   * เพราะของที่ "ใช้แต่ไม่ได้ประกาศ" คือบั๊กชนิดที่เทสข้อนี้ต้องจับ */
  const used = [...new Set([...APP.matchAll(/syncCfg\.lastPull([A-Za-z]+)\s*[=)},]/g)]
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

test('ห้ามล้างนาฬิกาซิงค์ที่อื่นนอกจาก resetPullClocks', async () => {
  const APP = fs.readFileSync(
    path.join(__dirname, '..', 'production_plan_tracker.html'), 'utf8');

  // ทุกที่ที่เซ็ตนาฬิกาเป็นค่าว่าง ต้องอยู่ในตัวกลางตัวเดียวเท่านั้น
  const assigns = [...APP.matchAll(/syncCfg\.lastPull[A-Za-z]*\s*=\s*''/g)];
  expect(assigns.length,
    'มีการล้างนาฬิกาแบบเขียนชื่อเองอยู่ — ย้ายไปใช้ resetPullClocks() ' +
    'ไม่งั้นวันหนึ่งจะเติมไม่ครบอีก (เกิดมาแล้วสองที่)').toBe(0);
});
