/**
 * Source Imports — 소스 엑셀을 직접 업로드해서 Notion DB를 자동 업데이트
 *
 * 3종 소스를 지원합니다:
 * 1. 알약 ASM 푸시 결과 (월 1회) — 성공/실패 동기화
 * 2. 알약 유저정보 (수시) — 온라인 상태/호스트네임/OS/IP 동기화
 * 3. 알약 미등록 사용자 (수시) — 용인 추정 후보 추출
 *
 * 소스 추가/수정은 이 파일 하나만 고치면 됩니다.
 */

import * as XLSX from 'xlsx';
import { Asset } from './notion';

export type SourceId =
    | 'notion-export-reimport'
    | 'ahnlab-push-result'
    | 'ahnlab-user-info'
    | 'ahnlab-unregistered';

// 한 행에서 어떤 Notion 필드를 어떤 값으로 업데이트할지
export interface FieldUpdate {
    field: string;          // Notion 컬럼명
    value: string;          // 변환 후 값
}

// 소스 정의
export interface SourceDef {
    id: SourceId;
    name: string;
    emoji: string;
    description: string;
    sampleFilename: string;

    // 헤더 컬럼 집합으로 소스 자동 감지
    detect: (headers: string[]) => boolean;

    // 매칭키: 소스 엑셀에서 이 컬럼 값으로 Notion의 Name과 매칭
    matchExcelColumn: string;

    // 한 행을 받아 Notion 필드 업데이트 목록을 반환
    rowToUpdates: (row: Record<string, any>) => FieldUpdate[];

    // 매칭 안 되는 행을 어떻게 처리할지
    // 'skip': 무시 (기본). 'candidate': 후보로 표시 (미등록 사용자용)
    unmatchedBehavior: 'skip' | 'candidate';

    // 처리이력에 한 줄 prepend할 라벨 (소스에 따라 다름)
    historyLabel: (row: Record<string, any>) => string;
}

// ============================================================================
// 헬퍼 변환 함수
// ============================================================================

/** "Windows 10 Pro 22H2" → "Windows 10". Notion OS type 값 분포에 맞춤. */
export const normalizeOs = (raw: string): string => {
    if (!raw) return '';
    const s = String(raw).trim();
    const m = s.match(/Windows\s*(11|10|8\.1|8|7|XP|Vista|Server\s*\d+)/i);
    if (m) {
        // "Windows 8.1" → "Windows 8" (현재 Notion 분포에 따름)
        const ver = m[1].replace('.1', '').trim();
        return `Windows ${ver}`;
    }
    if (/mac/i.test(s)) return 'macOS';
    if (/linux|ubuntu/i.test(s)) return 'Linux';
    return s; // 원본 유지
};

/** "성공" / "실패" / 빈값 → Notion M)ASM Push 옵션 */
export const normalizePushResult = (raw: string): string => {
    if (!raw) return '';
    const s = String(raw).trim();
    if (s.includes('성공')) return '성공';
    if (s.includes('실패')) return '실패';
    return s;
};

/** "ON" / "OFF" → 알약 온라인구분.
 *  ASM에 등록된 기기 중 OFF는 "오프라인", ON은 "온라인"으로 매핑.
 *  폐쇄망(스탠드얼론)은 ASM에 안 잡히므로 별개 처리.
 */
export const normalizeOnlineStatus = (raw: string): string => {
    if (!raw) return '';
    const s = String(raw).trim().toUpperCase();
    if (s === 'ON') return '온라인';
    if (s === 'OFF') return '오프라인';
    return raw;
};

// ============================================================================
// 용인 IP 화이트리스트
// ============================================================================
//
// 사용자 확인 결과 (2026-05-28):
// - 10.5.x.x 전체가 용인 실험기기 주력 대역
// - 192.168.x.x 일부도 폐쇄망 실험기기에서 사용 (정확한 서브넷은 차차 좁힐 수 있음)
// - Hostname/사용자명 패턴(AEQ-/DEQ- 등)은 향남·마곡에서도 쓰이므로 판단 기준에서 제외
//
// 패턴은 단순 prefix 매칭(startsWith)으로 처리해 빠름.

export const YONGIN_IP_PREFIXES: string[] = [
    '10.5.',     // 사내망 용인 (주력)
    '192.168.',  // 평광망 일부 (실험기기) — 향후 좁힐 수 있음
];

/** IP가 용인 실험기기로 추정되는 대역인지 */
export const isYonginIp = (ip: string): boolean => {
    if (!ip) return false;
    const s = String(ip).trim();
    return YONGIN_IP_PREFIXES.some(p => s.startsWith(p));
};

// ============================================================================
// 소스 정의들
// ============================================================================

// 임포트에서 제외할 필드 (Notion export 재임포트 등에서)
const RESERVED_FIELDS = new Set<string>([
    'Name',          // 매칭키라 업데이트 대상 아님
    '처리이력',       // 누적 이력은 임포트로 덮어쓰지 않음
]);

export const SOURCES: SourceDef[] = [
    // ------------------------------------------------------------------------
    // 0. Notion DB Export 재임포트
    //    사용자가 export 받은 CSV/XLSX를 수정해서 다시 적용.
    //    헤더에 Name 컬럼이 있고 알약 소스의 표식(사용자명)이 없으면 매칭.
    //    Name과 처리이력 제외한 모든 컬럼을 그대로 매핑.
    //    안전을 위해 빈 값은 스킵 — 의도치 않은 값 삭제 방지.
    // ------------------------------------------------------------------------
    {
        id: 'notion-export-reimport',
        name: 'Notion DB Export 재임포트',
        emoji: '📥',
        description: '익스포트한 CSV/XLSX를 수정 후 다시 적용',
        sampleFilename: 'export_YYYY-MM-DD.csv',
        detect: (headers) => {
            const set = new Set(headers.map(h => String(h).trim()));
            // Notion export 의 특징: 'Name' 컬럼 존재 + 알약 엑셀 시그니처(사용자명) 부재
            return set.has('Name') && !set.has('사용자명');
        },
        matchExcelColumn: 'Name',
        rowToUpdates: (row) => {
            // 빈 값도 포함해서 반환. 빈 값을 실제 적용할지는 buildImportPlan 의
            // allowBlankClear 옵션 + 모달의 '빈 셀로 값 삭제' 토글로 제어.
            const updates: FieldUpdate[] = [];
            for (const [key, raw] of Object.entries(row)) {
                if (!key) continue;
                if (RESERVED_FIELDS.has(key)) continue;
                if (raw === undefined || raw === null) continue;
                const value = String(raw).trim();
                updates.push({ field: key, value });
            }
            return updates;
        },
        unmatchedBehavior: 'skip',
        historyLabel: () => 'Notion DB export 재임포트',
    },

    // ------------------------------------------------------------------------
    // 1. 알약 ASM 푸시 결과
    //    헤더: 사용자명, 부서명, 성공, 작업 그룹, IP, ...
    // ------------------------------------------------------------------------
    {
        id: 'ahnlab-push-result',
        name: '알약 ASM 푸시 결과',
        emoji: '📤',
        description: '월간 원격 업데이트 푸시 성공/실패 결과 동기화',
        sampleFilename: '용인알약원격업데이트결과.xlsx',
        detect: (headers) => {
            const set = new Set(headers.map(h => String(h).trim()));
            return set.has('사용자명') && set.has('성공') && !set.has('접속 상태');
        },
        matchExcelColumn: '사용자명',
        rowToUpdates: (row) => {
            const updates: FieldUpdate[] = [];
            const pushResult = normalizePushResult(row['성공'] ?? '');
            if (pushResult) {
                updates.push({ field: 'M)ASM Push', value: pushResult });
            }
            const ip = String(row['IP'] ?? '').trim();
            if (ip) {
                updates.push({ field: 'QA)네트워크 IP', value: ip });
            }
            return updates;
        },
        unmatchedBehavior: 'skip',
        historyLabel: (row) => {
            const result = normalizePushResult(row['성공'] ?? '');
            return `ASM 푸시 결과 임포트: ${result || '미상'}`;
        },
    },

    // ------------------------------------------------------------------------
    // 2. 알약 유저정보 (등록된 사용자 전체)
    //    헤더: 사용자명, 부서명, 사원번호, 컴퓨터이름, 작업그룹, IP,
    //         Connected IP, 접속 상태, 정책명, OS, 통합에이전트버전, 알약버전, ...
    // ------------------------------------------------------------------------
    {
        id: 'ahnlab-user-info',
        name: '알약 유저정보',
        emoji: '👥',
        description: '온라인 상태/호스트네임/OS/IP 일괄 동기화',
        sampleFilename: '용인알약유저정보출력.xlsx',
        detect: (headers) => {
            const set = new Set(headers.map(h => String(h).trim()));
            return set.has('사용자명') && set.has('접속 상태') && set.has('OS');
        },
        matchExcelColumn: '사용자명',
        rowToUpdates: (row) => {
            const updates: FieldUpdate[] = [];
            const online = normalizeOnlineStatus(row['접속 상태'] ?? '');
            // ASM에 잡힌 폐쇄망(=콘솔에 등록되었지만 폐쇄망 정책) 기기는 그대로 폐쇄망으로 둬야 하므로
            // 기존 값이 "폐쇄망" 또는 "알약대상아님"이면 덮어쓰지 않도록 후처리는 임포트 모달에서 처리.
            if (online) {
                updates.push({ field: 'M)알약 온라인구분', value: online });
            }
            const hostname = String(row['컴퓨터 이름'] ?? '').trim();
            if (hostname) {
                updates.push({ field: 'PC Hostname', value: hostname });
            }
            const os = normalizeOs(row['OS'] ?? '');
            if (os) {
                updates.push({ field: 'OS type', value: os });
            }
            const ip = String(row['IP'] ?? '').trim();
            if (ip) {
                updates.push({ field: 'QA)네트워크 IP', value: ip });
            }
            return updates;
        },
        unmatchedBehavior: 'skip',
        historyLabel: () => '알약 유저정보 임포트',
    },

    // ------------------------------------------------------------------------
    // 3. 알약 미등록 사용자 (용인 추정 후보)
    //    부서명=미등록인 기기들. Notion에 없는 행은 후보로 표시.
    // ------------------------------------------------------------------------
    {
        id: 'ahnlab-unregistered',
        name: '알약 미등록 사용자 (용인 추정)',
        emoji: '❓',
        description: '용인 추정 후보 추출 (수동 확인 필요)',
        sampleFilename: '용인알약미등록사용자정보출력.xlsx',
        detect: (headers) => {
            const set = new Set(headers.map(h => String(h).trim()));
            // 유저정보와 같은 헤더 구조라서 부서명 값으로도 구분해야 하지만,
            // 헤더만으로는 구분 못 하므로 모달에서 사용자 선택으로 분기 가능하게 함.
            // 자동 감지가 같다면 유저정보가 우선.
            return set.has('사용자명') && set.has('접속 상태') && set.has('컴퓨터 이름');
        },
        matchExcelColumn: '사용자명',
        rowToUpdates: (row) => {
            // 등록된 기기와 동일한 매핑 (PC Hostname, OS, IP 등)
            const updates: FieldUpdate[] = [];
            const hostname = String(row['컴퓨터 이름'] ?? '').trim();
            if (hostname) updates.push({ field: 'PC Hostname', value: hostname });
            const os = normalizeOs(row['OS'] ?? '');
            if (os) updates.push({ field: 'OS type', value: os });
            const ip = String(row['IP'] ?? '').trim();
            if (ip) updates.push({ field: 'QA)네트워크 IP', value: ip });
            return updates;
        },
        unmatchedBehavior: 'candidate',
        historyLabel: () => '알약 미등록 사용자 임포트',
    },
];

// ============================================================================
// 파일 파싱
// ============================================================================

export interface ParsedFile {
    rows: Record<string, any>[];
    headers: string[];
    sheetName: string;
}

/** 엑셀(xlsx) ArrayBuffer를 파싱해서 첫 시트의 행/헤더를 추출 */
export const parseXlsxArrayBuffer = (buffer: ArrayBuffer): ParsedFile => {
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, headers, sheetName };
};

/** CSV 텍스트를 파싱 */
export const parseCsvText = (text: string): ParsedFile => {
    const wb = XLSX.read(text, { type: 'string' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, headers, sheetName };
};

// ============================================================================
// 소스 자동 감지 + 변경 계산
// ============================================================================

/** 헤더 + 첫 행 데이터로 어떤 소스인지 추정 */
export const detectSource = (parsed: ParsedFile): SourceDef | null => {
    // 미등록과 유저정보가 같은 헤더 구조라, 부서명 값으로 추가 판별
    const firstRow = parsed.rows[0];
    if (firstRow) {
        const dept = String(firstRow['부서명'] ?? '').trim();
        if (dept.includes('미등록')) {
            return SOURCES.find(s => s.id === 'ahnlab-unregistered') || null;
        }
    }
    return SOURCES.find(s => s.detect(parsed.headers)) || null;
};

// 한 자산에 대한 변경 미리보기
export interface RowPlan {
    excelRow: Record<string, any>;
    lookupValue: string;       // 사용자명
    matchedAsset?: Asset;      // 매칭된 Notion 자산
    fieldChanges: Array<{
        field: string;
        oldValue: string;
        newValue: string;
        changed: boolean;
    }>;
    historyLabel: string;
    /**
     * 매칭됐지만 새 IP가 용인 대역 밖 → 진짜 같은 기기가 맞는지 의심.
     * UI에서 기본 적용 제외 + 경고 표시.
     */
    suspicious?: boolean;
    suspicionReason?: string;
}

/** 매칭 안 된 행을 용인 추정 여부로 분류 */
export type UnmatchedClassification = 'likely-yongin' | 'excluded';

export interface UnmatchedRow {
    excelRow: Record<string, any>;
    lookupValue: string;
    classification: UnmatchedClassification;
    reason: string;
}

export interface ImportPlan {
    source: SourceDef;
    totalRows: number;
    matchedCount: number;
    unmatchedCount: number;
    changeCount: number;         // 실제로 값이 바뀌는 행 수
    suspiciousCount: number;     // 의심 매칭 수
    plans: RowPlan[];
    unmatchedRows: UnmatchedRow[];
}

/**
 * 파싱된 엑셀 + 현재 Notion 자산 목록을 받아 변경 계획을 생성.
 * 멀티셀렉트 필드의 경우 단순 덮어쓰기가 아닌 머지로 처리할 수 있도록
 * mergeMultiSelect 옵션을 받을 수 있지만 현재 매핑 룰은 모두 select/rich_text라 단순 덮어쓰기.
 */
export interface BuildPlanOptions {
    /**
     * true 면 빈 값 업데이트도 plan 에 포함 (값 삭제). 기본 false 면 빈 값 변경은
     * plan 에서 제외되어 변화 없음으로 카운트. Notion export 재임포트처럼
     * 모든 컬럼을 통째로 매핑하는 소스에서 빈 셀로 값 삭제를 허용할 때 사용.
     */
    allowBlankClear?: boolean;
}

export const buildImportPlan = (
    parsed: ParsedFile,
    source: SourceDef,
    assets: Asset[],
    options: BuildPlanOptions = {},
): ImportPlan => {
    const byName = new Map<string, Asset>();
    assets.forEach(a => {
        const name = String((a.values as any)['Name'] ?? '').trim();
        if (name) byName.set(name, a);
    });

    const plans: RowPlan[] = [];
    const unmatchedRows: UnmatchedRow[] = [];
    let matchedCount = 0;
    let changeCount = 0;
    let suspiciousCount = 0;

    for (const row of parsed.rows) {
        const lookupValue = String(row[source.matchExcelColumn] ?? '').trim();
        if (!lookupValue) continue;

        const rowIp = String(row['IP'] ?? '').trim();
        const asset = byName.get(lookupValue);

        // ----------------- 매칭 안 된 행 -----------------
        if (!asset) {
            // 미등록 후보: IP가 용인 대역이면 likely-yongin, 아니면 excluded
            // (Hostname/사용자명 패턴은 신뢰하지 않음 — 향남/마곡과 동일 형식 사용)
            const inYongin = isYonginIp(rowIp);
            unmatchedRows.push({
                excelRow: row,
                lookupValue,
                classification: inYongin ? 'likely-yongin' : 'excluded',
                reason: inYongin
                    ? `IP ${rowIp} 가 용인 대역 (10.5.x.x / 192.168.x.x)`
                    : rowIp
                        ? `IP ${rowIp} 가 용인 대역 밖`
                        : 'IP 정보 없음',
            });
            continue;
        }

        // ----------------- 매칭된 행 -----------------
        matchedCount++;
        let updates = source.rowToUpdates(row);
        // 옵션 OFF (기본): 빈 값으로 가는 update 는 제외 (안전 모드)
        if (!options.allowBlankClear) {
            updates = updates.filter(u => u.value !== '');
        }
        const fieldChanges = updates.map(u => {
            const oldValue = String((asset.values as any)[u.field] ?? '');
            const changed = oldValue !== u.value;
            return { field: u.field, oldValue, newValue: u.value, changed };
        });

        if (fieldChanges.some(c => c.changed)) {
            changeCount++;
        }

        // 의심 매칭 판단: 엑셀 IP가 있는데 용인 대역 밖이면 의심
        // (다른 사람 PC가 우연히/실수로 같은 사용자명을 쓰는 케이스 대비)
        let suspicious = false;
        let suspicionReason = '';
        if (rowIp && !isYonginIp(rowIp)) {
            suspicious = true;
            suspicionReason = `엑셀 IP ${rowIp} 가 용인 대역 (10.5.x.x / 192.168.x.x) 밖 — 동일 사용자명이지만 다른 기기일 가능성`;
            suspiciousCount++;
        }

        plans.push({
            excelRow: row,
            lookupValue,
            matchedAsset: asset,
            fieldChanges,
            historyLabel: source.historyLabel(row),
            suspicious,
            suspicionReason,
        });
    }

    return {
        source,
        totalRows: parsed.rows.length,
        matchedCount,
        unmatchedCount: unmatchedRows.length,
        changeCount,
        suspiciousCount,
        plans,
        unmatchedRows,
    };
};
