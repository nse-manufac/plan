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
  /* ผังคอลัมน์ — ของจริงมีสองแบบปนกันอยู่ในไฟล์เดียว (สำรวจ 4 ก.ย. 2026)
   *   'new' (ค่าเริ่มต้น) = WK 15 เป็นต้นมา · L = Open Q'ty · มีคอลัมน์วันแผน
   *   'old'                = WK 1-14        · L = Order Q'ty · M = Open Q'ty · ไม่มีวันแผน
   * opts.shift เลื่อนทุกคอลัมน์ไปทางขวา n ช่อง เลียนการแทรกคอลัมน์ใหม่เข้ามา
   * opts.dropHead ตัดหัวตารางที่ระบุออก เพื่อทดสอบว่าโปรแกรมฟ้องแทนการเดา */
  const shift = opts.shift || 0;
  const old = opts.layout === 'old';
  const at = n => n + shift;
  const drop = new Set(opts.dropHead || []);
  const put = (row, col, label, value) => {
    if (label != null && drop.has(label)) return;
    row.getCell(at(col)).value = value;
  };

  const HEAD = old
    ? [[1,'No.'], [2,'Code'], [4,'OSC'], [5,'Pc delta'], [6,'P/N'], [7,'PO No.'], [8,'Order Date'],
       [9,'Delta Req(ETD)'], [10,'VENDOR (ETA)'], [11,'Aging'], [12,"Order Q'ty"], [13,"Open Q'ty"],
       [14,'Rev.'], [15,'Rev.'], [16,'Remark']]
    // ⚠️ หัวจริงสะกดว่า "Winding/Trimmimg" (พิมพ์ตก) — ฟิกซ์เจอร์ต้องสะกดตามของจริง
    //    ไม่งั้นเทสจะผ่านด้วยคำที่สวยกว่าไฟล์ที่ใช้งานอยู่จริง
    : [[1,'No.'], [2,'Code'], [4,'OSC'], [5,'Pc delta'], [6,'P/N'], [7,'PO No.'], [8,'Order Date'],
       [9,'Delta Req(ETD)'], [10,'VENDOR (ETA)'], [11,'Aging'], [12,"Open Q'ty"],
       [13,'Winding/Trimmimg'], [14,'Assembly'], [15,'Inspection'], [16,'Plan Support']];

  const head = ws.getRow(7);
  HEAD.forEach(([c, v]) => put(head, c, v, v));
  ws.getRow(8).getCell(at(3)).value = 'Sub-Name';

  const qtyCol = old ? 13 : 12;     // ช่อง "Open Q'ty" ของผังนั้น

  rows.forEach((r, i) => {
    const row = ws.getRow(9 + i);
    put(row, 1, null, i + 1);                    // No.
    put(row, 2, null, r.code || '326570');       // Code
    // คอลัมน์ C ไม่มีหัวตารางในไฟล์จริง และตั้งแต่ 4 ก.ย. 2026 โปรแกรมไม่อ่านช่องนี้แล้ว
    // ยังเขียนไว้เพื่อพิสูจน์ว่า "ถูกเมินจริง" แม้ค่าจะขัดกับตัวอักษรใน PO
    put(row, 3, null, r.subName ?? 'TUE-H');
    put(row, 4, null, r.osc ?? 'Anatachai');
    put(row, 5, null, r.pc ?? 'Supawadee');
    put(row, 6, null, r.pn);
    put(row, 7, null, r.poNo);
    if (r.orderDate) put(row, 8, null, new Date(r.orderDate + 'T00:00:00Z'));
    put(row, qtyCol, null, r.qty);
    if (old) {
      if (r.orderQtyOld != null) put(row, 12, null, r.orderQtyOld);   // ช่อง Order Q'ty
    } else {
      if (r.planWinding) put(row, 13, null, new Date(r.planWinding + 'T00:00:00Z'));
      if (r.planAssembly) put(row, 14, null, new Date(r.planAssembly + 'T00:00:00Z'));
      if (r.planInspection) put(row, 15, null, new Date(r.planInspection + 'T00:00:00Z'));
      if (r.planSupport) put(row, 16, null, new Date(r.planSupport + 'T00:00:00Z'));
    }
  });

  // แถว TOTAL ที่ไฟล์จริงมี — โค้ดอ่านไว้เทียบว่ายอดรวมตรงกับที่นับเองไหม
  if (opts.total != null) {
    const t = ws.getRow(9 + rows.length + 1);
    put(t, 9, null, 'TOTAL');
    put(t, qtyCol, null, opts.total);
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
  // ⚠️ ตำแหน่งคอลัมน์ Wip bal. ปรับได้ผ่าน opts.wipCol/opts.wipHeader — ของจริงเคยถูก
  //    แทรกคอลัมน์ใหม่เข้ามาจนเลื่อนจาก E ไป F มาแล้ว (3 ก.ย. 2026)
  //    ค่าเริ่มต้นยังเป็น E เหมือนเดิม เทสเดิมที่ไม่ส่ง opts นี้จึงไม่ต้องแก้อะไร
  const wipCol = opts.wipCol || 5, agingCol = wipCol + 1;
  const head = ws.getRow(6);
  [[1,'P/N'], [2,'PO  NO'], [3,'Order Date'], [4,'PO QTY'],
   [wipCol, opts.wipHeader === undefined ? 'Wip bal.' : opts.wipHeader],
   [agingCol,'Aging'], [10,'commit']
  ].forEach(([c, v]) => { head.getCell(c).value = v; });

  rows.forEach((r, i) => {
    const n = 7 + i;
    const row = ws.getRow(n);
    row.getCell(1).value = r.pn;
    row.getCell(2).value = r.poNo;
    if (r.orderDate) row.getCell(3).value = new Date(r.orderDate + 'T00:00:00Z');
    row.getCell(4).value = r.qty;
    if (r.wip !== undefined) row.getCell(wipCol).value = r.wip;
    row.getCell(agingCol).value = { formula: `TODAY()-C${n}`, result: 0 };  // ดู result ที่ deliveryFormWorkbook
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
      // ⚠️ ต้องใส่ result ให้ทุกสูตร เลียนแบบฟอร์มจริงที่เก็บ <f>M10*N10+O10</f><v>0</v>
      //    เลข 0 ที่แคชไว้นี่แหละคือตัวที่ทำให้ใบส่งของโชว์จำนวนเป็น 0 (พนักงานเจอ 31 ส.ค. 2026)
      //    fixture เดิมไม่ใส่ result ExcelJS จึงไม่เขียน <v> เลย บั๊กนี้จึงลอดเทสทั้งชุดไปได้
      row.getCell(8).value  = { formula: `TODAY()-E${n}`, result: 0 };      // Aging
      // ⚠️ ตั้งรูปแบบวันที่ไว้ที่แถวแรกแถวเดียว เลียนแบบฟอร์มจริงที่บางแถวยังไม่มีช่องนั้นเลย
      //    แถวถัดไปที่แอปต้องสร้างช่องขึ้นมาใหม่ ต้องหยิบรูปแบบนี้ไปใช้ ไม่งั้นวันที่จะโชว์เป็นเลขดิบ
      if (n === 10) {
        row.getCell(5).value = new Date('2020-01-01T00:00:00Z');   // ของสัปดาห์ก่อนที่ค้างอยู่
        row.getCell(5).numFmt = 'dd/mm/yyyy';
      }
      row.getCell(16).value = { formula: `M${n}*N${n}+O${n}`, result: 0 };  // จำนวน/PCS
      row.getCell(23).value = { formula: `G${n}-P${n}`, result: 0 };        // Fail
    }
    const total = ws.getRow(96);
    total.getCell(2).value = 'รวม';
    total.getCell(6).value = { formula: 'SUM(F10:F95)', result: 0 };
    total.getCell(16).value = { formula: 'SUM(P10:P95)', result: 0 };
    // ของที่เหลือจากใบครั้งก่อน ต้องถูกล้างตอนออกใบใหม่
    if (opts.stale) {
      ws.getRow(10).getCell(3).value = 'ของเก่าที่ต้องหาย';
      ws.getRow(10).getCell(13).value = 999;
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { planWorkbook, callInWorkbook, deliveryFormWorkbook, readWorkbook };
