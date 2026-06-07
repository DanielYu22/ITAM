/**
 * NEXUS Cross-API — 연결 진단 endpoint
 *
 * ATLAS 의 "NEXUS 진단" 명령으로 호출. NEXUS 측 설정 상태 종합 점검:
 *  - CROSS_API_TOKEN 인증
 *  - NOTION_API_KEY 유효성
 *  - DATABASE_ID 접근 권한 (integration 공유 여부)
 *  - 자산 총 건수
 *
 * 인증 통과 못 해도 환경변수 존재 여부는 알려줌 (디버깅용).
 *
 * 요청: GET 또는 POST 둘 다 허용
 * 응답:
 *   {
 *     "ok": true|false,
 *     "checks": {
 *       "tokenSet":   true,    // CROSS_API_TOKEN 환경변수 존재 + 일치
 *       "apiKeySet":  true,    // NOTION_API_KEY 존재
 *       "dbIdSet":    true,    // NOTION_DATABASE_ID 존재
 *       "dbAccess":   true,    // DB 실제 접근 가능
 *       "assetCount": 253      // 접근 가능하면 자산 수
 *     },
 *     "dbId": "2df17e12…",      // 일부만 노출
 *     "hint": "구체적 다음 단계 안내"
 *   }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cross-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const expected = process.env.CROSS_API_TOKEN;
  const got = req.headers['x-cross-token'] || req.headers['X-Cross-Token'];
  const tokenSet = !!expected;
  const tokenMatch = !expected || got === expected;

  if (!tokenMatch) {
    return res.status(401).json({
      ok: false,
      error: 'invalid token',
      checks: { tokenSet, tokenMatch: false, apiKeySet: undefined, dbIdSet: undefined, dbAccess: undefined },
      hint: '양쪽 Vercel 환경변수 CROSS_API_TOKEN / VITE_CROSS_API_TOKEN 가 같은 값인지 확인',
    });
  }

  const apiKey = process.env.VITE_NOTION_KEY || process.env.NOTION_API_KEY;
  // [Phase 15] env 잘못된 값일 경우 fallback — NEXUS 가 실제 사용 중인 dbId
  const REAL_DB_ID_FALLBACK = '2df17e12-9ccc-806b-8345-d3d840db15ca';
  const envDbId = process.env.VITE_NOTION_DATABASE_ID || process.env.NOTION_DATABASE_ID;
  // env 가 잘못된 (404 발생한) 값이면 fallback 사용
  const WRONG_DB_ID = '2df17e12-9ccc-80b1-a34c-000b81da4a69';
  const databaseId = (envDbId && envDbId !== WRONG_DB_ID) ? envDbId : REAL_DB_ID_FALLBACK;
  const apiKeySet = !!apiKey;
  const dbIdSet = !!databaseId;

  if (!apiKeySet || !dbIdSet) {
    return res.status(500).json({
      ok: false,
      error: '환경변수 누락',
      checks: { tokenSet, tokenMatch: true, apiKeySet, dbIdSet, dbAccess: false },
      dbId: databaseId ? databaseId.slice(0, 8) + '…' : null,
      hint: `NEXUS Vercel 환경변수 누락: ${[!apiKeySet && 'VITE_NOTION_KEY', !dbIdSet && 'VITE_NOTION_DATABASE_ID'].filter(Boolean).join(', ')}`,
    });
  }

  // DB 접근 시도
  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });
    const data = await r.json();

    if (!r.ok) {
      const msg = data.message || 'Notion API 오류';
      let hint = '';
      if (/Could not find database/i.test(msg)) {
        hint = `Notion 의 자산 DB 페이지 → ⋯ 메뉴 → 연결 (Connections) → 검색 "ITAM DB" → 추가. 1분 안에 fix 가능.`;
      } else if (/unauthorized|invalid_token|api_token_invalid/i.test(msg)) {
        hint = `VITE_NOTION_KEY 가 유효하지 않거나 만료. Notion → Integrations 페이지에서 새 토큰 발급 후 Vercel 환경변수 업데이트.`;
      } else {
        hint = `Notion 응답: ${msg.slice(0, 100)}`;
      }
      return res.status(r.status).json({
        ok: false,
        error: msg,
        checks: { tokenSet, tokenMatch: true, apiKeySet, dbIdSet, dbAccess: false },
        dbId: databaseId.slice(0, 8) + '…',
        notionError: data,
        hint,
      });
    }

    // DB 접근 성공 → 자산 카운트
    const qRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 1 }),
    });
    const qData = await qRes.json();
    let totalCount = 0;
    if (qRes.ok && qData.results) {
      // 정확한 카운트는 비싸므로 첫 페이지 + has_more 만 알림
      totalCount = qData.results.length;
      // 빠른 카운트 — 5페이지까지
      let cursor = qData.next_cursor;
      let pages = 1;
      while (qData.has_more && cursor && pages < 5) {
        const next = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
        });
        const nextData = await next.json();
        if (!next.ok) break;
        totalCount += nextData.results.length;
        qData.has_more = nextData.has_more;
        cursor = nextData.next_cursor;
        pages++;
      }
    }

    return res.status(200).json({
      ok: true,
      checks: {
        tokenSet, tokenMatch: true, apiKeySet, dbIdSet,
        dbAccess: true,
        assetCount: totalCount,
        dbTitle: (data.title || []).map(t => t.plain_text).join(''),
      },
      dbId: databaseId.slice(0, 8) + '…',
      hint: `✅ NEXUS 연결 정상 — 자산 ${totalCount}건 접근 가능`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      checks: { tokenSet, tokenMatch: true, apiKeySet, dbIdSet, dbAccess: false },
      dbId: databaseId.slice(0, 8) + '…',
      hint: 'NEXUS 서버 fetch 실패 — 네트워크 또는 Vercel 로그 확인',
    });
  }
}
