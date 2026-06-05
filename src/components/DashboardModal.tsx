/**
 * DashboardModal — 앱 내에서 Notion DB를 직접 보고 편집하는 대시보드
 *
 * 기능:
 * - 컬럼 선택 (보고 싶은 컬럼만 체크) — 선택값은 메모리에 유지
 * - 다중 필터 (컬럼·연산·값) — AND 결합
 * - 다중 정렬 (컬럼·방향) — 위에 있는 게 우선순위
 * - 테이블 뷰 (가로 스크롤 + 세로 가상화)
 * - 셀 클릭 → 편집 다이얼로그
 *   · select / multi_select: Notion 옵션 + 다른 자산이 입력한 값 둘 다 추천
 *   · rich_text / title: 다른 자산이 같은 컬럼에 입력한 값들을 prefix 매칭으로 추천
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    TextInput,
    FlatList,
    Platform,
} from 'react-native';
import {
    X, Filter, ArrowUpDown, Columns, Check, Plus, Trash2, Edit2, Search, ChevronDown,
} from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';

interface Props {
    visible: boolean;
    onClose: () => void;
    assets: Asset[]; // 사이트 컨텍스트가 이미 적용된 자산
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdate: (id: string, field: string, value: string, type: string) => Promise<void>;
    /** 헤더에 표시할 타이틀. 안 주면 '데이터 뷰' */
    title?: string;
}

type FilterOp = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'is_empty' | 'is_not_empty';
type SortDir = 'asc' | 'desc';

interface FilterRow {
    id: string;
    column: string;
    op: FilterOp;
    value: string;
}

interface SortRow {
    id: string;
    column: string;
    dir: SortDir;
}

const FILTER_OP_LABEL: Record<FilterOp, string> = {
    contains: '포함',
    not_contains: '미포함',
    equals: '같음',
    not_equals: '다름',
    is_empty: '비어있음',
    is_not_empty: '값있음',
};

const DEFAULT_VISIBLE_COLUMNS = [
    'Name',
    'L)건물',
    'L)층',
    'L)연구실',
    'M)알약 온라인구분',
    'M)알약 현장조치',
    'M)ASM Push',
    'QA)백업 방법',
    'QA)네트워크 IP',
    'PC Hostname',
    'OS type',
    'User)소속 센터',
    'User)소속팀',
];

export const DashboardModal: React.FC<Props> = ({
    visible,
    onClose,
    assets,
    schema,
    schemaProperties,
    onUpdate,
    title,
}) => {
    // 표시 컬럼
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
        DEFAULT_VISIBLE_COLUMNS.filter(c => schema.includes(c))
    );
    const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
    const [sortRows, setSortRows] = useState<SortRow[]>([]);
    const [showColumnPicker, setShowColumnPicker] = useState(false);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showSortPanel, setShowSortPanel] = useState(false);
    const [quickSearch, setQuickSearch] = useState('');

    // 편집 다이얼로그 상태
    const [editingCell, setEditingCell] = useState<{ asset: Asset; field: string } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [editMultiSelected, setEditMultiSelected] = useState<string[]>([]);
    const [editSearch, setEditSearch] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // schema 동기화: 새 컬럼 들어왔는데 기본 매칭 안 된 경우 보정
    React.useEffect(() => {
        if (visibleColumns.length === 0 && schema.length > 0) {
            setVisibleColumns(DEFAULT_VISIBLE_COLUMNS.filter(c => schema.includes(c)));
        }
    }, [schema, visibleColumns.length]);

    // 컬럼별로 "다른 자산이 입력해둔 값"들을 모아 자동완성 추천
    const valueSuggestionsByField = useMemo(() => {
        const map: Record<string, string[]> = {};
        for (const a of assets) {
            for (const [k, v] of Object.entries(a.values)) {
                if (!v || String(v).trim() === '') continue;
                if (!map[k]) map[k] = [];
                const sv = String(v).trim();
                // 멀티셀렉트는 쉼표로 쪼개서 개별 옵션도 추천
                const type = schemaProperties[k]?.type;
                if (type === 'multi_select') {
                    sv.split(',').map(s => s.trim()).filter(Boolean).forEach(opt => {
                        if (!map[k].includes(opt)) map[k].push(opt);
                    });
                } else {
                    if (!map[k].includes(sv)) map[k].push(sv);
                }
            }
        }
        // 정렬
        Object.keys(map).forEach(k => map[k].sort((a, b) => a.localeCompare(b, 'ko')));
        return map;
    }, [assets, schemaProperties]);

    // 필터 + 정렬 + 빠른 검색 적용된 행
    const displayedAssets = useMemo(() => {
        let result = assets;

        // 빠른 검색 (선택된 컬럼 전체에서 contains)
        if (quickSearch.trim()) {
            const q = quickSearch.toLowerCase();
            result = result.filter(a =>
                visibleColumns.some(col => String((a.values as any)[col] ?? '').toLowerCase().includes(q))
            );
        }

        // 다중 필터 (AND)
        if (filterRows.length > 0) {
            result = result.filter(a => {
                return filterRows.every(f => {
                    if (!f.column) return true;
                    const v = String((a.values as any)[f.column] ?? '');
                    const vl = v.toLowerCase();
                    const tl = f.value.toLowerCase();
                    switch (f.op) {
                        case 'contains': return tl ? vl.includes(tl) : true;
                        case 'not_contains': return tl ? !vl.includes(tl) : true;
                        case 'equals': return tl ? vl === tl : true;
                        case 'not_equals': return tl ? vl !== tl : true;
                        case 'is_empty': return !v || v === '';
                        case 'is_not_empty': return !!v && v !== '';
                    }
                });
            });
        }

        // 다중 정렬 (위에 있는 게 우선)
        if (sortRows.length > 0) {
            result = [...result].sort((a, b) => {
                for (const s of sortRows) {
                    if (!s.column) continue;
                    const av = String((a.values as any)[s.column] ?? '');
                    const bv = String((b.values as any)[s.column] ?? '');
                    const cmp = av.localeCompare(bv, 'ko', { numeric: true });
                    if (cmp !== 0) return s.dir === 'asc' ? cmp : -cmp;
                }
                return 0;
            });
        }

        return result;
    }, [assets, filterRows, sortRows, quickSearch, visibleColumns]);

    const toggleColumn = (col: string) => {
        setVisibleColumns(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
    };

    const addFilter = () => {
        setFilterRows(prev => [...prev, {
            id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            column: visibleColumns[0] || schema[0] || '',
            op: 'contains',
            value: '',
        }]);
    };
    const updateFilter = (id: string, patch: Partial<FilterRow>) => {
        setFilterRows(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
    };
    const removeFilter = (id: string) => {
        setFilterRows(prev => prev.filter(f => f.id !== id));
    };

    const addSort = () => {
        setSortRows(prev => [...prev, {
            id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            column: visibleColumns[0] || schema[0] || '',
            dir: 'asc',
        }]);
    };
    const updateSort = (id: string, patch: Partial<SortRow>) => {
        setSortRows(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    };
    const removeSort = (id: string) => {
        setSortRows(prev => prev.filter(s => s.id !== id));
    };

    // 셀 클릭 → 편집 다이얼로그 오픈
    const openCellEdit = (asset: Asset, field: string) => {
        const current = String((asset.values as any)[field] ?? '');
        setEditingCell({ asset, field });
        setEditValue(current);
        setEditSearch('');
        const type = schemaProperties[field]?.type;
        if (type === 'multi_select') {
            setEditMultiSelected(current.split(',').map(s => s.trim()).filter(Boolean));
        } else {
            setEditMultiSelected([]);
        }
    };

    const closeCellEdit = () => {
        setEditingCell(null);
        setEditValue('');
        setEditSearch('');
        setEditMultiSelected([]);
    };

    // 편집 저장
    const saveCellEdit = async (overrideValue?: string) => {
        if (!editingCell) return;
        const type = schemaProperties[editingCell.field]?.type || 'rich_text';
        let valueToSave = overrideValue ?? editValue;
        if (type === 'multi_select') {
            valueToSave = editMultiSelected.join(', ');
        }
        setIsSaving(true);
        try {
            await onUpdate(editingCell.asset.id, editingCell.field, valueToSave, type);
            closeCellEdit();
        } finally {
            setIsSaving(false);
        }
    };

    // 편집 다이얼로그용 추천값 (Notion 옵션 + 다른 자산 값 병합)
    const editSuggestions = useMemo(() => {
        if (!editingCell) return [];
        const fieldName = editingCell.field;
        const type = schemaProperties[fieldName]?.type;
        const fromOptions = schemaProperties[fieldName]?.options?.map(o => o.name) || [];
        const fromAssets = valueSuggestionsByField[fieldName] || [];
        // 중복 제거 + 검색어 필터
        const seen = new Set<string>();
        const all: string[] = [];
        for (const v of [...fromOptions, ...fromAssets]) {
            const k = v.trim();
            if (!k || seen.has(k)) continue;
            seen.add(k);
            all.push(k);
        }
        const q = editSearch.trim().toLowerCase();
        const filtered = q ? all.filter(v => v.toLowerCase().includes(q)) : all;
        // 멀티셀렉트면 선택된 건 위로 정렬
        if (type === 'multi_select') {
            return filtered.sort((a, b) => {
                const ai = editMultiSelected.includes(a) ? 0 : 1;
                const bi = editMultiSelected.includes(b) ? 0 : 1;
                if (ai !== bi) return ai - bi;
                return a.localeCompare(b, 'ko');
            });
        }
        return filtered;
    }, [editingCell, schemaProperties, valueSuggestionsByField, editSearch, editMultiSelected]);

    const toggleEditOption = (opt: string) => {
        if (!editingCell) return;
        const type = schemaProperties[editingCell.field]?.type;
        if (type === 'multi_select') {
            setEditMultiSelected(prev =>
                prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]
            );
        } else {
            setEditValue(opt);
            // select는 클릭하면 자동 저장
            if (type === 'select') {
                saveCellEdit(opt);
            }
        }
    };

    // ---- 렌더 ----

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
            <View style={styles.container}>
                {/* 헤더 */}
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.title}>{title || '데이터 뷰'}</Text>
                        <Text style={styles.subtitle}>
                            {displayedAssets.length} / {assets.length}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={onClose}>
                        <X size={24} color="#6b7280" />
                    </TouchableOpacity>
                </View>

                {/* 컨트롤 바 */}
                <View style={styles.controlBar}>
                    <View style={styles.quickSearchBox}>
                        <Search size={16} color="#9ca3af" />
                        <TextInput
                            style={styles.quickSearchInput}
                            value={quickSearch}
                            onChangeText={setQuickSearch}
                            placeholder="빠른 검색 (선택된 컬럼)"
                            placeholderTextColor="#9ca3af"
                        />
                    </View>
                    <TouchableOpacity
                        style={[styles.ctrlBtn, showColumnPicker && styles.ctrlBtnActive]}
                        onPress={() => setShowColumnPicker(v => !v)}
                    >
                        <Columns size={14} color={showColumnPicker ? '#ffffff' : '#475569'} />
                        <Text style={[styles.ctrlBtnText, showColumnPicker && { color: '#ffffff' }]}>
                            컬럼 ({visibleColumns.length})
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.ctrlBtn, showFilterPanel && styles.ctrlBtnActive]}
                        onPress={() => setShowFilterPanel(v => !v)}
                    >
                        <Filter size={14} color={showFilterPanel ? '#ffffff' : '#475569'} />
                        <Text style={[styles.ctrlBtnText, showFilterPanel && { color: '#ffffff' }]}>
                            필터 ({filterRows.length})
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.ctrlBtn, showSortPanel && styles.ctrlBtnActive]}
                        onPress={() => setShowSortPanel(v => !v)}
                    >
                        <ArrowUpDown size={14} color={showSortPanel ? '#ffffff' : '#475569'} />
                        <Text style={[styles.ctrlBtnText, showSortPanel && { color: '#ffffff' }]}>
                            정렬 ({sortRows.length})
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* 컬럼 픽커 패널 */}
                {showColumnPicker && (
                    <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
                        {/* 전체 선택 / 해제 토글 */}
                        <View style={{
                            flexDirection: 'row',
                            gap: 8,
                            paddingBottom: 8,
                            marginBottom: 8,
                            borderBottomWidth: 1,
                            borderBottomColor: '#e5e7eb',
                        }}>
                            <TouchableOpacity
                                style={{
                                    flex: 1,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 4,
                                    paddingVertical: 8,
                                    backgroundColor: visibleColumns.length === schema.length ? '#e0e7ff' : '#f1f5f9',
                                    borderRadius: 8,
                                }}
                                onPress={() => setVisibleColumns([...schema])}
                            >
                                <Check size={12} color="#4338ca" />
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#4338ca' }}>
                                    전체 추가 ({schema.length})
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={{
                                    flex: 1,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 4,
                                    paddingVertical: 8,
                                    backgroundColor: visibleColumns.length === 0 ? '#fee2e2' : '#f1f5f9',
                                    borderRadius: 8,
                                }}
                                onPress={() => setVisibleColumns([])}
                            >
                                <X size={12} color="#b91c1c" />
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#b91c1c' }}>
                                    전체 해제
                                </Text>
                            </TouchableOpacity>
                        </View>
                        {schema.map(col => {
                            const checked = visibleColumns.includes(col);
                            return (
                                <TouchableOpacity
                                    key={col}
                                    style={styles.colItem}
                                    onPress={() => toggleColumn(col)}
                                >
                                    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                                        {checked && <Check size={12} color="#ffffff" />}
                                    </View>
                                    <Text style={styles.colItemText}>{col}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                )}

                {/* 필터 패널 */}
                {showFilterPanel && (
                    <View style={styles.panel}>
                        <ScrollView contentContainerStyle={styles.panelContent}>
                            {filterRows.map(f => (
                                <View key={f.id} style={styles.filterRow}>
                                    <ColumnPicker
                                        value={f.column}
                                        columns={schema}
                                        onChange={col => updateFilter(f.id, { column: col })}
                                    />
                                    <OpPicker
                                        value={f.op}
                                        onChange={op => updateFilter(f.id, { op })}
                                    />
                                    {f.op !== 'is_empty' && f.op !== 'is_not_empty' && (
                                        <TextInput
                                            style={styles.filterInput}
                                            value={f.value}
                                            onChangeText={t => updateFilter(f.id, { value: t })}
                                            placeholder="값"
                                            placeholderTextColor="#9ca3af"
                                        />
                                    )}
                                    <TouchableOpacity onPress={() => removeFilter(f.id)} style={styles.iconBtn}>
                                        <Trash2 size={14} color="#9ca3af" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                            <TouchableOpacity style={styles.addBtn} onPress={addFilter}>
                                <Plus size={14} color="#6366f1" />
                                <Text style={styles.addBtnText}>필터 추가</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                )}

                {/* 정렬 패널 */}
                {showSortPanel && (
                    <View style={styles.panel}>
                        <ScrollView contentContainerStyle={styles.panelContent}>
                            <Text style={styles.helperText}>위에 있는 정렬이 우선순위가 높습니다.</Text>
                            {sortRows.map((s, idx) => (
                                <View key={s.id} style={styles.filterRow}>
                                    <Text style={styles.sortOrder}>{idx + 1}.</Text>
                                    <ColumnPicker
                                        value={s.column}
                                        columns={schema}
                                        onChange={col => updateSort(s.id, { column: col })}
                                    />
                                    <TouchableOpacity
                                        style={[styles.dirBtn, s.dir === 'asc' && styles.dirBtnActive]}
                                        onPress={() => updateSort(s.id, { dir: 'asc' })}
                                    >
                                        <Text style={[styles.dirBtnText, s.dir === 'asc' && { color: '#ffffff' }]}>오름</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.dirBtn, s.dir === 'desc' && styles.dirBtnActive]}
                                        onPress={() => updateSort(s.id, { dir: 'desc' })}
                                    >
                                        <Text style={[styles.dirBtnText, s.dir === 'desc' && { color: '#ffffff' }]}>내림</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => removeSort(s.id)} style={styles.iconBtn}>
                                        <Trash2 size={14} color="#9ca3af" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                            <TouchableOpacity style={styles.addBtn} onPress={addSort}>
                                <Plus size={14} color="#6366f1" />
                                <Text style={styles.addBtnText}>정렬 추가</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                )}

                {/* 테이블 */}
                <View style={styles.tableWrap}>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            {/* 헤더 행 */}
                            <View style={styles.headerRow}>
                                {visibleColumns.map(col => (
                                    <View key={col} style={[styles.cell, styles.headerCell]}>
                                        <Text style={styles.headerCellText} numberOfLines={1}>{col}</Text>
                                    </View>
                                ))}
                            </View>
                            {/* 데이터 행들 (FlatList로 가상화) */}
                            <FlatList
                                data={displayedAssets}
                                keyExtractor={a => a.id}
                                initialNumToRender={30}
                                windowSize={10}
                                renderItem={({ item: asset, index }) => (
                                    <View style={[styles.dataRow, index % 2 === 0 && styles.dataRowAlt]}>
                                        {visibleColumns.map(col => {
                                            const v = String((asset.values as any)[col] ?? '');
                                            return (
                                                <TouchableOpacity
                                                    key={col}
                                                    style={[styles.cell, styles.dataCell]}
                                                    onPress={() => openCellEdit(asset, col)}
                                                    activeOpacity={0.6}
                                                >
                                                    <Text style={styles.dataCellText} numberOfLines={2}>
                                                        {v || <Text style={styles.empty}>—</Text>}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                )}
                            />
                        </View>
                    </ScrollView>
                </View>

                {/* 셀 편집 다이얼로그 */}
                {editingCell && (
                    <Modal visible animationType="fade" transparent onRequestClose={closeCellEdit}>
                        <TouchableOpacity style={styles.editOverlay} activeOpacity={1} onPress={closeCellEdit}>
                            <TouchableOpacity activeOpacity={1} style={styles.editDialog} onPress={() => { /* swallow */ }}>
                                <View style={styles.editHeader}>
                                    <View>
                                        <Text style={styles.editTitle}>{(editingCell.asset.values as any)['Name'] ?? ''}</Text>
                                        <Text style={styles.editSub}>{editingCell.field}</Text>
                                    </View>
                                    <TouchableOpacity onPress={closeCellEdit}>
                                        <X size={20} color="#6b7280" />
                                    </TouchableOpacity>
                                </View>

                                {(() => {
                                    const type = schemaProperties[editingCell.field]?.type;
                                    const isMulti = type === 'multi_select';
                                    const isSelect = type === 'select' || type === 'status';
                                    return (
                                        <>
                                            <View style={styles.editSearchBox}>
                                                <Search size={14} color="#9ca3af" />
                                                <TextInput
                                                    style={styles.editSearchInput}
                                                    value={isMulti || isSelect ? editSearch : editValue}
                                                    onChangeText={isMulti || isSelect ? setEditSearch : setEditValue}
                                                    placeholder={isMulti || isSelect ? '검색 또는 새 값 입력' : '값'}
                                                    placeholderTextColor="#9ca3af"
                                                    autoFocus
                                                />
                                            </View>

                                            {editSuggestions.length > 0 && (
                                                <>
                                                    <Text style={styles.suggestionsLabel}>
                                                        이미 입력된 값 / 옵션
                                                    </Text>
                                                    <ScrollView style={styles.suggestionsList}>
                                                        {editSuggestions.slice(0, 80).map(opt => {
                                                            const selected = isMulti && editMultiSelected.includes(opt);
                                                            return (
                                                                <TouchableOpacity
                                                                    key={opt}
                                                                    style={[styles.suggestionItem, selected && styles.suggestionItemActive]}
                                                                    onPress={() => toggleEditOption(opt)}
                                                                >
                                                                    {isMulti && (
                                                                        <View style={[styles.checkbox, selected && styles.checkboxOn]}>
                                                                            {selected && <Check size={12} color="#ffffff" />}
                                                                        </View>
                                                                    )}
                                                                    <Text style={styles.suggestionText} numberOfLines={1}>{opt}</Text>
                                                                </TouchableOpacity>
                                                            );
                                                        })}
                                                    </ScrollView>
                                                </>
                                            )}

                                            <View style={styles.editFooter}>
                                                <TouchableOpacity style={styles.editCancel} onPress={closeCellEdit}>
                                                    <Text style={styles.editCancelText}>취소</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[styles.editSave, isSaving && { opacity: 0.6 }]}
                                                    disabled={isSaving}
                                                    onPress={() => saveCellEdit()}
                                                >
                                                    <Text style={styles.editSaveText}>
                                                        {isSaving ? '저장 중…' : '저장'}
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                        </>
                                    );
                                })()}
                            </TouchableOpacity>
                        </TouchableOpacity>
                    </Modal>
                )}
            </View>
        </Modal>
    );
};

// ---------------------------------------------------------------------------
// 작은 헬퍼 컴포넌트
// ---------------------------------------------------------------------------

const ColumnPicker: React.FC<{
    value: string;
    columns: string[];
    onChange: (col: string) => void;
}> = ({ value, columns, onChange }) => {
    const [open, setOpen] = useState(false);
    return (
        <View style={{ position: 'relative' }}>
            <TouchableOpacity style={miniStyles.picker} onPress={() => setOpen(true)}>
                <Text style={miniStyles.pickerText} numberOfLines={1}>{value || '컬럼'}</Text>
                <ChevronDown size={12} color="#475569" />
            </TouchableOpacity>
            {open && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                    <TouchableOpacity style={miniStyles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
                        <View style={miniStyles.menu}>
                            <ScrollView>
                                {columns.map(c => (
                                    <TouchableOpacity
                                        key={c}
                                        style={miniStyles.menuItem}
                                        onPress={() => { onChange(c); setOpen(false); }}
                                    >
                                        <Text style={miniStyles.menuItemText}>{c}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    </TouchableOpacity>
                </Modal>
            )}
        </View>
    );
};

const OpPicker: React.FC<{
    value: FilterOp;
    onChange: (op: FilterOp) => void;
}> = ({ value, onChange }) => {
    const [open, setOpen] = useState(false);
    const ops: FilterOp[] = ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'];
    return (
        <View style={{ position: 'relative' }}>
            <TouchableOpacity style={miniStyles.picker} onPress={() => setOpen(true)}>
                <Text style={miniStyles.pickerText}>{FILTER_OP_LABEL[value]}</Text>
                <ChevronDown size={12} color="#475569" />
            </TouchableOpacity>
            {open && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                    <TouchableOpacity style={miniStyles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
                        <View style={miniStyles.menu}>
                            {ops.map(op => (
                                <TouchableOpacity
                                    key={op}
                                    style={miniStyles.menuItem}
                                    onPress={() => { onChange(op); setOpen(false); }}
                                >
                                    <Text style={miniStyles.menuItemText}>{FILTER_OP_LABEL[op]}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </TouchableOpacity>
                </Modal>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 14,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    headerLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    title: { fontSize: 18, fontWeight: 'bold', color: '#1f2937' },
    subtitle: { fontSize: 13, color: '#6b7280' },

    controlBar: {
        flexDirection: 'row',
        gap: 6,
        padding: 10,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        flexWrap: 'wrap',
    },
    quickSearchBox: {
        flex: 1,
        minWidth: 180,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    quickSearchInput: { flex: 1, fontSize: 13, color: '#1f2937', padding: 0 },
    ctrlBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
    },
    ctrlBtnActive: { backgroundColor: '#6366f1' },
    ctrlBtnText: { fontSize: 12, fontWeight: '600', color: '#475569' },

    panel: {
        maxHeight: 220,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    panelContent: { padding: 10, gap: 6 },
    colItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    colItemText: { fontSize: 12, color: '#1f2937' },
    checkbox: {
        width: 16, height: 16, borderRadius: 4, borderWidth: 1.5,
        borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
    helperText: { fontSize: 11, color: '#94a3b8', marginBottom: 4 },

    filterRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    filterInput: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        fontSize: 12,
        backgroundColor: '#ffffff',
        minWidth: 80,
    },
    iconBtn: { padding: 6 },
    sortOrder: { fontSize: 12, color: '#6366f1', fontWeight: '700', width: 18 },
    dirBtn: {
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: '#f3f4f6',
        borderRadius: 6,
    },
    dirBtnActive: { backgroundColor: '#6366f1' },
    dirBtnText: { fontSize: 11, color: '#475569', fontWeight: '600' },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 6,
        alignSelf: 'flex-start',
    },
    addBtnText: { fontSize: 12, color: '#6366f1', fontWeight: '600' },

    tableWrap: { flex: 1 },
    headerRow: { flexDirection: 'row', backgroundColor: '#1f2937' },
    headerCell: { backgroundColor: '#1f2937' },
    headerCellText: { fontSize: 11, fontWeight: '700', color: '#ffffff' },
    dataRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    dataRowAlt: { backgroundColor: '#fafafa' },
    dataCell: {},
    dataCellText: { fontSize: 12, color: '#1f2937' },
    cell: {
        width: 160,
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderRightWidth: 1,
        borderRightColor: '#f1f5f9',
        justifyContent: 'center',
    },
    empty: { color: '#cbd5e1' },

    editOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    editDialog: { backgroundColor: '#ffffff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '85%', padding: 16 },
    editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
    editTitle: { fontSize: 16, fontWeight: '700', color: '#1f2937' },
    editSub: { fontSize: 12, color: '#6366f1', marginTop: 2 },
    editSearchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginBottom: 8,
    },
    editSearchInput: { flex: 1, fontSize: 14, color: '#1f2937', padding: 0 },
    suggestionsLabel: {
        fontSize: 11,
        color: '#475569',
        fontWeight: '700',
        marginTop: 4,
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    suggestionsList: { maxHeight: 280 },
    suggestionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 6,
    },
    suggestionItemActive: { backgroundColor: '#eef2ff' },
    suggestionText: { fontSize: 13, color: '#1f2937', flex: 1 },
    editFooter: { flexDirection: 'row', gap: 8, marginTop: 12 },
    editCancel: { flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center' },
    editCancelText: { fontSize: 13, color: '#475569', fontWeight: '600' },
    editSave: { flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#6366f1', alignItems: 'center' },
    editSaveText: { fontSize: 13, color: '#ffffff', fontWeight: '700' },
});

const miniStyles = StyleSheet.create({
    picker: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: '#ffffff',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        minWidth: 110,
        maxWidth: 160,
    },
    pickerText: { fontSize: 12, color: '#1f2937', flex: 1 },
    overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', justifyContent: 'center', alignItems: 'center' },
    menu: {
        backgroundColor: '#ffffff',
        borderRadius: 10,
        maxHeight: 360,
        width: 260,
        padding: 6,
    },
    menuItem: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6 },
    menuItemText: { fontSize: 13, color: '#1f2937' },
});
