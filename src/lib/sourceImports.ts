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
// 소스 정의들
// ============================================================================

export const SOURCES: SourceDef[] = [
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
}

export interface ImportPlan {
    source: SourceDef;
    totalRows: number;
    matchedCount: number;
    unmatchedCount: number;
    changeCount: number;       // 실제로 값이 바뀌는 행 수
    plans: RowPlan[];
    unmatchedRows: Array<{ excelRow: Record<string, any>; lookupValue: string }>;
}

/**
 * 파싱된 엑셀 + 현재 Notion 자산 목록을 받아 변경 계획을 생성.
 * 멀티셀렉트 필드의 경우 단순 덮어쓰기가 아닌 머지로 처리할 수 있도록
 * mergeMultiSelect 옵션을 받을 수 있지만 현재 매핑 룰은 모두 select/rich_text라 단순 덮어쓰기.
 */
export const buildImportPlan = (
    parsed: ParsedFile,
    source: SourceDef,
    assets: Asset[]
): ImportPlan => {
    const byName = new Map<string, Asset>();
    assets.forEach(a => {
        const name = String((a.values as any)['Name'] ?? '').trim();
        if (name) byName.set(name, a);
    });

    const plans: RowPlan[] = [];
    const unmatchedRows: { excelRow: Record<string, any>; lookupValue: string }[] = [];
    let matchedCount = 0;
    let changeCount = 0;

    for (const row of parsed.rows) {
        const lookupValue = String(row[source.matchExcelColumn] ?? '').trim();
        if (!lookupValue) continue;

        const asset = byName.get(lookupValue);
        if (!asset) {
            unmatchedRows.push({ excelRow: row, lookupValue });
            continue;
        }

        matchedCount++;
        const updates = source.rowToUpdates(row);
        const fieldChanges = updates.map(u => {
            const oldValue = String((asset.values as any)[u.field] ?? '');
            const changed = oldValue !== u.value;
            return { field: u.field, oldValue, newValue: u.value, changed };
        });

        if (fieldChanges.some(c => c.changed)) {
            changeCount++;
        }

        plans.push({
            excelRow: row,
            lookupValue,
            matchedAsset: asset,
            fieldChanges,
            historyLabel: source.historyLabel(row),
        });
    }

    return {
        source,
        totalRows: parsed.rows.length,
        matchedCount,
        unmatchedCount: unmatchedRows.length,
        changeCount,
        plans,
        unmatchedRows,
    };
};
