/**
 * InfrastructureDbClient — 노션 Infrastructure DB 클라이언트
 *
 * Phase B: settings.infrastructure JSON 대신 별도 노션 DB를 사용.
 * - 모든 공간(room)을 노션 DB row 로 저장
 * - 트리(사이트 → 건물 → 층 → 공간) 구조는 클라이언트에서 빌드
 */

import { API_BASE_URL, NOTION_INFRA_DB_ID } from '../config';
import {
    InfrastructureData,
    BuildingInfo,
    FloorInfo,
    RoomInfo,
    RoomType,
    ServerRoomInfo,
    MeetingRoomInfo,
} from './infrastructure';
import { SiteId } from './sites';

const SITE_LABEL_TO_ID: Record<string, SiteId> = {
    '용인': 'yongin',
    '마곡': 'magok',
    '향남': 'hyangnam',
};
const SITE_ID_TO_LABEL: Record<SiteId, string> = {
    yongin: '용인',
    magok: '마곡',
    hyangnam: '향남',
    all: '용인',           // dummy — 저장 안 함
    unclassified: '용인',  // dummy
};
const TYPE_LABEL_TO_ID: Record<string, RoomType> = {
    '실험실': 'lab',
    '서버실': 'server-room',
    '사무실': 'office',
    '미팅룸': 'meeting-room',
    '기타': 'other',
};
const TYPE_ID_TO_LABEL: Record<RoomType, string> = {
    'lab': '실험실',
    'server-room': '서버실',
    'office': '사무실',
    'meeting-room': '미팅룸',
    'other': '기타',
};

/** DB row 의 페이지 ID 까지 포함하는 확장 RoomInfo */
export interface RoomNode extends RoomInfo {
    id: string;
    site: SiteId;
    building: string;
    floor: string;
    occupantIds?: string[];   // Companies relation page ids
    cluster?: string;          // select option name
}

export class InfrastructureDbClient {
    private baseQuery = `${API_BASE_URL}/api/notion/v1/databases/${NOTION_INFRA_DB_ID}/query`;
    private pagesBase = `${API_BASE_URL}/api/notion/v1/pages`;

    private headers() {
        return {
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
        };
    }

    /** 모든 공간 fetch (페이지네이션 포함) */
    async listAll(): Promise<RoomNode[]> {
        const out: RoomNode[] = [];
        let cursor: string | undefined;
        do {
            const body: any = { page_size: 100 };
            if (cursor) body.start_cursor = cursor;
            const resp = await fetch(this.baseQuery, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error(`Infra DB query failed: ${resp.status}`);
            const data = await resp.json();
            for (const r of data.results || []) {
                const node = this.rowToNode(r);
                if (node) out.push(node);
            }
            cursor = data.has_more ? data.next_cursor : undefined;
        } while (cursor);
        return out;
    }

    /** 트리 구조로 빌드 (InfrastructureData 형태) */
    async loadAsTree(): Promise<{ data: InfrastructureData; nodesById: Map<string, RoomNode> }> {
        const nodes = await this.listAll();
        const nodesById = new Map<string, RoomNode>();
        for (const n of nodes) nodesById.set(n.id, n);

        // site → building → floor → rooms
        const tree = new Map<SiteId, Map<string, Map<string, RoomNode[]>>>();
        for (const n of nodes) {
            if (!tree.has(n.site)) tree.set(n.site, new Map());
            const bmap = tree.get(n.site)!;
            if (!bmap.has(n.building)) bmap.set(n.building, new Map());
            const fmap = bmap.get(n.building)!;
            if (!fmap.has(n.floor)) fmap.set(n.floor, []);
            fmap.get(n.floor)!.push(n);
        }

        const koSort = (a: string, b: string) =>
            a.localeCompare(b, 'ko', { numeric: true });

        const buildings: BuildingInfo[] = [];
        for (const [siteId, bmap] of tree.entries()) {
            for (const bname of Array.from(bmap.keys()).sort(koSort)) {
                const floors: FloorInfo[] = [];
                const fmap = bmap.get(bname)!;
                for (const fname of Array.from(fmap.keys()).sort(this.floorSort)) {
                    const rooms = fmap.get(fname)!.sort((a, b) => koSort(a.name, b.name));
                    floors.push({ name: fname, rooms });
                }
                buildings.push({ name: bname, siteId, floors });
            }
        }

        return {
            data: { buildings, updatedAt: new Date().toISOString() },
            nodesById,
        };
    }

    private floorSort = (a: string, b: string) => {
        const score = (name: string) => {
            if (name.startsWith('B')) {
                const m = name.match(/^B(\d+)/);
                return m ? -parseInt(m[1], 10) : -99;
            }
            const m = name.match(/^(\d+)/);
            return m ? parseInt(m[1], 10) : 999;
        };
        return score(a) - score(b) || a.localeCompare(b, 'ko');
    };

    /** 단일 row → RoomNode */
    private rowToNode(row: any): RoomNode | null {
        const p = row.properties || {};
        const name = this.readTitle(p['공간 이름']);
        if (!name) return null;
        const siteLabel = this.readSelect(p['사이트']);
        const buildingName = this.readSelect(p['건물']);
        const floorName = this.readSelect(p['층']);
        const typeLabel = this.readSelect(p['타입']);
        const site = SITE_LABEL_TO_ID[siteLabel || ''] || 'unclassified';
        const type: RoomType = TYPE_LABEL_TO_ID[typeLabel || ''] || 'lab';

        const node: RoomNode = {
            id: row.id,
            name,
            site,
            building: buildingName || '미정',
            floor: floorName || '미정',
            type,
            notes: this.readRichText(p['메모']) || undefined,
            features: this.readMultiSelect(p['특징']) || undefined,
            assignedTeam: this.readRichText(p['할당팀']) || undefined,
            assetCount: this.readNumber(p['자산수']) ?? undefined,
            autoSeeded: this.readCheckbox(p['자동 시드']) || undefined,
            occupantIds: this.readRelation(p['입주사']) || undefined,
            cluster: this.readSelect(p['클러스터']) || undefined,
        };

        // meeting-room 메타
        if (type === 'meeting-room') {
            const mr: MeetingRoomInfo = {};
            const cap = this.readNumber(p['정원']); if (cap !== null) mr.capacity = cap;
            const eq = this.readMultiSelect(p['장비']); if (eq) mr.equipment = eq;
            const code = this.readRichText(p['예약 코드']); if (code) mr.reservationCode = code;
            const py = this.readNumber(p['평수']); if (py !== null) mr.areaPyung = py;
            if (Object.keys(mr).length > 0) node.meetingRoom = mr;
        }

        return node;
    }

    /** RoomNode → Notion properties */
    private nodeToProps(input: Partial<RoomNode> & { name: string; site: SiteId; building: string; floor: string; type: RoomType }): any {
        const siteLabel = SITE_ID_TO_LABEL[input.site];
        const typeLabel = TYPE_ID_TO_LABEL[input.type];
        const props: any = {
            '공간 이름': { title: [{ text: { content: input.name } }] },
            '사이트': { select: { name: siteLabel } },
            '건물': { select: { name: input.building } },
            '층': { select: { name: input.floor } },
            '타입': { select: { name: typeLabel } },
        };
        if (input.notes !== undefined) {
            props['메모'] = { rich_text: input.notes ? [{ text: { content: input.notes } }] : [] };
        }
        if (input.features !== undefined) {
            props['특징'] = { multi_select: (input.features || []).map(f => ({ name: f })) };
        }
        if (input.assignedTeam !== undefined) {
            props['할당팀'] = { rich_text: input.assignedTeam ? [{ text: { content: input.assignedTeam } }] : [] };
        }
        if (input.assetCount !== undefined) {
            props['자산수'] = { number: input.assetCount ?? null };
        }
        if (input.autoSeeded !== undefined) {
            props['자동 시드'] = { checkbox: !!input.autoSeeded };
        }
        if (input.cluster !== undefined) {
            props['클러스터'] = input.cluster ? { select: { name: input.cluster } } : { select: null };
        }
        if (input.occupantIds !== undefined) {
            props['입주사'] = { relation: (input.occupantIds || []).map(id => ({ id })) };
        }
        if (input.type === 'meeting-room' || input.meetingRoom !== undefined) {
            const mr = input.meetingRoom || {};
            if (mr.capacity !== undefined) props['정원'] = { number: mr.capacity ?? null };
            if (mr.equipment !== undefined) props['장비'] = { multi_select: (mr.equipment || []).map(e => ({ name: e })) };
            if (mr.reservationCode !== undefined) props['예약 코드'] = { rich_text: mr.reservationCode ? [{ text: { content: mr.reservationCode } }] : [] };
            if (mr.areaPyung !== undefined) props['평수'] = { number: mr.areaPyung ?? null };
        }
        return props;
    }

    /** 룸 생성 */
    async createRoom(input: {
        name: string; site: SiteId; building: string; floor: string; type: RoomType;
    } & Partial<RoomNode>): Promise<RoomNode> {
        const body = {
            parent: { database_id: NOTION_INFRA_DB_ID },
            properties: this.nodeToProps(input),
        };
        const resp = await fetch(this.pagesBase, {
            method: 'POST', headers: this.headers(), body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Infra createRoom failed: ${resp.status} ${await resp.text()}`);
        const data = await resp.json();
        return this.rowToNode(data)!;
    }

    /** 룸 부분 업데이트 */
    async updateRoom(id: string, patch: Partial<RoomNode>): Promise<RoomNode> {
        const props = this.nodeToProps({
            name: patch.name ?? '',
            site: (patch.site as SiteId) ?? 'unclassified',
            building: patch.building ?? '',
            floor: patch.floor ?? '',
            type: patch.type ?? 'lab',
            ...patch,
        });
        // 변경하지 않을 필드는 제거
        if (patch.name === undefined) delete props['공간 이름'];
        if (patch.site === undefined) delete props['사이트'];
        if (patch.building === undefined) delete props['건물'];
        if (patch.floor === undefined) delete props['층'];
        if (patch.type === undefined) delete props['타입'];

        const resp = await fetch(`${this.pagesBase}/${id}`, {
            method: 'PATCH', headers: this.headers(),
            body: JSON.stringify({ properties: props }),
        });
        if (!resp.ok) throw new Error(`Infra updateRoom failed: ${resp.status} ${await resp.text()}`);
        const data = await resp.json();
        return this.rowToNode(data)!;
    }

    /** 룸 아카이브 (삭제) */
    async archiveRoom(id: string): Promise<void> {
        const resp = await fetch(`${this.pagesBase}/${id}`, {
            method: 'PATCH', headers: this.headers(),
            body: JSON.stringify({ archived: true }),
        });
        if (!resp.ok) throw new Error(`Infra archiveRoom failed: ${resp.status}`);
    }

    // ── property readers ──
    private readTitle(p: any): string {
        if (!p?.title) return '';
        return p.title.map((t: any) => t.plain_text || '').join('');
    }
    private readRichText(p: any): string {
        if (!p?.rich_text) return '';
        return p.rich_text.map((t: any) => t.plain_text || '').join('');
    }
    private readSelect(p: any): string {
        return p?.select?.name || '';
    }
    private readMultiSelect(p: any): string[] | null {
        if (!p?.multi_select) return null;
        const arr = p.multi_select.map((x: any) => x.name);
        return arr.length > 0 ? arr : null;
    }
    private readNumber(p: any): number | null {
        if (p?.number === null || p?.number === undefined) return null;
        return p.number;
    }
    private readCheckbox(p: any): boolean {
        return !!p?.checkbox;
    }
    private readRelation(p: any): string[] | null {
        if (!p?.relation) return null;
        const ids = p.relation.map((x: any) => x.id);
        return ids.length > 0 ? ids : null;
    }
}
