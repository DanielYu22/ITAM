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
import { roomKey, type LayoutsStore } from '../lib/layouts';
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
import { X, Search, ClipboardCheck, MapPin, Check, ChevronDown, ChevronRight, FoldVertical, UnfoldVertical, Navigation, Copy } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import {
    QUICK_TASKS,
    QuickTaskDef,
    getMatchingQuickTasks,
    HISTORY_FIELD_NAME,
} from '../lib/quickTasks';
import { SiteId, SITES_DEFAULTS, getAssetSite, SiteDef } from '../lib/sites';

interface Props {
    visible: boolean;
    onClose: () => void;
    assets: Asset[]; // 사이트 컨텍스트 적용된 자산
    schemaProperties: Record<string, NotionProperty>;
    onCompleteQuickTask: (asset: Asset, task: QuickTaskDef) => Promise<void>;
    /** 카드 모드로 점프하고 싶을 때 (행 클릭) */
    onJumpToAsset?: (asset: Asset) => void;
    /** 현재 사이트 컨텍스트. 'all' 일 때만 트리에 사이트 단계가 추가됨. */
    currentSite?: SiteId;
    effectiveSites?: SiteDef[];
    /** [A-1.5] 레이아웃 동선 순서 — 방별 기기 방문순서로 대시보드 정렬에 사용 */
    layoutsStore?: LayoutsStore;
    /** Quick Task 토글 — 통합 카드와 공유 */
    disabledTaskIds?: Set<string>;
    onToggleTaskDisabled?: (id: string) => void;
}

interface AssetRow {
    asset: Asset;
    matched: QuickTaskDef[];
    siteId: SiteId;
    building: string;
    floor: string;
    room: string;
}

// 재귀 트리 노드 — 사이트/건물/층/연구실 단계
type TreeLevel = 'site' | 'building' | 'floor' | 'room';
interface TreeNode {
    key: string;       // 경로 기반 unique key (토글 식별용)
    label: string;     // 표시 라벨
    level: TreeLevel;
    rowCount: number;
    taskCount: number;
    children?: TreeNode[];
    rows?: AssetRow[]; // 연구실 단계에만 존재
}

export const TaskDashboardModal: React.FC<Props> = ({
    visible,
    onClose,
    assets,
    schemaProperties,
    onCompleteQuickTask,
    onJumpToAsset,
    currentSite = 'all',
    effectiveSites,
    layoutsStore,
    disabledTaskIds,
    onToggleTaskDisabled,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTaskFilter, setActiveTaskFilter] = useState<string | null>(null);
    const [completingKey, setCompletingKey] = useState<string | null>(null);
    // 펼쳐진 노드 key 집합. 기본 비어있음 = 모두 접힘.
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
    // [브리핑] 방문 동선 브리핑 텍스트 (null = 미표시)
    const [briefingText, setBriefingText] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const titleField = useMemo(() => {
        return Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name';
    }, [schemaProperties]);

    // 매칭되는 과제가 1건 이상인 자산만 추출 + 위치 정보
    // disabled 된 Quick Task 는 매칭에서 제외
    const allRows = useMemo<AssetRow[]>(() => {
        const enabledTasks = QUICK_TASKS.filter(t => !disabledTaskIds || !disabledTaskIds.has(t.id));
        const rows: AssetRow[] = [];
        for (const asset of assets) {
            const matched = getMatchingQuickTasks(asset, enabledTasks);
            if (matched.length === 0) continue;
            const v = asset.values as any;
            rows.push({
                asset,
                matched,
                siteId: getAssetSite(asset, effectiveSites),
                building: String(v['L)건물'] ?? '').trim() || '(건물 미상)',
                floor: String(v['L)층'] ?? '').trim() || '(층 미상)',
                room: String(v['L)연구실'] ?? '').trim() || '(연구실 미상)',
            });
        }
        return rows;
    }, [assets, effectiveSites, disabledTaskIds]);

    // 검색 + Quick Task 필터 적용
    const filteredRows = useMemo(() => {
        let result = allRows;
        if (activeTaskFilter) {
            result = result.filter(r => r.matched.some(t => t.id === activeTaskFilter));
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(r => {
                const name = String((r.asset.values as any)[titleField] ?? '').toLowerCase();
                const loc = `${r.building} ${r.floor} ${r.room}`.toLowerCase();
                return name.includes(q) || loc.includes(q);
            });
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

    // 4단계 트리 구조 — 사이트 단계는 currentSite === 'all' 일 때만 포함
    const tree = useMemo<TreeNode[]>(() => {
        const includeSite = currentSite === 'all';
        // 임시 nested map: site → building → floor → room → rows
        const root: Record<string, Record<string, Record<string, Record<string, AssetRow[]>>>> = {};
        for (const r of filteredRows) {
            const siteKey = includeSite ? r.siteId : '_';
            if (!root[siteKey]) root[siteKey] = {};
            if (!root[siteKey][r.building]) root[siteKey][r.building] = {};
            if (!root[siteKey][r.building][r.floor]) root[siteKey][r.building][r.floor] = {};
            if (!root[siteKey][r.building][r.floor][r.room]) root[siteKey][r.building][r.floor][r.room] = [];
            root[siteKey][r.building][r.floor][r.room].push(r);
        }
        // 변환: 카운트 + 정렬
        const krSort = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true });
        const taskCount = (rows: AssetRow[]) => rows.reduce((a, r) => a + r.matched.length, 0);
        const siteNodes: TreeNode[] = [];
        for (const siteKey of Object.keys(root).sort()) {
            const buildings = root[siteKey];
            const siteLabel = includeSite
                ? (SITES_DEFAULTS.find(s => s.id === (siteKey as SiteId))?.name || siteKey)
                : '';
            const buildingNodes: TreeNode[] = [];
            for (const b of Object.keys(buildings).sort(krSort)) {
                const floors = buildings[b];
                const floorNodes: TreeNode[] = [];
                for (const f of Object.keys(floors).sort(krSort)) {
                    const rooms = floors[f];
                    const roomNodes: TreeNode[] = [];
                    for (const rm of Object.keys(rooms).sort(krSort)) {
                        // [A-1.5] 레이아웃 동선 순서 — 이 방의 기기별 방문순서 조회.
                        //   주의: 레이아웃 assetId 는 이관 전 회사 DB id 라 개인 자산 id 와 불일치 →
                        //   기기명(label/이름)으로 매칭한다.
                        const orderMap: Record<string, number> = {};
                        const rl = layoutsStore?.rooms?.[roomKey(b, f, rm)];
                        if (rl) for (const o of rl.objects || []) {
                            const nm = String(o.label ?? '').trim();
                            if (nm && typeof o.order === 'number') orderMap[nm] = o.order;
                        }
                        const nameOf = (r: AssetRow) => String((r.asset.values as any)[titleField] ?? '');
                        const rows = rooms[rm].sort((ra, rb) => {
                            const oa = orderMap[nameOf(ra).trim()]; const ob = orderMap[nameOf(rb).trim()];
                            // 동선 순서 지정된 기기 우선(순서대로), 나머지는 이름순.
                            if (oa != null && ob != null) return oa - ob;
                            if (oa != null) return -1;
                            if (ob != null) return 1;
                            return nameOf(ra).localeCompare(nameOf(rb), 'ko', { numeric: true });
                        });
                        roomNodes.push({
                            key: `${siteKey}/${b}/${f}/${rm}`,
                            label: rm,
                            level: 'room',
                            rowCount: rows.length,
                            taskCount: taskCount(rows),
                            rows,
                        });
                    }
                    const fRowCount = roomNodes.reduce((a, n) => a + n.rowCount, 0);
                    const fTaskCount = roomNodes.reduce((a, n) => a + n.taskCount, 0);
                    floorNodes.push({
                        key: `${siteKey}/${b}/${f}`,
                        label: f,
                        level: 'floor',
                        rowCount: fRowCount,
                        taskCount: fTaskCount,
                        children: roomNodes,
                    });
                }
                const bRowCount = floorNodes.reduce((a, n) => a + n.rowCount, 0);
                const bTaskCount = floorNodes.reduce((a, n) => a + n.taskCount, 0);
                buildingNodes.push({
                    key: `${siteKey}/${b}`,
                    label: b,
                    level: 'building',
                    rowCount: bRowCount,
                    taskCount: bTaskCount,
                    children: floorNodes,
                });
            }
            if (includeSite) {
                const sRowCount = buildingNodes.reduce((a, n) => a + n.rowCount, 0);
                const sTaskCount = buildingNodes.reduce((a, n) => a + n.taskCount, 0);
                siteNodes.push({
                    key: `site/${siteKey}`,
                    label: siteLabel,
                    level: 'site',
                    rowCount: sRowCount,
                    taskCount: sTaskCount,
                    children: buildingNodes,
                });
            } else {
                // 사이트 단계 생략 시 buildings 가 최상위
                siteNodes.push(...buildingNodes);
            }
        }
        return siteNodes;
    }, [filteredRows, currentSite, titleField, layoutsStore]);

    // [브리핑] 동선 순서대로 정렬된 트리를 방문용 워크플랜 텍스트로 직렬화.
    //   현재 검색/필터/사이트가 그대로 반영되므로 "창조관" 검색 후 브리핑하면 그 건물만 나온다.
    const openBriefing = useCallback(() => {
        const lines: string[] = [];
        let totalRows = 0, totalTasks = 0;
        const taskLabel = (t: QuickTaskDef) => `${t.emoji}${t.name}`;
        const walk = (nodes: TreeNode[]) => {
            for (const n of nodes) {
                if (n.level === 'site') {
                    lines.push(`\n■ ${n.label}  (${n.rowCount}대 · ${n.taskCount}건)`);
                    walk(n.children || []);
                } else if (n.level === 'building') {
                    lines.push(`\n● ${n.label}  (${n.rowCount}대 · ${n.taskCount}건)`);
                    walk(n.children || []);
                } else if (n.level === 'floor') {
                    lines.push(` ▸ ${n.label}`);
                    walk(n.children || []);
                } else if (n.level === 'room') {
                    lines.push(`   〔${n.label}〕`);
                    (n.rows || []).forEach((r, i) => {
                        const nm = String((r.asset.values as any)[titleField] ?? '(이름없음)');
                        lines.push(`    ${i + 1}. ${nm} — ${r.matched.map(taskLabel).join(', ')}`);
                    });
                }
            }
        };
        walk(tree);
        for (const n of tree) { totalRows += n.rowCount; totalTasks += n.taskCount; }
        const header = `🧭 방문 동선 브리핑\n대상 ${totalRows}대 · 처리할 과제 ${totalTasks}건 (레이아웃 동선 순서)\n`;
        setBriefingText(totalRows === 0 ? `${header}\n표시할 대상이 없어요. 검색/필터를 확인해 주세요.` : header + lines.join('\n'));
        setCopied(false);
    }, [tree, titleField]);

    const copyBriefing = useCallback(async () => {
        if (!briefingText) return;
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(briefingText);
            } else {
                const Clipboard = require('expo-clipboard');
                await Clipboard.setStringAsync(briefingText);
            }
            setCopied(true);
        } catch (e) {
            console.error('briefing copy failed:', e);
        }
    }, [briefingText]);

    // 트리 안 모든 노드 key 수집 (펼치기 토글용)
    const allNodeKeys = useMemo(() => {
        const keys: string[] = [];
        const walk = (nodes: TreeNode[]) => {
            for (const n of nodes) {
                keys.push(n.key);
                if (n.children) walk(n.children);
            }
        };
        walk(tree);
        return keys;
    }, [tree]);

    const allExpanded = expandedKeys.size > 0 && expandedKeys.size === allNodeKeys.length;
    const toggleAll = () => {
        if (allExpanded || expandedKeys.size > 0) {
            setExpandedKeys(new Set());
        } else {
            setExpandedKeys(new Set(allNodeKeys));
        }
    };
    const toggleNode = (key: string) => {
        setExpandedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

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

    // 최근 처리이력 한 줄
    const getLastHistoryLine = (asset: Asset): string => {
        const h = String((asset.values as any)[HISTORY_FIELD_NAME] ?? '').trim();
        if (!h) return '';
        return h.split('\n').filter(Boolean)[0] || '';
    };

    // 자산 행 렌더
    const renderAssetRow = (row: AssetRow) => {
        const name = String((row.asset.values as any)[titleField] ?? '');
        const lastHistory = getLastHistoryLine(row.asset);
        return (
            <View key={row.asset.id} style={styles.tableRow}>
                <TouchableOpacity
                    style={styles.rowNameCell}
                    onPress={() => onJumpToAsset?.(row.asset)}
                    activeOpacity={0.7}
                >
                    <Text style={styles.rowName}>{name || '(이름 없음)'}</Text>
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
    };

    // 트리 노드 재귀 렌더
    const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
        const expanded = expandedKeys.has(node.key);
        const indent = depth * 14;
        // 단계별 색상
        const headerStyle = node.level === 'site'
            ? styles.nodeHeaderSite
            : node.level === 'building'
                ? styles.nodeHeaderBuilding
                : node.level === 'floor'
                    ? styles.nodeHeaderFloor
                    : styles.nodeHeaderRoom;
        return (
            <View key={node.key} style={[styles.nodeBlock, { marginLeft: indent }]}>
                <TouchableOpacity
                    style={[styles.nodeHeader, headerStyle]}
                    onPress={() => toggleNode(node.key)}
                    activeOpacity={0.7}
                >
                    {expanded
                        ? <ChevronDown size={13} color="#475569" />
                        : <ChevronRight size={13} color="#475569" />}
                    <MapPin size={11} color="#6366f1" />
                    <Text style={styles.nodeLabel} numberOfLines={1}>{node.label}</Text>
                    <Text style={styles.nodeCount}>
                        {node.rowCount}대 / {node.taskCount}건
                    </Text>
                </TouchableOpacity>
                {expanded && node.children && (
                    <View>{node.children.map(c => renderNode(c, depth + 1))}</View>
                )}
                {expanded && node.rows && (
                    <View style={styles.nodeRows}>
                        {node.rows.map(renderAssetRow)}
                    </View>
                )}
            </View>
        );
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <TouchableOpacity style={styles.briefingBtn} onPress={openBriefing}>
                            <Navigation size={14} color="#4338ca" />
                            <Text style={styles.briefingBtnText}>방문 브리핑</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onClose}>
                            <X size={24} color="#6b7280" />
                        </TouchableOpacity>
                    </View>
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
                                const active = activeTaskFilter === t.id;
                                const off = !!disabledTaskIds?.has(t.id);
                                const dim = !off && cnt === 0;
                                return (
                                    <TouchableOpacity
                                        key={t.id}
                                        style={[
                                            styles.taskFilterChip,
                                            { backgroundColor: active ? t.color : t.bgColor },
                                            dim && !active && { opacity: 0.5 },
                                            off && { backgroundColor: '#e5e7eb', opacity: 0.4 },
                                        ]}
                                        onPress={() => !off && !dim && setActiveTaskFilter(active ? null : t.id)}
                                        onLongPress={() => onToggleTaskDisabled?.(t.id)}
                                        disabled={false}
                                    >
                                        <Text style={[styles.taskFilterChipEmoji, off && { textDecorationLine: 'line-through' as any }]}>{t.emoji}</Text>
                                        <Text style={[
                                            styles.taskFilterChipText,
                                            { color: active ? '#ffffff' : (off ? '#6b7280' : t.color), fontWeight: '700' },
                                            off && { textDecorationLine: 'line-through' as any },
                                        ]}>
                                            {t.name} {cnt}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>

                {/* 전체 펼치기/접기 */}
                <View style={styles.expandAllRow}>
                    <TouchableOpacity style={styles.expandAllBtn} onPress={toggleAll}>
                        {expandedKeys.size > 0
                            ? <FoldVertical size={12} color="#475569" />
                            : <UnfoldVertical size={12} color="#475569" />}
                        <Text style={styles.expandAllText}>
                            {expandedKeys.size > 0 ? '모두 접기' : '모두 펼치기'}
                        </Text>
                    </TouchableOpacity>
                    <Text style={styles.expandAllHint}>
                        {expandedKeys.size > 0 ? `${expandedKeys.size}개 펼침` : '모두 접힘'}
                    </Text>
                </View>

                {/* Quick Task별 진행바 — 0대도 표시(희미)해서 어떤 사이클이 있는지 보임 */}
                <View style={styles.progressSection}>
                    {QUICK_TASKS.map(t => {
                        const cnt = stats.perTask[t.id] || 0;
                        const widthPct = stats.maxPerTask > 0 ? (cnt / stats.maxPerTask) * 100 : 0;
                        const dim = cnt === 0;
                        return (
                            <View key={t.id} style={[styles.progressRow, dim && { opacity: 0.45 }]}>
                                <Text style={styles.progressEmoji}>{t.emoji}</Text>
                                <Text style={styles.progressName} numberOfLines={1}>{t.name}</Text>
                                <View style={styles.progressBarTrack}>
                                    <View style={[styles.progressBarFill, { width: `${widthPct}%`, backgroundColor: t.color }]} />
                                </View>
                                <Text style={[styles.progressCount, { color: t.color }]}>{cnt}</Text>
                            </View>
                        );
                    })}
                    {Object.values(stats.perTask).filter(n => n > 0).length < QUICK_TASKS.length && (
                        <Text style={styles.progressHint}>
                            💡 0대인 사이클은 정기 초기화로 마킹해야 큐에 올라와요.
                        </Text>
                    )}
                </View>

                {/* 위치 4단계 트리 자산 테이블 */}
                <ScrollView style={styles.tableScroll} contentContainerStyle={styles.tableContent}>
                    {tree.length === 0 ? (
                        <View style={styles.emptyBox}>
                            <Text style={styles.emptyText}>
                                {allRows.length === 0
                                    ? '현재 정기 업무에 해당하는 기기가 없어요.'
                                    : '필터 조건에 맞는 기기가 없어요.'}
                            </Text>
                        </View>
                    ) : (
                        tree.map(n => renderNode(n, 0))
                    )}
                </ScrollView>

                {/* [브리핑] 방문 동선 브리핑 오버레이 */}
                <Modal visible={briefingText !== null} animationType="slide" presentationStyle="pageSheet">
                    <View style={styles.container}>
                        <View style={styles.header}>
                            <View>
                                <Text style={styles.title}>방문 동선 브리핑</Text>
                                <Text style={styles.subtitle}>동선 순서대로 · 복사해서 AI/메모에 활용</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                <TouchableOpacity style={styles.briefingBtn} onPress={copyBriefing}>
                                    <Copy size={14} color="#4338ca" />
                                    <Text style={styles.briefingBtnText}>{copied ? '복사됨 ✓' : '복사'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setBriefingText(null)}>
                                    <X size={24} color="#6b7280" />
                                </TouchableOpacity>
                            </View>
                        </View>
                        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                            <Text selectable style={styles.briefingBody}>{briefingText}</Text>
                        </ScrollView>
                    </View>
                </Modal>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    briefingBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: '#e0e7ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    briefingBtnText: { fontSize: 12, fontWeight: '700', color: '#4338ca' },
    briefingBody: {
        fontSize: 13,
        lineHeight: 21,
        color: '#1f2937',
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
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
    progressHint: {
        fontSize: 10,
        color: '#94a3b8',
        marginTop: 6,
        paddingHorizontal: 4,
        lineHeight: 14,
    },

    tableScroll: { flex: 1 },
    tableContent: { padding: 10, gap: 10 },
    emptyBox: { padding: 40, alignItems: 'center' },
    emptyText: { fontSize: 13, color: '#94a3b8' },

    expandAllRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    expandAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        backgroundColor: '#f1f5f9',
    },
    expandAllText: { fontSize: 11, color: '#475569', fontWeight: '700' },
    expandAllHint: { fontSize: 11, color: '#94a3b8' },

    nodeBlock: { marginBottom: 4 },
    nodeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
    },
    nodeHeaderSite: { backgroundColor: '#e0e7ff' },
    nodeHeaderBuilding: { backgroundColor: '#eef2ff' },
    nodeHeaderFloor: { backgroundColor: '#f5f3ff' },
    nodeHeaderRoom: { backgroundColor: '#f8fafc' },
    nodeLabel: { fontSize: 12, fontWeight: '700', color: '#1f2937', flex: 1 },
    nodeCount: {
        fontSize: 10,
        fontWeight: '700',
        color: '#6366f1',
        backgroundColor: '#ffffff',
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 8,
    },
    nodeRows: { paddingLeft: 16, paddingTop: 4 },
    tableRow: {
        // 모바일 친화: 자산명 위, 칩들 아래로 세로 배치 → 좁은 화면에서도 안 잘림
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#f8fafc',
    },
    rowNameCell: {},
    rowName: { fontSize: 13, fontWeight: '700', color: '#1f2937' },
    rowRoom: { fontSize: 11, color: '#64748b', marginTop: 2 },
    rowTaskCell: { gap: 6 },
    rowTaskChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingLeft: 8,
        paddingRight: 4,
        paddingVertical: 4,
        borderRadius: 14,
        alignSelf: 'flex-start',
        maxWidth: '100%',
    },
    rowTaskChipEmoji: { fontSize: 12 },
    rowTaskChipName: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
    rowTaskDoneBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 10,
        marginLeft: 2,
        flexShrink: 0,
    },
    rowTaskDoneText: { color: '#ffffff', fontSize: 9, fontWeight: '800' },
    rowHistory: { fontSize: 10, color: '#94a3b8', fontStyle: 'italic', marginTop: 2 },
});
