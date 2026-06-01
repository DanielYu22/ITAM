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
import { X, Save, Trash2, Plus, Map as MapIcon, Pencil } from 'lucide-react-native';
import {
    RoomInfo,
    RoomType,
    ROOM_TYPE_LABEL,
    ROOM_TYPE_EMOJI,
    ServerRoomInfo,
    MeetingRoomInfo,
} from '../lib/infrastructure';
import { CompanyInfo } from '../lib/companiesDb';
import {
    InfraAsset,
    INFRA_ASSET_CATEGORIES,
    InfraAssetCategory,
    INFRA_ASSET_STATUSES,
    InfraAssetStatus,
    CATEGORY_EMOJI,
} from '../lib/infrastructureAssetsDb';

interface Props {
    visible: boolean;
    onClose: () => void;
    room: RoomInfo & { occupantIds?: string[] };
    /** Notion 룸 row ID — 인프라 자산 relation 매칭용 */
    roomId?: string;
    /** UI 표시용 경로 */
    building: string;
    floor: string;
    /** 입주사 마스터 (relation 선택용) */
    companies?: CompanyInfo[];
    /** 이 룸에 연결된 인프라 자산 목록 (이미 필터된 상태) */
    infraAssets?: InfraAsset[];
    onSave: (next: RoomInfo & { occupantIds?: string[] }) => Promise<void>;
    onDelete?: () => Promise<void>;
    onOpenLayout?: () => void;
    /** 인프라 자산 CRUD — App.tsx 에서 주입 */
    onCreateInfraAsset?: (input: Partial<InfraAsset> & { name: string }) => Promise<void>;
    onUpdateInfraAsset?: (id: string, patch: Partial<InfraAsset>) => Promise<void>;
    onArchiveInfraAsset?: (id: string) => Promise<void>;
}

const ROOM_TYPES: RoomType[] = ['lab', 'server-room', 'office', 'meeting-room', 'other'];

const MEETING_EQUIP_PRESETS = ['TV', '스크린', '화상회의', '전화회의', '프로젝터', '음향'];

export const RoomEditDialog: React.FC<Props> = ({
    visible,
    onClose,
    room,
    roomId,
    building,
    floor,
    companies,
    infraAssets,
    onSave,
    onDelete,
    onOpenLayout,
    onCreateInfraAsset,
    onUpdateInfraAsset,
    onArchiveInfraAsset,
}) => {
    // 인프라 자산 인라인 편집 상태
    const [editingAsset, setEditingAsset] = useState<InfraAsset | 'new' | null>(null);
    const [assetForm, setAssetForm] = useState<Partial<InfraAsset>>({});
    const [name, setName] = useState(room.name);
    const [type, setType] = useState<RoomType>(room.type || 'lab');
    const [notes, setNotes] = useState(room.notes || '');
    const [features, setFeatures] = useState<string[]>(room.features || []);
    const [featureInput, setFeatureInput] = useState('');
    const [occupantIds, setOccupantIds] = useState<string[]>(room.occupantIds || []);
    const [assignedTeam, setAssignedTeam] = useState(room.assignedTeam || '');
    const [server, setServer] = useState<ServerRoomInfo>(room.serverRoom || {});
    const [equipmentInput, setEquipmentInput] = useState('');
    const [meeting, setMeeting] = useState<MeetingRoomInfo>(room.meetingRoom || {});
    const [meetingEquipInput, setMeetingEquipInput] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setName(room.name);
        setType(room.type || 'lab');
        setNotes(room.notes || '');
        setFeatures(room.features || []);
        setOccupantIds(room.occupantIds || []);
        setAssignedTeam(room.assignedTeam || '');
        setServer(room.serverRoom || {});
        setMeeting(room.meetingRoom || {});
        setFeatureInput('');
        setEquipmentInput('');
        setMeetingEquipInput('');
    }, [visible, room]);

    const toggleMeetingEquip = (v: string) => {
        const list = meeting.equipment || [];
        const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
        setMeeting(prev => ({ ...prev, equipment: next.length ? next : undefined }));
    };
    const addMeetingEquip = () => {
        const v = meetingEquipInput.trim();
        if (!v) return;
        const list = meeting.equipment || [];
        if (list.includes(v)) { setMeetingEquipInput(''); return; }
        setMeeting(prev => ({ ...prev, equipment: [...list, v] }));
        setMeetingEquipInput('');
    };

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
            const next: RoomInfo & { occupantIds?: string[] } = {
                ...room,
                name: name.trim(),
                type,
                notes: notes.trim() || undefined,
                features: features.length > 0 ? features : undefined,
                occupantIds,  // Phase B: 입주사 relation ids
                assignedTeam: assignedTeam.trim() || undefined,
                serverRoom: type === 'server-room' && Object.keys(server).length > 0 ? server : undefined,
                meetingRoom: type === 'meeting-room' && Object.keys(meeting).length > 0 ? meeting : undefined,
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
        <>
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

                    {/* 입주사 (multi-relation) */}
                    <Text style={styles.label}>입주사 (복수 선택)</Text>
                    {(!companies || companies.length === 0) ? (
                        <Text style={styles.helperText}>입주사 목록 로딩 중…</Text>
                    ) : (
                        <View style={styles.chipsRow}>
                            {companies
                                .slice()
                                .sort((a, b) => {
                                    // 입주완료 우선, 그 다음 입주예정, 희망
                                    const order = { '입주완료': 0, '입주예정': 1, '희망': 2 } as Record<string, number>;
                                    return (order[a.phase || ''] ?? 9) - (order[b.phase || ''] ?? 9)
                                        || a.name.localeCompare(b.name, 'ko');
                                })
                                .map(c => {
                                    const on = occupantIds.includes(c.id);
                                    return (
                                        <TouchableOpacity
                                            key={c.id}
                                            style={[styles.companyChip, on && styles.companyChipOn,
                                                c.phase === '희망' && styles.companyChipHope]}
                                            onPress={() => {
                                                setOccupantIds(prev => on ? prev.filter(x => x !== c.id) : [...prev, c.id]);
                                            }}
                                        >
                                            <Text style={[styles.companyChipText, on && styles.companyChipTextOn]}>
                                                {c.name}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                        </View>
                    )}

                    {/* 할당팀 */}
                    <Text style={styles.label}>할당팀</Text>
                    <TextInput
                        style={styles.input}
                        value={assignedTeam}
                        onChangeText={setAssignedTeam}
                        placeholder="예: CMC2팀"
                        placeholderTextColor="#94a3b8"
                    />

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

                    {/* 미팅룸 전용 필드 */}
                    {type === 'meeting-room' && (
                        <>
                            <Text style={styles.sectionDivider}>🤝 미팅룸 정보</Text>

                            <View style={styles.row2}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.label}>정원</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={meeting.capacity?.toString() || ''}
                                        onChangeText={(v) => setMeeting(prev => ({ ...prev, capacity: v ? parseInt(v, 10) || undefined : undefined }))}
                                        placeholder="0"
                                        placeholderTextColor="#94a3b8"
                                        keyboardType="numeric"
                                    />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.label}>평수</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={meeting.areaPyung?.toString() || ''}
                                        onChangeText={(v) => setMeeting(prev => ({ ...prev, areaPyung: v ? parseFloat(v) || undefined : undefined }))}
                                        placeholder="0"
                                        placeholderTextColor="#94a3b8"
                                        keyboardType="numeric"
                                    />
                                </View>
                            </View>

                            <Text style={styles.label}>장비</Text>
                            <Text style={styles.helperText}>탭하면 켜짐/꺼짐 토글. 없는 항목은 직접 추가</Text>
                            <View style={styles.chipsRow}>
                                {MEETING_EQUIP_PRESETS.map(eq => {
                                    const on = (meeting.equipment || []).includes(eq);
                                    return (
                                        <TouchableOpacity
                                            key={eq}
                                            style={[styles.equipChip, on && styles.equipChipOn]}
                                            onPress={() => toggleMeetingEquip(eq)}
                                        >
                                            <Text style={[styles.equipChipText, on && styles.equipChipTextOn]}>{eq}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                                {(meeting.equipment || []).filter(e => !MEETING_EQUIP_PRESETS.includes(e)).map(eq => (
                                    <View key={eq} style={[styles.equipChip, styles.equipChipOn]}>
                                        <Text style={[styles.equipChipText, styles.equipChipTextOn]}>{eq}</Text>
                                        <TouchableOpacity onPress={() => toggleMeetingEquip(eq)} style={{ marginLeft: 4 }}>
                                            <X size={10} color="#ffffff" />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                            <View style={styles.addRow}>
                                <TextInput
                                    style={styles.smallInput}
                                    value={meetingEquipInput}
                                    onChangeText={setMeetingEquipInput}
                                    onSubmitEditing={addMeetingEquip}
                                    placeholder="기타 장비"
                                    placeholderTextColor="#94a3b8"
                                />
                                <TouchableOpacity
                                    style={[styles.addBtn, !meetingEquipInput.trim() && { opacity: 0.4 }]}
                                    onPress={addMeetingEquip}
                                    disabled={!meetingEquipInput.trim()}
                                >
                                    <Plus size={12} color="#ffffff" />
                                    <Text style={styles.addBtnText}>추가</Text>
                                </TouchableOpacity>
                            </View>

                            <Text style={styles.label}>예약 시스템 코드</Text>
                            <TextInput
                                style={styles.input}
                                value={meeting.reservationCode || ''}
                                onChangeText={(v) => setMeeting(prev => ({ ...prev, reservationCode: v }))}
                                placeholder="예: W401, E501, 컨퍼런스룸1"
                                placeholderTextColor="#94a3b8"
                            />

                            <Text style={styles.label}>예약 페이지 URL (선택)</Text>
                            <TextInput
                                style={styles.input}
                                value={meeting.bookingUrl || ''}
                                onChangeText={(v) => setMeeting(prev => ({ ...prev, bookingUrl: v }))}
                                placeholder="https://gw.idstrust.com/..."
                                placeholderTextColor="#94a3b8"
                                autoCapitalize="none"
                            />
                        </>
                    )}

                    {/* 인프라 자산 (서버/스위치/방화벽 등) — 서버실/기타에 주로 노출 */}
                    {(type === 'server-room' || type === 'other' || (infraAssets && infraAssets.length > 0)) && (
                        <>
                            <Text style={styles.sectionDivider}>🔧 이 룸의 장비 {infraAssets && infraAssets.length > 0 && `(${infraAssets.length})`}</Text>
                            {(!infraAssets || infraAssets.length === 0) ? (
                                <Text style={styles.helperText}>아직 등록된 장비가 없어요</Text>
                            ) : (
                                <View style={{ gap: 4 }}>
                                    {infraAssets.map(a => (
                                        <TouchableOpacity
                                            key={a.id}
                                            style={styles.assetRow}
                                            onPress={() => {
                                                setEditingAsset(a);
                                                setAssetForm({ ...a });
                                            }}
                                        >
                                            <Text style={styles.assetEmoji}>{a.category ? CATEGORY_EMOJI[a.category] : '🔌'}</Text>
                                            <View style={{ flex: 1, minWidth: 0 }}>
                                                <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                                                {(a.model || a.ip) && (
                                                    <Text style={styles.assetMeta} numberOfLines={1}>
                                                        {a.model}{a.model && a.ip ? ' · ' : ''}{a.ip}
                                                    </Text>
                                                )}
                                            </View>
                                            {a.status && a.status !== '운영중' && (
                                                <Text style={[
                                                    styles.assetStatus,
                                                    a.status === '이전됨' && { backgroundColor: '#fce7f3', color: '#9d174d' },
                                                    a.status === 'EOL' && { backgroundColor: '#fee2e2', color: '#991b1b' },
                                                ]}>
                                                    {a.status}
                                                </Text>
                                            )}
                                            <Pencil size={10} color="#cbd5e1" />
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}
                            {onCreateInfraAsset && roomId && (
                                <TouchableOpacity
                                    style={styles.assetAddBtn}
                                    onPress={() => {
                                        setEditingAsset('new');
                                        setAssetForm({ status: '운영중' });
                                    }}
                                >
                                    <Plus size={12} color="#475569" />
                                    <Text style={styles.assetAddText}>장비 추가</Text>
                                </TouchableOpacity>
                            )}
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

        {/* 인프라 자산 편집/추가 sub-modal */}
        <Modal
            visible={editingAsset !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setEditingAsset(null)}
        >
            <View style={styles.assetOverlay}>
                <View style={styles.assetCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                        <Text style={styles.assetCardTitle}>
                            {editingAsset === 'new' ? '🔧 장비 추가' : '🔧 장비 편집'}
                        </Text>
                        <View style={{ flex: 1 }} />
                        <TouchableOpacity onPress={() => setEditingAsset(null)}>
                            <X size={18} color="#475569" />
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={{ maxHeight: 480 }}>
                        <Text style={styles.label}>장비명 *</Text>
                        <TextInput
                            style={styles.input}
                            value={assetForm.name || ''}
                            onChangeText={(v) => setAssetForm(prev => ({ ...prev, name: v }))}
                            placeholder="예: DW_BIO_BB_1"
                            placeholderTextColor="#94a3b8"
                            autoFocus={editingAsset === 'new'}
                        />

                        <Text style={styles.label}>카테고리</Text>
                        <View style={[styles.chipsRow, { marginBottom: 0 }]}>
                            {INFRA_ASSET_CATEGORIES.map(c => {
                                const on = assetForm.category === c;
                                return (
                                    <TouchableOpacity
                                        key={c}
                                        style={[styles.companyChip, on && styles.companyChipOn]}
                                        onPress={() => setAssetForm(prev => ({ ...prev, category: on ? undefined : c }))}
                                    >
                                        <Text style={[styles.companyChipText, on && styles.companyChipTextOn]}>
                                            {CATEGORY_EMOJI[c]} {c}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <Text style={styles.label}>모델</Text>
                        <TextInput
                            style={styles.input}
                            value={assetForm.model || ''}
                            onChangeText={(v) => setAssetForm(prev => ({ ...prev, model: v }))}
                            placeholder="예: Cisco C9500-16X-E"
                            placeholderTextColor="#94a3b8"
                        />

                        <View style={styles.row2}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>IP</Text>
                                <TextInput
                                    style={styles.input}
                                    value={assetForm.ip || ''}
                                    onChangeText={(v) => setAssetForm(prev => ({ ...prev, ip: v }))}
                                    placeholder="192.168.244.1"
                                    placeholderTextColor="#94a3b8"
                                    autoCapitalize="none"
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>MAC</Text>
                                <TextInput
                                    style={styles.input}
                                    value={assetForm.mac || ''}
                                    onChangeText={(v) => setAssetForm(prev => ({ ...prev, mac: v }))}
                                    placeholder="aa:bb:cc:..."
                                    placeholderTextColor="#94a3b8"
                                    autoCapitalize="none"
                                />
                            </View>
                        </View>

                        <Text style={styles.label}>시리얼</Text>
                        <TextInput
                            style={styles.input}
                            value={assetForm.serial || ''}
                            onChangeText={(v) => setAssetForm(prev => ({ ...prev, serial: v }))}
                            placeholder="S/N"
                            placeholderTextColor="#94a3b8"
                        />

                        <Text style={styles.label}>상태</Text>
                        <View style={[styles.chipsRow, { marginBottom: 0 }]}>
                            {INFRA_ASSET_STATUSES.map(s => {
                                const on = assetForm.status === s;
                                return (
                                    <TouchableOpacity
                                        key={s}
                                        style={[styles.companyChip, on && styles.companyChipOn]}
                                        onPress={() => setAssetForm(prev => ({ ...prev, status: on ? undefined : s }))}
                                    >
                                        <Text style={[styles.companyChipText, on && styles.companyChipTextOn]}>{s}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <Text style={styles.label}>메모</Text>
                        <TextInput
                            style={[styles.input, styles.inputMultiline]}
                            value={assetForm.note || ''}
                            onChangeText={(v) => setAssetForm(prev => ({ ...prev, note: v }))}
                            placeholder="역할, 특이사항, 이전 이력 등"
                            placeholderTextColor="#94a3b8"
                            multiline
                        />
                    </ScrollView>
                    <View style={[styles.footer, { padding: 0, marginTop: 10, borderTopWidth: 0 }]}>
                        {editingAsset !== 'new' && onArchiveInfraAsset && (
                            <TouchableOpacity
                                style={styles.deleteBtn}
                                onPress={() => {
                                    if (typeof editingAsset === 'object' && editingAsset) {
                                        const a = editingAsset;
                                        Alert.alert('삭제 확인', `${a.name} 을(를) 삭제할까요?`, [
                                            { text: '취소', style: 'cancel' },
                                            { text: '삭제', style: 'destructive', onPress: async () => {
                                                await onArchiveInfraAsset(a.id);
                                                setEditingAsset(null);
                                            }},
                                        ]);
                                    }
                                }}
                            >
                                <Trash2 size={14} color="#dc2626" />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingAsset(null)}>
                            <Text style={styles.cancelBtnText}>취소</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.saveBtn}
                            onPress={async () => {
                                if (!assetForm.name?.trim()) {
                                    Alert.alert('이름 필수', '장비명을 입력해 주세요.'); return;
                                }
                                try {
                                    if (editingAsset === 'new' && onCreateInfraAsset && roomId) {
                                        await onCreateInfraAsset({
                                            name: assetForm.name.trim(),
                                            category: assetForm.category,
                                            model: assetForm.model,
                                            ip: assetForm.ip,
                                            mac: assetForm.mac,
                                            serial: assetForm.serial,
                                            status: assetForm.status,
                                            note: assetForm.note,
                                            roomIds: [roomId],
                                        });
                                    } else if (typeof editingAsset === 'object' && editingAsset && onUpdateInfraAsset) {
                                        await onUpdateInfraAsset(editingAsset.id, {
                                            name: assetForm.name.trim(),
                                            category: assetForm.category,
                                            model: assetForm.model,
                                            ip: assetForm.ip,
                                            mac: assetForm.mac,
                                            serial: assetForm.serial,
                                            status: assetForm.status,
                                            note: assetForm.note,
                                        });
                                    }
                                    setEditingAsset(null);
                                } catch (e) {
                                    Alert.alert('저장 실패', '잠시 후 다시 시도하세요.');
                                }
                            }}
                        >
                            <Save size={14} color="#ffffff" />
                            <Text style={styles.saveBtnText}>저장</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
        </>
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

    assetRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#ffffff',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    assetEmoji: { fontSize: 14 },
    assetName: { fontSize: 12, fontWeight: '700', color: '#1f2937' },
    assetMeta: { fontSize: 10, color: '#64748b', marginTop: 1 },
    assetStatus: {
        fontSize: 9,
        fontWeight: '700',
        paddingHorizontal: 5,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: '#e0f2fe',
        color: '#0369a1',
        overflow: 'hidden',
    },
    assetAddBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: 8,
        marginTop: 6,
        borderRadius: 8,
        backgroundColor: '#f1f5f9',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderStyle: 'dashed',
    },
    assetAddText: { fontSize: 11, fontWeight: '700', color: '#475569' },
    assetOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    assetCard: {
        width: '100%',
        maxWidth: 420,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 16,
    },
    assetCardTitle: { fontSize: 14, fontWeight: '800', color: '#1f2937' },

    companyChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        backgroundColor: '#f1f5f9',
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    companyChipOn: { backgroundColor: '#0369a1', borderColor: '#0369a1' },
    companyChipHope: { borderStyle: 'dashed', opacity: 0.85 },
    companyChipText: { fontSize: 11, fontWeight: '600', color: '#475569' },
    companyChipTextOn: { color: '#ffffff' },

    equipChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        backgroundColor: '#f1f5f9',
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    equipChipOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
    equipChipText: { fontSize: 11, fontWeight: '700', color: '#475569' },
    equipChipTextOn: { color: '#ffffff' },

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
