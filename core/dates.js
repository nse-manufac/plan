"use strict";
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
/** วันที่ของใบสั่งที่เป็นไปไม่ได้ — ก่อนปี 2000 · เลยวันนี้ไปเกินหนึ่งปี · หรืออ่านเป็นวันที่ไม่ได้
 *  ⚠️ เจอจริง ต.ค. 2026: เครื่องหนึ่งถือ orderDate ปี 1901 (= ยอดสั่งที่ถูกอ่านเป็นเลขวันที่ของ Excel)
 *     Aging ขึ้นหลักหมื่นวันและทุกขั้นขึ้นล่าช้า ทั้งที่ชีตกับเครื่องอื่นเป็นปี 2026
 *  ช่องว่างไม่นับ — "ไม่มีวันที่" เป็นอีกกรณีหนึ่งที่ computeStatus จัดการแยกไว้แล้ว */
function implausibleDate(iso, refISO){
  if(iso==null || iso==='') return false;
  const s = normalizeDateOnly(iso);
  if(typeof s !== 'string' || !dateFromISO(s)) return true;
  return s < '2000-01-01' || s > addDaysISO(refISO, 366);
}
function fmtDateTH(iso){
  const s = normalizeDateOnly(iso);
  if(!s || typeof s !== 'string') return '-';
  const parts = s.split('-');
  if(parts.length!==3) return '-';
  const [y,m,d]=parts;
  return `${d}/${m}/${y}`;
}
