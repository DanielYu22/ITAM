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
    // 정렬 방향 (오름차순/내림차순)
    sortDirection: 'asc' | 'desc';
    // 작업 대상 그룹 (중첩 논리 지원)
    targetGroups: TargetGroup[];
    // 그룹 간 논리 관계 ('and' | 'or')
    globalLogicalOperator: 'and' | 'or';
    // 구버전 호환용 (사용 자제)
    targetConditions?: TargetCondition[];
    targetLogicalOperator?: 'and' | 'or';
    // 편집 가능 필드
    editableFields: string[];
}

export interface TargetGroup {
    id: string;
    operator: 'and' | 'or';
    conditions: TargetCondition[];
}

export interface TargetCondition {
    id: string;
    column: string;
    type: 'is_empty' | 'is_not_empty' | 'contains' | 'not_contains' | 'equals' | 'text_contains' | 'text_not_contains';
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
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
        currentConfig?.sortDirection || 'asc'
    );

    // 작업 대상 그룹
    const [targetGroups, setTargetGroups] = useState<TargetGroup[]>(() => {
        if (currentConfig?.targetGroups) return currentConfig.targetGroups;
        if (currentConfig?.targetConditions && currentConfig.targetConditions.length > 0) {
            return [{
                id: 'default-group',
                operator: currentConfig.targetLogicalOperator || 'and',
                conditions: currentConfig.targetConditions
            }];
        }
        return [{ id: 'group-1', operator: 'and', conditions: [] }];
    });
    const [globalLogicalOperator, setGlobalLogicalOperator] = useState<'and' | 'or'>(
        currentConfig?.globalLogicalOperator || 'and'
    );

    // 편집 가능 필드
    const [editableFields, setEditableFields] = useState<string[]>(
        currentConfig?.editableFields || []
    );

    // UI 상태
    const [showColumnPicker, setShowColumnPicker] = useState(false);
    const [pickerMode, setPickerMode] = useState<'hierarchy' | 'sort' | 'target' | 'editable'>('hierarchy');
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null); // 현재 컬럼을 추가할 그룹
    const [showValuePicker, setShowValuePicker] = useState(false);
    const [activeConditionId, setActiveConditionId] = useState<string | null>(null);
    const [valueSearchText, setValueSearchText] = useState('');
    const [columnSearchText, setColumnSearchText] = useState('');
    const [sortAscending, setSortAscending] = useState(true);
    const [editableSearchText, setEditableSearchText] = useState('');
    const [selectedTargetColumns, setSelectedTargetColumns] = useState<string[]>([]);

    // currentConfig가 변경되거나 모달이 열릴 때 내부 상태 업데이트
    useEffect(() => {
        if (visible && currentConfig) {
            setLocationHierarchy(currentConfig.locationHierarchy || []);
            setSortColumn(currentConfig.sortColumn || '');
            setSortDirection(currentConfig.sortDirection || 'asc');

            // 그룹 마이그레이션 및 업데이트
            if (currentConfig.targetGroups && currentConfig.targetGroups.length > 0) {
                setTargetGroups(currentConfig.targetGroups);
            } else if (currentConfig.targetConditions && currentConfig.targetConditions.length > 0) {
                setTargetGroups([{
                    id: 'default-group',
                    operator: currentConfig.targetLogicalOperator || 'and',
                    conditions: currentConfig.targetConditions
                }]);
            } else {
                setTargetGroups([{ id: 'group-1', operator: 'and', conditions: [] }]);
            }

            setGlobalLogicalOperator(currentConfig.globalLogicalOperator || 'and');
            setEditableFields(currentConfig.editableFields || []);
        }
    }, [visible, currentConfig]);

    // 각 컬럼의 고유 값 추출
    const columnValues = useMemo(() => {
        const values: Record<string, string[]> = {};
        schema.forEach(col => {
            const set = new Set<string>();
            assets.forEach(asset => {
                const val = String(asset.values[col] ?? '');
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
    // 그룹 추가
    const addGroup = () => {
        const newGroup: TargetGroup = {
            id: `group-${Date.now()}`,
            operator: 'and',
            conditions: []
        };
        setTargetGroups(prev => [...prev, newGroup]);
    };

    // 그룹 제거
    const removeGroup = (id: string) => {
        setTargetGroups(prev => {
            if (prev.length <= 1) return prev; // 최소 1개 그룹 유지
            return prev.filter(g => g.id !== id);
        });
    };

    // 그룹 연산자 업데이트
    const updateGroupOperator = (id: string, operator: 'and' | 'or') => {
        setTargetGroups(prev => prev.map(g => g.id === id ? { ...g, operator } : g));
    };

    // 조건 추가 (특정 그룹에) - 같은 컬럼도 중복 추가 가능
    const addConditionsToGroup = (groupId: string, columns: string | string[]) => {
        const columnsToProcess = Array.isArray(columns) ? columns : [columns];

        setTargetGroups(prev => prev.map(group => {
            if (group.id !== groupId) return group;

            // 같은 컬럼도 중복으로 추가할 수 있도록 필터링 로직 제거
            const newConditions: TargetCondition[] = columnsToProcess.map((column, index) => ({
                id: `${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
                column,
                type: 'is_empty',
                values: [],
            }));

            return {
                ...group,
                conditions: [...group.conditions, ...newConditions]
            };
        }));

        // 편집 가능 필드에도 자동 추가
        setEditableFields(prev => {
            const next = [...prev];
            columnsToProcess.forEach(column => {
                if (!next.includes(column)) {
                    next.push(column);
                }
            });
            return next;
        });

        setShowColumnPicker(false);
    };

    // 조건 업데이트
    const updateCondition = (conditionId: string, updates: Partial<TargetCondition>) => {
        setTargetGroups(prev => prev.map(group => ({
            ...group,
            conditions: group.conditions.map(c => (c.id === conditionId ? { ...c, ...updates } : c))
        })));
    };

    // 조건 제거
    const removeCondition = (conditionId: string) => {
        setTargetGroups(prev => prev.map(group => ({
            ...group,
            conditions: group.conditions.filter(c => c.id !== conditionId)
        })));
    };

    // 값 선택 토글 (리스트 전용)
    const toggleConditionValue = (conditionId: string, value: string) => {
        setTargetGroups(prev => prev.map(group => ({
            ...group,
            conditions: group.conditions.map(c => {
                if (c.id === conditionId) {
                    const values = c.values.includes(value)
                        ? c.values.filter(v => v !== value)
                        : [...c.values, value];
                    return { ...c, values };
                }
                return c;
            })
        })));
    };

    // 값 강제 추가 (검색/직접입력 전용)
    const addConditionValue = (conditionId: string, value: string) => {
        setTargetGroups(prev => prev.map(group => ({
            ...group,
            conditions: group.conditions.map(c => {
                if (c.id === conditionId && !c.values.includes(value)) {
                    return { ...c, values: [...c.values, value] };
                }
                return c;
            })
        })));
    };

    // 편집 필드 토글
    const toggleEditableField = (column: string) => {
        if (editableFields.includes(column)) {
            setEditableFields(prev => prev.filter(c => c !== column));
        } else {
            setEditableFields(prev => [...prev, column]);
        }
    };

    // 필터 조건에서 사용된 컬럼들을 편집필드에 추가
    const importFilterColumnsToEditable = () => {
        const filterColumns = new Set<string>();

        // targetGroups에서 사용된 모든 컬럼 수집
        targetGroups.forEach(group => {
            group.conditions.forEach(cond => {
                if (cond.column) {
                    filterColumns.add(cond.column);
                }
            });
        });

        // 기존 편집필드에 없는 컬럼만 추가
        const newColumns = Array.from(filterColumns).filter(col => !editableFields.includes(col));
        if (newColumns.length > 0) {
            setEditableFields(prev => [...prev, ...newColumns]);
        }
    };

    // 적용
    const getMatchCount = (cond: TargetCondition) => {
        if (!assets || assets.length === 0) return 0;

        return assets.filter(asset => {
            const columnKey = String(cond.column ?? '');
            const val = String(asset.values[columnKey] ?? '');
            const valLower = val.toLowerCase();

            switch (cond.type) {
                case 'is_empty':
                    return !val || val === '';
                case 'is_not_empty':
                    return val && val !== '';
                case 'contains': {
                    if (cond.values && cond.values.length > 0) {
                        // select/multi_select 타입: 아이템 기반 매칭
                        const propType = schemaProperties[columnKey]?.type;
                        if (propType === 'select' || propType === 'multi_select') {
                            // 공백 체크
                            if (cond.values.includes('') && (!val || val === '')) {
                                return true;
                            }
                            // multi_select는 콤마로 구분된 아이템들
                            const items = val.split(',').map(v => v.trim().toLowerCase());
                            return cond.values.some(v => {
                                if (v === '') return false; // 이미 위에서 처리
                                return items.includes(String(v ?? '').toLowerCase());
                            });
                        }
                        // 일반 텍스트: 부분 일치 (하위 호환성)
                        return cond.values.some(v => {
                            if (v === '') return !val || val === '';
                            return valLower.includes(String(v ?? '').toLowerCase());
                        });
                    }
                    return true;
                }
                case 'not_contains': {
                    if (cond.values && cond.values.length > 0) {
                        // select/multi_select 타입: 아이템 기반 매칭
                        const propType = schemaProperties[columnKey]?.type;
                        if (propType === 'select' || propType === 'multi_select') {
                            // 공백 체크
                            if (cond.values.includes('') && (!val || val === '')) {
                                return false;
                            }
                            // multi_select는 콤마로 구분된 아이템들
                            const items = val.split(',').map(v => v.trim().toLowerCase());
                            return !cond.values.some(v => {
                                if (v === '') return !val || val === '';
                                return items.includes(String(v ?? '').toLowerCase());
                            });
                        }
                        // 일반 텍스트: 부분 일치 (하위 호환성)
                        return !cond.values.some(v => {
                            if (v === '') return !val || val === '';
                            return valLower.includes(String(v ?? '').toLowerCase());
                        });
                    }
                    return true;
                }
                case 'text_contains': {
                    // 항상 텍스트 부분 일치
                    if (cond.values && cond.values.length > 0) {
                        return cond.values.some(v => {
                            if (v === '') return !val || val === '';
                            return valLower.includes(String(v ?? '').toLowerCase());
                        });
                    }
                    return true;
                }
                case 'text_not_contains': {
                    // 항상 텍스트 부분 불일치
                    if (cond.values && cond.values.length > 0) {
                        return !cond.values.some(v => {
                            if (v === '') return !val || val === '';
                            return valLower.includes(String(v ?? '').toLowerCase());
                        });
                    }
                    return true;
                }
                case 'equals':
                    if (cond.values && cond.values.length > 0) {
                        return cond.values.some(v => valLower === String(v ?? '').toLowerCase());
                    }
                    return true;
                default:
                    return true;
            }
        }).length;
    };

    const getGroupMatchCount = (group: TargetGroup) => {
        if (!assets || assets.length === 0) return 0;
        if (!group.conditions || group.conditions.length === 0) return assets.length;

        return assets.filter(asset => {
            const conditionMatches = group.conditions.map(cond => {
                const columnKey = String(cond.column ?? '');
                const val = String(asset.values[columnKey] ?? '');
                const valLower = val.toLowerCase();

                switch (cond.type) {
                    case 'is_empty':
                        return !val || val === '';
                    case 'is_not_empty':
                        return val && val !== '';
                    case 'contains': {
                        if (cond.values && cond.values.length > 0) {
                            // select/multi_select 타입: 아이템 기반 매칭
                            const propType = schemaProperties[columnKey]?.type;
                            if (propType === 'select' || propType === 'multi_select') {
                                // 공백 체크
                                if (cond.values.includes('') && (!val || val === '')) {
                                    return true;
                                }
                                // multi_select는 콤마로 구분된 아이템들
                                const items = val.split(',').map(v => v.trim().toLowerCase());
                                return cond.values.some(v => {
                                    if (v === '') return false; // 이미 위에서 처리
                                    return items.includes(String(v ?? '').toLowerCase());
                                });
                            }
                            // 일반 텍스트: 부분 일치 (하위 호환성)
                            return cond.values.some(v => {
                                if (v === '') return !val || val === '';
                                return valLower.includes(String(v ?? '').toLowerCase());
                            });
                        }
                        return true;
                    }
                    case 'not_contains': {
                        if (cond.values && cond.values.length > 0) {
                            // select/multi_select 타입: 아이템 기반 매칭
                            const propType = schemaProperties[columnKey]?.type;
                            if (propType === 'select' || propType === 'multi_select') {
                                // 공백 체크
                                if (cond.values.includes('') && (!val || val === '')) {
                                    return false;
                                }
                                // multi_select는 콤마로 구분된 아이템들
                                const items = val.split(',').map(v => v.trim().toLowerCase());
                                return !cond.values.some(v => {
                                    if (v === '') return !val || val === '';
                                    return items.includes(String(v ?? '').toLowerCase());
                                });
                            }
                            // 일반 텍스트: 부분 일치 (하위 호환성)
                            return !cond.values.some(v => {
                                if (v === '') return !val || val === '';
                                return valLower.includes(String(v ?? '').toLowerCase());
                            });
                        }
                        return true;
                    }
                    case 'text_contains': {
                        // 항상 텍스트 부분 일치
                        if (cond.values && cond.values.length > 0) {
                            return cond.values.some(v => {
                                if (v === '') return !val || val === '';
                                return valLower.includes(String(v ?? '').toLowerCase());
                            });
                        }
                        return true;
                    }
                    case 'text_not_contains': {
                        // 항상 텍스트 부분 불일치
                        if (cond.values && cond.values.length > 0) {
                            return !cond.values.some(v => {
                                if (v === '') return !val || val === '';
                                return valLower.includes(String(v ?? '').toLowerCase());
                            });
                        }
                        return true;
                    }
                    case 'equals':
                        if (cond.values && cond.values.length > 0) {
                            return cond.values.some(v => valLower === String(v ?? '').toLowerCase());
                        }
                        return true;
                    default:
                        return true;
                }
            });

            return group.operator === 'or'
                ? conditionMatches.some(m => m)
                : conditionMatches.every(m => m);
        }).length;
    };

    const handleApply = () => {
        onApply({
            locationHierarchy,
            sortColumn,
            sortDirection,
            targetGroups,
            globalLogicalOperator,
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
        text_contains: '텍스트 포함',
        text_not_contains: '텍스트 미포함',
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
                            <MapPin size={16} color={step === 'hierarchy' ? '#ffffff' : '#6b7280'} />
                            <Text style={[styles.stepText, step === 'hierarchy' && styles.stepTextActive]}>
                                위치 계층
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.stepTab, step === 'sort' && styles.stepTabActive]}
                            onPress={() => setStep('sort')}
                        >
                            <ArrowUpDown size={16} color={step === 'sort' ? '#ffffff' : '#6b7280'} />
                            <Text style={[styles.stepText, step === 'sort' && styles.stepTextActive]}>
                                정렬
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.stepTab, step === 'target' && styles.stepTabActive]}
                            onPress={() => setStep('target')}
                        >
                            <Target size={16} color={step === 'target' ? '#ffffff' : '#6b7280'} />
                            <Text style={[styles.stepText, step === 'target' && styles.stepTextActive]}>
                                작업 대상
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.stepTab, step === 'editable' && styles.stepTabActive]}
                            onPress={() => setStep('editable')}
                        >
                            <Edit3 size={16} color={step === 'editable' ? '#ffffff' : '#6b7280'} />
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
                                <View style={styles.sortContainer}>
                                    <View style={styles.sortSelected}>
                                        <View style={styles.sortInfo}>
                                            <ArrowUpDown size={20} color="#6366f1" />
                                            <Text style={styles.sortColumnText}>{sortColumn}</Text>
                                        </View>
                                        <TouchableOpacity onPress={() => setSortColumn('')}>
                                            <X size={20} color="#ef4444" />
                                        </TouchableOpacity>
                                    </View>

                                    <View style={styles.sortDirectionRow}>
                                        <TouchableOpacity
                                            style={[styles.directionButton, sortDirection === 'asc' && styles.directionButtonActive]}
                                            onPress={() => setSortDirection('asc')}
                                        >
                                            <Text style={[styles.directionButtonText, sortDirection === 'asc' && styles.directionButtonTextActive]}>
                                                오름차순 (1→10)
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.directionButton, sortDirection === 'desc' && styles.directionButtonActive]}
                                            onPress={() => setSortDirection('desc')}
                                        >
                                            <Text style={[styles.directionButtonText, sortDirection === 'desc' && styles.directionButtonTextActive]}>
                                                내림차순 (10→1)
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
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
                            <View style={styles.sectionHeaderRow}>
                                <View>
                                    <Text style={styles.sectionTitle}>작업 대상 조건</Text>
                                    <Text style={styles.sectionDesc}>
                                        어떤 항목을 작업 대상으로 할지 조건을 설정하세요.
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.globalLogicContainer}>
                                <Text style={styles.globalLogicLabel}>그룹 간 논리 관계:</Text>
                                <View style={styles.logicToggleContainer}>
                                    <TouchableOpacity
                                        style={[styles.logicButton, globalLogicalOperator === 'and' && styles.logicButtonActive]}
                                        onPress={() => setGlobalLogicalOperator('and')}
                                    >
                                        <View style={[styles.radio, globalLogicalOperator === 'and' && styles.radioChecked]}>
                                            {globalLogicalOperator === 'and' && <View style={styles.radioInner} />}
                                        </View>
                                        <Text style={[styles.logicButtonText, globalLogicalOperator === 'and' && styles.logicButtonTextActive]}>
                                            모든 그룹 일치 (AND)
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.logicButton, globalLogicalOperator === 'or' && styles.logicButtonActive]}
                                        onPress={() => setGlobalLogicalOperator('or')}
                                    >
                                        <View style={[styles.radio, globalLogicalOperator === 'or' && styles.radioChecked]}>
                                            {globalLogicalOperator === 'or' && <View style={styles.radioInner} />}
                                        </View>
                                        <Text style={[styles.logicButtonText, globalLogicalOperator === 'or' && styles.logicButtonTextActive]}>
                                            하나의 그룹이라도 일치 (OR)
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {targetGroups.map((group, gIndex) => (
                                <View key={group.id} style={styles.groupCard}>
                                    <View style={styles.groupHeader}>
                                        <View style={styles.groupHeaderLeft}>
                                            <Text style={styles.groupTitle}>그룹 {gIndex + 1}</Text>
                                            <View style={styles.groupMatchCountBadge}>
                                                <Text style={styles.groupMatchCountText}>{getGroupMatchCount(group)}</Text>
                                            </View>
                                            <View style={styles.logicToggleSmall}>
                                                <TouchableOpacity
                                                    style={[styles.logicButtonSmall, group.operator === 'and' && styles.logicButtonSmallActive]}
                                                    onPress={() => updateGroupOperator(group.id, 'and')}
                                                >
                                                    <Text style={[styles.logicTextSmall, group.operator === 'and' && styles.logicTextSmallActive]}>AND</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[styles.logicButtonSmall, group.operator === 'or' && styles.logicButtonSmallActive]}
                                                    onPress={() => updateGroupOperator(group.id, 'or')}
                                                >
                                                    <Text style={[styles.logicTextSmall, group.operator === 'or' && styles.logicTextSmallActive]}>OR</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                        {targetGroups.length > 1 && (
                                            <TouchableOpacity onPress={() => removeGroup(group.id)}>
                                                <X size={16} color="#ef4444" />
                                            </TouchableOpacity>
                                        )}
                                    </View>

                                    {group.conditions.map(cond => (
                                        <View key={cond.id} style={styles.conditionCard}>
                                            <View style={styles.conditionHeader}>
                                                <View style={styles.conditionTitleRow}>
                                                    <Text style={styles.conditionColumn}>{cond.column}</Text>
                                                    <View style={styles.matchCountBadge}>
                                                        <Text style={styles.matchCountText}>{getMatchCount(cond)}</Text>
                                                    </View>
                                                </View>
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
                                            {(cond.type === 'contains' || cond.type === 'not_contains' || cond.type === 'equals' || cond.type === 'text_contains' || cond.type === 'text_not_contains') && (
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
                                                                    <Text style={styles.selectedValueText}>{val || '공백'}</Text>
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
                                        style={styles.addSimpleButton}
                                        onPress={() => {
                                            setActiveGroupId(group.id);
                                            setPickerMode('target');
                                            setSelectedTargetColumns(group.conditions.map(c => c.column));
                                            setShowColumnPicker(true);
                                        }}
                                    >
                                        <Text style={styles.addSimpleButtonText}>+ 조건 추가</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}

                            <TouchableOpacity
                                style={styles.addGroupButton}
                                onPress={addGroup}
                            >
                                <Text style={styles.addGroupButtonText}>+ 새로운 그룹 추가</Text>
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

                            {/* 필터 조건 컬럼 가져오기 버튼 */}
                            {(() => {
                                const filterColumnsSet = new Set<string>();
                                targetGroups.forEach(group => {
                                    group.conditions.forEach(cond => {
                                        if (cond.column && !editableFields.includes(cond.column)) {
                                            filterColumnsSet.add(cond.column);
                                        }
                                    });
                                });
                                const importableCount = filterColumnsSet.size;
                                if (importableCount > 0) {
                                    return (
                                        <TouchableOpacity
                                            style={styles.importFilterColumnsButton}
                                            onPress={importFilterColumnsToEditable}
                                        >
                                            <Filter size={16} color="#6366f1" />
                                            <Text style={styles.importFilterColumnsText}>
                                                작업대상 조건 컬럼 가져오기 ({importableCount}개)
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                }
                                return null;
                            })()}

                            {/* 전체 선택/해제 버튼 */}
                            <View style={styles.selectAllEditableContainer}>
                                <Text style={styles.selectedEditableCount}>
                                    {editableFields.length}개 선택됨
                                </Text>
                                <TouchableOpacity
                                    onPress={() => {
                                        const filtered = schema.filter(col => {
                                            if (editableSearchText) {
                                                return col.toLowerCase().includes(editableSearchText.toLowerCase());
                                            }
                                            return true;
                                        });

                                        // 이미 검색된 결과가 모두 선택되어 있는지 확인
                                        const allSelected = filtered.every(col => editableFields.includes(col));

                                        if (allSelected) {
                                            // 모두 선택 해제
                                            setEditableFields(prev => prev.filter(col => !filtered.includes(col)));
                                        } else {
                                            // 검색된 것 모두 선택 (기존 선택 유지)
                                            setEditableFields(prev => {
                                                const next = [...prev];
                                                filtered.forEach(col => {
                                                    if (!next.includes(col)) next.push(col);
                                                });
                                                return next;
                                            });
                                        }
                                    }}
                                    style={styles.selectAllEditableButton}
                                >
                                    <Check size={14} color="#6366f1" />
                                    <Text style={styles.selectAllEditableText}>전체 선택/해제</Text>
                                </TouchableOpacity>
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

                            {/* target 모드에서 선택된 컬럼 표시 및 전체 선택 */}
                            {pickerMode === 'target' && (
                                <View style={styles.selectedColumnsBar}>
                                    <View style={styles.selectedColumnsLeft}>
                                        <Text style={styles.selectedColumnsText}>
                                            {selectedTargetColumns.length}개 선택됨
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        onPress={() => {
                                            const filtered = schema.filter(col => {
                                                if (columnSearchText) {
                                                    return col.toLowerCase().includes(columnSearchText.toLowerCase());
                                                }
                                                return true;
                                            });

                                            // 이미 검색된 결과가 모두 선택되어 있는지 확인
                                            const allSelected = filtered.every(col => selectedTargetColumns.includes(col));

                                            if (allSelected) {
                                                // 모두 선택 해제
                                                setSelectedTargetColumns(prev => prev.filter(col => !filtered.includes(col)));
                                            } else {
                                                // 검색된 것 모두 선택 (기존 선택 유지)
                                                setSelectedTargetColumns(prev => {
                                                    const next = [...prev];
                                                    filtered.forEach(col => {
                                                        if (!next.includes(col)) next.push(col);
                                                    });
                                                    return next;
                                                });
                                            }
                                        }}
                                        style={styles.selectAllButton}
                                    >
                                        <Check size={14} color="#6366f1" />
                                        <Text style={styles.selectAllText}>전체 선택/해제</Text>
                                    </TouchableOpacity>
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
                                        if (activeGroupId) {
                                            addConditionsToGroup(activeGroupId, selectedTargetColumns);
                                        }
                                        setSelectedTargetColumns([]);
                                        setColumnSearchText('');
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
                                                addConditionValue(activeConditionId, valueSearchText.trim());
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
                                    // 중첩된 그룹 내에서 조건을 찾음
                                    let cond = null;
                                    for (const group of targetGroups) {
                                        cond = group.conditions.find(c => c.id === activeConditionId);
                                        if (cond) break;
                                    }

                                    if (!cond) return null;

                                    const dbValues = columnValues[cond.column] || [];
                                    const selectedValues = cond.values;

                                    // 현재 데이터에 존재하는 값만 표시 (schemaProperties의 options도 포함)
                                    const schemaOptions = schemaProperties[cond.column]?.options?.map(o => o.name) || [];
                                    const validValues = Array.from(new Set([...dbValues, ...schemaOptions])).sort();

                                    // 이미 선택된 값 중 더 이상 존재하지 않는 값들
                                    const staleSelectedValues = selectedValues.filter(v => !validValues.includes(v));

                                    const filteredValidValues = validValues.filter(v =>
                                        v.toLowerCase().includes(valueSearchText.toLowerCase())
                                    );

                                    const filteredStaleValues = staleSelectedValues.filter(v =>
                                        v.toLowerCase().includes(valueSearchText.toLowerCase())
                                    );

                                    return (
                                        <>
                                            {/* 공백 옵션 (contains/not_contains/text 타입에만 표시) */}
                                            {(cond.type === 'contains' || cond.type === 'not_contains' || cond.type === 'text_contains' || cond.type === 'text_not_contains') && (
                                                <TouchableOpacity
                                                    style={[
                                                        styles.valueItem,
                                                        cond.values.includes('') && styles.valueItemActive,
                                                    ]}
                                                    onPress={() => toggleConditionValue(activeConditionId, '')}
                                                >
                                                    <Text style={[
                                                        styles.valueItemText,
                                                        { color: '#9ca3af', fontStyle: 'italic' },
                                                        cond.values.includes('') && styles.valueItemTextActive,
                                                    ]}>
                                                        공백
                                                    </Text>
                                                    {cond.values.includes('') && (
                                                        <Check size={18} color="#6366f1" />
                                                    )}
                                                </TouchableOpacity>
                                            )}

                                            {/* 유효하지 않은 선택값 (경고 표시) */}
                                            {filteredStaleValues.length > 0 && (
                                                <>
                                                    <Text style={styles.staleValuesWarning}>
                                                        ⚠️ 더 이상 존재하지 않는 값 (삭제 권장)
                                                    </Text>
                                                    {filteredStaleValues.map(val => (
                                                        <TouchableOpacity
                                                            key={val}
                                                            style={[styles.valueItem, styles.valueItemStale]}
                                                            onPress={() => toggleConditionValue(activeConditionId, val)}
                                                        >
                                                            <Text style={[styles.valueItemText, styles.valueItemTextStale]}>
                                                                {val}
                                                            </Text>
                                                            {cond.values.includes(val) && (
                                                                <Check size={18} color="#ef4444" />
                                                            )}
                                                        </TouchableOpacity>
                                                    ))}
                                                </>
                                            )}

                                            {/* 유효한 값들 */}
                                            {filteredValidValues.map(val => (
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
                                            ))}
                                        </>
                                    );
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
        backgroundColor: '#f8fafc',
        paddingVertical: 8,
    },
    steps: {
        flexDirection: 'row',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 6,
        paddingHorizontal: 16,
    },
    stepTab: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 6,
        paddingHorizontal: 10,
        gap: 4,
        borderRadius: 16,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    stepTabActive: {
        backgroundColor: '#6366f1',
        borderColor: '#6366f1',
    },
    stepText: {
        fontSize: 12,
        color: '#6b7280',
        fontWeight: '500',
    },
    stepTextActive: {
        color: '#ffffff',
        fontWeight: '600',
    },
    content: {
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
    sortContainer: {
        backgroundColor: '#f9fafb',
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    sortDirectionRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },
    directionButton: {
        flex: 1,
        backgroundColor: '#ffffff',
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    directionButtonActive: {
        backgroundColor: '#eef2ff',
        borderColor: '#6366f1',
    },
    directionButtonText: {
        fontSize: 14,
        color: '#6b7280',
        fontWeight: '500',
    },
    directionButtonTextActive: {
        color: '#6366f1',
        fontWeight: '600',
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
    conditionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    matchCountBadge: {
        backgroundColor: '#eef2ff',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e0e7ff',
    },
    matchCountText: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#6366f1',
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
    importFilterColumnsButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#eef2ff',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#c7d2fe',
        gap: 8,
    },
    importFilterColumnsText: {
        fontSize: 14,
        color: '#6366f1',
        fontWeight: '500',
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
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#eef2ff',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    selectedColumnsLeft: {
        flex: 1,
    },
    selectedColumnsText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#6366f1',
    },
    selectAllButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        gap: 6,
    },
    selectAllText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#6366f1',
    },
    logicToggleContainer: {
        flexDirection: 'row',
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        padding: 4,
        marginBottom: 16,
        gap: 4,
    },
    logicButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 8,
        gap: 8,
    },
    logicButtonActive: {
        backgroundColor: '#ffffff',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    logicButtonText: {
        fontSize: 13,
        color: '#6b7280',
        fontWeight: '500',
    },
    logicButtonTextActive: {
        color: '#6366f1',
        fontWeight: 'bold',
    },
    radio: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: '#d1d5db',
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioChecked: {
        borderColor: '#6366f1',
    },
    radioInner: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#6366f1',
    },
    doneButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    groupCard: {
        backgroundColor: '#f8fafc',
        borderRadius: 16,
        padding: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    groupHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    groupHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    groupMatchCountBadge: {
        backgroundColor: '#475569',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    groupMatchCountText: {
        fontSize: 11,
        fontWeight: 'bold',
        color: '#ffffff',
    },
    groupTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#475569',
    },
    logicToggleSmall: {
        flexDirection: 'row',
        backgroundColor: '#e2e8f0',
        borderRadius: 8,
        padding: 2,
    },
    logicButtonSmall: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    logicButtonSmallActive: {
        backgroundColor: '#ffffff',
    },
    logicTextSmall: {
        fontSize: 11,
        color: '#64748b',
        fontWeight: '600',
    },
    logicTextSmallActive: {
        color: '#6366f1',
    },
    addSimpleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#cbd5e1',
        borderRadius: 8,
        marginTop: 8,
    },
    addSimpleButtonText: {
        fontSize: 13,
        color: '#64748b',
        fontWeight: '500',
    },
    addGroupButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        backgroundColor: '#f1f5f9',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        marginTop: 8,
    },
    addGroupButtonText: {
        fontSize: 14,
        color: '#475569',
        fontWeight: 'bold',
    },
    globalLogicContainer: {
        marginBottom: 16,
    },
    globalLogicLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#64748b',
        marginBottom: 8,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
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
    staleValuesWarning: {
        fontSize: 12,
        color: '#ef4444',
        fontWeight: '500',
        padding: 12,
        paddingBottom: 4,
        backgroundColor: '#fef2f2',
    },
    valueItemStale: {
        backgroundColor: '#fef2f2',
        borderLeftWidth: 3,
        borderLeftColor: '#ef4444',
    },
    valueItemTextStale: {
        color: '#b91c1c',
        textDecorationLine: 'line-through',
    },
    selectAllEditableContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        paddingHorizontal: 4,
    },
    selectedEditableCount: {
        fontSize: 13,
        color: '#6b7280',
    },
    selectAllEditableButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#eef2ff',
        borderRadius: 6,
        gap: 4,
    },
    selectAllEditableText: {
        fontSize: 13,
        color: '#6366f1',
        fontWeight: '500',
    },
});
