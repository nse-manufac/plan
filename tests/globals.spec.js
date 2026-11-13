// ชื่อระดับบนสุดของแอปต้องไม่ทับของที่เบราว์เซอร์มีอยู่แล้ว
//
// ตั้งแต่ถอดเปลือก IIFE (ใบ 02 ของการแยกไฟล์ · CLAUDE.md §3.1) function และตัวแปรระดับบนสุดทุกตัว
// กลายเป็นของ global ของหน้า ถ้าวันหนึ่งมีคนเขียน function print() หรือ let status = ...
// จะทับของเบราว์เซอร์เงียบ ๆ — ปุ่มพิมพ์ที่เรียก window.print() จะไปเรียกของเราแทน
// (ตอนนี้คือ #btnPrintRecords · เคยเขียนว่า "ปุ่มพิมพ์ของ Dashboard" ซึ่งถูกลบพร้อมแท็บนั้น
//  เมื่อ 12 พ.ย. 2569 — ผู้ตรวจ #134 รอบ 13)
// ตรวจกับ Chromium จริงเพราะรายชื่อของ window ต่างกันไปตามเบราว์เซอร์และรุ่น จดเป็นรายการตายตัวไม่ได้

const { test, expect } = require('@playwright/test');
const { topLevelNames } = require('./app-source');

test('ชื่อระดับบนสุดของแอปต้องไม่ทับของที่เบราว์เซอร์มีอยู่แล้ว', async ({ page }) => {
  const names = topLevelNames();
  expect(names.length, 'ต้องหาชื่อระดับบนสุดเจอจริง ไม่งั้นข้อนี้ไม่ได้ตรวจอะไร').toBeGreaterThan(100);

  await page.goto('about:blank');
  const hits = await page.evaluate(ns => ns.filter(n => {
    for (let o = window; o; o = Object.getPrototypeOf(o)) {
      if (Object.prototype.hasOwnProperty.call(o, n.name)) return true;
    }
    return false;
  }).map(n => `${n.name} (${n.file}:${n.line})`), names);

  expect(hits, 'ชื่อเหล่านี้ทับของเบราว์เซอร์ — เปลี่ยนชื่อ').toEqual([]);
});
