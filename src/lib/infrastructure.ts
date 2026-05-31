/**
 * Infrastructure — 인프라 전용 메타데이터 트리
 *
 * 사이트 → 건물 → 층 → 실험실의 4단계 트리를 관리합니다. 자산 데이터의
 * L)건물·L)층·L)연구실 컬럼이 작업 데이터의 source of truth라면, 이쪽은
 * 그 위치를 설명하는 metadata (실험실 특징, 메모, 향후 레이아웃 연결 등).
 *
 * Phase 1: 데이터 모델 + 자산에서 자동 시드 + 트리 조회.
 * Phase 2 예정: 노드 편집 (이름·메모·특징), 수동 추가/삭제.
 * Phase 3 예정: 레이아웃과 양방향 연결, 사이트 분류 룰에서 인프라 참조.
 *
 * 저장: Notion 설정 페이지의 settings.infrastructure 키 (사이트 룰 /
 * 레이아웃과 동일 패턴). 별도 Notion DB 분리는 필요해지면 추후 작업.
 */

import { Asset } from './notion';
import { SiteId, SiteDef, getAssetSite, SITES_DEFAULTS } from './sites';

/** 공간(실험실/서버실/사무실/기타) 타입 */
export type RoomType = 'lab' | 'server-room' | 'office' | 'other';

export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
    'lab': '실험실',
    'server-room': '서버실',
    'office': '사무실',
    'other': '기타',
};

export const ROOM_TYPE_EMOJI: Record<RoomType, string> = {
    'lab': '🧪',
    'server-room': '🖥️',
    'office': '💼',
    'other': '📦',
};

/** 서버실 전용 메타 — type === 'server-room' 일 때만 의미 있음 */
export interface ServerRoomInfo {
    rackCount?: number;
    serverCount?: number;
    /** 주요 네트워크 장비 / UPS / 냉방 등 자유 라벨 */
    equipment?: string[];
    cooling?: string;        // 예: '항온항습 24/7'
    ups?: string;            // 예: 'APC Symmetra 80kVA'
    powerNotes?: string;     // 전원 회로 등
    accessNotes?: string;    // 출입권한 / 키 / 카드
    contactPerson?: string;  // 담당자
}

/** 공간 메타데이터 (실험실/서버실 공통) */
export interface RoomInfo {
    name: string;
    type?: RoomType;         // 기본 'lab'
    notes?: string;
    /** 안전등급, 분류, BSL 등급 같은 자유 라벨들 */
    features?: string[];
    /** Phase 3에서 레이아웃 데이터와 연결 */
    layoutRef?: { building: string; floor: string; room: string };
    /** 자산 DB에 한 번이라도 매칭된 적이 있는지 — 자동 시드된 노드 표시 */
    autoSeeded?: boolean;
    /** 마지막 자동 시드 시점에 매칭된 자산 수 */
    assetCount?: number;
    /** 서버실 전용 메타 */
    serverRoom?: ServerRoomInfo;
}

export interface FloorInfo {
    name: string;
    rooms: RoomInfo[];
    notes?: string;
}

export interface BuildingInfo {
    name: string;
    siteId: SiteId;
    floors: FloorInfo[];
    notes?: string;
}

export interface InfrastructureData {
    buildings: BuildingInfo[];
    updatedAt?: string;
    /** 마지막 자동 시드 시점 */
    lastSeededAt?: string;
}

export const emptyInfrastructure = (): InfrastructureData => ({
    buildings: [],
});

export const ensureInfrastructure = (raw: any): InfrastructureData => {
    if (raw && Array.isArray(raw.buildings)) {
        return raw as InfrastructureData;
    }
    return emptyInfrastructure();
};

// ---------------------------------------------------------------------------
// 자산 DB → 인프라 트리 자동 시드
// ---------------------------------------------------------------------------

/**
 * 자산의 L)건물·L)층·L)연구실 컬럼을 훑어 트리 빌드.
 * 사이트 분류는 effectiveSites 기준으로 함 (현재 사이트 룰 반영).
 * 미분류는 일단 unclassified 사이트로 묶임 (사용자가 사이트 룰을 수정한 뒤
 * 다시 시드하면 정정).
 */
export const seedFromAssets = (
    assets: Asset[],
    effectiveSites?: SiteDef[],
): InfrastructureData => {
    // building -> floor -> room -> count
    const map = new Map<string, Map<string, Map<string, number>>>();
    const buildingSites = new Map<string, SiteId>();

    for (const a of assets) {
        const v = a.values as any;
        const b = String(v['L)건물'] ?? '').trim();
        const f = String(v['L)층'] ?? '').trim();
        const r = String(v['L)연구실'] ?? '').trim();
        if (!b || !f || !r) continue;

        const siteId = getAssetSite(a, effectiveSites);
        // unclassified 도 일단 포함 — 사용자가 사이트 룰 조정 후 다시 시드 가능
        if (!buildingSites.has(b)) buildingSites.set(b, siteId);

        if (!map.has(b)) map.set(b, new Map());
        const bm = map.get(b)!;
        if (!bm.has(f)) bm.set(f, new Map());
        const fm = bm.get(f)!;
        fm.set(r, (fm.get(r) || 0) + 1);
    }

    const krSort = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true });

    const buildings: BuildingInfo[] = [];
    for (const b of Array.from(map.keys()).sort(krSort)) {
        const floors: FloorInfo[] = [];
        const bm = map.get(b)!;
        for (const f of Array.from(bm.keys()).sort(krSort)) {
            const rooms: RoomInfo[] = [];
            const fm = bm.get(f)!;
            for (const r of Array.from(fm.keys()).sort(krSort)) {
                rooms.push({
                    name: r,
                    autoSeeded: true,
                    assetCount: fm.get(r)!,
                });
            }
            floors.push({ name: f, rooms });
        }
        buildings.push({
            name: b,
            siteId: buildingSites.get(b) || 'unclassified',
            floors,
        });
    }

    const now = new Date().toISOString();
    return {
        buildings,
        updatedAt: now,
        lastSeededAt: now,
    };
};

/**
 * 기존 인프라 트리 + 새로 시드한 트리를 머지.
 * 자동 추출되지 않은 (사용자가 수동으로 추가했거나, 자산이 사라진) 노드는 그대로 유지.
 * 자산 카운트는 최신 값으로 갱신.
 */
export const mergeSeedIntoInfrastructure = (
    existing: InfrastructureData,
    seeded: InfrastructureData,
): InfrastructureData => {
    const result: InfrastructureData = {
        buildings: [],
        updatedAt: new Date().toISOString(),
        lastSeededAt: new Date().toISOString(),
    };

    const seededByBuilding = new Map(seeded.buildings.map(b => [b.name, b]));
    const existingByBuilding = new Map(existing.buildings.map(b => [b.name, b]));
    const allBuildingNames = new Set([
        ...existing.buildings.map(b => b.name),
        ...seeded.buildings.map(b => b.name),
    ]);

    for (const bname of allBuildingNames) {
        const ex = existingByBuilding.get(bname);
        const sd = seededByBuilding.get(bname);
        const siteId = sd?.siteId ?? ex?.siteId ?? 'unclassified';
        const mergedFloors: FloorInfo[] = [];

        const allFloorNames = new Set([
            ...(ex?.floors.map(f => f.name) ?? []),
            ...(sd?.floors.map(f => f.name) ?? []),
        ]);

        const exFloors = new Map((ex?.floors ?? []).map(f => [f.name, f]));
        const sdFloors = new Map((sd?.floors ?? []).map(f => [f.name, f]));

        for (const fname of allFloorNames) {
            const exF = exFloors.get(fname);
            const sdF = sdFloors.get(fname);
            const mergedRooms: RoomInfo[] = [];

            const allRoomNames = new Set([
                ...(exF?.rooms.map(r => r.name) ?? []),
                ...(sdF?.rooms.map(r => r.name) ?? []),
            ]);

            const exRooms = new Map((exF?.rooms ?? []).map(r => [r.name, r]));
            const sdRooms = new Map((sdF?.rooms ?? []).map(r => [r.name, r]));

            for (const rname of allRoomNames) {
                const exR = exRooms.get(rname);
                const sdR = sdRooms.get(rname);
                mergedRooms.push({
                    name: rname,
                    type: exR?.type,
                    notes: exR?.notes,
                    features: exR?.features,
                    layoutRef: exR?.layoutRef,
                    autoSeeded: sdR?.autoSeeded ?? exR?.autoSeeded,
                    assetCount: sdR?.assetCount ?? exR?.assetCount,
                    serverRoom: exR?.serverRoom,
                });
            }

            mergedFloors.push({
                name: fname,
                rooms: mergedRooms,
                notes: exF?.notes,
            });
        }

        result.buildings.push({
            name: bname,
            siteId,
            floors: mergedFloors,
            notes: ex?.notes,
        });
    }

    return result;
};

/** 사이트별 집계 통계 */
export const summarizeInfrastructure = (data: InfrastructureData) => {
    const perSite: Record<SiteId, { buildings: number; floors: number; rooms: number }> = {
        all: { buildings: 0, floors: 0, rooms: 0 },
        yongin: { buildings: 0, floors: 0, rooms: 0 },
        magok: { buildings: 0, floors: 0, rooms: 0 },
        hyangnam: { buildings: 0, floors: 0, rooms: 0 },
        unclassified: { buildings: 0, floors: 0, rooms: 0 },
    };
    for (const b of data.buildings) {
        const s = b.siteId;
        perSite[s].buildings++;
        for (const f of b.floors) {
            perSite[s].floors++;
            perSite[s].rooms += f.rooms.length;
        }
    }
    return perSite;
};

/** 사이트별로 건물 그룹화 (UI 표시용) */
export const groupBuildingsBySite = (data: InfrastructureData) => {
    const map: Record<SiteId, BuildingInfo[]> = {
        all: [],
        yongin: [],
        magok: [],
        hyangnam: [],
        unclassified: [],
    };
    for (const b of data.buildings) {
        map[b.siteId] = map[b.siteId] || [];
        map[b.siteId].push(b);
    }
    return map;
};
