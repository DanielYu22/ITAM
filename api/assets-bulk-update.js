/**
 * NEXUS Cross-API — Asset 일괄 업데이트 endpoint (write)
 *
 * 사용처: ATLAS 채팅에서 "이 장비들 상태를 점검완료 로 일괄 변경" 같은 명령.
 * 미리 선택된 asset IDs + 업데이트할 필드 + 값 받음 → Notion PATCH 일괄.
 * 이전 값 함께 반환 → ATLAS 측 Undo 가능.
 *
 * 보안: CROSS_API_TOKEN 토큰 인증 + dry-run 모드 지원.
 *
 * 요청 (POST):
 *   {
 *     "ids": ["page-id-1", "page-id-2", ...],
 *     "updates": {
 *       "상태": { "type": "select", "value": "점검완료" },
 *       "메모": { "type": "rich_text", "value": "2026-06 정기 점검" }
 *     },
 *     "dryRun": false   // true 면 실제 PATCH 안 함, 영향 받을 ids 만 반환
 *   }
 *
 * 응답:
 *   {
 *     "ok": true,
 *     "updated": [
 *       { "id": "...", "prevValues": { "상태": "예정" }, "newValues": { "상태": "점검완료" } },
 *       ...
 *     ],
 *     "failed": []
 *   }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cross-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const expected = process.env.CROSS_API_TOKEN;
  const got = req.headers['x-cross-token'] || req.headers['X-Cross-Token'];
  if (expected && got !== expected) {
    return res.status(401).json({ ok: false, error: 'invalid token' });
  }

  const apiKey = process.env.VITE_NOTION_KEY || process.env.NOTION_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'NEXUS Notion key 누락' });
  }

  const body = req.body || {};
  const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') : [];
  const updates = body.updates || {};
  const dryRun = body.dryRun === true;

  if (ids.length === 0) return res.status(400).json({ ok: false, error: 'ids 비어있음' });
  if (Object.keys(updates).length === 0) return res.status(400).json({ ok: false, error: 'updates 비어있음' });
  if (ids.length > 100) return res.status(400).json({ ok: false, error: '한 번에 최대 100건' });

  if (dryRun) {
    return res.status(200).json({
      ok: true, dryRun: true,
      wouldUpdate: ids.length,
      ids,
      updates,
    });
  }

  // Notion PATCH 페이로드 빌드
  const propPayload = {};
  for (const [name, spec] of Object.entries(updates)) {
    propPayload[name] = buildPropertyValue(spec);
  }

  // [Track B] 변경이력 — 값이 실제 바뀌면 처리이력에 "[날짜] ATLAS 변경: 필드 prev→new" prepend.
  //   (field-support.js 의 처리이력 누적 패턴 차용. 장비 변경의 감사 추적 보장.)
  const HISTORY_RE = /처리이력|이력|history/i;
  const todayYmd = new Date().toISOString().slice(0, 10);

  const updated = [];
  const failed = [];
  for (const id of ids) {
    try {
      // 페이지 1회 조회 — 이전 값(Undo용) + 처리이력 현재값.
      const pageRes = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28' },
      });
      const page = pageRes.ok ? await pageRes.json() : null;
      const props = page?.properties || {};
      const prev = {};
      for (const n of Object.keys(updates)) prev[n] = extractStringValue(props[n]);

      // 실제로 바뀐 필드만 변경 라인에 담는다.
      const changedParts = [];
      for (const [k, spec] of Object.entries(updates)) {
        const nv = Array.isArray(spec.value) ? spec.value.join(', ') : String(spec.value);
        if (String(prev[k] ?? '') !== nv) changedParts.push(`${k} ${prev[k] || '∅'}→${nv}`);
      }

      // 처리이력 prop 탐지(이름 가변 대비) + prepend.
      let historyName = null, historyCur = '';
      for (const [k, val] of Object.entries(props)) {
        if (HISTORY_RE.test(k) && val?.type === 'rich_text') { historyName = k; historyCur = extractStringValue(val); break; }
      }
      const pageProps = { ...propPayload };
      let historyAdded = false;
      if (changedParts.length > 0 && historyName) {
        const line = `[${todayYmd}] ATLAS 변경: ${changedParts.join(', ')}`;
        const newHist = (line + (historyCur ? '\n' + historyCur : '')).slice(0, 1990);
        pageProps[historyName] = { rich_text: [{ type: 'text', text: { content: newHist } }] };
        historyAdded = true;
      }

      // PATCH
      const r = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: pageProps }),
      });
      const data = await r.json();
      if (!r.ok) {
        failed.push({ id, error: data.message || 'PATCH failed' });
      } else {
        updated.push({
          id,
          prevValues: prev,
          newValues: Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, v.value])),
          historyAdded,
        });
      }
    } catch (err) {
      failed.push({ id, error: err.message || String(err) });
    }
  }

  return res.status(200).json({
    ok: failed.length === 0,
    updatedCount: updated.length,
    failedCount: failed.length,
    updated,
    failed,
  });
}

function buildPropertyValue(spec) {
  const type = spec.type;
  const value = spec.value;
  switch (type) {
    case 'select':       return { select: { name: String(value) } };
    case 'multi_select': return { multi_select: (Array.isArray(value) ? value : [value]).map(v => ({ name: String(v) })) };
    case 'status':       return { status: { name: String(value) } };
    case 'rich_text':    return { rich_text: [{ type: 'text', text: { content: String(value) } }] };
    case 'title':        return { title: [{ type: 'text', text: { content: String(value) } }] };
    case 'number':       return { number: Number(value) };
    case 'checkbox':     return { checkbox: !!value };
    case 'date':         return { date: { start: String(value) } };
    case 'url':          return { url: String(value) };
    default:             return { rich_text: [{ type: 'text', text: { content: String(value) } }] };
  }
}

async function fetchPagePropertyValues(apiKey, pageId, propNames) {
  try {
    const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28' },
    });
    if (!r.ok) return {};
    const page = await r.json();
    const out = {};
    for (const n of propNames) {
      out[n] = extractStringValue(page.properties?.[n]);
    }
    return out;
  } catch { return {}; }
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
      default:            return '';
    }
  } catch { return ''; }
}
