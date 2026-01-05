import React, { useState, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    TextInput,
} from 'react-native';
import { ChevronRight, Check, Filter, MapPin, Target, X } from 'lucide-react-native';
import { NotionProperty } from '../lib/notion';

interface FilterConfig {
    // 작업 대상 조건
    targetConditions: TargetCondition[];
    // 위치 필터
    locationColumns: string[];
    locationFilters: Record<string, string[]>; // column -> selected values
}

interface TargetCondition {
    id: string;
    column: string;
    type: 'is_empty' | 'is_not_empty' | 'contains' | 'not_contains' | 'equals';
    value?: string;
}

interface FieldWorkFilterProps {
    visible: boolean;
    onClose: () => void;
    onApply: (config: FilterConfig) => void;
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    assets: Array<{ values: Record<string, string> }>;
    currentConfig?: FilterConfig;
}

export const FieldWorkFilter: React.FC<FieldWorkFilterProps> = ({
    visible,
    onClose,
    onApply,
    schema,
    schemaProperties,
    assets,
    currentConfig,
}) => {
    const [step, setStep] = useState<'target' | 'location' | 'preview'>('target');
    const [targetConditions, setTargetConditions] = useState<TargetCondition[]>(
        currentConfig?.targetConditions || []
    );
    const [locationColumns, setLocationColumns] = useState<string[]>(
        currentConfig?.locationColumns || []
    );
    const [locationFilters, setLocationFilters] = useState<Record<string, string[]>>(
        currentConfig?.locationFilters || {}
    );
    const [showColumnPicker, setShowColumnPicker] = useState(false);
    const [pickerMode, setPickerMode] = useState<'target' | 'location'>('target');
    const [editingCondition, setEditingCondition] = useState<TargetCondition | null>(null);

    // 각 컬럼의 고유 값 추출
    const columnValues = useMemo(() => {
        const values: Record<string, Set<string>> = {};
        schema.forEach(col => {
            values[col] = new Set<string>();
            assets.forEach(asset => {
                const val = asset.values[col];
                if (val && val.trim()) {
                    values[col].add(val);
                }
            });
        });
        return values;
    }, [schema, assets]);

    // 필터 적용된 결과 미리보기
    const previewCount = useMemo(() => {
        let filtered = assets;

        // 작업 대상 조건 적용
        targetConditions.forEach(cond => {
            filtered = filtered.filter(asset => {
                const val = (asset.values[cond.column] || '').toLowerCase();
                switch (cond.type) {
                    case 'is_empty':
                        return !val || val === '';
                    case 'is_not_empty':
                        return val && val !== '';
                    case 'contains':
                        return val.includes((cond.value || '').toLowerCase());
                    case 'not_contains':
                        return !val.includes((cond.value || '').toLowerCase());
                    case 'equals':
                        return val === (cond.value || '').toLowerCase();
                    default:
                        return true;
                }
            });
        });

        // 위치 필터 적용
        Object.entries(locationFilters).forEach(([col, values]) => {
            if (values.length > 0) {
                filtered = filtered.filter(asset => {
                    const val = asset.values[col] || '';
                    return values.some(v => val.includes(v));
                });
            }
        });

        return filtered.length;
    }, [assets, targetConditions, locationFilters]);

    const addTargetCondition = (column: string) => {
        const newCondition: TargetCondition = {
            id: Date.now().toString(),
            column,
            type: 'is_empty',
        };
        setTargetConditions([...targetConditions, newCondition]);
        setShowColumnPicker(false);
    };

    const updateCondition = (id: string, updates: Partial<TargetCondition>) => {
        setTargetConditions(prev =>
            prev.map(c => (c.id === id ? { ...c, ...updates } : c))
        );
    };

    const removeCondition = (id: string) => {
        setTargetConditions(prev => prev.filter(c => c.id !== id));
    };

    const toggleLocationColumn = (column: string) => {
        if (locationColumns.includes(column)) {
            setLocationColumns(prev => prev.filter(c => c !== column));
            setLocationFilters(prev => {
                const next = { ...prev };
                delete next[column];
                return next;
            });
        } else {
            setLocationColumns(prev => [...prev, column]);
        }
    };

    const toggleLocationValue = (column: string, value: string) => {
        setLocationFilters(prev => {
            const current = prev[column] || [];
            if (current.includes(value)) {
                return { ...prev, [column]: current.filter(v => v !== value) };
            } else {
                return { ...prev, [column]: [...current, value] };
            }
        });
    };

    const handleApply = () => {
        onApply({
            targetConditions,
            locationColumns,
            locationFilters,
        });
        onClose();
    };

    const conditionTypeLabels: Record<string, string> = {
        is_empty: '비어있음',
        is_not_empty: '비어있지 않음',
        contains: '포함',
        not_contains: '포함하지 않음',
        equals: '정확히 일치',
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose}>
                        <X size={24} color="#6b7280" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>현장 작업 필터</Text>
                    <TouchableOpacity onPress={handleApply}>
                        <Text style={styles.applyButton}>적용</Text>
                    </TouchableOpacity>
                </View>

                {/* Steps */}
                <View style={styles.steps}>
                    <TouchableOpacity
                        style={[styles.stepTab, step === 'target' && styles.stepTabActive]}
                        onPress={() => setStep('target')}
                    >
                        <Target size={16} color={step === 'target' ? '#6366f1' : '#9ca3af'} />
                        <Text style={[styles.stepText, step === 'target' && styles.stepTextActive]}>
                            작업 대상
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.stepTab, step === 'location' && styles.stepTabActive]}
                        onPress={() => setStep('location')}
                    >
                        <MapPin size={16} color={step === 'location' ? '#6366f1' : '#9ca3af'} />
                        <Text style={[styles.stepText, step === 'location' && styles.stepTextActive]}>
                            위치 선택
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.stepTab, step === 'preview' && styles.stepTabActive]}
                        onPress={() => setStep('preview')}
                    >
                        <Filter size={16} color={step === 'preview' ? '#6366f1' : '#9ca3af'} />
                        <Text style={[styles.stepText, step === 'preview' && styles.stepTextActive]}>
                            미리보기
                        </Text>
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.content}>
                    {/* Step 1: 작업 대상 조건 */}
                    {step === 'target' && (
                        <View>
                            <Text style={styles.sectionTitle}>작업 대상 조건 설정</Text>
                            <Text style={styles.sectionDesc}>
                                어떤 항목을 작업 대상으로 할지 조건을 설정하세요.
                            </Text>

                            {targetConditions.map(cond => (
                                <View key={cond.id} style={styles.conditionCard}>
                                    <View style={styles.conditionHeader}>
                                        <Text style={styles.conditionColumn}>{cond.column}</Text>
                                        <TouchableOpacity onPress={() => removeCondition(cond.id)}>
                                            <X size={18} color="#ef4444" />
                                        </TouchableOpacity>
                                    </View>
                                    <View style={styles.conditionTypes}>
                                        {Object.entries(conditionTypeLabels).map(([type, label]) => (
                                            <TouchableOpacity
                                                key={type}
                                                style={[
                                                    styles.conditionType,
                                                    cond.type === type && styles.conditionTypeActive,
                                                ]}
                                                onPress={() => updateCondition(cond.id, { type: type as any })}
                                            >
                                                <Text
                                                    style={[
                                                        styles.conditionTypeText,
                                                        cond.type === type && styles.conditionTypeTextActive,
                                                    ]}
                                                >
                                                    {label}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    {(cond.type === 'contains' ||
                                        cond.type === 'not_contains' ||
                                        cond.type === 'equals') && (
                                            <TextInput
                                                style={styles.conditionInput}
                                                value={cond.value || ''}
                                                onChangeText={v => updateCondition(cond.id, { value: v })}
                                                placeholder="값 입력..."
                                            />
                                        )}
                                </View>
                            ))}

                            <TouchableOpacity
                                style={styles.addButton}
                                onPress={() => {
                                    setPickerMode('target');
                                    setShowColumnPicker(true);
                                }}
                            >
                                <Text style={styles.addButtonText}>+ 조건 추가</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Step 2: 위치 선택 */}
                    {step === 'location' && (
                        <View>
                            <Text style={styles.sectionTitle}>위치 컬럼 선택</Text>
                            <Text style={styles.sectionDesc}>
                                위치를 나타내는 컬럼을 선택하세요 (건물, 층, 실험실 등)
                            </Text>

                            <View style={styles.columnList}>
                                {schema.map(col => (
                                    <TouchableOpacity
                                        key={col}
                                        style={[
                                            styles.columnItem,
                                            locationColumns.includes(col) && styles.columnItemActive,
                                        ]}
                                        onPress={() => toggleLocationColumn(col)}
                                    >
                                        <Text style={styles.columnItemText}>{col}</Text>
                                        {locationColumns.includes(col) && (
                                            <Check size={18} color="#6366f1" />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {locationColumns.length > 0 && (
                                <>
                                    <Text style={[styles.sectionTitle, { marginTop: 24 }]}>
                                        현장 위치 선택
                                    </Text>
                                    {locationColumns.map(col => (
                                        <View key={col} style={styles.locationSection}>
                                            <Text style={styles.locationTitle}>{col}</Text>
                                            <View style={styles.valueList}>
                                                {Array.from(columnValues[col] || []).map(val => (
                                                    <TouchableOpacity
                                                        key={val}
                                                        style={[
                                                            styles.valueChip,
                                                            locationFilters[col]?.includes(val) &&
                                                            styles.valueChipActive,
                                                        ]}
                                                        onPress={() => toggleLocationValue(col, val)}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.valueChipText,
                                                                locationFilters[col]?.includes(val) &&
                                                                styles.valueChipTextActive,
                                                            ]}
                                                        >
                                                            {val}
                                                        </Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        </View>
                                    ))}
                                </>
                            )}
                        </View>
                    )}

                    {/* Step 3: 미리보기 */}
                    {step === 'preview' && (
                        <View>
                            <Text style={styles.sectionTitle}>필터 미리보기</Text>

                            <View style={styles.previewCard}>
                                <Text style={styles.previewNumber}>{previewCount}</Text>
                                <Text style={styles.previewLabel}>
                                    총 {assets.length}개 중 작업 대상
                                </Text>
                            </View>

                            {targetConditions.length > 0 && (
                                <View style={styles.summarySection}>
                                    <Text style={styles.summaryTitle}>작업 대상 조건</Text>
                                    {targetConditions.map(cond => (
                                        <Text key={cond.id} style={styles.summaryItem}>
                                            • {cond.column}: {conditionTypeLabels[cond.type]}
                                            {cond.value ? ` "${cond.value}"` : ''}
                                        </Text>
                                    ))}
                                </View>
                            )}

                            {Object.keys(locationFilters).length > 0 && (
                                <View style={styles.summarySection}>
                                    <Text style={styles.summaryTitle}>위치 필터</Text>
                                    {Object.entries(locationFilters).map(([col, vals]) =>
                                        vals.length > 0 ? (
                                            <Text key={col} style={styles.summaryItem}>
                                                • {col}: {vals.join(', ')}
                                            </Text>
                                        ) : null
                                    )}
                                </View>
                            )}
                        </View>
                    )}
                </ScrollView>

                {/* Column Picker Modal */}
                <Modal visible={showColumnPicker} transparent animationType="fade">
                    <View style={styles.pickerOverlay}>
                        <View style={styles.pickerContainer}>
                            <View style={styles.pickerHeader}>
                                <Text style={styles.pickerTitle}>컬럼 선택</Text>
                                <TouchableOpacity onPress={() => setShowColumnPicker(false)}>
                                    <X size={24} color="#6b7280" />
                                </TouchableOpacity>
                            </View>
                            <ScrollView style={styles.pickerList}>
                                {schema.map(col => (
                                    <TouchableOpacity
                                        key={col}
                                        style={styles.pickerItem}
                                        onPress={() => addTargetCondition(col)}
                                    >
                                        <Text style={styles.pickerItemText}>{col}</Text>
                                        <ChevronRight size={18} color="#9ca3af" />
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    </View>
                </Modal>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    applyButton: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6366f1',
    },
    steps: {
        flexDirection: 'row',
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    stepTab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        gap: 6,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    stepTabActive: {
        borderBottomColor: '#6366f1',
    },
    stepText: {
        fontSize: 14,
        color: '#9ca3af',
    },
    stepTextActive: {
        color: '#6366f1',
        fontWeight: '600',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 8,
    },
    sectionDesc: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 16,
    },
    conditionCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    conditionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    conditionColumn: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1f2937',
    },
    conditionTypes: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    conditionType: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#f3f4f6',
    },
    conditionTypeActive: {
        backgroundColor: '#6366f1',
    },
    conditionTypeText: {
        fontSize: 13,
        color: '#6b7280',
    },
    conditionTypeTextActive: {
        color: '#ffffff',
    },
    conditionInput: {
        marginTop: 12,
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
    },
    addButton: {
        backgroundColor: '#eef2ff',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
    },
    addButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6366f1',
    },
    columnList: {
        gap: 8,
    },
    columnItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 12,
    },
    columnItemActive: {
        backgroundColor: '#eef2ff',
        borderWidth: 1,
        borderColor: '#6366f1',
    },
    columnItemText: {
        fontSize: 15,
        color: '#1f2937',
    },
    locationSection: {
        marginBottom: 16,
    },
    locationTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    valueList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    valueChip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    valueChipActive: {
        backgroundColor: '#6366f1',
        borderColor: '#6366f1',
    },
    valueChipText: {
        fontSize: 14,
        color: '#374151',
    },
    valueChipTextActive: {
        color: '#ffffff',
    },
    previewCard: {
        backgroundColor: '#6366f1',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        marginBottom: 24,
    },
    previewNumber: {
        fontSize: 48,
        fontWeight: 'bold',
        color: '#ffffff',
    },
    previewLabel: {
        fontSize: 16,
        color: '#c7d2fe',
        marginTop: 4,
    },
    summarySection: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    summaryTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    summaryItem: {
        fontSize: 14,
        color: '#6b7280',
        lineHeight: 22,
    },
    pickerOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    pickerContainer: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '70%',
    },
    pickerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    pickerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    pickerList: {
        padding: 8,
    },
    pickerItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    pickerItemText: {
        fontSize: 15,
        color: '#1f2937',
    },
});
