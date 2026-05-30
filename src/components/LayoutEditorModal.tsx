/**
 * LayoutEditorModal — 연구실 평면도 편집기
 *
 * Phase A:
 *  - 캔버스에 벽 / 테이블 / 기기 객체 배치
 *  - 드래그로 이동, 탭으로 선택, 선택 시 회전 / 삭제 / 색상 변경
 *  - 자유 라벨 (벽/테이블) — 가구 이름이나 설명
 *  - 자산 객체는 그 연구실 자산 목록에서 선택
 *  - Notion 설정 페이지에 저장
 *
 * 캔버스는 가상 좌표(CANVAS_WIDTH×CANVAS_HEIGHT) 기반. 화면에 맞추기 위해
 * scale 계산해서 실 픽셀로 변환. 모바일에서도 한 화면에 들어옴.
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    TextInput,
    Alert,
    PanResponder,
    Dimensions,
} from 'react-native';
import { X, Save, Plus, Trash2, RotateCw, Square, Box, Cpu, Search } from 'lucide-react-native';
import { Asset } from '../lib/notion';
import {
    LayoutObject,
    LayoutObjectType,
    RoomLayout,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    emptyLayout,
    makeObject,
    DEFAULT_COLORS,
} from '../lib/layouts';

interface Props {
    visible: boolean;
    onClose: () => void;
    // 편집 대상 연구실
    building: string;
    floor: string;
    room: string;
    // 기존 레이아웃 (없으면 빈 캔버스로 시작)
    initialLayout: RoomLayout | null;
    // 그 연구실에 매칭되는 자산 목록 (기기 객체 추가용)
    roomAssets: Asset[];
    // 자산 타이틀 필드 이름 (보통 'Name')
    titleField: string;
    onSave: (layout: RoomLayout) => Promise<void>;
}

const COLOR_PALETTE = [
    '#475569', // 슬레이트
    '#dc2626', // 빨강
    '#f59e0b', // 주황
    '#16a34a', // 초록
    '#0284c7', // 파랑
    '#9333ea', // 보라
    '#f472b6', // 분홍
    '#1f2937', // 검정
];

export const LayoutEditorModal: React.FC<Props> = ({
    visible,
    onClose,
    building,
    floor,
    room,
    initialLayout,
    roomAssets,
    titleField,
    onSave,
}) => {
    const [layout, setLayout] = useState<RoomLayout>(() => initialLayout || emptyLayout());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showAssetPicker, setShowAssetPicker] = useState(false);
    const [assetSearch, setAssetSearch] = useState('');
    const [labelInput, setLabelInput] = useState('');
    const [saving, setSaving] = useState(false);

    // 모달 열릴 때마다 초기화
    useEffect(() => {
        if (visible) {
            setLayout(initialLayout || emptyLayout());
            setSelectedId(null);
            setShowAssetPicker(false);
            setAssetSearch('');
        }
    }, [visible, initialLayout]);

    // 캔버스 표시 크기 계산 — 가로 화면에 맞춤
    const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
    const canvasDisplayWidth = Math.min(screenWidth - 32, 720);
    const scale = canvasDisplayWidth / CANVAS_WIDTH;
    const canvasDisplayHeight = CANVAS_HEIGHT * scale;

    const selected = useMemo(
        () => layout.objects.find(o => o.id === selectedId) || null,
        [layout.objects, selectedId]
    );

    useEffect(() => {
        setLabelInput(selected?.label ?? '');
    }, [selected?.id, selected?.label]);

    // 자산 검색 결과
    const filteredAssets = useMemo(() => {
        const placedIds = new Set(layout.objects.filter(o => o.type === 'asset').map(o => o.assetId));
        const candidates = roomAssets.filter(a => !placedIds.has(a.id));
        if (!assetSearch.trim()) return candidates.slice(0, 30);
        const q = assetSearch.toLowerCase();
        return candidates
            .filter(a => String((a.values as any)[titleField] ?? '').toLowerCase().includes(q))
            .slice(0, 30);
    }, [roomAssets, layout.objects, assetSearch, titleField]);

    // ----- 객체 조작 -----
    const updateObject = useCallback((id: string, patch: Partial<LayoutObject>) => {
        setLayout(prev => ({
            ...prev,
            objects: prev.objects.map(o => (o.id === id ? { ...o, ...patch } : o)),
            updatedAt: new Date().toISOString(),
        }));
    }, []);

    const addObject = useCallback((type: LayoutObjectType, extra: Partial<LayoutObject> = {}) => {
        const obj = makeObject(type, extra);
        setLayout(prev => ({
            ...prev,
            objects: [...prev.objects, obj],
            updatedAt: new Date().toISOString(),
        }));
        setSelectedId(obj.id);
    }, []);

    const deleteSelected = useCallback(() => {
        if (!selectedId) return;
        setLayout(prev => ({
            ...prev,
            objects: prev.objects.filter(o => o.id !== selectedId),
            updatedAt: new Date().toISOString(),
        }));
        setSelectedId(null);
    }, [selectedId]);

    const rotateSelected = useCallback(() => {
        if (!selected) return;
        const next = ((selected.rotation || 0) + 90) % 360;
        updateObject(selected.id, { rotation: next });
    }, [selected, updateObject]);

    // ----- 자산 선택 → 기기 객체 추가 -----
    const addAssetObject = (asset: Asset) => {
        addObject('asset', {
            assetId: asset.id,
            label: String((asset.values as any)[titleField] ?? '(이름 없음)'),
        });
        setShowAssetPicker(false);
        setAssetSearch('');
    };

    // ----- 저장 -----
    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave({ ...layout, updatedAt: new Date().toISOString() });
            onClose();
        } catch (e) {
            Alert.alert('저장 실패', '잠시 후 다시 시도해 주세요.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
            <View style={styles.container}>
                {/* 헤더 */}
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title}>레이아웃 편집</Text>
                        <Text style={styles.subtitle}>
                            {building} · {floor} · {room}  ·  {layout.objects.length}개 객체
                        </Text>
                    </View>
                    <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
                        <X size={20} color="#475569" />
                    </TouchableOpacity>
                </View>

                {/* 도구바 (객체 추가) */}
                <View style={styles.toolbar}>
                    <TouchableOpacity
                        style={[styles.toolBtn, { backgroundColor: '#f1f5f9' }]}
                        onPress={() => addObject('wall')}
                    >
                        <Square size={14} color="#475569" />
                        <Text style={styles.toolBtnText}>벽</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.toolBtn, { backgroundColor: '#fef3c7' }]}
                        onPress={() => addObject('table')}
                    >
                        <Box size={14} color="#b45309" />
                        <Text style={[styles.toolBtnText, { color: '#b45309' }]}>테이블</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.toolBtn, { backgroundColor: '#e0e7ff' }]}
                        onPress={() => setShowAssetPicker(true)}
                    >
                        <Cpu size={14} color="#4338ca" />
                        <Text style={[styles.toolBtnText, { color: '#4338ca' }]}>기기</Text>
                    </TouchableOpacity>
                </View>

                {/* 캔버스 (외곽 스크롤로 큰 캔버스도 가능, 모바일은 한 화면) */}
                <ScrollView
                    style={styles.canvasScroll}
                    contentContainerStyle={styles.canvasScrollContent}
                    minimumZoomScale={0.5}
                    maximumZoomScale={2}
                    bouncesZoom
                >
                    <TouchableOpacity
                        activeOpacity={1}
                        style={[
                            styles.canvas,
                            { width: canvasDisplayWidth, height: canvasDisplayHeight },
                        ]}
                        onPress={() => setSelectedId(null)}
                    >
                        {/* 그리드 배경 */}
                        {Array.from({ length: 11 }).map((_, i) => (
                            <View
                                key={`vg-${i}`}
                                style={[
                                    styles.gridLine,
                                    {
                                        left: (canvasDisplayWidth / 10) * i,
                                        width: 1,
                                        height: '100%',
                                    },
                                ]}
                            />
                        ))}
                        {Array.from({ length: 9 }).map((_, i) => (
                            <View
                                key={`hg-${i}`}
                                style={[
                                    styles.gridLine,
                                    {
                                        top: (canvasDisplayHeight / 8) * i,
                                        height: 1,
                                        width: '100%',
                                    },
                                ]}
                            />
                        ))}

                        {/* 객체들 */}
                        {layout.objects.map(obj => (
                            <DraggableObject
                                key={obj.id}
                                obj={obj}
                                scale={scale}
                                selected={obj.id === selectedId}
                                onSelect={() => setSelectedId(obj.id)}
                                onMove={(dx, dy) => updateObject(obj.id, {
                                    x: Math.max(0, Math.min(CANVAS_WIDTH - obj.width, obj.x + dx)),
                                    y: Math.max(0, Math.min(CANVAS_HEIGHT - obj.height, obj.y + dy)),
                                })}
                            />
                        ))}
                    </TouchableOpacity>
                </ScrollView>

                {/* 선택된 객체 옵션 패널 */}
                {selected && (
                    <View style={styles.selectedPanel}>
                        <View style={styles.selectedPanelRow}>
                            <Text style={styles.selectedLabel}>
                                {selected.type === 'asset'
                                    ? `🖥️ ${selected.label}`
                                    : selected.type === 'table'
                                        ? '🟧 테이블'
                                        : '⬛ 벽'}
                            </Text>
                            <TouchableOpacity style={styles.smallBtn} onPress={rotateSelected}>
                                <RotateCw size={12} color="#475569" />
                                <Text style={styles.smallBtnText}>회전</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#fee2e2' }]} onPress={deleteSelected}>
                                <Trash2 size={12} color="#b91c1c" />
                                <Text style={[styles.smallBtnText, { color: '#b91c1c' }]}>삭제</Text>
                            </TouchableOpacity>
                        </View>

                        {/* 라벨 편집 (자산은 라벨 잠금) */}
                        {selected.type !== 'asset' && (
                            <View style={styles.selectedPanelRow}>
                                <TextInput
                                    style={styles.labelInput}
                                    value={labelInput}
                                    onChangeText={setLabelInput}
                                    onBlur={() => updateObject(selected.id, { label: labelInput })}
                                    placeholder="자유 라벨 (예: 작업대 1)"
                                    placeholderTextColor="#94a3b8"
                                />
                            </View>
                        )}

                        {/* 크기 조정 — 가로/세로 */}
                        <View style={styles.selectedPanelRow}>
                            <Text style={styles.sizeLbl}>W</Text>
                            <TouchableOpacity
                                style={styles.sizeBtn}
                                onPress={() => updateObject(selected.id, { width: Math.max(30, selected.width - 20) })}
                            >
                                <Text>－</Text>
                            </TouchableOpacity>
                            <Text style={styles.sizeVal}>{Math.round(selected.width)}</Text>
                            <TouchableOpacity
                                style={styles.sizeBtn}
                                onPress={() => updateObject(selected.id, { width: Math.min(CANVAS_WIDTH, selected.width + 20) })}
                            >
                                <Text>＋</Text>
                            </TouchableOpacity>

                            <Text style={[styles.sizeLbl, { marginLeft: 12 }]}>H</Text>
                            <TouchableOpacity
                                style={styles.sizeBtn}
                                onPress={() => updateObject(selected.id, { height: Math.max(20, selected.height - 20) })}
                            >
                                <Text>－</Text>
                            </TouchableOpacity>
                            <Text style={styles.sizeVal}>{Math.round(selected.height)}</Text>
                            <TouchableOpacity
                                style={styles.sizeBtn}
                                onPress={() => updateObject(selected.id, { height: Math.min(CANVAS_HEIGHT, selected.height + 20) })}
                            >
                                <Text>＋</Text>
                            </TouchableOpacity>
                        </View>

                        {/* 색상 팔레트 */}
                        <View style={styles.selectedPanelRow}>
                            {COLOR_PALETTE.map(c => (
                                <TouchableOpacity
                                    key={c}
                                    style={[
                                        styles.colorDot,
                                        { backgroundColor: c },
                                        selected.color === c && styles.colorDotActive,
                                    ]}
                                    onPress={() => updateObject(selected.id, { color: c })}
                                />
                            ))}
                        </View>
                    </View>
                )}

                {/* 저장 푸터 */}
                <View style={styles.footer}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                        <Text style={styles.cancelBtnText}>취소</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                        onPress={handleSave}
                        disabled={saving}
                    >
                        <Save size={14} color="#ffffff" />
                        <Text style={styles.saveBtnText}>{saving ? '저장 중…' : '저장'}</Text>
                    </TouchableOpacity>
                </View>

                {/* 자산 선택 모달 */}
                <Modal visible={showAssetPicker} animationType="slide" presentationStyle="pageSheet">
                    <View style={styles.container}>
                        <View style={styles.header}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.title}>기기 선택</Text>
                                <Text style={styles.subtitle}>
                                    이 연구실의 자산 중에서 골라 캔버스에 추가
                                </Text>
                            </View>
                            <TouchableOpacity style={styles.headerBtn} onPress={() => setShowAssetPicker(false)}>
                                <X size={20} color="#475569" />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.searchRow}>
                            <Search size={14} color="#94a3b8" />
                            <TextInput
                                style={styles.searchInput}
                                value={assetSearch}
                                onChangeText={setAssetSearch}
                                placeholder="자산명 검색"
                                placeholderTextColor="#94a3b8"
                            />
                        </View>
                        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 6 }}>
                            {filteredAssets.length === 0 ? (
                                <Text style={styles.emptyText}>
                                    {roomAssets.length === 0
                                        ? '이 연구실로 매칭되는 자산이 없어요.'
                                        : '검색 결과가 없거나 모두 배치된 상태예요.'}
                                </Text>
                            ) : (
                                filteredAssets.map(a => (
                                    <TouchableOpacity
                                        key={a.id}
                                        style={styles.assetItem}
                                        onPress={() => addAssetObject(a)}
                                    >
                                        <Cpu size={14} color="#4338ca" />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.assetItemName}>
                                                {(a.values as any)[titleField] ?? '(이름 없음)'}
                                            </Text>
                                            <Text style={styles.assetItemSub} numberOfLines={1}>
                                                {(a.values as any)['PC Hostname'] || '—'}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                ))
                            )}
                        </ScrollView>
                    </View>
                </Modal>
            </View>
        </Modal>
    );
};

// ---------------------------------------------------------------------------
// 드래그 가능 객체
// ---------------------------------------------------------------------------

const DraggableObject: React.FC<{
    obj: LayoutObject;
    scale: number;
    selected: boolean;
    onSelect: () => void;
    onMove: (dx: number, dy: number) => void;
}> = ({ obj, scale, selected, onSelect, onMove }) => {
    const lastMoveRef = useRef({ x: 0, y: 0 });

    const panResponder = useMemo(
        () => PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
            onPanResponderGrant: () => {
                lastMoveRef.current = { x: 0, y: 0 };
                onSelect();
            },
            onPanResponderMove: (_, g) => {
                const dx = (g.dx - lastMoveRef.current.x) / scale;
                const dy = (g.dy - lastMoveRef.current.y) / scale;
                lastMoveRef.current = { x: g.dx, y: g.dy };
                onMove(dx, dy);
            },
            onPanResponderTerminationRequest: () => false,
        }),
        [scale, onMove, onSelect]
    );

    const isAsset = obj.type === 'asset';
    const bg = obj.color || DEFAULT_COLORS[obj.type];

    return (
        <View
            {...panResponder.panHandlers}
            style={{
                position: 'absolute',
                left: obj.x * scale,
                top: obj.y * scale,
                width: obj.width * scale,
                height: obj.height * scale,
                transform: [{ rotate: `${obj.rotation || 0}deg` }],
                backgroundColor: isAsset ? '#ffffff' : bg,
                borderRadius: isAsset ? 8 : obj.type === 'table' ? 6 : 2,
                borderWidth: selected ? 2 : isAsset ? 2 : 0,
                borderColor: selected ? '#6366f1' : isAsset ? bg : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
                shadowColor: '#000',
                shadowOpacity: selected ? 0.3 : 0.1,
                shadowOffset: { width: 0, height: 1 },
                shadowRadius: 2,
            }}
        >
            {obj.label && (
                <Text
                    style={{
                        fontSize: Math.max(9, 11 * scale * 1.5),
                        fontWeight: '700',
                        color: isAsset ? bg : '#ffffff',
                        textAlign: 'center',
                    }}
                    numberOfLines={2}
                >
                    {obj.label}
                </Text>
            )}
        </View>
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

    toolbar: {
        flexDirection: 'row',
        gap: 6,
        padding: 10,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    toolBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
    },
    toolBtnText: { fontSize: 12, fontWeight: '700', color: '#475569' },

    canvasScroll: { flex: 1 },
    canvasScrollContent: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    canvas: {
        backgroundColor: '#ffffff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        position: 'relative',
        overflow: 'hidden',
    },
    gridLine: {
        position: 'absolute',
        backgroundColor: '#f1f5f9',
    },

    selectedPanel: {
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
        padding: 10,
        gap: 8,
    },
    selectedPanelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    selectedLabel: { fontSize: 13, fontWeight: '700', color: '#1f2937', flex: 1 },
    smallBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 8,
        backgroundColor: '#f1f5f9',
    },
    smallBtnText: { fontSize: 11, fontWeight: '700', color: '#475569' },
    labelInput: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 12,
        backgroundColor: '#ffffff',
        color: '#1f2937',
    },
    sizeLbl: { fontSize: 11, fontWeight: '700', color: '#475569' },
    sizeBtn: {
        width: 28,
        height: 28,
        borderRadius: 6,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sizeVal: { fontSize: 11, fontWeight: '700', color: '#1f2937', width: 36, textAlign: 'center' },
    colorDot: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    colorDotActive: { borderColor: '#1f2937' },

    footer: {
        flexDirection: 'row',
        gap: 8,
        padding: 12,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    cancelBtn: {
        flex: 1,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
    },
    cancelBtnText: { fontSize: 14, color: '#475569', fontWeight: '600' },
    saveBtn: {
        flex: 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#6366f1',
    },
    saveBtnDisabled: { backgroundColor: '#cbd5e1' },
    saveBtnText: { fontSize: 14, color: '#ffffff', fontWeight: '700' },

    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        margin: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    searchInput: { flex: 1, fontSize: 13, color: '#1f2937', padding: 0 },
    emptyText: { fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingVertical: 40 },
    assetItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 12,
        backgroundColor: '#ffffff',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    assetItemName: { fontSize: 13, fontWeight: '700', color: '#1f2937' },
    assetItemSub: { fontSize: 11, color: '#64748b', marginTop: 2 },
});
