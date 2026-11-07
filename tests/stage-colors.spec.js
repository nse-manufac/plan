// สีประจำขั้น — ห้ามซ้ำกันเอง และห้ามซ้ำกับสีสถานะของแอป (INVARIANTS A3)
//
// เจ้าของสั่งเปลี่ยนสีเมื่อ 8 พ.ย. 2026 เพราะสีเดิมแยกด้วยตาไม่ออก (น้ำเงิน #2563eb กับม่วง #7c3aed)
// ชุดใหม่วัดระยะเชิงการมองเห็นมาแล้วนอกเทสนี้ — เทสนี้ไม่วัดระยะ (ต้องมีคณิตสีซึ่งแอปไม่มีและห้ามเพิ่ม F2)
// สิ่งที่เทสนี้คุมคือสองอย่างที่เป็น "ซ้ำกันเป๊ะ" ซึ่งเป็นรูปของบั๊กที่เคยมีอยู่จริงในไฟล์:
//   · PROCESS_PALETTE เดิมมี #dc2626 ซึ่งเป็นสี var(--red) ที่ใช้เป็นป้าย "ล่าช้า" อยู่แล้ว
//     ขั้นที่เพิ่มเข้ามาจะได้สีเดียวกับป้ายล่าช้าเป๊ะ ๆ โดยไม่มีอะไรฟ้อง
//   · สองสีแรกของ PROCESS_PALETTE คือสีที่กันไว้ให้ขั้นที่ 6 กับ 7 (เจ้าของสั่ง 8 พ.ย. 2026)
//     ต้องไม่ซ้ำกับห้าขั้นตั้งต้น ไม่งั้นเพิ่มขั้นแล้วสองขั้นสีเดียวกัน

const { test, expect } = require('@playwright/test');
const { waitReady } = require('./app-state');

const APP = '/production_plan_tracker.html';
const DEFAULT_IDS = ['winding', 'assembly', 'support', 'inspection', 'shipping'];

const norm = c => String(c || '').trim().toLowerCase();

async function readColors(page) {
  await page.goto(APP);
  await waitReady(page);
  return page.evaluate(() => {
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return {
      stage: Object.fromEntries(Object.entries(PROCESS_COLORS)),
      palette: PROCESS_PALETTE.slice(),
      status: { red: css('--red'), amber: css('--amber'), green: css('--green') }
    };
  });
}

test('A3 — สีของห้าขั้นตั้งต้นต้องไม่ซ้ำกันเอง', async ({ page }) => {
  const { stage } = await readColors(page);
  const used = DEFAULT_IDS.map(id => norm(stage[id]));
  expect(used.filter(Boolean)).toHaveLength(DEFAULT_IDS.length);
  expect(new Set(used).size).toBe(DEFAULT_IDS.length);
});

test('A3 — สีของขั้นต้องไม่ซ้ำกับสีสถานะ (ล่าช้า · ใกล้ครบกำหนด · ส่งครบแล้ว)', async ({ page }) => {
  const { stage, status } = await readColors(page);
  const statusSet = new Set(Object.values(status).map(norm));
  expect(statusSet.size).toBe(3);               // อ่านค่าจาก CSS ได้จริง ไม่ใช่ค่าว่างสามอัน
  for (const id of DEFAULT_IDS) {
    expect(statusSet.has(norm(stage[id])), `สีของขั้น ${id} ซ้ำกับสีสถานะ`).toBe(false);
  }
});

test('A3 — สีสำรองของขั้นที่เพิ่มใหม่ ต้องไม่ซ้ำกับสีขั้นที่มีอยู่ และไม่ซ้ำกับสีสถานะ', async ({ page }) => {
  const { stage, palette, status } = await readColors(page);
  const taken = new Set([...DEFAULT_IDS.map(id => norm(stage[id])), ...Object.values(status).map(norm)]);
  expect(palette.length).toBeGreaterThanOrEqual(2);   // ต้องมีสีให้ขั้นที่ 6 กับ 7 เป็นอย่างน้อย
  palette.forEach((c, i) => {
    expect(taken.has(norm(c)), `สีสำรองตัวที่ ${i + 1} (${c}) ซ้ำกับสีที่ใช้อยู่แล้ว`).toBe(false);
  });
  expect(new Set(palette.map(norm)).size).toBe(palette.length);
});
