// ที่เก็บข้อมูลในเครื่อง — IndexedDB แทน localStorage (9 ต.ค. 2026)
//
// ที่มา: localStorage ของเครื่องหน้างานเต็มจริง (เพดานราว 5 MB) ยอดที่คีย์สะสมทุกวันจึงบันทึกลงเครื่องไม่ได้
// เทสชุดนี้คุมห้าเรื่องที่การย้ายที่เก็บต้องไม่พัง
//   1. เครื่องที่มีข้อมูลเดิม เปิดรุ่นใหม่ครั้งแรกแล้วข้อมูลต้องย้ายมาครบ (E1 · E2)
//   2. ข้อมูลเกินเพดานเดิมต้องบันทึกได้ — ปัญหาจริงที่ทำให้ต้องมีใบนี้
//   3. ข้อมูลอยู่สองที่ (แท็บรุ่นเก่ายังเปิดค้าง) ต้องไม่ทำของหาย
//   4. ซิงค์ตอนเปิดหน้าต้องรอข้อมูลโหลดเสร็จ ไม่งั้นรอบแรกจะซิงค์ state ว่าง (D3 · D7)
//   5. เครื่องที่ย้ายแล้วเปิด IndexedDB ไม่ได้ ต้องบังจอ ไม่ใช่เปิดหน้าว่างให้คีย์ทับ (E3) · ลบข้อมูลทั้งหมดต้องลบสำเนาด้วย

const { test, expect } = require('@playwright/test');
const { IDB_NAME, IDB_STORE, readSaved, waitReady } = require('./app-state');
const { patchAppSource } = require('./app-source');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const K_SYNC = 'tue_order_tracker_sync_v1';
const BACKUP = K_STATE + ':localStorage';

const ORDER = { id: 'O1', week: 'W31', poNo: 'PO-1', pn: 'PN-1', orderQty: 1000, orderDate: '2026-08-01',
  status: 'active', subName: 'TUE-U', importedAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false };
const rec = (id, qty, extra = {}) => Object.assign({ id, date: '2026-08-20', orderId: 'O1', process: 'winding',
  qty, note: '', deviceName: 't', createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z', voided: false, _dirty: false }, extra);
const legacy = records => ({ version: 1, deviceName: 't', orders: [ORDER], records,
  deliveryNotes: [], deltaWip: [], importHistory: [] });

/** ใส่ข้อมูลเดิมใน localStorage ครั้งเดียว ไม่ใส่ซ้ำตอนรีโหลด — แทนเครื่องจริงที่ใช้รุ่นเก่ามาก่อน */
async function seedOnce(page, st, sync = null) {
  await page.addInitScript(([k, s, sk, sy]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(k, s);
    if (sy) localStorage.setItem(sk, sy);
  }, [K_STATE, JSON.stringify(st), K_SYNC, sync && JSON.stringify(sync)]);
}

const lsItem = (page, k) => page.evaluate(key => localStorage.getItem(key), k);

async function keyQty(page, qty) {
  await page.click('.tab-btn[data-tab="entry"]');
  await page.click('#procBtn-winding');
  await page.fill('#entryDate', '2026-08-29');
  await page.waitForTimeout(100);
  const input = page.locator('#entryTable input.row-input[data-order="O1"]');
  await input.fill(String(qty));
  await input.press('Tab');
  await page.waitForTimeout(300);
}

test('E1 · E2 — เปิดรุ่นใหม่ครั้งแรก ข้อมูลเดิมใน localStorage ต้องย้ายไป IndexedDB ครบ แล้วคืนพื้นที่', async ({ page }) => {
  const st = legacy([rec('R1', 10), rec('R2', 20)]);
  await seedOnce(page, st);
  await page.goto(APP);

  const saved = await readSaved(page, K_STATE);
  expect(saved.records.map(r => r.id), 'ยอดเดิมต้องย้ายมาครบ').toEqual(['R1', 'R2']);
  expect(saved.orders.map(o => o.id)).toEqual(['O1']);
  expect(await lsItem(page, K_STATE), 'ย้ายแล้วต้องลบจาก localStorage เพื่อคืนพื้นที่').toBeNull();
  expect(await readSaved(page, BACKUP, { raw: true }), 'ต้องเก็บสำเนาดิบของเดิมไว้ใน IndexedDB ด้วย')
    .toBe(JSON.stringify(st));

  await page.reload();
  expect((await readSaved(page, K_STATE)).records.map(r => r.id), 'ข้อมูลต้องรอดการเปิดหน้าใหม่')
    .toEqual(['R1', 'R2']);
});

test('ข้อมูลเกินเพดานของ localStorage ต้องบันทึกได้ และไม่ขึ้นเตือนพื้นที่เต็ม', async ({ page }) => {
  await seedOnce(page, legacy([]));
  await page.goto(APP);
  await waitReady(page);

  // ประวัติยอดที่ยกเลิกแล้วจำนวนมาก — เครื่องที่ใช้มานานจนชนเพดาน (ใส่ตรงเข้า IndexedDB เพราะ localStorage รับไม่ไหว)
  const big = legacy(Array.from({ length: 25000 }, (_, i) =>
    rec('OLD' + i, 1, { orderId: 'GONE' + i, voided: true, note: 'x'.repeat(200) })));
  const json = JSON.stringify(big);
  expect(json.length, 'ข้อมูลทดสอบต้องเกินเพดานของ localStorage จริง').toBeGreaterThan(6_000_000);
  await page.evaluate(([db, store, k, v]) => new Promise((ok, fail) => {
    const r = indexedDB.open(db);
    r.onerror = () => fail(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction(store, 'readwrite');
      tx.objectStore(store).put(v, k);
      tx.oncomplete = () => { r.result.close(); ok(); };
      tx.onerror = () => fail(tx.error);
    };
  }), [IDB_NAME, IDB_STORE, K_STATE, json]);

  await page.reload();
  await waitReady(page);
  await keyQty(page, 7);

  await expect(page.locator('#toast'), 'ต้องไม่ขึ้นเตือนว่าพื้นที่เต็ม').not.toContainText('พื้นที่เก็บข้อมูล');
  const raw = await readSaved(page, K_STATE, { raw: true });
  expect(raw.length, 'สิ่งที่บันทึกต้องใหญ่กว่าเพดานเดิมจริง').toBeGreaterThan(6_000_000);
  expect(JSON.parse(raw).records.some(r => r.date === '2026-08-29' && r.qty === 7), 'ยอดที่เพิ่งคีย์ต้องถูกบันทึก')
    .toBe(true);
});

test('ข้อมูลอยู่สองที่ (แท็บรุ่นเก่ายังเขียน localStorage) — IndexedDB ชนะ แต่ของใน localStorage ต้องไม่หาย', async ({ page }) => {
  await seedOnce(page, legacy([rec('R1', 10)]));
  await page.goto(APP);
  await waitReady(page);

  const stale = JSON.stringify(legacy([rec('STALE', 99)]));
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [K_STATE, stale]);
  await page.reload();

  expect((await readSaved(page, K_STATE)).records.map(r => r.id), 'ของใน IndexedDB ต้องเป็นตัวหลัก')
    .toEqual(['R1']);
  expect(await readSaved(page, BACKUP, { raw: true }), 'ของจากแท็บรุ่นเก่าต้องถูกเก็บเป็นสำเนา ไม่ใช่ทิ้ง')
    .toBe(stale);
  expect(await lsItem(page, K_STATE), 'และต้องคืนพื้นที่ localStorage').toBeNull();
});

test('D3 · D7 — ซิงค์ตอนเปิดหน้าต้องรอข้อมูลโหลดเสร็จ ยอดที่ยังไม่ได้ส่งต้องถูกส่งในรอบแรก', async ({ page }) => {
  // ถ้าซิงค์เริ่มก่อนโหลดเสร็จ รอบแรกจะส่ง state ว่างขึ้นไป แล้วนาฬิกาซิงค์เดินไปทั้งที่ยังไม่ได้ส่งของจริง
  // ยอดที่ค้างส่งจะรอไปอีกรอบ (20 วินาที) — และของที่ดึงลงมาในรอบนั้นจะถูกทับด้วย state ที่โหลดทีหลัง
  const pushed = [];
  await page.route('**/exec', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action === 'pushRows') (body.rows || []).forEach(r => pushed.push(body.table + ':' + r.id));
    await route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ ok: true, rows: [], serverTime: '2026-08-26T00:00:00.000Z' }) });
  });
  await seedOnce(page, legacy([rec('R1', 10, { _dirty: true })]),
    { url: 'https://example.test/exec', token: 't', auto: true });
  await page.goto(APP);

  await expect.poll(() => pushed, { timeout: 5000, message: 'ยอดที่ค้างส่งต้องขึ้นไปในรอบซิงค์แรก' })
    .toContain('Records:R1');
});

test('E3 — เครื่องที่ย้ายแล้ว วันหนึ่งเปิด IndexedDB ไม่ได้ ต้องบังจอห้ามคีย์ ไม่ใช่เปิดหน้าว่างให้คีย์ทับ', async ({ page }) => {
  // localStorage ของเครื่องที่ย้ายแล้วว่าง ถ้ากลับไปใช้ localStorage แบบเดิม จอจะว่างโดยไม่มีอะไรเตือน
  // คนจะนำเข้าแผนใหม่แล้วคีย์ยอดทั้งวัน แล้วพอ IndexedDB กลับมา ของวันนั้นหายทั้งก้อน (ผู้ตรวจ #99)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('breakIdb')) {
      IDBFactory.prototype.open = function () { throw new DOMException('เปิดไม่ได้', 'UnknownError'); };
    }
  });
  await seedOnce(page, legacy([rec('R1', 10)]));
  await page.goto(APP);
  await waitReady(page);
  expect(await lsItem(page, K_STATE + ':moved'), 'ย้ายเสร็จต้องทิ้งธงไว้ใน localStorage').toBe('1');

  await page.evaluate(() => sessionStorage.setItem('breakIdb', '1'));
  await page.reload();
  await expect(page.locator('#storageLocked'), 'ต้องบอกตรง ๆ ว่าห้ามคีย์').toContainText('ห้ามคีย์ยอด');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.dataset.stateReady), 'ต้องไม่เปิดให้บันทึกหรือซิงค์')
    .toBeUndefined();
  expect(await lsItem(page, K_STATE), 'ต้องไม่เขียน state ว่างลง localStorage').toBeNull();

  await page.evaluate(() => sessionStorage.removeItem('breakIdb'));
  await page.reload();
  await waitReady(page);
  await expect(page.locator('#storageLocked')).toHaveCount(0);
  expect((await readSaved(page, K_STATE)).records.map(r => r.id), 'ข้อมูลเดิมต้องยังอยู่ครบ').toEqual(['R1']);
});

test('ลบข้อมูลทั้งหมด ต้องลบสำเนาดิบที่เก็บไว้ตอนย้ายด้วย — กล่องยืนยันบอกว่าย้อนกลับไม่ได้', async ({ page }) => {
  await seedOnce(page, legacy([rec('R1', 10)]));
  await page.goto(APP);
  await waitReady(page);
  expect(await readSaved(page, BACKUP, { raw: true }), 'ก่อนลบต้องมีสำเนาอยู่จริง').not.toBeNull();

  page.on('dialog', d => d.accept());
  await page.click('.tab-btn[data-tab="data"]');
  await page.click('#btnClearAll');

  await expect.poll(() => readSaved(page, BACKUP, { raw: true }), { message: 'สำเนาดิบต้องถูกลบ' }).toBeNull();
  expect((await readSaved(page, K_STATE)).records, 'ข้อมูลหลักต้องว่าง').toEqual([]);
});

test('วาดจอตอนเปิดหน้าพัง (ข้อมูลจริงมีค่าแปลก) — จอต้องไม่ค้างจางกดไม่ได้ และต้องบอกผู้ใช้', async ({ page }) => {
  // ระหว่างรอโหลด จอถูกทำให้จางและกดไม่ได้ · ถ้าวาดจอพังแล้วไม่มีใครปลด ทั้งหน้าจะค้างโดยไม่มีข้อความ (ผู้ตรวจ #99)
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const patched = await patchAppSource(page, 'function renderAll(){',
    "function renderAll(){ if(!window.__boomed){ window.__boomed = 1; throw new Error('จำลองวาดจอพัง'); }");
  await seedOnce(page, legacy([rec('R1', 10)]));
  await page.goto(APP);
  await waitReady(page);

  expect(patched(), 'หา renderAll ไม่เจอ — เทสนี้ไม่ได้จำลองอะไร').toBe(1);
  expect(errors.join(), 'error ต้องยังหลุดออกมาให้เห็น ไม่ถูกกลืน').toContain('จำลองวาดจอพัง');
  await expect(page.locator('#toast'), 'ต้องบอกผู้ใช้').toContainText('เปิดหน้าไม่สมบูรณ์');
  expect(await page.locator('main').evaluate(m => getComputedStyle(m).pointerEvents), 'จอต้องกดได้').not.toBe('none');
  await page.click('.tab-btn[data-tab="entry"]');
  await page.click('#procBtn-winding');   // คลิกใน main ได้จริง
});
