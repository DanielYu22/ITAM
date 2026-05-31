/**
 * InfrastructureModal — 인프라(사이트 → 건물 → 층 → 실험실) 트리 조회
 *
 * Phase 1: 트리 펼침/접힘 + 자산에서 자동 시드 (기존 메모/특징은 보존).
 * 향후 Phase 2 에서 노드 클릭 시 편집 다이얼로그 추가 예정.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    Alert,
} from 'react-native';
import {
    X,
    Building2,
    Database,
    ChevronDown,
    ChevronRight,
    RefreshCw,
    MapPin,
    FoldVertical,
    UnfoldVertical,
} from 'lucide-react-native';
import { Asset } from '../lib/notion';
import { SiteDef, SiteId, SITES_DEFAULTS } from '../lib/sites';
import {
    InfrastructureData,
    seedFromAssets,
    mergeSeedIntoInfrastructure,
    summarizeInfrastructure,
    groupBuildingsBySite,
    BuildingInfo,
    FloorInfo,
    RoomInfo,
} from '../lib/infrastructure';

interface Props {
    visible: boolean;
    onClose: () => void;
    data: InfrastructureData;
    assets: Asset[];
    effectiveSites?: SiteDef[];
    onSave: (next: InfrastructureData) => Promise<void>;
}

export const InfrastructureModal: React.FC<Props> = ({
    visible,
    onClose,
    data,
    assets,
    effectiveSites,
    onSave,
}) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);

    const summary = useMemo(() => summarizeInfrastructure(data), [data]);
    const grouped = useMemo(() => groupBuildingsBySite(data), [data]);

    // 펼침 토글
    const toggle = (key: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // 모든 노드 key 수집
    const allKeys = useMemo(() => {
        const keys: string[] = [];
        for (const b of data.buildings) {
            keys.push(`b:${b.name}`);
            for (const f of b.floors) {
                keys.push(`f:${b.name}/${f.name}`);
            }
        }
        return keys;
    }, [data]);

    const allExpanded = expanded.size === allKeys.length && expanded.size > 0;
    const toggleAll = () => {
        if (expanded.size > 0) {
            setExpanded(new Set());
        } else {
            setExpanded(new Set(allKeys));
        }
    };

    // 자산에서 자동 시드 (기존 노드의 notes/features 는 보존)
    const handleSeed = useCallback(async () => {
        const seeded = seedFromAssets(assets, effectiveSites);
        const merged = data.buildings.length === 0
            ? seeded
            : mergeSeedIntoInfrastructure(data, seeded);
        setSaving(true);
        try {
            await onSave(merged);
            Alert.alert(
                '자동 시드 완료',
                `${merged.buildings.length}개 건물 · ${merged.buildings.reduce((a, b) => a + b.floors.length, 0)}개 층 · ${merged.buildings.reduce((a, b) => a + b.floors.reduce((c, f) => c + f.rooms.length, 0), 0)}개 실험실 등록.`
            );
        } catch (e) {
            Alert.alert('오류', '저장 실패. 잠시 후 다시 시도하세요.');
        } finally {
            setSaving(false);
        }
    }, [assets, effectiveSites, data, onSave]);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>인프라</Text>
                        <Text style={styles.subtitle}>
                            사이트 · 건물 · 층 · 실험실 트리
                            {data.lastSeededAt && ` · 최근 시드 ${new Date(data.lastSeededAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit' })}`}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                        <X size={20} color="#475569" />
                    </TouchableOpacity>
                </View>

                {/* 컨트롤바 */}
                <View style={styles.controls}>
                    <TouchableOpacity
                        style={[styles.seedBtn, saving && { opacity: 0.6 }]}
                        onPress={handleSeed}
                        disabled={saving}
                    >
                        <RefreshCw size={13} color="#ffffff" />
                        <Text style={styles.seedBtnText}>
                            {saving ? '시드 중…' : '자산에서 자동 시드'}
                        </Text>
                    </TouchableOpacity>
                    {data.buildings.length > 0 && (
                        <TouchableOpacity style={styles.expandBtn} onPress={toggleAll}>
                            {expanded.size > 0
                                ? <FoldVertical size={12} color="#475569" />
                                : <UnfoldVertical size={12} color="#475569" />}
                            <Text style={styles.expandBtnText}>
                                {expanded.size > 0 ? '모두 접기' : '모두 펼치기'}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    {data.buildings.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Database size={28} color="#cbd5e1" />
                            <Text style={styles.emptyTitle}>아직 등록된 인프라가 없어요</Text>
                            <Text style={styles.emptyDesc}>
                                위의 '자산에서 자동 시드'를 누르면 현재 자산 DB의 L)건물·L)층·L)연구실
                                컬럼에서 사이트별 트리를 자동으로 만들어요. 메모와 특징은 그 다음에 추가할 수 있어요.
                            </Text>
                        </View>
                    ) : (
                        SITES_DEFAULTS.filter(s => s.id !== 'all').map(siteDef => {
                            const buildings = grouped[siteDef.id] || [];
                            if (buildings.length === 0) return null;
                            const sum = summary[siteDef.id];
                            return (
                                <View key={siteDef.id} style={styles.siteBlock}>
                                    <View style={[styles.siteHeader, { backgroundColor: siteDef.bgColor }]}>
                                        <View style={[styles.siteDot, { backgroundColor: siteDef.color }]} />
                                        <Text style={[styles.siteName, { color: siteDef.color }]}>
                                            {siteDef.emoji ? `${siteDef.emoji} ` : ''}{siteDef.name}
                                        </Text>
                                        <Text style={styles.siteSummary}>
                                            건물 {sum.buildings} · 층 {sum.floors} · 실험실 {sum.rooms}
                                        </Text>
                                    </View>
                                    {buildings.map(b => (
                                        <BuildingNode
                                            key={b.name}
                                            building={b}
                                            expanded={expanded}
                                            onToggle={toggle}
                                            siteColor={siteDef.color}
                                        />
                                    ))}
                                </View>
                            );
                        })
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
};

// ---------------------------------------------------------------------------
// 트리 노드들
// ---------------------------------------------------------------------------

const BuildingNode: React.FC<{
    building: BuildingInfo;
    expanded: Set<string>;
    onToggle: (key: string) => void;
    siteColor: string;
}> = ({ building, expanded, onToggle, siteColor }) => {
    const key = `b:${building.name}`;
    const open = expanded.has(key);
    const roomCount = building.floors.reduce((a, f) => a + f.rooms.length, 0);
    return (
        <View style={styles.buildingBlock}>
            <TouchableOpacity style={styles.buildingHeader} onPress={() => onToggle(key)}>
                {open
                    ? <ChevronDown size={13} color="#475569" />
                    : <ChevronRight size={13} color="#475569" />}
                <Building2 size={13} color={siteColor} />
                <Text style={styles.buildingName}>{building.name}</Text>
                <Text style={styles.buildingCount}>
                    {building.floors.length}개 층 · {roomCount}개 실험실
                </Text>
            </TouchableOpacity>
            {open && building.floors.map(f => (
                <FloorNode
                    key={f.name}
                    floor={f}
                    buildingName={building.name}
                    expanded={expanded}
                    onToggle={onToggle}
                />
            ))}
        </View>
    );
};

const FloorNode: React.FC<{
    floor: FloorInfo;
    buildingName: string;
    expanded: Set<string>;
    onToggle: (key: string) => void;
}> = ({ floor, buildingName, expanded, onToggle }) => {
    const key = `f:${buildingName}/${floor.name}`;
    const open = expanded.has(key);
    return (
        <View style={styles.floorBlock}>
            <TouchableOpacity style={styles.floorHeader} onPress={() => onToggle(key)}>
                {open
                    ? <ChevronDown size={11} color="#64748b" />
                    : <ChevronRight size={11} color="#64748b" />}
                <Text style={styles.floorName}>{floor.name}</Text>
                <Text style={styles.floorCount}>{floor.rooms.length}개 실험실</Text>
            </TouchableOpacity>
            {open && floor.rooms.map(r => (
                <RoomNode key={r.name} room={r} />
            ))}
        </View>
    );
};

const RoomNode: React.FC<{ room: RoomInfo }> = ({ room }) => {
    return (
        <View style={styles.roomRow}>
            <MapPin size={10} color="#94a3b8" />
            <Text style={styles.roomName}>{room.name}</Text>
            {!!room.assetCount && (
                <Text style={styles.roomMeta}>{room.assetCount}대</Text>
            )}
            {!!room.features?.length && (
                <Text style={styles.roomMeta}>{room.features.join(' · ')}</Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f3f4f6' },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 14,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: 17, fontWeight: 'bold', color: '#1f2937' },
    subtitle: { fontSize: 11, color: '#6b7280', marginTop: 2 },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
    },

    controls: {
        flexDirection: 'row',
        gap: 8,
        padding: 12,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    seedBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#0369a1',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
    },
    seedBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
    expandBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: '#f1f5f9',
    },
    expandBtnText: { fontSize: 11, color: '#475569', fontWeight: '700' },

    body: { flex: 1 },
    bodyContent: { padding: 12, gap: 12 },

    emptyState: {
        alignItems: 'center',
        padding: 40,
        gap: 8,
    },
    emptyTitle: { fontSize: 14, color: '#475569', fontWeight: '700' },
    emptyDesc: { fontSize: 12, color: '#94a3b8', textAlign: 'center', lineHeight: 18 },

    siteBlock: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    siteHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    siteDot: { width: 8, height: 8, borderRadius: 4 },
    siteName: { fontSize: 14, fontWeight: '800', flex: 1 },
    siteSummary: { fontSize: 10, color: '#475569', fontWeight: '600' },

    buildingBlock: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
    buildingHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    buildingName: { fontSize: 13, fontWeight: '700', color: '#1f2937', flex: 1 },
    buildingCount: { fontSize: 10, color: '#64748b' },

    floorBlock: { marginLeft: 14, borderTopWidth: 1, borderTopColor: '#f8fafc' },
    floorHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    floorName: { fontSize: 12, fontWeight: '600', color: '#475569', flex: 1 },
    floorCount: { fontSize: 10, color: '#94a3b8' },

    roomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 22,
        paddingVertical: 4,
    },
    roomName: { fontSize: 12, color: '#1f2937', flex: 1 },
    roomMeta: { fontSize: 10, color: '#94a3b8' },
});
