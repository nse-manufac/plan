// ด่านเทียบ "คอลัมน์ที่ซิงค์" ระหว่างแอปกับฝั่งเซิร์ฟเวอร์
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────
// แอปส่งทั้งแถวขึ้นไป ฝั่งเซิร์ฟเวอร์เป็นคนตัดสินว่าเก็บคอลัมน์ไหน
// ฟิลด์ที่ฝั่งโน้นไม่รู้จักจะ **หายเงียบ ๆ** ไม่มี error ไม่มีอะไรร้อง
//
// เกิดขึ้นจริงมาแล้ว — ORDER_COLS ฝั่งเซิร์ฟเวอร์ขาด planSupport ไปตัวเดียว
// ทำให้วันแผน Support ไม่เคยซิงค์เลยตั้งแต่ issue #17 กว่าจะรู้ก็หลายเดือน
// ทั้งสองฝั่ง "ทำงานสำเร็จ" ตามหน้าที่ของตัวเอง จึงไม่มีทางเห็นจากหน้าจอ
//
// ── ด่านนี้อ่านไฟล์จริงทั้งสองฝั่งมาเทียบ ห้ามก็อปรายการมาไว้ในเทส ─────
// ถ้าเขียนรายการที่คาดหวังไว้เอง วันหนึ่งมันจะหลุดจากของจริงแล้วเทสจะเขียว
// ทั้งที่ระบบพัง ซึ่งแย่กว่าไม่มีเทส เพราะให้ความมั่นใจปลอม

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'production_plan_tracker.html'), 'utf8');
const GS_SRC = fs.readFileSync(path.join(ROOT, 'google-apps-script.gs'), 'utf8');

/** ดึงรายการสตริงในวงเล็บเหลี่ยมของค่าคงที่ตัวหนึ่ง เช่น const X = ['a','b']; */
function constList(src, name) {
  const m = new RegExp('const ' + name + '\\s*=\\s*\\[([^\\]]*)\\]', 'm').exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

/** ตารางที่ฝั่งเซิร์ฟเวอร์ลงทะเบียนไว้ใน ROW_TABLES พร้อมชื่อค่าคงที่ของคอลัมน์ */
function serverTables() {
  const m = /var ROW_TABLES\s*=\s*\{([\s\S]*?)\}\s*;/.exec(GS_SRC);
  if (!m) return {};
  const out = {};
  for (const [, table, constName] of m[1].matchAll(/(\w+)\s*:\s*(\w+)/g)) {
    out[table] = constList(GS_SRC, constName);
  }
  return out;
}

/** ตารางที่ฝั่งแอปประกาศว่าจะซิงค์ ใน SYNC_COLS */
function clientTables() {
  const m = /const SYNC_COLS\s*=\s*\{([\s\S]*?)\n\};/.exec(APP_SRC);
  if (!m) return {};
  const out = {};
  for (const [, table, body] of m[1].matchAll(/(\w+)\s*:\s*\[([^\]]*)\]/g)) {
    out[table] = [...body.matchAll(/'([^']+)'/g)].map(x => x[1]);
  }
  return out;
}

// ── ด่านต้องล้มเมื่อ "ตัวมันเอง" อ่านไม่ออก ────────────────────────
// ถ้าไฟล์เปลี่ยนรูปแบบแล้วตัวแกะได้ผลว่าง ลูปจะวนศูนย์รอบ = เขียว = ด่านตายเงียบ
test('ตัวแกะต้องอ่านไฟล์จริงออก ไม่งั้นด่านนี้ตายไปโดยไม่มีใครรู้', () => {
  const srv = serverTables(), cli = clientTables();

  expect(Object.keys(srv).length, 'อ่าน ROW_TABLES จาก google-apps-script.gs ไม่ออก — รูปแบบไฟล์เปลี่ยนไปแล้ว')
    .toBeGreaterThanOrEqual(4);
  expect(Object.keys(cli).length, 'อ่าน SYNC_COLS จากตัวแอปไม่ออก — รูปแบบไฟล์เปลี่ยนไปแล้ว')
    .toBeGreaterThanOrEqual(4);

  for (const [t, cols] of Object.entries(srv)) {
    expect(cols, `อ่านคอลัมน์ของตาราง ${t} ฝั่งเซิร์ฟเวอร์ไม่ออก`).not.toBeNull();
    expect(cols.length, `ตาราง ${t} ฝั่งเซิร์ฟเวอร์มีคอลัมน์แค่ ${cols && cols.length} ตัว — น้อยผิดปกติ`)
      .toBeGreaterThanOrEqual(8);
  }
});

test('ทุกตารางที่แอปซิงค์ ต้องมีอยู่ฝั่งเซิร์ฟเวอร์ และกลับกัน', () => {
  const srv = Object.keys(serverTables()).sort();
  const cli = Object.keys(clientTables()).sort();
  expect(cli, 'ตารางสองฝั่งต้องตรงกัน — เพิ่มตารางใหม่แล้วลืมแก้อีกฝั่ง ข้อมูลจะหายเงียบ ๆ')
    .toEqual(srv);
});

test('ชื่อคอลัมน์ของทุกตารางต้องตรงกันทั้งสองฝั่ง', () => {
  const srv = serverTables(), cli = clientTables();
  for (const table of Object.keys(srv)) {
    const a = [...(cli[table] || [])].sort();
    const b = [...(srv[table] || [])].sort();

    const missingOnServer = a.filter(c => !b.includes(c));
    const missingOnClient = b.filter(c => !a.includes(c));

    expect(missingOnServer,
      `ตาราง ${table}: แอปส่ง [${missingOnServer}] ขึ้นไป แต่เซิร์ฟเวอร์ไม่มีคอลัมน์นี้ — ข้อมูลจะหายเงียบ ๆ ` +
      `(เคยเกิดกับ planSupport มาแล้ว)`).toEqual([]);
    expect(missingOnClient,
      `ตาราง ${table}: เซิร์ฟเวอร์มีคอลัมน์ [${missingOnClient}] แต่แอปไม่ได้ส่งขึ้นไป — ` +
      `ช่องนั้นจะว่างตลอดกาล`).toEqual([]);
  }
});

test('ตารางที่ลงทะเบียนไว้ ต้องถูกสร้างชีตให้ด้วยใน setupSheets()', () => {
  // ลงทะเบียนใน ROW_TABLES แล้วลืมใส่ใน setupSheets() = ชีตไม่ถูกสร้าง
  // push ครั้งแรกจะล้ม แต่บล็อกซิงค์ห่อ try/catch ไว้ จึงเงียบอีกเหมือนกัน
  const setup = /function setupSheets\(\)\s*\{([\s\S]*?)\n\}/.exec(GS_SRC);
  expect(setup, 'อ่าน setupSheets() ไม่ออก — รูปแบบไฟล์เปลี่ยนไปแล้ว').not.toBeNull();

  const created = [...setup[1].matchAll(/sheetOf\('(\w+)'/g)].map(m => m[1]);
  expect(created.length, `เจอ sheetOf แค่ ${created.length} ตัว — น้อยผิดปกติ`).toBeGreaterThanOrEqual(4);

  for (const table of Object.keys(serverTables())) {
    expect(created, `ตาราง ${table} ลงทะเบียนไว้แล้ว แต่ setupSheets() ไม่ได้สร้างชีตให้`)
      .toContain(table);
  }
});

// ── พิสูจน์ว่าด่านจับได้จริง ด้วยการทำให้มันแดงเอง ────────────────────
// เทสที่เขียวเพราะไม่ได้ตรวจอะไรเลย หน้าตาเหมือนเทสที่เขียวเพราะทุกอย่างถูก
test('ตัดคอลัมน์ออกจากฝั่งเซิร์ฟเวอร์แล้ว ด่านต้องจับได้', () => {
  const srv = serverTables();
  expect(srv.Orders, 'ของจริงต้องมี planSupport อยู่แล้ว').toContain('planSupport');

  // จำลองบั๊กจริงของ issue #17 — ตัด planSupport ออกจากรายการฝั่งเซิร์ฟเวอร์
  const broken = GS_SRC.replace("'planSupport',", '');
  const m = /var ROW_TABLES\s*=\s*\{([\s\S]*?)\}\s*;/.exec(broken);
  const constName = /Orders\s*:\s*(\w+)/.exec(m[1])[1];
  const brokenCols = constList(broken, constName);

  expect(brokenCols, 'ตัดออกแล้วรายการต้องเปลี่ยนจริง ไม่งั้นการจำลองนี้ไม่ได้พิสูจน์อะไร')
    .not.toContain('planSupport');

  const cliOrders = clientTables().Orders || [];
  const missing = cliOrders.filter(c => !brokenCols.includes(c));
  expect(missing, 'ด่านต้องชี้ได้ว่าคอลัมน์ไหนหายไป').toContain('planSupport');
});
