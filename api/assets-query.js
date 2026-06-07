/**
 * NEXUS Cross-API — Asset 검색 endpoint (read-only, v2)
 *
 * [Phase 13] 카테고리 단어 → 자산 prefix 매핑 + 더 친절한 에러 메시지.
 *
 * 예시 매핑:
 *   "실험기기" → CEQ-, EXP-, RES-, LAB-
 *   "PC" / "데스크탑" → DESKTOP-, PC-
 *   "노트북" → LAPTOP-, NB-, NOTE-
 *   "서버" → SRV-, SVR-, SERVER-
 *   "방화벽" → FW-, FIREWALL-
 *   "스위치" → SW-, SWITCH-
 *   "UPS" → UPS-
 *   "CCTV" → CCTV-, CAM-
 *   "NAS" → NAS-
 *
 * 요청 (POST):
 *   {
 *     "filter": "관제실 PC" | "방화벽" | "실험기기" | null,
 *     "site": "용인" | null,
 *     "limit": 50,
 *     "category": "실험기기" (옵션, 카테고리 단어 명시)
 *   }
 *
 * 응답:
 *   {
 *     "ok": true,
 *     "count": 12,
 *     "assets": [...],
 *     "totalScanned": 234,
 *     "inferredCategory": "실험기기" (있을 때만 — 추론된 카테고리),
 *     "matchedPrefixes": ["CEQ-", "EXP-"] (실제 매칭한 prefix 들)
 *   }
 */
const CATEGORY_PREFIXES = {
  '실험기기': ['CEQ-', 'EXP-', 'RES-', 'LAB-', 'EQ-', 'DEQ-', 'AEQ-', 'BEQ-'],
  '실험장비': ['CEQ-', 'EXP-', 'RES-', 'LAB-', 'EQ-', 'DEQ-', 'AEQ-', 'BEQ-'],
  'PC':       ['DESKTOP-', 'PC-', 'WS-'],
  '데스크탑':  ['DESKTOP-', 'PC-', 'WS-'],
  '노트북':    ['LAPTOP-', 'NB-', 'NOTE-', 'NT-'],
  '서버':      ['SRV-', 'SVR-', 'SERVER-', 'SV-'],
  '방화벽':    ['FW-', 'FIREWALL-'],
  '스위치':    ['SW-', 'SWITCH-'],
  'UPS':      ['UPS-'],
  'CCTV':     ['CCTV-', 'CAM-'],
  'NAS':      ['NAS-', 'SYNOLOGY-'],
  '네트워크':  ['NW-', 'NET-', 'SW-', 'FW-', 'RT-'],
  '라우터':    ['RT-', 'ROUTER-'],
  '백업':      ['BAK-', 'BACKUP-', 'NAS-'],
  '실험':      ['CEQ-', 'EXP-', 'RES-', 'LAB-'],
};

const KOREAN_CATEGORY_KEYS = Object.keys(CATEGORY_PREFIXES);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cross-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const expected = process.env.CROSS_API_TOKEN;
  const got = req.headers['x-cross-token'] || req.headers['X-Cross-Token'];
  if (expected && got !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'invalid token',
      hint: 'ATLAS 의 VITE_CROSS_API_TOKEN 과 NEXUS 의 CROSS_API_TOKEN 이 같은지 확인'
    });
  }

  const apiKey = process.env.VITE_NOTION_KEY || process.env.NOTION_API_KEY;
  // [Phase 15] env 잘못된 값일 경우 fallback — NEXUS 가 실제 사용 중인 dbId
  const REAL_DB_ID_FALLBACK = '2df17e12-9ccc-806b-8345-d3d840db15ca';
  const envDbId = process.env.VITE_NOTION_DATABASE_ID || process.env.NOTION_DATABASE_ID;
  // env 가 잘못된 (404 발생한) 값이면 fallback 사용
  const WRONG_DB_ID = '2df17e12-9ccc-80b1-a34c-000b81da4a69';
  const databaseId = (envDbId && envDbId !== WRONG_DB_ID) ? envDbId : REAL_DB_ID_FALLBACK;
  if (!apiKey || !databaseId) {
    return res.status(500).json({
      ok: false,
      error: 'NEXUS Notion 설정 누락',
      hint: 'VITE_NOTION_KEY + VITE_NOTION_DATABASE_ID 양쪽 모두 Vercel 환경변수 필요'
    });
  }

  const body = req.body || {};
  const rawFilter = String(body.filter || '').trim();
  const filterLower = rawFilter.toLowerCase();
  const site = String(body.site || '').trim();
  const limit = Math.min(Math.max(parseInt(body.limit) || 100, 1), 200);
  const explicitCategory = String(body.category || '').trim();

  // [Phase 13] 카테고리 추론 — filter 안에 카테고리 단어 포함 여부
  let inferredCategory = explicitCategory;
  let matchedPrefixes = [];
  if (!inferredCategory) {
    for (const key of KOREAN_CATEGORY_KEYS) {
      if (rawFilter.includes(key)) {
        inferredCategory = key;
        break;
      }
    }
  }
  if (inferredCategory && CATEGORY_PREFIXES[inferredCategory]) {
    matchedPrefixes = CATEGORY_PREFIXES[inferredCategory];
  }

  // Notion DB 전체 조회 (필터는 클라이언트 측)
  try {
    const allResults = [];
    let cursor = undefined;
    let totalScanned = 0;
    for (let i = 0; i < 5; i++) {
      const queryBody = {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      };
      const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(queryBody),
      });
      const data = await r.json();
      if (!r.ok) {
        // [Phase 13] Notion API 에러 — 어떤 종류인지 분석해서 친절히 안내
        const msg = data.message || 'Notion query failed';
        let hint = '';
        if (/Could not find database/i.test(msg)) {
          hint = `NEXUS 의 Notion integration ("ITAM DB") 가 자산 데이터베이스 (${databaseId}) 에 접근 권한이 없어요. ` +
                 `Notion 에서 해당 DB 페이지 → ⋯ 메뉴 → 연결 → "ITAM DB" 추가 필요.`;
        } else if (/unauthorized|invalid api key|invalid_token/i.test(msg)) {
          hint = `NEXUS 의 VITE_NOTION_KEY 가 유효하지 않아요. Notion → My integrations → 새 secret 발급 후 Vercel 환경변수 업데이트.`;
        }
        return res.status(r.status).json({
          ok: false,
          error: msg,
          hint,
          notionError: data,
          databaseId: databaseId.slice(0, 8) + '…',
        });
      }
      const rows = Array.isArray(data.results) ? data.results : [];
      totalScanned += rows.length;
      for (const row of rows) {
        allResults.push(row);
      }
      if (!data.has_more) break;
      cursor = data.next_cursor;
    }

    // 자산 정규화
    const normalized = allResults.map(page => {
      const values = {};
      let title = '';
      for (const [k, v] of Object.entries(page.properties || {})) {
        const s = extractStringValue(v);
        values[k] = s;
        if (v.type === 'title' && s) title = s;
      }
      return {
        id: page.id,
        title,
        url: page.url,
        values,
      };
    });

    // [Phase 16] 검색 — 단어 분리 + 카테고리 prefix + AND/OR fallback
    const STOPWORDS = new Set(['장비','장비들','자산','자산들','의','에','에서','를','을','들','다','좀','보여','보여줘','뭐','있어','있는','하기','하나','말이야','말','말야']);
    const meaningfulWords = rawFilter
      .toLowerCase()
      .split(/[\s,]+/)
      .map(w => w.trim())
      .filter(w => w.length >= 2 && !STOPWORDS.has(w));

    let filtered = normalized;

    // 카테고리 prefix 매칭
    if (matchedPrefixes.length > 0) {
      filtered = filtered.filter(a => {
        const upperTitle = (a.title || '').toUpperCase();
        return matchedPrefixes.some(p => upperTitle.startsWith(p.toUpperCase()));
      });
    }
    // 의미 있는 단어 매칭 (prefix 적용 후 또는 prefix 없을 때)
    if (meaningfulWords.length > 0) {
      const matchWords = (arr, mode) => arr.filter(a => {
        const haystack = ((a.title || '') + ' ' + Object.values(a.values || {}).join(' ')).toLowerCase();
        if (mode === 'and') return meaningfulWords.every(w => haystack.includes(w));
        return meaningfulWords.some(w => haystack.includes(w));
      });

      if (matchedPrefixes.length > 0) {
        // prefix + 단어 OR (조건 완화)
        const narrowed = matchWords(filtered, 'or');
        if (narrowed.length > 0) filtered = narrowed;
      } else if (meaningfulWords.length === 1) {
        filtered = matchWords(filtered, 'or');
      } else {
        // 2개 이상 단어 — 우선 AND, 0건이면 OR fallback
        const andResult = matchWords(filtered, 'and');
        filtered = andResult.length > 0 ? andResult : matchWords(filtered, 'or');
      }
    }

    // [Phase 16] site 필터 — 컬럼명 후보 대폭 확장 + title/전체값 fallback
    if (site) {
      const SITE_KEY_RE = /(site|사이트|장소|위치|지역|건물|사옥|캠퍼스|지점|location|건물명)/i;
      const siteLower = site.toLowerCase();
      filtered = filtered.filter(a => {
        const siteEntries = Object.entries(a.values || {}).filter(([k]) => SITE_KEY_RE.test(k));
        for (const [, v] of siteEntries) {
          if (String(v).toLowerCase().includes(siteLower)) return true;
        }
        // Fallback — 어디든 site 단어 포함
        const haystack = ((a.title || '') + ' ' + Object.values(a.values || {}).join(' ')).toLowerCase();
        return haystack.includes(siteLower);
      });
    }

    const result = filtered.slice(0, limit);

    return res.status(200).json({
      ok: true,
      count: result.length,
      assets: result,
      totalScanned,
      truncated: filtered.length > limit,
      inferredCategory: inferredCategory || undefined,
      matchedPrefixes: matchedPrefixes.length > 0 ? matchedPrefixes : undefined,
    });
  } catch (err) {
    console.error('[assets-query] error:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      hint: 'NEXUS 서버 내부 오류 — Vercel 로그 확인'
    });
  }
}

function extractStringValue(prop) {
  if (!prop) return '';
  try {
    switch (prop.type) {
      case 'title':       return prop.title?.map(t => t.plain_text).join('') || '';
      case 'rich_text':   return prop.rich_text?.map(t => t.plain_text).join('') || '';
      case 'select':      return prop.select?.name || '';
      case 'multi_select':return prop.multi_select?.map(s => s.name).join(', ') || '';
      case 'status':      return prop.status?.name || '';
      case 'number':      return prop.number?.toString() || '';
      case 'date':        return prop.date?.start || '';
      case 'checkbox':    return prop.checkbox ? 'Yes' : 'No';
      case 'url':         return prop.url || '';
      case 'email':       return prop.email || '';
      case 'phone_number':return prop.phone_number || '';
      case 'people':      return prop.people?.map(p => p.name).join(', ') || '';
      case 'created_time':return prop.created_time || '';
      case 'last_edited_time': return prop.last_edited_time || '';
      default:            return '';
    }
  } catch { return ''; }
}
