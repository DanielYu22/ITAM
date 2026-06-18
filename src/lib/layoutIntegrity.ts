/**
 * layoutIntegrity — 레이아웃 ↔ 데이터(자산 할당) 공간 무결성 검사 (2026-06-18)
 *   자산 값 거버넌스(assetGovernance)와 별개 차원: "그려둔 레이아웃"과 "실제 할당"의 어긋남.
 *
 * 검출:
 *  - ghost        : 레이아웃에 배치됐는데 그 방에 더는 할당된 자산이 없음(이동/제거)
 *  - missing      : 방에 할당됐는데 레이아웃에 안 그려짐(신규 추가)
 *  - order-partial: 동선 순서를 일부 기기만 지정(중간에 하나 추가/빼면 발생)
 *  - order-gap    : 동선 순서 번호에 구멍/중복
 *
 * 매칭: 레이아웃 asset 객체는 assetId 가 이관 전 회사 id 라 불일치 → 기기명(label)으로 매칭.
 */
import { type LayoutsStore, parseRoomKey, FLOOR_PLAN_ROOM } from './layouts';

type V = Record<string, any>;
const tx = (v: any) => (v == null ? '' : String(v).trim());

export type LayoutIssueKind = 'ghost' | 'missing' | 'order-partial' | 'order-gap';
export interface LayoutIssue {
  roomKey: string;
  building: string;
  floor: string;
  room: string;
  kind: LayoutIssueKind;
  count: number;
  message: string;
}

export const checkLayoutIntegrity = (
  assets: { values: V }[],
  layoutsStore: LayoutsStore | undefined,
  titleField: string,
): LayoutIssue[] => {
  // 방별 할당 기기명 집합 (L)건물|층|연구실 → names)
  const assignedByRoom = new Map<string, Set<string>>();
  for (const a of assets) {
    const v = a.values;
    const b = tx(v['L)건물']), f = tx(v['L)층']), r = tx(v['L)연구실']);
    if (!b || !f || !r) continue;
    const name = tx(v[titleField]);
    if (!name) continue;
    const k = `${b}||${f}||${r}`;
    (assignedByRoom.get(k) ?? assignedByRoom.set(k, new Set()).get(k)!).add(name);
  }

  const issues: LayoutIssue[] = [];
  const rooms = layoutsStore?.rooms ?? {};
  for (const [k, layout] of Object.entries(rooms)) {
    const { building, floor, room } = parseRoomKey(k);
    if (room === FLOOR_PLAN_ROOM) continue; // 층 평면도(실험실 타일)는 기기 레이아웃 아님
    const placed = (layout.objects ?? []).filter(o => o.type === 'asset');
    if (placed.length === 0) continue; // 빈/미편집 레이아웃은 대상 아님

    const placedNames = placed.map(o => tx(o.label)).filter(Boolean);
    const placedSet = new Set(placedNames);
    const assigned = assignedByRoom.get(k) ?? new Set<string>();
    const base = { roomKey: k, building, floor, room };

    // ghost: 배치됐는데 할당 없음
    const ghost = placedNames.filter(n => !assigned.has(n));
    if (ghost.length) issues.push({ ...base, kind: 'ghost', count: ghost.length, message: `배치됐지만 미할당 ${ghost.length}대(이동/제거?): ${ghost.slice(0, 3).join(', ')}${ghost.length > 3 ? '…' : ''}` });

    // missing: 할당됐는데 미배치
    const missing = [...assigned].filter(n => !placedSet.has(n));
    if (missing.length) issues.push({ ...base, kind: 'missing', count: missing.length, message: `할당됐지만 레이아웃 누락 ${missing.length}대: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}` });

    // 동선 순서
    const orders = placed.map(o => o.order).filter((x): x is number => typeof x === 'number');
    if (orders.length > 0 && orders.length < placed.length) {
      issues.push({ ...base, kind: 'order-partial', count: placed.length - orders.length, message: `동선 일부만 지정(${orders.length}/${placed.length}) — 미지정 ${placed.length - orders.length}대` });
    } else if (orders.length > 1) {
      const sorted = [...orders].sort((a, b) => a - b);
      const dup = new Set(sorted).size !== sorted.length;
      const gap = sorted.some((v, i) => i > 0 && v !== sorted[i - 1] + 1);
      if (dup || gap) issues.push({ ...base, kind: 'order-gap', count: 1, message: `동선 순서 ${dup ? '중복' : '구멍'}(${sorted.join('·')}) — 재정렬 필요` });
    }
  }
  return issues;
};

/** 방 단위 요약(한 방에 여러 이슈면 합침) — 홈 표시용 */
export interface RoomIntegrity { roomKey: string; building: string; floor: string; room: string; messages: string[] }
export const groupByRoom = (issues: LayoutIssue[]): RoomIntegrity[] => {
  const m = new Map<string, RoomIntegrity>();
  for (const i of issues) {
    const e = m.get(i.roomKey) ?? { roomKey: i.roomKey, building: i.building, floor: i.floor, room: i.room, messages: [] };
    e.messages.push(i.message);
    m.set(i.roomKey, e);
  }
  return [...m.values()];
};
