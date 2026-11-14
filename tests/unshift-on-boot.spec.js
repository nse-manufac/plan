// คลายคอลัมน์ที่เลื่อนให้เองตอนเปิดโปรแกรม — ไม่ต้องไปกดปุ่มทีละเครื่อง
//
// ── ที่มา ─────────────────────────────────────────────────────────
// `doPushRows` เคยเขียนลงชีตด้วย "ตำแหน่ง" ขณะที่ `planSupport` ถูกแทรกไว้กลางรายการ `ORDER_COLS`
// ค่าห้าช่องท้ายจึงหมุนเป็นวงกลม · ใบสั่ง 441 จาก 918 ใบบนชีตจริงเพี้ยนเงียบ ๆ หลายเดือน (พบ 14 พ.ย. 2569)
//
// ทางซ่อมเดิมคือให้ **ทุกเครื่อง** กดปุ่ม "ดึงรายการทั้งหมดใหม่" ซึ่งเจ้าของบอกว่าทำไม่ไหว
// (14 พ.ย. 2569: "ไล่กดทีละเครื่องไม่ไหวครับ") · `prepareState()` คือที่เดียวที่ทุกเครื่องผ่าน
// ตอนเปิดโปรแกรม จึงซ่อมที่นั่น แล้วมาร์ค `_dirty` ให้รอบซิงค์ถัดไปดันค่าที่ถูกขึ้นชีตทับของเพี้ยน
//
// ── กฎการเขียนเทสในไฟล์นี้ ────────────────────────────────────────
// ⚠️ ใบที่ใช้ทดสอบต้องมี `planSupport` เป็น **timestamp เต็ม** อย่างน้อยหนึ่งใบ
//    เพราะข้อที่มีฟันจริงคือ "คลายก่อน แล้วค่อยซ่อมวันที่" — ถ้าสลับลำดับ `normalizeRowDates`
//    จะตัด timestamp นั้นเป็นวันล้วนก่อน แล้ว `updatedAt` ตัวจริงหายทั้งที่กู้ได้
//    ใบที่ `planSupport` ว่างจะเขียวเองทั้งที่ลำดับผิด
// ⚠️ ต้องมีใบ "ปกติ" และใบ "importedAt ว่าง" อยู่ใน fixture ด้วยเสมอ — ลายเซ็นด้านเดียว
//    จะไปสลับช่องของใบพวกนั้นทิ้ง และนั่นคือการทำข้อมูลดีให้พัง ซึ่งแย่กว่าไม่ซ่อมเลย

const { test, expect } = require('@playwright/test');
const { readSaved, waitReady, forgetSavedOnEveryLoad } = require('./app-state');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

const base = (poNo, pn) => ({
  id: poNo + '|' + pn, week: 37, poNo, pn, subName: 'TUE-H', osc: '', pc: '',
  orderQty: 1000, orderDate: '2026-09-07', planWinding: '2026-09-10', planAssembly: '2026-09-12',
  voided: false, _dirty: false
});

/** ใบที่ค่าถูกต้อง — ห้าช่องท้ายอยู่ที่เดิมของมัน */
const good = (poNo, pn, over = {}) => Object.assign(base(poNo, pn), {
  planSupport: '', planInspection: '2026-09-14', status: 'active',
  importedAt: '2026-09-11T13:44:13.312Z', updatedAt: '2026-09-16T04:22:45.231Z'
}, over);

/** หมุนห้าช่องไปข้างหน้าหนึ่งตำแหน่ง = สิ่งที่ชีตคืนมาจริงสำหรับใบที่เลื่อน */
function shiftOnce(o) {
  return Object.assign({}, o, {
    planInspection: o.planSupport, status: o.planInspection, importedAt: o.status,
    updatedAt: o.importedAt, planSupport: o.updatedAt
  });
}

const TRUE_A = good('TM5269H101', 'PN-A');
const TRUE_B = good('TM5269H102', 'PN-B', { planSupport: '2026-09-20', planInspection: '2026-09-22' });
const CLEAN = good('TM5269H103', 'PN-C');
/* ⚠️ ใบนี้ต้องมี `updatedAt` เป็น timestamp จริง ไม่ใช่ว่าง — ไม่งั้นด่านที่สอง (updatedAt)
   จะรับมันไว้ก่อน แล้วด่าน "importedAt ว่าง" ไม่เคยถูกเรียก · ถอดด่านนั้นออกแล้วเทสยังเขียว
   (ลองแล้วเขียวจริงตอนเขียนเทสรอบแรก) · รูปที่อันตรายจริงคือใบเก่าที่เคยซิงค์จนมี updatedAt
   แต่ยังไม่มี importedAt ซึ่งมีอยู่จริงในเครื่องที่ใช้มาตั้งแต่ก่อนมีช่องนั้น */
const NEVER_SYNCED = good('TM5269H104', 'PN-D', { importedAt: '' });
const TWICE = shiftOnce(shiftOnce(good('TM5269H105', 'PN-E')));

/* 🚨 **รูปที่เครื่องจริงถืออยู่วันนี้** — `mergeRowsInto()` เรียก `normalizeRowDates()` ให้แถวที่
   ดึงมา **ก่อน** เก็บ (`app.js` บรรทัดแรกของลูป) · `planSupport` อยู่ใน `ORDER_DATE_FIELDS`
   จึงถูกตัดเป็นวันล้วนตั้งแต่ตอน pull · ใบข้างบนที่ `planSupport` เป็น timestamp เต็มคือรูปของ
   แถวที่ค้างในเครื่องจากแอปรุ่นก่อนที่ merge จะ normalize ให้ ซึ่งหาได้ยากแล้ว
   **สองรูปต้องมีทั้งคู่** — ไม่มีรูปนี้ ชุดเทสจะคุมแค่รูปที่ของจริงไม่ค่อยมี
   (ผู้ตรวจ #136 รอบ 10 รันพิสูจน์ว่า pull ไม่เคยทิ้ง timestamp ไว้ใน `planSupport`) */
const TRUE_C = good('TM5269H106', 'PN-F');
const SHIFTED_C = Object.assign(shiftOnce(TRUE_C), { planSupport: '2026-09-16' });

const SEED = [shiftOnce(TRUE_A), shiftOnce(TRUE_B), CLEAN, NEVER_SYNCED, TWICE, SHIFTED_C];

async function boot(page, orders = SEED) {
  await forgetSavedOnEveryLoad(page);
  await page.addInitScript(([k, o]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: [], deliveryNotes: [], deltaWip: [], deliveryLog: [], importHistory: []
  })), [K_STATE, orders]);
  await page.goto(APP);
  await waitReady(page);
  const st = await readSaved(page, K_STATE);
  return new Map(st.orders.map(o => [o.id, o]));
}

const FIVE = ['planSupport', 'planInspection', 'status', 'importedAt', 'updatedAt'];
const five = o => Object.fromEntries(FIVE.map(k => [k, o[k]]));

test('ใบที่คอลัมน์เลื่อน ต้องถูกคลายคืนครบทั้งห้าช่องตอนเปิดโปรแกรม', async ({ page }) => {
  const got = await boot(page);
  expect(five(got.get(TRUE_A.id))).toEqual(five(TRUE_A));
  expect(five(got.get(TRUE_B.id))).toEqual(five(TRUE_B));
});

/* 🚨 ข้อที่มีฟันจริงของกฎ "คลายก่อน แล้วค่อยซ่อมวันที่"
   สลับลำดับสองบล็อกใน prepareState() แล้ว normalizeRowDates จะตัด timestamp ใน planSupport
   เป็นวันล้วนก่อน → updatedAt ได้ '2026-09-16' แทน '2026-09-16T04:22:45.231Z' */
test('ต้องคลายก่อนซ่อมวันที่ — updatedAt ตัวจริงต้องไม่ถูกตัดเหลือวันล้วน', async ({ page }) => {
  const got = await boot(page);
  expect(got.get(TRUE_A.id).updatedAt).toBe('2026-09-16T04:22:45.231Z');
  expect(got.get(TRUE_B.id).updatedAt).toBe('2026-09-16T04:22:45.231Z');
});

/* รูปที่เครื่องจริงถืออยู่: `planSupport` เป็นวันล้วนเพราะ pull ตัดไปแล้ว
   ⚠️ **`updatedAt` ที่ได้คืนจึงเป็นวันล้วน ไม่ใช่ timestamp — และนั่นไม่มีผล**
   เพราะแถวถูกมาร์ค `_dirty` แล้ว `doSync()` เขียน `o.updatedAt = res.serverTime` ทับหลัง push (D4)
   ที่ต้องถูกคือสี่ช่องที่เก็บข้อมูลจริง ส่วน `updatedAt` เป็นนาฬิกาของการซิงค์ */
test('รูปที่เครื่องจริงถืออยู่ (planSupport เป็นวันล้วน) ต้องคลายได้ถูกทุกช่อง', async ({ page }) => {
  const got = await boot(page);
  const o = got.get(TRUE_C.id);
  expect(o.planSupport).toBe(TRUE_C.planSupport);
  expect(o.planInspection).toBe(TRUE_C.planInspection);
  expect(o.status).toBe(TRUE_C.status);
  expect(o.importedAt).toBe(TRUE_C.importedAt);
  expect(o.updatedAt).toBe('2026-09-16');
  expect(o._dirty).toBe(true);
});

test('คลายแล้วต้องมาร์ครอส่ง เพื่อดันค่าที่ถูกขึ้นชีตทับของเพี้ยน', async ({ page }) => {
  const got = await boot(page);
  expect(got.get(TRUE_A.id)._dirty).toBe(true);
  expect(got.get(TRUE_B.id)._dirty).toBe(true);
});

test('ใบปกติต้องไม่ถูกแตะ และต้องไม่ถูกมาร์ครอส่ง', async ({ page }) => {
  const got = await boot(page);
  expect(five(got.get(CLEAN.id))).toEqual(five(CLEAN));
  expect(got.get(CLEAN.id)._dirty).toBe(false);
});

/* ใบเก่าที่ยังไม่เคยซิงค์มี importedAt ว่าง — ลายเซ็นด้านเดียว ("ไม่ใช่ timestamp")
   จะไปสลับช่องของใบพวกนี้ทิ้ง ซึ่งเป็นการทำข้อมูลดีให้พัง */
test('ใบที่ยังไม่เคยซิงค์ (importedAt ว่าง) ต้องไม่ถูกสลับช่อง', async ({ page }) => {
  const got = await boot(page);
  expect(five(got.get(NEVER_SYNCED.id))).toEqual(five(NEVER_SYNCED));
});

/* ⚠️ เทียบเฉพาะสามช่องที่ "การหมุน" จะเปลี่ยน ไม่ใช่ทั้งห้าช่อง
   อีกสองช่อง (planSupport · planInspection) ถือ timestamp อยู่ แล้วถูก `normalizeRowDates`
   ตัดเป็นวันล้วน ซึ่งเป็น **ตัวซ่อมวันที่ของเดิม ไม่ใช่โค้ดในใบนี้** — และเป็นกลไกเดียวกับที่
   ทำให้ใบพวกนี้เสียหายกู้ไม่ครบตั้งแต่แรก · เทียบทั้งห้าช่องจะแดงด้วยเหตุที่ไม่เกี่ยวกับสิ่งที่ข้อนี้คุม */
test('ใบที่เลื่อนสองชั้นต้องไม่ถูกหมุนซ้ำ — กู้ไม่ครบ ต้องให้คนดูเอง', async ({ page }) => {
  const got = await boot(page);
  const o = got.get(TWICE.id);
  expect(o.updatedAt).toBe('active');          // หมุนแล้วช่องนี้จะกลายเป็นวันที่
  expect(o.status).toBe('');                   // หมุนแล้วช่องนี้จะกลายเป็น '2026-09-14'
  expect(o.importedAt).toBe('2026-09-14');     // หมุนแล้วช่องนี้จะกลายเป็น 'active'
});

/* ลายเซ็นหายไปเองหลังคลาย (importedAt กลับเป็น timestamp) จึงต้องไม่หมุนซ้ำรอบสอง
   เปิดหน้าสองครั้งโดยหว่านผลของรอบแรกกลับเข้าไป = จำลองการเปิดโปรแกรมวันถัดไป */
test('เปิดซ้ำต้องไม่หมุนอีกรอบ', async ({ page }) => {
  const once = await boot(page);
  const again = await boot(page, [...once.values()]);
  expect(five(again.get(TRUE_A.id))).toEqual(five(TRUE_A));
  expect(five(again.get(TRUE_B.id))).toEqual(five(TRUE_B));
});
