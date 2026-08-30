#!/usr/bin/env bash
# เทสตรรกะของด่าน "ห้ามแตะบรรทัด vendor" — เรียกสคริปต์ตัวจริงที่ workflow ใช้
#
# ตรรกะนี้ถูกแก้สี่รอบใน 30 ส.ค. 2026 และทุกรอบเกิดรูใหม่ที่ผู้ตรวจจับได้
# แต่ละกรณีข้างล่างที่เขียนว่า "รูรอบที่ N" คือรูจริงที่เคยหลุดมาแล้ว ไม่ใช่กรณีสมมติ
#
# รันเอง:  bash tests/guard-rules.test.sh

set -uo pipefail
cd "$(dirname "$0")/.."
source .github/scripts/vendor-gate.sh

pass=0; fail=0

# want: pass|fail
check() {
  local want=$1 desc=$2
  local got
  if ( vendor_gate ) >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass+1)); printf '  ok   %s\n' "$desc"
  else
    fail=$((fail+1)); printf '  FAIL %s  (ควรได้ %s แต่ได้ %s)\n' "$desc" "$want" "$got"
  fi
}

run() {  # run <vendorhit> <is_agent> <event> <label> <want> <desc>
  VENDORHIT=$1 IS_AGENT=$2 PR_EVENT=$3 PR_LABEL_NAME=$4 PR_AUTHOR=someone HEAD_REF=some/branch \
    check "$5" "$6"
}

echo "ด่านห้ามแตะบรรทัด vendor"

# ไม่ได้แตะเลย — ด่านนี้ต้องไม่ยุ่งกับใคร
run 0 no  synchronize ''              pass 'ไม่แตะ vendor · push ปกติ'
run 0 yes synchronize ''              pass 'ไม่แตะ vendor · เป็น agent ก็ไม่เกี่ยว'
run 0 no  labeled     vendor-change   pass 'ไม่แตะ vendor · ติด label ก็ไม่เกี่ยว'

# agent ห้ามเด็ดขาด ไม่ว่าจะทำท่าไหน
run 1 yes labeled     vendor-change   fail 'agent แตะ vendor แล้วติด label เอง'
run 1 yes synchronize ''              fail 'agent แตะ vendor'

# ทางผ่านทางเดียว
run 1 no  labeled     vendor-change   pass 'เจ้าของเพิ่งติด label vendor-change'

# ── รูที่เคยหลุดมาแล้วจริง ต้องตกทุกข้อ ──
run 1 no  synchronize ''              fail 'รูรอบที่ 3 · ติด label ไว้แล้ว push โค้ดตามมา'
run 1 no  labeled     ready-to-fix    fail 'รูรอบที่ 4 · ไปติด label ตัวอื่นเพื่อให้ด่านรันซ้ำ'
run 1 no  unlabeled   vendor-change   fail 'รูรอบที่ 4 · ถอด label แล้วด่านรันซ้ำบน commit เดิม'
run 1 no  reopened    ''              fail 'รูรอบที่ 4 · ปิดแล้วเปิด PR ใหม่'
run 1 no  opened      ''              fail 'เปิด PR มาพร้อม label ตั้งแต่แรก ยังต้องติดใหม่ให้เห็นการตัดสินใจ'

# ไม่มี label เลย
run 1 no  labeled     ''              fail 'ติด label แต่ไม่มีชื่อ'
run 1 no  synchronize ''              fail 'ไม่มี label เลย'

echo
if [ "$fail" -gt 0 ]; then
  echo "ตก $fail จาก $((pass+fail)) กรณี"
  exit 1
fi
echo "ผ่านครบ $pass กรณี"
