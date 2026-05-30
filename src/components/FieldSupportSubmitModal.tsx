/**
 * FieldSupportSubmitModal — 특정 기기의 현장지원 접수를 등록
 *
 * 흐름:
 * 1. 기기 검색 (Name 자동완성, 기존 자산 중에서)
 * 2. 요청자 입력
 * 3. 문제 내용 입력 (멀티라인)
 * 4. 접수 → 그 기기의 M)현장지원 상태 = '요청' + 메모 prepend + 처리이력 누적
 *
 * 등록되면 자동으로 '현장지원' Quick Task 매칭에 들어가서
 * 통합 큐 / 과제 대시보드에 표시됩니다.
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
    Alert,
} from 'react-native';
import { X, Search, Check, AlertTriangle } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import {
    FIELD_SUPPORT_STATUS_FIELD,
    FIELD_SUPPORT_MEMO_FIELD,
    HISTORY_FIELD_NAME,
    appendHistoryLine,
} from '../lib/quickTasks';

interface Props {
    visible: boolean;
    onClose: () => void;
    assets: Asset[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdate: (id: string, field: string, value: string, type: string) => Promise<void>;
}

export const FieldSupportSubmitModal: React.FC<Props> = ({
    visible,
    onClose,
    assets,
    schemaProperties,
    onUpdate,
}) => {
    const [search, setSearch] = useState('');
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [requester, setRequester] = useState('');
    const [problem, setProblem] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const titleField = useMemo(() => {
        return Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name';
    }, [schemaProperties]);

    const searchResults = useMemo(() => {
        if (!search.trim() || selectedAsset) return [];
        const q = search.toLowerCase();
        return assets
            .filter(a => {
                const name = String((a.values as any)[titleField] ?? '').toLowerCase();
                const host = String((a.values as any)['PC Hostname'] ?? '').toLowerCase();
                return name.includes(q) || host.includes(q);
            })
            .slice(0, 10);
    }, [search, selectedAsset, assets, titleField]);

    const resetAll = useCallback(() => {
        setSearch('');
        setSelectedAsset(null);
        setRequester('');
        setProblem('');
    }, []);

    const handleClose = useCallback(() => {
        resetAll();
        onClose();
    }, [resetAll, onClose]);

    const handleSubmit = useCallback(async () => {
        if (!selectedAsset) return;
        if (!problem.trim()) {
            Alert.alert('필수 입력', '문제 내용은 꼭 적어주세요.');
            return;
        }
        setSubmitting(true);
        try {
            const date = new Date().toISOString().slice(0, 10);
            const reqLabel = requester.trim() ? `요청: ${requester.trim()}` : '요청자 미상';
            const memoLine = `[${date}] ${reqLabel} · 내용: ${problem.trim()}`;
            const existingMemo = String((selectedAsset.values as any)[FIELD_SUPPORT_MEMO_FIELD] ?? '');
            const nextMemo = existingMemo ? `${memoLine}\n${existingMemo}` : memoLine;

            await Promise.all([
                onUpdate(selectedAsset.id, FIELD_SUPPORT_STATUS_FIELD, '요청', 'select'),
                onUpdate(selectedAsset.id, FIELD_SUPPORT_MEMO_FIELD, nextMemo, 'rich_text'),
            ]);

            // 처리이력에도 한 줄
            const existingHistory = String((selectedAsset.values as any)[HISTORY_FIELD_NAME] ?? '');
            const historyLine = `현장지원 접수 · ${reqLabel} · ${problem.trim().slice(0, 40)}${problem.trim().length > 40 ? '…' : ''}`;
            await onUpdate(
                selectedAsset.id,
                HISTORY_FIELD_NAME,
                appendHistoryLine(existingHistory, historyLine),
                'rich_text'
            );

            Alert.alert('접수 완료', '통합 작업큐와 과제 대시보드에 자동으로 추가됐어요.');
            resetAll();
            onClose();
        } catch (e) {
            console.error('[FieldSupport] 접수 실패:', e);
            Alert.alert('오류', '접수 중 문제가 발생했습니다.');
        } finally {
            setSubmitting(false);
        }
    }, [selectedAsset, requester, problem, onUpdate, resetAll, onClose]);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>현장지원 접수</Text>
                        <Text style={styles.subtitle}>고장 · 불편 · 사용자 요청 사항</Text>
                    </View>
                    <TouchableOpacity onPress={handleClose}>
                        <X size={22} color="#6b7280" />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    {/* 1. 기기 선택 */}
                    <Text style={styles.label}>1. 대상 기기</Text>
                    {selectedAsset ? (
                        <View style={styles.selectedAsset}>
                            <Check size={14} color="#15803d" />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.selectedName}>
                                    {(selectedAsset.values as any)[titleField] ?? '(이름 없음)'}
                                </Text>
                                <Text style={styles.selectedSub}>
                                    {[
                                        (selectedAsset.values as any)['L)건물'],
                                        (selectedAsset.values as any)['L)층'],
                                        (selectedAsset.values as any)['L)연구실'],
                                    ].filter(Boolean).join(' · ')}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => { setSelectedAsset(null); setSearch(''); }}>
                                <Text style={styles.changeBtn}>변경</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <>
                            <View style={styles.searchBox}>
                                <Search size={16} color="#94a3b8" />
                                <TextInput
                                    style={styles.searchInput}
                                    value={search}
                                    onChangeText={setSearch}
                                    placeholder="기기명 또는 호스트네임 검색"
                                    placeholderTextColor="#94a3b8"
                                    autoFocus
                                />
                            </View>
                            {searchResults.length > 0 && (
                                <View style={styles.suggestList}>
                                    {searchResults.map(a => (
                                        <TouchableOpacity
                                            key={a.id}
                                            style={styles.suggestItem}
                                            onPress={() => { setSelectedAsset(a); setSearch(''); }}
                                        >
                                            <Text style={styles.suggestName}>
                                                {(a.values as any)[titleField] ?? '(이름 없음)'}
                                            </Text>
                                            <Text style={styles.suggestSub} numberOfLines={1}>
                                                {[
                                                    (a.values as any)['PC Hostname'],
                                                    (a.values as any)['L)건물'],
                                                    (a.values as any)['L)연구실'],
                                                ].filter(Boolean).join(' · ')}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}
                        </>
                    )}

                    {/* 2. 요청자 */}
                    <Text style={styles.label}>2. 요청자 (선택)</Text>
                    <TextInput
                        style={styles.input}
                        value={requester}
                        onChangeText={setRequester}
                        placeholder="이름 / 소속 / 연락처 등"
                        placeholderTextColor="#94a3b8"
                    />

                    {/* 3. 문제 내용 */}
                    <Text style={styles.label}>3. 문제 내용 *</Text>
                    <TextInput
                        style={[styles.input, styles.inputMultiline]}
                        value={problem}
                        onChangeText={setProblem}
                        placeholder="어떤 증상인지, 언제 발생했는지, 재현 방법 등"
                        placeholderTextColor="#94a3b8"
                        multiline
                    />

                    <View style={styles.noticeBox}>
                        <AlertTriangle size={14} color="#b45309" />
                        <Text style={styles.noticeText}>
                            접수하면 그 기기의 'M)현장지원 상태'가 '요청'으로 설정되고
                            메모와 처리이력에 자동 기록됩니다. 현장에서 카드의 ✓ 완료 시
                            상태가 '완료'로 바뀌면서 통합 큐에서 빠져요.
                        </Text>
                    </View>
                </ScrollView>

                <View style={styles.footer}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                        <Text style={styles.cancelBtnText}>취소</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[
                            styles.submitBtn,
                            (!selectedAsset || !problem.trim() || submitting) && styles.submitBtnDisabled,
                        ]}
                        onPress={handleSubmit}
                        disabled={!selectedAsset || !problem.trim() || submitting}
                    >
                        <Text style={styles.submitBtnText}>
                            {submitting ? '접수 중…' : '접수하기'}
                        </Text>
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
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 14,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: 18, fontWeight: 'bold', color: '#dc2626' },
    subtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
    body: { flex: 1 },
    bodyContent: { padding: 14, paddingBottom: 100 },
    label: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
        marginTop: 14,
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    selectedAsset: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#dcfce7',
        padding: 10,
        borderRadius: 10,
    },
    selectedName: { fontSize: 14, fontWeight: '700', color: '#15803d' },
    selectedSub: { fontSize: 11, color: '#15803d', marginTop: 2 },
    changeBtn: { fontSize: 12, color: '#15803d', fontWeight: '700' },

    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#ffffff',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    searchInput: { flex: 1, fontSize: 13, color: '#1f2937', padding: 0 },
    suggestList: {
        marginTop: 6,
        backgroundColor: '#ffffff',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    suggestItem: {
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    suggestName: { fontSize: 13, fontWeight: '600', color: '#1f2937' },
    suggestSub: { fontSize: 11, color: '#64748b', marginTop: 2 },

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
    inputMultiline: { minHeight: 90, textAlignVertical: 'top' },

    noticeBox: {
        flexDirection: 'row',
        gap: 8,
        backgroundColor: '#fef3c7',
        padding: 10,
        borderRadius: 10,
        marginTop: 14,
    },
    noticeText: { flex: 1, fontSize: 11, color: '#92400e', lineHeight: 16 },

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
    submitBtn: {
        flex: 2,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#dc2626',
        alignItems: 'center',
    },
    submitBtnDisabled: { backgroundColor: '#cbd5e1' },
    submitBtnText: { fontSize: 14, color: '#ffffff', fontWeight: '700' },
});
