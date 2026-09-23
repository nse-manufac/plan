#!/usr/bin/env bash
# เทสตรรกะของด่าน "เพดานขนาด PR จาก agent" — เรียกสคริปต์ตัวจริงที่ workflow ใช้
#
# ข้อยกเว้น "ย้ายอย่างเดียว" ยืมกติกากันของค้างมาจากด่าน vendor ทั้งดุ้น
# กรณีที่เขียนว่า "รูรอบที่ N" คือรูที่เคยหลุดจริงในด่าน vendor เมื่อ 30 ส.ค. 2026
# ห้ามให้ด่านนี้เปิดรูเดียวกันซ้ำ
#
# รันเอง:  bash tests/guard-size.test.sh

set -uo pipefail
cd "$(dirname "$0")/.."
source .github/scripts/size-gate.sh

pass=0; fail=0

check() {  # check <pass|fail> <คำอธิบาย>
  local got
  if ( size_gate ) >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$1" ]; then
    pass=$((pass+1)); printf '  ok   %s\n' "$2"
  else
    fail=$((fail+1)); printf '  FAIL %s  (ควรได้ %s แต่ได้ %s)\n' "$2" "$1" "$got"
  fi
}

run() {  # run <applines> <is_agent> <proven> <event> <label> <want> <desc>
  APPLINES=$1 IS_AGENT=$2 MOVE_PROVEN=$3 PR_EVENT=$4 PR_LABEL_NAME=$5 check "$6" "$7"
}

echo "ด่านเพดานขนาด PR จาก agent"

# ── พฤติกรรมเดิมต้องไม่เปลี่ยน ──
run 150  yes skip synchronize ''        pass 'agent แก้ 150 บรรทัดพอดี — ยังไม่เกิน'
run 151  yes skip synchronize ''        fail 'agent แก้ 151 บรรทัด — เกิน'
run 4000 no  skip synchronize ''        pass 'ไม่ใช่ PR ของ agent — ด่านนี้ไม่ยุ่ง'
run 10   yes no   synchronize ''        pass 'PR เล็ก — ไม่ต้องพิสูจน์อะไร'

# ── ทางผ่านทางเดียวของ PR ใหญ่ ──
run 4500 yes yes  labeled     move-only pass 'ย้ายอย่างเดียว พิสูจน์ผ่าน และเจ้าของเพิ่งติด label'

# ── label อย่างเดียวไม่พอ ต้องพิสูจน์ผ่านด้วย ──
run 4500 yes no   labeled     move-only fail 'ติด label แต่พิสูจน์ไม่ผ่าน (มีโค้ดใหม่ปน)'
run 4500 yes skip labeled     move-only fail 'ติด label แต่ไม่ได้รันตัวพิสูจน์'

# ── พิสูจน์อย่างเดียวไม่พอ ต้องมีคนตัดสินใจกับ commit ชุดนี้ ──
run 4500 yes yes  synchronize ''        fail 'พิสูจน์ผ่าน แต่ยังไม่มีใครติด label'
run 4500 yes yes  opened      ''        fail 'เปิด PR มาพร้อม label ตั้งแต่แรก ยังต้องติดใหม่ให้เห็นการตัดสินใจ'

# ── รูที่เคยหลุดในด่าน vendor ต้องตกทุกข้อ ──
run 4500 yes yes  synchronize ''        fail 'รูรอบที่ 3 · ติด label ไว้แล้ว push โค้ดตามมา'
run 4500 yes yes  labeled     ready-to-fix fail 'รูรอบที่ 4 · ไปติด label ตัวอื่นเพื่อให้ด่านรันซ้ำ'
run 4500 yes yes  unlabeled   move-only fail 'รูรอบที่ 4 · ถอด label แล้วด่านรันซ้ำบน commit เดิม'
run 4500 yes yes  reopened    ''        fail 'รูรอบที่ 4 · ปิดแล้วเปิด PR ใหม่'

# ── label ของอีกด่านใช้แทนกันไม่ได้ ──
run 4500 yes yes  labeled     vendor-change fail 'ติด label vendor-change แทน move-only'

echo
if [ "$fail" -gt 0 ]; then
  echo "ตก $fail จาก $((pass+fail)) กรณี"
  exit 1
fi
echo "ผ่านครบ $pass กรณี"
