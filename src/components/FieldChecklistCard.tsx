/**
 * FieldChecklistCard — 현장 출장용 과제 체크리스트 (2026-06-18)
 *   "현장 가서 할 일"을 모바일에서 항목별로 체크오프하는 현장툴.
 *   체크 상태는 localStorage 에 사이트별로 영속(새로고침/앱 재진입해도 유지).
 *   각 항목은 관련 기능(현장 서베이 / 가져오기 / 인프라)으로 바로 점프 가능.
 *
 *   자체 완결형 — App 에서 새 prop 배선 없이 HomeScreen 이 이미 가진
 *   currentSite + 기존 콜백(onOpenFieldSurvey/onSourceImport/onOpenInfrastructure)만 받는다.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CheckSquare, Square, ChevronRight } from 'lucide-react-native';
import type { SiteId } from '../lib/sites';

type LinkTarget = 'survey' | 'import' | 'infra';

interface FieldTask {
    id: string;
    label: string;
    detail: string;
    link?: LinkTarget;
    linkLabel?: string;
}

/** 사이트별 현장 과제. 출장 갈 때마다 여기 항목만 늘리면 됨. */
const FIELD_TASKS: Partial<Record<SiteId, { title: string; tasks: FieldTask[] }>> = {
    yongin: {
        title: '🧳 용인 현장 과제',
        tasks: [
            {
                id: 'yi-layout',
                label: '바이오센터 전층 레이아웃 영상',
                detail: '방문 동선 순서대로 촬영. 각 실험실 호실/간판이 프레임에 들어오게.',
                link: 'infra', linkLabel: '인프라·레이아웃 열기',
            },
            {
                id: 'yi-nas-clients',
                label: 'NAS 클라이언트 PC 목록 + 스케줄러 설치 확인',
                detail: 'SMB로 NAS 진입 → 각 PC가 만든 백업파일 "생성시각" 확인(오늘 07시대=설치+온라인+정상 / 오래됨=멈춤점검 / 없음=미설치). PC별 스케줄러 설치여부 같이 기록.',
            },
            {
                id: 'yi-asm-export',
                label: 'ASM 3종 출력 (자산정보·미등록·정책푸시)',
                detail: 'ASM 콘솔에서 CSV 출력 → IP/온라인구분/정책 채움. 용인 FA 10.9.50.0/23 IP 정합성 입력값.',
                link: 'import', linkLabel: '가져오기 열기',
            },
            {
                id: 'yi-integrity-report',
                label: '분기백업 무결성 리포트 확보',
                detail: 'Final_Integrity_Report.csv 받아오기 → 분기백업 실제 PASS/FAIL.',
                link: 'import', linkLabel: '가져오기 열기',
            },
            {
                id: 'yi-nas-ip',
                label: '용인 NAS 실측 IP 확인',
                detail: '방화벽 룰 등록값: NAS1 192.168.244.245 / NAS2 192.168.244.239. 바뀌었으면 기록(대역 룰 갱신).',
            },
            {
                id: 'yi-closed-net',
                label: '폐쇄망/오프라인 기기 눈 확인',
                detail: 'ASM·NAS 둘 다 신호 안 잡히는 기기 — 자동 임포트로 절대 안 채워짐. 현장에서만 잡힘.',
                link: 'survey', linkLabel: '현장 서베이 열기',
            },
            {
                id: 'yi-label-db',
                label: '라벨 ↔ DB 대조 (유령/이동 기기)',
                detail: '정합성 ghost(레이아웃엔 있는데 데이터 없음) 뜬 방 실물 대조. 라벨 없는 기기 부착.',
                link: 'survey', linkLabel: '현장 서베이 열기',
            },
        ],
    },
};

const keyFor = (site: SiteId) => `nexus_field_tasks_${site}`;

const loadDone = (site: SiteId): Set<string> => {
    try {
        if (typeof localStorage === 'undefined') return new Set();
        const raw = localStorage.getItem(keyFor(site));
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
};

interface Props {
    currentSite: SiteId;
    onOpenFieldSurvey?: () => void;
    onSourceImport?: () => void;
    onOpenInfrastructure?: () => void;
}

export const FieldChecklistCard: React.FC<Props> = ({
    currentSite, onOpenFieldSurvey, onSourceImport, onOpenInfrastructure,
}) => {
    // 전체/용인 보기일 때만 용인 과제 노출(다른 사이트에선 숨김).
    const siteForTasks: SiteId = (currentSite === 'all' || currentSite === 'yongin') ? 'yongin' : currentSite;
    const plan = FIELD_TASKS[siteForTasks];

    const [done, setDone] = useState<Set<string>>(() => loadDone(siteForTasks));
    const [open, setOpen] = useState(true);

    const persist = useCallback((next: Set<string>) => {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(keyFor(siteForTasks), JSON.stringify([...next]));
            }
        } catch { /* */ }
    }, [siteForTasks]);

    const toggle = useCallback((id: string) => {
        setDone(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            persist(next);
            return next;
        });
    }, [persist]);

    const reset = useCallback(() => {
        const empty = new Set<string>();
        setDone(empty);
        persist(empty);
    }, [persist]);

    const jump = useCallback((link?: LinkTarget) => {
        if (link === 'survey') onOpenFieldSurvey?.();
        else if (link === 'import') onSourceImport?.();
        else if (link === 'infra') onOpenInfrastructure?.();
    }, [onOpenFieldSurvey, onSourceImport, onOpenInfrastructure]);

    if (!plan) return null;
    const total = plan.tasks.length;
    const doneCount = plan.tasks.filter(t => done.has(t.id)).length;
    const allDone = doneCount === total;

    return (
        <View style={[styles.card, allDone && styles.cardDone]}>
            <TouchableOpacity style={styles.header} onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
                <Text style={[styles.title, allDone && styles.titleDone]}>
                    {plan.title}  {allDone ? '✓ 완료' : `${doneCount}/${total}`}
                </Text>
                <View style={{ flex: 1 }} />
                {doneCount > 0 && (
                    <TouchableOpacity onPress={reset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.resetBtn}>초기화</Text>
                    </TouchableOpacity>
                )}
                <Text style={styles.caret}>{open ? '▾' : '▸'}</Text>
            </TouchableOpacity>

            {open && plan.tasks.map(t => {
                const checked = done.has(t.id);
                return (
                    <View key={t.id} style={styles.row}>
                        <TouchableOpacity
                            style={styles.checkHit}
                            onPress={() => toggle(t.id)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                            {checked
                                ? <CheckSquare size={22} color="#2563eb" />
                                : <Square size={22} color="#94a3b8" />}
                        </TouchableOpacity>
                        <View style={{ flex: 1, gap: 3 }}>
                            <Text style={[styles.label, checked && styles.labelDone]}>{t.label}</Text>
                            <Text style={[styles.detail, checked && styles.detailDone]}>{t.detail}</Text>
                            {t.link && (
                                <TouchableOpacity style={styles.link} onPress={() => jump(t.link)}>
                                    <Text style={styles.linkText}>{t.linkLabel || '열기'}</Text>
                                    <ChevronRight size={13} color="#2563eb" />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#eff6ff',
        borderWidth: 1,
        borderColor: '#bfdbfe',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 4,
        marginBottom: 16,
    },
    cardDone: {
        backgroundColor: '#f0fdf4',
        borderColor: '#bbf7d0',
    },
    header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    title: { fontSize: 13, fontWeight: '700', color: '#1d4ed8' },
    titleDone: { color: '#16a34a' },
    caret: { fontSize: 13, color: '#2563eb', fontWeight: '700', marginLeft: 8 },
    resetBtn: { fontSize: 11, color: '#64748b', fontWeight: '600', paddingHorizontal: 6 },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 9,
        paddingHorizontal: 2,
        borderTopWidth: 1,
        borderTopColor: '#dbeafe',
    },
    checkHit: { paddingTop: 1 },
    label: { fontSize: 13, color: '#1e293b', fontWeight: '600' },
    labelDone: { color: '#94a3b8', textDecorationLine: 'line-through' },
    detail: { fontSize: 11, color: '#475569', lineHeight: 15 },
    detailDone: { color: '#cbd5e1' },
    link: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2, alignSelf: 'flex-start' },
    linkText: { fontSize: 11, color: '#2563eb', fontWeight: '600' },
});
