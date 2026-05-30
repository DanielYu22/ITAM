/**
 * DBManagementModal — 내보내기 / 일괄 업데이트 / 소스 임포트 액션시트
 *
 * 도구 영역에 카드 3개를 따로 두는 대신 'DB 관리' 한 카드로 묶어서
 * 단순화. 이 모달이 3가지 액션의 진입점이 됩니다.
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Alert,
    TextInput,
} from 'react-native';
import { X, Download, Upload, FileUp, Eraser } from 'lucide-react-native';

interface Props {
    visible: boolean;
    onClose: () => void;
    onExport: () => void;
    onBulkUpdate: () => void;
    onSourceImport: () => void;
    /** 처리이력에서 특정 날짜로 시작하는 줄들 정리 */
    onCleanupHistoryDates?: (dates: string[]) => Promise<{ changed: number; scanned: number }>;
    cleanupProgress?: { current: number; total: number } | null;
}

export const DBManagementModal: React.FC<Props> = ({
    visible,
    onClose,
    onExport,
    onBulkUpdate,
    onSourceImport,
    onCleanupHistoryDates,
    cleanupProgress,
}) => {
    // 정리 대상 날짜 입력 — 기본값에 사용자가 요청한 5월 30/31 들어가 있음
    const [cleanupDates, setCleanupDates] = useState('2026-05-30, 2026-05-31');
    const [showCleanup, setShowCleanup] = useState(false);

    const handleRunCleanup = async () => {
        if (!onCleanupHistoryDates) return;
        const dates = cleanupDates
            .split(/[,\s]+/)
            .map(d => d.trim())
            .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
        if (dates.length === 0) {
            Alert.alert('날짜 형식 오류', 'YYYY-MM-DD 형식으로 한 개 이상 입력해 주세요.');
            return;
        }
        try {
            const result = await onCleanupHistoryDates(dates);
            Alert.alert(
                '정리 완료',
                `${result.scanned}대 검사 · ${result.changed}대 변경.\n해당 날짜로 시작하는 처리이력 줄을 모두 제거했어요.`
            );
            setShowCleanup(false);
            onClose();
        } catch (e) {
            Alert.alert('오류', '정리 중 문제가 발생했습니다.');
        }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
                <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => { /* swallow */ }}>
                    <View style={styles.header}>
                        <Text style={styles.title}>DB 관리</Text>
                        <TouchableOpacity onPress={onClose}>
                            <X size={22} color="#6b7280" />
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() => { onClose(); onSourceImport(); }}
                    >
                        <View style={[styles.iconBox, { backgroundColor: '#ede9fe' }]}>
                            <FileUp size={22} color="#7c3aed" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.actionTitle}>소스 임포트</Text>
                            <Text style={styles.actionDesc}>
                                알약 ASM 결과 / 유저정보 / 미등록 / Notion export 재임포트
                            </Text>
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() => { onClose(); onBulkUpdate(); }}
                    >
                        <View style={[styles.iconBox, { backgroundColor: '#fef3c7' }]}>
                            <Upload size={22} color="#d97706" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.actionTitle}>일괄 업데이트</Text>
                            <Text style={styles.actionDesc}>
                                자유 매핑 + 룩업 컬럼으로 행 일괄 수정
                            </Text>
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() => { onClose(); onExport(); }}
                    >
                        <View style={[styles.iconBox, { backgroundColor: '#dcfce7' }]}>
                            <Download size={22} color="#16a34a" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.actionTitle}>내보내기</Text>
                            <Text style={styles.actionDesc}>
                                현재 상태를 CSV/XLSX 로 저장 (Notion export 재임포트와 호환)
                            </Text>
                        </View>
                    </TouchableOpacity>

                    {onCleanupHistoryDates && (
                        <TouchableOpacity
                            style={styles.actionRow}
                            onPress={() => setShowCleanup(true)}
                        >
                            <View style={[styles.iconBox, { backgroundColor: '#fee2e2' }]}>
                                <Eraser size={22} color="#dc2626" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.actionTitle}>처리이력 날짜 정리</Text>
                                <Text style={styles.actionDesc}>
                                    특정 날짜로 시작하는 이력 줄만 일괄 삭제 (테스트 정리용)
                                </Text>
                            </View>
                        </TouchableOpacity>
                    )}
                </TouchableOpacity>

                {/* 정리 다이얼로그 */}
                {showCleanup && (
                    <Modal visible transparent animationType="fade">
                        <View style={styles.cleanupOverlay}>
                            <View style={styles.cleanupBox}>
                                <Text style={styles.cleanupTitle}>처리이력 날짜 정리</Text>
                                <Text style={styles.cleanupDesc}>
                                    아래 날짜로 시작하는 줄을 모든 자산의 처리이력에서 제거합니다.{'\n'}
                                    여러 개는 쉼표/공백/줄바꿈으로 구분. 형식: YYYY-MM-DD.
                                </Text>
                                <TextInput
                                    style={styles.cleanupInput}
                                    value={cleanupDates}
                                    onChangeText={setCleanupDates}
                                    placeholder="2026-05-30, 2026-05-31"
                                    placeholderTextColor="#94a3b8"
                                    multiline
                                />
                                {cleanupProgress && (
                                    <View style={styles.cleanupProgress}>
                                        <Text style={styles.cleanupProgressText}>
                                            처리 중… {cleanupProgress.current} / {cleanupProgress.total}
                                        </Text>
                                        <View style={styles.cleanupBarTrack}>
                                            <View
                                                style={[
                                                    styles.cleanupBarFill,
                                                    {
                                                        width: `${cleanupProgress.total
                                                            ? (cleanupProgress.current / cleanupProgress.total) * 100
                                                            : 0}%`,
                                                    },
                                                ]}
                                            />
                                        </View>
                                    </View>
                                )}
                                <View style={styles.cleanupActions}>
                                    <TouchableOpacity
                                        style={styles.cleanupCancel}
                                        onPress={() => setShowCleanup(false)}
                                        disabled={!!cleanupProgress}
                                    >
                                        <Text style={styles.cleanupCancelText}>취소</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.cleanupRun, !!cleanupProgress && { opacity: 0.6 }]}
                                        onPress={handleRunCleanup}
                                        disabled={!!cleanupProgress}
                                    >
                                        <Text style={styles.cleanupRunText}>
                                            {cleanupProgress ? '진행 중…' : '실행'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    </Modal>
                )}
            </TouchableOpacity>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    sheet: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        width: '100%',
        maxWidth: 420,
        padding: 14,
        gap: 8,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
        paddingHorizontal: 4,
    },
    title: { fontSize: 16, fontWeight: '800', color: '#1f2937' },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 12,
        backgroundColor: '#f8fafc',
    },
    iconBox: {
        width: 44,
        height: 44,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actionTitle: { fontSize: 14, fontWeight: '700', color: '#1f2937' },
    actionDesc: { fontSize: 11, color: '#64748b', marginTop: 2 },

    cleanupOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    cleanupBox: {
        backgroundColor: '#ffffff',
        borderRadius: 14,
        padding: 16,
        width: '100%',
        maxWidth: 420,
        gap: 10,
    },
    cleanupTitle: { fontSize: 16, fontWeight: '800', color: '#dc2626' },
    cleanupDesc: { fontSize: 12, color: '#475569', lineHeight: 18 },
    cleanupInput: {
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        color: '#1f2937',
        minHeight: 60,
        textAlignVertical: 'top',
    },
    cleanupProgress: { gap: 6 },
    cleanupProgressText: { fontSize: 11, color: '#64748b', fontWeight: '700' },
    cleanupBarTrack: { height: 6, backgroundColor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' },
    cleanupBarFill: { height: '100%', backgroundColor: '#dc2626' },
    cleanupActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    cleanupCancel: {
        flex: 1,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
    },
    cleanupCancelText: { fontSize: 13, fontWeight: '700', color: '#475569' },
    cleanupRun: {
        flex: 2,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#dc2626',
        alignItems: 'center',
    },
    cleanupRunText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
});
