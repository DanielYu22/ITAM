/**
 * RoomEditDialog — 인프라 트리의 실험실/서버실/사무실 노드 편집
 *
 * 이름 · 타입 · 메모 · 특징 칩 + 서버실일 때 추가 메타 필드.
 * 레이아웃 편집 진입 버튼도 여기.
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    TextInput,
    Alert,
} from 'react-native';
import { X, Save, Trash2, Plus, Map as MapIcon } from 'lucide-react-native';
import {
    RoomInfo,
    RoomType,
    ROOM_TYPE_LABEL,
    ROOM_TYPE_EMOJI,
    ServerRoomInfo,
} from '../lib/infrastructure';

interface Props {
    visible: boolean;
    onClose: () => void;
    room: RoomInfo;
    /** UI 표시용 경로 */
    building: string;
    floor: string;
    onSave: (next: RoomInfo) => Promise<void>;
    onDelete?: () => Promise<void>;
    onOpenLayout?: () => void;
}

const ROOM_TYPES: RoomType[] = ['lab', 'server-room', 'office', 'other'];

export const RoomEditDialog: React.FC<Props> = ({
    visible,
    onClose,
    room,
    building,
    floor,
    onSave,
    onDelete,
    onOpenLayout,
}) => {
    const [name, setName] = useState(room.name);
    const [type, setType] = useState<RoomType>(room.type || 'lab');
    const [notes, setNotes] = useState(room.notes || '');
    const [features, setFeatures] = useState<string[]>(room.features || []);
    const [featureInput, setFeatureInput] = useState('');
    const [server, setServer] = useState<ServerRoomInfo>(room.serverRoom || {});
    const [equipmentInput, setEquipmentInput] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setName(room.name);
        setType(room.type || 'lab');
        setNotes(room.notes || '');
        setFeatures(room.features || []);
        setServer(room.serverRoom || {});
        setFeatureInput('');
        setEquipmentInput('');
    }, [visible, room]);

    const addFeature = () => {
        const v = featureInput.trim();
        if (!v || features.includes(v)) { setFeatureInput(''); return; }
        setFeatures(prev => [...prev, v]);
        setFeatureInput('');
    };
    const removeFeature = (v: string) => setFeatures(prev => prev.filter(x => x !== v));

    const addEquipment = () => {
        const v = equipmentInput.trim();
        if (!v) return;
        const list = server.equipment || [];
        if (list.includes(v)) { setEquipmentInput(''); return; }
        setServer(prev => ({ ...prev, equipment: [...list, v] }));
        setEquipmentInput('');
    };
    const removeEquipment = (v: string) => {
        const list = (server.equipment || []).filter(x => x !== v);
        setServer(prev => ({ ...prev, equipment: list }));
    };

    const handleSave = async () => {
        if (!name.trim()) {
            Alert.alert('이름 필수', '실험실 이름을 입력해 주세요.');
            return;
        }
        setSaving(true);
        try {
            const next: RoomInfo = {
                ...room,
                name: name.trim(),
                type,
                notes: notes.trim() || undefined,
                features: features.length > 0 ? features : undefined,
                serverRoom: type === 'server-room' && Object.keys(server).length > 0 ? server : undefined,
            };
            await onSave(next);
            onClose();
        } catch (e) {
            Alert.alert('저장 실패', '잠시 후 다시 시도하세요.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        if (!onDelete) return;
        Alert.alert('삭제 확인', `${room.name} 을(를) 삭제할까요?\n자산 카운트는 다음 시드에서 다시 만들어지지만, 메모/특징/서버실 정보는 영구 삭제됩니다.`, [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: async () => { await onDelete(); onClose(); } },
        ]);
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title}>{ROOM_TYPE_EMOJI[type]} {room.name}</Text>
                        <Text style={styles.subtitle}>{building} · {floor}</Text>
                    </View>
                    <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                        <X size={20} color="#475569" />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    {/* 이름 */}
                    <Text style={styles.label}>이름</Text>
                    <TextInput
                        style={styles.input}
                        value={name}
                        onChangeText={setName}
                        placeholder="공간 이름"
                        placeholderTextColor="#94a3b8"
                    />

                    {/* 타입 */}
                    <Text style={styles.label}>타입</Text>
                    <View style={styles.typeRow}>
                        {ROOM_TYPES.map(t => {
                            const active = type === t;
                            return (
                                <TouchableOpacity
                                    key={t}
                                    style={[styles.typeChip, active && styles.typeChipActive]}
                                    onPress={() => setType(t)}
                                >
                                    <Text style={styles.typeChipEmoji}>{ROOM_TYPE_EMOJI[t]}</Text>
                                    <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                                        {ROOM_TYPE_LABEL[t]}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {/* 메모 */}
                    <Text style={styles.label}>메모</Text>
                    <TextInput
                        style={[styles.input, styles.inputMultiline]}
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="자유 메모 (특이사항, 출입 안내 등)"
                        placeholderTextColor="#94a3b8"
                        multiline
                    />

                    {/* 특징 (모든 타입 공통) */}
                    <Text style={styles.label}>특징</Text>
                    <Text style={styles.helperText}>
                        BSL 등급, 화학 분류, 안전 등급 같은 자유 라벨
                    </Text>
                    <View style={styles.chipsRow}>
                        {features.length === 0 && <Text style={styles.emptyChip}>비어있음</Text>}
                        {features.map(f => (
                            <View key={f} style={styles.featureChip}>
                                <Text style={styles.featureChipText}>{f}</Text>
                                <TouchableOpacity onPress={() => removeFeature(f)}>
                                    <X size={11} color="#0369a1" />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>
                    <View style={styles.addRow}>
                        <TextInput
                            style={styles.smallInput}
                            value={featureInput}
                            onChangeText={setFeatureInput}
                            onSubmitEditing={addFeature}
                            placeholder="예: BSL-2"
                            placeholderTextColor="#94a3b8"
                        />
                        <TouchableOpacity
                            style={[styles.addBtn, !featureInput.trim() && { opacity: 0.4 }]}
                            onPress={addFeature}
                            disabled={!featureInput.trim()}
                        >
                            <Plus size={12} color="#ffffff" />
                            <Text style={styles.addBtnText}>추가</Text>
                        </TouchableOpacity>
                    </View>

                    {/* 서버실 전용 필드 */}
                    {type === 'server-room' && (
                        <>
                            <Text style={styles.sectionDivider}>🖥️ 서버실 정보</Text>

                            <View style={styles.row2}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.label}>랙 수</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={server.rackCount?.toString() || ''}
                                        onChangeText={(v) => setServer(prev => ({ ...prev, rackCount: v ? parseInt(v, 10) || undefined : undefined }))}
                                        placeholder="0"
                                        placeholderTextColor="#94a3b8"
                                        keyboardType="numeric"
                                    />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.label}>서버 수</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={server.serverCount?.toString() || ''}
                                        onChangeText={(v) => setServer(prev => ({ ...prev, serverCount: v ? parseInt(v, 10) || undefined : undefined }))}
                                        placeholder="0"
                                        placeholderTextColor="#94a3b8"
                                        keyboardType="numeric"
                                    />
                                </View>
                            </View>

                            <Text style={styles.label}>장비 / 인프라</Text>
                            <Text style={styles.helperText}>주요 네트워크 장비, UPS, 백업 등</Text>
                            <View style={styles.chipsRow}>
                                {(server.equipment || []).length === 0 && <Text style={styles.emptyChip}>비어있음</Text>}
                                {(server.equipment || []).map(e => (
                                    <View key={e} style={[styles.featureChip, { backgroundColor: '#fef3c7' }]}>
                                        <Text style={[styles.featureChipText, { color: '#b45309' }]}>{e}</Text>
                                        <TouchableOpacity onPress={() => removeEquipment(e)}>
                                            <X size={11} color="#b45309" />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                            <View style={styles.addRow}>
                                <TextInput
                                    style={styles.smallInput}
                                    value={equipmentInput}
                                    onChangeText={setEquipmentInput}
                                    onSubmitEditing={addEquipment}
                                    placeholder="예: Cisco Catalyst 9200"
                                    placeholderTextColor="#94a3b8"
                                />
                                <TouchableOpacity
                                    style={[styles.addBtn, { backgroundColor: '#b45309' }, !equipmentInput.trim() && { opacity: 0.4 }]}
                                    onPress={addEquipment}
                                    disabled={!equipmentInput.trim()}
                                >
                                    <Plus size={12} color="#ffffff" />
                                    <Text style={styles.addBtnText}>추가</Text>
                                </TouchableOpacity>
                            </View>

                            <Text style={styles.label}>냉방</Text>
                            <TextInput
                                style={styles.input}
                                value={server.cooling || ''}
                                onChangeText={(v) => setServer(prev => ({ ...prev, cooling: v }))}
                                placeholder="예: 항온항습 24/7, 30kW"
                                placeholderTextColor="#94a3b8"
                            />

                            <Text style={styles.label}>UPS</Text>
                            <TextInput
                                style={styles.input}
                                value={server.ups || ''}
                                onChangeText={(v) => setServer(prev => ({ ...prev, ups: v }))}
                                placeholder="예: APC Symmetra 80kVA, 15분 자동"
                                placeholderTextColor="#94a3b8"
                            />

                            <Text style={styles.label}>전원</Text>
                            <TextInput
                                style={[styles.input, styles.inputMultiline]}
                                value={server.powerNotes || ''}
                                onChangeText={(v) => setServer(prev => ({ ...prev, powerNotes: v }))}
                                placeholder="회로 구성, 비상 전원 등"
                                placeholderTextColor="#94a3b8"
                                multiline
                            />

                            <Text style={styles.label}>출입 / 보안</Text>
                            <TextInput
                                style={[styles.input, styles.inputMultiline]}
                                value={server.accessNotes || ''}
                                onChangeText={(v) => setServer(prev => ({ ...prev, accessNotes: v }))}
                                placeholder="출입 카드, 키 위치, 보안 절차"
                                placeholderTextColor="#94a3b8"
                                multiline
                            />

                            <Text style={styles.label}>담당자</Text>
                            <TextInput
                                style={styles.input}
                                value={server.contactPerson || ''}
                                onChangeText={(v) => setServer(prev => ({ ...prev, contactPerson: v }))}
                                placeholder="이름 · 연락처"
                                placeholderTextColor="#94a3b8"
                            />
                        </>
                    )}

                    {/* 레이아웃 진입 */}
                    {onOpenLayout && type === 'lab' && (
                        <>
                            <Text style={styles.sectionDivider}>🗺️ 레이아웃</Text>
                            <TouchableOpacity style={styles.layoutBtn} onPress={onOpenLayout}>
                                <MapIcon size={14} color="#ffffff" />
                                <Text style={styles.layoutBtnText}>이 실험실 레이아웃 편집</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </ScrollView>

                <View style={styles.footer}>
                    {onDelete && (
                        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                            <Trash2 size={14} color="#dc2626" />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                        <Text style={styles.cancelBtnText}>취소</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                        onPress={handleSave}
                        disabled={saving}
                    >
                        <Save size={14} color="#ffffff" />
                        <Text style={styles.saveBtnText}>{saving ? '저장 중…' : '저장'}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f3f4f6' },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        padding: 14,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: 17, fontWeight: 'bold', color: '#1f2937' },
    subtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    body: { flex: 1 },
    bodyContent: { padding: 14, paddingBottom: 100 },
    label: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
        marginTop: 12,
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    helperText: { fontSize: 11, color: '#94a3b8', marginBottom: 6 },
    input: {
        backgroundColor: '#ffffff',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        color: '#1f2937',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
    row2: { flexDirection: 'row', gap: 8 },

    typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    typeChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#ffffff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    typeChipActive: { backgroundColor: '#0369a1', borderColor: '#0369a1' },
    typeChipEmoji: { fontSize: 14 },
    typeChipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
    typeChipTextActive: { color: '#ffffff' },

    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
    emptyChip: { fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' },
    featureChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: '#e0f2fe',
        borderRadius: 12,
    },
    featureChipText: { fontSize: 11, fontWeight: '600', color: '#0369a1' },
    addRow: { flexDirection: 'row', gap: 6 },
    smallInput: {
        flex: 1,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 12,
    },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#0369a1',
        borderRadius: 8,
    },
    addBtnText: { fontSize: 11, color: '#ffffff', fontWeight: '700' },

    sectionDivider: {
        fontSize: 13,
        fontWeight: '800',
        color: '#0f172a',
        marginTop: 18,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },

    layoutBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: '#b45309',
        padding: 12,
        borderRadius: 10,
        marginTop: 6,
    },
    layoutBtnText: { fontSize: 13, color: '#ffffff', fontWeight: '700' },

    footer: {
        flexDirection: 'row',
        gap: 8,
        padding: 12,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    deleteBtn: {
        width: 44,
        height: 44,
        borderRadius: 10,
        backgroundColor: '#fee2e2',
        alignItems: 'center',
        justifyContent: 'center',
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
    saveBtnText: { fontSize: 14, color: '#ffffff', fontWeight: '700' },
});
