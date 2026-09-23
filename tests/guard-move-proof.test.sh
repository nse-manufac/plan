#!/usr/bin/env bash
# เทสของตัวพิสูจน์ "ย้ายอย่างเดียว" — เรียกสคริปต์ตัวจริงแบบเดียวกับที่ workflow เรียก
#
# สร้าง repo จำลองในโฟลเดอร์ชั่วคราว แล้วทำ PR สมมติหลายแบบ
# ครึ่งหนึ่งคือท่าย้ายที่ถูกต้องซึ่งต้องผ่าน อีกครึ่งคือท่าที่แอบแก้โค้ดระหว่างย้ายซึ่งต้องตก
# ถ้าวันไหนกรณี "ต้องตก" กลายเป็นผ่าน = ด่านมีรู ห้ามแก้เทสให้เขียว ต้องแก้ด่าน
#
# รันเอง:  bash tests/guard-move-proof.test.sh

set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROOF="$ROOT/.github/scripts/move-proof.mjs"
source "$ROOT/.github/scripts/app-files.sh"

pass=0
fail=0

# expect <pass|fail> <คำอธิบาย> — เรียกเหมือน workflow ทุกตัวอักษร
expect() {
  local got out
  if out=$(node "$PROOF" main "${VERSIONED_PATHSPEC[@]}" 2>&1); then got=pass; else got=fail; fi
  if [ "$got" = "$1" ]; then
    pass=$((pass + 1)); printf '  ok   %s\n' "$2"
    # SHOW=1 bash tests/guard-move-proof.test.sh — ดูว่าแต่ละกรณีตกด้วยเหตุผลที่ตั้งใจจริง ไม่ใช่ตกเพราะบังเอิญ
    [ "${SHOW:-}" = 1 ] && printf '%s\n' "$out" | sed 's/^/         /'
  else
    fail=$((fail + 1)); printf '  FAIL %s  (ควรได้ %s แต่ได้ %s)\n' "$2" "$1" "$got"
    printf '%s\n' "$out" | sed 's/^/         /'
  fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK" || exit 1

git init -q .
git config user.email tester@example.com
git config user.name tester
git config core.autocrlf false
git config commit.gpgsign false

# ── หน้าตาเหมือนไฟล์แอปจริงย่อส่วน: โค้ดระดับบนสุดชิดซ้ายในบล็อก <script> ──
cat > production_plan_tracker.html <<'EOF'
<!doctype html>
<html>
<head>
<meta name="app-version" content="2026-01-01.1">
  <title>แผน</title>
</head>
<body>
  <div id="app"></div>
<script>
/* ===================== App Logic ===================== */
"use strict";

/* ---------- Basic helpers ---------- */
function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmt(d){
  return d.toISOString().slice(0, 10);
}

/* ---------- Status ---------- */
const LIMIT = 3;
function status(n){
  if(n > LIMIT) return 'late';
  -- n;
  return 'ok';
}

/* ---------- Init ---------- */
document.getElementById('app').textContent = status(1);
</script>
</body>
</html>
EOF
mkdir -p core lib tests
printf '"use strict";\n\nfunction keep(){\n  return 1;\n}\n' > core/keep.js
git add -A && git commit -qm base
git branch -M main

scenario() {  # scenario <ชื่อ branch ชั่วคราว>
  git checkout -q main
  git branch -qD "$1" 2>/dev/null
  git checkout -qb "$1"
}
seal() { git add -A && git commit -qm "$1"; }

# ตัดบรรทัดช่วงหนึ่งออกจากไฟล์ แล้วคืนเนื้อที่ตัดออกมา — ท่าเดียวกับที่ agent จะใช้ย้ายจริง
cut_lines() {  # cut_lines <ไฟล์> <จากบรรทัด> <ถึงบรรทัด>  → พิมพ์ช่วงที่ตัดออกทาง stdout
  sed -n "$2,$3p" "$1"
  sed -i "$2,$3d" "$1"
}
line_of() { grep -n -F -- "$2" "$1" | head -1 | cut -d: -f1; }

echo "ตัวพิสูจน์ \"ย้ายอย่างเดียว\""

# ═══════════════ ท่าที่ถูกต้อง — ต้องผ่าน ═══════════════

scenario move-helpers
a=$(line_of production_plan_tracker.html 'function addDays'); b=$(line_of production_plan_tracker.html '/* ---------- Status')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((b - 2)); } > core/dates.js
sed -i 's|^<script>$|<script src="core/dates.js"></script>\n<script>|' production_plan_tracker.html
seal move
expect pass 'ย้ายสองฟังก์ชันออกไปเป็นไฟล์ใหม่ + "use strict" + แท็กโหลดไฟล์'

scenario move-with-version
a=$(line_of production_plan_tracker.html 'const LIMIT'); b=$(line_of production_plan_tracker.html '/* ---------- Init')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((b - 2)); } > core/status.js
sed -i 's|^<script>$|<script src="core/status.js"></script>\n<script>|' production_plan_tracker.html
sed -i 's|content="2026-01-01.1"|content="2026-01-01.2"|' production_plan_tracker.html
seal move
expect pass 'ย้ายพร้อมบัมป์เลขรุ่น (บรรทัดเลขรุ่นอยู่ในส่วนหัวที่ย่อหน้าไว้)'

scenario move-dashdash
# บรรทัด "-- n;" ใน diff กลายเป็น "--- n;" หน้าตาเหมือนหัวไฟล์ — ตัวอ่าน diff ต้องไม่หลง
a=$(line_of production_plan_tracker.html 'function status'); b=$(line_of production_plan_tracker.html '/* ---------- Init')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((b - 2)); } > core/status.js
sed -i 's|^<script>$|<script src="core/status.js"></script>\n<script>|' production_plan_tracker.html
seal move
expect pass 'ย้ายก้อนที่มีบรรทัดขึ้นต้นด้วย "-- " (กับดักตัวอ่าน diff)'

scenario move-whole-script
# ย้ายโค้ดทั้งบล็อก <script> ไปเป็น app.js — ก้อนที่ 03 ของแผน
a=$(line_of production_plan_tracker.html '<script>'); b=$(line_of production_plan_tracker.html '</script>')
cut_lines production_plan_tracker.html $((a + 1)) $((b - 1)) > app.js
sed -i "${a},$((a + 1))d" production_plan_tracker.html
sed -i "$((a - 1))a <script src=\"app.js\"></script>" production_plan_tracker.html
sed -i 's|^ <script src|<script src|' production_plan_tracker.html
seal move
expect pass 'ย้ายโค้ดทั้งบล็อก <script> ไปเป็น app.js (ถอดแท็กเปิด/ปิดได้)'

scenario move-js-to-js
cut_lines core/keep.js 3 5 > /dev/null
printf '"use strict";\n\nfunction keep(){\n  return 1;\n}\n' > core/other.js
seal move
expect pass 'ย้ายก้อนจาก .js หนึ่งไปอีก .js หนึ่ง'

scenario split-two-files
a=$(line_of production_plan_tracker.html 'function addDays'); b=$(line_of production_plan_tracker.html 'function fmt')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((b - 1)); } > core/a.js
a=$(line_of production_plan_tracker.html 'function fmt')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((a + 2)); } > core/b.js
seal split
expect pass 'แบ่งช่วงติดกันออกไปสองไฟล์'

scenario gather
# เก็บฟังก์ชันที่กระจายอยู่สองที่ มารวมไว้ไฟล์เดียว
a=$(line_of production_plan_tracker.html 'function status')
s=$(cut_lines production_plan_tracker.html "$a" $((a + 4)))
a=$(line_of production_plan_tracker.html 'function fmt')
f=$(cut_lines production_plan_tracker.html "$a" $((a + 2)))
printf '"use strict";\n\n%s\n\n%s\n' "$f" "$s" > core/mixed.js
seal gather
expect pass 'รวมก้อนจากหลายที่ไว้ไฟล์เดียว (ลำดับระหว่างก้อนเปลี่ยนได้)'

scenario rename-file
git mv core/keep.js core/renamed.js
seal rename
expect pass 'ย้ายทั้งไฟล์ด้วย git mv'

scenario vendor-like
# บรรทัดยาวแบบไลบรารีที่ฝังไว้ — ย้ายตรงทุกไบต์ต้องผ่าน (ตัวพิสูจน์ไม่ตัดสินเรื่อง vendor ด่าน vendor ตัดสินแยก)
{ printf 'var LIB="'; head -c 30000 < /dev/zero | tr '\0' 'x'; printf '";\n'; } > long.txt
sed -i "/^<script>\$/r long.txt" production_plan_tracker.html
rm long.txt
seal add-long
git branch -qf main HEAD
scenario vendor-like-move
a=$(line_of production_plan_tracker.html 'var LIB=')
cut_lines production_plan_tracker.html "$a" "$a" > lib/lib.js
sed -i 's|^<script>$|<script src="lib/lib.js"></script>\n<script>|' production_plan_tracker.html
seal move
expect pass 'ย้ายบรรทัดยาว 30,000 ตัวอักษรตรงทุกไบต์'
git checkout -q main && git reset -q --hard HEAD~1

scenario nothing
printf '# เอกสาร\n' > NOTE.md
seal docs
expect pass 'ไม่แตะไฟล์แอปเลย'

# ═══════════════ ท่าโกง — ต้องตกทุกข้อ ═══════════════

scenario edit-during-move
a=$(line_of production_plan_tracker.html 'function addDays'); b=$(line_of production_plan_tracker.html '/* ---------- Status')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((b - 2)); } > core/dates.js
sed -i 's/getDate() + n/getDate() + n + 1/' core/dates.js
sed -i 's|^<script>$|<script src="core/dates.js"></script>\n<script>|' production_plan_tracker.html
seal edit
expect fail 'แก้ตัวอักษรเดียวระหว่างย้าย'

scenario reorder-inside
a=$(line_of production_plan_tracker.html 'function status')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((a + 4)); } > core/status.js
# สลับสองบรรทัดในฟังก์ชัน — ทุกบรรทัดยังอยู่ครบ แต่ความหมายเปลี่ยน
sed -i '/-- n;/{N;s/\(.*\)\n\(.*\)/\2\n\1/}' core/status.js
seal reorder
expect fail 'สลับลำดับบรรทัดในฟังก์ชัน (ทุกบรรทัดยังอยู่ครบ)'

scenario drop-line
a=$(line_of production_plan_tracker.html 'function status')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((a + 4)); } > core/status.js
sed -i '/-- n;/d' core/status.js
seal drop
expect fail 'ย้ายแล้วลืมบรรทัดหนึ่ง'

scenario copy-not-move
a=$(line_of production_plan_tracker.html 'function fmt')
{ printf '"use strict";\n\n'; sed -n "$a,$((a + 2))p" production_plan_tracker.html; } > core/fmt.js
seal copy
expect fail 'ก็อปไปแต่ไม่ลบของเดิม (โค้ดซ้ำสองที่)'

scenario delete-only
a=$(line_of production_plan_tracker.html 'function fmt')
sed -i "$a,$((a + 2))d" production_plan_tracker.html
seal delete
expect fail 'ลบฟังก์ชันทิ้งเฉย ๆ'

scenario new-code
printf 'function evil(){\n  fetch("/x");\n}\n' >> core/keep.js
seal new
expect fail 'เพิ่มฟังก์ชันใหม่'

scenario move-plus-new
a=$(line_of production_plan_tracker.html 'function fmt')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((a + 2)); printf '\nfunction extra(){}\n'; } > core/fmt.js
seal mix
expect fail 'ย้ายถูกต้อง แต่แถมโค้ดใหม่มาในไฟล์เดียวกัน'

scenario cut-half
a=$(line_of production_plan_tracker.html 'function status')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((a + 2)); } > core/half.js
seal half
expect fail 'ย้ายไปแค่ครึ่งฟังก์ชัน (ตัดกลางก้อน)'

scenario cut-body
a=$(line_of production_plan_tracker.html 'function status')
cut_lines production_plan_tracker.html $((a + 1)) $((a + 3)) > body.txt
{ printf '"use strict";\n\nfunction status2(){\n'; cat body.txt; printf '}\n'; } > core/body.js
rm body.txt
seal body
expect fail 'ย้ายเฉพาะเนื้อในฟังก์ชัน (ช่วงที่ลบเริ่มกลางก้อน)'

scenario insert-inside
# เอาฟังก์ชันไปวางกลางเนื้อในของฟังก์ชันที่มีอยู่แล้ว — ทุกตัวอักษรตรง แต่ขอบเขตตัวแปรเปลี่ยน
a=$(line_of production_plan_tracker.html 'function fmt')
cut_lines production_plan_tracker.html "$a" $((a + 2)) > frag.txt
sed -i '/^function keep(){$/r frag.txt' core/keep.js
rm frag.txt
seal insert
expect fail 'เอาฟังก์ชันไปวางกลางเนื้อในของฟังก์ชันอื่น'

scenario insert-before-closer
a=$(line_of production_plan_tracker.html 'function fmt')
cut_lines production_plan_tracker.html "$a" $((a + 2)) > frag.txt
sed -i '/^  return 1;$/r frag.txt' core/keep.js
rm frag.txt
seal insert2
expect fail 'เอาฟังก์ชันไปวางก่อนปีกกาปิดของฟังก์ชันอื่น (ซ้อนเข้าไปข้างใน)'

scenario external-src
a=$(line_of production_plan_tracker.html 'function fmt')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((a + 2)); } > core/fmt.js
sed -i 's|^<script>$|<script src="https://cdn.example.com/x.js"></script>\n<script>|' production_plan_tracker.html
seal ext
expect fail 'แท็กโหลดไฟล์จากเน็ต'

scenario escape-src
a=$(line_of production_plan_tracker.html 'function fmt')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((a + 2)); } > core/fmt.js
sed -i 's|^<script>$|<script src="../other/x.js"></script>\n<script>|' production_plan_tracker.html
seal esc
expect fail 'แท็กโหลดไฟล์นอก repo (..)'

scenario tests-src
# ไฟล์ใน tests/ ไม่อยู่ใน diff ที่ถูกพิสูจน์ — แท็กที่ชี้ไปจะพาโค้ดที่ไม่มีใครพิสูจน์เข้าไปรันในแอป
printf 'window.x = 1;\n' > tests/fixture.js
sed -i 's|^<script>$|<script src="tests/fixture.js"></script>\n<script>|' production_plan_tracker.html
seal tsrc
expect fail 'แท็กโหลดไฟล์ที่ชี้ไป tests/'

scenario missing-src
sed -i 's|^<script>$|<script src="core/nope.js"></script>\n<script>|' production_plan_tracker.html
seal msrc
expect fail 'แท็กโหลดไฟล์ที่ไม่มีอยู่จริง'

scenario inline-src
sed -i 's|^<script>$|<script src="core/keep.js">alert(1)</script>\n<script>|' production_plan_tracker.html
seal inl
expect fail 'แท็กโหลดไฟล์ที่แอบมีโค้ดอยู่ข้างใน'

scenario special-with-tail
printf '"use strict";\n  window.x = 1;\n' > core/tail.js
seal tail
expect fail '"use strict" ที่มีโค้ดย่อหน้าห้อยอยู่ใต้มัน'

scenario remove-use-strict
sed -i '/^"use strict";$/d' core/keep.js
seal nostrict
expect fail 'ลบ "use strict" ออก (โค้ดที่เหลือกลับไปโหมดหลวม)'

scenario edit-markup
sed -i 's|<title>แผน</title>|<title>แผนใหม่</title>|' production_plan_tracker.html
seal markup
expect fail 'แก้ HTML ส่วนอื่นที่ไม่ใช่การย้าย'

# ── ต้องรอดใต้ `set -euo pipefail` แบบที่ workflow รันจริง และคืนค่าถูกทาง ──
# (บทเรียนจาก app-files.sh: เทสเขียวแต่ของจริงตายเงียบเพราะเทสไม่ได้เปิด errexit)
scenario under-errexit
a=$(line_of production_plan_tracker.html 'function fmt')
{ printf '"use strict";\n\n'; cut_lines production_plan_tracker.html "$a" $((a + 2)); } > core/fmt.js
seal move
got=$(bash -c "set -euo pipefail; source '$ROOT/.github/scripts/app-files.sh'
  if node '$PROOF' main \"\${VERSIONED_PATHSPEC[@]}\" >/dev/null; then echo yes; else echo no; fi" 2>&1)
if [ "$got" = yes ]; then pass=$((pass + 1)); echo '  ok   ใต้ set -euo pipefail · ย้ายถูก → yes'; else fail=$((fail + 1)); echo "  FAIL ใต้ set -euo pipefail ควรได้ yes แต่ได้ $got"; fi

got=$(bash -c "set -euo pipefail; if node '$PROOF' no-such-ref production_plan_tracker.html >/dev/null; then echo yes; else echo no; fi" 2>&1)
if [ "$got" = no ]; then pass=$((pass + 1)); echo '  ok   base ที่ไม่มีอยู่จริง → ถือว่าตก ไม่ใช่ผ่าน'; else fail=$((fail + 1)); echo "  FAIL base ที่ไม่มีอยู่จริง ควรได้ no แต่ได้ $got"; fi

echo
if [ "$fail" -gt 0 ]; then
  echo "ตก $fail จาก $((pass + fail)) กรณี"
  exit 1
fi
echo "ผ่านครบ $pass กรณี"
