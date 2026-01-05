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
import { ChevronLeft, ChevronRight, X, ExternalLink, Maximize2 } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MobileCardViewProps {
    assets: Asset[];
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdateAsset: (id: string, field: string, value: string) => void;
    primaryFields?: string[];
}

export const MobileCardView: React.FC<MobileCardViewProps> = ({
    assets,
    schema,
    schemaProperties,
    onUpdateAsset,
    primaryFields
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [expandedAsset, setExpandedAsset] = useState<Asset | null>(null);
    const [fieldPage, setFieldPage] = useState(0);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    // Swipe handling
    const [touchStartX, setTouchStartX] = useState<number | null>(null);

    const displayFields = useMemo(() => {
        if (primaryFields && primaryFields.length > 0) return primaryFields;
        const titleField = Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title');
        const others = schema.filter(f => f !== titleField).slice(0, 4);
        return titleField ? [titleField, ...others] : others;
    }, [primaryFields, schema, schemaProperties]);

    const fieldPages = useMemo(() => {
        const pages: string[][] = [];
        for (let i = 0; i < schema.length; i += 5) {
            pages.push(schema.slice(i, i + 5));
        }
        return pages;
    }, [schema]);

    const currentAsset = assets[currentIndex];
    const titleField = Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title');
    const assetTitle = titleField && currentAsset ? currentAsset.values[titleField] : `Asset ${currentIndex + 1}`;

    const goNext = () => {
        if (currentIndex < assets.length - 1) {
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

    const startEditing = (field: string, value: string) => {
        setEditingField(field);
        setEditValue(value);
    };

    const saveEdit = (assetId: string) => {
        if (editingField) {
            onUpdateAsset(assetId, editingField, editValue);
            setEditingField(null);
            setEditValue('');
        }
    };

    const cancelEdit = () => {
        setEditingField(null);
        setEditValue('');
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
        const isEditing = editingField === field;

        return (
            <View key={field} style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>{field}</Text>
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
                                onPress={() => saveEdit(asset.id)}
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
                    <TouchableOpacity onPress={() => startEditing(field, value)}>
                        <Text style={styles.fieldValue}>{value || '-'}</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    return (
        <View style={styles.container}>
            {/* Progress indicator */}
            <View style={styles.progressBar}>
                <Text style={styles.progressText}>
                    {currentIndex + 1} / {assets.length}
                </Text>
                <View style={styles.progressTrack}>
                    <View
                        style={[
                            styles.progressFill,
                            { width: `${((currentIndex + 1) / assets.length) * 100}%` }
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
                style={styles.cardWrapper}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <View style={styles.card}>
                    {/* Card Header */}
                    <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{assetTitle}</Text>
                        <Text style={styles.cardSubtitle}>탭하여 편집 • 스와이프로 이동</Text>
                    </View>

                    {/* Card Body */}
                    <ScrollView style={styles.cardBody}>
                        {displayFields.map(field => renderField(field, currentAsset))}
                    </ScrollView>

                    {/* Card Footer */}
                    <View style={styles.cardFooter}>
                        <TouchableOpacity
                            onPress={() => Linking.openURL(currentAsset.url)}
                            style={styles.notionButton}
                        >
                            <ExternalLink size={16} color="#6366f1" />
                            <Text style={styles.notionButtonText}>Open in Notion</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Navigation Arrows */}
            <View style={styles.navigation}>
                <TouchableOpacity
                    onPress={goPrev}
                    disabled={currentIndex === 0}
                    style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
                >
                    <ChevronLeft size={24} color={currentIndex === 0 ? '#9ca3af' : '#1f2937'} />
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={goNext}
                    disabled={currentIndex === assets.length - 1}
                    style={[styles.navButton, currentIndex === assets.length - 1 && styles.navButtonDisabled]}
                >
                    <ChevronRight size={24} color={currentIndex === assets.length - 1 ? '#9ca3af' : '#1f2937'} />
                </TouchableOpacity>
            </View>

            {/* Expanded Modal */}
            <Modal
                visible={!!expandedAsset}
                animationType="slide"
                presentationStyle="fullScreen"
            >
                <View style={styles.modalContainer}>
                    {/* Modal Header */}
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle} numberOfLines={1}>
                            {titleField && expandedAsset ? expandedAsset.values[titleField] : 'Asset Details'}
                        </Text>
                        <TouchableOpacity onPress={() => setExpandedAsset(null)}>
                            <X size={24} color="#6b7280" />
                        </TouchableOpacity>
                    </View>

                    {/* Field Pages */}
                    <ScrollView style={styles.modalBody}>
                        {fieldPages[fieldPage]?.map(field =>
                            expandedAsset && renderField(field, expandedAsset)
                        )}
                    </ScrollView>

                    {/* Page Navigation */}
                    {fieldPages.length > 1 && (
                        <View style={styles.pageNavigation}>
                            <TouchableOpacity
                                onPress={() => setFieldPage(p => Math.max(0, p - 1))}
                                disabled={fieldPage === 0}
                                style={[styles.pageButton, fieldPage === 0 && styles.pageButtonDisabled]}
                            >
                                <ChevronLeft size={20} color={fieldPage === 0 ? '#9ca3af' : '#1f2937'} />
                            </TouchableOpacity>
                            <Text style={styles.pageText}>
                                Page {fieldPage + 1} / {fieldPages.length}
                            </Text>
                            <TouchableOpacity
                                onPress={() => setFieldPage(p => Math.min(fieldPages.length - 1, p + 1))}
                                disabled={fieldPage === fieldPages.length - 1}
                                style={[styles.pageButton, fieldPage === fieldPages.length - 1 && styles.pageButtonDisabled]}
                            >
                                <ChevronRight size={20} color={fieldPage === fieldPages.length - 1 ? '#9ca3af' : '#1f2937'} />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f3f4f6',
    },
    emptyText: {
        color: '#6b7280',
        fontSize: 16,
    },
    progressBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    progressText: {
        fontSize: 14,
        color: '#6b7280',
        marginRight: 12,
    },
    progressTrack: {
        flex: 1,
        height: 4,
        backgroundColor: '#e5e7eb',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#6366f1',
    },
    expandButton: {
        marginLeft: 12,
        padding: 8,
    },
    cardWrapper: {
        flex: 1,
        padding: 16,
    },
    card: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
        overflow: 'hidden',
    },
    cardHeader: {
        padding: 20,
        backgroundColor: '#6366f1',
    },
    cardTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#ffffff',
    },
    cardSubtitle: {
        fontSize: 14,
        color: '#c7d2fe',
        marginTop: 4,
    },
    cardBody: {
        flex: 1,
        padding: 16,
    },
    cardFooter: {
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    notionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#eef2ff',
        borderRadius: 12,
    },
    notionButtonText: {
        marginLeft: 8,
        color: '#6366f1',
        fontWeight: '500',
    },
    fieldContainer: {
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    fieldLabel: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    fieldValue: {
        fontSize: 16,
        color: '#1f2937',
    },
    editContainer: {
        gap: 8,
    },
    editInput: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        color: '#1f2937',
    },
    editButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    editButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
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
        fontWeight: '600',
    },
    navigation: {
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        pointerEvents: 'box-none',
    },
    navButton: {
        padding: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderRadius: 50,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    navButtonDisabled: {
        opacity: 0.5,
    },
    modalContainer: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    modalTitle: {
        flex: 1,
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        marginRight: 16,
    },
    modalBody: {
        flex: 1,
        padding: 16,
    },
    pageNavigation: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
        gap: 16,
    },
    pageButton: {
        padding: 8,
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
    },
    pageButtonDisabled: {
        opacity: 0.5,
    },
    pageText: {
        fontSize: 14,
        color: '#6b7280',
    },
});
