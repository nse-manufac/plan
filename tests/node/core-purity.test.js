// core/ เป็นกฎล้วน — ห้ามแตะ DOM · ที่เก็บข้อมูลในเครื่อง · เน็ต · state (CLAUDE.md §3.1)
//
// ตรวจ **ทุกไฟล์ใน core/** ไม่ใช่ทีละไฟล์ — ใบย้ายถัด ๆ ไป (core/cumulative · core/status …) แก้เทสเดิม
// ไม่ได้ (§3.1 กติกาข้อ 3) ไฟล์ใหม่จึงต้องถูกตรวจเองตั้งแต่วันที่มันเกิด โดยไม่มีใครต้องมาเติมชื่อ
//
// ⚠️ ค้นเป็น "ชื่อเปล่า ๆ" ไม่ใช่ "ชื่อตามด้วย . ( [" — ฉบับแรก (ใน core-dates.test.js · ใบ 04) เขียนแบบหลัง
//    จึงหลุด `globalThis.document` · `typeof window` · `const w = window` (ผู้ตรวจ #139 รอบ 2 ทัก)
//    ตัดคอมเมนต์ก่อนค้น เพราะคอมเมนต์ภาษาไทยในไฟล์พวกนี้พูดถึง state กับหน้าจอเป็นปกติ
// ⚠️ คำเดียวกันในข้อความ (string) จะแดงด้วย — ตั้งใจ ถ้าวันหนึ่งเจอ ให้ดูว่ามันแตะของจริงหรือไม่ก่อนจะยกเว้น

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CORE = path.join(__dirname, '..', '..', 'core');
const FORBIDDEN = ['document', 'window', 'globalThis', 'self', 'top', 'parent', 'frames',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'navigator', 'location', 'history', 'alert', 'confirm', 'prompt', 'state'];

/** ตัดคอมเมนต์ทิ้ง · `//` ที่ตามหลัง `:` ไม่นับ (เป็น URL ในข้อความ) */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function forbiddenIn(src) {
  const re = new RegExp(`(?<![.\\w$])(${FORBIDDEN.join('|')})(?![\\w$])`, 'g');
  return stripComments(src).match(re);
}

const FILES = fs.readdirSync(CORE).filter(f => f.endsWith('.js'));

test('core/ มีไฟล์ให้ตรวจจริง — ไม่งั้นข้อข้างล่างเขียวเปล่า ๆ', () => {
  assert.ok(FILES.includes('dates.js'), FILES.join(', '));
});

for (const f of FILES) {
  test(`core/${f} ห้ามแตะ DOM · ที่เก็บข้อมูล · เน็ต · state — ทุกรูปการเขียน`, () => {
    const src = fs.readFileSync(path.join(CORE, f), 'utf8');
    assert.deepEqual(forbiddenIn(src), null,
      'core/ เป็นกฎล้วน (CLAUDE.md §3.1) ของที่แตะหน้าจอหรือข้อมูลต้องอยู่ที่อื่น');
  });
}

test('ตัวตรวจต้องจับรูปที่ฉบับแรกหลุด — ไม่งั้นข้อข้างบนเขียวโดยไม่ได้ตรวจอะไร', () => {
  for (const bad of [
    'const d = globalThis.document;',
    'if (typeof window !== "undefined") x();',
    'const w = window; w.alert(1);',
    'function f(){ return state }',
    'self["fetch"]("x")',
  ]) {
    assert.notEqual(forbiddenIn(bad), null, `ต้องจับได้: ${bad}`);
  }
  // ของที่ไม่ใช่ของต้องห้าม — ชื่อที่มีคำพวกนี้ซ้อนอยู่ · property ของ object อื่น · คอมเมนต์
  for (const ok of [
    'const stateReady = 1; const myWindow = 2;',
    'o.state = 1; d.location;',
    '// อ่าน state จากที่อื่น\n/* document */ const x = 1;',
    'const url = "https://example.test/a";',
  ]) {
    assert.equal(forbiddenIn(ok), null, `ต้องไม่จับ: ${ok}`);
  }
});
