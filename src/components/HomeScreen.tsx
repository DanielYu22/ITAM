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
} from 'lucide-react-native';
import { FilterConfig } from './FieldWorkFilter';
import { Asset, NotionProperty } from '../lib/notion';

interface HomeScreenProps {
    assets: Asset[];
    filterConfig: FilterConfig | null;
    templates: FilterTemplate[];
    schemaProperties: Record<string, NotionProperty>;
    onStartWork: () => void;
    onOpenFilter: () => void;
    onLoadTemplate: (template: FilterTemplate) => void;
    onSaveTemplate: (name: string, overwriteId?: string) => void;
    onDeleteTemplate: (templateId: string) => void;
    onEditAsset: (asset: Asset) => void;
    // Tool section callbacks
    onExport?: () => void;
    onBulkUpdate?: () => void;
    onRefresh?: () => void;
}

export interface FilterTemplate {
    id: string;
    name: string;
    config: FilterConfig;
    createdAt: string;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
    assets,
    filterConfig,
    templates,
    schemaProperties,
    onStartWork,
    onOpenFilter,
    onLoadTemplate,
    onSaveTemplate,
    onDeleteTemplate,
    onEditAsset,
    onExport,
    onBulkUpdate,
    onRefresh,
}) => {
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
                        const val = String(asset.values[cond.column] ?? '').toLowerCase();
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
                    <Text style={styles.title}>NEXUS ITAM</Text>
                    <Text style={styles.subtitle}>현장 작업 관리</Text>
                </View>

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

                {/* 통계 카드 */}
                <View style={styles.statsContainer}>
                    <View style={styles.statCard}>
                        <Text style={styles.statNumber}>{assets.length}</Text>
                        <Text style={styles.statLabel}>전체 장비</Text>
                    </View>
                    <View style={[styles.statCard, styles.statCardHighlight]}>
                        <Text style={[styles.statNumber, styles.statNumberHighlight]}>{filteredCount}</Text>
                        <Text style={[styles.statLabel, styles.statLabelHighlight]}>작업 대상</Text>
                    </View>
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

                {/* 도구 섹션 */}
                <View style={styles.toolsSection}>
                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onExport}
                        disabled={!onExport}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#dcfce7' }]}>
                            <Download size={28} color="#16a34a" />
                        </View>
                        <Text style={styles.toolLabel}>내보내기</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onBulkUpdate}
                        disabled={!onBulkUpdate}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#fef3c7' }]}>
                            <Upload size={28} color="#d97706" />
                        </View>
                        <Text style={styles.toolLabel}>일괄 업데이트</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toolCard}
                        onPress={onRefresh}
                        disabled={!onRefresh}
                    >
                        <View style={[styles.toolIconContainer, { backgroundColor: '#dbeafe' }]}>
                            <RefreshCw size={28} color="#2563eb" />
                        </View>
                        <Text style={styles.toolLabel}>새로고침</Text>
                    </TouchableOpacity>
                </View>

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
        marginBottom: 16,
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
    toolsSection: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    toolCard: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    toolIconContainer: {
        width: 56,
        height: 56,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    toolLabel: {
        fontSize: 13,
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
});
