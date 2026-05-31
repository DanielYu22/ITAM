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
} from 'lucide-react-native';
import { FilterConfig } from './FieldWorkFilter';
import { Asset, NotionProperty } from '../lib/notion';
import { APP_VERSION } from '../lib/version';
import { QUICK_TASKS, QuickTaskDef, getMatchingQuickTasks } from '../lib/quickTasks';
import { SITES_DEFAULTS, SiteDef, SiteId, getSiteCounts } from '../lib/sites';

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
    onCombinedQuickTask?: () => void;
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
    // 인프라 트리 (사이트·건물·층·실험실) 진입
    onOpenInfrastructure?: () => void;
    /** 사용자 오버라이드가 합성된 최종 사이트 정의 (카운트/표시용) */
    effectiveSites?: SiteDef[];
    /** 'all' = 전체장비, 'filtered' = 작업대상 대시보드 오픈 */
    onOpenDashboard?: (mode: 'all' | 'filtered') => void;
    /** 작업 대상 자산 개수 (필터 적용된 결과). filteredCount 와 다를 수 있음 */
    workTargetCount?: number;
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
    onOpenInfrastructure,
    effectiveSites,
    onOpenDashboard,
    workTargetCount,
}) => {
    const sites = effectiveSites || SITES_DEFAULTS;
    const siteCounts = useMemo(
        () => getSiteCounts(allAssets, sites),
        [allAssets, sites]
    );
    // 개별 큐 펼침 토글 — 기본 접힘 (통합이 기본 워크플로우)
    const [showIndividualTasks, setShowIndividualTasks] = useState(false);
    // 통합 큐 대상 자산 수 + Quick Task 별 매칭 수
    const combinedStats = useMemo(() => {
        const matchedTaskCounts: Record<string, number> = {};
        let uniqueMatched = 0;
        for (const asset of assets) {
            const matched = getMatchingQuickTasks(asset);
            if (matched.length === 0) continue;
            uniqueMatched++;
            for (const t of matched) {
                matchedTaskCounts[t.id] = (matchedTaskCounts[t.id] || 0) + 1;
            }
        }
        return { uniqueMatched, matchedTaskCounts };
    }, [assets]);
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

    // 글로벌 검색 결과
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
                            placeholder="장비 검색 (전체 필드)"
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
                                검색 ({searchResults.length}건)
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
                                onPress={onCombinedQuickTask}
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
                                        const cnt = combinedStats.matchedTaskCounts[t.id] || 0;
                                        const dim = cnt === 0;
                                        return (
                                            <TouchableOpacity
                                                key={t.id}
                                                style={[
                                                    styles.combinedChip,
                                                    { backgroundColor: t.bgColor },
                                                    dim && styles.combinedChipDim,
                                                ]}
                                                onPress={(e) => {
                                                    (e as any).stopPropagation?.();
                                                    if (dim && onMonthlyReset) onMonthlyReset();
                                                }}
                                                activeOpacity={dim && onMonthlyReset ? 0.5 : 1}
                                                disabled={!dim || !onMonthlyReset}
                                            >
                                                <Text style={styles.combinedChipEmoji}>{t.emoji}</Text>
                                                <Text style={[styles.combinedChipName, { color: t.color }]} numberOfLines={1}>
                                                    {t.name}
                                                </Text>
                                                <Text style={[styles.combinedChipCount, { color: t.color }]}>
                                                    {cnt}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                                {Object.values(combinedStats.matchedTaskCounts).filter(n => n > 0).length < QUICK_TASKS.length && onMonthlyReset && (
                                    <View style={styles.combinedHint}>
                                        <Text style={styles.combinedHintText}>
                                            💡 0대인 사이클은 '정기 초기화'에서 마킹하면 큐에 올라옵니다 (탭하면 바로 이동)
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
                            검색 결과 ({searchResults.length}건)
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

                        {searchResults.length === 0 && (
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
