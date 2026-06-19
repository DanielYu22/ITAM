#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
#  scan_nas_manifest_mac.sh — macOS용 NAS manifest 스캔
#
#  smb://nas1.daewoong.co.kr/<기기명>/ 폴더들을 순회하며 각 기기에
#  'Manifest_SynologyDriveRoot.txt' 가 있는지 + 최종 생성일(mtime)을 조사해
#  NEXUS 'nas-manifest-scan' 임포터가 먹는 CSV 로 떨군다.
#
#  최근 30일 내 manifest = 07시 작업스케줄러 가동(= SynologyClient 설치 + 온라인 + NAS백업).
#  폴더만 있고 manifest 없음 = 수동폴더 가능성(설치 신호 아님) → FolderOnly=Y.
#
#  출력 CSV 헤더:  DeviceName,ManifestExists,ManifestDate,FolderOnly
#  → NEXUS 홈 '가져오기'에 이 CSV 던지면 B)NAS가동 자동 갱신 → 스케줄러 설치/확인 알람.
#
#  사용법:
#    1) 공유(share) 자동 열거 모드(기본):
#         NAS_USER=내계정 ./scan_nas_manifest_mac.sh
#       (비밀번호는 Finder로 한 번 접속해 Keychain에 저장돼 있으면 안 물음)
#
#    2) 이미 마운트해둔 부모 경로 모드(기기 폴더가 한 공유 아래 있을 때):
#         ./scan_nas_manifest_mac.sh /Volumes/대웅NAS루트
#
#  주의: 공유 자동열거 모드는 기기 공유를 하나씩 마운트/언마운트하므로 다소 느림.
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

NAS_HOST="${NAS_HOST:-nas1.daewoong.co.kr}"
NAS_USER="${NAS_USER:-}"
MANIFEST="Manifest_SynologyDriveRoot.txt"
# 기기 공유 패턴(시스템 공유 home/web/photo 등 제외). 필요시 수정.
DEVICE_RE="${DEVICE_RE:-^[A-Z]{2,4}-?[0-9]+$|^[A-Z]+[0-9]+-[0-9]+$}"
OUT="${OUT:-$HOME/Desktop/NasManifestScan_$(date +%Y%m%d_%H%M).csv}"

emit_header() { echo "DeviceName,ManifestExists,ManifestDate,FolderOnly" > "$OUT"; }

# 폴더 하나 검사 → CSV 한 줄
check_dir() {
  local dev="$1" dir="$2"
  local f="$dir/$MANIFEST"
  if [ -f "$f" ]; then
    local d; d="$(stat -f "%Sm" -t "%Y-%m-%d" "$f" 2>/dev/null)"
    echo "${dev},Y,${d},N" >> "$OUT"
    echo "  [OK ] $dev — manifest $d"
  else
    # 폴더는 있는데 manifest 없음 → 수동폴더 가능성(설치 신호 아님)
    echo "${dev},N,,Y" >> "$OUT"
    echo "  [-- ] $dev — manifest 없음(폴더만)"
  fi
}

emit_header

# ── 모드 2: 마운트된 부모 경로 ────────────────────────────────────────────
if [ "${1:-}" != "" ] && [ -d "${1:-}" ]; then
  ROOT="$1"
  echo "[모드2] 부모 경로 스캔: $ROOT"
  for d in "$ROOT"/*/; do
    [ -d "$d" ] || continue
    dev="$(basename "$d")"
    case "$dev" in .*|\#*|@*) continue;; esac
    check_dir "$dev" "${d%/}"
  done
  echo ""; echo "완료 → $OUT"; exit 0
fi

# ── 모드 1: 공유(share) 자동 열거 ─────────────────────────────────────────
[ -z "$NAS_USER" ] && { echo "NAS_USER 환경변수가 필요합니다. 예: NAS_USER=hong ./scan_nas_manifest_mac.sh"; exit 1; }
echo "[모드1] //$NAS_USER@$NAS_HOST 공유 열거..."
SHARES="$(smbutil view "//${NAS_USER}@${NAS_HOST}" 2>/dev/null | awk 'NR>3 && $1!="" && $1!~"^-" {print $1}')"
[ -z "$SHARES" ] && { echo "공유 목록을 못 가져왔습니다. Finder로 한 번 접속(Keychain 저장) 후 재시도하거나, 모드2(마운트 경로)를 쓰세요."; exit 1; }

TMPMNT="$(mktemp -d /tmp/nasman.XXXXXX)"
cleanup() { umount "$TMPMNT" 2>/dev/null; diskutil unmount force "$TMPMNT" 2>/dev/null; rmdir "$TMPMNT" 2>/dev/null; }
trap cleanup EXIT

while IFS= read -r share; do
  [ -z "$share" ] && continue
  # 시스템/관리 공유 제외
  case "$share" in homes|home|web|photo|music|video|NetBackup|usbshare*|*\$) continue;; esac
  # 기기 공유 패턴만(원하면 DEVICE_RE 비워서 전부 스캔)
  if [ -n "$DEVICE_RE" ] && ! echo "$share" | grep -Eq "$DEVICE_RE"; then continue; fi
  umount "$TMPMNT" 2>/dev/null
  if mount_smbfs -N "//${NAS_USER}@${NAS_HOST}/${share}" "$TMPMNT" 2>/dev/null; then
    check_dir "$share" "$TMPMNT"
    umount "$TMPMNT" 2>/dev/null
  else
    echo "  [SKIP] $share — 마운트 실패"
  fi
done <<< "$SHARES"

echo ""; echo "완료 → $OUT"
echo "이 CSV를 NEXUS 홈 '가져오기'에 넣으면 B)NAS가동이 갱신되고 스케줄러 설치/확인 대상이 홈에 뜹니다."
