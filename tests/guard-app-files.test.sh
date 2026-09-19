#!/usr/bin/env bash
# เทสของด่านที่ตัดสินจาก "ไฟล์ไหนคือไฟล์แอป" — เรียกสคริปต์ตัวจริงที่ workflow ใช้
#
# สร้าง repo จำลองในโฟลเดอร์ชั่วคราว แล้วทำ PR สมมติหลายแบบ
# เทสนี้เกิดขึ้นเพราะตอนแก้ด่านให้มองเห็นไฟล์ .js (19 ก.ย. 2026) การยืนยันรอบแรก
# ทำด้วยการสร้าง repo จำลองด้วยมือแล้วลบทิ้ง ซึ่งพิสูจน์อะไรให้รอบถัดไปไม่ได้เลย
#
# รันเอง:  bash tests/guard-app-files.test.sh

set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
source "$ROOT/.github/scripts/app-files.sh"

pass=0
fail=0

eq() {  # eq <ที่ควรได้> <ที่ได้จริง> <คำอธิบาย>
  if [ "$1" = "$2" ]; then
    pass=$((pass + 1)); printf '  ok   %s\n' "$3"
  else
    fail=$((fail + 1)); printf '  FAIL %s  (ควรได้ "%s" แต่ได้ "%s")\n' "$3" "$1" "$2"
  fi
}

net_says() {  # net_says <base> → yes/no
  if net_load_added "$1"; then echo yes; else echo no; fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK" || exit 1

git init -q .
git config user.email tester@example.com
git config user.name tester
git config core.autocrlf false
git config commit.gpgsign false

mkdir -p lib core tests
printf '<meta name="app-version" content="2026-01-01.1">\n<p>แอป</p>\n' > production_plan_tracker.html
printf 'export const a = 1;\n' > core/a.js
printf 'window.LIB = 1;\n' > lib/exceljs.min.js
printf 'test("x", () => {});\n' > tests/smoke.spec.js
printf 'export default {};\n' > playwright.config.js
printf '# เอกสาร\n' > CLAUDE.md
git add -A && git commit -qm base
git branch -M main

scenario() {  # scenario <ชื่อ branch ชั่วคราว>
  git checkout -q main
  git branch -qD "$1" 2>/dev/null
  git checkout -qb "$1"
}

seal() { git add -A && git commit -qm "$1"; }

echo "ด่านที่ตัดสินจากไฟล์แอป"

# ── 1. PR ที่ไม่ได้แตะแอปเลย ต้องไม่ถูกนับว่าแตะ ──
scenario docs-only
printf '# เอกสารที่แก้แล้ว\n' > CLAUDE.md
printf 'test("y", () => {});\n' >> tests/smoke.spec.js
printf 'export default { timeout: 1 };\n' > playwright.config.js
seal docs
eq ""  "$(app_changed_files main)"  'แก้แค่เอกสาร เทส และไฟล์ตั้งค่า → ไม่นับว่าแตะแอป'
eq "0" "$(app_changed_lines main)"  'แก้แค่เอกสาร เทส และไฟล์ตั้งค่า → นับได้ 0 บรรทัด'
eq "0" "$(vendor_hits main)"        'แก้แค่เอกสาร เทส และไฟล์ตั้งค่า → ไม่แตะ vendor'

# ── 2. แก้ .js ของแอป ต้องถูกนับ (นี่คือข้อที่ด่านเดิมมองไม่เห็น) ──
scenario app-js
printf 'export const a = 2;\nexport const b = 3;\n' > core/a.js
seal js
eq "core/a.js" "$(app_changed_files main)" 'แก้ core/*.js → นับเป็นไฟล์แอป'
eq "3"         "$(app_changed_lines main)" 'แก้ core/*.js → นับบรรทัดถูกต้อง (เพิ่ม 2 ลบ 1)'

# ── 3. ไฟล์ใน lib/ นับเป็นการแตะ vendor แม้จะสั้นนิดเดียว ──
scenario lib-touch
printf 'window.LIB = 2;\n' > lib/exceljs.min.js
seal lib
eq "1"  "$(vendor_hits main)"       'แก้ไฟล์ใน lib/ → นับเป็นแตะ vendor'
eq ""   "$(app_changed_files main)" 'ไฟล์ใน lib/ ไม่ถูกนับเป็นไฟล์แอป (มีด่านของตัวเอง)'

# ── 4. บรรทัดยาวผิดปกติในไฟล์แอป ยังนับเป็น vendor เหมือนเดิม ──
scenario long-line
{ printf '<script>var V="'; head -c 25000 < /dev/zero | tr '\0' 'x'; printf '";</script>\n'; } >> production_plan_tracker.html
seal long
eq "1" "$(vendor_hits main)" 'บรรทัดยาวเกิน 20,000 ตัวอักษร → นับเป็นแตะ vendor'

# ── 5. แตะทั้งสองแบบพร้อมกัน ต้องรวมกัน ──
scenario both-vendor
printf 'window.LIB = 3;\n' > lib/exceljs.min.js
{ printf '<script>var W="'; head -c 25000 < /dev/zero | tr '\0' 'y'; printf '";</script>\n'; } >> production_plan_tracker.html
seal both
eq "1" "$(vendor_long main)" 'แตะทั้งสองแบบ → นับบรรทัดยาวได้ 1'
eq "1" "$(vendor_lib main)"  'แตะทั้งสองแบบ → นับไฟล์ใน lib/ ได้ 1'
eq "2" "$(vendor_hits main)" 'แตะทั้ง lib/ และบรรทัดยาว → รวมเป็น 2 จุด'

# ── 6. การโหลดของจากเน็ต — ต้องจับได้ทุกรูปแบบ ──
scenario net-import-single
printf "import x from 'https://cdn.example.com/x.js';\n" >> core/a.js
seal net1
eq "yes" "$(net_says main)" 'import จาก URL ด้วยอัญประกาศเดี่ยว'

scenario net-import-double
printf 'import y from "https://cdn.example.com/y.js";\n' >> core/a.js
seal net2
eq "yes" "$(net_says main)" 'import จาก URL ด้วยอัญประกาศคู่'

scenario net-script-quoted
printf '<script src="https://cdn.example.com/z.js"></script>\n' >> production_plan_tracker.html
seal net3
eq "yes" "$(net_says main)" 'script src แบบใส่อัญประกาศ'

scenario net-script-bare
printf '<script src=https://cdn.example.com/z.js></script>\n' >> production_plan_tracker.html
seal net4
eq "yes" "$(net_says main)" 'script src แบบไม่ใส่อัญประกาศ'

scenario net-link
printf '<link rel="stylesheet" href="https://cdn.example.com/a.css">\n' >> production_plan_tracker.html
seal net5
eq "yes" "$(net_says main)" 'link href จากเน็ต'

scenario net-dynamic-import
printf 'const m = await import("https://cdn.example.com/m.js");\n' >> core/a.js
seal net6
eq "yes" "$(net_says main)" 'import() แบบไดนามิก'

scenario net-importscripts
printf 'importScripts("https://cdn.example.com/w.js");\n' >> core/a.js
seal net7
eq "yes" "$(net_says main)" 'importScripts ของ worker'

# ── 7. ฟังก์ชันต้องรอดใต้ `set -e` ที่ workflow ใช้จริง ──
# ตอนเขียนรอบแรกไม่มี `|| true` ท้ายไปป์ไลน์ของ vendor_hits · เทสชุดนี้เขียวหมด
# เพราะตัวเทสไม่ได้เปิด errexit แต่ใน CI ซึ่งรันด้วย `set -euo pipefail`
# grep ที่ไม่เจออะไร (กรณีปกติที่สุด) จะทำให้ step ตายเงียบโดยไม่มีข้อความบอกสาเหตุ
#
# ⚠️ สองอย่างที่ฉากนี้ต้องทำให้ถูก ไม่งั้นเทสเขียวทั้งที่ของจริงพัง (เกิดมาแล้วทั้งคู่)
#
#   1. ต้อง **ไม่แก้ไฟล์ .html/.js เลย** — ถ้ามีไฟล์ .js เปลี่ยนด้วย grep จะเจอบรรทัด
#      แล้วคืน 0 ไปป์ไลน์ผ่าน บั๊ก errexit หลุด (รอบแรกเขียนฉากผิดแบบนี้)
#   2. ต้องเรียก **แบบเดียวกับที่ workflow เรียกเป๊ะ ๆ** คือรับค่าผ่าน $( ) แล้วอ้างตัวแปร
#      ต่อในบรรทัดถัดไป — รอบแรกเรียกฟังก์ชันเฉย ๆ เทสจึงเขียว แต่ของจริงตายด้วย
#      "VENDOR_LONG: unbound variable" เพราะ $( ) รันในซับเชลล์ (run 35426934295)
scenario errexit
printf '# เอกสารที่แก้แล้วอีกครั้ง\n' > CLAUDE.md
seal errexit

# ชุดคำสั่งข้างล่างนี้ต้องเหมือนกับใน .github/workflows/agent-guard.yml ทุกบรรทัด
(
  set -euo pipefail
  source "$ROOT/.github/scripts/app-files.sh"
  APPLINES=$(app_changed_lines main)
  VENDOR_LONG=$(vendor_long main)
  VENDOR_LIB=$(vendor_lib main)
  VENDORHIT=$((VENDOR_LONG + VENDOR_LIB))
  echo "$APPLINES $VENDOR_LONG $VENDOR_LIB $VENDORHIT" > /dev/null
)
eq "0" "$?" 'เรียกแบบเดียวกับ agent-guard ใต้ set -euo pipefail แล้วไม่ตาย'

(
  set -euo pipefail
  source "$ROOT/.github/scripts/app-files.sh"
  APPCHANGED=$(app_changed_files main)
  [ -z "$APPCHANGED" ] || exit 9
)
eq "0" "$?" 'เรียกแบบเดียวกับ smoke.yml ใต้ set -euo pipefail แล้วไม่ตาย'

# ── 8. ของที่ต้องไม่ถูกจับผิด ──
scenario net-clean
printf '// อ้างอิง https://example.com/doc — เป็นแค่คอมเมนต์\n' >> core/a.js
printf 'const r = await fetch(syncCfg.url, { method: "POST" });\n' >> core/a.js
printf '<script src="app.js"></script>\n' >> production_plan_tracker.html
printf '<script type="module" src="./core/a.js"></script>\n' >> production_plan_tracker.html
seal clean
eq "no" "$(net_says main)" 'คอมเมนต์ที่มี URL · fetch ไป URL ที่ผู้ใช้กรอก · script src แบบ relative'

echo
if [ "$fail" -gt 0 ]; then
  echo "ตก $fail จาก $((pass + fail)) กรณี"
  exit 1
fi
echo "ผ่านครบ $pass กรณี"
