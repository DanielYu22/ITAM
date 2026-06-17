/**
 * assetGovernance — NEXUS 자산 거버넌스 (권위값/유효성/정합성) 단일 소스
 * (2026-06-17, Daniel 통제 룰 기반. 기존 DB·UI 비침습 — 순수 스펙/검증 로직)
 *
 * 철학:
 *  - 권위값(authoritative): "눈으로 본 현장조사" 또는 "시스템이 출력한 값"만 인정.
 *  - 기존 입력값: 전부 참고용(reference, 신뢰도 낮음). 재서베이 전까지 DB 권위값 아님.
 *  - 컬럼 네이밍룰: 접두로 도메인 표기. L)위치 S)시스템 U)사용자/조직 M)보안관리 B)백업/NAS.
 *
 * 이 파일은 "규칙의 정의"다. 실제 검증/마이그레이션 UI 는 이 스펙을 import 해서 쓴다.
 */

// ── 권위값 출처 & 신뢰도 ───────────────────────────────────────────────
export type AuthSource =
  | 'field-survey'   // 현장조사(눈으로 확인): 위치레이아웃
  | 'asm-export'     // ASM Console 출력: Hostname/IP/OS/접속상태/정책/버전
  | 'master-file'    // 마스터파일(당위적): 소속센터/팀 → NAS계정/쉐어계정/패스워드
  | 'nas-scheduler'  // NAS 스케줄러 가동 확인(당위적): 온라인상태/백업방법 제약
  | 'v3-poc'         // V3 PoC 대상 여부(현장/정책)
  | 'derived'        // 위 권위값들로부터 파생/검증되는 값
  | 'legacy-ref';    // 기존 입력값 — 참고만, 권위 아님(신뢰도 낮음)

export type Trust = 'authoritative' | 'reference';

// ── 컬럼 네이밍룰 접두 ─────────────────────────────────────────────────
export type Prefix = 'L' | 'S' | 'U' | 'M' | 'B' | 'ID';
export const PREFIX_LABEL: Record<Prefix, string> = {
  ID: '식별자', L: '위치(Location)', S: '시스템출력(System)',
  U: '사용자·조직(User)', M: '보안관리(Mgmt)', B: '백업/NAS(Backup)',
};

// ── 고정 도메인(유효성 enum) ───────────────────────────────────────────
/** M)온라인구분 — 정확히 이 3종만. '오프라인'은 존재하지 않음. 빈값=필수확인 위반. */
export const ONLINE_KINDS = ['온라인', '폐쇄망', '알약대상아님'] as const;
/** 사이트 — 반드시 하나. '기타'/빈값 불허. */
export const SITES = ['용인', '마곡', '향남'] as const;
/** 백업방법 — NAS 가동(온라인) 기기엔 아래 두 값이 오면 정합성 위반. */
export const OFFLINE_BACKUP_METHODS = ['IT현장백업', 'USB불출'] as const;

// ── 필드 레지스트리 ────────────────────────────────────────────────────
export interface GovField {
  /** 현재 Notion 컬럼명(있으면) */ current?: string;
  /** 권위 스키마 권장 컬럼명 */ canonical: string;
  prefix: Prefix;
  label: string;
  source: AuthSource;
  trust: Trust;
  required?: boolean;                 // 비면 '필수값 누락'
  allowed?: readonly string[];        // 허용값(enum)
  /** 형식 검증 — 위반 메시지 반환, OK 면 null */
  validate?: (raw: string) => string | null;
}

const ipOk = (v: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v.trim());

export const GOV_FIELDS: GovField[] = [
  { canonical: 'Name', current: 'Name', prefix: 'ID', label: '기기코드', source: 'field-survey', trust: 'authoritative', required: true },
  // 위치 — 현장조사 권위
  { canonical: 'L)건물', current: 'L)건물', prefix: 'L', label: '건물', source: 'field-survey', trust: 'authoritative', required: true },
  { canonical: 'L)층', current: 'L)층', prefix: 'L', label: '층', source: 'field-survey', trust: 'authoritative', required: true },
  { canonical: 'L)연구실', current: 'L)연구실', prefix: 'L', label: '연구실', source: 'field-survey', trust: 'authoritative', required: true },
  { canonical: 'L)사이트', current: '사이트', prefix: 'L', label: '사이트', source: 'derived', trust: 'authoritative', required: true, allowed: SITES,
    validate: v => (v && !SITES.includes(v.trim() as any)) ? `사이트는 ${SITES.join('/')} 중 하나여야 함('기타'·빈값 불허)` : null },
  // 시스템 출력 — ASM Console 권위 (단 IP 는 export 시점값=추정 성격)
  { canonical: 'S)Hostname', current: 'PC Hostname', prefix: 'S', label: '컴퓨터 이름', source: 'asm-export', trust: 'authoritative' },
  { canonical: 'S)IP', current: 'QA)기기 IP', prefix: 'S', label: 'IP(시점값)', source: 'asm-export', trust: 'authoritative',
    validate: v => (v && !ipOk(v)) ? 'IPv4 형식 아님' : null },
  { canonical: 'S)OS', current: 'OS type', prefix: 'S', label: 'OS', source: 'asm-export', trust: 'authoritative' },
  { canonical: 'S)접속상태', prefix: 'S', label: 'ASM 접속상태(ON/OFF)', source: 'asm-export', trust: 'authoritative' },
  { canonical: 'S)정책명', prefix: 'S', label: '알약 정책명', source: 'asm-export', trust: 'authoritative' },
  { canonical: 'S)최근접속', prefix: 'S', label: '최근 접속 일시', source: 'asm-export', trust: 'authoritative' },
  // 사용자·조직 — 마스터파일 당위적 권위
  { canonical: 'U)소속센터', current: 'User)소속 센터', prefix: 'U', label: '소속센터', source: 'master-file', trust: 'authoritative' },
  { canonical: 'U)소속팀', current: 'User)소속팀', prefix: 'U', label: '소속팀', source: 'master-file', trust: 'authoritative' },
  { canonical: 'U)기기관리자', current: 'User)기기관리자', prefix: 'U', label: '기기관리자', source: 'master-file', trust: 'authoritative', required: true },
  // 보안관리 — 알약/ASM
  { canonical: 'M)온라인구분', current: 'M)알약 온라인구분', prefix: 'M', label: '알약 온라인구분', source: 'derived', trust: 'authoritative', required: true, allowed: ONLINE_KINDS,
    validate: v => {
      const t = v.trim();
      if (!t) return null; // 빈값은 required 로 별도 처리
      if (t === '오프라인') return "'오프라인'은 허용되지 않음 — 온라인/폐쇄망/알약대상아님 중 하나";
      if (!ONLINE_KINDS.includes(t as any)) return `온라인구분은 ${ONLINE_KINDS.join('/')} 중 하나`;
      return null;
    } },
  { canonical: 'M)V3PoC대상', prefix: 'M', label: 'V3 PoC 대상 PC', source: 'v3-poc', trust: 'authoritative' },
  // 백업/NAS — 현장+스케줄러 권위
  { canonical: 'B)NAS클라이언트', current: 'M)Synology Client 설치', prefix: 'B', label: 'NAS클라이언트 설치(스케줄러 가동 확인)', source: 'nas-scheduler', trust: 'authoritative' },
  { canonical: 'B)백업방법', current: 'QA)백업 방법', prefix: 'B', label: '백업방법', source: 'derived', trust: 'authoritative' },
];

export const fieldByCanonical = (k: string) => GOV_FIELDS.find(f => f.canonical === k);
/** 현재 컬럼명 → 권위 필드 (마이그레이션 매핑) */
export const fieldByCurrent = (k: string) => GOV_FIELDS.find(f => f.current === k);

// ── 값 읽기(현재/권위 컬럼명 모두 시도) ───────────────────────────────
const read = (values: Record<string, any>, f: GovField): string => {
  const v = values[f.canonical] ?? (f.current ? values[f.current] : undefined);
  return v == null ? '' : String(v).trim();
};

export interface Violation {
  field: string;
  level: 'required' | 'validity' | 'integrity';
  message: string;
}

/** 유효성(필수+형식+enum) 검사 */
export const validateValidity = (values: Record<string, any>): Violation[] => {
  const out: Violation[] = [];
  for (const f of GOV_FIELDS) {
    const v = read(values, f);
    if (f.required && !v) { out.push({ field: f.canonical, level: 'required', message: `${f.label} 필수값 누락` }); continue; }
    if (v && f.validate) { const e = f.validate(v); if (e) out.push({ field: f.canonical, level: 'validity', message: e }); }
    if (v && f.allowed && !f.allowed.includes(v) && !f.validate) {
      out.push({ field: f.canonical, level: 'validity', message: `${f.label}: 허용값 아님(${f.allowed.join('/')})` });
    }
  }
  return out;
};

/** 정합성(교차 필드) 검사 — Daniel 룰 기반 */
export const validateIntegrity = (values: Record<string, any>): Violation[] => {
  const out: Violation[] = [];
  const online = read(values, fieldByCanonical('M)온라인구분')!);
  const backup = read(values, fieldByCanonical('B)백업방법')!);
  const nasClient = read(values, fieldByCanonical('B)NAS클라이언트')!);
  const asmConn = read(values, fieldByCanonical('S)접속상태')!).toUpperCase();
  const site = read(values, fieldByCanonical('L)사이트')!);
  const building = read(values, fieldByCanonical('L)건물')!);

  // R1) NAS 스케줄러 가동(설치됨/온라인) 기기는 백업방법이 IT현장백업·USB불출이면 안 됨
  const nasRunning = /설치|가동|확인|있음|online|y(es)?|true|o/i.test(nasClient) || online === '온라인';
  if (nasRunning && OFFLINE_BACKUP_METHODS.includes(backup as any)) {
    out.push({ field: 'B)백업방법', level: 'integrity', message: `NAS 가동(온라인) 기기인데 백업방법이 '${backup}' — 모순(현장백업/USB불출 불가)` });
  }
  // R2) ASM 접속상태 ON ↔ 온라인구분: ON 인데 폐쇄망이면 점검(폐쇄망은 통상 ASM 미접속)
  if (asmConn === 'ON' && online === '폐쇄망') {
    out.push({ field: 'M)온라인구분', level: 'integrity', message: 'ASM 접속 ON 인데 폐쇄망으로 표기 — 재확인 필요' });
  }
  // R3) 사이트 ↔ 건물 일관성(건물이 있으면 사이트는 그 건물의 사이트여야 함; 여기선 둘 다 있는데 사이트 미정만 잡음)
  if (building && !site) {
    out.push({ field: 'L)사이트', level: 'integrity', message: '건물은 있는데 사이트 미정 — 용인/마곡/향남 확정 필요' });
  }
  return out;
};

export const validateAsset = (values: Record<string, any>): Violation[] =>
  [...validateValidity(values), ...validateIntegrity(values)];

// ── ASM Console 출력 판별 & 매핑 (파일명 아님, 헤더 구조로) ─────────────
export type AsmExportKind = 'asm-asset' | 'asm-policy-push' | null;

/** 헤더 배열로 어떤 ASM 출력인지 판별. */
export const detectAsmExport = (headers: string[]): AsmExportKind => {
  const h = headers.map(x => String(x).trim());
  const has = (k: string) => h.includes(k);
  // 자산/사용자 정보(미등록·용인사용자정보 동형): 컴퓨터 이름+접속 상태+정책명+통합에이전트 버전
  if (has('컴퓨터 이름') && has('접속 상태') && has('정책명') && has('통합에이전트 버전')) return 'asm-asset';
  // 정책 푸시 결과: 사용자명+부서명+성공+작업 그룹+IP (5컬럼, '성공' 헤더)
  if (has('사용자명') && has('부서명') && has('성공') && has('IP') && h.length <= 7) return 'asm-policy-push';
  return null;
};

/** ASM 출력 헤더명 → 권위 필드(canonical). 매핑 안 되는 건 참고용. */
export const ASM_HEADER_MAP: Record<string, string> = {
  '컴퓨터 이름': 'S)Hostname',
  'IP': 'S)IP',
  'Connected IP': 'S)IP',
  '접속 상태': 'S)접속상태',
  'OS': 'S)OS',
  '정책명': 'S)정책명',
  '최근 접속 일시': 'S)최근접속',
  // 사용자명: 등록분은 기기코드(=Name) — 단 '미등록'/'0'/sec/sa 등은 식별 불가(참고)
  '사용자명': 'Name',
};

/** 부서명 문자열에서 사이트·카테고리·비트 추출. 예: "대웅/대웅제약;대웅제약;용인연구소 실험기기;64bit;" */
export const parseDeptString = (dept: string): { site?: string; category?: string; bit?: string } => {
  const s = String(dept || '');
  const site = SITES.find(x => s.includes(x));
  const bit = (s.match(/(\d{2})\s*bit/i) || [])[1];
  const category = /실험기기/.test(s) ? '실험기기' : undefined;
  return { site: site ? site : undefined, category, bit: bit ? `${bit}bit` : undefined };
};
