
import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    TextInput,
    Alert,
    Platform,
    Image,
} from 'react-native';
import { X, Upload, FileText, Image as ImageIcon, Zap, AlertTriangle, File, CheckCircle, Database, Copy } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { GeminiClient } from '../lib/gemini'; // Adjust path if needed
import { Asset } from '../lib/notion';
import { NOTION_API_KEY } from '../config'; // Use config for generic API key or passing it from props

interface ReportGeneratorModalProps {
    visible: boolean;
    onClose: () => void;
    geminiClient: GeminiClient | null;
    assets: Asset[]; // Optional: Use selected assets as context
}

interface FileItem {
    id: string;
    uri: string;
    name: string;
    type: 'image' | 'text' | 'file';
    mimeType?: string;
    size?: number;
    base64?: string; // For images
    textShort?: string; // For text preview
}

export const ReportGeneratorModal: React.FC<ReportGeneratorModalProps> = ({
    visible,
    onClose,
    geminiClient,
    assets
}) => {
    const [loading, setLoading] = useState(false);
    const [templateFiles, setTemplateFiles] = useState<FileItem[]>([]);
    const [contextFiles, setContextFiles] = useState<FileItem[]>([]);
    const [userInstruction, setUserInstruction] = useState('');
    const [generatedReport, setGeneratedReport] = useState('');
    const [step, setStep] = useState<'input' | 'result'>('input');
    const [progress, setProgress] = useState('');

    // Token estimation (rough)
    const estimateTokens = useCallback(() => {
        let tokens = 0;
        // Images: ~258 tokens (standardized for 1.5 Flash internal resizing)
        tokens += (templateFiles.filter(f => f.type === 'image').length + contextFiles.filter(f => f.type === 'image').length) * 258;
        // Text files: ~1 token per 4 chars
        contextFiles.filter(f => f.type === 'text').forEach(f => {
            tokens += (f.size || 0) / 4;
        });
        // Assets data
        // ... rough estimate
        return Math.round(tokens);
    }, [templateFiles, contextFiles]);

    const totalTokens = estimateTokens();
    const tokenStatus = totalTokens < 800000 ? 'safe' : (totalTokens < 950000 ? 'warning' : 'danger');

    const pickFile = async (target: 'template' | 'context') => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['image/*', 'text/*', 'application/json', 'application/pdf'], // PDF support limitation noted in plan
                multiple: true,
                copyToCacheDirectory: true
            });

            if (result.canceled) return;

            const newFiles: FileItem[] = [];

            for (const asset of result.assets) {
                // Image Optimization
                if (asset.mimeType?.startsWith('image/')) {
                    // Compress image
                    const manipulated = await ImageManipulator.manipulateAsync(
                        asset.uri,
                        [{ resize: { width: 1024 } }], // Max width 1024
                        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
                    );

                    newFiles.push({
                        id: Date.now() + Math.random().toString(),
                        uri: manipulated.uri,
                        name: asset.name,
                        type: 'image',
                        mimeType: 'image/jpeg',
                        base64: manipulated.base64,
                        size: asset.size
                    });
                } else if (asset.mimeType?.startsWith('text/') || asset.name.endsWith('.txt') || asset.name.endsWith('.md') || asset.name.endsWith('.json') || asset.name.endsWith('.csv')) {
                    // Read text content
                    const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
                    newFiles.push({
                        id: Date.now() + Math.random().toString(),
                        uri: asset.uri,
                        name: asset.name,
                        type: 'text',
                        mimeType: asset.mimeType || 'text/plain',
                        size: asset.size,
                        textShort: text // Store full text for simplicity, or manage separately
                    });
                } else {
                    // Unsupport for client-side text extraction of PDF/Doc yet (as per plan)
                    // Treat as 'file' just for listing, but maybe warn
                    Alert.alert('알림', `${asset.name}은(는) 미리보기/추출이 지원되지 않는 형식일 수 있습니다. (이미지나 텍스트 파일 권장)`);
                    continue;
                }
            }

            if (target === 'template') {
                setTemplateFiles(prev => [...prev, ...newFiles]);
            } else {
                setContextFiles(prev => [...prev, ...newFiles]);
            }

        } catch (error) {
            console.error('File pick error:', error);
            Alert.alert('Error', '파일을 불러오는데 실패했습니다.');
        }
    };

    const removeFile = (target: 'template' | 'context', id: string) => {
        if (target === 'template') {
            setTemplateFiles(prev => prev.filter(f => f.id !== id));
        } else {
            setContextFiles(prev => prev.filter(f => f.id !== id));
        }
    };

    const handleGenerate = async () => {
        if (!geminiClient) {
            Alert.alert('Error', 'AI 클라이언트가 초기화되지 않았습니다.');
            return;
        }

        if (templateFiles.length === 0) {
            Alert.alert('알림', '보고서 양식(Template)을 하나 이상 업로드해주세요.');
            return;
        }

        setLoading(true);
        setProgress('자료 분석 중...');

        try {
            const templateImages = templateFiles
                .filter(f => f.type === 'image' && f.base64)
                .map(f => f.base64!);

            const contextImages = contextFiles
                .filter(f => f.type === 'image' && f.base64)
                .map(f => f.base64!);

            const contextTexts = contextFiles
                .filter(f => f.type === 'text' && f.textShort)
                .map(f => f.textShort!);

            // Use assets passed to the modal as context data
            // (Assumes parent component passes relevant assets, e.g., filtered list)

            setProgress('보고서 생성 중... (최대 1분 소요)');

            const result = await geminiClient.generateReport(
                templateImages,
                contextImages,
                assets,
                contextTexts,
                userInstruction
            );

            if (result.error) {
                Alert.alert('생성 실패', result.error);
            } else {
                setGeneratedReport(result.report);
                setStep('result');
            }

        } catch (error) {
            console.error('Generation error:', error);
            Alert.alert('Error', '보고서 생성 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
            setProgress('');
        }
    };

    const copyToClipboard = async () => {
        // Platform specific clipboard
        if (Platform.OS === 'web') {
            await navigator.clipboard.writeText(generatedReport);
            Alert.alert('복사됨', '클립보드에 복사되었습니다.');
        } else {
            const Clipboard = require('expo-clipboard');
            await Clipboard.setStringAsync(generatedReport);
            Alert.alert('복사됨', '클립보드에 복사되었습니다.');
        }
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>AI 특수 보고서 작성</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <X size={24} color="#374151" />
                    </TouchableOpacity>
                </View>

                {step === 'input' ? (
                    <ScrollView style={styles.content}>
                        {/* 1. Template Section */}
                        <View style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <FileText size={20} color="#4f46e5" />
                                <Text style={styles.sectionTitle}>1. 보고서 양식 (Template)</Text>
                            </View>
                            <Text style={styles.sectionDesc}>
                                작성하려는 보고서의 양식 이미지나 예시 파일을 업로드하세요.
                            </Text>

                            <View style={styles.fileList}>
                                {templateFiles.map(file => (
                                    <View key={file.id} style={styles.fileItem}>
                                        {file.type === 'image' ? <ImageIcon size={16} color="#6366f1" /> : <FileText size={16} color="#6366f1" />}
                                        <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                                        <TouchableOpacity onPress={() => removeFile('template', file.id)}>
                                            <X size={16} color="#9ca3af" />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                                <TouchableOpacity style={styles.addButton} onPress={() => pickFile('template')}>
                                    <Upload size={16} color="#4f46e5" />
                                    <Text style={styles.addButtonText}>양식 파일 추가 (이미지/텍스트)</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* 2. Context Section */}
                        <View style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <Database size={20} color="#059669" />
                                <Text style={styles.sectionTitle}>2. 참고 자료 (Context)</Text>
                            </View>
                            <Text style={styles.sectionDesc}>
                                보고서 내용에 들어갈 데이터, 이미지, 문서 등을 업로드하세요.
                            </Text>

                            <View style={styles.fileList}>
                                {contextFiles.map(file => (
                                    <View key={file.id} style={styles.fileItem}>
                                        {file.type === 'image' ? <ImageIcon size={16} color="#059669" /> : <FileText size={16} color="#059669" />}
                                        <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                                        <TouchableOpacity onPress={() => removeFile('context', file.id)}>
                                            <X size={16} color="#9ca3af" />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                                <TouchableOpacity style={[styles.addButton, { borderColor: '#059669' }]} onPress={() => pickFile('context')}>
                                    <Upload size={16} color="#059669" />
                                    <Text style={[styles.addButtonText, { color: '#059669' }]}>참고 자료 추가</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* 3. Instruction Section */}
                        <View style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <Zap size={20} color="#d97706" />
                                <Text style={styles.sectionTitle}>3. 추가 지시사항 (선택)</Text>
                            </View>
                            <TextInput
                                style={styles.instructionInput}
                                placeholder="예: '결론 부분에 향후 계획을 3가지로 요약해서 넣어줘', '어조를 정중하게 변경해줘'"
                                multiline
                                numberOfLines={3}
                                value={userInstruction}
                                onChangeText={setUserInstruction}
                            />
                        </View>

                        {/* Token Gauge */}
                        <View style={styles.tokenContainer}>
                            <View style={styles.tokenHeader}>
                                <Text style={styles.tokenLabel}>예상 AI 처리량</Text>
                                <Text style={[styles.tokenValue,
                                tokenStatus === 'safe' ? { color: '#10b981' } :
                                    tokenStatus === 'warning' ? { color: '#f59e0b' } : { color: '#ef4444' }
                                ]}>
                                    {totalTokens.toLocaleString()} / 1,000,000 Tokens
                                </Text>
                            </View>
                            <View style={styles.tokenBarBg}>
                                <View style={[styles.tokenBarFill,
                                { width: `${Math.min((totalTokens / 1000000) * 100, 100)}%` },
                                tokenStatus === 'safe' ? { backgroundColor: '#10b981' } :
                                    tokenStatus === 'warning' ? { backgroundColor: '#f59e0b' } : { backgroundColor: '#ef4444' }
                                ]} />
                            </View>
                            {tokenStatus !== 'safe' && (
                                <View style={styles.warningBox}>
                                    <AlertTriangle size={14} color="#b45309" />
                                    <Text style={styles.warningText}>
                                        자료가 너무 많으면 처리 시간이 길어질 수 있습니다.
                                    </Text>
                                </View>
                            )}
                        </View>

                        <TouchableOpacity
                            style={[styles.generateButton, loading && styles.generateButtonDisabled]}
                            onPress={handleGenerate}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#ffffff" />
                            ) : (
                                <>
                                    <Zap size={20} color="#ffffff" />
                                    <Text style={styles.generateButtonText}>보고서 생성하기</Text>
                                </>
                            )}
                        </TouchableOpacity>
                        {loading && <Text style={styles.loadingText}>{progress}</Text>}
                        <View style={{ height: 40 }} />
                    </ScrollView>
                ) : (
                    <View style={styles.resultContainer}>
                        <View style={styles.resultHeader}>
                            <CheckCircle size={24} color="#10b981" />
                            <Text style={styles.resultTitle}>생성 완료!</Text>
                        </View>
                        <TextInput
                            style={styles.resultEditor}
                            multiline
                            value={generatedReport}
                            onChangeText={setGeneratedReport}
                            textAlignVertical="top"
                        />
                        <View style={styles.resultActions}>
                            <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep('input')}>
                                <Text style={styles.secondaryButtonText}>다시 설정</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.primaryButton} onPress={copyToClipboard}>
                                <Copy size={20} color="#ffffff" />
                                <Text style={styles.primaryButtonText}>결과 복사</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    closeButton: {
        padding: 8,
    },
    content: {
        flex: 1,
        padding: 16,
    },
    section: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 8,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
    },
    sectionDesc: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 16,
    },
    fileList: {
        gap: 8,
    },
    fileItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f3f4f6',
        padding: 10,
        borderRadius: 8,
        gap: 8,
    },
    fileName: {
        flex: 1,
        fontSize: 14,
        color: '#374151',
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderWidth: 1,
        borderColor: '#4f46e5',
        borderStyle: 'dashed',
        borderRadius: 8,
        gap: 8,
        backgroundColor: '#eef2ff',
    },
    addButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#4f46e5',
    },
    instructionInput: {
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        padding: 12,
        fontSize: 14,
        minHeight: 80,
        textAlignVertical: 'top',
    },
    tokenContainer: {
        marginVertical: 16,
    },
    tokenHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    tokenLabel: {
        fontSize: 12,
        color: '#6b7280',
    },
    tokenValue: {
        fontSize: 12,
        fontWeight: '600',
    },
    tokenBarBg: {
        height: 8,
        backgroundColor: '#e5e7eb',
        borderRadius: 4,
        overflow: 'hidden',
    },
    tokenBarFill: {
        height: '100%',
        borderRadius: 4,
    },
    warningBox: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        gap: 4,
        backgroundColor: '#fef3c7',
        padding: 8,
        borderRadius: 6,
    },
    warningText: {
        fontSize: 12,
        color: '#b45309',
    },
    generateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#4f46e5',
        padding: 16,
        borderRadius: 12,
        gap: 8,
        marginTop: 8,
    },
    generateButtonDisabled: {
        opacity: 0.7,
    },
    generateButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    loadingText: {
        textAlign: 'center',
        marginTop: 12,
        color: '#6b7280',
        fontSize: 14,
    },
    resultContainer: {
        flex: 1,
        padding: 16,
    },
    resultHeader: {
        alignItems: 'center',
        marginBottom: 20,
        gap: 8,
    },
    resultTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    resultEditor: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        padding: 16,
        fontSize: 14,
        color: '#374151',
        marginBottom: 16,
    },
    resultActions: {
        flexDirection: 'row',
        gap: 12,
    },
    primaryButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#4f46e5',
        padding: 16,
        borderRadius: 12,
        gap: 8,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    secondaryButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f3f4f6',
        padding: 16,
        borderRadius: 12,
    },
    secondaryButtonText: {
        color: '#374151',
        fontSize: 16,
        fontWeight: '600',
    },
});
