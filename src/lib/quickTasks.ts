/**
 * Quick Tasks — 정기/현장 업무 하드코딩 정의
 *
 * Quick Task 추가/수정은 여기 한 파일만 고치면 됩니다.
 *
 * 그룹: 알약 (월 1회) / 분기 백업 (분기 종료 후) / 시놀로지 (수시)
 *
 * 분기 백업처럼 시간에 따라 바뀌는 값은 buildConfig/buildHistoryLabel
 * 안에서 동적으로 계산합니다.
 */

import { FilterConfig, TargetCondition, TargetGroup } from '../components/FieldWorkFilter';
import { Asset } from './notion';

// 이력이 누적되는 Notion 필드 이름 (Rich Text)
export const HISTORY_FIELD_NAME = '처리이력';

// 시놀로지 상태를 추적하는 새 필드 (multi_select)
export const SYNOLOGY_FIELD_NAME = 'M)시놀로지 상태';

// 시놀로지 상태 옵션
export const SYNOLOGY_OPTIONS = [
    '대기',
    '접속불가',
    '클라이언트설치불가',
    '완료',
];

// 현장지원 (고장/불편접수) 관리 필드
export const FIELD_SUPPORT_STATUS_FIELD = 'M)현장지원 상태'; // select
export const FIELD_SUPPORT_STATUS_OPTIONS = ['요청', '완료'];
export const FIELD_SUPPORT_MEMO_FIELD = 'M)현장지원 메모';   // rich_text

// 분기 백업 사이클 상태 (multi_select)
// 'IT현장 백업필요' = 이번 분기 처리 필요. 'IT현장 백업완료' = 처리 완료.
// (다른 백업 종류와 구분하기 위해 'IT현장' 접두어를 붙임)
export const BACKUP_STATUS_FIELD = 'M)분기백업 상태';
export const BACKUP_STATUS_OPTIONS = ['IT현장 백업필요', 'IT현장 백업완료'];

// 미등록 기기 처리비고 (rich_text) — 미등록 사용자 임포트 시 작성하는 작업비고
export const UNREGISTERED_MEMO_FIELD = 'M)미등록 처리비고';

// Synology Client 설치 여부 (select) — 운영 필수
// 'M)시놀로지 상태'(multi_select)는 백업 작업 상태(대기/접속불가/완료) 추적용으로 의미 다름
export const SYNOLOGY_CLIENT_FIELD = 'M)Synology Client 설치';
export const SYNOLOGY_CLIENT_OPTIONS = ['설치됨', '미설치', '설치불가', '미대상'];

// 알약 온라인구분의 정상 운영 값 — 이 값이 아니거나 비어있으면 점검 대상
// '미등록'은 별도 흐름(임포트 → Quick Task 'unregistered-check')이므로 여기서 제외
// [2026-06-18] 타입 = 온라인/단독형(구 폐쇄망)/알약대상아님. '오프라인'은 분류값 아님(일시 상태) → 제외.
//   구 '폐쇄망'은 레거시 데이터 호환 위해 당분간 정상값에 유지(마이그레이션 후 제거 가능).
export const ALYAK_STATUS_NORMAL = ['온라인', '단독형', '폐쇄망', '알약대상아님', '알약대상아님(나보타)'];

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

export type QuickTaskGroup = '알약' | '분기 백업' | '시놀로지' | '현장지원' | '개별';

export interface QuickTaskDef {
    id: string;
    group: QuickTaskGroup;
    name: string;
    shortLabel: string; // 카드의 완료 버튼에 들어갈 짧은 라벨
    emoji: string;
    color: string;      // foreground (아이콘/텍스트)
    bgColor: string;    // background
    description: string;

    // 이 Quick Task를 누르면 만들어지는 FilterConfig
    buildConfig: (ctx: { now: Date }) => FilterConfig;

    // 완료 시 클리어할 필드/값 규칙
    clearOnComplete: ClearRule[];

    // 이력에 한 줄로 들어갈 라벨
    buildHistoryLabel: (ctx: { now: Date }) => string;
}

// ============================================================================
// 헬퍼: 현재 분기 계산
// ============================================================================

/** 현재 분기 라벨. 예: "2026Q2" */
export const getCurrentQuarterLabel = (now: Date = new Date()): string => {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    return `${year}Q${quarter}`;
};

/** 현재 월 라벨 (한국어). 예: "5월" */
export const getCurrentMonthLabel = (now: Date = new Date()): string => {
    return `${now.getMonth() + 1}월`;
};

// ============================================================================
// Quick Task 정의
// ============================================================================
//
// 매핑은 사용자 워크플로우와 실제 Notion 컬럼 값 분포(2026-05 export 기준)를
// 토대로 잡았습니다. 컬럼명/옵션값이 바뀌면 여기만 수정.

export const QUICK_TASKS: QuickTaskDef[] = [
    // ------------------------------------------------------------------------
    // 알약 - 푸시 실패기기 현장방문 (월 1회 주기)
    // ASM 콘솔에서 푸시 → 실패한 기기들 → 현장 방문 필요
    // ------------------------------------------------------------------------
    {
        id: 'ahnlab-push-failed',
        group: '알약',
        name: '알약 푸시 실패기기 현장방문',
        shortLabel: '현장방문 완료',
        emoji: '🚶',
        color: '#b91c1c',
        bgColor: '#fee2e2',
        description: 'ASM 푸시 실패 → 현장 방문',
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-pushfail-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-pushfail-c1-${now.getTime()}`,
                            column: 'M)ASM Push',
                            type: 'text_contains',
                            values: ['실패'],
                        },
                        {
                            id: `qt-pushfail-c2-${now.getTime()}`,
                            column: 'M)알약 현장조치',
                            type: 'text_contains',
                            values: ['현장확인'],
                        },
                    ],
                },
            ],
            editableFields: ['M)알약 현장조치', 'M)ASM Push', 'M)알약 온라인구분', 'PC Hostname'],
        }),
        clearOnComplete: [
            // ASM Push의 "실패" 표기 제거 (멀티셀렉트라면 옵션만 빼고, 단일이라면 비움)
            { field: 'M)ASM Push', setValue: '' },
            { field: 'M)알약 현장조치', removeValues: ['현장확인', '알약대상인지 현장확인'] },
        ],
        buildHistoryLabel: ({ now }) => `${getCurrentMonthLabel(now)} 알약 푸시 실패기기 현장 처리`,
    },

    // ------------------------------------------------------------------------
    // 알약 - 단독형(구 폐쇄망) 현장 패치
    // 매월 워크플로우:
    //   1. '월간 초기화' 액션 → 단독형 기기의 M)알약 현장조치에 '단독형조치필요' 추가
    //   2. 이 Quick Task / 통합 큐 / 과제 대시보드에서 매칭되어 표시됨
    //   3. 현장에서 완료 → 조치필요 태그 제거 + '단독형완료' 추가
    //   4. 다음 달에 다시 초기화 → 사이클 반복
    //   ※ 단독형 = 네트워크 미연결 독립기기 → 보안패치 USB 지참(사이트 다운로드) 후 현장 수동 설치.
    //   ※ 레거시 '폐쇄망조치필요' 태그도 매칭(마이그레이션 전 데이터 호환).
    // ------------------------------------------------------------------------
    {
        id: 'ahnlab-offline-patch',
        group: '알약',
        name: '단독형 알약 현장 패치',
        shortLabel: '단독형 패치 완료',
        emoji: '📴',
        color: '#a16207',
        bgColor: '#fef3c7',
        description: '단독형(USB 수동패치) 조치필요 기기 처리',
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-offline-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-offline-c1-${now.getTime()}`,
                            column: 'M)알약 현장조치',
                            type: 'contains',
                            values: ['단독형조치필요', '폐쇄망조치필요'], // 신규 + 레거시
                        },
                    ],
                },
            ],
            editableFields: ['M)알약 현장조치', 'M)알약 온라인구분', 'PC Hostname'],
        }),
        clearOnComplete: [
            // 멀티셀렉트: 조치필요 태그(신규+레거시) 제거 후 '단독형완료' 추가
            // computeClearUpdates 가 removeValues 와 setValue 를 합쳐서 처리해줌
            {
                field: 'M)알약 현장조치',
                removeValues: ['단독형조치필요', '폐쇄망조치필요'],
                setValue: '단독형완료',
            },
        ],
        buildHistoryLabel: ({ now }) => `${getCurrentMonthLabel(now)} 단독형 알약 현장 패치 완료`,
    },

    // ------------------------------------------------------------------------
    // 분기 백업 - IT/현장백업 대상
    // 분기 사이클:
    //   1. '정기 초기화 → 분기백업' → QA)백업 방법 = IT/현장백업 인 기기의
    //      M)분기백업 상태에 'IT현장 백업필요' 마킹
    //   2. 이 Quick Task / 통합 큐 / 과제 대시보드에서 매칭되어 표시
    //   3. 현장에서 ✓ 완료 → 'IT현장 백업필요' 제거 + 'IT현장 백업완료' 추가
    //   4. 다음 분기 시즌 도래 시 초기화 → 사이클 반복
    // ------------------------------------------------------------------------
    {
        id: 'backup-it-onsite',
        group: '분기 백업',
        name: 'IT/현장백업 대상 현장',
        shortLabel: 'IT현장 백업완료',
        emoji: '💾',
        color: '#047857',
        bgColor: '#d1fae5',
        description: "QA)백업 방법에 'IT/현장백업'이 포함된 기기의 M)분기백업 상태에 'IT현장 백업필요'를 추가합니다. 현장에서 ✓ 완료 누르면 'IT현장 백업필요'가 제거되고 'IT현장 백업완료'로 바뀝니다.",
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-backup1-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-backup1-c1-${now.getTime()}`,
                            column: BACKUP_STATUS_FIELD,
                            type: 'contains',
                            values: ['IT현장 백업필요'],
                        },
                    ],
                },
            ],
            editableFields: [BACKUP_STATUS_FIELD, '분기백업비고', 'QA)백업 방법'],
        }),
        clearOnComplete: [
            // 멀티셀렉트: 'IT현장 백업필요' 제거 후 'IT현장 백업완료' 추가
            {
                field: BACKUP_STATUS_FIELD,
                removeValues: ['IT현장 백업필요'],
                setValue: 'IT현장 백업완료',
            },
        ],
        buildHistoryLabel: ({ now }) => `${getCurrentQuarterLabel(now)} IT/현장백업 완료`,
    },

    // ------------------------------------------------------------------------
    // 분기 백업 - 실패 재방문
    // 분기백업비고에 사유 적힌 기기들 → 다시 가서 처리
    // ------------------------------------------------------------------------
    {
        id: 'backup-failed-revisit',
        group: '분기 백업',
        name: '백업 실패 재방문',
        shortLabel: '재방문 처리',
        emoji: '🔁',
        color: '#7c3aed',
        bgColor: '#ede9fe',
        description: '분기백업비고에 사유 있는 기기',
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-backup2-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-backup2-c1-${now.getTime()}`,
                            column: '분기백업비고',
                            type: 'is_not_empty',
                            values: [],
                        },
                    ],
                },
            ],
            editableFields: ['분기백업비고', '430백업', 'QA)백업 방법'],
        }),
        clearOnComplete: [
            { field: '분기백업비고', setValue: '' },
        ],
        buildHistoryLabel: ({ now }) => `${getCurrentQuarterLabel(now)} 백업 실패 재방문 처리`,
    },

    // ------------------------------------------------------------------------
    // 시놀로지 - 실패로그 현장확인
    // 시놀로지 NAS 백업 실패 로그에서 추출된 기기들 → 접속/클라이언트 확인
    // ------------------------------------------------------------------------
    {
        id: 'synology-failed-check',
        group: '시놀로지',
        name: '시놀로지 실패로그 현장확인',
        shortLabel: '확인 완료',
        emoji: '🗄️',
        color: '#0369a1',
        bgColor: '#e0f2fe',
        description: 'NAS 백업 실패 로그 기기 점검',
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-syn-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-syn-c1-${now.getTime()}`,
                            column: SYNOLOGY_FIELD_NAME,
                            type: 'contains',
                            values: ['접속불가'],
                        },
                        {
                            id: `qt-syn-c2-${now.getTime()}`,
                            column: SYNOLOGY_FIELD_NAME,
                            type: 'contains',
                            values: ['클라이언트설치불가'],
                        },
                        {
                            id: `qt-syn-c3-${now.getTime()}`,
                            column: SYNOLOGY_FIELD_NAME,
                            type: 'contains',
                            values: ['대기'],
                        },
                    ],
                },
            ],
            editableFields: [SYNOLOGY_FIELD_NAME, 'M)알약 현장조치'],
        }),
        clearOnComplete: [
            {
                field: SYNOLOGY_FIELD_NAME,
                removeValues: ['접속불가', '클라이언트설치불가', '대기'],
            },
        ],
        buildHistoryLabel: () => '시놀로지 실패로그 현장확인 처리',
    },

    // ------------------------------------------------------------------------
    // 현장지원 (고장/불편접수)
    // 사용자가 특정 기기에 대해 접수한 건들. 접수 모달에서 등록됨.
    // 매칭: M)현장지원 상태 = '요청'
    // 완료 시: 상태 = '완료' (메모는 유지)
    // ------------------------------------------------------------------------
    {
        id: 'field-support',
        group: '현장지원',
        name: '현장지원 (고장/불편접수)',
        shortLabel: '지원 완료',
        emoji: '🛠️',
        color: '#dc2626',
        bgColor: '#fee2e2',
        description: '접수된 고장/불편 현장 방문',
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-support-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-support-c1-${now.getTime()}`,
                            column: FIELD_SUPPORT_STATUS_FIELD,
                            type: 'equals',
                            values: ['요청'],
                        },
                    ],
                },
            ],
            editableFields: [FIELD_SUPPORT_STATUS_FIELD, FIELD_SUPPORT_MEMO_FIELD],
        }),
        clearOnComplete: [
            { field: FIELD_SUPPORT_STATUS_FIELD, setValue: '완료' },
        ],
        buildHistoryLabel: () => '현장지원 처리 완료',
    },

    // ------------------------------------------------------------------------
    // 알약 - 온라인구분 점검 (월간 사이클)
    // 정기 초기화 → 비어있거나 비정상값인 기기에 '온라인구분점검필요' 마킹
    //   1. 정기 초기화에서 '알약 온라인구분 점검' 사이클 실행
    //   2. 이 Quick Task / 통합 큐 / 과제 대시보드에 매칭되어 표시
    //   3. 현장 확인 후 정확한 값으로 채움 → '온라인구분점검필요' 제거 + '온라인구분확인완료' 추가
    // ------------------------------------------------------------------------
    {
        id: 'ahnlab-status-check',
        group: '알약',
        name: '알약 온라인구분 점검',
        shortLabel: '구분 확인',
        emoji: '❓',
        color: '#7c3aed',
        bgColor: '#ede9fe',
        description: '온라인구분이 비었거나 비정상값인 기기 확인',
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-alyakchk-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-alyakchk-c1-${now.getTime()}`,
                            column: 'M)알약 현장조치',
                            type: 'contains',
                            values: ['온라인구분점검필요'],
                        },
                    ],
                },
            ],
            editableFields: ['M)알약 온라인구분', 'M)알약 현장조치', 'PC Hostname'],
        }),
        clearOnComplete: [
            {
                field: 'M)알약 현장조치',
                removeValues: ['온라인구분점검필요'],
                setValue: '온라인구분확인완료',
            },
        ],
        buildHistoryLabel: ({ now }) => `${getCurrentMonthLabel(now)} 알약 온라인구분 점검 완료`,
    },

    // ------------------------------------------------------------------------
    // 필수정보 누락 — 운영 필수 컬럼이 비어있는 기기 자동 작업대상
    // 정기 초기화 불필요. 컬럼이 채워지면 자동으로 매칭 해제됨 (조건 = is_empty).
    // 누락 가능 컬럼:
    //   L)건물 / L)층 / L)연구실 (위치)
    //   PC Hostname / QA)기기 IP (식별)
    //   User)기기관리자 / User)소속팀 (담당)
    //   M)알약 온라인구분 (백신/알약 분류) ← 백신 관련 필수
    //   QA)백업 방법 (백업 분류) ← 백업 필수
    //   M)Synology Client 설치 ← Synology Client 설치 여부 필수
    // ------------------------------------------------------------------------
    {
        id: 'data-completeness',
        group: '개별',
        name: '필수정보 누락 기기',
        shortLabel: '정보 채움',
        emoji: '📝',
        color: '#0891b2',
        bgColor: '#cffafe',
        description: '위치·호스트·IP·담당자·팀·백신·백업·시놀로지 중 비어있는 컬럼이 있는 기기',
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-complete-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        // 위치
                        { id: `qt-complete-b-${now.getTime()}`,   column: 'L)건물',           type: 'is_empty', values: [] },
                        { id: `qt-complete-f-${now.getTime()}`,   column: 'L)층',             type: 'is_empty', values: [] },
                        { id: `qt-complete-r-${now.getTime()}`,   column: 'L)연구실',         type: 'is_empty', values: [] },
                        // 식별
                        { id: `qt-complete-h-${now.getTime()}`,   column: 'PC Hostname',      type: 'is_empty', values: [] },
                        { id: `qt-complete-i-${now.getTime()}`,   column: 'QA)기기 IP',       type: 'is_empty', values: [] },
                        // 담당
                        { id: `qt-complete-m-${now.getTime()}`,   column: 'User)기기관리자',  type: 'is_empty', values: [] },
                        { id: `qt-complete-t-${now.getTime()}`,   column: 'User)소속팀',      type: 'is_empty', values: [] },
                        // 백신/백업/시놀로지
                        { id: `qt-complete-a-${now.getTime()}`,   column: 'M)알약 온라인구분',type: 'is_empty', values: [] },
                        { id: `qt-complete-k-${now.getTime()}`,   column: 'QA)백업 방법',     type: 'is_empty', values: [] },
                        { id: `qt-complete-s-${now.getTime()}`,   column: SYNOLOGY_CLIENT_FIELD, type: 'is_empty', values: [] },
                    ],
                },
            ],
            editableFields: [
                'L)건물', 'L)층', 'L)연구실',
                'PC Hostname', 'QA)기기 IP',
                'User)기기관리자', 'User)소속팀',
                'M)알약 온라인구분', 'QA)백업 방법', SYNOLOGY_CLIENT_FIELD,
            ],
        }),
        // 빈 컬럼을 채우면 조건 (is_empty) 이 false 가 되어 자동으로 매칭 해제됨.
        // 별도 clearOnComplete 액션 불필요.
        clearOnComplete: [],
        buildHistoryLabel: () => '필수정보 누락 채움',
    },

    // ------------------------------------------------------------------------
    // 알약 - 미등록 사용자 Agent 확인 (수시)
    // 사용자가 알약 ASM에서 추출한 '미등록 사용자' 엑셀을 임포트하면,
    // 대상 기기의 M)알약 현장조치에 '미등록현장확인필요' 자동 마킹.
    // (sourceImports.ts 의 ahnlab-unregistered 가 임포트 시점에 마킹)
    //
    // 사용자 워크플로우:
    //   1. ASM 콘솔 → 미등록 사용자 list 추출 → 엑셀 다운로드
    //   2. DB 관리 → 소스 임포트 → 자동 감지로 'ahnlab-unregistered' 매칭
    //   3. 매칭된 자산엔 PC Hostname/OS/IP + '미등록현장확인필요' 자동 추가
    //   4. 이 Quick Task / 통합 큐 / 과제 대시보드에서 매칭되어 표시
    //   5. 현장에서 Agent 이름 확인 → 작업비고 입력 후 완료
    //      ('미등록현장확인필요' 제거 + '미등록확인완료' 추가)
    // ------------------------------------------------------------------------
    {
        id: 'unregistered-check',
        group: '알약',
        name: '미등록 사용자 Agent 확인',
        shortLabel: 'Agent 확인',
        emoji: '🪪',
        color: '#be123c',
        bgColor: '#ffe4e6',
        description: 'ASM 미등록 — Agent 이름 / 실제 사용자 확인',
        buildConfig: ({ now }) => ({
            locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
            sortColumn: 'L)연구실',
            sortDirection: 'asc',
            globalLogicalOperator: 'or',
            targetGroups: [
                {
                    id: `qt-unreg-${now.getTime()}`,
                    operator: 'or',
                    conditions: [
                        {
                            id: `qt-unreg-c1-${now.getTime()}`,
                            column: 'M)알약 현장조치',
                            type: 'contains',
                            values: ['미등록현장확인필요'],
                        },
                    ],
                },
            ],
            editableFields: [
                'PC Hostname',
                'M)알약 온라인구분',
                'M)알약 현장조치',
                UNREGISTERED_MEMO_FIELD,
                'User)기기관리자',
            ],
        }),
        clearOnComplete: [
            {
                field: 'M)알약 현장조치',
                removeValues: ['미등록현장확인필요'],
                setValue: '미등록확인완료',
            },
        ],
        buildHistoryLabel: () => '미등록 사용자 Agent 확인 처리',
    },
];

// ============================================================================
// 완료 처리: 자산의 현재 값을 보고 클리어 후 값 계산
// ============================================================================

export interface ClearedUpdate {
    field: string;
    newValue: string;
    type: 'select' | 'multi_select' | 'rich_text' | 'title' | 'date' | 'number' | 'status' | 'url' | 'email' | 'phone_number' | 'checkbox' | string;
}

/**
 * Quick Task 완료 시 어떤 필드를 어떤 값으로 업데이트해야 할지 계산.
 * 멀티셀렉트인 경우 현재 값에서 removeValues에 매칭되는 옵션만 제거.
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
            const currentOptions = current
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            // removeValues 처리
            const toRemove = new Set((rule.removeValues || []).map(v => v.trim()));
            let next = currentOptions.filter(opt => !toRemove.has(opt));

            // setValue가 있고 멀티셀렉트에 그 옵션이 없으면 추가 (예: "폐쇄망완료")
            if (rule.setValue && rule.setValue !== '' && !next.includes(rule.setValue)) {
                next.push(rule.setValue);
            }

            if (next.join(', ') !== currentOptions.join(', ')) {
                updates.push({ field: rule.field, newValue: next.join(', '), type });
            }
        } else {
            // 그 외 타입: setValue로 덮어쓰기
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
 *
 * Phase 1 픽스: Notion rich_text 는 한 block 당 2000자 제한이라
 * 오랫동안 누적되면 임포트/완료 API 가 통째로 실패. 1800자 도달 시
 * 가장 오래된 줄부터 잘라내고 `[...이전 N줄 생략]` 마커 prepend.
 */
const HISTORY_MAX_CHARS = 1800;

export const appendHistoryLine = (existing: string, label: string, now: Date = new Date()): string => {
    const date = now.toISOString().slice(0, 10);
    const newLine = `[${date}] ${label}`;
    if (!existing || existing.trim() === '') return newLine;
    let combined = `${newLine}\n${existing}`;
    if (combined.length <= HISTORY_MAX_CHARS) return combined;

    // 가장 오래된 줄부터 자르기
    const lines = combined.split('\n');
    let truncated = 0;
    while (combined.length > HISTORY_MAX_CHARS && lines.length > 2) {
        lines.pop();
        truncated++;
        combined = lines.join('\n');
    }
    if (truncated > 0) {
        // 잘렸음을 표시 — 다음 호출에서 또 잘리지 않게 마커 한 줄
        const marker = `[...이전 ${truncated}줄 생략]`;
        const finalLines = [...lines, marker];
        let final = finalLines.join('\n');
        // 마커 추가 후에도 초과하면 더 자르기
        while (final.length > HISTORY_MAX_CHARS && finalLines.length > 2) {
            finalLines.splice(-2, 1); // 마커 위쪽 줄 제거
            final = finalLines.join('\n');
        }
        return final;
    }
    return combined;
};

// ============================================================================
// 통합(combined) 모드 헬퍼
// ============================================================================

// Phase 4: 운영 필수 컬럼에서 '비어있음'으로 간주할 더미값 화이트리스트.
// '미정', '-', 'X', 'NA', '#N/A' 등 무의미한 값으로 채워서 회피 못 하게.
const DUMMY_VALUES = new Set([
    '', '-', '--', '?', 'na', 'n/a', '#n/a', '미정', '없음', '불명', 'x', 'tbd', 'todo',
]);

/** 한 조건이 자산에 매칭되는지 평가 (FilterConfig 평가용) */
const evaluateCondition = (asset: Asset, cond: TargetCondition): boolean => {
    const columnKey = String(cond.column ?? '');
    const val = String((asset.values as any)[columnKey] ?? '').toLowerCase().trim();
    switch (cond.type) {
        case 'is_empty':
            // Phase 4: 더미값도 '비어있음'으로 취급
            return !val || DUMMY_VALUES.has(val);
        case 'is_not_empty':
            return val !== '' && !DUMMY_VALUES.has(val);
        case 'contains':
            // Phase 6 통일: multi_select/select 는 콤마 split 아이템 단위 정확 매칭
            // (FieldWorkFilter.tsx 평가 엔진과 시맨틱 동일)
            if (cond.values && cond.values.length > 0) {
                const items = val.split(',').map(s => s.trim()).filter(Boolean);
                return cond.values.some(v => {
                    const t = String(v ?? '').toLowerCase().trim();
                    if (t === '') return val === '';
                    return items.includes(t) || val.includes(t);
                });
            }
            return true;
        case 'text_contains':
            // 일반 텍스트 부분 일치
            if (cond.values && cond.values.length > 0) {
                return cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
            }
            return true;
        case 'not_contains':
            if (cond.values && cond.values.length > 0) {
                const items = val.split(',').map(s => s.trim()).filter(Boolean);
                return !cond.values.some(v => {
                    const t = String(v ?? '').toLowerCase().trim();
                    if (t === '') return false;
                    return items.includes(t) || val.includes(t);
                });
            }
            return true;
        case 'text_not_contains':
            if (cond.values && cond.values.length > 0) {
                return !cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
            }
            return true;
        case 'equals':
            if (cond.values && cond.values.length > 0) {
                return cond.values.some(v => val === String(v ?? '').toLowerCase());
            }
            return true;
        default:
            return true;
    }
};

/** 자산이 한 Quick Task에 매칭되는지 — buildConfig 의 targetGroups 평가 */
export const assetMatchesQuickTask = (
    asset: Asset,
    task: QuickTaskDef,
    now: Date = new Date(),
): boolean => {
    const config = task.buildConfig({ now });
    const groups = config.targetGroups || [];
    if (groups.length === 0) return false;
    const isGlobalOr = config.globalLogicalOperator === 'or';
    const groupResults = groups.map((g: TargetGroup) => {
        if (!g.conditions || g.conditions.length === 0) return true;
        const isGroupOr = g.operator === 'or';
        const condResults = g.conditions.map(c => evaluateCondition(asset, c));
        return isGroupOr ? condResults.some(r => r) : condResults.every(r => r);
    });
    return isGlobalOr ? groupResults.some(r => r) : groupResults.every(r => r);
};

/** 자산에 매칭되는 모든 Quick Task 반환 */
export const getMatchingQuickTasks = (
    asset: Asset,
    tasks: QuickTaskDef[] = QUICK_TASKS,
    now: Date = new Date(),
): QuickTaskDef[] => {
    return tasks.filter(task => assetMatchesQuickTask(asset, task, now));
};

/**
 * 모든 Quick Task 의 조건을 OR 로 합친 통합 FilterConfig.
 * '현장 한 번 나가는 김에 다 처리' 워크플로우용.
 */
export const buildCombinedQuickTaskConfig = (
    tasks: QuickTaskDef[] = QUICK_TASKS,
    now: Date = new Date(),
): FilterConfig => {
    const stamp = now.getTime();
    const allGroups: TargetGroup[] = [];
    for (const task of tasks) {
        const c = task.buildConfig({ now });
        for (const g of c.targetGroups || []) {
            allGroups.push({ ...g, id: `combined-${task.id}-${g.id}-${stamp}` });
        }
    }
    const editableSet = new Set<string>();
    for (const task of tasks) {
        const c = task.buildConfig({ now });
        for (const f of c.editableFields || []) editableSet.add(f);
    }
    editableSet.add(HISTORY_FIELD_NAME);
    return {
        locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
        sortColumn: 'L)연구실',
        sortDirection: 'asc',
        globalLogicalOperator: 'or',
        targetGroups: allGroups,
        editableFields: Array.from(editableSet),
    };
};
