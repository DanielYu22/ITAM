/**
 * DBManagementModal — 내보내기 / 일괄 업데이트 / 소스 임포트 액션시트
 *
 * 도구 영역에 카드 3개를 따로 두는 대신 'DB 관리' 한 카드로 묶어서
 * 단순화. 이 모달이 3가지 액션의 진입점이 됩니다.
 */

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
} from 'react-native';
import { X, Download, Upload, FileUp } from 'lucide-react-native';

interface Props {
    visible: boolean;
    onClose: () => void;
    onExport: () => void;
    onBulkUpdate: () => void;
    onSourceImport: () => void;
}

export const DBManagementModal: React.FC<Props> = ({
    visible,
    onClose,
    onExport,
    onBulkUpdate,
    onSourceImport,
}) => {
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
                </TouchableOpacity>
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
});
