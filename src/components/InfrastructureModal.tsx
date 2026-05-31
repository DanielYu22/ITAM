/**
 * InfrastructureModal — 인프라(사이트 → 건물 → 층 → 공간) 트리
 *
 * Phase 2: 노드 클릭 → 편집 다이얼로그. 수동 추가/삭제. 실험실은 여기서
 * 레이아웃 편집까지 진입. (이제 별도의 '레이아웃' 메뉴는 제거됨)
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
    TextInput,
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
    Plus,
    Pencil,
    Map as MapIcon,
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
    RoomType,
    ROOM_TYPE_EMOJI,
} from '../lib/infrastructure';
import { RoomEditDialog } from './RoomEditDialog';

interface Props {
    visible: boolean;
    onClose: () => void;
    data: InfrastructureData;
    assets: Asset[];
    effectiveSites?: SiteDef[];
    onSave: (next: InfrastructureData) => Promise<void>;
    /** 실험실에서 레이아웃 편집 진입 — App.tsx가 모달 전환 처리 */
    onOpenLayout?: (building: string, floor: string, room: string) => void;
}

type AddTarget =
    | { kind: 'building'; siteId: SiteId }
    | { kind: 'floor'; building: string }
    | { kind: 'room'; building: string; floor: string };

export const InfrastructureModal: React.FC<Props> = ({
    visible,
    onClose,
    data,
    assets,
    effectiveSites,
    onSave,
    onOpenLayout,
}) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [editingRoom, setEditingRoom] = useState<{
        room: RoomInfo;
        building: string;
        floor: string;
    } | null>(null);
    const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
    const [addName, setAddName] = useState('');
    const [addType, setAddType] = useState<RoomType>('lab');

    const summary = useMemo(() => summarizeInfrastructure(data), [data]);
    const grouped = useMemo(() => groupBuildingsBySite(data), [data]);

    const toggle = (key: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const allKeys = useMemo(() => {
        const keys: string[] = [];
        for (const b of data.buildings) {
            keys.push(`b:${b.name}`);
            for (const f of b.floors) keys.push(`f:${b.name}/${f.name}`);
        }
        return keys;
    }, [data]);

    const toggleAll = () => {
        if (expanded.size > 0) setExpanded(new Set());
        else setExpanded(new Set(allKeys));
    };

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
                `${merged.buildings.length}개 건물 · ${merged.buildings.reduce((a, b) => a + b.floors.length, 0)}개 층 · ${merged.buildings.reduce((a, b) => a + b.floors.reduce((c, f) => c + f.rooms.length, 0), 0)}개 공간 등록.`
            );
        } catch (e) {
            Alert.alert('오류', '저장 실패. 잠시 후 다시 시도하세요.');
        } finally {
            setSaving(false);
        }
    }, [assets, effectiveSites, data, onSave]);

    // ── 노드 편집/저장 헬퍼 ──────────────────────────────────
    const updateRoom = useCallback(async (
        buildingName: string,
        floorName: string,
        oldRoomName: string,
        next: RoomInfo,
    ) => {
        const cloned: InfrastructureData = {
            ...data,
            buildings: data.buildings.map(b => {
                if (b.name !== buildingName) return b;
                return {
                    ...b,
                    floors: b.floors.map(f => {
                        if (f.name !== floorName) return f;
                        return {
                            ...f,
                            rooms: f.rooms.map(r => r.name === oldRoomName ? next : r),
                        };
                    }),
                };
            }),
            updatedAt: new Date().toISOString(),
        };
        await onSave(cloned);
    }, [data, onSave]);

    const deleteRoom = useCallback(async (
        buildingName: string,
        floorName: string,
        roomName: string,
    ) => {
        const cloned: InfrastructureData = {
            ...data,
            buildings: data.buildings.map(b => {
                if (b.name !== buildingName) return b;
                return {
                    ...b,
                    floors: b.floors.map(f => {
                        if (f.name !== floorName) return f;
                        return { ...f, rooms: f.rooms.filter(r => r.name !== roomName) };
                    }),
                };
            }),
            updatedAt: new Date().toISOString(),
        };
        await onSave(cloned);
    }, [data, onSave]);

    const openAdd = (target: AddTarget) => {
        setAddTarget(target);
        setAddName('');
        setAddType('lab');
    };

    const handleAdd = useCallback(async () => {
        if (!addTarget) return;
        const name = addName.trim();
        if (!name) { Alert.alert('이름 필수', '이름을 입력해 주세요.'); return; }

        let next: InfrastructureData = { ...data, updatedAt: new Date().toISOString() };

        if (addTarget.kind === 'building') {
            if (data.buildings.some(b => b.name === name)) {
                Alert.alert('중복', '같은 이름의 건물이 이미 있어요.');
                return;
            }
            next = {
                ...next,
                buildings: [
                    ...data.buildings,
                    { name, siteId: addTarget.siteId, floors: [] },
                ],
            };
        } else if (addTarget.kind === 'floor') {
            const b = data.buildings.find(x => x.name === addTarget.building);
            if (!b) return;
            if (b.floors.some(f => f.name === name)) {
                Alert.alert('중복', '같은 이름의 층이 이미 있어요.');
                return;
            }
            next = {
                ...next,
                buildings: data.buildings.map(b2 => {
                    if (b2.name !== addTarget.building) return b2;
                    return { ...b2, floors: [...b2.floors, { name, rooms: [] }] };
                }),
            };
        } else if (addTarget.kind === 'room') {
            const b = data.buildings.find(x => x.name === addTarget.building);
            const f = b?.floors.find(f => f.name === addTarget.floor);
            if (!f) return;
            if (f.rooms.some(r => r.name === name)) {
                Alert.alert('중복', '같은 이름의 공간이 이미 있어요.');
                return;
            }
            next = {
                ...next,
                buildings: data.buildings.map(b2 => {
                    if (b2.name !== addTarget.building) return b2;
                    return {
                        ...b2,
                        floors: b2.floors.map(f2 => {
                            if (f2.name !== addTarget.floor) return f2;
                            return { ...f2, rooms: [...f2.rooms, { name, type: addType }] };
                        }),
                    };
                }),
            };
        }
        try {
            await onSave(next);
            // 펼침 유지 & 새 노드 펼치기
            if (addTarget.kind === 'building') {
                setExpanded(prev => new Set([...prev, `b:${name}`]));
            } else if (addTarget.kind === 'floor') {
                setExpanded(prev => new Set([...prev, `b:${addTarget.building}`, `f:${addTarget.building}/${name}`]));
            }
            setAddTarget(null);
        } catch (e) {
            Alert.alert('오류', '저장 실패. 잠시 후 다시 시도하세요.');
        }
    }, [addTarget, addName, addType, data, onSave]);

    return (
        <>
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title}>인프라</Text>
                        <Text style={styles.subtitle}>
                            사이트 · 건물 · 층 · 공간
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
                            const sum = summary[siteDef.id];
                            // 빈 사이트라도 '건물 추가' 버튼은 보이게
                            return (
                                <View key={siteDef.id} style={styles.siteBlock}>
                                    <View style={[styles.siteHeader, { backgroundColor: siteDef.bgColor }]}>
                                        <View style={[styles.siteDot, { backgroundColor: siteDef.color }]} />
                                        <Text style={[styles.siteName, { color: siteDef.color }]}>
                                            {siteDef.emoji ? `${siteDef.emoji} ` : ''}{siteDef.name}
                                        </Text>
                                        <Text style={styles.siteSummary}>
                                            건물 {sum.buildings} · 층 {sum.floors} · 공간 {sum.rooms}
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.addInlineBtn}
                                            onPress={() => openAdd({ kind: 'building', siteId: siteDef.id })}
                                        >
                                            <Plus size={11} color={siteDef.color} />
                                            <Text style={[styles.addInlineText, { color: siteDef.color }]}>건물</Text>
                                        </TouchableOpacity>
                                    </View>
                                    {buildings.map(b => (
                                        <BuildingNode
                                            key={b.name}
                                            building={b}
                                            expanded={expanded}
                                            onToggle={toggle}
                                            siteColor={siteDef.color}
                                            onAddFloor={() => openAdd({ kind: 'floor', building: b.name })}
                                            onAddRoom={(floor) => openAdd({ kind: 'room', building: b.name, floor })}
                                            onEditRoom={(floor, room) => setEditingRoom({ building: b.name, floor, room })}
                                        />
                                    ))}
                                </View>
                            );
                        })
                    )}
                </ScrollView>
            </View>
        </Modal>

        {/* 공간 편집 다이얼로그 */}
        {editingRoom && (
            <RoomEditDialog
                visible
                onClose={() => setEditingRoom(null)}
                room={editingRoom.room}
                building={editingRoom.building}
                floor={editingRoom.floor}
                onSave={async (next) => {
                    await updateRoom(editingRoom.building, editingRoom.floor, editingRoom.room.name, next);
                }}
                onDelete={async () => {
                    await deleteRoom(editingRoom.building, editingRoom.floor, editingRoom.room.name);
                }}
                onOpenLayout={onOpenLayout ? () => {
                    const er = editingRoom;
                    setEditingRoom(null);
                    onOpenLayout(er.building, er.floor, er.room.name);
                } : undefined}
            />
        )}

        {/* 추가 다이얼로그 */}
        <Modal visible={!!addTarget} transparent animationType="fade" onRequestClose={() => setAddTarget(null)}>
            <View style={styles.addOverlay}>
                <View style={styles.addCard}>
                    <Text style={styles.addTitle}>
                        {addTarget?.kind === 'building' && '건물 추가'}
                        {addTarget?.kind === 'floor' && `층 추가 — ${addTarget.building}`}
                        {addTarget?.kind === 'room' && `공간 추가 — ${addTarget.building} ${addTarget.floor}`}
                    </Text>
                    <TextInput
                        style={styles.addInput}
                        value={addName}
                        onChangeText={setAddName}
                        placeholder={
                            addTarget?.kind === 'building' ? '예: 바이오센터' :
                            addTarget?.kind === 'floor' ? '예: 5층' :
                            '예: 분석실 A'
                        }
                        placeholderTextColor="#94a3b8"
                        autoFocus
                    />
                    {addTarget?.kind === 'room' && (
                        <View style={styles.addTypeRow}>
                            {(['lab', 'server-room', 'office', 'other'] as RoomType[]).map(t => {
                                const active = addType === t;
                                return (
                                    <TouchableOpacity
                                        key={t}
                                        style={[styles.addTypeChip, active && styles.addTypeChipActive]}
                                        onPress={() => setAddType(t)}
                                    >
                                        <Text style={styles.addTypeEmoji}>{ROOM_TYPE_EMOJI[t]}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    )}
                    <View style={styles.addFooter}>
                        <TouchableOpacity style={styles.addCancel} onPress={() => setAddTarget(null)}>
                            <Text style={styles.addCancelText}>취소</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.addConfirm} onPress={handleAdd}>
                            <Text style={styles.addConfirmText}>추가</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
        </>
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
    onAddFloor: () => void;
    onAddRoom: (floor: string) => void;
    onEditRoom: (floor: string, room: RoomInfo) => void;
}> = ({ building, expanded, onToggle, siteColor, onAddFloor, onAddRoom, onEditRoom }) => {
    const key = `b:${building.name}`;
    const open = expanded.has(key);
    const roomCount = building.floors.reduce((a, f) => a + f.rooms.length, 0);
    return (
        <View style={styles.buildingBlock}>
            <View style={styles.buildingHeader}>
                <TouchableOpacity
                    style={styles.buildingHeaderTap}
                    onPress={() => onToggle(key)}
                >
                    {open
                        ? <ChevronDown size={13} color="#475569" />
                        : <ChevronRight size={13} color="#475569" />}
                    <Building2 size={13} color={siteColor} />
                    <Text style={styles.buildingName}>{building.name}</Text>
                    <Text style={styles.buildingCount}>
                        {building.floors.length}개 층 · {roomCount}개 공간
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.miniBtn} onPress={onAddFloor}>
                    <Plus size={11} color="#475569" />
                    <Text style={styles.miniBtnText}>층</Text>
                </TouchableOpacity>
            </View>
            {open && building.floors.map(f => (
                <FloorNode
                    key={f.name}
                    floor={f}
                    buildingName={building.name}
                    expanded={expanded}
                    onToggle={onToggle}
                    onAddRoom={() => onAddRoom(f.name)}
                    onEditRoom={(room) => onEditRoom(f.name, room)}
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
    onAddRoom: () => void;
    onEditRoom: (room: RoomInfo) => void;
}> = ({ floor, buildingName, expanded, onToggle, onAddRoom, onEditRoom }) => {
    const key = `f:${buildingName}/${floor.name}`;
    const open = expanded.has(key);
    return (
        <View style={styles.floorBlock}>
            <View style={styles.floorHeader}>
                <TouchableOpacity
                    style={styles.floorHeaderTap}
                    onPress={() => onToggle(key)}
                >
                    {open
                        ? <ChevronDown size={11} color="#64748b" />
                        : <ChevronRight size={11} color="#64748b" />}
                    <Text style={styles.floorName}>{floor.name}</Text>
                    <Text style={styles.floorCount}>{floor.rooms.length}개 공간</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.miniBtn} onPress={onAddRoom}>
                    <Plus size={11} color="#475569" />
                    <Text style={styles.miniBtnText}>공간</Text>
                </TouchableOpacity>
            </View>
            {open && floor.rooms.map(r => (
                <RoomNode
                    key={r.name}
                    room={r}
                    onEdit={() => onEditRoom(r)}
                />
            ))}
        </View>
    );
};

const RoomNode: React.FC<{ room: RoomInfo; onEdit: () => void }> = ({ room, onEdit }) => {
    const type = room.type || 'lab';
    const emoji = ROOM_TYPE_EMOJI[type];
    return (
        <TouchableOpacity style={styles.roomRow} onPress={onEdit} activeOpacity={0.6}>
            <Text style={styles.roomEmoji}>{emoji}</Text>
            <Text style={styles.roomName}>{room.name}</Text>
            {!!room.assetCount && (
                <Text style={styles.roomMeta}>{room.assetCount}대</Text>
            )}
            {!!room.features?.length && (
                <Text style={styles.roomMeta} numberOfLines={1}>{room.features.join(' · ')}</Text>
            )}
            <Pencil size={10} color="#cbd5e1" />
        </TouchableOpacity>
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

    emptyState: { alignItems: 'center', padding: 40, gap: 8 },
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
    siteName: { fontSize: 14, fontWeight: '800' },
    siteSummary: { fontSize: 10, color: '#475569', fontWeight: '600', flex: 1, textAlign: 'right' },
    addInlineBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.7)',
    },
    addInlineText: { fontSize: 10, fontWeight: '700' },

    buildingBlock: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
    buildingHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 6,
    },
    buildingHeaderTap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    buildingName: { fontSize: 13, fontWeight: '700', color: '#1f2937', flex: 1 },
    buildingCount: { fontSize: 10, color: '#64748b' },
    miniBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: '#f1f5f9',
    },
    miniBtnText: { fontSize: 10, color: '#475569', fontWeight: '700' },

    floorBlock: { marginLeft: 14, borderTopWidth: 1, borderTopColor: '#f8fafc' },
    floorHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        gap: 6,
    },
    floorHeaderTap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    floorName: { fontSize: 12, fontWeight: '600', color: '#475569', flex: 1 },
    floorCount: { fontSize: 10, color: '#94a3b8' },

    roomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 22,
        paddingVertical: 6,
    },
    roomEmoji: { fontSize: 11 },
    roomName: { fontSize: 12, color: '#1f2937', flex: 1 },
    roomMeta: { fontSize: 10, color: '#94a3b8', maxWidth: 100 },

    // 추가 다이얼로그
    addOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    addCard: {
        width: '100%',
        maxWidth: 380,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 16,
    },
    addTitle: { fontSize: 14, fontWeight: '800', color: '#1f2937', marginBottom: 10 },
    addInput: {
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        color: '#1f2937',
    },
    addTypeRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
    addTypeChip: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        backgroundColor: '#f1f5f9',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    addTypeChipActive: { backgroundColor: '#e0f2fe', borderColor: '#0369a1' },
    addTypeEmoji: { fontSize: 16 },

    addFooter: { flexDirection: 'row', gap: 8, marginTop: 14 },
    addCancel: {
        flex: 1,
        padding: 10,
        borderRadius: 10,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
    },
    addCancelText: { fontSize: 13, color: '#475569', fontWeight: '700' },
    addConfirm: {
        flex: 1,
        padding: 10,
        borderRadius: 10,
        backgroundColor: '#0369a1',
        alignItems: 'center',
    },
    addConfirmText: { fontSize: 13, color: '#ffffff', fontWeight: '800' },
});
