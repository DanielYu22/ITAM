import React, { useState, useMemo, useRef } from 'react';
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
import { Edit2, X, Check, Search, Plus, ChevronDown, ChevronRight, ChevronLeft, AlertCircle, CheckCircle } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import { FilterConfig, TargetCondition } from './FieldWorkFilter';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// Explicit height calculation for web compatibility
// Header ~60px, Pagination ~60px, Padding ~32px = 152px total chrome
const CARD_HEIGHT = SCREEN_HEIGHT - 152;

interface MobileCardViewProps {
    assets: Asset[];
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdateAsset: (assetId: string, field: string, value: string, type: string) => Promise<void>;
    editableFields?: string[];
    filterConfig?: FilterConfig | null;
    onLocalUpdate?: (assetId: string, field: string, value: string) => void;
}

// 필터 조건 평가 함수
const evaluateCondition = (asset: Asset, cond: TargetCondition): boolean => {
    const val = (asset.values[cond.column] || '').toLowerCase();
    switch (cond.type) {
        case 'is_empty':
            return !val || val === '';
        case 'is_not_empty':
            return val !== '';
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
        default:
            return cond.column;
    }
};

export const MobileCardView: React.FC<MobileCardViewProps> = ({
    assets,
    schema,
    schemaProperties,
    onUpdateAsset,
    editableFields = [],
    filterConfig = null,
    onLocalUpdate,
}) => {
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const flatListRef = useRef<FlatList>(null);

    // 편집 상태
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Select/Multi-Select UI 상태
    const [showOptions, setShowOptions] = useState(false);
    const [optionSearchText, setOptionSearchText] = useState('');
    const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

    const titleField = useMemo(() => {
        return Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name';
    }, [schemaProperties]);

    const handleEdit = (asset: Asset, field: string) => {
        setSelectedAsset(asset);
        setEditingField(field);
        const currentValue = asset.values[field] || '';
        setEditValue(currentValue);

        const propType = schemaProperties[field]?.type;
        if (propType === 'multi_select') {
            setSelectedOptions(currentValue.split(',').map(s => s.trim()).filter(Boolean));
        } else if (propType === 'select') {
            setSelectedOptions(currentValue ? [currentValue] : []);
        }

        setOptionSearchText('');
        setEditModalVisible(true);
        setShowOptions(false);
    };

    const handleSave = async () => {
        if (!selectedAsset || !editingField) return;

        setIsSaving(true);
        try {
            const propType = schemaProperties[editingField]?.type || 'rich_text';
            let valueToSave = editValue;

            if (propType === 'multi_select') {
                valueToSave = selectedOptions.join(', ');
            } else if (propType === 'select') {
                valueToSave = selectedOptions[0] || '';
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
                        // 모든 조건 해결됨 - 완료 표시
                        Alert.alert('✅ 완료!', '모든 조건이 충족되었습니다. 다음 항목으로 이동합니다.', [
                            {
                                text: '확인',
                                onPress: () => {
                                    // 다음 카드로 자동 이동
                                    if (currentIndex < assets.length - 1) {
                                        flatListRef.current?.scrollToIndex({
                                            index: currentIndex + 1,
                                            animated: true
                                        });
                                    }
                                }
                            }
                        ]);
                    } else {
                        // 일부 조건 해결됨
                        Alert.alert('👍 진행 중', `${resolvedCount}개 조건 해결! 남은 조건: ${afterConditions.length}개`);
                    }
                }
            }

            setEditModalVisible(false);
            setEditingField(null);
        } catch (error) {
            Alert.alert('Error', 'Failed to update asset');
        } finally {
            setIsSaving(false);
        }
    };

    const toggleOption = (option: string, isMulti: boolean) => {
        if (isMulti) {
            setSelectedOptions(prev =>
                prev.includes(option)
                    ? prev.filter(o => o !== option)
                    : [...prev, option]
            );
        } else {
            setSelectedOptions([option]);
            setEditValue(option); // For display in main input
            setShowOptions(false);
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

        return (
            <View style={styles.cardContainer}>
                <View style={styles.cardWrapper}>
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text style={styles.cardTitle}>
                                {asset.values[titleField] || 'Untitled'}
                            </Text>

                            {/* 필터 조건 배지 */}
                            {matchedConditions.length > 0 && (
                                <View style={styles.conditionBadges}>
                                    {matchedConditions.slice(0, 3).map((cond, i) => (
                                        <View key={i} style={styles.conditionBadge}>
                                            <AlertCircle size={12} color="#b45309" />
                                            <Text style={styles.conditionBadgeText}>
                                                {getConditionText(cond)}
                                            </Text>
                                        </View>
                                    ))}
                                    {matchedConditions.length > 3 && (
                                        <Text style={styles.conditionMore}>
                                            +{matchedConditions.length - 3}
                                        </Text>
                                    )}
                                </View>
                            )}
                        </View>

                        <ScrollView
                            style={styles.cardBody}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={styles.cardBodyContent}
                        >
                            {(editableFields.length > 0 ? editableFields : schema)
                                .filter(field => field !== titleField)
                                .map(field => (
                                    <TouchableOpacity
                                        key={field}
                                        style={styles.fieldRow}
                                        onPress={() => handleEdit(asset, field)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={styles.fieldLabelRow}>
                                            <Text style={styles.fieldLabel}>{field}</Text>
                                            {editableFields.includes(field) && (
                                                <Edit2 size={12} color="#6366f1" />
                                            )}
                                        </View>
                                        <View style={styles.fieldValueContainer}>
                                            <Text style={styles.fieldValue}>
                                                {asset.values[field] || '-'}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                        </ScrollView>
                    </View>
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            {/* Pagination / Context Info */}
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
                transparent
                animationType="slide"
                onRequestClose={() => setEditModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.modalOverlay}
                >
                    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                        <View style={styles.modalSubOverlay}>
                            <TouchableWithoutFeedback onPress={() => { }}>
                                <View style={styles.modalContent}>
                                    <View style={styles.modalHeader}>
                                        <Text style={styles.modalTitle}>
                                            {editingField} 편집
                                        </Text>
                                        <TouchableOpacity
                                            onPress={() => setEditModalVisible(false)}
                                            disabled={isSaving}
                                        >
                                            <X size={24} color="#6b7280" />
                                        </TouchableOpacity>
                                    </View>

                                    {editingField && (
                                        <View style={styles.inputContainer}>
                                            {['select', 'multi_select'].includes(schemaProperties[editingField]?.type) ? (
                                                <View style={styles.selectContainer}>
                                                    {/* 선택된 값 표시 영역 */}
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
                                                                    }}
                                                                    placeholder="옵션 검색 또는 생성..."
                                                                    placeholderTextColor="#9ca3af"
                                                                />
                                                            </View>

                                                            <ScrollView style={styles.optionsList} keyboardShouldPersistTaps="handled">
                                                                {filteredOptions.map(opt => {
                                                                    const isSelected = selectedOptions.includes(opt.name);
                                                                    return (
                                                                        <TouchableOpacity
                                                                            key={opt.id}
                                                                            style={[styles.optionItem, isSelected && styles.optionItemSelected]}
                                                                            onPress={() => toggleOption(opt.name, schemaProperties[editingField].type === 'multi_select')}
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
                                                <TextInput
                                                    style={styles.textInput}
                                                    value={editValue}
                                                    onChangeText={setEditValue}
                                                    placeholder="값을 입력하세요"
                                                    multiline={schemaProperties[editingField]?.type === 'rich_text'}
                                                    autoFocus
                                                />
                                            )}
                                        </View>
                                    )}

                                    <TouchableOpacity
                                        style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                                        onPress={handleSave}
                                        disabled={isSaving}
                                    >
                                        <Text style={styles.saveButtonText}>
                                            {isSaving ? '저장 중...' : '저장'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </TouchableWithoutFeedback>
                        </View>
                    </TouchableWithoutFeedback>
                </KeyboardAvoidingView>
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
    fieldLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    fieldLabel: {
        fontSize: 13,
        color: '#64748b',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    fieldValueContainer: {
        flexDirection: 'row',
        alignItems: 'center',
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
    optionText: {
        fontSize: 15,
        color: '#1f2937',
    },
    optionTextSelected: {
        color: '#6366f1',
        fontWeight: '500',
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
});
