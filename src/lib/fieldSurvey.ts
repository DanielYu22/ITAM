/**
 * fieldSurvey — 현장 서베이 모드 로직 (2026-06-17)
 *   "현장 도착 → 어디로(동선 순서) → 무엇을(권위 필드) → 유효성 강제 입력".
 *   기존값은 참고(reference)로 보여주고, 현장에서 권위값을 검증 입력한다.
 *
 *   순수 로직만(UI 없음). 쓰기 대상 컬럼이 실제 schema 에 있는 것만 노출하도록
 *   surveyFieldsFor(asset, schema) 에서 schema 필터.
 */
import { ONLINE_KINDS, SITES, classifyBackup } from './assetGovernance';
import { type LayoutsStore, roomKey, floorOrder } from './layouts';

type V = Record<string, any>;
const g = (v: V, ...keys: string[]): string => {
  for (const k of keys) { const x = v[k]; if (x != null && String(x).trim()) return String(x).trim(); }
  return '';
};
const ipOk = (v: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v.trim());

export interface SurveyFieldDef {
  /** 쓰기 대상 Notion 컬럼명(실제 존재해야 함) */ col: string;
  label: string;
  input: 'enum' | 'yesno' | 'ip' | 'text';
  options?: string[];               // enum 옵션
  /** 위반 메시지 반환, OK 면 null */ validate?: (v: string) => string | null;
  hint?: string;
}

/** 현장에서 사람이 확인·입력하는 권위 필드 정의 (시스템 출력값 제외 — 그건 임포트로). */
export const SURVEY_FIELD_DEFS: SurveyFieldDef[] = [
  { col: 'L)건물', label: '건물', input: 'text', hint: '실제 위치(눈으로)' },
  { col: 'L)층', label: '층', input: 'text' },
  { col: 'L)연구실', label: '연구실', input: 'text' },
  { col: '사이트', label: '사이트', input: 'enum', options: [...SITES],
    validate: v => v && !SITES.includes(v as any) ? `${SITES.join('/')} 중 하나` : null },
  { col: 'M)알약 온라인구분', label: '알약 온라인구분', input: 'enum', options: [...ONLINE_KINDS],
    validate: v => v === '오프라인' ? "'오프라인' 불가" : (v && !ONLINE_KINDS.includes(v as any) ? `${ONLINE_KINDS.join('/')} 중 하나` : null) },
  { col: 'QA)백업 방법', label: '백업방법', input: 'enum',
    options: ['실시간백업기기', 'IT현장백업', 'USB사용자백업', '백업(client)', '백업대상아님'],
    validate: v => v && classifyBackup(v) === 'unknown' ? '5분류 중 하나' : null },
  { col: 'B)스케줄러설치', label: '7시 로그 스케줄러 설치', input: 'yesno', hint: '신규 컬럼 — 생성 후 노출' },
  { col: 'B)스케줄러모드', label: '스케줄러모드', input: 'enum', options: ['STAT', 'COPY'], hint: 'STAT=실시간/COPY=백업Client (신규 컬럼)' },
  { col: 'V3 POC', label: 'V3 PoC 대상', input: 'yesno' },
  { col: 'User)기기관리자', label: '기기관리자', input: 'text' },
  { col: 'M)알약 현장조치', label: '알약 현장조치', input: 'text', hint: '폐쇄망 등 현장 조치 메모' },
];

export interface SurveyFieldState extends SurveyFieldDef { current: string; pending: boolean; error: string | null; }

/** 한 자산의 서베이 필드 상태 — schema 에 있는 컬럼만. pending = 비었거나 위반. */
export const surveyFieldsFor = (values: V, schema: string[]): SurveyFieldState[] => {
  const set = new Set(schema);
  return SURVEY_FIELD_DEFS.filter(d => set.has(d.col)).map(d => {
    const current = g(values, d.col);
    let error: string | null = null;
    if (current && d.validate) error = d.validate(current);
    if (current && d.input === 'ip' && !ipOk(current)) error = 'IPv4 형식 아님';
    return { ...d, current, error, pending: !current || !!error };
  });
};

export interface SurveyDevice { id: string; name: string; pending: number; total: number; }
export interface SurveyStop {
  key: string; site: string; building: string; floor: string; room: string;
  order: number; devices: SurveyDevice[]; pending: number;
}

/**
 * 동선 워크플랜 — site→건물→층(floorOrder)→연구실, 방 안은 레이아웃 동선 순서(label 매칭).
 * 미확인(pending) 있는 정거장만, 미확인 많은 순서로 정렬해 "어디부터" 안내.
 */
export const buildSurveyPlan = (
  assets: { id: string; values: V }[],
  schema: string[],
  titleField: string,
  layouts?: LayoutsStore,
  siteOf?: (a: { values: V }) => string,
): SurveyStop[] => {
  const stops = new Map<string, SurveyStop>();
  for (const a of assets) {
    const v = a.values;
    const building = g(v, 'L)건물') || '(건물미정)';
    const floor = g(v, 'L)층') || '(층미정)';
    const room = g(v, 'L)연구실') || '(연구실미정)';
    const site = siteOf ? siteOf(a) : (g(v, '사이트') || '');
    const key = `${site}|${building}|${floor}|${room}`;
    const fields = surveyFieldsFor(v, schema);
    const pending = fields.filter(f => f.pending).length;
    const dev: SurveyDevice = { id: a.id, name: g(v, titleField) || '(이름없음)', pending, total: fields.length };
    if (!stops.has(key)) stops.set(key, { key, site, building, floor, room, order: 0, devices: [], pending: 0 });
    const s = stops.get(key)!;
    s.devices.push(dev);
    s.pending += pending;
  }
  // 방 안 동선 순서 — 레이아웃 객체 order 를 label(기기명)로 매칭
  for (const s of stops.values()) {
    const rl = layouts?.rooms?.[roomKey(s.building, s.floor, s.room)];
    const orderMap: Record<string, number> = {};
    if (rl) for (const o of rl.objects || []) {
      const nm = String((o as any).label ?? '').trim();
      if (nm && typeof (o as any).order === 'number') orderMap[nm] = (o as any).order;
    }
    s.devices.sort((a, b) => {
      const oa = orderMap[a.name]; const ob = orderMap[b.name];
      if (oa != null && ob != null) return oa - ob;
      if (oa != null) return -1; if (ob != null) return 1;
      return a.name.localeCompare(b.name, 'ko', { numeric: true });
    });
  }
  // 정거장 정렬: 사이트 → 건물 → 층(floorOrder) → 연구실. 미확인 0인 정거장은 뒤로.
  const arr = [...stops.values()];
  arr.sort((a, b) =>
    (a.pending === 0 ? 1 : 0) - (b.pending === 0 ? 1 : 0)
    || a.site.localeCompare(b.site, 'ko')
    || a.building.localeCompare(b.building, 'ko', { numeric: true })
    || floorOrder(a.floor) - floorOrder(b.floor)
    || a.room.localeCompare(b.room, 'ko', { numeric: true }),
  );
  arr.forEach((s, i) => { s.order = i + 1; });
  return arr;
};
