/* ===================== Production Plan Tracker — App Logic ===================== */
"use strict";

/* ---------- Basic helpers ---------- */
function uid(){ return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/* NOTE on dates — read this before touching anything that converts an Excel value.
   Date objects always carry an implicit timezone, and re-extracting a calendar day from one
   with the wrong getters has produced real off-by-one bugs here before.

   Two sources, two rules:
   1. Excel day-count serials  -> converted straight to "YYYY-MM-DD" with pure integer
      calendar math (civil_from_days). No Date object is ever created. Safest path.
   2. Date objects handed over by the Excel reader -> unavoidable since Sep 2026, when the
      library was switched to ExcelJS: it always materialises date cells as Date, with no
      option to hand back the raw serial. Those Dates sit at UTC midnight, so
      excelValueToISO() reads them back with UTC getters ONLY. Local getters would shift the
      day backwards on any machine behind UTC. Thailand is UTC+7 so it happens to agree —
      do not rely on that.

   "today" (entry-date picker, deadline comparisons) is a different question: it must reflect
   the user's real local wall-clock day, so todayISO() still uses `new Date()` + local getters.

   All paths produce plain "YYYY-MM-DD" strings that compare correctly lexicographically. */
function pad2(n){ return String(n).padStart(2,'0'); }
// Howard Hinnant's civil_from_days: days-since-1970-01-01 (integer, may be negative) -> Y/M/D.
function civilFromDays(z){
  z += 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe/1460) + Math.floor(doe/36524) - Math.floor(doe/146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365*yoe + Math.floor(yoe/4) - Math.floor(yoe/100));
  const mp = Math.floor((5*doy + 2)/153);
  const d = doy - Math.floor((153*mp+2)/5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const year = y + (m <= 2 ? 1 : 0);
  return {year, month:m, day:d};
}
function excelSerialToISO(serial){
  // Round first: legacy formula-derived serials often carry tiny float noise (e.g. 46227.99996)
  // a whole day count away from the intended calendar day.
  const days = Math.round(serial) - 25569;
  const c = civilFromDays(days);
  return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
}
function excelValueToISO(v){
  if (v==null || v==='') return null;
  if (typeof v === 'number'){
    if (isNaN(v)) return null;
    return excelSerialToISO(v);
  }
  if (v instanceof Date){
    if (isNaN(v.getTime())) return null;
    // ⚠️ ต้องอ่านด้วย UTC getters เท่านั้น
    // ตัวอ่าน Excel สร้าง Date ของช่องวันที่ไว้ที่เที่ยงคืน UTC เสมอ (ปิดพฤติกรรมนี้ไม่ได้)
    // ถ้าอ่านกลับด้วย getters ตามเขตเวลาเครื่อง เครื่องที่อยู่หลัง UTC จะได้วันก่อนหน้าไปหนึ่งวัน
    // ไทยอยู่ UTC+7 จึงบังเอิญได้วันเดียวกัน แต่ห้ามพึ่งความบังเอิญ — INVARIANTS หมวด C
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth()+1)}-${pad2(v.getUTCDate())}`;
  }
  if (typeof v === 'string'){
    const t = v.trim();
    if (!t) return null;
    if (/^\d+(\.\d+)?$/.test(t)) return excelSerialToISO(Number(t));
    const d = new Date(t);
    if (isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
  }
  return null;
}
function isoLocal(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayISO(){ return isoLocal(new Date()); }

/** บังคับให้ค่าวันที่เป็น 'YYYY-MM-DD' เสมอ
 *  Google Sheets จะแปลงสตริงที่หน้าตาเหมือนวันที่ให้เป็นเซลล์ชนิดวันที่โดยอัตโนมัติ พอ Apps Script
 *  อ่านกลับด้วย getValues() จะได้ Date object แล้ว JSON.stringify แปลงเป็น timestamp UTC เต็ม
 *  (เช่น '2026-07-07T17:00:00.000Z' = เที่ยงคืนวันที่ 8 ก.ค. เวลาไทย) ค่าแบบนี้ทำให้ทั้งการแสดงผล
 *  และการคำนวณ deadline พังทั้งหมด จึงต้องแปลงกลับด้วย getter เวลาท้องถิ่นเพื่อไม่ให้วันคลาดไป 1 วัน
 *  (เบราว์เซอร์หน้างานกับ Apps Script อยู่โซนเวลาเดียวกัน = Asia/Bangkok) */
function normalizeDateOnly(v){
  if(v==null || v==='') return v;
  if(v instanceof Date) return isNaN(v.getTime()) ? null : isoLocal(v);
  const s = String(v);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if(/^\d{4}-\d{2}-\d{2}T/.test(s)){
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : isoLocal(d);
  }
  return v;
}

function dateFromISO(iso){
  const s = normalizeDateOnly(iso);
  if(!s || typeof s !== 'string') return null;
  const parts = s.split('-').map(Number);
  if(parts.length!==3 || parts.some(n=>!isFinite(n))) return null;
  return new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
}
function addDaysISO(iso, days){
  const d = dateFromISO(iso);
  if(!d) return null;
  d.setUTCDate(d.getUTCDate()+Number(days||0));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
}
function daysBetween(isoA, isoB){
  const a = dateFromISO(isoA), b = dateFromISO(isoB);
  if(!a || !b) return null;
  return Math.round((b - a)/86400000);
}
function fmtDateTH(iso){
  const s = normalizeDateOnly(iso);
  if(!s || typeof s !== 'string') return '-';
  const parts = s.split('-');
  if(parts.length!==3) return '-';
  const [y,m,d]=parts;
  return `${d}/${m}/${y}`;
}
function numFmt(n){ return (Number(n)||0).toLocaleString('en-US'); }

let toastTimer=null;
function toast(msg){
  const el=document.getElementById('toast');
  if(!el) return;
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'), 3200);
}

function downloadBlob(content, filename, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
}

/* ---------- Processes ---------- */
// Shipping is tracked as the last daily-recorded stage (goods ship out incrementally, same as
// production stages), sitting downstream of Inspection.
// Support แทรกเป็นขั้นที่ 3 ระหว่าง Assembly กับ Inspection (issue #17) — ยังไม่มีชื่อไทยตามที่เจ้าของสั่ง
// ที่มาของยอดส่งของ เขียนไว้ในช่อง note ของ record
// ⚠️ ห้ามเปลี่ยนข้อความสองอันนี้ — มันถูกใช้เป็นตัวแยกแหล่งที่มาในตารางแก้ไขรายการ
const SOURCE_SHIP_IMPORT = 'นำเข้าจากใบส่งงาน';
const SOURCE_DELIVERY = 'จากใบส่งสินค้า';

/** เหตุผลสำเร็จรูปของช่องหมายเหตุในหน้าคีย์ยอดรายวัน (เจ้าของเลือกชุดนี้ 27 ต.ค. 2026)
 *  ⚠️ **ที่เดียวที่กำหนดรายการ** — แก้ที่นี่แล้วทั้งโปรแกรมเปลี่ยนตาม (แบบเดียวกับ DEFAULT_PROCESSES)
 *
 *  ⚠️ **ห้ามมีค่าใดซ้ำกับ SOURCE_SHIP_IMPORT หรือ SOURCE_DELIVERY สองบรรทัดข้างบน**
 *     ช่อง `note` ช่องเดียวกันนี้ถูกใช้บอก "ที่มาของยอด" ด้วย — คอลัมน์แหล่งที่มาในหน้าแก้ไขรายการ
 *     กับตัวกรองของมันตัดสินจากค่านี้ตรง ๆ · **ผลของการซ้ำไม่เหมือนกันสองคำ**
 *       ซ้ำกับ SOURCE_DELIVERY    → แหล่งที่มาแสดงผิดเป็น "ใบส่งสินค้า" แต่ยังอยู่ในตัวกรอง "กรอกมือ"
 *       ซ้ำกับ SOURCE_SHIP_IMPORT → หายจากตัวกรอง "กรอกมือ" ไปเลย เพราะตัวกรองนั้นคัดด้วยคำนี้คำเดียว
 *     ทั้งคู่พังแบบเงียบและตามหายาก · มีเทสคุมทั้งสองคำ
 *
 *  ⚠️ **ทางที่คนหน้างานใช้จริงคือเลื่อนหา ไม่ใช่พิมพ์** (เจ้าของยืนยัน 30 ต.ค. 2026 —
 *     พนักงานพิมพ์ภาษาไทยหาไม่ได้) · **รายการจึงต้องสั้นพอให้กวาดตาหาได้** เก้าคำถือว่ายังไหว
 *     ตามที่เจ้าของเคาะ · จะเพิ่มคำเรื่อย ๆ จนยาวเกินกวาดตาไม่ได้ ต้องถามเจ้าของก่อน
 *
 *     type-ahead (พิมพ์ตัวอักษรเพื่อกระโดด) ยังทำงาน — แปดคำแรกขึ้นต้นไม่ซ้ำกัน (เ ข ร ค ห ง ผ อ)
 *     ส่วนคำที่เก้า `NOTE_CLEARED` ขึ้นต้น เ ซ้ำกับ `เครื่องเสีย` จึงต้องกด เ สองครั้ง
 *     **เจ้าของรับข้อนี้แล้ว 30 ต.ค. 2026** เพราะทางนั้นไม่ใช่ทางที่หน้างานใช้ —
 *     อย่าเอาเรื่องตัวอักษรซ้ำมาเป็นเหตุผลขวางการตั้งชื่อคำใหม่อีก
 *     (ของเดิมเคยเขียนว่า type-ahead "เป็นทางที่คนใช้จริง" ซึ่งเป็นการเดาของ agent ไม่ใช่ข้อเท็จจริง)
 *
 *  เพิ่ม/แก้คำได้ตามปกติ แต่ **คำที่เคยถูกเลือกไว้แล้วจะยังอยู่ในข้อมูล** — หน้าจอจึงต้อง
 *  แสดงค่าเดิมที่ไม่อยู่ในรายการได้ด้วย ไม่ใช่ทำให้มันหายไปเงียบ ๆ (ดู renderEntryTable) */
const ENTRY_NOTES = ['เครื่องเสีย', 'ขาดวัตถุดิบ', 'รองาน/รอชิ้นส่วนจากขั้นก่อน', 'คนไม่พอ',
                     'หยุดงาน/วันหยุด', 'งานแก้ไข/ซ่อม', 'ผลิตเกินแผน', 'อื่น ๆ', 'เคลียร์แล้ว'];

/** คำปิดเรื่องของช่องหมายเหตุ (เจ้าของเลือก 29 ต.ค. 2026)
 *
 *  เหตุผลที่ใส่ไว้วันหนึ่ง **สืบทอดไปแสดงในวันถัด ๆ ไป** จนกว่าจะมีคนเปลี่ยนหรือกดปิด
 *  (เจ้าของสั่ง — ของเดิมหายทุกครั้งที่เปลี่ยนวัน เพราะหมายเหตุผูกกับ `orderId|process|date`)
 *  คำนี้คือตัวปิด · เป็นสมาชิกของ `ENTRY_NOTES` เหมือนคำอื่น จึงถูกบันทึกลงรายการของวันที่กดปิด
 *  = **มีหลักฐานว่าปิดเมื่อไหร่** ต่างจากการล้างเป็นค่าว่าง ซึ่งแยกจาก "ยังไม่เคยใส่" ไม่ออก
 *
 *  ⚠️ **ได้ "เมื่อไหร่" เสมอ แต่ไม่ได้ "ใคร" เสมอ** — ปิดบนแถวที่มีรายการอยู่แล้ว (กรณีส่วนใหญ่
 *     เพราะคนคีย์ยอดก่อน) `saveEntryNote()` ไม่ทับ `deviceName` โดยตั้งใจ ชื่อที่เห็นจึงเป็นของ
 *     คนที่คีย์ยอด ไม่ใช่คนที่กดปิด · ได้ชื่อคนปิดเฉพาะตอนที่การปิดสร้างแถวใหม่ขึ้นมาเอง
 *     (ผู้ตรวจ #117 ทักว่าคอมเมนต์สองที่ในไฟล์นี้ขัดกันเรื่องนี้) · จะเก็บ "ใครปิด" ให้ครบ
 *     ต้องเพิ่มคอลัมน์ = แก้ contract การซิงค์ + redeploy ซึ่งต้องถามเจ้าของก่อน (§7)
 *
 *  ⚠️ ขึ้นต้นด้วย "เ" ซ้ำกับ `เครื่องเสีย` จึงต้องกด เ สองครั้งถ้าใช้ type-ahead
 *     **เจ้าของรับข้อนี้แล้ว 30 ต.ค. 2026** เพราะหน้างานเลื่อนหา ไม่ได้พิมพ์ (ดูบล็อกข้างบน)
 *     อย่ายกเรื่องตัวอักษรซ้ำมาเป็นเหตุผลเปลี่ยนคำนี้อีก — ถ้าจะเปลี่ยน ต้องมีเหตุผลอื่น
 *     และเป็นการตัดสินใจเรื่องถ้อยคำของเจ้าของ · แก้ได้ที่บรรทัดนี้จุดเดียว */
const NOTE_CLEARED = 'เคลียร์แล้ว';

/* ---------- รายการขั้นการผลิต — มีที่เดียวคือ DEFAULT_PROCESSES (INVARIANTS A3) ----------
 * เจ้าของสั่ง 12 ก.ย. 2026 ให้เพิ่มขั้นได้จากในโปรแกรม
 * ข้างล่างคือห้าขั้นตั้งต้น · ขั้นที่เพิ่ม/เปลี่ยนชื่อ/ซ่อนจากหน้าจัดการขั้น ซิงค์มาเก็บใน state.processes
 * แล้วรวมกับห้าขั้นนี้ใน composeProcesses() — ทุกจุดในโปรแกรมอ่านผลรวมนั้น ไม่ได้อ่านรายการนี้ตรง ๆ
 *
 *   id             ค่าที่เก็บใน record.process · ห้ามเปลี่ยนเด็ดขาด (A2) — ยอดเก่าจะหลุดจากขั้นนั้นทั้งหมด
 *   label          ชื่อเต็ม · ปุ่มเลือกขั้น หัวคอลัมน์สะสม กราฟ
 *   short          ชื่อสั้น · หัวตาราง Dashboard สถานะล่าช้า การ์ด WIP รายงาน Excel
 *   defaultOffset  วันกำหนดส่งตั้งต้นนับจากวันสั่ง · null = ยังไม่กำหนด ไม่ตัดสินล่าช้า (A4)
 *   offsetInputId  id ของช่องกรอกวันในหน้าตั้งค่า — ห้าขั้นเดิมคง id เดิมไว้ ขั้นใหม่ได้ off-<id>
 *   headHtml/text  คำเฉพาะของขั้นนั้น (มีแค่ขั้นส่งของ) · ขั้นอื่นประกอบจากชื่อสั้นใน ptext()
 *
 * ⚠️ inspection กับ shipping ต้องอยู่ท้ายสุดเสมอ และห้ามเปลี่ยน id
 *    หน้า FG (inspection − shipping) ใบส่งของ แผงเทียบ Call In สถานะส่งครบ ผูกกับสอง id นี้ตรง ๆ
 *
 * ⚠️ สีของแต่ละขั้นอยู่ที่นี่ที่เดียว ทั้งแท่งกราฟและคำอธิบายสีเหนือกราฟ
 *    เดิมสีถูกเขียนไว้สองที่ แก้ที่เดียวแล้วอีกที่ค้างไว้ = คำอธิบายชี้ผิดแท่ง โดยไม่มีอะไรฟ้อง */
const DEFAULT_PROCESSES = [
  {id:'winding',    label:'Winding/Trimming',  short:'Winding',    icon:'🌀', color:'#2563eb', defaultOffset:10,   offsetInputId:'offW'},
  {id:'assembly',   label:'Assembly',          short:'Assembly',   icon:'🔧', color:'#d97706', defaultOffset:17,   offsetInputId:'offA'},
  {id:'support',    label:'Support',           short:'Support',    icon:'🧩', color:'#0891b2', defaultOffset:null, offsetInputId:'offSup'},
  {id:'inspection', label:'Inspection',        short:'Inspection', icon:'🔍', color:'#16a34a', defaultOffset:24,   offsetInputId:'offI'},
  {id:'shipping',   label:'ส่งของ (Shipping)', short:'Shipping',   icon:'🚚', color:'#7c3aed', defaultOffset:28,   offsetInputId:'offS',
    headHtml:'ส่งของ<br>(Shipping)',
    text:{late:'เกินกำหนดส่งของ', wait:'รอส่งของ', waitCard:'WIP รอส่งของ (เสร็จ Inspection แต่ยังไม่ส่ง)',
          waitExport:'WIP รอส่งของ', deadlineExport:'กำหนดส่งของ', offset:'กำหนดส่งของ (+วัน)'}}
];
/* ⚠️ อ็อบเจกต์ข้างล่างเป็นตัวเดิมตลอดอายุหน้า — applyProcessList() ล้างแล้วเติมค่าลงตัวเดิม
 *    ห้ามเปลี่ยนเป็น let แล้วสร้างใหม่ ฟังก์ชันทั้งแอปอ้างตัวแปรพวกนี้ไว้ตรง ๆ
 *
 *   PROCESS_LIST   ทุกขั้นเรียงตามสายการผลิต รวมขั้นที่ซ่อน — หน้าจัดการขั้นใช้
 *   PROCESSES      id ของขั้นที่แสดงอยู่ — ตัวคิดยอด ตาราง การ์ด ปุ่ม ใช้ตัวนี้ ขั้นที่ซ่อนจึงไม่ถูกนับ
 *   MAIN_PROCESSES id ของขั้นที่อยู่ใน "สายการผลิต" — PROCESSES ที่ตัดขั้นนับแยกออก (ดูข้างล่าง)
 *   PROCESS_BY_ID  ทุกขั้นที่รู้จักรวมขั้นที่ซ่อน — ตัวเตือนขั้นแปลกหน้าใช้ตัวนี้ ขั้นที่ซ่อนจึงไม่ถูกเตือน
 *
 * ⚠️ ขั้นนับแยก (standalone) — เจ้าของสั่ง 20 ก.ย. 2026
 *    ขั้นที่ยอดไม่เกี่ยวกับสายหลักเลย (งานซ่อม งานนอกแผน) คีย์ยอดเก็บไว้ดูย้อนหลังได้
 *    แต่ไม่ได้ไหลมาจากขั้นไหนและไม่ได้ไหลไปขั้นไหน
 *
 *    **ที่ไหนที่แปลว่า "สายการผลิต" ต้องใช้ MAIN_PROCESSES ไม่ใช่ PROCESSES**
 *    คือ ขั้นก่อนหน้า · ตัวจับข้อมูลย้อนแย้ง · การ์ด WIP ค้างหน้าขั้น · คอลัมน์ WIP ในรายงาน ·
 *    ตัวกรอง "ค้างอยู่ที่ขั้น" · ลูปตัดสินล่าช้าใน computeStatus
 *    เอา PROCESSES ไปใช้ตรงนั้นแล้วขั้นนับแยกจะกลายเป็นขั้นก่อนหน้าของขั้นถัดไป
 *    ยอดมันถูกเทียบกับสายหลักจนขึ้น "ข้อมูลย้อนแย้ง" ตลอด และถูกตัดสินล่าช้าทุกใบ
 *    เพราะยอดของมันไม่มีทางถึง orderQty ซึ่งเป็นเกณฑ์ของสายหลัก
 *
 *    ส่วนที่เหลือใช้ PROCESSES ตามเดิม — ปุ่มคีย์ยอด คอลัมน์สะสม กราฟ ช่องตั้งวันกำหนด
 *    การแยกทัน/เกินกำหนด และการซิงค์ · ขั้นนับแยกจึงมีกำหนดวันของตัวเองได้ แค่ไม่ถูกตัดสินล่าช้า
 *    (ห้าขั้นตั้งต้นเป็นสายหลักเสมอ — composeProcesses ไม่รับ standalone ที่ส่งมาทับขั้นเหล่านั้น) */
const PROCESS_LIST = [];
const PROCESSES = [];
const MAIN_PROCESSES = [];
const PROCESS_BY_ID = {};
const PROCESS_LABELS = {};
const PROCESS_COLORS = {};
const PREV_PROCESS = {};
const LOCKED_PROCESS_IDS = ['inspection', 'shipping'];
const DEFAULT_BY_ID = Object.fromEntries(DEFAULT_PROCESSES.map(p=>[p.id, p]));
/* สีของขั้นที่เพิ่มจากหน้าจัดการขั้น — ไม่ซ้ำสีของห้าขั้นตั้งต้น */
const PROCESS_PALETTE = ['#be185d', '#0d9488', '#9333ea', '#ca8a04', '#4f46e5', '#dc2626', '#059669', '#ea580c'];
const PROCESS_AUDIT_KEYS = ['addedBy', 'addedAt', 'updatedBy', 'updatedAt'];

/** รูปของรายการขั้นที่รับได้ — กฎเดียวกับ processListError ใน google-apps-script.gs
 *  (ยกเว้นห้ามลบขั้น ซึ่งต้องเทียบกับของเดิมบนเซิร์ฟเวอร์ ฝั่งนั้นตรวจให้) */
function validProcessList(list){
  if(!Array.isArray(list) || !list.length) return false;
  const ids = list.map(p=>p && p.id);
  if(new Set(ids).size !== ids.length) return false;
  const ok = list.every(p=> p && typeof p.id === 'string' && /^[a-z][a-z0-9_]{1,23}$/.test(p.id)
    && typeof p.label === 'string' && p.label.trim() && p.label.length <= 40);
  return ok && ids.slice(-LOCKED_PROCESS_IDS.length).join(',') === LOCKED_PROCESS_IDS.join(',');
}

/** รวมรายการขั้นที่ซิงค์มา (null = ยังไม่เคยมีใครแก้) เข้ากับห้าขั้นตั้งต้น — คืนรายการเต็มรวมขั้นที่ซ่อน
 *  ⚠️ ขั้นตั้งต้นเอาคำเฉพาะ (headHtml · text · offsetInputId · ไอคอน · สี) จากโค้ดเสมอ ที่ซิงค์มาเปลี่ยนได้แค่ชื่อกับซ่อน
 *  ⚠️ inspection กับ shipping ล็อก — เปลี่ยนชื่อหรือซ่อนไม่ได้ แม้ข้อมูลที่ซิงค์มาจะบอกให้ทำ */
function composeProcesses(stored){
  if(!validProcessList(stored)) return DEFAULT_PROCESSES.map(d=>Object.assign({}, d, {hidden:false}));
  const audit = s => Object.fromEntries(PROCESS_AUDIT_KEYS.filter(k=>s[k]).map(k=>[k, s[k]]));
  const out = stored.map((s, i)=>{
    const base = DEFAULT_BY_ID[s.id];
    if(base && LOCKED_PROCESS_IDS.includes(s.id)) return Object.assign({}, base, {hidden:false});
    if(base) return Object.assign({}, base, {label:s.label, short:s.short || base.short, hidden:!!s.hidden}, audit(s));
    return Object.assign({id:s.id, label:s.label, short:s.short || s.label, icon:s.icon || '🔹',
      color:s.color || PROCESS_PALETTE[i % PROCESS_PALETTE.length], defaultOffset:null,
      hidden:!!s.hidden, standalone:!!s.standalone}, audit(s));
  });
  // ขั้นตั้งต้นที่หายจากรายการ (เซิร์ฟเวอร์ห้ามลบ จึงไม่ควรเกิด) ใส่คืนก่อน inspection — กันยอดของขั้นนั้นหลุด
  DEFAULT_PROCESSES.forEach(d=>{
    if(!out.some(p=>p.id===d.id)) out.splice(out.findIndex(p=>p.id==='inspection'), 0, Object.assign({}, d, {hidden:false}));
  });
  return out;
}

function applyProcessList(list){
  PROCESS_LIST.length = 0;
  PROCESSES.length = 0;
  MAIN_PROCESSES.length = 0;
  [PROCESS_BY_ID, PROCESS_LABELS, PROCESS_COLORS, PREV_PROCESS].forEach(o=>Object.keys(o).forEach(k=>{ delete o[k]; }));
  list.forEach(p=>{
    PROCESS_LIST.push(p);
    PROCESS_BY_ID[p.id] = p;
    PROCESS_LABELS[p.id] = p.label;
    PROCESS_COLORS[p.id] = p.color;
    if(!p.hidden) PROCESSES.push(p.id);
    if(!p.hidden && !p.standalone) MAIN_PROCESSES.push(p.id);
  });
  /* ขั้นก่อนหน้าไล่ตามสายหลักเท่านั้น — ขั้นนับแยกไม่มีขั้นก่อนหน้า (null)
   * และไม่เป็นขั้นก่อนหน้าของใคร ขั้นที่อยู่ถัดจากมันจึงข้ามไปเอาขั้นสายหลักตัวก่อน */
  PROCESSES.forEach(p=>{ PREV_PROCESS[p] = null; });
  MAIN_PROCESSES.forEach((p, i)=>{ if(i) PREV_PROCESS[p] = MAIN_PROCESSES[i-1]; });
}
applyProcessList(composeProcesses(null));
function emptyCum(){ return Object.fromEntries(PROCESSES.map(p=>[p, 0])); }
const offsetInputId = d => d.offsetInputId || ('off-' + d.id);

/** ข้อความของขั้นในแต่ละที่ — คืนเป็นข้อความล้วน ผู้เรียกต้อง escapeHtml เองก่อนต่อเป็น HTML
 *  ⚠️ ชื่อขั้นจะมาจากหน้าจัดการขั้นในใบถัดไป ใครพิมพ์อะไรไว้ต้องไม่กลายเป็นโค้ดบนจอ */
function ptext(id, kind){
  const d = PROCESS_BY_ID[id] || {id, label:id, short:id};
  if(d.text && d.text[kind]) return d.text[kind];
  switch(kind){
    case 'late': return 'ล่าช้า ' + d.short;
    case 'wait': return 'ค้างหน้า ' + d.short;
    case 'waitCard': return 'WIP ค้างหน้า ' + d.short;
    case 'waitExport': return 'WIP หน้า ' + d.short;
    case 'deadlineExport': return 'Deadline ' + d.short;
    case 'cumExport': return 'สะสม ' + d.short;
    case 'offset': return d.label + ' (+วัน)';
    default: return d.label;
  }
}
/** หัวคอลัมน์ขั้นในตาราง Dashboard เป็น HTML — ขั้นส่งของใช้สองบรรทัดตามเดิม */
function processHeadHtml(id){
  const d = PROCESS_BY_ID[id];
  return (d && d.headHtml) || escapeHtml(d ? d.short : id);
}
/** ยอดสะสมของขั้นถัดไปมากกว่าขั้นก่อนหน้า = คีย์ข้ามขั้นหรือคีย์ผิด */
function hasOrderAnomaly(c){
  return MAIN_PROCESSES.some((p, i)=> i > 0 && (c[p]||0) > (c[MAIN_PROCESSES[i-1]]||0));
}

// ฟิลด์ที่เก็บ "วันปฏิทินล้วน" (YYYY-MM-DD) — ต้อง normalize ทุกครั้งที่รับค่าจากภายนอก
// (อย่าใส่ importedAt/createdAt/updatedAt ที่นี่ — พวกนั้นต้องคง timestamp ISO เต็มไว้)
/** คอลัมน์ที่เก็บ "วันปฏิทินล้วน" แยกตามตาราง — ต้องตรงกับ DATE_ONLY_COLS ใน google-apps-script.gs
 *
 *  ⚠️ ลืมเติมฝั่งใดฝั่งหนึ่งแล้ว Sheets จะแปลงสตริงวันที่เป็นเซลล์ชนิดวันที่ให้เอง
 *     พออ่านกลับมาจะได้ Date object แทนสตริง แล้วการคำนวณ deadline ฝั่งแอปจะพัง (INVARIANTS หมวด C)
 *     เป็นบั๊กเงียบคลาสเดียวกับ planSupport — tests/sync-contract.spec.js เทียบสองฝั่งให้แล้ว */
const SYNC_DATE_COLS = {
  Orders: ['orderDate','planWinding','planAssembly','planSupport','planInspection'],
  Records: ['date'],
  DeliveryNotes: ['date'],
  DeliveryLog: ['date']
};
// ชื่อเดิมอ้างจากรายการเดียวข้างบน ไม่ใช่ประกาศซ้ำ — มีที่เดียวจึงหลุดจากกันไม่ได้
const ORDER_DATE_FIELDS = SYNC_DATE_COLS.Orders;
const RECORD_DATE_FIELDS = SYNC_DATE_COLS.Records;
const DELIVERY_DATE_FIELDS = SYNC_DATE_COLS.DeliveryNotes;

/* ---------- ใบส่งสินค้า ---------- */
/*
 * หนึ่งแถว = หนึ่งบรรทัดบนใบส่งสินค้า ไม่ใช่หนึ่งใบ
 * เก็บแบนแบบเดียวกับ records เพื่อให้ merge ด้วย id ได้เหมือนกันหมด
 * ถ้าเก็บ lines[] ซ้อนอยู่ในใบ จะ merge ทีละบรรทัดไม่ได้ และต้องยัด JSON ลงช่องเดียวใน Sheets
 *
 *   id · date · unit (TUE-U/TUE-H/TUE-T) · orderId · pn
 *   perBox · boxes · remainder   ยอดบรรจุตามฟอร์ม FM-ST-07
 *   remark (NEW/RETURN/REWORK) · billNo · deviceName · createdAt · updatedAt · voided
 *
 * ⚠️ ไม่เก็บ qty — เพราะมันคือ perBox*boxes+remainder อยู่แล้ว
 *    เก็บสองที่เมื่อไหร่ก็มีวันไม่ตรงกันเมื่อนั้น ให้คิดตอนใช้ทุกครั้ง
 *
 * orderId ว่างได้ — ในใบจริงมีบรรทัด RETURN/REWORK ที่ไม่มี PO แต่มี P/N
 */
function deliveryQty(l){
  const n = v => Number(v) || 0;
  return n(l.perBox) * n(l.boxes) + n(l.remainder);
}

/** แบ่งยอดรวมออกเป็น กล่องเต็ม + ชิ้นที่เหลือ ตามที่ฟอร์มเข้าใจ
 *
 *  ในฟอร์ม ช่อง "กล่อง" หมายถึงกล่องที่เต็ม และ "เศษ" หมายถึงชิ้นที่เหลือ ไม่ใช่กล่องที่เหลือ
 *  เพราะ Excel คิดเอง จำนวน/PCS = ต่อกล่อง × กล่อง + เศษ แล้วเลขนั้นคือจำนวนที่ลูกค้านับ
 *
 *  ถ้ายังไม่ได้บอกว่ากล่องละเท่าไหร่ ให้ทุกชิ้นเป็นเศษ — ผลคูณยังได้ยอดที่ถูกต้อง
 *  ใบที่ออกไปก่อนกรอกต่อกล่องจึงยังมีจำนวนถูก แค่ไม่บอกว่าแบ่งกี่กล่อง */
function canonicalPack(qty, perBox){
  const q = Math.max(0, Number(qty) || 0), p = Number(perBox) || 0;
  if(p <= 0) return {boxes: 0, remainder: q};
  return {boxes: Math.floor(q / p), remainder: q % p};
}

/** ซ่อมฟิลด์วันที่ในแถวเดียวให้เป็น YYYY-MM-DD · คืน true ถ้ามีการเปลี่ยนแปลงจริง */
function normalizeRowDates(row, fields){
  let changed = false;
  for(const f of fields){
    if(row[f]==null || row[f]==='') continue;
    const fixed = normalizeDateOnly(row[f]);
    if(fixed !== row[f]){ row[f] = fixed; changed = true; }
  }
  return changed;
}

/* ---------- State ---------- */
const STORAGE_KEY = 'tue_order_tracker_v1';
/* ⚠️ ที่เก็บหลักคือ IndexedDB ตั้งแต่ 9 ต.ค. 2026 — localStorage ได้ราว 5 MB และเต็มจริงที่หน้างานแล้ว
   เก็บเป็นข้อความ JSON ใต้คีย์เดิม (E1) เหมือน localStorage ทุกตัวอักษร ห้ามเก็บเป็นอ็อบเจ็กต์ตรง ๆ
   ไม่งั้น Date ที่หลุดเข้า state จะรอดข้ามการรีโหลดเป็น Date แทนที่จะเป็นข้อความเหมือนเดิม (C1)
   localStorage เหลือแค่: ต้นทางตอนย้ายครั้งแรก · ทางสำรองเมื่อเปิด IndexedDB ไม่ได้ · ค่าตั้งซิงค์ (SYNC_KEY) */
const IDB_NAME = 'tue_order_tracker', IDB_STORE = 'kv';
const LEGACY_COPY_KEY = STORAGE_KEY + ':localStorage';   // สำเนาดิบของ localStorage ตอนย้าย (ใน IndexedDB)
const MOVED_KEY = STORAGE_KEY + ':moved';   // ธงใน localStorage: เครื่องนี้ย้ายเข้า IndexedDB แล้ว · localStorage ว่างแล้ว
/* ฟอร์ม FM-ST-07 ที่เครื่องนี้จำไว้ — **คีย์ของตัวเอง ไม่ปนกับ state**
 * ถ้าไปอยู่ใน state ก้อนที่เขียนทุกครั้งที่คีย์ยอดจะโตขึ้นเป็นเมกะ แล้วชนเพดานพื้นที่
 * ซึ่งเคยเกิดมาแล้วตอนยังใช้ localStorage · และมันเป็นไฟล์ของเครื่องใครเครื่องมัน ห้ามซิงค์ */
const DN_TPL_KEY = STORAGE_KEY + ':dnTemplate';
let stateDb = null;      // null = ใช้ localStorage แบบเดิม
let stateReady = false;  // ก่อนโหลดเสร็จ ห้ามบันทึกและห้ามซิงค์ — ไม่งั้น state ว่างจะไปทับของจริง
let syncWaiting;         // มีคนขอซิงค์ระหว่างรอโหลด · ค่าคือ silent ที่ขอ (false ชนะ) · ซิงค์ให้ใน openState
function openStateDb(){
  return new Promise((ok, fail)=>{
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = ()=>r.result.createObjectStore(IDB_STORE);
    r.onsuccess = ()=>ok(r.result);
    r.onerror = ()=>fail(r.error);
  });
}
// fn ถูกเรียกทันที — put() คัดลอกค่า ณ ตอนเรียก และ transaction ทำงานตามลำดับที่สร้าง
function idbTx(mode, fn){
  return new Promise((ok, fail)=>{
    const tx = stateDb.transaction(IDB_STORE, mode), req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = ()=>ok(req.result);
    tx.onerror = tx.onabort = ()=>fail(tx.error);
  });
}
function defaultState(){
  return {
    version:1,
    deviceName:'',
    // ค่าตั้งต้นมาจาก DEFAULT_PROCESSES · null = "ยังไม่กำหนด" → deadline ของขั้นนั้นเป็น null ไม่ตัดสินล่าช้า (A4)
    deadlineOffsets: Object.fromEntries(DEFAULT_PROCESSES.map(p=>[p.id, p.defaultOffset])),
    // รายการขั้นที่ซิงค์มาจากหน้าจัดการขั้นครั้งล่าสุด · null = ใช้ห้าขั้นตั้งต้น (ดู composeProcesses)
    processes: null,
    chartPref:{ mode:'14', from:'', to:'', hidden:[] }, // เครื่องนี้เท่านั้น ไม่ส่งขึ้น Google Sheets
    orders:[],
    records:[],
    deliveryNotes:[],
    deltaWip:[],
    // log การออกใบส่งสินค้า — ซิงค์ข้ามเครื่อง ต่างจาก importHistory ที่เป็นของเครื่องใครเครื่องมัน
    deliveryLog:[],
    importHistory:[]
  };
}
function loadState(raw){   // raw = ข้อความ JSON จาก IndexedDB · ไม่ส่งมา = อ่าน localStorage แบบเดิม
  try{
    if(raw === undefined) raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return Object.assign(base, parsed, {
      deadlineOffsets: Object.assign({}, base.deadlineOffsets, parsed.deadlineOffsets||{}),
      processes: validProcessList(parsed.processes) ? parsed.processes : null,
      chartPref: Object.assign({}, base.chartPref, parsed.chartPref||{}),
      orders: Array.isArray(parsed.orders)? parsed.orders : [],
      records: Array.isArray(parsed.records)? parsed.records : [],
      deliveryNotes: Array.isArray(parsed.deliveryNotes)? parsed.deliveryNotes : [],
      deltaWip: Array.isArray(parsed.deltaWip)? parsed.deltaWip : [],
      deliveryLog: Array.isArray(parsed.deliveryLog)? parsed.deliveryLog : [],
      importHistory: Array.isArray(parsed.importHistory)? parsed.importHistory : []
    });
  }catch(e){ console.error('loadState failed', e); return defaultState(); }
}
/** ⚠️ ต้องมี try/catch — ถ้าพื้นที่เต็ม setItem จะ throw
 *  เดิมไม่มีใครดัก ทำให้ throw ทะลุกลางฟังก์ชันที่เรียก แล้วบรรทัดถัดไป (doSync/renderAll)
 *  ไม่ถูกเรียก · ที่แย่กว่านั้นคือถ้าเกิดตอนบูตใน migrateCorruptedDates แอปจะเปิดไม่ขึ้นเลย
 *  ยอมให้ข้อมูลในหน่วยความจำเดินต่อและบอกคนใช้ ดีกว่าตายเงียบหรือตายทั้งหน้า */
function saveState(){
  if(!stateReady) return false;
  if(stateDb){
    idbTx('readwrite', s=>s.put(JSON.stringify(state), STORAGE_KEY)).catch(e=>{
      console.error('saveState failed', e);
      toast('บันทึกลงเครื่องไม่สำเร็จ — พื้นที่เก็บข้อมูลอาจเต็ม กรุณา Export ไฟล์ข้อมูลเก็บไว้แล้วแจ้งหัวหน้า');
    });
    return true;
  }
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  }catch(e){
    console.error('saveState failed', e);
    toast('บันทึกลงเครื่องไม่สำเร็จ — พื้นที่เก็บข้อมูลอาจเต็ม กรุณา Export ไฟล์ข้อมูลเก็บไว้แล้วแจ้งหัวหน้า');
    return false;
  }
}

/** state จาก IndexedDB · ครั้งแรกของเครื่องนี้ย้ายจาก localStorage มาให้
 *  ⚠️ ลบ localStorage เฉพาะเมื่ออ่านกลับจาก IndexedDB ได้ตรงทุกตัวอักษรแล้ว และเก็บสำเนาดิบไว้ใต้ ':localStorage'
 *  ถ้ามีทั้งสองที่ (แท็บรุ่นเก่ายังเขียน localStorage อยู่) IndexedDB ชนะ ของ localStorage ไม่หาย อยู่ในสำเนาดิบ */
async function bootState(){
  try{
    stateDb = await openStateDb();
    const legacy = localStorage.getItem(STORAGE_KEY);
    if(legacy) await idbTx('readwrite', s=>s.put(legacy, LEGACY_COPY_KEY));
    const saved = await idbTx('readonly', s=>s.get(STORAGE_KEY));
    if(saved){ if(legacy) localStorage.removeItem(STORAGE_KEY); markMoved(); return loadState(saved); }
    const st = loadState(legacy), json = JSON.stringify(st);
    await idbTx('readwrite', s=>s.put(json, STORAGE_KEY));
    if(legacy && await idbTx('readonly', s=>s.get(STORAGE_KEY)) === json) localStorage.removeItem(STORAGE_KEY);
    markMoved();
    return st;
  }catch(e){
    stateDb = null;
    // ย้ายไปแล้ว = localStorage ว่าง · ถ้าเปิดแบบเดิมจะได้หน้าว่างให้คีย์ทับ แล้วของที่คีย์หายตอนบูตครั้งถัดไป
    if(localStorage.getItem(MOVED_KEY)){ console.error('เปิด IndexedDB ไม่ได้ ทั้งที่ข้อมูลย้ายไปอยู่ในนั้นแล้ว', e); return null; }
    console.error('เปิด IndexedDB ไม่ได้ — ใช้ localStorage แบบเดิม', e);
    return loadState();
  }
}
function markMoved(){ try{ localStorage.setItem(MOVED_KEY, '1'); }catch(e){ console.error('ตั้งธงย้ายไม่ได้', e); } }

/** เตรียม state ที่เพิ่งโหลด — ต้องรันหลังโหลดเสร็จเท่านั้น (openState) */
function prepareState(){
  // รายการขั้นที่ได้มาครั้งล่าสุดต้องใช้ตั้งแต่ก่อนวาดจอครั้งแรก — เปิดแบบออฟไลน์ก็ยังได้ขั้นที่เพิ่มไว้
  applyProcessList(composeProcesses(state.processes));
  // Orders/records saved before this sync feature existed (or never successfully pushed) have
  // no _dirty flag at all — treat that as "needs push" so connecting Sheets for the first time
  // uploads everything already sitting on this machine. Items that synced successfully carry an
  // explicit _dirty:false, so this only catches genuinely never-synced data.
  state.orders.forEach(o=>{ if(o._dirty===undefined) o._dirty=true; });
  state.records.forEach(r=>{ if(r._dirty===undefined) r._dirty=true; });
  state.deliveryNotes.forEach(d=>{ if(d._dirty===undefined) d._dirty=true; });
  state.deltaWip.forEach(d=>{ if(d._dirty===undefined) d._dirty=true; });
  state.deliveryLog.forEach(d=>{ if(d._dirty===undefined) d._dirty=true; });

  // ซ่อมข้อมูลที่เพี้ยนค้างอยู่แล้วจากบั๊กวันที่ของ Google Sheets (ดู normalizeDateOnly)
  // แถวที่ค่าเปลี่ยนจริงถูกมาร์ค _dirty เพื่อดันค่าที่ถูกต้องกลับขึ้นเซิร์ฟเวอร์ทับของเดิม
  let fixed = 0;
  state.orders.forEach(o=>{ if(normalizeRowDates(o, ORDER_DATE_FIELDS)){ o._dirty = true; fixed++; } });
  state.records.forEach(r=>{ if(normalizeRowDates(r, RECORD_DATE_FIELDS)){ r._dirty = true; fixed++; } });
  state.deliveryNotes.forEach(d=>{ if(normalizeRowDates(d, DELIVERY_DATE_FIELDS)){ d._dirty = true; fixed++; } });
  state.deliveryLog.forEach(d=>{ if(normalizeRowDates(d, SYNC_DATE_COLS.DeliveryLog)){ d._dirty = true; fixed++; } });
  if(fixed){ saveState(); console.info(`ซ่อมวันที่ที่เพี้ยนจากการซิงค์ ${fixed} รายการ`); }
}

/** เปิดหน้า: รอโหลดเสร็จก่อน แล้วค่อยเตรียม · วาดจอ · ซิงค์ที่มีคนขอไว้ระหว่างรอ */
async function openState(){
  const st = await bootState();
  if(!st){   // stateReady ค้าง false = ห้ามบันทึก ห้ามซิงค์ · จอถูกบังไว้ ไม่ให้คีย์ลงหน้าว่าง
    document.body.insertAdjacentHTML('afterbegin', '<div id="storageLocked" style="position:fixed;inset:0;z-index:9999;background:#fff;color:#b00;padding:40px;font-size:22px;line-height:1.6">⛔ เปิดที่เก็บข้อมูลของเครื่องนี้ไม่ได้ — <b>ห้ามคีย์ยอด</b><br>ปิดเบราว์เซอร์ทุกหน้าต่างแล้วเปิดใหม่ ถ้ายังขึ้นข้อความนี้ให้แจ้งหัวหน้า<br>(ข้อมูลยังอยู่ในเครื่อง ไม่หาย)</div>');
    return;
  }
  state = st;
  stateReady = true;
  try{
    prepareState();
    currentProcess = MAIN_PROCESSES[0];
    renderProcessControls();
    loadSettingsIntoForm();
    renderAll();
    renderSyncBadge();   // ตัวนับ "รอส่ง" ต้องนับจากข้อมูลจริง ไม่ใช่ state ว่างตอนเปิดหน้า
    restoreDnTemplate(); // ไม่ await — ฟอร์มที่จำไว้ไม่ควรถ่วงการเปิดหน้า และพังแล้วต้องไม่ลากหน้าไปด้วย
  }catch(e){
    toast('เปิดหน้าไม่สมบูรณ์ — บางส่วนอาจแสดงผิด กรุณาแจ้งหัวหน้า');
    throw e;   // ปล่อยให้ error หลุดออกไปเหมือนเดิม — เทสที่ตรวจ "ต้องไม่มี error" ยังจับได้
  }finally{
    // ⚠️ ต้องปลดจอจางเสมอ แม้วาดจอพัง (ข้อมูลจริงมีค่าแปลก) — ไม่งั้นทั้งหน้ากดไม่ได้และไม่มีข้อความบอก (ผู้ตรวจ #99)
    document.documentElement.dataset.stateReady = '1';   // ป้ายให้เทสรู้ว่าโหลด · วาดจอเสร็จแล้ว (tests/app-state.js)
  }
  if(syncWaiting !== undefined) doSync(syncWaiting);
}

let state = defaultState();   // ของจริงมาใน openState() ตอนท้ายไฟล์

let workbookGlobal = null;
let pendingImportItems = null;
let pendingMerge = null;
let currentProcess = MAIN_PROCESSES[0];   // ขั้นแรกของสายการผลิต ไม่ใช่ขั้นนับแยกที่อาจถูกแทรกไว้หน้าสุด
let lastRenderedOrderIds = [];
let pendingFocusOrderId = null;

/* ---------- Google Sheets sync (multi-device, offline-first) ---------- */
// Same architecture as the Bin Card system's Google Sheets sync: local writes always land in
// localStorage first regardless of connectivity; a background loop pushes anything flagged
// _dirty and pulls anything newer than the last-seen server timestamp. Conflicts resolve by
// updatedAt (last write wins), except a record with unsent local edits (_dirty:true) is never
// clobbered by an incoming pull until it has been pushed.
const SYNC_KEY = 'tue_order_tracker_sync_v1';
function defaultSyncCfg(){
  /* ⚠️ ทุกตารางที่ซิงค์ต้องมีนาฬิกาของตัวเองครบที่นี่
   *    lastPullDeltaWip เคยตกหล่นตอนเพิ่มตาราง DeltaWip เข้ามา — saveSyncCfg กับ doSync
   *    ใช้มันอยู่ แต่ defaultSyncCfg ไม่เคยประกาศ ค่าจึงเป็น undefined บนเครื่องใหม่
   *    (ไม่ถึงกับข้อมูลหาย เพราะ since ที่เป็น undefined ทำให้ดึงมาทั้งตาราง
   *     แต่เป็นความไม่ตรงกันที่ไม่มีอะไรฟ้อง) · มีเทสคุมไว้แล้วใน gs-server.spec.js */
  return {url:'', token:'', auto:true, lastPullOrders:'', lastPullRecords:'', lastPullDeliveryNotes:'', lastPullDeliveryLog:'',
          lastPullDeltaWip:'', lastOkAt:'', state:'off', error:''};
}
function loadSyncCfg(){
  try{
    const raw = localStorage.getItem(SYNC_KEY);
    if(!raw) return defaultSyncCfg();
    const parsed = JSON.parse(raw);
    // state/error are transient (this session's connection status) — never trust a stale value
    // from a previous page load, always start "off" until the first sync attempt resolves it.
    return Object.assign(defaultSyncCfg(), parsed, {state:'off', error:''});
  }catch(e){ return defaultSyncCfg(); }
}
function saveSyncCfg(){
  /* เก็บเฉพาะฟิลด์ที่ต้องอยู่ข้ามการเปิดโปรแกรม — state กับ error เป็นของชั่วคราวของรอบนี้
   *
   * ⚠️ นาฬิกา pull เก็บด้วยการกวาดคีย์ที่ขึ้นต้นด้วย lastPull ห้ามแจกแจงชื่อเอง
   *    ของเดิมแจกแจงไว้ตรง ๆ พร้อมคอมเมนต์เตือนว่าลืมเติมแล้วนาฬิกาจะรีเซ็ตทุกครั้ง
   *    ที่เปิดโปรแกรม แล้วดึงข้อมูลทั้งกระดานลงมาใหม่ทุกวันโดยไม่มีใครสังเกต
   *    — คำเตือนไม่ช่วยอะไรถ้ายังต้องอาศัยความจำ นี่คือที่ที่สี่ที่เคยมีรายชื่อนาฬิกาซ้ำ
   *    (ผู้ตรวจทักไว้ใน #71) · มีเทสคุมแล้วว่าห้ามเขียนชื่อนาฬิกาในฟังก์ชันนี้ */
  const out = {};
  ['url','token','auto','lastOkAt'].forEach(k=>{ out[k] = syncCfg[k]; });
  Object.keys(syncCfg).forEach(k=>{ if(k.indexOf('lastPull') === 0) out[k] = syncCfg[k]; });
  localStorage.setItem(SYNC_KEY, JSON.stringify(out));
}
let syncCfg = loadSyncCfg();
let syncing = false;
let syncIntervalId = null;

/** คอลัมน์ที่ซิงค์ขึ้น Google Sheets — ต้องตรงกับ google-apps-script.gs ทุกตัว
 *
 *  ⚠️ ฝั่งเซิร์ฟเวอร์เป็นคนตัดสินว่าเก็บคอลัมน์ไหน ฟิลด์ที่ฝั่งโน้นไม่รู้จักจะหายเงียบ ๆ
 *     ไม่มี error ไม่มีอะไรร้อง — เกิดขึ้นจริงมาแล้วกับ planSupport ที่ไม่เคยซิงค์
 *     เลยตั้งแต่ issue #17 กว่าจะรู้ก็หลายเดือน
 *
 *  รายการนี้ไม่ใช่คำอธิบายเฉย ๆ — cleanForPush() ใช้มันจริงตอนส่ง
 *  ฟิลด์ที่ไม่อยู่ในนี้จะไม่ถูกส่ง จึงโกหกไม่ได้
 *  และ tests/sync-contract.spec.js อ่านทั้งไฟล์นี้กับ .gs มาเทียบกันทุกครั้งที่รันเทส */
const SYNC_COLS = {
  // ⚠️ คอลัมน์ใหม่ต้องเติมท้ายสุดเสมอ — ฝั่ง Apps Script เขียนแถวด้วยตำแหน่ง (toRow)
  //    แต่เติมคอลัมน์ที่ขาดต่อท้ายหัวตาราง ลำดับสองฝั่งจึงตรงกันได้ต่อเมื่อเติมท้ายเหมือนกัน
  Orders: ['id','week','poNo','pn','subName','osc','pc','orderQty','orderDate',
           'planWinding','planAssembly','planSupport','planInspection','status','importedAt','updatedAt',
           'voided'],
  Records: ['id','date','orderId','process','qty','note','deviceName',
            'createdAt','updatedAt','voided','batchId'],
  DeliveryNotes: ['id','date','unit','orderId','pn','perBox','boxes','remainder','remark','billNo',
                  'deviceName','createdAt','updatedAt','voided'],
  // override* = ตัวแก้มือเมื่อ Delta ทำ Wip bal. ผิด (15 ก.ย. 2026) · ใบนี้เพิ่มแค่คอลัมน์ หน้าจอแก้มืออยู่ใบถัดไป
  DeltaWip: ['id','orderId','week','wip','fileName',
             'deviceName','createdAt','updatedAt','voided',
             'wipOverride','overrideNote','overrideBy','overrideAt'],
  // log การออกใบส่งสินค้า — หนึ่งแถว = หนึ่งครั้งที่กดออกใบสำเร็จ (เจ้าของสั่ง 10 ต.ค. 2026)
  // no (เลขที่ใบ) คิดจากหน่วย+วัน จึงซ้ำได้เมื่อออกใบเดิมซ้ำ — กุญแจของแถวคือ id
  DeliveryLog: ['id','no','date','unit','week','groups','lines','qty',
                'deviceName','createdAt','updatedAt','voided']
};

/** เอาเฉพาะคอลัมน์ที่ประกาศไว้ขึ้นไป — ฟิลด์ภายในเครื่องอย่าง _dirty ไม่ถูกส่ง (D2) */
function cleanForPush(obj, table){
  const cols = SYNC_COLS[table];
  // ⚠️ พิมพ์ชื่อตารางผิดแล้วตกมาทางนี้เงียบ ๆ = ส่งทั้งแถวแบบเดิม และด่านเทียบคอลัมน์
  //    จะเขียวทั้งที่ตารางนั้นไม่ได้ถูกคุมเลย · ร้องดัง ๆ ดีกว่าปล่อยผ่าน
  //    tests/sync-contract.spec.js ตรวจชื่อตารางของทุก call site ให้อีกชั้น
  if(!cols){
    console.error('cleanForPush: ไม่รู้จักตาราง "'+table+'" — ส่งทั้งแถวขึ้นไปแทน');
    const o = Object.assign({}, obj); delete o._dirty; return o;
  }
  const out = {};
  cols.forEach(c=>{ if(obj[c] !== undefined) out[c] = obj[c]; });
  return out;
}

// text/plain avoids a CORS preflight request, which Apps Script Web Apps don't handle.
async function gsApi(action, body){
  if(!syncCfg.url) throw new Error('ยังไม่ได้ตั้งค่า URL');
  const res = await fetch(syncCfg.url, {
    method:'POST', redirect:'follow',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(Object.assign({action, token:syncCfg.token, device: state.deviceName}, body||{}))
  });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const d = await res.json();
  if(!d.ok) throw new Error(d.error || 'เซิร์ฟเวอร์ตอบกลับผิดพลาด');
  return d;
}

/** รวมแถวที่ดึงมาเข้ากับ array ในเครื่อง (ใช้ได้ทั้ง orders และ records) — id เป็นตัวจับคู่หลัก
 *  normalize ฟิลด์วันที่ก่อนเสมอ เพราะเซิร์ฟเวอร์อาจส่ง timestamp เต็มกลับมาแทน YYYY-MM-DD
 *  (ดู normalizeDateOnly) — ถ้าปล่อยผ่านจะทำให้ deadline คำนวณไม่ได้ทั้งกระดาน */
function mergeRowsInto(listArr, incomingRows, dateFields){
  const byId = new Map(listArr.map(x=>[x.id, x]));
  let added=0, updated=0;
  for(const r of incomingRows){
    if(dateFields) normalizeRowDates(r, dateFields);
    const local = byId.get(r.id);
    if(!local){ listArr.push(Object.assign({}, r, {_dirty:false})); added++; continue; }
    if(local._dirty) continue; // ของเรายังไม่ได้ส่งขึ้น อย่าเพิ่งทับ
    if(String(r.updatedAt||'') > String(local.updatedAt||'')){
      Object.assign(local, r, {_dirty:false}); updated++;
    }
  }
  return {added, updated};
}

function renderSyncBadge(){
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncLabel');
  if(!dot || !label) return;
  // ⚠️ เพิ่มตารางที่ซิงค์แล้วต้องเติมที่นี่ด้วย ไม่มีด่านไหนคุมให้ — ต่างจากนาฬิกา lastPull*
  //    ที่ tests/gs-server.spec.js กวาดชื่อจาก doSync มาเทียบอัตโนมัติ
  //    ลืมเติม = ป้ายขึ้น "ซิงค์แล้ว" ทั้งที่ยังมีแถวค้างไม่ได้ส่ง (ผู้ตรวจทักไว้ใน #102)
  const pending = state.orders.filter(o=>o._dirty).length
                + state.records.filter(r=>r._dirty).length
                + state.deliveryNotes.filter(d=>d._dirty).length
                + state.deltaWip.filter(d=>d._dirty).length
                + state.deliveryLog.filter(d=>d._dirty).length;
  let cls='', text='';
  if(!syncCfg.url){ text = 'ยังไม่เชื่อมต่อ'; }
  else if(syncCfg.state==='busy'){ cls='busy'; text = 'กำลังซิงค์...'; }
  else if(syncCfg.state==='error'){ cls='error'; text = 'เชื่อมต่อไม่ได้' + (pending? ` · ค้าง ${pending}`:''); }
  else if(pending){ cls='pending'; text = `รอส่ง ${pending}`; }
  else { cls='ok'; text = 'ซิงค์แล้ว'; }
  dot.className = 'dot' + (cls? ' '+cls : '');
  label.textContent = text;

  const statusLine = document.getElementById('gsStatusLine');
  if(statusLine){
    if(!syncCfg.url) statusLine.textContent = 'ยังไม่ได้ตั้งค่า';
    else {
      const lastOk = syncCfg.lastOkAt ? new Date(syncCfg.lastOkAt).toLocaleString('th-TH') : '-';
      statusLine.textContent = `สถานะ: ${text} · ซิงค์สำเร็จล่าสุด: ${lastOk}` + (syncCfg.error? ` · ข้อผิดพลาดล่าสุด: ${syncCfg.error}` : '');
    }
  }
}

async function doSync(silent = true){
  if(!syncCfg.url || syncing) return;
  if(!stateReady){ syncWaiting = syncWaiting === false ? false : silent; return; }
  syncing = true; syncCfg.state = 'busy'; syncCfg.error = ''; renderSyncBadge();
  try{
    const dirtyOrders = state.orders.filter(o=>o._dirty);
    if(dirtyOrders.length){
      const res = await gsApi('pushRows', {table:'Orders', rows: dirtyOrders.map(r=>cleanForPush(r, 'Orders'))});
      dirtyOrders.forEach(o=>{ o._dirty=false; if(res.serverTime) o.updatedAt=res.serverTime; });
    }
    const dirtyRecords = state.records.filter(r=>r._dirty);
    if(dirtyRecords.length){
      const res = await gsApi('pushRows', {table:'Records', rows: dirtyRecords.map(r=>cleanForPush(r, 'Records'))});
      dirtyRecords.forEach(r=>{ r._dirty=false; if(res.serverTime) r.updatedAt=res.serverTime; });
    }

    // ── ใบส่งสินค้า ────────────────────────────────────────────
    // แยก try/catch ของตัวเอง เพราะ Apps Script ที่ยังไม่ได้ re-deploy จะไม่รู้จักตารางนี้
    // ถ้าปล่อยให้ throw ออกไป แผนงานกับยอดผลิตจะซิงค์ไม่ได้ทั้งหมดตามไปด้วย
    // ระหว่างนั้นแถวยังคง _dirty อยู่ ป้ายจะขึ้น "รอส่ง n" ไม่ใช่หายเงียบ
    let rd = {added:0, updated:0};
    try{
      const dirtyNotes = state.deliveryNotes.filter(d=>d._dirty);
      if(dirtyNotes.length){
        const res = await gsApi('pushRows', {table:'DeliveryNotes', rows: dirtyNotes.map(r=>cleanForPush(r, 'DeliveryNotes'))});
        dirtyNotes.forEach(d=>{ d._dirty=false; if(res.serverTime) d.updatedAt=res.serverTime; });
      }
      const pulledNotes = await gsApi('pullRows', {table:'DeliveryNotes', since: syncCfg.lastPullDeliveryNotes});
      rd = mergeRowsInto(state.deliveryNotes, pulledNotes.rows||[], DELIVERY_DATE_FIELDS);
      syncCfg.lastPullDeliveryNotes = pulledNotes.serverTime;
    }catch(e){
      console.warn('ซิงค์ใบส่งสินค้าไม่สำเร็จ — เซิร์ฟเวอร์อาจยังไม่ได้ re-deploy', e.message);
    }

    // ── ยอดค้างส่งจากไฟล์ Call In ของ Delta ────────────────────
    // แยก try/catch ของตัวเองด้วยเหตุผลเดียวกับใบส่งสินค้า
    let rw = {added:0, updated:0};
    try{
      const dirtyWip = state.deltaWip.filter(d=>d._dirty);
      if(dirtyWip.length){
        const res = await gsApi('pushRows', {table:'DeltaWip', rows: dirtyWip.map(r=>cleanForPush(r, 'DeltaWip'))});
        dirtyWip.forEach(d=>{ d._dirty=false; if(res.serverTime) d.updatedAt=res.serverTime; });
      }
      const pulledWip = await gsApi('pullRows', {table:'DeltaWip', since: syncCfg.lastPullDeltaWip});
      rw = mergeRowsInto(state.deltaWip, pulledWip.rows||[], null);
      syncCfg.lastPullDeltaWip = pulledWip.serverTime;
    }catch(e){
      console.warn('ซิงค์ยอดของ Delta ไม่สำเร็จ — เซิร์ฟเวอร์อาจยังไม่ได้ re-deploy', e.message);
    }

    // ── log การออกใบส่งสินค้า ──────────────────────────────────
    // แยก try/catch ของตัวเองด้วยเหตุผลเดียวกับสองตารางข้างบน — ตารางนี้เพิ่งเพิ่ม
    // เครื่องที่ยังไม่ได้ redeploy จะไม่รู้จัก ถ้าปล่อยให้ throw แผนงานกับยอดผลิตจะซิงค์ไม่ได้ตามไปด้วย
    let rl = {added:0, updated:0};
    try{
      const dirtyLog = state.deliveryLog.filter(d=>d._dirty);
      if(dirtyLog.length){
        const res = await gsApi('pushRows', {table:'DeliveryLog', rows: dirtyLog.map(r=>cleanForPush(r, 'DeliveryLog'))});
        dirtyLog.forEach(d=>{ d._dirty=false; if(res.serverTime) d.updatedAt=res.serverTime; });
      }
      const pulledLog = await gsApi('pullRows', {table:'DeliveryLog', since: syncCfg.lastPullDeliveryLog});
      rl = mergeRowsInto(state.deliveryLog, pulledLog.rows||[], SYNC_DATE_COLS.DeliveryLog);
      syncCfg.lastPullDeliveryLog = pulledLog.serverTime;
    }catch(e){
      console.warn('ซิงค์ log ใบส่งสินค้าไม่สำเร็จ — เซิร์ฟเวอร์อาจยังไม่ได้ re-deploy', e.message);
    }

    const pulledOrders = await gsApi('pullRows', {table:'Orders', since: syncCfg.lastPullOrders});
    const ro = mergeRowsInto(state.orders, pulledOrders.rows||[], ORDER_DATE_FIELDS);
    syncCfg.lastPullOrders = pulledOrders.serverTime;

    const pulledRecords = await gsApi('pullRows', {table:'Records', since: syncCfg.lastPullRecords});
    const rr = mergeRowsInto(state.records, pulledRecords.rows||[], RECORD_DATE_FIELDS);
    syncCfg.lastPullRecords = pulledRecords.serverTime;

    let processesChanged = false;
    try{
      const ds = await gsApi('pullSettings', {});
      if(ds.deadlineOffsets) state.deadlineOffsets = Object.assign({}, state.deadlineOffsets, ds.deadlineOffsets);
      // รายการขั้นที่เครื่องอื่นแก้ไว้ — ปุ่มกับคอลัมน์ต้องเปลี่ยนตามทันที ไม่ต้องรอโหลดหน้าใหม่
      processAdminInfo = ds.processAdmin || null;
      processesChanged = adoptProcessList(ds.processes);
    }catch(e){ /* เซิร์ฟเวอร์เวอร์ชันเก่ายังไม่มีคำสั่งนี้ — ไม่ใช่ปัญหาใหญ่ ข้ามไป */ }

    saveState(); saveSyncCfg();
    syncCfg.state = 'ok'; syncCfg.lastOkAt = new Date().toISOString();
    renderSyncBadge();
    const pulledCount = ro.added+ro.updated+rr.added+rr.updated+rd.added+rd.updated+rw.added+rw.updated+rl.added+rl.updated;
    if(pulledCount > 0 || processesChanged) renderAll();
    if(!silent) toast(`ซิงค์แล้ว · รับมา ${pulledCount}`);
  }catch(e){
    syncCfg.state = 'error'; syncCfg.error = e.message;
    renderSyncBadge();
    if(!silent) toast('ซิงค์ไม่สำเร็จ: '+e.message);
  }finally{ syncing = false; }
}

async function gsTestConn(){
  try{
    syncCfg.state = 'busy'; renderSyncBadge();
    const d = await gsApi('ping', {});
    syncCfg.state = 'ok'; syncCfg.error = ''; saveSyncCfg(); renderSyncBadge();
    toast(`เชื่อมต่อได้ · ${d.spreadsheet} · Orders ${d.orderCount} · Records ${d.recordCount}`);
  }catch(e){
    syncCfg.state = 'error'; syncCfg.error = e.message; renderSyncBadge();
    toast('เชื่อมต่อไม่ได้: '+e.message);
  }
}

async function gsConnectAndPull(){
  syncCfg.error = '';
  try{ await gsApi('ping', {}); }
  catch(e){ syncCfg.state='error'; syncCfg.error='เชื่อมต่อไม่ได้: '+e.message; renderSyncBadge(); toast(syncCfg.error); return; }
  saveSyncCfg();
  await doSync(false);
}

function gsCopySetupLink(){
  const link = location.origin + location.pathname + '#gsurl=' + encodeURIComponent(syncCfg.url) + '&gstoken=' + encodeURIComponent(syncCfg.token);
  navigator.clipboard.writeText(link)
    .then(()=>toast('คัดลอกลิงก์แล้ว — เปิดลิงก์นี้ที่เครื่องใหม่ได้เลย'))
    .catch(()=>prompt('คัดลอกลิงก์นี้ไปเปิดที่เครื่องใหม่:', link));
}

/** ล้างนาฬิกา "ดึงมาถึงไหนแล้ว" ของทุกตาราง เพื่อให้ซิงค์รอบหน้าดึงกลับมาทั้งหมด
 *
 *  ⚠️ ที่เดียวในโปรแกรมที่รู้ว่ามีนาฬิกากี่ตัว ห้ามเขียนรายชื่อซ้ำที่อื่นเด็ดขาด
 *
 *     เคยเขียนซ้ำสามที่ (ปุ่มกู้ · ปุ่มลบข้อมูลทั้งหมด · defaultSyncCfg)
 *     พอเพิ่มตาราง DeliveryNotes กับ DeltaWip เข้ามา เติมไม่ครบทั้งสามที่
 *     ปุ่มลบข้อมูลทั้งหมดจึงล้างข้อมูลในเครื่องหมดแต่รีเซ็ตนาฬิกาแค่สองตัว
 *     = ใบส่งสินค้ากับยอดของ Delta หายถาวรจากเครื่องนั้น ทั้งที่เซิร์ฟเวอร์ยังมีครบ
 *     และคอมเมนต์ตรงนั้นก็เขียนไว้เองว่า "ดึงของทั้งหมดกลับมาใหม่" ซึ่งไม่จริง
 *
 *     เทสคุมไว้แล้วว่าห้ามมีการล้างนาฬิกาที่อื่นนอกจากฟังก์ชันนี้ */
function resetPullClocks(){
  Object.keys(syncCfg).forEach(k=>{ if(k.indexOf('lastPull') === 0) syncCfg[k] = ''; });
}

function gsResetPullClock(){
  if(!confirm('ดึงรายการทั้งหมดใหม่ตั้งแต่ต้น? ใช้เมื่อสงสัยว่าข้อมูลไม่ครบ')) return;
  resetPullClocks();
  saveSyncCfg(); doSync(false);
}

/* ---------- แก้ไฟล์ Excel เฉพาะช่องที่ต้องแก้ ---------- */
/*
 * ⚠️ ทำไมไม่ใช้ ExcelJS เขียนไฟล์นี้ — อ่านก่อนคิดจะ "ทำให้ง่ายกว่านี้"
 *
 * ExcelJS อ่านไฟล์เข้ามาเป็นโครงสร้างของมันเอง แล้วเขียนออกใหม่ทั้งไฟล์
 * ทุกอย่างที่มันไม่รู้จักจะหายไปเงียบ ๆ ไม่มี error ให้เห็น ทดสอบกับไฟล์จริงแล้วพบว่า
 *
 *   Daily Call In  สูตร VLOOKUP ข้ามไฟล์ 698 สูตรหายเกลี้ยง พร้อม external link 3 ตัว
 *                  คอมเมนต์ในเซลล์ และค่าตั้งเครื่องพิมพ์
 *   FM-ST-07       xl/drawings/ ถูกตัดทิ้งทั้งหมด โลโก้บริษัทเลยไม่ขึ้นบนกระดาษ
 *                  (ไฟล์รูปยังอยู่ในซิป แต่ไม่มีอะไรบอกว่าให้วางตรงไหน)
 *
 * ไฟล์พวกนี้เป็นเอกสารที่ส่งลูกค้าทุกวัน ยอมให้พังแบบนั้นไม่ได้
 * จึงเปิดไฟล์เป็นซิปแล้วแก้เฉพาะช่องที่ต้องแก้ ส่วนที่เหลือคัดลอกไปทั้งดุ้น
 * ของที่เราไม่ได้แตะจึงรอดแน่นอน เพราะไม่เคยถูกอ่านเข้ามาตีความตั้งแต่แรก
 */

const XL_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XL_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const parseXml = t => new DOMParser().parseFromString(t, 'application/xml');
const serializeXml = doc => new XMLSerializer().serializeToString(doc);

/* ---------- ทำให้ Excel คิดสูตรใหม่หลังเราแก้ช่องต้นทาง ----------
 *
 * ⚠️ Excel เชื่อ "ค่าที่แคชไว้" ในช่องสูตร ไม่ได้คิดใหม่ให้เองเสมอไป
 *
 * ในไฟล์ FM-ST-07 จริง ช่องจำนวน/PCS เก็บไว้แบบนี้
 *     <c r="P10"><f>M10*N10+O10</f><v>0</v></c>
 * เลข 0 ตัวหลังคือค่าที่ Excel คำนวณไว้ครั้งสุดท้ายตอนที่ M/N/O ยังว่าง
 * เราเติม M/N/O ด้วยการเขียน XML ตรง ๆ Excel จึงไม่รู้ว่าค่าที่แคชไว้เก่าไปแล้ว
 * แล้วโชว์ 0 ทั้งที่ช่องต้นทางมีเลขครบ · ยอดรวมท้ายตารางก็ 0 ตามกันทั้งใบ
 *
 * พนักงานเจอของจริงเมื่อ 31 ส.ค. 2026 — ใบส่งของที่ปริ้นออกมามีจำนวนเป็น 0
 * อาการนี้เงียบสนิท ไฟล์เปิดได้ปกติ ไม่มี error และสูตรยังอยู่ครบถ้าคลิกเข้าไปดูในช่อง
 * จึงดูไม่ออกจากตัวไฟล์ว่าผิด ต้องเอาไปเทียบกับที่คีย์ไว้ในโปรแกรมถึงจะรู้
 *
 * ปิดสองชั้น เพราะชั้นเดียวไม่พอ
 *   1. ล้างค่าที่แคชไว้ในชีตที่เราเขียนทับ — ช่องว่างคือ "ยังไม่ได้คิด" ซึ่งคนดูออก
 *      ต่างจากเลข 0 ที่หน้าตาเหมือนยอดจริง แล้วหลุดไปถึงลูกค้าได้
 *   2. สั่งให้คิดใหม่ทั้งไฟล์ตอนเปิด — คลุมสูตรในชีตอื่นที่อ้างถึงชีตที่เราแก้ด้วย
 *
 * ห้ามแก้ด้วยการให้แอปคำนวณค่าใส่ลงไปเอง — นั่นคือการมีสูตรสองชุดที่ต้องตรงกันตลอดไป
 * ถ้าวันหนึ่งฟอร์มเปลี่ยนสูตร ยอดในไฟล์จะผิดเงียบ ๆ อีกแบบหนึ่ง
 */

/** ล้างค่าที่แคชไว้ในช่องสูตรทุกช่องของชีตหนึ่ง · คืนจำนวนช่องที่ล้าง */
function clearCachedFormulaValues(doc){
  let n = 0;
  Array.from(doc.getElementsByTagNameNS(XL_NS, 'c')).forEach(c=>{
    if(!c.getElementsByTagNameNS(XL_NS, 'f').length) return;
    Array.from(c.getElementsByTagNameNS(XL_NS, 'v')).forEach(v=> c.removeChild(v));
    // t="str" บอกว่าค่าที่แคชไว้เป็นข้อความ พอไม่มีค่าแล้วก็ต้องเอาออกด้วย
    if(c.getAttribute('t') === 'str') c.removeAttribute('t');
    n++;
  });
  return n;
}

/** ลำดับลูกของ <workbook> ที่ต้องอยู่ "หลัง" calcPr ตามสเปค OOXML
 *  ถ้าแทรกผิดลำดับ Excel จะฟ้องว่าไฟล์เสียและขอซ่อมให้ ซึ่งน่าตกใจกว่าเลขผิด */
const WB_AFTER_CALCPR = ['oleSize','customWorkbookViews','pivotCaches','smartTagPr',
  'smartTagTypes','webPublishing','fileRecoveryPr','webPublishObjects','extLst'];

/** สั่ง Excel ให้คิดสูตรใหม่ทั้งไฟล์ตอนเปิด */
async function setFullCalcOnLoad(zip){
  const f = zip.file('xl/workbook.xml');
  if(!f) return false;
  const doc = parseXml(await f.async('string'));
  const wb = doc.getElementsByTagNameNS(XL_NS, 'workbook')[0];
  if(!wb) return false;
  let calcPr = doc.getElementsByTagNameNS(XL_NS, 'calcPr')[0];
  if(!calcPr){
    calcPr = doc.createElementNS(XL_NS, 'calcPr');
    const after = Array.from(wb.children)
      .find(el => WB_AFTER_CALCPR.indexOf(el.localName) > -1) || null;
    wb.insertBefore(calcPr, after);
  }
  calcPr.setAttribute('fullCalcOnLoad', '1');
  // calcCompleted="0" ค้างอยู่ในฟอร์มจริง แปลว่ารอบคำนวณล่าสุดไม่จบ — ลบทิ้งให้สถานะไม่ขัดกันเอง
  calcPr.removeAttribute('calcCompleted');
  zip.file('xl/workbook.xml', serializeXml(doc));
  return true;
}

/** 'AB12' -> 'AB' · 'AB' -> 28 (A คือ 1) */
const colOfRef = ref => String(ref||'').replace(/[0-9]+$/, '');
function colIndex(col){
  let n = 0;
  for(const ch of String(col).toUpperCase()) n = n*26 + (ch.charCodeAt(0)-64);
  return n;
}

/** ข้อความในตาราง sharedStrings — ช่องที่เป็นข้อความส่วนใหญ่เก็บแค่เลขอ้างอิงมาที่นี่ */
async function readSharedStrings(zip){
  const f = zip.file('xl/sharedStrings.xml');
  if(!f) return [];
  const doc = parseXml(await f.async('string'));
  return Array.from(doc.getElementsByTagNameNS(XL_NS, 'si'))
    .map(si => Array.from(si.getElementsByTagNameNS(XL_NS, 't')).map(t=>t.textContent).join(''));
}

/** ชื่อชีตที่คนเห็น -> path ของ xml จริงในซิป (sheet1.xml ไม่จำเป็นต้องเป็นชีตแรกที่ตาเห็น) */
async function sheetPathMap(zip){
  const wbDoc = parseXml(await zip.file('xl/workbook.xml').async('string'));
  const relDoc = parseXml(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
  const target = {};
  Array.from(relDoc.getElementsByTagName('Relationship')).forEach(r=>{
    target[r.getAttribute('Id')] = r.getAttribute('Target');
  });
  const map = {};
  Array.from(wbDoc.getElementsByTagNameNS(XL_NS, 'sheet')).forEach(sh=>{
    const rid = sh.getAttributeNS(XL_REL_NS, 'id') || sh.getAttribute('r:id');
    let t = target[rid] || '';
    if(t.charAt(0) === '/') t = t.slice(1); else t = 'xl/' + t.replace(/^\.\//, '');
    map[sh.getAttribute('name')] = t;
  });
  return map;
}

/** ค่าที่คนเห็นในช่องหนึ่ง — คืนเป็นข้อความเสมอเพื่อเอาไปจับคู่ */
function cellText(c, shared){
  if(!c) return '';
  const t = c.getAttribute('t');
  if(t === 'inlineStr'){
    const el = c.getElementsByTagNameNS(XL_NS, 't')[0];
    return el ? el.textContent.trim() : '';
  }
  const v = c.getElementsByTagNameNS(XL_NS, 'v')[0];
  if(!v) return '';
  if(t === 's'){
    const s = shared[Number(v.textContent)];
    return s == null ? '' : String(s).trim();
  }
  return String(v.textContent).trim();
}

/** เขียนตัวเลขลงช่อง โดยรักษารูปแบบ (เส้นขอบ สี ทศนิยม) ของช่องเดิมไว้
 *  ถ้าแถวนั้นยังไม่มีช่องนี้เลย ต้องสร้างใหม่และ "แทรกให้ถูกลำดับคอลัมน์"
 *  เพราะ Excel อ่านช่องในแถวตามลำดับ ถ้าสลับลำดับไฟล์จะเสีย */
function setNumberCell(doc, rowEl, col, num, fallbackStyle){
  const ref = col + rowEl.getAttribute('r');
  let c = null;
  for(const el of Array.from(rowEl.children)){
    if(el.getAttribute('r') === ref){ c = el; break; }
  }
  if(!c){
    // ⚠️ ต้องใช้ createElementNS — ถ้าใช้ createElement ธรรมดา ตัวแปลงจะเติม xmlns="" ให้
    //    แล้ว Excel จะฟ้องว่าไฟล์เสีย
    c = doc.createElementNS(XL_NS, 'c');
    c.setAttribute('r', ref);
    if(fallbackStyle != null) c.setAttribute('s', fallbackStyle);
    const want = colIndex(col);
    let before = null;
    for(const el of Array.from(rowEl.children)){
      if(colIndex(colOfRef(el.getAttribute('r'))) > want){ before = el; break; }
    }
    rowEl.insertBefore(c, before);
  }
  c.removeAttribute('t');                       // เป็นตัวเลข ไม่ใช่ข้อความ
  while(c.firstChild) c.removeChild(c.firstChild);  // ถ้าเคยเป็นสูตร ต้องเอาสูตรออกด้วย
  const v = doc.createElementNS(XL_NS, 'v');
  v.textContent = String(num);
  c.appendChild(v);
}

/** ยอดที่ยังไม่ได้ส่งของใบนี้ = PO QTY − ยอดส่งสะสม (ครอบไม่ให้ติดลบ)
 *
 *  เจ้าของยืนยันว่านี่คือ "Wip bal." ในฟอร์มของบริษัท และเท่ากับผลรวมถัง WIP ทั้งห้าถังพอดี
 *  (ยังไม่เริ่ม + ค้าง Assembly + Support + Inspection + รอส่ง) เพราะตัวกลางหักกันหมด
 *  ใช้สูตรตรงแทนการไล่บวกทีละถัง เพราะทนกว่าเมื่อเจอใบที่คีย์ยอดผิดลำดับ */
function wipBalance(order, cum){
  return Math.max(0, (order.orderQty||0) - ((cum && cum.shipping) || 0));
}

/** ใบสั่งที่ยังใช้งานอยู่ — ตัดใบที่ถูกยกเลิกออก (พนักงานแจ้ง 5 ก.ย. 2026 ว่านำเข้าผิดแล้วลบไม่ได้)
 *
 *  ⚠️ ยกเลิก ไม่ใช่ลบ (B1) — ลบออกจาก array เฉย ๆ ไม่ได้ผล เพราะรอบซิงค์ถัดไปดึงกลับมา
 *     และยอดที่คีย์ไว้ทุกรายการอ้าง orderId อยู่ ใบหายจริงเมื่อไหร่ยอดกลายเป็นกำพร้า
 *
 *  ⚠️ ใช้เฉพาะที่ "ไล่รายการใบสั่ง" · ที่ค้นใบจาก orderId ของยอดที่คีย์ไว้ (พวก orderById)
 *     ต้องเห็นใบที่ยกเลิกด้วย ไม่งั้นหน้าแก้ไข/ลบรายการจะโชว์ PO เป็น "?" แล้วตามไม่ได้ */
function activeOrders(){
  return state.orders.filter(o => !o.voided);
}

/** แถว deltaWip ไหน "ใหม่กว่า" กัน — ที่เดียวในโปรแกรมที่ตัดสินเรื่องนี้
 *
 *  ⚠️ ตัดสินด้วย createdAt ห้ามใช้เลขงวด และห้ามใช้ updatedAt
 *
 *     เลขงวด — ปลายปี wk52 -> wk01 เลขน้อยลงแต่ใหม่กว่า ถ้าเทียบด้วยตัวเลข
 *     ทั้งกระดานจะค้างอยู่ที่ wk52 ข้ามปีไปเลย
 *
 *     updatedAt — ถูกซิงค์เขียนทับด้วยเวลาเซิร์ฟเวอร์ (D4) และแถวที่ยังไม่ได้ส่งขึ้น
 *     ถูกมาร์ค _dirty ใหม่ตอนบูต (D5) เครื่องที่ออฟไลน์แล้วดันของงวดเก่าขึ้นไป
 *     จะทำให้งวดเก่ากลายเป็น "ใหม่ที่สุด" ของทุกเครื่อง
 *
 *  createdAt เท่ากันเป๊ะเกิดได้ตอนนำเข้าสองชีตในวินาทีเดียวกัน — ตัดด้วยเลขงวดให้ผลนิ่ง
 *
 *  ⚠️ เขียนที่เดียว เพราะเคยเขียนซ้ำใน deltaWipOf กับ currentDeltaWeek แบบตัวอักษรต่อตัวอักษร
 *     แก้ที่หนึ่งลืมอีกที่เมื่อไหร่ = จอกับกระดาษบอกคนละงวดโดยไม่มีอะไรฟ้อง */
function deltaWipNewer(row, than){
  const a = String(row.createdAt||''), b = String(than.createdAt||'');
  if(a !== b) return a > b;
  return (Number(row.week)||0) > (Number(than.week)||0);
}

/** ยอดค้างส่งที่ Delta บันทึกไว้ สำหรับใบสั่งใบหนึ่ง — เอาแถวที่นำเข้าใหม่สุด
 *
 *  ⚠️ นี่ไม่ใช่ยอดเดียวกับ wipBalance() ห้ามเอามาแทนกัน
 *     wipBalance() คือยอดค้างตามบัญชีของเรา — ใช้ตัดสินว่าจะโชว์ PO ไหนบนจอ
 *     ตัวนี้คือยอดค้างตามบัญชีของ Delta — ใช้เป็นเลขที่พิมพ์ลงกระดาษเท่านั้น
 *     สองเลขนี้ไม่ตรงกันได้ และนั่นคือข้อมูล ไม่ใช่บั๊ก
 *
 *  ตั้งแต่ 5 ก.ย. 2026 การนำเข้าไฟล์ Call In ยกเลิกยอดเดิม "ของใบที่อยู่ในชีตนั้น" ก่อนเขียนใหม่
 *  (ดู saveDeltaWip) ปกติจึงเหลือแถวที่ยังไม่ถูกยกเลิกไม่เกินใบละหนึ่งแถว
 *  การเลือกจึงแทบไม่มีผลแล้ว ที่เหลือไว้เป็นตัวกันเหนียวเผื่อเครื่องที่ยังไม่ได้อัปเดต
 *  ซิงค์ของเก่ากลับเข้ามา
 *
 *  ⚠️ "มีแถว" กับ "มียอด" ไม่ใช่เรื่องเดียวกันตั้งแต่ 5 ก.ย. 2026
 *     มีแถว = Delta เอ่ยถึงใบนี้ในไฟล์ที่นำเข้า
 *     มียอด = เขากรอกตัวเลขมาด้วย -> เอาไปพิมพ์ลงกระดาษได้
 *     แถวที่ wip ว่าง คือ "อยู่ในไฟล์แต่เขาไม่ได้ระบุยอด" คนละเรื่องกับ "ค้างศูนย์"
 *
 *  ⚠️ คืนเฉพาะแถวของงวดล่าสุด (currentDeltaWeek) — แถวของงวดเก่าไม่ใช่ยอดค้างของตอนนี้
 *     Delta ไม่ใส่ 0 ให้ใบที่ส่งครบแล้ว แต่ตัดใบนั้นออกจากไฟล์งวดใหม่ไปเลย
 *     saveDeltaWip ล้างเฉพาะใบที่อยู่ในไฟล์ แถวของงวดก่อนจึงค้างอยู่เป็นประวัติ (ตั้งใจ — เทส #62)
 *     ถ้าหยิบแถวล่าสุดของใบโดยไม่ดูงวด ยอดของงวดเก่าจะค้างไปตลอด (เจ้าของเจอ 14 ก.ย. 2026):
 *     หน้า FG นับยอดค้างของ Delta เกิน · ใบที่ส่งครบแล้วโผล่ในหน้าใบส่งสินค้า · กระดาษพิมพ์ยอดเก่า
 *
 *  week ให้ผู้เรียกคิดครั้งเดียวแล้วส่งมา — เรียก currentDeltaWeek() ต่อใบจะวนทั้งตารางซ้ำทุกใบ */
function deltaWipOf(orderId, week = currentDeltaWeek()){
  let best = null;
  state.deltaWip.forEach(d=>{
    if(d.voided || d.orderId !== orderId) return;
    if(!best || deltaWipNewer(d, best)) best = d;
  });
  return best && String(best.week) === String(week) ? best : null;
}

/** ยอดตัวเลขของแถว deltaWip — คืน null ถ้าไฟล์ปล่อยช่องนั้นว่างไว้
 *
 *  ⚠️ ห้ามใช้ Number(d.wip)||0 ตรง ๆ · ช่องว่างจะกลายเป็น 0 แล้ว 0 บนกระดาษ
 *     อ่านว่า "ไม่มีของค้างแล้ว" ซึ่งเป็นคนละความหมายกับ "เขาไม่ได้บอกมา"
 *
 *  ⚠️ ต้องรับทั้ง null และ '' · เราเก็บลงเครื่องเป็น null แต่ Apps Script เขียนลงชีต
 *     ด้วย toRow() ที่แปลง null เป็น '' พอ pull กลับมาจึงได้สตริงว่าง (ไม่ใช่ 0
 *     เพราะ getValues() คืน '' สำหรับเซลล์เปล่า) ส่วนศูนย์จริงกลับมาเป็นเลข 0 */
function deltaWipNum(d){
  // ⚠️ ยอดที่แก้มือชนะยอดในไฟล์ทุกที่ รวมช่อง Wip bal. บนกระดาษ (เจ้าของสั่ง 15 ก.ย. 2026)
  //    ทุกจุดอ่านยอดของ Delta ผ่านฟังก์ชันนี้ จึงไม่ต้องไปแก้ทีละหน้า · ยอดดิบของไฟล์ดูที่ deltaWipFileNum
  const o = deltaWipOverride(d);
  return o != null ? o : deltaWipFileNum(d);
}

/** ยอดตามไฟล์ของ Delta ล้วน ๆ ไม่สนการแก้มือ — ใช้โชว์คู่กับยอดที่แก้ · กติกาช่องว่างเหมือน deltaWipNum */
function deltaWipFileNum(d){
  if(!d) return null;
  const txt = String(d.wip == null ? '' : d.wip).trim();
  if(txt === '') return null;
  const n = Number(txt);
  return isFinite(n) ? n : null;
}

/** ยอดที่แก้มือไว้บนแถวนี้ — null ถ้าไม่ได้แก้หรือยกเลิกแล้ว (รับทั้ง null และ '' เหตุผลเดียวกับ deltaWipNum) */
function deltaWipOverride(d){
  if(!d) return null;
  const txt = String(d.wipOverride == null ? '' : d.wipOverride).trim();
  if(txt === '') return null;
  const n = Number(txt);
  return isFinite(n) ? n : null;
}

/** ข้อความอธิบายการแก้มือ — ยอดในไฟล์ · ยอดที่แก้ · ใครแก้ · เมื่อไหร่ · เพราะอะไร (ยังไม่ escape) */
function deltaOverrideTip(d){
  const file = deltaWipFileNum(d), ov = deltaWipOverride(d);
  const t = Date.parse(d.overrideAt);
  return `ไฟล์ของ Delta ${file == null ? 'ว่าง' : numFmt(file)} → แก้มือเป็น ${numFmt(ov)}`
    + ` · โดย ${d.overrideBy || '-'}` + (isFinite(t) ? ` · ${fmtDateTH(isoLocal(new Date(t)))}` : '')
    + ` · เหตุผล: ${d.overrideNote || '-'}`;
}

/** ยอดค้างของ Delta หลังหักยอดที่เราส่งแล้วแต่ Delta ยังไม่นับ — ใช้เฉพาะหน้ายอดคงคลัง FG
 *
 *  ไฟล์ Call In บันทึกยอดส่งช้ากว่าเราไม่แน่นอน — เจ้าของเจอ 15 ก.ย. 2026: ส่งของไปหลายรอบก่อนวันนำเข้าไฟล์
 *  แต่ไฟล์ยังให้ค้างเต็มยอดสั่ง (Delta ยังไม่บันทึกยอดส่งเลย) · เจ้าของจึงเลือกเกณฑ์ที่ไม่ใช้วันที่
 *
 *    Delta นับส่งแล้ว  = ยอดสั่ง − Wip bal. ในไฟล์
 *    Delta ยังไม่นับ   = ยอดที่เราส่งทั้งหมด − ที่ Delta นับแล้ว   (ไม่ต่ำกว่า 0)
 *    ยอดที่แสดง        = Wip bal. − ที่ Delta ยังไม่นับ             (ไม่ต่ำกว่า 0)
 *
 *  ⚠️ ห้ามเอาไปใช้กับหน้าใบส่งสินค้าหรือกระดาษ — ช่อง Wip bal. บนใบต้องเป็นยอดของ Delta ตรง ๆ
 *     (เจ้าของสั่ง 1 ก.ย. 2026 · 14 ก.ย. 2026 ลองให้หักทุกที่แล้วเปลี่ยนเป็นเฉพาะหน้า FG)
 *  ⚠️ ช่อง "ต่าง" จึงไม่บอกแล้วว่า Delta บันทึกช้ากว่าเรา (ใบที่ช้าจะขึ้นว่าตรง)
 *     แต่ยังบอกอีกทิศ — Delta นับส่งมากกว่าที่เราคีย์ (เราอาจลืมคีย์ยอดส่ง) ยังขึ้นว่าต่างเหมือนเดิม
 *  ⚠️ ถือว่ายอดสั่งของเราเท่ากับ PO QTY ของ Delta · ไม่ตรงเมื่อไหร่ตัวเลขนี้เพี้ยนตาม
 *     (หน้าเทียบไฟล์ Call In เตือน PO QTY ไม่ตรงอยู่แล้ว)
 *  ⚠️ #87 เคยหักเฉพาะยอดที่ส่งตั้งแต่วันนำเข้าไฟล์ — ใช้ไม่ได้เมื่อ Delta บันทึกช้าหรือเรานำเข้าช้า
 *
 *  คืน null ถ้า Delta ไม่ได้ให้ตัวเลข (ไม่อยู่ในไฟล์งวดล่าสุด หรือเว้นช่องว่าง) — ไม่มีอะไรให้หัก ห้ามเดา */
function deltaWipLeft(dw, orderQty, shipped){
  const raw = deltaWipNum(dw);
  if(raw == null) return null;
  const counted = Math.max(0, (Number(orderQty) || 0) - raw);
  const uncounted = Math.max(0, (Number(shipped) || 0) - counted);
  return {raw, counted, uncounted, left: Math.max(0, raw - uncounted), week: dw.week};
}

/** งวดของไฟล์ Call In ที่นำเข้าล่าสุด — ตัวตัดสินว่าใบไหนนับว่า "อยู่ในรอบนี้"
 *
 *  ⚠️ เทียบด้วย "งวด" ไม่ใช่ "การนำเข้าครั้งล่าสุด" เพราะหนึ่งงวดมีได้หลายชีต
 *     (ไฟล์ WK 35 ตัวจริงมีสองชีต) ถ้าเทียบเป็นครั้ง พอนำเข้าชีตที่สอง
 *     ใบของชีตแรกจะหายจากจอทั้งชุด
 *
 *  เหตุผลที่ต้องตัดสินด้วย createdAt อยู่ที่ deltaWipNewer() */
function currentDeltaWeek(){
  let best = null;
  state.deltaWip.forEach(d=>{
    if(d.voided) return;
    if(!best || deltaWipNewer(d, best)) best = d;
  });
  return best ? String(best.week) : null;
}

/** เลขสัปดาห์จากชื่อชีต เช่น "X'FRM3M4 wk34" -> "34"
 *  ไฟล์จริงตั้งชื่อชีตแบบนี้ทุกใบ ถ้าวันหนึ่งไม่ตรงรูปแบบ ให้คนพิมพ์เอง */
function weekFromSheetName(name){
  const m = /wk[ ]*([0-9]{1,2})/i.exec(String(name||''));
  return m ? String(Number(m[1])) : '';
}

/** เก็บยอดของ Delta จากไฟล์ที่เพิ่งเทียบ — หนึ่งแถวต่อ (ใบสั่ง + งวด)
 *  นำเข้าชีตที่สองของงวดเดียวกันต้อง "เพิ่ม" ไม่ใช่ทับของชีตแรก
 *  เพราะไฟล์จริงมีหลายชีตต่อหนึ่งสัปดาห์ แบ่งตามกลุ่มสินค้า */
function saveDeltaWip(items, week, fileName){
  const now = new Date().toISOString();
  const known = new Set(activeOrders().map(o=>o.id));

  /* ขอบเขตของการล้าง = "ใบที่อยู่ในชีตนี้จริง ๆ" ไม่ใช่ทั้งหน่วย และไม่ใช่ทั้งงวด
   *
   * ⚠️ เปิดไฟล์ Call In ของ WK 35 ตัวจริงดูเมื่อ 5 ก.ย. 2026 — ชีตไม่ได้แบ่งตามหน่วย
   *    อย่างที่เข้าใจกันมาตลอด:
   *      ชีตแรก   348 ใบ = TUE-H 342 + รหัสที่แยกหน่วยไม่ได้ 6
   *      ชีตที่สอง  60 ใบ = TUE-U  59 + TUE-H ปนมา 1 ใบ
   *    ถ้าล้าง "ทั้งหน่วย" ใบ TUE-H ที่ปนอยู่ในชีตที่สองใบเดียว จะพายอดของ TUE-H
   *    อีก 341 ใบที่ชีตแรกเพิ่งเขียนหายไปด้วย · ต่อใบเท่านั้นถึงจะปลอดภัย
   *    และต่อใบยังไม่ต้องพึ่ง subNameFromPo() เลย จึงทนกับรหัส PO ที่แยกหน่วยไม่ออก */
  const inFile = new Set();
  items.forEach(it=>{ if(known.has(it.id)) inFile.add(it.id); });
  if(!inFile.size) return {added:0, updated:0, cleared:0, blank:0};

  // ล้างยอดเดิมของใบเหล่านั้นให้หมดก่อน แล้วค่อยเขียนของไฟล์นี้ลงไป (B1 — voided ไม่ splice)
  let cleared = 0;
  state.deltaWip.forEach(d=>{
    if(d.voided || !inFile.has(d.orderId)) return;
    d.voided = true; d.updatedAt = now; d._dirty = true;
    cleared++;
  });

  let added = 0, updated = 0, blank = 0;
  items.forEach(it=>{
    if(!known.has(it.id)) return;              // ใบที่เราไม่รู้จัก ไม่เก็บ

    /* ⚠️ ช่องว่างในไฟล์ของ Delta แปลว่า "ไม่รู้" ไม่ใช่ "ค้างศูนย์" — เก็บเป็น wip:null
     *    Number('') ได้ 0 และ isFinite(0) เป็นจริง ถ้าเช็กแค่ isFinite ช่องว่างจะกลายเป็น 0
     *    แล้วกระดาษจะพิมพ์ 0 ส่งถึงลูกค้า ซึ่งอ่านว่า "ไม่มีของค้างแล้ว"
     *
     * ⚠️ ต้องเก็บแถวไว้ถึงจะว่าง ห้าม return ทิ้ง — "มีแถว" คือหลักฐานว่าใบนี้อยู่ในไฟล์
     *    ของเดิม return ทิ้ง ยอดที่ผิดจากการอัปครั้งก่อนจึงรอดมาตลอด อัปทับกี่ครั้งก็ไม่หาย
     *    ซึ่งคืออาการที่ #62 แจ้งมา · ชีตแรกของไฟล์จริงมีใบแบบนี้ 39 ใบ */
    const txt = String(it.fileWip == null ? '' : it.fileWip).trim();
    const num = txt === '' ? NaN : Number(txt);
    const wip = isFinite(num) ? num : null;
    if(wip == null) blank++;
    const i = state.deltaWip.findIndex(d => d.orderId===it.id && String(d.week)===String(week));
    if(i > -1){
      Object.assign(state.deltaWip[i], {wip, fileName, voided:false, updatedAt:now, _dirty:true});
      updated++;
    } else {
      state.deltaWip.push({
        id: uid(), orderId: it.id, week: String(week), wip, fileName,
        deviceName: state.deviceName, createdAt: now, updatedAt: now, voided:false, _dirty:true
      });
      added++;
    }
  });
  saveState();
  doSync();
  return {added, updated, cleared, blank};
}

/* ---------- ยอดคงคลัง FG ---------- */
/*
 * ⚠️ สามจำนวนนี้ไม่ใช่อันเดียวกัน เอามาเทียบผิดคู่แล้วจะสรุปว่า "ยอดไม่ตรง" ทั้งที่ทั้งสองฝั่งถูก
 *
 *   FG คงเหลือ        Σ inspection − Σ shipping   ของสำเร็จรูปที่อยู่ในคลังตอนนี้
 *   ยอดค้างส่งของเรา   Σ (orderQty − shipped)      เรายังติดลูกค้าอยู่เท่าไหร่ ตามบัญชีเรา
 *   ยอดค้างส่งของ Delta Σ deltaWip จากไฟล์          Delta คิดว่าเรายังติดเขาอยู่เท่าไหร่
 *
 * คู่ที่เทียบกันได้คือสองอันหลัง — FG เทียบกับของ Delta ไม่ได้
 * เพราะ FG ไม่รวมของที่ยังไม่ได้ผลิต ส่วนยอดค้างส่งรวม
 *
 * ⚠️ ไม่มีที่ไหนเก็บยอดคงเหลือไว้เป็นตัวเลข คิดสดจากสมุดทุกครั้ง (กฎเดียวกับ A1)
 *    ที่ไหนแก้ยอดได้โดยไม่เขียนสมุด ที่นั่นคือจุดที่ตัวเลขเริ่มเชื่อไม่ได้
 */

/** ยอดคงคลัง FG รายกลุ่ม — หนึ่งแถวต่อ (P/N + หน่วย)
 *  แยกตามหน่วยเพราะของ TUE-U / TUE-H / TUE-T ไม่ปนกัน และใบส่งสินค้าก็แยกหน่วยอยู่แล้ว */
function fgRows(){
  const cum = buildCumMap(state.records);
  const byKey = new Map();
  // งวดเดียวกับที่หน้าใบส่งสินค้ายึด — ใบที่ Delta ตัดออกจากไฟล์งวดล่าสุดไม่นับเป็นยอดค้างของ Delta (ดู deltaWipOf)
  const curWeek = currentDeltaWeek();

  activeOrders().forEach(o=>{
    const pn = String(o.pn == null ? '' : o.pn);
    const unit = String(o.subName || '');
    const key = pn + '|' + unit;
    if(!byKey.has(key)) byKey.set(key, {
      pn, unit, orders:[], inQty:0, outQty:0, ourWip:0, deltaWip:0, deltaHave:0
    });
    const g = byKey.get(key);
    const c = cum[o.id] || emptyCum();
    const inQty = Number(c.inspection)||0;
    const outQty = Number(c.shipping)||0;

    // ⚠️ ไม่ครอบยอดด้วย orderQty — FG คือของที่นับได้จากสมุด ไม่ใช่ของที่ควรจะเป็น
    //    ถ้าครอบไว้ ข้อมูลที่คีย์ผิดจะถูกกลบจนไม่มีใครเห็น
    g.inQty += inQty;
    g.outQty += outQty;
    g.ourWip += wipBalance(o, c);

    // ⚠️ นับเฉพาะใบที่ Delta กรอกตัวเลขมาจริง · ใบที่อยู่ในไฟล์แต่เว้นช่องไว้
    //    ไม่มียอดให้เทียบ ถ้านับเป็น 0 ช่อง "ต่าง" จะฟ้องว่ายอดไม่ตรงทั้งที่ไม่มีข้อมูล
    const dw = deltaWipOf(o.id, curWeek);
    // หักยอดที่เราส่งแล้วแต่ Delta ยังไม่นับ — เจ้าของเลือก 15 ก.ย. 2026 ให้หักเฉพาะหน้านี้ (ดู deltaWipLeft)
    const dl = deltaWipLeft(dw, o.orderQty, outQty);
    const dwNum = dl ? dl.left : null;
    if(dwNum != null){ g.deltaWip += dwNum; g.deltaHave++; }
    g.orders.push({o, inQty, outQty, ourWip: wipBalance(o, c), delta: dl, dw});
  });

  const rows = [];
  byKey.forEach(g=>{
    g.orders.sort((a,b)=> String(a.o.poNo).localeCompare(String(b.o.poNo)));
    g.fg = g.inQty - g.outQty;
    // เทียบเฉพาะใบที่ Delta มีข้อมูล ไม่งั้นเอาผลบวกของ 2 ใบไปเทียบกับ 5 ใบ แล้วสรุปผิด
    g.ourWipCmp = g.orders.reduce((n,x)=> n + (x.delta ? x.ourWip : 0), 0);
    g.diff = g.ourWipCmp - g.deltaWip;
    g.noDelta = g.orders.length - g.deltaHave;
    rows.push(g);
  });
  rows.sort((a,b)=> a.unit.localeCompare(b.unit) || a.pn.localeCompare(b.pn));
  return rows;
}

/** การเคลื่อนไหวของกลุ่มหนึ่ง เรียงตามวัน พร้อมยอดสะสม — โครงเดียวกับการ์ดของ Bin Card */
function fgMoves(pn, unit){
  const ids = new Set(activeOrders()
    .filter(o=> String(o.pn == null ? '' : o.pn) === String(pn) && String(o.subName||'') === String(unit))
    .map(o=>o.id));
  const poOf = {};
  state.orders.forEach(o=>{ poOf[o.id] = o.poNo; });

  const moves = state.records
    .filter(r=> !r.voided && ids.has(r.orderId) && (r.process==='inspection' || r.process==='shipping'))
    .map(r=>({ date:r.date, po:poOf[r.orderId]||'', kind:r.process, qty:Number(r.qty)||0 }))
    .sort((a,b)=> a.date.localeCompare(b.date) || (a.kind==='inspection'? -1 : 1));

  let bal = 0;
  moves.forEach(m=>{ bal += (m.kind==='inspection' ? m.qty : -m.qty); m.balance = bal; });
  return moves;
}

/* ---------- ใบส่งสินค้า: ข้อมูลและการคิดยอด ---------- */
/*
 * ⚠️ หน่วยของการกรอกคือ "P/N" ไม่ใช่ "PO" — ตรงกับใบจริงที่ใช้อยู่หน้างาน
 *    ในใบจริง ช่องจำนวนต่อกล่อง/กล่อง/เศษ ถูก merge ข้ามแถวของ PO ทุกใบที่เป็น P/N เดียวกัน
 *    เพราะของถูกบรรจุรวมกันตาม P/N แล้วค่อยตัดเข้าใบสั่งทีหลัง
 *
 * จึงแยกเป็นสองเรื่องที่เก็บคนละที่
 *   ยอดบรรจุของกลุ่ม   เก็บใน state.deliveryNotes หนึ่งแถวต่อ (วันที่ + หน่วย + P/N)
 *                      orderId ของแถวพวกนี้เว้นว่างไว้ เพราะไม่ได้เป็นของใบสั่งใบใดใบหนึ่ง
 *   ยอดที่ตัดเข้าแต่ละใบ  เก็บเป็น record ยอดส่งของตามปกติ (orderId|shipping|date)
 *
 * ⚠️ ระบบไม่ตัดยอดเข้าใบให้เอง — เจ้าของยืนยันว่าคนเป็นคนเลือกเองว่าใบไหนเท่าไหร่
 *    ห้ามใส่การเฉลี่ยอัตโนมัติกลับเข้ามาโดยไม่ถามก่อน มันคือการตัดสินใจทางธุรกิจ ไม่ใช่เรื่องคณิตศาสตร์
 */

/** วันปฏิทิน YYYY-MM-DD -> เลข serial ของ Excel
 *  กลับทางกับ excelSerialToISO() ที่ใช้ -25569 · ทั้งคู่ยึด UTC เที่ยงคืนเหมือนกัน
 *  จึงไม่มีทางเลื่อนวันไม่ว่าเครื่องจะอยู่เขตเวลาไหน (INVARIANTS หมวด C) */
function isoToExcelSerial(iso){
  const d = dateFromISO(iso);
  if(!d) return null;
  return Math.round(d.getTime()/86400000) + 25569;
}

/** ยอดที่ตัดเข้าใบสั่งใบหนึ่งในวันหนึ่ง = ยอดส่งของที่บันทึกไว้แล้ว */
function allocOf(orderId, date){
  const r = state.records.find(x => x.orderId===orderId && x.process==='shipping'
                                && x.date===date && !x.voided);
  return r ? (Number(r.qty)||0) : 0;
}

/** P/N เทียบกันเป็นข้อความเสมอ
 *
 *  ⚠️ P/N มาถึงแอปได้สองทาง และชนิดข้อมูลไม่เหมือนกัน
 *       นำเข้าไฟล์ Excel → ผ่าน String(...).trim() จึงเป็นข้อความ
 *       ซิงค์จาก Google Sheets → คัดลอกมาตรง ๆ ถ้าชีตเก็บเป็นตัวเลข ก็ได้ตัวเลขมา
 *     แถมค่าที่อ่านจาก DOM (dataset) เป็นข้อความเสมอ
 *
 *  ถ้าเทียบด้วย === ตรง ๆ เครื่องที่รับข้อมูลมาจากการซิงค์จะหายอดบรรจุของตัวเองไม่เจอ
 *  กรอกต่อกล่องแล้วหายตอนรีเฟรช · กล่องกับเศษไม่ขึ้น · และใบที่ออกมามีจำนวนเป็น 0
 *  พนักงานเจอของจริง 1 ก.ย. 2026 บนมือถือ ส่วนเครื่องที่นำเข้าไฟล์เองไม่เจอเลย */
const samePn = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);

/** ยอดบรรจุของกลุ่ม P/N ในวัน+หน่วยนั้น (ถ้ายังไม่เคยกรอกจะคืน null) */
function packingOf(date, unit, pn){
  return state.deliveryNotes.find(d => !d.voided && d.date===date && d.unit===unit
                                    && !d.orderId && samePn(d.pn, pn)) || null;
}

/** จัดกลุ่มตาม P/N — โครงเดียวกับที่ใบจริงเรียง
 *
 *  ⚠️ ทิศทางของตัวเลข (เปลี่ยนเมื่อ 31 ส.ค. 2026 ตามที่พนักงานเสนอ)
 *
 *     ยอดที่คนกรอกคือ "จำนวนที่ส่งของแต่ละ PO" · ยอดรวมของกลุ่มคือผลบวกของ PO ทุกใบ
 *     แล้วโปรแกรมแบ่งเป็นกล่องกับเศษให้จาก ต่อกล่อง ที่กรอกไว้
 *
 *     ของเดิมกลับทาง คือกรอกยอดรวมของกลุ่มก่อนแล้วค่อยมาแบ่งเข้า PO ทีหลัง
 *     ซึ่งทำให้มีเลขสองชุดที่ต้องตรงกันเอง และเกิดสถานะ "ตัดยังไม่ครบ / ตัดเกิน" ได้ตลอด
 *     ทางใหม่ทำให้สถานะนั้นหายไปโดยโครงสร้าง ไม่ใช่แค่กันไว้
 *
 *  กลุ่มที่ "แก้กล่องเอง" คือกลุ่มที่เลขกล่อง/เศษที่เก็บไว้ ไม่ตรงกับที่ canonicalPack คิดให้
 *  ไม่ต้องเก็บธงบอกโหมด จึงไม่ต้องเพิ่มคอลัมน์ในตารางที่ซิงค์ และไม่ต้อง deploy Apps Script ใหม่
 *
 *  เรียงกลุ่มตามใบที่เก่าสุดในกลุ่ม และเรียงใบในกลุ่มตามวันสั่งเก่าสุดก่อน */
function deliveryGroups(date, unit){
  const cum = buildCumMap(state.records);
  const byPn = new Map();
  const curWeek = currentDeltaWeek();

  activeOrders().filter(o => o.subName === unit).forEach(o=>{
    const alloc = allocOf(o.id, date);

    /* Wip bal. คือยอดค้าง "ก่อน" ส่งรอบนี้ จึงต้องหักยอดที่ตัดเข้าใบวันนี้ออกจากยอดส่งสะสมก่อน
     *
     * ⚠️ ห้ามคิดเป็น wipBalance(o, cum) + alloc — เคยเขียนแบบนั้นแล้วคำเตือน "เกิน" ตายสนิท
     *    เพราะ wipBalance() ครอบไม่ให้ติดลบ พอส่งเกินยอดสั่ง ค่าที่ครอบแล้วเป็น 0
     *    บวก alloc กลับเข้าไปจึงได้ค่าเท่ากับ alloc พอดี แล้วเงื่อนไข alloc > wip เป็นเท็จเสมอ
     *    ทดสอบแล้ว สั่ง 1,000 ตัดเข้าใบ 3,000 ก็ไม่เตือนอะไรเลย (เจอ 2 ก.ย. 2026)
     *
     * wipBefore ปล่อยให้ติดลบได้ เพื่อให้เทียบว่า "เกิน" ได้จริง
     * ส่วนตัวเลขที่โชว์และพิมพ์ลงกระดาษยังครอบที่ 0 เหมือนเดิม */
    const shippedBefore = ((cum[o.id] && cum[o.id].shipping) || 0) - alloc;
    const wipBefore = (Number(o.orderQty) || 0) - shippedBefore;
    const wip = Math.max(0, wipBefore);
    const dw = deltaWipOf(o.id, curWeek);
    /* ⚠️ อ่านยอดผ่าน deltaWipNum() เสมอ ห้ามหยิบ dw.wip ดิบ ๆ
     *    เครื่องที่รับข้อมูลมาจากการซิงค์ได้ '' แทน null (ดูคอมเมนต์ของ deltaWipNum)
     *    ซึ่ง Number('')||0 ได้ 0 และ '' == null เป็นเท็จ สองทางนี้พา 0 ลงกระดาษได้ทั้งคู่ */
    /* ⚠️ หน้านี้และกระดาษใช้ยอดดิบของ Delta — ห้ามหักยอดที่ Delta ยังไม่นับ (deltaWipLeft)
     *    เจ้าของเลือกให้หักเฉพาะยอดที่โชว์ในหน้ายอดคงคลัง FG (14–15 ก.ย. 2026) */
    const dwNum = deltaWipNum(dw);
    const deltaLeft = dwNum == null ? 0 : dwNum;

    /* ⚠️ กติกาของยอด Delta ในตัวกรองนี้ — อ่านให้จบก่อนแก้
     *
     *    ใช้ "เพิ่มแถว" ได้    ✅   ใช้ "ตัดแถวทิ้ง" ไม่ได้เด็ดขาด ❌
     *
     * ที่ห้ามคือการเอา deltaWip ไปแทน wip ของเรา — PO ที่ไม่มีในไฟล์ Delta
     * จะหายจากหน้าจอจนส่งของใบนั้นไม่ได้เลย (กับดักเดียวกับใบที่ส่ง 0 ใน PR #43)
     *
     * แต่การเพิ่มแถวตอน Delta ยังค้างอยู่ ปลอดภัย เพราะมีแต่ทำให้เห็นมากขึ้น ไม่มีทางทำให้หาย
     * และจำเป็น — พนักงานเจอของจริง 2 ก.ย. 2026 ว่าใบที่เราตัดยอดส่งครบไปแล้ว
     * แต่ Delta ยังบันทึกว่าค้างอยู่ จะหายจากหน้าจอจนใส่ลงใบส่งของไม่ได้
     * ทั้งที่ Delta ยังรอของใบนั้นอยู่ */
    if(wip <= 0 && alloc <= 0 && deltaLeft <= 0) return;
    // จัดกลุ่มด้วยข้อความเสมอ ไม่งั้น P/N เดียวกันที่มาคนละทางจะแตกเป็นสองกลุ่ม
    const key = String(o.pn == null ? '' : o.pn);
    if(!byPn.has(key)) byPn.set(key, []);
    byPn.get(key).push({o, wip, alloc, deltaWip: dwNum, deltaRow: dw, deltaWeek: dw ? dw.week : '',
      /* อยู่ในไฟล์ Call In "ของงวดล่าสุด" หรือไม่ — คนละเรื่องกับ "มียอด" (ดู deltaWipNum)
       *
       * ⚠️ ต้องเทียบงวดด้วย ห้ามใช้แค่ !!dw · ใบที่ Delta ตัดออกจากไฟล์รอบนี้
       *    ยังมีแถวของงวดก่อนค้างอยู่ (เราเก็บประวัติไว้ ไม่ได้ลบ) ถ้าไม่เทียบงวด
       *    ใบนั้นจะยังโชว์อยู่บนจอพร้อมยอดของสัปดาห์ที่แล้ว ซึ่งคือสิ่งที่เจ้าของสั่งให้เลิก */
      inCallIn: !!dw && String(dw.week) === curWeek,
      // แถวนี้โผล่มาเพราะ Delta ยังค้าง ทั้งที่บัญชีเราส่งครบแล้ว — ต้องบอกคนคีย์ให้รู้
      onlyDelta: wip <= 0 && alloc <= 0 && deltaLeft > 0, wipBefore});
  });

  const groups = [];
  byPn.forEach((orders, pn)=>{
    orders.sort((a,b)=> (a.o.orderDate||'').localeCompare(b.o.orderDate||'')
                     || String(a.o.poNo).localeCompare(String(b.o.poNo)));
    const pack = packingOf(date, unit, pn);
    // ยอดรวมของกลุ่มคือผลบวกของที่ส่งแต่ละ PO — เป็นตัวเลขต้นทางเพียงตัวเดียว
    const qty = orders.reduce((s,x)=> s + x.alloc, 0);
    const perBox = Number(pack && pack.perBox) || 0;
    const auto = canonicalPack(qty, perBox);
    // ⚠️ กติกา: ข้อมูลเก็บเฉพาะสิ่งที่ "คนพิมพ์" เท่านั้น
    //    กล่อง 0 เศษ 0 = ยังไม่มีใครแก้ ให้โปรแกรมคิดสดจากยอดรวมทุกครั้ง
    //    ห้ามเก็บค่าที่โปรแกรมคิดให้ลงข้อมูล — เคยทำแล้วพัง เพราะพอยอดเปลี่ยน
    //    ค่าที่เก็บไว้จะไม่ตรงกับที่ควรคิดได้ใหม่ ระบบเลยเข้าใจผิดว่าคนแก้เองแล้วหยุดคิดให้
    const kept = {boxes: Number(pack && pack.boxes)||0, remainder: Number(pack && pack.remainder)||0};
    const manual = kept.boxes !== 0 || kept.remainder !== 0;
    const boxes = manual ? kept.boxes : auto.boxes;
    const remainder = manual ? kept.remainder : auto.remainder;
    groups.push({
      pn, pack, orders, qty, perBox, boxes, remainder,
      // ยอดที่กระดาษจะพิมพ์ออกมา — Excel คิดเองจาก ต่อกล่อง × กล่อง + เศษ
      packQty: perBox * boxes + remainder,
      manual,
      remark: (pack && pack.remark) || ''
    });
  });
  groups.sort((a,b)=> (a.orders[0].o.orderDate||'').localeCompare(b.orders[0].o.orderDate||''));
  return groups;
}

/** บันทึกยอดบรรจุของกลุ่ม P/N — ไม่แตะยอดที่ตัดเข้าใบ คนละเรื่องกัน */
function savePacking(date, unit, pn, patch){
  const now = new Date().toISOString();
  const i = state.deliveryNotes.findIndex(d => d.date===date && d.unit===unit
                                            && !d.orderId && samePn(d.pn, pn));
  if(i > -1){
    Object.assign(state.deliveryNotes[i], patch, {voided:false, updatedAt:now, _dirty:true});
  } else {
    state.deliveryNotes.push(Object.assign({
      id: uid(), date, unit, orderId:'', pn: String(pn),
      perBox:0, boxes:0, remainder:0, remark:'', billNo:'',
      deviceName: state.deviceName, createdAt: now, updatedAt: now, voided:false, _dirty:true
    }, patch));
  }
  saveState();
  doSync();
}

/** ทางกลับออกจากโหมดแก้กล่องเอง — ล้างเลขที่คนพิมพ์ไว้ทิ้ง แล้วโปรแกรมจะคิดสดให้เอง
 *  ไม่ได้เขียนค่าที่คิดได้ลงไปแทน เพราะนั่นจะกลายเป็น "คนพิมพ์" อีกครั้งในสายตาของระบบ */
function resetPacking(date, unit, pn){
  savePacking(date, unit, pn, {boxes: 0, remainder: 0});
}

/** บันทึกจำนวนที่ส่งของใบสั่งใบหนึ่ง — ลงเป็น record ยอดส่งของตามกุญแจเดิม (INVARIANTS A2)
 *  เขียนทับค่าเดิมเสมอ ไม่บวกเพิ่ม แก้ตัวเลขที่พิมพ์ผิดแล้วยอดตามทันที */
function saveAllocation(orderId, date, qty){
  const now = new Date().toISOString();
  const i = state.records.findIndex(r => r.orderId===orderId && r.process==='shipping' && r.date===date);
  if(i > -1){
    Object.assign(state.records[i], {qty, voided:false, note:SOURCE_DELIVERY, updatedAt:now, _dirty:true});
  } else if(qty > 0){
    state.records.push({
      id: uid(), date, orderId, process:'shipping', qty, note: SOURCE_DELIVERY,
      deviceName: state.deviceName, createdAt: now, updatedAt: now, voided:false, _dirty:true
    });
  }
  saveState();
  doSync();
}

/* ---------- กรอกฟอร์ม Daily Call In ---------- */

let pendingCallIn = null;   // {zip, sheetMap, fileName}

/* หัวตารางของไฟล์ Call In — หาคอลัมน์จากข้อความ ไม่ยึดตัวอักษรคอลัมน์
 *
 * ⚠️ ยึดตำแหน่งตายตัวไม่ได้ · เปิดไฟล์ WK 35 ตัวจริงดูเมื่อ 5 ก.ย. 2026
 *    สองชีตในไฟล์เดียวกันวางคอลัมน์ไม่ตรงกัน เพราะชีตแรกมี "New SAP" แทรกอยู่ที่ D
 *
 *      ชีตแรก    P/N=A  PO NO=B  PO QTY=E  Wip bal.=F
 *      ชีตที่สอง  P/N=A  PO NO=B  PO QTY=D  Wip bal.=E
 *
 *    #53 แก้ให้ Wip bal. หาจากหัวตารางแล้ว แต่ qty ยังยึด 'D' อยู่ พออ่านชีตแรก
 *    จึงเอาเลขของ New SAP มาเป็น PO QTY แล้วแผงเทียบยอดฟ้อง "PO QTY ไม่ตรง" มั่วทั้งชีต
 *    ไม่ทำข้อมูลเสียเพราะ fileQty ใช้แค่ทำรายการเตือน แต่คนอ่านแล้วเลิกเชื่อหน้านี้
 *
 * ⚠️ เทียบแบบผ่อนปรน — ตัดทุกอย่างที่ไม่ใช่ตัวอักษรทิ้งก่อน กัน "PO  NO" (เว้นสองเคาะ)
 *    "Wip bal." "WIP BAL" "Wip Balance" ถือเป็นชื่อเดียวกัน · ช่องที่เป็นตัวเลขล้วน
 *    (หัวตารางมีคอลัมน์วันที่เป็นเลข serial) จะเหลือสตริงว่าง จึงไม่ไปชนกับใคร */
/* ⚠️ required บอกว่าขาดแล้วต้องปฏิเสธทั้งชีตหรือแค่ข้ามไป — แยกตามว่าช่องนั้นทำอะไร
 *
 *    pn/po  = กุญแจของแถว ขาดแล้วจับคู่ใบสั่งไม่ได้เลย
 *    wip    = ของที่ทั้งหน้านี้มีไว้เพื่อมัน ขาดแล้วเก็บอะไรไม่ได้
 *    qty    = ใช้ทำ "คำเตือน PO QTY ไม่ตรง" อย่างเดียว ไม่ได้เก็บลงข้อมูล
 *
 *    เคยตั้ง qty เป็นบังคับด้วยตอน 6 ก.ย. 2026 ด้วยเหตุผลว่า "ขาดหัวตารางต้องฟ้อง ไม่ใช่เดา"
 *    แต่ไม่ได้สัดส่วนกับความสำคัญของช่องนั้น — Delta สะกดหัวคอลัมน์นี้ต่างไปนิดเดียว
 *    จะทำให้เก็บ Wip bal. ของทั้งชีตไม่ได้เลย ทั้งที่ของที่หายไปคือแค่คำเตือน
 *    (ผู้ตรวจทักไว้ใน #68) · ขาดแล้ว fileQty เป็น 0 ซึ่ง planCallIn ถือว่า "ไม่มีอะไรให้เทียบ"
 *    อยู่แล้ว จึงเงียบไปเฉย ๆ ไม่มีคำเตือนหลอก */
const CALLIN_HEAD = [
  {field:'pn',  label:'P/N',      required:true,  test: n => n === 'pn'},
  {field:'po',  label:'PO No.',   required:true,  test: n => n.startsWith('pono')},
  {field:'qty', label:'PO QTY',   required:false, test: n => n.startsWith('poqty')},
  {field:'wip', label:'Wip bal.', required:true,  test: n => n.startsWith('wipbal')}
];
const headNorm = txt => String(txt == null ? '' : txt).toLowerCase().replace(/[^a-z]/g, '');

/** อ่านแถวข้อมูลของชีตที่เลือก แล้วจับคู่กับใบสั่งในเครื่อง
 *  จับคู่ด้วย PO + P/N เหมือนกุญแจของ order ในแอป (id = poNo|pn) */
async function readCallInSheet(zip, path){
  const shared = await readSharedStrings(zip);
  const doc = parseXml(await zip.file(path).async('string'));
  const rows = Array.from(doc.getElementsByTagNameNS(XL_NS, 'row'));
  const cellsOf = rowEl => {
    const m = {};
    Array.from(rowEl.children).forEach(c=>{ m[colOfRef(c.getAttribute('r'))] = c; });
    return m;
  };

  /* หาแถวหัวตารางจากข้อความ "P/N" ที่ "ช่องไหนก็ได้" ไม่ใช่คอลัมน์ A เสมอ
   *    และห้าม fix เลขแถวไว้ — ของจริงหัวตารางอยู่แถว 6 */
  let headerIdx = -1, headerCells = null;
  for(let i=0;i<rows.length && i<20;i++){
    const cs = cellsOf(rows[i]);
    for(const col in cs){
      if(headNorm(cellText(cs[col], shared)) === 'pn'){ headerIdx = i; headerCells = cs; break; }
    }
    if(headerIdx > -1) break;
  }
  if(headerIdx < 0) return {error:'ไม่พบหัวตาราง "P/N" ในชีตนี้ — เลือกชีตให้ถูกก่อนครับ'};

  // จับคู่ทุกคอลัมน์ที่ต้องใช้จากข้อความหัวตารางของ "แถวที่เจอจริง"
  const col = {};
  for(const c in headerCells){
    const norm = headNorm(cellText(headerCells[c], shared));
    if(!norm) continue;                                  // ช่องว่างหรือหัวที่เป็นตัวเลขล้วน
    CALLIN_HEAD.forEach(h=>{ if(col[h.field] == null && h.test(norm)) col[h.field] = c; });
  }
  const missing = CALLIN_HEAD.filter(h => h.required && col[h.field] == null);
  if(missing.length) return {error:'ไม่พบหัวตาราง ' + missing.map(h=>'"'+h.label+'"').join(' และ ')
    + ' ในชีตนี้ — เลือกชีตให้ถูกก่อนครับ'};

  const items = [];
  for(let i=headerIdx+1;i<rows.length;i++){
    const cs = cellsOf(rows[i]);
    const pn = cellText(cs[col.pn], shared);
    const po = cellText(cs[col.po], shared);
    if(!pn || !po) continue;
    items.push({
      rowNo: rows[i].getAttribute('r'),
      pn, po,
      id: po+'|'+pn,
      // ไม่มีคอลัมน์ PO QTY ในชีตนี้ = 0 = "ไม่มีอะไรให้เทียบ" ไม่ใช่ "ยอดเป็นศูนย์"
      fileQty: col.qty == null ? 0 : (Number(cellText(cs[col.qty], shared)) || 0),
      fileWip: cellText(cs[col.wip], shared)
    });
  }
  return {items};
}

/** เทียบไฟล์กับข้อมูลในเครื่อง คืนสิ่งที่จะเกิดขึ้น โดยยังไม่แตะอะไร
 *
 *  ⚠️ ต้องใช้ activeOrders() ให้ตรงกับ saveDeltaWip() ที่กดเก็บจริง
 *     ตอนแรกใช้ state.orders ทั้งก้อน ใบที่ยกเลิกแล้วจึงถูกนับเป็น "เทียบได้" บนจอ
 *     แต่ตอนกดเก็บกลับถูกข้าม จำนวนที่เห็นกับที่เก็บจริงไม่เท่ากันเงียบ ๆ
 *     (ผู้ตรวจทักไว้ใน #66) · ใบที่เรายกเลิกแล้วต้องขึ้นเป็น "ไม่มีใบนี้ในระบบ"
 *     ซึ่งเป็นความจริง และเป็นข้อมูลที่ต้องเอาไปคุยกับ Delta ว่าเขายังเรียก PO นี้อยู่ */
function planCallIn(items){
  const orderById = {}; activeOrders().forEach(o=>orderById[o.id]=o);
  const cumMap = buildCumMap(state.records);
  const inFile = new Set();
  const update = [], missingOrder = [], qtyMismatch = [];

  items.forEach(it=>{
    inFile.add(it.id);
    const o = orderById[it.id];
    if(!o){ missingOrder.push(it); return; }
    const wip = wipBalance(o, cumMap[o.id]);
    if(o.orderQty && it.fileQty && o.orderQty !== it.fileQty) qtyMismatch.push({it, appQty:o.orderQty});
    update.push({it, wip, changed: String(wip) !== String(it.fileWip)});
  });

  // ใบที่เรายังส่งไม่ครบ แต่ไม่มีแถวในไฟล์ของ Delta
  // แปลว่าสองฝั่งมองไม่ตรงกันว่ายังมีใบนี้ค้างอยู่ — เป็นข้อมูลที่ต้องเอาไปคุยกับ Delta
  // ไม่ใช่ของที่โปรแกรมจะไปเติมให้เอง
  const missingRow = activeOrders().filter(o=>{
    if(inFile.has(o.id)) return false;
    return wipBalance(o, cumMap[o.id]) > 0;
  }).map(o=>({o, wip: wipBalance(o, cumMap[o.id])}));

  return {update, missingOrder, missingRow, qtyMismatch};
}

/* ---------- Excel parsing ---------- */

/** ชีตที่ถูกซ่อนคือของเก่าที่เขาตั้งใจเก็บไว้ ห้ามดึงยอดออกมาใช้ */
function isHiddenSheet(ws){ return !!ws && ws.state !== 'visible'; }

/** หา worksheet จากชื่อที่เก็บไว้ใน dropdown — ชื่อชีตจริงมีช่องว่างท้ายบ่อย จึงเทียบแบบตรงตัวก่อน */
function sheetByName(wb, name){
  return wb.worksheets.find(ws => ws.name === name)
      || wb.worksheets.find(ws => ws.name.trim() === String(name).trim())
      || null;
}

/** ค่าของช่องหนึ่ง ให้ออกมาเป็นชนิดพื้นฐานเสมอ
 *  ช่องสูตรคืน {formula, result} — ต้องหยิบผลลัพธ์ที่ Excel คำนวณค้างไว้ ไม่ใช่ตัวสูตร
 *  ข้อความที่จัดรูปแบบคืน {richText:[...]} — ต้องต่อกลับเป็นข้อความธรรมดา
 *  ถ้าปล่อย object ดิบไหลลงไป ตัวตรวจ typeof ข้างล่างจะตัดสินผิดหมด */
function cellValue(v){
  if(v==null || v==='') return null;
  if(v instanceof Date) return v;
  if(typeof v === 'object'){
    if(v.error !== undefined) return null;
    if(v.result !== undefined) return cellValue(v.result);
    if(v.richText) return v.richText.map(t=>t.text).join('');
    if(v.text !== undefined) return v.text;
    return null;
  }
  return v;
}

/** ทั้งชีตเป็นตารางสองมิติ — ดัชนี 0 คือคอลัมน์ A และ rows[n] คือแถวที่ n+1 ของชีตเสมอ
 *
 *  ตัวอ่านทุกตัวข้างล่างอ้างตำแหน่งแบบตายตัว (หัวตารางแถว 7 · ข้อมูลเริ่มแถว 10 · ยอดส่งคอลัมน์ P)
 *  การรักษารูปร่างนี้ไว้จึงสำคัญกว่าความสวยของโค้ด และตัวนี้ยึดเลขแถวจริงของชีต
 *  ไม่ใช่ขอบเขตที่ไฟล์ประกาศไว้ ซึ่งเป็นจุดที่ตัวอ่านเดิมเลื่อนได้ถ้าไฟล์ประกาศขอบเขตไม่เริ่มที่ A1 */
function sheetRows(ws){
  const out = [];
  if(!ws) return out;
  for(let r=1; r<=ws.rowCount; r++){
    const row = ws.getRow(r);
    const arr = [];
    for(let c=1; c<=row.cellCount; c++) arr.push(cellValue(row.getCell(c).value));
    out.push(arr);
  }
  return out;
}

/** ExcelJS อ่านได้เฉพาะ .xlsx — .xls รุ่นเก่าต้องให้คนไป Save As ก่อน
 *  บอกให้ชัดตรงนี้ ดีกว่าปล่อยให้ error ดิบของไลบรารีเด้งใส่หน้าพนักงาน */
function rejectLegacyXls(file){
  if(/\.xls$/i.test(file.name)){
    toast('ไฟล์ .xls รุ่นเก่าเปิดไม่ได้ — เปิดใน Excel แล้วสั่ง Save As เป็น .xlsx ก่อนครับ');
    return true;
  }
  return false;
}

/* ---------- หาคอลัมน์ของไฟล์แผนจากข้อความหัวตาราง ----------
 *
 * ⚠️ เดิมอ้างตำแหน่งตายตัว (F=P/N G=PO No. L=Open Q'ty M/N/O=วันแผน) ซึ่งพังเงียบ
 *    เมื่อไฟล์เปลี่ยนผัง สำรวจไฟล์จริง 36 ชีตเมื่อ 4 ก.ย. 2026 พบว่า **มีสองผังปนกันอยู่**
 *
 *      WK 15 เป็นต้นมา   L=Open Q'ty  · M/N/O = Winding/Assembly/Inspection
 *      WK 1-14 (ของเก่า) L=Order Q'ty · M=Open Q'ty · N/O = Rev.
 *
 *    ผลคือชีตเก่าถูกอ่านวันแผน Winding มาจากช่อง "Open Q'ty" ได้วันที่มั่ว
 *    และยอดมาจากคนละช่องกับที่ชีตใหม่ใช้ ไม่มีอะไรฟ้องสักอย่าง
 *
 * จับคู่แบบผ่อนปรน เพราะหัวตารางจริงสะกดว่า "Winding/Trimmimg" (พิมพ์ตก)
 * และเว้นวรรคไม่คงที่ */
const PLAN_HEAD = [
  {field:'pn',             label:'P/N',        pats:[/^p\s*\/\s*n$/]},
  {field:'poNo',           label:'PO No.',     pats:[/^po\s*no/]},
  {field:'orderDate',      label:'Order Date', pats:[/^order\s*date/]},
  // ⚠️ ยอดสั่งผูกกับ "Open Q'ty" — ผังปัจจุบันมีช่องนี้ช่องเดียว และเป็นความหมาย
  //    ที่โปรแกรมใช้มาตลอด · "Order Q'ty" เป็นตัวสำรองเผื่อวันหนึ่งเปลี่ยนกลับไปใช้ชื่อนั้น
  //    (ผังเก่ามีทั้งสองช่อง ค่าเท่ากัน 574 จาก 577 แถว เจ้าของยืนยันว่าเป็นยอดเดียวกัน)
  {field:'orderQty',       label:"Open Q'ty",  pats:[/^open\s*q/], alt:[/^order\s*q/]},
  {field:'osc',            label:'OSC',        pats:[/^osc$/]},
  {field:'pc',             label:'Pc',         pats:[/^pc\b/]},
  {field:'planWinding',    label:'Winding',    pats:[/wind/]},
  {field:'planAssembly',   label:'Assembly',   pats:[/assembl/]},
  {field:'planInspection', label:'Inspection', pats:[/inspect/]},
  {field:'planSupport',    label:'Support',    pats:[/support/]}
];

/** ชื่อคอลัมน์ที่ขาดไม่ได้ — ขาดเมื่อไหร่ต้องฟ้อง ไม่ใช่เดาตำแหน่งเอาเอง */
const PLAN_REQUIRED = ['pn', 'poNo', 'orderQty'];

const normHead = v => typeof v === 'string'
  ? v.replace(/\s+/g, ' ').trim().toLowerCase() : '';

/** หาแถวหัวตารางแล้วแปลงเป็น {ชื่อฟิลด์: ดัชนีคอลัมน์}
 *  คืน {error} ถ้าหาไม่เจอ หรือขาดคอลัมน์ที่จำเป็น */
function findPlanCols(rows){
  for(let i=0; i<Math.min(rows.length, 14); i++){
    const row = rows[i];
    if(!row) continue;
    const heads = row.map(normHead);
    const map = {};

    /* ⚠️ ต้องกวาดสองรอบ — รอบแรกเอาเฉพาะชื่อหลัก รอบสองค่อยเติมด้วยชื่อสำรอง
     *    ผังเก่ามี "Order Q'ty" อยู่ซ้ายมือของ "Open Q'ty" ถ้ากวาดรอบเดียวไล่ทีละคอลัมน์
     *    ตัวสำรองจะชิงคว้าช่องไปก่อนที่จะเดินไปเจอตัวหลัก แล้วได้ยอดจากคนละช่อง
     *    (เทสจับได้ตอนเขียน — อ่านได้ 999 แทนที่จะเป็น 800) */
    for(const spec of PLAN_HEAD){
      const c = heads.findIndex(h => h && spec.pats.some(re => re.test(h)));
      if(c >= 0) map[spec.field] = c;
    }
    for(const spec of PLAN_HEAD){
      if(map[spec.field] != null || !spec.alt) continue;
      const c = heads.findIndex(h => h && spec.alt.some(re => re.test(h)));
      if(c >= 0) map[spec.field] = c;
    }

    if(map.pn != null && map.poNo != null){
      const missing = PLAN_REQUIRED
        .filter(f => map[f] == null)
        .map(f => (PLAN_HEAD.find(x => x.field === f) || {}).label || f);
      if(missing.length){
        return {error: 'หัวตารางในชีตนี้ไม่มีคอลัมน์ ' + missing.join(', ')
                     + ' — เลือกชีตให้ถูก หรือแจ้งหัวหน้าว่าผังไฟล์เปลี่ยนไป'};
      }
      return {cols: map, headerIdx: i};
    }
  }
  return {error: 'ไม่พบหัวตาราง (ต้องมีทั้ง "P/N" และ "PO No.") ในชีตนี้ — เลือกชีตให้ถูกก่อนครับ'};
}

/** Sub-Name จากตัวอักษรในรหัส PO — เจ้าของสั่ง 4 ก.ย. 2026
 *
 *  ⚠️ ทำไมไม่อ่านจากคอลัมน์ C เหมือนเดิม — คอลัมน์นั้น "ไม่มีหัวตาราง" เลยในไฟล์จริง
 *     (หัวแถว 7 ข้ามจาก B=Code ไป D=OSC) จึงหาจากหัวตารางไม่ได้ ต้องยึดตำแหน่งอย่างเดียว
 *     และที่สำคัญกว่านั้น เจ้าของยืนยันว่า "ตัวอักษรใน PO ถูก คอลัมน์ C พิมพ์ผิด"
 *     สำรวจไฟล์จริงพบ 89 แถวที่สองอย่างนี้ขัดกัน การเปลี่ยนมาใช้ PO จึงเป็นการแก้ให้ถูก
 *
 *  ⚠️ ตัดสินไม่ได้ = คืนค่าว่าง ห้ามเดาข้างใดข้างหนึ่ง
 *     ใบส่งสินค้าแยกตาม Sub-Name ถ้าเดาผิด ของจะไปออกใบผิดหน่วยโดยไม่มีใครรู้
 *     หน้าตรวจก่อนนำเข้าจะนับแถวที่บอกหน่วยไม่ได้ขึ้นมาเตือนให้เห็นก่อนกดยืนยัน
 *
 * ── กฎปัจจุบัน: อ่านจาก "ตัวอักษรตำแหน่งที่ 7" ของรหัส PO (10 ต.ค. 2026)
 *
 * ⚠️ **ห้ามกลับไปใช้ `includes()` เด็ดขาด** — ของเดิมถาม "มีตัว H ไหม / มีตัว U ไหม"
 *    ซึ่งบังเอิญใช้ได้ตอนมีแค่สองหน่วย แต่ขยายไม่ได้เลย
 *
 *    สำรวจรหัส PO จริง 1,657 ใบจากไฟล์ใบส่งงานของบริษัท (10 ต.ค. 2026)
 *      เพิ่ม "มีตัว T" → **พัง 1,641 จาก 1,657 ใบ** เพราะรหัสทุกใบขึ้นต้นด้วย `TM`
 *      เพิ่ม "มีตัว A" → **พัง 170 ใบ** เพราะ A ที่ตำแหน่งที่ 6 คือ **เดือน** ไม่ใช่หน่วย
 *
 *    ส่วนตำแหน่งที่ 7 เป็นหนึ่งใน H U T A เสมอ **ครบทั้ง 1,657 ใบ ไม่มีข้อยกเว้น**
 *    รองรับทั้งสองรูปแบบที่ใช้จริง เพราะทั้งคู่ยาวหกตัวก่อนถึงตัวอักษรหน่วย
 *      `TM` + เลขสี่หลัก + ตัวอักษรหน่วย      เช่น TM5269H688   (1,484 ใบ)
 *      `TM` + เลขสามหลัก + เดือน + ตัวอักษรหน่วย  เช่น TM526AH123   (173 ใบ)
 *
 * ตัวอักษรที่ไม่รู้จัก หรือรหัสที่สั้นเกินไป คืนค่าว่าง — **ห้ามเดา**
 * ใบส่งสินค้าแยกตามหน่วย เดาผิดแล้วของไปออกใบผิดหน่วยโดยไม่มีใครรู้
 */
const SUB_BY_LETTER = { H: 'TUE-H', U: 'TUE-U', T: 'TUE-T', A: 'TUE-A' };

function subNameFromPo(poNo){
  const s = String(poNo == null ? '' : poNo).trim().toUpperCase();
  if(!s.startsWith('TM') || s.length < 7) return '';
  return SUB_BY_LETTER[s.charAt(6)] || '';
}

function parseSelectedSheet(){
  const name = document.getElementById('sheetSelect').value;
  if(!workbookGlobal || !name) return null;
  const ws = sheetByName(workbookGlobal, name);
  if(!ws) return null;
  const rows = sheetRows(ws);

  // ⚠️ หาคอลัมน์จากหัวตารางก่อนเสมอ — ห้ามกลับไปใช้ดัชนีตายตัว อ่านเหตุผลที่ PLAN_HEAD
  const head = findPlanCols(rows);
  if(head.error) return {error: head.error};
  const C = head.cols;

  const items=[]; const seenIds={};
  let reportedTotal=null;
  const at = (row, field) => C[field]!=null ? row[C[field]] : null;
  const txt = v => v!=null ? String(v).trim() : '';

  for(let i=head.headerIdx+1; i<rows.length; i++){
    const row = rows[i];
    if(!row) continue;

    // แถวยอดรวมท้ายตาราง — หาคำว่า TOTAL ในช่องไหนก็ได้ของแถว แล้วอ่านยอดจาก
    // คอลัมน์เดียวกับที่ใช้เป็นยอดสั่ง ไม่ใช่คอลัมน์ตายตัวที่เลื่อนตามผังไฟล์
    if(row.some(v => typeof v === 'string' && v.trim().toUpperCase() === 'TOTAL')){
      const t = at(row, 'orderQty');
      if(typeof t === 'number') reportedTotal = t;
      continue;
    }

    const pnRaw = at(row, 'pn'), poRaw = at(row, 'poNo');
    if (poRaw==null || poRaw==='' || pnRaw==null || pnRaw==='') continue;
    const qty = Number(at(row, 'orderQty'));
    if (!qty || qty<=0 || isNaN(qty)) continue;

    const poNo = txt(poRaw);
    const pn = txt(pnRaw);
    let id = poNo+'|'+pn;
    if (seenIds[id]!=null){ seenIds[id]++; id = id+'-'+seenIds[id]; } else { seenIds[id]=1; }

    items.push({
      id,
      week: name.trim(),
      poNo, pn,
      subName: subNameFromPo(poNo),
      osc: txt(at(row, 'osc')),
      pc: txt(at(row, 'pc')),
      orderQty: qty,
      orderDate: excelValueToISO(at(row, 'orderDate')),
      planWinding: excelValueToISO(at(row, 'planWinding')),
      planAssembly: excelValueToISO(at(row, 'planAssembly')),
      planSupport: excelValueToISO(at(row, 'planSupport')),
      planInspection: excelValueToISO(at(row, 'planInspection'))
    });
  }
  return {items, reportedTotal, sheetName:name};
}

/* ---------- Cumulative / deadline / status helpers ---------- */
// Soft-deleted records (voided:true) are excluded from every aggregate below but stay in
// state.records — a hard delete would resurrect on the next Google Sheets pull, so deletion
// is a synced flag, not a removal (same pattern as the Bin Card system's `voided` column).
function buildCumMap(records){
  const map = {};
  for(const r of records){
    if(r.voided) continue;
    if(!map[r.orderId]) map[r.orderId] = emptyCum();
    if(map[r.orderId][r.process]==null) continue;
    map[r.orderId][r.process] += Number(r.qty)||0;
  }
  return map;
}
function buildRecordIndex(records){
  const idx = {};
  for(const r of records){ if(!r.voided) idx[r.orderId+'|'+r.process+'|'+r.date] = r.qty; }
  return idx;
}

/** หมายเหตุของรายการ ตามกุญแจ orderId|process|date เดียวกับ buildRecordIndex (A2)
 *  แยก map เพราะตัวนั้นคืนยอด และที่เรียกใช้ต้องการทั้งสองอย่างคนละช่องกัน */
function buildNoteIndex(records){
  const idx = {};
  for(const r of records){
    if(!r.voided) idx[r.orderId+'|'+r.process+'|'+r.date] = String(r.note==null?'':r.note);
  }
  return idx;
}

/** เหตุผลล่าสุดของแต่ละ `orderId|process` ที่ยัง "ค้างอยู่" ณ วันที่เลือกบนจอ
 *  → `{note, date}` ของวันที่ใส่ไว้ หรือ `undefined` ถ้าไม่มีอะไรค้าง
 *
 *  เจ้าของสั่ง 29 ต.ค. 2026 — เหตุผลต้องตามไปวันถัด ๆ ไปจนกว่าจะเปลี่ยนหรือกดปิด
 *  ไม่งั้นต้องมาใส่ใหม่ทุกวันทั้งที่เรื่องเดิมยังไม่จบ
 *
 *  ⚠️ **นับเฉพาะวันที่ไม่เกินวันที่เลือกอยู่** · ย้อนไปดูวันเก่าต้องไม่เห็นเหตุผลที่เพิ่งใส่ทีหลัง
 *     ไม่งั้นจอจะเล่าอดีตด้วยข้อมูลของอนาคต (C1 — วันที่เป็นวันปฏิทินล้วน เทียบเป็นข้อความได้)
 *  ⚠️ **ข้ามรายการที่ยกเลิกไว้ และข้ามหมายเหตุที่ว่าง** · ว่าง = "ไม่เคยใส่" ไม่ใช่ "ปิดแล้ว"
 *     เพราะรายการที่เกิดจากการคีย์ยอดตามปกติก็มี `note` ว่าง ถ้านับว่าเป็นการปิด
 *     เรื่องที่ยังไม่จบจะหายไปทุกวันที่มีคนคีย์ยอด ซึ่งคือทุกวัน
 *  ⚠️ **ตัวปิดคือ `NOTE_CLEARED`** — เจอเป็นตัวล่าสุดแล้วถือว่าไม่มีอะไรค้าง
 *     (ยังคืนค่าออกไปด้วย เพื่อให้ผู้เรียกแยกได้ว่า "ปิดแล้ว" กับ "ไม่เคยมี")
 *  ⚠️ วันเดียวกันซ้ำกัน (สองรายการกุญแจเดียวกัน) หยิบตัวที่เจอทีหลัง **เฉพาะตอนที่มันมีหมายเหตุ**
 *     ถ้าตัวหลังหมายเหตุว่าง ด่าน "ข้ามหมายเหตุที่ว่าง" ข้างบนจะข้ามมัน แล้วย้อนไปได้ตัวแรกแทน
 *     ซึ่งต่างจาก `buildNoteIndex` ที่เอาตัวหลังเสมอ — ผลคือป้ายสืบทอดอาจขึ้นทับวันของตัวเอง
 *     (ผู้ตรวจ #117 รันเจอ: ยืนอยู่วันที่ 29/08 แล้วเห็น "ต่อเนื่องมาจาก 29/08")
 *     **ไม่แก้ที่นี่** — สภาพ "สองแถวกุญแจเดียวกัน" ละเมิด A2 อยู่แล้ว และตอนนั้น `buildCumMap()`
 *     นับยอดซ้ำสองเท่า ซึ่งหนักกว่ามากและเป็นของเดิม · ที่ต้องแก้คือต้นเหตุ (`mergeRowsInto`
 *     จับคู่ด้วย `id` ไม่ใช่กุญแจ) ไม่ใช่ปลายทางตรงนี้ */
function buildCarryIndex(records, onDate){
  const idx = {};
  for(const r of records){
    if(r.voided) continue;
    const note = String(r.note==null?'':r.note);
    /* ⚠️ `trim()` ที่นี่ไม่ใช่ของแต่ง — หมายเหตุที่มีแต่อักขระช่องว่างมาได้จากข้อมูลภายนอก
     *    (เซลล์ในชีตที่มีสเปซ · `applyMerge`) ช่องเขียนเองไม่มีทางสร้างค่านี้
     *    ถ้าไม่ตัด ป้ายจะกลายเป็น `↩    · 29/08` คือเอียงสีจางแต่ไม่มีเหตุผลให้อ่าน
     *    **แล้วตามไปทุกวันจนกว่าจะมีคนกดปิด** — การสืบทอดทำให้ของเสียชิ้นเดียวกวนได้ยาวกว่าเดิมมาก
     *    (ผู้ตรวจ #117 รันเจอ) · ของวันตัวเองยังโชว์ตามเดิมผ่าน `buildNoteIndex` ซึ่งเป็นพฤติกรรมเดิม
     *    ที่ใบนี้ไม่แตะ — ตรงนั้นอย่างน้อยก็อยู่แค่วันเดียว */
    if(!note.trim()) continue;
    const d = String(r.date==null?'':r.date);
    if(!d || d > onDate) continue;
    const key = r.orderId+'|'+r.process;
    const cur = idx[key];
    if(!cur || d >= cur.date) idx[key] = {note, date: d};
  }
  return idx;
}
/** เหมือน buildCumMap แต่แยกยอดสะสมออกเป็น "ทันกำหนด" (บันทึกในหรือก่อนวัน deadline ของขั้นนั้น)
 *  กับ "เกินกำหนด" (บันทึกหลังวัน deadline) — ใช้วาดแถบ progress 2 สีในตาราง Dashboard
 *  ต้องใช้ orderById เพราะ deadline คำนวณจาก orderDate ของแต่ละ order เอง ไม่ใช่ค่าคงที่ */
function buildCumSplitMap(records, orderById){
  const map = {}; const dlCache = {};
  for(const r of records){
    if(r.voided) continue;
    const order = orderById[r.orderId];
    if(!order) continue;
    if(!map[r.orderId]) map[r.orderId] = Object.fromEntries(PROCESSES.map(p=>[p, {onTime:0, late:0}]));
    const bucket = map[r.orderId][r.process];
    if(!bucket) continue;
    if(!dlCache[r.orderId]) dlCache[r.orderId] = computeDeadlines(order);
    const dl = dlCache[r.orderId][r.process];
    const qty = Number(r.qty)||0;
    if(!dl || r.date <= dl) bucket.onTime += qty; else bucket.late += qty;
  }
  return map;
}
function computeDeadlines(order){
  const off = state.deadlineOffsets;
  // ยังไม่ตั้งค่า (null) หรือขั้นที่เพิ่งเพิ่มและยังไม่มีค่า (undefined) = ยังไม่มีกำหนดวัน
  // ⚠️ ต้องไม่กลายเป็น orderDate+0 ไม่งั้นทุกใบจะขึ้นล่าช้าขั้นนั้นทันที (A4)
  return Object.fromEntries(PROCESSES.map(p=>[p, off[p]==null ? null : addDaysISO(order.orderDate, off[p])]));
}
function computeStatus(order, cum, dl, refISO){
  const done = cum.shipping >= order.orderQty;
  if(done) return {code:'done', label:'ส่งของครบแล้ว', color:'green'};
  if(!order.orderDate) return {code:'ok', label:'ไม่มีวันที่สั่งซื้อ', color:'gray'};
  /* ⚠️ A5 — รายงานขั้นปลายน้ำก่อนเสมอ จึงไล่จากขั้นท้ายสุดย้อนขึ้นไป ห้ามไล่จากต้นน้ำ
   * ⚠️ ไล่ MAIN_PROCESSES ไม่ใช่ PROCESSES — เกณฑ์ตรงนี้คือ "ยอดขั้นนั้นยังไม่ถึง orderQty"
   *    ซึ่งเป็นยอดของสายหลัก ขั้นนับแยกไม่มีทางถึง ถ้ารวมมาด้วยจะขึ้นล่าช้าทุกใบทันที
   *    ที่ตั้งวันกำหนดให้ขั้นนับแยกได้ ยังได้เหมือนเดิม — วันถูกคิดและแสดง แค่ไม่ตัดสินล่าช้า */
  for(let i = MAIN_PROCESSES.length - 1; i >= 0; i--){
    const p = MAIN_PROCESSES[i];
    if(dl[p] && refISO > dl[p] && (cum[p]||0) < order.orderQty) return {code:'late', label:ptext(p, 'late'), color:'red'};
  }
  if(dl.shipping){
    const daysLeft = daysBetween(refISO, dl.shipping);
    if(daysLeft!=null && daysLeft<=3) return {code:'soon', label:`ใกล้ครบกำหนด (เหลือ ${daysLeft} วัน)`, color:'amber'};
  }
  return {code:'ok', label:'กำลังดำเนินการ', color:'gray'};
}

/* ---------- Generic UI helpers ---------- */
function fillSelect(id, values){
  const el = document.getElementById(id);
  if(!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">ทั้งหมด</option>' + values.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if(values.includes(cur)) el.value = cur;
}
function uniqueSorted(arr){ return [...new Set(arr.filter(v=>v!=null && v!==''))].sort(); }
function emptyRow(colspan, msg){ return `<tr><td colspan="${colspan}" class="empty-hint">${msg||'ยังไม่มีข้อมูล — กรุณานำเข้าแผนงานก่อน'}</td></tr>`; }

/* ---------- Render: Import tab ---------- */
function renderPreview(parsed){
  const existingIds = new Set(state.orders.map(o=>o.id));
  let newCount=0, updCount=0, sumQty=0;
  const rowsHtml = parsed.items.map(it=>{
    sumQty += it.orderQty;
    const isNew = !existingIds.has(it.id);
    if(isNew) newCount++; else updCount++;
    return `<tr>
      <td>${isNew?'<span class="badge green">ใหม่</span>':'<span class="badge amber">อัปเดต</span>'}</td>
      <td class="left">${escapeHtml(it.poNo)}</td>
      <td class="left">${escapeHtml(it.pn)}</td>
      <td class="left">${it.subName
        ? escapeHtml(it.subName)
        : '<span class="badge red" title="รหัส PO นี้บอกหน่วยไม่ได้ (ต้องขึ้นต้นด้วย TM และตัวอักษรตำแหน่งที่ 7 เป็น H U T หรือ A) '
          + 'นำเข้าได้ แต่ใบสั่งนี้จะไม่ขึ้นในหน้าใบส่งสินค้าของหน่วยใดเลย">'
          + 'หาไม่เจอ</span>'}</td>
      <td class="left">${escapeHtml(it.osc)}</td>
      <td class="left">${escapeHtml(it.pc)}</td>
      <td>${numFmt(it.orderQty)}</td>
      <td>${fmtDateTH(it.orderDate)}</td>
    </tr>`;
  }).join('');
  document.getElementById('previewTable').innerHTML =
    `<thead><tr><th>สถานะ</th><th>PO No.</th><th>P/N</th><th>Sub-Name</th><th>OSC</th><th>PC</th><th>Order Qty</th><th>Order Date</th></tr></thead>
     <tbody>${rowsHtml || emptyRow(8,'ไม่พบรายการที่ถูกต้องใน sheet นี้')}</tbody>`;

  let summary = `พบ ${parsed.items.length} รายการ (ใหม่ ${newCount}, จะอัปเดต ${updCount}) รวม ${numFmt(sumQty)} pcs`;

  /* ⚠️ Sub-Name มาจากตัวอักษรในรหัส PO ถ้าตัดสินไม่ได้จะเป็นค่าว่าง
   *    ใบสั่งที่ Sub-Name ว่างจะไม่โผล่ในหน้าใบส่งสินค้าของหน่วยไหนเลย = ส่งของไม่ได้
   *    ต้องบอกก่อนกดยืนยัน ไม่ใช่ให้ไปงงเอาตอนหาใบไม่เจอ */
  const noSub = parsed.items.filter(it => !it.subName).length;
  if(noSub){
    summary += ` — ⚠️ มี ${numFmt(noSub)} รายการที่บอกหน่วยไม่ได้จากรหัส PO`
             + ` (ต้องขึ้นต้นด้วย TM และตัวอักษรตำแหน่งที่ 7 เป็น H U T หรือ A) รายการเหล่านี้จะไม่ขึ้นในหน้าใบส่งสินค้า`;
  }
  if(parsed.reportedTotal!=null){
    const match = sumQty===parsed.reportedTotal;
    summary += ` — เทียบกับยอด TOTAL ในไฟล์: ${numFmt(parsed.reportedTotal)} pcs ${match? '✅ ตรงกัน':'⚠️ ไม่ตรงกัน กรุณาตรวจสอบข้อมูล'}`;
  }
  document.getElementById('previewSummary').textContent = summary;
  document.getElementById('previewPanel').style.display = '';
}

/* ---------- ยกเลิกใบสั่งที่นำเข้าผิด ----------
 *
 * ⚠️ ต้องพิมพ์ค้นหาก่อนถึงจะขึ้นรายการ — ตั้งใจ · ของจริงมีใบสั่งหลายร้อยใบ
 *    (ชีตเดียวของ WK 35 มี 348 ใบ) ไล่ทั้งตารางมีแต่จะกดผิดใบ
 *    คนที่มาหน้านี้รู้อยู่แล้วว่าจะยกเลิก PO ไหน
 *
 * ⚠️ ยกเลิกได้แม้มียอดคีย์ไว้ แต่ต้องบอกจำนวนก่อน (เจ้าของเลือก 5 ก.ย. 2026)
 *    ยอดไม่ถูกลบ แค่ไม่ถูกนับเพราะใบหายไป · กู้คืนแล้วกลับมาครบ */
function voidRecCount(orderId){
  return state.records.filter(r => r.orderId === orderId && !r.voided).length;
}

function renderOrderVoidTable(){
  const el = document.getElementById('orderVoidTable');
  if(!el) return;
  const q = (document.getElementById('voidSearch').value || '').trim().toLowerCase();
  const showVoided = document.getElementById('voidShowVoided').checked;

  let rows = state.orders.filter(o => showVoided || !o.voided);
  if(q) rows = rows.filter(o =>
    String(o.poNo||'').toLowerCase().includes(q) || String(o.pn||'').toLowerCase().includes(q));
  else rows = [];

  const body = rows.slice(0, 50).map(o=>{
    const n = voidRecCount(o.id);
    const btn = o.voided
      ? `<button class="btn small" data-unvoid="${escapeHtml(o.id)}">↩️ กู้คืน</button>`
      : `<button class="btn danger small" data-void="${escapeHtml(o.id)}">🚫 ยกเลิกใบนี้</button>`;
    return `<tr class="${o.voided?'row-voided':''}">
      <td class="left">${escapeHtml(o.poNo)}</td>
      <td class="left">${escapeHtml(o.pn)}</td>
      <td class="left">${escapeHtml(o.subName||'—')}</td>
      <td>${fmtDateTH(o.orderDate)}</td>
      <td>${numFmt(o.orderQty)}</td>
      <td>${n ? numFmt(n) : '—'}</td>
      <td>${o.voided?'<span class="badge gray">ยกเลิกแล้ว</span> ':''}${btn}</td>
    </tr>`;
  }).join('');

  const empty = q ? 'ไม่พบใบสั่งที่ตรงกับที่ค้นหา' : 'พิมพ์ PO หรือ P/N ที่ต้องการยกเลิกก่อน';
  el.innerHTML =
    `<thead><tr><th>PO No.</th><th>P/N</th><th>Sub-Name</th><th>Order Date</th>
      <th>Open Q'ty</th><th>ยอดที่คีย์ไว้</th><th></th></tr></thead>
     <tbody>${body || emptyRow(7, empty)}</tbody>`;

  el.querySelectorAll('[data-void]').forEach(b=>
    b.addEventListener('click', ()=>setOrderVoided(b.dataset.void, true)));
  el.querySelectorAll('[data-unvoid]').forEach(b=>
    b.addEventListener('click', ()=>setOrderVoided(b.dataset.unvoid, false)));
}

function setOrderVoided(id, voided){
  const o = state.orders.find(x=>x.id===id);
  if(!o) return;
  if(voided){
    const n = voidRecCount(o.id);
    const warn = n
      ? `\n\n⚠️ ใบนี้มียอดคีย์ไว้ ${numFmt(n)} รายการ ยกเลิกแล้วยอดพวกนี้จะหายไปจากการนับทุกหน้า`
        + `\n(ยอดไม่ถูกลบ — กดกู้คืนเมื่อไหร่ก็กลับมาครบ)`
      : '';
    if(!confirm(`ยกเลิกใบสั่ง ${o.poNo} / ${o.pn} ?${warn}`)) return;
  }
  o.voided = !!voided;
  o.updatedAt = new Date().toISOString();
  o._dirty = true;
  saveState();
  toast(voided ? `ยกเลิกใบสั่ง ${o.poNo} แล้ว` : `กู้คืนใบสั่ง ${o.poNo} แล้ว`);
  renderAll();
  doSync();
}

function renderImportHistory(){
  const hist = state.importHistory || [];
  const rows = hist.map((h,origIdx)=>({h,origIdx})).slice().reverse().map(({h,origIdx})=>{
    const isShip = h.type==='ship' || (h.week||'').startsWith('ส่งของ ');
    let actionCell = '';
    if(isShip) actionCell = h.deletedTs
      ? '<span class="badge gray">ลบแล้ว</span>'
      : `<button class="btn danger small" data-del-batch="${origIdx}">🗑️ ลบยอดชุดนี้</button>`;
    return `<tr>
      <td>${new Date(h.ts).toLocaleString('th-TH')}</td>
      <td class="left">${escapeHtml(h.week)}</td>
      <td>${h.newCount}</td><td>${h.updCount}</td><td>${numFmt(h.sumQty)}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');
  document.getElementById('importHistoryTable').innerHTML =
    `<thead><tr><th>เวลา</th><th>Sheet</th><th>รายการใหม่</th><th>อัปเดต</th><th>รวม Qty</th><th></th></tr></thead>
     <tbody>${rows || emptyRow(6,'ยังไม่มีประวัติการนำเข้า')}</tbody>`;

  document.querySelectorAll('#importHistoryTable [data-del-batch]').forEach(el=>{
    el.addEventListener('click', function(){
      const entry = state.importHistory[Number(this.dataset.delBatch)];
      if(!entry) return;
      if(!confirm('ลบยอดส่งที่นำเข้าชุดนี้ทั้งหมด? (กู้คืนได้ทีหลังในตาราง "แก้ไข/ลบรายการที่บันทึกแล้ว")')) return;

      let idsToVoid = [];
      if(entry.batchId){
        idsToVoid = state.records.filter(r=>r.batchId===entry.batchId && !r.voided).map(r=>r.id);
      } else {
        // entry เก่าก่อนมี batchId — จับคู่ด้วยวันที่ที่ฝังอยู่ใน week ("ส่งของ YYYY-MM-DD")
        const m = (entry.week||'').match(/^ส่งของ (\d{4}-\d{2}-\d{2})$/);
        if(m) idsToVoid = state.records
          .filter(r=>r.process==='shipping' && r.note===SOURCE_SHIP_IMPORT && r.date===m[1] && !r.voided)
          .map(r=>r.id);
      }
      if(!idsToVoid.length){ toast('ไม่พบรายการที่จะลบ (อาจถูกลบหรือแก้ไขไปแล้ว)'); return; }

      entry.deletedTs = Date.now();
      const n = voidRecords(idsToVoid); // saveState + renderAll + doSync ในตัว
      toast(`ลบยอดส่งชุดนี้แล้ว ${n} รายการ`);
    });
  });
}

/* ---------- Render: Entry tab ---------- */
/* ⚠️ สะสม กับ คงเหลือ เป็นคอลัมน์ของตัวเอง — 9 ก.ย. 2026 (#80) เคยยุบเป็นแถบใต้ Order Qty
 *    เจ้าของสั่งแยกกลับเมื่อ 12 ก.ย. 2026 พร้อมเพิ่มคอลัมน์ Aging และให้ตารางเต็มกรอบ
 *
 * ⚠️ คงเหลือครอบที่ 0 แต่ "สะสม" ไม่ครอบ · ใบที่คีย์เกินต้องเห็นสะสมมากกว่ายอดแผนได้ ซึ่งเป็นความจริง */
function renderEntryTable(){
  const dateEl = document.getElementById('entryDate');
  const date = dateEl.value || todayISO();
  const search = document.getElementById('entrySearch').value.trim().toLowerCase();
  const weekFilter = document.getElementById('entryWeekFilter').value;
  const subFilter = document.getElementById('entrySubFilter').value;
  const hideDone = document.getElementById('entryHideDone').checked;

  const allCum = buildCumMap(state.records);
  const recIndex = buildRecordIndex(state.records);
  const noteIndex = buildNoteIndex(state.records);
  const carryIndex = buildCarryIndex(state.records, date);
  const prevProc = PREV_PROCESS[currentProcess];
  const procLabel = PROCESS_LABELS[currentProcess];
  /* ยอดส่งของมีทางเขียนทางเดียวคือหน้าใบส่งสินค้า (A2) — หน้านี้โชว์อย่างเดียว
   * เจ้าของสั่งปิดช่องกรอกเมื่อ 23 ต.ค. 2026 · ก่อนหน้านี้เปิดไว้เป็นทางสำรองระหว่างเปลี่ยนผ่าน
   * แล้วสองทางเขียนกุญแจ orderId|shipping|date เดียวกัน ทับกันเงียบ ๆ โดยไม่มีใครรู้ว่าอันไหนถูก */
  const isShip = currentProcess === 'shipping';
  document.getElementById('entryShipNote').hidden = !isShip;
  /* ใบที่บอกหน่วยไม่ได้จาก `subNameFromPo()` จะไม่ขึ้นในหน้าใบส่งสินค้าของหน่วยไหนเลย
   * (`deliveryGroups()` กรอง `o.subName === unit` · `renderDnUnits()` ทิ้งค่าว่าง)
   * = ส่งของใบนั้นไม่ได้ ยอดค้าง 0 ตลอดไป Dashboard ขึ้นล่าช้าถาวร FG ไม่ลด
   *
   * ⚠️ หน้าตรวจก่อนนำเข้าเตือนครั้งเดียวตอนกดยืนยันแล้วหายไป — ตรงนี้คือที่ที่คนจะมาหา
   *    คำตอบว่า "ทำไมใบนี้ไม่มียอดส่งของ" จึงต้องเตือนทุกวันที่เปิดดู
   *    ตรวจ 25 ต.ค. 2026 ของจริงมี 0 ใบ · ที่ต้องระวังคือตอนเพิ่มนิติบุคคลตัวถัดไป
   *    แล้วลืมเติมตัวอักษรเข้า SUB_BY_LETTER — ทุกใบของหน่วยนั้นจะเงียบหายไปทั้งหน่วย */
  if(isShip){
    /* ⚠️ นับเฉพาะใบที่ยังมียอดค้างส่ง — ใบที่ส่งครบแล้วไม่ต้องใช้หน้าใบส่งสินค้าอีก
     *    ถ้านับมันด้วย แถบจะติดค้างถาวรแล้วคนเลิกอ่าน ซึ่งตรงข้ามกับเหตุผลที่มีแถบนี้ */
    const noUnit = activeOrders().filter(o=>
      !String(o.subName==null?'':o.subName).trim() && wipBalance(o, allCum[o.id]) > 0);
    /* ⚠️ สองพวกนี้แก้คนละทาง ห้ามรวมเป็นข้อความเดียว
     *    ปุ่ม "คำนวณ Sub-Name ใหม่" **ข้ามใบที่รหัส PO ตัดสินไม่ได้** (ดู btnRecalcSubName)
     *    แนะปุ่มให้พวกหลังคือส่งคนไปกดของที่ไม่เกิดอะไร แล้วเขาจะคิดว่าตัวเองทำผิด
     *    (ผู้ตรวจ #110 รันพิสูจน์: กดแล้ว subName ยังว่างเหมือนเดิม) */
    const byPo  = noUnit.filter(o=> subNameFromPo(o.poNo));
    const stuck = noUnit.filter(o=> !subNameFromPo(o.poNo));
    const box = document.getElementById('entryShipNoUnit');
    box.hidden = !noUnit.length;
    if(noUnit.length){
      const list = a => escapeHtml(a.slice(0,5).map(o=>o.poNo).join(' · '))
        + (a.length>5 ? ' และอีก ' + numFmt(a.length-5) + ' ใบ' : '');
      const parts = [];
      /* ⚠️ ต้องบอกว่าปุ่มนั้นเป็น "งานเหมา" — มันเขียน subName ใหม่ให้ทุกใบที่รหัส PO ตัดสินได้
       *    รวมใบที่มีหน่วยอยู่แล้วแต่ไม่ตรงรหัส · กล่องยืนยันสรุปครบก่อนเปลี่ยน ไม่เงียบ
       *    แต่แถบนี้ส่งคนหน้างานไปกด ไม่ใช่เจ้าของ จึงต้องรู้ก่อนว่ากำลังจะกดอะไร (ผู้ตรวจ #110) */
      if(byPo.length) parts.push(`<b>${numFmt(byPo.length)} ใบ</b> ช่อง Sub-Name ว่าง `
        + `แต่รหัส PO บอกหน่วยได้ (${list(byPo)}) — กดปุ่ม "คำนวณ Sub-Name ใหม่" `
        + 'ที่หน้า "ข้อมูล \u0026 แชร์" · ปุ่มนั้นแก้ทุกใบที่รหัส PO ตัดสินได้พร้อมกัน '
        + 'และสรุปให้ดูก่อนยืนยัน');
      if(stuck.length) parts.push(`<b>${numFmt(stuck.length)} ใบ</b> รหัส PO บอกหน่วยไม่ได้ `
        + `(${list(stuck)}) — <b>ปุ่มคำนวณ Sub-Name ใหม่ช่วยไม่ได้</b> `
        + 'ถ้ารหัส PO พิมพ์ผิดให้แก้แล้วนำเข้าใหม่ · ถ้ารหัสถูกอยู่แล้ว '
        + 'แปลว่ามีหน่วยใหม่ที่โปรแกรมยังไม่รู้จัก ต้องแจ้งผู้ดูแลให้เพิ่มตัวอักษรหน่วยเข้าโปรแกรม');
      box.innerHTML = `<span class="badge red">ส่งของไม่ได้ ${numFmt(noUnit.length)} ใบ</span> `
        + 'ไม่ขึ้นในหน้าใบส่งสินค้าของหน่วยไหนเลย<br>' + parts.join('<br>');
    }
  }

  let orders = activeOrders().filter(o=>o.status!=='closed');
  if(weekFilter) orders = orders.filter(o=>o.week===weekFilter);
  /* ⚠️ เทียบข้อความตรงตัวเหมือนหน้าอื่น — ห้ามเดาหน่วยจากรหัส PO ตรงนี้
   *    subNameFromPo() เป็นของ "ตอนนำเข้า" เท่านั้น ถ้าเอามาใช้ตอนกรองด้วย
   *    ใบที่ตัดสินจากรหัส PO ไม่ได้ (ซึ่งตั้งใจให้ Sub-Name ว่าง) จะโผล่มาผิดกลุ่ม
   *    และจะไม่ตรงกับที่หน้า Dashboard กับใบส่งสินค้ากรอง */
  if(subFilter) orders = orders.filter(o=>o.subName===subFilter);
  if(search) orders = orders.filter(o=> String(o.poNo).toLowerCase().includes(search) || String(o.pn).toLowerCase().includes(search));
  orders = orders.slice().sort((a,b)=> (a.week||'').localeCompare(b.week) || (a.orderDate||'').localeCompare(b.orderDate));

  lastRenderedOrderIds = [];
  let rowsHtml = '';
  let n=0;
  const ref = todayISO();
  orders.forEach(o=>{
    const cum = (allCum[o.id] && allCum[o.id][currentProcess]) || 0;
    if(hideDone && cum>=o.orderQty) return;
    const todayKey = o.id+'|'+currentProcess+'|'+date;
    const todayVal = recIndex[todayKey];
    const todayNote = noteIndex[todayKey] || '';
    /* เหตุผลที่ค้างมาจากวันก่อน — ใช้เฉพาะตอนวันนี้ยังไม่ได้ใส่เอง
     * ⚠️ ห้ามโชว์เป็นค่าที่ถูกเลือกไว้เฉย ๆ · ต้องบอกด้วยว่ามาจากวันไหน ไม่งั้นคนอ่านจะเข้าใจว่า
     *    มีคนใส่ไว้ให้วันนี้แล้ว ทั้งที่ข้อมูลของวันนี้ยังว่าง (จอต้องไม่เล่าเกินข้อมูล) */
    const carry = todayNote ? null : carryIndex[o.id+'|'+currentProcess];
    const carried = carry && carry.note !== NOTE_CLEARED ? carry : null;
    const prevCum = prevProc!=null ? ((allCum[o.id] && allCum[o.id][prevProc]) || 0) : null;
    const warn = prevProc!=null && cum > prevCum;
    const remaining = Math.max(0, o.orderQty - cum);
    // Aging นิยามและสีเดียวกับคอลัมน์ Aging บน Dashboard — ใช้ agingCell กับ computeStatus ตัวเดียวกัน
    // ⚠️ นับถึง "วันนี้" ไม่ใช่วันที่เลือกคีย์ย้อนหลัง ไม่งั้นสองหน้าจะขึ้นอายุงานของใบเดียวกันไม่ตรงกัน
    const aging = daysBetween(o.orderDate, ref);
    const st = computeStatus(o, allCum[o.id] || emptyCum(), computeDeadlines(o), ref);
    n++;
    lastRenderedOrderIds.push(o.id);
    rowsHtml += `<tr${warn?' style="background:var(--amber-light)"':''}>
      <td>${n}</td>
      <td class="left">${escapeHtml(o.week)}</td>
      <td class="left">${escapeHtml(o.poNo)}</td>
      <td class="left">${escapeHtml(o.pn)}</td>
      <td>${numFmt(o.orderQty)}</td>
      <td data-aging>${agingCell(aging, st.code)}</td>
      <td><span class="cum">${numFmt(cum)}</span>${warn?' <span class="badge amber" title="ยอดสะสมเกินขั้นตอนก่อนหน้า">⚠</span>':''}</td>
      <td class="rem">${numFmt(remaining)}</td>
      <td>${isShip
        ? `<span class="ship-today">${todayVal!=null ? numFmt(todayVal) : '—'}</span>`
        : `<input type="number" min="0" class="row-input" data-order="${escapeHtml(o.id)}" value="${todayVal!=null?todayVal:''}">`}</td>
      ${/* ⚠️ แถวส่งของไม่มีช่องเลือก · note ของแถวนั้นคือคำว่า "จากใบส่งสินค้า" ที่ระบบใช้บอกที่มา
             ทับแล้วคอลัมน์แหล่งที่มากับตัวกรองของหน้าแก้ไขรายการจะนับยอดนั้นเป็นยอดคีย์มือ
           ⚠️ ค่าเดิมที่ไม่อยู่ใน ENTRY_NOTES ต้องยังเลือกค้างและอ่านออก — เกิดได้จริงเมื่อ
             เครื่องอื่นใช้รายการคนละชุด หรือรายการถูกแก้ทีหลัง · ทำให้หายคือทำข้อมูลของคนอื่นหาย */''}
      <td>${isShip
        ? `<span class="row-note-na" title="ยอดส่งของคีย์ที่หน้าใบส่งสินค้า — ช่องหมายเหตุของแถวนั้นระบบใช้บอกที่มาของยอด">—</span>`
        : `<select class="row-note${carried ? ' carried' : ''}" data-order="${escapeHtml(o.id)}"`
          + `${carried ? ` title="ต่อเนื่องมาจากวันที่ ${escapeHtml(fmtDateTH(carried.date))} — เลือกใหม่เพื่อเปลี่ยน หรือเลือก ${escapeHtml(NOTE_CLEARED)} เพื่อปิดเรื่องนี้"` : ''}>`
          + `<option value=""${todayNote ? '' : ' selected'}>`
          /* วันที่รูปสั้น วัน/เดือน — ตัวเต็มอยู่ใน title ของช่อง
           * ⚠️ `date` เป็นวันปฏิทินล้วนรูป YYYY-MM-DD (A2/C1) ตัดด้วยตำแหน่งได้ ไม่ต้องแปลงเป็น Date
           *    ซึ่งจะเลื่อนวันเพราะเขตเวลา · ปีหายจากป้ายแต่ยังอยู่ใน title ซึ่งพอสำหรับ
           *    เรื่องที่ค้างข้ามปี (พบยาก) และได้ที่คืนมา ~38px ให้ตัวเหตุผลที่คนต้องอ่าน */
          + `${carried ? `↩ ${escapeHtml(carried.note)} · ${escapeHtml(carried.date.slice(8,10)+'/'+carried.date.slice(5,7))}` : '— ไม่ระบุ —'}</option>`
          + ENTRY_NOTES.map(x=>`<option value="${escapeHtml(x)}"${x===todayNote?' selected':''}>${escapeHtml(x)}</option>`).join('')
          + (todayNote && !ENTRY_NOTES.includes(todayNote)
              ? `<option value="${escapeHtml(todayNote)}" selected>${escapeHtml(todayNote)} (ค่าเดิม)</option>` : '')
          + `</select>`}</td>
    </tr>`;
  });

  document.getElementById('entryTable').innerHTML =
    `<thead><tr><th>#</th><th>สัปดาห์</th><th>PO No.</th><th>P/N</th><th>Order Qty</th><th>Aging<br>(วัน)</th>
     <th>สะสม ${escapeHtml(procLabel)}</th><th>คงเหลือ</th><th>${isShip ? 'ยอดวันนี้<br><span class="small">(แก้ที่ใบส่งสินค้า)</span>' : 'ยอดวันนี้'}</th>
     <th>หมายเหตุ</th></tr></thead>
     <tbody>${rowsHtml || emptyRow(10,'ไม่พบบรรทัดแผนงาน — นำเข้าแผนงานก่อน หรือปรับตัวกรอง')}</tbody>`;

  document.querySelectorAll('#entryTable input.row-input').forEach(inputEl=>{
    inputEl.addEventListener('keydown', function(e){
      if(e.key==='Enter'){
        e.preventDefault();
        const idx = lastRenderedOrderIds.indexOf(this.dataset.order);
        pendingFocusOrderId = lastRenderedOrderIds[idx+1] || null;
        this.blur();
      }
    });
    inputEl.addEventListener('change', function(){
      saveEntryValue(this.dataset.order, this.value, date);
      renderEntryTable();
      renderRecordEditor();
      renderSyncBadge();
      if(pendingFocusOrderId){
        const el = document.querySelector(`#entryTable input[data-order="${CSS.escape(pendingFocusOrderId)}"]`);
        if(el){ el.focus(); el.select(); }
        pendingFocusOrderId = null;
      }
    });
  });

  /* ช่องเลือกเหตุผล
   *
   * ⚠️ วาดตารางใหม่ **เฉพาะตอนที่หน้าตาของตารางเปลี่ยนจริง** — `saveEntryNote()` บอกมาเอง
   *    เปลี่ยนเหตุผลของรายการที่มีอยู่แล้วไม่ทำให้ช่องไหนบนตารางเปลี่ยนเลย (เหตุผลอยู่ในตัว
   *    `select` ซึ่งเบราว์เซอร์อัปเดตให้แล้ว) การวาดใหม่จึงเป็นงานเปล่า
   *    และไม่ใช่งานเปล่าที่ถูก ๆ — ตารางขนาดของจริง (712 ใบ) วาดครั้งละ ~95 ms
   *    ส่วนการกดลูกศรยิง change **ทุกครั้ง** ต่างจากช่องยอดที่ยิงครั้งเดียวตอนออกจากช่อง
   *    ไล่เหตุผลจากตัวแรกถึงตัวท้ายจึงเคยเสียเวลาวาดตารางเปล่า ๆ เจ็ดรอบ
   *    (ผู้ตรวจ #115 วัดได้ 274 ms ต่อการกดลูกศรหนึ่งครั้งบนตาราง 712 ใบ)
   *
   * ⚠️ แต่ตอนที่ **ต้อง** วาดก็ต้องวาดจริง ๆ — **เงื่อนไขอยู่ที่ค่าที่ `saveEntryNote()` คืน
   *    ที่เดียว ไปอ่านที่นั่น** · หลักการคือวาดใหม่เมื่อสิ่งที่ตาเห็นในแถวเปลี่ยน
   *    (ช่อง "ยอดวันนี้" · ป้ายสืบทอด · ตัวเลือก "(ค่าเดิม)") ดู `CLAUDE.md` ประกอบ
   *
   *    ⚠️ **ห้ามเขียนรายการกรณีไว้ตรงนี้** — เคยเขียนแล้วสามรอบ และนับไม่ครบทั้งสามรอบ
   *    (#115 ตกข้อ "ค่าเดิมนอกรายการ" · #117 ตกทั้งสองทิศของความว่าง รอบละทิศ)
   *    รายการที่ต้องนับมือให้ตรงกับโค้ดที่อยู่คนละที่ คือของที่จะหลุดเสมอ */
  document.querySelectorAll('#entryTable select.row-note').forEach(sel=>{
    sel.addEventListener('change', function(){
      const oid = this.dataset.order;
      const redraw = saveEntryNote(oid, this.value, date);
      renderRecordEditor();
      renderSyncBadge();
      if(!redraw) return;
      renderEntryTable();
      /* ⚠️ ต้องคืนโฟกัสเอง — วาดตารางใหม่แล้วอิลิเมนต์เดิมหายไปพร้อมโฟกัส
       *    Chrome ยิง change **ทุกครั้งที่กดลูกศร** บน select ที่ยังไม่เปิดรายการ
       *    พอโฟกัสหลุดตั้งแต่ลูกศรครั้งแรก ลูกศรครั้งต่อไปไม่ถึงช่องนี้แล้ว
       *    เหตุผลตัวที่สองเป็นต้นไปจึงเอื้อมไม่ถึงด้วยแป้นพิมพ์ และค่าที่ค้างอยู่คือ
       *    ตัวแรกของรายการซึ่งเขาไม่ได้ตั้งใจเลือก (ผู้ตรวจ #115 รันพิสูจน์บน Chromium)
       *    ช่องยอดมี pendingFocusOrderId คืนให้อยู่แล้ว ช่องนี้ต้องมีของตัวเอง (G2) */
      const again = document.querySelector(
        `#entryTable select.row-note[data-order="${CSS.escape(oid)}"]`);
      if(again) again.focus();
    });
  });
}

/* ---------- Record editor: แก้ไข/ลบรายการที่บันทึกแล้ว ---------- */
let recSelectedIds = new Set();

function renderRecordEditor(){
  const dateF = document.getElementById('recFilterDate').value;
  const procF = document.getElementById('recFilterProcess').value;
  const srcF = document.getElementById('recFilterSource').value;
  const search = document.getElementById('recFilterSearch').value.trim().toLowerCase();
  const showVoided = document.getElementById('recShowVoided').checked;

  const orderById = {}; state.orders.forEach(o=>orderById[o.id]=o);
  let rows = state.records.filter(r=>showVoided ? true : !r.voided);
  if(dateF) rows = rows.filter(r=>r.date===dateF);
  if(procF) rows = rows.filter(r=>r.process===procF);
  if(srcF==='ship') rows = rows.filter(r=>r.note===SOURCE_SHIP_IMPORT);
  if(srcF==='manual') rows = rows.filter(r=>r.note!==SOURCE_SHIP_IMPORT);
  if(search){
    rows = rows.filter(r=>{
      const o = orderById[r.orderId];
      return o && (String(o.poNo).toLowerCase().includes(search) || String(o.pn).toLowerCase().includes(search));
    });
  }
  rows.sort((a,b)=> (b.date||'').localeCompare(a.date) || (b.updatedAt||'').localeCompare(a.updatedAt));

  const total = rows.length;
  // เลือกวันที่เจาะจงแล้วไม่ตัดที่ 300 แถว — วันเดียวต้องได้ครบใบ ไม่งั้นกระดาษที่พิมพ์ขาดหายโดยคนพิมพ์ไม่รู้ตัว
  const limited = dateF ? rows : rows.slice(0, 300);
  // เลิกจำ selection ของรายการที่ไม่อยู่ในผลกรองปัจจุบันแล้ว กัน "ลบรายการที่เลือก" ลบของที่มองไม่เห็นอยู่
  const visibleIds = new Set(limited.map(r=>r.id));
  recSelectedIds.forEach(id=>{ if(!visibleIds.has(id)) recSelectedIds.delete(id); });

  const bodyHtml = limited.map(r=>{
    const o = orderById[r.orderId];
    const source = r.note===SOURCE_SHIP_IMPORT ? 'ใบส่งงาน'
                 : r.note===SOURCE_DELIVERY ? 'ใบส่งสินค้า' : 'กรอกมือ';
    const actionBtn = r.voided
      ? `<button class="btn small" data-restore="${r.id}">↩️ กู้คืน</button>`
      : `<button class="btn danger small" data-delete="${r.id}">🗑️ ลบ</button>`;
    return `<tr class="${r.voided?'row-voided':''}">
      <td><input type="checkbox" class="rec-chk" data-id="${r.id}" ${recSelectedIds.has(r.id)?'checked':''}></td>
      <td>${fmtDateTH(r.date)}</td>
      <td class="left">${escapeHtml(PROCESS_LABELS[r.process]||r.process)}</td>
      <td class="left">${escapeHtml(o?o.poNo:'?')}</td>
      <td class="left">${escapeHtml(o?o.pn:'?')}</td>
      <td><input type="number" min="0" class="row-input rec-qty-input" data-id="${r.id}" value="${r.qty}" ${r.voided?'disabled':''}></td>
      <td class="left">${source}${r.voided?' <span class="badge gray">ลบแล้ว</span>':''}</td>
      <td class="left">${escapeHtml(r.deviceName||'-')}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');

  document.getElementById('recordEditorTable').innerHTML =
    `<thead><tr><th></th><th>วันที่</th><th>Process</th><th>PO No.</th><th>P/N</th><th>จำนวน</th><th>แหล่งที่มา</th><th>เครื่องที่กรอก</th><th></th></tr></thead>
     <tbody>${bodyHtml || emptyRow(9,'ไม่พบรายการตามตัวกรองนี้')}</tbody>`;
  const oldNote = document.getElementById('recTruncNote'); if(oldNote) oldNote.remove();   // ไม่งั้นข้อความ "แสดงไม่ครบ" ของรอบก่อนค้างอยู่ แล้วติดไปบนกระดาษทั้งที่ตอนนี้แสดงครบแล้ว
  if(total>limited.length){
    document.getElementById('recordEditorTable').insertAdjacentHTML('afterend',
      `<div id="recTruncNote" class="small muted" style="margin-top:6px;">แสดง ${numFmt(limited.length)} จาก ${numFmt(total)} รายการ — กรองตามวันที่หรือค้นหาเพื่อดูรายการที่เหลือ</div>`);
  }

  document.getElementById('recSelectedCount').textContent = recSelectedIds.size;

  document.querySelectorAll('#recordEditorTable .rec-chk').forEach(el=>{
    el.addEventListener('change', function(){
      if(this.checked) recSelectedIds.add(this.dataset.id); else recSelectedIds.delete(this.dataset.id);
      document.getElementById('recSelectedCount').textContent = recSelectedIds.size;
    });
  });
  document.querySelectorAll('#recordEditorTable .rec-qty-input').forEach(el=>{
    el.addEventListener('change', function(){
      const qty = Number(this.value);
      if(isNaN(qty) || qty<0){ toast('กรุณากรอกตัวเลขที่ถูกต้อง (>= 0)'); renderRecordEditor(); return; }
      const idx = state.records.findIndex(r=>r.id===this.dataset.id);
      if(idx>-1){
        state.records[idx].qty = qty;
        state.records[idx].updatedAt = new Date().toISOString();
        state.records[idx]._dirty = true;
        saveState(); renderAll(); doSync();
      }
    });
  });
  document.querySelectorAll('#recordEditorTable [data-delete]').forEach(el=>{
    el.addEventListener('click', function(){
      if(!confirm('ลบรายการนี้? (กู้คืนได้ทีหลัง)')) return;
      voidRecords([this.dataset.delete]);
    });
  });
  document.querySelectorAll('#recordEditorTable [data-restore]').forEach(el=>{
    el.addEventListener('click', function(){
      const idx = state.records.findIndex(r=>r.id===this.dataset.restore);
      if(idx>-1){
        state.records[idx].voided = false;
        state.records[idx].updatedAt = new Date().toISOString();
        state.records[idx]._dirty = true;
        saveState(); renderAll(); doSync();
      }
    });
  });
}

/** ลบแบบ soft-delete (ตั้ง voided:true) — ไม่ลบถาวรเพราะจะขัดกับการซิงค์ Google Sheets */
function voidRecords(ids){
  const now = new Date().toISOString();
  const idSet = new Set(ids);
  let n=0;
  state.records.forEach(r=>{
    if(idSet.has(r.id) && !r.voided){ r.voided = true; r.updatedAt = now; r._dirty = true; n++; }
  });
  saveState();
  recSelectedIds.clear();
  renderAll();
  doSync();
  return n;
}

function saveEntryValue(orderId, rawVal, date){
  /* ⚠️ ด่านนี้ไม่ใช่ของซ้ำกับการไม่วาดช่องกรอก — มันกันทางที่เหลือ
   *    ยอดส่งของต้องมีทางเขียนทางเดียวคือ saveAllocation() ของหน้าใบส่งสินค้า (A2)
   *    ถ้าวันหนึ่งมีใครวาดช่องกรอกกลับมา หรือเรียกฟังก์ชันนี้จากที่อื่น
   *    กุญแจ orderId|shipping|date จะถูกเขียนจากสองที่แล้วทับกันเงียบ ๆ อีกรอบ */
  if(currentProcess === 'shipping'){
    toast('ยอดส่งของคีย์ที่หน้าใบส่งสินค้า — หน้านี้แสดงผลอย่างเดียว');
    return;
  }
  const idx = state.records.findIndex(r=>r.orderId===orderId && r.process===currentProcess && r.date===date);
  if(rawVal===''||rawVal==null){
    // เจตนาไม่ลบบันทึกเดิมเมื่อเคลียร์ช่องว่าง (ต่างจากเดิม) — เพื่อไม่ให้ขัดกับการซิงค์ข้าม
    // เครื่อง: ถ้าลบในเครื่องเดียวแต่เซิร์ฟเวอร์ยังมีอยู่ ซิงค์รอบถัดไปจะดึงกลับมาใหม่เหมือนเดิม
    // ถ้าต้องการแก้ยอดที่กรอกผิด ให้พิมพ์ 0 ทับแทนการลบ
    return;
  }
  const qty = Number(rawVal);
  if(isNaN(qty) || qty<0){ toast('กรุณากรอกตัวเลขที่ถูกต้อง (>= 0)'); return; }
  // ถามยืนยันก่อนบันทึก ถ้ายอดสะสมของขั้นนี้จะเกิน Order Qty — แค่ถาม ไม่ห้าม
  // (ผลิตเกินจริงเกิดขึ้นได้ และห้ามทิ้งยอดที่พนักงานคีย์ไว้ — INVARIANTS D3/D7)
  const ord = state.orders.find(o=>o.id===orderId);
  const ordQty = ord ? Number(ord.orderQty) : NaN;
  if(!isNaN(ordQty) && ordQty>0){
    const curCum = ((buildCumMap(state.records)[orderId])||emptyCum())[currentProcess] || 0;
    // คีย์ทับคือ "แทนที่" ไม่ใช่ "บวกเพิ่ม" จึงต้องหักยอดเดิมของวันนั้นออกก่อน
    const oldQty = (idx>-1 && !state.records[idx].voided) ? (Number(state.records[idx].qty)||0) : 0;
    const newCum = curCum - oldQty + qty;
    if(newCum > ordQty){
      const label = PROCESS_LABELS[currentProcess] || currentProcess;
      if(!confirm(`ยอดสะสม ${label} ของ ${ord.poNo} จะเป็น ${numFmt(newCum)} ซึ่งเกิน Order Qty ${numFmt(ordQty)}\nยืนยันบันทึกหรือไม่?`)) return;
    }
  }
  const now = new Date().toISOString();
  if(idx>-1){
    state.records[idx].qty = qty;
    state.records[idx].updatedAt = now;
    state.records[idx].deviceName = state.deviceName;
    state.records[idx].voided = false; // พิมพ์ค่าใหม่ทับรายการที่เคยลบ = กู้คืนรายการนั้น
    state.records[idx]._dirty = true;
  } else {
    state.records.push({id:uid(), date, orderId, process:currentProcess, qty, note:'', deviceName:state.deviceName, createdAt:now, updatedAt:now, voided:false, _dirty:true});
  }
  saveState();
  doSync();
}

/** บันทึกเหตุผลของแถวในหน้าคีย์ยอดรายวัน — เขียนช่อง `note` ของรายการวันนั้น
 *
 *  คืน `true` เมื่อ **ตารางต้องถูกวาดใหม่** — สร้างรายการยอด 0 ขึ้นใหม่ หรือการเลือกถูกปฏิเสธ
 *  จนต้องดีดช่องกลับ · คืน `false` เมื่อไม่มีอะไรบนตารางเปลี่ยน (ดูเหตุผลที่ตัวจับ change)
 *
 *  ⚠️ ด่านเดียวกับ saveEntryValue — ยอดส่งของมีทางเขียนทางเดียวคือหน้าใบส่งสินค้า (A2)
 *     และ `note` ของแถว shipping คือคำว่า "จากใบส่งสินค้า" ที่ระบบใช้บอกที่มาของยอด
 *     ทับแล้วคอลัมน์แหล่งที่มากับตัวกรองของหน้าแก้ไขรายการจะนับยอดนั้นเป็นยอดคีย์มือ
 *     ด่านนี้ไม่ใช่ของซ้ำกับการไม่วาดช่องเลือก — มันกันทางที่เหลือถ้ามีใครเรียกฟังก์ชันนี้จากที่อื่น */
function saveEntryNote(orderId, value, date){
  if(currentProcess === 'shipping'){
    toast('แถวส่งของแก้ที่หน้าใบส่งสินค้า — หน้านี้แสดงผลอย่างเดียว');
    return false;   // แถวส่งของไม่มีช่องเลือกอยู่แล้ว ไม่มีอะไรต้องดีดกลับ
  }
  const note = String(value==null?'':value);
  const idx = state.records.findIndex(r=>r.orderId===orderId && r.process===currentProcess && r.date===date);
  const cur = idx>-1 ? String(state.records[idx].note==null?'':state.records[idx].note) : '';
  /* ⚠️ ด่าน voided ต้องมา **ก่อน** ด่าน "ค่าไม่เปลี่ยน" ข้างล่าง
   *    ไม่งั้นการเลือกค่าที่บังเอิญตรงกับเหตุผลเดิมของแถวที่ยกเลิกไว้ จะคืนค่าเงียบสนิท
   *    ไม่มีข้อความอะไรเลย แล้วช่องเด้งกลับเป็น "— ไม่ระบุ —" เอง (เพราะแถวที่ยกเลิกไม่เข้าดัชนี)
   *    คนกดจึงไม่รู้ว่าเกิดอะไรขึ้น · เลือกค่าอื่นได้ข้อความเตือน แต่ตัวที่ตรงกับของเก่าไม่ได้
   *    = พฤติกรรมสองแบบบนการกดเดียวกัน (ผู้ตรวจ #115 รันเจอ)
   *
   *    saveEntryValue ปลุกรายการที่ยกเลิกให้เมื่อพิมพ์ยอดทับ เพราะนั่นคือการกู้คืนโดยเจตนา
   *    แต่การใส่เหตุผลไม่ใช่ — ปลุกแล้วยอดที่ถูกยกเลิกจะกลับเข้ายอดสะสมโดยคนกดไม่ได้สั่ง (B1) */
  if(idx>-1 && state.records[idx].voided){
    toast('รายการของวันนี้ถูกยกเลิกไว้ — ถ้าต้องการใช้อีกครั้ง ให้คีย์ยอดทับก่อน');
    return true;    // ต้องดีดช่องกลับ ไม่งั้นจอโชว์เหตุผลที่ไม่ได้บันทึก
  }
  /* รับเฉพาะค่าว่าง (ล้างหมายเหตุ) · ค่าที่อยู่ในรายการ · หรือค่าเดิมของแถวนั้นเอง
   * ค่าเดิมที่ไม่อยู่ในรายการเกิดได้จริงเมื่อเครื่องอื่นใช้รายการคนละชุด จึงต้องเลือกค้างไว้ได้
   * ห้ามรับค่าอื่น ไม่งั้นช่องนี้กลายเป็นทางเขียนข้อความอะไรก็ได้ลง note ซึ่งชนกับที่มาของยอด */
  if(note !== '' && note !== cur && !ENTRY_NOTES.includes(note)){
    toast('เหตุผลนี้ไม่อยู่ในรายการ');
    return true;    // เช่นเดียวกัน ต้องดีดกลับ
  }
  if(idx>-1 && cur === note) return false;
  const now = new Date().toISOString();
  if(idx>-1){
    /* ⚠️ ห้ามแตะ `deviceName` ตรงนี้ — คอลัมน์ในหน้าแก้ไขรายการชื่อ "เครื่องที่กรอก"
     *    และสิ่งที่คนไปหาคำตอบคือ **ใครคีย์ยอดจำนวนนี้** · การที่อีกคนมาเลือกเหตุผล
     *    ให้แถวนั้นแล้วชื่อเครื่องเปลี่ยนตาม = คำตอบนั้นผิดโดยไม่มีใครรู้
     *
     *    ⚠️ **สามทางที่แก้ record เขียนช่องนี้ไม่เหมือนกัน และยังไม่มีกฎกลาง**
     *      `saveEntryValue()` (คีย์ยอดบนหน้านี้) — **ทับ**
     *      ช่องแก้ยอดในหน้าแก้ไขรายการ — **ไม่ทับ**
     *      `saveEntryNote()` (ที่นี่) — **ไม่ทับ**
     *    อย่าสรุปว่ากฎคือ "ใครพิมพ์ยอดเป็นเจ้าของช่องนี้" — ไม่จริงในโค้ดวันนี้
     *    (ผู้ตรวจ #115 รันยืนยันทั้งสามทาง) · จะตั้งกฎกลางต้องแก้ทั้งสามทางพร้อมกัน
     *    ไม่ใช่แก้ทางเดียวให้ต่างจากที่เหลือ ซึ่งจะยิ่งเพิ่มความไม่ตรงกัน
     *
     *    ตอนสร้างแถวใหม่ข้างล่างยังบันทึกชื่อเครื่องตามเดิม เพราะคนนั้นสร้างแถวจริง
     *    ผลที่ยอมรับไว้: ไม่มีที่เก็บว่า "ใครเลือกเหตุผล" — จะเก็บต้องเพิ่มคอลัมน์ = แก้ contract
     *    การซิงค์ + redeploy Apps Script ซึ่งต้องถามเจ้าของก่อน (§7) */
    state.records[idx].note = note;
    state.records[idx].updatedAt = now;
    state.records[idx]._dirty = true;
    saveState();
    doSync();
    /* ⚠️ ค่าเดิมที่เป็นค่านอกรายการต้องวาดใหม่ — ตัวเลือก "(ค่าเดิม)" ถูกวาดไว้เฉพาะตอนที่
     *    มันเป็นค่าปัจจุบันของแถว · เปลี่ยนไปค่าอื่นแล้วไม่วาดใหม่ มันจะค้างอยู่ในรายการ
     *    แล้วถ้าคนเลือกย้อนกลับไปหามัน จะได้ข้อความ "เหตุผลนี้ไม่อยู่ในรายการ"
     *    ทั้งที่มันอยู่บนจอตรงหน้า = จอกับพฤติกรรมไม่ตรงกัน ซึ่งเป็นสิ่งที่การประหยัด
     *    การวาดใหม่ต้องไม่สร้างขึ้นมา (ผู้ตรวจ #115 รันเจอ) */
    /* ⚠️ **ป้ายสืบทอดขึ้นกับ "หมายเหตุของวันนี้ว่างหรือไม่" ตัวเดียว**
     *    (ดู `carried` ใน renderEntryTable) · ความว่างนั้นเปลี่ยนเมื่อไหร่ จอต้องวาดใหม่ทันที
     *    ไม่งั้นช่องจะค้างอยู่คนละสถานะกับข้อมูล — ผู้ตรวจ #117 เจอทั้งสองทิศ รอบละทิศ
     *      ว่าง → มีค่า   ช่องค้างเป็นตัวเอียงสีจางพร้อม tooltip ของวันเก่า ทั้งที่เป็นของวันนี้แล้ว
     *                     (ทางนี้คือเส้นทางที่คนใช้จริงมากที่สุด: คีย์ยอดก่อน แล้วค่อยใส่เหตุผล)
     *      มีค่า → ว่าง   ช่องค้างเป็น "— ไม่ระบุ —" ทั้งที่เรื่องของวันก่อนยังไม่ปิด
     *
     *    ⚠️ อย่าเขียนเป็นรายการกรณี แล้วไล่เติมทีละข้อ — สองรอบก่อนทำแบบนั้นแล้วตกทั้งสองรอบ
     *    เงื่อนไขคือ "ความว่างเปลี่ยน" บวกกรณีค่าเดิมนอกรายการ (ตัวเลือก "(ค่าเดิม)" ต้องหาย)
     *    ส่วนการเปลี่ยนจากคำหนึ่งไปอีกคำในรายการ ไม่มีอะไรบนตารางเปลี่ยน จึงไม่ต้องวาด
     *    (ผู้ตรวจวัดแล้ว: กดลูกศรรัว 7 ครั้ง วาดใหม่ครั้งเดียว — ครั้งที่ออกจากค่าว่าง) */
    return note === '' || cur === '' || !ENTRY_NOTES.includes(cur);
  } else {
    if(note === '') return false;   // ไม่มีรายการ และไม่ได้เลือกอะไร = ไม่ต้องสร้างแถวเปล่า
    /* ⚠️ เจ้าของเลือก 27 ต.ค. 2026 ให้เลือกเหตุผลได้แม้ยังไม่คีย์ยอด แล้ว **บันทึกยอดเป็น 0**
     *    เพราะเหตุผลมักจำเป็นตอน "วันนี้ไม่ได้ผลิต" ซึ่งคือตอนที่ยังไม่มียอด
     *    ผลที่ตามมาและยอมรับไว้: เกิดรายการยอด 0 ขึ้นจริง ซึ่งมีความหมายว่า "วันนี้ผลิต 0"
     *    ไม่ใช่ "ยังไม่ได้คีย์" · โผล่ในหน้าแก้ไขรายการ และนับเป็นการคีย์ของวันนั้น
     *    ยอดสะสมไม่ขยับเพราะบวก 0 · ล้างเหตุผลทีหลังจะเหลือรายการยอด 0 ไว้ ไม่ลบให้ (B1) */
    state.records.push({id:uid(), date, orderId, process:currentProcess, qty:0, note,
      deviceName:state.deviceName, createdAt:now, updatedAt:now, voided:false, _dirty:true});
  }
  saveState();
  doSync();
  return true;      // แถวใหม่โผล่บนตาราง ช่อง "ยอดวันนี้" เปลี่ยนจากว่างเป็น 0
}

/* ---------- Render: ยอดคงคลัง FG ---------- */

const fgUnit = () => document.getElementById('fgUnit').value;
const fgQuery = () => document.getElementById('fgSearch').value.trim().toLowerCase();

/** ช่องส่วนต่างจาก Delta — เตือนอย่างเดียว ไม่บล็อกอะไรทั้งสิ้น (เจ้าของสั่ง)
 *  ใบส่งของใช้เลขของ Delta อยู่แล้ว หน้านี้มีไว้ตอบตอน Delta ถามว่าทำไมไม่ตรง */
function fgDiffCell(g){
  if(!g.deltaHave) return '<span class="hint">ยังไม่มียอดของ Delta</span>';

  // ⚠️ เทียบได้ไม่ครบทุกใบ ห้ามขึ้นเขียวว่า "ตรงกัน" เฉย ๆ
  //    คนกวาดตาผ่านจะอ่านว่าทุกอย่างเรียบร้อย ทั้งที่ยังมีใบที่ไม่รู้ว่าตรงหรือเปล่า
  //    และคอลัมน์ซ้ายมือโชว์ยอดทั้งกลุ่มซึ่งไม่ใช่เลขที่เอามาเทียบ ยิ่งชวนเข้าใจผิด
  const partial = g.noDelta > 0;
  const cover = `เทียบได้ ${numFmt(g.deltaHave)}/${numFmt(g.orders.length)} ใบ`;
  const tip = `เทียบ ${numFmt(g.ourWipCmp)} (เฉพาะใบที่ Delta มีข้อมูล) กับ ${numFmt(g.deltaWip)} ของ Delta`;

  if(g.diff === 0){
    return partial
      ? `<span class="badge amber" title="${tip}">ตรงเท่าที่เทียบได้ · ${cover}</span>`
      : `<span class="badge green" title="${tip}">ตรงกันทุกใบ</span>`;
  }
  return `<span class="badge red" title="${tip}">${g.diff > 0 ? '+' : ''}${numFmt(g.diff)}</span>`
       + (partial ? ` <span class="hint">${cover}</span>` : '');
}

function renderFg(){
  fillSelect('fgUnit', uniqueSorted(activeOrders().map(o=>o.subName)));
  const unit = fgUnit(), q = fgQuery();
  const hideZero = document.getElementById('fgHideZero').checked;

  const all = fgRows();
  let rows = all;
  if(unit) rows = rows.filter(g=> g.unit === unit);
  if(q) rows = rows.filter(g=> g.pn.toLowerCase().includes(q));
  if(hideZero) rows = rows.filter(g=> g.fg !== 0);

  const html = rows.map(g=>{
    // ยอดติดลบเตือนได้ แต่ห้ามบล็อก — ของจริงมีคีย์ย้อนหลัง (แบบเดียวกับ Bin Card v2)
    const neg = g.fg < 0
      ? ' <span class="badge red" title="ส่งออกมากกว่าที่ผ่าน Inspection — น่าจะคีย์ย้อนหลังหรือคีย์ผิดลำดับ">⚠ ติดลบ</span>'
      : '';
    return `<tr class="fg-row" data-pn="${escapeHtml(g.pn)}" data-unit="${escapeHtml(g.unit)}" style="cursor:pointer">
      <td class="left"><b>${escapeHtml(g.pn)}</b></td>
      <td class="left">${escapeHtml(g.unit)}</td>
      <td>${numFmt(g.inQty)}</td>
      <td>${numFmt(g.outQty)}</td>
      <td><b>${numFmt(g.fg)}</b>${neg}</td>
      <td>${numFmt(g.ourWip)}</td>
      <td>${g.deltaHave ? numFmt(g.deltaWip) : '—'}</td>
      <td>${fgDiffCell(g)}</td>
    </tr>`;
  }).join('');

  document.getElementById('fgTable').innerHTML =
    `<thead><tr><th>P/N</th><th style="width:110px">Sub-Name</th>
      <th style="width:100px">รับเข้า</th><th style="width:100px">ส่งออก</th>
      <th style="width:110px">FG คงเหลือ</th>
      <th style="width:110px">ค้างส่ง (เรา)</th><th style="width:110px">ค้างส่ง (Delta)</th>
      <th style="width:150px">ต่าง</th></tr></thead>
     <tbody>${html || emptyRow(8, q ? `ไม่พบ P/N ที่ตรงกับ "${escapeHtml(q)}"` : 'ยังไม่มีข้อมูล')}</tbody>`;

  const totalFg = all.reduce((n,g)=> n + g.fg, 0);
  const mismatch = all.filter(g=> g.deltaHave && g.diff !== 0).length;
  document.getElementById('fgSummary').innerHTML =
    `${numFmt(all.length)} กลุ่ม · <b>FG รวมทั้งหมด ${numFmt(totalFg)} ชิ้น</b>` +
    (rows.length !== all.length ? ` · แสดงอยู่ ${numFmt(rows.length)} กลุ่ม` : '') +
    (mismatch ? ` · <b style="color:var(--warn)">${numFmt(mismatch)} กลุ่มยอดค้างไม่ตรงกับ Delta</b>` : '') +
    ` · กดที่แถวเพื่อดูการเคลื่อนไหว`;

  document.querySelectorAll('#fgTable .fg-row').forEach(tr=>{
    tr.addEventListener('click', ()=> renderFgCard(tr.dataset.pn, tr.dataset.unit));
  });
}

/** การ์ดรายตัว — ระดับที่ Delta ถามมาจริง เขาถามเป็นราย PO */
function renderFgCard(pn, unit){
  const g = fgRows().find(x=> x.pn === pn && x.unit === unit);
  if(!g) return;
  const moves = fgMoves(pn, unit);

  document.getElementById('fgCardTitle').textContent = `P/N ${pn} · ${unit}`;
  document.getElementById('fgCardSummary').innerHTML =
    `รับเข้าสะสม <b>${numFmt(g.inQty)}</b> · ส่งออกสะสม <b>${numFmt(g.outQty)}</b>`
    + ` · คงเหลือ <b>${numFmt(g.fg)}</b> ชิ้น · ${numFmt(g.orders.length)} ใบสั่ง`;

  document.getElementById('fgCardTable').innerHTML =
    `<thead><tr><th style="width:110px">วันที่</th><th>PO No.</th>
      <th style="width:100px">รับเข้า</th><th style="width:100px">ส่งออก</th>
      <th style="width:110px">คงเหลือ</th></tr></thead><tbody>` +
    (moves.map(m=>`<tr>
      <td>${fmtDateTH(m.date)}</td>
      <td class="left">${escapeHtml(m.po)}</td>
      <td>${m.kind==='inspection' ? numFmt(m.qty) : ''}</td>
      <td>${m.kind==='shipping' ? numFmt(m.qty) : ''}</td>
      <td><b>${numFmt(m.balance)}</b></td>
    </tr>`).join('') || emptyRow(5, 'ยังไม่มีการเคลื่อนไหว')) + '</tbody>';

  document.getElementById('fgCardCmp').innerHTML =
    `<thead><tr><th>PO No.</th><th style="width:110px">ค้างส่ง (เรา)</th>
      <th style="width:110px">ค้างส่ง (Delta)</th><th style="width:90px">งวด</th>
      <th style="width:100px">ต่าง</th></tr></thead><tbody>` +
    g.orders.map(({o, ourWip, delta, dw})=>{
      const d = delta ? delta.left : null;
      const diff = d == null ? null : ourWip - d;
      // ยอดฐานของการหักคือยอดที่แก้มือถ้ามี (deltaWipNum) — บอกให้ชัดว่าเลขนั้นมาจากไฟล์หรือจากคนแก้
      const edited = dw && deltaWipOverride(dw) != null;
      const cut = delta && delta.uncounted > 0
        ? `<div class="hint" title="ยอดสั่ง − Wip bal. = Delta นับส่งแล้ว ${numFmt(delta.counted)} · เราส่งมากกว่านั้น ${numFmt(delta.uncounted)}">`
          + `${edited ? 'แก้มือ' : 'ไฟล์'} ${numFmt(delta.raw)} − Delta ยังไม่นับ ${numFmt(delta.uncounted)}</div>` : '';
      const tools = (edited ? `<div><span class="badge amber" title="${escapeHtml(deltaOverrideTip(dw))}">แก้มือ</span></div>` : '')
        + (dw ? `<button type="button" class="btn-mini fg-dw-edit" data-dw="${escapeHtml(dw.id)}"`
          + ` title="แก้ Wip bal. ของ Delta ด้วยมือ — ต้องใส่เหตุผลและชื่อผู้แก้">✎ แก้</button>` : '');
      return `<tr>
        <td class="left">${escapeHtml(o.poNo)}</td>
        <td>${numFmt(ourWip)}</td>
        <td>${(d == null ? '<span class="hint">ไม่มี</span>' : numFmt(d) + cut) + tools}</td>
        <td>${delta && delta.week ? 'wk'+escapeHtml(delta.week) : '—'}</td>
        <td>${diff == null ? '—'
             : diff === 0 ? '<span class="badge green">ตรง</span>'
             : `<span class="badge amber">${diff>0?'+':''}${numFmt(diff)}</span>`}</td>
      </tr>`;
    }).join('') + '</tbody>';
  document.querySelectorAll('#fgCardCmp .fg-dw-edit').forEach(el=>{
    // renderAll() ไม่ได้วาดการ์ดนี้ใหม่ — แก้เสร็จต้องวาดเองให้เห็นเลขที่แก้ทันที
    el.addEventListener('click', function(){ if(editDeltaWip(this.dataset.dw)) renderFgCard(pn, unit); });
  });

  document.getElementById('fgCardPanel').style.display = '';
  document.getElementById('fgCardPanel').scrollIntoView({block:'nearest'});
}

/* ---------- Render: Dashboard tab ---------- */

/** Sub-Name ที่หน้า Dashboard กรองอยู่ · '' = ทุกหน่วย
 *
 *  ⚠️ ทั้งหน้าต้องใช้ค่าตัวเดียวกัน — การ์ด WIP · กราฟ · ตาราง (เจ้าของสั่งเมื่อ 8 ก.ย. 2026)
 *     ของเดิมกรองแค่ตาราง การ์ดกับกราฟจึงเป็นยอดรวมทุกหน่วยเงียบ ๆ
 *     คนอ่านที่เลือกหน่วยไว้แล้วเอาการ์ดไปเทียบกับตาราง จะสรุปว่ายอดไม่ตรงทั้งที่ทั้งคู่ถูก */
function dashSubName(){
  const el = document.getElementById('dashSubFilter');
  return el ? el.value : '';
}

/** ชุดใบสั่งที่หน้า Dashboard กำลังพูดถึง (กรองหน่วยแล้ว) */
function dashScopedOrders(){
  const subF = dashSubName();
  return subF ? activeOrders().filter(o=>o.subName === subF) : activeOrders();
}

function renderWipCards(){
  const allCum = buildCumMap(state.records);
  const subF = dashSubName();
  const note = document.getElementById('wipScopeNote');
  if(note) note.textContent = subF ? 'นับเฉพาะ Sub-Name: ' + subF : 'นับรวมทุก Sub-Name';
  let totalQty=0, anomalyCount=0;
  const sum = emptyCum();
  dashScopedOrders().forEach(o=>{
    totalQty += o.orderQty;
    const c = allCum[o.id] || emptyCum();
    if(hasOrderAnomaly(c)) anomalyCount++;
    PROCESSES.forEach(p=>{ sum[p] += Math.min(c[p]||0, o.orderQty); });
  });
  const shipped = sum.shipping;

  // การ์ดค้างหน้าขั้น = ยอดขั้นก่อนหน้า − ยอดขั้นนั้น · ขั้นแรกไม่มีการ์ดค้างหน้า (อยู่ในยังไม่เริ่มผลิต)
  const cards = [
    {label:'ยอดแผนรวม (Order Qty)', value:numFmt(totalQty), unit:'pcs', accent:'blue'},
    {label:'ยังไม่เริ่มผลิต', value:numFmt(Math.max(0, totalQty - sum[MAIN_PROCESSES[0]])), unit:'pcs', accent:'blue'},
    ...MAIN_PROCESSES.slice(1).map((p, i)=>({label:ptext(p, 'waitCard'),
      value:numFmt(Math.max(0, sum[MAIN_PROCESSES[i]] - sum[p])), unit:'pcs', accent:'amber'})),
    {label:'ส่งของแล้ว (Shipped)', value:numFmt(shipped), unit:`pcs (${totalQty? Math.round(shipped/totalQty*100):0}%)`, accent:'green'}
  ];
  let html = cards.map(c=>`<div class="card accent-${c.accent}"><div class="label">${escapeHtml(c.label)}</div><div class="value">${c.value}<span class="unit">${c.unit}</span></div></div>`).join('');
  if(anomalyCount>0){
    html += `<div class="card accent-red"><div class="label">ข้อมูลย้อนแย้ง</div><div class="value" style="color:var(--red)">${anomalyCount}<span class="unit">รายการ (สะสมขั้นถัดไป &gt; ขั้นก่อนหน้า)</span></div></div>`;
  }
  document.getElementById('wipCards').innerHTML = html;
}

/** ยอดที่ค้างอยู่หน้าขั้น stage ของใบสั่งซื้อใบเดียว — ใช้สูตรเดียวกับการ์ด WIP ด้านบน
 *  (renderWipCards) แต่คิดทีละใบ เพื่อให้ตัวเลขบนการ์ดกับรายการที่กรองออกมาตรงกันเสมอ
 *  ต้องครอบ Math.min(สะสม, orderQty) เหมือนการ์ด ไม่งั้นใบที่คีย์เกิน Order Qty จะเพี้ยน
 *  stage 'notStarted' = ยังไม่เข้าขั้นแรก */
function wipQtyAtStage(order, cum, stage){
  const capped = p => Math.min(cum[p]||0, order.orderQty);
  if(stage === 'notStarted') return Math.max(0, order.orderQty - capped(MAIN_PROCESSES[0]));
  const prev = PREV_PROCESS[stage];
  if(!prev) return 0;
  return Math.max(0, capped(prev) - capped(stage));
}

const MAX_CHART_DAYS = 366;

/** อ่านช่วงวันที่ที่กราฟจะแสดง จาก dropdown/ช่องวันที่กำหนดเอง
 *  คืน {startISO, endISO} เมื่อใช้ได้, {error} เมื่อผิดเงื่อนไข, null เมื่อยังกรอกไม่ครบ (โหมด custom) */
function getChartRange(){
  const mode = document.getElementById('chartRange').value;
  if(mode !== 'custom'){
    const days = parseInt(mode,10) || 14;
    const endISO = todayISO();
    return {startISO: addDaysISO(endISO, -(days-1)), endISO};
  }
  const startISO = document.getElementById('chartFrom').value;
  const endISO = document.getElementById('chartTo').value;
  if(!startISO || !endISO) return null;
  if(startISO > endISO) return {error:'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด'};
  if(daysBetween(startISO, endISO)+1 > MAX_CHART_DAYS) return {error:`ช่วงเวลายาวเกินไป (สูงสุด ${MAX_CHART_DAYS} วัน)`};
  return {startISO, endISO};
}

/** สร้าง label รายวัน + ยอดรวมต่อ process ต่อวัน ระหว่าง startISO–endISO (รวมทั้งสองปลาย)
 *  ไล่ด้วย addDaysISO/daysBetween (คำนวณบนสตริงล้วน) แทน new Date()+setDate() แบบเดิม
 *  เพื่อเลี่ยงปัญหา timezone drift เดียวกับที่แก้ไปแล้วตอน parse วันที่จากไฟล์ Excel */
function buildDailyTotals(startISO, endISO, subName){
  /* กรองตาม Sub-Name ผ่าน "ใบสั่งของเรคคอร์ดนั้น" เพราะเรคคอร์ดไม่ได้เก็บหน่วยไว้เอง
   * ⚠️ ดูจาก state.orders ทั้งหมด ไม่ใช่ activeOrders() — ตรงนี้ต้องเป็นการกรองหน่วยล้วน ๆ
   *    ถ้าเผลอกรองใบที่ยกเลิกออกไปด้วย กราฟตอนเลือก "ทุกหน่วย" จะไม่เท่ากับตอนไม่กรอง
   *    ซึ่งเป็นการเปลี่ยนความหมายของกราฟไปโดยไม่มีใครสั่ง */
  let subOf = null;
  if(subName){
    subOf = {};
    state.orders.forEach(o=>{ subOf[o.id] = o.subName; });
  }
  const dayCount = daysBetween(startISO, endISO)+1;
  const labels = []; const data = Object.fromEntries(PROCESSES.map(p=>[p, []]));
  for(let i=0;i<dayCount;i++){
    labels.push(addDaysISO(startISO, i));
    PROCESSES.forEach(p=>data[p].push(0));
  }
  const idxByDate = {}; labels.forEach((l,i)=>idxByDate[l]=i);
  state.records.forEach(r=>{
    if(r.voided) return;
    if(subOf && subOf[r.orderId] !== subName) return;
    if(idxByDate[r.date]!=null && data[r.process]) data[r.process][idxByDate[r.date]] += Number(r.qty)||0;
  });
  return {labels, data};
}

/** ขั้นที่ถูกกดซ่อนไว้ในกราฟ · เก็บรวมกับช่วงเวลาใน chartPref (เครื่องนี้เท่านั้น)
 *  กรองชื่อที่ไม่รู้จักทิ้ง เพราะค่านี้อาจมาจากไฟล์ที่นำเข้าหรือรุ่นเก่าที่ชื่อขั้นไม่ตรงกัน */
function chartHiddenProcs(){
  const raw = state.chartPref && state.chartPref.hidden;
  const list = Array.isArray(raw) ? raw : [];
  return new Set(list.filter(x=>PROCESSES.indexOf(x) >= 0));
}

/** ขั้นที่กราฟกำลังวาดจริง
 *  ⚠️ ซ่อนครบทุกขั้นแล้วถือว่าไม่ซ่อนอะไรเลย — กราฟเปล่าที่ไม่มีอะไรอธิบายว่าทำไมถึงเปล่า
 *     จะถูกอ่านว่า "ช่วงนี้ไม่มียอดเลย" ซึ่งไม่จริง ปุ่มกันไว้ชั้นหนึ่งแล้ว นี่คือด่านที่สอง */
function chartProcesses(){
  const hidden = chartHiddenProcs();
  const vis = PROCESSES.filter(x=>!hidden.has(x));
  return vis.length ? vis : PROCESSES.slice();
}

/** คำอธิบายสีเหนือกราฟ — กดเพื่อซ่อน/แสดงทีละขั้น */
function renderChartLegend(){
  const hidden = chartHiddenProcs();
  document.getElementById('chartLegend').innerHTML = PROCESSES.map(x=>{
    const off = hidden.has(x);
    return `<button type="button" class="legend-item${off?' off':''}" data-proc="${x}"`
         + ` aria-pressed="${off?'false':'true'}" title="${off?'กดเพื่อแสดงขั้นนี้':'กดเพื่อซ่อนขั้นนี้'}">`
         + `<i style="background:${PROCESS_COLORS[x]}"></i>${escapeHtml(PROCESS_LABELS[x])}</button>`;
  }).join('');
}

/* เกินกี่วันจึงเลิกวาดรายวัน แล้วรวมเป็นรายสัปดาห์ — 21 วันคือช่วงยาวที่สุดที่แท่งยังหนาพออ่าน */
const CHART_DAILY_MAX = 21;
/* หลักไมล์สำหรับหาว่าวันไหนอยู่สัปดาห์เดียวกัน — 1970-01-05 เป็นวันจันทร์ */
const MONDAY_ANCHOR = '1970-01-05';

/** รวมยอดรายวันเป็นรายสัปดาห์ (จันทร์–อาทิตย์)
 *
 *  ⚠️ ต้องยึดวันจันทร์จริง ไม่ใช่นับทีละเจ็ดวันจากวันแรกของช่วงที่เลือก
 *     ไม่งั้นเลือกช่วงต่างกันสองครั้ง แท่งตำแหน่งเดียวกันจะกินคนละชุดวัน เอามาเทียบกันไม่ได้
 *     ผลที่ตามมาคือหัวกับท้ายอาจเป็นสัปดาห์ไม่เต็ม — spans จึงเก็บช่วงวันจริงไว้ให้ tooltip บอก
 *
 *  ⚠️ หาวันในสัปดาห์ด้วย daysBetween บนสตริงล้วน ไม่ใช่ new Date().getDay()
 *     ด้วยเหตุผลเดียวกับที่ buildDailyTotals เลี่ยงไว้ — timezone drift */
function bucketWeekly(labels, data){
  const out = {labels:[], data:{}, spans:[]};
  PROCESSES.forEach(x=>out.data[x]=[]);
  let idx = -1, prevKey = null;
  labels.forEach((iso,i)=>{
    const dow = ((daysBetween(MONDAY_ANCHOR, iso) % 7) + 7) % 7;
    const monday = addDaysISO(iso, -dow);
    if(monday !== prevKey){
      prevKey = monday; idx++;
      out.labels.push(monday);
      out.spans.push({from: iso, to: iso});
      PROCESSES.forEach(x=>out.data[x].push(0));
    }
    out.spans[idx].to = iso;
    PROCESSES.forEach(x=>{ out.data[x][idx] += data[x][i]; });
  });
  return out;
}

function renderChart(){
  renderChartLegend();
  const range = getChartRange();
  const caption = document.getElementById('chartRangeCaption');
  if(!range){
    document.getElementById('chartWrap').innerHTML = `<div class="empty-hint">เลือกทั้ง "จากวันที่" และ "ถึงวันที่" เพื่อแสดงกราฟ</div>`;
    caption.textContent = '';
    return;
  }
  if(range.error){
    document.getElementById('chartWrap').innerHTML = `<div class="empty-hint">${escapeHtml(range.error)}</div>`;
    caption.textContent = '';
    return;
  }
  const {startISO, endISO} = range;
  const subF = dashSubName();
  const daily = buildDailyTotals(startISO, endISO, subF);
  /* ช่วงยาววาดรายวันแล้วอ่านไม่ออก — 90 วันคือ 450 แท่ง แท่งละ 2px
     รวมเป็นรายสัปดาห์แทน เหลือ 13 กลุ่ม เต็มจอพอดีโดยไม่ต้องเลื่อน
     และตรงกับที่ทั้งระบบคิดเป็น WK อยู่แล้ว */
  const bucketed = daily.labels.length > CHART_DAILY_MAX;
  const bucket = bucketed ? bucketWeekly(daily.labels, daily.data) : null;
  const labels = bucketed ? bucket.labels : daily.labels;
  const data = bucketed ? bucket.data : daily.data;
  const spans = bucketed ? bucket.spans : null;
  caption.textContent = `แสดง ${fmtDateTH(startISO)} – ${fmtDateTH(endISO)} (${daily.labels.length} วัน)`
    + (bucketed ? ' · รวมรายสัปดาห์ จ–อา' : '')
    + (subF ? ` · ${subF}` : '');

  /* ความกว้างของกราฟ = ความกว้างของกล่องที่มันอยู่ ไม่ใช่เลขตายตัว (เจ้าของสั่งเมื่อ 8 ก.ย. 2026)
   *
   * ⚠️ ของเดิมคิดจากจำนวนวัน × พิกเซลต่อวัน แล้วตรึงขั้นต่ำ 600px
   *    ช่วงสั้น (7 หรือ 14 วัน) จึงได้กราฟกว้าง 600px ค้างอยู่กลางจอกว้าง ๆ เสมอ
   *
   *    ตอนนี้ยึดความกว้างจริงของกล่องเป็นหลัก แล้วค่อยขยายเกินกล่องเมื่อช่องแคบเกินอ่าน
   *    (ต่ำกว่า minPerSlot) — กรณีนั้น .chart-wrap เลื่อนดูได้เหมือนเดิม */
  const minPerSlot = bucketed ? 46 : 14;
  const wrapEl = document.getElementById('chartWrap');
  const avail = Math.max(320, Math.floor(wrapEl.clientWidth) || 0);
  const w = Math.max(avail, labels.length*minPerSlot);
  const h = 220, padL=44, padB=28, padT=10;
  const procs = chartProcesses();
  /* ⚠️ สเกลต้องคิดจากขั้นที่แสดงอยู่เท่านั้น ไม่งั้นปิดขั้นที่ยอดสูงสุดทิ้งแล้ว
     แท่งที่เหลือยังเตี้ยติดพื้นเหมือนเดิม ทั้งที่จุดประสงค์ของการปิดคือขอดูให้ชัดขึ้น */
  const maxVal = Math.max(1, ...procs.map(x=>Math.max(...data[x])));
  const plotH = h-padT-padB;
  const groupW = (w-padL)/labels.length;
  /* กลุ่มกินแค่ 75% ของช่องแต่ละวัน ที่เหลือเป็นช่องว่างให้ตาแยกวันออกจากกัน
   * ⚠️ ของเดิมกลุ่มกิน 93% เหลือช่องว่างระหว่างวันแค่ 6.7% แท่งทั้งแถบจึงอ่านเป็นพืดเดียว
   *    สูตรนี้คิดกลับจากความกว้างที่กลุ่มควรกิน จึงชดเชยให้เองเมื่อขั้นถูกซ่อนไปบางขั้น */
  const GROUP_FILL = 0.75;
  const barW = Math.max(2, Math.min(28, GROUP_FILL*groupW/(1.15*procs.length - 0.15)));
  const gap = Math.max(0.5, barW*0.15);

  /* แถบพื้นหลังสลับช่องเว้นช่อง — ตัวช่วยที่สองในการแยกกลุ่ม สำคัญตอนแท่งเตี้ยจนแทบไม่มีอะไรให้เกาะ */
  let bands='';
  labels.forEach((lab,i)=>{
    if(i % 2 === 0) return;
    bands += `<rect x="${(padL+i*groupW).toFixed(1)}" y="${padT}" width="${groupW.toFixed(1)}" height="${plotH}" fill="#f1f5f9"/>`;
  });

  let grid='';
  for(let g=0; g<=4; g++){
    const val = Math.round(maxVal*g/4);
    const y = padT+plotH-(val/maxVal)*plotH;
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="#e2e6ed" stroke-width="1"/><text x="${padL-6}" y="${(y+3).toFixed(1)}" font-size="10" text-anchor="end" fill="#6b7280">${val}</text>`;
  }
  let bars='';
  // ตำแหน่งซ้าย-ขวาของแต่ละขั้นในกลุ่ม คิดจากจำนวนขั้นที่แสดงอยู่ กลุ่มจึงอยู่กลางช่องเสมอ
  const series = procs.map((key,i)=>[key, PROCESS_COLORS[key], i - (procs.length-1)/2]);
  // ป้ายกำกับแกน X ถี่เกินไปจะทับกันเมื่อช่วงยาว — เว้นระยะให้เหลือไม่เกิน ~18 ป้าย
  const labelStep = Math.max(1, Math.ceil(labels.length/18));
  labels.forEach((lab,i)=>{
    const gx = padL + i*groupW + groupW/2;
    // แท่งรายสัปดาห์ต้องบอกช่วงวันจริงของมัน เพราะหัวกับท้ายอาจเป็นสัปดาห์ไม่เต็ม
    const when = spans ? `${fmtDateTH(spans[i].from)}–${fmtDateTH(spans[i].to)}` : lab;
    series.forEach(([key,color,offsetIdx])=>{
      const val = data[key][i];
      const barH = (val/maxVal)*plotH;
      const x = gx + offsetIdx*(barW+gap) - barW/2;
      const y = padT+plotH-barH;
      bars += `<rect data-proc="${key}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="1.5"><title>${when} ${escapeHtml(PROCESS_LABELS[key])}: ${numFmt(val)}</title></rect>`;
    });
    if(i % labelStep === 0){
      bars += `<text x="${gx.toFixed(1)}" y="${h-8}" font-size="10" text-anchor="middle" fill="#6b7280">${lab.slice(5)}</text>`;
    }
  });
  document.getElementById('chartWrap').innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bands}${grid}${bars}</svg>`;
}

function renderDashFilterOptions(){
  fillSelect('dashWeekFilter', uniqueSorted(activeOrders().map(o=>o.week)));
  fillSelect('entryWeekFilter', uniqueSorted(activeOrders().map(o=>o.week)));
  // รายชื่อมาจากข้อมูลจริง ไม่ fix ไว้ — โรงงานเพิ่มหน่วยใหม่แล้วต้องโผล่เอง
  // เหมือนที่หน้า Dashboard กับหน้ายอดคงคลัง FG ทำอยู่
  fillSelect('entrySubFilter', uniqueSorted(activeOrders().map(o=>o.subName)));
  fillSelect('dashSubFilter', uniqueSorted(activeOrders().map(o=>o.subName)));
}

/** แถบ progress 2 ส่วน: ฟ้า = ยอดที่บันทึกทันหรือก่อนวัน deadline ของขั้นนั้น, เหลือง = บันทึกหลังเลย
 *  deadline ไปแล้ว — เขียวทั้งแถบสงวนไว้เฉพาะกรณีเสร็จครบ "และ" ไม่มีส่วนที่ช้าเลยเท่านั้น (เสร็จครบ
 *  แบบมีส่วนช้าปนอยู่ ยังคงแสดงฟ้า+เหลืองตามจริง ไม่ใช่เขียว) ยอดแยกทัน/เกินโชว์เป็นตัวหนังสือในเซลล์
 *  เลย ไม่ต้องรอ hover เพราะผู้ใช้อยากเห็นตัวเลขทันทีตอนกวาดตาดูตาราง */
function progressCell(cum, split, qty){
  split = split || {onTime:0, late:0};
  const done = qty>0 && cum>=qty && split.late===0;
  const onTimePct = qty>0 ? Math.min(100, split.onTime/qty*100) : 0;
  const latePct = qty>0 ? Math.min(100-onTimePct, split.late/qty*100) : 0;
  const splitNote = split.late>0
    ? `<div class="split-note"><span class="on">ทัน ${numFmt(split.onTime)}</span> · <span class="late">เกิน ${numFmt(split.late)}</span></div>`
    : '';
  return `<div class="small">${numFmt(cum)}/${numFmt(qty)}</div>
    <div class="progress ${done?'done':''}" title="ทันกำหนด ${numFmt(split.onTime)} · เกินกำหนด ${numFmt(split.late)}">
      <div class="seg-on" style="width:${onTimePct}%"></div><div class="seg-late" style="width:${latePct}%"></div>
    </div>${splitNote}`;
}

/* ช่อง Aging — ระบายสีให้กวาดตาเจอใบที่ค้างนานได้ทันที (issue #41)
 * เกณฑ์อ่านจาก deadlineOffsets.shipping เสมอ ห้าม hardcode (A4) และถ้ายังไม่กำหนด (null)
 * ห้ามเดาเป็น 0 → แสดงเป็นตัวเลขเปล่า ส่วน "เหลือ 3 วัน = ใกล้ครบกำหนด" ใช้เกณฑ์เดียวกับ
 * computeStatus เพื่อไม่ให้สีของสองคอลัมน์ขัดกันเอง */
function agingCell(aging, statusCode){
  if(aging==null) return '—';
  const txt = numFmt(aging);
  const off = state.deadlineOffsets.shipping;
  if(statusCode==='done') return `<span class="badge green">${txt}</span>`;
  if(off==null) return txt;
  if(aging > off) return `<span class="badge red">${txt}</span>`;
  if(off - aging <= 3) return `<span class="badge amber">${txt}</span>`;
  return `<span class="badge green">${txt}</span>`;
}

function renderDashTable(){
  const allCum = buildCumMap(state.records);
  const orderById = {}; state.orders.forEach(o=>orderById[o.id]=o);
  const splitMap = buildCumSplitMap(state.records, orderById);
  const ref = todayISO();
  const weekF = document.getElementById('dashWeekFilter').value;
  const subF = document.getElementById('dashSubFilter').value;
  const statusF = document.getElementById('dashStatusFilter').value;
  const wipF = document.getElementById('dashWipFilter').value;
  const search = document.getElementById('dashSearch').value.trim().toLowerCase();
  const hideDone = document.getElementById('dashHideDone').checked;

  let rows = activeOrders().map(o=>{
    const c = allCum[o.id] || emptyCum();
    const dl = computeDeadlines(o);
    const st = computeStatus(o, c, dl, ref);
    const split = splitMap[o.id] || {};
    return {o,c,dl,st,split};
  });
  if(weekF) rows = rows.filter(x=>x.o.week===weekF);
  if(subF) rows = rows.filter(x=>x.o.subName===subF);
  if(search) rows = rows.filter(x=>String(x.o.poNo).toLowerCase().includes(search) || String(x.o.pn).toLowerCase().includes(search));
  if(statusF) rows = rows.filter(x=>x.st.code===statusF);
  if(wipF) rows = rows.filter(x=>wipQtyAtStage(x.o, x.c, wipF) > 0);
  // ซ่อนงานที่ส่งครบแล้ว — แต่ต้องยอมให้คนที่ "เลือกดูเฉพาะเสร็จแล้ว" เห็นของที่ตัวเองขอดู
  // ไม่งั้นเลือกสถานะเสร็จแล้วจะได้ตารางว่าง โดยไม่มีอะไรบอกว่าเพราะติ๊กอีกช่องค้างไว้
  if(hideDone && statusF !== 'done') rows = rows.filter(x=>x.st.code !== 'done');
  rows.sort((a,b)=> (a.o.week||'').localeCompare(b.o.week) || (a.o.orderDate||'').localeCompare(b.o.orderDate));

  /* ⚠️ Item No. คือ "ลำดับของแถวที่เห็นอยู่ตอนนี้" ไม่ใช่เลขประจำใบสั่ง
   *
   *    มีไว้ให้ชี้กันรู้เรื่องตอนคุยหรือตอนถือกระดาษที่พิมพ์ออกมา ("ดูแถวที่ 12")
   *    จึงต้องนับหลังกรองและเรียงแล้ว = นับตามที่ตาเห็น ไม่ใช่ตามลำดับในข้อมูล
   *
   *    เปลี่ยนตัวกรองเมื่อไหร่เลขก็เปลี่ยน ซึ่งถูกต้องตามความหมายนี้
   *    และหัวกระดาษตอนพิมพ์บอกอยู่แล้วว่ากรองอะไรไว้ คนที่ถือกระดาษคนละใบจึงรู้ตัว
   *
   *    ⚠️ ห้ามเอาไปใช้เป็นกุญแจอ้างอิงใบสั่ง — กุญแจจริงคือ PO|P/N (ดู INVARIANTS)
   *       และเลข No. ในไฟล์แผนของลูกค้าก็ไม่ใช่ตัวนี้ (ของเขาเริ่มนับใหม่ทุกสัปดาห์
   *       และมีเลขซ้ำกับช่องว่างปนอยู่) โปรแกรมไม่ได้เก็บเลขนั้นไว้ */
  const bodyHtml = rows.map(({o,c,st,split}, idx)=>{
    const anomaly = hasOrderAnomaly(c);
    // อายุงาน = จำนวนวันนับจากวันสั่งถึงวันนี้ นิยามเดียวกับคอลัมน์ Aging ในใบส่งสินค้า FM-ST-07
    // ใช้ ref ตัวเดียวกับที่ computeStatus ใช้ตัดสินล่าช้า ตัวเลขบนจอจึงมาจากวันเดียวกันเสมอ
    const aging = daysBetween(o.orderDate, ref);
    return `<tr>
      <td class="hint">${idx + 1}</td>
      <td class="left">${escapeHtml(o.week)}</td>
      <td class="left" data-po="${escapeHtml(o.poNo)}">${escapeHtml(o.poNo)}</td>
      <td class="left">${escapeHtml(o.pn)}</td>
      <td class="left">${escapeHtml(o.subName)}</td>
      <td>${numFmt(o.orderQty)}</td>
      <td>${fmtDateTH(o.orderDate)}</td>
      <td data-aging>${agingCell(aging, st.code)}</td>
      ${PROCESSES.map(p=>`<td>${progressCell(c[p]||0, split[p], o.orderQty)}</td>`).join('')}
      <td><span class="badge ${st.color}">${escapeHtml(st.label)}</span>${anomaly?' <span class="badge red" title="ยอดสะสมย้อนแย้งกัน">⚠ ผิดลำดับ</span>':''}</td>
    </tr>`;
  }).join('');

  document.getElementById('dashTable').innerHTML = `<thead><tr>
      <th style="width:52px" title="ลำดับของแถวที่เห็นอยู่ตอนนี้ ไว้ชี้กันตอนคุยหรือตอนดูกระดาษที่พิมพ์ออกมา — เปลี่ยนตัวกรองแล้วเลขเปลี่ยนตาม">Item No.</th>
      <th>สัปดาห์</th><th>PO No.</th><th>P/N</th><th>Sub-Name</th><th>Order Qty</th><th>Order Date</th><th>Aging<br>(วัน)</th>
      ${PROCESSES.map(p=>`<th>${processHeadHtml(p)}</th>`).join('')}<th>สถานะ</th>
    </tr></thead><tbody>${bodyHtml || emptyRow(9 + PROCESSES.length)}</tbody>`;
}

/* ---------- Render: Data tab ---------- */
function loadSettingsIntoForm(){
  document.getElementById('deviceName').value = state.deviceName || '';
  fillOffsetInputs();
  document.getElementById('chartRange').value = state.chartPref.mode || '14';
  document.getElementById('chartFrom').value = state.chartPref.from || '';
  document.getElementById('chartTo').value = state.chartPref.to || '';
  toggleChartCustomFields();
}
function toggleChartCustomFields(){
  const isCustom = document.getElementById('chartRange').value === 'custom';
  document.querySelectorAll('.chart-custom-field').forEach(el=>{ el.style.display = isCustom ? '' : 'none'; });
}
function saveChartPref(){
  state.chartPref = {
    mode: document.getElementById('chartRange').value,
    from: document.getElementById('chartFrom').value,
    to: document.getElementById('chartTo').value,
    // ⚠️ ต้องพกขั้นที่ซ่อนไว้มาด้วย ไม่งั้นแค่เปลี่ยนช่วงเวลา ขั้นที่ปิดไว้ก็เด้งกลับมาทั้งห้า
    hidden: Array.from(chartHiddenProcs())
  };
  saveState();
}

/* ---------- Merge logic ---------- */
function computeMergePlan(incoming){
  const plan = {newOrders:[], updOrders:[], newRecords:[], conflictRecords:[], skipRecords:0};
  // ไฟล์ที่ export มาจากเครื่องที่ยังมีวันที่เพี้ยน (ก่อนแก้บั๊กนี้) ต้องซ่อมก่อนนำมาเทียบ
  // ไม่งั้นการจับคู่ record ด้วย key ที่มี date จะไม่ตรงและได้รายการซ้ำ
  (incoming.orders||[]).forEach(o=>normalizeRowDates(o, ORDER_DATE_FIELDS));
  (incoming.records||[]).forEach(r=>normalizeRowDates(r, RECORD_DATE_FIELDS));
  const orderMap = {}; state.orders.forEach(o=>orderMap[o.id]=o);
  (incoming.orders||[]).forEach(io=>{
    const existing = orderMap[io.id];
    if(!existing) plan.newOrders.push(io);
    else if(new Date(io.updatedAt||0) > new Date(existing.updatedAt||0)) plan.updOrders.push(io);
  });
  const recKey = r=>r.orderId+'|'+r.process+'|'+r.date;
  const localRecMap = {}; state.records.forEach(r=>localRecMap[recKey(r)] = r);
  (incoming.records||[]).forEach(ir=>{
    const k = recKey(ir);
    const local = localRecMap[k];
    if(!local){ plan.newRecords.push(ir); }
    else if(Number(local.qty)===Number(ir.qty)){ plan.skipRecords++; }
    else {
      const irNewer = new Date(ir.updatedAt||0) > new Date(local.updatedAt||0);
      plan.conflictRecords.push({local, incoming:ir, winner: irNewer? 'incoming':'local'});
    }
  });
  return plan;
}
function showMergeModal(plan){
  let html = `<p>รายการแผนงาน: ใหม่ <b>${plan.newOrders.length}</b> รายการ, จะอัปเดต <b>${plan.updOrders.length}</b> รายการ</p>
    <p>บันทึกยอดรายวัน: ใหม่ <b>${plan.newRecords.length}</b> รายการ, ซ้ำเหมือนเดิม <b>${plan.skipRecords}</b> รายการ${plan.conflictRecords.length? `, <span style="color:var(--red)">ขัดแย้งกัน ${plan.conflictRecords.length} รายการ (ใช้ค่าล่าสุดตามเวลาบันทึก)</span>`:''}</p>`;
  if(plan.conflictRecords.length){
    html += `<div class="small muted">ตัวอย่างรายการขัดแย้ง:<br>` +
      plan.conflictRecords.slice(0,6).map(c=>{
        const winVal = c.winner==='incoming'? c.incoming.qty : c.local.qty;
        return `${escapeHtml(c.local.orderId)} (${escapeHtml(c.local.process)}, ${c.local.date}): ${c.local.qty} vs ${c.incoming.qty} → ใช้ ${winVal}`;
      }).join('<br>') + `</div>`;
  }
  if(!plan.newOrders.length && !plan.updOrders.length && !plan.newRecords.length && !plan.conflictRecords.length){
    html += `<p class="muted">ไม่มีข้อมูลใหม่ที่จะรวม — ข้อมูลทั้งสองเครื่องเหมือนกันแล้ว</p>`;
  }
  document.getElementById('mergeSummary').innerHTML = html;
  document.getElementById('mergeModal').classList.add('show');
}
function applyMerge(plan){
  // ติด _dirty:true ให้ทุกรายการที่รวมเข้ามาจากไฟล์ — เผื่อเครื่องนี้ต่อ Google Sheets อยู่ด้วย
  // จะได้ส่งขึ้นเซิร์ฟเวอร์ต่อในซิงค์รอบถัดไป (ไม่ใช่แค่รวมในเครื่องนี้เฉย ๆ)
  const orderMap = {}; state.orders.forEach((o,i)=>orderMap[o.id]=i);
  plan.newOrders.forEach(io=>state.orders.push(Object.assign({}, io, {_dirty:true})));
  plan.updOrders.forEach(io=>{ const i=orderMap[io.id]; if(i!=null) state.orders[i]=Object.assign({}, io, {_dirty:true}); });
  plan.newRecords.forEach(ir=>state.records.push(Object.assign({}, ir, {_dirty:true})));
  plan.conflictRecords.forEach(c=>{
    const idx = state.records.findIndex(r=>r.orderId===c.local.orderId && r.process===c.local.process && r.date===c.local.date);
    if(idx>-1) state.records[idx] = Object.assign({}, c.winner==='incoming' ? c.incoming : c.local, {_dirty:true});
  });
  saveState();
  doSync();
}

/* ---------- Excel report export ---------- */
async function exportExcelReport(){
  const allCum = buildCumMap(state.records);
  const summaryRows = activeOrders().map(o=>{
    const c = allCum[o.id] || emptyCum();
    const dl = computeDeadlines(o);
    return {
      'สัปดาห์': o.week, 'PO No.': o.poNo, 'P/N': o.pn, 'Sub-Name': o.subName,
      'Order Qty': o.orderQty, 'Order Date': o.orderDate,
      // ⚠️ ลำดับคอลัมน์ต้องคงที่ — สะสมครบทุกขั้น แล้ว WIP แล้ว Deadline (ไฟล์ถูกส่งต่อไปใช้ข้างนอก)
      ...Object.fromEntries(PROCESSES.map(p=>[ptext(p, 'cumExport'), c[p]||0])),
      ...Object.fromEntries(MAIN_PROCESSES.slice(1).map((p, i)=>[ptext(p, 'waitExport'), Math.max(0, (c[MAIN_PROCESSES[i]]||0) - (c[p]||0))])),
      ...Object.fromEntries(PROCESSES.map(p=>[ptext(p, 'deadlineExport'), dl[p]]))
    };
  });
  const recordRows = state.records.filter(r=>!r.voided).sort((a,b)=>(a.date||'').localeCompare(b.date)).map(r=>{
    const o = state.orders.find(x=>x.id===r.orderId);
    return {
      'วันที่': r.date,
      'PO No.': o? o.poNo : (r.orderId||'').split('|')[0],
      'P/N': o? o.pn : (r.orderId||'').split('|')[1],
      'Process': r.process, 'จำนวน': r.qty, 'เครื่อง': r.deviceName||''
    };
  });
  const wb = new ExcelJS.Workbook();
  addSheetFromObjects(wb, 'สรุป WIP', summaryRows);
  addSheetFromObjects(wb, 'บันทึกรายวัน', recordRows);
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf, `รายงาน_production_${todayISO()}.xlsx`,
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/** เขียนอาร์เรย์ของ object ลงชีตใหม่ โดยใช้ key ของตัวแรกเป็นหัวคอลัมน์
 *  แทนที่ json_to_sheet ของไลบรารีเดิม — ลำดับคอลัมน์ต้องคงที่ ไม่งั้นไฟล์ที่ส่งต่อไปข้างนอกเปลี่ยนรูปทุกครั้ง */
function addSheetFromObjects(wb, name, rows){
  const ws = wb.addWorksheet(name);
  if(!rows.length) return ws;
  const cols = Object.keys(rows[0]);
  ws.addRow(cols);
  rows.forEach(r => ws.addRow(cols.map(c => r[c] === undefined ? null : r[c])));
  return ws;
}

/* ---------- กรอกฟอร์มใบส่งสินค้า FM-ST-07 ---------- */
/*
 * ใช้วิธีเดียวกับ Call In คือเปิดไฟล์เป็นซิปแล้วแก้เฉพาะช่องที่ต้องแก้
 * ❗ ห้ามเปลี่ยนไปใช้ ExcelJS เขียนไฟล์นี้ — ทดสอบกับฟอร์มจริงแล้ว xl/drawings/ ถูกตัดทิ้งทั้งหมด
 *    ไฟล์โลโก้ยังอยู่ในซิปแต่ไม่มีอะไรบอกว่าให้วางตรงไหน โลโก้บริษัทจึงไม่ขึ้นบนกระดาษ
 *
 * ผังของฟอร์ม — อ่านจากข้อความหัวตารางทุกครั้ง ไม่ fix ตัวอักษรคอลัมน์หรือเลขแถว (ดู dnLayout)
 *   หัวใบ: ช่อง "Date___D/M/YY__(WK nn)" · หน่วยอยู่คอลัมน์ B แถวเดียวกัน
 *   แถวหัวตาราง = แถวที่มีช่อง P/N · ข้อมูลเริ่มแถวถัดไป · จบก่อนแถวแรกที่มีสูตร SUM (แถวรวม)
 *
 * ⚠️ แต่ละชีตยาวไม่เท่ากัน — TUE-U/TUE-T แถวรวมอยู่ที่ 96 แต่ TUE-H อยู่ที่ 78 (ตรวจไฟล์จริง 11 ก.ย. 2026)
 *    ของเดิม fix แถว 10-95 ทุกชีต จึงล้างยอดรวมกับช่องลงชื่อของ TUE-H ทิ้งมาตั้งแต่ 30 ส.ค. 2026
 * ⚠️ เจ้าของแทรกคอลัมน์ "ยอดส่งงาน" เมื่อ 11 ก.ย. 2026 คอลัมน์ตั้งแต่ M จึงเลื่อนไปหนึ่งช่อง
 *    ฟอร์มที่ไม่มีคอลัมน์นี้ต้องถูกปฏิเสธ ห้ามเดา — เดาผิดคือยอดลงผิดช่องบนใบที่ส่งลูกค้า
 *
 * ⚠️ ห้ามแตะ Aging · Fail · แถวรวม · ช่องลงชื่อใต้แถวรวม — เป็นของฟอร์มเอง
 * ⚠️ จำนวน/PCS = ต่อกล่อง × กล่อง + เศษ คือยอดรวมทั้งกลุ่ม P/N · ยอดราย PO ลงคอลัมน์ยอดส่งงาน
 *    #77 (8 ก.ย. 2026) เขียนยอดราย PO ทับช่องจำนวน/PCS พนักงานอ่านแล้วงง เจ้าของสั่งย้าย 11 ก.ย. 2026
 */

/** ป้ายหัวตารางที่ต้องมี -> ชื่อที่โค้ดใช้ · เทียบแบบตัดช่องว่างทิ้งและไม่สนตัวพิมพ์ ("PO  NO" = "PO NO") */
const DN_HEAD = [['P/N','pn'], ['PO NO','po'], ['Order Date','orderDate'], ['PO QTY','orderQty'],
  ['Wip bal.','wip'], ['ยอดส่งงาน','shipQty'], ['จำนวนต่อกล่อง','perBox'], ['จำนวนกล่อง','boxes'],
  ['จำนวนเศษ','remainder'], ['จำนวน/PCS','pcs'], ['Remark','remark']];
const dnKey = s => String(s).replace(/\s+/g, '').toLowerCase();

/** ผังของชีตนี้ { col, first, last, dateRef } — ขาดอะไรต้อง throw บอกคนใช้ ห้ามเดาตำแหน่ง */
function dnLayout(doc, shared){
  const rows = Array.from(doc.getElementsByTagNameNS(XL_NS, 'row'));
  const rowNo = r => Number(r.getAttribute('r'));
  const head = rows.find(r => Array.from(r.children).some(c => dnKey(cellText(c, shared)) === 'p/n'));
  if(!head) throw new Error('หาแถวหัวตาราง (ช่อง P/N) ในชีตนี้ไม่เจอ');
  const want = new Map(DN_HEAD.map(([label, k]) => [dnKey(label), k]));
  const col = {};
  Array.from(head.children).forEach(c => {
    const k = want.get(dnKey(cellText(c, shared)));
    // Remark มีสองช่อง ช่องแรกเป็นคอลัมน์ที่ซ่อนไว้ · ช่องที่พิมพ์ออกกระดาษคือช่องท้ายตาราง จึงให้ตัวหลังชนะ
    if(k && (!col[k] || k === 'remark')) col[k] = colOfRef(c.getAttribute('r'));
  });
  if(!col.shipQty) throw new Error('ฟอร์มนี้ยังเป็นฉบับเก่าที่ไม่มีคอลัมน์ "ยอดส่งงาน" — ใช้ฟอร์มฉบับที่แทรกคอลัมน์นี้แล้ว');
  const miss = DN_HEAD.filter(([, k]) => !col[k]).map(([label]) => label);
  if(miss.length) throw new Error('ฟอร์มนี้ไม่มีหัวคอลัมน์ ' + miss.join(', '));
  const first = rowNo(head) + 1;
  const total = rows.find(r => rowNo(r) >= first && Array.from(r.getElementsByTagNameNS(XL_NS, 'f'))
    .some(f => /^\s*SUM\(/i.test(f.textContent)));
  if(!total) throw new Error('หาแถวยอดรวมท้ายตาราง (สูตร SUM) ไม่เจอ');
  const dateCell = rows.filter(r => rowNo(r) < first).flatMap(r => Array.from(r.children))
    .find(c => /^Date_/i.test(cellText(c, shared)));
  if(!dateCell) throw new Error('หาช่องวันที่บนหัวใบ (Date___) ไม่เจอ');
  return { col, first, last: rowNo(total) - 1, dateRef: dateCell.getAttribute('r') };
}

/** เขียนข้อความลงช่อง โดยรักษารูปแบบเดิมไว้
 *  ใช้ inlineStr เพื่อไม่ต้องไปยุ่งกับตาราง sharedStrings ที่ใช้ร่วมกันทั้งไฟล์
 *  แตะตารางนั้นเมื่อไหร่ ช่องอื่นที่อ้างเลขเดียวกันจะเปลี่ยนตามไปด้วย */
function setTextCell(doc, rowEl, col, text, fallbackStyle){
  const c = ensureCell(doc, rowEl, col, fallbackStyle);
  c.setAttribute('t', 'inlineStr');
  while(c.firstChild) c.removeChild(c.firstChild);
  const is = doc.createElementNS(XL_NS, 'is');
  const t = doc.createElementNS(XL_NS, 't');
  t.textContent = String(text);
  is.appendChild(t); c.appendChild(is);
}

/** เขียนสูตรจำนวน/PCS ของฟอร์ม (ต่อกล่อง × กล่อง + เศษ) ลงแถวนี้
 *
 *  ใช้กับทุกแถวที่ออกใบ — แถวแรกของกลุ่มคิดยอดรวมทั้งกลุ่ม แถวที่เหลือถูก merge ทับและคิดได้ 0
 *  และกับแถวที่ไม่ได้ใช้ซึ่งมีตัวเลขนิ่งค้างจากใบที่รุ่น 8-11 ก.ย. 2026 ออกให้
 *  ถ้าปล่อยตัวเลขนั้นไว้ มันจะถูกบวกเข้ายอดรวมท้ายตารางบนใบใหม่โดยไม่มีอะไรฟ้อง
 *
 *  ⚠️ ฟอร์มจริงเก็บสูตรคอลัมน์นี้แบบ shared (ตรวจไฟล์จริง 11 ก.ย. 2026)
 *     ช่องแรกถือสูตร <f t="shared" ref="Q10:Q54" si="1">N10*O10+P10</f> ช่องที่เหลือเก็บแค่ <f t="shared" si="1"/>
 *     พอเขียนทับช่องแรก ช่องที่เหลือจะอ้างถึงสูตรที่ไม่มีอยู่ — ลูปล้างแถวท้ายจึงต้องเขียนสูตรคืนให้ช่องพวกนั้นด้วย
 *
 *  ⚠️ ห้ามใช้ clearCell() กับช่องนี้ · มันลบลูกทุกตัวรวมทั้ง <f> = ลบสูตรของฟอร์มลูกค้าทิ้ง */
function restoreQtyFormula(doc, rowEl, col, fallbackStyle){
  const n = rowEl.getAttribute('r');
  const c = ensureCell(doc, rowEl, col.pcs, fallbackStyle);
  c.removeAttribute('t');
  while(c.firstChild) c.removeChild(c.firstChild);
  const f = doc.createElementNS(XL_NS, 'f');
  f.textContent = `${col.perBox}${n}*${col.boxes}${n}+${col.remainder}${n}`;
  c.appendChild(f);
}

/** ล้างค่าในช่องแต่คงรูปแบบ (เส้นขอบ สี) ไว้ — ใช้กับแถวที่เหลือจากใบครั้งก่อน */
function clearCell(doc, rowEl, col){
  const ref = col + rowEl.getAttribute('r');
  for(const el of Array.from(rowEl.children)){
    if(el.getAttribute('r') === ref){
      el.removeAttribute('t');
      while(el.firstChild) el.removeChild(el.firstChild);
      return;
    }
  }
}

/** หา <c> ของคอลัมน์นี้ สร้างใหม่ให้ถูกลำดับถ้ายังไม่มี */
function ensureCell(doc, rowEl, col, fallbackStyle){
  const ref = col + rowEl.getAttribute('r');
  for(const el of Array.from(rowEl.children)){
    if(el.getAttribute('r') === ref) return el;
  }
  const c = doc.createElementNS(XL_NS, 'c');
  c.setAttribute('r', ref);
  if(fallbackStyle != null) c.setAttribute('s', fallbackStyle);
  const want = colIndex(col);
  let before = null;
  for(const el of Array.from(rowEl.children)){
    if(colIndex(colOfRef(el.getAttribute('r'))) > want){ before = el; break; }
  }
  rowEl.insertBefore(c, before);
  return c;
}

/** ตั้งค่า merge ของช่วงข้อมูลใหม่ทั้งหมด — ของเดิมในช่วงแถวข้อมูลถูกล้างก่อนเสมอ
 *  ไม่งั้น merge ของใบครั้งก่อนจะค้างและซ้อนทับกับของใบใหม่จนไฟล์เสีย
 *  ⚠️ ต้องเป็นช่วงแถวของชีตนี้ ไม่ใช่ 10-95 · merge ช่อง "รวม" (B78:E78) ของชีต TUE-H เคยหายเพราะเลขตายตัว */
function setDataMerges(doc, ranges, first, last){
  let mc = doc.getElementsByTagNameNS(XL_NS, 'mergeCells')[0];
  if(!mc){
    const sheetData = doc.getElementsByTagNameNS(XL_NS, 'sheetData')[0];
    if(!sheetData) return;
    mc = doc.createElementNS(XL_NS, 'mergeCells');
    sheetData.parentNode.insertBefore(mc, sheetData.nextSibling);
  }
  const inData = ref => {
    const m = /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(ref || '');
    return m && Number(m[1]) >= first && Number(m[2]) <= last;
  };
  Array.from(mc.children).forEach(el => { if(inData(el.getAttribute('ref'))) mc.removeChild(el); });
  ranges.forEach(ref => {
    const el = doc.createElementNS(XL_NS, 'mergeCell');
    el.setAttribute('ref', ref);
    mc.appendChild(el);
  });
  mc.setAttribute('count', String(mc.children.length));
  if(!mc.children.length && mc.parentNode) mc.parentNode.removeChild(mc);
}

/** กรอกฟอร์มแล้วคืนไฟล์ใหม่ · groups มาจาก deliveryGroups() */
/** ใบสั่งที่คนติ๊กไว้เองว่าให้ขึ้นในใบ ทั้งที่รอบนี้ไม่ได้ส่งของใบนั้น
 *
 *  ⚠️ ตั้งใจ "ไม่เก็บลงข้อมูลและไม่ซิงค์" ตามที่เจ้าของสั่ง 3 ก.ย. 2026
 *     เหตุผลของเจ้าของ — คนที่ปริ้นใบคือคนที่เซฟไฟล์ออกมาอยู่แล้ว การซิงค์จึงไม่มีประโยชน์
 *     และถ้าติ๊กค้างไว้ข้ามวัน พนักงานจะเลิกตรวจสอบว่ารอบนี้ควรใส่ใบไหนบ้าง
 *
 *  จึงล้างทิ้งทุกครั้งที่เปลี่ยนวันที่หรือหน่วย — บังคับให้ตัดสินใจใหม่ทุกใบ */
let dnExtraRows = new Set();
let dnExtraKey = '';

/** ใบสั่งที่จะได้บรรทัดบนกระดาษจริง
 *
 *  ⚠️ ต่างจากบนจอโดยตั้งใจ · บนจอต้องเห็นทุกใบของกลุ่ม ไม่งั้นไม่มีช่องให้กรอก
 *     บนกระดาษเอาเฉพาะใบที่มีของส่งรอบนี้ เพราะใบส่งสินค้าคือรายการ "ของที่ส่งไปกับรอบนี้"
 *     ไม่ใช่รายการใบสั่งที่ยังค้างอยู่ (PR #43)
 *
 *  ...บวกใบที่คนติ๊กไว้เอง — เจ้าของเจอกรณีจริงที่ Delta ยังค้างใบหนึ่งอยู่
 *  และอยากให้ใบนั้นปรากฏบนกระดาษ ทั้งที่ของรอบนี้ตัดเข้าใบอื่นไปหมดแล้ว
 *  ใส่จำนวนให้ใบนั้นไม่ได้เพราะยอดส่งจะเกินของจริง จึงต้องเป็นการเลือกด้วยมือ */
const shippedOrders = g => g.orders.filter(x => x.alloc > 0 || dnExtraRows.has(x.o.id));

async function fillDeliveryForm(zip, path, unit, date, groups, week){
  const doc = parseXml(await zip.file(path).async('string'));
  const L = dnLayout(doc, await readSharedStrings(zip));
  const col = L.col;
  const lineCount = groups.reduce((s,g)=> s + shippedOrders(g).length, 0);
  if(lineCount > L.last - L.first + 1){
    throw new Error(`ชีต ${unit} มีที่ให้ ${L.last-L.first+1} บรรทัด แต่มี ${lineCount} บรรทัดที่จะส่ง — ต้องแยกเป็นสองใบ`);
  }
  const rowByNo = {};
  Array.from(doc.getElementsByTagNameNS(XL_NS, 'row'))
    .forEach(r => { rowByNo[Number(r.getAttribute('r'))] = r; });

  // รูปแบบประจำคอลัมน์ เอาไว้ใช้กับแถวที่ยังไม่มีช่องนั้นอยู่เลย
  // ⚠️ สำคัญกับคอลัมน์ Order Date เป็นพิเศษ — ช่องที่สร้างใหม่โดยไม่มีรูปแบบ
  //    จะโชว์เป็นเลขดิบแทนที่จะเป็นวันที่ ซึ่งอ่านไม่รู้เรื่องบนกระดาษ
  const styleOf = {};
  Object.values(col).forEach(letter=>{
    for(let n=L.first; n<=L.last; n++){
      const rowEl = rowByNo[n];
      if(!rowEl) continue;
      const c = Array.from(rowEl.children).find(x=>x.getAttribute('r')===letter+n);
      if(c && c.getAttribute('s') != null){ styleOf[letter] = c.getAttribute('s'); break; }
    }
  });

  const d = date.split('-');
  const dateLabel = `Date___${Number(d[2])}/${Number(d[1])}/${d[0].slice(2)}__(WK ${week})`;
  const headRow = rowByNo[Number(L.dateRef.replace(/^[A-Z]+/, ''))];
  setTextCell(doc, headRow, 'B', unit);
  setTextCell(doc, headRow, colOfRef(L.dateRef), dateLabel);

  let n = L.first;
  const merges = [];
  for(const g of groups){
    const first = n;
    for(const {o, wip, alloc, deltaWip} of shippedOrders(g)){
      const rowEl = rowByNo[n];
      if(rowEl){
        setTextCell(doc, rowEl, col.pn, g.pn, styleOf[col.pn]);
        setTextCell(doc, rowEl, col.po, o.poNo, styleOf[col.po]);
        if(o.orderDate) setNumberCell(doc, rowEl, col.orderDate, isoToExcelSerial(o.orderDate), styleOf[col.orderDate]);
        else clearCell(doc, rowEl, col.orderDate);
        setNumberCell(doc, rowEl, col.orderQty, Number(o.orderQty)||0, styleOf[col.orderQty]);
        // ⚠️ ช่องนี้ต้องเป็นยอดของ Delta ไม่ใช่ยอดที่เราคิดเอง (เจ้าของสั่ง 1 ก.ย. 2026)
        //    เพราะเลขบนใบต้องตรงกับที่ลูกค้าถืออยู่ ไม่ใช่ตรงกับบัญชีเรา
        //    ใบที่ Delta ไม่มีข้อมูล เว้นว่างไว้ ห้ามเดาด้วยยอดของเรา
        //    ห้ามหักยอดที่ Delta ยังไม่นับด้วย — เจ้าของเลือกให้หักเฉพาะหน้า FG (deltaWipLeft)
        if(deltaWip == null) clearCell(doc, rowEl, col.wip);
        else setNumberCell(doc, rowEl, col.wip, deltaWip, styleOf[col.wip]);

        /* ยอดส่งของ "ราย PO" — Delta ขอเมื่อ 8 ก.ย. 2026 · ลงคอลัมน์ยอดส่งงาน (เจ้าของสั่ง 11 ก.ย. 2026)
         *
         * ⚠️ ห้ามลงช่องจำนวน/PCS · ช่องนั้นคือยอดรวมทั้งกลุ่มที่พนักงานกับ Delta อ่าน
         *    #77 เคยลงยอดราย PO ทับช่องนั้น ยอดรวมของกลุ่มหายจากกระดาษ พนักงานอ่านแล้วงง
         *
         * ⚠️ ผลบวกยอดส่งงานของกลุ่มเท่ากับจำนวน/PCS บนกระดาษเสมอ เพราะด่าน packQty !== qty กันไว้ก่อนออกใบ */
        setNumberCell(doc, rowEl, col.shipQty, Number(alloc)||0, styleOf[col.shipQty]);
        // จำนวน/PCS เป็นสูตรทุกแถวที่ใช้ · แถวแรกคิดยอดรวมกลุ่ม แถวที่เหลือกล่อง/เศษว่างจึงคิดได้ 0 และถูก merge ทับ
        // ต้องเขียนเอง ไม่ใช่ปล่อยไว้ — ฟอร์มจริงมีสูตรแค่บางช่วงแถว และใบที่รุ่นก่อนออกให้มีตัวเลขนิ่งค้าง
        restoreQtyFormula(doc, rowEl, col, styleOf[col.pcs]);
        // ยอดบรรจุลงเฉพาะแถวแรกของกลุ่ม แถวที่เหลือเว้นว่าง เพราะกล่อง/เศษเป็นของทั้งกลุ่ม
        if(n === first){
          /* ⚠️ กลุ่มที่รอบนี้ไม่ได้ส่งของเลย — มีแต่แถวที่คนติ๊กให้ขึ้นกระดาษ
           *
           * ต้องเว้นช่องบรรจุไว้ ห้ามพิมพ์ 0 · กระดาษที่เขียนว่า "กล่องละ 0 · 0 กล่อง · เศษ 0"
           * เป็นการประกาศเรื่องการแพ็คที่ไม่จริง ทั้งที่ความจริงคือรอบนี้ไม่ได้ส่งใบนี้
           *
           * ⚠️ ช่องยอดส่งงานต่างออกไป — ตรงนั้นเขียน 0 ลงไปจริง เพราะ "รอบนี้ส่ง 0 ชิ้น"
           *    เป็นความจริงและเป็นข้อมูลที่ Delta ขอ ไม่ใช่การประกาศเรื่องที่ไม่เคยเกิด
           *
           * Remark ยังลงตามปกติ เพราะเป็นที่เดียวที่อธิบายได้ว่าทำไมใบนี้ถึงมาอยู่บนกระดาษ */
          if(g.qty > 0){
            setNumberCell(doc, rowEl, col.perBox, g.perBox, styleOf[col.perBox]);
            setNumberCell(doc, rowEl, col.boxes, g.boxes, styleOf[col.boxes]);
            setNumberCell(doc, rowEl, col.remainder, g.remainder, styleOf[col.remainder]);
          } else {
            [col.perBox, col.boxes, col.remainder]
              .forEach(c => clearCell(doc, rowEl, c));
          }
          const remark = g.remark;
          if(remark) setTextCell(doc, rowEl, col.remark, remark, styleOf[col.remark]);
          else clearCell(doc, rowEl, col.remark);
        } else {
          [col.perBox, col.boxes, col.remainder, col.remark]
            .forEach(c => clearCell(doc, rowEl, c));
        }
      }
      n++;
    }
    // จำนวน/PCS merge ทั้งกลุ่มเหมือนกล่อง/เศษ · ยอดส่งงานห้าม merge เพราะเป็นยอดราย PO
    if(n - first > 1) [col.perBox, col.boxes, col.remainder, col.pcs].forEach(c => merges.push(`${c}${first}:${c}${n-1}`));
  }

  // แถวที่เหลือจากใบครั้งก่อนต้องล้าง ไม่งั้นใบใหม่จะมีของเก่าปนโดยไม่มีใครสังเกต
  // ⚠️ ล้างแค่ถึงแถวก่อนแถวรวมของชีตนี้ · แถวรวมกับช่องลงชื่อข้างใต้เป็นของฟอร์ม
  for(; n <= L.last; n++){
    const rowEl = rowByNo[n];
    if(!rowEl) continue;
    ['pn','po','orderDate','orderQty','wip','shipQty','perBox','boxes','remainder','remark']
      .forEach(k => clearCell(doc, rowEl, col[k]));
    // ช่องจำนวนต้องกลับเป็นสูตรธรรมดา ถ้าเป็นตัวเลขนิ่งที่ค้างมา หรือยังเป็นสูตร shared (ดู restoreQtyFormula)
    // ⚠️ รวมช่องแรกของช่วง shared ที่เรายังไม่ได้แตะด้วย — ช่วง (ref) ของมันครอบช่องถัดไปที่ถูกแปลงเป็นสูตรธรรมดาแล้ว
    //    ปล่อยไว้ไฟล์จะมีช่วง shared ที่ไม่ตรงกับของจริง ซึ่ง Excel อาจฟ้องว่าไฟล์เสีย
    // ช่องที่ฟอร์มไม่มีสูตรมาแต่แรกปล่อยว่าง — เติมให้ทุกแถวไม่ได้ กระดาษจะขึ้น 0 เต็มคอลัมน์
    const pc = Array.from(rowEl.children).find(x => x.getAttribute('r') === col.pcs + n);
    const pf = pc && pc.getElementsByTagNameNS(XL_NS, 'f')[0];
    const keep = pf && pf.textContent && pf.getAttribute('t') !== 'shared';
    if(pc && pc.firstChild && !keep) restoreQtyFormula(doc, rowEl, col, null);
  }

  setDataMerges(doc, merges, L.first, L.last);
  // ต้องทำหลังเติมค่าเสร็จ ไม่งั้นช่องสูตรที่เราเพิ่งแตะจะแคชค่าเก่าไว้อีก
  clearCachedFormulaValues(doc);
  await setFullCalcOnLoad(zip);
  zip.file(path, serializeXml(doc));
  // ⚠️ ต้องสั่ง DEFLATE เอง ค่าเริ่มต้นของ JSZip คือไม่บีบอัดเลย (เคยทำไฟล์โต 5 เท่ามาแล้ว)
  return await zip.generateAsync({type:'blob', compression:'DEFLATE', compressionOptions:{level:6},
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

/* ---------- หน้าจอใบส่งสินค้า ---------- */

const dnDate = () => document.getElementById('dnDate').value;
const dnUnit = () => document.getElementById('dnUnit').value;
const dnWeek = () => document.getElementById('dnWeek').value;

/** หน่วยที่มีอยู่จริงในข้อมูล ไม่ fix ไว้ในโค้ด — โรงงานเพิ่มหน่วยใหม่แล้วต้องโผล่เอง
 *
 *  ⚠️ ไม่ใช้ fillSelect() เพราะตัวนั้นใส่ตัวเลือก "ทั้งหมด" ให้เสมอ ซึ่งถูกสำหรับตัวกรอง
 *     แต่ผิดสำหรับที่นี่ — ใบส่งสินค้าหนึ่งใบเป็นของหน่วยเดียว ไม่มีใบ "ทุกหน่วย"
 *     ถ้าปล่อยให้เลือกได้ ตารางจะว่างเปล่าตั้งแต่เปิดหน้ามาโดยไม่มีอะไรบอกว่าทำไม */
function renderDnUnits(){
  const el = document.getElementById('dnUnit');
  const units = uniqueSorted(activeOrders().map(o=>o.subName));
  const cur = el.value;
  el.innerHTML = units.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if(units.includes(cur)) el.value = cur;
}

const dnQuery = () => document.getElementById('dnSearch').value.trim();

/** กรองกลุ่มที่จะแสดงตามคำค้น — ตรงกับ P/N หรือ PO ใบไหนก็ได้ในกลุ่ม
 *
 *  ⚠️ เจอกลุ่มแล้วต้องโชว์ "ทั้งกลุ่ม" ไม่ใช่เฉพาะใบที่ตรงกับคำค้น
 *     เพราะยอดบรรจุเป็นของทั้งกลุ่ม ถ้าซ่อนบางใบไป ช่อง "เหลือต้องตัดอีก"
 *     จะดูเหมือนกรอกผิดทั้งที่ถูก แล้วคนจะไปแก้ตัวเลขที่ถูกอยู่แล้วให้ผิด
 *
 *  ⚠️ นี่คือการกรองสิ่งที่ "เห็น" อย่างเดียว การออกใบไม่ผ่านทางนี้
 *     ห้ามเอาผลของฟังก์ชันนี้ไปใช้ตอนสร้างไฟล์ ไม่งั้นของที่ถูกซ่อนจะหายจากใบจริง */
function dnFilter(groups){
  const q = dnQuery().toLowerCase();
  if(!q) return groups;
  return groups.filter(g => String(g.pn).toLowerCase().includes(q)
                         || g.orders.some(({o}) => String(o.poNo).toLowerCase().includes(q)));
}

/** ข้อความตอนตารางว่าง — ต้องบอกให้ตรงว่าว่างเพราะอะไร
 *
 *  ⚠️ ช่องติ๊ก "ซ่อนใบที่ไม่มียอด Delta" ติ๊กไว้เป็นค่าเริ่มต้น
 *     ถ้าสัปดาห์นั้นยังไม่ได้นำเข้าไฟล์ Call In ตารางจะว่างทั้งหน้า
 *     ถ้าไม่บอกเหตุผล คนจะคิดว่าข้อมูลหายหรือโปรแกรมพัง แล้วโทรตามกันวุ่น
 *     ทั้งที่แค่ปลดติ๊กก็เห็นครบ */
function dnEmptyMsg(all){
  if(dnQuery()) return `ไม่พบ P/N หรือ PO ที่ตรงกับ "${escapeHtml(dnQuery())}" ในหน่วยนี้`;
  return 'หน่วยนี้ไม่มีใบที่ค้างส่งแล้ว';
}

/** ซ่อนใบที่ไม่มียอด Delta ออกจากหน้าจอ — เจ้าของสั่ง 4 ก.ย. 2026
 *
 *  ⚠️ นี่คือ "การซ่อนบนหน้าจอ" ไม่ใช่การตัดออกจากตัวกรองหลัก และต่างกันมาก
 *
 *     กฎที่ตั้งไว้ใน #49 ยังอยู่ครบ — ยอด Delta ใช้ "เพิ่มแถว" ได้ ใช้ "ตัดแถว" ไม่ได้
 *     ถ้าเอาไปตัดใน deliveryGroups() ใบที่ Delta ยังไม่ส่งไฟล์มาจะหายจนส่งของไม่ได้เลย
 *     ตัวนี้จึงกรองทีหลัง เป็นชั้นของการแสดงผลล้วน ๆ และปลดติ๊กก็กลับมาเห็นทันที
 *
 *  ⚠️ เกณฑ์คือ "ใบนั้นอยู่ในไฟล์ Call In งวดล่าสุดหรือไม่" ไม่ใช่ "มียอด Delta หรือไม่"
 *     เปลี่ยนเมื่อ 5 ก.ย. 2026 ตามที่เจ้าของสั่ง — ใบที่อยู่ในไฟล์แต่เขาเว้นช่อง Wip bal.
 *     ว่างไว้ ยังต้องอยู่บนจอ เพราะเขาเอ่ยถึงใบนั้นแปลว่ายังรอของอยู่ แค่ไม่ได้บอกยอด
 *     (ไฟล์จริงของ WK 35 มีแบบนี้ 39 ใบ)
 *
 *  ⚠️ ห้ามซ่อนแถวที่ "กำลังใช้งานอยู่" — มีจำนวนที่ส่งแล้ว หรือถูกติ๊กใส่ในใบไว้
 *     ซ่อนแล้วคนจะแก้ยอดที่ตัวเองเพิ่งคีย์ไม่ได้ ทั้งที่ยอดนั้นจะลงกระดาษจริง
 *
 *  ⚠️ การออกใบไม่สนใจตัวกรองนี้ (เหมือนที่ไม่สนใจช่องค้นหา) ของที่ซ่อนอยู่
 *     แต่มีจำนวนคีย์ไว้ ยังลงไฟล์ตามปกติ — ยอดสรุปด้านบนจึงต้องบอกว่าซ่อนไว้กี่ใบ */
function dnHideNoDelta(){
  const el = document.getElementById('dnHideNoDelta');
  return !el || el.checked;
}

function dnApplyNoDeltaHide(groups){
  if(!dnHideNoDelta()) return {groups, hidden: 0};

  /* ⚠️ ถ้ารอบนี้ยังไม่มียอด Delta สักใบเดียว = ยังไม่ได้นำเข้าไฟล์ Call In ของสัปดาห์นี้
   *    กรณีนั้นห้ามซ่อนอะไรเลย ไม่งั้นหน้าจอว่างทั้งหน้าและส่งของไม่ได้ทั้งหน่วย
   *
   *    ตัวกรองนี้มีไว้ "ตัดเสียงรบกวนตอนมีของให้เทียบ" ไม่ใช่ "ปิดหน้าจอตอนไม่มีข้อมูล"
   *    เจอตอนรันเทส — ตั้งซ่อนตรง ๆ แล้วเทสเดิมตก 17 ข้อ ทุกข้อคือกรณีที่ยังไม่มีข้อมูล Delta
   *    ซึ่งตรงกับสภาพจริงของสัปดาห์ที่ไฟล์ยังมาไม่ถึง */
  const anyInCallIn = groups.some(g => g.orders.some(x => x.inCallIn));
  if(!anyInCallIn) return {groups, hidden: 0};
  let hidden = 0;
  const out = [];
  groups.forEach(g=>{
    const keep = g.orders.filter(x=>{
      if(x.inCallIn) return true;
      if(x.alloc > 0 || dnExtraRows.has(x.o.id)) return true;   // กำลังใช้งานอยู่
      hidden++;
      return false;
    });
    if(keep.length) out.push(Object.assign({}, g, {orders: keep}));
  });
  return {groups: out, hidden};
}

function renderDeliveryNote(){
  renderDnUnits();
  const date = dnDate(), unit = dnUnit();
  if(!date || !unit){
    document.getElementById('dnTable').innerHTML = '';
    document.getElementById('dnSummary').textContent = 'เลือกวันที่และหน่วยก่อน';
    return;
  }
  // เปลี่ยนวันหรือหน่วยเมื่อไหร่ ล้างที่ติ๊กไว้ทิ้ง — ใบใหม่ต้องตัดสินใจใหม่
  const key = date + '|' + unit;
  if(key !== dnExtraKey){ dnExtraKey = key; dnExtraRows = new Set(); }

  const all = deliveryGroups(date, unit);

  // เลข Item ต้องนับจากลำดับจริงของทั้งวัน ไม่ใช่ลำดับที่เห็นตอนกรอง
  // ไม่งั้นเลขบนจอกับเลขบนกระดาษที่ปริ้นออกมาจะไม่ตรงกัน
  let item = 0;
  const itemOf = new Map();
  all.forEach(g=> g.orders.forEach(({o})=> itemOf.set(o.id, ++item)));

  const groups = dnApplyNoDeltaHide(dnFilter(all)).groups;

  const html = groups.map(g=>{
    const pn = escapeHtml(g.pn);
    // v === 0 ต้องโชว์เลข 0 ไม่ใช่ช่องว่าง เพราะเป็นค่าที่โปรแกรมคิดให้ ไม่ใช่ค่าที่ยังไม่มี
    const num = (f, v, ph) => `<input type="number" min="0" class="row-input dn-pack" data-f="${f}" data-pn="${pn}" value="${(v === '' || v == null) ? '' : v}" placeholder="${ph}">`;

    /* ⚠️ ช่องของ "กลุ่ม P/N" ใช้ rowspan คร่อมทุกใบสั่งของกลุ่ม ไม่ใช่แถวหัวกลุ่มลอยด้านบน
     *
     *    เจ้าของแจ้ง 3 ก.ย. 2026 ว่าพนักงานอ่านหน้านี้ยาก เพราะโครงบนจอไม่เหมือนกระดาษ
     *    บนกระดาษ P/N เป็นคอลัมน์แรกของทุกบรรทัด และช่องบรรจุถูก merge คร่อมทั้งกลุ่ม
     *    จอเดิมกลับเอา P/N ไปเป็นแถวพาดหัว แล้ววางช่องบรรจุไว้บนแถวนั้น
     *    คนที่ถือกระดาษอยู่จึงต้องแปลโครงในหัวทุกครั้งที่กวาดตาหาบรรทัด
     *
     *    rowspan ให้ผลเหมือน merge บนกระดาษเป๊ะ ๆ และยังกรอกครั้งเดียวต่อกลุ่มเหมือนเดิม */
    const span = g.orders.length;
    const packCells =
      `<td class="dn-merge" rowspan="${span}">${num('perBox', g.perBox || '', 'ต่อกล่อง')}</td>
       <td class="dn-merge" rowspan="${span}">${num('boxes', g.qty ? g.boxes : '', 'กล่อง')}</td>
       <td class="dn-merge" rowspan="${span}">${num('remainder', g.qty ? g.remainder : '', 'เศษ')}</td>
       <td class="dn-merge" rowspan="${span}" data-pcs="${pn}"><b>${g.qty? numFmt(g.qty) : '—'}</b></td>
       <td class="dn-merge" rowspan="${span}" data-left="${pn}">${dnLeftCell(g)}</td>
       <td class="dn-merge" rowspan="${span}"><input type="text" class="row-input dn-pack" data-f="remark"
              data-pn="${pn}" value="${escapeHtml(g.remark)}" style="width:88px" placeholder="Remark"
              title="ลงช่อง Remark ของใบส่งสินค้า เช่น NEW / RETURN / แพค 3 กล่องไม่เต็ม"></td>`;

    return g.orders.map(({o, wip, alloc, deltaWip, deltaRow, deltaWeek, inCallIn, onlyDelta, wipBefore}, i)=>{
      const first = i === 0;
      return `<tr${first ? ' class="dn-group"' : ''}>`
        + (first ? `<td class="dn-pn left" rowspan="${span}"><b>${pn}</b>
             <div class="hint">${span} ใบสั่ง</div></td>` : '')
        + `<td>${itemOf.get(o.id)}</td>
        <td class="left">${escapeHtml(o.poNo)}</td>
        <td>${fmtDateTH(o.orderDate)}</td>
        <td>${numFmt(o.orderQty)}</td>
        <td data-ourwip="${escapeHtml(o.id)}">${numFmt(wip)}</td>
        <td data-deltawip="${escapeHtml(o.id)}">${dnDeltaCell(deltaWip, deltaWeek, wip, inCallIn, deltaRow)}</td>
        <td><input type="number" min="0" class="row-input dn-alloc" data-order="${escapeHtml(o.id)}" data-pn="${pn}" value="${alloc||''}" placeholder="จำนวนที่ส่ง"></td>
        <td data-include="${escapeHtml(o.id)}">${dnIncludeCell(o.id, alloc)}</td>`
        + (first ? packCells : '')
        /* หมายเหตุอยู่ท้ายสุด (เจ้าของขอ 3 ก.ย. 2026) — ส่วนใหญ่ว่าง จึงไม่ควรไปคั่น
         * ระหว่างช่องที่คนคีย์จริง แต่ยังต้องอยู่บนจอ เพราะในนี้มีคำเตือน "เกิน"
         * ที่เคยตายมาหลายเดือนจนปลุกกลับมาใน #49 และป้ายบอกว่าแถวนี้โผล่มาเพราะ Delta */
        + `<td class="hint dn-note" data-note="${escapeHtml(o.id)}">${dnRowNote(wipBefore, alloc, deltaWip, onlyDelta)}</td>`
        + `</tr>`;
    }).join('');
  }).join('');

  /* หัวตารางสองแถว — แถวบนบอกว่ากลุ่มคอลัมน์นั้นตอบคำถามอะไร แถวล่างคือชื่อช่องจริง
   * ลำดับคอลัมน์เรียงตามใบจริง P/N -> PO -> Order Date -> PO QTY -> Wip bal. -> บรรจุ -> Remark */
  document.getElementById('dnTable').innerHTML =
    `<thead>
      <tr>
        <th rowspan="2" style="width:95px">P/N</th>
        <th rowspan="2" style="width:44px" title="บรรทัดที่เท่าไหร่บนกระดาษ">Item</th>
        <th rowspan="2">PO No.</th>
        <th rowspan="2" style="width:92px">Order Date</th>
        <th rowspan="2" style="width:80px">PO QTY</th>
        <th colspan="2" title="ยอดค้างส่ง — เทียบบัญชีเรากับไฟล์ Call In ของ Delta">Wip bal. · ยอดค้างส่ง</th>
        <th rowspan="2" style="width:76px">จำนวนที่ส่ง</th>
        <th rowspan="2" style="width:70px" title="ใบที่รอบนี้ไม่ได้ส่งของ แต่อยากให้ปรากฏบนกระดาษ">ใส่ในใบ</th>
        <th colspan="5" title="กรอกครั้งเดียวใช้ทั้งกลุ่ม P/N เหมือนช่องที่ merge ไว้ในใบจริง">บรรจุ · ทั้งกลุ่ม P/N</th>
        <th rowspan="2" style="width:96px" title="ลงช่อง Remark ของใบส่งสินค้า">Remark</th>
        <th rowspan="2" class="dn-note" style="width:1%" title="แถวนี้มีอะไรต้องระวัง">หมายเหตุ</th>
      </tr>
      <tr>
        <th style="width:85px" title="ยอดสั่ง ลบ ยอดที่ส่งไปแล้ว ตามบัญชีเรา — ตัวที่คุมว่ารอบนี้ส่งได้เท่าไหร่">ของเรา</th>
        <th style="width:86px" title="ยอดที่ Delta บันทึกว่าเรายังค้างเขาอยู่ — ตัวนี้คือเลขที่พิมพ์ลงกระดาษ">Delta</th>
        <th style="width:70px">ต่อกล่อง</th>
        <th style="width:64px">กล่อง</th>
        <th style="width:64px">เศษ</th>
        <th style="width:78px">จำนวน/PCS</th>
        <th style="width:72px" title="กลุ่มนี้ออกใบได้หรือยัง">ตรวจบรรจุ</th>
      </tr>
     </thead>
     <tbody>${html || emptyRow(16, dnEmptyMsg(all))}</tbody>`;

  /* หัวตารางแถวล่างต้องเลื่อนลงมาเท่าความสูงของแถวบน ไม่งั้นสองแถวทับกันตอนเลื่อนดู
   * วัดจากของจริงเพราะความสูงเปลี่ยนตามฟอนต์และการซูมของเครื่องแต่ละคน
   *
   * ⚠️ ห้ามวัดจาก th ตัวแรกของแถวบน — ตัวนั้นเป็น rowspan="2" ความสูงที่ได้จึงเป็น
   *    ของสองแถวรวมกัน แถวล่างจะถูกดันลงไปทับแถวข้อมูลแถวแรก (พลาดมาแล้วรอบหนึ่ง)
   *    วัดจากระยะของแถวล่างเทียบกับขอบบนของตารางแทน = ความสูงของแถวบนพอดี
   *
   * ล้าง top ที่เคยตั้งไว้ก่อนวัด ไม่งั้นรอบถัดไปจะวัดทับค่าของรอบก่อน
   * แท็บที่ยังซ่อนอยู่วัดได้ 0 — กรณีนั้นปล่อยให้ใช้ค่าตั้งต้นใน CSS ไป */
  const tbl = document.getElementById('dnTable');
  const leaf = Array.from(tbl.querySelectorAll('thead tr:nth-child(2) th'));
  leaf.forEach(th=> th.style.top = '0px');
  const rowTop = leaf.length
    ? leaf[0].getBoundingClientRect().top - tbl.getBoundingClientRect().top : 0;
  if(rowTop > 0) leaf.forEach(th=> th.style.top = rowTop + 'px');

  renderDnSummary();
  bindDnInputs();
}

/** ยอดสรุปเหนือตาราง — แยกออกมาเพราะต้องอัปเดตทุกครั้งที่ตัวเลขเปลี่ยน
 *  ไม่ใช่เฉพาะตอนวาดตารางใหม่ ไม่งั้นคำเตือน "ออกใบไม่ได้" จะขึ้นช้าไปหนึ่งจังหวะ
 *  อยู่นอกตารางจึงเขียนใหม่ได้ทั้งก้อนโดยไม่กระทบโฟกัสของช่องที่กำลังคีย์ */
function renderDnSummary(){
  const el = document.getElementById('dnSummary');
  if(!el) return;
  const all = deliveryGroups(dnDate(), dnUnit());
  const curWeek = currentDeltaWeek();

  /* ⚠️ ต้องเก็บผลของ "ตัวค้นหา" ไว้ก่อน แล้วค่อยเอาไปผ่านตัวกรอง Delta
   *
   *    dnFilter() คัดกลุ่มเดิมออกมาตรง ๆ เทียบด้วย indexOf ได้
   *    แต่ dnApplyNoDeltaHide() สร้างกลุ่มใหม่ด้วย Object.assign เพื่อตัดแถวข้างใน
   *    ถ้าเอาผลของมันไปเทียบ indexOf จะหาไม่เจอสักกลุ่ม แล้วตัวนับของตัวค้นหา
   *    จะกลายเป็น "ทุกกลุ่มที่มียอด" ทั้งที่คนไม่ได้ค้นหาอะไรเลย
   *
   *    ผู้ตรวจจับได้ใน #61 — จอขึ้นว่า "ตัวค้นหาซ่อนอยู่ 1 กลุ่ม (กรอกไว้แล้ว 1 กลุ่ม)"
   *    ทั้งที่กลุ่มที่ซ่อนไม่มียอดสักชิ้น เป็นคำเตือนหลอกบนหน้าจอที่คนใช้ตัดสินใจก่อนออกใบ */
  const searched = dnFilter(all);
  const hideRes = dnApplyNoDeltaHide(searched);
  const groups = hideRes.groups;

  // ⚠️ นับยอดรวมจากทุกกลุ่มของวันนั้นเสมอ ไม่ใช่เฉพาะกลุ่มที่ค้นหาเจอ
  //    ถ้านับตามที่เห็นบนจอ คนจะกดออกใบโดยเข้าใจว่ากรอกไปเท่าที่เห็น
  //    แต่ไฟล์ที่ออกมามีของที่ถูกกรองซ่อนอยู่ด้วย เพราะการออกใบไม่สนใจตัวค้นหา
  const totalPcs = all.reduce((s,g)=> s + g.qty, 0);
  const mismatch = all.filter(g => g.packQty !== g.qty).length;
  const hidden = all.length - searched.length;
  const hiddenFilled = all.filter(g => searched.indexOf(g) < 0 && g.qty > 0).length;

  /* ⚠️ นับเฉพาะใบที่ติ๊กไว้ "และยังไม่มียอดส่ง" — ไม่ใช่ dnExtraRows.size ดื้อ ๆ
   *
   * ติ๊กไว้ก่อนแล้วมาคีย์จำนวนทีหลังได้ พอมีจำนวนแล้วแถวนั้นขึ้นกระดาษเพราะจำนวน
   * ไม่ใช่เพราะติ๊ก การนับรวมจึงขัดกับข้อความที่เขียนว่า "ใบที่รอบนี้ไม่ได้ส่งของ"
   * (ที่ติ๊กไว้ไม่ถูกลบตอนคีย์จำนวน เพราะถ้าลบยอดออกทีหลัง คนจะเสียที่ติ๊กไปฟรี ๆ) */
  const extraNoShip = all.reduce((n, g) =>
    n + g.orders.filter(x => x.alloc <= 0 && dnExtraRows.has(x.o.id)).length, 0);

  el.innerHTML =
    `${numFmt(all.length)} กลุ่ม P/N · รวมที่จะส่งวันนี้ <b id="dnTotal">${numFmt(totalPcs)}</b> ชิ้น` +
    (mismatch? ` · <b style="color:var(--red)">มี ${numFmt(mismatch)} กลุ่มที่กล่อง/เศษไม่ตรงกับยอดที่คีย์ — ออกใบไม่ได้จนกว่าจะแก้</b>` : '') +
    // ต้องบอกว่ามีของถูกซ่อนอยู่ และซ่อนของที่กรอกไว้แล้วกี่กลุ่ม
    // เพราะการออกใบไม่สนใจตัวค้นหา ของที่มองไม่เห็นก็ยังลงไปในไฟล์
    (hidden ? ` · <b id="dnHidden">ตัวค้นหาซ่อนอยู่ ${numFmt(hidden)} กลุ่ม` +
       (hiddenFilled ? ` (กรอกไว้แล้ว ${numFmt(hiddenFilled)} กลุ่ม)` : '') +
       ` — การออกใบไม่สนใจตัวค้นหา ของที่ซ่อนอยู่ก็ลงในไฟล์ด้วย</b>` : '') +
    (extraNoShip ? ` · <b>ใส่ในใบเพิ่มอีก ${numFmt(extraNoShip)} ใบที่รอบนี้ไม่ได้ส่งของ</b>` : '') +
    // ซ่อนอยู่ต้องรู้ตัว ไม่งั้นคนหาใบไม่เจอแล้วคิดว่าข้อมูลหาย
    (hideRes.hidden ? ` · <b id="dnHiddenNoDelta">ซ่อนใบที่ไม่อยู่ในไฟล์ Call In อยู่ ${numFmt(hideRes.hidden)} ใบ</b>` : '') +
    /* ⚠️ ต้องบอกว่ากำลังยึดงวดไหนอยู่ · เปิดไฟล์งวดเก่าดูย้อนหลังแล้วกดเก็บ จะทำให้งวดเก่า
     *    กลายเป็น "ล่าสุด" ทั้งเครื่อง แล้วใบของงวดปัจจุบันถูกซ่อนหมด
     *    เราไม่กันการกดเก็บ (เจ้าของอาจตั้งใจตามเก็บงวดเก่าจริง) แต่ต้องเห็นด้วยตาทันที
     *    ห้ามเดาว่างวดไหน "ใหม่กว่า" ด้วยการเทียบเลข — ปลายปี wk52 -> wk01 เลขน้อยลงแต่ใหม่กว่า */
    (curWeek ? ` · ยึดยอด Delta จากไฟล์งวด <b>wk${escapeHtml(curWeek)}</b>` : '') +
    ` · ยอดที่กรอกลงสมุดเป็นยอดส่งของให้อัตโนมัติแล้ว ไม่ต้องไปคีย์ซ้ำที่แท็บบันทึกยอดรายวัน`;
}

/** ช่องติ๊ก "ใส่ในใบ" — มีความหมายเฉพาะแถวที่รอบนี้ไม่ได้ส่งของ
 *  แถวที่มีจำนวนแล้วขึ้นกระดาษอยู่แล้ว จึงติ๊กค้างไว้และกดไม่ได้ ไม่ใช่ซ่อน
 *  เพราะการเห็นว่ามันติ๊กอยู่ ช่วยให้อ่านตารางได้ว่าแถวไหนจะขึ้นบ้าง */
function dnIncludeCell(orderId, alloc){
  if(alloc > 0){
    return `<input type="checkbox" checked disabled title="มีจำนวนที่ส่งแล้ว จึงขึ้นในใบอยู่แล้ว">`;
  }
  const on = dnExtraRows.has(orderId) ? ' checked' : '';
  return `<input type="checkbox" class="dn-include" data-order="${escapeHtml(orderId)}"${on}`
       + ` title="ติ๊กเพื่อให้ใบสั่งนี้ปรากฏบนกระดาษ ทั้งที่รอบนี้ไม่ได้ส่งของ">`;
}

/** ป้ายท้ายแถวของใบสั่งหนึ่งใบ
 *
 *  ⚠️ "เกิน" ต้องวัดกับยอดค้างที่ "มากที่สุดของสองฝั่ง" ไม่ใช่ของเราอย่างเดียว
 *     ใบที่เราส่งครบแล้วแต่ Delta ยังค้าง ยอดของเราเป็น 0 ถ้าวัดกับของเรา
 *     ทุกจำนวนที่คีย์จะขึ้น "เกิน" หมด ซึ่งเป็นเสียงรบกวนบนแถวที่เราเพิ่งตั้งใจให้โผล่มา
 *     คำว่าเกินควรแปลว่า "มากกว่าที่ทั้งสองฝั่งคิดว่าค้างอยู่" */
function dnRowNote(wipBefore, alloc, deltaWip, onlyDelta){
  const limit = Math.max(Number(wipBefore) || 0, Number(deltaWip) || 0);
  const over = alloc > limit
    ? ` <span class="badge red" title="มากกว่ายอดค้างของทั้งสองฝั่ง (${numFmt(limit)})">⚠ เกิน</span>` : '';
  if(!onlyDelta) return over.trim();
  return `<span class="badge amber" title="บัญชีเราส่งครบแล้ว แต่ไฟล์ Call In ของ Delta ยังบันทึกว่าค้างอยู่ `
       + `— แถวนี้จึงยังขึ้นให้ส่งของได้">เราส่งครบแล้ว · Delta ยังค้าง</span>${over}`;
}

/** บอกว่าเลขที่จะลงกระดาษมาจากไหน — คนคีย์ต้องรู้ก่อนกดออกใบ ไม่ใช่รู้ตอนใบถึงมือลูกค้า */
/** ช่องยอดค้างฝั่ง Delta — คู่กับช่องยอดค้างของเราที่อยู่ติดกันซ้ายมือ
 *
 *  เจ้าของขอให้แยกเป็นสองคอลัมน์เทียบกัน (3 ก.ย. 2026) แทนป้ายต่อท้ายบรรทัดเดิม
 *  เพราะเลขฝั่ง Delta คือตัวที่พิมพ์ลงกระดาษ ส่วนเลขฝั่งเราคือตัวที่คุมว่าส่งได้เท่าไหร่
 *  วางคู่กันแล้วเห็นทันทีว่าสองฝั่งห่างกันอยู่หรือเปล่า โดยไม่ต้องเปิดหน้ายอดคงคลัง FG
 *
 *  ⚠️ ไม่ตรงกันไม่ใช่ความผิดพลาด และห้ามกันการออกใบ — Delta ตัดยอดช้ากว่าเราเป็นเรื่องปกติ */
function dnDeltaCell(deltaWip, deltaWeek, ourWip, inCallIn, dw){
  /* ตัวแก้มือ (เจ้าของสั่ง 15 ก.ย. 2026) — แก้ได้เฉพาะใบที่มีแถวของงวดล่าสุด (dw)
   * ใบที่ไม่อยู่ในไฟล์ไม่มีแถวให้แก้ และกระดาษของใบนั้นเว้นว่างตามกติกาเดิม */
  const edited = dw && deltaWipOverride(dw) != null;
  const tools = (edited ? `<div><span class="badge amber" title="${escapeHtml(deltaOverrideTip(dw))}">แก้มือ</span></div>` : '')
    + (dw ? `<button type="button" class="btn-mini dn-dw-edit" data-dw="${escapeHtml(dw.id)}"`
      + ` title="แก้ Wip bal. ของ Delta ด้วยมือ — ต้องใส่เหตุผลและชื่อผู้แก้">✎ แก้</button>` : '');
  /* ⚠️ สองกรณีนี้ต่างกัน และคนคีย์ต้องแยกออกจากข้อความบนจอ
   *    อยู่ในไฟล์แต่เว้นช่องว่าง = เขายังรอของ แต่ไม่ได้บอกยอด
   *    ไม่อยู่ในไฟล์เลย        = รอบนี้เขาไม่ได้เรียกใบนี้ (ปกติถูกซ่อนอยู่แล้ว) */
  if(deltaWip == null){
    const wkTxt = deltaWeek ? ` (wk${escapeHtml(deltaWeek)})` : '';
    return (inCallIn
      ? `<span class="badge amber" title="ใบนี้อยู่ในไฟล์ Call In${wkTxt} แต่ Delta เว้นช่อง Wip bal. ว่างไว้ `
        + `— ช่อง Wip bal. บนกระดาษจะเว้นว่างตาม">ไม่ระบุยอด</span>`
      : `<span class="badge amber" title="ไม่มีใบนี้ในไฟล์ Call In รอบล่าสุด — ช่อง Wip bal. บนกระดาษจะเว้นว่าง">`
        + `ไม่อยู่ในไฟล์</span>`) + tools;
  }
  const wk = deltaWeek ? `<div class="hint">wk${escapeHtml(deltaWeek)}</div>` : '';
  const diff = (Number(deltaWip) || 0) - (Number(ourWip) || 0);
  const style = diff === 0 ? '' : ' style="color:var(--amber)"';
  const tip = diff === 0
    ? 'ตรงกับยอดค้างของเรา'
    : `ต่างจากยอดค้างของเรา ${diff > 0 ? '+' : ''}${numFmt(diff)} — Delta ตัดยอดช้ากว่าเราได้ ไม่ใช่ความผิดพลาด`;
  return `<b${style} title="${tip}">${numFmt(deltaWip)}</b>${wk}${tools}`;
}

/** แก้ Wip bal. ของ Delta ด้วยมือ — เจ้าของสั่ง 15 ก.ย. 2026 (Delta ทำยอดในไฟล์ผิดได้)
 *
 *  ⚠️ บังคับเหตุผลกับชื่อผู้แก้ทุกครั้ง รวมตอนยกเลิก · ช่องชื่อไม่เติมชื่อเครื่องให้ ไม่งั้นคนกดผ่านโดยไม่ได้ลงชื่อจริง
 *  ⚠️ ยอดจากไฟล์ (wip) ไม่ถูกทับ — ตัวแก้อยู่คู่กันบนแถวของงวดนั้น จึงหมดอายุเองเมื่อนำเข้าไฟล์งวดใหม่
 *  ⚠️ ยกเลิกต้องเขียน wipOverride เป็น '' ตรง ๆ ห้ามลบฟิลด์ทิ้ง — Apps Script คงค่าเดิมไว้ถ้าฟิลด์หายไป
 *     (KEEP_IF_ABSENT กันเครื่องรุ่นเก่าล้างยอดที่แก้) ลบฟิลด์ = ยกเลิกไม่ได้บนเซิร์ฟเวอร์
 *  คืน true ถ้าบันทึก */
function editDeltaWip(dwId){
  const d = state.deltaWip.find(x => x.id === dwId && !x.voided);
  if(!d) return false;
  const file = deltaWipFileNum(d), cur = deltaWipOverride(d);
  const ans = prompt(`Wip bal. ที่ถูกต้อง (wk${d.week}) — ในไฟล์ของ Delta: ${file == null ? 'ว่าง' : numFmt(file)}`
    + (cur != null ? ` · ตอนนี้แก้มือไว้เป็น ${numFmt(cur)}` : '')
    + `\nเว้นว่าง = ยกเลิกการแก้มือ กลับไปใช้ยอดในไฟล์`, cur != null ? String(cur) : '');
  if(ans === null) return false;
  const txt = String(ans).replace(/,/g, '').trim();
  const clearing = txt === '';
  if(clearing && cur == null){ toast('ยังไม่ได้แก้มือไว้ — ไม่มีอะไรให้ยกเลิก'); return false; }
  const n = Number(txt);
  if(!clearing && (!isFinite(n) || n < 0)){ toast('ยอดต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป — ยังไม่ได้บันทึก'); return false; }
  const note = String(prompt(clearing ? 'เหตุผลที่ยกเลิกการแก้มือ (บังคับ)'
    : 'รายละเอียด / เหตุผลที่แก้ (บังคับ) — เช่น เทียบกับใบส่งของใบไหน', '') || '').trim();
  if(note.length < 3){ toast('ต้องใส่เหตุผลอย่างน้อย 3 ตัวอักษร — ยังไม่ได้บันทึก'); return false; }
  const by = String(prompt('ชื่อผู้แก้ (บังคับ)', '') || '').trim();
  if(!by){ toast('ต้องใส่ชื่อผู้แก้ — ยังไม่ได้บันทึก'); return false; }
  const now = new Date().toISOString();
  Object.assign(d, {wipOverride: clearing ? '' : n, overrideNote: clearing ? 'ยกเลิกการแก้: ' + note : note,
    overrideBy: by, overrideAt: now, updatedAt: now, _dirty: true});
  saveState();
  doSync();
  renderAll();
  // ⚠️ renderAll() ไม่วาดหน้าใบส่งสินค้า (หน้านั้นวาดตอนกดแท็บ) — แก้จากหน้านั้นต้องวาดเอง ไม่งั้นจอค้างเลขเก่า
  if(document.getElementById('view-delivery').classList.contains('active')) renderDeliveryNote();
  toast(clearing ? 'ยกเลิกการแก้มือแล้ว — กลับไปใช้ยอดในไฟล์ของ Delta' : `แก้ Wip bal. เป็น ${numFmt(n)} แล้ว`);
  return true;
}

/** ช่องสถานะของกลุ่ม — ตัวเลขที่คนต้องมองก่อนกดออกใบ
 *
 *  สิ่งที่ต้องเตือนคือ "เลขที่กระดาษจะพิมพ์ ไม่ตรงกับที่คีย์ไว้"
 *  เพราะสิ่งที่ลูกค้านับคือเลขบนกระดาษ ซึ่ง Excel คิดเองจาก ต่อกล่อง × กล่อง + เศษ
 *  ถ้าปล่อยให้ไม่ตรง ยอดที่ส่งจริงกับยอดที่แจ้งลูกค้าจะคนละตัว โดยไม่มีใครเห็น */
function dnLeftCell(g){
  const recalc = `<button type="button" class="btn-mini dn-recalc" data-pn="${escapeHtml(g.pn)}">คำนวณให้</button>`;
  if(!g.qty && !g.packQty) return '<span class="hint">ยังไม่กรอก</span>';
  const diff = g.packQty - g.qty;
  if(diff !== 0){
    return `<span class="badge red" title="กระดาษจะพิมพ์ ${numFmt(g.packQty)} แต่คีย์ไว้ ${numFmt(g.qty)}">`
         + `กล่อง/เศษ ไม่ตรงยอด ${diff > 0 ? '+' : ''}${numFmt(diff)}</span> ` + recalc;
  }
  if(g.manual){
    return `<span class="badge amber" title="โปรแกรมจะไม่คิดกล่องให้ใหม่เอง จนกว่าจะกดคำนวณให้">แก้กล่องเอง</span> ` + recalc;
  }
  return `<span class="badge green">ยอดตรง</span>`;
}

/** ⚠️ ห้ามวาดตารางใหม่ทั้งใบตอน change — change ยิงตอนกด Tab ซึ่งโฟกัสย้ายไปช่องถัดไปแล้ว
 *     ถ้าวาดใหม่ ช่องที่เพิ่งได้โฟกัสจะถูกทิ้ง พนักงานต้องคลิกทีละช่องทั้งวัน (INVARIANTS G2)
 *     จึงอัปเดตเฉพาะตัวเลขที่เปลี่ยนจริงของกลุ่มนั้น */
function bindDnInputs(){
  const num = (el, cb) => el.addEventListener('change', function(){
    const v = Number(this.value);
    if(this.value !== '' && (isNaN(v) || v < 0)){ toast('กรุณากรอกตัวเลขที่ถูกต้อง (>= 0)'); this.value=''; return; }
    cb.call(this, this.value === '' ? 0 : v);
    refreshDnGroup(this.dataset.pn);
    renderSyncBadge();
  });

  document.querySelectorAll('#dnTable .dn-pack').forEach(el=>{
    if(el.dataset.f === 'remark'){
      el.addEventListener('change', function(){
        savePacking(dnDate(), dnUnit(), this.dataset.pn, {remark: this.value.trim()});
        renderSyncBadge();
      });
      return;
    }
    num(el, function(v){
      savePacking(dnDate(), dnUnit(), this.dataset.pn, {[this.dataset.f]: v});
    });
  });
  document.querySelectorAll('#dnTable .dn-alloc').forEach(el=>{
    num(el, function(v){ saveAllocation(this.dataset.order, dnDate(), v); });
  });
  bindDnRecalc(document);

  document.querySelectorAll('#dnTable .dn-include').forEach(el=>{
    el.addEventListener('change', function(){
      if(this.checked) dnExtraRows.add(this.dataset.order);
      else dnExtraRows.delete(this.dataset.order);
      renderDnSummary();
    });
  });
  document.querySelectorAll('#dnTable .dn-dw-edit').forEach(el=>{
    el.addEventListener('click', function(){ editDeltaWip(this.dataset.dw); });
  });
}

/** ทางกลับออกจากโหมดแก้กล่องเอง — ต้องมีเสมอ ไม่งั้นคนติดอยู่กับเลขที่ตัวเองแก้ไว้
 *  ปุ่มนี้ถูกวาดใหม่ทุกครั้งที่สถานะกลุ่มเปลี่ยน จึงต้องผูกใหม่ทุกครั้งด้วย */
function bindDnRecalc(root){
  root.querySelectorAll('.dn-recalc').forEach(el=>{
    el.addEventListener('click', function(){
      resetPacking(dnDate(), dnUnit(), this.dataset.pn);
      renderDeliveryNote();
    });
  });
}

/** อัปเดตเฉพาะตัวเลขของกลุ่มที่เพิ่งแก้ ไม่แตะโฟกัส */
function refreshDnGroup(pn){
  const groups = deliveryGroups(dnDate(), dnUnit());
  const g = groups.find(x => samePn(x.pn, pn));
  if(g){
    const pcs = document.querySelector(`#dnTable td[data-pcs="${CSS.escape(pn)}"]`);
    if(pcs) pcs.innerHTML = `<b>${g.qty? numFmt(g.qty) : '—'}</b>`;
    const left = document.querySelector(`#dnTable td[data-left="${CSS.escape(pn)}"]`);
    if(left){ left.innerHTML = dnLeftCell(g); bindDnRecalc(left); }

    // ⚠️ ช่องเตือนท้ายแถวต้องอัปเดตด้วย ไม่งั้นคำเตือน "เกิน" จะไม่มีวันโผล่ตอนคีย์
    //    เพราะแถวไม่ได้ถูกวาดใหม่ทั้งใบ (จงใจ เพื่อไม่ให้โฟกัสหลุด — G2)
    g.orders.forEach(({o, alloc, deltaWip, onlyDelta, wipBefore})=>{
      const td = document.querySelector(`#dnTable td[data-note="${CSS.escape(o.id)}"]`);
      if(td) td.innerHTML = dnRowNote(wipBefore, alloc, deltaWip, onlyDelta);

      // ช่องติ๊กต้องสะท้อนสถานะใหม่ด้วย — คีย์จำนวนแล้วแถวนั้นขึ้นกระดาษอยู่แล้ว
      // ถ้าไม่อัปเดต ช่องจะยังว่างทั้งที่แถวจะถูกพิมพ์ ซึ่งอ่านแล้วเข้าใจผิด
      const inc = document.querySelector(`#dnTable td[data-include="${CSS.escape(o.id)}"]`);
      if(inc && inc.querySelector('input') !== document.activeElement){
        inc.innerHTML = dnIncludeCell(o.id, alloc);
        inc.querySelectorAll('.dn-include').forEach(el=> el.addEventListener('change', function(){
          if(this.checked) dnExtraRows.add(this.dataset.order);
          else dnExtraRows.delete(this.dataset.order);
          renderDnSummary();
        }));
      }
    });

    // กล่องกับเศษถูกคิดใหม่ให้ ต้องอัปเดตช่องตามไปด้วย
    // อัปเดตแม้ช่องนั้นกำลังโฟกัสอยู่ — คนเพิ่งกด Tab เข้ามา ยังไม่ได้พิมพ์อะไร
    // และต้องเห็นเลขที่โปรแกรมคิดให้ทันที ไม่ใช่ช่องว่างที่ดูเหมือนโปรแกรมไม่ทำงาน
    // เหตุการณ์ change ยิงตอนออกจากช่องเท่านั้น จึงไม่มีทางทับเลขที่กำลังพิมพ์ค้างอยู่
    ['boxes','remainder'].forEach(f=>{
      const inp = document.querySelector(`#dnTable input.dn-pack[data-pn="${CSS.escape(pn)}"][data-f="${f}"]`);
      if(inp) inp.value = g.qty ? String(g[f]) : '';
    });
  }
  renderDnSummary();
  // ⚠️ ต้องวาด log ใหม่ด้วย — แก้ยอดบรรจุหลังออกใบไปแล้ว ป้าย "ข้อมูลเปลี่ยนหลังออกใบ" ต้องโผล่ทันที
  //    ไม่ใช่รอจนกว่าจะวาดทั้งหน้า ไม่งั้นคนกดออกไฟล์ซ้ำโดยไม่รู้ว่ามันจะไม่ตรงกับกระดาษที่ส่งไปแล้ว
  renderDnLog();
}

/* ---------- ออกไฟล์ใบส่งสินค้า FM-ST-07 ---------- */

/* ฟอร์ม FM-ST-07 ที่เจ้าของเลือกมา — เก็บ **ไบต์ดิบ** ไม่ใช่ object ของ JSZip
 *
 * ⚠️ ห้ามเก็บ zip ที่โหลดแล้วไว้ใช้ซ้ำ · fillDeliveryForm() เขียนกลับเข้า zip ที่ได้รับ
 *    ถ้าเป็นตัวเดียวกันทุกครั้ง ชีตที่เขียนไว้รอบก่อนจะค้างอยู่แล้วติดไปในไฟล์รอบถัดไป
 *    ออกใบ TUE-U แล้วออก TUE-H ต่อ ไฟล์ของ TUE-H จะพกใบของ TUE-U ไปด้วย
 *    (ผู้ตรวจ #103 รันพบ · ชีตที่จะปริ้นถูกต้องเสมอ แต่ไฟล์พกข้อมูลของอีกนิติบุคคลไป)
 *
 *    plan ลอกวิธีของ bincard v2 ที่สร้างไฟล์ใหม่จากศูนย์ไม่ได้ — ExcelJS เขียนไฟล์ใหม่ทั้งไฟล์
 *    แล้ว xl/drawings/ หายจนโลโก้บริษัทไม่ขึ้น · ทางที่เหลือคือโหลดใหม่จากไบต์ดิบทุกครั้ง */
let dnTemplate = null;   // {buf, sheetMap, fileName, savedAt}

/** รับไบต์ของฟอร์มเข้ามาเป็นเทมเพลตที่ใช้งานอยู่
 *  ใช้ร่วมกันระหว่าง "เลือกไฟล์" กับ "กู้คืนของที่จำไว้" — ต้องเป็นเส้นทางเดียวกัน
 *  ไม่งั้นฟอร์มที่กู้คืนมาอาจผ่านด่านคนละชุดกับฟอร์มที่เพิ่งเลือก
 *
 *  ⚠️ ไม่เก็บ sheetMap ลงฐานข้อมูล — คิดใหม่จากไบต์ทุกครั้ง
 *     กติกาเดียวกับกล่อง/เศษ: ห้ามเก็บของที่คิดได้ ไม่งั้นมันค้างไม่ตรงกับไฟล์จริง */
async function useDnTemplate(buf, fileName, savedAt, fromMemory){
  const zip = await JSZip.loadAsync(buf);
  if(!zip.file('xl/workbook.xml')) throw new Error('ไม่ใช่ไฟล์ Excel (.xlsx)');
  const sheetMap = await sheetPathMap(zip);
  /* เลข WK เป็นสัปดาห์การผลิตของโรงงาน ไม่ตรงกับสัปดาห์ ISO ที่คำนวณเองได้
   * จึงอ่านจากฟอร์มที่เจ้าของ "เพิ่งเลือก" มาเป็นค่าตั้งต้น แล้วให้แก้บนหน้าจอได้
   *
   * ⚠️ **ห้ามเติมจากฟอร์มที่จำไว้** — เจตนาเดิมคือ "ไฟล์ที่เพิ่งหยิบมาคือฟอร์มของสัปดาห์นี้"
   *    ซึ่งไม่จริงกับไฟล์ที่ค้างอยู่ในเครื่องมาหลายสัปดาห์ · ถ้าเติมให้ทุกครั้งที่เปิดโปรแกรม
   *    ด่าน "กรอกเลขสัปดาห์ (WK) ก่อนครับ" จะไม่มีโอกาสทำงานอีกเลย แล้ว WK ของสัปดาห์เก่า
   *    จะไหลลงกระดาษที่ส่ง Delta เองโดยไม่มีใครพิมพ์ (ผู้ตรวจ #112 รันเจอ) */
  if(!fromMemory){
    const wk = await weekFromTemplate(zip, sheetMap);
    if(wk && !dnWeek()) document.getElementById('dnWeek').value = wk;
  }
  /* ⚠️ **ตั้ง `dnTemplate` เป็นบรรทัดท้ายสุด** หลังงานที่โยนได้ทั้งหมด
   *    ไฟล์ .xlsx ที่ผ่านด่าน xl/workbook.xml แต่พังทีหลัง (ขาด rels · โดนตัดครึ่ง)
   *    เคยทิ้ง dnTemplate ที่ใช้ไม่ได้ไว้ก่อนโยน · แล้วด่านกันแข่งจังหวะใน
   *    restoreDnTemplate() (`if(dnTemplate) return;`) เห็นว่ามีของอยู่แล้วเลยไม่กู้ของดีกลับมา
   *
   *    ผลคือเลือกไฟล์เสียมาทับครั้งเดียว แล้วออกใบไม่ได้ทั้งปุ่มหลักและลิงก์ออกไฟล์ซ้ำ
   *    จนกว่าจะรีเฟรช — ลิงก์ใน log เช็กแค่ `if(!dnTemplate)` ซึ่งไม่ null แต่เป็นของพัง
   *    จึงหลุดด่านไปตายข้างในแล้วได้ข้อความอังกฤษ (ผู้ตรวจ #112 รันเจอ)
   *
   *    ตั้งท้ายสุดแล้ว ด่านกันแข่งจังหวะยังทำงานเหมือนเดิม เพราะการเลือกไฟล์ที่สำเร็จ
   *    ยังตั้งค่าให้ก่อนที่ restoreDnTemplate() จะอ่านฐานข้อมูลเสร็จอยู่ดี */
  dnTemplate = {buf, sheetMap, fileName, savedAt: savedAt || null};
  document.getElementById('btnDnExport').disabled = false;
  /* ⚠️ ไม่วาดกล่องที่นี่ — ตอนนี้ `savedAt` ยังว่างเสมอบนเส้นทางเลือกไฟล์
   *    วาดเลยจะขึ้น "เครื่องนี้จำไว้ให้ไม่ได้" แวบหนึ่งทุกครั้ง ซึ่งเห็นได้จริงถ้าฟอร์มใหญ่
   *    ให้ผู้เรียกวาดหลังรู้ผลการจำแล้ว (ผู้ตรวจ #112 ทัก) */
}

/** บอกบนจอว่าเครื่องนี้จำฟอร์มไหนไว้ และจำไว้เมื่อไหร่
 *  ⚠️ ห้ามจำเงียบ ๆ — บริษัทแก้ฟอร์มเมื่อไหร่ เครื่องที่ยังใช้ของเก่าจะออกใบด้วยผังเก่า
 *     โดยไม่มีอะไรฟ้องเลย · ชื่อไฟล์กับวันที่คือสิ่งเดียวที่ทำให้คนสังเกตได้
 *
 *  ⚠️ และห้ามบอกว่า "จำแล้ว" ตอนที่จำไม่สำเร็จ — `savedAt` ต้องมาจากการเขียนลงฐานข้อมูล
 *     ที่สำเร็จจริงเท่านั้น ไม่ใช่จากเวลาที่กดเลือกไฟล์ · เครื่องที่เปิด IndexedDB ไม่ได้ (E3)
 *     หรือพื้นที่เต็ม ต้องรู้ว่าตัวเองต้องเลือกไฟล์ใหม่ทุกครั้ง ไม่ใช่เชื่อว่าจำให้แล้ว
 *     (ผู้ตรวจ #112 รันเจอ — ของเดิมกลับด้านกับเจตนาของใบนี้เอง) */
function renderDnTplInfo(){
  const box = document.getElementById('dnTplInfo');
  const txt = document.getElementById('dnTplInfoText');
  box.hidden = !dnTemplate;
  if(box.hidden) return;
  txt.textContent = dnTemplate.savedAt
    ? `จำฟอร์มไว้แล้ว: ${dnTemplate.fileName} (เลือกเมื่อ ${fmtDateTimeTH(dnTemplate.savedAt)})`
      + ' — ไม่ต้องเลือกไฟล์ใหม่ทุกครั้ง · ถ้าบริษัทแก้ฟอร์ม ให้เลือกไฟล์ใหม่ทับ'
    : `ใช้ฟอร์ม ${dnTemplate.fileName} ได้ในรอบนี้ แต่เครื่องนี้จำไว้ให้ไม่ได้`
      + ' — เปิดโปรแกรมใหม่ครั้งหน้าต้องเลือกไฟล์ฟอร์มอีกครั้ง';
  document.getElementById('btnDnTplForget').hidden = !dnTemplate.savedAt;
}

/** วันเวลาตามนาฬิกาเครื่อง — ห้ามตัดสิบตัวแรกของ ISO มาใช้ นั่นเป็นวันแบบ UTC (C1)
 *  เลือกไฟล์ตอนเช้าก่อนเจ็ดโมงจะโชว์วันก่อนหน้าหนึ่งวัน (ผู้ตรวจ #112 ทัก) */
function fmtDateTimeTH(iso){
  const d = new Date(iso);
  return isNaN(d) ? String(iso||'') : d.toLocaleString('th-TH');
}

/** จำไว้ในเครื่องนี้ — ล้มเหลวได้โดยไม่พังอะไร เทมเพลตยังใช้ได้ในรอบนี้อยู่ดี
 *  ⚠️ ไม่มี IndexedDB = ไม่จำ · ห้ามยัด ArrayBuffer ลง localStorage เด็ดขาด
 *     มันเก็บได้แต่ข้อความ ต้องแปลงเป็น base64 ซึ่งโตขึ้นหนึ่งในสามและชนเพดานทันที */
async function rememberDnTemplate(){
  if(!dnTemplate) return false;
  // เครื่องที่เปิด IndexedDB ไม่ได้ยังใช้ localStorage อยู่ (E3) — จำฟอร์มให้ไม่ได้ และต้องบอก ไม่ใช่เงียบ
  if(!stateDb) return false;
  try{
    const savedAt = new Date().toISOString();
    await idbTx('readwrite', st => st.put(
      {buf: dnTemplate.buf, fileName: dnTemplate.fileName, savedAt}, DN_TPL_KEY));
    dnTemplate.savedAt = savedAt;   // ตั้งหลังเขียนสำเร็จเท่านั้น — กล่องบนจออ่านค่านี้
    return true;
  }catch(err){
    /* ⚠️ **จำของใหม่ไม่ได้ ก็ต้องไม่เหลือของเก่าไว้ให้กู้**
     *    ไม่งั้นแถวของฟอร์มเก่ายังอยู่ แล้วรอบถัดไปโปรแกรมกู้ "ฟอร์มเก่า" ขึ้นมาให้ออกใบได้ทันที
     *    ทั้งที่เพิ่งบอกผู้ใช้ไปว่าครั้งหน้าต้องเลือกไฟล์ใหม่ — เขาจะไม่พกไฟล์มา
     *    แล้วกระดาษออกจากผังฟอร์มเก่า ซึ่งคือความเสี่ยงที่ใบนี้ตั้งใจกันทั้งใบ
     *    (ผู้ตรวจ #112 รันเจอ) · การลบยังช่วยคืนพื้นที่ให้ด้วย ซึ่งมักเป็นสาเหตุที่เขียนไม่สำเร็จ */
    try{ await idbTx('readwrite', st => st.delete(DN_TPL_KEY)); }catch(e){}
    return false;
  }
}

/** กู้ฟอร์มที่จำไว้ตอนเปิดโปรแกรม
 *  ⚠️ ห้ามให้ตัวนี้ถ่วงหรือทำให้การเปิดหน้าพัง — ฟอร์มเสียต้องแค่ "ไม่มีฟอร์ม" ไม่ใช่เปิดโปรแกรมไม่ได้
 *     (กฎเดียวกับ #100 ที่วาดจอพังแล้วห้ามทำทั้งหน้าค้างจาง) */
async function restoreDnTemplate(){
  let saved = null;
  try{
    if(stateDb) saved = await idbTx('readonly', st => st.get(DN_TPL_KEY));
  }catch(err){ saved = null; }   // อ่านพลาดชั่วคราว — ห้ามลบของที่จำไว้ทิ้ง
  try{
    /* ⚠️ restoreDnTemplate() ถูกเรียกแบบไม่ await ตอนเปิดหน้า — ถ้ามีคนเลือกไฟล์แทรกเข้ามา
     *    ระหว่างที่กำลังอ่านฐานข้อมูล **ของใหม่ต้องชนะ** ห้ามเอาฟอร์มเก่าทับ
     *    ไม่งั้นคนเลือกไฟล์ใหม่แล้วออกใบด้วยฟอร์มเก่าโดยไม่รู้ตัว ซึ่งเป็นบั๊กชนิดเดียว
     *    กับที่ใบนี้ตั้งใจกัน (ผู้ตรวจ #112 จดว่าเป็นมุมที่ยังไม่ได้ดู) */
    if(dnTemplate) return;
    /* แถวที่เขียนค้างครึ่ง ๆ (ไม่มี buf) กู้ไม่ได้ — ล้างทิ้ง
     * ⚠️ ต้องอยู่ **หลัง** ด่านข้างบน · เคยวางไว้ก่อนแล้วผู้ตรวจ #112 ทักว่าได้การแข่งจังหวะอีกทิศ
     *    คือถ้ามีคนเลือกไฟล์แล้วจำสำเร็จพอดีในช่วงนั้น แถวใหม่จะถูกลบ
     *    ระหว่าง "ลบแถวใหม่ของคนอื่น" กับ "แถวเสียค้างอยู่เฉย ๆ" อย่างหลังปลอดภัยกว่าชัดเจน */
    if(saved && !saved.buf){ try{ await idbTx('readwrite', st => st.delete(DN_TPL_KEY)); }catch(e){} }
    if(saved && saved.buf) await useDnTemplate(saved.buf, saved.fileName, saved.savedAt, true);
    renderDnTplInfo();
  }catch(err){
    /* ถึงตรงนี้แปลว่าไบต์ที่เก็บไว้เปิดเป็นไฟล์ Excel ไม่ได้จริง — เก็บไว้ก็ไม่มีประโยชน์ */
    dnTemplate = null;
    try{ await idbTx('readwrite', st => st.delete(DN_TPL_KEY)); }catch(e){}
    renderDnTplInfo();
    toast('ฟอร์มที่จำไว้เปิดไม่ได้ — กรุณาเลือกไฟล์ฟอร์มใหม่');
  }finally{
    document.documentElement.dataset.dnTplReady = '1';   // ป้ายให้เทสรู้ว่าลองกู้คืนจบแล้ว (ได้หรือไม่ได้ก็ตาม)
  }
}

document.getElementById('dnTemplateInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  dnTemplate = null;
  document.getElementById('btnDnExport').disabled = true;
  renderDnTplInfo();
  /* ⚠️ **ทุกทางออก**ของตัวจับนี้ต้องกู้ฟอร์มที่จำไว้กลับมา ไม่ใช่เฉพาะทางที่แกะ zip ไม่ผ่าน
   *    เลือก .xls มาทับ หรือกดยกเลิกหน้าต่างเลือกไฟล์ ก็ไม่ควรทำให้ของที่จำไว้หายไปจากจอ
   *    ทั้งที่ยังอยู่ในฐานข้อมูล แล้วต้องให้คนไปรีเฟรชเอง (ผู้ตรวจ #112 รันเจอ สองรอบติด) */
  if(!file || rejectLegacyXls(file)){ await restoreDnTemplate(); return; }
  toast('กำลังอ่านไฟล์...');
  try{
    await useDnTemplate(await file.arrayBuffer(), file.name, null, false);
  }catch(err){
    toast('เปิดไฟล์ไม่สำเร็จ: '+err.message);
    /* ⚠️ เลือกไฟล์เสียมาทับ ไม่ควรทำให้ฟอร์มที่จำไว้หายไปจากหน้าจอด้วย
     *    ของที่จำไว้ยังอยู่ในฐานข้อมูล แค่หลุดจากหน่วยความจำ — ดึงกลับมาเลย
     *    ไม่ใช่ให้คนไปรีเฟรชเอง (ผู้ตรวจ #112 ทัก) */
    await restoreDnTemplate();
    return;
  }
  const kept = await rememberDnTemplate();
  renderDnTplInfo();
  toast(kept ? 'อ่านเทมเพลตแล้ว และจำไว้ให้ — ครั้งหน้าไม่ต้องเลือกไฟล์อีก'
             : 'อ่านเทมเพลตแล้ว — แต่เครื่องนี้จำไว้ให้ไม่ได้ ครั้งหน้าต้องเลือกไฟล์อีกครั้ง');
});

document.getElementById('btnDnTplForget').addEventListener('click', async ()=>{
  // ไม่ใช้ตัวขึ้นบรรทัดใหม่ตรง ๆ — กติกาเดียวกับที่อื่นในไฟล์ เคยถูกกลืนจนสตริงไม่ปิดมาแล้ว
  if(!confirm('ล้างฟอร์มที่จำไว้ในเครื่องนี้?'
    + String.fromCharCode(10) + String.fromCharCode(10)
    + 'ครั้งหน้าที่เปิดโปรแกรมต้องเลือกไฟล์ฟอร์มใหม่')) return;
  try{ if(stateDb) await idbTx('readwrite', st => st.delete(DN_TPL_KEY)); }catch(e){}
  dnTemplate = null;
  document.getElementById('btnDnExport').disabled = true;
  document.getElementById('dnTemplateInput').value = '';
  renderDnTplInfo();
  toast('ล้างฟอร์มที่จำไว้แล้ว');
});

/** เลขที่ใบส่งสินค้า — คิดจากหน่วย+วัน ไม่ใช่เลขรัน (เจ้าของเลือก 10 ต.ค. 2026)
 *
 *  ⚠️ เลขรันที่นับจากข้อมูลในเครื่องตัวเอง **ชนกันได้** เมื่อสองเครื่องออกใบตอนยังไม่ได้ซิงค์
 *     แล้วกระดาษถึงมือลูกค้าไปก่อนที่ใครจะรู้ ซึ่งแก้ย้อนหลังไม่ได้
 *     แบบนี้ทุกเครื่องคำนวณได้เลขเดียวกันเสมอโดยไม่ต้องคุยกัน และออฟไลน์ได้เต็มที่ (F2)
 *
 *  TUE-U + 2026-10-11 → TUEU-261011 · ออกใบหน่วย+วันเดิมซ้ำจึงได้เลขเดิม ซึ่งตั้งใจ
 *  เพราะในความจริงคือใบเดิมที่พิมพ์ใหม่ ไม่ใช่ใบใหม่ — กุญแจของแถว log คือ id ไม่ใช่ no */
function deliveryNoteNo(unit, date){
  const u = String(unit||'').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const d = String(date||'').split('-');
  return d.length===3 ? `${u}-${d[0].slice(2)}${d[1]}${d[2]}` : u;
}

/** ชื่อชีตของหน่วยนี้ในไฟล์ฟอร์ม — ชื่อจริงในไฟล์มีช่องว่างท้ายบ้าง จึงเทียบแบบตัดช่องว่าง */
function dnSheetNameFor(unit){
  return Object.keys(dnTemplate.sheetMap)
    .find(n => n.trim().replace(/\s+/g,' ').toUpperCase().endsWith(unit.toUpperCase()));
}

/** สร้างไฟล์ใบส่งสินค้าแล้วดาวน์โหลด — ใช้ร่วมกันระหว่างปุ่มออกใบกับลิงก์ออกไฟล์ซ้ำ
 *
 *  ⚠️ ไม่เก็บไฟล์ไว้ที่ไหนเลย สร้างใหม่จากยอดบรรจุทุกครั้ง (วิธีเดียวกับ fbReissue ของ repo store)
 *     จึงต้องมีไฟล์ฟอร์มอยู่ในมือเสมอ — plan แก้ไฟล์ของผู้ใช้ด้วย JSZip ไม่ได้เขียนฟอร์มขึ้นใหม่
 *     เหมือน store เพราะ ExcelJS ตัด xl/drawings/ ทิ้งจนโลโก้บริษัทหายจากกระดาษ */
async function writeDeliveryFile(unit, date, week, groups, sheetName){
  /* ⚠️ ด่านกล่อง/เศษอยู่ที่นี่ ไม่ใช่ที่ปุ่ม — ทุกทางที่ออกไฟล์ต้องผ่านด่านเดียวกัน
   *    ของเดิมด่านอยู่ในตัวจับคลิกของปุ่มอย่างเดียว พอมีทางที่สอง (ลิงก์ออกไฟล์ซ้ำ)
   *    ทางนั้นข้ามด่านไปเลย แล้วกระดาษที่ส่งลูกค้าจะแจ้งจำนวนคนละตัวกับของที่ส่งจริง
   *    (ผู้ตรวจ #103 รันพิสูจน์แล้วว่าออกไฟล์ซ้ำข้ามด่านได้จริง) */
  const bad = groups.filter(g => g.packQty !== g.qty);
  if(bad.length){
    throw new Error(`กล่องกับเศษไม่ตรงกับยอดที่คีย์ ${bad.length} กลุ่ม — `
      + bad.map(g=>`P/N ${g.pn} กระดาษจะพิมพ์ ${numFmt(g.packQty)} แต่คีย์ไว้ ${numFmt(g.qty)}`).join(' · '));
  }
  const sheet = sheetName || dnSheetNameFor(unit);
  if(!sheet) throw new Error(`ไม่พบชีตของหน่วย ${unit} ในฟอร์มนี้ — มีชีต: ${Object.keys(dnTemplate.sheetMap).join(', ')}`);
  /* โหลด zip ใหม่จากไบต์ดิบทุกครั้ง — ดูเหตุผลที่คอมเมนต์ของ dnTemplate
   * ค่าใช้จ่ายต่ำ loadAsync อ่านแค่สารบัญของ zip ส่วนการแตะ XML ของชีตเกิดต่อครั้งอยู่แล้ว */
  const zip = await JSZip.loadAsync(dnTemplate.buf);
  const blob = await fillDeliveryForm(zip, dnTemplate.sheetMap[sheet], unit, date, groups, week);
  downloadBlob(blob, `${deliveryNoteNo(unit, date)}.xlsx`,
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/** เขียนแถว log ว่ามีการออกใบ — เรียกหลังไฟล์ออกสำเร็จเท่านั้น
 *  ออกใบซ้ำได้แถวใหม่เสมอ ไม่ทับของเดิม เพราะ log คือบันทึกว่า "เกิดอะไรขึ้นกี่ครั้ง" */
function logDeliveryIssue(unit, date, week, groups){
  const now = new Date().toISOString();
  state.deliveryLog.push({
    id: uid(), no: deliveryNoteNo(unit, date), date, unit, week: String(week||''),
    groups: groups.length,
    lines: groups.reduce((s,g)=> s + shippedOrders(g).length, 0),
    qty: groups.reduce((s,g)=> s + (Number(g.qty)||0), 0),
    deviceName: state.deviceName, createdAt: now, updatedAt: now, voided: false, _dirty: true
  });
  saveState();
  doSync();
  renderDnLog();
}

/** กลุ่มที่จะลงกระดาษตอน "ออกไฟล์ซ้ำ" — เอาเฉพาะใบที่มียอดตัดจริง
 *
 *  ⚠️ ห้ามใช้ shippedOrders() ตรง ๆ ที่นี่ · มันอ่าน dnExtraRows ซึ่งเป็นช่องติ๊กของ
 *     "วันและหน่วยที่เลือกอยู่บนจอตอนนี้" (ล้างเมื่อเปลี่ยนวัน) ส่วนการออกไฟล์ซ้ำทำงานกับ
 *     วันของแถว log ซึ่งมักไม่ใช่วันเดียวกัน — แถวที่ติ๊กไว้ของวันอื่นจะไหลลงกระดาษเงียบ ๆ
 *     (ผู้ตรวจ #103 รันพิสูจน์แล้วว่าเกิดจริง)
 *  ตัด orders ทิ้งตั้งแต่ตรงนี้ ไม่ใช่แค่กรองกลุ่ม เพราะ fillDeliveryForm เรียก shippedOrders() เองอีกชั้น */
function dnReissueGroups(date, unit){
  return deliveryGroups(date, unit)
    .map(g => Object.assign({}, g, {orders: g.orders.filter(x => x.alloc > 0)}))
    .filter(g => g.orders.length > 0);
}

/** ยอดที่จะลงกระดาษตอนนี้ ต่างจากตอนที่ออกใบไปแล้วหรือเปล่า
 *  ถ้าต่าง ไฟล์ที่ออกซ้ำจะไม่ตรงกับกระดาษใบเดิมที่ส่งลูกค้าไปแล้ว — ต้องบอกก่อน ไม่ใช่ให้ไปเจอเอง
 *
 *  ⚠️ เทียบ "เนื้อข้อมูล" ไม่ใช่ "เวลา" · ของเดิมเทียบ updatedAt ของบรรทัดกับ createdAt ของแถว log
 *     ซึ่งเป็นเวลาคนละเรือนนาฬิกา — doSync() เขียน updatedAt ทับด้วย serverTime หลัง push (D4)
 *     แต่ createdAt ของ log เป็นนาฬิกาเครื่อง · ป้ายจึงโผล่เองหลังซิงค์ทั้งที่ไม่มีใครแก้อะไร
 *     และกลับกัน ถ้านาฬิกาเครื่องล้ำกว่าเซิร์ฟเวอร์ ของที่ถูกแก้จริงจะไม่ขึ้นป้าย
 *     นี่คืออาการที่ D4 เตือนไว้ตรง ๆ (ผู้ตรวจ #103 รันพิสูจน์ทั้งสองทาง)
 *
 *  เทียบด้วย qty รวมอย่างเดียว เพราะเป็นตัวเดียวที่ไม่ขึ้นกับช่องติ๊ก dnExtraRows
 *  (ใบที่ติ๊กให้โผล่มี alloc = 0 จึงบวกยอดเป็นศูนย์) และเป็นเลขที่ผิดแล้วลูกค้าเสียหายจริง */
function dnLogStale(entry){
  if(entry.qty == null) return false;
  const now = dnReissueGroups(entry.date, entry.unit)
    .reduce((s,g)=> s + (Number(g.qty)||0), 0);
  return now !== (Number(entry.qty)||0);
}

/** รายละเอียดของใบที่ออกไปแล้ว อ่านได้บนจอ **โดยไม่ต้องมีไฟล์ฟอร์ม FM-ST-07**
 *  (เจ้าของสั่ง 25 ต.ค. 2026 — คนที่ไม่มีฟอร์มในมือก็ต้องตามได้ว่าใบนั้นส่งอะไรไป)
 *
 *  ⚠️ สิ่งที่หน้านี้แสดงคือข้อมูลของใบนั้น **ณ วันนี้ ไม่ใช่สำเนาของกระดาษที่ส่งไปแล้ว**
 *     ระบบไม่เก็บไฟล์และไม่เก็บเนื้อของกระดาษไว้เลย ทุกช่องคิดใหม่จากยอดบรรจุของหน่วย
 *     และวันนั้นทุกครั้ง (เหตุผลเดียวกับ writeDeliveryFile) · หน้านี้ต้องพูดเรื่องนี้ออกมาตรง ๆ
 *     เพราะคนที่เปิดดูคือคนที่ไม่มีฟอร์ม จึงเทียบกับไฟล์เองไม่ได้ และจะไม่รู้เลยว่า
 *     เลขที่เห็นอาจไม่ใช่เลขบนกระดาษ — ที่เปลี่ยนเองเงียบที่สุดคือ Wip bal. ของ Delta
 *
 *  ⚠️ ต้องผ่าน dnReissueGroups() เท่านั้น ห้ามเรียก deliveryGroups() ตรง ๆ ที่นี่
 *     เหตุผลอยู่ที่คอมเมนต์ของ dnReissueGroups — ช่องติ๊ก dnExtraRows เป็นของวันที่เลือก
 *     อยู่บนจอ ไม่ใช่วันของแถว log · ใบที่ติ๊กไว้ของวันอื่นจะไหลมาโชว์บนใบนี้เงียบ ๆ
 *     (ตระกูลเดียวกับที่ผู้ตรวจ #103 รันเจอบนเส้นทางออกไฟล์ซ้ำ)
 *
 *  ช่องที่โชว์เรียงตามกระดาษ (ดู fillDeliveryForm) — ราย PO: P/N · PO No. · Order Date ·
 *  PO QTY · Wip bal. · ยอดส่งงาน · ของทั้งกลุ่ม: ต่อกล่อง · กล่อง · เศษ · จำนวน/PCS · Remark
 *  ⚠️ ป้ายหัวคอลัมน์ทุกช่องต้องเป็นคำที่ **มีใช้อยู่จริงบนกระดาษ (`DN_HEAD`) หรือบนตาราง
 *     `#dnTable`** ที่พนักงานคีย์ทุกวัน · สองที่นั้นใช้คำไม่เหมือนกันทุกช่อง (กระดาษ `ยอดส่งงาน`
 *     จอ `จำนวนที่ส่ง` · กระดาษ `จำนวนต่อกล่อง` จอ `ต่อกล่อง`) จึงไม่มีชุดคำที่ "ตรงทั้งคู่"
 *     ที่ห้ามคือคำที่ไม่มีใครในสายใบส่งสินค้าใช้ — เช่น `Order Q'ty` ซึ่งเป็นป้ายของ
 *     **ไฟล์แผนงานฝั่งลูกค้า** (`PLAN_HEAD`) คนละเอกสารกัน (ผู้ตรวจ #113 ทักทั้งสองรอบ)
 *     เทสบังคับกฎนี้ด้วยการอ่าน `DN_HEAD` กับหัวตาราง `#dnTable` มาเทียบ ไม่ใช่รายการที่พิมพ์ไว้เอง
 *
 *  ⚠️ **ทุกค่าที่ลง `innerHTML` ต้องผ่าน `escapeHtml()` รวมวันที่** (G3)
 *     `fmtDateTH()` ไม่ใช่ตัวทำให้ปลอดภัย — `normalizeDateOnly()` คืนค่าเดิมให้สตริงที่ไม่ใช่รูปวันที่
 *     ค่าเพี้ยนจากชีต `DeliveryLog` หรือจากไฟล์นำเข้าจึงไหลผ่าน `prepareState()` กับการ pull
 *     มาถึง `innerHTML` ได้ครบ · ผู้ตรวจ #113 รันพิสูจน์แล้วว่าโค้ดเดิมของใบนี้รัน `onerror` ได้จริง
 *     ใบนี้เป็นที่แรกที่วาด `deliveryLog.date` ลงจอ จึงเป็นรูที่ใบนี้สร้างเอง ไม่ใช่ของเดิม */
function dnPreviewHtml(entry){
  const groups = dnReissueGroups(entry.date, entry.unit);
  const head = `<div class="desc">
      หน่วย <b>${escapeHtml(entry.unit)}</b> · วันที่ <b>${escapeHtml(fmtDateTH(entry.date))}</b>
      · WK บนใบ <b>${escapeHtml(String(entry.week||'') || '—')}</b><br>
      ออกเมื่อ ${escapeHtml(entry.createdAt ? new Date(entry.createdAt).toLocaleString('th-TH') : '—')}
      จากเครื่อง ${escapeHtml(entry.deviceName||'—')}</div>`;

  /* ⚠️ "ณ ตอนที่กดเปิด" ไม่ใช่ "ณ วันนี้" — กล่องนี้เป็นภาพนิ่ง ไม่มีกลไกวาดใหม่
   *    แก้ยอดหรือซิงค์เข้ามาขณะกล่องเปิดอยู่ ตัวเลขในกล่องไม่ขยับ (ผู้ตรวจ #113 รอบ 6 รันแล้ว)
   *    ถ้าวันหนึ่งทำให้มันวาดใหม่ได้ ให้แก้คำนี้ด้วย ไม่ใช่ปล่อยให้คำกับพฤติกรรมคลาดกัน */
  const why = `<div class="desc">⚠️ <b>นี่คือข้อมูลของใบนี้ ณ ตอนที่กดเปิด ไม่ใช่สำเนาของกระดาษที่ส่งไปแล้ว</b>
      — ระบบไม่ได้เก็บไฟล์หรือเนื้อของกระดาษไว้ แต่คิดใหม่จากยอดบรรจุของหน่วยและวันนั้นทุกครั้ง
      ถ้ามีอะไรเปลี่ยนไปหลังออกใบ ตัวเลขที่เห็นจะไม่เท่ากับกระดาษ โดยเฉพาะ <b>Wip bal.</b>
      ซึ่งเป็นยอดของ <b>งวดล่าสุดที่นำเข้าไว้ ไม่ใช่ของ WK ที่เขียนบนใบ</b>
      จึงเปลี่ยนเองทุกครั้งที่นำเข้าไฟล์ Call In งวดใหม่</div>`;

  /* ⚠️ สภาพ "กลุ่มว่าง" มีได้สี่สาเหตุ และหน้านี้แยกจากกันไม่ได้ จึงต้องบอกครบทั้งสี่
   *    ห้ามเขียนชี้แค่บางสาเหตุเหมือนรู้คำตอบ (ผู้ตรวจ #113 ทักสองรอบ รอบละสาเหตุ)
   *    สาเหตุที่สามเกิดจาก `doSync()` ดึง `DeliveryLog` **ก่อน** `Orders`/`Records`
   *    และบล็อกนั้นมี try/catch ของตัวเอง ส่วน Orders/Records ไม่มี — เน็ตหลุดหลังดึง log
   *    ทั้งรอบจึงหลุดไป catch ชั้นนอกโดยที่แถว log เข้ามาอยู่ในหน่วยความจำแล้ว
   *    และหน้านี้ทำมาเพื่อคนที่นั่งเครื่องอื่น ซึ่งคือเครื่องที่เจอสภาพนี้ง่ายที่สุด
   *
   *    สาเหตุที่สี่คือ **ใบถูกย้ายหน่วย** · `deliveryGroups()` กรองด้วย `o.subName === unit`
   *    ใบที่ย้ายไปหน่วยอื่นจึงหายจากใบเดิมทันที · เกิดจากปุ่ม "คำนวณ Sub-Name ใหม่"
   *    (เจ้าของกดของจริง 25 ต.ค. 2026 แล้วมี 1 ใบย้าย TUE-H→TUE-T) และจากการนำเข้า
   *    ไฟล์แผนทับด้วยกฎ `subNameFromPo()` ที่เข้มขึ้น — สองทางนั้นไม่ได้แตะยอดอะไรเลย
   *    ถ้าไม่บอกไว้ ข้อความจะไปโทษว่ามีคนแก้ยอดหรือยกเลิกใบ ทั้งที่ไม่มีใครทำ */
  if(!groups.length){
    return head + why + `<div class="desc"><b>ไม่เหลือยอดบรรจุของใบนี้แล้ว</b> —
      ยอดที่ตัดเข้าใบถูกแก้เป็น 0 · ใบสั่งถูกยกเลิกไปหลังออกใบ · ใบสั่งถูกย้ายหน่วย
      · หรือข้อมูลของวันนั้นยังไม่ซิงค์มาถึงเครื่องนี้ · จึงไม่มีรายการให้แสดง
      และออกไฟล์ซ้ำไม่ได้ด้วย · ตัวกระดาษที่ส่งไปแล้วยังเป็นหลักฐานตามเดิม</div>`;
  }

  /* เทียบยอดรวมกับตอนออกใบ — ใช้ dnLogStale() เป็นตัวตัดสินจุดเดียว ไม่ตั้งเกณฑ์ใหม่ที่นี่
   * ⚠️ แถวที่ไม่ได้บันทึก qty ไว้ (ซิงค์มาจากเครื่องรุ่นก่อน) เทียบไม่ได้ ต้องบอกว่าเทียบไม่ได้
   *    ห้ามขึ้นว่า "เท่ากับตอนออกใบ" ซึ่งเป็นคำที่ไม่มีหลักฐานรองรับ — dnLogStale() คืน false
   *    ทั้งกรณี "เท่ากัน" และ "ไม่มีอะไรให้เทียบ" แยกสองกรณีนี้จากค่าที่มันคืนไม่ได้ */
  const now = groups.reduce((s,g)=> s + (Number(g.qty)||0), 0);
  const cmp = entry.qty == null
    ? `<div class="desc">แถวนี้ไม่ได้บันทึกยอดรวมตอนออกใบไว้ จึงเทียบไม่ได้ว่าข้อมูลเปลี่ยนไปหรือยัง
        · ยอดรวมวันนี้ <b>${numFmt(now)}</b></div>`
    : dnLogStale(entry)
    ? `<div class="desc"><span class="badge amber">ข้อมูลเปลี่ยนหลังออกใบ</span>
        ยอดรวมตอนออกใบ <b>${numFmt(Number(entry.qty)||0)}</b> · ยอดรวมวันนี้ <b>${numFmt(now)}</b></div>`
    : `<div class="desc">ยอดรวม <b>${numFmt(now)}</b> เท่ากับตอนออกใบ</div>`;

  /* ⚠️ ยอดรวมเท่าเดิมไม่ได้แปลว่ากระดาษเหมือนเดิม — จำนวนบรรทัดต่างกันได้โดยยอดรวมไม่ขยับ
   *    เพราะใบที่ถูกติ๊กให้ขึ้นกระดาษทั้งที่รอบนั้นไม่ได้ส่งของมี `alloc = 0` จึงบวกยอดเป็นศูนย์
   *    `dnLogStale()` มองไม่เห็นโดยออกแบบ (#103 บันทึกไว้แล้วว่าจะจับได้ต้องเพิ่มคอลัมน์)
   *    แต่แถว log เก็บ `lines` ไว้อยู่แล้ว จึงเทียบได้ฟรีโดยไม่ต้องเพิ่มคอลัมน์และไม่ต้อง redeploy
   *    ใบนี้เป็นที่แรกที่วางสองเลขนี้ไว้ใกล้กันให้คนเทียบ จึงต้องไม่ปล่อยให้ขัดกันเงียบ ๆ
   *    (ผู้ตรวจ #113 รอบ 5 รันเจอ: log บอก 2 บรรทัด กล่องโชว์ 1 พร้อมคำว่า "เท่ากับตอนออกใบ")
   * ⚠️ สาเหตุบอกแบบ "ที่พบบ่อยคือ" เท่านั้น — บรรทัดหายเพราะใบถูกยกเลิกหรือย้ายหน่วยก็ได้
   *    ซึ่งกรณีนั้นยอดรวมมักเปลี่ยนตามด้วย และหน้านี้แยกสาเหตุจากกันไม่ได้ */
  const nowLines = groups.reduce((s,g)=> s + shippedOrders(g).length, 0);
  /* ⚠️ ต้องเป็นตัวเลขจริงเท่านั้น · ค่าที่ซิงค์กลับมาเป็นสตริงว่างให้ 0 และสตริงอื่นให้ NaN
   *    ซึ่ง NaN !== nowLines เสมอ → ป้ายขึ้นพร้อมเลข 0 ที่ไม่มีใครเคยออกใบด้วย (ผู้ตรวจ #113) */
  const keptNum = Number(entry.lines);
  const keptLines = (entry.lines == null || entry.lines === '' || !isFinite(keptNum))
    ? null : keptNum;
  const lineCmp = (keptLines != null && keptLines !== nowLines)
    ? `<div class="desc"><span class="badge amber">จำนวนบรรทัดไม่เท่าตอนออกใบ</span>
        ตอนออกใบ <b>${numFmt(keptLines)}</b> บรรทัด · วันนี้ <b>${numFmt(nowLines)}</b> บรรทัด —
        ถ้ายอดรวมเท่าเดิม สาเหตุที่พบบ่อยคือใบที่ถูกติ๊กให้ขึ้นกระดาษทั้งที่รอบนั้นไม่ได้ส่งของ
        ซึ่งย้อนรู้ไม่ได้ว่าใบไหน</div>`
    : '';

  /* ด่านเดียวกับที่ writeDeliveryFile() กันไว้ก่อนออกไฟล์ — บอกที่นี่ด้วย
   * เพราะคนที่ไม่มีฟอร์มกดออกไฟล์ซ้ำเพื่อดูเหตุไม่ได้ และนี่คือเหตุที่พบบ่อยที่สุด */
  const bad = groups.filter(g => g.packQty !== g.qty);
  const warn = bad.length ? `<div class="desc"><span class="badge red">กล่องกับเศษไม่ตรงกับยอด</span>
      ${bad.map(g=>`P/N ${escapeHtml(g.pn)} กระดาษจะพิมพ์ ${numFmt(g.packQty)} แต่คีย์ไว้ ${numFmt(g.qty)}`).join(' · ')}
      — ออกไฟล์ซ้ำไม่ได้จนกว่าจะแก้ให้ตรง</div>` : '';

  const rows = groups.map(g=>{
    /* shippedOrders() ปลอดภัยที่นี่เพราะ dnReissueGroups() ตัดเหลือเฉพาะ alloc > 0 แล้ว
     * ช่องติ๊กจึงเพิ่มแถวอะไรไม่ได้ · และด้วยเหตุเดียวกัน qty ของทุกกลุ่มมากกว่า 0 เสมอ
     * จึงไม่มีกรณี "กลุ่มที่ไม่ได้ส่งของเลย" ที่กระดาษเว้นช่องบรรจุไว้ ให้ต้องรองรับที่นี่
     *
     * ⚠️ Wip bal. ที่ Delta ไม่ได้ให้ยอดมา ต้องเว้นว่างเหมือนกระดาษ ห้ามโชว์ 0
     *    เลข 0 แปลว่า "Delta บอกว่าไม่ค้างแล้ว" ซึ่งคนละเรื่องกับ "Delta ไม่ได้บอก" */
    const lines = shippedOrders(g);
    return lines.map((x,i)=>{
      const grp = i > 0 ? `` : `
        <td class="dn-merge" rowspan="${lines.length}">${numFmt(g.perBox)}</td>
        <td class="dn-merge" rowspan="${lines.length}">${numFmt(g.boxes)}</td>
        <td class="dn-merge" rowspan="${lines.length}">${numFmt(g.remainder)}</td>
        <td class="dn-merge" rowspan="${lines.length}">${numFmt(g.packQty)}</td>
        <td class="dn-merge left" rowspan="${lines.length}">${escapeHtml(g.remark)}</td>`;
      return `<tr>
        <td class="left">${escapeHtml(g.pn)}</td>
        <td class="left">${escapeHtml(x.o.poNo)}</td>
        <td>${x.o.orderDate ? escapeHtml(fmtDateTH(x.o.orderDate)) : '—'}</td>
        <td>${numFmt(Number(x.o.orderQty)||0)}</td>
        <td>${x.deltaWip == null ? '—' : numFmt(x.deltaWip)}</td>
        <td>${numFmt(Number(x.alloc)||0)}</td>${grp}
      </tr>`;
    }).join('');
  }).join('');

  return head + why + cmp + lineCmp + warn + `<div class="table-wrap"><table id="dnPreviewTable">
    <thead><tr><th class="left">P/N</th><th class="left">PO No.</th><th>Order Date</th>
      <th>PO QTY</th><th>Wip bal.</th><th>ยอดส่งงาน</th><th>ต่อกล่อง</th><th>กล่อง</th>
      <th>เศษ</th><th>จำนวน/PCS</th><th class="left">Remark</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function showDnPreview(entry){
  document.getElementById('dnPreviewTitle').textContent = 'รายละเอียดใบ ' + entry.no;
  document.getElementById('dnPreviewBody').innerHTML = dnPreviewHtml(entry);
  document.getElementById('dnPreviewModal').classList.add('show');
}

function renderDnLog(){
  const table = document.getElementById('dnLogTable');
  if(!table) return;
  const log = (state.deliveryLog||[]).filter(e=>!e.voided);
  // "ครั้งที่ N" นับจากแถวที่เลขซ้ำกัน เรียงตามเวลาออกจริง — คิดสดตอนวาด ไม่เก็บลงฐานข้อมูล
  const seqOfRow = {}, countOfNo = {};
  log.slice().sort((a,b)=> String(a.createdAt).localeCompare(String(b.createdAt)))
     .forEach(e=>{ seqOfRow[e.id] = countOfNo[e.no] = (countOfNo[e.no]||0) + 1; });

  const rows = log.slice()
    .sort((a,b)=> String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(e=>{
      const again = seqOfRow[e.id] > 1 ? ` <span class="badge amber">ครั้งที่ ${seqOfRow[e.id]}</span>` : '';
      const stale = dnLogStale(e)
        ? ' <span class="badge amber" title="ยอดรวมของใบนี้ไม่เท่ากับตอนออกใบ — แก้ยอดบรรจุ แก้ยอดที่ตัดเข้าใบ หรือใบสั่งถูกยกเลิก · ไฟล์ที่ออกซ้ำจะไม่ตรงกับกระดาษใบเดิม">ข้อมูลเปลี่ยนหลังออกใบ</span>' : '';
      return `<tr>
        <td class="left"><a href="#" data-dn-reissue="${escapeHtml(e.id)}" title="ออกไฟล์ใบนี้อีกครั้ง">${escapeHtml(e.no)}</a>${again}${stale}</td>
        <td>${e.createdAt ? new Date(e.createdAt).toLocaleString('th-TH') : ''}</td>
        <td class="left">${escapeHtml(e.unit)}</td>
        <td>${escapeHtml(String(e.week||''))}</td>
        <td>${numFmt(Number(e.groups)||0)}</td>
        <td>${numFmt(Number(e.lines)||0)}</td>
        <td>${numFmt(Number(e.qty)||0)}</td>
        <td class="left">${escapeHtml(e.deviceName||'')}</td>
        <td><a href="#" data-dn-preview="${escapeHtml(e.id)}"
               title="ดูรายการบนใบนี้บนจอ — ไม่ต้องมีไฟล์ฟอร์ม">ดูรายละเอียด</a></td>
      </tr>`;
    }).join('');

  table.innerHTML =
    `<thead><tr><th class="left">เลขที่</th><th>เวลาที่ออก</th><th class="left">หน่วย</th><th>WK</th>
       <th>กลุ่ม P/N</th><th>บรรทัด</th><th>ยอดรวม</th><th class="left">เครื่อง</th>
       <th class="left">รายละเอียด</th></tr></thead>
     <tbody>${rows || emptyRow(9,'ยังไม่มีใบส่งสินค้าที่ออกไป')}</tbody>`;
}

/* กดเลขที่ใบ = ออกไฟล์ใบนั้นอีกครั้ง · สร้างใหม่จากยอดบรรจุของหน่วย+วันนั้น ไม่ได้เก็บไฟล์ไว้ */
document.getElementById('dnLogTable').addEventListener('click', async (e)=>{
  const a = e.target.closest('[data-dn-reissue]');
  if(!a) return;
  e.preventDefault();
  const entry = (state.deliveryLog||[]).find(x=>x.id===a.dataset.dnReissue);
  if(!entry) return;
  if(!dnTemplate){ toast('เลือกไฟล์ฟอร์ม FM-ST-07 ก่อนครับ — ระบบไม่ได้เก็บไฟล์ใบเก่าไว้ แต่สร้างใหม่ให้'); return; }

  const groups = dnReissueGroups(entry.date, entry.unit);
  if(!groups.length){ toast('ไม่เหลือยอดบรรจุของใบนี้แล้ว — ออกไฟล์ซ้ำไม่ได้'); return; }
  /* ⚠️ ถามยืนยัน **ทุกครั้ง** ไม่ใช่เฉพาะตอนป้ายขึ้น
   *    เพราะ dnLogStale() จับได้แค่ยอดรวมเปลี่ยน · ของที่มันจับไม่ได้แต่เปลี่ยนจริงมีอีกหลายอย่าง
   *    ที่หนักสุดคือ **Wip bal. บนกระดาษ** ซึ่งมาจากไฟล์ Call In งวดล่าสุด —
   *    นำเข้าไฟล์งวดใหม่ตามปกติทุกสัปดาห์ เลขบนกระดาษก็เปลี่ยนแล้วโดยไม่มีใครแตะยอดอะไรเลย
   *    และนั่นคือเลขที่ Delta อ่าน (ผู้ตรวจ #103 รันพิสูจน์: งวด 34 ค้าง 5,000 → งวด 35 ได้ 3,000)
   *    รวมถึงกลุ่มที่ขึ้นกระดาษเพราะติ๊กให้โผล่ (alloc = 0) ซึ่งจะหายไปจากไฟล์ที่ออกซ้ำ
   *    บอกให้ชัดว่านี่คือ "สร้างใหม่จากข้อมูลวันนี้" ดีกว่าปล่อยให้เข้าใจว่าเป็นสำเนาของกระดาษใบเดิม */
  const warn = dnLogStale(entry)
    ? `\n\n⚠️ ยอดที่จะลงกระดาษตอนนี้ไม่เท่ากับตอนออกใบ (${numFmt(Number(entry.qty)||0)})` : '';
  if(!confirm(`ออกไฟล์ใบ ${entry.no} (${entry.unit} ${fmtDateTH(entry.date)}) ใหม่\n\n`
      + 'ไฟล์นี้สร้างใหม่จากข้อมูลวันนี้ ไม่ใช่สำเนาของกระดาษใบเดิม\n'
      + 'ถ้ามีอะไรเปลี่ยนไปตั้งแต่วันที่ออกใบ — รวมถึง Wip bal. ที่มาจากไฟล์ Call In งวดล่าสุด —\n'
      + 'เลขบนกระดาษจะไม่เท่ากับใบที่ส่งไปแล้ว' + warn + '\n\nออกไฟล์ต่อหรือไม่?')) return;

  try{
    await writeDeliveryFile(entry.unit, entry.date, entry.week, groups);
    toast(`ออกไฟล์ใบ ${entry.no} อีกครั้งแล้ว`);
  }catch(err){ toast('ออกไฟล์ไม่สำเร็จ: '+err.message); }
});

/* กดดูรายละเอียด = อ่านบนจอ ไม่สร้างไฟล์ จึงไม่ต้องมีฟอร์มและไม่ต้องถามยืนยันอะไร
 * แยกตัวจับคลิกจากของ "ออกไฟล์ซ้ำ" ตั้งใจ — ทางนั้นมีด่าน dnTemplate กับกล่องยืนยันอยู่ก่อน
 * ถ้าเอามารวมกัน ทางนี้จะติดด่านที่ไม่เกี่ยวกับมันเลย */
document.getElementById('dnLogTable').addEventListener('click', (e)=>{
  const a = e.target.closest('[data-dn-preview]');
  if(!a) return;
  e.preventDefault();
  const entry = (state.deliveryLog||[]).find(x=>x.id===a.dataset.dnPreview);
  if(entry) showDnPreview(entry);
});

document.getElementById('dnPreviewCloseBtn').addEventListener('click', ()=>{
  document.getElementById('dnPreviewModal').classList.remove('show');
});

// คลิกฉากหลังก็ปิด — รูปแบบเดียวกับ mergeModal · ไม่มีอะไรต้องเก็บ จึงไม่ต้องล้างสถานะ
document.getElementById('dnPreviewModal').addEventListener('click', (e)=>{
  if(e.target.id==='dnPreviewModal') e.currentTarget.classList.remove('show');
});

document.getElementById('btnDnExport').addEventListener('click', async ()=>{
  if(!dnTemplate){ toast('เลือกไฟล์ฟอร์มก่อนครับ'); return; }
  const date = dnDate(), unit = dnUnit();
  // กลุ่มที่ไม่มีของส่งเลย แต่มีใบที่คนติ๊กไว้ ก็ต้องได้ขึ้น — ไม่งั้นติ๊กแล้วไม่เกิดอะไรขึ้น
  const groups = deliveryGroups(date, unit).filter(g => shippedOrders(g).length > 0);
  if(!groups.length){ toast('ยังไม่มีกลุ่มไหนกรอกยอดไว้ในวันนี้'); return; }

  // ⚠️ ด่านนี้ห้ามเป็นแค่คำถามให้กดผ่าน — ต้องกันจริง
  //    เลขที่ Excel พิมพ์คือ ต่อกล่อง × กล่อง + เศษ ถ้ามันไม่ตรงกับยอดที่คีย์
  //    ใบที่ส่งลูกค้าจะแจ้งจำนวนคนละตัวกับของที่ส่งจริง โดยไม่มีใครเห็นบนจอ
  //    ทางออกอยู่ใกล้มือ — ปุ่ม "คำนวณให้" ในแถวของกลุ่มนั้น จึงไม่ใช่การกันแล้วติดตาย
  const bad = groups.filter(g => g.packQty !== g.qty);
  if(bad.length){
    // ไม่ใช้ตัวหนีบรรทัดใหม่ตรง ๆ เพราะเคยถูกกลืนจนสตริงไม่ปิดมาแล้ว
    const nl = String.fromCharCode(10);
    const detail = bad.map(g=>`  P/N ${g.pn} — กระดาษจะพิมพ์ ${numFmt(g.packQty)} แต่คีย์ไว้ ${numFmt(g.qty)}`).join(nl);
    alert(`ออกใบไม่ได้ — มี ${bad.length} กลุ่มที่กล่องกับเศษไม่ตรงกับยอดที่คีย์${nl}${nl}${detail}`
        + `${nl}${nl}กดปุ่ม "คำนวณให้" ในแถวของกลุ่มนั้น เพื่อให้โปรแกรมแบ่งกล่องใหม่`
        + `${nl}หรือแก้กล่อง/เศษเองให้ผลคูณตรงกับยอดที่คีย์`);
    return;
  }

  // ชีตของหน่วยนี้ — ชื่อจริงในไฟล์มีช่องว่างท้ายบ้าง จึงเทียบแบบตัดช่องว่าง
  const sheetName = Object.keys(dnTemplate.sheetMap)
    .find(n => n.trim().replace(/\s+/g,' ').toUpperCase().endsWith(unit.toUpperCase()));
  if(!sheetName){
    toast(`ไม่พบชีตของหน่วย ${unit} ในฟอร์มนี้ — มีชีต: ${Object.keys(dnTemplate.sheetMap).join(', ')}`);
    return;
  }

  if(!dnWeek()){ toast('กรอกเลขสัปดาห์ (WK) ก่อนครับ — อยู่บนหัวใบส่งสินค้า'); return; }

  const btn = document.getElementById('btnDnExport');
  btn.disabled = true;
  try{
    await writeDeliveryFile(unit, date, dnWeek(), groups, sheetName);
    logDeliveryIssue(unit, date, dnWeek(), groups);
    toast(`ออกใบส่งสินค้าแล้ว ${groups.length} กลุ่ม P/N`);
  }catch(err){
    toast('ออกใบไม่สำเร็จ: '+err.message);
  }finally{ btn.disabled = false; }
});

/** เลข WK ที่มีอยู่ในฟอร์ม — ใช้เป็นค่าตั้งต้นให้คนไม่ต้องพิมพ์เองทุกครั้ง */
async function weekFromTemplate(zip, map){
  const first = Object.values(map)[0];
  if(!first) return '';
  const doc = parseXml(await zip.file(first).async('string'));
  const shared = await readSharedStrings(zip);
  // หาจากข้อความ ไม่ใช่ตำแหน่ง — ช่องนี้ย้ายจาก U7 ไป V7 ตอนเจ้าของแทรกคอลัมน์ยอดส่งงาน (11 ก.ย. 2026)
  const cell = Array.from(doc.getElementsByTagNameNS(XL_NS,'c')).find(c=>/^Date_/i.test(cellText(c, shared)));
  const m = /WK\s*(\d+)/i.exec(cellText(cell, shared));
  return m ? m[1] : '';
}

/* ---------- ยอดของขั้นที่โปรแกรมรุ่นนี้ไม่รู้จัก ---------- */
/* เจ้าของสั่งเมื่อ 12 ก.ย. 2026 ให้เพิ่มขั้นการผลิตได้จากในโปรแกรม และซิงค์ไปทุกเครื่อง
 * เครื่องที่ยังเปิดโปรแกรมรุ่นก่อนหน้าค้างไว้จะดึงยอดของขั้นใหม่มาเก็บได้ แต่ไม่รู้จักขั้นนั้น
 *
 * ⚠️ buildCumMap · buildCumSplitMap · buildDailyTotals ข้ามยอดของขั้นที่ไม่รู้จักแบบเงียบ ๆ
 *    การ์ด WIP ตาราง กราฟ บนเครื่องนั้นจึงต่ำกว่าเครื่องอื่นโดยไม่มีอะไรฟ้อง — ต้องเตือนให้เห็น
 *    ห้ามแก้ด้วยการ throw ในตัวคิดยอด เพราะมันวิ่งทุกครั้งที่วาดจอ throw = หน้าขาวทั้งแอป */
function unknownProcessCounts(records){
  // ขั้นที่ซ่อนก็นับว่ารู้จัก — ยอดของมันไม่ถูกนับโดยตั้งใจ ไม่ใช่ขั้นแปลกหน้า
  const known = new Set(Object.keys(PROCESS_BY_ID));
  const counts = {};
  for(const r of records){
    if(r.voided || known.has(r.process)) continue;
    counts[r.process] = (counts[r.process] || 0) + 1;
  }
  return counts;
}

let processWarnShown = false;
function renderProcessWarning(){
  const counts = unknownProcessCounts(state.records);
  const names = Object.keys(counts);
  const el = document.getElementById('unknownProcessWarn');
  el.hidden = names.length === 0;
  if(!names.length){ processWarnShown = false; return; }
  const total = names.reduce((s, k) => s + counts[k], 0);
  // ชื่อขั้นมาจากข้อมูลที่ซิงค์มา ต้องใส่เป็นข้อความเท่านั้น ห้ามต่อเป็น HTML
  el.querySelector('.msg').textContent =
    `เครื่องนี้ใช้โปรแกรมรุ่นเก่า — มียอด ${numFmt(total)} รายการของขั้นที่รุ่นนี้ไม่รู้จัก (${names.join(', ')}) ` +
    `· ยอดบนจอจึงต่ำกว่าเครื่องอื่น กดโหลดโปรแกรมรุ่นใหม่ก่อนใช้ตัวเลข`;
  // เพิ่งเจอครั้งแรก — เช็กรุ่นใหม่ทันทีไม่ต้องรอรอบ 30 นาที (ห้ามยิงทุกครั้งที่วาดจอ ไฟล์เกือบ 1 MB)
  if(!processWarnShown){ processWarnShown = true; lastUpdateCheck = 0; checkAppUpdate(); }
}

/* ---------- Orchestration ---------- */
function renderAll(){
  renderProcessWarning();
  renderProcessAdmin();
  renderDashFilterOptions();
  renderImportHistory();
  renderOrderVoidTable();
  renderWipCards();
  renderChart();
  renderDashTable();
  renderEntryTable();
  renderRecordEditor();
  // ถ้านั่งค้างหน้า FG ไว้แล้วซิงค์ดึงข้อมูลใหม่เข้ามา ตัวเลขต้องขยับตาม
  // ไม่ใช่ค้างของเก่าจนกว่าจะสลับแท็บ — เป็นหน้ายอดคงเหลือ คนจะจ้องมันแล้วเชื่อเลข
  if(document.getElementById('view-fg').classList.contains('active')) renderFg();
  /* log ใบส่งสินค้าซิงค์ข้ามเครื่อง — เครื่องที่นั่งค้างหน้านี้ไว้ต้องเห็นใบที่เครื่องอื่นเพิ่งออก
   * ⚠️ เช็กแท็บก่อนเหมือน renderFg() บรรทัดบน — ทุกแถว log เรียก deliveryGroups() ใหม่หนึ่งรอบ
   *    ปล่อยให้วิ่งทุกครั้งที่ซิงค์ เครื่องที่นั่งอยู่หน้า Dashboard จะเสียเวลาฟรีทุกรอบ
   *    (ผู้ตรวจ #103 วัดได้ 121 ms ที่ log 300 แถว / 4,000 record) */
  if(document.getElementById('view-delivery').classList.contains('active')) renderDnLog();
  renderSyncBadge();
}

/* ---------- Event bindings ---------- */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-'+tab).classList.add('active');
    if(tab==='dashboard'){ renderDashFilterOptions(); renderWipCards(); renderChart(); renderDashTable(); }
    if(tab==='entry'){ renderDashFilterOptions(); renderEntryTable(); renderRecordEditor(); }
    if(tab==='import'){ renderImportHistory(); renderOrderVoidTable(); }
    if(tab==='data'){ loadSettingsIntoForm(); }
    /* renderDnLog() ต้องอยู่ที่นี่ด้วย ไม่ใช่พึ่ง renderAll() ตอนเปิดหน้า —
     * renderAll() มีด่านเช็กแท็บของตัวเองแล้ว ซึ่งตอนเปิดหน้าแท็บ import ยัง active อยู่
     * ถ้าไม่วาดตอนกดเข้ามา ตารางจะว่างทั้งหัวตาราง อ่านได้ว่า 'ยังไม่ออกใบ' แล้วคนออกกระดาษซ้ำ */
    if(tab==='delivery'){ renderDeliveryNote(); renderDnLog(); }
    if(tab==='fg'){ renderFg(); }
  });
});

document.getElementById('voidSearch').addEventListener('input', renderOrderVoidTable);
document.getElementById('voidShowVoided').addEventListener('change', renderOrderVoidTable);

document.getElementById('fileInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  if(rejectLegacyXls(file)) return;
  // ไฟล์แผนจริงเกือบ 2 MB สามสิบกว่าชีต ใช้เวลาอ่านหลายวินาทีบนเครื่องโรงงาน
  // ถ้าไม่บอกอะไรเลย คนจะกดซ้ำเพราะนึกว่าไม่ติด
  toast('กำลังอ่านไฟล์...');
  try{
    workbookGlobal = new ExcelJS.Workbook();
    await workbookGlobal.xlsx.load(await file.arrayBuffer());
  }catch(err){
    toast('เปิดไฟล์ไม่สำเร็จ: '+err.message);
    return;
  }
  const sel = document.getElementById('sheetSelect');
  sel.innerHTML = '';
  let best=null, bestNum=-1;
  workbookGlobal.worksheets.forEach(ws=>{
    const nm = ws.name;
    const opt = document.createElement('option');
    opt.value = nm;
    opt.textContent = nm + (isHiddenSheet(ws) ? ' (ซ่อน)' : '');
    sel.appendChild(opt);
    const m = nm.match(/WK\s*(\d+)/i);
    if(m && !isHiddenSheet(ws)){
      const num = parseInt(m[1],10);
      if(num>bestNum){ bestNum=num; best=nm; }
    }
  });
  if(best) sel.value = best;
  sel.disabled = false;
  document.getElementById('btnParseSheet').disabled = false;
  document.getElementById('previewPanel').style.display = 'none';
  pendingImportItems = null;
});

document.getElementById('btnParseSheet').addEventListener('click', ()=>{
  const parsed = parseSelectedSheet();
  if(!parsed){ toast('กรุณาเลือกไฟล์และ sheet ก่อน'); return; }
  // หัวตารางผิดผัง หรือขาดคอลัมน์ที่จำเป็น — บอกให้ชัด ดีกว่าเดาตำแหน่งแล้วนำเข้าผิดเงียบ ๆ
  if(parsed.error){ toast(parsed.error); return; }
  if(parsed.items.length===0){ toast('ไม่พบข้อมูลที่ถูกต้องใน sheet นี้'); return; }
  pendingImportItems = parsed.items;
  renderPreview(parsed);
});

document.getElementById('btnCancelImport').addEventListener('click', ()=>{
  pendingImportItems = null;
  document.getElementById('previewPanel').style.display = 'none';
});

document.getElementById('btnConfirmImport').addEventListener('click', ()=>{
  if(!pendingImportItems || !pendingImportItems.length) return;
  const now = new Date().toISOString();
  const orderMap = {}; state.orders.forEach((o,i)=>orderMap[o.id]=i);
  let newCount=0, updCount=0, sumQty=0;
  pendingImportItems.forEach(it=>{
    sumQty += it.orderQty;
    const i = orderMap[it.id];
    if(i!=null){
      state.orders[i] = Object.assign({}, state.orders[i], it, {updatedAt:now, _dirty:true});
      updCount++;
    } else {
      state.orders.push(Object.assign({}, it, {status:'active', importedAt:now, updatedAt:now, _dirty:true}));
      newCount++;
    }
  });
  state.importHistory = state.importHistory || [];
  state.importHistory.push({ts:Date.now(), week: document.getElementById('sheetSelect').value, newCount, updCount, sumQty});
  saveState();
  pendingImportItems = null;
  document.getElementById('previewPanel').style.display = 'none';
  toast(`นำเข้าสำเร็จ: ใหม่ ${newCount} รายการ, อัปเดต ${updCount} รายการ`);
  renderAll();
  doSync();
});


/* คิด Sub-Name ใหม่ให้ใบสั่งที่มีอยู่แล้ว — ของที่นำเข้าไว้ก่อน 4 ก.ย. 2026
 * ได้ค่ามาจากคอลัมน์ C ซึ่งมีที่พิมพ์ผิดปนอยู่ (สำรวจไฟล์จริงพบ 84 แถว ไม่นับ DLG-H)
 *
 * ⚠️ แตะเฉพาะ subName — ห้ามแตะยอด วันแผน หรือ records
 *    การนำเข้าไฟล์ซ้ำก็ได้ผลเหมือนกัน แต่มันทับยอดสั่งกับวันแผนไปด้วย
 *    ปุ่มนี้จึงมีไว้ให้แก้เรื่อง Sub-Name อย่างเดียวได้ โดยไม่กระทบอย่างอื่น
 *
 * ⚠️ ใบที่ subNameFromPo() ตัดสินไม่ได้ ต้อง "ไม่แตะ" ไม่ใช่ล้างเป็นค่าว่าง
 *    ใบที่ตอนนี้มีหน่วยอยู่แล้วและใช้งานได้ ถ้าโดนล้างจะหายจากหน้าใบส่งสินค้าทันที
 *    ทำให้ส่งของใบนั้นไม่ได้ — เสียมากกว่าได้ */
document.getElementById('btnRecalcSubName').addEventListener('click', ()=>{
  const changes = [];
  let unresolved = 0, unchanged = 0;
  activeOrders().forEach(o=>{
    const to = subNameFromPo(o.poNo);
    if(!to){ unresolved++; return; }
    const from = String(o.subName == null ? '' : o.subName);
    if(from === to){ unchanged++; return; }
    changes.push({o, from: from || '(ว่าง)', to});
  });

  const nl = String.fromCharCode(10);
  if(!changes.length){
    toast(`ไม่มีใบไหนต้องเปลี่ยน — ตรงอยู่แล้ว ${numFmt(unchanged)} ใบ`
        + (unresolved? ` · ตัดสินจากรหัส PO ไม่ได้ ${numFmt(unresolved)} ใบ` : ''));
    return;
  }

  const tally = {};
  changes.forEach(c=>{ const k = c.from + ' → ' + c.to; tally[k] = (tally[k]||0) + 1; });
  const detail = Object.entries(tally).sort((a,b)=>b[1]-a[1])
    .map(([k,n])=> '  ' + k + '   ' + numFmt(n) + ' ใบ').join(nl);

  if(!confirm(`จะเปลี่ยน Sub-Name ของ ${numFmt(changes.length)} ใบสั่ง${nl}${nl}${detail}${nl}${nl}`
    + `ไม่เปลี่ยน ${numFmt(unchanged)} ใบ (ตรงอยู่แล้ว)`
    + (unresolved? ` · ไม่แตะ ${numFmt(unresolved)} ใบ (ตัดสินจากรหัส PO ไม่ได้)` : '')
    + `${nl}${nl}ยอดที่คีย์ไว้ ยอดสั่ง และวันแผน ไม่ถูกแตะ`)) return;

  const now = new Date().toISOString();
  changes.forEach(c=>{ c.o.subName = c.to; c.o.updatedAt = now; c.o._dirty = true; });
  saveState();
  renderAll();
  renderSyncBadge();
  doSync();
  toast(`เปลี่ยน Sub-Name แล้ว ${numFmt(changes.length)} ใบ`);
});

/** ส่วนของหน้าจอที่มีหนึ่งช่องต่อหนึ่งขั้น — วาดจาก PROCESSES ทั้งหมด ไม่มี HTML ตายตัวของขั้นไหนเหลือ
 *  หัวจอ · ปุ่มเลือกขั้นหน้าคีย์ยอด · ตัวกรองค้างอยู่ที่ขั้น · ตัวกรองขั้นในตารางแก้ไข · ช่องวันกำหนดส่ง
 *
 *  ⚠️ เดิมปุ่มเป็น HTML ตายตัวแต่ผูกด้วย PROCESSES.forEach — เพิ่มขั้นโดยลืมเพิ่มปุ่ม
 *     getElementById คืน null แล้ว throw ตอนโหลด โค้ดส่วน Init ไม่ถูกรัน แอปพังทั้งหน้า
 *  ⚠️ ต้องถูกเรียกก่อน loadSettingsIntoForm เพราะช่องวันกำหนดส่งถูกสร้างที่นี่ */
function renderProcessControls(){
  /* ขั้นที่กำลังคีย์อยู่ถูกซ่อนจากเครื่องอื่น — กลับไปขั้นแรก ไม่งั้นหน้าคีย์ยอดไม่มีปุ่มไหนถูกเลือก
   * ⚠️ กลับไปขั้นแรก "ของสายการผลิต" ไม่ใช่ PROCESSES[0] — ถ้าขั้นนับแยกถูกแทรกเป็นขั้นแรก
   *    คนเปิดหน้ามาจะเจอปุ่มงานซ่อมถูกเลือกไว้แทน Winding ซึ่งไม่ใช่งานประจำวันของใคร
   *    (เลือกขั้นนับแยกเองยังได้ตามปกติ ตรงนี้คุมแค่ค่าตั้งต้นกับตอนตกกลับ) */
  if(!PROCESSES.includes(currentProcess)) currentProcess = MAIN_PROCESSES[0];
  // บรรทัดนี้คือ "สายการผลิต" ที่วาดด้วยลูกศร — ขั้นนับแยกอยู่ในนั้นจะอ่านว่าต่อจากขั้นก่อนหน้า
  document.getElementById('processFlow').textContent = 'Thai Union Electronics — '
    + MAIN_PROCESSES.filter(p=>p!=='shipping').map(p=>PROCESS_LABELS[p]).join(' → ');

  const btns = document.getElementById('procButtons');
  btns.innerHTML = PROCESSES.map(p=>{
    const d = PROCESS_BY_ID[p];
    return `<button class="btn${p===currentProcess?' primary':''}" id="procBtn-${p}" data-proc="${p}">${escapeHtml(d.icon + ' ' + d.label)}</button>`;
  }).join('');
  btns.querySelectorAll('button').forEach(b=> b.addEventListener('click', ()=>{
    currentProcess = b.dataset.proc;
    btns.querySelectorAll('button').forEach(x=> x.classList.toggle('primary', x===b));
    renderEntryTable();
  }));

  const refill = (id, html) => {
    const sel = document.getElementById(id);
    const keep = sel.value;
    sel.innerHTML = html;
    sel.value = keep;
    if(sel.value !== keep) sel.value = '';
  };
  // ตัวกรองนี้ถามว่า "ค้างอยู่หน้าขั้นไหน" ซึ่งมีความหมายเฉพาะขั้นในสายหลัก
  refill('dashWipFilter', '<option value="">ทั้งหมด</option><option value="notStarted">ยังไม่เริ่มผลิต</option>'
    + MAIN_PROCESSES.slice(1).map(p=>`<option value="${p}">${escapeHtml(ptext(p, 'wait'))}</option>`).join(''));
  refill('recFilterProcess', '<option value="">ทั้งหมด</option>'
    + PROCESSES.map(p=>`<option value="${p}">${escapeHtml(PROCESS_LABELS[p])}</option>`).join(''));

  document.getElementById('offsetFields').innerHTML = PROCESSES.map(p=>{
    const d = PROCESS_BY_ID[p];
    return `<div class="field"><label>${escapeHtml(ptext(p, 'offset'))}</label>`
      + `<input type="number" id="${offsetInputId(d)}" min="0" style="width:90px"${d.defaultOffset===null ? ' placeholder="ยังไม่กำหนด"' : ''}></div>`;
  }).join('');
}
/** ค่าในช่องวันกำหนดส่ง — ยังไม่ตั้งค่า (null) ต้องโชว์เป็นช่องว่าง ไม่ใช่ 0 (0 = deadline เท่ากับวันสั่งซื้อ) */
function fillOffsetInputs(){
  PROCESSES.forEach(p=>{
    const el = document.getElementById(offsetInputId(PROCESS_BY_ID[p]));
    const v = state.deadlineOffsets[p];
    if(el) el.value = v==null ? '' : v;
  });
}

/* ---------- จัดการขั้นการผลิต (หน้าข้อมูล & แชร์) ---------- */
/* เจ้าของสั่ง 12 ก.ย. 2026 · ข้อตกลง: เพิ่ม · เปลี่ยนชื่อ · ซ่อน เท่านั้น · Inspection กับ ส่งของ ล็อก
 * ลบขั้นไม่ได้ · ต้องต่อ Google Sheets · ต้องใส่รหัสหัวหน้า
 *
 * ⚠️ บันทึกขึ้นเซิร์ฟเวอร์ก่อน สำเร็จแล้วค่อยเปลี่ยนในเครื่อง — ห้ามกลับลำดับ
 *    ถ้าเปลี่ยนในเครื่องก่อนแล้วส่งไม่ผ่าน (เน็ตหลุด หรือเซิร์ฟเวอร์ปฏิเสธเพราะเครื่องอื่นเพิ่มขั้นไปก่อน)
 *    เครื่องนี้จะคีย์ยอดลงขั้นที่เครื่องอื่นไม่รู้จัก แล้วยอดนั้นหายจากทุกผลรวมของเครื่องอื่น
 * ⚠️ รหัสหัวหน้าเป็นรั้วกันกดพลาด ไม่ใช่ความปลอดภัยจริง — ค่าที่เข้ารหัสกับ salt อยู่ในข้อมูลที่ทุกเครื่องดึงได้
 *    ไม่เก็บรหัสจริงไว้ที่ไหนเลย ทั้งในเครื่องและบนเซิร์ฟเวอร์ */
const PROCESS_UNLOCK_MS = 10 * 60 * 1000;
let processAdminInfo = null;       // {hash, salt, setBy, setAt} จากเซิร์ฟเวอร์ · null = ยังไม่เคยตั้งรหัส
let processUnlockedUntil = 0;
let processPinMode = '';           // set · verify · change
let processPinVerified = false;    // ใส่รหัสเดิมผ่านแล้ว จึงตั้งรหัสใหม่ทับได้
const processUnlocked = () => Date.now() < processUnlockedUntil;

function randomHex(bytes){
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, b=>b.toString(16).padStart(2, '0')).join('');
}
/** ⚠️ crypto.subtle มีเฉพาะหน้าที่เปิดผ่าน https หรือ localhost — เปิดไฟล์จากเครื่องตรง ๆ ต้องบอกคนใช้ ไม่ใช่เงียบ */
async function sha256Hex(text){
  if(!(window.crypto && crypto.subtle)) throw new Error('เบราว์เซอร์ตรวจรหัสไม่ได้ — เปิดโปรแกรมผ่านลิงก์เว็บ (https) แทนการเปิดไฟล์ในเครื่อง');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b=>b.toString(16).padStart(2, '0')).join('');
}

/** รับรายการขั้นใหม่มาใช้ — คืน true ถ้าเปลี่ยนจริง · รูปผิดไม่รับ คงรายการเดิมไว้ */
function adoptProcessList(list){
  if(!validProcessList(list)) return false;
  if(JSON.stringify(list) === JSON.stringify(state.processes)) return false;
  state.processes = list;
  applyProcessList(composeProcesses(list));
  renderProcessControls();
  fillOffsetInputs();
  return true;
}

/** รายการเต็มในเครื่อง → รูปที่เก็บบนเซิร์ฟเวอร์ · ขั้นตั้งต้นไม่ต้องพกไอคอนกับสี เพราะอยู่ในโค้ดแล้ว
 *
 *  ⚠️ ฟังก์ชันนี้คัดฟิลด์แบบ whitelist — ฟิลด์ที่ลืมใส่จะหายจากเซิร์ฟเวอร์ถาวร ไม่ใช่แค่ไม่ถูกส่ง
 *     เพราะ saveProcessList() เอาผลของตัวนี้ไป adoptProcessList() ทับในเครื่องต่อด้วย
 *     ลืม standalone แล้วใครกดเปลี่ยนชื่อ/ซ่อนขั้นไหนก็ได้ ขั้นนับแยกจะกลับเข้าสายหลักทุกเครื่อง
 *     แล้วทุกใบจะขึ้นล่าช้า ซึ่งเป็นอาการที่ A3/A5 ตั้งใจกันไว้พอดี */
function storedProcessList(list){
  return list.map(p=>{
    const o = {id:p.id, label:p.label, short:p.short, hidden:!!p.hidden};
    if(!DEFAULT_BY_ID[p.id]){ o.icon = p.icon; o.color = p.color; }
    if(p.standalone) o.standalone = true;
    PROCESS_AUDIT_KEYS.forEach(k=>{ if(p[k]) o[k] = p[k]; });
    return o;
  });
}

/** ดึงรายการขั้นกับข้อมูลรหัสล่าสุดจากเซิร์ฟเวอร์ — ใช้ก่อนแก้ทุกครั้ง ห้ามเชื่อของที่ค้างในเครื่อง */
async function refreshProcessSettings(){
  const ds = await gsApi('pullSettings', {});
  processAdminInfo = ds.processAdmin || null;
  if(adoptProcessList(ds.processes)){ saveState(); renderAll(); }
}

async function saveProcessList(list, doneMsg){
  if(!processUnlocked()){ toast('หมดเวลาแก้ไข — ใส่รหัสหัวหน้าใหม่'); renderProcessAdmin(); return false; }
  const next = storedProcessList(list);
  if(!validProcessList(next)){ toast('รายการขั้นไม่ถูกต้อง — ไม่ได้บันทึก'); return false; }
  try{
    await gsApi('pushSettings', {processes: next});
  }catch(e){
    // ส่วนใหญ่คือเครื่องอื่นเพิ่มขั้นไปก่อน — ดึงของจริงบนเซิร์ฟเวอร์กลับมาให้เห็นก่อนลองใหม่
    toast('บันทึกรายการขั้นไม่สำเร็จ: ' + e.message);
    try{ await refreshProcessSettings(); }catch(_){ /* เน็ตหลุด — คงรายการเดิมไว้ */ }
    renderProcessAdmin();
    return false;
  }
  adoptProcessList(next);
  saveState();
  renderAll();
  toast(doneMsg);
  return true;
}

function renderProcessAdmin(){
  const table = document.getElementById('processTable');
  if(!table) return;
  const unlocked = processUnlocked();
  const counts = {};
  state.records.forEach(r=>{ if(!r.voided) counts[r.process] = (counts[r.process] || 0) + 1; });
  table.innerHTML = '<thead><tr><th>#</th><th>ชื่อขั้น</th><th>ชื่อสั้น</th><th>สถานะ</th><th>ยอดที่คีย์ไว้ (รายการ)</th><th></th></tr></thead><tbody>'
    + PROCESS_LIST.map((p, i)=>{
      const locked = LOCKED_PROCESS_IDS.includes(p.id);
      const status = (locked ? '<span class="badge gray">ล็อก</span>'
        : p.hidden ? '<span class="badge amber">ซ่อนอยู่</span>' : '<span class="badge green">แสดง</span>')
        // ชนิดของขั้นเปลี่ยนทีหลังไม่ได้ จึงต้องเห็นได้ตลอดว่าขั้นไหนไม่ได้อยู่ในสายการผลิต
        // ⚠️ ต้องมีคลาสสีด้วย — `.badge` เปล่า ๆ ไม่มีพื้นหลัง จะออกมาเป็นตัวหนาเล็ก ๆ ไม่เหมือนป้ายอื่น
        + (p.standalone ? ' <span class="badge gray" title="ยอดไม่เกี่ยวกับสายหลัก ไม่มีการ์ด WIP และไม่ถูกตัดสินล่าช้า">นับแยก</span>' : '');
      const who = p.updatedBy || p.addedBy;
      const audit = who ? `<div class="hint">${escapeHtml((p.updatedBy ? 'แก้ล่าสุดโดย ' : 'เพิ่มโดย ') + who)}</div>` : '';
      const actions = unlocked && !locked
        ? `<button class="btn-mini" data-proc-rename="${p.id}">เปลี่ยนชื่อ</button> `
          + `<button class="btn-mini" data-proc-toggle="${p.id}">${p.hidden ? 'เลิกซ่อน' : 'ซ่อน'}</button>` : '';
      return `<tr data-proc-row="${p.id}"><td>${i + 1}</td><td class="left">${escapeHtml(p.icon + ' ' + p.label)}${audit}</td>`
        + `<td class="left">${escapeHtml(p.short)}</td><td>${status}</td><td>${numFmt(counts[p.id] || 0)}</td><td>${actions}</td></tr>`;
    }).join('') + '</tbody>';

  document.getElementById('btnProcessUnlock').hidden = unlocked;
  document.getElementById('btnProcessLock').hidden = !unlocked;
  document.getElementById('btnProcessChangePin').hidden = !unlocked;
  document.getElementById('processAddRow').hidden = !unlocked;
  if(unlocked){
    // ตำแหน่งแทรกได้แค่ก่อน Inspection — ตัวเลือกจึงมีแต่ขั้นที่ไม่ล็อก
    const sel = document.getElementById('newProcAfter');
    const keep = sel.value;
    const open = PROCESS_LIST.filter(p=>!LOCKED_PROCESS_IDS.includes(p.id));
    sel.innerHTML = '<option value="__first__">เป็นขั้นแรก</option>'
      + open.map(p=>`<option value="${p.id}">ต่อจาก ${escapeHtml(p.label)}</option>`).join('');
    sel.value = keep==='__first__' || open.some(p=>p.id===keep) ? keep : (open.length ? open[open.length - 1].id : '__first__');
  }
}

function showProcessPin(mode){
  processPinMode = mode;
  document.getElementById('processPinLabel').textContent =
    {set:'ตั้งรหัสหัวหน้าใหม่ (อย่างน้อย 4 ตัว)', verify:'รหัสหัวหน้า', change:'รหัสหัวหน้าเดิม'}[mode];
  document.getElementById('processPin2Field').hidden = mode !== 'set';
  document.getElementById('processPin').value = '';
  document.getElementById('processPin2').value = '';
  document.getElementById('processPinRow').hidden = false;
  document.getElementById('processPin').focus();
}

async function submitProcessPin(){
  const pin = document.getElementById('processPin').value;
  try{
    if(processPinMode === 'set'){
      // ตั้งรหัสทับได้เฉพาะตอนยังไม่เคยมีรหัส หรือเพิ่งใส่รหัสเดิมผ่าน
      if(processAdminInfo && !processPinVerified){ toast('ต้องใส่รหัสหัวหน้าเดิมก่อน'); return; }
      if(pin.length < 4){ toast('รหัสหัวหน้าต้องยาวอย่างน้อย 4 ตัว'); return; }
      if(pin !== document.getElementById('processPin2').value){ toast('รหัสสองช่องไม่ตรงกัน'); return; }
      const salt = randomHex(16);
      const admin = {hash: await sha256Hex(salt + ':' + pin), salt, setBy: state.deviceName || '', setAt: new Date().toISOString()};
      await gsApi('pushSettings', {processAdmin: admin});
      processAdminInfo = admin;
      toast('ตั้งรหัสหัวหน้าแล้ว');
    }else{
      const ok = processAdminInfo && await sha256Hex(processAdminInfo.salt + ':' + pin) === processAdminInfo.hash;
      if(!ok){ toast('รหัสหัวหน้าไม่ถูกต้อง'); return; }
      if(processPinMode === 'change'){ processPinVerified = true; showProcessPin('set'); return; }
    }
    processPinVerified = false;
    processUnlockedUntil = Date.now() + PROCESS_UNLOCK_MS;
    setTimeout(renderProcessAdmin, PROCESS_UNLOCK_MS + 500);   // หมดเวลาแล้วล็อกกลับเอง
    document.getElementById('processPinRow').hidden = true;
    renderProcessAdmin();
  }catch(e){ toast('ทำรายการไม่สำเร็จ: ' + e.message); }
}

document.getElementById('btnProcessUnlock').addEventListener('click', async ()=>{
  if(!syncCfg.url){ toast('ต้องเชื่อมต่อ Google Sheets ก่อน — รายการขั้นต้องเหมือนกันทุกเครื่อง'); return; }
  try{ await refreshProcessSettings(); }
  catch(e){ toast('ดึงรายการขั้นจากเซิร์ฟเวอร์ไม่สำเร็จ: ' + e.message); return; }
  processPinVerified = false;
  showProcessPin(processAdminInfo ? 'verify' : 'set');
});
document.getElementById('btnProcessPinOk').addEventListener('click', submitProcessPin);
['processPin', 'processPin2'].forEach(id=> document.getElementById(id).addEventListener('keydown', e=>{
  if(e.key === 'Enter'){ e.preventDefault(); submitProcessPin(); }
}));
document.getElementById('btnProcessLock').addEventListener('click', ()=>{ processUnlockedUntil = 0; renderProcessAdmin(); });
document.getElementById('btnProcessChangePin').addEventListener('click', ()=>{ processPinVerified = false; showProcessPin('change'); });

document.getElementById('btnProcessAdd').addEventListener('click', ()=>{
  const label = document.getElementById('newProcLabel').value.trim();
  const short = document.getElementById('newProcShort').value.trim() || label;
  if(!label){ toast('ใส่ชื่อขั้นก่อน'); return; }
  if(label.length > 40 || short.length > 20){ toast('ชื่อขั้นยาวไม่เกิน 40 ตัว · ชื่อสั้นไม่เกิน 20 ตัว'); return; }
  if(PROCESS_LIST.some(p=>p.label === label || p.short === short)){ toast('มีขั้นชื่อนี้อยู่แล้ว'); return; }
  const after = document.getElementById('newProcAfter').value;
  const standalone = document.getElementById('newProcStandalone').checked;
  const list = PROCESS_LIST.slice();
  const at = after === '__first__' ? 0 : list.findIndex(p=>p.id === after) + 1;
  if(after !== '__first__' && at <= 0){ toast('เลือกตำแหน่งของขั้นก่อน'); return; }
  const where = after === '__first__' ? 'เป็นขั้นแรก' : 'ต่อจาก ' + PROCESS_LABELS[after];
  // ⚠️ ชนิดของขั้นเปลี่ยนทีหลังไม่ได้ (มีแต่เปลี่ยนชื่อกับซ่อน) จึงต้องบอกให้ชัดตั้งแต่ตอนกด
  const kind = standalone
    ? ' · เป็นขั้นนับแยก ยอดไม่เกี่ยวกับสายหลัก ไม่มีการ์ด WIP และไม่ถูกตัดสินล่าช้า'
    : ' · อยู่ในสายการผลิต';
  if(!confirm(`เพิ่มขั้น "${label}" ${where}?${kind}\n— ทุกเครื่องจะเห็นขั้นนี้หลังซิงค์ · ลบทีหลังไม่ได้ ซ่อนได้อย่างเดียว · ชนิดของขั้นเปลี่ยนทีหลังไม่ได้`)) return;
  list.splice(at, 0, {id: 'p' + Date.now().toString(36), label, short, icon: standalone ? '🧰' : '🔹',
    color: PROCESS_PALETTE.find(c=>!list.some(p=>p.color === c)) || PROCESS_PALETTE[0],
    hidden: false, standalone, addedBy: state.deviceName || '', addedAt: new Date().toISOString()});
  saveProcessList(list, `เพิ่มขั้น ${label} แล้ว`).then(ok=>{
    if(ok){ document.getElementById('newProcLabel').value = ''; document.getElementById('newProcShort').value = '';
      document.getElementById('newProcStandalone').checked = false; }
  });
});

document.getElementById('processTable').addEventListener('click', e=>{
  const renameId = e.target.dataset.procRename, toggleId = e.target.dataset.procToggle;
  const id = renameId || toggleId;
  const p = id && PROCESS_BY_ID[id];
  if(!p || LOCKED_PROCESS_IDS.includes(id)) return;
  const by = state.deviceName || '', now = new Date().toISOString();
  if(renameId){
    const l = prompt('ชื่อขั้น — ขึ้นบนปุ่มเลือกขั้นและหัวคอลัมน์สะสม (ไม่เกิน 40 ตัว)', p.label);
    if(l === null || !l.trim()) return;
    const s = prompt('ชื่อสั้น — หัวตาราง Dashboard สถานะล่าช้า รายงาน (ไม่เกิน 20 ตัว)', p.short);
    if(s === null) return;
    const label = l.trim(), short = s.trim() || label;
    if(label.length > 40 || short.length > 20){ toast('ชื่อขั้นยาวไม่เกิน 40 ตัว · ชื่อสั้นไม่เกิน 20 ตัว'); return; }
    if(PROCESS_LIST.some(x=>x.id !== id && (x.label === label || x.short === short))){ toast('มีขั้นชื่อนี้อยู่แล้ว'); return; }
    saveProcessList(PROCESS_LIST.map(x=> x.id === id ? Object.assign({}, x, {label, short, updatedBy: by, updatedAt: now}) : x),
      `เปลี่ยนชื่อเป็น ${label} แล้ว`);
    return;
  }
  // ⚠️ นับเฉพาะขั้นในสายการผลิต — ขั้นนับแยกไม่ใช่ขั้นผลิต ถ้านับรวมด้วยจะซ่อนสายหลักจนหมด
  //    แล้วเหลือแต่ขั้นนับแยก ซึ่งแปลว่าไม่มีขั้นไหนป้อนยอดเข้าสายให้ Inspection อีกเลย
  if(!p.hidden && !p.standalone && PROCESS_LIST.filter(x=>!x.hidden && !x.standalone && !LOCKED_PROCESS_IDS.includes(x.id)).length <= 1){
    toast('ต้องเหลือขั้นผลิตที่แสดงอยู่อย่างน้อยหนึ่งขั้น'); return;
  }
  const n = state.records.filter(r=>!r.voided && r.process === id).length;
  const msg = p.hidden ? `เลิกซ่อนขั้น "${p.label}"? ปุ่มและคอลัมน์จะกลับมาทุกเครื่อง`
    : `ซ่อนขั้น "${p.label}"? ปุ่ม คอลัมน์ การ์ด จะหายไปจากทุกเครื่อง`
      + (n ? ` · ยอดที่คีย์ไว้ ${numFmt(n)} รายการยังอยู่ แต่จะไม่ถูกนับจนกว่าจะเลิกซ่อน` : '');
  if(!confirm(msg)) return;
  saveProcessList(PROCESS_LIST.map(x=> x.id === id ? Object.assign({}, x, {hidden: !p.hidden, updatedBy: by, updatedAt: now}) : x),
    p.hidden ? `เลิกซ่อน ${p.label} แล้ว` : `ซ่อน ${p.label} แล้ว`);
});

document.getElementById('entryDate').addEventListener('change', renderEntryTable);
document.getElementById('entrySearch').addEventListener('input', renderEntryTable);
document.getElementById('entryWeekFilter').addEventListener('change', renderEntryTable);
document.getElementById('entrySubFilter').addEventListener('change', renderEntryTable);
document.getElementById('entryHideDone').addEventListener('change', renderEntryTable);

document.getElementById('recFilterDate').addEventListener('change', renderRecordEditor);
document.getElementById('recFilterProcess').addEventListener('change', renderRecordEditor);
document.getElementById('recFilterSource').addEventListener('change', renderRecordEditor);
document.getElementById('recFilterSearch').addEventListener('input', renderRecordEditor);
document.getElementById('recShowVoided').addEventListener('change', renderRecordEditor);
document.getElementById('btnRecDeleteSelected').addEventListener('click', ()=>{
  if(!recSelectedIds.size){ toast('ยังไม่ได้เลือกรายการ'); return; }
  if(!confirm(`ลบ ${recSelectedIds.size} รายการที่เลือก? (กู้คืนได้ทีหลัง)`)) return;
  const n = voidRecords(Array.from(recSelectedIds));
  toast(`ลบแล้ว ${n} รายการ`);
});

document.getElementById('dashWeekFilter').addEventListener('change', renderDashTable);
// ⚠️ หน่วยคุมทั้งหน้า จึงต้องวาดใหม่ครบทั้งสามส่วน ไม่ใช่แค่ตาราง
document.getElementById('dashSubFilter').addEventListener('change', ()=>{
  renderWipCards(); renderChart(); renderDashTable();
});
document.getElementById('dashStatusFilter').addEventListener('change', renderDashTable);
document.getElementById('dashWipFilter').addEventListener('change', renderDashTable);
document.getElementById('dashSearch').addEventListener('input', renderDashTable);
['fgUnit','fgHideZero'].forEach(id=>
  document.getElementById(id).addEventListener('change', renderFg));
// ช่องค้นหาอยู่นอกตาราง การวาดใหม่จึงไม่แย่งโฟกัส พิมพ์รัวได้ (INVARIANTS G2)
document.getElementById('fgSearch').addEventListener('input', renderFg);
document.getElementById('btnFgCardClose').addEventListener('click', ()=>{
  document.getElementById('fgCardPanel').style.display = 'none';
});

document.getElementById('dnDate').addEventListener('change', renderDeliveryNote);
// ช่องค้นหาอยู่นอกตาราง การวาดตารางใหม่จึงไม่แย่งโฟกัสไปจากมัน พิมพ์รัวได้ (INVARIANTS G2)
document.getElementById('dnSearch').addEventListener('input', renderDeliveryNote);
document.getElementById('dnHideNoDelta').addEventListener('change', renderDeliveryNote);
document.getElementById('dnUnit').addEventListener('change', renderDeliveryNote);
document.getElementById('dashHideDone').addEventListener('change', renderDashTable);

/* พิมพ์ / บันทึก PDF — ใช้ window.print() ของเบราว์เซอร์ล้วน ไม่เพิ่มไลบรารีทำ PDF (INVARIANTS F2)
   เขียนหัวกระดาษก่อนพิมพ์เสมอ ทั้งตอนกดปุ่มและตอนคนกด Ctrl+P เอง เพราะกระดาษที่ไม่บอกว่า
   กรองอะไรอยู่ / พิมพ์เมื่อไหร่ / รุ่นไหน จะถูกหยิบไปใช้ผิดใบได้ */
function fillPrintHeader(){
  const selText = id=>{ const el=document.getElementById(id); const o=el.options[el.selectedIndex]; return o ? o.textContent : 'ทั้งหมด'; };
  const parts = [
    'สัปดาห์: '+selText('dashWeekFilter'),
    'Sub-Name: '+selText('dashSubFilter'),
    'สถานะ: '+selText('dashStatusFilter'),
    'ค้างอยู่ที่ขั้น: '+selText('dashWipFilter')
  ];
  const search = document.getElementById('dashSearch').value.trim();
  if(search) parts.push('ค้นหา: '+search);
  /* กระดาษที่มีกราฟซ่อนขั้นอยู่ ต้องบอกว่าซ่อนอะไร ไม่งั้นคนอ่านจะสรุปว่าขั้นนั้นไม่มียอดเลย
     เหตุผลเดียวกับที่ต้องบอกว่าซ่อนงานที่ส่งครบแล้ว */
  const hiddenProcs = Array.from(chartHiddenProcs());
  if(hiddenProcs.length) parts.push('กราฟซ่อนขั้น: '+hiddenProcs.map(x=>PROCESS_LABELS[x]||x).join(', '));
  // กระดาษที่ไม่บอกว่าซ่อนอะไรไว้ จะถูกอ่านว่า "งานทั้งหมดมีเท่านี้" ซึ่งไม่จริง
  if(document.getElementById('dashHideDone').checked) parts.push('ซ่อนงานที่ส่งของครบแล้ว');
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  parts.push('พิมพ์เมื่อ '+fmtDateTH(todayISO())+' '+hhmm);
  parts.push('รุ่น '+(APP_VERSION||'ไม่ทราบ'));
  document.getElementById('printMeta').textContent = parts.join(' · ');
}
document.getElementById('btnPrintDash').addEventListener('click', ()=>{ fillPrintHeader(); window.print(); });
window.addEventListener('beforeprint', fillPrintHeader);

/* หัวกระดาษของกล่อง "แก้ไข / ลบรายการที่บันทึกแล้ว" — แยกจาก fillPrintHeader ของ Dashboard
   เพราะคนละตัวกรองและคนละ "ณ วันที่" กัน เอามารวมใบเดียวจะอ่านผิดวัน */
function fillRecPrintHeader(){
  const selText = id=>{ const el=document.getElementById(id); const o=el.options[el.selectedIndex]; return o ? o.textContent : 'ทั้งหมด'; };
  const dateF = document.getElementById('recFilterDate').value;
  const parts = [
    'ยอดของวันที่: '+(dateF ? fmtDateTH(dateF) : 'ทุกวัน'),
    'Process: '+selText('recFilterProcess'),
    'แหล่งที่มา: '+selText('recFilterSource')
  ];
  const search = document.getElementById('recFilterSearch').value.trim();
  if(search) parts.push('ค้นหา: '+search);
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  parts.push('พิมพ์เมื่อ '+fmtDateTH(todayISO())+' '+hhmm);
  parts.push('รุ่น '+(APP_VERSION||'ไม่ทราบ'));
  document.getElementById('recPrintMeta').textContent = parts.join(' · ');
}
document.getElementById('btnPrintRecords').addEventListener('click', ()=>{ fillRecPrintHeader(); window.print(); });
window.addEventListener('beforeprint', fillRecPrintHeader);
document.getElementById('chartRange').addEventListener('change', ()=>{
  toggleChartCustomFields();
  if(document.getElementById('chartRange').value === 'custom'
     && !document.getElementById('chartFrom').value && !document.getElementById('chartTo').value){
    document.getElementById('chartTo').value = todayISO();
    document.getElementById('chartFrom').value = addDaysISO(todayISO(), -13);
  }
  saveChartPref();
  renderChart();
});
document.getElementById('chartFrom').addEventListener('change', ()=>{ saveChartPref(); renderChart(); });
document.getElementById('chartTo').addEventListener('change', ()=>{ saveChartPref(); renderChart(); });

/* ย่อ/ขยายหน้าต่างแล้ววาดกราฟใหม่ — ความกว้างของกราฟยึดจากกล่องที่มันอยู่ ถ้าไม่วาดใหม่
   กราฟจะค้างขนาดเดิมจนล้นออกนอกจอ (บนมือถือคือตอนหมุนเครื่อง)
   หน่วงไว้ก่อนวาด เพราะเบราว์เซอร์ยิง resize รัวมากระหว่างลาก และข้ามไปถ้าแท็บอื่นเปิดอยู่ */
/* กดที่คำอธิบายสีเพื่อซ่อน/แสดงขั้นนั้นในกราฟ — ผูกไว้ที่กล่องแม่ เพราะปุ่มถูกวาดใหม่ทุกครั้ง */
document.getElementById('chartLegend').addEventListener('click', e=>{
  const btn = e.target.closest('.legend-item');
  if(!btn) return;
  const hidden = chartHiddenProcs();
  if(hidden.has(btn.dataset.proc)) hidden.delete(btn.dataset.proc);
  else hidden.add(btn.dataset.proc);
  // ⚠️ ห้ามปิดจนไม่เหลือสักขั้น · กราฟเปล่าจะถูกอ่านว่า "ช่วงนี้ไม่มียอด" ซึ่งไม่จริง
  if(hidden.size >= PROCESSES.length){ toast('ต้องเหลือไว้อย่างน้อยหนึ่งขั้น'); return; }
  state.chartPref = Object.assign({}, state.chartPref, {hidden: Array.from(hidden)});
  saveState();
  renderChart();
});

let chartResizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(()=>{
    const el = document.getElementById('chartWrap');
    if(el && el.clientWidth > 0) renderChart();
  }, 150);
});

document.getElementById('btnSaveSettings').addEventListener('click', ()=>{
  state.deviceName = document.getElementById('deviceName').value.trim();
  /* ⚠️ เริ่มจากค่าเดิมทั้งก้อน ไม่ใช่สร้างใหม่จากช่องบนจอ
   *    ค่าวันของขั้นที่เครื่องนี้ไม่มีช่องกรอก (เช่นขั้นที่เครื่องอื่นเพิ่มไว้) ต้องไม่หายตอนกดบันทึก
   *    เดิมสร้างใหม่จากห้าช่อง key อื่นจึงหายแล้วถูกดันขึ้นเซิร์ฟเวอร์ทับของทุกเครื่อง
   * ช่องว่าง: ขั้นที่ตั้งต้นว่า "ยังไม่กำหนด" เก็บเป็น null · ขั้นอื่นเก็บเป็น 0 ตามพฤติกรรมเดิม */
  const offsets = Object.assign({}, state.deadlineOffsets);
  PROCESSES.forEach(p=>{
    const d = PROCESS_BY_ID[p];
    const raw = document.getElementById(offsetInputId(d)).value.trim();
    offsets[p] = raw==='' && d.defaultOffset===null ? null : (Number(raw)||0);
  });
  state.deadlineOffsets = offsets;
  saveState();
  toast('บันทึกการตั้งค่าแล้ว');
  renderWipCards();
  renderDashTable();
  if(syncCfg.url){ gsApi('pushSettings', {deadlineOffsets: state.deadlineOffsets}).catch(()=>{}); }
});

document.getElementById('btnExportJson').addEventListener('click', ()=>{
  const payload = JSON.stringify(state, null, 2);
  const safeName = (state.deviceName||'device').replace(/[^a-zA-Z0-9ก-๙_-]+/g,'_');
  downloadBlob(payload, `order_tracker_${safeName}_${todayISO()}.json`, 'application/json');
});

document.getElementById('mergeFileInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  try{
    const text = await file.text();
    const incoming = JSON.parse(text);
    if(!incoming || !Array.isArray(incoming.orders) || !Array.isArray(incoming.records)){
      toast('ไฟล์ไม่ถูกต้อง — ต้องเป็นไฟล์ที่ export จากโปรแกรมนี้');
      e.target.value=''; return;
    }
    pendingMerge = computeMergePlan(incoming);
    showMergeModal(pendingMerge);
  }catch(err){
    toast('อ่านไฟล์ไม่สำเร็จ: '+err.message);
  }
  e.target.value='';
});
document.getElementById('mergeCancelBtn').addEventListener('click', ()=>{
  document.getElementById('mergeModal').classList.remove('show');
  pendingMerge = null;
});
document.getElementById('mergeModal').addEventListener('click', (e)=>{
  if(e.target.id==='mergeModal'){
    e.currentTarget.classList.remove('show');
    pendingMerge = null;
  }
});
document.getElementById('mergeConfirmBtn').addEventListener('click', ()=>{
  if(!pendingMerge) return;
  applyMerge(pendingMerge);
  document.getElementById('mergeModal').classList.remove('show');
  pendingMerge = null;
  toast('รวมข้อมูลสำเร็จ');
  renderAll();
});

document.getElementById('btnExportExcel').addEventListener('click', exportExcelReport);

/* ---------- หน้าจอ: กรอกฟอร์ม Daily Call In ---------- */

function resetCallIn(){
  pendingCallIn = null;
  document.getElementById('callInPreviewPanel').style.display = 'none';
  const sel = document.getElementById('callInSheet');
  sel.innerHTML = '<option>— เปิดไฟล์ก่อน —</option>';
  sel.disabled = true;
  document.getElementById('btnCallInScan').disabled = true;
}

document.getElementById('callInFileInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  resetCallIn();
  if(rejectLegacyXls(file)) return;
  toast('กำลังอ่านไฟล์...');
  try{
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    if(!zip.file('xl/workbook.xml')) throw new Error('ไม่ใช่ไฟล์ Excel (.xlsx)');
    pendingCallIn = {zip, sheetMap: await sheetPathMap(zip), fileName: file.name};
  }catch(err){
    toast('เปิดไฟล์ไม่สำเร็จ: '+err.message);
    return;
  }
  const sel = document.getElementById('callInSheet');
  sel.innerHTML = '';
  Object.keys(pendingCallIn.sheetMap).forEach(nm=>{
    const opt = document.createElement('option');
    opt.value = nm; opt.textContent = nm;
    sel.appendChild(opt);
  });
  sel.disabled = false;
  document.getElementById('btnCallInScan').disabled = false;
});

document.getElementById('btnCallInScan').addEventListener('click', async ()=>{
  if(!pendingCallIn){ toast('เลือกไฟล์ก่อนครับ'); return; }
  const name = document.getElementById('callInSheet').value;
  const path = pendingCallIn.sheetMap[name];
  const read = await readCallInSheet(pendingCallIn.zip, path);
  if(read.error){ toast(read.error); return; }
  if(!read.items.length){ toast('ไม่พบแถวที่มีทั้ง P/N และ PO ในชีตนี้'); return; }

  pendingCallIn.week = weekFromSheetName(name);
  pendingCallIn.items = read.items;
  pendingCallIn.plan = planCallIn(read.items);
  renderCallInPreview();
});

function renderCallInPreview(){
  const p = pendingCallIn.plan;
  const willChange = p.update.filter(u=>u.changed);

  const rows = [];
  willChange.slice(0, 200).forEach(u=>{
    rows.push(`<tr>
      <td><span class="badge amber">ไม่ตรงกัน</span></td>
      <td>${escapeHtml(u.it.rowNo)}</td>
      <td class="left">${escapeHtml(u.it.po)}</td>
      <td class="left">${escapeHtml(u.it.pn)}</td>
      <td>${escapeHtml(u.it.fileWip || '—')}</td>
      <td><b>${numFmt(u.wip)}</b></td>
    </tr>`);
  });
  p.missingRow.slice(0, 50).forEach(m=>{
    rows.push(`<tr>
      <td><span class="badge gray">ไม่มีในไฟล์ Delta</span></td>
      <td>—</td>
      <td class="left">${escapeHtml(m.o.poNo)}</td>
      <td class="left">${escapeHtml(m.o.pn)}</td>
      <td>—</td>
      <td><b>${numFmt(m.wip)}</b></td>
    </tr>`);
  });
  // แถวพวกนี้ไม่ต้องทำอะไร แสดงไว้พอให้เห็นว่ามีอยู่ ถ้าโชว์หมดจะดันแถวที่ต้องดูจริงตกจอ
  p.missingOrder.slice(0, 15).forEach(it=>{
    rows.push(`<tr>
      <td><span class="badge gray">ไม่มีใบนี้ในแอป</span></td>
      <td>${escapeHtml(it.rowNo)}</td>
      <td class="left">${escapeHtml(it.po)}</td>
      <td class="left">${escapeHtml(it.pn)}</td>
      <td>${escapeHtml(it.fileWip || '—')}</td>
      <td>—</td>
    </tr>`);
  });

  document.getElementById('callInTable').innerHTML =
    `<thead><tr><th style="width:130px">ประเภท</th><th style="width:60px">แถว</th><th>PO No.</th><th>P/N</th>
      <th style="width:110px">ยอด Delta</th><th style="width:110px">ยอดเรา</th></tr></thead>
     <tbody>${rows.join('') || emptyRow(6,'ไม่มีอะไรต้องเปลี่ยน')}</tbody>`;

  const parts = [
    `จับคู่ PO ได้ <b>${numFmt(p.update.length)}</b> แถว · <b>ยอดไม่ตรงกัน ${numFmt(willChange.length)} แถว</b>`,
    `แถวในไฟล์ที่ไม่มีใบนั้นในแอป <b>${numFmt(p.missingOrder.length)}</b> — Delta รู้จัก เราไม่รู้จัก`,
    `ใบที่เรายังส่งไม่ครบ แต่ไม่มีแถวในไฟล์ <b>${numFmt(p.missingRow.length)}</b> — เรารู้จัก Delta ไม่มี`
  ];
  if(p.qtyMismatch.length){
    parts.push(`⚠️ <b>PO QTY ไม่ตรงกัน ${numFmt(p.qtyMismatch.length)} แถว</b> — ร้ายแรงกว่ายอดค้างไม่ตรง ต้องหาว่าฝั่งไหนถูก`);
  }
  if(p.missingOrder.length > 15) parts.push(`(ตารางข้างล่างแสดงแถวที่ไม่มีใบในแอปแค่ 15 จาก ${numFmt(p.missingOrder.length)} แถว)`);
  parts.push('หน้านี้อ่านอย่างเดียว ไม่แก้ไฟล์ของ Delta และไม่เปลี่ยนข้อมูลในแอป');
  document.getElementById('callInSummary').innerHTML = parts.join('<br>');
  document.getElementById('callInPreviewPanel').style.display = '';
}

document.getElementById('btnDeltaWipSave').addEventListener('click', ()=>{
  if(!pendingCallIn || !pendingCallIn.items) return;
  const week = pendingCallIn.week
    || prompt('ชื่อชีตไม่ได้บอกเลขสัปดาห์ — พิมพ์เลขสัปดาห์ของไฟล์นี้ (เช่น 34)');
  if(!week) return;
  const r = saveDeltaWip(pendingCallIn.items, week, pendingCallIn.fileName);
  /* ⚠️ ห้ามรายงาน r.cleared เป็น "ลบไปกี่ใบ" — ขอบเขตการล้างคือใบที่อยู่ในชีตนี้
   *    ทุกใบที่ถูกล้างจึงถูกเขียนทับด้วยของใหม่ทันทีเสมอ ไม่มีอะไรหายไปจริง */
  const total = r.added + r.updated;
  toast(`เก็บยอดของ Delta งวด wk${week} แล้ว — ${total} ใบในชีตนี้`
      + (r.blank ? ` (มียอด ${total - r.blank} · Delta เว้นช่องว่างไว้ ${r.blank})` : '')
      + ` · ใบที่ไม่ได้อยู่ในชีตนี้ไม่ถูกแตะ`);
  renderSyncBadge();
  renderDeliveryNote();
});

document.getElementById('btnCallInCancel').addEventListener('click', ()=>{
  resetCallIn();
  document.getElementById('callInFileInput').value = '';
});

document.getElementById('btnClearAll').addEventListener('click', ()=>{
  if(!confirm('ยืนยันลบข้อมูลทั้งหมด? การกระทำนี้ไม่สามารถย้อนกลับได้')) return;
  /* ⚠️ **ฟอร์ม FM-ST-07 ที่จำไว้ไม่ถูกลบ** — เจ้าของเคาะเมื่อ 25 ต.ค. 2026
   *    เป็นฟอร์มเปล่าของบริษัท ไม่ใช่ข้อมูลธุรกิจ จึงไม่อยู่ในความหมายของ "ลบข้อมูลทั้งหมด"
   *    แต่ต้องเขียนไว้ในกล่องยืนยัน ไม่ใช่เหลือของไว้เงียบ ๆ ทั้งที่ปุ่มอ้างว่าลบทั้งหมด
   *    (ผู้ตรวจ #112 ทักว่าคำกับของไม่ตรงกัน) · ล้างได้ที่ปุ่มของมันเองในหน้าใบส่งสินค้า */
  if(!confirm('ยืนยันอีกครั้ง: ต้องการลบข้อมูลแผนงานและบันทึกทั้งหมดในเครื่องนี้จริงหรือไม่?'
    + String.fromCharCode(10) + String.fromCharCode(10)
    + 'หมายเหตุ: ฟอร์ม FM-ST-07 ที่เครื่องนี้จำไว้ จะไม่ถูกลบ'
    + String.fromCharCode(10) + 'ถ้าต้องการล้างด้วย ให้กดปุ่มล้างฟอร์มที่จำไว้ในหน้าใบส่งสินค้า')) return;
  state = defaultState();
  saveState();
  if(stateDb) idbTx('readwrite', s=>s.delete(LEGACY_COPY_KEY)).catch(e=>console.error('ลบสำเนาตอนย้ายไม่ได้', e));   // สำเนาก็เป็นข้อมูลในเครื่อง
  /* ล้างเฉพาะข้อมูลในเครื่องนี้ ไม่แตะเซิร์ฟเวอร์ — ถ้าเคยต่อ Google Sheets ไว้ ให้รีเซ็ตเวลา
   * ดึงข้อมูลกลับไปเป็นค่าว่าง เพื่อให้ซิงค์รอบถัดไปดึงของทั้งหมดจากเซิร์ฟเวอร์กลับมาใหม่
   *
   * ⚠️ ต้องเรียก resetPullClocks() ห้ามเขียนรายชื่อนาฬิกาเองที่นี่
   *    ของเดิมเขียนเอง แล้วล้างแค่ Orders กับ Records ทั้งที่ defaultState() ล้างทุกตาราง
   *    ใบส่งสินค้ากับยอดของ Delta จึงหายถาวรจากเครื่องนี้ ทั้งที่เซิร์ฟเวอร์ยังมีครบ
   *    (ผู้ตรวจจับได้ใน #70) */
  if(syncCfg.url){ resetPullClocks(); saveSyncCfg(); }
  toast('ลบข้อมูลทั้งหมดแล้ว');
  loadSettingsIntoForm();
  renderAll();
  renderSyncBadge();
  if(syncCfg.url) doSync();
});

/* ---------- Google Sheets sync: UI bindings ---------- */
document.getElementById('gsUrl').addEventListener('change', ()=>{
  syncCfg.url = document.getElementById('gsUrl').value.trim();
  saveSyncCfg(); renderSyncBadge();
});
document.getElementById('gsToken').addEventListener('change', ()=>{
  syncCfg.token = document.getElementById('gsToken').value;
  saveSyncCfg();
});
document.getElementById('gsAuto').addEventListener('change', ()=>{
  syncCfg.auto = document.getElementById('gsAuto').checked;
  saveSyncCfg();
});
document.getElementById('btnGsTest').addEventListener('click', ()=>{
  syncCfg.url = document.getElementById('gsUrl').value.trim();
  syncCfg.token = document.getElementById('gsToken').value;
  gsTestConn();
});
document.getElementById('btnGsConnect').addEventListener('click', ()=>{
  syncCfg.url = document.getElementById('gsUrl').value.trim();
  syncCfg.token = document.getElementById('gsToken').value;
  gsConnectAndPull();
});
document.getElementById('btnGsCopyLink').addEventListener('click', gsCopySetupLink);
document.getElementById('btnGsResetPull').addEventListener('click', gsResetPullClock);
document.getElementById('btnGsGuide').addEventListener('click', ()=>{
  toast('ดูวิธีตั้งค่าได้ในไฟล์ คู่มือติดตั้ง_GoogleSheets.md (โฟลเดอร์เดียวกับไฟล์นี้)');
});
document.getElementById('syncBadge').addEventListener('click', ()=>doSync(false));

/* ---------- App version / update check ---------- */
/* เครื่องในโรงงานเปิดโปรแกรมค้างไว้ทั้งวัน และเบราว์เซอร์ก็ cache ไฟล์เก่าไว้ได้
   เลขรุ่นบนหัวจอคือสิ่งเดียวที่ใช้ตัดสินทางโทรศัพท์ได้ว่าสองเครื่องใช้ของเดียวกันไหม
   วิธีเช็กรุ่นใหม่: fetch ไฟล์ตัวเองแบบข้าม cache แล้วอ่าน <meta> จากข้อความที่ได้มา
   — ไม่ต้องเพิ่มไฟล์ใหม่ ยังเป็นไฟล์เดียวเหมือนเดิม (INVARIANTS F2/F4) */
const APP_VERSION = (document.querySelector('meta[name="app-version"]')||{}).content || '';
const APP_VERSION_RE = /<meta\s+name="app-version"\s+content="([^"]*)"/i;
const UPDATE_CHECK_MS = 30*60*1000;   // ไฟล์เกือบ 1 MB — เช็กถี่กว่านี้เน็ตโรงงานรับไม่ไหว
let lastUpdateCheck = 0;

async function checkAppUpdate(){
  // กันยิงรัวตอนคนสลับหน้าจอไปมา
  if(Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
  if(!APP_VERSION) return;
  if(location.protocol !== 'http:' && location.protocol !== 'https:') return;  // เปิดจากไฟล์ในเครื่อง = เช็กไม่ได้
  lastUpdateCheck = Date.now();
  try{
    const bust = (location.search ? location.search+'&' : '?') + '_v=' + Date.now();
    const res = await fetch(location.pathname + bust, { cache:'no-store' });
    if(!res.ok) return;
    const m = APP_VERSION_RE.exec(await res.text());
    if(m && m[1] && m[1] !== APP_VERSION) document.getElementById('updateBadge').hidden = false;
  }catch(e){
    // เน็ตโรงงานหลุดเป็นเรื่องปกติ — เช็กไม่ได้ก็เงียบไว้ ห้ามขึ้น error ขวางการคีย์ยอด
  }
}

document.getElementById('appVersion').textContent = APP_VERSION || 'ไม่ทราบ';
// ห้ามโหลดหน้าใหม่เอง — รอให้คนกดปุ่มเท่านั้น (ยอดที่คีย์ค้างในช่องถูกบันทึกตอนออกจากช่องอยู่แล้ว)
// ใส่ query กันไว้ไม่ให้เบราว์เซอร์หยิบไฟล์เก่าใน cache กลับมาให้อีก
document.getElementById('updateBadge').addEventListener('click', ()=>{
  location.replace(location.pathname + '?_v=' + Date.now());
});
document.getElementById('btnProcessWarnReload').addEventListener('click', ()=>{
  location.replace(location.pathname + '?_v=' + Date.now());
});
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) checkAppUpdate(); });
setInterval(checkAppUpdate, UPDATE_CHECK_MS);
checkAppUpdate();

/* ---------- Init ---------- */
document.getElementById('entryDate').value = todayISO();
document.getElementById('dnDate').value = todayISO();

// เครื่องใหม่เปิดผ่านลิงก์ตั้งค่า (#gsurl=...&gstoken=...) — ตั้งค่าและดึงข้อมูลให้อัตโนมัติ
// แล้วลบรหัสออกจากแถบที่อยู่ทันทีเพื่อไม่ให้ค้างอยู่ในประวัติเบราว์เซอร์
(function(){
  const hash = location.hash.slice(1);
  if(!hash) return;
  const params = new URLSearchParams(hash);
  const hUrl = params.get('gsurl');
  if(!hUrl) return;
  syncCfg.url = hUrl;
  syncCfg.token = params.get('gstoken') || '';
  saveSyncCfg();
  history.replaceState(null, '', location.pathname + location.search);
  gsConnectAndPull();
})();

document.getElementById('gsUrl').value = syncCfg.url;
document.getElementById('gsToken').value = syncCfg.token;
document.getElementById('gsAuto').checked = syncCfg.auto;
renderSyncBadge();
if(syncCfg.url && syncCfg.auto){ doSync(); }
syncIntervalId = setInterval(()=>{ if(syncCfg.url && syncCfg.auto) doSync(); }, 20000);
openState();


