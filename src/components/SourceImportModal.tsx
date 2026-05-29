/**
 * SourceImportModal — 알약 엑셀 3종을 직접 업로드해서 Notion DB 일괄 업데이트
 *
 * 흐름:
 * 1. 파일 선택 (드래그 또는 클릭)
 * 2. 자동 파싱 + 소스 감지 (사용자가 수동 변경 가능)
 * 3. 변경 미리보기 표 (매칭 / 추가 후보 / 변화 없음)
 * 4. 적용 (진행률 표시) → 처리이력 자동 누적
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    Platform,
    Alert,
} from 'react-native';
import { X, Upload, Check, AlertTriangle, FileText, ChevronRight, RefreshCw } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import {
    SOURCES,
    SourceDef,
    detectSource,
    buildImportPlan,
    parseXlsxArrayBuffer,
    parseCsvText,
    ParsedFile,
    ImportPlan,
} from '../lib/sourceImports';
import { HISTORY_FIELD_NAME, appendHistoryLine } from '../lib/quickTasks';

interface Props {
    visible: boolean;
    onClose: () => void;
    assets: Asset[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdate: (id: string, field: string, value: string, type: string) => Promise<void>;
}

type Step = 'select' | 'preview' | 'running' | 'done';

export const SourceImportModal: React.FC<Props> = ({
    visible,
    onClose,
    assets,
    schemaProperties,
    onUpdate,
}) => {
    const [step, setStep] = useState<Step>('select');
    const [fileName, setFileName] = useState('');
    const [parsed, setParsed] = useState<ParsedFile | null>(null);
    const [selectedSource, setSelectedSource] = useState<SourceDef | null>(null);
    const [plan, setPlan] = useState<ImportPlan | null>(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [skipUnchanged, setSkipUnchanged] = useState(true);
    const [appendHistory, setAppendHistory] = useState(true);
    // 의심 매칭(엑셀 IP가 용인 대역 밖)을 적용에 포함할지 — 기본 false(안전)
    const [applySuspicious, setApplySuspicious] = useState(false);
    // 빈 셀로 값 삭제 — Notion export 재임포트 같이 모든 컬럼을 매핑하는 소스에서
    // 사용자가 의도적으로 값을 비울 때만 ON. 기본 false(안전).
    const [allowBlankClear, setAllowBlankClear] = useState(false);
    // 미등록 후보 중 ❌ 제외(용인 대역 밖)도 보여줄지
    const [showExcludedCandidates, setShowExcludedCandidates] = useState(false);

    const resetAll = useCallback(() => {
        setStep('select');
        setFileName('');
        setParsed(null);
        setSelectedSource(null);
        setPlan(null);
        setProgress({ current: 0, total: 0 });
    }, []);

    const handleClose = useCallback(() => {
        resetAll();
        onClose();
    }, [resetAll, onClose]);

    // 파일 선택 핸들러 (웹 환경 기준 — 모바일 RN은 expo-document-picker 필요하지만 본 앱은 주로 웹)
    const handleFilePick = useCallback(async () => {
        if (Platform.OS !== 'web') {
            Alert.alert('미지원', '현재 파일 업로드는 웹 브라우저에서만 동작합니다.');
            return;
        }
        // input[type=file] 동적 생성
        const input = (globalThis as any).document?.createElement('input');
        if (!input) return;
        input.type = 'file';
        input.accept = '.xlsx,.xls,.csv';
        input.onchange = async (e: any) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFileName(file.name);

            try {
                let parsedFile: ParsedFile;
                if (file.name.toLowerCase().endsWith('.csv')) {
                    const text = await file.text();
                    parsedFile = parseCsvText(text);
                } else {
                    const buffer = await file.arrayBuffer();
                    parsedFile = parseXlsxArrayBuffer(buffer);
                }
                setParsed(parsedFile);

                // 자동 감지
                const detected = detectSource(parsedFile);
                setSelectedSource(detected);

                if (detected) {
                    const newPlan = buildImportPlan(parsedFile, detected, assets, { allowBlankClear });
                    setPlan(newPlan);
                    setStep('preview');
                } else {
                    Alert.alert(
                        '소스 자동 감지 실패',
                        '헤더로 소스를 판별하지 못했습니다. 아래에서 직접 선택해 주세요.'
                    );
                    setStep('preview');
                }
            } catch (error: any) {
                console.error('[SourceImport] 파일 파싱 실패:', error);
                Alert.alert('오류', `파일을 읽지 못했습니다.\n${error?.message ?? ''}`);
            }
        };
        input.click();
    }, [assets]);

    const handleSelectSource = useCallback((src: SourceDef) => {
        setSelectedSource(src);
        if (parsed) {
            const newPlan = buildImportPlan(parsed, src, assets, { allowBlankClear });
            setPlan(newPlan);
        }
    }, [parsed, assets, allowBlankClear]);

    // 빈 셀 토글이 바뀌면 plan 재계산
    React.useEffect(() => {
        if (parsed && selectedSource) {
            setPlan(buildImportPlan(parsed, selectedSource, assets, { allowBlankClear }));
        }
    }, [allowBlankClear, parsed, selectedSource, assets]);

    const handleApply = useCallback(async () => {
        if (!plan) return;
        let toApply = plan.plans;
        if (skipUnchanged) {
            toApply = toApply.filter(p => p.fieldChanges.some(c => c.changed));
        }
        // 의심 매칭은 토글 켤 때만 적용
        if (!applySuspicious) {
            toApply = toApply.filter(p => !p.suspicious);
        }

        setStep('running');
        setProgress({ current: 0, total: toApply.length });

        for (let i = 0; i < toApply.length; i++) {
            const p = toApply[i];
            if (!p.matchedAsset) continue;

            try {
                // 1) 각 필드 업데이트 (변경된 것만)
                const updates = p.fieldChanges.filter(c => c.changed);
                await Promise.all(updates.map(c => {
                    const type = schemaProperties[c.field]?.type || 'rich_text';
                    return onUpdate(p.matchedAsset!.id, c.field, c.newValue, type);
                }));

                // 2) 처리이력 한 줄 prepend (옵션) — 변경된 필드와 새 값을 함께 기록
                if (appendHistory && updates.length > 0) {
                    const existing = String((p.matchedAsset.values as any)[HISTORY_FIELD_NAME] ?? '');
                    // "필드명=새값" 형식으로 요약. 빈 값은 ∅ 로 표기.
                    const trim = (s: string) => (s.length > 30 ? s.slice(0, 30) + '…' : s);
                    const changeSummary = updates
                        .map(c => `${c.field}=${trim(c.newValue || '∅')}`)
                        .join(', ');
                    const detailedLabel = `${p.historyLabel} · ${changeSummary}`;
                    const nextHistory = appendHistoryLine(existing, detailedLabel);
                    await onUpdate(p.matchedAsset.id, HISTORY_FIELD_NAME, nextHistory, 'rich_text');
                }
            } catch (e) {
                console.error(`[SourceImport] ${p.lookupValue} 업데이트 실패:`, e);
            }

            setProgress({ current: i + 1, total: toApply.length });
        }

        setStep('done');
    }, [plan, skipUnchanged, applySuspicious, appendHistory, schemaProperties, onUpdate]);

    // 미리보기 통계
    const stats = useMemo(() => {
        if (!plan) return null;
        return {
            total: plan.totalRows,
            matched: plan.matchedCount,
            unmatched: plan.unmatchedCount,
            changes: plan.changeCount,
            unchanged: plan.matchedCount - plan.changeCount,
        };
    }, [plan]);

    // 컬럼별 변경 요약 — 사용자가 의도한 변경 패턴인지 한눈에 확인용
    // 의심 매칭 제외(기본) 같은 적용 옵션을 반영해서 실제 적용될 변경만 카운트.
    const fieldSummary = useMemo(() => {
        if (!plan) return [];
        const map = new Map<string, { total: number; deletes: number; sets: number }>();
        for (const p of plan.plans) {
            if (!applySuspicious && p.suspicious) continue;
            for (const c of p.fieldChanges) {
                if (!c.changed) continue;
                const entry = map.get(c.field) || { total: 0, deletes: 0, sets: 0 };
                entry.total++;
                if (c.newValue === '') entry.deletes++;
                else entry.sets++;
                map.set(c.field, entry);
            }
        }
        return Array.from(map.entries())
            .map(([field, counts]) => ({ field, ...counts }))
            .sort((a, b) => b.total - a.total);
    }, [plan, applySuspicious]);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>소스 임포트</Text>
                    <TouchableOpacity onPress={handleClose}>
                        <X size={24} color="#6b7280" />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    {/* STEP: SELECT (파일 고르기) */}
                    {step === 'select' && (
                        <>
                            <Text style={styles.intro}>
                                알약 콘솔에서 받은 엑셀을 그대로 업로드하면, 사전 정의된 매핑으로
                                Notion DB를 자동 업데이트해요. 사용자명(예: DEQ-358)이 매칭키예요.
                            </Text>

                            <TouchableOpacity style={styles.dropZone} onPress={handleFilePick} activeOpacity={0.7}>
                                <Upload size={36} color="#6366f1" />
                                <Text style={styles.dropZoneTitle}>파일 선택 또는 드래그</Text>
                                <Text style={styles.dropZoneSub}>.xlsx, .xls, .csv 지원</Text>
                            </TouchableOpacity>

                            <Text style={styles.sectionLabel}>지원하는 소스</Text>
                            {SOURCES.map(src => (
                                <View key={src.id} style={styles.sourceCard}>
                                    <Text style={styles.sourceEmoji}>{src.emoji}</Text>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.sourceName}>{src.name}</Text>
                                        <Text style={styles.sourceDesc}>{src.description}</Text>
                                        <Text style={styles.sourceFile}>예: {src.sampleFilename}</Text>
                                    </View>
                                </View>
                            ))}
                        </>
                    )}

                    {/* STEP: PREVIEW */}
                    {step === 'preview' && parsed && (
                        <>
                            <View style={styles.fileBar}>
                                <FileText size={16} color="#475569" />
                                <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
                                <TouchableOpacity onPress={resetAll}>
                                    <Text style={styles.changeFileBtn}>다른 파일</Text>
                                </TouchableOpacity>
                            </View>

                            {/* 소스 선택 (자동감지된 거 강조) */}
                            <Text style={styles.sectionLabel}>소스 종류</Text>
                            <View style={styles.sourceChips}>
                                {SOURCES.map(src => {
                                    const active = selectedSource?.id === src.id;
                                    return (
                                        <TouchableOpacity
                                            key={src.id}
                                            style={[styles.chip, active && styles.chipActive]}
                                            onPress={() => handleSelectSource(src)}
                                        >
                                            <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                                {src.emoji} {src.name}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            {/* 통계 카드 */}
                            {stats && plan && (
                                <View style={styles.statsRow}>
                                    <View style={styles.statBox}>
                                        <Text style={styles.statNum}>{stats.total}</Text>
                                        <Text style={styles.statLabel}>총 행</Text>
                                    </View>
                                    <View style={[styles.statBox, { backgroundColor: '#dcfce7' }]}>
                                        <Text style={[styles.statNum, { color: '#15803d' }]}>{stats.changes}</Text>
                                        <Text style={styles.statLabel}>변경됨</Text>
                                    </View>
                                    {plan.suspiciousCount > 0 && (
                                        <View style={[styles.statBox, { backgroundColor: '#fee2e2' }]}>
                                            <Text style={[styles.statNum, { color: '#b91c1c' }]}>{plan.suspiciousCount}</Text>
                                            <Text style={styles.statLabel}>의심 매칭</Text>
                                        </View>
                                    )}
                                    <View style={[styles.statBox, { backgroundColor: '#f1f5f9' }]}>
                                        <Text style={[styles.statNum, { color: '#475569' }]}>{stats.unchanged}</Text>
                                        <Text style={styles.statLabel}>변화 없음</Text>
                                    </View>
                                    <View style={[styles.statBox, { backgroundColor: '#fef3c7' }]}>
                                        <Text style={[styles.statNum, { color: '#b45309' }]}>{stats.unmatched}</Text>
                                        <Text style={styles.statLabel}>매칭 안됨</Text>
                                    </View>
                                </View>
                            )}

                            {/* 옵션 */}
                            <View style={styles.optionsRow}>
                                <TouchableOpacity
                                    style={styles.option}
                                    onPress={() => setSkipUnchanged(v => !v)}
                                >
                                    <View style={[styles.checkbox, skipUnchanged && styles.checkboxOn]}>
                                        {skipUnchanged && <Check size={14} color="#ffffff" />}
                                    </View>
                                    <Text style={styles.optionText}>변화 없는 행 건너뛰기</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.option}
                                    onPress={() => setAppendHistory(v => !v)}
                                >
                                    <View style={[styles.checkbox, appendHistory && styles.checkboxOn]}>
                                        {appendHistory && <Check size={14} color="#ffffff" />}
                                    </View>
                                    <Text style={styles.optionText}>처리이력에 한 줄 추가</Text>
                                </TouchableOpacity>
                                {plan && plan.suspiciousCount > 0 && (
                                    <TouchableOpacity
                                        style={styles.option}
                                        onPress={() => setApplySuspicious(v => !v)}
                                    >
                                        <View style={[styles.checkbox, applySuspicious && styles.checkboxOnDanger]}>
                                            {applySuspicious && <Check size={14} color="#ffffff" />}
                                        </View>
                                        <Text style={[styles.optionText, { color: '#b91c1c' }]}>의심 매칭도 적용 (위험)</Text>
                                    </TouchableOpacity>
                                )}
                                {selectedSource?.id === 'notion-export-reimport' && (
                                    <TouchableOpacity
                                        style={styles.option}
                                        onPress={() => setAllowBlankClear(v => !v)}
                                    >
                                        <View style={[styles.checkbox, allowBlankClear && styles.checkboxOnDanger]}>
                                            {allowBlankClear && <Check size={14} color="#ffffff" />}
                                        </View>
                                        <Text style={[styles.optionText, { color: '#b91c1c' }]}>빈 셀로 값 삭제 (위험)</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            {selectedSource?.id === 'notion-export-reimport' && !allowBlankClear && (
                                <View style={styles.suspicionNotice}>
                                    <AlertTriangle size={14} color="#b45309" />
                                    <Text style={[styles.suspicionNoticeText, { color: '#92400e' }]}>
                                        안전 모드: 비어있는 셀로 인한 변경은 제외돼요. 의도적으로 값을 비우려면
                                        '빈 셀로 값 삭제'를 켜세요.
                                    </Text>
                                </View>
                            )}
                            {plan && plan.suspiciousCount > 0 && !applySuspicious && (
                                <View style={styles.suspicionNotice}>
                                    <AlertTriangle size={14} color="#b91c1c" />
                                    <Text style={styles.suspicionNoticeText}>
                                        엑셀의 IP가 용인 대역(10.5.x.x / 192.168.x.x) 밖인 매칭 {plan.suspiciousCount}건은
                                        기본 제외됐어요. 동일 사용자명을 가진 다른 기기일 가능성이 있어요.
                                    </Text>
                                </View>
                            )}

                            {/* 컬럼별 변경 요약 — 의도한 변경 패턴인지 한눈에 검증 */}
                            {plan && fieldSummary.length > 0 && (
                                <>
                                    <Text style={styles.sectionLabel}>
                                        변경 요약 (컬럼별 · 적용 대상 기준)
                                    </Text>
                                    <View style={styles.summaryBox}>
                                        {fieldSummary.map(s => (
                                            <View key={s.field} style={styles.summaryRow}>
                                                <Text style={styles.summaryField} numberOfLines={1}>
                                                    {s.field}
                                                </Text>
                                                <Text style={styles.summaryCount}>
                                                    <Text style={styles.summaryTotal}>{s.total}건 변경</Text>
                                                    {s.deletes > 0 && (
                                                        <Text style={styles.summaryDeletes}>
                                                            {' · '}{s.deletes}건 삭제
                                                        </Text>
                                                    )}
                                                    {s.sets > 0 && (
                                                        <Text style={styles.summarySets}>
                                                            {' · '}{s.sets}건 입력
                                                        </Text>
                                                    )}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                </>
                            )}

                            {/* 변경 미리보기 표 */}
                            {plan && (
                                <>
                                    <Text style={styles.sectionLabel}>
                                        변경 미리보기 (상위 50건)
                                    </Text>
                                    {plan.plans
                                        .filter(p => !skipUnchanged || p.fieldChanges.some(c => c.changed))
                                        .slice(0, 50)
                                        .map((p, idx) => (
                                            <View
                                                key={`${p.lookupValue}-${idx}`}
                                                style={[styles.planRow, p.suspicious && styles.planRowSuspicious]}
                                            >
                                                <View style={styles.planRowHeader}>
                                                    {p.suspicious && (
                                                        <AlertTriangle size={14} color="#b91c1c" />
                                                    )}
                                                    <Text style={[styles.planName, p.suspicious && { color: '#b91c1c' }]}>
                                                        {p.lookupValue}
                                                    </Text>
                                                    {p.suspicious && !applySuspicious && (
                                                        <Text style={styles.planSkipBadge}>적용 제외됨</Text>
                                                    )}
                                                </View>
                                                {p.suspicious && (
                                                    <Text style={styles.planSuspicionReason}>
                                                        {p.suspicionReason}
                                                    </Text>
                                                )}
                                                {p.fieldChanges.map((c, i) => {
                                                    const isDelete = c.changed && c.newValue === '';
                                                    return (
                                                        <View key={i} style={styles.changeRow}>
                                                            <Text style={styles.changeField}>{c.field}</Text>
                                                            {c.changed ? (
                                                                <Text style={styles.changeArrow}>
                                                                    <Text style={styles.changeOld}>{c.oldValue || '∅'}</Text>
                                                                    {' → '}
                                                                    {isDelete ? (
                                                                        <Text style={{ color: '#b91c1c', fontWeight: '700' }}>삭제</Text>
                                                                    ) : (
                                                                        <Text style={styles.changeNew}>{c.newValue}</Text>
                                                                    )}
                                                                </Text>
                                                            ) : (
                                                                <Text style={styles.changeSame}>= {c.oldValue || '∅'}</Text>
                                                            )}
                                                        </View>
                                                    );
                                                })}
                                            </View>
                                        ))}
                                </>
                            )}

                            {/* 매칭 안 된 행 (분류: ✅용인추정 / ❌제외) */}
                            {plan && plan.unmatchedRows.length > 0 && (() => {
                                const likely = plan.unmatchedRows.filter(u => u.classification === 'likely-yongin');
                                const excluded = plan.unmatchedRows.filter(u => u.classification === 'excluded');
                                return (
                                    <>
                                        <Text style={styles.sectionLabel}>
                                            매칭 안 된 행 (전체 {plan.unmatchedRows.length}건)
                                        </Text>
                                        <Text style={styles.helperText}>
                                            Notion에 없는 사용자명. IP 대역으로 용인 추정 여부 분류. 자동 추가는 안 하니
                                            확인 후 기존 일괄 업데이트 모달에서 수동으로 추가하세요.
                                        </Text>

                                        {/* ✅ 용인 추정 */}
                                        {likely.length > 0 && (
                                            <>
                                                <Text style={styles.unmatchedGroupLabel}>
                                                    ✅ 용인 추정 ({likely.length}건) — IP 화이트리스트 매칭
                                                </Text>
                                                {likely.slice(0, 30).map((u, idx) => (
                                                    <View key={idx} style={[styles.unmatchedRow, styles.unmatchedRowLikely]}>
                                                        <Text style={styles.unmatchedText}>
                                                            <Text style={{ fontWeight: '700' }}>{u.lookupValue}</Text>
                                                            {u.excelRow['컴퓨터 이름'] ? ` (${u.excelRow['컴퓨터 이름']})` : ''}
                                                            {u.excelRow['IP'] ? ` · ${u.excelRow['IP']}` : ''}
                                                        </Text>
                                                    </View>
                                                ))}
                                                {likely.length > 30 && (
                                                    <Text style={styles.helperText}>… 외 {likely.length - 30}건</Text>
                                                )}
                                            </>
                                        )}

                                        {/* ❌ 용인 외 (접힘) */}
                                        {excluded.length > 0 && (
                                            <>
                                                <TouchableOpacity
                                                    style={styles.excludedToggle}
                                                    onPress={() => setShowExcludedCandidates(v => !v)}
                                                >
                                                    <Text style={styles.unmatchedGroupLabel}>
                                                        ❌ 용인 외 ({excluded.length}건) — {showExcludedCandidates ? '접기' : '펼치기'}
                                                    </Text>
                                                </TouchableOpacity>
                                                {showExcludedCandidates && excluded.slice(0, 50).map((u, idx) => (
                                                    <View key={idx} style={styles.unmatchedRow}>
                                                        <AlertTriangle size={12} color="#b45309" />
                                                        <Text style={styles.unmatchedText}>
                                                            {u.lookupValue}
                                                            {u.excelRow['컴퓨터 이름'] ? ` (${u.excelRow['컴퓨터 이름']})` : ''}
                                                            {u.excelRow['IP'] ? ` · ${u.excelRow['IP']}` : ''}
                                                            {' · '}
                                                            <Text style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                                                                {u.reason}
                                                            </Text>
                                                        </Text>
                                                    </View>
                                                ))}
                                            </>
                                        )}
                                    </>
                                );
                            })()}
                        </>
                    )}

                    {/* STEP: RUNNING */}
                    {step === 'running' && (
                        <View style={styles.runningBox}>
                            <RefreshCw size={36} color="#6366f1" />
                            <Text style={styles.runningTitle}>업데이트 중…</Text>
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

                    {/* STEP: DONE */}
                    {step === 'done' && plan && (
                        <View style={styles.doneBox}>
                            <View style={styles.doneIconCircle}>
                                <Check size={36} color="#15803d" />
                            </View>
                            <Text style={styles.doneTitle}>임포트 완료</Text>
                            <Text style={styles.doneStat}>
                                {progress.current}건 업데이트 적용. 처리이력에도 누적됐어요.
                            </Text>
                            <TouchableOpacity style={styles.doneBtn} onPress={resetAll}>
                                <Text style={styles.doneBtnText}>다른 파일 임포트</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </ScrollView>

                {/* 하단 액션 */}
                {step === 'preview' && plan && (() => {
                    // 적용 대상 수 계산 (의심 매칭 제외 반영)
                    let toApply = plan.plans;
                    if (skipUnchanged) {
                        toApply = toApply.filter(p => p.fieldChanges.some(c => c.changed));
                    }
                    if (!applySuspicious) {
                        toApply = toApply.filter(p => !p.suspicious);
                    }
                    const applyCount = toApply.length;
                    return (
                        <View style={styles.footer}>
                            <TouchableOpacity style={styles.footerCancel} onPress={resetAll}>
                                <Text style={styles.footerCancelText}>취소</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.footerApply,
                                    applyCount === 0 && styles.footerApplyDisabled,
                                ]}
                                onPress={handleApply}
                                disabled={applyCount === 0}
                            >
                                <Text style={styles.footerApplyText}>
                                    {applyCount}건 적용
                                </Text>
                                <ChevronRight size={16} color="#ffffff" />
                            </TouchableOpacity>
                        </View>
                    );
                })()}
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
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: 18, fontWeight: 'bold', color: '#1f2937' },
    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 100 },
    intro: { fontSize: 13, color: '#475569', lineHeight: 20, marginBottom: 16 },
    dropZone: {
        backgroundColor: '#eef2ff',
        borderWidth: 2,
        borderColor: '#a5b4fc',
        borderStyle: 'dashed',
        borderRadius: 14,
        padding: 30,
        alignItems: 'center',
        gap: 8,
        marginBottom: 20,
    },
    dropZoneTitle: { fontSize: 16, fontWeight: '700', color: '#4338ca' },
    dropZoneSub: { fontSize: 12, color: '#6366f1' },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginTop: 12,
        marginBottom: 8,
    },
    sourceCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        marginBottom: 8,
    },
    sourceEmoji: { fontSize: 24 },
    sourceName: { fontSize: 14, fontWeight: '700', color: '#1f2937' },
    sourceDesc: { fontSize: 12, color: '#475569', marginTop: 2 },
    sourceFile: { fontSize: 11, color: '#9ca3af', marginTop: 4, fontStyle: 'italic' },

    fileBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        backgroundColor: '#ffffff',
        borderRadius: 10,
        marginBottom: 12,
    },
    fileName: { flex: 1, fontSize: 13, color: '#1f2937', fontWeight: '600' },
    changeFileBtn: { fontSize: 12, color: '#6366f1', fontWeight: '600' },

    sourceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: '#ffffff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    chipActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
    chipText: { fontSize: 12, color: '#475569' },
    chipTextActive: { color: '#ffffff', fontWeight: '600' },

    statsRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
    statBox: {
        flex: 1,
        backgroundColor: '#ffffff',
        padding: 10,
        borderRadius: 10,
        alignItems: 'center',
    },
    statNum: { fontSize: 20, fontWeight: 'bold', color: '#1f2937' },
    statLabel: { fontSize: 10, color: '#64748b', marginTop: 2 },

    optionsRow: { flexDirection: 'row', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
    option: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    checkbox: {
        width: 18,
        height: 18,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: '#cbd5e1',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
    checkboxOnDanger: { backgroundColor: '#b91c1c', borderColor: '#b91c1c' },
    optionText: { fontSize: 12, color: '#475569' },
    suspicionNotice: {
        flexDirection: 'row',
        gap: 8,
        backgroundColor: '#fee2e2',
        padding: 10,
        borderRadius: 8,
        marginBottom: 12,
    },
    suspicionNoticeText: { flex: 1, fontSize: 11, color: '#991b1b', lineHeight: 16 },
    summaryBox: {
        backgroundColor: '#ffffff',
        borderRadius: 10,
        padding: 10,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        gap: 12,
    },
    summaryField: {
        fontSize: 12,
        color: '#1f2937',
        fontWeight: '600',
        minWidth: 140,
        maxWidth: 220,
    },
    summaryCount: { fontSize: 12, color: '#475569', flex: 1 },
    summaryTotal: { fontWeight: '700', color: '#1f2937' },
    summaryDeletes: { color: '#b91c1c', fontWeight: '600' },
    summarySets: { color: '#15803d', fontWeight: '600' },
    planRowSuspicious: {
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fef2f2',
    },
    planRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    planSkipBadge: {
        marginLeft: 'auto',
        fontSize: 10,
        color: '#ffffff',
        backgroundColor: '#b91c1c',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        fontWeight: '700',
    },
    planSuspicionReason: { fontSize: 11, color: '#991b1b', marginBottom: 6, fontStyle: 'italic' },
    unmatchedGroupLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#334155',
        marginTop: 10,
        marginBottom: 6,
    },
    unmatchedRowLikely: { backgroundColor: '#ecfdf5' },
    excludedToggle: { marginTop: 6 },

    planRow: {
        backgroundColor: '#ffffff',
        borderRadius: 8,
        padding: 10,
        marginBottom: 6,
    },
    planName: { fontSize: 13, fontWeight: '700', color: '#1f2937', marginBottom: 4 },
    changeRow: {
        flexDirection: 'row',
        gap: 6,
        paddingVertical: 2,
        flexWrap: 'wrap',
    },
    changeField: { fontSize: 11, color: '#64748b', minWidth: 110 },
    changeArrow: { fontSize: 11, flex: 1, flexWrap: 'wrap' },
    changeOld: { color: '#94a3b8', textDecorationLine: 'line-through' },
    changeNew: { color: '#15803d', fontWeight: '600' },
    changeSame: { fontSize: 11, color: '#9ca3af', flex: 1 },

    helperText: { fontSize: 11, color: '#9ca3af', marginBottom: 6, lineHeight: 16 },
    unmatchedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#fffbeb',
        padding: 6,
        borderRadius: 6,
        marginBottom: 4,
    },
    unmatchedText: { fontSize: 11, color: '#92400e', flex: 1 },

    footer: {
        flexDirection: 'row',
        gap: 8,
        padding: 12,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    footerCancel: {
        flex: 1,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
    },
    footerCancelText: { fontSize: 14, color: '#475569', fontWeight: '600' },
    footerApply: {
        flex: 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#6366f1',
    },
    footerApplyDisabled: { backgroundColor: '#cbd5e1' },
    footerApplyText: { fontSize: 14, color: '#ffffff', fontWeight: '700' },

    runningBox: { alignItems: 'center', padding: 40, gap: 12 },
    runningTitle: { fontSize: 16, fontWeight: '700', color: '#1f2937' },
    runningProgress: { fontSize: 14, color: '#6366f1', fontWeight: '600' },
    progressBar: {
        width: '100%',
        height: 8,
        backgroundColor: '#e5e7eb',
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: '#6366f1' },

    doneBox: { alignItems: 'center', padding: 40, gap: 12 },
    doneIconCircle: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: '#dcfce7',
        alignItems: 'center',
        justifyContent: 'center',
    },
    doneTitle: { fontSize: 18, fontWeight: 'bold', color: '#15803d' },
    doneStat: { fontSize: 13, color: '#475569', textAlign: 'center' },
    doneBtn: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: '#6366f1',
        borderRadius: 10,
        marginTop: 8,
    },
    doneBtnText: { color: '#ffffff', fontWeight: '600' },
});
