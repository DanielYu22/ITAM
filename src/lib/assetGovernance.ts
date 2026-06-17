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
  | 'backup-report'  // 분기백업 자동화 산출물(Final_Integrity_Report.csv): 백업 실제 PASS/FAIL
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
/**
 * 백업방식 5분류 (Daniel 연구소 운영 기준).
 *   1 실시간백업기기 — 실험기기PC가 로데이터를 계속 생성, 그 경로가 시놀로지 클라 폴더 (NAS)
 *   2 IT현장백업    — OS구형/네트워크X, 현장 로보카피 직접 (비NAS)
 *   3 USB사용자백업  — PC없는 실험기기, USB 직접 꽂아 제출 (비NAS)
 *   4 백업(Client)  — 네트워크+시놀로지 클라이언트 일반 (NAS)
 *   5 백업대상아님   — 제외
 *   NAS 사용 = {1, 4}. 1은 4와 외형 같아(로데이터 경로=시놀로지드라이브) 혼동되기 쉬움.
 */
export type BackupClass = 'realtime' | 'it-field' | 'usb-user' | 'client' | 'none' | 'unknown';
/** DB 실제 select 문자열이 표기 흔들려도(대소문/슬래시 등) 분류되도록 패턴 매칭. */
export const classifyBackup = (raw: string): BackupClass => {
  const v = String(raw || '').replace(/\s/g, '').toLowerCase();
  if (!v) return 'unknown';
  if (/대상아님|해당없음|제외/.test(v)) return 'none';
  if (/실시간/.test(v)) return 'realtime';
  if (/usb/.test(v)) return 'usb-user';
  if (/it.?현장|현장백업/.test(v)) return 'it-field';
  if (/백업\(?client|client백업|클라이언트/.test(v)) return 'client';
  return 'unknown';
};
/** NAS(시놀로지) 사용 방식 = 실시간(1) / 백업Client(4) */
export const NAS_BACKUP_CLASSES: BackupClass[] = ['realtime', 'client'];
/** 비NAS(오프라인) 방식 = IT현장(2) / USB사용자(3) */
export const OFFLINE_BACKUP_CLASSES: BackupClass[] = ['it-field', 'usb-user'];
/** 자산명이 실험기기 코드(CEQ/DEQ/AEQ/BEQ/EQ-)인가 — 1↔4 혼동 점검용 */
export const isLabEquipCode = (name: string): boolean => /\b[A-Z]?(CEQ|DEQ|AEQ|BEQ|EQ)-/i.test(String(name || ''));

/** 분기백업 자동화 ResultCode (Final_Integrity_Report.csv). PASS 만 정합성 통과. */
export const BACKUP_RESULT_CODES = ['PASS', 'FAIL_NO_NAS_FOLDER', 'FAIL_NO_CHECK_FILE', 'FAIL_MISMATCH'] as const;
/** 스케줄러 모드 ↔ 백업분류: STAT=실시간(1, synologydrive가 로데이터경로), COPY=백업Client(4, 원본→synologydrive 복사). */
export const SCHED_MODE_TO_CLASS: Record<string, BackupClass> = { STAT: 'realtime', COPY: 'client' };

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
  // 7시 로그 스케줄러 — PC에 설치(배포)했는지. C:\SynologyDrive 존재 시 매일 07시 로그를 남기도록 등록.
  { canonical: 'B)스케줄러설치', prefix: 'B', label: '07시 로그 스케줄러 설치 여부', source: 'field-survey', trust: 'authoritative' },
  // NAS 가동 신호 — NAS 서버에 "최신 07시 로그 파일"이 있으면 가동(=NAS설치+온라인)으로 당위 인정.
  { canonical: 'B)NAS가동', current: 'M)Synology Client 설치', prefix: 'B', label: 'NAS 가동(최신 07시 로그 확인)', source: 'nas-scheduler', trust: 'authoritative' },
  { canonical: 'B)백업방법', current: 'QA)백업 방법', prefix: 'B', label: '백업방법', source: 'derived', trust: 'authoritative',
    validate: v => classifyBackup(v) === 'unknown' ? '백업방법 미분류(실시간/IT현장백업/USB사용자백업/백업(Client)/백업대상아님 중 하나)' : null },
  // 분기백업 자동화 산출물 — 실제 백업 결과(권위). 데이터상(백업방법) vs 실제(이 값) 오차 검출용.
  { canonical: 'B)분기백업상태', current: 'M)분기백업 상태', prefix: 'B', label: '분기백업 정합성결과', source: 'backup-report', trust: 'authoritative', allowed: BACKUP_RESULT_CODES },
  { canonical: 'B)분기백업증빙', prefix: 'B', label: '백업증빙(온라인NAS/오프라인/없음)', source: 'backup-report', trust: 'authoritative' },
  // 스케줄러 모드 — 1↔4 의 결정적 구분(STAT=실시간, COPY=백업Client). schtasks 조회로 확인.
  { canonical: 'B)스케줄러모드', prefix: 'B', label: '스케줄러모드(STAT실시간/COPY백업Client)', source: 'field-survey', trust: 'authoritative' },
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
  const schedInstalled = read(values, fieldByCanonical('B)스케줄러설치')!);
  const nasActive = read(values, fieldByCanonical('B)NAS가동')!);
  const asmConn = read(values, fieldByCanonical('S)접속상태')!).toUpperCase();
  const site = read(values, fieldByCanonical('L)사이트')!);
  const building = read(values, fieldByCanonical('L)건물')!);
  const name = read(values, fieldByCanonical('Name')!);
  const bclass = classifyBackup(backup);
  const negatory = (v: string) => /미설치|없음|안\s*됨|미가동|미확인|불가|미배포|안\s*함|offline|false|^\s*(x|n|no)\s*$/i.test(v.trim());
  // 부정 표현('미설치' 등)이 '설치'를 substring 으로 포함하므로 negatory 우선 배제
  const truthy = (v: string) => !negatory(v) && /설치|가동|확인|있음|존재|online|true|완료|예|^\s*(o|y|yes)\s*$/i.test(v.trim());

  // R1) NAS 가동(최신 07시 로그 = 온라인) 기기는 비NAS 방식(IT현장·USB사용자) 또는 대상아님이면 모순(당위)
  const nasRunning = truthy(nasActive) || online === '온라인';
  if (nasRunning && (OFFLINE_BACKUP_CLASSES.includes(bclass) || bclass === 'none')) {
    out.push({ field: 'B)백업방법', level: 'integrity', message: `NAS 가동(온라인) 기기인데 백업방법이 '${backup}' — 모순(시놀로지 방식=실시간/백업Client 이어야 함)` });
  }
  // R1d) NAS 방식(실시간/백업Client) 인데 NAS 가동 신호 없음(스케줄러 미설치+07시 로그 없음) → 점검
  if (NAS_BACKUP_CLASSES.includes(bclass) && negatory(nasActive) && negatory(schedInstalled)) {
    out.push({ field: 'B)NAS가동', level: 'integrity', message: `백업방법이 '${backup}'(NAS 방식)인데 스케줄러·07시 로그 신호 없음 — 실제 백업 안 되는 중일 수 있음` });
  }
  // R1e) [1↔4 혼동] 실험기기 코드인데 백업(Client=4)로 분류 → 데이터 생성방식 따라 실시간(1)일 수 있음
  if (bclass === 'client' && isLabEquipCode(name)) {
    out.push({ field: 'B)백업방법', level: 'integrity', message: '실험기기인데 백업(Client) — 로데이터 계속 생성 타입이면 실시간(1)으로 지정돼야 함, 데이터 생성방식 확인' });
  }
  // R1b) NAS 가동(07시 로그 존재)인데 온라인구분이 온라인이 아니면 모순(당위: 가동=온라인)
  if (truthy(nasActive) && online && online !== '온라인') {
    out.push({ field: 'M)온라인구분', level: 'integrity', message: `NAS 최신 07시 로그 존재(가동)인데 온라인구분이 '${online}' — 당위상 '온라인'이어야 함` });
  }
  // R1c) 스케줄러는 설치됐는데 NAS 최신 07시 로그가 안 옴 → SynologyDrive 부재/네트워크 끊김 점검
  if (truthy(schedInstalled) && negatory(nasActive)) {
    out.push({ field: 'B)NAS가동', level: 'integrity', message: '스케줄러 설치됨인데 NAS 최신 07시 로그 없음 — C:\\SynologyDrive 부재/네트워크 끊김 점검' });
  }
  // R2) ASM 접속상태 ON ↔ 온라인구분: ON 인데 폐쇄망이면 점검(폐쇄망은 통상 ASM 미접속)
  if (asmConn === 'ON' && online === '폐쇄망') {
    out.push({ field: 'M)온라인구분', level: 'integrity', message: 'ASM 접속 ON 인데 폐쇄망으로 표기 — 재확인 필요' });
  }
  // R3) 사이트 ↔ 건물 일관성(건물이 있으면 사이트는 그 건물의 사이트여야 함; 여기선 둘 다 있는데 사이트 미정만 잡음)
  if (building && !site) {
    out.push({ field: 'L)사이트', level: 'integrity', message: '건물은 있는데 사이트 미정 — 용인/마곡/향남 확정 필요' });
  }

  // ── 분기백업 자동화(실제) ↔ 백업방법(데이터상) 오차 검출 ──
  const bkStatus = read(values, fieldByCanonical('B)분기백업상태')!).toUpperCase();
  const bkEvidence = read(values, fieldByCanonical('B)분기백업증빙')!);
  const schedMode = read(values, fieldByCanonical('B)스케줄러모드')!).toUpperCase();

  // R4) NAS 백업방식(실시간/Client)인데 분기백업 정합성 FAIL → 실제 백업 안 됨(데이터상≠실제)
  if (NAS_BACKUP_CLASSES.includes(bclass) && /^FAIL/.test(bkStatus)) {
    out.push({ field: 'B)분기백업상태', level: 'integrity', message: `백업방법 '${backup}'(NAS)인데 분기백업 ${bkStatus} — 실제로 백업 안 되는 중(데이터상≠실제)` });
  }
  // R5) 분기백업 증빙=온라인NAS(PASS) → NAS가동·온라인 당위. 온라인구분이 다르면 모순
  if (/온라인|nas/i.test(bkEvidence) && bkStatus === 'PASS' && online && online !== '온라인') {
    out.push({ field: 'M)온라인구분', level: 'integrity', message: `분기백업이 온라인NAS PASS인데 온라인구분이 '${online}' — 당위상 '온라인'` });
  }
  // R6) 스케줄러모드(실제)로 1↔4 확정 — 백업방법(데이터상)과 어긋나면 정정
  const modeClass = SCHED_MODE_TO_CLASS[schedMode];
  if (modeClass && bclass !== 'unknown' && modeClass !== bclass) {
    const want = modeClass === 'realtime' ? '실시간(1)' : '백업(Client)(4)';
    out.push({ field: 'B)백업방법', level: 'integrity', message: `스케줄러 ${schedMode} 모드 → 실제는 ${want} — 백업방법 '${backup}' 정정 필요` });
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

// ── 분기백업 자동화 출력(Final_Integrity_Report.csv) 판별 & 매핑 ──────────
/** 헤더로 분기백업 정합성 리포트인지 판별. */
export const isBackupIntegrityReport = (headers: string[]): boolean => {
  const h = headers.map(x => String(x).trim());
  return h.includes('DeviceName') && h.includes('FINAL_VERIFICATION') && h.includes('ResultCode') && h.includes('ManifestSource');
};
/** 리포트 한 행 → 권위 필드 값. ManifestSource→증빙(온라인NAS/오프라인/없음). */
export const mapBackupReportRow = (row: Record<string, any>): { Name: string; 'B)분기백업상태': string; 'B)분기백업증빙': string } => {
  const ms = String(row['ManifestSource'] ?? '').trim();
  const evidence = /online|nas/i.test(ms) ? '온라인NAS' : (ms && ms.toLowerCase() !== 'none' ? '오프라인' : '없음');
  return {
    Name: String(row['DeviceName'] ?? '').trim(),
    'B)분기백업상태': String(row['ResultCode'] ?? row['FINAL_VERIFICATION'] ?? '').trim(),
    'B)분기백업증빙': evidence,
  };
};
