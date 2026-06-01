/**
 * Layouts — 현장 평면도 + 동선 데이터 모델
 *
 * Phase A: 연구실(room) 단위 캔버스. 벽/테이블/기기 객체를 자유롭게 배치.
 * Phase B 예정: 동선 (한붓 그리기) — 객체 순서로 통합큐/대시보드 정렬.
 * Phase C 예정: 정합성 검증 + 인접 실험실 자동 추천.
 *
 * 저장: Notion 설정 페이지의 settings.layouts 키.
 *   roomKey 는 'building||floor||room' (case-sensitive, 정확히 L)건물 등의 값)
 */

export type LayoutObjectType =
    | 'wall' | 'table' | 'asset'
    // Phase 3 P0: 안전·인프라 도면 필수 객체
    | 'door' | 'window' | 'exit'
    | 'outlet' | 'gas' | 'water' | 'aisle';

/** 객체 카테고리별 한글 라벨 (UI 표시용) */
export const OBJECT_TYPE_LABEL: Record<LayoutObjectType, string> = {
    wall: '벽',
    table: '테이블',
    asset: '자산',
    door: '문',
    window: '창문',
    exit: '비상구',
    outlet: '콘센트',
    gas: '가스',
    water: '물',
    aisle: '통로',
};

/** 카테고리별 이모지 (캔버스 표시용) */
export const OBJECT_TYPE_EMOJI: Record<LayoutObjectType, string> = {
    wall: '',
    table: '',
    asset: '',
    door: '🚪',
    window: '🪟',
    exit: '🚨',
    outlet: '🔌',
    gas: '🔥',
    water: '💧',
    aisle: '➡️',
};

export interface LayoutObject {
    id: string;
    type: LayoutObjectType;
    /** 캔버스 0~CANVAS_SIZE 가상 좌표 */
    x: number;
    y: number;
    width: number;
    height: number;
    /** 회전 (도). 0 / 90 / 180 / 270. 기본 0 */
    rotation?: number;
    /** asset 타입일 때 — Notion 자산 id */
    assetId?: string;
    /** 표시 라벨 — asset 이면 자산명, table/wall 이면 자유 라벨 */
    label?: string;
    /** 객체 색상 (테이블/벽) */
    color?: string;
}

export interface RoomLayout {
    canvasWidth: number;
    canvasHeight: number;
    objects: LayoutObject[];
    updatedAt: string;
    // Phase B 예정:
    // path?: { points: Array<{ x: number; y: number }> };  // 동선
}

export interface LayoutsStore {
    rooms: Record<string, RoomLayout>;
}

// 캔버스 기본 크기 (가상 좌표) — 비율 4:3
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 750;

export const roomKey = (building: string, floor: string, room: string): string => {
    return `${building}||${floor}||${room}`;
};

export const parseRoomKey = (key: string): { building: string; floor: string; room: string } => {
    const [building = '', floor = '', room = ''] = key.split('||');
    return { building, floor, room };
};

export const emptyLayout = (): RoomLayout => ({
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    objects: [],
    updatedAt: new Date().toISOString(),
});

export const ensureStore = (s: any): LayoutsStore => {
    if (s && typeof s === 'object' && s.rooms && typeof s.rooms === 'object') {
        return s as LayoutsStore;
    }
    return { rooms: {} };
};

// 객체 기본 사이즈
export const DEFAULT_SIZES: Record<LayoutObjectType, { width: number; height: number }> = {
    wall: { width: 200, height: 14 },
    table: { width: 160, height: 100 },
    asset: { width: 110, height: 70 },
    // Phase 3 신규
    door: { width: 70, height: 14 },
    window: { width: 100, height: 14 },
    exit: { width: 60, height: 60 },
    outlet: { width: 36, height: 36 },
    gas: { width: 40, height: 40 },
    water: { width: 40, height: 40 },
    aisle: { width: 160, height: 36 },
};

export const DEFAULT_COLORS: Record<LayoutObjectType, string> = {
    wall: '#475569',
    table: '#fbbf24',
    asset: '#6366f1',
    door: '#92400e',
    window: '#7dd3fc',
    exit: '#dc2626',
    outlet: '#1f2937',
    gas: '#f97316',
    water: '#0ea5e9',
    aisle: 'rgba(168, 162, 158, 0.35)',  // 반투명 회색 — 길 표시
};

export const makeObject = (
    type: LayoutObjectType,
    overrides: Partial<LayoutObject> = {},
): LayoutObject => {
    const size = DEFAULT_SIZES[type];
    // 캔버스 중앙에 작은 무작위 오프셋 — 연속 추가 시 겹침 방지
    const jitter = () => (Math.random() - 0.5) * 80;
    return {
        id: `obj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        x: CANVAS_WIDTH / 2 - size.width / 2 + jitter(),
        y: CANVAS_HEIGHT / 2 - size.height / 2 + jitter(),
        width: size.width,
        height: size.height,
        rotation: 0,
        color: DEFAULT_COLORS[type],
        ...overrides,
    };
};
