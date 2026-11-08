// รหัส PO ใน fixture ของเทสต้องเป็นของสมมุติ ไม่ใช่ของจริงจากจอเจ้าของ (INVARIANTS F3 · repo นี้ public)
//
// ⚠️ เรื่องนี้เกิดจริงสองรอบในใบเดียว (#127) — ครั้งแรกหลุดเข้าหัว PR ผู้ตรวจทักแล้วแก้
//    ครั้งที่สอง **เอากลับเข้าไฟล์ที่ commit** สองรอบถัดมา เพราะค่านั้นยังอยู่ในหัวคนเขียน
//    ผู้ตรวจจับได้ทั้งสองครั้ง แต่การพึ่งสายตาคนในเรื่องที่ย้อนกลับไม่ได้ ไม่ใช่ด่าน
//
// กติกา: รหัส PO ในเทสห้ามขึ้นต้น **TM2** ซึ่งเป็นปีจริง (TM + ปี ค.ศ. สองหลัก → 26xx = 2026)
// ชุดสมมุติที่ repo ใช้มาตลอดคือ TM52… กับ TM99… ซึ่งไม่มีทางเป็นปีจริง
// ห้ามเฉพาะ TM2 ไม่ใช่บังคับ TM52 — ด่านที่บอกว่าห้ามทุกอย่างเว้นสิ่งเดียว
// คือด่านที่คนเลี่ยงด้วยการตั้งชื่ออื่น แล้วจะกลายเป็นด่านที่ไม่มีใครอ่าน
//
// ⚠️ ด่านนี้จับเฉพาะรูปแบบรหัส PO · เลข P/N จริงยังหลุดได้ ซึ่งเครื่องตรวจแยกจากของสมมุติไม่ออก
//    (ทั้งคู่เป็นตัวเลขสิบหลัก) — ตรงนั้นยังต้องอาศัยคนอ่าน

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..');
const PO = /\bTM[0-9A-Z]{6,10}\b/g;
const REAL_YEAR = /^TM2/;   // TM + 2x = ปีจริง

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js'))
  .concat(fs.readdirSync(__dirname).map(f => path.join('node', f)).filter(f => f.endsWith('.js')));

test('หา fixture ที่มีรหัส PO เจอจริง — ไม่งั้นข้อถัดไปเขียวเพราะไม่ได้ตรวจอะไร', () => {
  let n = 0;
  for (const f of files) n += (fs.readFileSync(path.join(DIR, f), 'utf8').match(PO) || []).length;
  assert.ok(n > 20, `เจอรหัส PO แค่ ${n} ตัว — ตัวจับน่าจะพัง`);
});

test('F3 — รหัส PO ใน fixture ห้ามขึ้นต้นด้วยปีจริง (TM2…) ซึ่งแปลว่าก๊อปมาจากจอเจ้าของ', () => {
  const bad = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.match(PO) || []) {
        if (REAL_YEAR.test(m)) bad.push(`${f}:${i + 1} ${m}`);
      }
    });
  }
  assert.deepEqual(bad, [], 'ใช้ชุดสมมุติ TM52… แทน — ของจริงลบจาก git ไม่ได้หลังเมิร์จ');
});
