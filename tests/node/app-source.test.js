// เทสของ "ตัวช่วยอ่านซอร์สของแอป" และกฎที่ทำให้มันเชื่อได้ — รันด้วย node ล้วน (npm run test:core)
//
// ทำไมต้องมี: แผนแยกไฟล์ (CLAUDE.md §3.1) จะย้ายโค้ดออกจาก HTML ทีละก้อน
// เทสที่อ่านซอร์สจาก HTML ตรง ๆ จะเขียวเองโดยไม่ได้ตรวจอะไร (ข้อ "ต้องไม่มี X")
// และใบย้ายโค้ดแก้เทสเดิมไม่ได้ — กฎพวกนี้ต้องถูกบังคับด้วยเครื่อง ตั้งแต่ก่อนย้ายก้อนแรก

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, appHtml, appSources, appSource, fnSource } = require('../app-source');

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
