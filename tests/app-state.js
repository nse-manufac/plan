// ข้อมูลที่แอปบันทึกไว้ในเครื่อง — ตัวช่วยเดียวที่เทสใช้อ่านหรือล้าง state ของแอป
//
// ตั้งแต่ 9 ต.ค. 2026 แอปเก็บ state ใน IndexedDB ไม่ใช่ localStorage (localStorage ของหน้างานเต็มจริง)
// ยังเก็บเป็นข้อความ JSON ใต้คีย์เดิม K_STATE · localStorage เหลือเป็นต้นทางตอนย้ายครั้งแรกเท่านั้น
//
// การ "หว่าน" state ตั้งต้นในเทสยังทำแบบเดิมได้ คือ addInitScript ใส่ localStorage
// แอปจะย้ายเข้า IndexedDB ให้เองตอนเปิดหน้า (เส้นทางเดียวกับเครื่องจริงที่อัปเดตรุ่นครั้งแรก)
// แต่ "อ่าน" ต้องอ่านจาก IndexedDB ผ่านตัวนี้ — localStorage ว่างทันทีที่ย้ายเสร็จ

const IDB_NAME = 'tue_order_tracker';
const IDB_STORE = 'kv';

/** รอให้แอปโหลด state และวาดจอเสร็จ — ก่อนหน้านั้นแอปยังไม่บันทึกอะไร และ IndexedDB อาจยังไม่มีข้อมูล
 *  ดูจากป้ายบน <html> ไม่ใช่ตัวแปร stateReady — ตัวแปรระดับบนสุดของแอปอาจมองจากเทสไม่เห็น */
async function waitReady(page) {
  const ready = () => document.documentElement.dataset.stateReady === '1';
  // เช็กครั้งเดียวก่อน — เทสที่ใช้ page.clock แช่นาฬิกาไว้ การรอแบบวนเช็กอาจไม่เดินเลย
  if (await page.evaluate(ready)) return;
  await page.waitForFunction(ready);
}

/**
 * state ที่แอปบันทึกล่าสุด — แทน JSON.parse(localStorage.getItem(k)) เดิม · ยังไม่เคยบันทึก = null
 * opts.raw = true คืนข้อความดิบ (ใช้กับเทสแบบ "ต้องไม่มีอะไรเปลี่ยนเลย")
 *
 * อ่านได้ถูกแม้แอปเพิ่งสั่งบันทึก: transaction อ่านที่สร้างทีหลังจะรอ transaction เขียนที่สร้างก่อนเสมอ
 */
async function readSaved(page, key, opts = {}) {
  await waitReady(page);
  const raw = await page.evaluate(async ([db, store, k]) => {
    if (!(await indexedDB.databases()).some(d => d.name === db)) return null;
    return new Promise((ok, fail) => {
      const r = indexedDB.open(db);
      r.onerror = () => fail(r.error);
      r.onsuccess = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(store)) { d.close(); return ok(null); }
        const g = d.transaction(store).objectStore(store).get(k);
        g.onsuccess = () => { d.close(); ok(g.result === undefined ? null : g.result); };
        g.onerror = () => { d.close(); fail(g.error); };
      };
    });
  }, [IDB_NAME, IDB_STORE, key]);
  return opts.raw ? raw : (raw === null ? null : JSON.parse(raw));
}

/**
 * ล้างสิ่งที่แอปบันทึกไว้ทุกครั้งที่หน้าโหลด — ใช้คู่กับ addInitScript ที่หว่าน localStorage ใหม่ทุกครั้ง
 * เดิมการหว่าน localStorage ทับก็คือการล้างไปในตัว ตอนนี้ของที่บันทึกแล้วอยู่ใน IndexedDB
 * ถ้าไม่ล้าง แอปจะเปิดของเดิมขึ้นมาแทนของที่หว่าน (IndexedDB ชนะ localStorage — ดู bootState)
 * ต้องเรียกก่อน addInitScript ที่หว่าน · การลบถูกเข้าคิวก่อน indexedDB.open ของแอปเสมอ
 */
function forgetSavedOnEveryLoad(page) {
  return page.addInitScript(db => { indexedDB.deleteDatabase(db); }, IDB_NAME);
}

module.exports = { IDB_NAME, IDB_STORE, waitReady, readSaved, forgetSavedOnEveryLoad };
