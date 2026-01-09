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

// 다중 컬럼용 파싱된 행
interface ParsedRow {
    lookupValue: string;
    columnValues: Record<string, string>; // column name -> value
}

// 컬럼별 변경 정보
interface ColumnChange {
    column: string;
    oldValue: string;
    newValue: string;
    changeType: 'update' | 'overwrite' | 'same';
}

// 신규 항목의 기타 필드 데이터
interface NewItemData {
    lookupValue: string;
    inputColumns: Record<string, string>; // 입력된 컬럼 값
    otherColumns: Record<string, string>; // 나머지 컬럼 기본값 (수정 가능)
}

// 매칭 결과 (다중 컬럼)
interface MatchResult {
    type: 'matched' | 'new';
    lookupValue: string;
    asset?: Asset;
    columnChanges: ColumnChange[];
}

export const BulkUpdateModal: React.FC<BulkUpdateModalProps> = ({
    visible,
    onClose,
    assets,
    schema,
    schemaProperties,
    onUpdate,
}) => {
    // Steps: 1=룩업 선택, 2=업데이트 컬럼 복수 선택, 3=데이터 붙여넣기, 4=미리보기, 5=실행중/완료
    const [step, setStep] = useState(1);
    const [lookupColumn, setLookupColumn] = useState('');
    const [updateColumns, setUpdateColumns] = useState<string[]>([]); // 복수 컬럼
    const [pastedData, setPastedData] = useState('');
    const [searchText, setSearchText] = useState('');

    // 옵션
    const [allowOverwrite, setAllowOverwrite] = useState(true);
    const [allowNew, setAllowNew] = useState(false);

    // 신규 항목 편집 데이터
    const [newItemsData, setNewItemsData] = useState<NewItemData[]>([]);

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

    // 기존 값 목록 (드롭다운용)
    const existingValues = useMemo(() => {
        const values: Record<string, string[]> = {};
        schema.forEach(col => {
            const uniqueValues = [...new Set(assets.map(a => a.values[col]).filter(Boolean))];
            values[col] = uniqueValues.sort();
        });
        return values;
    }, [schema, assets]);

    // TSV 파싱 (다중 컬럼)
    const parsedRows = useMemo((): ParsedRow[] => {
        if (!pastedData.trim()) return [];

        const lines = pastedData.trim().split('\n');
        if (lines.length < 2) return []; // 헤더 + 최소 1행 필요

        return lines.slice(1).map(line => {
            const parts = line.split('\t');
            const columnValues: Record<string, string> = {};

            updateColumns.forEach((col, idx) => {
                columnValues[col] = (parts[idx + 1] || '').trim();
            });

            return {
                lookupValue: (parts[0] || '').trim(),
                columnValues,
            };
        }).filter(row => row.lookupValue); // 빈 룩업값 제외
    }, [pastedData, updateColumns]);

    // 매칭 결과 계산 (다중 컬럼)
    const matchResults = useMemo((): MatchResult[] => {
        if (!lookupColumn || updateColumns.length === 0 || parsedRows.length === 0) return [];

        return parsedRows.map(row => {
            // 룩업 컬럼으로 매칭되는 asset 찾기
            const matchedAsset = assets.find(asset =>
                (asset.values[lookupColumn] || '').toLowerCase() === row.lookupValue.toLowerCase()
            );

            if (!matchedAsset) {
                // 신규 항목
                return {
                    type: 'new' as const,
                    lookupValue: row.lookupValue,
                    columnChanges: Object.entries(row.columnValues).map(([col, val]) => ({
                        column: col,
                        oldValue: '',
                        newValue: val,
                        changeType: 'update' as const,
                    })),
                };
            }

            // 각 컬럼별 변경사항 계산
            const columnChanges: ColumnChange[] = Object.entries(row.columnValues).map(([col, newValue]) => {
                const oldValue = matchedAsset.values[col] || '';
                let changeType: 'update' | 'overwrite' | 'same';

                if (oldValue === newValue) {
                    changeType = 'same';
                } else if (oldValue && oldValue !== newValue) {
                    changeType = 'overwrite';
                } else {
                    changeType = 'update';
                }

                return { column: col, oldValue, newValue, changeType };
            });

            return {
                type: 'matched' as const,
                lookupValue: row.lookupValue,
                asset: matchedAsset,
                columnChanges,
            };
        });
    }, [lookupColumn, updateColumns, parsedRows, assets]);

    // 통계 (다중 컬럼 기반)
    const stats = useMemo(() => {
        const matched = matchResults.filter(r => r.type === 'matched');
        const newItems = matchResults.filter(r => r.type === 'new');

        let totalUpdates = 0;
        let totalOverwrites = 0;
        matched.forEach(r => {
            r.columnChanges.forEach(c => {
                if (c.changeType === 'update') totalUpdates++;
                if (c.changeType === 'overwrite') totalOverwrites++;
            });
        });

        return {
            matchedCount: matched.length,
            newCount: newItems.length,
            totalUpdates,
            totalOverwrites,
            total: matchResults.length
        };
    }, [matchResults]);

    // 실행 (다중 컬럼)
    const executeUpdates = useCallback(async () => {
        const matchedToProcess = matchResults.filter(r => r.type === 'matched');

        // 업데이트할 변경사항 수집
        const updates: { assetId: string; column: string; value: string; propType: string }[] = [];
        matchedToProcess.forEach(r => {
            if (!r.asset) return;
            r.columnChanges.forEach(c => {
                if (c.changeType === 'update') {
                    updates.push({
                        assetId: r.asset!.id,
                        column: c.column,
                        value: c.newValue,
                        propType: schemaProperties[c.column]?.type || 'rich_text',
                    });
                } else if (c.changeType === 'overwrite' && allowOverwrite) {
                    updates.push({
                        assetId: r.asset!.id,
                        column: c.column,
                        value: c.newValue,
                        propType: schemaProperties[c.column]?.type || 'rich_text',
                    });
                }
            });
        });

        if (updates.length === 0) {
            Alert.alert('알림', '업데이트할 항목이 없습니다.');
            return;
        }

        setIsProcessing(true);
        setTotalCount(updates.length);
        setProcessedCount(0);
        setResults({ success: 0, failed: 0 });

        let success = 0;
        let failed = 0;

        for (let i = 0; i < updates.length; i++) {
            const { assetId, column, value, propType } = updates[i];
            try {
                await onUpdate(assetId, column, value, propType);
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
    }, [matchResults, allowOverwrite, updateColumns, schemaProperties, onUpdate]);

    // 초기화
    const reset = () => {
        setStep(1);
        setLookupColumn('');
        setUpdateColumns([]);
        setPastedData('');
        setSearchText('');
        setAllowOverwrite(true);
        setAllowNew(false);
        setNewItemsData([]);
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

                    {/* Step 2: 업데이트 컬럼 복수 선택 */}
                    {step === 2 && (
                        <View>
                            <Text style={styles.stepTitle}>2. 업데이트 컬럼 선택 ({updateColumns.length}개)</Text>
                            <Text style={styles.stepDesc}>값을 덮어넣을 대상 컬럼들을 선택하세요 (복수 선택 가능)</Text>

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
                                {filteredColumns.filter(c => c !== lookupColumn).map(col => {
                                    const isSelected = updateColumns.includes(col);
                                    return (
                                        <TouchableOpacity
                                            key={col}
                                            style={[styles.columnItem, isSelected && styles.columnItemSelected]}
                                            onPress={() => {
                                                if (isSelected) {
                                                    setUpdateColumns(updateColumns.filter(c => c !== col));
                                                } else {
                                                    setUpdateColumns([...updateColumns, col]);
                                                }
                                            }}
                                        >
                                            <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                                                {isSelected && <Check size={14} color="#fff" />}
                                            </View>
                                            <Text style={[styles.columnText, isSelected && styles.columnTextSelected]}>
                                                {col}
                                            </Text>
                                            <Text style={styles.columnType}>
                                                {schemaProperties[col]?.type || 'text'}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>
                    )}

                    {step === 3 && (
                        <View>
                            <Text style={styles.stepTitle}>3. Excel 데이터 붙여넣기</Text>
                            <Text style={styles.stepDesc}>
                                Excel에서 {updateColumns.length + 1}열 데이터를 복사하세요{'\n'}
                                (1열: {lookupColumn}, {updateColumns.map((c, i) => `${i + 2}열: ${c}`).join(', ')})
                            </Text>

                            <View style={styles.pasteArea}>
                                <TextInput
                                    style={styles.pasteInput}
                                    placeholder={`${lookupColumn}\t${updateColumns.join('\t')}\n값1\t값1\t...\n값2\t값2\t...\n...`}
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
                                    <Text style={styles.statValue}>{stats.matchedCount}</Text>
                                    <Text style={styles.statLabel}>매칭됨</Text>
                                </View>
                                <View style={[styles.statItem, styles.statUpdate]}>
                                    <Text style={styles.statValue}>{stats.totalUpdates}</Text>
                                    <Text style={styles.statLabel}>업데이트</Text>
                                </View>
                                <View style={[styles.statItem, styles.statOverwrite]}>
                                    <Text style={styles.statValue}>{stats.totalOverwrites}</Text>
                                    <Text style={styles.statLabel}>덮어쓰기</Text>
                                </View>
                                <View style={[styles.statItem, styles.statNew]}>
                                    <Text style={styles.statValue}>{stats.newCount}</Text>
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
                                    <Text style={styles.optionText}>기존 값 덮어쓰기 허용 ({stats.totalOverwrites}건)</Text>
                                </TouchableOpacity>
                            </View>

                            {/* 변경사항 미리보기 */}
                            {stats.matchedCount > 0 && (
                                <View style={styles.previewSection}>
                                    <Text style={styles.previewTitle}>📝 변경 내역 ({stats.matchedCount}건)</Text>
                                    <ScrollView style={styles.previewScrollList} nestedScrollEnabled>
                                        {matchResults.filter(r => r.type === 'matched').map((r, i) => (
                                            <View key={i} style={styles.previewItem}>
                                                <Text style={styles.previewLookup}>{r.lookupValue}</Text>
                                                {r.columnChanges.filter(c => c.changeType !== 'same').map((c, j) => (
                                                    <View key={j} style={[
                                                        styles.previewChange,
                                                        c.changeType === 'overwrite' && styles.previewChangeOverwrite
                                                    ]}>
                                                        <Text style={styles.previewColumnName}>{c.column}:</Text>
                                                        {c.oldValue ? (
                                                            <Text style={styles.previewOld} numberOfLines={1}>
                                                                <Text style={{ textDecorationLine: 'line-through' }}>{c.oldValue}</Text>
                                                            </Text>
                                                        ) : null}
                                                        <ChevronRight size={14} color="#9ca3af" />
                                                        <Text style={styles.previewNew} numberOfLines={1}>{c.newValue}</Text>
                                                    </View>
                                                ))}
                                            </View>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                            {/* 신규 항목 */}
                            {stats.newCount > 0 && (
                                <View style={[styles.previewSection, { borderColor: '#fbbf24' }]}>
                                    <Text style={styles.previewTitle}>🆕 신규 항목 ({stats.newCount}건)</Text>
                                    <Text style={styles.previewNote}>
                                        {stats.newCount}건의 항목이 기존 데이터와 매칭되지 않습니다.{'\n'}
                                        (신규 생성은 현재 미지원)
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
                                    {stats.totalUpdates + (allowOverwrite ? stats.totalOverwrites : 0)}건 업데이트 실행
                                </Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[
                                    styles.nextButton,
                                    ((step === 1 && !lookupColumn) ||
                                        (step === 2 && updateColumns.length === 0) ||
                                        (step === 3 && parsedRows.length === 0)) && styles.nextButtonDisabled
                                ]}
                                onPress={() => { setStep(step + 1); setSearchText(''); }}
                                disabled={
                                    (step === 1 && !lookupColumn) ||
                                    (step === 2 && updateColumns.length === 0) ||
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
        gap: 6,
        marginTop: 4,
        flexWrap: 'wrap',
    },
    previewChangeOverwrite: {
        backgroundColor: '#fef3c7',
        padding: 4,
        borderRadius: 4,
    },
    previewColumnName: {
        fontSize: 12,
        color: '#6b7280',
        fontWeight: '500',
        minWidth: 60,
    },
    previewOld: {
        fontSize: 13,
        color: '#dc2626',
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
