import React, { useState, useMemo } from 'react';
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
} from 'react-native';
import { Edit2, X, Check, Search, Plus, ChevronDown, ChevronRight } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';

interface MobileCardViewProps {
    assets: Asset[];
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdateAsset: (assetId: string, field: string, value: string, type: string) => Promise<void>;
    editableFields?: string[];
}

export const MobileCardView: React.FC<MobileCardViewProps> = ({
    assets,
    schema,
    schemaProperties,
    onUpdateAsset,
    editableFields = [],
}) => {
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [editModalVisible, setEditModalVisible] = useState(false);

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

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.listContent}>
                {assets.map(asset => (
                    <View key={asset.id} style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text style={styles.cardTitle}>
                                {asset.values[titleField] || 'Untitled'}
                            </Text>
                        </View>

                        <View style={styles.cardBody}>
                            {(editableFields.length > 0 ? editableFields : schema)
                                .filter(field => field !== titleField) // 타이틀은 헤더에 표시되므로 제외
                                .map(field => (
                                    <TouchableOpacity
                                        key={field}
                                        style={styles.fieldRow}
                                        onPress={() => handleEdit(asset, field)}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={styles.fieldLabel}>{field}</Text>
                                        <View style={styles.fieldValueContainer}>
                                            <Text style={styles.fieldValue} numberOfLines={2}>
                                                {asset.values[field] || '-'}
                                            </Text>
                                            {editableFields.includes(field) && (
                                                <Edit2 size={14} color="#6366f1" style={styles.editIcon} />
                                            )}
                                        </View>
                                    </TouchableOpacity>
                                ))}
                        </View>
                    </View>
                ))}
                <View style={styles.footer} />
            </ScrollView>

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
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
        overflow: 'hidden',
    },
    cardHeader: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        backgroundColor: '#f9fafb',
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1f2937',
    },
    cardBody: {
        padding: 16,
    },
    fieldRow: {
        marginBottom: 12,
    },
    fieldLabel: {
        fontSize: 12,
        color: '#6b7280',
        marginBottom: 4,
        fontWeight: '500',
    },
    fieldValueContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#f9fafb',
        padding: 10,
        borderRadius: 8,
    },
    fieldValue: {
        fontSize: 15,
        color: '#1f2937',
        flex: 1,
    },
    editIcon: {
        marginLeft: 8,
    },
    footer: {
        height: 40,
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
