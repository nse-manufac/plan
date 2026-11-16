// กฎวันที่ใน core/dates.js — หมวด C ของ INVARIANTS (จุดที่เคยพังมาแล้ว)
//
// ไฟล์นี้มากับใบ 04 ของการแยกไฟล์ (CLAUDE.md §3.1) ตามกติกาข้อ 3: ย้ายก้อน core/ ต้องมีเทส node มาด้วย
// รันด้วย node ล้วน ไม่ต้องเปิดเบราว์เซอร์ — core/ ห้ามแตะ DOM จึงโหลดใน sandbox เปล่าได้ทั้งไฟล์
// และถ้าวันหนึ่งมีใครเอาของที่แตะหน้าจอหรือข้อมูลในเครื่องมาใส่ ข้อแรกจะแดงก่อนข้ออื่น

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', '..', 'core', 'dates.js');
const SRC = fs.readFileSync(FILE, 'utf8');
// สคริปต์ธรรมดา (ยังไม่ใช่ ES module · §3.1 เฟส 1) — ฟังก์ชันระดับบนสุดกลายเป็นของ context
const D = vm.createContext({});
vm.runInContext(SRC, D, { filename: 'core/dates.js' });

/** วันตามปฏิทินของเลขวันแบบ Excel คิดอีกทางหนึ่ง (ผ่าน Date.UTC) ไว้เทียบกับ civilFromDays
 *  ใช้ได้กับเลขตั้งแต่ 61 ขึ้นไป — Excel นับ 29 ก.พ. 1900 ที่ไม่มีอยู่จริงเป็นเลข 60 */
const oracle = serial => new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);

test('core/ ห้ามแตะ DOM · localStorage · state · fetch — โหลดได้ใน sandbox เปล่า', () => {
  const touches = SRC.match(/\b(document|window|localStorage|sessionStorage|indexedDB|fetch|state)\s*[.(\[]/g);
  assert.deepEqual(touches, null, 'core/ เป็นกฎล้วน (CLAUDE.md §3.1) ของที่แตะหน้าจอหรือข้อมูลต้องอยู่ที่อื่น');
  for (const fn of ['excelSerialToISO', 'excelValueToISO', 'normalizeDateOnly', 'dateFromISO',
    'addDaysISO', 'daysBetween', 'implausibleDate', 'fmtDateTH', 'todayISO', 'isoLocal', 'pad2']) {
    assert.equal(typeof D[fn], 'function', `${fn} ต้องอยู่ใน core/dates.js`);
  }
});

test('C1 — เลขวันของ Excel แปลงเป็น YYYY-MM-DD ตรงวันทุกตัว ไม่ผ่าน Date และไม่ขึ้นกับเขตเวลา', () => {
  assert.equal(D.excelSerialToISO(25569), '1970-01-01');
  assert.equal(D.excelSerialToISO(45000), '2023-03-15');
  assert.equal(D.excelSerialToISO(379), '1901-01-13', 'เลขยอดสั่ง 379 ที่ถูกอ่านเป็นวันที่ — เคสจริง ต.ค. 2026');
  for (let s = 61; s <= 80000; s += 37) assert.equal(D.excelSerialToISO(s), oracle(s), `เลข ${s}`);
});

test('C1 — เลขวันที่มีเศษทศนิยมจากสูตร ต้องปัดเป็นวันที่ใกล้ที่สุด ไม่ใช่ตัดทิ้ง', () => {
  assert.equal(D.excelSerialToISO(46227.99996), D.excelSerialToISO(46228));
  assert.equal(D.excelSerialToISO(46228.00004), D.excelSerialToISO(46228));
});

// ⚠️ Date ต้องสร้างใน context เดียวกับโค้ด — excelValueToISO เช็ก `instanceof Date`
//    ซึ่งเป็นคนละตัวกับ Date ของ node ข้างนอก (เขียนตรง ๆ แล้วได้ null ทั้งที่โค้ดถูก)
const utcDate = (y, m, d) => vm.runInContext(`new Date(Date.UTC(${y}, ${m}, ${d}))`, D);

test('C1 — ช่องวันที่ที่ตัวอ่าน Excel ส่งมาเป็น Date (เที่ยงคืน UTC) ต้องอ่านด้วยเวลา UTC', () => {
  assert.equal(D.excelValueToISO(utcDate(2026, 6, 29)), '2026-07-29');
  assert.equal(D.excelValueToISO(utcDate(2028, 1, 29)), '2028-02-29');
  assert.equal(D.excelValueToISO(46227), D.excelSerialToISO(46227));
  assert.equal(D.excelValueToISO(null), null);
  assert.equal(D.excelValueToISO(''), null);
  assert.equal(D.excelValueToISO(vm.runInContext('new Date(NaN)', D)), null);
});

/** รันนิพจน์กับ core/dates.js ในโปรเซสลูกที่ตั้งเขตเวลาไว้ · คืน [ห่างจาก UTC กี่ชั่วโมง, ผลลัพธ์]
 *  ⚠️ ข้อที่ขึ้นกับเขตเวลาต้องรันแบบนี้ · CI เป็น UTC ส่วนเครื่องเจ้าของเป็นไทย (UTC+7)
 *     ซึ่งบังเอิญได้วันเดิมในบางทิศ เทสที่รันในเขตเวลาของเครื่องจึงเขียวทั้งที่โค้ดผิดได้
 *  ⚠️ ตั้ง TZ ผ่าน env ของ spawn เท่านั้น — Git Bash บน Windows ไม่ส่ง TZ ที่มี "/" ให้ node */
function inTz(tz, expr) {
  const { spawnSync } = require('child_process');
  const code = `const vm=require('vm');const c=vm.createContext({});vm.runInContext(${JSON.stringify(SRC)},c);`
    + `process.stdout.write(String(-new Date(0).getTimezoneOffset()/60)+' '+`
    + `vm.runInContext(${JSON.stringify(expr)},c));`;
  const r = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [offset, out] = r.stdout.split(' ');
  return [Number(offset), out];
}

test('C1 — อ่าน Date ด้วยเวลา UTC ต้องได้วันเดิมแม้เครื่องอยู่หลัง UTC (รันในเขตเวลาสหรัฐฯ)', () => {
  // ลองถอด getUTC* ออกแล้ว: ข้อข้างบนเขียวทั้งบน CI และเครื่องไทย · ข้อนี้แดงทั้งคู่
  const [offset, iso] = inTz('America/Los_Angeles', 'excelValueToISO(new Date(Date.UTC(2026,6,29)))');
  assert.ok(offset < 0, 'โปรเซสลูกไม่ได้อยู่หลัง UTC จริง — เทสนี้จะไม่ได้ตรวจอะไร');
  assert.equal(iso, '2026-07-29');
});

test('C2 — timestamp เต็มต้องตัดเป็นวันตามเวลาเครื่อง ไม่ใช่วันของ UTC (รันในเขตเวลาไทยและสหรัฐฯ)', () => {
  // ทิศตรงข้ามกับ excelValueToISO · 17:00Z ของวันที่ 7 คือ 00:00 วันที่ 8 ที่ไทย
  // ⚠️ ผู้ตรวจ #139 ลองสลับ isoLocal เป็น getUTC* แล้ว: ข้อ C2 ข้างล่างเขียวบน CI ทั้งที่โค้ดผิด
  //    เพราะ timestamp ที่ไม่มี Z ไม่ขึ้นกับเขตเวลา และ UTC กับ "เวลาท้องถิ่นของ CI" คือตัวเดียวกัน
  const [th, inBangkok] = inTz('Asia/Bangkok', "normalizeDateOnly('2026-07-07T17:00:00.000Z')");
  assert.equal(th, 7, 'โปรเซสลูกไม่ได้อยู่ที่ UTC+7 จริง — เทสนี้จะไม่ได้ตรวจอะไร');
  assert.equal(inBangkok, '2026-07-08');
  const [, inLA] = inTz('America/Los_Angeles', "normalizeDateOnly('2026-07-08T02:00:00.000Z')");
  assert.equal(inLA, '2026-07-07');
});

test('C2 — normalizeDateOnly: YYYY-MM-DD ผ่านตามเดิม · timestamp เต็มเหลือแค่วัน · ค่าว่างไม่ถูกแตะ', () => {
  assert.equal(D.normalizeDateOnly('2026-10-20'), '2026-10-20');
  // ไม่มี Z = เวลาท้องถิ่น · ได้วันเดิมไม่ว่าเครื่องอยู่เขตเวลาไหน
  assert.equal(D.normalizeDateOnly('2026-10-20T00:00:00'), '2026-10-20');
  assert.equal(D.normalizeDateOnly('2026-10-20T23:59:59'), '2026-10-20');
  assert.equal(D.normalizeDateOnly(''), '');
  assert.equal(D.normalizeDateOnly(null), null);
  assert.equal(D.normalizeDateOnly('2026-13-45T00:00:00'), null, 'timestamp ที่อ่านไม่ได้ต้องเป็น null ไม่ใช่ Invalid Date');
});

test('C3 — addDaysISO · daysBetween ข้ามเดือน ข้ามปี ปีอธิกสุรทิน', () => {
  assert.equal(D.addDaysISO('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addDaysISO('2027-02-28', 1), '2027-03-01');
  assert.equal(D.addDaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDaysISO('2026-03-01', -1), '2026-02-28');
  assert.equal(D.daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(D.daysBetween('2026-10-20', '2026-10-17'), -3);
  assert.equal(D.daysBetween('', '2026-10-17'), null, 'ไม่มีวันที่ = คิด Aging ไม่ได้ ไม่ใช่ 0');
  assert.equal(D.addDaysISO(null, 3), null);
});

test('C3 — สตริงวันที่ที่ได้เรียงตามตัวอักษรตรงกับเรียงตามเวลา', () => {
  const days = [];
  for (let s = 40000; s <= 50000; s += 97) days.push(D.excelSerialToISO(s));
  assert.deepEqual([...days].sort(), days);
});

test('C3 — fmtDateTH ใช้แสดงผลเท่านั้น: วว/ดด/ปปปป · ค่าที่อ่านไม่ได้เป็นขีด', () => {
  assert.equal(D.fmtDateTH('2026-10-20'), '20/10/2026');
  assert.equal(D.fmtDateTH('2026-10-20T08:00:00'), '20/10/2026');
  assert.equal(D.fmtDateTH(null), '-');
  assert.equal(D.fmtDateTH(''), '-');
});

test('implausibleDate — ก่อนปี 2000 หรือเลยวันนี้ไปเกิน 366 วัน · ช่องว่างไม่นับ (#111)', () => {
  const ref = '2026-11-15';
  assert.equal(D.implausibleDate('1901-01-13', ref), true);
  assert.equal(D.implausibleDate('1999-12-31', ref), true);
  assert.equal(D.implausibleDate('2000-01-01', ref), false);
  assert.equal(D.implausibleDate(D.addDaysISO(ref, 366), ref), false);
  assert.equal(D.implausibleDate(D.addDaysISO(ref, 367), ref), true);
  assert.equal(D.implausibleDate('ไม่ใช่วันที่', ref), true);
  assert.equal(D.implausibleDate(379, ref), true, 'ตัวเลขดิบที่หลุดมาในช่องวันที่');
  assert.equal(D.implausibleDate('', ref), false);
  assert.equal(D.implausibleDate(null, ref), false);
});

test('todayISO — วันตามนาฬิกาเครื่อง รูป YYYY-MM-DD', () => {
  const t = D.todayISO();
  assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
  const n = new Date();
  assert.equal(t, `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`);
});
