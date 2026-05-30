/**
 * TaskDashboardModal — 정기/현장 업무를 테이블 형태로 한눈에
 *
 * 4가지 영역:
 *  1) 상단 통계 — 총 대상 자산 / 총 과제 건 / 매칭 자산 비율
 *  2) Quick Task별 진행바 — 각 task 의 대상 수 (가로 막대)
 *  3) 위치별 그룹화 자산 테이블 — 동선 짜기 편하게 건물·층으로 묶음
 *  4) 인라인 ✓ 완료 — 행에서 바로 칩별 완료 처리
 *
 * 사이트 컨텍스트(currentSite) 가 부모로부터 그대로 흐르므로 마곡/용인
 * 등에서 호출하면 그 사이트 자산만 보입니다.
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
} from 'react-native';
import { X, Search, ClipboardCheck, MapPin, Check, ChevronDown, ChevronRight } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import {
    QUICK_TASKS,
    QuickTaskDef,
    getMatchingQuickTasks,
    HISTORY_FIELD_NAME,
} from '../lib/quickTasks';

interface Props {
    visible: boolean;
    onClose: () => void;
    assets: Asset[]; // 사이트 컨텍스트 적용된 자산
    schemaProperties: Record<string, NotionProperty>;
    onCompleteQuickTask: (asset: Asset, task: QuickTaskDef) => Promise<void>;
    /** 카드 모드로 점프하고 싶을 때 (행 클릭) */
    onJumpToAsset?: (asset: Asset) => void;
}

interface AssetRow {
    asset: Asset;
    matched: QuickTaskDef[];
    locationKey: string;
    location: string;
}

export const TaskDashboardModal: React.FC<Props> = ({
    visible,
    onClose,
    assets,
    schemaProperties,
    onCompleteQuickTask,
    onJumpToAsset,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTaskFilter, setActiveTaskFilter] = useState<string | null>(null);
    const [completingKey, setCompletingKey] = useState<string | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    const titleField = useMemo(() => {
        return Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name';
    }, [schemaProperties]);

    // 매칭되는 과제가 1건 이상인 자산만 추출 + 위치 키 계산
    const allRows = useMemo<AssetRow[]>(() => {
        const rows: AssetRow[] = [];
        for (const asset of assets) {
            const matched = getMatchingQuickTasks(asset);
            if (matched.length === 0) continue;
            const v = asset.values as any;
            const b = String(v['L)건물'] ?? '').trim() || '(건물 미상)';
            const f = String(v['L)층'] ?? '').trim() || '(층 미상)';
            const r = String(v['L)연구실'] ?? '').trim() || '(연구실 미상)';
            rows.push({
                asset,
                matched,
                locationKey: `${b}__${f}`,
                location: `${b} · ${f} · ${r}`,
            });
        }
        return rows;
    }, [assets]);

    // 검색 + Quick Task 필터 적용
    const filteredRows = useMemo(() => {
        let result = allRows;
        if (activeTaskFilter) {
            result = result.filter(r => r.matched.some(t => t.id === activeTaskFilter));
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(r =>
                String((r.asset.values as any)[titleField] ?? '').toLowerCase().includes(q) ||
                r.location.toLowerCase().includes(q)
            );
        }
        return result;
    }, [allRows, activeTaskFilter, searchQuery, titleField]);

    // 통계
    const stats = useMemo(() => {
        const totalAssets = allRows.length;
        const totalTaskCount = allRows.reduce((acc, r) => acc + r.matched.length, 0);
        const perTask: Record<string, number> = {};
        for (const r of allRows) {
            for (const t of r.matched) {
                perTask[t.id] = (perTask[t.id] || 0) + 1;
            }
        }
        const maxPerTask = Math.max(1, ...Object.values(perTask));
        return { totalAssets, totalTaskCount, perTask, maxPerTask };
    }, [allRows]);

    // 위치별 그룹화
    const grouped = useMemo(() => {
        const map = new Map<string, { key: string; building: string; floor: string; rows: AssetRow[] }>();
        for (const r of filteredRows) {
            const v = r.asset.values as any;
            const b = String(v['L)건물'] ?? '').trim() || '(건물 미상)';
            const f = String(v['L)층'] ?? '').trim() || '(층 미상)';
            const k = `${b}__${f}`;
            if (!map.has(k)) map.set(k, { key: k, building: b, floor: f, rows: [] });
            map.get(k)!.rows.push(r);
        }
        return Array.from(map.values()).sort((a, b) => {
            const c = a.building.localeCompare(b.building, 'ko');
            if (c !== 0) return c;
            return a.floor.localeCompare(b.floor, 'ko', { numeric: true });
        });
    }, [filteredRows]);

    const handleCompleteInline = useCallback(async (asset: Asset, task: QuickTaskDef) => {
        const key = `${asset.id}-${task.id}`;
        if (completingKey === key) return;
        setCompletingKey(key);
        try {
            await onCompleteQuickTask(asset, task);
        } finally {
            setCompletingKey(null);
        }
    }, [completingKey, onCompleteQuickTask]);

    const toggleGroup = (k: string) => {
        setCollapsedGroups(prev => ({ ...prev, [k]: !prev[k] }));
    };

    // 최근 처리이력 한 줄 (위)
    const getLastHistoryLine = (asset: Asset): string => {
        const h = String((asset.values as any)[HISTORY_FIELD_NAME] ?? '').trim();
        if (!h) return '';
        return h.split('\n').filter(Boolean)[0] || '';
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
            <View style={styles.container}>
                {/* 헤더 */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>과제 대시보드</Text>
                        <Text style={styles.subtitle}>
                            {stats.totalAssets}대 · 총 {stats.totalTaskCount}건
                            {filteredRows.length !== allRows.length &&
                                ` · 필터링 ${filteredRows.length}대`}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={onClose}>
                        <X size={24} color="#6b7280" />
                    </TouchableOpacity>
                </View>

                {/* 검색 + Quick Task 필터 칩 */}
                <View style={styles.controls}>
                    <View style={styles.searchBox}>
                        <Search size={14} color="#9ca3af" />
                        <TextInput
                            style={styles.searchInput}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="Name / 위치 검색"
                            placeholderTextColor="#94a3b8"
                        />
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.taskFilterScroll}>
                        <View style={styles.taskFilterRow}>
                            <TouchableOpacity
                                style={[styles.taskFilterChip, !activeTaskFilter && styles.taskFilterChipActive]}
                                onPress={() => setActiveTaskFilter(null)}
                            >
                                <Text style={[styles.taskFilterChipText, !activeTaskFilter && styles.taskFilterChipTextActive]}>
                                    전체 {allRows.length}
                                </Text>
                            </TouchableOpacity>
                            {QUICK_TASKS.map(t => {
                                const cnt = stats.perTask[t.id] || 0;
                                if (cnt === 0) return null;
                                const active = activeTaskFilter === t.id;
                                return (
                                    <TouchableOpacity
                                        key={t.id}
                                        style={[
                                            styles.taskFilterChip,
                                            { backgroundColor: active ? t.color : t.bgColor },
                                        ]}
                                        onPress={() => setActiveTaskFilter(active ? null : t.id)}
                                    >
                                        <Text style={styles.taskFilterChipEmoji}>{t.emoji}</Text>
                                        <Text style={[
                                            styles.taskFilterChipText,
                                            { color: active ? '#ffffff' : t.color, fontWeight: '700' },
                                        ]}>
                                            {t.name} {cnt}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>

                {/* Quick Task별 진행바 */}
                <View style={styles.progressSection}>
                    {QUICK_TASKS.map(t => {
                        const cnt = stats.perTask[t.id] || 0;
                        if (cnt === 0) return null;
                        const widthPct = (cnt / stats.maxPerTask) * 100;
                        return (
                            <View key={t.id} style={styles.progressRow}>
                                <Text style={styles.progressEmoji}>{t.emoji}</Text>
                                <Text style={styles.progressName} numberOfLines={1}>{t.name}</Text>
                                <View style={styles.progressBarTrack}>
                                    <View style={[styles.progressBarFill, { width: `${widthPct}%`, backgroundColor: t.color }]} />
                                </View>
                                <Text style={[styles.progressCount, { color: t.color }]}>{cnt}</Text>
                            </View>
                        );
                    })}
                </View>

                {/* 위치별 그룹화 자산 테이블 */}
                <ScrollView style={styles.tableScroll} contentContainerStyle={styles.tableContent}>
                    {grouped.length === 0 ? (
                        <View style={styles.emptyBox}>
                            <Text style={styles.emptyText}>
                                {allRows.length === 0
                                    ? '현재 정기 업무에 해당하는 기기가 없어요.'
                                    : '필터 조건에 맞는 기기가 없어요.'}
                            </Text>
                        </View>
                    ) : (
                        grouped.map(group => {
                            const collapsed = !!collapsedGroups[group.key];
                            const totalTasks = group.rows.reduce((a, r) => a + r.matched.length, 0);
                            return (
                                <View key={group.key} style={styles.groupBlock}>
                                    <TouchableOpacity
                                        style={styles.groupHeader}
                                        onPress={() => toggleGroup(group.key)}
                                        activeOpacity={0.7}
                                    >
                                        {collapsed
                                            ? <ChevronRight size={14} color="#475569" />
                                            : <ChevronDown size={14} color="#475569" />}
                                        <MapPin size={13} color="#6366f1" />
                                        <Text style={styles.groupTitle}>
                                            {group.building} · {group.floor}
                                        </Text>
                                        <Text style={styles.groupCount}>
                                            {group.rows.length}대 / {totalTasks}건
                                        </Text>
                                    </TouchableOpacity>

                                    {!collapsed && group.rows.map(row => {
                                        const name = String((row.asset.values as any)[titleField] ?? '');
                                        const room = String((row.asset.values as any)['L)연구실'] ?? '').trim();
                                        const lastHistory = getLastHistoryLine(row.asset);
                                        return (
                                            <View key={row.asset.id} style={styles.tableRow}>
                                                <TouchableOpacity
                                                    style={styles.rowNameCell}
                                                    onPress={() => onJumpToAsset?.(row.asset)}
                                                    activeOpacity={0.7}
                                                >
                                                    <Text style={styles.rowName}>{name || '(이름 없음)'}</Text>
                                                    {!!room && (
                                                        <Text style={styles.rowRoom} numberOfLines={1}>{room}</Text>
                                                    )}
                                                </TouchableOpacity>
                                                <View style={styles.rowTaskCell}>
                                                    {row.matched.map(t => {
                                                        const isCompleting = completingKey === `${row.asset.id}-${t.id}`;
                                                        return (
                                                            <View
                                                                key={t.id}
                                                                style={[styles.rowTaskChip, { backgroundColor: t.bgColor }]}
                                                            >
                                                                <Text style={styles.rowTaskChipEmoji}>{t.emoji}</Text>
                                                                <Text
                                                                    style={[styles.rowTaskChipName, { color: t.color }]}
                                                                    numberOfLines={1}
                                                                >
                                                                    {t.name}
                                                                </Text>
                                                                <TouchableOpacity
                                                                    style={[styles.rowTaskDoneBtn, { backgroundColor: t.color }]}
                                                                    onPress={() => handleCompleteInline(row.asset, t)}
                                                                    disabled={isCompleting}
                                                                >
                                                                    <Check size={10} color="#ffffff" />
                                                                    <Text style={styles.rowTaskDoneText}>
                                                                        {isCompleting ? '…' : '완료'}
                                                                    </Text>
                                                                </TouchableOpacity>
                                                            </View>
                                                        );
                                                    })}
                                                    {!!lastHistory && (
                                                        <Text style={styles.rowHistory} numberOfLines={1}>
                                                            최근: {lastHistory}
                                                        </Text>
                                                    )}
                                                </View>
                                            </View>
                                        );
                                    })}
                                </View>
                            );
                        })
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 14,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: 18, fontWeight: 'bold', color: '#1f2937' },
    subtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },

    controls: {
        padding: 10,
        gap: 8,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    searchInput: { flex: 1, fontSize: 13, color: '#1f2937', padding: 0 },
    taskFilterScroll: { marginHorizontal: -4 },
    taskFilterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 4 },
    taskFilterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: '#f3f4f6',
        borderRadius: 14,
    },
    taskFilterChipActive: { backgroundColor: '#1f2937' },
    taskFilterChipEmoji: { fontSize: 12 },
    taskFilterChipText: { fontSize: 11, color: '#475569', fontWeight: '600' },
    taskFilterChipTextActive: { color: '#ffffff' },

    progressSection: {
        padding: 10,
        gap: 4,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    progressEmoji: { fontSize: 13, width: 18 },
    progressName: { fontSize: 11, color: '#475569', width: 130 },
    progressBarTrack: { flex: 1, height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden' },
    progressBarFill: { height: '100%' },
    progressCount: { fontSize: 11, fontWeight: '800', minWidth: 28, textAlign: 'right' },

    tableScroll: { flex: 1 },
    tableContent: { padding: 10, gap: 10 },
    emptyBox: { padding: 40, alignItems: 'center' },
    emptyText: { fontSize: 13, color: '#94a3b8' },

    groupBlock: {
        backgroundColor: '#ffffff',
        borderRadius: 10,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    groupHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: '#eef2ff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e7ff',
    },
    groupTitle: { fontSize: 13, fontWeight: '700', color: '#4338ca', flex: 1 },
    groupCount: {
        fontSize: 11,
        fontWeight: '700',
        color: '#6366f1',
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
    },
    tableRow: {
        flexDirection: 'row',
        gap: 8,
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#f8fafc',
    },
    rowNameCell: { width: 110 },
    rowName: { fontSize: 13, fontWeight: '700', color: '#1f2937' },
    rowRoom: { fontSize: 11, color: '#64748b', marginTop: 2 },
    rowTaskCell: { flex: 1, gap: 6 },
    rowTaskChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingLeft: 8,
        paddingRight: 4,
        paddingVertical: 4,
        borderRadius: 14,
        alignSelf: 'flex-start',
    },
    rowTaskChipEmoji: { fontSize: 12 },
    rowTaskChipName: { fontSize: 11, fontWeight: '700', maxWidth: 160 },
    rowTaskDoneBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 10,
        marginLeft: 2,
    },
    rowTaskDoneText: { color: '#ffffff', fontSize: 9, fontWeight: '800' },
    rowHistory: { fontSize: 10, color: '#94a3b8', fontStyle: 'italic', marginTop: 2 },
});
