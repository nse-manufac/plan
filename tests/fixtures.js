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

/** ไฟล์แบบ Daily Call In — หัวตารางแถว 6 ข้อมูลเริ่มแถว 7
 *  A=P/N B=PO NO C=Order Date D=PO QTY E=Wip bal. F=Aging(สูตร) J=commit ตามวัน
 *  ชีตที่สองมีสูตรไว้พิสูจน์ว่าการกรอกไม่ไปแตะชีตอื่น */
async function callInWorkbook(rows, opts = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName || "X-FRM wk34");
  anchorTopLeft(ws);
  ws.getCell('E1').value = 'DAILY CALL IN TRANSFOMER';
  const head = ws.getRow(6);
  [[1,'P/N'], [2,'PO  NO'], [3,'Order Date'], [4,'PO QTY'], [5,'Wip bal.'], [6,'Aging'], [10,'commit']
  ].forEach(([c, v]) => { head.getCell(c).value = v; });

  rows.forEach((r, i) => {
    const n = 7 + i;
    const row = ws.getRow(n);
    row.getCell(1).value = r.pn;
    row.getCell(2).value = r.poNo;
    if (r.orderDate) row.getCell(3).value = new Date(r.orderDate + 'T00:00:00Z');
    row.getCell(4).value = r.qty;
    if (r.wip !== undefined) row.getCell(5).value = r.wip;
    row.getCell(6).value = { formula: `TODAY()-C${n}` };
    if (r.commit !== undefined) row.getCell(10).value = r.commit;   // ของที่คนวางแผนกรอกเอง
  });

  const other = wb.addWorksheet('อีกชีตที่ห้ามแตะ');
  anchorTopLeft(other);
  other.getCell('B2').value = 123;
  other.getCell('B3').value = { formula: 'B2*2' };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** ฟอร์มใบส่งสินค้า FM-ST-07 — โครงเหมือนของจริงเท่าที่โค้ดอ้างถึง
 *  B7 หน่วย · U7 Date___D/M/YY__(WK nn) · แถว 9 หัวตาราง · แถว 10-95 ข้อมูล · แถว 96 ยอดรวม
 *  H, P, W เป็นสูตรประจำแถว และแถว 96 เป็น SUM — ทั้งหมดนี้แอปห้ามแตะ */
async function deliveryFormWorkbook(units = ['TUE-U', 'TUE-H'], opts = {}) {
  const wb = new ExcelJS.Workbook();
  for (const unit of units) {
    const ws = wb.addWorksheet('ใบส่งงาน ' + unit);
    anchorTopLeft(ws);
    ws.getCell('F2').value = 'ใบส่งสินค้า';
    ws.getRow(7).getCell(2).value = unit;
    ws.getRow(7).getCell(21).value = `Date___1/1/26__(WK ${opts.week || 34})`;
    const head = ws.getRow(9);
    [[2,'Item'], [3,'P/N'], [4,'PO  NO'], [5,'Order Date'], [6,'PO QTY'], [7,'Wip bal.'], [8,'Aging'],
     [13,'จำนวนต่อกล่อง'], [14,'จำนวนกล่อง'], [15,'จำนวนเศษ'], [16,'จำนวน/PCS'], [21,'Remark'], [23,'Fail']
    ].forEach(([c, v]) => { head.getCell(c).value = v; });

    for (let n = 10; n <= 95; n++) {
      const row = ws.getRow(n);
      row.getCell(2).value = n - 9;                              // Item มีอยู่แล้วในฟอร์ม
      row.getCell(8).value  = { formula: `TODAY()-E${n}` };      // Aging
      // ⚠️ ตั้งรูปแบบวันที่ไว้ที่แถวแรกแถวเดียว เลียนแบบฟอร์มจริงที่บางแถวยังไม่มีช่องนั้นเลย
      //    แถวถัดไปที่แอปต้องสร้างช่องขึ้นมาใหม่ ต้องหยิบรูปแบบนี้ไปใช้ ไม่งั้นวันที่จะโชว์เป็นเลขดิบ
      if (n === 10) {
        row.getCell(5).value = new Date('2020-01-01T00:00:00Z');   // ของสัปดาห์ก่อนที่ค้างอยู่
        row.getCell(5).numFmt = 'dd/mm/yyyy';
      }
      row.getCell(16).value = { formula: `M${n}*N${n}+O${n}` };  // จำนวน/PCS
      row.getCell(23).value = { formula: `G${n}-P${n}` };        // Fail
    }
    const total = ws.getRow(96);
    total.getCell(2).value = 'รวม';
    total.getCell(6).value = { formula: 'SUM(F10:F95)' };
    total.getCell(16).value = { formula: 'SUM(P10:P95)' };
    // ของที่เหลือจากใบครั้งก่อน ต้องถูกล้างตอนออกใบใหม่
    if (opts.stale) {
      ws.getRow(10).getCell(3).value = 'ของเก่าที่ต้องหาย';
      ws.getRow(10).getCell(13).value = 999;
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { planWorkbook, callInWorkbook, deliveryFormWorkbook, readWorkbook };
