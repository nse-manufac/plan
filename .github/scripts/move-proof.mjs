// พิสูจน์ว่า PR นี้ "ย้ายโค้ดอย่างเดียว" — ไม่มีโค้ดใหม่ ไม่มีโค้ดหาย ไม่มีบรรทัดไหนถูกแก้
//
// ── ทำไมต้องมีตัวนี้ ─────────────────────────────────────────────
// เพดาน 150 บรรทัดของ PR จาก agent มีไว้ให้เจ้าของตรวจทันตอนพักเที่ยง
// งานแยกไฟล์ (CLAUDE.md §3.1) ย้ายโค้ดหลายพันบรรทัดโดยไม่แก้สักตัวอักษร
// ตรวจด้วยตาไม่ไหว แต่ **พิสูจน์ด้วยเครื่องได้ทั้งหมด** — ตัวนี้คือเครื่องนั้น
//
// ห้ามแทนตัวนี้ด้วยการเชื่อข้อความ "ย้ายอย่างเดียว" ในหัว PR
// ประตูที่เป็นข้อความคือรูรอบที่ 1 ของด่าน vendor (agent เขียนหัว PR ของตัวเอง)
//
// ── นิยาม ──────────────────────────────────────────────────────
// "ก้อน" = บรรทัดที่ขึ้นต้นชิดซ้าย (ไม่ใช่ช่องว่าง และไม่ใช่ตัวปิด } ) ])
//          ต่อด้วยทุกบรรทัดถัดไปจนกว่าจะเจอบรรทัดชิดซ้ายบรรทัดถัดไป
// โค้ดของแอปเขียนระดับบนสุดชิดซ้ายเสมอ ก้อนหนึ่งจึงคือฟังก์ชันทั้งตัว
// หรือประกาศหนึ่งอันพร้อมเนื้อในทั้งหมด
//
// ผ่านเมื่อครบทุกข้อ
//   1. ช่วงที่ถูกลบทุกช่วง เริ่มที่ต้นก้อน และบรรทัดถัดจากช่วงเป็นบรรทัดว่าง/ท้ายไฟล์/ต้นก้อน
//      = ถอดออกได้เฉพาะทั้งก้อน ห้ามตัดกลางฟังก์ชัน
//   2. ช่วงที่ถูกเพิ่มทุกช่วง ต้องเป็นทั้งก้อนแบบเดียวกัน = ห้ามแทรกเข้ากลางฟังก์ชัน
//   3. ก้อนที่ถูกลบกับก้อนที่ถูกเพิ่ม ต้องตรงกันทุกตัวอักษร และจำนวนเท่ากันทุกก้อน
//      สลับลำดับบรรทัดในฟังก์ชัน แก้ตัวอักษรเดียว ลืมบรรทัดเดียว = ก้อนไม่ตรง = ตก
//   4. บรรทัดที่อนุญาตเป็นพิเศษมีเท่าที่การแยกไฟล์ต้องใช้จริง (ALLOW_* ข้างล่าง)
//      และต้องอยู่เดี่ยว ๆ ห้ามมีบรรทัดอื่นห้อยอยู่ใต้มัน
//      <script src> ต้องชี้ไปที่ไฟล์แอปที่มีอยู่จริง · "use strict" เพิ่มเกินได้ ลดไม่ได้
//
// ลองกับไฟล์จริงแล้ว (23 ก.ย. 2026): ย้ายไลบรารีออกเป็น lib/ (29 ก้อน) และย้ายโค้ดทั้งบล็อก
// 4,509 บรรทัดไป app.js (525 ก้อน) พิสูจน์ผ่านทั้งคู่ ใช้เวลาไม่ถึงครึ่งวินาที
//
// ── สิ่งที่ตัวนี้ "พิสูจน์ไม่ได้" ── ต้องพูดตรง ๆ อย่าอ้างเกินนี้
//   - ลำดับการโหลดไฟล์ (<script src> ตัวไหนก่อน) — ย้ายถูกทุกตัวอักษรแต่โหลดผิดลำดับ แอปพังได้
//   - บรรทัดชิดซ้ายที่อยู่ใน string หลายบรรทัด (template literal) จะถูกนับเป็นต้นก้อน
//   - ย้ายทั้งก้อนแต่ไปวางผิดที่จนความหมายเปลี่ยน (เช่นย้ายไปอยู่หลังโค้ดที่เรียกใช้มันตอนโหลด)
//   - เนื้อในของไฟล์นอกขอบเขตที่อนุญาต (เทสใหม่ · CLAUDE.md) — ตัวพิสูจน์พิมพ์ชื่อไว้ให้อ่านด้วยตา
//   ข้อพวกนี้พึ่ง Playwright ชุดเดิม ซึ่งเป็น required check อยู่แล้ว
//   และชุดเทสเดิมเชื่อได้ เพราะใบย้ายอย่างเดียวแก้หรือลบเทสเดิมไม่ได้ (ดู GITIGNORE_ADD ข้างล่าง)
//   ตัวนี้ตอบคำถามเดียว: "มีโค้ดที่ไม่ได้มาจากของเดิมแอบเข้ามาไหม" — และตอบได้เด็ดขาด
//
// ใช้งาน:  node .github/scripts/move-proof.mjs <base> <pathspec...>
//   เรียกแบบเดียวกับ workflow:  node .github/scripts/move-proof.mjs "$BASE" "${VERSIONED_PATHSPEC[@]}"
//   คืน 0 = พิสูจน์ได้ว่าย้ายอย่างเดียว · 1 = ไม่ใช่ · 2 = เรียกผิดหรือ git ล้ม (ถือว่าตก)
//
// ไม่มี dependency — ด่านนี้รันบน runner เปล่า เหมือนด่านอื่นทุกตัว

import { execFileSync } from 'node:child_process';

// บรรทัดที่ "โผล่มาใหม่ได้" โดยไม่ต้องมาจากของเดิม — เท่าที่การแยกไฟล์ต้องใช้จริงเท่านั้น
// ⚠️ เพิ่มรายการที่นี่ = ขยายช่องให้โค้ดใหม่เข้ามาได้ ต้องมีเทสคุมทุกรายการ
const SCRIPT_SRC = /^<script src="([^"]*)"><\/script>$/;
const ALLOW_ADDED = [
  // แท็กโหลดไฟล์ — ต้องชี้ไปที่ "ไฟล์แอป" ที่มีอยู่จริงเท่านั้น (ตรวจเพิ่มใน checkSrc)
  // ไม่งั้นแท็กที่ชี้ไป tests/ หรือไฟล์ที่ไม่อยู่ใน diff จะพาโค้ดที่ไม่ผ่านการพิสูจน์เข้าไปรันในแอป
  SCRIPT_SRC,
  // เลขรุ่น — ด่าน F4 ตรวจแยกอยู่แล้วว่าบัมป์ถูก
  /^<meta name="app-version" content="[^"]*">$/,
];

// "use strict" ไม่อยู่ในรายการข้างบน เพราะมันต้อง "ย้ายไปพร้อมโค้ดได้" ด้วย (ย้ายทั้งไฟล์ · ย้ายบล็อก <script> ทั้งก้อน)
// จึงนับเป็นก้อนธรรมดา แต่ให้ฝั่งที่เพิ่มมีมากกว่าฝั่งที่ลบได้ (ไฟล์ใหม่ทุกไฟล์ต้องเปิดโหมดเข้มเหมือนโค้ดเดิม)
// ฝั่งที่ลบมีมากกว่า = มีไฟล์ที่เสีย "use strict" ไป โค้ดที่เหลือในไฟล์นั้นกลับไปโหมดหลวม = ตก
const USE_STRICT = '"use strict";';

// บรรทัดที่ "หายไปได้" โดยไม่ต้องไปโผล่ที่อื่น
const ALLOW_REMOVED = [
  // แท็กเปิด/ปิดของ <script> ที่ฝังโค้ดไว้ในหน้า — ตอนย้ายโค้ดทั้งบล็อกออกไปเป็นไฟล์
  /^<script>$/,
  /^<\/script>$/,
  /^<meta name="app-version" content="[^"]*">$/,
];

// ── ไฟล์นอกขอบเขตการพิสูจน์ ──────────────────────────────────────
// ตัวพิสูจน์อ่านแค่ไฟล์แอป (pathspec ที่ผู้เรียกส่งมา) แต่คำตอบต้องครอบ "ทั้งใบ"
// ไม่งั้นใบที่ย้ายถูกทุกตัวอักษรจะพ่วงการถอดเขี้ยวเทส แก้ .gs หรือเปลี่ยน `npm test` เป็น `true` มาได้
// (ผู้ตรวจลองแล้วผ่านจริงใน #97 รอบแรก) — และเทสคือตาข่ายที่ใช้ชดเชยการยกเพดาน
//
// ใบย้ายอย่างเดียวแตะไฟล์นอกขอบเขตได้แค่สามแบบที่แผนแยกไฟล์ต้องใช้จริง ที่เหลือ = ตก
//   .gitignore      เพิ่มบรรทัดอนุญาตโฟลเดอร์/ไฟล์ .js ใหม่ได้อย่างเดียว (ไฟล์นั้นปฏิเสธทุกอย่างก่อน)
//   tests/**        **เพิ่ม** ไฟล์ใหม่ได้เท่านั้น แก้หรือลบของเดิมไม่ได้ — เทสเดิมคือตาข่าย
//   CLAUDE.md       แก้ตารางว่าอะไรอยู่ไฟล์ไหน
// ทั้งสามแบบถูกพิมพ์ชื่อไว้ให้ผู้ตรวจอ่านด้วยตา — ตัวพิสูจน์ไม่ได้อ่านเนื้อในแทนให้
// ตัวกันชื่อต้องห้ามใช้กับทั้งรูปแบบ "ทั้งโฟลเดอร์" และ "ไฟล์ .js" (รอบสองของ #97 ผู้ตรวจพบว่า !/evidence/x.js หลุด)
const GITIGNORE_ADD = /^(|#.*|!\/(?!(?:evidence|node_modules|test-results|playwright-report)\b)(?:[A-Za-z0-9_\-]+\/?|[A-Za-z0-9_\-./]+\.js))$/;

const MAX_BUF = 512 * 1024 * 1024; // ไฟล์แอปมีไลบรารีฝังอยู่ ~1.4 MB ค่าเริ่มต้น 1 MB ไม่พอ
const MAX_SHOW = 30;

// เก็บ stderr ของ git ไว้เอง แล้วรายงานผ่านข้อความของเรา — ไม่ปล่อยให้ไหลปนผลลัพธ์
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      encoding: 'utf8', maxBuffer: MAX_BUF, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const why = String(e.stderr || e.message).trim().split('\n')[0];
    throw new Error(`git ${args[0]} ล้ม: ${why}`);
  }
};

const isBlank = s => s.trim() === '';
const isUnitStart = s => /^[^\s})\]]/.test(s);
const short = s => {
  const t = s.trim();
  return t.length > 70 ? t.slice(0, 70) + '…' : t;
};

// ── อ่าน diff ─────────────────────────────────────────────────────
// อ่านเนื้อใน hunk ตามจำนวนบรรทัดที่หัว @@ บอก ไม่ใช่ดูจากตัวอักษรนำหน้า
// ไม่งั้นบรรทัดโค้ดที่ขึ้นต้นด้วย "-- " จะกลายเป็นหัวไฟล์ "--- " แล้วอ่านเพี้ยนเงียบ ๆ
function parseDiff(text) {
  const lines = text.split('\n');
  const files = [];
  let cur = null;
  const pathOf = (s, prefix) => {
    s = s.replace(/\t$/, '');
    if (s === '/dev/null') return null;
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s.startsWith(prefix) ? s.slice(prefix.length) : s;
  };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('diff --git ')) {
      cur = { oldPath: null, newPath: null, runs: [], binary: false };
      files.push(cur);
      i++;
      continue;
    }
    if (cur && l.startsWith('--- ')) { cur.oldPath = pathOf(l.slice(4), 'a/'); i++; continue; }
    if (cur && l.startsWith('+++ ')) { cur.newPath = pathOf(l.slice(4), 'b/'); i++; continue; }
    if (cur && l.startsWith('Binary files ')) { cur.binary = true; i++; continue; }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (cur && h) {
      const oldCount = h[2] === undefined ? 1 : +h[2];
      const newCount = h[4] === undefined ? 1 : +h[4];
      const rem = { side: '-', start: +h[1], lines: [] };
      const add = { side: '+', start: +h[3], lines: [] };
      i++;
      while ((rem.lines.length < oldCount || add.lines.length < newCount) && i < lines.length) {
        const c = lines[i];
        if (c.startsWith('\\')) { i++; continue; } // "\ No newline at end of file"
        const body = c.slice(1).replace(/\r$/, '');
        if (c[0] === '-' && rem.lines.length < oldCount) rem.lines.push(body);
        else if (c[0] === '+' && add.lines.length < newCount) add.lines.push(body);
        else throw new Error(`อ่าน diff ไม่ออกที่บรรทัด ${i + 1}: ${c.slice(0, 60)}`);
        i++;
      }
      if (rem.lines.length) cur.runs.push(rem);
      if (add.lines.length) cur.runs.push(add);
      continue;
    }
    i++;
  }
  return files;
}

// ── แบ่งช่วงที่เปลี่ยนเป็นก้อน ──────────────────────────────────────
function segment(run, file, fileLines, appFiles, problems) {
  const side = run.side;
  const path = side === '-' ? file.oldPath : file.newPath;
  const allow = side === '-' ? ALLOW_REMOVED : ALLOW_ADDED;
  const units = [];
  let special = 0;
  let u = null;

  const close = () => {
    if (!u) return;
    while (u.lines.length && isBlank(u.lines[u.lines.length - 1])) u.lines.pop();
    if (u.special) {
      special++;
      if (u.lines.length > 1) {
        problems.push({ path, line: u.line, msg: `บรรทัดพิเศษ "${short(u.lines[0])}" ต้องอยู่เดี่ยว ๆ แต่มีบรรทัดอื่นห้อยอยู่ใต้มัน` });
      }
      const src = side === '+' ? SCRIPT_SRC.exec(u.lines[0]) : null;
      if (src && !appFiles.has(src[1])) {
        problems.push({ path, line: u.line, msg: `แท็กโหลดไฟล์ชี้ไปที่ "${src[1]}" ซึ่งไม่ใช่ไฟล์แอปใน repo นี้ — โค้ดในนั้นไม่ได้ผ่านการพิสูจน์` });
      }
    } else if (!u.fragment) {
      units.push({ text: u.lines.join('\n'), path, line: u.line });
    }
    u = null;
  };

  run.lines.forEach((s, k) => {
    const line = run.start + k;
    if (isUnitStart(s)) {
      close();
      u = { line, lines: [s], special: allow.some(re => re.test(s)) };
      return;
    }
    if (u) { u.lines.push(s); return; }
    if (isBlank(s)) return;
    problems.push({
      path, line,
      msg: side === '-'
        ? 'ตัดกลางก้อน — ช่วงที่ลบเริ่มจากบรรทัดที่ย่อหน้า (เนื้อในของก้อนอื่น) ไม่ใช่ต้นก้อน'
        : 'แทรกกลางก้อน — ช่วงที่เพิ่มเริ่มจากบรรทัดที่ย่อหน้า ไม่ใช่ต้นก้อน',
    });
    u = { line, lines: [s], fragment: true };
  });
  close();

  // บรรทัดถัดจากช่วง ต้องไม่ใช่เนื้อในของก้อนเดิม — ช่วงที่มีแต่บรรทัดพิเศษไม่ต้องตรวจ
  // (เช่นบัมป์เลขรุ่นกลางส่วนหัวของ HTML ที่บรรทัดรอบ ๆ ย่อหน้าไว้)
  const hasCode = run.lines.some(s => !isBlank(s) && !(isUnitStart(s) && allow.some(re => re.test(s))));
  if (hasCode) {
    const after = fileLines[run.start - 1 + run.lines.length];
    if (after !== undefined && !isBlank(after) && !isUnitStart(after)) {
      problems.push({
        path, line: run.start + run.lines.length,
        msg: side === '-'
          ? 'ตัดกลางก้อน — บรรทัดถัดจากช่วงที่ลบยังเป็นเนื้อในของก้อนเดิม (ย้ายไปไม่ครบทั้งก้อน)'
          : 'แทรกกลางก้อน — บรรทัดถัดจากช่วงที่เพิ่มเป็นเนื้อในของก้อนอื่น',
      });
    }
  }
  return { units, special };
}

// บรรทัดแรกที่ต่างกัน — ช่วยคนแก้หาว่าย้ายแล้วเผลอแก้ตรงไหน
function firstDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let k = 0; k < Math.max(x.length, y.length); k++) {
    if (x[k] !== y[k]) return { k, was: x[k] ?? '(ไม่มีบรรทัดนี้)', now: y[k] ?? '(ไม่มีบรรทัดนี้)' };
  }
  return null;
}

function main(argv) {
  const [base, ...pathspec] = argv;
  if (!base || pathspec.length === 0) {
    console.log('ใช้งาน: node .github/scripts/move-proof.mjs <base> <pathspec...>');
    return 2;
  }
  process.chdir(git('rev-parse', '--show-toplevel').trim());
  const mb = git('merge-base', base, 'HEAD').trim();
  const diff = git('diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--no-textconv', mb, 'HEAD', '--', ...pathspec);
  const files = parseDiff(diff);
  // ไฟล์แอปทั้งหมดใน HEAD ตามนิยามเดียวกับที่ผู้เรียกส่งมา — ใช้ตรวจว่า <script src> ชี้ไปของที่ควรชี้
  const appFiles = new Set(git('ls-files', '-z', '--', ...pathspec).split('\0').filter(Boolean));

  const cache = new Map();
  const linesAt = (rev, path) => {
    if (!path) return [];
    const key = rev + '\0' + path;
    if (!cache.has(key)) {
      const arr = git('show', `${rev}:${path}`).split('\n').map(s => s.replace(/\r$/, ''));
      if (arr.length && arr[arr.length - 1] === '') arr.pop();
      cache.set(key, arr);
    }
    return cache.get(key);
  };

  const problems = [];
  const removed = [], added = [];
  let special = 0;
  const outCount = new Map(), inCount = new Map();

  for (const f of files) {
    if (f.binary) {
      problems.push({ path: f.newPath || f.oldPath, line: 1, msg: 'ไฟล์ถูกมองเป็นไบนารี อ่านเนื้อในไม่ได้ จึงพิสูจน์ไม่ได้' });
      continue;
    }
    for (const run of f.runs) {
      const fl = run.side === '-' ? linesAt(mb, f.oldPath) : linesAt('HEAD', f.newPath);
      const r = segment(run, f, fl, appFiles, problems);
      special += r.special;
      const bucket = run.side === '-' ? removed : added;
      const count = run.side === '-' ? outCount : inCount;
      for (const u of r.units) {
        bucket.push(u);
        count.set(u.path, (count.get(u.path) || 0) + 1);
      }
    }
  }

  // ── เทียบก้อนสองฝั่ง ──
  const bag = new Map();
  const entry = t => { if (!bag.has(t)) bag.set(t, { rem: [], add: [] }); return bag.get(t); };
  for (const u of removed) entry(u.text).rem.push(u);
  for (const u of added) entry(u.text).add.push(u);

  const lost = [], fresh = [];
  for (const [text, e] of bag) {
    if (text === USE_STRICT) {
      if (e.rem.length > e.add.length) {
        const at = e.rem[0];
        problems.push({ path: at.path, line: at.line, msg: `ลบ ${USE_STRICT} ออก ${e.rem.length - e.add.length} ที่โดยไม่ได้พาไปด้วย — โค้ดที่เหลือในไฟล์นั้นจะกลับไปโหมดหลวม` });
      }
      continue; // เพิ่มเกินได้ — ไฟล์ใหม่ทุกไฟล์ต้องมี
    }
    if (e.rem.length > e.add.length) lost.push({ text, e });
    if (e.add.length > e.rem.length) fresh.push({ text, e });
  }
  // ก้อนที่หายกับก้อนที่โผล่ใหม่ซึ่งขึ้นต้นเหมือนกัน = เกือบแน่นอนว่าถูกแก้ระหว่างย้าย
  const firstLine = t => t.split('\n')[0];
  for (const n of fresh) {
    const k = lost.findIndex(o => firstLine(o.text) === firstLine(n.text));
    const at = n.e.add[0];
    if (k >= 0) {
      const o = lost.splice(k, 1)[0];
      const d = firstDiff(o.text, n.text);
      problems.push({
        path: at.path, line: at.line + (d ? d.k : 0),
        msg: `ถูกแก้ระหว่างย้าย (เดิมอยู่ ${o.e.rem[0].path}:${o.e.rem[0].line})` +
          (d ? ` — เดิม: "${short(d.was)}" · ใหม่: "${short(d.now)}"` : ''),
      });
    } else {
      problems.push({
        path: at.path, line: at.line,
        msg: `โค้ดใหม่ — ก้อนนี้โผล่มา ${n.e.add.length} ครั้ง แต่ถูกลบจากที่เดิม ${n.e.rem.length} ครั้ง: "${short(firstLine(n.text))}"`,
      });
    }
  }
  for (const o of lost) {
    const at = o.e.rem[0];
    problems.push({
      path: at.path, line: at.line,
      msg: `โค้ดหาย — ก้อนนี้ถูกลบ ${o.e.rem.length} ครั้ง แต่ไปโผล่ที่อื่น ${o.e.add.length} ครั้ง: "${short(firstLine(o.text))}"`,
    });
  }

  // ── ไฟล์นอกขอบเขต ──
  const inScope = new Set(git('diff', '--name-only', '-z', '--no-renames', mb, 'HEAD', '--', ...pathspec).split('\0').filter(Boolean));
  const ns = git('diff', '--name-status', '-z', '--no-renames', mb, 'HEAD').split('\0').filter(Boolean);
  const eyes = [];
  for (let k = 0; k + 1 < ns.length; k += 2) {
    const status = ns[k][0], path = ns[k + 1];
    if (inScope.has(path)) continue;
    if (path === '.gitignore' && status === 'M') {
      const d = git('diff', '-U0', '--no-color', mb, 'HEAD', '--', '.gitignore').split('\n');
      const bad = d.filter(l => (l.startsWith('-') && !l.startsWith('---')) ||
        (l.startsWith('+') && !l.startsWith('+++') && !GITIGNORE_ADD.test(l.slice(1).replace(/\r$/, ''))));
      if (bad.length) {
        problems.push({ path, line: 1, msg: `.gitignore ในใบย้ายอย่างเดียวเพิ่มได้แค่บรรทัดอนุญาตโฟลเดอร์/ไฟล์ .js ใหม่ — เจอ "${short(bad[0])}"` });
      } else eyes.push(`${path} (เพิ่มบรรทัดอนุญาตไฟล์ใหม่)`);
      continue;
    }
    if (path.startsWith('tests/') && status === 'A') { eyes.push(`${path} (เทสใหม่)`); continue; }
    if (path === 'CLAUDE.md' && status === 'M') { eyes.push(`${path} (เอกสาร)`); continue; }
    const how = { A: 'เพิ่ม', M: 'แก้', D: 'ลบ', T: 'เปลี่ยนชนิด' }[status] || status;
    problems.push({ path, line: 1, msg: `${how}ไฟล์นอกขอบเขตที่พิสูจน์ได้ — ใบย้ายอย่างเดียวแตะได้แค่ .gitignore (บรรทัดอนุญาต) · เทสใหม่ · CLAUDE.md` });
  }

  console.log(`ตรวจการย้าย: ก้อนที่ถูกลบ ${removed.length} · ก้อนที่ถูกเพิ่ม ${added.length} · บรรทัดพิเศษ ${special}`);
  for (const [p, n] of outCount) console.log(`  - ${p}: ย้ายออก ${n} ก้อน`);
  for (const [p, n] of inCount) console.log(`  + ${p}: ย้ายเข้า ${n} ก้อน`);
  if (eyes.length) {
    console.log('ไฟล์นอกขอบเขตการพิสูจน์ — ต้องอ่านด้วยตา ตัวพิสูจน์ไม่ได้อ่านเนื้อในให้:');
    for (const e of eyes) console.log(`  ? ${e}`);
  }

  if (problems.length) {
    console.log(`✗ ไม่ใช่การย้ายอย่างเดียว — พบ ${problems.length} จุด`);
    for (const p of problems.slice(0, MAX_SHOW)) console.log(`  ${p.path}:${p.line} ${p.msg}`);
    if (problems.length > MAX_SHOW) console.log(`  …และอีก ${problems.length - MAX_SHOW} จุด`);
    return 1;
  }
  console.log('✓ พิสูจน์แล้วว่าย้ายอย่างเดียว — ทุกก้อนที่ถูกลบไปโผล่ที่อื่นครบทุกตัวอักษร ไม่มีโค้ดใหม่ ไม่มีโค้ดหาย');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.log(`✗ ตรวจไม่ได้ — ${e.message}`);
  process.exitCode = 2;
}
