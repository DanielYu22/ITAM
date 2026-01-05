import React, { useState, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    TextInput,
    FlatList,
} from 'react-native';
import { ChevronRight, ChevronDown, Check, Filter, MapPin, Target, X, Edit3, ArrowUpDown } from 'lucide-react-native';
import { NotionProperty } from '../lib/notion';

// 필터 설정 인터페이스
export interface FilterConfig {
    // 위치 계층 컬럼 (건물 → 층 → 연구실)
    locationHierarchy: string[];
    // 정렬 컬럼 (동선)
    sortColumn: string;
    // 작업 대상 조건
    targetConditions: TargetCondition[];
    // 편집 가능 필드
    editableFields: string[];
}

export interface TargetCondition {
    id: string;
    column: string;
    type: 'is_empty' | 'is_not_empty' | 'contains' | 'not_contains' | 'equals';
    values: string[]; // 다중 선택 지원
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
    const [step, setStep] = useState<'hierarchy' | 'sort' | 'target' | 'editable'>('hierarchy');

    // 위치 계층 (건물 → 층 → 연구실)
    const [locationHierarchy, setLocationHierarchy] = useState<string[]>(
        currentConfig?.locationHierarchy || []
    );

    // 정렬 컬럼
    const [sortColumn, setSortColumn] = useState<string>(
        currentConfig?.sortColumn || ''
    );

    // 작업 대상 조건
    const [targetConditions, setTargetConditions] = useState<TargetCondition[]>(
        currentConfig?.targetConditions || []
    );

    // 편집 가능 필드
    const [editableFields, setEditableFields] = useState<string[]>(
        currentConfig?.editableFields || []
    );

    // UI 상태
    const [showColumnPicker, setShowColumnPicker] = useState(false);
    const [pickerMode, setPickerMode] = useState<'hierarchy' | 'sort' | 'target' | 'editable'>('hierarchy');
    const [showValuePicker, setShowValuePicker] = useState(false);
    const [activeConditionId, setActiveConditionId] = useState<string | null>(null);
    const [valueSearchText, setValueSearchText] = useState('');
    const [columnSearchText, setColumnSearchText] = useState('');
    const [sortAscending, setSortAscending] = useState(true);
    const [editableSearchText, setEditableSearchText] = useState('');
    const [selectedTargetColumns, setSelectedTargetColumns] = useState<string[]>([]);

    // 각 컬럼의 고유 값 추출
    const columnValues = useMemo(() => {
        const values: Record<string, string[]> = {};
        schema.forEach(col => {
            const set = new Set<string>();
            assets.forEach(asset => {
                const val = asset.values[col];
                if (val && val.trim()) {
                    set.add(val);
                }
            });
            values[col] = Array.from(set).sort();
        });
        return values;
    }, [schema, assets]);

    // 계층 추가
    const addHierarchyLevel = (column: string) => {
        if (!locationHierarchy.includes(column)) {
            setLocationHierarchy([...locationHierarchy, column]);
        }
        setShowColumnPicker(false);
    };

    // 계층 제거
    const removeHierarchyLevel = (index: number) => {
        setLocationHierarchy(prev => prev.filter((_, i) => i !== index));
    };

    // 조건 추가
    const addTargetCondition = (column: string) => {
        const newCondition: TargetCondition = {
            id: Date.now().toString(),
            column,
            type: 'is_empty',
            values: [],
        };
        setTargetConditions([...targetConditions, newCondition]);
        // 편집 가능 필드에도 자동 추가
        if (!editableFields.includes(column)) {
            setEditableFields([...editableFields, column]);
        }
        setShowColumnPicker(false);
    };

    // 조건 업데이트
    const updateCondition = (id: string, updates: Partial<TargetCondition>) => {
        setTargetConditions(prev =>
            prev.map(c => (c.id === id ? { ...c, ...updates } : c))
        );
    };

    // 조건 제거
    const removeCondition = (id: string) => {
        setTargetConditions(prev => prev.filter(c => c.id !== id));
    };

    // 값 선택 토글
    const toggleConditionValue = (conditionId: string, value: string) => {
        setTargetConditions(prev =>
            prev.map(c => {
                if (c.id === conditionId) {
                    const values = c.values.includes(value)
                        ? c.values.filter(v => v !== value)
                        : [...c.values, value];
                    return { ...c, values };
                }
                return c;
            })
        );
    };

    // 편집 필드 토글
    const toggleEditableField = (column: string) => {
        if (editableFields.includes(column)) {
            setEditableFields(prev => prev.filter(c => c !== column));
        } else {
            setEditableFields(prev => [...prev, column]);
        }
    };

    // 적용
    const handleApply = () => {
        onApply({
            locationHierarchy,
            sortColumn,
            targetConditions,
            editableFields,
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

    const hierarchyLabels = ['건물', '층', '연구실', '추가'];

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose}>
                        <X size={24} color="#6b7280" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>현장 작업 설정</Text>
                    <TouchableOpacity onPress={handleApply}>
                        <Text style={styles.applyButton}>적용</Text>
                    </TouchableOpacity>
                </View>

                {/* Steps */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stepsScroll}>
                    <View style={styles.steps}>
                        <TouchableOpacity
                            style={[styles.stepTab, step === 'hierarchy' && styles.stepTabActive]}
                            onPress={() => setStep('hierarchy')}
                        >
                            <MapPin size={16} color={step === 'hierarchy' ? '#6366f1' : '#9ca3af'} />
                            <Text style={[styles.stepText, step === 'hierarchy' && styles.stepTextActive]}>
                                위치 계층
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.stepTab, step === 'sort' && styles.stepTabActive]}
                            onPress={() => setStep('sort')}
                        >
                            <ArrowUpDown size={16} color={step === 'sort' ? '#6366f1' : '#9ca3af'} />
                            <Text style={[styles.stepText, step === 'sort' && styles.stepTextActive]}>
                                정렬
                            </Text>
                        </TouchableOpacity>
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
                            style={[styles.stepTab, step === 'editable' && styles.stepTabActive]}
                            onPress={() => setStep('editable')}
                        >
                            <Edit3 size={16} color={step === 'editable' ? '#6366f1' : '#9ca3af'} />
                            <Text style={[styles.stepText, step === 'editable' && styles.stepTextActive]}>
                                편집 필드
                            </Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>

                <ScrollView style={styles.content}>
                    {/* Step 1: 위치 계층 설정 */}
                    {step === 'hierarchy' && (
                        <View>
                            <Text style={styles.sectionTitle}>위치 계층 설정</Text>
                            <Text style={styles.sectionDesc}>
                                건물 → 층 → 연구실 순서로 위치 컬럼을 선택하세요.
                            </Text>

                            {locationHierarchy.map((col, index) => (
                                <View key={col} style={styles.hierarchyItem}>
                                    <View style={styles.hierarchyLeft}>
                                        <View style={styles.hierarchyBadge}>
                                            <Text style={styles.hierarchyBadgeText}>
                                                {hierarchyLabels[index] || `${index + 1}단계`}
                                            </Text>
                                        </View>
                                        <Text style={styles.hierarchyColumn}>{col}</Text>
                                    </View>
                                    <TouchableOpacity onPress={() => removeHierarchyLevel(index)}>
                                        <X size={20} color="#ef4444" />
                                    </TouchableOpacity>
                                </View>
                            ))}

                            {locationHierarchy.length < 4 && (
                                <TouchableOpacity
                                    style={styles.addButton}
                                    onPress={() => {
                                        setPickerMode('hierarchy');
                                        setShowColumnPicker(true);
                                    }}
                                >
                                    <Text style={styles.addButtonText}>
                                        + {hierarchyLabels[locationHierarchy.length]} 컬럼 선택
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    )}

                    {/* Step 2: 정렬 설정 */}
                    {step === 'sort' && (
                        <View>
                            <Text style={styles.sectionTitle}>정렬 기준</Text>
                            <Text style={styles.sectionDesc}>
                                장비 순서를 정할 컬럼을 선택하세요 (예: 동선).
                            </Text>

                            {sortColumn ? (
                                <View style={styles.sortSelected}>
                                    <View style={styles.sortInfo}>
                                        <ArrowUpDown size={20} color="#6366f1" />
                                        <Text style={styles.sortColumnText}>{sortColumn}</Text>
                                        <Text style={styles.sortDesc}>오름차순 정렬</Text>
                                    </View>
                                    <TouchableOpacity onPress={() => setSortColumn('')}>
                                        <X size={20} color="#ef4444" />
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <TouchableOpacity
                                    style={styles.addButton}
                                    onPress={() => {
                                        setPickerMode('sort');
                                        setShowColumnPicker(true);
                                    }}
                                >
                                    <Text style={styles.addButtonText}>+ 정렬 컬럼 선택</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    )}

                    {/* Step 3: 작업 대상 조건 */}
                    {step === 'target' && (
                        <View>
                            <Text style={styles.sectionTitle}>작업 대상 조건</Text>
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

                                    {/* 값 선택 (다중 선택 지원) */}
                                    {(cond.type === 'contains' || cond.type === 'not_contains' || cond.type === 'equals') && (
                                        <View style={styles.valueSection}>
                                            <TouchableOpacity
                                                style={styles.valuePickerButton}
                                                onPress={() => {
                                                    setActiveConditionId(cond.id);
                                                    setValueSearchText('');
                                                    setShowValuePicker(true);
                                                }}
                                            >
                                                <Text style={styles.valuePickerButtonText}>
                                                    {cond.values.length > 0
                                                        ? `${cond.values.length}개 선택됨`
                                                        : '값 선택...'}
                                                </Text>
                                                <ChevronDown size={18} color="#6b7280" />
                                            </TouchableOpacity>

                                            {cond.values.length > 0 && (
                                                <View style={styles.selectedValues}>
                                                    {cond.values.map(val => (
                                                        <View key={val} style={styles.selectedValueChip}>
                                                            <Text style={styles.selectedValueText}>{val}</Text>
                                                            <TouchableOpacity
                                                                onPress={() => toggleConditionValue(cond.id, val)}
                                                            >
                                                                <X size={14} color="#6366f1" />
                                                            </TouchableOpacity>
                                                        </View>
                                                    ))}
                                                </View>
                                            )}
                                        </View>
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

                    {/* Step 4: 편집 가능 필드 */}
                    {step === 'editable' && (
                        <View>
                            <Text style={styles.sectionTitle}>편집 가능 필드</Text>
                            <Text style={styles.sectionDesc}>
                                카드에서 편집할 수 있는 필드를 선택하세요.
                            </Text>

                            {/* 검색 입력 */}
                            <View style={styles.editableSearch}>
                                <TextInput
                                    style={styles.editableSearchInput}
                                    value={editableSearchText}
                                    onChangeText={setEditableSearchText}
                                    placeholder="필드 검색..."
                                    placeholderTextColor="#9ca3af"
                                />
                                {editableSearchText.length > 0 && (
                                    <TouchableOpacity onPress={() => setEditableSearchText('')}>
                                        <X size={18} color="#9ca3af" />
                                    </TouchableOpacity>
                                )}
                            </View>

                            <View style={styles.editableList}>
                                {schema
                                    .filter(col => {
                                        if (editableSearchText) {
                                            return col.toLowerCase().includes(editableSearchText.toLowerCase());
                                        }
                                        return true;
                                    })
                                    .sort((a, b) => a.localeCompare(b, 'ko'))
                                    .map(col => (
                                        <TouchableOpacity
                                            key={col}
                                            style={[
                                                styles.editableItem,
                                                editableFields.includes(col) && styles.editableItemActive,
                                            ]}
                                            onPress={() => toggleEditableField(col)}
                                        >
                                            <Text style={[
                                                styles.editableItemText,
                                                editableFields.includes(col) && styles.editableItemTextActive,
                                            ]}>
                                                {col}
                                            </Text>
                                            {editableFields.includes(col) && (
                                                <Check size={18} color="#6366f1" />
                                            )}
                                        </TouchableOpacity>
                                    ))}
                            </View>
                        </View>
                    )}
                </ScrollView>

                {/* Column Picker Modal */}
                <Modal visible={showColumnPicker} transparent animationType="fade">
                    <View style={styles.pickerOverlay}>
                        <View style={styles.pickerContainer}>
                            <View style={styles.pickerHeader}>
                                <Text style={styles.pickerTitle}>
                                    {pickerMode === 'target' ? '컬럼 선택 (다중)' : '컬럼 선택'}
                                </Text>
                                <View style={styles.pickerHeaderRight}>
                                    <TouchableOpacity
                                        style={styles.sortToggle}
                                        onPress={() => setSortAscending(!sortAscending)}
                                    >
                                        <Text style={styles.sortToggleText}>
                                            {sortAscending ? 'A→Z' : 'Z→A'}
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => {
                                        setShowColumnPicker(false);
                                        setColumnSearchText('');
                                        setSelectedTargetColumns([]);
                                    }}>
                                        <X size={24} color="#6b7280" />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* 검색 입력 */}
                            <View style={styles.searchInputContainer}>
                                <TextInput
                                    style={styles.searchInput}
                                    value={columnSearchText}
                                    onChangeText={setColumnSearchText}
                                    placeholder="컬럼 검색..."
                                    placeholderTextColor="#9ca3af"
                                    autoFocus
                                />
                                {columnSearchText.length > 0 && (
                                    <TouchableOpacity onPress={() => setColumnSearchText('')}>
                                        <X size={18} color="#9ca3af" />
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* target 모드에서 선택된 컬럼 표시 */}
                            {pickerMode === 'target' && selectedTargetColumns.length > 0 && (
                                <View style={styles.selectedColumnsBar}>
                                    <Text style={styles.selectedColumnsText}>
                                        {selectedTargetColumns.length}개 선택됨
                                    </Text>
                                </View>
                            )}

                            <ScrollView style={styles.pickerList}>
                                {schema
                                    .filter(col => {
                                        // 이미 선택된 항목 제외 (hierarchy 모드)
                                        if (pickerMode === 'hierarchy' && locationHierarchy.includes(col)) {
                                            return false;
                                        }
                                        // 검색 필터
                                        if (columnSearchText) {
                                            return col.toLowerCase().includes(columnSearchText.toLowerCase());
                                        }
                                        return true;
                                    })
                                    .sort((a, b) => {
                                        return sortAscending
                                            ? a.localeCompare(b, 'ko')
                                            : b.localeCompare(a, 'ko');
                                    })
                                    .map(col => {
                                        const isSelected = selectedTargetColumns.includes(col);

                                        if (pickerMode === 'target') {
                                            // target 모드: 체크박스 스타일
                                            return (
                                                <TouchableOpacity
                                                    key={col}
                                                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                                                    onPress={() => {
                                                        setSelectedTargetColumns(prev =>
                                                            prev.includes(col)
                                                                ? prev.filter(c => c !== col)
                                                                : [...prev, col]
                                                        );
                                                    }}
                                                >
                                                    <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                                                        {isSelected && <Check size={14} color="#ffffff" />}
                                                    </View>
                                                    <Text style={[styles.pickerItemText, isSelected && styles.pickerItemTextSelected]}>
                                                        {col}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        }

                                        // 기존 모드: 단일 선택
                                        return (
                                            <TouchableOpacity
                                                key={col}
                                                style={styles.pickerItem}
                                                onPress={() => {
                                                    if (pickerMode === 'hierarchy') {
                                                        addHierarchyLevel(col);
                                                    } else if (pickerMode === 'sort') {
                                                        setSortColumn(col);
                                                        setShowColumnPicker(false);
                                                    }
                                                    setColumnSearchText('');
                                                }}
                                            >
                                                <Text style={styles.pickerItemText}>{col}</Text>
                                                <ChevronRight size={18} color="#9ca3af" />
                                            </TouchableOpacity>
                                        );
                                    })}
                            </ScrollView>

                            {/* target 모드: 적용 버튼 */}
                            {pickerMode === 'target' && (
                                <TouchableOpacity
                                    style={[styles.doneButton, selectedTargetColumns.length === 0 && styles.doneButtonDisabled]}
                                    onPress={() => {
                                        selectedTargetColumns.forEach(col => addTargetCondition(col));
                                        setSelectedTargetColumns([]);
                                        setColumnSearchText('');
                                        setShowColumnPicker(false);
                                    }}
                                    disabled={selectedTargetColumns.length === 0}
                                >
                                    <Text style={styles.doneButtonText}>
                                        {selectedTargetColumns.length > 0
                                            ? `${selectedTargetColumns.length}개 조건 추가`
                                            : '컬럼을 선택하세요'}
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                </Modal>

                {/* Value Picker Modal (다중 선택) */}
                <Modal visible={showValuePicker} transparent animationType="fade">
                    <View style={styles.pickerOverlay}>
                        <View style={styles.pickerContainer}>
                            <View style={styles.pickerHeader}>
                                <Text style={styles.pickerTitle}>값 선택 (다중)</Text>
                                <TouchableOpacity onPress={() => setShowValuePicker(false)}>
                                    <X size={24} color="#6b7280" />
                                </TouchableOpacity>
                            </View>

                            {/* 검색 입력 */}
                            <View style={styles.searchInputContainer}>
                                <TextInput
                                    style={styles.searchInput}
                                    value={valueSearchText}
                                    onChangeText={setValueSearchText}
                                    placeholder="검색 또는 직접 입력..."
                                    placeholderTextColor="#9ca3af"
                                />
                                {valueSearchText.length > 0 && (
                                    <TouchableOpacity
                                        style={styles.addCustomValue}
                                        onPress={() => {
                                            if (activeConditionId && valueSearchText.trim()) {
                                                toggleConditionValue(activeConditionId, valueSearchText.trim());
                                                setValueSearchText('');
                                            }
                                        }}
                                    >
                                        <Text style={styles.addCustomValueText}>추가</Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            <ScrollView style={styles.pickerList}>
                                {activeConditionId && (() => {
                                    const cond = targetConditions.find(c => c.id === activeConditionId);
                                    if (!cond) return null;

                                    const values = columnValues[cond.column] || [];
                                    const filtered = values.filter(v =>
                                        v.toLowerCase().includes(valueSearchText.toLowerCase())
                                    );

                                    return filtered.map(val => (
                                        <TouchableOpacity
                                            key={val}
                                            style={[
                                                styles.valueItem,
                                                cond.values.includes(val) && styles.valueItemActive,
                                            ]}
                                            onPress={() => toggleConditionValue(activeConditionId, val)}
                                        >
                                            <Text style={[
                                                styles.valueItemText,
                                                cond.values.includes(val) && styles.valueItemTextActive,
                                            ]}>
                                                {val}
                                            </Text>
                                            {cond.values.includes(val) && (
                                                <Check size={18} color="#6366f1" />
                                            )}
                                        </TouchableOpacity>
                                    ));
                                })()}
                            </ScrollView>

                            <TouchableOpacity
                                style={styles.doneButton}
                                onPress={() => setShowValuePicker(false)}
                            >
                                <Text style={styles.doneButtonText}>완료</Text>
                            </TouchableOpacity>
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
    stepsScroll: {
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    steps: {
        flexDirection: 'row',
        paddingHorizontal: 8,
    },
    stepTab: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
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
    hierarchyItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 12,
        marginBottom: 8,
    },
    hierarchyLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    hierarchyBadge: {
        backgroundColor: '#6366f1',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    hierarchyBadgeText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '600',
    },
    hierarchyColumn: {
        fontSize: 16,
        color: '#1f2937',
        fontWeight: '500',
    },
    sortSelected: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 12,
    },
    sortInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    sortColumnText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#1f2937',
    },
    sortDesc: {
        fontSize: 13,
        color: '#6b7280',
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
    valueSection: {
        marginTop: 12,
    },
    valuePickerButton: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    valuePickerButtonText: {
        fontSize: 15,
        color: '#6b7280',
    },
    selectedValues: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
    },
    selectedValueChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#eef2ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
    },
    selectedValueText: {
        fontSize: 13,
        color: '#6366f1',
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
    editableList: {
        gap: 8,
    },
    editableItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 12,
    },
    editableItemActive: {
        backgroundColor: '#eef2ff',
        borderWidth: 1,
        borderColor: '#6366f1',
    },
    editableItemText: {
        fontSize: 15,
        color: '#1f2937',
    },
    editableItemTextActive: {
        color: '#6366f1',
        fontWeight: '500',
    },
    editableSearch: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    editableSearchInput: {
        flex: 1,
        fontSize: 15,
        color: '#1f2937',
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
    pickerHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    sortToggle: {
        backgroundColor: '#eef2ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
    },
    sortToggleText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#6366f1',
    },
    pickerList: {
        padding: 8,
        maxHeight: 300,
    },
    pickerItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    pickerItemSelected: {
        backgroundColor: '#eef2ff',
    },
    pickerItemText: {
        fontSize: 15,
        color: '#1f2937',
    },
    pickerItemTextSelected: {
        color: '#6366f1',
        fontWeight: '500',
    },
    checkbox: {
        width: 22,
        height: 22,
        borderWidth: 2,
        borderColor: '#d1d5db',
        borderRadius: 4,
        marginRight: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxChecked: {
        backgroundColor: '#6366f1',
        borderColor: '#6366f1',
    },
    selectedColumnsBar: {
        backgroundColor: '#eef2ff',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    selectedColumnsText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#6366f1',
    },
    doneButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        gap: 10,
    },
    searchInput: {
        flex: 1,
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
    },
    addCustomValue: {
        backgroundColor: '#6366f1',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 8,
    },
    addCustomValueText: {
        color: '#ffffff',
        fontWeight: '600',
    },
    valueItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    valueItemActive: {
        backgroundColor: '#eef2ff',
    },
    valueItemText: {
        fontSize: 15,
        color: '#1f2937',
    },
    valueItemTextActive: {
        color: '#6366f1',
        fontWeight: '500',
    },
    doneButton: {
        backgroundColor: '#6366f1',
        margin: 16,
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    doneButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
});
