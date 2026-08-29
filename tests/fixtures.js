// สร้างไฟล์ Excel ปลอมสำหรับเทสนำเข้า
//
// ── ทำไมต้องสร้างเอง ไม่ใช้ไฟล์จริง ──────────────────────────────
// repo นี้เป็น public (INVARIANTS F3) ไฟล์แผนผลิตจริงมีชื่อลูกค้า เลข PO และยอดจริง
// เอาเข้ามาเป็น fixture ไม่ได้ จึงประกอบไฟล์ที่มี "รูปร่างเหมือนของจริง" ขึ้นมาแทน
// โครงคอลัมน์ด้านล่างลอกจากไฟล์จริงทีละช่อง (หัวตารางอยู่แถว 7 ข้อมูลเริ่มแถว 9)
//
// เขียนวันที่เป็น cell แบบวันที่จริง ไม่ใช่ข้อความ เพื่อให้เดินผ่านเส้นทางแปลงวันที่
// เส้นเดียวกับไฟล์ของลูกค้า — ซึ่งเป็นจุดที่ INVARIANTS หมวด C เคยพังมาแล้ว

const ExcelJS = require('exceljs');

/** บังคับให้ชีตประกาศขอบเขตตั้งแต่ A1
 *
 *  ⚠️ กับดักที่เสียเวลาไปแล้วรอบหนึ่ง — ไฟล์ที่ Excel เขียนเองประกาศ <dimension ref="A1:...">
 *  เสมอ แม้แถวบน ๆ จะว่าง ตัวอ่านของแอปจึงนับแถวที่ 1 เป็นดัชนี 0 ได้ตรง ๆ
 *  แต่ ExcelJS คำนวณขอบเขตจาก "ช่องแรกที่มีค่า" ถ้า fixture ไม่มีอะไรอยู่แถว 1
 *  ดัชนีทั้งชีตจะเลื่อนขึ้น แล้วเทสจะฟ้องว่าแอปพัง ทั้งที่ fixture ต่างหากที่ไม่เหมือนของจริง */
function anchorTopLeft(ws) {
  ws.getCell('A1').value = '';
}

/** แผนงานรายสัปดาห์ (เลียนแบบ "ใบรับ Order 26.xlsx")
 *  คอลัมน์ตามไฟล์จริง: C=Sub-Name D=OSC E=Pc F=P/N G=PO No. H=Order Date
 *  I=Delta Req(ETD) J=VENDOR(ETA) K=Aging L=Open Q'ty M=แผน Winding N=แผน Assembly O=แผน Inspection
 *  และคอลัมน์ P ที่หัวเขียนว่า "Plan Support" — โค้ดหาคอลัมน์นี้จากข้อความหัว ไม่ได้ fix ตำแหน่ง */
async function planWorkbook(rows, opts = {}) {
  const wb = new ExcelJS.Workbook();

  // ชีตที่ซ่อน + เลข WK สูงกว่า — ตัวเลือกอัตโนมัติต้องไม่ไปเลือกอันนี้
  if (opts.withHidden !== false) {
    const hidden = wb.addWorksheet('WK 99 ของเก่า');
    hidden.state = 'hidden';
    hidden.getCell('A1').value = 'ไม่ควรถูกเลือกอัตโนมัติ';
  }

  const ws = wb.addWorksheet(opts.sheetName || 'WK 30  26-29.7.26');
  anchorTopLeft(ws);
  ws.getCell('A4').value = 'Thai Union Electronics Co.,Ltd.';
  // ⚠️ ห้ามใช้ row.values = [...] — ExcelJS ตอนเขียนนับคอลัมน์จากศูนย์ แต่ตอนอ่านนับจากหนึ่ง
  //    เขียนแบบนั้นแล้วหัวตารางเลื่อนไปหนึ่งช่องเงียบ ๆ ใช้ getCell(n) ที่ n = A คือ 1 แทนเสมอ
  const head = ws.getRow(7);
  [[1,'No.'], [2,'Code'], [4,'OSC'], [5,'Pc delta'], [6,'P/N'], [7,'PO No.'], [8,'Order Date'],
   [9,'Delta Req(ETD)'], [10,'VENDOR (ETA)'], [11,'Aging'], [12,"Open Q'ty"],
   [13,'Plan Winding'], [14,'Plan Assembly'], [15,'Plan Inspection'], [16,'Plan Support']
  ].forEach(([c, v]) => { head.getCell(c).value = v; });
  ws.getRow(8).getCell(3).value = 'Sub-Name';

  rows.forEach((r, i) => {
    const row = ws.getRow(9 + i);
    row.getCell(1).value = i + 1;              // A: No.
    row.getCell(2).value = r.code || '326570'; // B: Code
    row.getCell(3).value = r.subName ?? 'TUE-H';
    row.getCell(4).value = r.osc ?? 'Anatachai';
    row.getCell(5).value = r.pc ?? 'Supawadee';
    row.getCell(6).value = r.pn;               // F: P/N
    row.getCell(7).value = r.poNo;             // G: PO No.
    if (r.orderDate) row.getCell(8).value = new Date(r.orderDate + 'T00:00:00Z');
    row.getCell(12).value = r.qty;             // L: Open Q'ty
    if (r.planWinding) row.getCell(13).value = new Date(r.planWinding + 'T00:00:00Z');
    if (r.planAssembly) row.getCell(14).value = new Date(r.planAssembly + 'T00:00:00Z');
    if (r.planInspection) row.getCell(15).value = new Date(r.planInspection + 'T00:00:00Z');
    if (r.planSupport) row.getCell(16).value = new Date(r.planSupport + 'T00:00:00Z');
  });

  // แถว TOTAL ที่ไฟล์จริงมี — โค้ดอ่านไว้เทียบว่ายอดรวมตรงกับที่นับเองไหม
  if (opts.total != null) {
    const t = ws.getRow(9 + rows.length + 1);
    t.getCell(9).value = 'TOTAL';
    t.getCell(12).value = opts.total;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** ใบส่งงาน TPP-UNION — โค้ดอ่านเฉพาะชีตที่ชื่อขึ้นต้น "ใบส่งงาน" และไม่ซ่อน
 *  หัววันที่อยู่แถว 7 คอลัมน์ U · ข้อมูลเริ่มแถว 10 · ยอดส่งจริงอยู่คอลัมน์ P */
async function shipWorkbook(sheets, opts = {}) {
  const wb = new ExcelJS.Workbook();

  if (opts.withHidden !== false) {
    const h = wb.addWorksheet('ใบส่งงาน TUE-X');
    anchorTopLeft(h);
    h.state = 'hidden';
    h.getRow(7).getCell(21).value = `Date___${opts.dateLabel || '29/8/26'}__(WK ${opts.week || 34})`;
    const hr = h.getRow(10);
    hr.getCell(3).value = '9999999999';   // C = P/N
    hr.getCell(4).value = 'TMHIDDEN';     // D = PO NO
    hr.getCell(6).value = 999;            // F = PO QTY
    hr.getCell(16).value = 999;           // P = จำนวน/PCS
  }

  for (const s of sheets) {
    const ws = wb.addWorksheet('ใบส่งงาน ' + s.unit);
    anchorTopLeft(ws);
    ws.getRow(7).getCell(2).value = s.unit;
    ws.getRow(7).getCell(21).value = `Date___${opts.dateLabel || '29/8/26'}__(WK ${opts.week || 34})`;
    const sh = ws.getRow(9);
    [[2,'Item'], [3,'P/N'], [4,'PO  NO'], [5,'Order Date'], [6,'PO QTY'], [16,'จำนวน/PCS']
    ].forEach(([c, v]) => { sh.getCell(c).value = v; });
    s.lines.forEach((ln, i) => {
      const row = ws.getRow(10 + i);
      row.getCell(3).value = ln.pn;        // C
      row.getCell(4).value = ln.poNo;      // D
      if (ln.orderDate) row.getCell(5).value = new Date(ln.orderDate + 'T00:00:00Z');
      row.getCell(6).value = ln.orderQty;  // F
      row.getCell(16).value = ln.qty;      // P = จำนวน/PCS
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** อ่านไฟล์ที่แอปสร้างออกมา กลับเป็นโครงสร้างที่ตรวจได้ */
async function readWorkbook(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = {};
  wb.worksheets.forEach(ws => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, r => {
      rows.push(r.values.slice(1).map(v => (v && v.result !== undefined) ? v.result : v));
    });
    out[ws.name] = rows;
  });
  return out;
}

module.exports = { planWorkbook, shipWorkbook, readWorkbook };
