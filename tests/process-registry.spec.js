// รายการขั้นการผลิตมีที่เดียว — เพิ่มหนึ่งแถวใน DEFAULT_PROCESSES แล้วทุกหน้าต้องตามเอง (INVARIANTS A3)
//
// เจ้าของสั่ง 12 ก.ย. 2026 ให้เพิ่มขั้นได้จากในโปรแกรม · ใบนี้ย้ายทุกจุดมาอ่านจากรายการเดียว
// เทสไม่ได้แก้ไฟล์จริง — ดักไฟล์ตอนเบราว์เซอร์โหลด แล้วแทรกขั้นทดสอบระหว่าง Winding กับ Assembly
// (ตำแหน่งเดียวกับขั้นที่ผู้ใช้ขอเพิ่มจริง) แล้วไล่ดูว่าโผล่ครบทุกที่และคิดยอดถูก
//
// ⚠️ เทสกลุ่มท้ายไฟล์ไม่แทรกขั้น — คุมว่าหน้าตาของห้าขั้นเดิมยังเหมือนเดิมทุกตัวอักษร

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const APP = '/production_plan_tracker.html';
const APP_FILE = path.join(__dirname, '..', 'production_plan_tracker.html');
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
const RECORDS = [rec('r1', 'winding', 800), rec('r2', 'coating', 500), rec('r3', 'assembly', 300)];
const OFFSETS = { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 };

const EXTRA = "{id:'coating', label:'Coating ทดสอบ', short:'Coating', icon:'🧪', color:'#be185d', defaultOffset:null},";

async function open(page, { extra = true, offsets = OFFSETS, records = RECORDS } = {}) {
  if (extra) {
    await page.route(/production_plan_tracker\.html/, async route => {
      const res = await route.fetch();
      const body = await res.text();
      const anchor = "{id:'assembly',";
      if (!body.includes(anchor)) throw new Error('หาแถว assembly ใน DEFAULT_PROCESSES ไม่เจอ');
      await route.fulfill({ response: res, body: body.replace(anchor, EXTRA + '\n  ' + anchor) });
    });
  }
  await page.addInitScript(([k, o, r, off]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't', deadlineOffsets: off,
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: [o], records: r, deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, ORDER, records, offsets]);
  await page.goto(APP);
  await page.waitForTimeout(300);
}
const tab = async (page, name) => { await page.click(`.tab-btn[data-tab="${name}"]`); await page.waitForTimeout(200); };
const readState = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), K_STATE);

// ── แทรกขั้นทดสอบแล้วต้องโผล่ครบทุกที่ ─────────────────────────────

test('ขั้นที่เพิ่มต้องไม่ถูกเตือนว่าไม่รู้จัก', async ({ page }) => {
  await open(page);
  await expect(page.locator('#unknownProcessWarn')).toBeHidden();
});

test('หน้าบันทึกยอด — มีปุ่มของขั้นที่เพิ่ม อยู่ถัดจาก Winding และคีย์ยอดได้', async ({ page }) => {
  await open(page);
  await tab(page, 'entry');
  const order = await page.locator('#procButtons button').evaluateAll(bs => bs.map(b => b.dataset.proc));
  expect(order).toEqual(['winding', 'coating', 'assembly', 'support', 'inspection', 'shipping']);

  await page.click('#procBtn-coating');
  await page.waitForTimeout(200);
  await expect(page.locator('#entryTable thead')).toContainText('สะสม Coating ทดสอบ');
  expect(await page.locator('#entryTable tbody tr').first().locator('.cum').innerText()).toBe('500');

  const input = page.locator(`#entryTable input.row-input[data-order="${ORDER.id}"]`);
  await input.fill('50'); await input.press('Tab'); await page.waitForTimeout(200);
  const saved = (await readState(page)).records.filter(r => r.process === 'coating' && !r.voided);
  expect(saved.map(r => r.qty).sort(), 'ยอดใหม่ต้องถูกเก็บเป็นขั้น coating').toContain(50);
});

test('Dashboard — มีคอลัมน์ของขั้นที่เพิ่มในลำดับที่ถูก และตัวเลขถูก', async ({ page }) => {
  await open(page);
  await tab(page, 'dashboard');
  const heads = (await page.locator('#dashTable thead th').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  const iW = heads.indexOf('Winding');
  expect(heads[iW + 1], 'ถัดจาก Winding').toBe('Coating');
  expect(heads[iW + 2]).toBe('Assembly');
  const cells = page.locator('#dashTable tbody tr').first().locator('td');
  expect(await cells.count(), 'หัวกับแถวต้องมีคอลัมน์เท่ากัน').toBe(heads.length);
  expect(await cells.nth(iW + 1).innerText()).toContain('500/1,000');
});

test('การ์ด WIP — ค้างหน้าขั้นที่เพิ่ม และค้างหน้าขั้นถัดไป คิดจากขั้นที่เพิ่ม', async ({ page }) => {
  // Winding 800 · Coating 500 · Assembly 300 → ค้างหน้า Coating 300 · ค้างหน้า Assembly 200
  await open(page);
  await tab(page, 'dashboard');
  const card = label => page.locator('#wipCards .card', { hasText: label }).locator('.value');
  expect(await card('WIP ค้างหน้า Coating').innerText()).toContain('300');
  expect(await card('WIP ค้างหน้า Assembly').innerText(), 'ต้องหักจาก Coating ไม่ใช่ Winding').toContain('200');
});

test('ตัวกรองค้างอยู่ที่ขั้น — มีขั้นที่เพิ่มและกรองได้', async ({ page }) => {
  await open(page);
  await tab(page, 'dashboard');
  await expect(page.locator('#dashWipFilter option[value="coating"]')).toHaveText('ค้างหน้า Coating');
  await page.selectOption('#dashWipFilter', 'coating');
  await page.waitForTimeout(200);
  await expect(page.locator('#dashTable tbody')).toContainText('PO-1');
});

test('สถานะล่าช้า — รู้จักขั้นที่เพิ่ม', async ({ page }) => {
  // สั่งมา 10 วัน · Coating ครบกำหนดวันที่ 3 และยังทำไม่ครบ · ขั้นปลายน้ำยังไม่ถึงกำหนด
  await open(page, { offsets: { ...OFFSETS, coating: 3 } });
  await tab(page, 'dashboard');
  await expect(page.locator('#dashTable tbody')).toContainText('ล่าช้า Coating');
});

test('ขั้นที่เพิ่มยังไม่มีวันกำหนดส่ง — ต้องไม่ถูกตัดสินว่าล่าช้า (A4)', async ({ page }) => {
  await open(page);
  await tab(page, 'dashboard');
  await expect(page.locator('#dashTable tbody')).not.toContainText('ล่าช้า Coating');
});

test('หน้าตั้งค่า — มีช่องวันของขั้นที่เพิ่ม และกดบันทึกแล้ว key อื่นไม่หาย', async ({ page }) => {
  await open(page, { offsets: { ...OFFSETS, zzz_other_device: 7 } });
  await tab(page, 'data');
  const input = page.locator('#off-coating');
  await expect(input).toHaveAttribute('placeholder', 'ยังไม่กำหนด');
  await expect(input).toHaveValue('');
  await input.fill('5');
  await page.click('#btnSaveSettings');
  await page.waitForTimeout(200);
  const off = (await readState(page)).deadlineOffsets;
  expect(off.coating).toBe(5);
  expect(off.winding, 'ค่าเดิมต้องอยู่').toBe(10);
  expect(off.support, 'ช่องว่างของขั้นที่ยังไม่กำหนดต้องยังเป็น null').toBeNull();
  expect(off.zzz_other_device, 'ค่าของขั้นที่เครื่องนี้ไม่มีช่อง ต้องไม่หายตอนกดบันทึก').toBe(7);
});

test('รายงาน Excel — มีคอลัมน์ของขั้นที่เพิ่มในลำดับที่ถูก', async ({ page }) => {
  await open(page);
  await tab(page, 'data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportExcel')]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await dl.path());
  const head = wb.getWorksheet('สรุป WIP').getRow(1).values.filter(Boolean);
  const at = h => head.indexOf(h);
  expect(at('สะสม Coating')).toBe(at('สะสม Winding') + 1);
  expect(at('WIP หน้า Coating')).toBeGreaterThan(-1);
  expect(at('WIP หน้า Assembly')).toBe(at('WIP หน้า Coating') + 1);
  expect(at('Deadline Coating')).toBe(at('Deadline Winding') + 1);
  const row = wb.getWorksheet('สรุป WIP').getRow(2).values;
  expect(row[head.indexOf('WIP หน้า Coating') + 1], 'Winding 800 − Coating 500').toBe(300);
});

test('กราฟ — คำอธิบายสีมีขั้นที่เพิ่ม', async ({ page }) => {
  await open(page);
  await tab(page, 'dashboard');
  await expect(page.locator('#chartLegend [data-proc="coating"]')).toContainText('Coating ทดสอบ');
});

// ── ขั้นก่อนหน้า กับ ขั้นแรก ต้องไม่ถูกใช้แทนกัน ─────────────────────
//
// ตอนมีห้าขั้นตายตัว สองอย่างนี้เขียนเป็นคู่ชื่อขั้นตรง ๆ · พอเปลี่ยนเป็นวนรายการ
// สับสนระหว่าง "ขั้นก่อนหน้า" (PROCESSES[i-1]) กับ "ขั้นแรก" (PROCESSES[0]) ได้ง่ายที่สุด
// และเทสเดิมไม่มีข้อมูลที่ทำให้สองอย่างนี้ให้ผลต่างกัน

test('ผิดลำดับ — ต้องเทียบกับขั้นก่อนหน้า ไม่ใช่ขั้นแรก', async ({ page }) => {
  // Winding 1,000 · Assembly 600 · Support 800 → Support เกิน Assembly ทั้งที่ยังไม่เกิน Winding
  await open(page, { extra: false, records: [rec('r1', 'winding', 1000), rec('r2', 'assembly', 600), rec('r3', 'support', 800)] });
  await tab(page, 'dashboard');
  await expect(page.locator('#dashTable tbody tr').first(), 'ป้ายในแถว').toContainText('ผิดลำดับ');
  await expect(page.locator('#wipCards'), 'การ์ดสรุป').toContainText('ข้อมูลย้อนแย้ง');
});

test('ตัวกรองยังไม่เริ่มผลิต — ต้องดูจากขั้นแรก ไม่ใช่ขั้นที่สอง', async ({ page }) => {
  // Winding ครบ 1,000 แล้ว แต่ Assembly ยังไม่เริ่ม → ใบนี้เริ่มผลิตแล้ว ต้องไม่อยู่ในกลุ่มยังไม่เริ่ม
  await open(page, { extra: false, records: [rec('r1', 'winding', 1000)] });
  await tab(page, 'dashboard');
  await page.selectOption('#dashWipFilter', 'notStarted');
  await page.waitForTimeout(200);
  await expect(page.locator('#dashTable tbody')).not.toContainText('PO-1');
  await page.selectOption('#dashWipFilter', 'assembly');
  await page.waitForTimeout(200);
  await expect(page.locator('#dashTable tbody'), 'ต้องไปอยู่ที่ค้างหน้า Assembly แทน').toContainText('PO-1');
});

// ── ห้าขั้นเดิม — หน้าตาต้องเหมือนเดิมทุกตัวอักษร ─────────────────────

test('ห้าขั้นเดิม — ปุ่ม ตัวกรอง ช่องตั้งค่า หัวจอ ข้อความเดิมทั้งหมด', async ({ page }) => {
  await open(page, { extra: false, records: [] });
  await expect(page.locator('#processFlow')).toHaveText('Thai Union Electronics — Winding/Trimming → Assembly → Support → Inspection');
  expect(await page.locator('#procButtons button').allInnerTexts())
    .toEqual(['🌀 Winding/Trimming', '🔧 Assembly', '🧩 Support', '🔍 Inspection', '🚚 ส่งของ (Shipping)']);
  expect(await page.locator('#dashWipFilter option').allInnerTexts())
    .toEqual(['ทั้งหมด', 'ยังไม่เริ่มผลิต', 'ค้างหน้า Assembly', 'ค้างหน้า Support', 'ค้างหน้า Inspection', 'รอส่งของ']);
  expect(await page.locator('#offsetFields label').allInnerTexts())
    .toEqual(['Winding/Trimming (+วัน)', 'Assembly (+วัน)', 'Support (+วัน)', 'Inspection (+วัน)', 'กำหนดส่งของ (+วัน)']);
  for (const id of ['offW', 'offA', 'offSup', 'offI', 'offS']) await expect(page.locator('#' + id)).toHaveCount(1);
  await tab(page, 'dashboard');
  const heads = (await page.locator('#dashTable thead th').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  expect(heads.slice(8, 13)).toEqual(['Winding', 'Assembly', 'Support', 'Inspection', 'ส่งของ (Shipping)']);
  const cards = await page.locator('#wipCards .card .label').allInnerTexts();
  expect(cards).toEqual(['ยอดแผนรวม (Order Qty)', 'ยังไม่เริ่มผลิต', 'WIP ค้างหน้า Assembly', 'WIP ค้างหน้า Support',
    'WIP ค้างหน้า Inspection', 'WIP รอส่งของ (เสร็จ Inspection แต่ยังไม่ส่ง)', 'ส่งของแล้ว (Shipped)']);
});

test('ชื่อขั้นต้นน้ำต้องไม่ถูกเขียนตายตัวนอกรายการขั้น', async () => {
  // inspection กับ shipping ล็อกไว้และมีหน้าที่พิเศษ (FG · ใบส่งของ) จึงอ้างตรง ๆ ได้
  // ส่วนขั้นต้นน้ำต้องมาจาก DEFAULT_PROCESSES เท่านั้น ไม่งั้นเพิ่มขั้นแล้วจะมีจุดที่ไม่ตาม
  const src = fs.readFileSync(APP_FILE, 'utf8')
    .replace(/const DEFAULT_PROCESSES = \[[\s\S]*?\r?\n\];/, '');
  const hits = src.split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter(x => x.line.length < 400 && !/^(\/\/|\*|\/\*|<!--)/.test(x.line))
    .filter(x => /['"](winding|assembly|support)['"]|\.(winding|assembly|support)\b|\b(winding|assembly|support)\s*:/.test(x.line));
  expect(hits.map(x => `${x.no}: ${x.line.slice(0, 120)}`), 'ย้ายไปอ่านจาก PROCESSES').toEqual([]);
});
