/**
 * NEXUS Cross-API — Asset 검색 endpoint (read-only)
 *
 * 사용처: ATLAS 채팅에서 "관제실 PC 들 보여줘" 같은 자연어 명령 → 이 endpoint 호출.
 * NEXUS 의 Notion 자산 DB 를 자기 키로 조회 → 결과 JSON 반환.
 *
 * 보안: CROSS_API_TOKEN env 토큰으로 간단 인증 (외부 무단 호출 차단).
 *
 * 요청 (POST):
 *   {
 *     "filter": "관제실 PC" | "방화벽" | null,    // free text 검색 (모든 컬럼)
 *     "site": "IT쉐어드" | null,                  // 사이트 필터 (선택)
 *     "limit": 50                                  // 결과 수 제한 (기본 100, 최대 200)
 *   }
 *
 * 응답:
 *   {
 *     "ok": true,
 *     "count": 12,
 *     "assets": [
 *       { "id": "...", "title": "PC-001", "values": { "위치": "관제실", ... }, "url": "..." },
 *       ...
 *     ],
 *     "totalScanned": 234
 *   }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cross-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // 토큰 인증
  const expected = process.env.CROSS_API_TOKEN;
  const got = req.headers['x-cross-token'] || req.headers['X-Cross-Token'];
  if (expected && got !== expected) {
    return res.status(401).json({ ok: false, error: 'invalid token' });
  }

  const apiKey = process.env.VITE_NOTION_KEY || process.env.NOTION_API_KEY;
  const databaseId = process.env.VITE_NOTION_DATABASE_ID || process.env.NOTION_DATABASE_ID;
  if (!apiKey || !databaseId) {
    return res.status(500).json({ ok: false, error: 'NEXUS Notion 설정 누락' });
  }

  const body = req.body || {};
  const filter = String(body.filter || '').trim().toLowerCase();
  const site = String(body.site || '').trim();
  const limit = Math.min(Math.max(parseInt(body.limit) || 100, 1), 200);

  // Notion DB 전체 조회 (필터는 클라이언트 측 — 단순 + 컬럼 무관 검색)
  try {
    const allResults = [];
    let cursor = undefined;
    let totalScanned = 0;
    // pagination — 최대 5페이지 (500건) 안전 limit
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
        return res.status(r.status).json({ ok: false, error: data.message || 'Notion query failed', notionError: data });
      }
      const rows = Array.isArray(data.results) ? data.results : [];
      totalScanned += rows.length;
      for (const row of rows) {
        allResults.push(row);
      }
      if (!data.has_more) break;
      cursor = data.next_cursor;
    }

    // 자산 정규화 + 클라이언트 측 필터
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

    // 검색 적용
    let filtered = normalized;
    if (filter) {
      filtered = filtered.filter(a => {
        const haystack = (a.title + ' ' + Object.values(a.values).join(' ')).toLowerCase();
        return haystack.includes(filter);
      });
    }
    if (site) {
      filtered = filtered.filter(a => {
        const v = Object.entries(a.values).find(([k]) => /(site|사이트|장소|위치)/i.test(k))?.[1] || '';
        return String(v).toLowerCase().includes(site.toLowerCase());
      });
    }

    // limit 적용
    const result = filtered.slice(0, limit);

    return res.status(200).json({
      ok: true,
      count: result.length,
      assets: result,
      totalScanned,
      truncated: filtered.length > limit,
    });
  } catch (err) {
    console.error('[assets-query] error:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
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
