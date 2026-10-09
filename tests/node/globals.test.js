// ชื่อระดับบนสุดของแอปต้องไม่ซ้ำกันเอง — รันด้วย node ล้วน (npm run test:core)
//
// ตั้งแต่ถอดเปลือก IIFE (ใบ 02 ของการแยกไฟล์ · CLAUDE.md §3.1) ทุกไฟล์ใช้ชื่อร่วมกันในที่เดียว
// สองไฟล์ประกาศ function ชื่อเดียวกัน = ตัวที่โหลดทีหลังทับตัวแรกโดยไม่มีอะไรฟ้อง
// ส่วนชื่อที่ซ้ำกับของเบราว์เซอร์ต้องใช้เบราว์เซอร์ตรวจ อยู่ที่ tests/globals.spec.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { topLevelNames } = require('../app-source');

test('หาชื่อระดับบนสุดเจอจริง — ไม่งั้นข้อถัดไปเขียวเพราะไม่ได้ตรวจอะไร', () => {
  assert.ok(topLevelNames().length > 100, `เจอแค่ ${topLevelNames().length} ชื่อ`);
});

test('ชื่อระดับบนสุดต้องไม่ซ้ำกัน ไม่ว่าจะอยู่ไฟล์เดียวกันหรือคนละไฟล์', () => {
  const seen = new Map();
  const dup = [];
  for (const n of topLevelNames()) {
    if (seen.has(n.name)) dup.push(`${n.name}: ${seen.get(n.name)} กับ ${n.file}:${n.line}`);
    else seen.set(n.name, `${n.file}:${n.line}`);
  }
  assert.deepEqual(dup, [], 'ตัวที่โหลดทีหลังจะทับตัวแรกเงียบ ๆ — เปลี่ยนชื่อตัวใดตัวหนึ่ง');
});
