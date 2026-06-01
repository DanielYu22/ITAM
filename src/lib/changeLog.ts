/**
 * ChangeLog 클라이언트 — 자산 컬럼 변경을 시계열로 기록
 *
 * Phase 2 검토 권고:
 *  - 처리이력(rich_text)은 사람이 읽기 좋지만 시계열·diff·컬럼 단위 추적은 약함
 *  - 별도 노션 DB에 변경 row 를 시계열로 누적
 *  - "변경분만 export" 등 다운스트림 워크플로우 가능
 *
 * 실패해도 메인 PATCH 흐름은 막지 않음 (fire-and-forget).
 */

import { API_BASE_URL, NOTION_CHANGELOG_DB_ID } from '../config';

export type ChangeSource =
    | '수동 편집'
    | '정기 초기화'
    | '소스 임포트'
    | '대시보드 완료'
    | 'Quick Task 완료'
    | '일괄 업데이트'
    | '기타';

export interface ChangeEntry {
    assetId: string;
    assetName: string;
    field: string;
    oldValue: string;
    newValue: string;
    by?: string;
    site?: string; // '용인' / '마곡' / '향남'
    source?: ChangeSource;
    at?: Date;
}

const headers = () => ({
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
});

const rich = (t: string) => t
    ? { rich_text: [{ text: { content: t.slice(0, 1800) } }] }
    : { rich_text: [] };

export const recordChange = async (entry: ChangeEntry): Promise<void> => {
    const at = entry.at || new Date();
    const props: any = {
        '제목': { title: [{ text: { content: `${entry.assetName} · ${entry.field}` } }] },
        '자산 ID': rich(entry.assetId),
        '자산명': rich(entry.assetName),
        '컬럼': rich(entry.field),
        '이전 값': rich(entry.oldValue || ''),
        '새 값': rich(entry.newValue || ''),
        '변경 시각': { date: { start: at.toISOString() } },
    };
    if (entry.by) props['변경자'] = rich(entry.by);
    if (entry.site) props['사이트'] = { select: { name: entry.site } };
    if (entry.source) props['소스'] = { select: { name: entry.source } };

    try {
        await fetch(`${API_BASE_URL}/api/notion/v1/pages`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
                parent: { database_id: NOTION_CHANGELOG_DB_ID },
                properties: props,
            }),
        });
    } catch (e) {
        // 변경 기록 실패는 메인 흐름 막지 않음
        console.warn('[ChangeLog] record failed', entry.assetName, entry.field, e);
    }
};

/** 여러 변경을 한 번에 — 순차 호출 (Notion API rate 보호용 sleep 포함) */
export const recordChanges = async (entries: ChangeEntry[]): Promise<void> => {
    for (const e of entries) {
        await recordChange(e);
        await new Promise(r => setTimeout(r, 30));
    }
};

/** 최근 N일 변경 fetch (변경분 export 용) */
export const fetchRecentChanges = async (sinceDays: number = 7): Promise<any[]> => {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);
    const sinceISO = since.toISOString().slice(0, 10);

    const out: any[] = [];
    let cursor: string | undefined;
    do {
        const body: any = {
            page_size: 100,
            filter: {
                property: '변경 시각',
                date: { on_or_after: sinceISO },
            },
            sorts: [{ property: '변경 시각', direction: 'descending' }],
        };
        if (cursor) body.start_cursor = cursor;
        const resp = await fetch(`${API_BASE_URL}/api/notion/v1/databases/${NOTION_CHANGELOG_DB_ID}/query`, {
            method: 'POST', headers: headers(), body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`ChangeLog query failed: ${resp.status}`);
        const data = await resp.json();
        for (const r of data.results || []) {
            const p = r.properties || {};
            const getR = (k: string) => (p[k]?.rich_text || []).map((t: any) => t.plain_text).join('');
            out.push({
                id: r.id,
                assetId: getR('자산 ID'),
                assetName: getR('자산명'),
                field: getR('컬럼'),
                oldValue: getR('이전 값'),
                newValue: getR('새 값'),
                by: getR('변경자'),
                site: p['사이트']?.select?.name,
                source: p['소스']?.select?.name,
                at: p['변경 시각']?.date?.start,
            });
        }
        cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return out;
};
