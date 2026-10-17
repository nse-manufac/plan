// ซอร์สของแอปที่เบราว์เซอร์โหลดจริง — ที่เดียวที่เทสควรอ่านโค้ดของแอปเป็นข้อความ
//
// ── ทำไมต้องมีตัวนี้ ─────────────────────────────────────────────
// เทสหลายข้ออ่านซอร์สมาตรวจแบบ "ต้องไม่มี X" (ห้ามเพิ่มไลบรารี PDF · ห้ามล้างนาฬิกาซิงค์ที่อื่น ·
// ห้ามเขียนชื่อขั้นตายตัว) เดิมอ่านจาก production_plan_tracker.html ตรง ๆ
// พอแผนแยกไฟล์ (CLAUDE.md §3.1) ย้ายโค้ดออกไปอยู่ app.js · core/ · io/ ...
// เทสพวกนั้นจะ **เขียวเองโดยไม่ได้ตรวจอะไรเลย** เพราะ X ไม่อยู่ในไฟล์ HTML แล้ว ไม่ใช่เพราะไม่มี X
// ตัวนี้อ่านทุกไฟล์ที่หน้าโหลดจริงตามแท็ก <script src> — ย้ายโค้ดไปไหน เทสก็ยังเห็น
//
// และใบย้ายโค้ดแก้เทสเดิมไม่ได้ (ด่านพิสูจน์ย้ายอย่างเดียว) เทสทุกข้อจึงต้องทนการย้ายตั้งแต่ก่อนย้าย
// tests/node/app-source.test.js คุมว่าไม่มีเทสไหนกลับไปอ่าน HTML ตรง ๆ อีก

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_FILE = path.join(ROOT, 'production_plan_tracker.html');

// แท็กโหลดไฟล์รูปแบบเดียวที่ด่านพิสูจน์ย้ายอย่างเดียวยอมรับ — ตรงกันกับ .github/scripts/move-proof.mjs
// กลุ่มที่ 1 = path ล้วน · กลุ่มที่ 2 = เลขรุ่นใน ?v= (INVARIANTS F4 — บัสต์แคชของแต่ละไฟล์)
const SCRIPT_SRC = /^<script src="([^"?]*)(?:\?v=([^"]*))?"><\/script>\r?$/gm;

/** แท็กโหลดไฟล์ทุกตัวในหน้า ตามลำดับ — [{file, v}] · v เป็น null ถ้าไม่มี ?v= */
function scriptTags() {
  return [...appHtml().matchAll(SCRIPT_SRC)].map(m => ({ file: m[1], v: m[2] ?? null }));
}

/** ไฟล์ HTML ของแอป (ใช้เฉพาะเรื่องของ HTML เอง เช่น <meta name="app-version">) */
function appHtml() {
  return fs.readFileSync(APP_FILE, 'utf8');
}

/** ทุกไฟล์ที่หน้าโหลด ตามลำดับที่เบราว์เซอร์โหลด — [{file, text}] เริ่มจาก HTML */
function appSources() {
  const html = appHtml();
  const out = [{ file: 'production_plan_tracker.html', text: html }];
  for (const m of html.matchAll(SCRIPT_SRC)) {
    out.push({ file: m[1], text: fs.readFileSync(path.join(ROOT, m[1]), 'utf8') });
  }
  return out;
}

/** ซอร์สทั้งหมดต่อกันเป็นข้อความเดียว — สำหรับเทสแบบ "ต้องมี/ต้องไม่มี X ที่ไหนก็ตามในแอป" */
function appSource() {
  return appSources().map(s => s.text).join('\n');
}

/**
 * ตัวฟังก์ชันระดับบนสุดชื่อ name ทั้งตัว ไม่ว่าจะอยู่ไฟล์ไหน
 * นับแบบเดียวกับด่านพิสูจน์: เริ่มที่บรรทัดชิดซ้าย `function name(` จนถึงก่อนบรรทัดชิดซ้ายบรรทัดถัดไป
 * ที่ไม่ใช่ตัวปิด } ) ] — หาไม่เจอหรือเจอเกินหนึ่งที่ = โยน error ให้เทสแดงดัง ๆ ไม่ใช่คืนค่าว่างเงียบ ๆ
 */
function fnSource(name) {
  const head = new RegExp(`^(async )?function ${name}\\(`);
  const hits = [];
  for (const { file, text } of appSources()) {
    const lines = text.split(/\r?\n/);
    lines.forEach((l, i) => {
      if (!head.test(l)) return;
      let j = i + 1;
      while (j < lines.length && !/^[^\s})\]]/.test(lines[j])) j++;
      hits.push({ file, line: i + 1, text: lines.slice(i, j).join('\n') });
    });
  }
  if (hits.length !== 1) {
    throw new Error(`หา function ${name} ระดับบนสุดเจอ ${hits.length} ที่ (ต้องเจอหนึ่งที่พอดี)` +
      hits.map(h => ` ${h.file}:${h.line}`).join(''));
  }
  return hits[0].text;
}

/**
 * ชื่อระดับบนสุดที่โค้ดของแอปประกาศ ทุกไฟล์ยกเว้น lib/ — [{name, file, line}]
 *
 * ตั้งแต่ใบ 02 ของการแยกไฟล์ (ถอดเปลือก IIFE) ทุกไฟล์ใช้ชื่อร่วมกันในที่เดียวคือ global ของหน้า
 * ชื่อซ้ำข้ามไฟล์ = ตัวที่โหลดทีหลังทับตัวแรกเงียบ ๆ (ถ้าเป็น function) หรือหน้าพังทั้งหน้า (ถ้าเป็น const/let)
 * ชื่อที่ซ้ำกับของเบราว์เซอร์ (เช่น print · status · close) = ทับของเบราว์เซอร์เงียบ ๆ
 * tests/node/globals.test.js กับ tests/globals.spec.js ใช้ตัวนี้คุมทั้งสองเรื่อง
 *
 * นับเฉพาะบรรทัดชิดซ้าย — โค้ดแอปเขียนระดับบนสุดชิดซ้ายเสมอ (ข้อเดียวกับที่ด่านพิสูจน์ย้ายอย่างเดียวใช้)
 * การประกาศแบบแยกส่วน (const {a, b} = ...) ตัวนี้มองไม่เห็น — ตรวจแล้วตอนใบ 02 ว่ายังไม่มีในแอป
 */
function topLevelNames() {
  const out = [];
  for (const { file, text } of appSources()) {
    if (file.startsWith('lib/')) continue;
    text.split(/\r?\n/).forEach((l, i) => {
      const m = /^(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/.exec(l);
      if (m) out.push({ name: m[1] || m[2], file, line: i + 1 });
    });
  }
  return out;
}

/**
 * แก้ซอร์สของแอประหว่างที่เบราว์เซอร์โหลด — แทนที่ anchor ด้วย replacement ในไฟล์ไหนก็ตามที่มันอยู่
 *
 * เดิมเทสดักเฉพาะ production_plan_tracker.html แล้วแทรกขั้นทดสอบเข้า DEFAULT_PROCESSES
 * พอรายการขั้นย้ายไปอยู่ core/ การดักแบบนั้นจะหาไม่เจอ — ตัวนี้ดักทุกไฟล์ของแอปที่หน้าขอ
 * คืนฟังก์ชันนับว่าแทนที่ไปในกี่ "ไฟล์" ให้เทสยืนยันหลังเปิดหน้าว่า "หนึ่งไฟล์พอดี"
 * (ไม่เจอ = เทสกำลังทดสอบแอปที่ไม่ได้ถูกแก้ ซึ่งคือการเขียวหลอก)
 * นับเป็นไฟล์ ไม่ใช่จำนวนครั้งที่ขอ — แอปดึง HTML ซ้ำอีกรอบตอนเช็กรุ่นใหม่ (?_v=...) ไฟล์เดียวจึงถูกขอสองครั้ง
 */
async function patchAppSource(page, anchor, replacement) {
  const files = new Set();
  await page.route(url => url.hostname === '127.0.0.1' && /\.(html|js)$/.test(url.pathname), async route => {
    const res = await route.fetch();
    const body = await res.text();
    if (!body.includes(anchor)) return route.fulfill({ response: res });
    files.add(new URL(route.request().url()).pathname);
    return route.fulfill({ response: res, body: body.replace(anchor, replacement) });
  });
  return () => files.size;
}

module.exports = { ROOT, APP_FILE, appHtml, appSources, appSource, fnSource, topLevelNames, patchAppSource, scriptTags };
