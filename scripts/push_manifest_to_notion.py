#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════════════
#  push_manifest_to_notion.py — NAS manifest 스캔 CSV → Notion 자산 DB 직접 반영
#
#  scan_nas_manifest_mac.sh 가 만든 CSV(DeviceName,ManifestExists,ManifestDate,FolderOnly)를
#  읽어, 자산 DB 각 기기 페이지의 'B)NAS가동' 컬럼을 갱신한다(기기명=title 매칭).
#    · ManifestDate 있음 → 그 날짜(예 2026-06-19)
#    · 폴더만(FolderOnly=Y) → '폴더만(수동가능성)'
#  → NEXUS 가 Notion 을 읽으므로 가져오기(import) 없이 자동 반영. manifestFresh()가 30일 판정.
#
#  필요: 자산 DB가 공유된 Notion 인테그레이션 토큰.
#    export NOTION_TOKEN="secret_xxx"      # 자산 DB를 이 인테그레이션에 공유해둘 것
#    export NEXUS_DB_ID="380ee0d6-d000-81e7-9fad-ca0b2fa95dda"   # (기본값 내장)
#  사용:  python3 push_manifest_to_notion.py [CSV경로]   # 생략 시 ~/Desktop 최신 NasManifestScan_*.csv
# ════════════════════════════════════════════════════════════════════════════
import os, sys, csv, glob, json, time, urllib.request, urllib.error

TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
DB_ID = os.environ.get("NEXUS_DB_ID", "380ee0d6-d000-81e7-9fad-ca0b2fa95dda").strip()
COL = "B)NAS가동"
API = "https://api.notion.com/v1"
HDRS = {"Authorization": f"Bearer {TOKEN}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}

def die(m): print(f"[중단] {m}", file=sys.stderr); sys.exit(1)
if not TOKEN: die("NOTION_TOKEN 환경변수가 필요합니다(자산 DB 공유된 인테그레이션 토큰).")

def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, headers=HDRS, method=method)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limit
                time.sleep(float(e.headers.get("Retry-After", "1"))); continue
            die(f"{method} {path} → HTTP {e.code}: {e.read().decode()[:200]}")
        except urllib.error.URLError as e:
            die(f"네트워크 오류: {e}")
    die("재시도 초과(429)")

def find_csv():
    if len(sys.argv) > 1: return sys.argv[1]
    cands = sorted(glob.glob(os.path.expanduser("~/Desktop/NasManifestScan_*.csv")), reverse=True)
    return cands[0] if cands else die("CSV 경로를 못 찾음. 인자로 지정하세요.")

# 1) 자산 DB 전체 페이지 → {기기명: page_id} 맵 (title 프로퍼티 자동 감지)
def load_name_map():
    name2id, title_prop, cursor = {}, None, None
    while True:
        body = {"page_size": 100}
        if cursor: body["start_cursor"] = cursor
        res = api("POST", f"/databases/{DB_ID}/query", body)
        for pg in res.get("results", []):
            props = pg.get("properties", {})
            if title_prop is None:
                for k, v in props.items():
                    if v.get("type") == "title": title_prop = k; break
            if not title_prop: continue
            tarr = props.get(title_prop, {}).get("title", [])
            nm = "".join(t.get("plain_text", "") for t in tarr).strip()
            if nm: name2id[nm] = pg["id"]
        if not res.get("has_more"): break
        cursor = res.get("next_cursor")
    return name2id

def value_for(row):
    d = (row.get("ManifestDate") or row.get("Manifest") or "").strip()
    if d: return d
    fo = (row.get("FolderOnly") or "").strip().lower()
    ex = (row.get("ManifestExists") or "").strip().lower()
    if fo in ("y", "yes", "true", "1", "o") or ex in ("n", "no", "false", "0"): return "폴더만(수동가능성)"
    return ""

def main():
    csv_path = find_csv()
    print(f"CSV: {csv_path}")
    print("자산 DB 페이지 로드 중...")
    name2id = load_name_map()
    print(f"  자산 {len(name2id)}건 로드")
    matched = unmatched = updated = 0
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            dev = (row.get("DeviceName") or "").strip()
            if not dev: continue
            val = value_for(row)
            if dev not in name2id:
                unmatched += 1; print(f"  [미매칭] {dev}"); continue
            matched += 1
            api("PATCH", f"/pages/{name2id[dev]}",
                {"properties": {COL: {"rich_text": [{"text": {"content": val}}] if val else []}}})
            updated += 1
    print(f"\n완료 — 매칭 {matched} / 미매칭 {unmatched} / 갱신 {updated} (컬럼 '{COL}')")
    print("NEXUS 새로고침하면 🗓 스케줄러 설치/확인 알람에 반영됩니다.")

if __name__ == "__main__":
    main()
