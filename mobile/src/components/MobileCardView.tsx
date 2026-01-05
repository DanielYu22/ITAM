import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Dimensions,
    Modal,
    Linking,
    TextInput,
    GestureResponderEvent,
} from 'react-native';
import { ChevronLeft, ChevronRight, X, ExternalLink, Maximize2, Check, Plus } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MobileCardViewProps {
    assets: Asset[];
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdateAsset: (id: string, field: string, value: string) => void;
    primaryFields?: string[];
    editableFields?: string[];
    sortColumn?: string;
}

export const MobileCardView: React.FC<MobileCardViewProps> = ({
    assets,
    schema,
    schemaProperties,
    onUpdateAsset,
    primaryFields,
    editableFields,
    sortColumn,
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [expandedAsset, setExpandedAsset] = useState<Asset | null>(null);
    const [fieldPage, setFieldPage] = useState(0);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    // Select/Multi-Select 드롭다운 상태
    const [showSelectPicker, setShowSelectPicker] = useState(false);
    const [selectSearchText, setSelectSearchText] = useState('');
    const [selectedValues, setSelectedValues] = useState<string[]>([]);
    const [isMultiSelect, setIsMultiSelect] = useState(false);
    const [currentAssetId, setCurrentAssetId] = useState<string | null>(null);

    // Swipe handling
    const [touchStartX, setTouchStartX] = useState<number | null>(null);

    // 숫자 정렬 적용된 자산 목록
    const sortedAssets = useMemo(() => {
        if (!sortColumn) return assets;

        return [...assets].sort((a, b) => {
            const valA = a.values[sortColumn] || '';
            const valB = b.values[sortColumn] || '';

            // 숫자인지 확인하고 숫자 정렬
            const numA = parseFloat(valA);
            const numB = parseFloat(valB);

            if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB; // 숫자 오름차순
            }

            return valA.localeCompare(valB, 'ko');
        });
    }, [assets, sortColumn]);

    // Select/Multi-Select 옵션 추출
    const getSelectOptions = (field: string): string[] => {
        const prop = schemaProperties[field];
        if (!prop) return [];

        if (prop.type === 'select' && prop.select?.options) {
            return prop.select.options.map(o => o.name);
        }
        if (prop.type === 'multi_select' && prop.multi_select?.options) {
            return prop.multi_select.options.map(o => o.name);
        }
        return [];
    };

    // 편집 가능 필드 결정
    const displayFields = useMemo(() => {
        if (editableFields && editableFields.length > 0) return editableFields;
        if (primaryFields && primaryFields.length > 0) return primaryFields;
        const titleField = Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title');
        const others = schema.filter(f => f !== titleField).slice(0, 4);
        return titleField ? [titleField, ...others] : others;
    }, [editableFields, primaryFields, schema, schemaProperties]);

    const isFieldEditable = (field: string) => {
        if (!editableFields || editableFields.length === 0) return true;
        return editableFields.includes(field);
    };

    const fieldPages = useMemo(() => {
        const pages: string[][] = [];
        for (let i = 0; i < schema.length; i += 5) {
            pages.push(schema.slice(i, i + 5));
        }
        return pages;
    }, [schema]);

    const currentAsset = sortedAssets[currentIndex];
    const titleField = Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title');
    const assetTitle = titleField && currentAsset ? currentAsset.values[titleField] : `Asset ${currentIndex + 1}`;

    const goNext = () => {
        if (currentIndex < sortedAssets.length - 1) {
            setCurrentIndex(currentIndex + 1);
        }
    };

    const goPrev = () => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        }
    };

    const handleTouchStart = (e: GestureResponderEvent) => {
        setTouchStartX(e.nativeEvent.pageX);
    };

    const handleTouchEnd = (e: GestureResponderEvent) => {
        if (touchStartX === null) return;
        const touchEndX = e.nativeEvent.pageX;
        const diff = touchStartX - touchEndX;

        if (Math.abs(diff) > 50) {
            if (diff > 0) goNext();
            else goPrev();
        }
        setTouchStartX(null);
    };

    // 필드 편집 시작
    const startEditing = (field: string, value: string, assetId: string) => {
        if (!isFieldEditable(field)) return;

        const prop = schemaProperties[field];

        // Select 또는 Multi-Select 타입이면 드롭다운 표시
        if (prop?.type === 'select' || prop?.type === 'multi_select') {
            setEditingField(field);
            setIsMultiSelect(prop.type === 'multi_select');
            setCurrentAssetId(assetId);

            // Multi-Select는 현재 값을 배열로 파싱
            if (prop.type === 'multi_select') {
                setSelectedValues(value ? value.split(',').map(v => v.trim()).filter(v => v) : []);
            } else {
                setSelectedValues(value ? [value] : []);
            }

            setSelectSearchText('');
            setShowSelectPicker(true);
        } else {
            // 일반 텍스트 편집
            setEditingField(field);
            setEditValue(value);
            setCurrentAssetId(assetId);
        }
    };

    const saveEdit = () => {
        if (editingField && currentAssetId) {
            onUpdateAsset(currentAssetId, editingField, editValue);
            setEditingField(null);
            setEditValue('');
            setCurrentAssetId(null);
        }
    };

    const cancelEdit = () => {
        setEditingField(null);
        setEditValue('');
        setShowSelectPicker(false);
        setSelectSearchText('');
        setSelectedValues([]);
        setCurrentAssetId(null);
    };

    // Select 값 토글
    const toggleSelectValue = (val: string) => {
        if (isMultiSelect) {
            setSelectedValues(prev =>
                prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
            );
        } else {
            // 단일 선택: 즉시 저장
            if (editingField && currentAssetId) {
                onUpdateAsset(currentAssetId, editingField, val);
            }
            cancelEdit();
        }
    };

    // Multi-Select 저장
    const saveMultiSelect = () => {
        if (editingField && currentAssetId) {
            onUpdateAsset(currentAssetId, editingField, selectedValues.join(', '));
        }
        cancelEdit();
    };

    // 새 옵션 생성
    const createNewOption = (val: string) => {
        if (isMultiSelect) {
            setSelectedValues(prev => [...prev, val]);
            setSelectSearchText('');
        } else {
            if (editingField && currentAssetId) {
                onUpdateAsset(currentAssetId, editingField, val);
            }
            cancelEdit();
        }
    };

    if (!currentAsset) {
        return (
            <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No assets to display</Text>
            </View>
        );
    }

    const renderField = (field: string, asset: Asset) => {
        const value = asset.values[field] || '';
        const isEditing = editingField === field && currentAssetId === asset.id && !showSelectPicker;
        const canEdit = isFieldEditable(field);
        const prop = schemaProperties[field];
        const isSelectType = prop?.type === 'select' || prop?.type === 'multi_select';

        return (
            <View key={field} style={styles.fieldContainer}>
                <View style={styles.fieldHeader}>
                    <Text style={styles.fieldLabel}>{field}</Text>
                    {canEdit && (
                        <Text style={[styles.editHint, isSelectType && styles.editHintSelect]}>
                            {isSelectType ? (prop?.type === 'multi_select' ? '다중선택' : '선택') : '편집 가능'}
                        </Text>
                    )}
                </View>
                {isEditing ? (
                    <View style={styles.editContainer}>
                        <TextInput
                            style={styles.editInput}
                            value={editValue}
                            onChangeText={setEditValue}
                            autoFocus
                            multiline
                        />
                        <View style={styles.editButtons}>
                            <TouchableOpacity
                                style={[styles.editButton, styles.saveButton]}
                                onPress={saveEdit}
                            >
                                <Text style={styles.editButtonText}>저장</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.editButton, styles.cancelButton]}
                                onPress={cancelEdit}
                            >
                                <Text style={styles.editButtonText}>취소</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <TouchableOpacity
                        onPress={() => startEditing(field, value, asset.id)}
                        disabled={!canEdit}
                    >
                        <Text style={[
                            styles.fieldValue,
                            !canEdit && styles.fieldValueReadOnly,
                            isSelectType && styles.fieldValueSelect
                        ]}>
                            {value || '-'}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    // Select 드롭다운 렌더링
    const renderSelectPicker = () => {
        if (!editingField) return null;

        const options = getSelectOptions(editingField);
        const filteredOptions = options.filter(o =>
            o.toLowerCase().includes(selectSearchText.toLowerCase())
        );
        const showCreate = selectSearchText.trim() &&
            !options.some(o => o.toLowerCase() === selectSearchText.toLowerCase());

        return (
            <Modal visible={showSelectPicker} transparent animationType="fade">
                <View style={styles.pickerOverlay}>
                    <View style={styles.pickerContainer}>
                        <View style={styles.pickerHeader}>
                            <Text style={styles.pickerTitle}>
                                {isMultiSelect ? '다중 선택' : '선택'}: {editingField}
                            </Text>
                            <TouchableOpacity onPress={cancelEdit}>
                                <X size={24} color="#6b7280" />
                            </TouchableOpacity>
                        </View>

                        {/* 검색 입력 */}
                        <View style={styles.searchContainer}>
                            <TextInput
                                style={styles.searchInput}
                                value={selectSearchText}
                                onChangeText={setSelectSearchText}
                                placeholder="검색 또는 새로 만들기..."
                                placeholderTextColor="#9ca3af"
                                autoFocus
                            />
                            {selectSearchText.length > 0 && (
                                <TouchableOpacity onPress={() => setSelectSearchText('')}>
                                    <X size={18} color="#9ca3af" />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* 선택된 값 표시 (Multi-Select) */}
                        {isMultiSelect && selectedValues.length > 0 && (
                            <View style={styles.selectedBar}>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    {selectedValues.map(val => (
                                        <TouchableOpacity
                                            key={val}
                                            style={styles.selectedChip}
                                            onPress={() => toggleSelectValue(val)}
                                        >
                                            <Text style={styles.selectedChipText}>{val}</Text>
                                            <X size={14} color="#6366f1" />
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </View>
                        )}

                        {/* 옵션 목록 */}
                        <ScrollView style={styles.optionsList}>
                            {/* 새로 만들기 옵션 */}
                            {showCreate && (
                                <TouchableOpacity
                                    style={styles.createOption}
                                    onPress={() => createNewOption(selectSearchText.trim())}
                                >
                                    <Plus size={18} color="#6366f1" />
                                    <Text style={styles.createOptionText}>
                                        "{selectSearchText.trim()}" 생성
                                    </Text>
                                </TouchableOpacity>
                            )}

                            {filteredOptions.map(option => {
                                const isSelected = selectedValues.includes(option);
                                return (
                                    <TouchableOpacity
                                        key={option}
                                        style={[styles.optionItem, isSelected && styles.optionItemSelected]}
                                        onPress={() => toggleSelectValue(option)}
                                    >
                                        <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                                            {option}
                                        </Text>
                                        {isSelected && <Check size={18} color="#6366f1" />}
                                    </TouchableOpacity>
                                );
                            })}

                            {filteredOptions.length === 0 && !showCreate && (
                                <Text style={styles.noOptions}>옵션이 없습니다</Text>
                            )}
                        </ScrollView>

                        {/* Multi-Select 저장 버튼 */}
                        {isMultiSelect && (
                            <TouchableOpacity style={styles.doneButton} onPress={saveMultiSelect}>
                                <Text style={styles.doneButtonText}>완료</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </Modal>
        );
    };

    return (
        <View style={styles.container}>
            {/* Progress indicator */}
            <View style={styles.progressBar}>
                <Text style={styles.progressText}>
                    {currentIndex + 1} / {sortedAssets.length}
                </Text>
                <View style={styles.progressTrack}>
                    <View
                        style={[
                            styles.progressFill,
                            { width: `${((currentIndex + 1) / sortedAssets.length) * 100}%` }
                        ]}
                    />
                </View>
                <TouchableOpacity
                    onPress={() => setExpandedAsset(currentAsset)}
                    style={styles.expandButton}
                >
                    <Maximize2 size={18} color="#6366f1" />
                </TouchableOpacity>
            </View>

            {/* Card View */}
            <View
                style={styles.cardContainer}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <TouchableOpacity
                    style={[styles.navButton, styles.navButtonLeft]}
                    onPress={goPrev}
                    disabled={currentIndex === 0}
                >
                    <ChevronLeft size={24} color={currentIndex === 0 ? '#d1d5db' : '#6366f1'} />
                </TouchableOpacity>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>{assetTitle}</Text>
                    {sortColumn && currentAsset.values[sortColumn] && (
                        <Text style={styles.sortBadge}>
                            {sortColumn}: {currentAsset.values[sortColumn]}
                        </Text>
                    )}

                    <ScrollView style={styles.fieldsContainer} showsVerticalScrollIndicator={false}>
                        {displayFields.map(field => renderField(field, currentAsset))}
                    </ScrollView>
                </View>

                <TouchableOpacity
                    style={[styles.navButton, styles.navButtonRight]}
                    onPress={goNext}
                    disabled={currentIndex === sortedAssets.length - 1}
                >
                    <ChevronRight size={24} color={currentIndex === sortedAssets.length - 1 ? '#d1d5db' : '#6366f1'} />
                </TouchableOpacity>
            </View>

            {/* Expanded Modal */}
            <Modal visible={!!expandedAsset} animationType="slide" presentationStyle="pageSheet">
                <View style={styles.expandedContainer}>
                    <View style={styles.expandedHeader}>
                        <Text style={styles.expandedTitle}>
                            {expandedAsset && titleField ? expandedAsset.values[titleField] : 'Asset Details'}
                        </Text>
                        <TouchableOpacity onPress={() => setExpandedAsset(null)}>
                            <X size={24} color="#6b7280" />
                        </TouchableOpacity>
                    </View>

                    {/* Field pages pagination */}
                    {fieldPages.length > 1 && (
                        <View style={styles.pageTabs}>
                            {fieldPages.map((_, idx) => (
                                <TouchableOpacity
                                    key={idx}
                                    style={[styles.pageTab, fieldPage === idx && styles.pageTabActive]}
                                    onPress={() => setFieldPage(idx)}
                                >
                                    <Text style={[styles.pageTabText, fieldPage === idx && styles.pageTabTextActive]}>
                                        {idx + 1}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    <ScrollView style={styles.expandedFields}>
                        {expandedAsset && fieldPages[fieldPage]?.map(field => renderField(field, expandedAsset))}
                    </ScrollView>

                    {expandedAsset?.notionUrl && (
                        <TouchableOpacity
                            style={styles.notionLink}
                            onPress={() => Linking.openURL(expandedAsset.notionUrl!)}
                        >
                            <ExternalLink size={18} color="#6366f1" />
                            <Text style={styles.notionLinkText}>Notion에서 열기</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </Modal>

            {/* Select Picker Modal */}
            {renderSelectPicker()}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 16,
        color: '#6b7280',
    },
    progressBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    progressText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#6b7280',
    },
    progressTrack: {
        flex: 1,
        height: 4,
        backgroundColor: '#e5e7eb',
        borderRadius: 2,
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#6366f1',
        borderRadius: 2,
    },
    expandButton: {
        padding: 4,
    },
    cardContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    navButton: {
        padding: 8,
    },
    navButtonLeft: {},
    navButtonRight: {},
    card: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 20,
        marginHorizontal: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
        maxHeight: '90%',
    },
    cardTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 8,
    },
    sortBadge: {
        fontSize: 13,
        color: '#6366f1',
        backgroundColor: '#eef2ff',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        alignSelf: 'flex-start',
        marginBottom: 12,
    },
    fieldsContainer: {
        flex: 1,
    },
    fieldContainer: {
        marginBottom: 16,
    },
    fieldHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    fieldLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6b7280',
        textTransform: 'uppercase',
    },
    editHint: {
        fontSize: 10,
        color: '#10b981',
    },
    editHintSelect: {
        color: '#6366f1',
    },
    fieldValue: {
        fontSize: 15,
        color: '#1f2937',
        padding: 10,
        backgroundColor: '#f9fafb',
        borderRadius: 8,
        minHeight: 40,
    },
    fieldValueReadOnly: {
        color: '#9ca3af',
    },
    fieldValueSelect: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderStyle: 'dashed',
    },
    editContainer: {
        gap: 8,
    },
    editInput: {
        fontSize: 15,
        color: '#1f2937',
        padding: 10,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#6366f1',
        borderRadius: 8,
        minHeight: 60,
    },
    editButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    editButton: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 6,
        alignItems: 'center',
    },
    saveButton: {
        backgroundColor: '#6366f1',
    },
    cancelButton: {
        backgroundColor: '#6b7280',
    },
    editButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '600',
    },
    expandedContainer: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    expandedHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    expandedTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        flex: 1,
    },
    pageTabs: {
        flexDirection: 'row',
        padding: 12,
        gap: 8,
        backgroundColor: '#ffffff',
    },
    pageTab: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#f3f4f6',
    },
    pageTabActive: {
        backgroundColor: '#6366f1',
    },
    pageTabText: {
        fontSize: 14,
        color: '#6b7280',
    },
    pageTabTextActive: {
        color: '#ffffff',
        fontWeight: '500',
    },
    expandedFields: {
        flex: 1,
        padding: 16,
    },
    notionLink: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
        gap: 8,
    },
    notionLinkText: {
        color: '#6366f1',
        fontSize: 16,
        fontWeight: '500',
    },
    // Select Picker styles
    pickerOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    pickerContainer: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
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
    searchContainer: {
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
    selectedBar: {
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    selectedChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#eef2ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        marginRight: 8,
        gap: 4,
    },
    selectedChipText: {
        fontSize: 13,
        color: '#6366f1',
        fontWeight: '500',
    },
    optionsList: {
        maxHeight: 300,
        padding: 8,
    },
    createOption: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        backgroundColor: '#eef2ff',
        borderRadius: 8,
        marginBottom: 4,
        gap: 10,
    },
    createOptionText: {
        fontSize: 15,
        color: '#6366f1',
        fontWeight: '500',
    },
    optionItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 14,
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
    noOptions: {
        textAlign: 'center',
        color: '#9ca3af',
        padding: 20,
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
