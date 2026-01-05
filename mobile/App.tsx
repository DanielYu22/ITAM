import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Search, Database, RefreshCw, Settings, Filter, Home, X } from 'lucide-react-native';
import { NotionClient, Asset, NotionProperty } from './src/lib/notion';
import { NOTION_API_KEY, NOTION_DATABASE_ID, API_BASE_URL } from './src/config';
import { MobileCardView } from './src/components/MobileCardView';
import { evaluateFilter, FilterCondition, DEFAULT_FILTER } from './src/lib/utils';
import { FieldWorkFilter, FilterConfig } from './src/components/FieldWorkFilter';
import { LocationNavigator } from './src/components/LocationNavigator';
import { HomeScreen, FilterTemplate } from './src/components/HomeScreen';

export default function App() {
  // Settings state for configuration - check these first
  const [apiKey, setApiKey] = useState(NOTION_API_KEY);
  const [databaseId, setDatabaseId] = useState(NOTION_DATABASE_ID);
  const [apiBaseUrl, setApiBaseUrl] = useState(API_BASE_URL);

  // State
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filteredAssets, setFilteredAssets] = useState<Asset[]>([]);
  const [schema, setSchema] = useState<string[]>([]);
  const [schemaProperties, setSchemaProperties] = useState<Record<string, NotionProperty>>({});
  // Only show loading if we have config to load
  const [loading, setLoading] = useState(!!NOTION_API_KEY && !!NOTION_DATABASE_ID);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterCondition>(DEFAULT_FILTER);
  const [showSettings, setShowSettings] = useState(false);
  const [showFieldWorkFilter, setShowFieldWorkFilter] = useState(false);
  const [fieldWorkConfig, setFieldWorkConfig] = useState<FilterConfig | null>(null);
  // 위치 네비게이션 상태
  const [locationSelectedAssets, setLocationSelectedAssets] = useState<Asset[]>([]);
  const [locationFilters, setLocationFilters] = useState<Record<string, string>>({});
  // 홈 화면 / 작업 모드
  const [isWorkMode, setIsWorkMode] = useState(false);
  // 필터 템플릿
  const [filterTemplates, setFilterTemplates] = useState<FilterTemplate[]>([]);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // Notion Client
  const [notionClient, setNotionClient] = useState<NotionClient | null>(null);

  // Initialize Notion client
  useEffect(() => {
    if (apiKey && databaseId) {
      const client = new NotionClient({ apiKey, databaseId });
      setNotionClient(client);
      setLoading(true); // Start loading when client is ready
    } else {
      setNotionClient(null);
      setLoading(false); // No loading if no config
    }
  }, [apiKey, databaseId]);

  // Load data - 전체 데이터 로드
  const loadData = useCallback(async () => {
    if (!notionClient) {
      console.log('[App] No Notion client configured');
      setLoading(false);
      return;
    }

    try {
      console.log('[App] Loading all data...');

      // Get schema first
      const schemaProps = await notionClient.getDatabaseSchema();
      setSchemaProperties(schemaProps);

      // 전체 데이터베이스 로드 (100개 제한 없음)
      const result = await notionClient.fetchAllDatabase();
      setAssets(result.assets);
      setSchema(result.schema);
      setFilteredAssets(result.assets);

      console.log(`[App] Loaded ${result.assets.length} assets (all)`);

      // 설정/템플릿 로드
      const settings = await notionClient.loadSettings();
      if (settings?.templates) {
        setFilterTemplates(settings.templates as FilterTemplate[]);
        console.log(`[App] Loaded ${settings.templates.length} filter templates`);
      }
    } catch (error) {
      console.error('[App] Load error:', error);
      Alert.alert('Error', 'Failed to load data from Notion');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notionClient]);

  // Initial load
  useEffect(() => {
    if (notionClient) {
      loadData();
    }
  }, [notionClient, loadData]);

  // Filter assets based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      const filtered = assets.filter(asset => evaluateFilter(asset, filter));
      setFilteredAssets(filtered);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = assets.filter(asset => {
        if (!evaluateFilter(asset, filter)) return false;
        return Object.values(asset.values).some(v =>
          String(v).toLowerCase().includes(query)
        );
      });
      setFilteredAssets(filtered);
    }
  }, [assets, searchQuery, filter]);

  // Field work filter 적용
  const workFilteredAssets = useMemo(() => {
    // 위치 네비게이션에서 선택된 자산이 있으면 그것 사용
    if (locationSelectedAssets.length > 0) {
      return locationSelectedAssets;
    }

    if (!fieldWorkConfig) return filteredAssets;

    let result = filteredAssets;

    // 작업 대상 조건 적용
    if (fieldWorkConfig.targetConditions) {
      fieldWorkConfig.targetConditions.forEach((cond) => {
        result = result.filter(asset => {
          const val = (asset.values[cond.column] || '').toLowerCase();
          switch (cond.type) {
            case 'is_empty':
              return !val || val === '';
            case 'is_not_empty':
              return val && val !== '';
            case 'contains':
              // 다중 선택 지원
              if (cond.values && cond.values.length > 0) {
                return cond.values.some(v => val.includes(v.toLowerCase()));
              }
              return true;
            case 'not_contains':
              if (cond.values && cond.values.length > 0) {
                return !cond.values.some(v => val.includes(v.toLowerCase()));
              }
              return true;
            case 'equals':
              if (cond.values && cond.values.length > 0) {
                return cond.values.some(v => val === v.toLowerCase());
              }
              return true;
            default:
              return true;
          }
        });
      });
    }

    // 정렬 적용
    if (fieldWorkConfig.sortColumn) {
      result = [...result].sort((a, b) => {
        const valA = parseFloat(a.values[fieldWorkConfig.sortColumn]) || 0;
        const valB = parseFloat(b.values[fieldWorkConfig.sortColumn]) || 0;
        return valA - valB;
      });
    }

    return result;
  }, [filteredAssets, fieldWorkConfig, locationSelectedAssets]);

  // Pull to refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // Update asset
  const handleUpdateAsset = useCallback(async (id: string, field: string, value: string) => {
    if (!notionClient) return;

    try {
      const type = schemaProperties[field]?.type || 'rich_text';
      await notionClient.updatePage(id, field, value, type);

      setAssets(prev => prev.map(asset => {
        if (asset.id === id) {
          return {
            ...asset,
            values: { ...asset.values, [field]: value }
          };
        }
        return asset;
      }));
    } catch (error) {
      console.error('[App] Update error:', error);
      Alert.alert('Error', 'Failed to update asset');
    }
  }, [notionClient, schemaProperties]);

  // 템플릿 저장 (새로 저장 또는 덮어쓰기)
  const saveTemplate = useCallback(async (name: string, overwriteId?: string) => {
    if (!notionClient || !fieldWorkConfig) return;

    let updatedTemplates: FilterTemplate[];

    if (overwriteId) {
      // 덮어쓰기 모드
      updatedTemplates = filterTemplates.map(t =>
        t.id === overwriteId
          ? { ...t, name, config: fieldWorkConfig, createdAt: new Date().toISOString().slice(0, 10) }
          : t
      );
    } else {
      // 새로 저장
      const newTemplate: FilterTemplate = {
        id: Date.now().toString(),
        name,
        config: fieldWorkConfig,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      updatedTemplates = [...filterTemplates, newTemplate];
    }

    try {
      await notionClient.saveSettings({ templates: updatedTemplates });
      setFilterTemplates(updatedTemplates);
      Alert.alert('성공', overwriteId ? `템플릿이 업데이트되었습니다.` : `템플릿 "${name}"이 저장되었습니다.`);
    } catch (error) {
      console.error('[App] Save template error:', error);
      Alert.alert('Error', 'Failed to save template');
    }
  }, [notionClient, fieldWorkConfig, filterTemplates]);

  // 템플릿 삭제
  const deleteTemplate = useCallback(async (templateId: string) => {
    if (!notionClient) return;

    const updatedTemplates = filterTemplates.filter(t => t.id !== templateId);

    try {
      await notionClient.saveSettings({ templates: updatedTemplates });
      setFilterTemplates(updatedTemplates);
      Alert.alert('성공', '템플릿이 삭제되었습니다.');
    } catch (error) {
      console.error('[App] Delete template error:', error);
      Alert.alert('Error', 'Failed to delete template');
    }
  }, [notionClient, filterTemplates]);

  // 템플릿 로드
  const loadTemplate = useCallback((template: FilterTemplate) => {
    setFieldWorkConfig(template.config);
    setLocationSelectedAssets([]);
    setLocationFilters({});
    Alert.alert('템플릿 로드', `"${template.name}" 템플릿이 적용되었습니다.`);
  }, []);

  // 작업 시작
  const startWork = useCallback(() => {
    setIsWorkMode(true);
    setLocationSelectedAssets([]);
    setLocationFilters({});
  }, []);

  // 홈으로 돌아가기
  const goHome = useCallback(() => {
    setIsWorkMode(false);
    setLocationSelectedAssets([]);
    setLocationFilters({});
  }, []);

  // Settings screen
  if (showSettings) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <StatusBar style="dark" />
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>Settings</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)}>
              <Text style={styles.doneButton}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.settingsBody}>
            {/* 현재 설정 값 (읽기 전용) */}
            <View style={styles.settingSection}>
              <Text style={styles.settingSectionTitle}>현재 설정 (하드코딩)</Text>

              <View style={styles.settingInfoItem}>
                <Text style={styles.settingInfoLabel}>API Base URL</Text>
                <Text style={styles.settingInfoValue} selectable>{API_BASE_URL || '(비어있음)'}</Text>
              </View>

              <View style={styles.settingInfoItem}>
                <Text style={styles.settingInfoLabel}>Notion API Key</Text>
                <Text style={styles.settingInfoValue} selectable>
                  {NOTION_API_KEY ? `${NOTION_API_KEY.slice(0, 12)}...${NOTION_API_KEY.slice(-6)}` : '(비어있음)'}
                </Text>
              </View>

              <View style={styles.settingInfoItem}>
                <Text style={styles.settingInfoLabel}>Database ID</Text>
                <Text style={styles.settingInfoValue} selectable>{NOTION_DATABASE_ID || '(비어있음)'}</Text>
              </View>
            </View>

            {/* 임시 설정 변경 */}
            <View style={styles.settingSection}>
              <Text style={styles.settingSectionTitle}>임시 설정 변경</Text>
              <Text style={styles.settingSectionDesc}>
                앱 재시작 시 초기화됩니다. 영구 변경은 config.ts 파일을 수정하세요.
              </Text>

              <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>API Base URL</Text>
                <TextInput
                  style={styles.settingInput}
                  value={apiBaseUrl}
                  onChangeText={setApiBaseUrl}
                  placeholder="https://your-app.vercel.app"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Notion API Key</Text>
                <TextInput
                  style={styles.settingInput}
                  value={apiKey}
                  onChangeText={setApiKey}
                  placeholder="secret_xxx..."
                  autoCapitalize="none"
                  secureTextEntry
                />
              </View>
              <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Database ID</Text>
                <TextInput
                  style={styles.settingInput}
                  value={databaseId}
                  onChangeText={setDatabaseId}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <Text style={styles.settingHint}>
              터널 사용 시: Vercel 배포 URL 또는 ngrok URL을 API Base URL에 입력하세요.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // Loading state
  if (loading) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <StatusBar style="dark" />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.loadingText}>Loading assets...</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // No config state
  if (!apiKey || !databaseId) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <StatusBar style="dark" />
          <View style={styles.noConfigContainer}>
            <Database size={48} color="#6b7280" />
            <Text style={styles.noConfigTitle}>Configure Notion</Text>
            <Text style={styles.noConfigText}>
              API Key와 Database ID를 설정해주세요
            </Text>
            <TouchableOpacity
              style={styles.configButton}
              onPress={() => setShowSettings(true)}
            >
              <Settings size={20} color="#ffffff" />
              <Text style={styles.configButtonText}>Settings</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />

        {/* 홈 화면 모드 */}
        {!isWorkMode ? (
          <>
            <HomeScreen
              assets={assets}
              filterConfig={fieldWorkConfig}
              templates={filterTemplates}
              schemaProperties={schemaProperties}
              onStartWork={startWork}
              onOpenFilter={() => setShowFieldWorkFilter(true)}
              onLoadTemplate={loadTemplate}
              onSaveTemplate={saveTemplate}
              onDeleteTemplate={deleteTemplate}
              onEditAsset={(asset) => {
                // 검색에서 선택한 자산을 편집하기 위해 작업 모드로 전환
                setLocationSelectedAssets([asset]);
                setIsWorkMode(true);
              }}
            />

            {/* 필터 설정 모달 */}
            <FieldWorkFilter
              visible={showFieldWorkFilter}
              onClose={() => setShowFieldWorkFilter(false)}
              onApply={(config) => {
                setFieldWorkConfig(config);
                setLocationSelectedAssets([]);
                setLocationFilters({});
              }}
              schema={schema}
              schemaProperties={schemaProperties}
              assets={assets}
              currentConfig={fieldWorkConfig || undefined}
            />

            {/* 템플릿 저장 모달 */}
            <Modal visible={showSaveTemplateModal} transparent animationType="fade">
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>템플릿 저장</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="템플릿 이름"
                    value={templateName}
                    onChangeText={setTemplateName}
                    placeholderTextColor="#9ca3af"
                  />
                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonCancel]}
                      onPress={() => {
                        setShowSaveTemplateModal(false);
                        setTemplateName('');
                      }}
                    >
                      <Text style={styles.modalButtonCancelText}>취소</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonSave]}
                      onPress={() => {
                        if (templateName.trim()) {
                          saveTemplate(templateName.trim());
                          setShowSaveTemplateModal(false);
                          setTemplateName('');
                        }
                      }}
                    >
                      <Text style={styles.modalButtonSaveText}>저장</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </>
        ) : (
          /* 작업 모드 */
          <>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={goHome} style={styles.homeButton}>
                <Home size={20} color="#6366f1" />
              </TouchableOpacity>
              <View style={styles.headerLeft}>
                <Text style={styles.headerTitle}>현장 작업</Text>
                <Text style={styles.headerSubtitle}>
                  {workFilteredAssets.length} / {assets.length} assets
                </Text>
              </View>
              <View style={styles.headerRight}>
                <TouchableOpacity
                  style={[styles.headerButton, fieldWorkConfig && styles.headerButtonActive]}
                  onPress={() => setShowFieldWorkFilter(true)}
                >
                  <Filter size={20} color={fieldWorkConfig ? '#ffffff' : '#6366f1'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.headerButton}
                  onPress={onRefresh}
                >
                  <RefreshCw size={20} color="#6366f1" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Main Content */}
            <View style={styles.content}>
              {/* 위치 계층이 설정되어 있고 아직 선택 완료 안됨 */}
              {fieldWorkConfig?.locationHierarchy && fieldWorkConfig.locationHierarchy.length > 0 && locationSelectedAssets.length === 0 ? (
                <LocationNavigator
                  assets={filteredAssets}
                  locationHierarchy={fieldWorkConfig.locationHierarchy}
                  sortColumn={fieldWorkConfig.sortColumn}
                  onSelectLocation={(filters, selected) => {
                    setLocationFilters(filters);
                    setLocationSelectedAssets(selected);
                  }}
                />
              ) : workFilteredAssets.length === 0 ? (
                <ScrollView
                  contentContainerStyle={styles.emptyContainer}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={onRefresh}
                      colors={['#6366f1']}
                    />
                  }
                >
                  <Text style={styles.emptyText}>No assets found</Text>
                  <Text style={styles.emptyHint}>
                    {searchQuery ? 'Try a different search' : 'Pull to refresh'}
                  </Text>
                </ScrollView>
              ) : (
                <MobileCardView
                  assets={workFilteredAssets}
                  schema={schema}
                  schemaProperties={schemaProperties}
                  onUpdateAsset={handleUpdateAsset}
                  editableFields={fieldWorkConfig?.editableFields}
                  sortColumn={fieldWorkConfig?.sortColumn}
                />
              )}
            </View>

            {/* Field Work Filter Modal (작업 모드용) */}
            <FieldWorkFilter
              visible={showFieldWorkFilter}
              onClose={() => setShowFieldWorkFilter(false)}
              onApply={(config) => {
                setFieldWorkConfig(config);
                setLocationSelectedAssets([]);
                setLocationFilters({});
              }}
              schema={schema}
              schemaProperties={schemaProperties}
              assets={assets}
              currentConfig={fieldWorkConfig || undefined}
            />
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
  },
  noConfigContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  noConfigTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  noConfigText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  configButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  configButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerLeft: {},
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    padding: 8,
    backgroundColor: '#eef2ff',
    borderRadius: 8,
  },
  headerButtonActive: {
    backgroundColor: '#6366f1',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: '#1f2937',
  },
  content: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 18,
    color: '#6b7280',
    fontWeight: '500',
  },
  emptyHint: {
    fontSize: 14,
    color: '#9ca3af',
  },
  settingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  settingsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  doneButton: {
    fontSize: 16,
    color: '#6366f1',
    fontWeight: '600',
  },
  settingsBody: {
    flex: 1,
    padding: 16,
  },
  settingItem: {
    marginBottom: 20,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  settingInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1f2937',
  },
  settingHint: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
    lineHeight: 20,
  },
  homeButton: {
    padding: 8,
    marginRight: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#f3f4f6',
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  modalButtonSave: {
    backgroundColor: '#6366f1',
  },
  modalButtonSaveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  settingSection: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  settingSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
  },
  settingSectionDesc: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 12,
  },
  settingInfoItem: {
    marginBottom: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  settingInfoLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  settingInfoValue: {
    fontSize: 14,
    color: '#1f2937',
    fontFamily: 'monospace',
  },
});
