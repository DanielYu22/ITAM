/**
 * MonthlyResetModal (정기 초기화) — 사이클 큐 일괄 마킹
 *
 * 사용자가 매월/매분기 정기적으로 일을 다시 시작할 때 큐를 초기화.
 *
 * 지원 사이클:
 *  - 폐쇄망 알약 (월간): M)알약 온라인구분=폐쇄망 인 기기의
 *    M)알약 현장조치에 '폐쇄망조치필요' 추가
 *  - IT/현장백업 (분기): QA)백업 방법 contains IT/현장백업 인 기기의
 *    M)분기백업 상태에 '백업필요' 추가
 *
 * 같은 패턴: 처리 완료 표시는 따로 두고, 영구 분류 필드는 절대 건드리지 않음.
 * 큐 매칭은 'XX필요' 태그가 있을 때만, 완료 시 'XX필요' 제거 + 'XX완료' 추가.
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
import { X, RefreshCw, Check, AlertTriangle, ChevronRight, ArrowLeft } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import {
    HISTORY_FIELD_NAME,
    BACKUP_STATUS_FIELD,
    appendHistoryLine,
    getCurrentMonthLabel,
    getCurrentQuarterLabel,
    ALYAK_STATUS_NORMAL,
} from '../lib/quickTasks';
import { SiteDef, SiteId, SITES_DEFAULTS } from '../lib/sites';

interface Props {
    visible: boolean;
    onClose: () => void;
    assets: Asset[];
    /** Phase 1 픽스: 사이트 컨텍스트 표시 + 라벨 */
    currentSite?: SiteId;
    effectiveSites?: SiteDef[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdate: (id: string, field: string, value: string, type: string) => Promise<void>;
}

type Step = 'select' | 'preview' | 'running' | 'done';
type CycleId = 'closed-network' | 'quarterly-backup' | 'alyak-status-check';

// Phase 1 픽스: '미등록'은 별도 흐름이지만 사이클 마킹 대상에서 제외하기 위해
// 정상으로 취급. quickTasks.ts 의 ALYAK_STATUS_NORMAL 에 '미등록' 포함하지 않으므로
// 여기 한 줄로 보강 (사이클 전용 화이트리스트).
const ALYAK_STATUS_NORMAL_RESET = [...ALYAK_STATUS_NORMAL, '미등록'];

// ---------------------------------------------------------------------------
// 사이클 정의 — 새 사이클은 여기 한 곳에만 추가하면 됨
// ---------------------------------------------------------------------------

interface CycleDef {
    id: CycleId;
    title: string;
    badge: string;        // '월간 - 5월' 같은 시점 라벨 — getter
    emoji: string;
    color: string;
    bgColor: string;
    description: string;
    // 대상 자산 — 영구 분류 컬럼으로 판단
    targetFilter: (asset: Asset) => boolean;
    // 작업 상태 컬럼명
    statusField: string;
    // '...필요' 태그
    needTag: string;
    // '...완료' 태그 — 사이클 시작 시 이게 남아 있으면 제거
    completedTag: string;
    // 처리이력 라벨 (사이클 시작 시 한 줄)
    historyLabel: (now: Date) => string;
}

const CYCLE_DEFS: CycleDef[] = [
    {
        id: 'closed-network',
        title: '폐쇄망 알약 (월간)',
        get badge() { return `월간 · ${getCurrentMonthLabel()}`; },
        emoji: '📴',
        color: '#a16207',
        bgColor: '#fef3c7',
        description: '폐쇄망 기기에 폐쇄망조치필요 마킹',
        targetFilter: (a) => String((a.values as any)['M)알약 온라인구분'] ?? '').includes('폐쇄망'),
        statusField: 'M)알약 현장조치',
        needTag: '폐쇄망조치필요',
        completedTag: '폐쇄망완료',
        historyLabel: (now) => `${getCurrentMonthLabel(now)} 폐쇄망 큐 초기화 (폐쇄망조치필요 마킹)`,
    },
    {
        id: 'quarterly-backup',
        title: 'IT/현장백업 (분기)',
        get badge() { return `분기 · ${getCurrentQuarterLabel()}`; },
        emoji: '💾',
        color: '#047857',
        bgColor: '#d1fae5',
        description: "IT/현장백업 분류 기기에 'IT현장 백업필요' 마킹",
        targetFilter: (a) => String((a.values as any)['QA)백업 방법'] ?? '').includes('IT/현장백업'),
        statusField: BACKUP_STATUS_FIELD,
        needTag: 'IT현장 백업필요',
        completedTag: 'IT현장 백업완료',
        historyLabel: (now) => `${getCurrentQuarterLabel(now)} 분기백업 큐 초기화 (IT현장 백업필요 마킹)`,
    },
    {
        id: 'alyak-status-check',
        title: '알약 온라인구분 점검 (월간)',
        get badge() { return `월간 · ${getCurrentMonthLabel()}`; },
        emoji: '❓',
        color: '#9333ea',
        bgColor: '#f3e8ff',
        description: '온라인구분이 비어있거나 비정상값인 기기에 점검 마킹',
        targetFilter: (a) => {
            const v = String((a.values as any)['M)알약 온라인구분'] ?? '').trim();
            // 빈 값이거나 정상값 list 에 없으면 점검 대상
            return v === '' || !ALYAK_STATUS_NORMAL_RESET.includes(v);
        },
        statusField: 'M)알약 현장조치',
        needTag: '온라인구분점검필요',
        completedTag: '온라인구분확인완료',
        historyLabel: (now) => `${getCurrentMonthLabel(now)} 알약 온라인구분 점검 큐 초기화`,
    },
];

export const MonthlyResetModal: React.FC<Props> = ({
    currentSite,
    effectiveSites,
    visible,
    onClose,
    assets,
    schemaProperties,
    onUpdate,
}) => {
    const [step, setStep] = useState<Step>('select');
    const [activeCycleId, setActiveCycleId] = useState<CycleId | null>(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [doneSummary, setDoneSummary] = useState<{ marked: number; skipped: number; cycle: CycleDef } | null>(null);

    const activeCycle = useMemo(
        () => CYCLE_DEFS.find(c => c.id === activeCycleId) || null,
        [activeCycleId]
    );

    // 사이클 선택 후 대상 분류
    const { allTargets, alreadyMarked, willBeMarked } = useMemo(() => {
        if (!activeCycle) return { allTargets: [], alreadyMarked: [], willBeMarked: [] };
        const targets = assets.filter(activeCycle.targetFilter);
        const already: Asset[] = [];
        const will: Asset[] = [];
        for (const a of targets) {
            const cur = String((a.values as any)[activeCycle.statusField] ?? '');
            const opts = cur.split(',').map(s => s.trim()).filter(Boolean);
            if (opts.includes(activeCycle.needTag)) already.push(a);
            else will.push(a);
        }
        return { allTargets: targets, alreadyMarked: already, willBeMarked: will };
    }, [activeCycle, assets]);

    // 각 사이클의 대상/마킹 예정 개수 (select 단계 카드 표시용)
    const cycleStats = useMemo(() => {
        const result: Record<CycleId, { total: number; pending: number }> = {} as any;
        for (const c of CYCLE_DEFS) {
            const targets = assets.filter(c.targetFilter);
            let pending = 0;
            for (const a of targets) {
                const cur = String((a.values as any)[c.statusField] ?? '');
                const opts = cur.split(',').map(s => s.trim()).filter(Boolean);
                if (!opts.includes(c.needTag)) pending++;
            }
            result[c.id] = { total: targets.length, pending };
        }
        return result;
    }, [assets]);

    const handleClose = useCallback(() => {
        setStep('select');
        setActiveCycleId(null);
        setProgress({ current: 0, total: 0 });
        setDoneSummary(null);
        onClose();
    }, [onClose]);

    const handleSelectCycle = useCallback((id: CycleId) => {
        setActiveCycleId(id);
        setStep('preview');
    }, []);

    const handleBackToSelect = useCallback(() => {
        setActiveCycleId(null);
        setStep('select');
    }, []);

    const handleRun = useCallback(async () => {
        if (!activeCycle) return;
        if (willBeMarked.length === 0) {
            Alert.alert('처리할 대상 없음', '모든 대상 기기가 이미 마킹되어 있어요.');
            return;
        }
        const statusType = schemaProperties[activeCycle.statusField]?.type || 'multi_select';
        setStep('running');
        setProgress({ current: 0, total: willBeMarked.length });
        const now = new Date();
        let marked = 0;
        let done = 0;

        // Phase 4: p-limit(3) 동시 + 429 backoff 재시도 (총 3회)
        const CONCURRENCY = 3;
        const RETRY_MAX = 3;
        const processOne = async (a: any) => {
            const cur = String((a.values as any)[activeCycle.statusField] ?? '');
            const opts = cur.split(',').map((s: string) => s.trim()).filter(Boolean);
            const cleaned = opts.filter((o: string) => o !== activeCycle.completedTag);
            if (!cleaned.includes(activeCycle.needTag)) cleaned.push(activeCycle.needTag);
            const next = cleaned.join(', ');
            const updateWithRetry = async (field: string, value: string, type: string) => {
                for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
                    try {
                        await onUpdate(a.id, field, value, type);
                        return true;
                    } catch (e: any) {
                        const msg = String(e?.message || e);
                        const is429 = msg.includes('429') || msg.includes('rate');
                        if (!is429 || attempt === RETRY_MAX - 1) {
                            console.error('[ResetCycle] 실패:', a.id, field, e);
                            return false;
                        }
                        // exponential backoff
                        await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
                    }
                }
                return false;
            };
            const okStatus = await updateWithRetry(activeCycle.statusField, next, statusType);
            const histExisting = String((a.values as any)[HISTORY_FIELD_NAME] ?? '');
            const okHist = await updateWithRetry(
                HISTORY_FIELD_NAME,
                appendHistoryLine(histExisting, activeCycle.historyLabel(now)),
                'rich_text',
            );
            if (okStatus) marked++;
            done++;
            setProgress({ current: done, total: willBeMarked.length });
        };

        // 청크 단위 병렬 처리
        for (let i = 0; i < willBeMarked.length; i += CONCURRENCY) {
            const chunk = willBeMarked.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(processOne));
        }
        setDoneSummary({ marked, skipped: alreadyMarked.length, cycle: activeCycle });
        setStep('done');
    }, [activeCycle, willBeMarked, alreadyMarked.length, onUpdate, schemaProperties]);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    {step === 'preview' ? (
                        <TouchableOpacity style={styles.closeBtn} onPress={handleBackToSelect}>
                            <ArrowLeft size={18} color="#475569" />
                        </TouchableOpacity>
                    ) : (
                        <View style={{ width: 32 }} />
                    )}
                    <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={styles.title}>정기 초기화</Text>
                        <Text style={styles.subtitle}>
                            {(() => {
                                const sd = (effectiveSites || SITES_DEFAULTS).find(s => s.id === currentSite);
                                const siteLabel = currentSite && currentSite !== 'all'
                                    ? `${sd?.emoji ? sd.emoji + ' ' : ''}${sd?.name || currentSite} · `
                                    : '';
                                const ctx = step === 'select'
                                    ? '큐 사이클 시작'
                                    : activeCycle?.title || '';
                                return `${siteLabel}${ctx}`;
                            })()}
                        </Text>
                    </View>
                    <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                        <X size={20} color="#475569" />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    {/* STEP: 사이클 선택 */}
                    {step === 'select' && (
                        <>
                            <Text style={styles.intro}>
                                매월/매분기 시즌 도래 시 처리 대상 기기를 일괄로 큐에 올립니다.
                                초기화하면 Quick Task / 통합 큐 / 과제 대시보드 모두에서 자동으로 잡혀요.
                            </Text>
                            {CYCLE_DEFS.map(c => {
                                const stat = cycleStats[c.id];
                                return (
                                    <TouchableOpacity
                                        key={c.id}
                                        style={[styles.cycleCard, { backgroundColor: c.bgColor }]}
                                        onPress={() => handleSelectCycle(c.id)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={styles.cycleHeader}>
                                            <Text style={styles.cycleEmoji}>{c.emoji}</Text>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.cycleTitle, { color: c.color }]}>{c.title}</Text>
                                                <Text style={styles.cycleBadge}>{c.badge}</Text>
                                                <Text style={styles.cycleDesc}>{c.description}</Text>
                                            </View>
                                            <ChevronRight size={18} color={c.color} />
                                        </View>
                                        <View style={styles.cycleStats}>
                                            <View style={styles.cycleStat}>
                                                <Text style={[styles.cycleStatNum, { color: c.color }]}>{stat.total}</Text>
                                                <Text style={styles.cycleStatLabel}>전체</Text>
                                            </View>
                                            <View style={styles.cycleStat}>
                                                <Text style={[styles.cycleStatNum, { color: c.color }]}>{stat.pending}</Text>
                                                <Text style={styles.cycleStatLabel}>마킹 예정</Text>
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                );
                            })}
                        </>
                    )}

                    {/* STEP: 미리보기 */}
                    {step === 'preview' && activeCycle && (
                        <>
                            <View style={styles.intro2Box}>
                                <Text style={styles.introTitle}>{activeCycle.title}</Text>
                                <Text style={styles.introBody}>
                                    {activeCycle.targetFilter.toString().includes('폐쇄망')
                                        ? `M)알약 온라인구분이 '폐쇄망'인 기기의 ${activeCycle.statusField}에 '${activeCycle.needTag}'를 추가합니다.`
                                        : `QA)백업 방법에 'IT/현장백업'이 포함된 기기의 ${activeCycle.statusField}에 '${activeCycle.needTag}'를 추가합니다.`}
                                    {' '}현장에서 ✓ 완료 누르면 '{activeCycle.needTag}'가 제거되고 '{activeCycle.completedTag}'로 바뀝니다.
                                </Text>
                            </View>

                            <View style={styles.statsRow}>
                                <View style={[styles.statBox, { backgroundColor: activeCycle.bgColor }]}>
                                    <Text style={[styles.statNum, { color: activeCycle.color }]}>{allTargets.length}</Text>
                                    <Text style={styles.statLabel}>전체 대상</Text>
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
                                    이전 사이클의 '{activeCycle.completedTag}' 마킹이 남아있으면 이번 초기화에서 제거됩니다.
                                    처리이력으로 과거 기록은 그대로 보존돼요.
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

                    {/* STEP: 진행 */}
                    {step === 'running' && activeCycle && (
                        <View style={styles.runningBox}>
                            <RefreshCw size={32} color={activeCycle.color} />
                            <Text style={styles.runningTitle}>마킹 중…</Text>
                            <Text style={[styles.runningProgress, { color: activeCycle.color }]}>
                                {progress.current} / {progress.total}
                            </Text>
                            <View style={styles.progressBar}>
                                <View
                                    style={[
                                        styles.progressFill,
                                        {
                                            width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`,
                                            backgroundColor: activeCycle.color,
                                        },
                                    ]}
                                />
                            </View>
                        </View>
                    )}

                    {/* STEP: 완료 */}
                    {step === 'done' && doneSummary && (
                        <View style={styles.doneBox}>
                            <View style={[styles.doneIcon, { backgroundColor: doneSummary.cycle.bgColor }]}>
                                <Check size={28} color={doneSummary.cycle.color} />
                            </View>
                            <Text style={[styles.doneTitle, { color: doneSummary.cycle.color }]}>
                                {doneSummary.cycle.title} 시작 완료
                            </Text>
                            <Text style={styles.doneStat}>
                                {doneSummary.marked}대 마킹 · {doneSummary.skipped}대 이미 마킹됨
                            </Text>
                            <Text style={styles.helperText}>
                                Quick Task / 통합 큐 / 과제 대시보드에서 확인하세요.
                            </Text>
                        </View>
                    )}
                </ScrollView>

                <View style={styles.footer}>
                    {step === 'select' && (
                        <TouchableOpacity style={styles.cancelBtnFull} onPress={handleClose}>
                            <Text style={styles.cancelBtnText}>닫기</Text>
                        </TouchableOpacity>
                    )}
                    {step === 'preview' && activeCycle && (
                        <>
                            <TouchableOpacity style={styles.cancelBtn} onPress={handleBackToSelect}>
                                <Text style={styles.cancelBtnText}>뒤로</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.runBtn,
                                    { backgroundColor: activeCycle.color },
                                    willBeMarked.length === 0 && styles.runBtnDisabled,
                                ]}
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
                    {step === 'done' && doneSummary && (
                        <>
                            <TouchableOpacity style={styles.cancelBtn} onPress={handleBackToSelect}>
                                <Text style={styles.cancelBtnText}>다른 사이클</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.runBtn, { backgroundColor: doneSummary.cycle.color }]} onPress={handleClose}>
                                <Text style={styles.runBtnText}>닫기</Text>
                            </TouchableOpacity>
                        </>
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
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: 16, fontWeight: 'bold', color: '#1f2937' },
    subtitle: { fontSize: 11, color: '#6b7280', marginTop: 1 },
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
    intro: { fontSize: 12, color: '#475569', lineHeight: 18, marginBottom: 16 },

    cycleCard: {
        padding: 14,
        borderRadius: 14,
        marginBottom: 10,
    },
    cycleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cycleEmoji: { fontSize: 28 },
    cycleTitle: { fontSize: 15, fontWeight: '700' },
    cycleBadge: { fontSize: 10, color: '#94a3b8', marginTop: 1, fontWeight: '600' },
    cycleDesc: { fontSize: 11, color: '#475569', marginTop: 2 },
    cycleStats: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },
    cycleStat: {
        flex: 1,
        backgroundColor: '#ffffff',
        padding: 8,
        borderRadius: 8,
        alignItems: 'center',
    },
    cycleStatNum: { fontSize: 18, fontWeight: '800' },
    cycleStatLabel: { fontSize: 9, color: '#475569' },

    intro2Box: { gap: 6, marginBottom: 14 },
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
    runningProgress: { fontSize: 13, fontWeight: '700' },
    progressBar: {
        width: '100%',
        height: 8,
        backgroundColor: '#e5e7eb',
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressFill: { height: '100%' },

    doneBox: { alignItems: 'center', padding: 30, gap: 8 },
    doneIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    doneTitle: { fontSize: 16, fontWeight: 'bold' },
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
    cancelBtnFull: {
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
        alignItems: 'center',
    },
    runBtnDisabled: { backgroundColor: '#cbd5e1' },
    runBtnText: { fontSize: 14, color: '#ffffff', fontWeight: '700' },
});
