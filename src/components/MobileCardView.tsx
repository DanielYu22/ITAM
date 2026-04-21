import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    TextInput,
    ScrollView,
    Alert,
    KeyboardAvoidingView,
    Platform,
    TouchableWithoutFeedback,
    Keyboard,
    Dimensions,
    FlatList,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import { Edit2, X, Check, Search, Plus, ChevronDown, ChevronRight, ChevronLeft, AlertCircle, CheckCircle, MapPin } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import { FilterConfig, TargetCondition } from './FieldWorkFilter';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// Explicit height calculation for web compatibility
// Header ~60px, Pagination ~60px, Padding ~32px = 152px total chrome
const CARD_HEIGHT = SCREEN_HEIGHT - 152;

interface MobileCardViewProps {
    assets: Asset[];
    allAssets?: Asset[]; // 전체 자산 목록
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdateAsset: (assetId: string, field: string, value: string, type: string) => Promise<void>;
    editableFields?: string[];
    filterConfig?: FilterConfig | null;
    onLocalUpdate?: (assetId: string, field: string, value: string) => void;
    // Location Navigation
    locationHierarchy?: string[];
    locationFilters?: Record<string, string>;
    onRequestChangeLocation?: () => void;
}

// 필터 조건 평가 함수
const evaluateCondition = (asset: Asset, cond: TargetCondition): boolean => {
    const columnKey = String(cond.column ?? '');
    const val = String(asset.values[columnKey] ?? '').toLowerCase();
    switch (cond.type) {
        case 'is_empty':
            return !val || val === '';
        case 'is_not_empty':
            return val !== '';
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
};

// 매칭된 조건들 찾기
const getMatchedConditions = (asset: Asset, filterConfig: FilterConfig | null): TargetCondition[] => {
    if (!filterConfig?.targetGroups) return [];
    const matched: TargetCondition[] = [];
    for (const group of filterConfig.targetGroups) {
        for (const cond of group.conditions) {
            if (evaluateCondition(asset, cond)) {
                matched.push(cond);
            }
        }
    }
    return matched;
};

// 조건 설명 텍스트
const getConditionText = (cond: TargetCondition): string => {
    switch (cond.type) {
        case 'is_empty':
            return `${cond.column} 미입력`;
        case 'is_not_empty':
            return `${cond.column} 입력됨`;
        case 'contains':
            return `${cond.column} 포함: ${cond.values.join(', ')}`;
        case 'not_contains':
            return `${cond.column} 미포함: ${cond.values.join(', ')}`;
        case 'equals':
            return `${cond.column} = ${cond.values.join(', ')}`;
        case 'text_contains':
            return `${cond.column} 텍스트 포함: ${cond.values.join(', ')}`;
        case 'text_not_contains':
            return `${cond.column} 텍스트 미포함: ${cond.values.join(', ')}`;
        default:
            return cond.column;
    }
};

export const MobileCardView: React.FC<MobileCardViewProps> = ({
    assets,
    allAssets,
    schema,
    schemaProperties,
    onUpdateAsset,
    editableFields = [],
    filterConfig = null,
    onLocalUpdate,
    locationHierarchy,
    locationFilters,
    onRequestChangeLocation,
}) => {
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

    // Location Text Generation
    const locationText = useMemo(() => {
        if (!locationHierarchy || !locationFilters || Object.keys(locationFilters).length === 0) {
            return '전체 위치 (변경하려면 클릭)';
        }
        return locationHierarchy
            .map(col => locationFilters[col])
            .filter(val => val)
            .join(' > ');
    }, [locationHierarchy, locationFilters]);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const flatListRef = useRef<FlatList>(null);
    const fieldScrollRef = useRef<ScrollView>(null);
    const optionsScrollRef = useRef<ScrollView>(null); // 드롭다운 옵션 스크롤

    // 편집 상태
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Select/Multi-Select UI 상태
    const [showOptions, setShowOptions] = useState(false);
    const [optionSearchText, setOptionSearchText] = useState('');
    const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
    const [highlightedOptionIndex, setHighlightedOptionIndex] = useState(0); // 방향키 드롭다운 네비게이션
    const [hasAutoFocused, setHasAutoFocused] = useState(false); // 자동 포커스 여부

    const titleField = useMemo(() => {
        return Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name';
    }, [schemaProperties]);

    // 키보드 네비게이션 시 하이라이트된 옵션으로 자동 스크롤
    useEffect(() => {
        if (optionsScrollRef.current && showOptions && highlightedOptionIndex >= 0) {
            const optionHeight = 44; // 옵션 아이템 높이
            optionsScrollRef.current.scrollTo({
                y: highlightedOptionIndex * optionHeight - optionHeight,
                animated: true
            });
        }
    }, [highlightedOptionIndex, showOptions]);

    // 현장 작업 진입 시 첫 번째 타겟 필드 자동 오픈 (조건에 해당하는 필드 우선, Title 제외)
    useEffect(() => {
        // 이미 포커스 했거나, 데이터가 없거나, 스키마 정보가 아직 없으면 리턴
        if (hasAutoFocused || assets.length === 0 || Object.keys(schemaProperties).length === 0) return;

        const firstAsset = assets[0];
        let targetField = '';

        // 1. 필터 조건이 있으면 조건에 해당하는 첫 번째 필드 선택 (Title 제외)
        if (filterConfig) {
            const matchedConditions = getMatchedConditions(firstAsset, filterConfig);
            // Title이 아닌 첫 번째 매칭 조건 찾기
            const firstValidCondition = matchedConditions.find(c => c.column !== titleField);
            if (firstValidCondition) {
                targetField = firstValidCondition.column;
            }
        }

        // 2. 조건 매칭 없으면, editableFields 중 첫 번째 (Title 제외)
        if (!targetField) {
            const fieldsToCheck = editableFields.length > 0 ? editableFields : schema;
            const firstEditableField = fieldsToCheck.find((f: string) => f !== titleField);
            if (firstEditableField) {
                targetField = firstEditableField;
            }
        }

        // 3. 타겟 필드가 결정되면 오픈
        if (targetField) {
            setTimeout(() => {
                handleEdit(firstAsset, targetField);
            }, 500);
            setHasAutoFocused(true);
        }
    }, [assets, filterConfig, hasAutoFocused, editableFields, schema, titleField, schemaProperties]);

    const handleEdit = (asset: Asset, field: string) => {
        setSelectedAsset(asset);
        setEditingField(field);
        const currentValue = asset.values[field] ?? ''; // Use ?? for safety
        setEditValue(currentValue);

        const propType = schemaProperties[field]?.type;
        if (propType === 'multi_select') {
            setSelectedOptions(currentValue.split(',').map(s => s.trim()).filter(Boolean));
        } else if (propType === 'select') {
            setSelectedOptions(currentValue ? [currentValue] : []);
        }

        setOptionSearchText('');
        setHighlightedOptionIndex(0);
        setEditModalVisible(true);
        // Select/Multi-Select는 드롭다운 자동 오픈
        setShowOptions(['select', 'multi_select'].includes(propType));
    };





    const handleSave = async (directValue?: string) => {
        if (!selectedAsset || !editingField) return;

        setIsSaving(true);
        try {
            const propType = schemaProperties[editingField]?.type || 'rich_text';
            let valueToSave = editValue;

            if (propType === 'multi_select') {
                valueToSave = selectedOptions.join(', ');
            } else if (propType === 'select') {
                // directValue가 전달되면 우선 사용 (toggleOption에서 직접 전달)
                // 그렇지 않으면 editValue 또는 selectedOptions 사용
                valueToSave = directValue ?? (editValue || selectedOptions[0] || '');
            }



            await onUpdateAsset(selectedAsset.id, editingField, valueToSave, propType);

            // 부모에게 로컬 업데이트 알림 (즉시 반영)
            if (onLocalUpdate) {
                onLocalUpdate(selectedAsset.id, editingField, valueToSave);
            }

            // 현재 선택된 자산 데이터 업데이트 (UI 반영용)
            const updatedAsset = {
                ...selectedAsset,
                values: {
                    ...selectedAsset.values,
                    [editingField]: valueToSave
                }
            };
            setSelectedAsset(updatedAsset);

            // 필터 조건이 해결되었는지 확인
            if (filterConfig) {
                const beforeConditions = getMatchedConditions(selectedAsset, filterConfig);
                const afterConditions = getMatchedConditions(updatedAsset, filterConfig);

                // 이전에 매칭되던 조건이 해결됨
                if (beforeConditions.length > afterConditions.length) {
                    const resolvedCount = beforeConditions.length - afterConditions.length;

                    if (afterConditions.length === 0) {
                        // 모든 조건 해결됨 - 자동으로 다음 항목 이동
                        if (currentIndex < assets.length - 1) {
                            // 잠시 후 자동 이동 (사용자가 결과 확인할 시간)
                            setTimeout(() => {
                                flatListRef.current?.scrollToIndex({
                                    index: currentIndex + 1,
                                    animated: true
                                });
                            }, 800);
                            Alert.alert('✅ 완료!', '다음 항목으로 자동 이동합니다.');
                        } else {
                            Alert.alert('🎉 모든 작업 완료!', '마지막 항목까지 모두 처리했습니다.');
                        }
                    } else {
                        // 일부 조건 해결됨
                        Alert.alert('👍 진행 중', `${resolvedCount}개 조건 해결! 남은 조건: ${afterConditions.length}개`);
                    }
                }
            }

            const savedField = editingField; // 저장하기 전에 현재 필드 저장
            setEditModalVisible(false);
            setEditingField(null);

            // 저장 후 스크롤을 위로 이동 (타겟 필드가 상단에 정렬되므로)
            setTimeout(() => {
                fieldScrollRef.current?.scrollTo({ y: 0, animated: true });
            }, 100);

            // 저장 후 다음 필드로 자동 이동
            if (savedField) {
                openNextField(savedField);
            }
        } catch (error) {
            Alert.alert('Error', 'Failed to update asset');
        } finally {
            setIsSaving(false);
        }
    };

    const toggleOption = (option: string, isMulti: boolean, autoSave: boolean = false) => {
        if (isMulti) {
            setSelectedOptions(prev =>
                prev.includes(option)
                    ? prev.filter(o => o !== option)
                    : [...prev, option]
            );
        } else {
            setSelectedOptions([option]);
            setEditValue(option);
            setShowOptions(false);

            // Select 타입에서 선택하면 즉시 저장 - option을 직접 전달하여 상태 동기화 이슈 방지
            if (autoSave && selectedAsset && editingField) {
                setTimeout(() => {
                    handleSave(option); // 선택된 값 직접 전달
                }, 50);
            }
        }
    };

    // 옵션 필터링
    const filteredOptions = useMemo(() => {
        if (!editingField || !schemaProperties[editingField]?.options) return [];

        const options = schemaProperties[editingField].options || [];
        if (!optionSearchText) return options;

        return options.filter(opt =>
            opt.name.toLowerCase().includes(optionSearchText.toLowerCase())
        );
    }, [editingField, schemaProperties, optionSearchText]);

    // 정렬된 편집 가능 필드 목록 (타겟 필드가 상단에)
    const sortedEditableFields = useMemo(() => {
        const currentAsset = assets[currentIndex];
        if (!currentAsset || !filterConfig) return editableFields.length > 0 ? editableFields : schema;

        const matchedConditions = getMatchedConditions(currentAsset, filterConfig);
        return (editableFields.length > 0 ? editableFields : schema)
            .filter((field: string) => field !== titleField)
            .sort((a: string, b: string) => {
                const aMatched = matchedConditions.some(c => c.column === a);
                const bMatched = matchedConditions.some(c => c.column === b);
                if (aMatched && !bMatched) return -1;
                if (!aMatched && bMatched) return 1;
                return 0;
            });
    }, [assets, currentIndex, filterConfig, editableFields, schema, titleField]);

    // 다음 필드로 자동 이동
    const openNextField = (currentField: string) => {
        const currentAsset = assets[currentIndex];
        if (!currentAsset) return;

        const currentIdx = sortedEditableFields.indexOf(currentField);
        if (currentIdx >= 0 && currentIdx < sortedEditableFields.length - 1) {
            const nextField = sortedEditableFields[currentIdx + 1];
            // 잠시 후 다음 필드 열기
            setTimeout(() => {
                handleEdit(currentAsset, nextField);
            }, 200);
        }
    };

    const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const contentOffsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(contentOffsetX / SCREEN_WIDTH);
        if (index !== currentIndex) {
            setCurrentIndex(index);
        }
    };

    const renderAssetCard = ({ item: asset }: { item: Asset }) => {
        // 이 항목이 매칭된 필터 조건들
        const matchedConditions = getMatchedConditions(asset, filterConfig);

        // 필드별 매칭 조건 찾기
        const getFieldCondition = (fieldName: string): TargetCondition | null => {
            return matchedConditions.find(c => c.column === fieldName) || null;
        };

        return (
            <View style={styles.cardContainer}>
                <View style={styles.cardWrapper}>
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text style={styles.cardTitle}>
                                {asset.values[titleField] ?? 'Untitled'}
                            </Text>
                        </View>

                        <ScrollView
                            ref={fieldScrollRef}
                            style={styles.cardBody}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={styles.cardBodyContent}
                            keyboardShouldPersistTaps="handled"
                        >
                            {(editableFields.length > 0 ? editableFields : schema)
                                .filter((field: string) => field !== titleField)
                                .sort((a: string, b: string) => {
                                    // 조건 매칭 필드를 상단으로 정렬
                                    const aMatched = !!getFieldCondition(a);
                                    const bMatched = !!getFieldCondition(b);
                                    if (aMatched && !bMatched) return -1;
                                    if (!aMatched && bMatched) return 1;
                                    return 0; // 원래 순서 유지
                                })
                                .map((field: string) => {
                                    const fieldCondition = getFieldCondition(field);
                                    const isHighlighted = !!fieldCondition;

                                    return (
                                        <TouchableOpacity
                                            key={field}
                                            style={[
                                                styles.fieldRow,
                                                isHighlighted && styles.fieldRowHighlighted
                                            ]}
                                            onPress={() => handleEdit(asset, field)}
                                            activeOpacity={0.7}
                                        >
                                            <View style={styles.fieldLabelRow}>
                                                <View style={styles.fieldLabelContainer}>
                                                    <Text style={[
                                                        styles.fieldLabel,
                                                        isHighlighted && styles.fieldLabelHighlighted
                                                    ]}>{field}</Text>
                                                    {isHighlighted && (
                                                        <View style={styles.fieldConditionBadge}>
                                                            <AlertCircle size={10} color="#b45309" />
                                                            <Text style={styles.fieldConditionText}>
                                                                {fieldCondition.type === 'is_empty' ? '미입력' :
                                                                    fieldCondition.type === 'contains' ? `포함: ${fieldCondition.values.join(', ')}` :
                                                                        fieldCondition.type === 'equals' ? `= ${fieldCondition.values.join(', ')}` :
                                                                            '조건 매칭'}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                                {editableFields.includes(field) && (
                                                    <Edit2 size={12} color={isHighlighted ? "#b45309" : "#6366f1"} />
                                                )}
                                            </View>
                                            <View style={styles.fieldValueContainer}>
                                                <Text style={[
                                                    styles.fieldValue,
                                                    isHighlighted && styles.fieldValueHighlighted
                                                ]}>
                                                    {asset.values[field] ?? '-'}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                        </ScrollView>
                    </View>
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            {/* Location Navigation Bar */}
            {locationHierarchy && locationHierarchy.length > 0 && (
                <TouchableOpacity
                    style={styles.locationHeader}
                    onPress={onRequestChangeLocation}
                >
                    <MapPin size={16} color="#6366f1" />
                    <Text style={styles.locationHeaderText} numberOfLines={1}>
                        {locationText}
                    </Text>
                    <ChevronDown size={16} color="#6b7280" />
                </TouchableOpacity>
            )}

            {/* Pagination */}
            <View style={styles.paginationContainer}>
                <TouchableOpacity
                    onPress={() => flatListRef.current?.scrollToIndex({ index: Math.max(0, currentIndex - 1) })}
                    disabled={currentIndex === 0}
                    style={styles.navButton}
                >
                    <ChevronLeft size={24} color={currentIndex === 0 ? '#e5e7eb' : '#6366f1'} />
                </TouchableOpacity>

                <View style={styles.paginationInfo}>
                    <Text style={styles.paginationText}>
                        <Text style={styles.currentIndexText}>{currentIndex + 1}</Text> / {assets.length}
                    </Text>
                    <Text style={styles.assetNameHint} numberOfLines={1}>
                        {assets[currentIndex]?.values[titleField]}
                    </Text>
                </View>

                <TouchableOpacity
                    onPress={() => flatListRef.current?.scrollToIndex({ index: Math.min(assets.length - 1, currentIndex + 1) })}
                    disabled={currentIndex === assets.length - 1}
                    style={styles.navButton}
                >
                    <ChevronRight size={24} color={currentIndex === assets.length - 1 ? '#e5e7eb' : '#6366f1'} />
                </TouchableOpacity>
            </View>

            <FlatList
                ref={flatListRef}
                data={assets}
                extraData={assets}
                renderItem={renderAssetCard}
                keyExtractor={item => item.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                style={styles.flatList}
                getItemLayout={(_, index) => ({
                    length: SCREEN_WIDTH,
                    offset: SCREEN_WIDTH * index,
                    index,
                })}
            />

            {/* Edit Modal */}
            <Modal
                visible={editModalVisible}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setEditModalVisible(false)}
            >
                <TouchableWithoutFeedback onPress={() => setEditModalVisible(false)}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                            style={styles.modalSubOverlay}
                        >
                            <TouchableWithoutFeedback onPress={() => { }}>
                                <View style={styles.modalContent}>
                                    <View style={styles.modalHeader}>
                                        <Text style={styles.modalTitle}>{editingField}</Text>
                                        <TouchableOpacity
                                            onPress={() => setEditModalVisible(false)}
                                            style={{ padding: 4 }}
                                        >
                                            <X size={24} color="#6b7280" />
                                        </TouchableOpacity>
                                    </View>

                                    {editingField && (
                                        <View>
                                            {/* Select / Multi-Select */}
                                            {['select', 'multi_select'].includes(schemaProperties[editingField]?.type) ? (
                                                <View style={styles.selectContainer}>
                                                    <TouchableOpacity
                                                        style={styles.selectedValueBox}
                                                        onPress={() => setShowOptions(!showOptions)}
                                                    >
                                                        <View style={styles.selectedTags}>
                                                            {selectedOptions.length > 0 ? (
                                                                selectedOptions.map(opt => (
                                                                    <View key={opt} style={styles.tag}>
                                                                        <Text style={styles.tagText}>{opt}</Text>
                                                                        {schemaProperties[editingField].type === 'multi_select' && (
                                                                            <TouchableOpacity onPress={() => toggleOption(opt, true)}>
                                                                                <X size={12} color="#4b5563" />
                                                                            </TouchableOpacity>
                                                                        )}
                                                                    </View>
                                                                ))
                                                            ) : (
                                                                <Text style={styles.placeholderText}>값을 선택하세요</Text>
                                                            )}
                                                        </View>
                                                        <ChevronDown size={20} color="#9ca3af" />
                                                    </TouchableOpacity>

                                                    {/* 옵션 드롭다운 */}
                                                    {(showOptions || optionSearchText) && (
                                                        <View style={styles.dropdownContainer}>
                                                            <View style={styles.optionSearch}>
                                                                <Search size={16} color="#9ca3af" />
                                                                <TextInput
                                                                    style={styles.optionSearchInput}
                                                                    value={optionSearchText}
                                                                    onChangeText={(text) => {
                                                                        setOptionSearchText(text);
                                                                        setShowOptions(true);
                                                                        setHighlightedOptionIndex(0);
                                                                    }}
                                                                    placeholder="옵션 검색 또는 생성..."
                                                                    placeholderTextColor="#9ca3af"
                                                                    autoFocus
                                                                    onKeyPress={(e: any) => {
                                                                        const key = e.nativeEvent?.key || e.key;
                                                                        if (key === 'ArrowDown') {
                                                                            setHighlightedOptionIndex(prev =>
                                                                                Math.min(prev + 1, filteredOptions.length - 1)
                                                                            );
                                                                        } else if (key === 'ArrowUp') {
                                                                            setHighlightedOptionIndex(prev => Math.max(prev - 1, 0));
                                                                        } else if (key === 'Enter' && filteredOptions.length > 0) {
                                                                            const selectedOpt = filteredOptions[highlightedOptionIndex];
                                                                            if (selectedOpt) {
                                                                                const isMulti = schemaProperties[editingField]?.type === 'multi_select';
                                                                                toggleOption(selectedOpt.name, isMulti, !isMulti);
                                                                                setOptionSearchText('');
                                                                            }
                                                                        } else if (key === 'Escape') {
                                                                            setEditModalVisible(false);
                                                                        }
                                                                    }}
                                                                />
                                                            </View>

                                                            <ScrollView ref={optionsScrollRef} style={styles.optionsList} keyboardShouldPersistTaps="handled">
                                                                {/* 공백 옵션 (빈 값 설정) */}
                                                                <TouchableOpacity
                                                                    style={[
                                                                        styles.optionItem,
                                                                        styles.emptyOptionItem,
                                                                        selectedOptions.length === 0 && styles.optionItemSelected
                                                                    ]}
                                                                    onPress={() => {
                                                                        const isMulti = schemaProperties[editingField].type === 'multi_select';
                                                                        // 공백 선택 시 빈 배열로 설정
                                                                        setSelectedOptions([]);
                                                                        if (!isMulti) {
                                                                            setEditValue('');
                                                                            setShowOptions(false);
                                                                            // Select 타입에서 공백 선택 시 즉시 저장
                                                                            if (selectedAsset && editingField) {
                                                                                setTimeout(() => {
                                                                                    handleSave(''); // 빈 문자열로 저장
                                                                                }, 50);
                                                                            }
                                                                        }
                                                                    }}
                                                                >
                                                                    <Text style={[styles.optionText, styles.emptyOptionText]}>
                                                                        공백
                                                                    </Text>
                                                                    {selectedOptions.length === 0 && <Check size={16} color="#6366f1" />}
                                                                </TouchableOpacity>

                                                                {filteredOptions.map((opt, idx) => {
                                                                    const isSelected = selectedOptions.includes(opt.name);
                                                                    const isHighlighted = idx === highlightedOptionIndex;
                                                                    return (
                                                                        <TouchableOpacity
                                                                            key={opt.id}
                                                                            style={[
                                                                                styles.optionItem,
                                                                                isSelected && styles.optionItemSelected,
                                                                                isHighlighted && styles.optionItemHighlighted
                                                                            ]}
                                                                            onPress={() => {
                                                                                const isMulti = schemaProperties[editingField].type === 'multi_select';
                                                                                toggleOption(opt.name, isMulti, !isMulti);
                                                                            }}
                                                                        >
                                                                            <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                                                                                {opt.name}
                                                                            </Text>
                                                                            {isSelected && <Check size={16} color="#6366f1" />}
                                                                        </TouchableOpacity>
                                                                    );
                                                                })}

                                                                {/* 결과 없음 & 생성 옵션 */}
                                                                {optionSearchText && !filteredOptions.some(o => o.name.toLowerCase() === optionSearchText.toLowerCase()) && (
                                                                    <TouchableOpacity
                                                                        style={styles.createOptionItem}
                                                                        onPress={() => {
                                                                            toggleOption(optionSearchText, schemaProperties[editingField].type === 'multi_select');
                                                                            setOptionSearchText('');
                                                                        }}
                                                                    >
                                                                        <Plus size={16} color="#6366f1" />
                                                                        <Text style={styles.createOptionText}>
                                                                            "{optionSearchText}" 생성
                                                                        </Text>
                                                                    </TouchableOpacity>
                                                                )}
                                                            </ScrollView>
                                                        </View>
                                                    )}
                                                </View>
                                            ) : (
                                                <View>
                                                    {/* Text Input */}
                                                    <TextInput
                                                        style={styles.textInput}
                                                        value={editValue}
                                                        onChangeText={setEditValue}
                                                        placeholder="값을 입력하세요"
                                                        multiline={false}
                                                        autoFocus
                                                        blurOnSubmit={true}
                                                        returnKeyType="done"
                                                        onSubmitEditing={() => handleSave()}
                                                    />
                                                </View>
                                            )}
                                        </View>
                                    )}

                                    {/* Save Button */}
                                    <TouchableOpacity
                                        style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                                        onPress={() => handleSave()}
                                        disabled={isSaving}
                                    >
                                        <Text style={styles.saveButtonText}>
                                            {isSaving ? '저장 중...' : '저장'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    paginationContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    paginationInfo: {
        alignItems: 'center',
        flex: 1,
    },
    paginationText: {
        fontSize: 14,
        color: '#6b7280',
        fontWeight: '500',
    },
    currentIndexText: {
        color: '#6366f1',
        fontWeight: 'bold',
        fontSize: 16,
    },
    assetNameHint: {
        fontSize: 12,
        color: '#9ca3af',
        marginTop: 2,
    },
    navButton: {
        padding: 8,
    },
    flatList: {
        flex: 1,
    },
    cardContainer: {
        width: SCREEN_WIDTH,
        height: CARD_HEIGHT, // Explicit pixel height for web scroll support
    },
    cardWrapper: {
        flex: 1,
        padding: 16,
        paddingBottom: 0,
    },
    card: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
        // overflow: 'hidden', // Removed to prevent clipping on web
    },
    cardHeader: {
        padding: 20,
        backgroundColor: '#f8fafc',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    cardTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1e293b',
        textAlign: 'center',
    },
    conditionBadges: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 12,
        gap: 6,
    },
    conditionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fef3c7',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    conditionBadgeText: {
        fontSize: 11,
        color: '#b45309',
        fontWeight: '500',
    },
    conditionMore: {
        fontSize: 11,
        color: '#9ca3af',
        marginLeft: 4,
    },
    cardBody: {
        flex: 1,
    },
    cardBodyContent: {
        flexGrow: 1, // Ensure content fills space
        padding: 20,
        paddingBottom: 20, // Reset to normal padding, using spacer instead
    },
    fieldRow: {
        marginBottom: 16,
        backgroundColor: '#f8fafc',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    fieldRowHighlighted: {
        backgroundColor: '#fef3c7',
        borderColor: '#fcd34d',
        borderWidth: 2,
    },
    fieldLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    fieldLabelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        flex: 1,
        gap: 6,
    },
    fieldLabel: {
        fontSize: 13,
        color: '#64748b',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    fieldLabelHighlighted: {
        color: '#b45309',
    },
    fieldConditionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fde68a',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        gap: 3,
    },
    fieldConditionText: {
        fontSize: 10,
        color: '#92400e',
        fontWeight: '500',
    },
    fieldValueContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    fieldValueHighlighted: {
        color: '#92400e',
    },
    fieldValue: {
        fontSize: 16,
        color: '#334155',
        lineHeight: 24,
    },
    footer: {
        height: 0,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalSubOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    inputContainer: {
        marginBottom: 20,
    },
    textInput: {
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        color: '#1f2937',
        minHeight: 50,
    },
    selectContainer: {
        position: 'relative',
        zIndex: 1000,
    },
    selectedValueBox: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        padding: 12,
        minHeight: 50,
    },
    selectedTags: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#e0e7ff',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        gap: 6,
    },
    tagText: {
        fontSize: 14,
        color: '#4338ca',
        fontWeight: '500',
    },
    placeholderText: {
        color: '#9ca3af',
        fontSize: 16,
    },
    dropdownContainer: {
        marginTop: 8,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        maxHeight: 250,
        overflow: 'hidden',
    },
    optionSearch: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        gap: 8,
    },
    optionSearchInput: {
        flex: 1,
        fontSize: 15,
        color: '#1f2937',
    },
    optionsList: {
        maxHeight: 200,
    },
    optionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    optionItemSelected: {
        backgroundColor: '#eef2ff',
    },
    optionItemHighlighted: {
        backgroundColor: '#e0e7ff',
        borderLeftWidth: 3,
        borderLeftColor: '#6366f1',
    },
    optionText: {
        fontSize: 15,
        color: '#1f2937',
    },
    optionTextSelected: {
        color: '#6366f1',
        fontWeight: '500',
    },
    emptyOptionItem: {
        backgroundColor: '#fafafa',
        borderBottomWidth: 2,
        borderBottomColor: '#e5e7eb',
    },
    emptyOptionText: {
        color: '#9ca3af',
        fontStyle: 'italic',
    },
    createOptionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    createOptionText: {
        fontSize: 15,
        color: '#6366f1',
        fontWeight: '500',
    },
    saveButton: {
        backgroundColor: '#6366f1',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
    },
    saveButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    saveButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    locationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#f3f4f6',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        gap: 8,
    },
    locationHeaderText: {
        flex: 1,
        fontSize: 14,
        color: '#4b5563',
        fontWeight: '500',
    },
});
