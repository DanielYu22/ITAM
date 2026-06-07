/**
 * NEXUS Cross-API — 현장지원 접수 endpoint
 *
 * ATLAS 에서 "현장지원 task" 를 등록할 때 호출 → NEXUS 의 자산 페이지의
 * 'M)현장지원 상태' 필드를 '요청' 으로 설정 + 메모 + 처리이력 추가.
 *
 * NEXUS 본체의 FieldSupportSubmitModal 과 동일한 결과를 만들어줌.
 *
 * 요청 (POST):
 *   {
 *     "assetId": "Notion page id" | null,    // 자산 페이지 ID (있으면)
 *     "assetTitle": "PC-001" | null,         // 또는 자산 제목으로 검색
 *     "requester": "이름/소속",              // 요청자 (선택)
 *     "content": "문제 내용",                // 필수
 *     "fromAtlas": true                      // ATLAS task ID (있으면 ref)
 *   }
 *
 * 응답:
 *   {
 *     "ok": true,
 *     "assetId": "...",
 *     "assetTitle": "...",
 *     "url": "...",
 *     "submitted": "2026-06-07T..."
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
  // [Phase 15] env 잘못된 값일 경우 fallback — NEXUS 가 실제 사용 중인 dbId
  const REAL_DB_ID_FALLBACK = '2df17e12-9ccc-806b-8345-d3d840db15ca';
  const envDbId = process.env.VITE_NOTION_DATABASE_ID || process.env.NOTION_DATABASE_ID;
  // env 가 잘못된 (404 발생한) 값이면 fallback 사용
  const WRONG_DB_ID = '2df17e12-9ccc-80b1-a34c-000b81da4a69';
  const databaseId = (envDbId && envDbId !== WRONG_DB_ID) ? envDbId : REAL_DB_ID_FALLBACK;
  if (!apiKey || !databaseId) {
    return res.status(500).json({ ok: false, error: 'NEXUS Notion 설정 누락' });
  }

  const body = req.body || {};
  let assetId = String(body.assetId || '').trim();
  const assetTitle = String(body.assetTitle || '').trim();
  const requester = String(body.requester || '').trim();
  const content = String(body.content || '').trim();
  const fromAtlas = body.fromAtlas === true;

  if (!content) return res.status(400).json({ ok: false, error: '문제 내용 필수' });
  if (!assetId && !assetTitle) return res.status(400).json({ ok: false, error: 'assetId 또는 assetTitle 필요' });

  // assetId 없으면 title 로 검색
  let foundTitle = '';
  let pageUrl = '';
  try {
    if (!assetId && assetTitle) {
      const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 5 }),
      });
      const data = await r.json();
      if (r.ok && Array.isArray(data.results)) {
        // title 매칭 — substring
        const target = assetTitle.toLowerCase();
        const found = data.results.find(p => {
          for (const v of Object.values(p.properties || {})) {
            if (v.type === 'title') {
              const s = (v.title || []).map(t => t.plain_text).join('').toLowerCase();
              if (s.includes(target)) return true;
            }
          }
          return false;
        });
        if (found) {
          assetId = found.id;
          foundTitle = (Object.values(found.properties || {}).find(v => v.type === 'title')?.title || []).map(t => t.plain_text).join('');
          pageUrl = found.url;
        }
      }
    }
    if (!assetId) {
      return res.status(404).json({ ok: false, error: `"${assetTitle}" 자산 찾을 수 없음` });
    }

    // PATCH — 현장지원 상태 + 메모 + 처리이력
    const ts = new Date().toISOString();
    const historyLine = `${ts.slice(0, 16).replace('T', ' ')} [현장지원 요청${fromAtlas ? ' · ATLAS' : ''}] ${content}${requester ? ` (요청자: ${requester})` : ''}`;

    // 기존 메모/처리이력 가져오기 (append 위해)
    let prevMemo = '', prevHistory = '';
    try {
      const r = await fetch(`https://api.notion.com/v1/pages/${assetId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28' },
      });
      const page = await r.json();
      if (r.ok) {
        for (const [k, v] of Object.entries(page.properties || {})) {
          if (/M\)현장지원\s*메모|현장지원\s*메모|FIELD_SUPPORT_MEMO/i.test(k) && v.type === 'rich_text') {
            prevMemo = (v.rich_text || []).map(t => t.plain_text).join('');
          }
          if (/처리이력|HISTORY|이력/i.test(k) && v.type === 'rich_text') {
            prevHistory = (v.rich_text || []).map(t => t.plain_text).join('');
          }
          if (!pageUrl && page.url) pageUrl = page.url;
          if (!foundTitle && v.type === 'title') {
            foundTitle = (v.title || []).map(t => t.plain_text).join('');
          }
        }
      }
    } catch {}

    const updatedMemo = content + (prevMemo ? `\n\n--- 이전 ---\n${prevMemo}` : '');
    const updatedHistory = (prevHistory ? prevHistory + '\n' : '') + historyLine;

    // 컬럼명 가변 — 일반적인 이름 시도
    const propPayload = {
      'M)현장지원 상태': { select: { name: '요청' } },
      'M)현장지원 메모': { rich_text: [{ type: 'text', text: { content: updatedMemo.slice(0, 1990) } }] },
      '처리이력': { rich_text: [{ type: 'text', text: { content: updatedHistory.slice(0, 1990) } }] },
    };

    const patchRes = await fetch(`https://api.notion.com/v1/pages/${assetId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: propPayload }),
    });
    const patchData = await patchRes.json();
    if (!patchRes.ok) {
      // 일부 컬럼이 NEXUS DB 에 없을 수 있음 → 빠진 컬럼만 제거 후 재시도
      const errMsg = patchData?.message || '';
      const missingMatch = errMsg.match(/(\S+) is not a property/i) || errMsg.match(/property\s+(\S+)\s+not found/i);
      if (missingMatch) {
        const missingKey = missingMatch[1].replace(/['"]/g, '');
        delete propPayload[missingKey];
        const retry = await fetch(`https://api.notion.com/v1/pages/${assetId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ properties: propPayload }),
        });
        if (!retry.ok) {
          const rData = await retry.json();
          return res.status(retry.status).json({ ok: false, error: rData.message || 'PATCH 실패', notionError: rData });
        }
      } else {
        return res.status(patchRes.status).json({ ok: false, error: errMsg || 'PATCH 실패', notionError: patchData });
      }
    }

    return res.status(200).json({
      ok: true,
      assetId,
      assetTitle: foundTitle || assetTitle,
      url: pageUrl,
      submitted: ts,
    });
  } catch (err) {
    console.error('[field-support] error:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
