/**
 * ระบบติดตามแผนงาน Production — Google Apps Script backend
 * ใช้คู่กับไฟล์ production_plan_tracker.html
 *
 * วิธีติดตั้งดูใน คู่มือติดตั้ง_GoogleSheets.md (ในโฟลเดอร์เดียวกัน)
 * แก้ TOKEN ด้านล่างเป็นรหัสของคุณเองก่อนใช้งานจริง
 */

// ═══════════ ตั้งค่า ═══════════
const TOKEN = 'CHANGE-ME-1234';   // ⚠️ ต้องเปลี่ยน และต้องตรงกับที่กรอกในโปรแกรม

// Orders / Records ใช้ระบบ upsert รายแถวอิง id — ห้ามลบคอลัมน์ id กับ updatedAt
// ⚠️ 'voided' ต้องอยู่ท้ายสุดเสมอ — doPushRows เขียนแถวด้วยตำแหน่ง (toRow ตามลำดับ cols)
//    ส่วน sheetOf() เติมคอลัมน์ที่ขาด "ต่อท้าย" หัวตารางของชีตเดิม
//    ลำดับสองฝั่งจึงตรงกันได้ต่อเมื่อคอลัมน์ใหม่ถูกเติมท้ายทั้งคู่
//    ถ้าแทรกไว้กลางรายการ ชีตที่มีอยู่แล้วจะเขียนข้อมูลเหลื่อมคอลัมน์ทั้งตารางโดยไม่มี error
const ORDER_COLS  = ['id','week','poNo','pn','subName','osc','pc','orderQty','orderDate',
  'planWinding','planAssembly','planSupport','planInspection','status','importedAt','updatedAt',
  'voided'];
const RECORD_COLS = ['id','date','orderId','process','qty','note','deviceName','createdAt','updatedAt','voided','batchId'];

// ใบส่งสินค้า FM-ST-07 — หนึ่งแถว = หนึ่งบรรทัดบนใบ ไม่ใช่หนึ่งใบ
// ไม่มีคอลัมน์ qty เพราะมันคือ perBox*boxes+remainder อยู่แล้ว เก็บสองที่เมื่อไหร่ก็ไม่ตรงกันเมื่อนั้น
// orderId ว่างได้ — ในใบจริงมีบรรทัด RETURN/REWORK ที่ไม่มี PO แต่มี P/N
const DELIVERY_COLS = ['id','date','unit','orderId','pn','perBox','boxes','remainder','remark','billNo',
  'deviceName','createdAt','updatedAt','voided'];

// ยอดค้างส่งที่ Delta บันทึกไว้ อ่านมาจากไฟล์ Call In รายสัปดาห์
// หนึ่งแถว = หนึ่งใบสั่ง ต่อหนึ่งงวด — เก็บทุกงวด ไม่ทับของเก่า เพื่อให้ย้อนตรวจได้ตอน Delta ถาม
const DELTAWIP_COLS = ['id','orderId','week','wip','fileName',
  'deviceName','createdAt','updatedAt','voided'];

// ⚠️ เพิ่มตารางใหม่ ต้องเติมให้ครบทั้งสี่ที่ในไฟล์นี้ + setupSheets()
//    ตกหล่นที่ไหนที่หนึ่งจะไม่มี error แต่ข้อมูลคอลัมน์นั้นจะหายเงียบ ๆ ทุกครั้งที่ซิงค์
//    (planSupport เคยตกหล่นแบบนี้มาตั้งแต่ issue #17 จนถึง 30 ส.ค. 2026)
var ROW_TABLES = { Orders: ORDER_COLS, Records: RECORD_COLS, DeliveryNotes: DELIVERY_COLS,
                   DeltaWip: DELTAWIP_COLS };

// คอลัมน์ที่เก็บ "วันปฏิทินล้วน" (YYYY-MM-DD) — Sheets ชอบแปลงสตริงพวกนี้เป็นเซลล์ชนิดวันที่ให้เอง
// ถ้าไม่กันไว้ พออ่านกลับด้วย getValues() จะได้ Date object แทนสตริง ทำให้ client คำนวณ deadline พัง
var DATE_ONLY_COLS = {
  Orders: ['orderDate', 'planWinding', 'planAssembly', 'planSupport', 'planInspection'],
  Records: ['date'],
  DeliveryNotes: ['date']
};
// เผื่อ Sheets แปลง timestamp เต็ม (เช่น updatedAt) เป็นเซลล์ชนิดวันที่-เวลาด้วยเช่นกัน — ต่างจาก
// DATE_ONLY_COLS ตรงที่แปลงกลับด้วย toISOString() (คง เวลา+โซน ไว้) ไม่ใช่ 'yyyy-MM-dd'
var TIMESTAMP_COLS = {
  Orders: ['importedAt', 'updatedAt'],
  Records: ['createdAt', 'updatedAt'],
  DeliveryNotes: ['createdAt', 'updatedAt'],
  DeltaWip: ['createdAt', 'updatedAt']
};

// ═══════════ จุดเข้า ═══════════
function doGet(e)  { return handle(e, {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle(e, body);
}

function handle(e, body) {
  var p = e && e.parameter ? e.parameter : {};
  var action = body.action || p.action || 'ping';
  var token  = body.token  || p.token  || '';

  if (token !== TOKEN) return json({ ok: false, error: 'token ไม่ถูกต้อง' });

  try {
    switch (action) {
      case 'ping':        return json(doPing());
      case 'pullRows':    return json(doPullRows(body.table || p.table, body.since || p.since || ''));
      case 'pushRows':    return json(doPushRows(body.table, body.rows || [], body.device || ''));
      case 'pullSettings':return json(doPullSettings());
      case 'pushSettings':return json(doPushSettings(body));
      case 'clearTable':  return json(doClearTable(body.table, body.confirm));
      default:            return json({ ok: false, error: 'ไม่รู้จักคำสั่ง: ' + action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════ ตัวช่วยจัดการชีต ═══════════
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheetOf(name, cols) {
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    s.setFrozenRows(1);
    return s;
  }
  var w = Math.max(1, s.getLastColumn());
  var head = s.getRange(1, 1, 1, w).getValues()[0].map(String);
  var missing = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    var start = head.filter(String).length + 1;
    s.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}

function readObjects(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var w = sheet.getLastColumn();
  var vals = sheet.getRange(1, 1, last, w).getValues();
  var head = vals[0].map(String);
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = {}, empty = true;
    for (var c = 0; c < head.length; c++) {
      var v = vals[i][c];
      if (v !== '' && v !== null) empty = false;
      o[head[c]] = v;
    }
    if (!empty) { o._row = i + 1; out.push(o); }
  }
  return out;
}

function toRow(obj, cols) {
  return cols.map(function (c) {
    var v = obj[c];
    return (v === undefined || v === null) ? '' : v;
  });
}

function nowIso() { return new Date().toISOString(); }

/** เซลล์ในคอลัมน์วันที่อาจถูก Sheets แปลงเป็น Date object เองแม้เราจะส่งสตริงไป — ถ้าเจอ Date
 *  ให้แปลงกลับเป็น 'yyyy-MM-dd' ด้วยโซนเวลาของสเปรดชีต (ไม่ใช้ toISOString ตรง ๆ เพราะนั่นเป็น UTC
 *  จะทำให้วันคลาดไป 1 วันสำหรับโซนเวลาไทย) ค่าที่เป็นสตริงอยู่แล้วปล่อยผ่านตามเดิม */
function fixDateOnlyCols(row, cols) {
  var tz = ss().getSpreadsheetTimeZone();
  for (var i = 0; i < cols.length; i++) {
    var v = row[cols[i]];
    if (v instanceof Date) row[cols[i]] = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
}

/** เหมือน fixDateOnlyCols แต่สำหรับคอลัมน์ timestamp เต็ม — คงเวลาไว้ด้วย toISOString() */
function fixTimestampCols(row, cols) {
  for (var i = 0; i < cols.length; i++) {
    var v = row[cols[i]];
    if (v instanceof Date) row[cols[i]] = v.toISOString();
  }
}

/** ตั้ง number format ของคอลัมน์วันที่เป็นข้อความ ('@') ก่อนเขียน กัน Sheets ตีความสตริงวันที่
 *  เป็นเซลล์ชนิดวันที่เองตอน setValues() — ครอบคลุมถึงแถวที่กำลังจะเพิ่มใหม่ด้วย (+buffer กันคลาด) */
function ensureTextFormat(sheet, cols, dateFieldNames, incomingRowCount) {
  if (!dateFieldNames.length) return;
  var rowSpan = Math.max(sheet.getLastRow(), 1) + incomingRowCount + 5;
  dateFieldNames.forEach(function (name) {
    var idx = cols.indexOf(name) + 1;
    if (idx > 0) sheet.getRange(2, idx, rowSpan, 1).setNumberFormat('@');
  });
}

function meta(key, value) {
  var s = sheetOf('Meta', ['key', 'value']);
  var rows = readObjects(s);
  var hit = null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].key) === key) hit = rows[i];
  if (value === undefined) return hit ? String(hit.value) : '';
  if (hit) s.getRange(hit._row, 2).setValue(value);
  else s.appendRow([key, value]);
  return value;
}

// ═══════════ คำสั่ง ═══════════
function doPing() {
  var o = sheetOf('Orders', ORDER_COLS);
  var r = sheetOf('Records', RECORD_COLS);
  return {
    ok: true,
    serverTime: nowIso(),
    orderCount: Math.max(0, o.getLastRow() - 1),
    recordCount: Math.max(0, r.getLastRow() - 1),
    spreadsheet: ss().getName()
  };
}

/** ดึงรายการที่เปลี่ยนแปลงหลังเวลา since (ISO string) — ใช้ได้ทั้ง Orders และ Records */
function doPullRows(table, since) {
  var cols = ROW_TABLES[table];
  if (!cols) return { ok: false, error: 'ไม่รู้จักตาราง: ' + table };
  var rows = readObjects(sheetOf(table, cols));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // แก้ updatedAt ก่อนเทียบ since เสมอ (แม้แถวนี้จะไม่ถูกส่งออกไปก็ตาม) เพราะถ้า Sheets แปลงเป็น
    // Date object แล้วปล่อยผ่าน String(Date) จะได้รูปแบบอ่านง่ายที่ไม่ใช่ ISO เทียบกับ since ไม่ได้
    fixTimestampCols(r, TIMESTAMP_COLS[table] || []);
    if (!since || String(r.updatedAt || '') > since) {
      delete r._row;
      fixDateOnlyCols(r, DATE_ONLY_COLS[table] || []);
      if (table === 'Orders') r.orderQty = Number(r.orderQty) || 0;
      if (table === 'Records') {
        r.qty = Number(r.qty) || 0;
        r.voided = String(r.voided).toUpperCase() === 'TRUE';
      }
      out.push(r);
    }
  }
  return { ok: true, serverTime: nowIso(), rows: out };
}

/** เพิ่มหรืออัปเดตรายการ — อิง id เป็นหลัก ใครแก้ทีหลังชนะ (ตัดสินที่ฝั่ง client ก่อนส่งมาแล้ว) */
function doPushRows(table, rows, device) {
  var cols = ROW_TABLES[table];
  if (!cols) return { ok: false, error: 'ไม่รู้จักตาราง: ' + table };
  if (!rows.length) return { ok: true, serverTime: nowIso(), saved: 0 };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'ระบบกำลังถูกใช้งาน ลองใหม่อีกครั้ง' };
  try {
    var sheet = sheetOf(table, cols);
    // บังคับคอลัมน์วันที่ให้เป็น format ข้อความก่อนเขียน กัน Sheets แปลงเป็นเซลล์ชนิดวันที่เอง
    // (ครอบคลุมแถวที่มีอยู่ + จำนวนแถวที่กำลังจะเขียนเผื่อไว้ ไม่ต้องกวาดทั้งคอลัมน์ทุกครั้ง)
    ensureTextFormat(sheet, cols, DATE_ONLY_COLS[table] || [], rows.length);
    var last = sheet.getLastRow();
    var index = {};
    if (last >= 2) {
      var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) index[String(ids[i][0])] = i + 2;
    }
    var stamp = nowIso();
    var appends = [];
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      if (!r.id) continue;
      r.updatedAt = stamp;
      if (table === 'Records') {
        if (!r.deviceName) r.deviceName = device || '';
        r.voided = r.voided ? 'TRUE' : 'FALSE';
      }
      var at = index[String(r.id)];
      if (at) sheet.getRange(at, 1, 1, cols.length).setValues([toRow(r, cols)]);
      else appends.push(toRow(r, cols));
    }
    if (appends.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, cols.length).setValues(appends);
    }
    SpreadsheetApp.flush();
    return { ok: true, serverTime: stamp, saved: rows.length, added: appends.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ล้างข้อมูลในชีต (เหลือแถวหัวตาราง)
 * ต้องส่ง confirm มาให้ตรงกับชื่อตาราง เพื่อกันเรียกพลาด
 */
function doClearTable(table, confirm) {
  var cols = ROW_TABLES[table];
  if (!cols) return { ok: false, error: 'ล้างตารางนี้ไม่ได้: ' + table };
  if (confirm !== table) return { ok: false, error: 'confirm ไม่ตรงกับชื่อตาราง' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'ระบบกำลังถูกใช้งาน ลองใหม่อีกครั้ง' };
  try {
    var sheet = sheetOf(table, cols);
    var last = sheet.getLastRow();
    var removed = Math.max(0, last - 1);
    if (removed > 0) sheet.deleteRows(2, removed);
    SpreadsheetApp.flush();
    return { ok: true, serverTime: nowIso(), table: table, removed: removed };
  } finally {
    lock.releaseLock();
  }
}

/** ตั้งค่ากลาง (ตอนนี้มีแค่ deadlineOffsets) ที่ต้องเหมือนกันทุกเครื่อง */
function doPullSettings() {
  var raw = meta('deadlineOffsets');
  var deadlineOffsets = null;
  if (raw) { try { deadlineOffsets = JSON.parse(raw); } catch (e) {} }
  return { ok: true, setupVersion: meta('setupVersion'), deadlineOffsets: deadlineOffsets };
}

function doPushSettings(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'ระบบกำลังถูกใช้งาน ลองใหม่อีกครั้ง' };
  try {
    if (body.deadlineOffsets) meta('deadlineOffsets', JSON.stringify(body.deadlineOffsets));
    var v = nowIso();
    meta('setupVersion', v);
    SpreadsheetApp.flush();
    return { ok: true, setupVersion: v };
  } finally {
    lock.releaseLock();
  }
}

// ═══════════ เมนูช่วยเหลือในสเปรดชีต ═══════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ระบบติดตามแผนงาน')
    .addItem('สร้างชีตที่จำเป็นทั้งหมด', 'setupSheets')
    .addItem('ซ่อมรูปแบบวันที่ (ทำครั้งเดียวหลังอัปเดต)', 'repairDateColumns')
    .addItem('ตรวจสอบสถานะ', 'showStatus')
    .addToUi();
}

function setupSheets() {
  sheetOf('Orders', ORDER_COLS);
  sheetOf('Records', RECORD_COLS);
  sheetOf('DeliveryNotes', DELIVERY_COLS);
  sheetOf('DeltaWip', DELTAWIP_COLS);
  sheetOf('Meta', ['key', 'value']);
  SpreadsheetApp.getUi().alert('สร้างชีตครบแล้ว');
}

/**
 * ซ่อมคอลัมน์วันที่ที่ Sheets เคยแปลงเป็นเซลล์ชนิดวันที่ให้กลับเป็นข้อความ 'yyyy-MM-dd' ถาวร
 * รันครั้งเดียวหลัง deploy โค้ดเวอร์ชันนี้ — ไม่งั้นแถวเก่าที่เพี้ยนอยู่แล้วจะยังส่ง Date object
 * กลับไปให้ client เรื่อย ๆ แม้ doPullRows จะแปลงให้ตอนอ่านก็ตาม (แก้ที่ปลายทางทุกครั้งเสียเวลากว่า
 * แก้ที่ต้นตอครั้งเดียว) ปลอดภัยที่จะรันซ้ำได้เสมอ
 */
function repairDateColumns() {
  var tz = ss().getSpreadsheetTimeZone();
  var totalFixed = 0;
  Object.keys(DATE_ONLY_COLS).forEach(function (table) {
    var cols = ROW_TABLES[table];
    var fields = DATE_ONLY_COLS[table];
    var sheet = sheetOf(table, cols);
    var last = sheet.getLastRow();
    if (last < 2) return;

    ensureTextFormat(sheet, cols, fields, 0);

    fields.forEach(function (name) {
      var idx = cols.indexOf(name) + 1;
      if (idx < 1) return;
      var range = sheet.getRange(2, idx, last - 1, 1);
      var values = range.getValues();
      var changed = false;
      for (var i = 0; i < values.length; i++) {
        var v = values[i][0];
        if (v instanceof Date) {
          values[i][0] = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
          changed = true;
          totalFixed++;
        }
      }
      if (changed) range.setValues(values);
    });
  });
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('ซ่อมวันที่เสร็จแล้ว — แก้ไป ' + totalFixed + ' ช่อง');
}

function showStatus() {
  var s = doPing();
  SpreadsheetApp.getUi().alert(
    'บรรทัดแผนงาน (Orders): ' + s.orderCount + '\n' +
    'บันทึกยอดรายวัน (Records): ' + s.recordCount + '\n' +
    'เวลาเซิร์ฟเวอร์: ' + s.serverTime);
}
