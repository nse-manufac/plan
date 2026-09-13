// ชีตปลอมสำหรับรันสคริปต์ฝั่ง Google Sheets (google-apps-script.gs) จริงใน Node
//
// ใช้สองที่ — gs-server.spec.js เรียกฟังก์ชันของสคริปต์ตรง ๆ
// ส่วน process-admin.spec.js เอา doPost ไปตอบคำขอของหน้าเว็บ ให้หน้าเว็บคุยกับสคริปต์จริงทั้งเส้น
// ไฟล์นี้ไม่ใช่เทส (ชื่อไม่ลงท้าย .spec.js) Playwright จึงไม่รันมันเอง

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
  appendRow(arr) { this.rows[this.getLastRow()] = arr.slice(); return this; }
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
      setValue(v) {
        if (!s.rows[r - 1]) s.rows[r - 1] = [];
        s.rows[r - 1][c - 1] = v;
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
    GS_SRC + '\n;return { doPullRows: doPullRows, doPushRows: doPushRows,' +
    ' doPullSettings: doPullSettings, doPushSettings: doPushSettings, doPost: doPost, meta: meta,' +
    ' TOKEN: TOKEN };');
  const api = fn(SpreadsheetApp, LockService, ContentService, Utilities, opts.Date || Date);
  return { api, book, locks };
}

module.exports = { FakeSheet, FakeBook, loadGs };
