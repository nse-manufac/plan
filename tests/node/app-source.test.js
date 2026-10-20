// เทสของ "ตัวช่วยอ่านซอร์สของแอป" และกฎที่ทำให้มันเชื่อได้ — รันด้วย node ล้วน (npm run test:core)
//
// ทำไมต้องมี: แผนแยกไฟล์ (CLAUDE.md §3.1) จะย้ายโค้ดออกจาก HTML ทีละก้อน
// เทสที่อ่านซอร์สจาก HTML ตรง ๆ จะเขียวเองโดยไม่ได้ตรวจอะไร (ข้อ "ต้องไม่มี X")
// และใบย้ายโค้ดแก้เทสเดิมไม่ได้ — กฎพวกนี้ต้องถูกบังคับด้วยเครื่อง ตั้งแต่ก่อนย้ายก้อนแรก

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ROOT, appHtml, appSources, appSource, fnSource, scriptTags } = require('../app-source');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

test('ทุก <script src> ในหน้า ชี้ไปไฟล์ที่มีอยู่จริงใน repo', () => {
  const missing = appSources().slice(1).map(s => s.file)
    .filter(f => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, []);
});

test('ไม่มีไฟล์ .js ของแอปที่หน้าไม่ได้โหลด — ไฟล์กำพร้าคือโค้ดที่ไม่มีเทสไหนเห็น', () => {
  // นิยามเดียวกับ VERSIONED_PATHSPEC ใน .github/scripts/app-files.sh
  const tracked = git('ls-files', '-z', '--', '*.js', ':(exclude)tests/**', ':(exclude)playwright.config.js')
    .split('\0').filter(Boolean);
  const loaded = new Set(appSources().slice(1).map(s => s.file));
  assert.deepEqual(tracked.filter(f => !loaded.has(f)), [],
    'ไฟล์เหล่านี้อยู่ใน repo แต่หน้าไม่ได้โหลด — ลืมใส่ <script src> หรือเป็นของค้างที่ต้องลบ');
});

test('appSource() รวม HTML กับทุกไฟล์ที่หน้าโหลด ตามลำดับการโหลด', () => {
  const all = appSource();
  const parts = appSources();
  assert.equal(parts[0].file, 'production_plan_tracker.html');
  assert.ok(all.startsWith(appHtml()), 'ต้องขึ้นต้นด้วย HTML');
  let at = 0;
  for (const { file, text } of parts) {
    const i = all.indexOf(text, at);
    assert.ok(i >= at, `${file} ต้องอยู่ในซอร์สรวมตามลำดับการโหลด`);
    at = i + text.length;
  }
});

test('fnSource() ได้ตัวฟังก์ชันทั้งตัวหนึ่งที่พอดี ไม่ว่าจะอยู่ไฟล์ไหน', () => {
  const body = fnSource('deliveryGroups');
  assert.match(body, /^function deliveryGroups\(/);
  assert.match(body, /\n\}\s*$/, 'ต้องจบที่ปีกกาปิดของตัวเอง');
  assert.ok(!/\nfunction /.test(body), 'ต้องไม่กินฟังก์ชันถัดไปเข้ามา');
});

test('fnSource() หาไม่เจอต้องโยน error ดัง ๆ — ไม่ใช่คืนค่าว่างให้เทส "ต้องไม่มี X" เขียวหลอก', () => {
  assert.throws(() => fnSource('ไม่มีฟังก์ชันนี้แน่นอน'), /เจอ 0 ที่/);
});

test('ไม่มีเทสไหนอ่านซอร์สจาก HTML ตรง ๆ — ต้องผ่าน tests/app-source.js เท่านั้น', () => {
  const dir = path.join(ROOT, 'tests');
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f === 'app-source.js') continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // อ่านไฟล์ HTML จากดิสก์ (path.join/resolve ไปที่ไฟล์) หรือดักแก้เฉพาะ HTML ตอนหน้าโหลด
    if (/(join|resolve)\([^)]*production_plan_tracker\.html/.test(src)) offenders.push(`${f} (อ่านไฟล์ HTML ตรง ๆ → ใช้ appHtml/appSource/fnSource)`);
    if (/page\.route\(\s*\/production_plan_tracker/.test(src)) offenders.push(`${f} (ดักแก้เฉพาะ HTML → ใช้ patchAppSource)`);
  }
  assert.deepEqual(offenders, []);
});

test('แท็ก <script> ทุกตัวในหน้าต้องเป็นรูปแบบเดียวที่ตัวช่วยอ่านออก — ไม่งั้นเทส F4 กับตัวพิสูจน์มองไม่เห็น', () => {
  // Codex ตรวจซ้ำ #109: เพิ่ม <script src="lib/exceljs.min.js" ></script> (เว้นวรรคเกินหนึ่งตัว)
  // เบราว์เซอร์โหลดจริง แต่ scriptTags() ไม่เห็น → F4 เขียวทั้งที่แท็กนั้นไม่มี ?v= และไฟล์ไม่ใช่กำพร้าเพราะมีแท็กเดิมอยู่แล้ว
  // จึงนับจากทุกบรรทัดที่มี "<script" (ไม่สนตัวพิมพ์) แล้วทุกบรรทัดต้องเป็นรูปแบบเดียวกับ SCRIPT_SRC เป๊ะ ๆ
  // ผลพลอยได้: ห้ามฝังโค้ดใน <script> ในหน้าแล้ว — โค้ดอยู่ใน app.js ตั้งแต่ใบ 03 (เทสอ่านซอร์สจึงไม่หลุด)
  const canonical = /^<script src="[^"?]+\?v=[^"]+"><\/script>\r?$/;
  const lines = appHtml().split('\n');
  const odd = lines.map((s, k) => ({ s, n: k + 1 }))
    .filter(({ s }) => /<\/?script\b/i.test(s) && !canonical.test(s))
    .map(({ s, n }) => `บรรทัด ${n}: ${s.trim().slice(0, 80)}`);
  assert.deepEqual(odd, [], 'เขียนแท็กเป็น <script src="ไฟล์?v=..."></script> บรรทัดเดียว ชิดซ้าย ไม่มีอย่างอื่น (CLAUDE.md §3.1 ข้อ 8)');
  assert.equal(scriptTags().length, lines.filter(s => /<script\b/i.test(s)).length);
});

test('F4 — ทุก <script src> ต่อท้าย ?v= · ไฟล์แอป = เลขรุ่นใน <meta> · lib/ = แฮชของเนื้อไฟล์', () => {
  // ปุ่ม "มีรุ่นใหม่" บัสต์แคชได้แค่ HTML (?_v=) · ไฟล์ที่หน้าโหลดจะได้ของใหม่ก็ต่อเมื่อ URL เปลี่ยน
  // ลืมบัมป์ ?v= = เครื่องที่ค้างไฟล์เก่าเห็นเลขรุ่นใหม่บนหัวจอแต่รันโค้ดเก่า — "เลขรุ่นที่โกหก" ที่ F4 ห้าม
  // lib/ ใช้แฮชของเนื้อไฟล์แทนเลขรุ่น (ผู้ตรวจ #109): ไลบรารี ~1 MB ไม่ต้องโหลดใหม่ทุกครั้งที่ออกรุ่น
  // แต่เปลี่ยนเมื่อไฟล์เปลี่ยนจริงเสมอ · แฮชคิดหลังแปลง CRLF เป็น LF — Windows เช็กเอาต์เป็น CRLF แต่ CI เป็น LF
  const meta = /<meta name="app-version" content="([^"]*)">/.exec(appHtml());
  assert.ok(meta, 'ไม่พบ <meta name="app-version">');
  const tags = scriptTags();
  assert.ok(tags.length > 0, 'ไม่พบแท็ก <script src> เลย — ตัวอ่านแท็กอาจพัง เทสนี้จะผ่านแบบไม่ได้ตรวจอะไร');
  const want = file => file.startsWith('lib/')
    ? crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 8)
    : meta[1];
  const wrong = tags.filter(t => t.v !== want(t.file)).map(t => `${t.file}?v=${t.v ?? '(ไม่มี)'} → ควรเป็น ?v=${want(t.file)}`);
  assert.deepEqual(wrong, []);
});
