/**
 * LayoutRoomPickerModal — 어느 연구실의 레이아웃을 편집할지 선택
 *
 * 건물·층·연구실 드릴다운. 자산 분포에서 자동으로 후보를 추출하므로
 * 사용자가 직접 새 위치를 칠 필요는 거의 없습니다.
 */

import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    TextInput,
} from 'react-native';
import { X, Search, ChevronRight, MapPin, Building2 } from 'lucide-react-native';
import { Asset } from '../lib/notion';
import { FLOOR_PLAN_ROOM } from '../lib/layouts';

interface Props {
    visible: boolean;
    onClose: () => void;
    assets: Asset[];
    onSelect: (building: string, floor: string, room: string) => void;
    /** 이미 레이아웃이 있는 연구실은 ✓ 표시 */
    existingRoomKeys: Set<string>;
    titleField: string;
}

export const LayoutRoomPickerModal: React.FC<Props> = ({
    visible,
    onClose,
    assets,
    onSelect,
    existingRoomKeys,
    titleField,
}) => {
    const [search, setSearch] = useState('');

    // 자산에서 건물·층·연구실 트리 추출
    const tree = useMemo(() => {
        const map = new Map<string, Map<string, Map<string, number>>>();
        for (const a of assets) {
            const v = a.values as any;
            const b = String(v['L)건물'] ?? '').trim();
            const f = String(v['L)층'] ?? '').trim();
            const r = String(v['L)연구실'] ?? '').trim();
            if (!b || !f || !r) continue;
            if (!map.has(b)) map.set(b, new Map());
            const bm = map.get(b)!;
            if (!bm.has(f)) bm.set(f, new Map());
            const fm = bm.get(f)!;
            fm.set(r, (fm.get(r) || 0) + 1);
        }
        // 정렬
        const sorted: Array<{
            building: string;
            floors: Array<{
                floor: string;
                rooms: Array<{ room: string; count: number }>;
            }>;
        }> = [];
        const krSort = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true });
        for (const b of Array.from(map.keys()).sort(krSort)) {
            const floors: any[] = [];
            const bm = map.get(b)!;
            for (const f of Array.from(bm.keys()).sort(krSort)) {
                const rooms: any[] = [];
                const fm = bm.get(f)!;
                for (const r of Array.from(fm.keys()).sort(krSort)) {
                    rooms.push({ room: r, count: fm.get(r)! });
                }
                floors.push({ floor: f, rooms });
            }
            sorted.push({ building: b, floors });
        }
        return sorted;
    }, [assets]);

    const filteredTree = useMemo(() => {
        if (!search.trim()) return tree;
        const q = search.toLowerCase();
        return tree
            .map(b => ({
                ...b,
                floors: b.floors
                    .map(f => ({
                        ...f,
                        rooms: f.rooms.filter(r =>
                            `${b.building} ${f.floor} ${r.room}`.toLowerCase().includes(q)
                        ),
                    }))
                    .filter(f => f.rooms.length > 0),
            }))
            .filter(b => b.floors.length > 0);
    }, [tree, search]);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title}>레이아웃 편집할 연구실</Text>
                        <Text style={styles.subtitle}>건물·층·연구실 선택</Text>
                    </View>
                    <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
                        <X size={20} color="#475569" />
                    </TouchableOpacity>
                </View>

                <View style={styles.searchRow}>
                    <Search size={14} color="#94a3b8" />
                    <TextInput
                        style={styles.searchInput}
                        value={search}
                        onChangeText={setSearch}
                        placeholder="건물 / 층 / 연구실 검색"
                        placeholderTextColor="#94a3b8"
                    />
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 10 }}>
                    {filteredTree.length === 0 ? (
                        <Text style={styles.emptyText}>매칭되는 연구실이 없어요.</Text>
                    ) : (
                        filteredTree.map(b => (
                            <View key={b.building} style={styles.buildingBlock}>
                                <View style={styles.buildingHeader}>
                                    <MapPin size={12} color="#6366f1" />
                                    <Text style={styles.buildingName}>{b.building}</Text>
                                </View>
                                {b.floors.map(f => (
                                    <View key={`${b.building}/${f.floor}`} style={styles.floorBlock}>
                                        <Text style={styles.floorName}>{f.floor}</Text>
                                        {(() => {
                                            const floorKey = `${b.building}||${f.floor}||${FLOOR_PLAN_ROOM}`;
                                            const floorHas = existingRoomKeys.has(floorKey);
                                            return (
                                                <TouchableOpacity
                                                    style={styles.floorPlanRow}
                                                    onPress={() => onSelect(b.building, f.floor, FLOOR_PLAN_ROOM)}
                                                    activeOpacity={0.7}
                                                >
                                                    <Building2 size={13} color="#6366f1" />
                                                    <Text style={styles.floorPlanName}>이 층 평면도 (실험실 배치·동선)</Text>
                                                    {floorHas && <Text style={styles.savedBadge}>✓ 저장됨</Text>}
                                                    <ChevronRight size={14} color="#94a3b8" />
                                                </TouchableOpacity>
                                            );
                                        })()}
                                        {f.rooms.map(r => {
                                            const key = `${b.building}||${f.floor}||${r.room}`;
                                            const has = existingRoomKeys.has(key);
                                            return (
                                                <TouchableOpacity
                                                    key={key}
                                                    style={styles.roomRow}
                                                    onPress={() => onSelect(b.building, f.floor, r.room)}
                                                    activeOpacity={0.7}
                                                >
                                                    <Text style={styles.roomName}>{r.room}</Text>
                                                    <Text style={styles.roomCount}>{r.count}대</Text>
                                                    {has && <Text style={styles.savedBadge}>✓ 저장됨</Text>}
                                                    <ChevronRight size={14} color="#94a3b8" />
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                ))}
                            </View>
                        ))
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f1f5f9' },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        padding: 14,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: 16, fontWeight: 'bold', color: '#1f2937' },
    subtitle: { fontSize: 11, color: '#64748b', marginTop: 2 },
    headerBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        margin: 12,
        marginBottom: 0,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    searchInput: { flex: 1, fontSize: 13, color: '#1f2937', padding: 0 },
    emptyText: { fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingVertical: 40 },
    buildingBlock: {
        backgroundColor: '#ffffff',
        borderRadius: 10,
        padding: 10,
        gap: 6,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    buildingHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    buildingName: { fontSize: 13, fontWeight: '800', color: '#4338ca' },
    floorBlock: {
        marginLeft: 6,
        paddingLeft: 8,
        borderLeftWidth: 2,
        borderLeftColor: '#e0e7ff',
        gap: 4,
    },
    floorName: { fontSize: 11, fontWeight: '700', color: '#475569', marginVertical: 4 },
    roomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: '#f8fafc',
        borderRadius: 8,
    },
    roomName: { flex: 1, fontSize: 12, fontWeight: '600', color: '#1f2937' },
    floorPlanRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: '#eef2ff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#c7d2fe',
    },
    floorPlanName: { flex: 1, fontSize: 12, fontWeight: '700', color: '#4338ca' },
    roomCount: { fontSize: 10, color: '#64748b' },
    savedBadge: { fontSize: 10, fontWeight: '700', color: '#16a34a' },
});
