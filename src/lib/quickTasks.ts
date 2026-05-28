/**
 * Quick Tasks — 정기/현장 업무 하드코딩 정의
 *
 * 4가지 Quick Task의 필터 매핑, 사전값, 편집필드, 완료 시 클리어 규칙,
 * 이력 라벨을 한 곳에서 관리합니다.
 *
 * Quick Task 추가/수정은 여기 한 파일만 고치면 됩니다.
 *
 * 분기 백업처럼 시간에 따라 바뀌는 값은 buildConfig/buildHistoryLabel
 * 안에서 동적으로 계산합니다.
 */

import { FilterConfig } from '../components/FieldWorkFilter';

// 이력이 누적되는 Notion 필드 이름 (Rich Text)
export const HISTORY_FIELD_NAME = '처리이력';

// 완료 시 어떻게 클리어할지에 대한 규칙
export interface ClearRule {
    field: string;
    // 멀티셀렉트: 이 값들을 옵션 목록에서 제거 (현재 값에서 빼기)
    removeValues?: string[];
    // 셀렉트/리치텍스트/타이틀: 이 값으로 덮어쓰기. 빈 문자열이면 비우기
    setValue?: string;
    // 전체 비우기 (멀티셀렉트 포함)
    clearAll?: boolean;
}

export interface QuickTaskDef {
    id: string;
    name: string;
    shortLabel: string; // 카드의 완료 버튼에 들어갈 짧은 라벨
    emoji: string;
    color: string;      // foreground (아이콘/텍스트)
    bgColor: string;    // background
    description: string;

    // 이 Quick Task를 누르면 만들어지는 FilterConfig
    // 동적으로(현재 분기 등) 계산되어야 하므로 함수 형태
    buildConfig: (ctx: { now: Date }) => FilterConfig;

    // 완료 시 클리어할 필드/값 규칙. 멀티셀렉트는 부분 제거 가능
    clearOnComplete: ClearRule[];

    // 이력에 한 줄로 들어갈 라벨. 현재 분기 정보 등 동적 데이터 반영
    buildHistoryLabel: (ctx: { now: Date }) => string;
}

// ============================================================================
// 헬퍼: 현재 분기 계산
// ============================================================================

/** 현재 분기 라벨. 예: "2026Q2" */
export const getCurrentQuarterLabel = (now: Date = new Date()): string => {
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    const quarter = Math.ceil(month / 3); // 1-4
    return `${year}Q${quarter}`;
};

/** 분기 백업 표기 prefix. 예: "2026Q)" — Notion에 이 prefix로 시작하는 옵션이 있다고 가정 */
export const getCurrentQuarterPrefix = (now: Date = new Date()): string => {
    return `${getCurrentQuarterLabel(now)})`;
};

// ============================================================================
// Quick Task 정의 (4종)
// ============================================================================
//
// 필드 이름은 Notion DB에 실제 존재하는 컬럼명과 정확히 일치해야 합니다.
// 현재 매핑은 기존 "4월 POC/알약 작업큐" 템플릿 (App.tsx)의 사용 패턴을
// 그대로 따릅니다. 필드명이 변경되면 여기만 수정하면 됩니다.

export const QUICK_TASKS: QuickTaskDef[] = [
    // ------------------------------------------------------------------------
    // 1. 알약 콘솔 업데이트
    //    - 콘솔에서 일괄 업데이트 명령 대상 추적
    //    - PC Hostname이 "POC업데이트 필요"로 마킹된 기기들
    // ------------------------------------------------------------------------
    {
        id: 'ahnlab-console-update',
        name: '알약 콘솔 업데이트',
        shortLabel: '콘솔 업데이트 완료',
        emoji: '💻',
        color: '#1d4ed8',
        bgColor: '#dbeafe',
        description: '콘솔에서 알약 업데이트 명령 대상',
        buildConfig: ({ now }) => ({
            locationHierarchy: [],
            sortColumn: '',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-ahnlab-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-ahnlab-c1-${now.getTime()}`,
                            column: 'PC Hostname',
                            type: 'equals',
                            values: ['POC업데이트 필요'],
                        },
                    ],
                },
            ],
            editableFields: ['PC Hostname', 'M)알약 현장조치', 'M)알약 온라인구분'],
        }),
        clearOnComplete: [
            // PC Hostname을 "POC업데이트 필요"에서 비우면 필터에서 자동 제외됨
            { field: 'PC Hostname', setValue: '' },
        ],
        buildHistoryLabel: () => '알약 콘솔 업데이트 완료',
    },

    // ------------------------------------------------------------------------
    // 2. 실패기기 현장방문
    //    - 콘솔 업데이트 실패 → 현장 방문해서 처리
    //    - M)알약 현장조치에 "알약대상인지 현장확인" 또는 "폐쇄망조치필요"
    // ------------------------------------------------------------------------
    {
        id: 'failed-onsite-visit',
        name: '실패기기 현장방문',
        shortLabel: '현장방문 완료',
        emoji: '🚶',
        color: '#b91c1c',
        bgColor: '#fee2e2',
        description: '콘솔 실패 → 현장 방문 처리',
        buildConfig: ({ now }) => ({
            locationHierarchy: [],
            sortColumn: '',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-failed-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-failed-c1-${now.getTime()}`,
                            column: 'M)알약 현장조치',
                            type: 'contains',
                            values: ['알약대상인지 현장확인'],
                        },
                        {
                            id: `qt-failed-c2-${now.getTime()}`,
                            column: 'M)알약 현장조치',
                            type: 'contains',
                            values: ['폐쇄망조치필요'],
                        },
                    ],
                },
            ],
            editableFields: ['M)알약 현장조치', 'M)알약 온라인구분', 'PC Hostname'],
        }),
        clearOnComplete: [
            {
                field: 'M)알약 현장조치',
                removeValues: ['알약대상인지 현장확인', '폐쇄망조치필요'],
            },
        ],
        buildHistoryLabel: () => '실패기기 현장방문 처리',
    },

    // ------------------------------------------------------------------------
    // 3. 오프라인 기기 현장 업데이트
    //    - 콘솔에서 안 닿는 오프라인 장비 직접 처리
    //    - M)알약 온라인구분이 "오프라인" 또는 "정보없음"
    // ------------------------------------------------------------------------
    {
        id: 'offline-onsite-update',
        name: '오프라인 기기 현장 업데이트',
        shortLabel: '오프라인 처리 완료',
        emoji: '📴',
        color: '#a16207',
        bgColor: '#fef3c7',
        description: '오프라인 장비 현장 업데이트',
        buildConfig: ({ now }) => ({
            locationHierarchy: [],
            sortColumn: '',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-offline-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-offline-c1-${now.getTime()}`,
                            column: 'M)알약 온라인구분',
                            type: 'contains',
                            values: ['오프라인'],
                        },
                        {
                            id: `qt-offline-c2-${now.getTime()}`,
                            column: 'M)알약 온라인구분',
                            type: 'contains',
                            values: ['정보없음'],
                        },
                    ],
                },
            ],
            editableFields: ['M)알약 온라인구분', 'M)알약 현장조치', 'PC Hostname'],
        }),
        clearOnComplete: [
            { field: 'M)알약 온라인구분', removeValues: ['오프라인', '정보없음'] },
        ],
        buildHistoryLabel: () => '오프라인 기기 현장 업데이트 완료',
    },

    // ------------------------------------------------------------------------
    // 4. 분기 백업 / 정기 점검
    //    - 분기마다 자동으로 분기 라벨이 바뀜 (현재 분기 기준)
    //    - "*4월조치" 필드의 "IT/현장백업" 옵션을 사용한다고 가정
    //      (필드명이 월별로 바뀐다면 아래 컬럼만 수정)
    // ------------------------------------------------------------------------
    {
        id: 'quarterly-backup',
        name: '분기 백업 / 정기 점검',
        shortLabel: '백업 완료',
        emoji: '💾',
        color: '#047857',
        bgColor: '#d1fae5',
        description: '분기 백업/점검 대상',
        buildConfig: ({ now }) => ({
            locationHierarchy: [],
            sortColumn: '',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-backup-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-backup-c1-${now.getTime()}`,
                            column: '*4월조치',
                            type: 'contains',
                            values: ['IT/현장백업'],
                        },
                        {
                            id: `qt-backup-c2-${now.getTime()}`,
                            column: '*4월조치',
                            type: 'text_contains',
                            values: [getCurrentQuarterPrefix(now)],
                        },
                    ],
                },
            ],
            editableFields: ['*4월조치', 'PC Hostname'],
        }),
        clearOnComplete: [
            // 백업 완료 후 해당 표기 제거
            {
                field: '*4월조치',
                removeValues: ['IT/현장백업'],
            },
        ],
        buildHistoryLabel: ({ now }) => `${getCurrentQuarterLabel(now)} 분기 백업/정기 점검 완료`,
    },
];

// ============================================================================
// 완료 처리: 자산의 현재 값을 보고 클리어 후 값 계산
// ============================================================================

export interface ClearedUpdate {
    field: string;
    newValue: string; // 멀티셀렉트는 ", " 조인 형태
    type: 'select' | 'multi_select' | 'rich_text' | 'title' | 'date' | 'number' | 'status' | 'url' | 'email' | 'phone_number' | 'checkbox' | string;
}

/**
 * Quick Task 완료 시 어떤 필드를 어떤 값으로 업데이트해야 할지 계산.
 * 멀티셀렉트인 경우 현재 값에서 removeValues에 매칭되는 옵션만 제거.
 *
 * @param currentValues 자산의 현재 값 (Asset.values)
 * @param schemaTypes 필드별 Notion 타입 (예: { 'M)알약 현장조치': 'multi_select' })
 */
export const computeClearUpdates = (
    task: QuickTaskDef,
    currentValues: Record<string, string>,
    schemaTypes: Record<string, string>
): ClearedUpdate[] => {
    const updates: ClearedUpdate[] = [];

    for (const rule of task.clearOnComplete) {
        const type = schemaTypes[rule.field] || 'rich_text';
        const current = currentValues[rule.field] ?? '';

        if (rule.clearAll) {
            updates.push({ field: rule.field, newValue: '', type });
            continue;
        }

        if (type === 'multi_select') {
            // 멀티셀렉트: 현재 옵션 목록에서 removeValues에 매칭되는 것만 제거
            const currentOptions = current
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            const toRemove = new Set((rule.removeValues || []).map(v => v.trim()));
            const next = currentOptions.filter(opt => !toRemove.has(opt));
            // 변화가 없으면 굳이 업데이트 안 함
            if (next.length !== currentOptions.length) {
                updates.push({ field: rule.field, newValue: next.join(', '), type });
            }
        } else {
            // 그 외 타입: setValue로 덮어쓰기 (기본 빈 문자열)
            const next = rule.setValue ?? '';
            if (current !== next) {
                updates.push({ field: rule.field, newValue: next, type });
            }
        }
    }

    return updates;
};

/**
 * 처리이력 필드에 새 한 줄을 prepend (최신이 위로).
 * 형식: [YYYY-MM-DD] 라벨
 */
export const appendHistoryLine = (existing: string, label: string, now: Date = new Date()): string => {
    const date = now.toISOString().slice(0, 10);
    const newLine = `[${date}] ${label}`;
    if (!existing || existing.trim() === '') return newLine;
    return `${newLine}\n${existing}`;
};
