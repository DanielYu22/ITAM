/**
 * InfrastructureAssetsDbClient — 인프라 장비(서버/스위치/방화벽 등) 전용 DB
 *
 * 일상 자산 DB(실험기기)와 완전 분리. 인프라·레이아웃 메뉴 안에서만 노출.
 */

import { API_BASE_URL, NOTION_INFRA_ASSETS_DB_ID } from '../config';

export const INFRA_ASSET_CATEGORIES = [
    '백본/코어 스위치',
    '분배/Access 스위치',
    '방화벽',
    'IPS',
    'WLC',
    'AP',
    '서버',
    'NAS',
    '음성/CUCM',
    '모니터링',
    '기타 네트워크',
] as const;
export type InfraAssetCategory = typeof INFRA_ASSET_CATEGORIES[number];

export const INFRA_ASSET_STATUSES = [
    '운영중',
    '유휴/예비',
    '점검중',
    '교체대기',
    'EOL',
    '이전됨',
] as const;
export type InfraAssetStatus = typeof INFRA_ASSET_STATUSES[number];

export const CATEGORY_EMOJI: Record<InfraAssetCategory, string> = {
    '백본/코어 스위치': '🔴',
    '분배/Access 스위치': '🟠',
    '방화벽': '🛡️',
    'IPS': '🔍',
    'WLC': '📡',
    'AP': '📶',
    '서버': '🖥️',
    'NAS': '💾',
    '음성/CUCM': '📞',
    '모니터링': '📊',
    '기타 네트워크': '🔌',
};

export interface InfraAsset {
    id: string;
    name: string;
    category?: InfraAssetCategory;
    model?: string;
    ip?: string;
    mac?: string;
    serial?: string;
    roomIds?: string[];
    status?: InfraAssetStatus;
    introducedDate?: string; // YYYY-MM-DD
    note?: string;
}

export class InfrastructureAssetsDbClient {
    private query = `${API_BASE_URL}/api/notion/v1/databases/${NOTION_INFRA_ASSETS_DB_ID}/query`;
    private pagesBase = `${API_BASE_URL}/api/notion/v1/pages`;

    private headers() {
        return {
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
        };
    }

    /** 모든 인프라 자산 (페이지네이션 포함) */
    async listAll(): Promise<InfraAsset[]> {
        const out: InfraAsset[] = [];
        let cursor: string | undefined;
        do {
            const body: any = { page_size: 100 };
            if (cursor) body.start_cursor = cursor;
            const resp = await fetch(this.query, {
                method: 'POST', headers: this.headers(), body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error(`InfraAssets list failed: ${resp.status}`);
            const data = await resp.json();
            for (const r of data.results || []) {
                const a = this.rowToAsset(r);
                if (a) out.push(a);
            }
            cursor = data.has_more ? data.next_cursor : undefined;
        } while (cursor);
        return out;
    }

    /** 특정 룸의 자산만 */
    async listByRoomId(roomId: string): Promise<InfraAsset[]> {
        const all = await this.listAll(); // 양이 적으니 client filter
        return all.filter(a => (a.roomIds || []).includes(roomId));
    }

    async create(input: Partial<InfraAsset> & { name: string }): Promise<InfraAsset> {
        const body = {
            parent: { database_id: NOTION_INFRA_ASSETS_DB_ID },
            properties: this.toProps(input),
        };
        const resp = await fetch(this.pagesBase, {
            method: 'POST', headers: this.headers(), body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`InfraAsset create failed: ${resp.status} ${await resp.text()}`);
        return this.rowToAsset(await resp.json())!;
    }

    async update(id: string, patch: Partial<InfraAsset>): Promise<InfraAsset> {
        const body = { properties: this.toProps(patch, true) };
        const resp = await fetch(`${this.pagesBase}/${id}`, {
            method: 'PATCH', headers: this.headers(), body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`InfraAsset update failed: ${resp.status} ${await resp.text()}`);
        return this.rowToAsset(await resp.json())!;
    }

    async archive(id: string): Promise<void> {
        const resp = await fetch(`${this.pagesBase}/${id}`, {
            method: 'PATCH', headers: this.headers(),
            body: JSON.stringify({ archived: true }),
        });
        if (!resp.ok) throw new Error(`InfraAsset archive failed: ${resp.status}`);
    }

    private toProps(input: Partial<InfraAsset>, isUpdate = false): any {
        const props: any = {};
        if (input.name !== undefined) props['장비명'] = { title: [{ text: { content: input.name } }] };
        if (input.category !== undefined) props['카테고리'] = input.category ? { select: { name: input.category } } : { select: null };
        if (input.model !== undefined) props['모델'] = { rich_text: input.model ? [{ text: { content: input.model } }] : [] };
        if (input.ip !== undefined) props['IP'] = { rich_text: input.ip ? [{ text: { content: input.ip } }] : [] };
        if (input.mac !== undefined) props['MAC'] = { rich_text: input.mac ? [{ text: { content: input.mac } }] : [] };
        if (input.serial !== undefined) props['시리얼'] = { rich_text: input.serial ? [{ text: { content: input.serial } }] : [] };
        if (input.note !== undefined) props['메모'] = { rich_text: input.note ? [{ text: { content: input.note } }] : [] };
        if (input.status !== undefined) props['상태'] = input.status ? { select: { name: input.status } } : { select: null };
        if (input.introducedDate !== undefined) props['도입일'] = input.introducedDate ? { date: { start: input.introducedDate } } : { date: null };
        if (input.roomIds !== undefined) props['위치 (룸)'] = { relation: (input.roomIds || []).map(id => ({ id })) };
        return props;
    }

    private rowToAsset(row: any): InfraAsset | null {
        const p = row.properties || {};
        const name = (p['장비명']?.title || []).map((t: any) => t.plain_text).join('');
        if (!name) return null;
        return {
            id: row.id,
            name,
            category: (p['카테고리']?.select?.name as InfraAssetCategory) || undefined,
            model: (p['모델']?.rich_text || []).map((t: any) => t.plain_text).join('') || undefined,
            ip: (p['IP']?.rich_text || []).map((t: any) => t.plain_text).join('') || undefined,
            mac: (p['MAC']?.rich_text || []).map((t: any) => t.plain_text).join('') || undefined,
            serial: (p['시리얼']?.rich_text || []).map((t: any) => t.plain_text).join('') || undefined,
            note: (p['메모']?.rich_text || []).map((t: any) => t.plain_text).join('') || undefined,
            status: (p['상태']?.select?.name as InfraAssetStatus) || undefined,
            introducedDate: p['도입일']?.date?.start || undefined,
            roomIds: (p['위치 (룸)']?.relation || []).map((x: any) => x.id),
        };
    }
}
