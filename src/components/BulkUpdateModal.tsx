import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    TextInput,
    Platform,
    Alert,
} from 'react-native';
import { X, Upload, Check, AlertTriangle, ChevronRight, ChevronLeft, Search, RefreshCw } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';

interface BulkUpdateModalProps {
    visible: boolean;
    onClose: () => void;
    assets: Asset[];
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdate: (id: string, field: string, value: string, type: string) => Promise<void>;
}

interface ParsedRow {
    lookupValue: string;
    updateValue: string;
}

interface MatchResult {
    type: 'update' | 'overwrite' | 'new' | 'skip';
    lookupValue: string;
    newValue: string;
    oldValue?: string;
    asset?: Asset;
}

export const BulkUpdateModal: React.FC<BulkUpdateModalProps> = ({
    visible,
    onClose,
    assets,
    schema,
    schemaProperties,
    onUpdate,
}) => {
    // Steps: 1=룩업 선택, 2=업데이트 컬럼 선택, 3=데이터 붙여넣기, 4=미리보기, 5=실행중/완료
    const [step, setStep] = useState(1);
    const [lookupColumn, setLookupColumn] = useState('');
    const [updateColumn, setUpdateColumn] = useState('');
    const [pastedData, setPastedData] = useState('');
    const [searchText, setSearchText] = useState('');

    // 옵션
    const [allowOverwrite, setAllowOverwrite] = useState(true);
    const [allowNew, setAllowNew] = useState(false);

    // 실행 상태
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [results, setResults] = useState<{ success: number; failed: number }>({ success: 0, failed: 0 });

    // 컬럼 필터링
    const filteredColumns = useMemo(() => {
        if (!searchText.trim()) return schema;
        const query = searchText.toLowerCase();
        return schema.filter(col => col.toLowerCase().includes(query));
    }, [schema, searchText]);

    // TSV 파싱
    const parsedRows = useMemo((): ParsedRow[] => {
        if (!pastedData.trim()) return [];

        const lines = pastedData.trim().split('\n');
        if (lines.length < 2) return []; // 헤더 + 최소 1행 필요

        // 첫 줄은 헤더로 무시
        return lines.slice(1).map(line => {
            const parts = line.split('\t');
            return {
                lookupValue: (parts[0] || '').trim(),
                updateValue: (parts[1] || '').trim(),
            };
        }).filter(row => row.lookupValue); // 빈 룩업값 제외
    }, [pastedData]);

    // 매칭 결과 계산
    const matchResults = useMemo((): MatchResult[] => {
        if (!lookupColumn || !updateColumn || parsedRows.length === 0) return [];

        return parsedRows.map(row => {
            // 룩업 컬럼으로 매칭되는 asset 찾기
            const matchedAsset = assets.find(asset =>
                (asset.values[lookupColumn] || '').toLowerCase() === row.lookupValue.toLowerCase()
            );

            if (!matchedAsset) {
                return {
                    type: 'new' as const,
                    lookupValue: row.lookupValue,
                    newValue: row.updateValue,
                };
            }

            const oldValue = matchedAsset.values[updateColumn] || '';

            if (oldValue && oldValue !== row.updateValue) {
                return {
                    type: 'overwrite' as const,
                    lookupValue: row.lookupValue,
                    newValue: row.updateValue,
                    oldValue,
                    asset: matchedAsset,
                };
            }

            if (!oldValue || oldValue === row.updateValue) {
                return {
                    type: 'update' as const,
                    lookupValue: row.lookupValue,
                    newValue: row.updateValue,
                    oldValue,
                    asset: matchedAsset,
                };
            }

            return {
                type: 'skip' as const,
                lookupValue: row.lookupValue,
                newValue: row.updateValue,
            };
        });
    }, [lookupColumn, updateColumn, parsedRows, assets]);

    // 통계
    const stats = useMemo(() => {
        const updates = matchResults.filter(r => r.type === 'update').length;
        const overwrites = matchResults.filter(r => r.type === 'overwrite').length;
        const newItems = matchResults.filter(r => r.type === 'new').length;
        return { updates, overwrites, newItems, total: matchResults.length };
    }, [matchResults]);

    // 실행
    const executeUpdates = useCallback(async () => {
        const toProcess = matchResults.filter(r => {
            if (r.type === 'update') return true;
            if (r.type === 'overwrite' && allowOverwrite) return true;
            // 신규 추가는 현재 미지원 (Notion API로 페이지 생성 필요)
            return false;
        });

        if (toProcess.length === 0) {
            Alert.alert('알림', '업데이트할 항목이 없습니다.');
            return;
        }

        setIsProcessing(true);
        setTotalCount(toProcess.length);
        setProcessedCount(0);
        setResults({ success: 0, failed: 0 });

        let success = 0;
        let failed = 0;
        const propType = schemaProperties[updateColumn]?.type || 'rich_text';

        for (let i = 0; i < toProcess.length; i++) {
            const item = toProcess[i];
            if (!item.asset) continue;

            try {
                await onUpdate(item.asset.id, updateColumn, item.newValue, propType);
                success++;
            } catch (error) {
                console.error('Update failed:', error);
                failed++;
            }
            setProcessedCount(i + 1);
        }

        setResults({ success, failed });
        setIsProcessing(false);
        setStep(5);
    }, [matchResults, allowOverwrite, updateColumn, schemaProperties, onUpdate]);

    // 초기화
    const reset = () => {
        setStep(1);
        setLookupColumn('');
        setUpdateColumn('');
        setPastedData('');
        setSearchText('');
        setAllowOverwrite(true);
        setAllowNew(false);
        setIsProcessing(false);
        setProcessedCount(0);
        setTotalCount(0);
        setResults({ success: 0, failed: 0 });
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>일괄 업데이트</Text>
                    <TouchableOpacity onPress={handleClose}>
                        <X size={24} color="#6b7280" />
                    </TouchableOpacity>
                </View>

                {/* Progress Steps */}
                <View style={styles.progressBar}>
                    {[1, 2, 3, 4, 5].map(s => (
                        <View key={s} style={[styles.progressStep, step >= s && styles.progressStepActive]}>
                            <Text style={[styles.progressText, step >= s && styles.progressTextActive]}>{s}</Text>
                        </View>
                    ))}
                </View>

                <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
                    {/* Step 1: 룩업 컬럼 선택 */}
                    {step === 1 && (
                        <View>
                            <Text style={styles.stepTitle}>1. 룩업 컬럼 선택</Text>
                            <Text style={styles.stepDesc}>매칭에 사용할 기준 컬럼을 선택하세요 (예: Name, 자산번호 등)</Text>

                            <View style={styles.searchBox}>
                                <Search size={18} color="#9ca3af" />
                                <TextInput
                                    style={styles.searchInput}
                                    placeholder="컬럼 검색..."
                                    value={searchText}
                                    onChangeText={setSearchText}
                                    placeholderTextColor="#9ca3af"
                                />
                            </View>

                            <View style={styles.columnList}>
                                {filteredColumns.map(col => (
                                    <TouchableOpacity
                                        key={col}
                                        style={[styles.columnItem, lookupColumn === col && styles.columnItemSelected]}
                                        onPress={() => setLookupColumn(col)}
                                    >
                                        <Text style={[styles.columnText, lookupColumn === col && styles.columnTextSelected]}>
                                            {col}
                                        </Text>
                                        {lookupColumn === col && <Check size={18} color="#6366f1" />}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}

                    {/* Step 2: 업데이트 컬럼 선택 */}
                    {step === 2 && (
                        <View>
                            <Text style={styles.stepTitle}>2. 업데이트 컬럼 선택</Text>
                            <Text style={styles.stepDesc}>값을 덮어넣을 대상 컬럼을 선택하세요</Text>

                            <View style={styles.searchBox}>
                                <Search size={18} color="#9ca3af" />
                                <TextInput
                                    style={styles.searchInput}
                                    placeholder="컬럼 검색..."
                                    value={searchText}
                                    onChangeText={setSearchText}
                                    placeholderTextColor="#9ca3af"
                                />
                            </View>

                            <View style={styles.columnList}>
                                {filteredColumns.filter(c => c !== lookupColumn).map(col => (
                                    <TouchableOpacity
                                        key={col}
                                        style={[styles.columnItem, updateColumn === col && styles.columnItemSelected]}
                                        onPress={() => setUpdateColumn(col)}
                                    >
                                        <Text style={[styles.columnText, updateColumn === col && styles.columnTextSelected]}>
                                            {col}
                                        </Text>
                                        <Text style={styles.columnType}>
                                            {schemaProperties[col]?.type || 'text'}
                                        </Text>
                                        {updateColumn === col && <Check size={18} color="#6366f1" />}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}

                    {/* Step 3: 데이터 붙여넣기 */}
                    {step === 3 && (
                        <View>
                            <Text style={styles.stepTitle}>3. Excel 데이터 붙여넣기</Text>
                            <Text style={styles.stepDesc}>
                                Excel에서 2열 데이터를 복사하세요{'\n'}
                                (1열: {lookupColumn}, 2열: {updateColumn})
                            </Text>

                            <View style={styles.pasteArea}>
                                <TextInput
                                    style={styles.pasteInput}
                                    placeholder={`${lookupColumn}\t${updateColumn}\n값1\t값1\n값2\t값2\n...`}
                                    value={pastedData}
                                    onChangeText={setPastedData}
                                    multiline
                                    numberOfLines={10}
                                    placeholderTextColor="#9ca3af"
                                />
                            </View>

                            {parsedRows.length > 0 && (
                                <View style={styles.parseResult}>
                                    <Check size={18} color="#10b981" />
                                    <Text style={styles.parseResultText}>
                                        {parsedRows.length}개 행 인식됨
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Step 4: 미리보기 */}
                    {step === 4 && (
                        <View>
                            <Text style={styles.stepTitle}>4. 미리보기 및 확인</Text>

                            {/* 통계 */}
                            <View style={styles.statsContainer}>
                                <View style={styles.statItem}>
                                    <Text style={styles.statValue}>{stats.total}</Text>
                                    <Text style={styles.statLabel}>전체</Text>
                                </View>
                                <View style={[styles.statItem, styles.statUpdate]}>
                                    <Text style={styles.statValue}>{stats.updates}</Text>
                                    <Text style={styles.statLabel}>업데이트</Text>
                                </View>
                                <View style={[styles.statItem, styles.statOverwrite]}>
                                    <Text style={styles.statValue}>{stats.overwrites}</Text>
                                    <Text style={styles.statLabel}>덮어쓰기</Text>
                                </View>
                                <View style={[styles.statItem, styles.statNew]}>
                                    <Text style={styles.statValue}>{stats.newItems}</Text>
                                    <Text style={styles.statLabel}>신규</Text>
                                </View>
                            </View>

                            {/* 옵션 */}
                            <View style={styles.optionSection}>
                                <TouchableOpacity
                                    style={styles.optionRow}
                                    onPress={() => setAllowOverwrite(!allowOverwrite)}
                                >
                                    <View style={[styles.checkbox, allowOverwrite && styles.checkboxChecked]}>
                                        {allowOverwrite && <Check size={14} color="#fff" />}
                                    </View>
                                    <Text style={styles.optionText}>기존 값 덮어쓰기 허용 ({stats.overwrites}건)</Text>
                                </TouchableOpacity>
                            </View>

                            {/* 덮어쓰기 미리보기 */}
                            {stats.overwrites > 0 && allowOverwrite && (
                                <View style={styles.previewSection}>
                                    <Text style={styles.previewTitle}>⚠️ 덮어쓰기 대상 ({stats.overwrites}건)</Text>
                                    <ScrollView style={styles.previewScrollList} nestedScrollEnabled>
                                        {matchResults.filter(r => r.type === 'overwrite').map((r, i) => (
                                            <View key={i} style={styles.previewItem}>
                                                <Text style={styles.previewLookup}>{r.lookupValue}</Text>
                                                <View style={styles.previewChange}>
                                                    <Text style={styles.previewOld} numberOfLines={1}>{r.oldValue}</Text>
                                                    <ChevronRight size={16} color="#9ca3af" />
                                                    <Text style={styles.previewNew} numberOfLines={1}>{r.newValue}</Text>
                                                </View>
                                            </View>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                            {/* 신규 항목 */}
                            {stats.newItems > 0 && (
                                <View style={[styles.previewSection, styles.previewNew]}>
                                    <Text style={styles.previewTitle}>🆕 매칭 실패 (신규 항목)</Text>
                                    <Text style={styles.previewNote}>
                                        {stats.newItems}건의 항목이 기존 데이터와 매칭되지 않습니다.
                                        {'\n'}(신규 생성은 현재 미지원)
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Step 5: 완료 */}
                    {step === 5 && (
                        <View style={styles.completeSection}>
                            {isProcessing ? (
                                <>
                                    <RefreshCw size={48} color="#6366f1" />
                                    <Text style={styles.processingText}>
                                        처리 중... ({processedCount}/{totalCount})
                                    </Text>
                                </>
                            ) : (
                                <>
                                    <Check size={48} color="#10b981" />
                                    <Text style={styles.completeTitle}>완료!</Text>
                                    <Text style={styles.completeStats}>
                                        성공: {results.success}건 / 실패: {results.failed}건
                                    </Text>
                                    <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
                                        <Text style={styles.closeButtonText}>닫기</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    )}
                </ScrollView>

                {/* Footer Navigation */}
                {step < 5 && (
                    <View style={styles.footer}>
                        {step > 1 && (
                            <TouchableOpacity
                                style={styles.backButton}
                                onPress={() => { setStep(step - 1); setSearchText(''); }}
                            >
                                <ChevronLeft size={20} color="#6366f1" />
                                <Text style={styles.backButtonText}>이전</Text>
                            </TouchableOpacity>
                        )}

                        <View style={{ flex: 1 }} />

                        {step === 4 ? (
                            <TouchableOpacity
                                style={[styles.nextButton, styles.executeButton]}
                                onPress={executeUpdates}
                                disabled={isProcessing}
                            >
                                <Upload size={20} color="#fff" />
                                <Text style={styles.nextButtonText}>
                                    {stats.updates + (allowOverwrite ? stats.overwrites : 0)}건 업데이트 실행
                                </Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[
                                    styles.nextButton,
                                    ((step === 1 && !lookupColumn) ||
                                        (step === 2 && !updateColumn) ||
                                        (step === 3 && parsedRows.length === 0)) && styles.nextButtonDisabled
                                ]}
                                onPress={() => { setStep(step + 1); setSearchText(''); }}
                                disabled={
                                    (step === 1 && !lookupColumn) ||
                                    (step === 2 && !updateColumn) ||
                                    (step === 3 && parsedRows.length === 0)
                                }
                            >
                                <Text style={styles.nextButtonText}>다음</Text>
                                <ChevronRight size={20} color="#fff" />
                            </TouchableOpacity>
                        )}
                    </View>
                )}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    progressBar: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
        gap: 8,
        backgroundColor: '#fff',
    },
    progressStep: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#e5e7eb',
        justifyContent: 'center',
        alignItems: 'center',
    },
    progressStepActive: {
        backgroundColor: '#6366f1',
    },
    progressText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#9ca3af',
    },
    progressTextActive: {
        color: '#fff',
    },
    content: {
        flex: 1,
    },
    contentInner: {
        padding: 16,
    },
    stepTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 8,
    },
    stepDesc: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 16,
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    searchInput: {
        flex: 1,
        marginLeft: 8,
        fontSize: 14,
        color: '#1f2937',
    },
    columnList: {
        gap: 8,
    },
    columnItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 14,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    columnItemSelected: {
        borderColor: '#6366f1',
        backgroundColor: '#eef2ff',
    },
    columnText: {
        flex: 1,
        fontSize: 14,
        color: '#1f2937',
    },
    columnTextSelected: {
        fontWeight: '600',
        color: '#6366f1',
    },
    columnType: {
        fontSize: 12,
        color: '#9ca3af',
        marginRight: 8,
    },
    pasteArea: {
        backgroundColor: '#fff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        minHeight: 200,
    },
    pasteInput: {
        padding: 12,
        fontSize: 13,
        color: '#1f2937',
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        textAlignVertical: 'top',
    },
    parseResult: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        padding: 12,
        backgroundColor: '#f0fdf4',
        borderRadius: 8,
        gap: 8,
    },
    parseResultText: {
        fontSize: 14,
        color: '#166534',
        fontWeight: '500',
    },
    statsContainer: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 16,
    },
    statItem: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    statUpdate: {
        borderColor: '#6366f1',
        backgroundColor: '#eef2ff',
    },
    statOverwrite: {
        borderColor: '#f59e0b',
        backgroundColor: '#fffbeb',
    },
    statNew: {
        borderColor: '#10b981',
        backgroundColor: '#f0fdf4',
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    statLabel: {
        fontSize: 12,
        color: '#6b7280',
    },
    optionSection: {
        marginBottom: 16,
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#fff',
        borderRadius: 8,
        gap: 12,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: '#d1d5db',
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkboxChecked: {
        backgroundColor: '#6366f1',
        borderColor: '#6366f1',
    },
    optionText: {
        fontSize: 14,
        color: '#1f2937',
    },
    previewSection: {
        backgroundColor: '#fffbeb',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
    },
    previewTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#92400e',
        marginBottom: 8,
    },
    previewScrollList: {
        maxHeight: 300,
    },
    previewItem: {
        backgroundColor: '#fff',
        borderRadius: 6,
        padding: 10,
        marginBottom: 6,
    },
    previewLookup: {
        fontSize: 12,
        color: '#6b7280',
        marginBottom: 4,
    },
    previewChange: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    previewOld: {
        fontSize: 13,
        color: '#dc2626',
        textDecorationLine: 'line-through',
    },
    previewNew: {
        fontSize: 13,
        color: '#16a34a',
        fontWeight: '500',
    },
    previewMore: {
        fontSize: 12,
        color: '#9ca3af',
        fontStyle: 'italic',
        textAlign: 'center',
        marginTop: 4,
    },
    previewNote: {
        fontSize: 13,
        color: '#6b7280',
    },
    completeSection: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
    },
    processingText: {
        marginTop: 16,
        fontSize: 16,
        color: '#6366f1',
    },
    completeTitle: {
        marginTop: 16,
        fontSize: 24,
        fontWeight: 'bold',
        color: '#10b981',
    },
    completeStats: {
        marginTop: 8,
        fontSize: 16,
        color: '#6b7280',
    },
    closeButton: {
        marginTop: 24,
        backgroundColor: '#6366f1',
        paddingHorizontal: 32,
        paddingVertical: 12,
        borderRadius: 8,
    },
    closeButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 4,
    },
    backButtonText: {
        fontSize: 14,
        color: '#6366f1',
        fontWeight: '500',
    },
    nextButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#6366f1',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 8,
        gap: 8,
    },
    nextButtonDisabled: {
        backgroundColor: '#d1d5db',
    },
    executeButton: {
        backgroundColor: '#10b981',
    },
    nextButtonText: {
        fontSize: 14,
        color: '#fff',
        fontWeight: '600',
    },
});
