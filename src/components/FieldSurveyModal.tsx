/**
 * FieldSurveyModal — 현장 서베이 모드
 *   동선 순서로 "어디 가서 → 뭘 확인할지" 안내 + 권위값 유효성 강제 입력.
 *   기존값은 '참고'로 흐리게 보여주고, 현장 확인값을 검증 통과해야만 기록.
 *
 *   3단계: 정거장(동선 순서) → 기기 목록 → 권위 필드 입력.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Modal, TextInput } from 'react-native';
import { X, ChevronRight, ChevronLeft, Check, MapPin } from 'lucide-react-native';
import { Asset, NotionProperty } from '../lib/notion';
import { type LayoutsStore } from '../lib/layouts';
import { buildSurveyPlan, surveyFieldsFor, type SurveyStop, type SurveyFieldState } from '../lib/fieldSurvey';

interface Props {
  visible: boolean;
  onClose: () => void;
  assets: Asset[];                 // 사이트 컨텍스트 적용된 자산
  schema: string[];
  schemaProperties: Record<string, NotionProperty>;
  layoutsStore?: LayoutsStore;
  onUpdate: (id: string, field: string, value: string) => Promise<void>;
}

export const FieldSurveyModal: React.FC<Props> = ({ visible, onClose, assets, schema, schemaProperties, layoutsStore, onUpdate }) => {
  const titleField = useMemo(() => Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name', [schemaProperties]);
  const plan = useMemo(() => buildSurveyPlan(assets, schema, titleField, layoutsStore), [assets, schema, titleField, layoutsStore]);

  const [stopKey, setStopKey] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({}); // text/ip 입력 중 임시값

  const stop = plan.find(s => s.key === stopKey) || null;
  const asset = assetId ? assets.find(a => a.id === assetId) || null : null;
  const fields = useMemo(() => asset ? surveyFieldsFor(asset.values as any, schema) : [], [asset, schema]);

  const save = useCallback(async (col: string, value: string) => {
    if (!assetId) return;
    setSavingField(col);
    try { await onUpdate(assetId, col, value); } finally { setSavingField(null); }
  }, [assetId, onUpdate]);

  const totalPending = plan.reduce((a, s) => a + s.pending, 0);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        <View style={styles.header}>
          {(stopKey || assetId) ? (
            <TouchableOpacity style={styles.backBtn} onPress={() => { if (assetId) { setAssetId(null); setDraft({}); } else setStopKey(null); }}>
              <ChevronLeft size={20} color="#475569" />
            </TouchableOpacity>
          ) : <View style={{ width: 28 }} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>🧭 현장 서베이</Text>
            <Text style={styles.subtitle}>
              {asset ? (asset.values as any)[titleField]
                : stop ? `${stop.building} ${stop.floor} · ${stop.room}`
                : `미확인 ${totalPending}건 · 동선 순서대로`}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose}><X size={22} color="#6b7280" /></TouchableOpacity>
        </View>

        {/* 1) 정거장(동선 순서) */}
        {!stopKey && (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
            {plan.length === 0 && <Text style={styles.empty}>대상 자산이 없어요.</Text>}
            {plan.map(s => (
              <TouchableOpacity key={s.key} style={[styles.stopRow, s.pending === 0 && { opacity: 0.5 }]} onPress={() => setStopKey(s.key)}>
                <View style={styles.orderBadge}><Text style={styles.orderBadgeText}>{s.order}</Text></View>
                <MapPin size={13} color="#6366f1" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.stopTitle} numberOfLines={1}>{s.building} {s.floor} · {s.room}</Text>
                  <Text style={styles.stopSub}>{s.site || '사이트미정'} · 기기 {s.devices.length}대</Text>
                </View>
                {s.pending > 0
                  ? <Text style={styles.pendBadge}>미확인 {s.pending}</Text>
                  : <Check size={15} color="#16a34a" />}
                <ChevronRight size={14} color="#94a3b8" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* 2) 기기 목록(동선 순서) */}
        {stop && !assetId && (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
            <Text style={styles.guide}>이 방 동선 순서대로 {stop.devices.length}대 — 미확인부터 처리</Text>
            {stop.devices.map((d, i) => (
              <TouchableOpacity key={d.id} style={styles.devRow} onPress={() => { setAssetId(d.id); setDraft({}); }}>
                <View style={styles.orderBadgeSm}><Text style={styles.orderBadgeTextSm}>{i + 1}</Text></View>
                <Text style={styles.devName} numberOfLines={1}>{d.name}</Text>
                <View style={{ flex: 1 }} />
                {d.pending > 0
                  ? <Text style={styles.pendBadge}>미확인 {d.pending}/{d.total}</Text>
                  : <Text style={styles.okBadge}>확인됨 ✓</Text>}
                <ChevronRight size={14} color="#94a3b8" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* 3) 권위 필드 입력 */}
        {asset && (
          <ScrollView contentContainerStyle={{ padding: 14, gap: 14 }}>
            {fields.length === 0 && <Text style={styles.empty}>입력 가능한 권위 컬럼이 없어요(컬럼 생성 필요).</Text>}
            {fields.map(f => (
              <FieldInput
                key={f.col}
                field={f}
                saving={savingField === f.col}
                draft={draft[f.col]}
                onDraft={(t) => setDraft(p => ({ ...p, [f.col]: t }))}
                onSave={(val) => save(f.col, val)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const FieldInput: React.FC<{
  field: SurveyFieldState;
  saving: boolean;
  draft?: string;
  onDraft: (t: string) => void;
  onSave: (v: string) => void;
}> = ({ field: f, saving, draft, onDraft, onSave }) => {
  const val = draft != null ? draft : f.current;
  const liveErr = (() => {
    if (!val) return null;
    if (f.validate) return f.validate(val);
    if (f.input === 'ip' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(val.trim())) return 'IPv4 형식 아님';
    return null;
  })();
  return (
    <View style={styles.fieldCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={styles.fieldLabel}>{f.label}</Text>
        {f.pending && !f.error ? <Text style={styles.fieldPend}>미확인</Text> : null}
        {f.error ? <Text style={styles.fieldErr}>⚠ {f.error}</Text> : null}
        {saving ? <Text style={styles.saving}>저장중…</Text> : null}
      </View>
      {f.current ? <Text style={styles.refVal}>참고(기존): {f.current}</Text> : <Text style={styles.refVal}>참고값 없음</Text>}
      {f.hint ? <Text style={styles.hint}>{f.hint}</Text> : null}

      {(f.input === 'enum') && (
        <View style={styles.chips}>
          {(f.options || []).map(opt => (
            <TouchableOpacity key={opt} style={[styles.chip, f.current === opt && styles.chipOn]} onPress={() => onSave(opt)}>
              <Text style={[styles.chipText, f.current === opt && styles.chipTextOn]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {(f.input === 'yesno') && (
        <View style={styles.chips}>
          {['예', '아니오'].map(opt => (
            <TouchableOpacity key={opt} style={[styles.chip, f.current === opt && styles.chipOn]} onPress={() => onSave(opt)}>
              <Text style={[styles.chipText, f.current === opt && styles.chipTextOn]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {(f.input === 'text' || f.input === 'ip') && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            style={[styles.textInput, liveErr && { borderColor: '#ef4444' }]}
            value={val}
            onChangeText={onDraft}
            placeholder={f.input === 'ip' ? '10.5.x.x' : '현장 확인값 입력'}
            placeholderTextColor="#94a3b8"
            keyboardType={f.input === 'ip' ? 'numbers-and-punctuation' : 'default'}
          />
          <TouchableOpacity
            style={[styles.saveBtn, (!!liveErr || !val.trim()) && { opacity: 0.4 }]}
            disabled={!!liveErr || !val.trim()}
            onPress={() => onSave(val.trim())}
          >
            <Check size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  backBtn: { width: 28, height: 28, justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '800', color: '#1f2937' },
  subtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },
  empty: { fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingVertical: 40 },
  guide: { fontSize: 11.5, color: '#475569', fontWeight: '600', marginBottom: 4 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  orderBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  orderBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  orderBadgeSm: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#c7d2fe', alignItems: 'center', justifyContent: 'center' },
  orderBadgeTextSm: { color: '#3730a3', fontSize: 10, fontWeight: '800' },
  stopTitle: { fontSize: 13, fontWeight: '700', color: '#1f2937' },
  stopSub: { fontSize: 10.5, color: '#64748b', marginTop: 1 },
  pendBadge: { fontSize: 10.5, fontWeight: '800', color: '#b45309', backgroundColor: '#fef3c7', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  okBadge: { fontSize: 10.5, fontWeight: '700', color: '#16a34a' },
  devRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#eef2f6' },
  devName: { fontSize: 13, fontWeight: '700', color: '#1f2937' },
  fieldCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e5e7eb', gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: '#1f2937' },
  fieldPend: { fontSize: 10, fontWeight: '700', color: '#b45309' },
  fieldErr: { fontSize: 10.5, fontWeight: '700', color: '#dc2626' },
  saving: { fontSize: 10, color: '#6366f1' },
  refVal: { fontSize: 11, color: '#94a3b8' },
  hint: { fontSize: 10.5, color: '#64748b' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  chipOn: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  textInput: { flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#1f2937' },
  saveBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
});
