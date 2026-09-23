// ขั้นนับแยก (standalone) — ขั้นที่ยอดไม่เกี่ยวกับสายหลักเลย (INVARIANTS A3 · A5)
//
// เจ้าของสั่ง 20 ก.ย. 2026: อยากเพิ่มขั้นที่ไม่ได้ต่อจากขั้นไหนใน process flow
// เช่นงานซ่อม งานนอกแผน — คีย์ยอดเก็บไว้ดูย้อนหลังได้ แต่ไม่ได้ไหลมาจากขั้นไหน
//
// เทสไม่ได้แก้ไฟล์จริง — ดักไฟล์ตอนเบราว์เซอร์โหลด แล้วแทรกขั้นนับแยกระหว่าง Winding กับ Assembly
// ยอดที่ใช้ตั้งใจให้ "ผิดถ้าถูกนับเป็นขั้นในสาย" — winding 800 → repair 100 → assembly 300
// ถ้า repair ถูกนับเป็นขั้นก่อนหน้าของ assembly จะได้ 300 > 100 = ย้อนแย้งทันที
// ซึ่งเป็นอาการที่ใบนี้กันไว้ · ตามสายจริง assembly เทียบกับ winding (300 < 800) จึงปกติ

const { test, expect } = require('@playwright/test');
const { patchAppSource } = require('./app-source');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

const daysAgo = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ORDER = { id: 'PO-1|PN-1', week: 'WK 37', poNo: 'PO-1', pn: 'PN-1', subName: 'TUE-U', orderQty: 1000,
  orderDate: daysAgo(10), status: 'active', importedAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z', _dirty: false };
const rec = (id, process, qty) => ({ id, date: daysAgo(5), orderId: ORDER.id, process, qty, note: '',
  deviceName: 't', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
  voided: false, _dirty: false });

const RECORDS = [rec('r1', 'winding', 800), rec('r2', 'repair', 100), rec('r3', 'assembly', 300)];
const OFFSETS = { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28, repair: null };

const STANDALONE = "{id:'repair', label:'งานซ่อม (นับแยก)', short:'ซ่อม', icon:'🛠️', color:'#be185d', defaultOffset:null, standalone:true},";

async function open(page, { records = RECORDS, offsets = OFFSETS, processes = null } = {}) {
  // แทรกขั้นนับแยกในไฟล์ไหนก็ตามที่ DEFAULT_PROCESSES อยู่ — แยกไฟล์แล้วเทสนี้ยังทำงาน (tests/app-source.js)
  const anchor = "{id:'assembly',";
  const patched = await patchAppSource(page, anchor, STANDALONE + '\n  ' + anchor);
  await page.addInitScript(([k, o, r, off, procs]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't', deadlineOffsets: off, processes: procs,
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: [o], records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, ORDER, records, offsets, processes]);
  await page.goto(APP);
  await page.waitForTimeout(300);
  expect(patched(), 'หาแถว assembly ใน DEFAULT_PROCESSES ไม่เจอ — ไม่งั้นเทสนี้ทดสอบแอปที่ไม่มีขั้นนับแยก').toBe(1);
}
const tab = async (page, name) => { await page.click(`.tab-btn[data-tab="${name}"]`); await page.waitForTimeout(200); };

// ── ขั้นนับแยกต้องไม่ถูกนับเป็นส่วนหนึ่งของสายการผลิต ──────────────

test('A3 — ขั้นนับแยกต้องไม่กลายเป็นขั้นก่อนหน้าของขั้นถัดไป', async ({ page }) => {
  await open(page);
  await tab(page, 'entry');
  await page.click('#procBtn-assembly');
  await page.waitForTimeout(200);
  // สะสม assembly = 300 · ขั้นก่อนหน้าตามสายคือ winding (800) จึงไม่เกิน ไม่ต้องขึ้นป้ายเตือน
  // ถ้าเอา repair (100) มาเป็นขั้นก่อนหน้า 300 > 100 จะขึ้นป้ายทันที
  const row = page.locator('#entryTable tbody tr').first();
  expect(await row.locator('.cum').innerText()).toBe('300');
  await expect(row.locator('.badge.amber')).toHaveCount(0);
});

test('A3 — ขั้นนับแยกต้องไม่ทำให้ขึ้น "ข้อมูลย้อนแย้ง"', async ({ page }) => {
  await open(page);
  await tab(page, 'dashboard');
  await expect(page.locator('#wipCards')).not.toContainText('ข้อมูลย้อนแย้ง');
});

test('A3 — ขั้นนับแยกต้องไม่มีการ์ด WIP ค้างหน้าขั้น', async ({ page }) => {
  await open(page);
  await tab(page, 'dashboard');
  await expect(page.locator('#wipCards')).not.toContainText('ค้างหน้า ซ่อม');
  // การ์ดของสายหลักยังครบเหมือนเดิม
  await expect(page.locator('#wipCards')).toContainText('WIP ค้างหน้า Assembly');
});

test('A3 — ตัวกรอง "ค้างอยู่ที่ขั้น" ต้องไม่มีตัวเลือกของขั้นนับแยก', async ({ page }) => {
  await open(page);
  await tab(page, 'dashboard');
  const opts = await page.locator('#dashWipFilter option').evaluateAll(os => os.map(o => o.value));
  expect(opts).not.toContain('repair');
  expect(opts).toContain('assembly');
});

test('A5 — ขั้นนับแยกที่เลยกำหนดแล้ว ต้องไม่ทำให้ใบขึ้นล่าช้า', async ({ page }) => {
  // สายหลักเสร็จหมดยกเว้น shipping ที่ยังไม่ถึงกำหนด · repair คีย์ไว้ 500 จาก 1000 และเลยกำหนดไปแล้ว
  // ถ้า repair ถูกนับในลูปตัดสินล่าช้า ใบนี้จะขึ้น "ล่าช้า ซ่อม" ทั้งที่ยอดของมันไม่เกี่ยวกับ orderQty
  await open(page, {
    records: [rec('r1', 'winding', 1000), rec('r2', 'assembly', 1000), rec('r3', 'support', 1000),
      rec('r4', 'inspection', 1000), rec('r5', 'shipping', 999), rec('r6', 'repair', 500)],
    offsets: { winding: 10, assembly: 17, support: 20, inspection: 24, shipping: 28, repair: 1 }
  });
  await tab(page, 'dashboard');
  const body = page.locator('#dashTable tbody');
  await expect(body).not.toContainText('ล่าช้า ซ่อม');
  await expect(body).toContainText('กำลังดำเนินการ');
});

// ── สิ่งที่ขั้นนับแยกยังต้องได้เหมือนขั้นอื่น ────────────────────────

test('ขั้นนับแยกยังคีย์ยอดได้และยอดสะสมถูกต้อง', async ({ page }) => {
  await open(page);
  await tab(page, 'entry');
  await page.click('#procBtn-repair');
  await page.waitForTimeout(200);
  await expect(page.locator('#entryTable thead')).toContainText('สะสม งานซ่อม (นับแยก)');
  expect(await page.locator('#entryTable tbody tr').first().locator('.cum').innerText()).toBe('100');
});

test('ขั้นนับแยกยังมีช่องตั้งวันกำหนด (เจ้าของสั่งให้เผื่อไว้ 20 ก.ย. 2026)', async ({ page }) => {
  await open(page);
  await tab(page, 'data');
  await expect(page.locator('#off-repair')).toHaveCount(1);
});

test('ขั้นนับแยกต้องไม่ถูกเตือนว่าเป็นขั้นที่ไม่รู้จัก', async ({ page }) => {
  await open(page);
  await expect(page.locator('#unknownProcessWarn')).toBeHidden();
});

// ── ธงนับแยกต้องรอดจากรายการขั้นที่ซิงค์มา ──────────────────────────

test('A3 — ธงนับแยกที่ซิงค์มาจากเซิร์ฟเวอร์ต้องไม่หายไประหว่าง composeProcesses', async ({ page }) => {
  // ขั้นที่ไม่ได้อยู่ใน DEFAULT_PROCESSES — เส้นทางจริงของขั้นที่ผู้ใช้เพิ่มเองแล้วซิงค์มา
  await open(page, {
    records: [rec('r1', 'winding', 800), rec('r2', 'extra', 900), rec('r3', 'assembly', 300)],
    processes: [
      { id: 'winding', label: 'Winding/Trimming', short: 'Winding' },
      { id: 'extra', label: 'งานนอกแผน', short: 'นอกแผน', standalone: true },
      { id: 'assembly', label: 'Assembly', short: 'Assembly' },
      { id: 'support', label: 'Support', short: 'Support' },
      { id: 'inspection', label: 'Inspection', short: 'Inspection' },
      { id: 'shipping', label: 'ส่งของ (Shipping)', short: 'Shipping' }
    ]
  });
  await tab(page, 'dashboard');
  // ยอด extra (900) มากกว่า winding (800) — ถ้าธงหายไป มันจะถูกนับเป็นขั้นในสายแล้วขึ้นย้อนแย้ง
  await expect(page.locator('#wipCards')).not.toContainText('ข้อมูลย้อนแย้ง');
  await expect(page.locator('#wipCards')).not.toContainText('ค้างหน้า นอกแผน');
  const opts = await page.locator('#dashWipFilter option').evaluateAll(os => os.map(o => o.value));
  expect(opts).not.toContain('extra');
});
