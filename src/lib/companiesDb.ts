/**
 * CompaniesDbClient — 입주사 마스터 DB 클라이언트
 * Phase B: Infrastructure DB 의 '입주사' relation 의 후보 목록.
 */

import { API_BASE_URL, NOTION_COMPANIES_DB_ID } from '../config';

export interface CompanyInfo {
    id: string;
    name: string;
    site?: string;            // 용인/마곡/향남
    director?: string;        // 연구소장
    leadResearcher?: string;  // 실무책임자
    julyHeadcount?: number;
    phase?: string;           // 입주완료/입주예정/희망
    clusters?: string[];
    note?: string;
}

export class CompaniesDbClient {
    private baseQuery = `${API_BASE_URL}/api/notion/v1/databases/${NOTION_COMPANIES_DB_ID}/query`;

    private headers() {
        return {
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
        };
    }

    async listAll(): Promise<CompanyInfo[]> {
        const out: CompanyInfo[] = [];
        let cursor: string | undefined;
        do {
            const body: any = { page_size: 100 };
            if (cursor) body.start_cursor = cursor;
            const resp = await fetch(this.baseQuery, {
                method: 'POST', headers: this.headers(), body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error(`Companies DB query failed: ${resp.status}`);
            const data = await resp.json();
            for (const r of data.results || []) {
                const c = this.rowToInfo(r);
                if (c) out.push(c);
            }
            cursor = data.has_more ? data.next_cursor : undefined;
        } while (cursor);
        return out;
    }

    private rowToInfo(row: any): CompanyInfo | null {
        const p = row.properties || {};
        const name = (p['회사명']?.title || []).map((t: any) => t.plain_text).join('');
        if (!name) return null;
        return {
            id: row.id,
            name,
            site: p['사이트']?.select?.name || undefined,
            director: (p['연구소장']?.rich_text || []).map((t: any) => t.plain_text).join('') || undefined,
            leadResearcher: (p['실무책임자']?.rich_text || []).map((t: any) => t.plain_text).join('') || undefined,
            julyHeadcount: p['7월 인원']?.number ?? undefined,
            phase: p['입주 단계']?.select?.name || undefined,
            clusters: (p['클러스터']?.multi_select || []).map((x: any) => x.name) || undefined,
            note: (p['비고']?.rich_text || []).map((t: any) => t.plain_text).join('') || undefined,
        };
    }
}
