import React, { useState, useRef } from 'react';
import { Mic, MicOff, Loader2, Sparkles, X, Check, Camera } from 'lucide-react';
import { GeminiClient } from '../lib/gemini';
import { FilterCondition } from '../lib/utils';

interface AIFilterButtonProps {
    schema: string[];
    schemaTypes: Record<string, string>;
    geminiApiKey: string;
    onFilterGenerated: (filter: FilterCondition, name?: string) => void;
}

export const AIFilterButton: React.FC<AIFilterButtonProps> = ({
    schema,
    schemaTypes,
    geminiApiKey,
    onFilterGenerated
}) => {
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [generatedFilter, setGeneratedFilter] = useState<FilterCondition | null>(null);
    const [explanation, setExplanation] = useState('');
    const [error, setError] = useState('');
    const [mode, setMode] = useState<'voice' | 'screenshot' | null>(null);

    const recognitionRef = useRef<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Check if Web Speech API is available
    const speechAvailable = typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

    const startListening = () => {
        if (!speechAvailable) {
            setError('음성 인식이 지원되지 않는 브라우저입니다.');
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();

        recognition.lang = 'ko-KR';
        recognition.continuous = false;
        recognition.interimResults = true;

        recognition.onstart = () => {
            setIsListening(true);
            setError('');
            setMode('voice');
        };

        recognition.onresult = (event: any) => {
            const current = event.resultIndex;
            const result = event.results[current];
            setTranscript(result[0].transcript);
        };

        recognition.onend = () => {
            setIsListening(false);
            if (transcript) {
                processVoiceCommand(transcript);
            }
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            setIsListening(false);
            setError(`음성 인식 오류: ${event.error}`);
        };

        recognitionRef.current = recognition;
        recognition.start();
    };

    const stopListening = () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
    };

    const processVoiceCommand = async (text: string) => {
        if (!text.trim()) return;

        setIsProcessing(true);
        setError('');

        try {
            const client = new GeminiClient({ apiKey: geminiApiKey });
            const result = await client.generateFilter(text, schema, schemaTypes);

            if (result.filter) {
                setGeneratedFilter(result.filter);
                setExplanation(result.explanation);
                setShowPreview(true);
            } else {
                setError(result.explanation || '필터를 생성할 수 없습니다.');
            }
        } catch (err) {
            console.error('Filter generation error:', err);
            setError('AI 처리 중 오류가 발생했습니다.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleScreenshotUpload = async (file: File) => {
        setIsProcessing(true);
        setError('');
        setMode('screenshot');

        try {
            // Convert file to base64
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = (e.target?.result as string).split(',')[1];

                const client = new GeminiClient({ apiKey: geminiApiKey });
                const result = await client.analyzeScreenshot(base64, schema);

                if (result.filter) {
                    setGeneratedFilter(result.filter);
                    setExplanation(result.explanation);
                    setShowPreview(true);
                } else {
                    setError(result.explanation || '필터를 추출할 수 없습니다.');
                }
                setIsProcessing(false);
            };
            reader.readAsDataURL(file);
        } catch (err) {
            console.error('Screenshot processing error:', err);
            setError('이미지 처리 중 오류가 발생했습니다.');
            setIsProcessing(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleScreenshotUpload(file);
        }
    };

    const applyFilter = () => {
        if (generatedFilter) {
            const filterName = mode === 'voice'
                ? `🎤 ${transcript.substring(0, 20)}...`
                : `📸 스크린샷 필터`;
            onFilterGenerated(generatedFilter, filterName);
            closePreview();
        }
    };

    const closePreview = () => {
        setShowPreview(false);
        setGeneratedFilter(null);
        setTranscript('');
        setExplanation('');
        setMode(null);
    };

    // Render filter conditions for preview
    const renderFilterPreview = (filter: FilterCondition, depth = 0): React.ReactNode => {
        if ('logic' in filter && filter.conditions) {
            return (
                <div className={`${depth > 0 ? 'ml-4 pl-4 border-l-2 border-indigo-200' : ''}`}>
                    <span className="text-xs font-bold text-indigo-500">{filter.logic}</span>
                    {filter.conditions.map((cond, idx) => (
                        <div key={idx}>{renderFilterPreview(cond, depth + 1)}</div>
                    ))}
                </div>
            );
        } else {
            return (
                <div className={`${depth > 0 ? 'ml-4' : ''} py-1`}>
                    <span className="text-sm text-theme-secondary">
                        <strong>{filter.field}</strong>{' '}
                        <span className="text-theme-tertiary">{filter.operator}</span>{' '}
                        {filter.value && <span className="text-indigo-500">"{filter.value}"</span>}
                    </span>
                </div>
            );
        }
    };

    return (
        <>
            {/* Action Buttons */}
            <div className="flex items-center gap-2">
                {/* Voice Button */}
                <button
                    onClick={isListening ? stopListening : startListening}
                    disabled={isProcessing}
                    className={`p-3 rounded-xl transition-all ${isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-theme-secondary border border-theme-primary text-theme-secondary hover:border-indigo-500 hover:text-indigo-500'
                        } disabled:opacity-50`}
                    title="음성으로 필터 생성"
                >
                    {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                </button>

                {/* Screenshot Button */}
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="p-3 rounded-xl bg-theme-secondary border border-theme-primary text-theme-secondary hover:border-indigo-500 hover:text-indigo-500 transition-all disabled:opacity-50"
                    title="스크린샷에서 필터 추출"
                >
                    <Camera size={20} />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                />
            </div>

            {/* Processing Indicator */}
            {(isListening || isProcessing) && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-theme-secondary border border-theme-primary rounded-2xl shadow-xl p-4 flex items-center gap-3 z-50">
                    {isListening ? (
                        <>
                            <div className="w-3 h-3 bg-red-500 rounded-full animate-ping" />
                            <span className="text-theme-primary font-medium">듣고 있습니다...</span>
                        </>
                    ) : (
                        <>
                            <Loader2 className="animate-spin text-indigo-500" size={20} />
                            <span className="text-theme-primary font-medium">AI가 분석 중...</span>
                        </>
                    )}
                    {transcript && (
                        <span className="text-theme-secondary text-sm max-w-xs truncate">"{transcript}"</span>
                    )}
                </div>
            )}

            {/* Error Toast */}
            {error && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-red-500 text-white rounded-2xl shadow-xl px-6 py-3 z-50">
                    {error}
                    <button onClick={() => setError('')} className="ml-3 opacity-70 hover:opacity-100">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Preview Modal */}
            {showPreview && generatedFilter && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-theme-secondary rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
                        <div className="p-6 border-b border-theme-primary">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="text-indigo-500" size={20} />
                                    <h3 className="text-lg font-bold text-theme-primary">AI 생성 필터</h3>
                                </div>
                                <button onClick={closePreview} className="text-theme-tertiary hover:text-red-500">
                                    <X size={20} />
                                </button>
                            </div>
                            {transcript && (
                                <p className="text-sm text-theme-tertiary mt-2">
                                    "{transcript}"
                                </p>
                            )}
                        </div>

                        <div className="p-6 max-h-64 overflow-auto">
                            {renderFilterPreview(generatedFilter)}
                        </div>

                        <div className="p-4 bg-theme-tertiary flex justify-end gap-3">
                            <button
                                onClick={closePreview}
                                className="px-4 py-2 rounded-xl text-theme-secondary hover:bg-theme-secondary transition-colors"
                            >
                                취소
                            </button>
                            <button
                                onClick={applyFilter}
                                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2"
                            >
                                <Check size={16} />
                                필터 적용
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
