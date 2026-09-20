// หน้าจัดการขั้นการผลิต — เพิ่ม · เปลี่ยนชื่อ · ซ่อน · รหัสหัวหน้า (INVARIANTS A3)
//
// เจ้าของสั่ง 12 ก.ย. 2026 · ข้อตกลง: ต้องต่อ Google Sheets · ต้องใส่รหัสหัวหน้า
// Inspection กับ ส่งของ ล็อกไว้ท้ายสุด · ลบขั้นไม่ได้ ซ่อนได้อย่างเดียว
//
// หน้าเว็บคุยกับ google-apps-script.gs ตัวจริงที่รันบนชีตปลอม (fake-gs.js) ไม่ใช่คำตอบที่เขียนมือ
// ด่านที่อยู่ฝั่งเซิร์ฟเวอร์ (ห้ามลบขั้น · ลำดับท้ายรายการ) จึงถูกทดสอบไปพร้อมกันทั้งเส้น

const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { loadGs } = require('./fake-gs');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const K_SYNC = 'tue_order_tracker_sync_v1';
// ⚠️ ตัวอักษรไทยกับขีด ไม่มีทางไปโผล่ในค่า hex ของ hash หรือ salt — ตรวจว่ารหัสจริงหลุดไปไหนได้แน่นอน
const PIN = 'หัวหน้า-77';

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
const OFFSETS = { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 };
const DEFAULT_IDS = ['winding', 'assembly', 'support', 'inspection', 'shipping'];

/** รายการขั้นในรูปที่เก็บบนชีต */
const baseList = () => [
  { id: 'winding', label: 'Winding/Trimming', short: 'Winding', hidden: false },
  { id: 'assembly', label: 'Assembly', short: 'Assembly', hidden: false },
  { id: 'support', label: 'Support', short: 'Support', hidden: false },
  { id: 'inspection', label: 'Inspection', short: 'Inspection', hidden: false },
  { id: 'shipping', label: 'ส่งของ (Shipping)', short: 'Shipping', hidden: false }
];
/** เครื่องอื่นเพิ่มขั้น Plating ต่อจาก Winding ไว้แล้ว */
const withOther = () => {
  const l = baseList();
  l.splice(1, 0, { id: 'p_other', label: 'Plating เครื่องอื่น', short: 'Plating', hidden: false, addedBy: 'เครื่องอื่น' });
  return l;
};

const sha = (salt, pin) => crypto.createHash('sha256').update(salt + ':' + pin, 'utf8').digest('hex');
function seedPin(gs, pin = PIN) {
  const salt = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  const r = gs.api.doPushSettings({ processAdmin: { hash: sha(salt, pin), salt, setBy: 'ทดสอบ', setAt: '2026-09-13T00:00:00.000Z' } });
  if (!r.ok) throw new Error(r.error);
}
const serverList = gs => gs.api.doPullSettings().processes;
const serverIds = gs => (serverList(gs) || []).map(p => p.id);

/** ส่งทุกคำขอของหน้าเว็บเข้า doPost ของสคริปต์จริง · net.down = true จำลองเน็ตหลุด */
async function serve(page, gs) {
  const net = { calls: [], down: false };
  await page.route('**/exec', async route => {
    const raw = route.request().postData() || '{}';
    net.calls.push(JSON.parse(raw));
    if (net.down) return route.abort();
    const out = gs.api.doPost({ postData: { contents: raw }, parameter: {} });
    await route.fulfill({ contentType: 'application/json', body: out.body });
  });
  return net;
}

async function open(page, gs, { records = [], sync = true } = {}) {
  const net = await serve(page, gs);
  // ใส่ข้อมูลตั้งต้นครั้งเดียว — เทสที่โหลดหน้าใหม่ต้องเห็นของที่เครื่องเก็บไว้ ไม่ใช่ของตั้งต้น
  await page.addInitScript(([k, sk, st, cfg]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(k, JSON.stringify(st));
    if (cfg) localStorage.setItem(sk, JSON.stringify(cfg));
  }, [K_STATE, K_SYNC, {
    version: 1, deviceName: 'เครื่องทดสอบ', deadlineOffsets: OFFSETS,
    chartPref: { mode: '14', from: '', to: '', hidden: [] },
    orders: [ORDER], records, deliveryNotes: [], deltaWip: [], importHistory: []
  }, sync ? { url: 'https://example.test/exec', token: gs.api.TOKEN, auto: true } : null]);
  await page.goto(APP);
  if (sync) await expect.poll(() => net.calls.some(c => c.action === 'pullSettings')).toBe(true);
  await page.waitForTimeout(300);
  return net;
}

/** ตอบกล่อง confirm/prompt ตามลำดับ — หมดคิวแล้วกดตกลงให้ · false = กดยกเลิก */
function answerDialogs(page, answers = []) {
  const seen = [];
  page.on('dialog', async d => {
    seen.push({ type: d.type(), message: d.message() });
    const a = answers.shift();
    if (a === false) await d.dismiss(); else await d.accept(a);
  });
  return seen;
}

const tab = async (page, name) => { await page.click(`.tab-btn[data-tab="${name}"]`); await page.waitForTimeout(200); };
const readState = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), K_STATE);
const procButtonIds = page => page.locator('#procButtons button').evaluateAll(bs => bs.map(b => b.dataset.proc));

async function unlock(page, pin = PIN) {
  await tab(page, 'data');
  await page.click('#btnProcessUnlock');
  await expect(page.locator('#processPinRow')).toBeVisible();
  await page.fill('#processPin', pin);
  await page.click('#btnProcessPinOk');
}
async function addStep(page, label, short, after) {
  await page.fill('#newProcLabel', label);
  await page.fill('#newProcShort', short);
  await page.selectOption('#newProcAfter', after);
  await page.click('#btnProcessAdd');
}

// ── รหัสหัวหน้า ─────────────────────────────────────────────────────

test('ตั้งรหัสหัวหน้าครั้งแรก — ชีตเก็บแค่ค่าที่เข้ารหัส รหัสจริงไม่ออกจากเครื่อง', async ({ page }) => {
  const gs = loadGs();
  const net = await open(page, gs);
  await tab(page, 'data');
  await expect(page.locator('#processAddRow')).toBeHidden();
  await page.click('#btnProcessUnlock');
  await expect(page.locator('#processPin2Field')).toBeVisible();     // ยังไม่เคยมีรหัส = ให้ตั้งใหม่
  await page.fill('#processPin', PIN);
  await page.fill('#processPin2', PIN);
  await page.click('#btnProcessPinOk');
  await expect(page.locator('#processAddRow')).toBeVisible();

  const admin = gs.api.doPullSettings().processAdmin;
  expect(admin.hash).toBe(sha(admin.salt, PIN));
  expect(admin.salt).toMatch(/^[0-9a-f]{32}$/);
  expect(admin.setBy).toBe('เครื่องทดสอบ');
  expect(JSON.stringify(net.calls)).not.toContain(PIN);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(PIN);
});

test('ตั้งรหัสครั้งแรก — สองช่องไม่ตรงกันต้องไม่ถูกเก็บ', async ({ page }) => {
  const gs = loadGs();
  await open(page, gs);
  await tab(page, 'data');
  await page.click('#btnProcessUnlock');
  await page.fill('#processPin', PIN);
  await page.fill('#processPin2', PIN + 'x');
  await page.click('#btnProcessPinOk');
  await expect(page.locator('#toast')).toContainText('ไม่ตรงกัน');
  await expect(page.locator('#processAddRow')).toBeHidden();
  expect(gs.api.doPullSettings().processAdmin).toBeNull();
});

test('รหัสหัวหน้าผิด — ต้องไม่ปลดล็อก · รหัสถูกจึงแก้ได้', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  await open(page, gs);
  await tab(page, 'data');
  await page.click('#btnProcessUnlock');
  await expect(page.locator('#processPin2Field')).toBeHidden();      // มีรหัสแล้ว = ถามรหัส ไม่ใช่ให้ตั้งทับ
  await page.fill('#processPin', 'ผิด-1234');
  await page.click('#btnProcessPinOk');
  await expect(page.locator('#toast')).toContainText('รหัสหัวหน้าไม่ถูกต้อง');
  await expect(page.locator('#processAddRow')).toBeHidden();
  await expect(page.locator('[data-proc-rename]')).toHaveCount(0);

  await page.fill('#processPin', PIN);
  await page.click('#btnProcessPinOk');
  await expect(page.locator('#processAddRow')).toBeVisible();
  await expect(page.locator('[data-proc-rename="winding"]')).toHaveCount(1);
});

test('เปลี่ยนรหัสหัวหน้า — ต้องใส่รหัสเดิมให้ถูกก่อน แล้วรหัสเดิมใช้ไม่ได้อีก', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  await open(page, gs);
  await unlock(page);
  await page.click('#btnProcessChangePin');
  await expect(page.locator('#processPin2Field')).toBeHidden();      // ถามรหัสเดิมก่อน
  const before = gs.api.doPullSettings().processAdmin.hash;
  await page.fill('#processPin', 'ผิด-0000');
  await page.click('#btnProcessPinOk');
  await expect(page.locator('#toast')).toContainText('ไม่ถูกต้อง');
  await expect(page.locator('#processPin2Field')).toBeHidden();

  await page.fill('#processPin', PIN);
  await page.click('#btnProcessPinOk');
  await expect(page.locator('#processPin2Field')).toBeVisible();
  const NEW = 'ใหม่-4321';
  await page.fill('#processPin', NEW);
  await page.fill('#processPin2', NEW);
  await page.click('#btnProcessPinOk');
  await expect.poll(() => gs.api.doPullSettings().processAdmin.hash).not.toBe(before);
  const admin = gs.api.doPullSettings().processAdmin;
  expect(admin.hash).toBe(sha(admin.salt, NEW));

  await page.click('#btnProcessLock');
  await expect(page.locator('#processAddRow')).toBeHidden();
  await page.click('#btnProcessUnlock');
  await page.fill('#processPin', PIN);
  await page.click('#btnProcessPinOk');
  await expect(page.locator('#toast')).toContainText('ไม่ถูกต้อง');
  await expect(page.locator('#processAddRow')).toBeHidden();
  await page.fill('#processPin', NEW);
  await page.click('#btnProcessPinOk');
  await expect(page.locator('#processAddRow')).toBeVisible();
});

test('ไม่ได้ต่อ Google Sheets — แก้รายการขั้นไม่ได้ และบอกเหตุผล', async ({ page }) => {
  const gs = loadGs();
  await open(page, gs, { sync: false });
  await tab(page, 'data');
  await page.click('#btnProcessUnlock');
  await expect(page.locator('#toast')).toContainText('ต้องเชื่อมต่อ Google Sheets');
  await expect(page.locator('#processPinRow')).toBeHidden();
});

// ── เพิ่ม · เปลี่ยนชื่อ · ซ่อน ────────────────────────────────────────

test('เพิ่มขั้นระหว่าง Winding กับ Assembly — ขึ้นชีต โผล่ทุกที่ทันที และยังอยู่หลังเปิดหน้าใหม่', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  const net = await open(page, gs, { records: [rec('r1', 'winding', 800)] });
  answerDialogs(page);
  await unlock(page);
  await addStep(page, 'Coating ทดสอบ', 'Coating', 'winding');

  await expect.poll(() => serverIds(gs)).toEqual(
    ['winding', expect.stringMatching(/^p[a-z0-9]+$/), 'assembly', 'support', 'inspection', 'shipping']);
  const id = serverIds(gs)[1];
  expect(serverList(gs)[1]).toMatchObject({ label: 'Coating ทดสอบ', short: 'Coating', hidden: false, addedBy: 'เครื่องทดสอบ' });

  await expect(page.locator('#offsetFields input#off-' + id)).toHaveCount(1);
  await expect(page.locator(`#dashWipFilter option[value="${id}"]`)).toHaveCount(1);
  await tab(page, 'entry');
  expect(await procButtonIds(page)).toEqual(['winding', id, 'assembly', 'support', 'inspection', 'shipping']);
  await expect(page.locator('#processFlow')).toContainText('Winding/Trimming → Coating ทดสอบ → Assembly');
  await expect(page.locator('#unknownProcessWarn')).toBeHidden();

  // เปิดใหม่ตอนเน็ตหลุด — ขั้นที่เพิ่มต้องยังอยู่ ไม่งั้นยอดที่คีย์ลงขั้นนั้นหายจากจอจนกว่าเน็ตจะกลับ
  net.down = true;
  await page.reload();
  await page.waitForTimeout(300);
  await tab(page, 'entry');
  await expect(page.locator('#procBtn-' + id)).toBeVisible();
});

test('เครื่องอื่นเพิ่มขั้นไปก่อน — เซิร์ฟเวอร์ปฏิเสธ ขั้นของเครื่องอื่นไม่ถูกทับ และเครื่องนี้เห็นของจริง', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  await open(page, gs);
  answerDialogs(page);
  await unlock(page);
  // หน้านี้เปิดค้างไว้ ระหว่างนั้นอีกเครื่องเพิ่มขั้น
  expect(gs.api.doPushSettings({ processes: withOther() }).ok).toBe(true);

  await addStep(page, 'Coating ทดสอบ', 'Coating', 'winding');
  await expect(page.locator('#toast')).toContainText('ลบขั้นไม่ได้');
  expect(serverIds(gs)).toEqual(withOther().map(p => p.id));
  await expect(page.locator('#processTable')).toContainText('Plating เครื่องอื่น');
  await expect(page.locator('#processTable')).not.toContainText('Coating ทดสอบ');
});

test('เน็ตหลุดตอนบันทึก — ขั้นใหม่ต้องไม่โผล่ในเครื่องนี้ ไม่งั้นยอดจะถูกคีย์ลงขั้นที่เครื่องอื่นไม่รู้จัก', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  const net = await open(page, gs);
  answerDialogs(page);
  await unlock(page);
  net.down = true;
  await addStep(page, 'Coating ทดสอบ', 'Coating', 'winding');
  await expect(page.locator('#toast')).toContainText('บันทึกรายการขั้นไม่สำเร็จ');
  await expect(page.locator('#processTable')).not.toContainText('Coating ทดสอบ');
  await tab(page, 'entry');
  expect(await procButtonIds(page)).toEqual(DEFAULT_IDS);
  expect((await readState(page)).processes).toBeFalsy();
});

test('เปลี่ยนชื่อขั้น — id เดิม ยอดที่คีย์ไว้ยังนับ และชื่อใหม่ขึ้นทุกที่', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  await open(page, gs, { records: [rec('r1', 'winding', 800)] });
  answerDialogs(page, ['Winding ใหม่', 'W-ใหม่']);
  await unlock(page);
  await page.click('[data-proc-rename="winding"]');

  await expect.poll(() => (serverList(gs) || [])[0]?.label).toBe('Winding ใหม่');
  expect(serverList(gs)[0]).toMatchObject({ id: 'winding', short: 'W-ใหม่', updatedBy: 'เครื่องทดสอบ' });
  await tab(page, 'entry');
  await expect(page.locator('#procBtn-winding')).toContainText('Winding ใหม่');
  await expect(page.locator('#entryTable thead')).toContainText('สะสม Winding ใหม่');
  expect(await page.locator('#entryTable tbody tr').first().locator('.cum').innerText()).toBe('800');
  expect((await readState(page)).records[0].process).toBe('winding');
});

test('ซ่อนขั้นที่มียอด — บอกก่อนว่ามียอดค้าง ปุ่มหาย ไม่ขึ้นแถบเตือนขั้นแปลกหน้า และยอดยังอยู่ครบ', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  await open(page, gs, { records: [rec('r1', 'winding', 800), rec('r2', 'assembly', 600), rec('r3', 'support', 300)] });
  const seen = answerDialogs(page);
  await unlock(page);
  await page.click('[data-proc-toggle="support"]');

  await expect(page.locator('[data-proc-row="support"]')).toContainText('ซ่อนอยู่');
  expect(seen[0].message).toContain('1 รายการ');
  expect(serverList(gs).find(p => p.id === 'support').hidden).toBe(true);
  await expect(page.locator('#offSup')).toHaveCount(0);
  await tab(page, 'entry');
  await expect(page.locator('#procBtn-support')).toHaveCount(0);
  await expect(page.locator('#unknownProcessWarn')).toBeHidden();
  expect((await readState(page)).records.map(r => r.process)).toContain('support');

  await tab(page, 'data');
  await page.click('[data-proc-toggle="support"]');
  await expect(page.locator('[data-proc-row="support"]')).toContainText('แสดง');
  await tab(page, 'entry');
  await expect(page.locator('#procBtn-support')).toHaveCount(1);
});

test('Inspection กับ ส่งของ ล็อก — ไม่มีปุ่มแก้ ไม่มีให้แทรกต่อท้าย และข้อมูลบนชีตสั่งซ่อนก็ไม่ทำตาม', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  // ด่านฝั่งเซิร์ฟเวอร์ไม่ได้ตรวจชื่อหรือการซ่อนของสองขั้นนี้ — หน้าจอต้องไม่ทำตามเอง
  const list = baseList();
  Object.assign(list[3], { label: 'ชื่อแปลก', hidden: true });
  expect(gs.api.doPushSettings({ processes: list }).ok).toBe(true);

  await open(page, gs);
  await unlock(page);
  for (const id of ['inspection', 'shipping']) {
    await expect(page.locator(`[data-proc-rename="${id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-proc-toggle="${id}"]`)).toHaveCount(0);
    await expect(page.locator(`#newProcAfter option[value="${id}"]`)).toHaveCount(0);
  }
  await expect(page.locator('[data-proc-row="inspection"]')).toContainText('ล็อก');
  await tab(page, 'entry');
  await expect(page.locator('#procBtn-inspection')).toContainText('Inspection');
  await expect(page.locator('#procBtn-inspection')).not.toContainText('ชื่อแปลก');
});

test('ชื่อขั้นที่มีแท็ก HTML — ขึ้นเป็นตัวหนังสือทุกที่ ไม่ถูกรันเป็นโค้ด', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  await open(page, gs);
  answerDialogs(page);
  await unlock(page);
  await addStep(page, '<img src=x onerror="window.__xss=1">', '<b>XSS</b>', 'winding');
  await expect.poll(() => serverIds(gs).length).toBe(6);
  const id = serverIds(gs)[1];

  for (const t of ['entry', 'dashboard', 'data']) await tab(page, t);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#processTable b')).toHaveCount(0);
  await tab(page, 'entry');
  await expect(page.locator('#procBtn-' + id)).toContainText('<img');
});

// ── ซิงค์รายการขั้นจากเครื่องอื่น ────────────────────────────────────

test('เครื่องอื่นเพิ่มขั้น — เครื่องนี้ใช้ตามหลังซิงค์โดยไม่ต้องเปิดหน้าใหม่ และแถบเตือนขั้นแปลกหน้าหายเอง', async ({ page }) => {
  const gs = loadGs();
  expect(gs.api.doPushSettings({ processes: withOther() }).ok).toBe(true);
  // ยอดของขั้นใหม่ดึงมาถึงเครื่องนี้แล้ว — ก่อนซิงค์รายการขั้น เครื่องนี้ยังไม่รู้จักมัน
  await open(page, gs, { records: [rec('r1', 'winding', 800), rec('r9', 'p_other', 200)] });
  await expect(page.locator('#unknownProcessWarn')).toBeHidden();
  await tab(page, 'entry');
  await expect(page.locator('#procBtn-p_other')).toBeVisible();
  expect((await readState(page)).processes.map(p => p.id)).toEqual(withOther().map(p => p.id));
});

test('เครื่องอื่นซ่อนขั้นที่กำลังคีย์อยู่ — กลับไปขั้นแรก ไม่ค้างอยู่ที่ขั้นที่ไม่มีปุ่มแล้ว', async ({ page }) => {
  const gs = loadGs();
  const net = await open(page, gs, { records: [rec('r1', 'winding', 800)] });
  await tab(page, 'entry');
  await page.click('#procBtn-support');
  const list = baseList();
  list[2].hidden = true;
  expect(gs.api.doPushSettings({ processes: list }).ok).toBe(true);

  const before = net.calls.length;
  await page.click('#syncBadge');
  await expect.poll(() => net.calls.slice(before).some(c => c.action === 'pullSettings')).toBe(true);
  await expect(page.locator('#procBtn-support')).toHaveCount(0);
  await expect(page.locator('#procBtn-winding')).toHaveClass(/primary/);
});

test('รายการขั้นบนชีตรูปผิด — ไม่ถูกใช้และไม่ถูกเก็บ เครื่องยังใช้ห้าขั้นเดิม', async ({ page }) => {
  const gs = loadGs();
  // เขียนลง Meta ตรง ๆ ข้ามด่านของ pushSettings — จำลองคนแก้ชีตด้วยมือ
  gs.api.meta('processes', JSON.stringify([
    { id: 'winding', label: 'Winding' }, { id: 'shipping', label: 'ส่งของ' }, { id: 'inspection', label: 'Inspection' }]));
  await open(page, gs);
  await tab(page, 'entry');
  expect(await procButtonIds(page)).toEqual(DEFAULT_IDS);
  expect((await readState(page)).processes).toBeFalsy();
});

// ── ธงขั้นนับแยกต้องรอดขา push (ผู้ตรวจ PR #94 จับได้) ──────────────

test('A3 — กดเปลี่ยนชื่อขั้นอื่น ต้องไม่ทำให้ธงขั้นนับแยกหายจากเซิร์ฟเวอร์', async ({ page }) => {
  // เส้นทางจริง: เจ้าของสร้างขั้นนับแยกบนชีต (ตอนนี้เป็นทางเดียว) แล้ววันหลังมีคนกดเปลี่ยนชื่อขั้นไหนก็ได้
  // saveProcessList() ประกอบรายการทั้งก้อนใหม่ผ่าน storedProcessList() แล้ว push ทับ Meta
  // ถ้าฟังก์ชันนั้นไม่พกธงไปด้วย ขั้นนับแยกจะกลับเข้าสายหลักทุกเครื่อง แล้วทุกใบขึ้นล่าช้า
  const gs = loadGs();
  const list = baseList();
  list.splice(1, 0, { id: 'p_repair', label: 'งานซ่อม', short: 'ซ่อม', hidden: false, standalone: true });
  const seeded = gs.api.doPushSettings({ processes: list });
  if (!seeded.ok) throw new Error(seeded.error);
  seedPin(gs);

  await open(page, gs);
  expect(serverList(gs).find(p => p.id === 'p_repair').standalone).toBe(true);

  await unlock(page);
  answerDialogs(page, ['Assembly ชื่อใหม่']);
  await page.click('[data-proc-rename="assembly"]');
  await expect.poll(() => (serverList(gs).find(p => p.id === 'assembly') || {}).label).toBe('Assembly ชื่อใหม่');

  // ธงต้องยังอยู่ทั้งบนเซิร์ฟเวอร์และในเครื่อง
  expect(serverList(gs).find(p => p.id === 'p_repair').standalone).toBe(true);
  const st = await readState(page);
  expect(st.processes.find(p => p.id === 'p_repair').standalone).toBe(true);

  // และยังทำงานเป็นขั้นนับแยกจริง ไม่ใช่แค่มีฟิลด์ค้างไว้
  await tab(page, 'dashboard');
  const opts = await page.locator('#dashWipFilter option').evaluateAll(os => os.map(o => o.value));
  expect(opts).not.toContain('p_repair');
});

// ── ติ๊ก "นับแยก" ตอนเพิ่มขั้น (ใบ 2) ────────────────────────────────

test('A3 — ติ๊กนับแยกแล้วเพิ่มขั้น ธงต้องขึ้นชีตและขั้นนั้นต้องอยู่นอกสายการผลิตจริง', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  await open(page, gs, { records: [rec('r1', 'winding', 800), rec('r2', 'assembly', 300)] });
  await unlock(page);
  answerDialogs(page);
  await page.check('#newProcStandalone');
  await addStep(page, 'งานซ่อม', 'ซ่อม', 'winding');
  await expect.poll(() => serverIds(gs).length).toBe(6);

  const added = serverList(gs).find(p => p.label === 'งานซ่อม');
  expect(added.standalone).toBe(true);

  // อยู่นอกสายจริง ไม่ใช่แค่มีฟิลด์ — ไม่มีการ์ด WIP และไม่อยู่ในตัวกรอง "ค้างอยู่ที่ขั้น"
  await tab(page, 'dashboard');
  await expect(page.locator('#wipCards')).not.toContainText('ค้างหน้า ซ่อม');
  const opts = await page.locator('#dashWipFilter option').evaluateAll(os => os.map(o => o.value));
  expect(opts).not.toContain(added.id);
  // ขั้นที่ตามหลังมันต้องข้ามไปเทียบกับ Winding (800) ไม่ใช่ขั้นนับแยก (0)
  await expect(page.locator('#wipCards')).toContainText('WIP ค้างหน้า Assembly');
  await expect(page.locator('#wipCards')).not.toContainText('ข้อมูลย้อนแย้ง');
});

test('A3 — ไม่ติ๊ก = ขั้นในสายการผลิตตามเดิม ไม่มีธงติดไปด้วย', async ({ page }) => {
  const gs = loadGs();
  seedPin(gs);
  await open(page, gs);
  await unlock(page);
  answerDialogs(page);
  await addStep(page, 'Plating', 'Plating', 'winding');
  await expect.poll(() => serverIds(gs).length).toBe(6);

  const added = serverList(gs).find(p => p.label === 'Plating');
  expect(added.standalone).toBeUndefined();
  await tab(page, 'dashboard');
  const opts = await page.locator('#dashWipFilter option').evaluateAll(os => os.map(o => o.value));
  expect(opts).toContain(added.id);
});

test('ตารางจัดการขั้นต้องมีป้าย "นับแยก" บอกว่าขั้นไหนไม่อยู่ในสายการผลิต', async ({ page }) => {
  const gs = loadGs();
  const list = baseList();
  list.splice(1, 0, { id: 'p_repair', label: 'งานซ่อม', short: 'ซ่อม', hidden: false, standalone: true });
  const r = gs.api.doPushSettings({ processes: list });
  if (!r.ok) throw new Error(r.error);
  seedPin(gs);
  await open(page, gs);
  await tab(page, 'data');
  await expect(page.locator('[data-proc-row="p_repair"]')).toContainText('นับแยก');
  // ขั้นสายหลักต้องไม่มีป้ายนี้ติดมาด้วย
  await expect(page.locator('[data-proc-row="assembly"]')).not.toContainText('นับแยก');
});

test('A3 — ซ่อนขั้นสายหลักจนเหลือขั้นนับแยกอย่างเดียวไม่ได้', async ({ page }) => {
  // ด่าน "ต้องเหลือขั้นผลิตอย่างน้อยหนึ่งขั้น" ต้องนับเฉพาะขั้นในสายการผลิต
  // ถ้านับขั้นนับแยกด้วย จะซ่อน winding/assembly/support ได้หมดโดยเหลือแต่งานซ่อม
  // ซึ่งแปลว่าไม่มีขั้นไหนป้อนยอดเข้าสายให้ Inspection อีกเลย
  const gs = loadGs();
  const list = baseList();
  list.splice(1, 0, { id: 'p_repair', label: 'งานซ่อม', short: 'ซ่อม', hidden: false, standalone: true });
  const r = gs.api.doPushSettings({ processes: list });
  if (!r.ok) throw new Error(r.error);
  seedPin(gs);
  await open(page, gs);
  await unlock(page);
  answerDialogs(page);

  for (const id of ['winding', 'assembly']) {
    await page.click(`[data-proc-toggle="${id}"]`);
    await expect.poll(() => (serverList(gs).find(p => p.id === id) || {}).hidden).toBe(true);
  }
  // เหลือ support ขั้นเดียวในสายหลัก — กดซ่อนต่อต้องถูกปฏิเสธ
  await page.click('[data-proc-toggle="support"]');
  await expect(page.locator('#toast')).toContainText('ต้องเหลือขั้นผลิตที่แสดงอยู่อย่างน้อยหนึ่งขั้น');
  expect(serverList(gs).find(p => p.id === 'support').hidden).toBe(false);

  // แต่ซ่อนขั้นนับแยกยังต้องทำได้ เพราะไม่ได้ลดจำนวนขั้นผลิตลงเลย
  await page.click('[data-proc-toggle="p_repair"]');
  await expect.poll(() => (serverList(gs).find(p => p.id === 'p_repair') || {}).hidden).toBe(true);
});

test('ขั้นนับแยกที่เป็นขั้นแรก ต้องไม่กลายเป็นปุ่มตั้งต้นของหน้าคีย์ยอด', async ({ page }) => {
  // ⚠️ ต้องซ่อน winding ด้วย ไม่งั้นเทสนี้ไม่ได้ทดสอบอะไรเลย —
  //    currentProcess ตั้งต้นเป็น winding อยู่แล้ว และจะถูกตั้งใหม่ก็ต่อเมื่อขั้นนั้นหายจาก PROCESSES
  //    เส้นทางที่ต้องคุมคือ "ตกกลับ" ซึ่งเข้าได้เมื่อขั้นที่ค้างอยู่ถูกซ่อนเท่านั้น
  const gs = loadGs();
  const list = baseList();
  list[0].hidden = true;
  list.unshift({ id: 'p_repair', label: 'งานซ่อม', short: 'ซ่อม', hidden: false, standalone: true });
  const r = gs.api.doPushSettings({ processes: list });
  if (!r.ok) throw new Error(r.error);
  await open(page, gs);
  await tab(page, 'entry');
  // ปุ่มยังมีขั้นนับแยกอยู่ (เลือกเองได้) แต่ตัวที่ถูกเลือกไว้ต้องเป็นขั้นแรกของสายการผลิต
  expect(await procButtonIds(page)).toEqual(['p_repair', 'assembly', 'support', 'inspection', 'shipping']);
  const active = await page.locator('#procButtons button.primary').getAttribute('data-proc');
  expect(active).toBe('assembly');
  // บรรทัดลูกศรสายการผลิตต้องไม่มีขั้นนับแยก
  await expect(page.locator('#processFlow')).not.toContainText('งานซ่อม');
  await expect(page.locator('#processFlow')).toContainText('Assembly');
});
