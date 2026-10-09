// เทสชั้นข้อมูลของใบส่งสินค้า — ยังไม่มีหน้าจอในก้อนนี้
//
// ก้อนนี้แตะสิ่งที่กู้คืนไม่ได้ถ้าพลาด: โครงสร้างข้อมูลในเครื่องพนักงาน (INVARIANTS E)
// และ contract กับ Google Apps Script ที่เจ้าของต้อง re-deploy เอง
// จึงต้องพิสูจน์ก่อนว่า "ของเดิมที่มีอยู่ในเครื่องแล้วไม่พัง" ก่อนจะมีหน้าจอให้ใครกด

const { test, expect } = require('@playwright/test');
const { readSaved, forgetSavedOnEveryLoad, waitReady } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const K_SYNC = 'tue_order_tracker_sync_v1';

/** state รุ่นก่อนที่จะมีใบส่งสินค้า — ไม่มีคีย์ deliveryNotes เลย */
function oldState(extra = {}) {
  return Object.assign({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: [{ id: 'O1', week: 'W31', poNo: 'PO-1', pn: 'PN-1', orderQty: 100,
               orderDate: '2026-08-01', status: 'active',
               importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false }],
    records: [], importHistory: []
  }, extra);
}

async function open(page, st, init) {
  // หว่านใหม่ทุกครั้งที่หน้าโหลด = ล้างของที่บันทึกไว้ด้วย (เดิม localStorage ทับให้เอง · ตอนนี้ของที่บันทึกอยู่ใน IndexedDB)
  await forgetSavedOnEveryLoad(page);
  await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [K_STATE, st]);
  if (init) await page.addInitScript(init);
  await page.goto(APP);
  await waitReady(page);
  await page.waitForSelector('.tab-btn[data-tab="entry"]');
}

const readState = page => readSaved(page, K_STATE);   // อ่านจาก IndexedDB (tests/app-state.js)

/** แอปไม่เขียน localStorage กลับตอนเปิดถ้าไม่มีอะไรเปลี่ยน
 *  จะตรวจสิ่งที่ loadState() เติมให้ ต้องทำให้มีการบันทึกจริงเสียก่อน */
async function forceSave(page) {
  await page.click('.tab-btn[data-tab="entry"]');
  await page.click('#procBtn-winding');
  await page.fill('#entryDate', '2026-08-29');
  await page.waitForTimeout(100);
  const input = page.locator('#entryTable input.row-input[data-order="O1"]');
  await input.fill('1');
  await input.press('Tab');
  await page.waitForTimeout(150);
}

const note = (id, o) => Object.assign({
  id, date: '2026-08-29', unit: 'TUE-U', orderId: 'O1', pn: 'PN-1',
  perBox: 96, boxes: 3, remainder: 47, remark: '', billNo: '',
  deviceName: 't', createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z',
  voided: false
}, o);

test('E2 — state ที่บันทึกไว้ก่อนมีใบส่งสินค้า ต้องเปิดได้ ไม่ใช่หน้าขาว', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page, oldState());

  expect(errors, 'ข้อมูลเก่าที่ไม่มีคีย์ใหม่ ต้องเปิดได้เสมอ (INVARIANTS E2)').toEqual([]);
  await forceSave(page);
  const st = await readState(page);
  expect(Array.isArray(st.deliveryNotes), 'ต้องได้ค่าเริ่มต้นเป็น array ว่าง ไม่ใช่ undefined').toBe(true);
  expect(st.orders.length, 'ข้อมูลเดิมต้องอยู่ครบ ไม่ถูกรีเซ็ต').toBe(1);
});

test('E2 — คีย์ deliveryNotes ที่เป็นขยะ ต้องถูกแทนด้วย array ว่าง ไม่ใช่ทำให้แอปพัง', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page, oldState({ deliveryNotes: 'ไม่ใช่อาเรย์' }));

  expect(errors).toEqual([]);
  await forceSave(page);
  const st = await readState(page);
  expect(Array.isArray(st.deliveryNotes)).toBe(true);
});

test('D5 — ใบส่งที่ยังไม่เคยส่งขึ้นเซิร์ฟเวอร์ ต้องถูกมาร์คว่ารอส่ง และนับในป้ายสถานะ', async ({ page }) => {
  // แถวที่ไม่มี _dirty เลย = ของที่บันทึกไว้ก่อนจะมีระบบซิงค์ ต้องถือว่ายังไม่ได้ส่ง
  const n = note('D1'); delete n._dirty;
  await open(page, oldState({ deliveryNotes: [n] }));

  await forceSave(page);
  const st = await readState(page);
  expect(st.deliveryNotes[0]._dirty, 'ไม่มี _dirty = ยังไม่เคยส่ง ต้องกลายเป็น true').toBe(true);

  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(
    { url: 'https://script.google.com/macros/s/EXAMPLE/exec', token: 'x', auto: false })), K_SYNC);
  await page.reload();
  await waitReady(page);
  await page.waitForSelector('#syncLabel');
  await expect(page.locator('#syncLabel'),
    'ป้ายต้องนับใบส่งที่ค้างด้วย ไม่งั้นป้ายจะบอกว่าซิงค์แล้วทั้งที่ยังไม่ได้ส่ง').toContainText('รอส่ง 1');
});

test('C2 — วันที่ของใบส่งที่เพี้ยนกลับมาจาก Google Sheets ต้องถูกซ่อมตอนเปิดโปรแกรม', async ({ page }) => {
  // Sheets ชอบคืนค่าเป็น timestamp เต็มแทน YYYY-MM-DD ถ้าปล่อยไว้จะเทียบวันไม่ตรงทั้งระบบ
  await open(page, oldState({ deliveryNotes: [note('D1', { date: '2026-08-29T00:00:00.000Z', _dirty: false })] }));

  const st = await readState(page);
  expect(st.deliveryNotes[0].date, 'ต้องถูกตัดกลับเป็นวันปฏิทินล้วน').toBe('2026-08-29');
  expect(st.deliveryNotes[0]._dirty, 'แถวที่ถูกซ่อมต้องถูกมาร์คให้ดันค่าที่ถูกกลับขึ้นไปทับ').toBe(true);
});

/** คีย์ยอดหนึ่งช่อง แล้วตรวจว่าแอปบอกผู้ใช้ว่าบันทึกไม่ได้ โดยไม่มี error หลุดจนหน้าค้าง */
async function keyAndExpectStorageWarning(page, errors) {
  expect(errors, 'แอปต้องเปิดขึ้นได้แม้เขียนลงเครื่องไม่ได้').toEqual([]);

  await page.click('.tab-btn[data-tab="entry"]');
  await page.click('#procBtn-winding');
  await page.fill('#entryDate', '2026-08-29');
  await page.waitForTimeout(100);
  const input = page.locator('#entryTable input.row-input[data-order="O1"]');
  await input.fill('10');
  await input.press('Tab');

  await expect(page.locator('#toast'),
    'ต้องบอกตรง ๆ ว่าบันทึกไม่ได้ ไม่ใช่ปล่อยให้คนคีย์ต่อทั้งวันแล้วข้อมูลหายหมด')
    .toContainText('พื้นที่เก็บข้อมูล');
  expect(errors, 'และต้องไม่มี error หลุดออกมาจนหน้าจอค้าง').toEqual([]);
}

test('E3 — เขียน IndexedDB ไม่ได้ระหว่างใช้งาน (เช่นพื้นที่เต็ม) ต้องบอกผู้ใช้ ไม่ใช่ตายเงียบ', async ({ page }) => {
  // ที่เก็บหลักเป็น IndexedDB ตั้งแต่ 9 ต.ค. 2026 · การบันทึกเป็นแบบไม่รอผล ความล้มเหลวจึงมาทีหลัง
  // ถ้าไม่มีใครดักไว้ จะกลายเป็น error ที่ไม่มีคนจัดการ แล้วคนคีย์ต่อทั้งวันโดยไม่รู้ว่าไม่ได้บันทึก
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page, oldState(), () => {
    const real = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      // ปล่อยให้ตอนเปิดหน้าย้ายข้อมูลได้ตามปกติ แล้วค่อยเต็มระหว่างใช้งาน
      if (document.documentElement.dataset.stateReady === '1') {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return real.call(this, v, k);
    };
  });
  await keyAndExpectStorageWarning(page, errors);
});

test('E3 — เปิด IndexedDB ไม่ได้ ต้องใช้ localStorage แบบเดิมต่อได้ และถ้าเต็มต้องบอกผู้ใช้', async ({ page }) => {
  // ทางสำรองเมื่อเบราว์เซอร์ไม่ให้ใช้ IndexedDB · เดิม saveState() ไม่มี try/catch เลย
  // ถ้า quota เต็มจะ throw ทะลุกลางฟังก์ชันที่เรียก แล้วบรรทัดถัดไปไม่ถูกรัน · ถ้าเกิดตอนบูตจะเปิดโปรแกรมไม่ขึ้นเลย
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page, oldState(), () => {
    IDBFactory.prototype.open = function () { throw new DOMException('ไม่ให้ใช้', 'InvalidStateError'); };
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'tue_order_tracker_v1') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      return real.call(this, k, v);
    };
  });
  // keyAndExpectStorageWarning คีย์ลงช่องของใบ O1 ซึ่งมาจากข้อมูลใน localStorage
  // หาช่องเจอ = เปิดข้อมูลเดิมขึ้นมาได้จริงโดยไม่มี IndexedDB
  await keyAndExpectStorageWarning(page, errors);
});
