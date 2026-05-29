/**
 * SiteRulesModal — 사이트(용인/마곡/향남)의 분류 룰을 앱 안에서 직접 편집.
 *
 * 각 사이트별로 세 가지 카테고리를 칩+입력으로 편집:
 *   1. IP prefix (예: 10.9.)
 *   2. 건물 정확 일치 (예: 바이오센터)
 *   3. 건물 키워드 포함 (예: 향남)
 *
 * 저장하면 Notion 설정 페이지에 SitesOverrides 로 영구 저장됩니다.
 * 기본값으로 되돌리기 버튼도 사이트별로 있어요.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Modal,
    TextInput,
    Alert,
} from 'react-native';
import { X, Plus, RotateCcw, Save } from 'lucide-react-native';
import {
    SiteDef,
    SiteId,
    SITES_DEFAULTS,
    SitesOverrides,
    SiteOverride,
    applySitesOverrides,
    siteToOverride,
} from '../lib/sites';

interface Props {
    visible: boolean;
    onClose: () => void;
    overrides: SitesOverrides | null;
    onSave: (next: SitesOverrides) => Promise<void>;
}

type CategoryKey = 'ipPrefixes' | 'buildingExactMatches' | 'buildingContains';

const CATEGORY_META: Record<CategoryKey, { label: string; placeholder: string; description: string }> = {
    ipPrefixes: {
        label: 'IP prefix',
        placeholder: '예: 10.9.',
        description: 'QA)네트워크 IP가 이 prefix로 시작하면 해당 사이트로 분류',
    },
    buildingExactMatches: {
        label: '건물 정확 일치',
        placeholder: '예: 바이오센터',
        description: 'L)건물 값이 정확히 이 값 중 하나면 분류',
    },
    buildingContains: {
        label: '건물 키워드 포함',
        placeholder: '예: 향남',
        description: 'L)건물 값에 이 키워드가 포함되어 있으면 분류',
    },
};

// 편집 대상 사이트만
const EDITABLE_SITES: SiteId[] = ['yongin', 'magok', 'hyangnam'];

export const SiteRulesModal: React.FC<Props> = ({ visible, onClose, overrides, onSave }) => {
    // 작업용 카피본 (모달이 열릴 때마다 외부 overrides 로 초기화)
    const [draft, setDraft] = useState<SitesOverrides>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!visible) return;
        // 현재 effective 사이트 정의를 draft 로 채워 사용자가 그대로 편집하도록
        const effective = applySitesOverrides(overrides);
        const d: SitesOverrides = {};
        for (const id of EDITABLE_SITES) {
            const site = effective.find(s => s.id === id);
            if (site) d[id] = siteToOverride(site);
        }
        setDraft(d);
    }, [visible, overrides]);

    const updateCategory = useCallback((siteId: SiteId, cat: CategoryKey, values: string[]) => {
        setDraft(prev => ({
            ...prev,
            [siteId]: {
                ...(prev[siteId] || {}),
                [cat]: values,
            },
        }));
    }, []);

    const resetSite = useCallback((siteId: SiteId) => {
        const def = SITES_DEFAULTS.find(s => s.id === siteId);
        if (!def) return;
        setDraft(prev => ({
            ...prev,
            [siteId]: siteToOverride(def),
        }));
    }, []);

    const hasChanges = useMemo(() => {
        // override 와 draft 비교 (간단히 JSON)
        const effective = applySitesOverrides(overrides);
        const current: SitesOverrides = {};
        for (const id of EDITABLE_SITES) {
            const site = effective.find(s => s.id === id);
            if (site) current[id] = siteToOverride(site);
        }
        return JSON.stringify(current) !== JSON.stringify(draft);
    }, [overrides, draft]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            // SITES_DEFAULTS 와 동일하면 그 사이트는 오버라이드에서 제거 (깔끔)
            const next: SitesOverrides = {};
            for (const id of EDITABLE_SITES) {
                const def = SITES_DEFAULTS.find(s => s.id === id);
                const cur = draft[id];
                if (!def || !cur) continue;
                const defOv = siteToOverride(def);
                if (JSON.stringify(defOv) !== JSON.stringify(cur)) {
                    next[id] = cur;
                }
            }
            await onSave(next);
            onClose();
        } catch (e) {
            console.error('[SiteRules] 저장 실패:', e);
            Alert.alert('저장 실패', '잠시 후 다시 시도해 주세요.');
        } finally {
            setSaving(false);
        }
    }, [draft, onSave, onClose]);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>사이트 설정</Text>
                        <Text style={styles.subtitle}>분류 룰을 편집하고 저장하면 모두 즉시 반영됩니다</Text>
                    </View>
                    <TouchableOpacity onPress={onClose}>
                        <X size={24} color="#6b7280" />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    {EDITABLE_SITES.map(id => {
                        const def = SITES_DEFAULTS.find(s => s.id === id);
                        if (!def) return null;
                        const ov = draft[id] || {};
                        return (
                            <View key={id} style={[styles.siteSection, { borderTopColor: def.color }]}>
                                <View style={styles.siteHeader}>
                                    <View style={[styles.siteSwatch, { backgroundColor: def.color }]} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.siteName}>{def.name}</Text>
                                        {def.description && (
                                            <Text style={styles.siteDescription}>{def.description}</Text>
                                        )}
                                    </View>
                                    <TouchableOpacity style={styles.resetBtn} onPress={() => resetSite(id)}>
                                        <RotateCcw size={12} color="#475569" />
                                        <Text style={styles.resetBtnText}>기본값으로</Text>
                                    </TouchableOpacity>
                                </View>

                                {(['buildingExactMatches', 'buildingContains', 'ipPrefixes'] as CategoryKey[]).map(cat => (
                                    <ChipEditor
                                        key={cat}
                                        label={CATEGORY_META[cat].label}
                                        description={CATEGORY_META[cat].description}
                                        placeholder={CATEGORY_META[cat].placeholder}
                                        values={ov[cat] || []}
                                        chipColor={def.color}
                                        onChange={vals => updateCategory(id, cat, vals)}
                                    />
                                ))}
                            </View>
                        );
                    })}

                    <Text style={styles.footnote}>
                        분류 우선순위: 건물 정확 일치 → 건물 키워드 포함 → IP prefix. 위 어디에도 안 맞으면 미분류.
                        {'\n'}'all' / '미분류'는 다른 사이트 정의로부터 자동 도출되므로 여기서 편집하지 않아요.
                    </Text>
                </ScrollView>

                <View style={styles.footer}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                        <Text style={styles.cancelBtnText}>취소</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.saveBtn, (!hasChanges || saving) && styles.saveBtnDisabled]}
                        onPress={handleSave}
                        disabled={!hasChanges || saving}
                    >
                        <Save size={14} color="#ffffff" />
                        <Text style={styles.saveBtnText}>
                            {saving ? '저장 중…' : hasChanges ? '저장' : '변경 없음'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

// ---------------------------------------------------------------------------
// 칩 에디터
// ---------------------------------------------------------------------------

const ChipEditor: React.FC<{
    label: string;
    description: string;
    placeholder: string;
    values: string[];
    chipColor: string;
    onChange: (vals: string[]) => void;
}> = ({ label, description, placeholder, values, chipColor, onChange }) => {
    const [input, setInput] = useState('');

    const addValue = () => {
        const v = input.trim();
        if (!v) return;
        if (values.includes(v)) {
            setInput('');
            return;
        }
        onChange([...values, v]);
        setInput('');
    };

    const removeValue = (v: string) => {
        onChange(values.filter(x => x !== v));
    };

    return (
        <View style={chipStyles.wrapper}>
            <Text style={chipStyles.label}>{label}</Text>
            <Text style={chipStyles.description}>{description}</Text>
            <View style={chipStyles.chipsRow}>
                {values.length === 0 && (
                    <Text style={chipStyles.empty}>비어있음 (이 카테고리로는 매칭 안 됨)</Text>
                )}
                {values.map(v => (
                    <View key={v} style={[chipStyles.chip, { borderColor: chipColor }]}>
                        <Text style={[chipStyles.chipText, { color: chipColor }]}>{v}</Text>
                        <TouchableOpacity onPress={() => removeValue(v)} hitSlop={6}>
                            <X size={11} color={chipColor} />
                        </TouchableOpacity>
                    </View>
                ))}
            </View>
            <View style={chipStyles.addRow}>
                <TextInput
                    style={chipStyles.input}
                    value={input}
                    onChangeText={setInput}
                    onSubmitEditing={addValue}
                    placeholder={placeholder}
                    placeholderTextColor="#9ca3af"
                    returnKeyType="done"
                />
                <TouchableOpacity
                    style={[chipStyles.addBtn, !input.trim() && { opacity: 0.4 }]}
                    onPress={addValue}
                    disabled={!input.trim()}
                >
                    <Plus size={12} color="#ffffff" />
                    <Text style={chipStyles.addBtnText}>추가</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

// ---------------------------------------------------------------------------
// 스타일
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f3f4f6' },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: 18, fontWeight: 'bold', color: '#1f2937' },
    subtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
    body: { flex: 1 },
    bodyContent: { padding: 12, paddingBottom: 80 },

    siteSection: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
        borderTopWidth: 4,
    },
    siteHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    siteSwatch: { width: 8, height: 8, borderRadius: 4 },
    siteName: { fontSize: 16, fontWeight: '700', color: '#1f2937' },
    siteDescription: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
    resetBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: '#f1f5f9',
    },
    resetBtnText: { fontSize: 10, color: '#475569', fontWeight: '600' },

    footnote: {
        fontSize: 11,
        color: '#94a3b8',
        lineHeight: 16,
        marginTop: 8,
        padding: 10,
    },

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
    saveBtn: {
        flex: 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#6366f1',
    },
    saveBtnDisabled: { backgroundColor: '#cbd5e1' },
    saveBtnText: { fontSize: 14, color: '#ffffff', fontWeight: '700' },
});

const chipStyles = StyleSheet.create({
    wrapper: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#f1f5f9',
    },
    label: { fontSize: 13, fontWeight: '700', color: '#1f2937' },
    description: { fontSize: 11, color: '#94a3b8', marginTop: 2, marginBottom: 6 },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    empty: { fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        backgroundColor: '#ffffff',
    },
    chipText: { fontSize: 12, fontWeight: '600' },
    addRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    input: {
        flex: 1,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 12,
        color: '#1f2937',
    },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: '#6366f1',
        borderRadius: 8,
    },
    addBtnText: { fontSize: 11, color: '#ffffff', fontWeight: '700' },
});
