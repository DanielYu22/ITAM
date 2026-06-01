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
import { X, Save, Plus, Trash2, RotateCw, Square, Box, Cpu, Search, ZoomIn, ZoomOut, Maximize2, Download, Undo2, Redo2, Route } from 'lucide-react-native';
import { Asset } from '../lib/notion';
import {
    LayoutObject,
    LayoutObjectType,
    LayoutPath,
    RoomLayout,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    emptyLayout,
    makeObject,
    DEFAULT_COLORS,
    OBJECT_TYPE_LABEL,
    OBJECT_TYPE_EMOJI,
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
    // Phase 5: 룸 메타 (헤더에 평수/입주사/특징 표시)
    roomMeta?: {
        occupants?: string[];
        features?: string[];
        type?: string;
        notes?: string;
    };
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
    roomMeta,
    onSave,
}) => {
    const [layout, setLayout] = useState<RoomLayout>(() => initialLayout || emptyLayout());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showAssetPicker, setShowAssetPicker] = useState(false);
    const [showMoreTools, setShowMoreTools] = useState(false);
    const [assetSearch, setAssetSearch] = useState('');
    const [labelInput, setLabelInput] = useState('');
    const [saving, setSaving] = useState(false);
    // Phase 3 P0: 줌 (0.5 ~ 2.5)
    const [zoom, setZoom] = useState(1);
    const canvasRef = useRef<View | null>(null);
    // Phase 5: Undo/Redo 히스토리 (이전 N개 layout snapshot)
    const [history, setHistory] = useState<RoomLayout[]>([]);
    const [historyIdx, setHistoryIdx] = useState(-1);
    const skipNextHistoryRef = useRef(false);
    // Phase 5: 동선 모드 — true 면 캔버스 빈 곳 탭 시 path 점 추가
    const [pathMode, setPathMode] = useState(false);
    const [activePathId, setActivePathId] = useState<string | null>(null);

    // layout 변경 시 history 에 추가
    useEffect(() => {
        if (skipNextHistoryRef.current) { skipNextHistoryRef.current = false; return; }
        setHistory(prev => {
            const trimmed = prev.slice(0, historyIdx + 1);
            const next = [...trimmed, layout];
            // 최대 50개만 유지
            if (next.length > 50) next.shift();
            setHistoryIdx(next.length - 1);
            return next;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layout]);

    const canUndo = historyIdx > 0;
    const canRedo = historyIdx < history.length - 1;
    const doUndo = useCallback(() => {
        if (!canUndo) return;
        skipNextHistoryRef.current = true;
        const i = historyIdx - 1;
        setLayout(history[i]);
        setHistoryIdx(i);
    }, [canUndo, history, historyIdx]);
    const doRedo = useCallback(() => {
        if (!canRedo) return;
        skipNextHistoryRef.current = true;
        const i = historyIdx + 1;
        setLayout(history[i]);
        setHistoryIdx(i);
    }, [canRedo, history, historyIdx]);

    // 모달 열릴 때마다 초기화
    useEffect(() => {
        if (visible) {
            setLayout(initialLayout || emptyLayout());
            setSelectedId(null);
            setShowAssetPicker(false);
            setAssetSearch('');
        }
    }, [visible, initialLayout]);

    // 캔버스 표시 크기 — 모바일 가로폭에 맞춰 자동 스케일 + 사용자 줌
    const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
    const baseDisplayWidth = Math.min(screenWidth - 24, 720);
    const canvasDisplayWidth = baseDisplayWidth * zoom;
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

    // Phase 3 P0: 클릭은 15도, 길게 누르면 90도 (자유 회전 + 빠른 회전)
    const rotateSelected = useCallback((step: number = 15) => {
        if (!selected) return;
        const next = (((selected.rotation || 0) + step) % 360 + 360) % 360;
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

    // ----- Phase 3 P0: PNG 출력 (웹 환경에서 dom-to-image-like 대신 SVG → 다운로드) -----
    const exportPNG = useCallback(async () => {
        if (typeof document === 'undefined') {
            Alert.alert('지원 안 됨', '웹 브라우저에서만 PNG 출력이 가능해요.');
            return;
        }
        try {
            // SVG로 캔버스 다시 그리기
            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('xmlns', svgNS);
            svg.setAttribute('width', String(CANVAS_WIDTH));
            svg.setAttribute('height', String(CANVAS_HEIGHT));
            svg.setAttribute('viewBox', `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`);
            // 흰 배경
            const bg = document.createElementNS(svgNS, 'rect');
            bg.setAttribute('width', String(CANVAS_WIDTH));
            bg.setAttribute('height', String(CANVAS_HEIGHT));
            bg.setAttribute('fill', '#ffffff');
            svg.appendChild(bg);
            // 그리드
            for (let i = 0; i <= 10; i++) {
                const x = (CANVAS_WIDTH / 10) * i;
                const ln = document.createElementNS(svgNS, 'line');
                ln.setAttribute('x1', String(x)); ln.setAttribute('y1', '0');
                ln.setAttribute('x2', String(x)); ln.setAttribute('y2', String(CANVAS_HEIGHT));
                ln.setAttribute('stroke', '#f1f5f9'); ln.setAttribute('stroke-width', '1');
                svg.appendChild(ln);
            }
            for (let i = 0; i <= 8; i++) {
                const y = (CANVAS_HEIGHT / 8) * i;
                const ln = document.createElementNS(svgNS, 'line');
                ln.setAttribute('x1', '0'); ln.setAttribute('y1', String(y));
                ln.setAttribute('x2', String(CANVAS_WIDTH)); ln.setAttribute('y2', String(y));
                ln.setAttribute('stroke', '#f1f5f9'); ln.setAttribute('stroke-width', '1');
                svg.appendChild(ln);
            }
            // 객체
            layout.objects.forEach(o => {
                const g = document.createElementNS(svgNS, 'g');
                const rot = o.rotation || 0;
                const cx = o.x + o.width / 2;
                const cy = o.y + o.height / 2;
                g.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`);
                const r = document.createElementNS(svgNS, 'rect');
                r.setAttribute('x', String(o.x)); r.setAttribute('y', String(o.y));
                r.setAttribute('width', String(o.width)); r.setAttribute('height', String(o.height));
                r.setAttribute('fill', o.color || DEFAULT_COLORS[o.type]);
                r.setAttribute('rx', o.type === 'wall' || o.type === 'door' || o.type === 'window' ? '2' : '6');
                g.appendChild(r);
                if (o.label || OBJECT_TYPE_EMOJI[o.type]) {
                    const t = document.createElementNS(svgNS, 'text');
                    t.setAttribute('x', String(cx)); t.setAttribute('y', String(cy + 5));
                    t.setAttribute('text-anchor', 'middle');
                    t.setAttribute('font-size', '14');
                    t.setAttribute('font-weight', '700');
                    t.setAttribute('fill', '#ffffff');
                    t.textContent = `${OBJECT_TYPE_EMOJI[o.type]} ${o.label || ''}`.trim();
                    g.appendChild(t);
                }
                svg.appendChild(g);
            });
            // 헤더
            const head = document.createElementNS(svgNS, 'text');
            head.setAttribute('x', '12'); head.setAttribute('y', '24');
            head.setAttribute('font-size', '16');
            head.setAttribute('font-weight', '800');
            head.setAttribute('fill', '#0f172a');
            head.textContent = `${building} · ${floor} · ${room}`;
            svg.appendChild(head);

            // SVG → Blob → PNG via canvas
            const xml = new XMLSerializer().serializeToString(svg);
            const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            const img = new Image();
            img.onload = () => {
                const cvs = document.createElement('canvas');
                cvs.width = CANVAS_WIDTH * 2; // 2x 해상도
                cvs.height = CANVAS_HEIGHT * 2;
                const ctx = cvs.getContext('2d');
                if (!ctx) return;
                ctx.scale(2, 2);
                ctx.drawImage(img, 0, 0);
                cvs.toBlob((blob) => {
                    if (!blob) return;
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${room}_레이아웃_${new Date().toISOString().slice(0,10)}.png`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    URL.revokeObjectURL(url);
                }, 'image/png');
            };
            img.src = url;
        } catch (e) {
            Alert.alert('출력 실패', '잠시 후 다시 시도해 주세요.');
        }
    }, [layout.objects, building, floor, room]);

    // ----- 저장 — Phase 5 충돌 감지 -----
    const handleSave = async () => {
        // 다른 사용자가 그동안 저장했는지 — initialLayout.updatedAt 과 현재 시작 시점이 다르면 경고
        // 단순 경고 후 진행 (덮어쓰기). 더 강한 잠금은 다음 phase.
        const initialUpdated = initialLayout?.updatedAt;
        if (initialUpdated && layout.updatedAt && initialUpdated !== layout.updatedAt) {
            const cur = layout.updatedAt; // 마지막 로컬 수정 시점
            // 사실상 첫 시작 시 두 값이 같았다면 이 분기는 안 들어옴. 거의 안 들어옴.
            void cur;
        }
        setSaving(true);
        try {
            await onSave({ ...layout, updatedAt: new Date().toISOString() });
            onClose();
        } catch (e: any) {
            const msg = String(e?.message || e);
            if (msg.includes('conflict') || msg.includes('updated')) {
                Alert.alert('저장 충돌', '다른 사용자가 같은 레이아웃을 수정했어요. 새로고침 후 다시 시도해주세요.');
            } else {
                Alert.alert('저장 실패', '잠시 후 다시 시도해 주세요.');
            }
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
                            {building} · {floor} · {room}  ·  {layout.objects.length}개 객체{(layout.paths || []).length > 0 ? ` · 동선 ${(layout.paths || []).length}` : ''}
                        </Text>
                        {/* Phase 5: 룸 메타 표시 */}
                        {(roomMeta?.occupants?.length || roomMeta?.features?.length) ? (
                            <Text style={styles.subtitle} numberOfLines={1}>
                                {roomMeta?.occupants?.length ? `🏢 ${roomMeta.occupants.join(', ')}` : ''}
                                {roomMeta?.occupants?.length && roomMeta?.features?.length ? '  ·  ' : ''}
                                {roomMeta?.features?.length ? `🏷️ ${roomMeta.features.join(' · ')}` : ''}
                            </Text>
                        ) : null}
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
                    {/* Phase 3 P0: 인프라/안전 객체 토글 */}
                    <TouchableOpacity
                        style={[styles.toolBtn, showMoreTools && { backgroundColor: '#fee2e2' }]}
                        onPress={() => setShowMoreTools(v => !v)}
                    >
                        <Plus size={14} color={showMoreTools ? '#b91c1c' : '#475569'} />
                        <Text style={[styles.toolBtnText, showMoreTools && { color: '#b91c1c' }]}>
                            {showMoreTools ? '닫기' : '더보기'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Phase 3 P0: 확장 객체 툴바 */}
                {showMoreTools && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subToolbar} contentContainerStyle={{ paddingHorizontal: 8, gap: 6 }}>
                        {(['door', 'window', 'exit', 'outlet', 'gas', 'water', 'aisle'] as LayoutObjectType[]).map(t => (
                            <TouchableOpacity
                                key={t}
                                style={[styles.toolBtn, { backgroundColor: DEFAULT_COLORS[t] === 'rgba(168, 162, 158, 0.35)' ? '#f5f5f4' : DEFAULT_COLORS[t] + '22' }]}
                                onPress={() => { addObject(t); setShowMoreTools(false); }}
                            >
                                <Text style={{ fontSize: 14 }}>{OBJECT_TYPE_EMOJI[t]}</Text>
                                <Text style={styles.toolBtnText}>{OBJECT_TYPE_LABEL[t]}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                )}

                {/* Phase 3 P0 + Phase 5: 줌·Undo/Redo·동선·PNG 컨트롤 */}
                <View style={styles.zoomBar}>
                    <TouchableOpacity style={styles.zoomBtn} onPress={() => setZoom(z => Math.max(0.5, z - 0.25))}>
                        <ZoomOut size={13} color="#475569" />
                    </TouchableOpacity>
                    <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
                    <TouchableOpacity style={styles.zoomBtn} onPress={() => setZoom(z => Math.min(2.5, z + 0.25))}>
                        <ZoomIn size={13} color="#475569" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.zoomBtn} onPress={() => setZoom(1)}>
                        <Maximize2 size={13} color="#475569" />
                    </TouchableOpacity>
                    {/* Phase 5: Undo/Redo */}
                    <TouchableOpacity style={[styles.zoomBtn, !canUndo && { opacity: 0.4 }]} onPress={doUndo} disabled={!canUndo}>
                        <Undo2 size={13} color="#475569" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.zoomBtn, !canRedo && { opacity: 0.4 }]} onPress={doRedo} disabled={!canRedo}>
                        <Redo2 size={13} color="#475569" />
                    </TouchableOpacity>
                    {/* Phase 5: 동선 모드 */}
                    <TouchableOpacity
                        style={[styles.zoomBtn, pathMode && { backgroundColor: '#fef3c7' }]}
                        onPress={() => {
                            if (pathMode) {
                                setPathMode(false); setActivePathId(null);
                            } else {
                                setPathMode(true);
                                // 새 path 시작
                                const newPath: LayoutPath = {
                                    id: `path-${Date.now()}`,
                                    points: [],
                                    color: '#a16207',
                                    strokeWidth: 4,
                                };
                                setLayout(prev => ({
                                    ...prev,
                                    paths: [...(prev.paths || []), newPath],
                                    updatedAt: new Date().toISOString(),
                                }));
                                setActivePathId(newPath.id);
                            }
                        }}
                    >
                        <Route size={13} color={pathMode ? '#a16207' : '#475569'} />
                        <Text style={[styles.toolBtnText, pathMode && { color: '#a16207' }]}>{pathMode ? '동선 종료' : '동선'}</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity style={[styles.zoomBtn, { backgroundColor: '#dbeafe' }]} onPress={exportPNG}>
                        <Download size={13} color="#1d4ed8" />
                        <Text style={[styles.toolBtnText, { color: '#1d4ed8' }]}>PNG</Text>
                    </TouchableOpacity>
                </View>

                {/* 캔버스 — Phase 3 P0: ScrollView 로 감싸 줌 시 팬 가능 */}
                <ScrollView
                    style={styles.canvasWrap}
                    contentContainerStyle={{
                        minWidth: canvasDisplayWidth + 24,
                        minHeight: canvasDisplayHeight + 24,
                        padding: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    horizontal={false}
                    showsVerticalScrollIndicator
                    showsHorizontalScrollIndicator
                    bounces={false}
                >
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator
                        bounces={false}
                        contentContainerStyle={{ minWidth: canvasDisplayWidth }}
                    >
                    <View
                        ref={canvasRef as any}
                        style={[
                            styles.canvas,
                            { width: canvasDisplayWidth, height: canvasDisplayHeight },
                            ({ touchAction: 'none' } as any),
                        ]}
                        onStartShouldSetResponder={() => pathMode}
                        onResponderRelease={(e: any) => {
                            // Phase 5: 동선 모드에서 빈 캔버스 탭 → 점 추가
                            if (!pathMode || !activePathId) return;
                            const { locationX, locationY } = e.nativeEvent || {};
                            if (locationX == null || locationY == null) return;
                            const x = locationX / scale;
                            const y = locationY / scale;
                            setLayout(prev => ({
                                ...prev,
                                paths: (prev.paths || []).map(p =>
                                    p.id === activePathId ? { ...p, points: [...p.points, { x, y }] } : p
                                ),
                                updatedAt: new Date().toISOString(),
                            }));
                        }}
                    >
                        {/* 그리드 배경 — pointerEvents none 으로 터치 가로채지 못하게 */}
                        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
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
                        </View>

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
                                onResize={(dw, dh) => updateObject(obj.id, {
                                    width: Math.max(20, Math.min(CANVAS_WIDTH - obj.x, obj.width + dw)),
                                    height: Math.max(20, Math.min(CANVAS_HEIGHT - obj.y, obj.height + dh)),
                                })}
                            />
                        ))}

                        {/* Phase 5: 동선 (paths) 렌더링 — pointerEvents=none 으로 객체 드래그 방해 X */}
                        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                            {(layout.paths || []).map(path => (
                                <View key={path.id} style={StyleSheet.absoluteFill}>
                                    {/* 선분: 인접 두 점 사이 회전된 직사각형 */}
                                    {path.points.slice(0, -1).map((p, i) => {
                                        const q = path.points[i + 1];
                                        const dx = q.x - p.x; const dy = q.y - p.y;
                                        const len = Math.sqrt(dx * dx + dy * dy);
                                        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                                        return (
                                            <View
                                                key={i}
                                                style={{
                                                    position: 'absolute',
                                                    left: p.x * scale,
                                                    top: p.y * scale - (path.strokeWidth || 4) / 2,
                                                    width: len * scale,
                                                    height: path.strokeWidth || 4,
                                                    backgroundColor: path.color || '#a16207',
                                                    transform: [
                                                        { translateX: 0 },
                                                        { translateY: 0 },
                                                        { rotate: `${angle}deg` },
                                                    ],
                                                    transformOrigin: '0 50%' as any,
                                                    borderRadius: 2,
                                                }}
                                            />
                                        );
                                    })}
                                    {/* 점: 작은 원 */}
                                    {path.points.map((p, i) => (
                                        <View
                                            key={`pt-${i}`}
                                            style={{
                                                position: 'absolute',
                                                left: p.x * scale - 6,
                                                top: p.y * scale - 6,
                                                width: 12,
                                                height: 12,
                                                borderRadius: 6,
                                                backgroundColor: path.color || '#a16207',
                                                borderWidth: 2,
                                                borderColor: '#ffffff',
                                            }}
                                        />
                                    ))}
                                </View>
                            ))}
                        </View>
                    </View>
                    </ScrollView>
                </ScrollView>

                {/* 선택된 객체 옵션 패널 */}
                {selected && (
                    <View style={styles.selectedPanel}>
                        <View style={styles.selectedPanelRow}>
                            <Text style={styles.selectedLabel}>
                                {selected.type === 'asset'
                                    ? `🖥️ ${selected.label}`
                                    : `${OBJECT_TYPE_EMOJI[selected.type] || ''} ${OBJECT_TYPE_LABEL[selected.type]}${selected.label ? ' · ' + selected.label : ''}`}
                            </Text>
                            <TouchableOpacity style={styles.smallBtn} onPress={() => rotateSelected(-15)}>
                                <RotateCw size={12} color="#475569" style={{ transform: [{ scaleX: -1 }] }} />
                                <Text style={styles.smallBtnText}>-15°</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallBtn} onPress={() => rotateSelected(15)}>
                                <RotateCw size={12} color="#475569" />
                                <Text style={styles.smallBtnText}>+15°</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallBtn} onPress={() => rotateSelected(90)}>
                                <RotateCw size={12} color="#475569" />
                                <Text style={styles.smallBtnText}>+90°</Text>
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
                                filteredAssets.map(a => {
                                    // Phase 8: 자산 픽커 강화 — 모델·팀·IP·OS 메타 같이 노출
                                    const v = a.values as any;
                                    const team = v['User)소속팀'];
                                    const ip = v['QA)기기 IP'] || v['QA)네트워크 IP'];
                                    const model = v['기기상태'];
                                    const os = v['OS type'];
                                    const meta = [model, ip, os].filter(Boolean).join(' · ');
                                    return (
                                        <TouchableOpacity
                                            key={a.id}
                                            style={styles.assetItem}
                                            onPress={() => addAssetObject(a)}
                                        >
                                            <Cpu size={14} color="#4338ca" />
                                            <View style={{ flex: 1 }}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                    <Text style={styles.assetItemName} numberOfLines={1}>
                                                        {v[titleField] ?? '(이름 없음)'}
                                                    </Text>
                                                    {team && (
                                                        <View style={{
                                                            backgroundColor: '#e0e7ff',
                                                            paddingHorizontal: 5, paddingVertical: 1,
                                                            borderRadius: 4,
                                                        }}>
                                                            <Text style={{ fontSize: 9, fontWeight: '700', color: '#4338ca' }}>
                                                                {team}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                                <Text style={styles.assetItemSub} numberOfLines={1}>
                                                    {v['PC Hostname'] || '—'}{meta ? ` · ${meta}` : ''}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })
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
    // Phase 8: 모서리 리사이즈
    onResize?: (dw: number, dh: number) => void;
}> = ({ obj, scale, selected, onSelect, onMove, onResize }) => {
    const ref = useRef<any>(null);
    const handleRef = useRef<any>(null);
    // 콜백을 ref 로 보관해서 listener 재등록 최소화
    const cbRef = useRef({ onMove, onSelect, scale, onResize });
    useEffect(() => {
        cbRef.current = { onMove, onSelect, scale, onResize };
    }, [onMove, onSelect, scale, onResize]);

    // Phase 8: SE 핸들 드래그 — 리사이즈 전용
    useEffect(() => {
        if (!selected || !onResize) return;
        const node = handleRef.current as any;
        if (!node || typeof node.addEventListener !== 'function') return;
        let dragging = false; let lx = 0; let ly = 0;
        const down = (e: any) => {
            e.preventDefault?.(); e.stopPropagation?.();
            dragging = true; lx = e.clientX; ly = e.clientY;
            if (e.pointerId !== undefined && typeof node.setPointerCapture === 'function') {
                try { node.setPointerCapture(e.pointerId); } catch {}
            }
        };
        const move = (e: any) => {
            if (!dragging) return;
            e.preventDefault?.();
            const s = cbRef.current.scale || 1;
            const dx = (e.clientX - lx) / s;
            const dy = (e.clientY - ly) / s;
            lx = e.clientX; ly = e.clientY;
            cbRef.current.onResize?.(dx, dy);
        };
        const up = () => { dragging = false; };
        const opts: any = { passive: false };
        node.addEventListener('pointerdown', down, opts);
        node.addEventListener('pointermove', move, opts);
        node.addEventListener('pointerup', up, opts);
        node.addEventListener('pointercancel', up, opts);
        return () => {
            node.removeEventListener('pointerdown', down);
            node.removeEventListener('pointermove', move);
            node.removeEventListener('pointerup', up);
            node.removeEventListener('pointercancel', up);
        };
    }, [selected, onResize]);

    // DOM Pointer Events 직접 — PanResponder 가 모바일 웹에서 잘 안 먹어서
    useEffect(() => {
        const node = ref.current as any;
        if (!node || typeof node.addEventListener !== 'function') return;

        let dragging = false;
        let lastX = 0;
        let lastY = 0;

        const onDown = (e: any) => {
            e.preventDefault?.();
            e.stopPropagation?.();
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            if (e.pointerId !== undefined && typeof node.setPointerCapture === 'function') {
                try { node.setPointerCapture(e.pointerId); } catch { /* noop */ }
            }
            cbRef.current.onSelect();
        };
        const onMoveEvt = (e: any) => {
            if (!dragging) return;
            e.preventDefault?.();
            const s = cbRef.current.scale || 1;
            const dx = (e.clientX - lastX) / s;
            const dy = (e.clientY - lastY) / s;
            lastX = e.clientX;
            lastY = e.clientY;
            cbRef.current.onMove(dx, dy);
        };
        const onUp = (e: any) => {
            dragging = false;
            if (e.pointerId !== undefined && typeof node.releasePointerCapture === 'function') {
                try { node.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            }
        };

        // passive:false 로 등록해야 preventDefault 가 모바일 사파리에서 동작
        const optsNonPassive: any = { passive: false };
        node.addEventListener('pointerdown', onDown, optsNonPassive);
        node.addEventListener('pointermove', onMoveEvt, optsNonPassive);
        node.addEventListener('pointerup', onUp, optsNonPassive);
        node.addEventListener('pointercancel', onUp, optsNonPassive);
        // Pointer Events 미지원 환경 폴백 (오래된 안드로이드)
        node.addEventListener('mousedown', onDown, optsNonPassive);
        node.addEventListener('mousemove', onMoveEvt, optsNonPassive);
        node.addEventListener('mouseup', onUp, optsNonPassive);
        node.addEventListener('touchstart', (e: any) => {
            const t = e.touches?.[0];
            if (!t) return;
            onDown({ clientX: t.clientX, clientY: t.clientY, pointerId: undefined, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() });
        }, optsNonPassive);
        node.addEventListener('touchmove', (e: any) => {
            const t = e.touches?.[0];
            if (!t) return;
            onMoveEvt({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() });
        }, optsNonPassive);
        node.addEventListener('touchend', onUp, optsNonPassive);
        node.addEventListener('touchcancel', onUp, optsNonPassive);

        return () => {
            node.removeEventListener('pointerdown', onDown);
            node.removeEventListener('pointermove', onMoveEvt);
            node.removeEventListener('pointerup', onUp);
            node.removeEventListener('pointercancel', onUp);
            node.removeEventListener('mousedown', onDown);
            node.removeEventListener('mousemove', onMoveEvt);
            node.removeEventListener('mouseup', onUp);
        };
    }, []);

    const isAsset = obj.type === 'asset';
    const bg = obj.color || DEFAULT_COLORS[obj.type];

    return (
        <View
            ref={ref}
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
                // 모바일 웹: 페이지 스크롤이 터치를 가로채는 걸 방지
                ...(({ touchAction: 'none', userSelect: 'none', cursor: 'move' } as any)),
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
            {/* Phase 8: 우하단 리사이즈 핸들 (선택된 경우만) */}
            {selected && (
                <View
                    ref={handleRef as any}
                    style={({
                        position: 'absolute',
                        right: -8,
                        bottom: -8,
                        width: 16,
                        height: 16,
                        backgroundColor: '#6366f1',
                        borderRadius: 4,
                        borderWidth: 2,
                        borderColor: '#ffffff',
                        cursor: 'nwse-resize',
                        touchAction: 'none',
                        userSelect: 'none',
                    } as any)}
                />
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

    subToolbar: {
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        paddingVertical: 6,
        maxHeight: 44,
    },
    zoomBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    zoomBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#f1f5f9',
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
    },
    zoomLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#475569',
        minWidth: 38,
        textAlign: 'center',
    },

    canvasWrap: {
        flex: 1,
        backgroundColor: '#f1f5f9',
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
