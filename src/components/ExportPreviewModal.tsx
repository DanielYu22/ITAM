import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    Platform,
} from 'react-native';
import { X, Copy, Download, Check, FileSpreadsheet } from 'lucide-react-native';
import { Asset } from '../lib/notion';

interface ExportPreviewModalProps {
    visible: boolean;
    onClose: () => void;
    assets: Asset[];
    schema: string[];
}

export const ExportPreviewModal: React.FC<ExportPreviewModalProps> = ({
    visible,
    onClose,
    assets,
    schema,
}) => {
    const [copied, setCopied] = useState(false);
    const [downloaded, setDownloaded] = useState(false);

    // 'Name' 컬럼이 없으면 맨 앞에 추가
    const fullSchema = useMemo(() => {
        if (schema.includes('Name')) return schema;
        return ['Name', ...schema];
    }, [schema]);

    // 미리보기용 데이터 (최대 10행)
    const previewData = useMemo(() => assets.slice(0, 10), [assets]);

    // CSV 문자열 생성 (콤마 구분)
    const generateCSV = (): string => {
        const escapeCSV = (val: string) => {
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        };

        const header = fullSchema.map(escapeCSV).join(',');
        const rows = assets.map(asset =>
            fullSchema.map(col => escapeCSV(asset.values[col] || '')).join(',')
        );

        return [header, ...rows].join('\n');
    };

    // TSV 문자열 생성 (Tab 구분 - Excel 붙여넣기용)
    const generateTSV = (): string => {
        const escapeTSV = (val: string): string => {
            // Tab, 줄바꿈 문자를 공백으로 치환
            return String(val || '').replace(/[\t\r\n]/g, ' ');
        };

        const headerRow = fullSchema.map(col => escapeTSV(col)).join('\t');
        const dataRows = assets.map(asset => {
            return fullSchema.map(col => escapeTSV(asset.values[col] || '')).join('\t');
        });

        return headerRow + '\n' + dataRows.join('\n');
    };

    // 클립보드로 복사 (TSV - Excel 호환)
    const handleCopyToClipboard = async () => {
        try {
            const tsv = generateTSV();

            if (Platform.OS === 'web') {
                await navigator.clipboard.writeText(tsv);
            } else {
                // React Native용 Clipboard (expo-clipboard 사용 시)
                const Clipboard = require('expo-clipboard');
                await Clipboard.setStringAsync(tsv);
            }

            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Clipboard copy failed:', error);
            alert('클립보드 복사에 실패했습니다.');
        }
    };

    // CSV 파일 다운로드
    const handleDownloadCSV = () => {
        try {
            const csv = generateCSV();
            const filename = `export_${new Date().toISOString().slice(0, 10)}.csv`;

            if (Platform.OS === 'web') {
                // 웹에서는 Blob을 생성하여 다운로드
                const BOM = '\uFEFF'; // UTF-8 BOM for Excel
                const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                // 모바일에서는 expo-file-system + expo-sharing 사용
                const FileSystem = require('expo-file-system');
                const Sharing = require('expo-sharing');

                const fileUri = FileSystem.documentDirectory + filename;
                FileSystem.writeAsStringAsync(fileUri, csv, {
                    encoding: FileSystem.EncodingType.UTF8,
                }).then(() => {
                    Sharing.shareAsync(fileUri);
                });
            }

            setDownloaded(true);
            setTimeout(() => setDownloaded(false), 2000);
        } catch (error) {
            console.error('CSV download failed:', error);
            alert('CSV 다운로드에 실패했습니다.');
        }
    };

    return (
        <Modal visible={visible} animationType="fade" transparent>
            <View style={styles.overlay}>
                <View style={styles.container}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <FileSpreadsheet size={24} color="#6366f1" />
                            <Text style={styles.headerTitle}>데이터 내보내기</Text>
                        </View>
                        <TouchableOpacity onPress={onClose}>
                            <X size={24} color="#6b7280" />
                        </TouchableOpacity>
                    </View>

                    {/* Summary */}
                    <View style={styles.summary}>
                        <Text style={styles.summaryText}>
                            <Text style={styles.summaryHighlight}>{assets.length}개</Text> 항목 • {fullSchema.length}개 컬럼
                        </Text>
                    </View>

                    {/* Preview Table */}
                    <View style={styles.previewContainer}>
                        <Text style={styles.previewLabel}>미리보기 (최대 10행)</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator>
                            <View>
                                {/* Header Row */}
                                <View style={styles.tableRow}>
                                    {fullSchema.slice(0, 6).map((col, i) => (
                                        <View key={col} style={[styles.tableCell, styles.tableHeaderCell]}>
                                            <Text style={styles.tableHeaderText} numberOfLines={1}>
                                                {col}
                                            </Text>
                                        </View>
                                    ))}
                                    {fullSchema.length > 6 && (
                                        <View style={[styles.tableCell, styles.tableHeaderCell]}>
                                            <Text style={styles.tableHeaderText}>+{fullSchema.length - 6}</Text>
                                        </View>
                                    )}
                                </View>
                                {previewData.map((asset, rowIndex) => (
                                    <View key={asset.id} style={styles.tableRow}>
                                        {fullSchema.slice(0, 6).map((col, i) => (
                                            <View key={col} style={styles.tableCell}>
                                                <Text style={styles.tableCellText} numberOfLines={1}>
                                                    {asset.values[col] || '-'}
                                                </Text>
                                            </View>
                                        ))}
                                        {fullSchema.length > 6 && (
                                            <View style={styles.tableCell}>
                                                <Text style={styles.tableCellText}>...</Text>
                                            </View>
                                        )}
                                    </View>
                                ))}
                                {assets.length > 10 && (
                                    <View style={styles.moreRows}>
                                        <Text style={styles.moreRowsText}>
                                            ... 외 {assets.length - 10}개 항목
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </ScrollView>
                    </View>

                    {/* Actions */}
                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={[styles.actionButton, styles.clipboardButton]}
                            onPress={handleCopyToClipboard}
                        >
                            {copied ? (
                                <Check size={20} color="#10b981" />
                            ) : (
                                <Copy size={20} color="#6366f1" />
                            )}
                            <Text style={[styles.actionButtonText, styles.clipboardButtonText]}>
                                {copied ? '복사됨!' : '클립보드로 복사'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.actionButton, styles.downloadButton]}
                            onPress={handleDownloadCSV}
                        >
                            {downloaded ? (
                                <Check size={20} color="#ffffff" />
                            ) : (
                                <Download size={20} color="#ffffff" />
                            )}
                            <Text style={[styles.actionButtonText, styles.downloadButtonText]}>
                                {downloaded ? '완료!' : 'CSV로 다운로드'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.hint}>
                        💡 클립보드 복사는 Excel에 붙여넣기 시 그리드 형태로 유지됩니다
                    </Text>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    container: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        width: '100%',
        maxWidth: 600,
        maxHeight: '80%',
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    summary: {
        backgroundColor: '#f0fdf4',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
    },
    summaryText: {
        fontSize: 14,
        color: '#166534',
    },
    summaryHighlight: {
        fontWeight: 'bold',
        color: '#15803d',
    },
    previewContainer: {
        flex: 1,
        marginBottom: 16,
    },
    previewLabel: {
        fontSize: 12,
        color: '#6b7280',
        marginBottom: 8,
    },
    tableRow: {
        flexDirection: 'row',
    },
    tableCell: {
        width: 100,
        padding: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        backgroundColor: '#ffffff',
    },
    tableHeaderCell: {
        backgroundColor: '#f3f4f6',
    },
    tableHeaderText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#374151',
    },
    tableCellText: {
        fontSize: 12,
        color: '#6b7280',
    },
    moreRows: {
        padding: 12,
        alignItems: 'center',
    },
    moreRowsText: {
        fontSize: 12,
        color: '#9ca3af',
        fontStyle: 'italic',
    },
    actions: {
        flexDirection: 'row',
        gap: 12,
    },
    actionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 14,
        borderRadius: 10,
        gap: 8,
    },
    clipboardButton: {
        backgroundColor: '#eef2ff',
        borderWidth: 1,
        borderColor: '#c7d2fe',
    },
    downloadButton: {
        backgroundColor: '#6366f1',
    },
    actionButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    clipboardButtonText: {
        color: '#6366f1',
    },
    downloadButtonText: {
        color: '#ffffff',
    },
    hint: {
        fontSize: 12,
        color: '#9ca3af',
        textAlign: 'center',
        marginTop: 12,
    },
});
