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
    | 'outlet' | 'gas' | 'water' | 'aisle'
    // Phase 7 (A-2): 층 평면도용 — 실험실 타일(그 방 레이아웃 썸네일)
    | 'lab';

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
    lab: '실험실',
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
    lab: '🧪',
};

/** [A-2] 층 평면도 = roomKey 의 room 자리에 이 sentinel 을 쓴다. 객체는 'lab' 타입(실험실 타일). */
export const FLOOR_PLAN_ROOM = '(층 평면도)';

/** [A-2] 층 정렬 순서 — 지하(B*) → 저층 → 고층. "B2"<"B1"<"1F"<"2F"... */
export const floorOrder = (floor: string): number => {
    const f = String(floor || '').trim().toUpperCase();
    const bm = f.match(/^B\s*(\d+)/);          // 지하 Bn → 음수 (B2 < B1)
    if (bm) return -parseInt(bm[1], 10);
    const m = f.match(/(\d+)/);                // 1F, 2F → 양수
    return m ? parseInt(m[1], 10) : 99;
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
    /** Phase 6: 동선 방문 순서 (1부터). 미지정이면 없음. '순서' 모드에서 기기를 탭하면 부여 */
    order?: number;
    /** Phase 7 (A-2): lab 타입일 때 — 이 타일이 가리키는 연구실 이름(L)연구실). 썸네일·드릴다운 키 */
    roomName?: string;
}

/** Phase 5: 동선 (작업자가 한 점씩 찍어 만드는 폴리라인) */
export interface LayoutPath {
    id: string;
    points: Array<{ x: number; y: number }>;
    color?: string;
    label?: string;
    /** 두께 (선 width) */
    strokeWidth?: number;
}

export interface RoomLayout {
    canvasWidth: number;
    canvasHeight: number;
    objects: LayoutObject[];
    /** Phase 5: 동선 (여러 개 가능) */
    paths?: LayoutPath[];
    updatedAt: string;
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
    lab: { width: 230, height: 170 },  // 실험실 타일 — 썸네일이 들어가게 크게
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
    lab: '#eef2ff',  // 실험실 타일 배경(연보라)
};

/**
 * [리맵] 레이아웃 'asset' 객체의 assetId 를 현재(개인) DB 자산 id 로 재연결.
 *
 * 회사 DB → 개인 DB 이관 후 layout 의 assetId 는 옛 회사 id 라 현재 자산 id 와 불일치한다.
 * 같은 연구실의 자산 중 이름(label === titleField 값)이 일치하는 항목으로 assetId 를 갱신한다.
 * 순수 함수: 변경이 없으면 입력 layout 을 그대로 반환(참조 동일 → 불필요한 dirty 방지).
 */
export const remapLayoutAssetIds = (
    layout: RoomLayout,
    roomAssets: { id: string; values: Record<string, any> }[],
    titleField: string,
): { layout: RoomLayout; remapped: number } => {
    const liveIds = new Set(roomAssets.map(a => a.id));
    const byName = new Map<string, string>(); // 이름 → 현재 id
    for (const a of roomAssets) {
        const nm = String(a.values?.[titleField] ?? '').trim();
        if (nm && !byName.has(nm)) byName.set(nm, a.id);
    }
    let remapped = 0;
    const objects = layout.objects.map(o => {
        if (o.type !== 'asset') return o;
        if (o.assetId && liveIds.has(o.assetId)) return o; // 이미 현재 id
        const nm = String(o.label ?? '').trim();
        const live = nm ? byName.get(nm) : undefined;
        if (live && live !== o.assetId) {
            remapped++;
            return { ...o, assetId: live };
        }
        return o;
    });
    if (remapped === 0) return { layout, remapped: 0 };
    return { layout: { ...layout, objects }, remapped };
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
