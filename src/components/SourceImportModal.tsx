/**
 * SourceImportModal — 여러 소스 파일을 한 번에 업로드해서 Notion DB 일괄 업데이트
 *
 * 흐름:
 * 1. 파일 여러 개 선택 (xlsx/csv)
 * 2. 각 파일 자동 파싱 + 소스 감지 (헤더 기반, 파일명과 무관)
 * 3. 파일별 탭 + 변경 미리보기 (활성 파일)
 * 4. 활성 파일 단독 적용 OR 모든 파일 일괄 적용
 *
 * 자동 감지는 파일명이 아닌 헤더 시그니처에 의존하기 때문에 다음 달
 * 같은 패턴(예: 용인알약업데이트YYYYMMDD.xlsx)도 그대로 동작합니다.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
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

interface ImportFile {
    id: string;
    name: string;
    parsed: ParsedFile;
    source: SourceDef | null;
    plan: ImportPlan | null;
    /** 한 번 적용된 파일은 이후 일괄 적용에서 제외 + 탭에 ✅ 표시 */
    applied?: boolean;
    appliedAt?: string;   // "오후 3:24" 등 표시용
    appliedRows?: number; // 실제로 적용된 행 수 (옵션 반영 후)
}

export const SourceImportModal: React.FC<Props> = ({
    visible,
    onClose,
    assets,
    schemaProperties,
    onUpdate,
}) => {
    const [step, setStep] = useState<Step>('select');
    const [files, setFiles] = useState<ImportFile[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [progressLabel, setProgressLabel] = useState('');
    const [doneSummary, setDoneSummary] = useState<{ files: number; rows: number } | null>(null);
    // 세션 전체 누적 (이 파일 적용 / 전체 적용을 여러 번 해도 합산)
    const [accumulated, setAccumulated] = useState({ files: 0, rows: 0 });
    // 옵션 (모든 파일에 일관 적용)
    const [skipUnchanged, setSkipUnchanged] = useState(true);
    const [appendHistory, setAppendHistory] = useState(true);
    const [applySuspicious, setApplySuspicious] = useState(false);
    const [allowBlankClear, setAllowBlankClear] = useState(false);
    const [showExcludedCandidates, setShowExcludedCandidates] = useState(false);

    const activeFile = files.find(f => f.id === activeId) || null;
    const plan = activeFile?.plan || null;
    const selectedSource = activeFile?.source || null;

    const resetAll = useCallback(() => {
        setStep('select');
        setFiles([]);
        setActiveId(null);
        setProgress({ current: 0, total: 0 });
        setProgressLabel('');
        setDoneSummary(null);
        setAccumulated({ files: 0, rows: 0 });
    }, []);

    const handleClose = useCallback(() => {
        resetAll();
        onClose();
    }, [resetAll, onClose]);

    // 파일 추가 (다중 지원)
    const handleFilePick = useCallback(async () => {
        if (Platform.OS !== 'web') {
            Alert.alert('미지원', '현재 파일 업로드는 웹 브라우저에서만 동작합니다.');
            return;
        }
        const input = (globalThis as any).document?.createElement('input');
        if (!input) return;
        input.type = 'file';
        input.accept = '.xlsx,.xls,.csv';
        input.multiple = true;
        input.onchange = async (e: any) => {
            const fileList = e.target.files as FileList | null;
            if (!fileList || fileList.length === 0) return;

            const newItems: ImportFile[] = [];
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                try {
                    let parsedFile: ParsedFile;
                    if (file.name.toLowerCase().endsWith('.csv')) {
                        parsedFile = parseCsvText(await file.text());
                    } else {
                        parsedFile = parseXlsxArrayBuffer(await file.arrayBuffer());
                    }
                    const detected = detectSource(parsedFile);
                    const newPlan = detected
                        ? buildImportPlan(parsedFile, detected, assets, { allowBlankClear })
                        : null;
                    newItems.push({
                        id: `f-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
                        name: file.name,
                        parsed: parsedFile,
                        source: detected,
                        plan: newPlan,
                    });
                } catch (error: any) {
                    console.error('[SourceImport] 파일 파싱 실패:', file.name, error);
                    Alert.alert('오류', `'${file.name}' 파싱 실패\n${error?.message ?? ''}`);
                }
            }

            if (newItems.length === 0) return;

            setFiles(prev => [...prev, ...newItems]);
            // 활성 파일이 없으면 첫 번째 신규 파일로
            setActiveId(prev => prev || newItems[0].id);
            setStep('preview');

            // 자동 감지 실패한 파일이 있으면 알림
            const undetected = newItems.filter(f => !f.source);
            if (undetected.length > 0) {
                Alert.alert(
                    '일부 파일 자동 감지 실패',
                    `${undetected.map(f => f.name).join(', ')}\n해당 파일 탭에서 소스를 수동으로 선택해 주세요.`
                );
            }
        };
        input.click();
    }, [assets, allowBlankClear]);

    // 활성 파일의 소스 수동 변경
    const handleSelectSource = useCallback((src: SourceDef) => {
        if (!activeFile) return;
        const newPlan = buildImportPlan(activeFile.parsed, src, assets, { allowBlankClear });
        setFiles(prev => prev.map(f =>
            f.id === activeFile.id ? { ...f, source: src, plan: newPlan } : f
        ));
    }, [activeFile, assets, allowBlankClear]);

    // 옵션이 바뀌면 모든 파일의 plan 재계산
    useEffect(() => {
        setFiles(prev => prev.map(f => {
            if (!f.source) return f;
            return { ...f, plan: buildImportPlan(f.parsed, f.source, assets, { allowBlankClear }) };
        }));
    }, [allowBlankClear, assets]);

    // 파일 제거
    const removeFile = useCallback((id: string) => {
        setFiles(prev => {
            const next = prev.filter(f => f.id !== id);
            if (activeId === id) {
                setActiveId(next[0]?.id || null);
            }
            return next;
        });
    }, [activeId]);

    // 적용 — target 'active' 또는 'all'.
    // 적용 후에도 모달은 그대로 (preview step 유지). 사용자가 다음 파일을 검토 후 다시 적용 가능.
    const handleApply = useCallback(async (target: 'active' | 'all') => {
        // 이미 적용된 파일은 제외
        const targetFiles = target === 'active'
            ? (activeFile && !activeFile.applied ? [activeFile] : [])
            : files.filter(f => f.plan && !f.applied);
        if (targetFiles.length === 0) return;

        // 적용할 행 수집 (파일별로 옵션 일관 적용)
        type RowEntry = {
            file: ImportFile;
            row: NonNullable<typeof activeFile>['plan'] extends infer T
                ? T extends { plans: Array<infer R> } ? R : never
                : never;
        };
        const allRows: RowEntry[] = [];
        // 파일별 적용 행 수도 함께 기록 (탭에 표시할 용도)
        const appliedRowsByFile = new Map<string, number>();
        for (const f of targetFiles) {
            if (!f.plan) continue;
            let rows = f.plan.plans;
            if (skipUnchanged) rows = rows.filter(p => p.fieldChanges.some(c => c.changed));
            if (!applySuspicious) rows = rows.filter(p => !p.suspicious);
            appliedRowsByFile.set(f.id, rows.length);
            for (const r of rows) {
                allRows.push({ file: f, row: r as any });
            }
        }

        setStep('running');
        setProgress({ current: 0, total: allRows.length });
        setProgressLabel('');

        for (let i = 0; i < allRows.length; i++) {
            const { file, row } = allRows[i];
            const p = row as any;
            if (!p.matchedAsset) continue;
            setProgressLabel(`${file.name} · ${p.lookupValue}`);

            try {
                const updates = p.fieldChanges.filter((c: any) => c.changed);
                await Promise.all(updates.map((c: any) => {
                    const type = schemaProperties[c.field]?.type || 'rich_text';
                    // Phase 6: multi_select 컬럼은 기존 값과 머지 (덮어쓰기 X)
                    // export 시 콤마 join 된 값이 단일 select 로 잘못 들어가는 회귀 방지.
                    if (type === 'multi_select') {
                        const existing = String((p.matchedAsset.values as any)[c.field] ?? '');
                        const set = new Set<string>(
                            existing.split(',').map(s => s.trim()).filter(Boolean)
                        );
                        const incoming = String(c.newValue ?? '')
                            .split(',').map(s => s.trim()).filter(Boolean);
                        incoming.forEach(v => set.add(v));
                        const merged = Array.from(set).join(', ');
                        return onUpdate(p.matchedAsset.id, c.field, merged, type);
                    }
                    return onUpdate(p.matchedAsset.id, c.field, c.newValue, type);
                }));

                if (appendHistory && updates.length > 0) {
                    const existing = String((p.matchedAsset.values as any)[HISTORY_FIELD_NAME] ?? '');
                    const trim = (s: string) => (s.length > 30 ? s.slice(0, 30) + '…' : s);
                    const changeSummary = updates
                        .map((c: any) => `${c.field}=${trim(c.newValue || '∅')}`)
                        .join(', ');
                    const detailedLabel = `${p.historyLabel} · ${changeSummary}`;
                    const nextHistory = appendHistoryLine(existing, detailedLabel);
                    await onUpdate(p.matchedAsset.id, HISTORY_FIELD_NAME, nextHistory, 'rich_text');
                }
            } catch (e) {
                console.error(`[SourceImport] ${p.lookupValue} 업데이트 실패:`, e);
            }

            setProgress({ current: i + 1, total: allRows.length });
        }

        // 누적 합산
        setAccumulated(prev => ({
            files: prev.files + targetFiles.length,
            rows: prev.rows + allRows.length,
        }));

        // 적용된 파일들에 applied 마킹
        const appliedIds = new Set(targetFiles.map(f => f.id));
        const applyTime = new Date().toLocaleTimeString('ko-KR', {
            hour: '2-digit', minute: '2-digit',
        });
        let nextActiveId = activeId;
        setFiles(prev => {
            const next = prev.map(f =>
                appliedIds.has(f.id)
                    ? {
                        ...f,
                        applied: true,
                        appliedAt: applyTime,
                        appliedRows: appliedRowsByFile.get(f.id) ?? 0,
                    }
                    : f
            );
            // 활성 탭이 방금 적용된 거면, 다음 미적용 파일로 자동 이동
            const currentActive = next.find(f => f.id === activeId);
            if (currentActive?.applied) {
                const remaining = next.find(f => f.plan && !f.applied);
                if (remaining) nextActiveId = remaining.id;
            }
            return next;
        });
        if (nextActiveId !== activeId) {
            setActiveId(nextActiveId);
        }

        // 미적용 파일이 더 남아있으면 preview 로 복귀, 다 끝났으면 done
        const remainingCount = files.filter(
            f => f.plan && !f.applied && !appliedIds.has(f.id)
        ).length;
        if (remainingCount === 0) {
            setDoneSummary({ files: accumulated.files + targetFiles.length, rows: accumulated.rows + allRows.length });
            setStep('done');
        } else {
            setStep('preview');
        }
    }, [activeFile, files, activeId, skipUnchanged, applySuspicious, appendHistory, accumulated, schemaProperties, onUpdate]);

    // 활성 파일의 plan 통계
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

    // 활성 파일의 컬럼별 변경 요약
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

    // 전체 적용 카운트 — 미적용 파일만 합산
    const totalApplyCount = useMemo(() => {
        let cnt = 0;
        for (const f of files) {
            if (!f.plan || f.applied) continue;
            let rows = f.plan.plans;
            if (skipUnchanged) rows = rows.filter(p => p.fieldChanges.some(c => c.changed));
            if (!applySuspicious) rows = rows.filter(p => !p.suspicious);
            cnt += rows.length;
        }
        return cnt;
    }, [files, skipUnchanged, applySuspicious]);

    // 활성 파일의 적용 카운트 — 적용된 파일은 0
    const activeApplyCount = useMemo(() => {
        if (!plan || activeFile?.applied) return 0;
        let rows = plan.plans;
        if (skipUnchanged) rows = rows.filter(p => p.fieldChanges.some(c => c.changed));
        if (!applySuspicious) rows = rows.filter(p => !p.suspicious);
        return rows.length;
    }, [plan, activeFile, skipUnchanged, applySuspicious]);

    // 적용된 파일 수 / 미적용 파일 수 (헤더에 표시)
    const appliedFilesCount = useMemo(() => files.filter(f => f.applied).length, [files]);
    const remainingFilesCount = useMemo(
        () => files.filter(f => f.plan && !f.applied).length,
        [files],
    );

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
                                여러 소스 엑셀을 한 번에 업로드하면 헤더로 자동 분류해서 일괄 적용합니다.
                                파일명이 달라도(예: 날짜 변경) 같은 양식이면 인식돼요.
                                매칭키는 각 소스의 사용자명 / Name 컬럼입니다.
                            </Text>

                            <TouchableOpacity style={styles.dropZone} onPress={handleFilePick} activeOpacity={0.7}>
                                <Upload size={36} color="#6366f1" />
                                <Text style={styles.dropZoneTitle}>파일 선택 (여러 개 가능)</Text>
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
                    {step === 'preview' && (
                        <>
                            {/* 파일 탭 */}
                            <Text style={styles.sectionLabel}>
                                업로드한 파일 ({files.length})
                                {appliedFilesCount > 0 && (
                                    <Text style={{ color: '#15803d', fontWeight: '700' }}>
                                        {'  ·  '}✓ {appliedFilesCount}개 적용 완료
                                    </Text>
                                )}
                                {remainingFilesCount > 0 && (
                                    <Text style={{ color: '#6366f1', fontWeight: '700' }}>
                                        {'  ·  '}{remainingFilesCount}개 남음
                                    </Text>
                                )}
                            </Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fileTabsScroll}>
                                <View style={styles.fileTabs}>
                                    {files.map(f => {
                                        const active = f.id === activeId;
                                        const src = f.source;
                                        let countText = '';
                                        if (f.applied) {
                                            countText = `✓ ${f.appliedRows ?? 0}건 적용됨`;
                                        } else if (f.plan) {
                                            let rows = f.plan.plans;
                                            if (skipUnchanged) rows = rows.filter(p => p.fieldChanges.some(c => c.changed));
                                            if (!applySuspicious) rows = rows.filter(p => !p.suspicious);
                                            countText = `${rows.length}건`;
                                        } else {
                                            countText = '미감지';
                                        }
                                        return (
                                            <TouchableOpacity
                                                key={f.id}
                                                style={[
                                                    styles.fileTab,
                                                    active && styles.fileTabActive,
                                                    f.applied && !active && styles.fileTabApplied,
                                                ]}
                                                onPress={() => setActiveId(f.id)}
                                            >
                                                <Text style={styles.fileTabIcon}>
                                                    {f.applied ? '✅' : (src?.emoji || '⚠️')}
                                                </Text>
                                                <View style={{ flex: 1 }}>
                                                    <Text
                                                        style={[
                                                            styles.fileTabName,
                                                            active && styles.fileTabNameActive,
                                                            f.applied && !active && styles.fileTabNameApplied,
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        {f.name}
                                                    </Text>
                                                    <Text
                                                        style={[
                                                            styles.fileTabSub,
                                                            active && styles.fileTabSubActive,
                                                            f.applied && !active && styles.fileTabSubApplied,
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        {f.applied
                                                            ? `${countText}${f.appliedAt ? ` · ${f.appliedAt}` : ''}`
                                                            : `${src?.name || '미감지'} · ${countText}`}
                                                    </Text>
                                                </View>
                                                <TouchableOpacity
                                                    onPress={(e) => { e.stopPropagation?.(); removeFile(f.id); }}
                                                    hitSlop={6}
                                                    style={styles.fileTabClose}
                                                >
                                                    <X size={12} color={active ? '#ffffff' : '#9ca3af'} />
                                                </TouchableOpacity>
                                            </TouchableOpacity>
                                        );
                                    })}
                                    <TouchableOpacity style={styles.addFileBtn} onPress={handleFilePick}>
                                        <Upload size={14} color="#6366f1" />
                                        <Text style={styles.addFileBtnText}>파일 추가</Text>
                                    </TouchableOpacity>
                                </View>
                            </ScrollView>

                            {!activeFile ? (
                                <Text style={styles.helperText}>위에서 파일을 선택해 미리보기를 확인하세요.</Text>
                            ) : (
                                <>
                                    {/* 적용 완료된 파일이면 안내 */}
                                    {activeFile.applied && (
                                        <View style={styles.appliedBanner}>
                                            <Check size={16} color="#15803d" />
                                            <Text style={styles.appliedBannerText}>
                                                이 파일은 {activeFile.appliedAt} 에 {activeFile.appliedRows}건 적용되었어요.
                                                다른 파일 탭을 눌러 검토를 이어가세요.
                                            </Text>
                                        </View>
                                    )}

                                    {/* 소스 종류 (수동 변경 가능) */}
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

                                    {/* 옵션 (모든 파일에 일관 적용) */}
                                    <View style={styles.optionsRow}>
                                        <TouchableOpacity style={styles.option} onPress={() => setSkipUnchanged(v => !v)}>
                                            <View style={[styles.checkbox, skipUnchanged && styles.checkboxOn]}>
                                                {skipUnchanged && <Check size={14} color="#ffffff" />}
                                            </View>
                                            <Text style={styles.optionText}>변화 없는 행 건너뛰기</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.option} onPress={() => setAppendHistory(v => !v)}>
                                            <View style={[styles.checkbox, appendHistory && styles.checkboxOn]}>
                                                {appendHistory && <Check size={14} color="#ffffff" />}
                                            </View>
                                            <Text style={styles.optionText}>처리이력에 한 줄 추가</Text>
                                        </TouchableOpacity>
                                        {plan && plan.suspiciousCount > 0 && (
                                            <TouchableOpacity style={styles.option} onPress={() => setApplySuspicious(v => !v)}>
                                                <View style={[styles.checkbox, applySuspicious && styles.checkboxOnDanger]}>
                                                    {applySuspicious && <Check size={14} color="#ffffff" />}
                                                </View>
                                                <Text style={[styles.optionText, { color: '#b91c1c' }]}>의심 매칭도 적용 (위험)</Text>
                                            </TouchableOpacity>
                                        )}
                                        {selectedSource?.id === 'notion-export-reimport' && (
                                            <TouchableOpacity style={styles.option} onPress={() => setAllowBlankClear(v => !v)}>
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

                                    {/* 컬럼별 변경 요약 */}
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

                                    {/* 변경 미리보기 */}
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

                                    {/* 매칭 안 된 행 */}
                                    {plan && plan.unmatchedRows.length > 0 && (() => {
                                        const likely = plan.unmatchedRows.filter(u => u.classification === 'likely-yongin');
                                        const excluded = plan.unmatchedRows.filter(u => u.classification === 'excluded');
                                        return (
                                            <>
                                                <Text style={styles.sectionLabel}>
                                                    매칭 안 된 행 (전체 {plan.unmatchedRows.length}건)
                                                </Text>
                                                <Text style={styles.helperText}>
                                                    Notion에 없는 사용자명. 자동 추가는 안 하니 확인 후 일괄 업데이트에서 수동 추가하세요.
                                                </Text>
                                                {likely.length > 0 && (
                                                    <>
                                                        <Text style={styles.unmatchedGroupLabel}>
                                                            ✅ 용인 추정 ({likely.length}건)
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
                            {!!progressLabel && (
                                <Text style={styles.runningLabel} numberOfLines={1}>{progressLabel}</Text>
                            )}
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

                    {/* STEP: DONE — 모든 파일 적용 완료 */}
                    {step === 'done' && doneSummary && (
                        <View style={styles.doneBox}>
                            <View style={styles.doneIconCircle}>
                                <Check size={36} color="#15803d" />
                            </View>
                            <Text style={styles.doneTitle}>모든 파일 임포트 완료</Text>
                            <Text style={styles.doneStat}>
                                이번 세션에서 {doneSummary.files}개 파일 · {doneSummary.rows}건 적용했어요.
                                처리이력에도 누적됐어요.
                            </Text>
                            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                                <TouchableOpacity style={styles.doneBtn} onPress={resetAll}>
                                    <Text style={styles.doneBtnText}>다른 파일 임포트</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.doneBtn, { backgroundColor: '#e5e7eb' }]} onPress={handleClose}>
                                    <Text style={[styles.doneBtnText, { color: '#1f2937' }]}>닫기</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </ScrollView>

                {/* 하단 액션 */}
                {step === 'preview' && files.length > 0 && (
                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.footerCancel} onPress={handleClose}>
                            <Text style={styles.footerCancelText}>
                                {appliedFilesCount > 0 ? '닫기' : '취소'}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.footerApplyOne, activeApplyCount === 0 && styles.footerApplyDisabled]}
                            onPress={() => handleApply('active')}
                            disabled={activeApplyCount === 0}
                        >
                            <Text style={styles.footerApplyOneText}>
                                {activeFile?.applied
                                    ? '이미 적용됨'
                                    : `이 파일 ${activeApplyCount}건`}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.footerApply, totalApplyCount === 0 && styles.footerApplyDisabled]}
                            onPress={() => handleApply('all')}
                            disabled={totalApplyCount === 0}
                        >
                            <Text style={styles.footerApplyText}>
                                {appliedFilesCount > 0
                                    ? `남은 ${totalApplyCount}건 적용`
                                    : `전체 ${totalApplyCount}건 적용`}
                            </Text>
                            <ChevronRight size={16} color="#ffffff" />
                        </TouchableOpacity>
                    </View>
                )}
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

    fileTabsScroll: { marginBottom: 4 },
    fileTabs: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
    fileTab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: '#ffffff',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        minWidth: 200,
        maxWidth: 260,
    },
    fileTabActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
    fileTabApplied: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
    fileTabNameApplied: { color: '#15803d' },
    fileTabSubApplied: { color: '#16a34a' },
    fileTabIcon: { fontSize: 16 },
    fileTabName: { fontSize: 12, fontWeight: '700', color: '#1f2937' },
    fileTabNameActive: { color: '#ffffff' },
    fileTabSub: { fontSize: 10, color: '#64748b', marginTop: 1 },
    fileTabSubActive: { color: '#e0e7ff' },
    fileTabClose: { padding: 4 },
    addFileBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#eef2ff',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#c7d2fe',
        borderStyle: 'dashed',
    },
    addFileBtnText: { fontSize: 12, fontWeight: '600', color: '#6366f1' },

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
    appliedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#dcfce7',
        padding: 10,
        borderRadius: 8,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#bbf7d0',
    },
    appliedBannerText: { flex: 1, fontSize: 12, color: '#14532d', lineHeight: 16, fontWeight: '500' },

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

    planRow: {
        backgroundColor: '#ffffff',
        borderRadius: 8,
        padding: 10,
        marginBottom: 6,
    },
    planRowSuspicious: {
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fef2f2',
    },
    planRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    planName: { fontSize: 13, fontWeight: '700', color: '#1f2937' },
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
    unmatchedGroupLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#334155',
        marginTop: 10,
        marginBottom: 6,
    },
    unmatchedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#fffbeb',
        padding: 6,
        borderRadius: 6,
        marginBottom: 4,
    },
    unmatchedRowLikely: { backgroundColor: '#ecfdf5' },
    unmatchedText: { fontSize: 11, color: '#92400e', flex: 1 },
    excludedToggle: { marginTop: 6 },

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
    footerApplyOne: {
        flex: 1.2,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#e0e7ff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    footerApplyOneText: { fontSize: 13, color: '#4338ca', fontWeight: '700' },
    footerApply: {
        flex: 1.6,
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
    runningLabel: { fontSize: 11, color: '#64748b', maxWidth: 280, textAlign: 'center' },
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
