// ด่านของ subNameFromPo — หน่วยของใบสั่งมาจากตัวอักษรตำแหน่งที่ 7 ของรหัส PO
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────
// ใบส่งสินค้าแยกตามหน่วย ตัดสินผิดแล้ว **ของไปออกใบผิดหน่วยโดยไม่มีใครรู้**
// ไม่มี error ไม่มีอะไรร้อง เห็นอีกทีตอนลูกค้าทัก
//
// ของเดิมถาม "มีตัว H ไหม / มีตัว U ไหม" ซึ่งบังเอิญใช้ได้ตอนมีสองหน่วย
// แต่ขยายไม่ได้ สำรวจรหัสจริง 1,657 ใบจากไฟล์ใบส่งงานของบริษัท (10 ต.ค. 2026)
//   เพิ่ม "มีตัว T" -> พัง 1,641 ใบ เพราะรหัสทุกใบขึ้นต้นด้วย TM
//   เพิ่ม "มีตัว A" -> พัง 170 ใบ เพราะ A ที่ตำแหน่งที่ 6 คือ "เดือน 10" ไม่ใช่หน่วย
//
// โครงรหัสจริง — ตำแหน่งที่ 6 คือเดือน (3-9 แล้วข้ามไป A=ต.ค. B=พ.ย.)
//                ตำแหน่งที่ 7 คือนิติบุคคล (H U T A)
// สองอย่างนี้อยู่คนละตำแหน่ง จึงไม่ชนกันแม้ตัวอักษรจะซ้ำกัน

const { test, expect } = require('@playwright/test');
const { appSource, fnSource } = require('./app-source');

/** ดึงตัวฟังก์ชันจริงออกมาจากซอร์ส แล้วรันในเทส
 *  อ่านจากไฟล์จริงเสมอ ห้ามก็อปตรรกะมาไว้ในเทส ไม่งั้นวันหนึ่งมันจะหลุดจากกัน
 *  แล้วเทสจะเขียวทั้งที่ระบบพัง ซึ่งแย่กว่าไม่มีเทส
 *
 *  ใช้ `fnSource()` ของ tests/app-source.js แทน regex ของตัวเอง
 *  ตัวนั้นอ่านทุกไฟล์ที่หน้าโหลดจริง จึงทนการแยกไฟล์ตาม CLAUDE.md §3.1
 *  และ **โยน error ดัง ๆ ถ้าหาไม่เจอหรือเจอเกินหนึ่งที่**
 *  ต่างจาก regex ที่หาไม่เจอแล้วเงียบ (ผู้ตรวจทักไว้ใน #101) */
function loadSubNameFromPo() {
  const mapSrc = appSource().match(/const SUB_BY_LETTER = \{[^}]*\};/);
  expect(mapSrc, 'หา SUB_BY_LETTER ในซอร์สไม่เจอ').toBeTruthy();
  // eslint-disable-next-line no-new-func
  return new Function(`${mapSrc[0]}\n${fnSource('subNameFromPo')}\nreturn subNameFromPo;`)();
}

test('Sub-Name — ตัวอักษรตำแหน่งที่ 7 ตัดสินหน่วย ครบทั้งสี่หน่วย', () => {
  const f = loadSubNameFromPo();
  expect(f('TM5269H688')).toBe('TUE-H');
  expect(f('TM5267U123')).toBe('TUE-U');
  expect(f('TM5269T005')).toBe('TUE-T');
  expect(f('TM5267A001')).toBe('TUE-A');
});

test('Sub-Name — รหัสเดือน 10 ขึ้นไปใช้ตัวอักษรแทนเลข แต่ไม่กระทบการตัดสินหน่วย', () => {
  const f = loadSubNameFromPo();
  // ตำแหน่งที่ 6 เป็น A คือ "เดือน 10" ไม่ใช่หน่วย TUE-A — ของจริงมี 144 ใบที่เป็นแบบนี้
  expect(f('TM526AH123'), 'เดือน 10 ของ TUE-H ต้องยังเป็น TUE-H').toBe('TUE-H');
  expect(f('TM526AU123')).toBe('TUE-U');
  expect(f('TM526AT123')).toBe('TUE-T');
  expect(f('TM526BH123'), 'เดือน 11').toBe('TUE-H');
  // เดือน 10 ของ TUE-A เอง — ตัว A สองตัวติดกัน ยังต้องอ่านถูก
  expect(f('TM526AA123'), 'เดือน A + หน่วย A').toBe('TUE-A');
});

test('Sub-Name — รหัสที่มีตัวอักษรหน่วยซ้ำต่อท้าย ยังอ่านถูก', () => {
  const f = loadSubNameFromPo();
  expect(f('TM5269HH51')).toBe('TUE-H');
  expect(f('TM526AHH51')).toBe('TUE-H');
});

test('Sub-Name — ตัดสินไม่ได้ต้องคืนค่าว่าง ห้ามเดา', () => {
  const f = loadSubNameFromPo();
  for (const bad of ['', null, undefined, 'TM5269', 'TM526', 'XX5269H688', 'TM5269X688', 'TM5269 688'])
    expect(f(bad), 'ต้องคืนค่าว่าง: ' + JSON.stringify(bad)).toBe('');
});

test('Sub-Name — เว้นวรรคหัวท้ายและตัวพิมพ์เล็กยังอ่านได้', () => {
  const f = loadSubNameFromPo();
  expect(f(' TM5269H688 ')).toBe('TUE-H');
  expect(f('tm5269t005')).toBe('TUE-T');
});

test('Sub-Name — ห้ามกลับไปตัดสินหน่วยด้วย includes()', () => {
  // ด่านอ่านซอร์ส เพราะถ้ามีใครเปลี่ยนกลับ เทสข้างบนบางข้อจะยังเขียวอยู่
  // (เช่น TM5269H688 ผ่านทั้งสองกฎ) แต่ของจริงจะพังเป็นพันใบ
  const fn = fnSource('subNameFromPo');
  expect(fn, 'subNameFromPo ต้องไม่ใช้ includes — รหัสทุกใบขึ้นต้นด้วย TM จึง "มีตัว T" เสมอ')
    .not.toMatch(/\.includes\(/);
});
