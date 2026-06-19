#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
#  sync_nas_to_nexus.sh — NAS manifest 스캔 → Notion 자산 DB 자동 반영(원클릭/스케줄)
#
#  1) scan_nas_manifest_mac.sh 로 smb://nas1 기기 폴더 manifest 스캔 → CSV
#  2) push_manifest_to_notion.py 로 자산 DB 'B)NAS가동' 직접 갱신
#  → NEXUS 가져오기 없이 자동 반영(🗓 스케줄러 설치/확인 알람).
#
#  설정(최초 1회): ~/.atlas/nas_sync.env 에 자격증명 저장 —
#     NAS_USER=daewoongyi
#     NOTION_TOKEN=secret_xxx     # 자산 DB가 공유된 Notion 인테그레이션 토큰
#     # NEXUS_DB_ID=380ee0d6-d000-81e7-9fad-ca0b2fa95dda  # (기본값 내장)
#  수동 실행:  bash sync_nas_to_nexus.sh
#  스케줄:     com.atlas.nasmanifest.plist (launchd) 가 이 스크립트를 주기 실행
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ATLAS_NAS_ENV:-$HOME/.atlas/nas_sync.env}"
LOG="$HOME/.atlas/nas_sync.log"
mkdir -p "$HOME/.atlas"
log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG" >&2; }

[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
[ -z "${NAS_USER:-}" ] && { log "NAS_USER 없음 ($ENV_FILE 설정 필요)"; exit 1; }
[ -z "${NOTION_TOKEN:-}" ] && { log "NOTION_TOKEN 없음 ($ENV_FILE 설정 필요)"; exit 1; }

CSV="$HOME/.atlas/NasManifestScan_$(date +%Y%m%d_%H%M).csv"
log "=== 스캔 시작 ==="
NAS_USER="$NAS_USER" OUT="$CSV" bash "$DIR/scan_nas_manifest_mac.sh" >>"$LOG" 2>&1
rows=$(( $(wc -l < "$CSV" 2>/dev/null || echo 1) - 1 ))
log "스캔 완료: ${rows}건 → $CSV"
[ "$rows" -le 0 ] && { log "스캔 0건 — Notion 반영 생략"; exit 1; }

log "=== Notion 반영 ==="
NOTION_TOKEN="$NOTION_TOKEN" NEXUS_DB_ID="${NEXUS_DB_ID:-}" python3 "$DIR/push_manifest_to_notion.py" "$CSV" >>"$LOG" 2>&1
log "=== 완료 ==="
