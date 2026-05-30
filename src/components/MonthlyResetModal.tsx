/**
 * MonthlyResetModal — 매월 정기 큐 초기화
 *
 * 현재 지원:
 *  - 폐쇄망 알약: M)알약 온라인구분 = 폐쇄망 인 기기의 M)알약 현장조치에
 *    '폐쇄망조치필요'를 추가. 그러면 오프라인 Quick Task / 통합 큐 /
 *    과제 대시보드 모두에서 자동 매칭되어 이번 달 작업 대상으로 잡힘.
 *
 * 향후 시놀로지·분기백업 등도 같은 패턴으로 한 카드 안에서 가지치기 가능.
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
import { X, RefreshCw, Check, AlertTriangle } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import { HISTORY_FIELD_NAME, appendHistoryLine, getCurrentMonthLabel } from '../lib/quickTasks';

interface Props {
    visible: boolean;
    onClose: () => void;
    assets: Asset[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdate: (id: string, field: string, value: string, type: string) => Promise<void>;
}

const SITE_FIELD = 'M)알약 온라인구분';
const ACTION_FIELD = 'M)알약 현장조치';
const RESET_TAG = '폐쇄망조치필요';
const COMPLETED_TAG = '폐쇄망완료';

type Step = 'preview' | 'running' | 'done';

export const MonthlyResetModal: React.FC<Props> = ({
    visible,
    onClose,
    assets,
    schemaProperties,
    onUpdate,
}) => {
    const [step, setStep] = useState<Step>('preview');
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [doneSummary, setDoneSummary] = useState<{ marked: number; skipped: number } | null>(null);

    // 대상: 폐쇄망인 기기들
    const targets = useMemo(() => {
        return assets.filter(a => {
            const v = a.values as any;
            return String(v[SITE_FIELD] ?? '').includes('폐쇄망');
        });
    }, [assets]);

    // 분류
    const { alreadyMarked, willBeMarked } = useMemo(() => {
        const already: Asset[] = [];
        const will: Asset[] = [];
        for (const a of targets) {
            const cur = String((a.values as any)[ACTION_FIELD] ?? '');
            const opts = cur.split(',').map(s => s.trim()).filter(Boolean);
            if (opts.includes(RESET_TAG)) already.push(a);
            else will.push(a);
        }
        return { alreadyMarked: already, willBeMarked: will };
    }, [targets]);

    const handleClose = useCallback(() => {
        setStep('preview');
        setProgress({ current: 0, total: 0 });
        setDoneSummary(null);
        onClose();
    }, [onClose]);

    const handleRun = useCallback(async () => {
        if (willBeMarked.length === 0) {
            Alert.alert('처리할 대상 없음', '모든 폐쇄망 기기가 이미 마킹되어 있어요.');
            return;
        }
        const actionType = schemaProperties[ACTION_FIELD]?.type || 'multi_select';
        setStep('running');
        setProgress({ current: 0, total: willBeMarked.length });
        const monthLabel = getCurrentMonthLabel();
        let marked = 0;
        for (let i = 0; i < willBeMarked.length; i++) {
            const a = willBeMarked[i];
            const cur = String((a.values as any)[ACTION_FIELD] ?? '');
            const opts = cur.split(',').map(s => s.trim()).filter(Boolean);
            // 폐쇄망완료가 남아 있으면 이번 달엔 다시 안 보이도록 제거 (사이클 깔끔)
            const cleaned = opts.filter(o => o !== COMPLETED_TAG);
            if (!cleaned.includes(RESET_TAG)) cleaned.push(RESET_TAG);
            const next = cleaned.join(', ');
            try {
                await onUpdate(a.id, ACTION_FIELD, next, actionType);
                // 처리이력 한 줄
                const histExisting = String((a.values as any)[HISTORY_FIELD_NAME] ?? '');
                const histLabel = `${monthLabel} 폐쇄망 큐 초기화 (폐쇄망조치필요 마킹)`;
                await onUpdate(a.id, HISTORY_FIELD_NAME, appendHistoryLine(histExisting, histLabel), 'rich_text');
                marked++;
            } catch (e) {
                console.error('[MonthlyReset] 실패:', a.id, e);
            }
            setProgress({ current: i + 1, total: willBeMarked.length });
        }
        setDoneSummary({ marked, skipped: alreadyMarked.length });
        setStep('done');
    }, [willBeMarked, alreadyMarked.length, onUpdate, schemaProperties]);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>월간 초기화</Text>
                        <Text style={styles.subtitle}>{getCurrentMonthLabel()} 폐쇄망 큐 시작</Text>
                    </View>
                    <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                        <X size={20} color="#475569" />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    {step === 'preview' && (
                        <>
                            <View style={styles.intro}>
                                <Text style={styles.introTitle}>이번 달 폐쇄망 사이클을 시작합니다</Text>
                                <Text style={styles.introBody}>
                                    M)알약 온라인구분이 '폐쇄망'인 기기의 M)알약 현장조치에
                                    '폐쇄망조치필요'를 추가해요. 그러면 오프라인 알약 Quick Task /
                                    통합 큐 / 과제 대시보드에서 자동으로 잡혀요. 현장에서 ✓ 완료
                                    누르면 폐쇄망조치필요가 제거되고 폐쇄망완료로 바뀝니다.
                                </Text>
                            </View>

                            <View style={styles.statsRow}>
                                <View style={[styles.statBox, { backgroundColor: '#fef3c7' }]}>
                                    <Text style={[styles.statNum, { color: '#b45309' }]}>{targets.length}</Text>
                                    <Text style={styles.statLabel}>폐쇄망 기기</Text>
                                </View>
                                <View style={[styles.statBox, { backgroundColor: '#dcfce7' }]}>
                                    <Text style={[styles.statNum, { color: '#15803d' }]}>{willBeMarked.length}</Text>
                                    <Text style={styles.statLabel}>마킹 예정</Text>
                                </View>
                                <View style={[styles.statBox, { backgroundColor: '#f1f5f9' }]}>
                                    <Text style={[styles.statNum, { color: '#475569' }]}>{alreadyMarked.length}</Text>
                                    <Text style={styles.statLabel}>이미 마킹됨</Text>
                                </View>
                            </View>

                            <View style={styles.noticeBox}>
                                <AlertTriangle size={14} color="#92400e" />
                                <Text style={styles.noticeText}>
                                    '폐쇄망완료'가 남아 있는 기기는 이번 사이클에서 그 마킹이 제거돼요.
                                    필요 시 처리이력으로 추적 가능합니다.
                                </Text>
                            </View>

                            <Text style={styles.sectionLabel}>마킹 예정 ({willBeMarked.length}대)</Text>
                            {willBeMarked.slice(0, 50).map(a => (
                                <Text key={a.id} style={styles.itemLine}>
                                    · {(a.values as any)['Name'] ?? '(이름 없음)'}
                                    {(a.values as any)['L)연구실'] ? ` · ${(a.values as any)['L)연구실']}` : ''}
                                </Text>
                            ))}
                            {willBeMarked.length > 50 && (
                                <Text style={styles.helperText}>… 외 {willBeMarked.length - 50}대</Text>
                            )}
                        </>
                    )}

                    {step === 'running' && (
                        <View style={styles.runningBox}>
                            <RefreshCw size={32} color="#a16207" />
                            <Text style={styles.runningTitle}>마킹 중…</Text>
                            <Text style={styles.runningProgress}>
                                {progress.current} / {progress.total}
                            </Text>
                            <View style={styles.progressBar}>
                                <View
                                    style={[
                                        styles.progressFill,
                                        { width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` },
                                    ]}
                                />
                            </View>
                        </View>
                    )}

                    {step === 'done' && doneSummary && (
                        <View style={styles.doneBox}>
                            <View style={styles.doneIcon}>
                                <Check size={28} color="#15803d" />
                            </View>
                            <Text style={styles.doneTitle}>이번 달 사이클 시작 완료</Text>
                            <Text style={styles.doneStat}>
                                {doneSummary.marked}대 마킹 · {doneSummary.skipped}대 이미 마킹됨
                            </Text>
                            <Text style={styles.helperText}>
                                오프라인 알약 Quick Task / 통합 큐 / 과제 대시보드에서 확인하세요.
                            </Text>
                        </View>
                    )}
                </ScrollView>

                <View style={styles.footer}>
                    {step === 'preview' && (
                        <>
                            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                                <Text style={styles.cancelBtnText}>취소</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.runBtn, willBeMarked.length === 0 && styles.runBtnDisabled]}
                                onPress={handleRun}
                                disabled={willBeMarked.length === 0}
                            >
                                <Text style={styles.runBtnText}>
                                    {willBeMarked.length === 0
                                        ? '대상 없음'
                                        : `${willBeMarked.length}대 마킹`}
                                </Text>
                            </TouchableOpacity>
                        </>
                    )}
                    {step === 'done' && (
                        <TouchableOpacity style={styles.runBtn} onPress={handleClose}>
                            <Text style={styles.runBtnText}>닫기</Text>
                        </TouchableOpacity>
                    )}
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
    title: { fontSize: 17, fontWeight: 'bold', color: '#a16207' },
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

    intro: { gap: 6, marginBottom: 14 },
    introTitle: { fontSize: 14, fontWeight: '700', color: '#1f2937' },
    introBody: { fontSize: 12, color: '#475569', lineHeight: 18 },

    statsRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
    statBox: {
        flex: 1,
        padding: 12,
        borderRadius: 10,
        alignItems: 'center',
    },
    statNum: { fontSize: 22, fontWeight: 'bold' },
    statLabel: { fontSize: 10, color: '#475569', marginTop: 2 },

    noticeBox: {
        flexDirection: 'row',
        gap: 8,
        backgroundColor: '#fef3c7',
        padding: 10,
        borderRadius: 10,
        marginBottom: 12,
    },
    noticeText: { flex: 1, fontSize: 11, color: '#92400e', lineHeight: 16 },

    sectionLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
        marginTop: 4,
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    itemLine: { fontSize: 12, color: '#1f2937', paddingVertical: 2 },
    helperText: { fontSize: 11, color: '#94a3b8', marginTop: 6 },

    runningBox: { alignItems: 'center', padding: 30, gap: 10 },
    runningTitle: { fontSize: 15, fontWeight: '700', color: '#1f2937' },
    runningProgress: { fontSize: 13, color: '#a16207', fontWeight: '700' },
    progressBar: {
        width: '100%',
        height: 8,
        backgroundColor: '#e5e7eb',
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: '#a16207' },

    doneBox: { alignItems: 'center', padding: 30, gap: 8 },
    doneIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#dcfce7',
        alignItems: 'center',
        justifyContent: 'center',
    },
    doneTitle: { fontSize: 16, fontWeight: 'bold', color: '#15803d' },
    doneStat: { fontSize: 12, color: '#475569' },

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
    runBtn: {
        flex: 2,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#a16207',
        alignItems: 'center',
    },
    runBtnDisabled: { backgroundColor: '#cbd5e1' },
    runBtnText: { fontSize: 14, color: '#ffffff', fontWeight: '700' },
});
