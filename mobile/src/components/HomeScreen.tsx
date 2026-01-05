import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
} from 'react-native';
import {
    Play,
    Target,
    MapPin,
    ArrowUpDown,
    Edit3,
    CheckCircle2,
    Circle,
    Settings2,
    Bookmark
} from 'lucide-react-native';
import { FilterConfig } from './FieldWorkFilter';
import { Asset } from '../lib/notion';

interface HomeScreenProps {
    assets: Asset[];
    filterConfig: FilterConfig | null;
    templates: FilterTemplate[];
    onStartWork: () => void;
    onOpenFilter: () => void;
    onLoadTemplate: (template: FilterTemplate) => void;
    onSaveTemplate: () => void;
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
    onStartWork,
    onOpenFilter,
    onLoadTemplate,
    onSaveTemplate,
}) => {
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

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
            {/* 헤더 */}
            <View style={styles.header}>
                <Text style={styles.title}>NEXUS ITAM</Text>
                <Text style={styles.subtitle}>현장 작업 관리</Text>
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
                        {/* 위치 계층 */}
                        {filterConfig.locationHierarchy && filterConfig.locationHierarchy.length > 0 && (
                            <View style={styles.filterItem}>
                                <MapPin size={16} color="#6366f1" />
                                <Text style={styles.filterItemLabel}>위치 계층:</Text>
                                <Text style={styles.filterItemValue}>
                                    {filterConfig.locationHierarchy.join(' → ')}
                                </Text>
                            </View>
                        )}

                        {/* 정렬 */}
                        {filterConfig.sortColumn && (
                            <View style={styles.filterItem}>
                                <ArrowUpDown size={16} color="#6366f1" />
                                <Text style={styles.filterItemLabel}>정렬:</Text>
                                <Text style={styles.filterItemValue}>{filterConfig.sortColumn}</Text>
                            </View>
                        )}

                        {/* 작업 대상 조건 */}
                        {filterConfig.targetConditions && filterConfig.targetConditions.length > 0 && (
                            <View style={styles.filterItem}>
                                <Target size={16} color="#6366f1" />
                                <Text style={styles.filterItemLabel}>작업 조건:</Text>
                                <Text style={styles.filterItemValue}>
                                    {filterConfig.targetConditions.length}개
                                </Text>
                            </View>
                        )}

                        {/* 편집 필드 */}
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
        marginBottom: 24,
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
});
