import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
import { X, Upload, Check, AlertTriangle, ChevronRight, ChevronLeft, ChevronDown, Search, RefreshCw, Edit2, RotateCcw } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';

interface BulkUpdateModalProps {
    visible: boolean;
    onClose: () => void;
    assets: Asset[];
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdate: (id: string, field: string, value: string, type: string) => Promise<void>;
    onCreatePage?: (values: Record<string, string>) => Promise<string | null>;
    onDeletePage?: (pageId: string) => Promise<boolean>;
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

// Undo를 위한 이력 저장
interface UndoHistoryItem {
    assetId: string;
    column: string;
    oldValue: string;
    propType: string;
}

export const BulkUpdateModal: React.FC<BulkUpdateModalProps> = ({
    visible,
    onClose,
    assets,
    schema,
    schemaProperties,
    onUpdate,
    onCreatePage,
    onDeletePage,
}) => {
    // Steps: 1=룩업 선택, 2=데이터 붙여넣기(헤더 포함), 3=미리보기, 4=실행중/완료
    const [step, setStep] = useState(1);
    const [lookupColumn, setLookupColumn] = useState('');
    const [pastedData, setPastedData] = useState('');
    const [searchText, setSearchText] = useState('');

    // 옵션
    const [allowOverwrite, setAllowOverwrite] = useState(true);
    const [allowNew, setAllowNew] = useState(false);
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');

    // 신규 항목 편집 데이터
    const [newItemsData, setNewItemsData] = useState<NewItemData[]>([]);

    // 실행 상태
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [results, setResults] = useState<{ success: number; failed: number }>({ success: 0, failed: 0 });

    // Undo 상태
    const [undoHistory, setUndoHistory] = useState<UndoHistoryItem[]>([]);
    const [isUndoing, setIsUndoing] = useState(false);
    const [undoComplete, setUndoComplete] = useState(false);
    const [createdPageIds, setCreatedPageIds] = useState<string[]>([]); // 신규 생성된 페이지 ID (undo용)

    // 미리보기 필터 상태
    const [previewFilter, setPreviewFilter] = useState<'all' | 'update' | 'overwrite' | 'new' | 'noChange'>('all');

    // 컬럼 필터링
    const filteredColumns = useMemo(() => {
        if (!searchText.trim()) return schema;
        const query = searchText.toLowerCase();
        return schema.filter((col: string) => col.toLowerCase().includes(query));
    }, [schema, searchText]);

    // 기존 값 목록 (드롭다운용)
    const existingValues = useMemo(() => {
        const values: Record<string, string[]> = {};
        schema.forEach((col: string) => {
            const uniqueValues = Array.from(new Set(assets.map((a: Asset) => a.values[col]).filter(Boolean))) as string[];
            values[col] = uniqueValues.sort();
        });
        return values;
    }, [schema, assets]);

    // TSV 헤더에서 컬럼 자동 감지
    const detectedColumns = useMemo((): string[] => {
        if (!pastedData.trim()) return [];
        const lines = pastedData.trim().split('\n');
        if (lines.length < 1) return [];

        const headerParts = lines[0].split('\t').map(h => h.trim());
        // 첫 번째 컬럼은 lookup column, 나머지가 update columns (스키마에 있는 것만)
        return headerParts.slice(1).filter(h => h && schema.includes(h));
    }, [pastedData, schema]);

    // TSV 파싱 (헤더에서 자동 감지된 컬럼 사용) - 원본 인덱스 유지
    const parsedRows = useMemo((): ParsedRow[] => {
        if (!pastedData.trim()) return [];

        const lines = pastedData.trim().split('\n');
        if (lines.length < 2) return []; // 헤더 + 최소 1행 필요

        const headerParts = lines[0].split('\t').map(h => h.trim());

        // 각 컬럼의 원본 인덱스를 함께 저장
        const columnIndexMap: { col: string; originalIndex: number }[] = [];
        headerParts.forEach((h, idx) => {
            if (idx > 0 && h && schema.includes(h)) {
                columnIndexMap.push({ col: h, originalIndex: idx });
            }
        });

        return lines.slice(1).map(line => {
            const parts = line.split('\t');
            const columnValues: Record<string, string> = {};

            // 원본 인덱스를 사용하여 올바른 값 매핑
            columnIndexMap.forEach(({ col, originalIndex }) => {
                columnValues[col] = (parts[originalIndex] || '').trim();
            });

            return {
                lookupValue: (parts[0] || '').trim(),
                columnValues,
            };
        }).filter(row => row.lookupValue); // 빈 룩업값 제외
    }, [pastedData, schema]);

    // 매칭 결과 계산 (다중 컬럼)
    const matchResults = useMemo((): MatchResult[] => {
        if (!lookupColumn || detectedColumns.length === 0 || parsedRows.length === 0) return [];

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
    }, [lookupColumn, detectedColumns, parsedRows, assets]);

    // 통계 (다중 컬럼 기반)
    const stats = useMemo(() => {
        const matched = matchResults.filter(r => r.type === 'matched');
        const newItems = matchResults.filter(r => r.type === 'new');

        let totalUpdates = 0;
        let totalOverwrites = 0;
        let itemsWithUpdates = 0;  // 업데이트가 있는 항목 수
        let itemsWithOverwrites = 0;  // 덮어쓰기가 있는 항목 수
        let itemsWithNoChange = 0;  // 변경 없는 항목 수

        matched.forEach(r => {
            const hasUpdate = r.columnChanges.some(c => c.changeType === 'update');
            const hasOverwrite = r.columnChanges.some(c => c.changeType === 'overwrite');
            const hasAnyChange = hasUpdate || hasOverwrite;

            if (hasUpdate) itemsWithUpdates++;
            if (hasOverwrite) itemsWithOverwrites++;
            if (!hasAnyChange) itemsWithNoChange++;

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
            itemsWithUpdates,
            itemsWithOverwrites,
            itemsWithNoChange,
            itemsWithActualChanges: matched.length - itemsWithNoChange,
            total: matchResults.length
        };
    }, [matchResults]);

    // 필터링된 미리보기 결과
    const filteredMatchResults = useMemo(() => {
        // 기본적으로 변경이 있는 항목만 표시
        let results = matchResults.filter(r => {
            if (r.type === 'new') return true;
            // 변경이 있는 항목만 (update 또는 overwrite)
            return r.columnChanges.some(c => c.changeType !== 'same');
        });

        // 추가 필터 적용
        if (previewFilter === 'update') {
            results = results.filter(r =>
                r.type === 'matched' && r.columnChanges.some(c => c.changeType === 'update')
            );
        } else if (previewFilter === 'overwrite') {
            results = results.filter(r =>
                r.type === 'matched' && r.columnChanges.some(c => c.changeType === 'overwrite')
            );
        } else if (previewFilter === 'new') {
            results = results.filter(r => r.type === 'new');
        } else if (previewFilter === 'noChange') {
            // 변경 없는 항목 표시
            results = matchResults.filter(r =>
                r.type === 'matched' && r.columnChanges.every(c => c.changeType === 'same')
            );
        }

        return results;
    }, [matchResults, previewFilter]);

    // 실행 (다중 컬럼 + 신규 생성)
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

        // 신규 항목 생성 데이터
        const newItemsToCreate = allowNew && onCreatePage ? newItemsData : [];
        const totalOperations = updates.length + newItemsToCreate.length;

        if (totalOperations === 0) {
            Alert.alert('알림', '업데이트할 항목이 없습니다.');
            return;
        }

        // Undo를 위해 현재 값 저장 (업데이트만, 신규 생성은 제외)
        const historyItems: UndoHistoryItem[] = [];
        matchedToProcess.forEach(r => {
            if (!r.asset) return;
            r.columnChanges.forEach(c => {
                if (c.changeType === 'update' || (c.changeType === 'overwrite' && allowOverwrite)) {
                    historyItems.push({
                        assetId: r.asset!.id,
                        column: c.column,
                        oldValue: c.oldValue || '',
                        propType: schemaProperties[c.column]?.type || 'rich_text',
                    });
                }
            });
        });
        setUndoHistory(historyItems);
        setUndoComplete(false);

        setIsProcessing(true);
        setTotalCount(totalOperations);
        setProcessedCount(0);
        setResults({ success: 0, failed: 0 });

        let success = 0;
        let failed = 0;
        let processedSoFar = 0;

        // 기존 항목 업데이트
        for (let i = 0; i < updates.length; i++) {
            const { assetId, column, value, propType } = updates[i];
            try {
                await onUpdate(assetId, column, value, propType);
                success++;
            } catch (error) {
                console.error('Update failed:', error);
                failed++;
            }
            processedSoFar++;
            setProcessedCount(processedSoFar);
        }

        // 신규 항목 생성
        const newlyCreatedIds: string[] = [];
        for (let i = 0; i < newItemsToCreate.length; i++) {
            const newItem = newItemsToCreate[i];
            try {
                // 모든 컬럼 값 합치기: lookupColumn + inputColumns + otherColumns
                const allValues: Record<string, string> = {
                    [lookupColumn]: newItem.lookupValue,
                    ...newItem.inputColumns,
                    ...newItem.otherColumns,
                };
                const pageId = await onCreatePage!(allValues);
                if (pageId) {
                    newlyCreatedIds.push(pageId); // Undo용 페이지 ID 저장
                }
                success++;
            } catch (error) {
                console.error('Create failed:', error);
                failed++;
            }
            processedSoFar++;
            setProcessedCount(processedSoFar);
        }
        setCreatedPageIds(newlyCreatedIds);

        setResults({ success, failed });
        setIsProcessing(false);
        setStep(4);
    }, [matchResults, allowOverwrite, allowNew, detectedColumns, schemaProperties, onUpdate, onCreatePage, newItemsData, lookupColumn]);

    // Undo 실행 (이전 값으로 복원 + 신규 생성 삭제)
    const executeUndo = useCallback(async () => {
        if (undoHistory.length === 0 && createdPageIds.length === 0) return;

        setIsUndoing(true);
        setProcessedCount(0);
        const totalOps = undoHistory.length + createdPageIds.length;
        setTotalCount(totalOps);

        let success = 0;
        let failed = 0;
        let deletedCount = 0;

        // 1. 기존 항목 복원
        for (let i = 0; i < undoHistory.length; i++) {
            const { assetId, column, oldValue, propType } = undoHistory[i];
            try {
                await onUpdate(assetId, column, oldValue, propType);
                success++;
            } catch (error) {
                console.error('Undo failed:', error);
                failed++;
            }
            setProcessedCount(i + 1);
        }

        // 2. 신규 생성된 페이지 삭제
        if (onDeletePage) {
            for (let i = 0; i < createdPageIds.length; i++) {
                try {
                    const deleted = await onDeletePage(createdPageIds[i]);
                    if (deleted) deletedCount++;
                    else failed++;
                } catch (error) {
                    console.error('Delete failed:', error);
                    failed++;
                }
                setProcessedCount(undoHistory.length + i + 1);
            }
        }

        setIsUndoing(false);
        setUndoComplete(true);
        setUndoHistory([]);
        setCreatedPageIds([]);

        const msg = deletedCount > 0
            ? `${success}건 복원, ${deletedCount}건 삭제, ${failed}건 실패`
            : `${success}건 복원, ${failed}건 실패`;
        Alert.alert('되돌리기 완료', msg);
    }, [undoHistory, createdPageIds, onUpdate, onDeletePage]);

    // Step 4 진입 시 신규 항목 데이터 초기화
    useEffect(() => {
        if (step === 3) {
            const newItems = matchResults.filter(r => r.type === 'new');
            const otherColumns = schema.filter(col =>
                col !== lookupColumn && !detectedColumns.includes(col)
            );

            const initialData: NewItemData[] = newItems.map(item => {
                const inputColumns: Record<string, string> = {};
                item.columnChanges.forEach(c => {
                    inputColumns[c.column] = c.newValue;
                });

                const otherCols: Record<string, string> = {};
                otherColumns.forEach(col => {
                    otherCols[col] = '신규등록';
                });

                return {
                    lookupValue: item.lookupValue,
                    inputColumns,
                    otherColumns: otherCols,
                };
            });

            setNewItemsData(initialData);
        }
    }, [step, matchResults, schema, lookupColumn, detectedColumns]);

    // 신규 항목 필드 값 변경
    const updateNewItemField = (lookupValue: string, column: string, value: string) => {
        setNewItemsData(prev => prev.map(item => {
            if (item.lookupValue === lookupValue) {
                return {
                    ...item,
                    otherColumns: { ...item.otherColumns, [column]: value },
                };
            }
            return item;
        }));
    };

    // 드롭다운 표시 상태
    const [showDropdown, setShowDropdown] = useState<{ key: string; column: string } | null>(null);

    // 초기화
    const reset = () => {
        setStep(1);
        setLookupColumn('');
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

                    {/* Step 2: Excel 데이터 붙여넣기 (헤더 포함) */}
                    {step === 2 && (
                        <View>
                            <Text style={styles.stepTitle}>2. Excel 데이터 붙여넣기</Text>
                            <Text style={styles.stepDesc}>
                                헤더 행을 포함하여 데이터를 붙여넣으세요.{'\n'}
                                첫 번째 열: {lookupColumn} (기준 컬럼){'\n'}
                                나머지 열: 업데이트할 컬럼들 (헤더에서 자동 인식)
                            </Text>

                            <View style={styles.pasteArea}>
                                <TextInput
                                    style={styles.pasteInput}
                                    placeholder={`${lookupColumn}\t컬럼A\t컬럼B\t...\n값1\t값A1\t값B1\t...\n값2\t값A2\t값B2\t...\n...`}
                                    value={pastedData}
                                    onChangeText={setPastedData}
                                    multiline
                                    numberOfLines={10}
                                    placeholderTextColor="#9ca3af"
                                />
                            </View>

                            {detectedColumns.length > 0 && (
                                <View style={styles.parseResult}>
                                    <Check size={18} color="#10b981" />
                                    <Text style={styles.parseResultText}>
                                        {detectedColumns.length}개 컬럼 감지: {detectedColumns.slice(0, 3).join(', ')}
                                        {detectedColumns.length > 3 ? ` 외 ${detectedColumns.length - 3}개` : ''}
                                    </Text>
                                </View>
                            )}

                            {parsedRows.length > 0 && (
                                <View style={[styles.parseResult, { backgroundColor: '#eff6ff' }]}>
                                    <Check size={18} color="#3b82f6" />
                                    <Text style={[styles.parseResultText, { color: '#1d4ed8' }]}>
                                        {parsedRows.length}개 데이터 행 인식됨
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Step 4: 미리보기 */}
                    {step === 3 && (
                        <View>
                            <Text style={styles.stepTitle}>3. 미리보기 및 확인</Text>

                            {/* 통계 - 클릭하면 해당 유형만 표시 */}
                            <View style={styles.statsContainer}>
                                <TouchableOpacity
                                    style={[styles.statItem, previewFilter === 'all' && styles.statItemActive]}
                                    onPress={() => setPreviewFilter('all')}
                                >
                                    <Text style={styles.statValue}>{stats.itemsWithActualChanges + stats.newCount}</Text>
                                    <Text style={styles.statLabel}>변경있음</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.statItem, styles.statUpdate, previewFilter === 'update' && styles.statItemActive]}
                                    onPress={() => setPreviewFilter('update')}
                                >
                                    <Text style={styles.statValue}>{stats.itemsWithUpdates}</Text>
                                    <Text style={styles.statLabel}>업데이트</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.statItem, styles.statOverwrite, previewFilter === 'overwrite' && styles.statItemActive]}
                                    onPress={() => setPreviewFilter('overwrite')}
                                >
                                    <Text style={styles.statValue}>{stats.itemsWithOverwrites}</Text>
                                    <Text style={styles.statLabel}>덮어쓰기</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.statItem, styles.statNew, previewFilter === 'new' && styles.statItemActive]}
                                    onPress={() => setPreviewFilter('new')}
                                >
                                    <Text style={styles.statValue}>{stats.newCount}</Text>
                                    <Text style={styles.statLabel}>신규</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.statItem, styles.statNoChange, previewFilter === 'noChange' && styles.statItemActive]}
                                    onPress={() => setPreviewFilter('noChange')}
                                >
                                    <Text style={styles.statValue}>{stats.itemsWithNoChange}</Text>
                                    <Text style={styles.statLabel}>변경없음</Text>
                                </TouchableOpacity>
                            </View>

                            {/* 필터 결과 요약 */}
                            <Text style={styles.filterSummary}>
                                {previewFilter === 'all' ? '변경이 있는 항목만 표시' :
                                    previewFilter === 'update' ? '업데이트 항목' :
                                        previewFilter === 'overwrite' ? '덮어쓰기 항목' :
                                            previewFilter === 'new' ? '신규 항목' : '변경없는 항목'}
                                : {filteredMatchResults.length}건
                            </Text>

                            {/* 뷰모드 토글 */}
                            <View style={styles.viewModeToggle}>
                                <TouchableOpacity
                                    style={[styles.viewModeBtn, viewMode === 'card' && styles.viewModeBtnActive]}
                                    onPress={() => setViewMode('card')}
                                >
                                    <Text style={[styles.viewModeText, viewMode === 'card' && styles.viewModeTextActive]}>카드</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.viewModeBtn, viewMode === 'table' && styles.viewModeBtnActive]}
                                    onPress={() => setViewMode('table')}
                                >
                                    <Text style={[styles.viewModeText, viewMode === 'table' && styles.viewModeTextActive]}>표</Text>
                                </TouchableOpacity>
                            </View>

                            {/* 테이블 뷰 */}
                            {viewMode === 'table' && (
                                <View style={styles.tableContainer}>
                                    <ScrollView horizontal showsHorizontalScrollIndicator>
                                        <View>
                                            {/* 테이블 헤더 */}
                                            <View style={styles.tableRow}>
                                                <View style={[styles.tableCell, styles.tableHeaderCell, { width: 80 }]}>
                                                    <Text style={styles.tableHeaderText}>유형</Text>
                                                </View>
                                                <View style={[styles.tableCell, styles.tableHeaderCell, { width: 140 }]}>
                                                    <Text style={styles.tableHeaderText}>{lookupColumn}</Text>
                                                </View>
                                                {detectedColumns.map((col: string) => (
                                                    <View key={col} style={[styles.tableCell, styles.tableHeaderCell, { width: 140 }]}>
                                                        <Text style={styles.tableHeaderText}>{col}</Text>
                                                    </View>
                                                ))}
                                            </View>

                                            {/* 테이블 본문 */}
                                            <ScrollView style={{ maxHeight: 350 }} nestedScrollEnabled>
                                                {filteredMatchResults.map((r, i) => (
                                                    <View key={i} style={styles.tableRow}>
                                                        <View style={[styles.tableCell, { width: 80 }]}>
                                                            <Text style={[
                                                                styles.tableBadge,
                                                                r.type === 'new' ? styles.tableBadgeNew : styles.tableBadgeUpdate
                                                            ]}>
                                                                {r.type === 'new' ? '신규' : '업데이트'}
                                                            </Text>
                                                        </View>
                                                        <View style={[styles.tableCell, styles.tableCellKey, { width: 140 }]}>
                                                            <Text style={styles.tableCellText} numberOfLines={2}>{r.lookupValue}</Text>
                                                        </View>
                                                        {detectedColumns.map((col: string) => {
                                                            const change = r.columnChanges.find(c => c.column === col);
                                                            const newItemData = newItemsData.find(item => item.lookupValue === r.lookupValue);
                                                            const newValue = r.type === 'new'
                                                                ? (newItemData?.inputColumns[col] || newItemData?.otherColumns[col] || '-')
                                                                : (change?.newValue || '-');
                                                            const oldValue = change?.oldValue;
                                                            const hasChange = change?.changeType !== 'same';

                                                            return (
                                                                <View key={col} style={[
                                                                    styles.tableCell,
                                                                    { width: 140 },
                                                                    // 변경된 셀만 배경색 적용
                                                                    hasChange && change?.changeType === 'overwrite' && { backgroundColor: '#fef3c7' },
                                                                    hasChange && change?.changeType === 'update' && { backgroundColor: '#ecfdf5' },
                                                                    r.type === 'new' && { backgroundColor: '#f0fdf4' }
                                                                ]}>
                                                                    {/* 변경된 경우만 이전 값 표시 */}
                                                                    {hasChange && oldValue && (
                                                                        <Text style={styles.tableOldValue} numberOfLines={1}>
                                                                            {oldValue}
                                                                        </Text>
                                                                    )}
                                                                    <Text style={[
                                                                        styles.tableCellText,
                                                                        hasChange && change?.changeType === 'overwrite' && { color: '#b45309', fontWeight: '500' },
                                                                        hasChange && change?.changeType === 'update' && { color: '#059669', fontWeight: '500' }
                                                                    ]} numberOfLines={2}>
                                                                        {newValue}
                                                                    </Text>
                                                                </View>
                                                            );
                                                        })}
                                                    </View>
                                                ))}
                                            </ScrollView>
                                        </View>
                                    </ScrollView>

                                    {/* 테이블 범례 */}
                                    <View style={styles.tableLegend}>
                                        <View style={styles.legendItem}>
                                            <View style={[styles.legendDot, { backgroundColor: '#fef3c7' }]} />
                                            <Text style={styles.legendText}>덮어쓰기</Text>
                                            <TouchableOpacity onPress={() => setAllowOverwrite(!allowOverwrite)}>
                                                <View style={[styles.checkboxSmall, allowOverwrite && styles.checkboxSmallChecked]}>
                                                    {allowOverwrite && <Check size={10} color="#fff" />}
                                                </View>
                                            </TouchableOpacity>
                                        </View>
                                        <View style={styles.legendItem}>
                                            <View style={[styles.legendDot, { backgroundColor: '#f0fdf4' }]} />
                                            <Text style={styles.legendText}>신규</Text>
                                            <TouchableOpacity onPress={() => setAllowNew(!allowNew)}>
                                                <View style={[styles.checkboxSmall, allowNew && styles.checkboxSmallCheckedGreen]}>
                                                    {allowNew && <Check size={10} color="#fff" />}
                                                </View>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* 카드 뷰: 변경사항 미리보기 */}
                            {viewMode === 'card' && filteredMatchResults.filter(r => r.type === 'matched').length > 0 && (
                                <View style={styles.previewSection}>
                                    <View style={styles.sectionHeader}>
                                        <Text style={styles.previewTitle}>📝 변경 내역 ({filteredMatchResults.filter(r => r.type === 'matched').length}건)</Text>
                                        <TouchableOpacity
                                            style={styles.sectionCheckbox}
                                            onPress={() => setAllowOverwrite(!allowOverwrite)}
                                        >
                                            <View style={[styles.checkboxSmall, allowOverwrite && styles.checkboxSmallChecked]}>
                                                {allowOverwrite && <Check size={10} color="#fff" />}
                                            </View>
                                            <Text style={styles.sectionCheckboxText}>덮어쓰기 ({stats.itemsWithOverwrites})</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <ScrollView style={styles.previewScrollList} nestedScrollEnabled>
                                        {filteredMatchResults.filter(r => r.type === 'matched').map((r, i) => (
                                            <View key={i} style={styles.previewItem}>
                                                <View style={styles.previewLookupRow}>
                                                    <Text style={styles.previewLookup}>{r.lookupValue}</Text>
                                                </View>
                                                {r.columnChanges.filter(c => c.changeType !== 'same').map((c, j) => (
                                                    <View key={j} style={[
                                                        styles.previewChange,
                                                        c.changeType === 'overwrite' && styles.previewChangeOverwrite,
                                                        c.changeType === 'update' && styles.previewChangeUpdate
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

                            {/* 카드 뷰: 신규 항목 (편집 가능) */}
                            {viewMode === 'card' && stats.newCount > 0 && (
                                <View style={[styles.previewSection, { borderColor: allowNew ? '#22c55e' : '#fbbf24', borderWidth: 1, overflow: 'visible' }]}>
                                    <View style={styles.sectionHeader}>
                                        <Text style={styles.previewTitle}>🆕 신규 항목 ({stats.newCount}건)</Text>
                                        <TouchableOpacity
                                            style={styles.sectionCheckbox}
                                            onPress={() => setAllowNew(!allowNew)}
                                        >
                                            <View style={[styles.checkboxSmall, allowNew && styles.checkboxSmallCheckedGreen]}>
                                                {allowNew && <Check size={10} color="#fff" />}
                                            </View>
                                            <Text style={styles.sectionCheckboxText}>생성 허용</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <Text style={[styles.previewNote, { marginBottom: 8 }]}>
                                        {allowNew
                                            ? '아래에서 기타 컬럼 값을 편집 후 실행하세요.'
                                            : '"생성 허용" 체크 시 Notion에 새로 생성합니다.'
                                        }
                                    </Text>

                                    <ScrollView style={styles.previewScrollList} nestedScrollEnabled>
                                        {newItemsData.map((item, i) => (
                                            <View key={i} style={[styles.previewItem, { backgroundColor: allowNew ? '#f0fdf4' : '#fefce8' }]}>
                                                <Text style={styles.previewLookup}>
                                                    {lookupColumn}: {item.lookupValue}
                                                </Text>

                                                {/* 가로 스크롤 컬럼 영역 */}
                                                <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginTop: 8 }}>
                                                    {/* 입력된 컬럼 (읽기 전용) */}
                                                    {Object.entries(item.inputColumns).map(([col, val]) => (
                                                        <View key={col} style={styles.newItemCard}>
                                                            <Text style={styles.newItemCardLabel}>{col}</Text>
                                                            <Text style={styles.newItemCardValue}>{val}</Text>
                                                            <Text style={[styles.newItemBadge, { backgroundColor: '#dbeafe' }]}>입력됨</Text>
                                                        </View>
                                                    ))}

                                                    {/* 기타 컬럼 (편집 가능) - 모두 표시 */}
                                                    {Object.entries(item.otherColumns).map(([col, val]) => (
                                                        <View key={col} style={styles.newItemCard}>
                                                            <Text style={styles.newItemCardLabel}>{col}</Text>
                                                            <TouchableOpacity
                                                                style={styles.newItemCardDropdown}
                                                                onPress={() => {
                                                                    if (showDropdown?.key === item.lookupValue && showDropdown?.column === col) {
                                                                        setShowDropdown(null);
                                                                    } else {
                                                                        setShowDropdown({ key: item.lookupValue, column: col });
                                                                    }
                                                                }}
                                                            >
                                                                <Text style={styles.newItemCardDropdownText} numberOfLines={1}>
                                                                    {val}
                                                                </Text>
                                                                <ChevronDown size={12} color="#6b7280" />
                                                            </TouchableOpacity>

                                                            {/* 드롭다운 옵션 */}
                                                            {showDropdown?.key === item.lookupValue && showDropdown?.column === col && (
                                                                <View style={styles.dropdownOptionsCard}>
                                                                    <TouchableOpacity
                                                                        style={styles.dropdownOption}
                                                                        onPress={() => {
                                                                            updateNewItemField(item.lookupValue, col, '신규등록');
                                                                            setShowDropdown(null);
                                                                        }}
                                                                    >
                                                                        <Text style={styles.dropdownOptionText}>신규등록</Text>
                                                                    </TouchableOpacity>
                                                                    {existingValues[col]?.slice(0, 10).map((v, idx) => (
                                                                        <TouchableOpacity
                                                                            key={idx}
                                                                            style={styles.dropdownOption}
                                                                            onPress={() => {
                                                                                updateNewItemField(item.lookupValue, col, v);
                                                                                setShowDropdown(null);
                                                                            }}
                                                                        >
                                                                            <Text style={styles.dropdownOptionText}>{v}</Text>
                                                                        </TouchableOpacity>
                                                                    ))}
                                                                </View>
                                                            )}
                                                        </View>
                                                    ))}
                                                </ScrollView>
                                            </View>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}
                        </View>
                    )}
                    {/* Step 5: 완료 */}
                    {step === 4 && (
                        <View style={styles.completeSection}>
                            {(isProcessing || isUndoing) ? (
                                <>
                                    <RefreshCw size={48} color="#6366f1" />
                                    <Text style={styles.processingText}>
                                        {isUndoing ? '되돌리는 중' : '처리 중'}... ({processedCount}/{totalCount})
                                    </Text>
                                </>
                            ) : (
                                <>
                                    <Check size={48} color="#10b981" />
                                    <Text style={styles.completeTitle}>
                                        {undoComplete ? '되돌리기 완료!' : '완료!'}
                                    </Text>
                                    <Text style={styles.completeStats}>
                                        성공: {results.success}건 / 실패: {results.failed}건
                                    </Text>

                                    {/* Undo 버튼 */}
                                    {(undoHistory.length > 0 || createdPageIds.length > 0) && !undoComplete && (
                                        <TouchableOpacity style={styles.undoButton} onPress={executeUndo}>
                                            <RotateCcw size={16} color="#b45309" />
                                            <Text style={styles.undoButtonText}>
                                                되돌리기 ({undoHistory.length + createdPageIds.length}건)
                                            </Text>
                                        </TouchableOpacity>
                                    )}

                                    <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
                                        <Text style={styles.closeButtonText}>닫기</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    )}
                </ScrollView>

                {/* Footer Navigation */}
                {step < 4 && (
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

                        {step === 3 ? (
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
                                        (step === 2 && (detectedColumns.length === 0 || parsedRows.length === 0))) && styles.nextButtonDisabled
                                ]}
                                onPress={() => { setStep(step + 1); setSearchText(''); }}
                                disabled={
                                    (step === 1 && !lookupColumn) ||
                                    (step === 2 && (detectedColumns.length === 0 || parsedRows.length === 0))
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
    statNoChange: {
        borderColor: '#9ca3af',
        backgroundColor: '#f9fafb',
    },
    statItemActive: {
        borderWidth: 3,
        borderColor: '#6366f1',
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
    filterSummary: {
        fontSize: 13,
        color: '#6b7280',
        marginBottom: 8,
        textAlign: 'center',
    },
    tableCellKey: {
        backgroundColor: '#f3f4f6',
    },
    previewLookupRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    previewChangeUpdate: {
        backgroundColor: '#ecfdf5',
        borderLeftColor: '#10b981',
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
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    sectionCheckbox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    checkboxSmall: {
        width: 16,
        height: 16,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: '#f59e0b',
        backgroundColor: '#fff',
        marginRight: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxSmallChecked: {
        backgroundColor: '#f59e0b',
        borderColor: '#f59e0b',
    },
    checkboxSmallCheckedGreen: {
        backgroundColor: '#22c55e',
        borderColor: '#22c55e',
    },
    sectionCheckboxText: {
        fontSize: 11,
        color: '#6b7280',
    },
    // 뷰모드 토글 스타일
    viewModeToggle: {
        flexDirection: 'row',
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        padding: 4,
        marginBottom: 12,
    },
    viewModeBtn: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 6,
    },
    viewModeBtnActive: {
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    viewModeText: {
        fontSize: 13,
        color: '#6b7280',
    },
    viewModeTextActive: {
        color: '#1f2937',
        fontWeight: '600',
    },
    // 테이블 뷰 스타일
    tableContainer: {
        backgroundColor: '#fff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        marginBottom: 12,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    tableCell: {
        padding: 8,
        borderRightWidth: 1,
        borderRightColor: '#f3f4f6',
        justifyContent: 'center',
    },
    tableHeaderCell: {
        backgroundColor: '#f9fafb',
    },
    tableHeaderText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#374151',
    },
    tableCellText: {
        fontSize: 12,
        color: '#1f2937',
    },
    tableOldValue: {
        fontSize: 10,
        color: '#9ca3af',
        textDecorationLine: 'line-through',
        marginBottom: 2,
    },
    tableBadge: {
        fontSize: 10,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        overflow: 'hidden',
        textAlign: 'center',
    },
    tableBadgeNew: {
        backgroundColor: '#dcfce7',
        color: '#166534',
    },
    tableBadgeUpdate: {
        backgroundColor: '#dbeafe',
        color: '#1e40af',
    },
    tableLegend: {
        flexDirection: 'row',
        padding: 10,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
        gap: 16,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    legendDot: {
        width: 12,
        height: 12,
        borderRadius: 2,
    },
    legendText: {
        fontSize: 11,
        color: '#6b7280',
        marginRight: 4,
    },
    previewTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#92400e',
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
    // 신규 항목 편집 스타일
    newItemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
        flexWrap: 'wrap',
    },
    newItemLabel: {
        fontSize: 12,
        color: '#6b7280',
        width: 80,
    },
    newItemValue: {
        fontSize: 13,
        color: '#1f2937',
        flex: 1,
    },
    newItemBadge: {
        fontSize: 10,
        color: '#059669',
        backgroundColor: '#d1fae5',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        marginLeft: 8,
    },
    newItemDropdown: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        flex: 1,
    },
    newItemDropdownText: {
        flex: 1,
        fontSize: 13,
        color: '#1f2937',
    },
    dropdownOptions: {
        position: 'absolute',
        top: 36,
        left: 80,
        right: 0,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        maxHeight: 200,
        zIndex: 100,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 5,
    },
    // 가로 스크롤 카드 스타일
    newItemCard: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        padding: 10,
        marginRight: 8,
        minWidth: 120,
        maxWidth: 160,
        overflow: 'visible',
        zIndex: 1,
    },
    newItemCardLabel: {
        fontSize: 11,
        color: '#6b7280',
        marginBottom: 4,
    },
    newItemCardValue: {
        fontSize: 13,
        color: '#1f2937',
        fontWeight: '500',
    },
    newItemCardDropdown: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    newItemCardDropdownText: {
        flex: 1,
        fontSize: 12,
        color: '#1f2937',
    },
    dropdownOptionsCard: {
        position: 'absolute',
        top: 70,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 6,
        maxHeight: 180,
        zIndex: 100,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 8,
    },
    dropdownOption: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    dropdownOptionText: {
        fontSize: 13,
        color: '#1f2937',
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
    undoButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fef3c7',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 8,
        marginTop: 16,
        gap: 8,
    },
    undoButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#b45309',
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
