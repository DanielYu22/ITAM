import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    TextInput,
    Modal,
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
    onSaveTemplate: () => void;
    onEditAsset: (asset: Asset) => void;
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
    onEditAsset,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearchResults, setShowSearchResults] = useState(false);

    // Title 필드 찾기
    const titleField = useMemo(() => {
        return Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name';
    }, [schemaProperties]);

    // 글로벌 검색 결과
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];

        const query = searchQuery.toLowerCase();
        return assets.filter(asset => {
            // 모든 필드에서 검색
            return Object.values(asset.values).some(val =>
                String(val).toLowerCase().includes(query)
            );
        }).sort((a, b) => {
            // Name 필드 기준 정렬
            const nameA = a.values[titleField] || '';
            const nameB = b.values[titleField] || '';
            return nameA.localeCompare(nameB, 'ko');
        });
    }, [assets, searchQuery, titleField]);

    // 필터 적용된 자산 수 계산
    const getFilteredCount = () => {
        if (!filterConfig) return assets.length;

        let result = assets;

        if (filterConfig.targetConditions) {
            filterConfig.targetConditions.forEach((cond) => {
                result = result.filter(asset => {
                    const val = (asset.values[cond.column] || '').toLowerCase();
                    switch (cond.type) {
                        case 'is_empty':
                            return !val || val === '';
                        case 'is_not_empty':
                            return val && val !== '';
                        case 'contains':
                            if (cond.values && cond.values.length > 0) {
                                return cond.values.some(v => val.includes(v.toLowerCase()));
                            }
                            return true;
                        case 'not_contains':
                            if (cond.values && cond.values.length > 0) {
                                return !cond.values.some(v => val.includes(v.toLowerCase()));
                            }
                            return true;
                        case 'equals':
                            if (cond.values && cond.values.length > 0) {
                                return cond.values.some(v => val === v.toLowerCase());
                            }
                            return true;
                        default:
                            return true;
                    }
                });
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

                            {filterConfig.targetConditions && filterConfig.targetConditions.length > 0 && (
                                <View style={styles.filterItem}>
                                    <Target size={16} color="#6366f1" />
                                    <Text style={styles.filterItemLabel}>작업 조건:</Text>
                                    <Text style={styles.filterItemValue}>
                                        {filterConfig.targetConditions.length}개
                                    </Text>
                                </View>
                            )}

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
                            <TouchableOpacity onPress={onSaveTemplate} style={styles.saveButton}>
                                <Bookmark size={16} color="#ffffff" />
                                <Text style={styles.saveButtonText}>현재 저장</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {templates.length > 0 ? (
                        <View style={styles.templateList}>
                            {templates.map(template => (
                                <TouchableOpacity
                                    key={template.id}
                                    style={styles.templateItem}
                                    onPress={() => onLoadTemplate(template)}
                                >
                                    <View style={styles.templateInfo}>
                                        <Text style={styles.templateName}>{template.name}</Text>
                                        <Text style={styles.templateDate}>{template.createdAt}</Text>
                                    </View>
                                    <Play size={18} color="#6366f1" />
                                </TouchableOpacity>
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
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        padding: 14,
        borderRadius: 10,
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
});
