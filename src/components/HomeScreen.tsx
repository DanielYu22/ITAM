import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    TextInput,
    Modal,
    Alert,
    Platform,
} from 'react-native';
import {
    Play,
    Target,
    MapPin,
    ArrowUpDown,
    Edit3,
    Settings2,
    Bookmark,
    Search,
    X,
    ChevronRight,
    MoreVertical,
    Copy,
    Trash2,
    Edit,
    Download,
    Upload,
    RefreshCw,
    FileUp,
    LayoutGrid,
    Database,
    Wrench,
    CalendarClock,
    Building2,
    ExternalLink,
} from 'lucide-react-native';
import { FilterConfig } from './FieldWorkFilter';
import { Asset, NotionProperty } from '../lib/notion';
import { APP_VERSION } from '../lib/version';
import { QUICK_TASKS, QuickTaskDef, getMatchingQuickTasks } from '../lib/quickTasks';
import { type LayoutsStore, parseRoomKey } from '../lib/layouts';
import { SITES_DEFAULTS, SiteDef, SiteId, getSiteCounts } from '../lib/sites';
import { validateAsset } from '../lib/assetGovernance';
import { classifyBackupTarget, classifyVaccineTarget } from '../lib/kpiTargets';

// [필수값] 장비로서 존재하기 위한 필수 컬럼 — 비어있으면 홈에서 누락 알람.
//   물리위치 + 기기담당자 + 망구분(백신 온라인/폐쇄망). (hostname/백업/시놀로지는 광범위해 제외)
const REQUIRED_FIELDS: { col: string; label: string }[] = [
    { col: 'L)건물', label: '건물' },
    { col: 'L)층', label: '층' },
    { col: 'L)연구실', label: '연구실' },
    { col: 'User)기기관리자', label: '담당자' },
    { col: 'M)알약 온라인구분', label: '망구분' },
];

interface HomeScreenProps {
    // 전체 자산 (사이트 토글 카운트 계산용)
    allAssets: Asset[];
    // 사이트 필터링 후 자산 (통계/Quick Task 카운트는 이걸 사용)
    assets: Asset[];
    filterConfig: FilterConfig | null;
    templates: FilterTemplate[];
    schemaProperties: Record<string, NotionProperty>;
    // 사이트 토글
    currentSite: SiteId;
    onChangeSite: (site: SiteId) => void;
    onStartWork: () => void;
    onOpenFilter: () => void;
    onLoadTemplate: (template: FilterTemplate) => void;
    onSaveTemplate: (name: string, overwriteId?: string) => void;
    onDeleteTemplate: (templateId: string) => void;
    onEditAsset: (asset: Asset) => void;
    // Quick Task: 정기/현장 업무를 한 번에 시작
    onQuickTask?: (task: QuickTaskDef) => void;
    // 모든 Quick Task 통합 큐 시작 (메인 진입)
    onCombinedQuickTask?: (enabledTaskIds?: string[]) => void;
    // 과제 대시보드 (테이블 뷰) 진입
    onTaskDashboard?: () => void;
    // Tool section callbacks (개별 액션 — DBManagementModal 안에서 호출)
    onExport?: () => void;
    onBulkUpdate?: () => void;
    onSourceImport?: () => void;
    // DB 관리 액션시트 열기
    onOpenDBManagement?: () => void;
    onDashboard?: () => void;
    onEditSiteRules?: () => void;
    onRefresh?: () => void;
    // 현장지원 접수 모달 열기
    onSubmitFieldSupport?: () => void;
    // 월간 정기 큐 초기화 (폐쇄망 등)
    onMonthlyReset?: () => void;
    // 레이아웃 편집 진입
    onEditLayout?: () => void;
    /** [B] 동선 미마킹 검출용 레이아웃 데이터 */
    layoutsStore?: LayoutsStore;
    /** [B] 특정 연구실 레이아웃 편집기로 바로 진입 (동선 미마킹 항목 클릭) */
    onOpenRoomLayout?: (building: string, floor: string, room: string) => void;
    // 인프라 트리 (사이트·건물·층·실험실) 진입
    onOpenInfrastructure?: () => void;
    // 현장 서베이 모드(동선 순서 권위값 입력) 진입
    onOpenFieldSurvey?: () => void;
    /** 사용자 오버라이드가 합성된 최종 사이트 정의 (카운트/표시용) */
    effectiveSites?: SiteDef[];
    /** 'all' = 전체장비, 'filtered' = 작업대상 대시보드 오픈 */
    onOpenDashboard?: (mode: 'all' | 'filtered') => void;
    /** 작업 대상 자산 개수 (필터 적용된 결과). filteredCount 와 다를 수 있음 */
    workTargetCount?: number;
    /** Phase 9: 통합 검색용 추가 데이터 */
    infraAssets?: Array<{ id: string; name: string; category?: string; model?: string; ip?: string; roomIds?: string[] }>;
    infraRooms?: Array<{ id: string; name: string; building: string; floor: string; type?: string; site?: string }>;
    companies?: Array<{ id: string; name: string; site?: string }>;
    /** 검색 결과에서 룸/자산 클릭 시 인프라 모달 + 룸 편집 진입 */
    onOpenRoomFromSearch?: (building: string, floor: string, roomName: string) => void;
    /** Quick Task 토글 — App.tsx 에서 단일 source of truth */
    disabledTaskIds?: Set<string>;
    onToggleTaskDisabled?: (id: string) => void;
}

export interface FilterTemplate {
    id: string;
    name: string;
    config: FilterConfig;
    createdAt: string;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
    allAssets,
    assets,
    filterConfig,
    templates,
    schemaProperties,
    currentSite,
    onChangeSite,
    onStartWork,
    onOpenFilter,
    onLoadTemplate,
    onSaveTemplate,
    onDeleteTemplate,
    onEditAsset,
    onQuickTask,
    onCombinedQuickTask,
    onTaskDashboard,
    onExport,
    onBulkUpdate,
    onSourceImport,
    onOpenDBManagement,
    onDashboard,
    onEditSiteRules,
    onRefresh,
    onSubmitFieldSupport,
    onMonthlyReset,
    onEditLayout,
    layoutsStore,
    onOpenRoomLayout,
    onOpenInfrastructure,
    onOpenFieldSurvey,
    effectiveSites,
    onOpenDashboard,
    workTargetCount,
    infraAssets,
    infraRooms,
    companies,
    onOpenRoomFromSearch,
    disabledTaskIds: disabledTaskIdsProp,
    onToggleTaskDisabled,
}) => {
    const sites = effectiveSites || SITES_DEFAULTS;
    const siteCounts = useMemo(
        () => getSiteCounts(allAssets, sites),
        [allAssets, sites]
    );
    // 개별 큐 펼침 토글 — 기본 접힘 (통합이 기본 워크플로우)
    const [showIndividualTasks, setShowIndividualTasks] = useState(false);
    // Quick Task 토글 — App.tsx 에서 prop 으로 받음 (대시보드와 공유)
    const disabledTaskIds = disabledTaskIdsProp || new Set<string>();
    const toggleTaskDisabled = onToggleTaskDisabled || (() => {});
    // 활성화된 Quick Task list (꺼진 것 제외)
    const enabledQuickTasks = useMemo(
        () => QUICK_TASKS.filter(t => !disabledTaskIds.has(t.id)),
        [disabledTaskIds]
    );
    // 통합 큐 대상 자산 수 + Quick Task 별 매칭 수 (활성화된 task 만 기준)
    const combinedStats = useMemo(() => {
        const matchedTaskCounts: Record<string, number> = {};
        let uniqueMatched = 0;
        for (const asset of assets) {
            const matched = getMatchingQuickTasks(asset, enabledQuickTasks);
            if (matched.length === 0) continue;
            uniqueMatched++;
            for (const t of matched) {
                matchedTaskCounts[t.id] = (matchedTaskCounts[t.id] || 0) + 1;
            }
        }
        // disabled 도 카운트는 보여주기 (전체 매칭 수)
        const fullCounts: Record<string, number> = {};
        for (const asset of assets) {
            const matched = getMatchingQuickTasks(asset);
            for (const t of matched) {
                fullCounts[t.id] = (fullCounts[t.id] || 0) + 1;
            }
        }
        return { uniqueMatched, matchedTaskCounts, fullCounts };
    }, [assets, enabledQuickTasks]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearchResults, setShowSearchResults] = useState(false);

    // 템플릿 관리 상태
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<FilterTemplate | null>(null);
    const [showTemplateMenu, setShowTemplateMenu] = useState(false);
    const [saveMode, setSaveMode] = useState<'new' | 'overwrite'>('new');

    // Title 필드 찾기
    const titleField = useMemo(() => {
        return Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name';
    }, [schemaProperties]);

    // [B] 동선 미마킹 검출 — 레이아웃에 기기는 있으나 방문순서(order) 안 매긴 연구실.
    const unmarkedRooms = useMemo(() => {
        const out: { building: string; floor: string; room: string; unmarked: number; total: number }[] = [];
        const rooms = layoutsStore?.rooms || {};
        for (const [key, rl] of Object.entries(rooms)) {
            const assets = (rl.objects || []).filter(o => o.type === 'asset');
            if (assets.length === 0) continue;
            const unmarked = assets.filter(o => typeof o.order !== 'number').length;
            if (unmarked > 0) {
                const { building, floor, room } = parseRoomKey(key);
                out.push({ building, floor, room, unmarked, total: assets.length });
            }
        }
        return out.sort((a, b) => b.unmarked - a.unmarked);
    }, [layoutsStore]);

    // [필수값] 필수 컬럼이 하나라도 비어있는 기기 (현재 사이트 컨텍스트 기준).
    const missingAssets = useMemo(() => {
        const out: { asset: Asset; name: string; missing: string[] }[] = [];
        for (const a of assets) {
            const v = a.values as any;
            const missing = REQUIRED_FIELDS.filter(f => !String(v[f.col] ?? '').trim()).map(f => f.label);
            if (missing.length) out.push({ asset: a, name: String(v[titleField] ?? '').trim() || '(이름없음)', missing });
        }
        return out;
    }, [assets, titleField]);
    // 누락 필드별 카운트 요약
    const missingByField = useMemo(() => {
        const c: Record<string, number> = {};
        for (const m of missingAssets) for (const f of m.missing) c[f] = (c[f] || 0) + 1;
        return c;
    }, [missingAssets]);

    // [거버넌스] 유효성·정합성 위반 (필수누락은 위 섹션이 담당 → 여기선 제외).
    //   잘못된 값('오프라인', 사이트 '기타')·정합성 모순(NAS+현장백업 등)을 검출.
    const govViolations = useMemo(() => {
        const out: { asset: Asset; name: string; msgs: string[] }[] = [];
        for (const a of assets) {
            const vs = validateAsset(a.values as any).filter(x => x.level !== 'required');
            if (vs.length) out.push({
                asset: a,
                name: String((a.values as any)[titleField] ?? '').trim() || '(이름없음)',
                msgs: vs.map(x => x.message),
            });
        }
        return out;
    }, [assets, titleField]);
    const govByRule = useMemo(() => {
        const c: Record<string, number> = {};
        for (const g of govViolations) for (const m of g.msgs) c[m] = (c[m] || 0) + 1;
        return c;
    }, [govViolations]);

    // [KPI] 2대 KPI(분기백업·백신) 타겟 분류 → 조치 필요(action) 자산 목록.
    const kpiActions = useMemo(() => {
        const backup: { asset: Asset; name: string; label: string; action: string }[] = [];
        const vaccine: { asset: Asset; name: string; label: string; action: string }[] = [];
        for (const a of assets) {
            const nm = String((a.values as any)[titleField] ?? '').trim() || '(이름없음)';
            const b = classifyBackupTarget(a.values as any);
            if (b.status === 'action') backup.push({ asset: a, name: nm, label: b.targetLabel, action: b.action });
            const vc = classifyVaccineTarget(a.values as any);
            if (vc.status === 'action') vaccine.push({ asset: a, name: nm, label: vc.targetLabel, action: vc.action });
        }
        return { backup, vaccine };
    }, [assets, titleField]);

    // [접고 펼치기] 홈 알람 섹션 — 화면 정리용. 기본 접힘.
    const [showUnmarked, setShowUnmarked] = useState(false);
    const [showMissing, setShowMissing] = useState(false);
    const [showGov, setShowGov] = useState(false);
    const [showKpiBk, setShowKpiBk] = useState(false);
    const [showKpiVac, setShowKpiVac] = useState(false);

    // 글로벌 검색 결과 — 자산만 (기존)
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];

        const query = searchQuery.toLowerCase();
        return assets.filter(asset => {
            return Object.values(asset.values).some(val =>
                String(val ?? '').toLowerCase().includes(query)
            );
        }).sort((a, b) => {
            const nameA = a.values[titleField] ?? '';
            const nameB = b.values[titleField] ?? '';
            return String(nameA).localeCompare(String(nameB), 'ko');
        });
    }, [assets, searchQuery, titleField]);

    // Phase 9: 통합 검색 — 네트워크 장비 / 공간 / 입주사
    const infraAssetResults = useMemo(() => {
        if (!searchQuery.trim() || !infraAssets) return [];
        const q = searchQuery.toLowerCase();
        return infraAssets.filter(a =>
            a.name.toLowerCase().includes(q) ||
            (a.model || '').toLowerCase().includes(q) ||
            (a.ip || '').toLowerCase().includes(q) ||
            (a.category || '').toLowerCase().includes(q)
        ).slice(0, 30);
    }, [infraAssets, searchQuery]);

    const roomResults = useMemo(() => {
        if (!searchQuery.trim() || !infraRooms) return [];
        const q = searchQuery.toLowerCase();
        return infraRooms.filter(r =>
            r.name.toLowerCase().includes(q) ||
            r.building.toLowerCase().includes(q) ||
            r.floor.toLowerCase().includes(q)
        ).slice(0, 30);
    }, [infraRooms, searchQuery]);

    const companyResults = useMemo(() => {
        if (!searchQuery.trim() || !companies) return [];
        const q = searchQuery.toLowerCase();
        return companies.filter(c => c.name.toLowerCase().includes(q)).slice(0, 15);
    }, [companies, searchQuery]);

    const totalResultCount = searchResults.length + infraAssetResults.length + roomResults.length + companyResults.length;

    // 필터 적용된 자산 수 계산
    const getFilteredCount = () => {
        if (!filterConfig) return assets.length;

        let result = assets;

        // 작업 대상 조건 적용 (그룹 및 중첩 논리 지원)
        const targetGroups = filterConfig.targetGroups || (filterConfig.targetConditions ? [{
            id: 'legacy-group',
            operator: filterConfig.targetLogicalOperator || 'and',
            conditions: filterConfig.targetConditions
        }] : []);

        if (targetGroups.length > 0) {
            const isGlobalOr = filterConfig.globalLogicalOperator === 'or';

            result = result.filter(asset => {
                const groupMatches = targetGroups.map(group => {
                    if (!group.conditions || group.conditions.length === 0) return true;

                    const isGroupOr = group.operator === 'or';
                    const conditionMatches = group.conditions.map(cond => {
                        const columnKey = String(cond.column ?? '');
                        const val = String(asset.values[columnKey] ?? '').toLowerCase();
                        switch (cond.type) {
                            case 'is_empty':
                                return !val || val === '';
                            case 'is_not_empty':
                                return val && val !== '';
                            case 'contains':
                                if (cond.values && cond.values.length > 0) {
                                    return cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
                                }
                                return true;
                            case 'not_contains':
                                if (cond.values && cond.values.length > 0) {
                                    return !cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
                                }
                                return true;
                            case 'equals':
                                if (cond.values && cond.values.length > 0) {
                                    return cond.values.some(v => val === String(v ?? '').toLowerCase());
                                }
                                return true;
                            case 'text_contains':
                                if (cond.values && cond.values.length > 0) {
                                    return cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
                                }
                                return true;
                            case 'text_not_contains':
                                if (!val || val === '') return true;
                                if (cond.values && cond.values.length > 0) {
                                    return !cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
                                }
                                return true;
                            default:
                                return true;
                        }
                    });

                    return isGroupOr ? conditionMatches.some(m => m) : conditionMatches.every(m => m);
                });

                return isGlobalOr ? groupMatches.some(m => m) : groupMatches.every(m => m);
            });
        }
        return result.length;
    };

    const filteredCount = getFilteredCount();
    const hasFilter = filterConfig !== null;

    const handleSearch = () => {
        if (searchQuery.trim()) {
            setShowSearchResults(true);
        }
    };

    // 새 템플릿 저장
    const handleSaveNew = () => {
        setSaveMode('new');
        setTemplateName('');
        setShowSaveModal(true);
    };

    // 템플릿 덮어쓰기
    const handleOverwrite = (template: FilterTemplate) => {
        setSaveMode('overwrite');
        setSelectedTemplate(template);
        setTemplateName(template.name);
        setShowSaveModal(true);
        setShowTemplateMenu(false);
    };

    // 템플릿 복제
    const handleDuplicate = (template: FilterTemplate) => {
        onLoadTemplate(template);
        setSaveMode('new');
        setTemplateName(`${template.name} (복사)`);
        setShowSaveModal(true);
        setShowTemplateMenu(false);
    };

    // 템플릿 삭제
    const handleDelete = (template: FilterTemplate) => {
        if (Platform.OS === 'web') {
            // 웹에서는 window.confirm 사용 (Alert.alert의 버튼이 작동하지 않음)
            const confirmed = window.confirm(`"${template.name}" 템플릿을 삭제하시겠습니까?`);
            if (confirmed) {
                onDeleteTemplate(template.id);
                setShowTemplateMenu(false);
                setSelectedTemplate(null);
            }
        } else {
            Alert.alert(
                '템플릿 삭제',
                `"${template.name}" 템플릿을 삭제하시겠습니까?`,
                [
                    { text: '취소', style: 'cancel' },
                    {
                        text: '삭제',
                        style: 'destructive',
                        onPress: () => {
                            onDeleteTemplate(template.id);
                            setShowTemplateMenu(false);
                            setSelectedTemplate(null);
                        }
                    }
                ]
            );
        }
    };

    // 저장 확인
    const confirmSave = () => {
        if (!templateName.trim()) {
            Alert.alert('오류', '템플릿 이름을 입력하세요.');
            return;
        }

        if (saveMode === 'overwrite' && selectedTemplate) {
            onSaveTemplate(templateName.trim(), selectedTemplate.id);
        } else {
            onSaveTemplate(templateName.trim());
        }

        setShowSaveModal(false);
        setTemplateName('');
        setSelectedTemplate(null);
    };

    // 템플릿 메뉴 열기
    const openTemplateMenu = (template: FilterTemplate) => {
        setSelectedTemplate(template);
        setShowTemplateMenu(true);
    };

    return (
        <>
            <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
                {/* 헤더 */}
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title}>NEXUS ITAM</Text>
                        <Text style={styles.subtitle}>현장 작업 관리</Text>
                    </View>
                    {/* [Shell 통합] ATLAS (업무) 진입 — 새 탭. 데이터·계정 분리 유지. */}
                    <TouchableOpacity
                        style={[styles.headerRefreshBtn, { marginRight: 8, backgroundColor: '#eef2ff', borderColor: '#c7d2fe' }]}
                        onPress={() => {
                            try {
                                if (typeof window !== 'undefined' && window.open) {
                                    window.open('https://ai-notion-task.vercel.app', '_blank');
                                }
                            } catch {}
                        }}
                        activeOpacity={0.7}
                    >
                        <ExternalLink size={16} color="#6366f1" />
                    </TouchableOpacity>
                    {onRefresh && (
                        <TouchableOpacity
                            style={styles.headerRefreshBtn}
                            onPress={onRefresh}
                            activeOpacity={0.7}
                        >
                            <RefreshCw size={16} color="#475569" />
                        </TouchableOpacity>
                    )}
                </View>

                {/* 사이트(장소) 토글 — 메인 컨텍스트 */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.siteToggleScroll}
                    contentContainerStyle={styles.siteToggleRow}
                >
                    {sites.map(site => {
                        const active = currentSite === site.id;
                        const count = siteCounts[site.id];
                        return (
                            <TouchableOpacity
                                key={site.id}
                                style={[
                                    styles.siteChip,
                                    active && { backgroundColor: site.color, borderColor: site.color },
                                ]}
                                onPress={() => onChangeSite(site.id)}
                                activeOpacity={0.7}
                            >
                                {site.emoji ? (
                                    <Text style={[styles.siteChipEmoji, !active && { opacity: 0.7 }]}>
                                        {site.emoji}
                                    </Text>
                                ) : null}
                                <Text style={[styles.siteChipName, active && { color: '#ffffff' }]}>
                                    {site.name}
                                </Text>
                                <Text
                                    style={[
                                        styles.siteChipCount,
                                        active && {
                                            color: site.color,
                                            backgroundColor: '#ffffff',
                                        },
                                    ]}
                                >
                                    {count}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {/* 글로벌 검색 */}
                <View style={styles.searchSection}>
                    <View style={styles.searchInputContainer}>
                        <Search size={20} color="#9ca3af" />
                        <TextInput
                            style={styles.searchInput}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="통합 검색 (자산 · 네트워크 장비 · 공간 · 입주사)"
                            placeholderTextColor="#9ca3af"
                            onSubmitEditing={handleSearch}
                            returnKeyType="search"
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <X size={18} color="#9ca3af" />
                            </TouchableOpacity>
                        )}
                    </View>
                    {searchQuery.trim() && (
                        <TouchableOpacity
                            style={styles.searchButton}
                            onPress={handleSearch}
                        >
                            <Text style={styles.searchButtonText}>
                                검색 ({totalResultCount}건)
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* 통계 카드 — 클릭하면 해당 자산셋의 대시보드가 열림 */}
                <View style={styles.statsContainer}>
                    <TouchableOpacity
                        style={styles.statCard}
                        onPress={() => onOpenDashboard?.('all')}
                        disabled={!onOpenDashboard}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.statNumber}>{assets.length}</Text>
                        <Text style={styles.statLabel}>전체 장비</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.statCard, styles.statCardHighlight]}
                        onPress={() => onOpenDashboard?.('filtered')}
                        disabled={!onOpenDashboard}
                        activeOpacity={0.85}
                    >
                        <Text style={[styles.statNumber, styles.statNumberHighlight]}>
                            {workTargetCount ?? filteredCount}
                        </Text>
                        <Text style={[styles.statLabel, styles.statLabelHighlight]}>작업 대상</Text>
                    </TouchableOpacity>
                </View>

                {/* 달성률 */}
                {hasFilter && assets.length > 0 && (
                    <View style={styles.progressSection}>
                        <View style={styles.progressHeader}>
                            <Text style={styles.progressLabel}>달성률</Text>
                            <Text style={styles.progressPercent}>
                                {Math.round(((assets.length - filteredCount) / assets.length) * 100)}%
                            </Text>
                        </View>
                        <View style={styles.progressBarBackground}>
                            <View
                                style={[
                                    styles.progressBarFill,
                                    { width: `${((assets.length - filteredCount) / assets.length) * 100}%` }
                                ]}
                            />
                        </View>
                        <Text style={styles.progressDetail}>
                            {assets.length - filteredCount}개 완료 / {assets.length}개 전체
                        </Text>
                    </View>
                )}

                {/* [필수값] 누락 알람 — 존재 필수 컬럼(위치·담당자·망구분) 비어있는 기기. 접고 펼치기 */}
                {missingAssets.length > 0 && (
                    <View style={styles.alarmSection}>
                        <TouchableOpacity style={styles.alarmHeader} onPress={() => setShowMissing(v => !v)}>
                            <Text style={styles.alarmTitle}>⚠️ 필수값 누락 {missingAssets.length}대</Text>
                            <Text style={styles.alarmSummary}>  {Object.entries(missingByField).map(([k, n]) => `${k} ${n}`).join(' · ')}</Text>
                            <View style={{ flex: 1 }} />
                            <Text style={styles.alarmCaret}>{showMissing ? '▾' : '▸'}</Text>
                        </TouchableOpacity>
                        {showMissing && missingAssets.slice(0, 40).map((m, i) => (
                            <TouchableOpacity
                                key={`miss-${m.asset.id}-${i}`}
                                style={styles.alarmRow}
                                onPress={() => onEditAsset(m.asset)}
                            >
                                <Text style={styles.alarmName}>{m.name}</Text>
                                <View style={{ flex: 1 }} />
                                <Text style={styles.alarmMissing}>{m.missing.join('·')} 없음</Text>
                                <Text style={styles.unmarkedArrow}>›</Text>
                            </TouchableOpacity>
                        ))}
                        {showMissing && missingAssets.length > 40 && (
                            <Text style={styles.alarmMore}>외 {missingAssets.length - 40}대… (필터로 전체 보기)</Text>
                        )}
                    </View>
                )}

                {/* [KPI] 분기데이터백업 — 조치 필요(타겟 분류별 다음 액션) */}
                {kpiActions.backup.length > 0 && (
                    <View style={styles.alarmSection}>
                        <TouchableOpacity style={styles.alarmHeader} onPress={() => setShowKpiBk(v => !v)}>
                            <Text style={styles.alarmTitle}>💾 분기백업 조치 {kpiActions.backup.length}대</Text>
                            <View style={{ flex: 1 }} />
                            <Text style={styles.alarmCaret}>{showKpiBk ? '▾' : '▸'}</Text>
                        </TouchableOpacity>
                        {showKpiBk && kpiActions.backup.slice(0, 50).map((m, i) => (
                            <TouchableOpacity key={`kbk-${m.asset.id}-${i}`} style={styles.alarmRow} onPress={() => onEditAsset(m.asset)}>
                                <View style={{ flex: 1, gap: 2 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <Text style={styles.alarmName}>{m.name}</Text>
                                        <Text style={{ fontSize: 10, color: '#64748b' }}>{m.label}</Text>
                                    </View>
                                    <Text style={[styles.alarmMissing, { fontWeight: '500' }]}>{m.action}</Text>
                                </View>
                                <Text style={styles.unmarkedArrow}>›</Text>
                            </TouchableOpacity>
                        ))}
                        {showKpiBk && kpiActions.backup.length > 50 && <Text style={styles.alarmMore}>외 {kpiActions.backup.length - 50}대…</Text>}
                    </View>
                )}

                {/* [KPI] 백신업데이트(알약+V3) — 조치 필요 */}
                {kpiActions.vaccine.length > 0 && (
                    <View style={styles.alarmSection}>
                        <TouchableOpacity style={styles.alarmHeader} onPress={() => setShowKpiVac(v => !v)}>
                            <Text style={styles.alarmTitle}>🛡 백신 조치 {kpiActions.vaccine.length}대</Text>
                            <View style={{ flex: 1 }} />
                            <Text style={styles.alarmCaret}>{showKpiVac ? '▾' : '▸'}</Text>
                        </TouchableOpacity>
                        {showKpiVac && kpiActions.vaccine.slice(0, 50).map((m, i) => (
                            <TouchableOpacity key={`kvc-${m.asset.id}-${i}`} style={styles.alarmRow} onPress={() => onEditAsset(m.asset)}>
                                <View style={{ flex: 1, gap: 2 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <Text style={styles.alarmName}>{m.name}</Text>
                                        <Text style={{ fontSize: 10, color: '#64748b' }}>{m.label}</Text>
                                    </View>
                                    <Text style={[styles.alarmMissing, { fontWeight: '500' }]}>{m.action}</Text>
                                </View>
                                <Text style={styles.unmarkedArrow}>›</Text>
                            </TouchableOpacity>
                        ))}
                        {showKpiVac && kpiActions.vaccine.length > 50 && <Text style={styles.alarmMore}>외 {kpiActions.vaccine.length - 50}대…</Text>}
                    </View>
                )}

                {/* [거버넌스] 유효성·정합성 위반 — 잘못된 값('오프라인'·사이트 기타)·교차 모순(NAS+현장백업 등) */}
                {govViolations.length > 0 && (
                    <View style={styles.alarmSection}>
                        <TouchableOpacity style={styles.alarmHeader} onPress={() => setShowGov(v => !v)}>
                            <Text style={styles.alarmTitle}>🚨 거버넌스 위반 {govViolations.length}대</Text>
                            <Text style={styles.alarmSummary}>  {Object.entries(govByRule).slice(0, 4).map(([k, n]) => `${k.slice(0, 14)} ${n}`).join(' · ')}</Text>
                            <View style={{ flex: 1 }} />
                            <Text style={styles.alarmCaret}>{showGov ? '▾' : '▸'}</Text>
                        </TouchableOpacity>
                        {showGov && govViolations.slice(0, 40).map((g, i) => (
                            <TouchableOpacity
                                key={`gov-${g.asset.id}-${i}`}
                                style={styles.alarmRow}
                                onPress={() => onEditAsset(g.asset)}
                            >
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={styles.alarmName}>{g.name}</Text>
                                    <Text style={[styles.alarmMissing, { fontWeight: '500' }]}>{g.msgs.join(' · ')}</Text>
                                </View>
                                <Text style={styles.unmarkedArrow}>›</Text>
                            </TouchableOpacity>
                        ))}
                        {showGov && govViolations.length > 40 && (
                            <Text style={styles.alarmMore}>외 {govViolations.length - 40}대…</Text>
                        )}
                    </View>
                )}

                {/* [B] 동선 미마킹 검출 — 순서 안 매긴 연구실. 접고 펼치기. 클릭 시 그 방 레이아웃 편집기로 */}
                {unmarkedRooms.length > 0 && (
                    <View style={styles.unmarkedSection}>
                        <TouchableOpacity style={styles.alarmHeader} onPress={() => setShowUnmarked(v => !v)}>
                            <Text style={styles.unmarkedTitle}>🧭 동선 미마킹 {unmarkedRooms.length}곳</Text>
                            <View style={{ flex: 1 }} />
                            <Text style={styles.alarmCaret}>{showUnmarked ? '▾' : '▸'}</Text>
                        </TouchableOpacity>
                        {showUnmarked && unmarkedRooms.map((r, i) => (
                            <TouchableOpacity
                                key={`${r.building}/${r.floor}/${r.room}/${i}`}
                                style={styles.unmarkedRow}
                                onPress={() => onOpenRoomLayout?.(r.building, r.floor, r.room)}
                                disabled={!onOpenRoomLayout}
                            >
                                <Text style={styles.unmarkedRoomText}>📍 {r.building} · {r.floor} · {r.room}</Text>
                                <View style={{ flex: 1 }} />
                                <Text style={styles.unmarkedCount}>미마킹 {r.unmarked}/{r.total}</Text>
                                <Text style={styles.unmarkedArrow}>›</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}

                {/* 도구 섹션 — DB 관리로 묶고 / 테이블로 보기 / 과제 대시보드 / 현장지원 / 사이트 설정 */}
                <View style={styles.toolsSection}>
                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onSubmitFieldSupport}
                        disabled={!onSubmitFieldSupport}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#fee2e2' }]}>
                            <Wrench size={22} color="#dc2626" />
                        </View>
                        <Text style={styles.toolLabel}>현장지원 접수</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onTaskDashboard}
                        disabled={!onTaskDashboard}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#dbeafe' }]}>
                            <Text style={{ fontSize: 22 }}>📊</Text>
                        </View>
                        <Text style={styles.toolLabel}>과제 대시보드</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onDashboard}
                        disabled={!onDashboard}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#fce7f3' }]}>
                            <LayoutGrid size={22} color="#be185d" />
                        </View>
                        <Text style={styles.toolLabel}>테이블로 보기</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onOpenDBManagement}
                        disabled={!onOpenDBManagement}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#e0f2fe' }]}>
                            <Database size={22} color="#0369a1" />
                        </View>
                        <Text style={styles.toolLabel}>DB 관리</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onMonthlyReset}
                        disabled={!onMonthlyReset}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#fef3c7' }]}>
                            <CalendarClock size={22} color="#a16207" />
                        </View>
                        <Text style={styles.toolLabel}>정기 초기화</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onOpenInfrastructure}
                        disabled={!onOpenInfrastructure}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#e0f2fe' }]}>
                            <Building2 size={22} color="#0369a1" />
                        </View>
                        <Text style={styles.toolLabel}>인프라 · 레이아웃</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onOpenFieldSurvey}
                        disabled={!onOpenFieldSurvey}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#ede9fe' }]}>
                            <MapPin size={22} color="#6d28d9" />
                        </View>
                        <Text style={styles.toolLabel}>현장 서베이</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onEditSiteRules}
                        disabled={!onEditSiteRules}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#e0e7ff' }]}>
                            <Settings2 size={22} color="#4338ca" />
                        </View>
                        <Text style={styles.toolLabel}>사이트 설정</Text>
                    </TouchableOpacity>
                </View>

                {/* Quick Task — 메인 통합 카드 + 개별 큐 펼침 */}
                {onQuickTask && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>정기 / 현장 업무</Text>
                        </View>

                        {/* 메인 통합 카드 */}
                        {onCombinedQuickTask && (
                            <TouchableOpacity
                                style={styles.combinedCard}
                                onPress={() => onCombinedQuickTask(enabledQuickTasks.map(t => t.id))}
                                activeOpacity={0.85}
                            >
                                <View style={styles.combinedHeader}>
                                    <Text style={styles.combinedEmoji}>🚶</Text>
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text style={styles.combinedName} numberOfLines={1}>
                                            현장 통합 작업
                                        </Text>
                                        <Text style={styles.combinedDesc} numberOfLines={2}>
                                            모든 정기 업무를 합쳐 한 동선으로 처리
                                        </Text>
                                    </View>
                                    <View style={styles.combinedCountBadge}>
                                        <Text style={styles.combinedCountNum}>
                                            {combinedStats.uniqueMatched}
                                        </Text>
                                        <Text style={styles.combinedCountLabel}>대상</Text>
                                    </View>
                                </View>
                                {onTaskDashboard && (
                                    <TouchableOpacity
                                        style={styles.combinedDashboardBtn}
                                        onPress={(e) => {
                                            (e as any).stopPropagation?.();
                                            onTaskDashboard();
                                        }}
                                    >
                                        <Text style={styles.combinedDashboardBtnText}>📊 대시보드로 보기</Text>
                                    </TouchableOpacity>
                                )}
                                <View style={styles.combinedBreakdown}>
                                    {QUICK_TASKS.map(t => {
                                        // 활성화된 task 의 매칭 수 / 전체 매칭 수 둘 다 표시 가능
                                        const cnt = combinedStats.matchedTaskCounts[t.id] || 0;
                                        const fullCnt = combinedStats.fullCounts[t.id] || 0;
                                        const off = disabledTaskIds.has(t.id);
                                        const dim = !off && cnt === 0;
                                        const displayCnt = off ? fullCnt : cnt;
                                        return (
                                            <TouchableOpacity
                                                key={t.id}
                                                style={[
                                                    styles.combinedChip,
                                                    { backgroundColor: t.bgColor },
                                                    dim && styles.combinedChipDim,
                                                    off && {
                                                        opacity: 0.35,
                                                        backgroundColor: '#e5e7eb',
                                                    },
                                                ]}
                                                onPress={(e) => {
                                                    (e as any).stopPropagation?.();
                                                    // 일반 탭 = task 끄기/켜기 토글 (모든 task 적용)
                                                    toggleTaskDisabled(t.id);
                                                }}
                                                onLongPress={(e) => {
                                                    // 길게 누름 + 0대인 경우 = 정기 초기화 진입
                                                    (e as any).stopPropagation?.();
                                                    if (dim && onMonthlyReset) onMonthlyReset();
                                                }}
                                                activeOpacity={0.6}
                                            >
                                                <Text style={[styles.combinedChipEmoji, off && { textDecorationLine: 'line-through' as any }]}>{t.emoji}</Text>
                                                <Text style={[
                                                    styles.combinedChipName,
                                                    { color: off ? '#6b7280' : t.color },
                                                    off && { textDecorationLine: 'line-through' as any },
                                                ]} numberOfLines={1}>
                                                    {t.name}
                                                </Text>
                                                <Text style={[styles.combinedChipCount, { color: off ? '#6b7280' : t.color }]}>
                                                    {displayCnt}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                                {disabledTaskIds.size > 0 && (
                                    <View style={[styles.combinedHint, { backgroundColor: '#f3f4f6', borderColor: '#d1d5db' }]}>
                                        <Text style={[styles.combinedHintText, { color: '#374151' }]}>
                                            🚫 꺼진 과제 {disabledTaskIds.size}개 — 칩을 다시 탭하면 켜짐
                                        </Text>
                                    </View>
                                )}
                                {Object.values(combinedStats.matchedTaskCounts).filter(n => n > 0).length < QUICK_TASKS.length && onMonthlyReset && (
                                    <View style={styles.combinedHint}>
                                        <Text style={styles.combinedHintText}>
                                            💡 0대인 사이클은 칩 길게 누르면 '정기 초기화'로 이동
                                        </Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        )}

                        {/* 개별 큐 펼침 토글 */}
                        <TouchableOpacity
                            style={styles.individualToggle}
                            onPress={() => setShowIndividualTasks(v => !v)}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.individualToggleText}>
                                {showIndividualTasks ? '▼' : '▶'} 개별 큐로 보기
                            </Text>
                        </TouchableOpacity>

                        {/* 개별 Quick Task (그룹별) — 토글 시 표시 */}
                        {showIndividualTasks && (() => {
                            const groupOrder: string[] = [];
                            const byGroup: Record<string, typeof QUICK_TASKS> = {};
                            QUICK_TASKS.forEach(t => {
                                if (!byGroup[t.group]) {
                                    byGroup[t.group] = [];
                                    groupOrder.push(t.group);
                                }
                                byGroup[t.group].push(t);
                            });
                            return (
                                <View style={{ marginTop: 12 }}>
                                    {groupOrder.map(group => (
                                        <View key={group} style={styles.quickTaskGroupBlock}>
                                            <Text style={styles.quickTaskGroupLabel}>{group}</Text>
                                            <View style={styles.quickTaskGrid}>
                                                {byGroup[group].map(task => (
                                                    <TouchableOpacity
                                                        key={task.id}
                                                        style={[styles.quickTaskCard, { backgroundColor: task.bgColor }]}
                                                        onPress={() => onQuickTask(task)}
                                                        activeOpacity={0.7}
                                                    >
                                                        <Text style={styles.quickTaskEmoji}>{task.emoji}</Text>
                                                        <Text style={[styles.quickTaskName, { color: task.color }]} numberOfLines={2}>
                                                            {task.name}
                                                        </Text>
                                                        <Text style={styles.quickTaskDesc} numberOfLines={2}>
                                                            {task.description}
                                                        </Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            );
                        })()}
                    </View>
                )}

                {/* 현재 필터 요약 */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>현재 필터 설정</Text>
                        <TouchableOpacity onPress={onOpenFilter}>
                            <Settings2 size={20} color="#6366f1" />
                        </TouchableOpacity>
                    </View>

                    {hasFilter ? (
                        <View style={styles.filterSummary}>
                            {filterConfig.locationHierarchy && filterConfig.locationHierarchy.length > 0 && (
                                <View style={styles.filterItem}>
                                    <MapPin size={16} color="#6366f1" />
                                    <Text style={styles.filterItemLabel}>위치 계층:</Text>
                                    <Text style={styles.filterItemValue}>
                                        {filterConfig.locationHierarchy.join(' → ')}
                                    </Text>
                                </View>
                            )}

                            {filterConfig.sortColumn && (
                                <View style={styles.filterItem}>
                                    <ArrowUpDown size={16} color="#6366f1" />
                                    <Text style={styles.filterItemLabel}>정렬:</Text>
                                    <Text style={styles.filterItemValue}>{filterConfig.sortColumn}</Text>
                                </View>
                            )}

                            {(() => {
                                const totalConditions = (filterConfig.targetGroups?.reduce((acc, g) => acc + (g.conditions?.length || 0), 0) || 0) +
                                    (filterConfig.targetConditions?.length || 0);
                                return totalConditions > 0 ? (
                                    <View style={styles.filterItem}>
                                        <Target size={16} color="#6366f1" />
                                        <Text style={styles.filterItemLabel}>작업 조건:</Text>
                                        <Text style={styles.filterItemValue}>
                                            {totalConditions}개
                                        </Text>
                                    </View>
                                ) : null;
                            })()}

                            {filterConfig.editableFields && filterConfig.editableFields.length > 0 && (
                                <View style={styles.filterItem}>
                                    <Edit3 size={16} color="#6366f1" />
                                    <Text style={styles.filterItemLabel}>편집 필드:</Text>
                                    <Text style={styles.filterItemValue}>
                                        {filterConfig.editableFields.length}개
                                    </Text>
                                </View>
                            )}
                        </View>
                    ) : (
                        <View style={styles.noFilter}>
                            <Text style={styles.noFilterText}>필터가 설정되지 않았습니다</Text>
                            <TouchableOpacity style={styles.setFilterButton} onPress={onOpenFilter}>
                                <Text style={styles.setFilterButtonText}>필터 설정하기</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {/* 저장된 템플릿 */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>저장된 템플릿</Text>
                        {hasFilter && (
                            <TouchableOpacity onPress={handleSaveNew} style={styles.saveButton}>
                                <Bookmark size={16} color="#ffffff" />
                                <Text style={styles.saveButtonText}>새로 저장</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {templates.length > 0 ? (
                        <View style={styles.templateList}>
                            {templates.map(template => (
                                <View key={template.id} style={styles.templateItem}>
                                    <TouchableOpacity
                                        style={styles.templateMain}
                                        onPress={() => onLoadTemplate(template)}
                                    >
                                        <View style={styles.templateInfo}>
                                            <Text style={styles.templateName}>{template.name}</Text>
                                            <Text style={styles.templateDate}>{template.createdAt}</Text>
                                        </View>
                                        <Play size={18} color="#6366f1" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.templateDeleteButton}
                                        onPress={() => handleDelete(template)}
                                    >
                                        <Trash2 size={16} color="#9ca3af" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.templateMenuButton}
                                        onPress={() => openTemplateMenu(template)}
                                    >
                                        <MoreVertical size={18} color="#9ca3af" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Text style={styles.noTemplates}>저장된 템플릿이 없습니다</Text>
                    )}
                </View>

                {/* 현장 작업 시작 버튼 */}
                <TouchableOpacity
                    style={[styles.startButton, !hasFilter && styles.startButtonDisabled]}
                    onPress={onStartWork}
                    disabled={!hasFilter}
                >
                    <Play size={24} color="#ffffff" />
                    <Text style={styles.startButtonText}>현장 작업 시작</Text>
                    <Text style={styles.startButtonSubtext}>
                        {hasFilter ? `${filteredCount}개 장비` : '먼저 필터를 설정하세요'}
                    </Text>
                </TouchableOpacity>

                {/* 버전 정보 */}
                <View style={styles.versionBadge}>
                    <Text style={styles.versionText}>{APP_VERSION}</Text>
                </View>
            </ScrollView>

            {/* 검색 결과 모달 */}
            <Modal visible={showSearchResults} animationType="slide" presentationStyle="pageSheet">
                <View style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>
                            검색 결과 ({totalResultCount}건)
                        </Text>
                        <TouchableOpacity onPress={() => setShowSearchResults(false)}>
                            <X size={24} color="#6b7280" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.modalSearchInfo}>
                        <Search size={16} color="#6b7280" />
                        <Text style={styles.modalSearchText}>"{searchQuery}"</Text>
                    </View>

                    <ScrollView style={styles.resultsList}>
                        {/* 📦 자산 (실험기기) */}
                        {searchResults.length > 0 && (
                            <Text style={{
                                fontSize: 12, fontWeight: '800', color: '#475569',
                                paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
                                backgroundColor: '#f8fafc',
                            }}>
                                📦 자산 · 실험기기 ({searchResults.length})
                            </Text>
                        )}
                        {searchResults.map(asset => (
                            <TouchableOpacity
                                key={asset.id}
                                style={styles.resultItem}
                                onPress={() => {
                                    setShowSearchResults(false);
                                    onEditAsset(asset);
                                }}
                            >
                                <View style={styles.resultInfo}>
                                    <Text style={styles.resultName}>
                                        {asset.values[titleField] || '(이름 없음)'}
                                    </Text>
                                    <Text style={styles.resultPreview} numberOfLines={1}>
                                        {Object.entries(asset.values)
                                            .filter(([k]) => k !== titleField)
                                            .slice(0, 3)
                                            .map(([k, v]) => `${k}: ${v}`)
                                            .join(' | ')}
                                    </Text>
                                </View>
                                <ChevronRight size={18} color="#9ca3af" />
                            </TouchableOpacity>
                        ))}

                        {/* 🔧 네트워크 장비 (InfraAssets) */}
                        {infraAssetResults.length > 0 && (
                            <Text style={{
                                fontSize: 12, fontWeight: '800', color: '#475569',
                                paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
                                backgroundColor: '#f8fafc',
                            }}>
                                🔧 네트워크 장비 ({infraAssetResults.length})
                            </Text>
                        )}
                        {infraAssetResults.map(a => {
                            // 첫 번째 룸을 찾아 위치 표시
                            const linkedRoom = (a.roomIds || []).map(rid => (infraRooms || []).find(r => r.id === rid)).find(Boolean);
                            return (
                                <TouchableOpacity
                                    key={a.id}
                                    style={styles.resultItem}
                                    onPress={() => {
                                        setShowSearchResults(false);
                                        if (linkedRoom && onOpenRoomFromSearch) {
                                            onOpenRoomFromSearch(linkedRoom.building, linkedRoom.floor, linkedRoom.name);
                                        }
                                    }}
                                >
                                    <View style={styles.resultInfo}>
                                        <Text style={styles.resultName}>
                                            {a.name}
                                            {a.category && (
                                                <Text style={{ fontSize: 10, color: '#0369a1', fontWeight: '700' }}>  · {a.category}</Text>
                                            )}
                                        </Text>
                                        <Text style={styles.resultPreview} numberOfLines={1}>
                                            {[a.model, a.ip, linkedRoom ? `📍 ${linkedRoom.building} · ${linkedRoom.floor} · ${linkedRoom.name}` : ''].filter(Boolean).join(' · ')}
                                        </Text>
                                    </View>
                                    <ChevronRight size={18} color="#9ca3af" />
                                </TouchableOpacity>
                            );
                        })}

                        {/* 🏢 공간 (미팅룸/실험실/서버실 등) */}
                        {roomResults.length > 0 && (
                            <Text style={{
                                fontSize: 12, fontWeight: '800', color: '#475569',
                                paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
                                backgroundColor: '#f8fafc',
                            }}>
                                🏢 공간 ({roomResults.length})
                            </Text>
                        )}
                        {roomResults.map(r => {
                            const typeEmoji = r.type === 'meeting-room' ? '🤝'
                                : r.type === 'server-room' ? '🖥️'
                                : r.type === 'office' ? '💼'
                                : r.type === 'other' ? '📦' : '🧪';
                            return (
                                <TouchableOpacity
                                    key={r.id}
                                    style={styles.resultItem}
                                    onPress={() => {
                                        setShowSearchResults(false);
                                        if (onOpenRoomFromSearch) {
                                            onOpenRoomFromSearch(r.building, r.floor, r.name);
                                        }
                                    }}
                                >
                                    <View style={styles.resultInfo}>
                                        <Text style={styles.resultName}>
                                            {typeEmoji} {r.name}
                                        </Text>
                                        <Text style={styles.resultPreview} numberOfLines={1}>
                                            {r.site ? `${r.site} · ` : ''}{r.building} · {r.floor}
                                        </Text>
                                    </View>
                                    <ChevronRight size={18} color="#9ca3af" />
                                </TouchableOpacity>
                            );
                        })}

                        {/* 🏭 입주사 */}
                        {companyResults.length > 0 && (
                            <Text style={{
                                fontSize: 12, fontWeight: '800', color: '#475569',
                                paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
                                backgroundColor: '#f8fafc',
                            }}>
                                🏭 입주사 ({companyResults.length})
                            </Text>
                        )}
                        {companyResults.map(c => (
                            <View key={c.id} style={styles.resultItem}>
                                <View style={styles.resultInfo}>
                                    <Text style={styles.resultName}>🏭 {c.name}</Text>
                                    {c.site && (
                                        <Text style={styles.resultPreview}>{c.site}</Text>
                                    )}
                                </View>
                            </View>
                        ))}

                        {totalResultCount === 0 && (
                            <View style={styles.noResults}>
                                <Text style={styles.noResultsText}>검색 결과가 없습니다</Text>
                            </View>
                        )}
                    </ScrollView>
                </View>
            </Modal>

            {/* 템플릿 저장 모달 */}
            <Modal visible={showSaveModal} transparent animationType="fade">
                <View style={styles.saveModalOverlay}>
                    <View style={styles.saveModalContent}>
                        <Text style={styles.saveModalTitle}>
                            {saveMode === 'overwrite' ? '템플릿 덮어쓰기' : '새 템플릿 저장'}
                        </Text>
                        <TextInput
                            style={styles.saveModalInput}
                            value={templateName}
                            onChangeText={setTemplateName}
                            placeholder="템플릿 이름"
                            placeholderTextColor="#9ca3af"
                            autoFocus
                        />
                        <View style={styles.saveModalButtons}>
                            <TouchableOpacity
                                style={[styles.saveModalButton, styles.saveModalButtonCancel]}
                                onPress={() => {
                                    setShowSaveModal(false);
                                    setTemplateName('');
                                }}
                            >
                                <Text style={styles.saveModalButtonCancelText}>취소</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.saveModalButton, styles.saveModalButtonConfirm]}
                                onPress={confirmSave}
                            >
                                <Text style={styles.saveModalButtonConfirmText}>
                                    {saveMode === 'overwrite' ? '덮어쓰기' : '저장'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* 템플릿 메뉴 모달 */}
            <Modal visible={showTemplateMenu} transparent animationType="fade">
                <TouchableOpacity
                    style={styles.menuOverlay}
                    activeOpacity={1}
                    onPress={() => setShowTemplateMenu(false)}
                >
                    <View style={styles.menuContent}>
                        <Text style={styles.menuTitle}>{selectedTemplate?.name}</Text>

                        <TouchableOpacity
                            style={styles.menuItem}
                            onPress={() => {
                                if (selectedTemplate) {
                                    onLoadTemplate(selectedTemplate);
                                    setShowTemplateMenu(false);
                                }
                            }}
                        >
                            <Play size={20} color="#1f2937" />
                            <Text style={styles.menuItemText}>적용하기</Text>
                        </TouchableOpacity>

                        {hasFilter && (
                            <TouchableOpacity
                                style={styles.menuItem}
                                onPress={() => selectedTemplate && handleOverwrite(selectedTemplate)}
                            >
                                <Edit size={20} color="#1f2937" />
                                <Text style={styles.menuItemText}>현재 설정으로 덮어쓰기</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={styles.menuItem}
                            onPress={() => selectedTemplate && handleDuplicate(selectedTemplate)}
                        >
                            <Copy size={20} color="#1f2937" />
                            <Text style={styles.menuItemText}>복제하기</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.menuItem, styles.menuItemDanger]}
                            onPress={() => selectedTemplate && handleDelete(selectedTemplate)}
                        >
                            <Trash2 size={20} color="#ef4444" />
                            <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>삭제</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>
        </>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    containerContent: {
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    headerRefreshBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    subtitle: {
        fontSize: 16,
        color: '#6b7280',
        marginTop: 4,
    },
    searchSection: {
        marginBottom: 20,
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: '#1f2937',
    },
    searchButton: {
        backgroundColor: '#6366f1',
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 10,
    },
    searchButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    siteToggleScroll: {
        marginBottom: 16,
        marginHorizontal: -4,
    },
    siteToggleRow: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 4,
    },
    siteChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#ffffff',
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: '#e5e7eb',
    },
    siteChipEmoji: { fontSize: 14 },
    siteChipName: { fontSize: 13, fontWeight: '600', color: '#1f2937' },
    siteChipCount: {
        fontSize: 11,
        color: '#9ca3af',
        backgroundColor: '#f1f5f9',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 8,
        overflow: 'hidden',
        fontWeight: '700',
    },
    toolsSection: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 20,
        flexWrap: 'wrap',
    },
    // [B] 동선 미마킹 섹션
    unmarkedSection: {
        backgroundColor: '#eef2ff',
        borderWidth: 1,
        borderColor: '#c7d2fe',
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
    },
    unmarkedTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#4338ca',
        marginBottom: 8,
    },
    unmarkedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 6,
        borderTopWidth: 1,
        borderTopColor: '#e0e7ff',
    },
    unmarkedRoomText: {
        fontSize: 13,
        color: '#1e293b',
        fontWeight: '600',
    },
    unmarkedCount: {
        fontSize: 12,
        color: '#4338ca',
        fontWeight: '700',
    },
    unmarkedArrow: {
        fontSize: 18,
        color: '#94a3b8',
    },
    // [필수값] 누락 알람 섹션
    alarmSection: {
        backgroundColor: '#fffbeb',
        borderWidth: 1,
        borderColor: '#fde68a',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 4,
        marginBottom: 16,
    },
    alarmHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
    },
    alarmTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#b45309',
    },
    alarmSummary: {
        fontSize: 11,
        color: '#a16207',
    },
    alarmCaret: {
        fontSize: 13,
        color: '#a16207',
        fontWeight: '700',
    },
    alarmRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 7,
        paddingHorizontal: 4,
        borderTopWidth: 1,
        borderTopColor: '#fef3c7',
    },
    alarmName: {
        fontSize: 13,
        color: '#1e293b',
        fontWeight: '600',
    },
    alarmMissing: {
        fontSize: 11,
        color: '#dc2626',
        fontWeight: '600',
    },
    alarmMore: {
        fontSize: 11,
        color: '#a16207',
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
    combinedCard: {
        backgroundColor: '#4338ca',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
    },
    combinedHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
    },
    combinedEmoji: { fontSize: 32 },
    combinedName: { fontSize: 18, fontWeight: '800', color: '#ffffff' },
    combinedDesc: { fontSize: 12, color: '#c7d2fe', marginTop: 2 },
    combinedCountBadge: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
        alignItems: 'center',
    },
    combinedCountNum: { fontSize: 22, fontWeight: '800', color: '#4338ca' },
    combinedCountLabel: { fontSize: 10, color: '#6366f1', marginTop: -2 },
    combinedDashboardBtn: {
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(255,255,255,0.18)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 10,
        marginTop: -4,
        marginBottom: 10,
    },
    combinedDashboardBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
    combinedBreakdown: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    combinedChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    combinedChipEmoji: { fontSize: 12 },
    combinedChipName: { fontSize: 11, fontWeight: '700', maxWidth: 140 },
    combinedChipCount: { fontSize: 11, fontWeight: '800' },
    combinedChipDim: { opacity: 0.45 },
    combinedHint: {
        marginTop: 8,
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    combinedHintText: { fontSize: 11, color: '#e0e7ff', lineHeight: 16 },
    individualToggle: {
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    individualToggleText: { fontSize: 12, color: '#6366f1', fontWeight: '600' },
    quickTaskGroupBlock: {
        marginBottom: 14,
    },
    quickTaskGroupLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
        letterSpacing: 0.5,
        marginBottom: 8,
        textTransform: 'uppercase',
    },
    quickTaskGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    quickTaskCard: {
        width: '48%',
        borderRadius: 14,
        padding: 14,
        minHeight: 110,
        justifyContent: 'space-between',
    },
    quickTaskEmoji: {
        fontSize: 28,
        marginBottom: 4,
    },
    quickTaskName: {
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 2,
    },
    quickTaskDesc: {
        fontSize: 11,
        color: '#475569',
        lineHeight: 14,
    },
    toolCard: {
        // 3칸 그리드 (31% × 3 ≈ 93% + gap 약 7%) — 모바일에서 가로 스크롤 안 생기게
        width: '31%',
        backgroundColor: '#ffffff',
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 6,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    toolIconContainer: {
        width: 46,
        height: 46,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    toolLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#374151',
        textAlign: 'center',
    },
    statsContainer: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 24,
    },
    statCard: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 20,
        alignItems: 'center',
    },
    statCardHighlight: {
        backgroundColor: '#6366f1',
    },
    statNumber: {
        fontSize: 36,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    statNumberHighlight: {
        color: '#ffffff',
    },
    statLabel: {
        fontSize: 14,
        color: '#6b7280',
        marginTop: 4,
    },
    statLabelHighlight: {
        color: '#c7d2fe',
    },
    progressSection: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    progressLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#374151',
    },
    progressPercent: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#10b981',
    },
    progressBarBackground: {
        height: 12,
        backgroundColor: '#e5e7eb',
        borderRadius: 6,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#10b981',
        borderRadius: 6,
    },
    progressDetail: {
        fontSize: 13,
        color: '#6b7280',
        textAlign: 'center',
        marginTop: 8,
    },
    section: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1f2937',
    },
    filterSummary: {
        gap: 10,
    },
    filterItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    filterItemLabel: {
        fontSize: 14,
        color: '#6b7280',
    },
    filterItemValue: {
        fontSize: 14,
        fontWeight: '500',
        color: '#1f2937',
        flex: 1,
    },
    noFilter: {
        alignItems: 'center',
        paddingVertical: 20,
    },
    noFilterText: {
        fontSize: 14,
        color: '#9ca3af',
        marginBottom: 12,
    },
    setFilterButton: {
        backgroundColor: '#eef2ff',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
    },
    setFilterButtonText: {
        color: '#6366f1',
        fontWeight: '600',
    },
    saveButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#6366f1',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
    },
    saveButtonText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '500',
    },
    templateList: {
        gap: 8,
    },
    templateItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        borderRadius: 10,
    },
    templateMain: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 14,
    },
    templateInfo: {
        flex: 1,
    },
    templateName: {
        fontSize: 15,
        fontWeight: '500',
        color: '#1f2937',
    },
    templateDate: {
        fontSize: 12,
        color: '#9ca3af',
        marginTop: 2,
    },
    templateDeleteButton: {
        padding: 12,
    },
    templateMenuButton: {
        padding: 14,
        borderLeftWidth: 1,
        borderLeftColor: '#e5e7eb',
    },
    noTemplates: {
        fontSize: 14,
        color: '#9ca3af',
        textAlign: 'center',
        paddingVertical: 16,
    },
    startButton: {
        backgroundColor: '#6366f1',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        marginTop: 8,
    },
    startButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    startButtonText: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#ffffff',
        marginTop: 8,
    },
    startButtonSubtext: {
        fontSize: 14,
        color: '#c7d2fe',
        marginTop: 4,
    },
    modalContainer: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    modalSearchInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        backgroundColor: '#eef2ff',
    },
    modalSearchText: {
        fontSize: 14,
        color: '#6366f1',
        fontWeight: '500',
    },
    resultsList: {
        flex: 1,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    resultInfo: {
        flex: 1,
    },
    resultName: {
        fontSize: 16,
        fontWeight: '500',
        color: '#1f2937',
    },
    resultPreview: {
        fontSize: 13,
        color: '#6b7280',
        marginTop: 4,
    },
    noResults: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    noResultsText: {
        fontSize: 16,
        color: '#9ca3af',
    },
    saveModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    saveModalContent: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 24,
        width: '100%',
        maxWidth: 400,
    },
    saveModalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 16,
        textAlign: 'center',
    },
    saveModalInput: {
        backgroundColor: '#f3f4f6',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 16,
        marginBottom: 16,
    },
    saveModalButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    saveModalButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
    },
    saveModalButtonCancel: {
        backgroundColor: '#f3f4f6',
    },
    saveModalButtonCancelText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6b7280',
    },
    saveModalButtonConfirm: {
        backgroundColor: '#6366f1',
    },
    saveModalButtonConfirmText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
    },
    menuOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    menuContent: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
    },
    menuTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 16,
        textAlign: 'center',
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    menuItemText: {
        fontSize: 16,
        color: '#1f2937',
    },
    menuItemDanger: {
        borderBottomWidth: 0,
    },
    menuItemTextDanger: {
        color: '#ef4444',
    },
    versionBadge: {
        alignSelf: 'flex-end',
        backgroundColor: '#f3f4f6',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        marginTop: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    versionText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#6b7280',
    },
});
