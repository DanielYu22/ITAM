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
import {
  Filter,
  RefreshCw,
  Settings,
  Search,
  Home,
  ChevronLeft,
  ChevronRight,
  Database,
  Layout,
  PlusCircle,
  AlertCircle,
  Download,
  Upload
} from 'lucide-react-native';
import { NotionClient, Asset, NotionProperty } from './src/lib/notion';
import { filterUserFacingAssets } from './src/lib/ghostAssets';
import { NOTION_API_KEY, NOTION_DATABASE_ID, API_BASE_URL } from './src/config';
import { MobileCardView } from './src/components/MobileCardView';
import { evaluateFilter, FilterCondition, DEFAULT_FILTER } from './src/lib/utils';
import { FieldWorkFilter, FilterConfig, AiFilterSession } from './src/components/FieldWorkFilter';
import { LocationNavigator } from './src/components/LocationNavigator';
import { HomeScreen, FilterTemplate } from './src/components/HomeScreen';
import { ExportPreviewModal } from './src/components/ExportPreviewModal';
import { BulkUpdateModal } from './src/components/BulkUpdateModal';
import { SourceImportModal } from './src/components/SourceImportModal';
import { DashboardModal } from './src/components/DashboardModal';
import { TaskDashboardModal } from './src/components/TaskDashboardModal';
import { SiteRulesModal } from './src/components/SiteRulesModal';
import { DBManagementModal } from './src/components/DBManagementModal';
import { FieldSupportSubmitModal } from './src/components/FieldSupportSubmitModal';
import { LayoutEditorModal } from './src/components/LayoutEditorModal';
import { LayoutRoomPickerModal } from './src/components/LayoutRoomPickerModal';
import { LayoutsStore, RoomLayout, ensureStore, roomKey } from './src/lib/layouts';
import { MonthlyResetModal } from './src/components/MonthlyResetModal';
import { InfrastructureModal } from './src/components/InfrastructureModal';
import {
  InfrastructureData,
  ensureInfrastructure,
  emptyInfrastructure,
} from './src/lib/infrastructure';
import {
  SiteId,
  SitesOverrides,
  applySitesOverrides,
  filterAssetsBySite,
  buildSiteFilterConfig,
} from './src/lib/sites';
import { APP_VERSION } from './src/lib/version';
import {
  QUICK_TASKS,
  QuickTaskDef,
  HISTORY_FIELD_NAME,
  SYNOLOGY_FIELD_NAME,
  SYNOLOGY_OPTIONS,
  FIELD_SUPPORT_STATUS_FIELD,
  FIELD_SUPPORT_STATUS_OPTIONS,
  FIELD_SUPPORT_MEMO_FIELD,
  BACKUP_STATUS_FIELD,
  BACKUP_STATUS_OPTIONS,
  computeClearUpdates,
  appendHistoryLine,
  buildCombinedQuickTaskConfig,
  getMatchingQuickTasks,
} from './src/lib/quickTasks';

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
  // Only show loading if we have databaseId to load
  const [loading, setLoading] = useState(!!NOTION_DATABASE_ID);
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
  const [showExportModal, setShowExportModal] = useState(false);
  const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
  const [showSourceImportModal, setShowSourceImportModal] = useState(false);
  const [showDashboardModal, setShowDashboardModal] = useState(false);
  // 대시보드 모드: 'all' = 전체장비, 'filtered' = 작업대상(워크 필터 적용)
  const [dashboardMode, setDashboardMode] = useState<'all' | 'filtered'>('all');
  const [showTaskDashboardModal, setShowTaskDashboardModal] = useState(false);
  // 카드 뷰에서 '대시보드로 돌아가기' 버튼을 보여줄지
  const [returnToDashboard, setReturnToDashboard] = useState(false);
  // 새 모달들
  const [showDBManagementModal, setShowDBManagementModal] = useState(false);
  const [showFieldSupportModal, setShowFieldSupportModal] = useState(false);
  const [showMonthlyResetModal, setShowMonthlyResetModal] = useState(false);
  const [showInfrastructureModal, setShowInfrastructureModal] = useState(false);
  const [infrastructure, setInfrastructure] = useState<InfrastructureData>(emptyInfrastructure());
  // 테스트 이력 정리 진행 상태 (UI 인디케이터용)
  const [cleanupProgress, setCleanupProgress] = useState<{ current: number; total: number } | null>(null);
  // 레이아웃 편집
  const [layoutsStore, setLayoutsStore] = useState<LayoutsStore>({ rooms: {} });
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [editingRoom, setEditingRoom] = useState<{ building: string; floor: string; room: string } | null>(null);
  // 인프라 → 레이아웃 진입 시 복귀 플래그 — 레이아웃 닫히면 인프라 다시 열기
  const [returnToInfrastructure, setReturnToInfrastructure] = useState(false);
  const [showSiteRulesModal, setShowSiteRulesModal] = useState(false);
  // 사이트(장소) 컨텍스트
  const [currentSite, setCurrentSite] = useState<SiteId>('all');
  // 사용자 편집 사이트 정의 (Notion 설정에 영구 저장)
  const [sitesOverrides, setSitesOverrides] = useState<SitesOverrides | null>(null);
  // 오버라이드 합성된 최종 사이트 정의
  const effectiveSites = useMemo(
    () => applySitesOverrides(sitesOverrides),
    [sitesOverrides]
  );

  // 사이트 필터링된 자산 (앱 전반의 컨텍스트)
  const siteFilteredAssets = useMemo(() => {
    return filterAssetsBySite(assets, currentSite, effectiveSites);
  }, [assets, currentSite, effectiveSites]);
  const [skipLocationSelection, setSkipLocationSelection] = useState(false);
  const [appSettings, setAppSettings] = useState<Record<string, any>>({});
  const [bulkLookupColumn, setBulkLookupColumn] = useState<string>('Name');
  const [fieldFilterAiSession, setFieldFilterAiSession] = useState<AiFilterSession | undefined>(undefined);
  // 현재 활성화된 Quick Task (홈에서 카드 누른 후 워크모드에 진입한 경우)
  const [activeQuickTask, setActiveQuickTask] = useState<QuickTaskDef | null>(null);
  // 통합 모드 활성 (모든 Quick Task 통합 큐). activeQuickTask 와 동시 활성 안 됨.
  const [combinedQuickTask, setCombinedQuickTask] = useState<boolean>(false);

  // Notion Client
  const [notionClient, setNotionClient] = useState<NotionClient | null>(null);

  // Initialize Notion client
  useEffect(() => {
    if (databaseId) {
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
      let schemaProps = await notionClient.getDatabaseSchema();

      // 처리이력 필드가 없으면 자동 생성 (Rich Text)
      let schemaChanged = false;
      if (!schemaProps[HISTORY_FIELD_NAME]) {
        try {
          const created = await notionClient.createDatabaseProperty(HISTORY_FIELD_NAME, 'rich_text');
          if (created) {
            console.log(`[App] '${HISTORY_FIELD_NAME}' 필드를 Notion DB에 자동 생성했습니다.`);
            schemaChanged = true;
          }
        } catch (e) {
          console.warn(`[App] '${HISTORY_FIELD_NAME}' 필드 자동 생성 실패 (수동으로 만들어 주세요):`, e);
        }
      }

      // 시놀로지 상태 필드가 없으면 자동 생성 (multi_select). 옵션은 사용자가
      // Notion에서 직접 추가하거나, 처음 입력하는 값으로 자동 등록됨.
      if (!schemaProps[SYNOLOGY_FIELD_NAME]) {
        try {
          const created = await notionClient.createDatabaseProperty(SYNOLOGY_FIELD_NAME, 'multi_select');
          if (created) {
            console.log(`[App] '${SYNOLOGY_FIELD_NAME}' 필드(multi_select)를 Notion DB에 자동 생성했습니다. 옵션: ${SYNOLOGY_OPTIONS.join(', ')}`);
            schemaChanged = true;
          }
        } catch (e) {
          console.warn(`[App] '${SYNOLOGY_FIELD_NAME}' 필드 자동 생성 실패:`, e);
        }
      }

      // 현장지원 상태 필드 (select: 요청/완료)
      if (!schemaProps[FIELD_SUPPORT_STATUS_FIELD]) {
        try {
          const created = await notionClient.createDatabaseProperty(FIELD_SUPPORT_STATUS_FIELD, 'select');
          if (created) {
            console.log(`[App] '${FIELD_SUPPORT_STATUS_FIELD}' 필드(select) 자동 생성. 옵션: ${FIELD_SUPPORT_STATUS_OPTIONS.join(', ')}`);
            schemaChanged = true;
          }
        } catch (e) {
          console.warn(`[App] '${FIELD_SUPPORT_STATUS_FIELD}' 필드 자동 생성 실패:`, e);
        }
      }
      // 현장지원 메모 필드 (rich_text)
      if (!schemaProps[FIELD_SUPPORT_MEMO_FIELD]) {
        try {
          const created = await notionClient.createDatabaseProperty(FIELD_SUPPORT_MEMO_FIELD, 'rich_text');
          if (created) {
            console.log(`[App] '${FIELD_SUPPORT_MEMO_FIELD}' 필드(rich_text) 자동 생성`);
            schemaChanged = true;
          }
        } catch (e) {
          console.warn(`[App] '${FIELD_SUPPORT_MEMO_FIELD}' 필드 자동 생성 실패:`, e);
        }
      }

      // 분기 백업 상태 필드 (multi_select: 백업필요/백업완료)
      if (!schemaProps[BACKUP_STATUS_FIELD]) {
        try {
          const created = await notionClient.createDatabaseProperty(BACKUP_STATUS_FIELD, 'multi_select');
          if (created) {
            console.log(`[App] '${BACKUP_STATUS_FIELD}' 필드(multi_select) 자동 생성. 옵션: ${BACKUP_STATUS_OPTIONS.join(', ')}`);
            schemaChanged = true;
          }
        } catch (e) {
          console.warn(`[App] '${BACKUP_STATUS_FIELD}' 필드 자동 생성 실패:`, e);
        }
      }

      if (schemaChanged) {
        schemaProps = await notionClient.getDatabaseSchema();
      }

      setSchemaProperties(schemaProps);

      // 전체 데이터베이스 로드 (100개 제한 없음)
      const result = await notionClient.fetchAllDatabase();
      const titlePropName =
        Object.keys(schemaProps).find(k => schemaProps[k].type === 'title') || 'Name';
      const visibleAssets = filterUserFacingAssets(result.assets, titlePropName);
      setAssets(visibleAssets);
      setSchema(result.schema);
      setFilteredAssets(visibleAssets);

      console.log(
        `[App] Loaded ${visibleAssets.length} assets (ghost rows excluded, raw=${result.assets.length})`
      );

      // 설정/템플릿 로드
      const settings = await notionClient.loadSettings();
      const ensureDefaultWorkQueueTemplate = async (baseSettings: Record<string, any> | null) => {
        const TEMPLATE_NAME = '4월 POC/알약 작업큐';
        const currentTemplates: FilterTemplate[] = Array.isArray(baseSettings?.templates) ? baseSettings!.templates : [];
        const existingIndex = currentTemplates.findIndex(t => String(t?.name || '').trim() === TEMPLATE_NAME);

        const now = Date.now();
        const defaultConfig: FilterConfig = {
          locationHierarchy: [],
          sortColumn: '',
          sortDirection: 'asc',
          globalLogicalOperator: 'or',
          targetGroups: [
            {
              id: `group-${now}`,
              operator: 'or',
              conditions: [
                // 멀티셀렉트에서도 동작하도록 contains 사용 (아이템 단위 매칭)
                { id: `c-${now}-1`, column: 'M)알약 현장조치', type: 'contains', values: ['폐쇄망조치필요'] },
                { id: `c-${now}-2`, column: 'M)알약 현장조치', type: 'contains', values: ['알약대상인지 현장확인'] },
                { id: `c-${now}-3`, column: 'OS type', type: 'equals', values: ['확인필요'] },
                { id: `c-${now}-4`, column: 'PC Hostname', type: 'equals', values: ['POC업데이트 필요'] },
                { id: `c-${now}-5`, column: '*4월조치', type: 'equals', values: ['IT/현장백업'] },
                // "*4월조치"에 "2025Q)"로 시작/포함된 값이 있으면 작업 대상
                { id: `c-${now}-7`, column: '*4월조치', type: 'text_contains', values: ['2025Q)'] },
                { id: `c-${now}-6`, column: 'M)알약 온라인구분', type: 'equals', values: ['정보없음'] },
              ],
            },
          ],
          editableFields: [
            'M)알약 현장조치',
            'OS type',
            'PC Hostname',
            '*4월조치',
            'M)알약 온라인구분',
          ],
        };

        const nextTemplates: FilterTemplate[] =
          existingIndex >= 0
            ? currentTemplates.map((t, idx) => idx === existingIndex ? ({
              ...t,
              name: TEMPLATE_NAME,
              config: defaultConfig,
              createdAt: new Date().toISOString().slice(0, 10),
            }) : t)
            : [
              ...currentTemplates,
              {
                id: `tmpl-${now}`,
                name: TEMPLATE_NAME,
                config: defaultConfig,
                createdAt: new Date().toISOString().slice(0, 10),
              },
            ];

        const merged = {
          ...(baseSettings || {}),
          templates: nextTemplates,
        };

        try {
          await notionClient.saveSettings(merged);
          return { ensuredSettings: merged, templates: nextTemplates, created: existingIndex === -1 };
        } catch (e) {
          console.warn('[App] Failed to auto-create default template:', e);
          return { ensuredSettings: baseSettings, templates: currentTemplates, created: false };
        }
      };

      const ensured = await ensureDefaultWorkQueueTemplate(settings as any);
      const ensuredSettings = ensured.ensuredSettings || settings;

      if (ensuredSettings) {
        setAppSettings(ensuredSettings);
        // 사이트 오버라이드 복원 (저장된 게 있으면)
        const savedSites = (ensuredSettings as any)?.sites;
        if (savedSites && typeof savedSites === 'object') {
          setSitesOverrides(savedSites as SitesOverrides);
        }
        // 레이아웃 스토어 복원
        const savedLayouts = (ensuredSettings as any)?.layouts;
        setLayoutsStore(ensureStore(savedLayouts));
        // 인프라 데이터 복원
        const savedInfra = (ensuredSettings as any)?.infrastructure;
        setInfrastructure(ensureInfrastructure(savedInfra));
        const lastLookup = ensuredSettings?.bulkUpdate?.lastLookupColumn;
        const schemaCols = result.schema;
        if (typeof lastLookup === 'string' && schemaCols.includes(lastLookup)) {
          setBulkLookupColumn(lastLookup);
        } else if (schemaCols.includes('Name')) {
          setBulkLookupColumn('Name');
        } else {
          setBulkLookupColumn(
            schemaCols.includes(titlePropName) ? titlePropName : schemaCols[0] || 'Name'
          );
        }
        const session = ensuredSettings?.aiFilter?.fieldWorkSession;
        if (session?.messages) {
          setFieldFilterAiSession(session as AiFilterSession);
        }
      }

      if (ensured.templates && ensured.templates.length > 0) {
        setFilterTemplates(ensured.templates as FilterTemplate[]);
        if (ensured.created) {
          console.log('[App] Created default work queue template:', '4월 POC/알약 작업큐');
        }
        console.log(`[App] Loaded ${ensured.templates.length} filter templates`);
      } else if (settings?.templates) {
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

  const persistBulkLookupColumn = useCallback(async (col: string) => {
    setBulkLookupColumn(col);
    if (!notionClient) return;

    const merged = {
      ...(appSettings || {}),
      bulkUpdate: {
        ...((appSettings || {}).bulkUpdate || {}),
        lastLookupColumn: col,
      },
    };
    setAppSettings(merged);
    try {
      await notionClient.saveSettings(merged);
    } catch (e) {
      console.warn('[App] Failed to persist bulk update lookup column:', e);
    }
  }, [appSettings, notionClient]);

  const persistFieldFilterAiSession = useCallback(async (session: AiFilterSession) => {
    setFieldFilterAiSession(session);
    if (!notionClient) return;

    const merged = {
      ...(appSettings || {}),
      aiFilter: {
        ...((appSettings || {}).aiFilter || {}),
        fieldWorkSession: session,
      },
    };
    setAppSettings(merged);
    try {
      await notionClient.saveSettings(merged);
    } catch (e) {
      console.warn('[App] Failed to persist AI filter session:', e);
    }
  }, [appSettings, notionClient]);

  // 스키마 기반 필터 설정 정리 - 존재하지 않는 컬럼 제거
  const cleanFilterConfig = useCallback((config: FilterConfig | null, currentSchema: string[]): FilterConfig | null => {
    if (!config || currentSchema.length === 0) return config;

    const schemaSet = new Set(currentSchema);

    return {
      ...config,
      locationHierarchy: config.locationHierarchy?.filter(col => schemaSet.has(col)) || [],
      sortColumn: schemaSet.has(config.sortColumn || '') ? config.sortColumn : '',
      editableFields: config.editableFields?.filter(col => schemaSet.has(col)) || [],
      targetGroups: config.targetGroups?.map(group => ({
        ...group,
        conditions: group.conditions?.filter(cond => schemaSet.has(cond.column)) || []
      })).filter(group => group.conditions.length > 0 || config.targetGroups?.length === 1) || [],
    };
  }, []);

  // 스키마 변경 시 필터 설정 자동 정리
  useEffect(() => {
    if (schema.length > 0 && fieldWorkConfig) {
      const cleanedConfig = cleanFilterConfig(fieldWorkConfig, schema);
      if (cleanedConfig && JSON.stringify(cleanedConfig) !== JSON.stringify(fieldWorkConfig)) {
        console.log('[App] Cleaning filter config - removed invalid columns');
        setFieldWorkConfig(cleanedConfig);
      }
    }
  }, [schema, fieldWorkConfig, cleanFilterConfig]);

  // Page Visibility 기반 자동 새로고침
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && notionClient && !loading) {
        console.log('[App] Page became visible - refreshing data...');
        loadData();
      }
    };

    // 웹에서만 동작 (모바일에서는 AppState 사용)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  }, [notionClient, loading, loadData]);

  // Initial load
  useEffect(() => {
    if (notionClient) {
      loadData();
    }
  }, [notionClient, loadData]);

  // Filter assets based on search query AND current site
  useEffect(() => {
    // 사이트 컨텍스트 먼저 적용
    const siteScoped = filterAssetsBySite(assets, currentSite, effectiveSites);
    if (!searchQuery.trim()) {
      const filtered = siteScoped.filter(asset => evaluateFilter(asset, filter));
      setFilteredAssets(filtered);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = siteScoped.filter(asset => {
        if (!evaluateFilter(asset, filter)) return false;
        return Object.values(asset.values).some(v =>
          String(v).toLowerCase().includes(query)
        );
      });
      setFilteredAssets(filtered);
    }
  }, [assets, searchQuery, filter, currentSite, effectiveSites]);

  // Field work filter 적용
  const workFilteredAssets = useMemo(() => {
    // 위치 네비게이션에서 선택된 자산이 있으면 그것 사용
    if (locationSelectedAssets.length > 0) {
      return locationSelectedAssets;
    }

    if (!fieldWorkConfig) return filteredAssets;

    // 통합 모드: 각 Quick Task 를 따로 평가해서 하나라도 매칭되면 포함.
    // (fieldWorkConfig 의 평탄화된 그룹 평가는 오프라인 패치처럼 그룹간
    // AND 가 있는 Quick Task 의 의미를 망가뜨려서 별도 경로로 처리)
    if (combinedQuickTask) {
      const now = new Date();
      return filteredAssets.filter(a => getMatchingQuickTasks(a, QUICK_TASKS, now).length > 0);
    }

    let result = filteredAssets;

    // 작업 대상 조건 적용 (그룹 및 중첩 논리 지원)
    const targetGroups = fieldWorkConfig.targetGroups || (fieldWorkConfig.targetConditions ? [{
      id: 'legacy-group',
      operator: fieldWorkConfig.targetLogicalOperator || 'and',
      conditions: fieldWorkConfig.targetConditions
    }] : []);

    if (targetGroups.length > 0) {
      const isGlobalOr = fieldWorkConfig.globalLogicalOperator === 'or';

      result = result.filter(asset => {
        const groupMatches = targetGroups.map(group => {
          if (!group.conditions || group.conditions.length === 0) return true;

          const isGroupOr = group.operator === 'or';
          const conditionMatches = group.conditions.map(cond => {
            const columnKey = String(cond.column ?? '');
            const val = String(asset.values[columnKey] ?? '').toLowerCase();
            switch (cond.type) {
              case 'is_empty':
                return !val || val === '';
              case 'is_not_empty':
                return val && val !== '';
              case 'contains':
                if (cond.values && cond.values.length > 0) {
                  return cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
                }
                return true;
              case 'not_contains':
                if (cond.values && cond.values.length > 0) {
                  return !cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
                }
                return true;
              case 'equals':
                if (cond.values && cond.values.length > 0) {
                  return cond.values.some(v => val === String(v ?? '').toLowerCase());
                }
                return true;
              case 'text_contains':
                if (cond.values && cond.values.length > 0) {
                  return cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
                }
                return true;
              case 'text_not_contains':
                if (!val || val === '') return true;
                if (cond.values && cond.values.length > 0) {
                  return !cond.values.some(v => val.includes(String(v ?? '').toLowerCase()));
                }
                return true;
              default:
                return true;
            }
          });

          return isGroupOr ? conditionMatches.some(m => m) : conditionMatches.every(m => m);
        });

        return isGlobalOr ? groupMatches.some(m => m) : groupMatches.every(m => m);
      });
    }

    // 정렬 적용: 위치 계층 우선, 그 다음 Move (공백 우선, 오름차순)
    if (fieldWorkConfig.locationHierarchy?.length || fieldWorkConfig.sortColumn) {
      result = [...result].sort((a, b) => {
        // 1. 위치 계층 정렬 (건물 → 층 → 연구실)
        if (fieldWorkConfig.locationHierarchy?.length) {
          for (const col of fieldWorkConfig.locationHierarchy) {
            const valA = a.values[col] || '';
            const valB = b.values[col] || '';
            const locCompare = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
            if (locCompare !== 0) return locCompare;
          }
        }

        // 2. Move 정렬 (공백 우선, 그 다음 오름차순)
        if (fieldWorkConfig.sortColumn) {
          const valA = a.values[fieldWorkConfig.sortColumn] || '';
          const valB = b.values[fieldWorkConfig.sortColumn] || '';

          // 공백 우선 처리
          if (valA === '' && valB !== '') return -1;
          if (valA !== '' && valB === '') return 1;

          // 숫자, 문자열 혼합된 경우도 자연스럽게 정렬 (Natural Sort)
          const comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
          return fieldWorkConfig.sortDirection === 'desc' ? -comparison : comparison;
        }

        return 0;
      });
    }

    return result;
  }, [filteredAssets, fieldWorkConfig, locationSelectedAssets, combinedQuickTask]);

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

  // 템플릿 로드 (필터만 적용, 현장 작업은 별도로 시작해야 함)
  const loadTemplate = useCallback((template: FilterTemplate) => {
    setFieldWorkConfig(template.config);
    setLocationSelectedAssets([]);
    setLocationFilters({});
    // 현장 작업 모드로 자동 전환하지 않음 - 사용자가 "현장 작업 시작" 버튼 눌러야 함
    Alert.alert('템플릿 로드', `"${template.name}" 템플릿이 적용되었습니다.`);
  }, []);

  const startWork = useCallback(() => {
    setIsWorkMode(true);
    setLocationSelectedAssets([]);
    setLocationFilters({});

    // 위치 계층이 있어도 초기에는 전체 보기로 시작 (상단 네비게이션으로 변경 가능)
    if (fieldWorkConfig?.locationHierarchy && fieldWorkConfig.locationHierarchy.length > 0) {
      setSkipLocationSelection(true);
    }
  }, [fieldWorkConfig]);

  // 사이트 변경: 글로벌 컨텍스트 + FilterConfig 프리셋 동시 적용.
  // 사용자가 '필터 설정' 모달을 열면 그 사이트로 분류되는 조건이 그대로 보여요.
  const handleChangeSite = useCallback((siteId: SiteId) => {
    setCurrentSite(siteId);
    const preset = buildSiteFilterConfig(siteId, effectiveSites);
    setFieldWorkConfig(preset);
    setLocationSelectedAssets([]);
    setLocationFilters({});
    setActiveQuickTask(null);
    setCombinedQuickTask(false);
  }, [effectiveSites]);

  // 인프라 데이터 저장 — Notion 설정 페이지에 infrastructure 로 저장
  const handleSaveInfrastructure = useCallback(async (next: InfrastructureData) => {
    setInfrastructure(next);
    const merged = { ...(appSettings || {}), infrastructure: next };
    setAppSettings(merged);
    if (notionClient) {
      try {
        await notionClient.saveSettings(merged);
      } catch (e) {
        console.error('[App] 인프라 저장 실패:', e);
        throw e;
      }
    }
  }, [appSettings, notionClient]);

  // 레이아웃 저장 — Notion 설정 페이지에 layouts.rooms[key] 로 저장
  const handleSaveRoomLayout = useCallback(async (key: string, layout: RoomLayout) => {
    const next: LayoutsStore = {
      ...layoutsStore,
      rooms: { ...layoutsStore.rooms, [key]: layout },
    };
    setLayoutsStore(next);
    const merged = { ...(appSettings || {}), layouts: next };
    setAppSettings(merged);
    if (notionClient) {
      try {
        await notionClient.saveSettings(merged);
      } catch (e) {
        console.error('[App] 레이아웃 저장 실패:', e);
        throw e;
      }
    }
  }, [layoutsStore, appSettings, notionClient]);

  // 사이트 룰 저장: Notion 설정 페이지에 영구 저장.
  // 저장 직후 effectiveSites 가 재계산되어 분류/카운트가 즉시 반영됩니다.
  const handleSaveSitesOverrides = useCallback(async (next: SitesOverrides) => {
    setSitesOverrides(next);
    const merged = { ...(appSettings || {}), sites: next };
    setAppSettings(merged);
    if (notionClient) {
      try {
        await notionClient.saveSettings(merged);
      } catch (e) {
        console.error('[App] 사이트 룰 저장 실패:', e);
        throw e;
      }
    }
    // 현재 활성 사이트가 편집된 경우, 필터 프리셋도 새 정의로 다시 적용
    if (currentSite !== 'all' && currentSite !== 'unclassified') {
      const nextEffective = applySitesOverrides(next);
      setFieldWorkConfig(buildSiteFilterConfig(currentSite, nextEffective));
    }
  }, [appSettings, notionClient, currentSite]);

  // 통합 모드 핸들러 — 모든 Quick Task 를 합친 큐 시작.
  // '현장 한 번 나가는 김에 그 기기의 모든 과제 처리' 워크플로우용.
  //
  // 사이트 컨텍스트는 siteFilteredAssets 단계에서 이미 적용되므로
  // 여기서 사이트 그룹을 prepend 하지 않습니다. (prepend 하면 그룹간
  // AND 가 평탄화된 통합 그룹들과 충돌해서 매칭 0건이 됨)
  //
  // 실제 자산 필터링은 workFilteredAssets 안에서 getMatchingQuickTasks
  // 기반으로 정확히 평가합니다. fieldWorkConfig 는 '필터 설정' 모달에서
  // 어떤 조건들이 합쳐졌는지 시각적으로 보여주는 디스플레이 용도입니다.
  const handleCombinedQuickTask = useCallback(() => {
    const now = new Date();
    const config = buildCombinedQuickTaskConfig(QUICK_TASKS, now);
    setActiveQuickTask(null);
    setCombinedQuickTask(true);
    setFieldWorkConfig(config);
    setLocationSelectedAssets([]);
    setLocationFilters({});
    setIsWorkMode(true);
    if (config.locationHierarchy && config.locationHierarchy.length > 0) {
      setSkipLocationSelection(true);
    }
  }, []);

  // Quick Task 핸들러: 정기/현장 업무를 즉시 시작.
  // 현재 사이트의 프리셋이 있으면 사이트 그룹을 첫 번째 그룹으로 prepend해서
  // 두 조건이 모두 가시화되고, 워크 결과도 사이트 안으로 좁혀집니다.
  const handleQuickTask = useCallback((task: QuickTaskDef) => {
    const now = new Date();
    const taskConfig = task.buildConfig({ now });
    const sitePreset = buildSiteFilterConfig(currentSite, effectiveSites);

    const config: typeof taskConfig = sitePreset
      ? {
          ...taskConfig,
          // 사이트 ∩ Quick Task (둘 다 만족하는 자산)
          globalLogicalOperator: 'and',
          targetGroups: [
            ...sitePreset.targetGroups,
            ...taskConfig.targetGroups,
          ],
        }
      : taskConfig;

    setActiveQuickTask(task);
    setCombinedQuickTask(false);
    setFieldWorkConfig(config);
    setLocationSelectedAssets([]);
    setLocationFilters({});
    setIsWorkMode(true);
    if (config.locationHierarchy && config.locationHierarchy.length > 0) {
      setSkipLocationSelection(true);
    }
  }, [currentSite, effectiveSites]);

  // Quick Task 완료 처리: 사전값 클리어 + 처리이력 append
  // 자산 카드의 "완료" 체크박스에서 호출됨
  const handleCompleteQuickTask = useCallback(async (asset: Asset, task: QuickTaskDef) => {
    if (!notionClient) return;

    // 0) 매번 fresh schema 를 가져옴. 사용자가 다른 세션에서 컬럼을 만들었거나
    //    앱이 자동 생성한 컬럼의 type 정보가 캐시되지 않은 경우를 방어.
    let freshTypes: Record<string, string> = {};
    try {
      const fresh = await notionClient.getDatabaseSchema();
      Object.entries(fresh).forEach(([k, v]) => {
        freshTypes[k] = v.type;
      });
      // schemaProperties state 도 최신화 (다음 작업이 같은 사이클이면 한 번만 호출되게)
      setSchemaProperties(fresh);
    } catch (e) {
      // fresh fetch 실패 시 캐시 사용
      Object.entries(schemaProperties).forEach(([k, v]) => {
        freshTypes[k] = v.type;
      });
    }

    // 1) 처리이력 한 줄 prepend
    const now = new Date();
    const historyLabel = task.buildHistoryLabel({ now });
    const existingHistory = asset.values[HISTORY_FIELD_NAME] ?? '';
    const nextHistory = appendHistoryLine(existingHistory, historyLabel, now);

    // 2) 사전값 클리어 계산
    const clearUpdates = computeClearUpdates(task, asset.values, freshTypes);

    // 누락된 필드(Notion DB 에 없음) 식별 — 사용자에게 명확히 알림
    const missingFields = clearUpdates
      .filter(u => !freshTypes[u.field])
      .map(u => u.field);
    if (missingFields.length > 0) {
      Alert.alert(
        '필드 미존재',
        `'${missingFields.join(', ')}' 컬럼이 Notion DB 에 없어요.\n앱을 새로고침하면 자동 생성됩니다.`
      );
    }

    // 3) Notion 업데이트 — 필드별 결과 추적
    const failed: Array<{ field: string; error: any }> = [];
    const safeUpdate = async (field: string, value: string, type: string) => {
      try {
        await notionClient.updatePage(asset.id, field, value, type);
      } catch (e) {
        failed.push({ field, error: e });
      }
    };
    await Promise.all([
      safeUpdate(HISTORY_FIELD_NAME, nextHistory, 'rich_text'),
      ...clearUpdates.map(u => safeUpdate(u.field, u.newValue, u.type)),
    ]);

    if (failed.length > 0) {
      console.error('[QuickTask] 일부 필드 업데이트 실패:', failed);
      const msg = failed
        .map(f => `• ${f.field}: ${String((f.error as any)?.message ?? f.error).slice(0, 120)}`)
        .join('\n');
      Alert.alert(
        '일부 필드 업데이트 실패',
        `${failed.length}개 필드 실패. 처리이력은 기록됐어요.\n\n${msg}`
      );
      // 성공한 필드만 로컬 반영
    }

    // 4) 로컬 상태 동기화 (성공한 것만)
    const updatedValues: Record<string, string> = { ...asset.values };
    if (!failed.find(f => f.field === HISTORY_FIELD_NAME)) {
      updatedValues[HISTORY_FIELD_NAME] = nextHistory;
    }
    for (const u of clearUpdates) {
      if (!failed.find(f => f.field === u.field)) {
        updatedValues[u.field] = u.newValue;
      }
    }
    setAssets(prev => prev.map(a =>
      a.id === asset.id ? { ...a, values: updatedValues } : a
    ));
    setLocationSelectedAssets(prev => prev.map(a =>
      a.id === asset.id ? { ...a, values: updatedValues } : a
    ));
  }, [notionClient, schemaProperties]);

  // 홈으로 돌아가기
  const handleBackToLocation = () => {
    if (!fieldWorkConfig?.locationHierarchy) return;

    const prevLevel = Object.keys(locationFilters).length - 1;
    if (prevLevel < 0) { // Already at the top level
      setLocationFilters({});
      setLocationSelectedAssets([]);
      return;
    }

    const newFilters = { ...locationFilters };
    const lastCol = fieldWorkConfig.locationHierarchy[prevLevel];
    delete newFilters[lastCol];

    setLocationFilters(newFilters);
    setLocationSelectedAssets([]);
  };

  const goHome = useCallback(() => {
    setIsWorkMode(false);
    setLocationSelectedAssets([]);
    setLocationFilters({});
    setActiveQuickTask(null);
    setCombinedQuickTask(false);
    setReturnToDashboard(false);
  }, []);

  // 카드뷰에서 대시보드로 돌아가기 — 워크모드 닫고 대시보드 모달 재오픈
  const backToTaskDashboard = useCallback(() => {
    setIsWorkMode(false);
    setLocationSelectedAssets([]);
    setLocationFilters({});
    setActiveQuickTask(null);
    setCombinedQuickTask(false);
    setReturnToDashboard(false);
    setShowTaskDashboardModal(true);
  }, []);

  // 테스트 이력 일괄 삭제 — 처리이력에서 특정 날짜로 시작하는 줄만 제거
  // dates: ['2026-05-30', '2026-05-31'] 같은 ISO 날짜 배열
  const handleCleanupHistoryDates = useCallback(async (dates: string[]) => {
    if (!notionClient) return { changed: 0, scanned: 0 };
    const prefixes = dates.map(d => `[${d}]`);
    const candidates = assets.filter(a => {
      const h = String((a.values as any)[HISTORY_FIELD_NAME] ?? '');
      return prefixes.some(p => h.includes(p));
    });
    setCleanupProgress({ current: 0, total: candidates.length });
    let changed = 0;
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      const h = String((a.values as any)[HISTORY_FIELD_NAME] ?? '');
      const lines = h.split('\n');
      const kept = lines.filter(l => !prefixes.some(p => l.startsWith(p)));
      const next = kept.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
      if (next !== h) {
        try {
          await notionClient.updatePage(a.id, HISTORY_FIELD_NAME, next, 'rich_text');
          // 로컬 상태 동기화
          setAssets(prev => prev.map(x =>
            x.id === a.id ? { ...x, values: { ...x.values, [HISTORY_FIELD_NAME]: next } } : x
          ));
          changed++;
        } catch (e) {
          console.error('[Cleanup] 실패:', a.id, e);
        }
      }
      setCleanupProgress({ current: i + 1, total: candidates.length });
    }
    setCleanupProgress(null);
    return { changed, scanned: candidates.length };
  }, [notionClient, assets]);

  // 자유 메모 — 자산의 처리이력에 한 줄 prepend.
  // 사용자가 현장에서 우발 콜이나 추가 작업 메모를 카드에서 바로 남길 수 있게.
  const handleAddNote = useCallback(async (asset: Asset, note: string) => {
    if (!notionClient || !note.trim()) return;
    const existing = String((asset.values as any)[HISTORY_FIELD_NAME] ?? '');
    const next = appendHistoryLine(existing, `메모: ${note.trim()}`);
    try {
      await notionClient.updatePage(asset.id, HISTORY_FIELD_NAME, next, 'rich_text');
      setAssets(prev => prev.map(a =>
        a.id === asset.id
          ? { ...a, values: { ...a.values, [HISTORY_FIELD_NAME]: next } }
          : a
      ));
      setLocationSelectedAssets(prev => prev.map(a =>
        a.id === asset.id
          ? { ...a, values: { ...a.values, [HISTORY_FIELD_NAME]: next } }
          : a
      ));
    } catch (e) {
      console.error('[Note] 메모 저장 실패:', e);
      Alert.alert('오류', '메모 저장 중 문제가 발생했습니다.');
    }
  }, [notionClient]);

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

          {/* Settings 화면에서도 글로벌 플로팅 버튼 */}
          <View style={styles.globalFloatingBar}>
            <TouchableOpacity
              style={styles.globalFloatingButton}
              onPress={() => setShowSettings(false)}
            >
              <Home size={22} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.globalFloatingButton, refreshing && styles.globalFloatingButtonActive]}
              onPress={() => {
                if (!refreshing) {
                  onRefresh();
                }
              }}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <RefreshCw size={22} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>
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
  if (!databaseId) {
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
              allAssets={assets}
              assets={siteFilteredAssets}
              filterConfig={fieldWorkConfig}
              templates={filterTemplates}
              schemaProperties={schemaProperties}
              currentSite={currentSite}
              onChangeSite={handleChangeSite}
              onStartWork={startWork}
              onOpenFilter={() => setShowFieldWorkFilter(true)}
              onLoadTemplate={loadTemplate}
              onSaveTemplate={saveTemplate}
              onDeleteTemplate={deleteTemplate}
              onQuickTask={handleQuickTask}
              onCombinedQuickTask={handleCombinedQuickTask}
              onTaskDashboard={() => setShowTaskDashboardModal(true)}
              onEditAsset={(asset) => {
                // 검색에서 선택한 자산을 편집하기 위해 작업 모드로 전환
                setLocationSelectedAssets([asset]);
                setIsWorkMode(true);
              }}
              onExport={() => setShowExportModal(true)}
              onBulkUpdate={() => setShowBulkUpdateModal(true)}
              onSourceImport={() => setShowSourceImportModal(true)}
              onOpenDBManagement={() => setShowDBManagementModal(true)}
              onSubmitFieldSupport={() => setShowFieldSupportModal(true)}
              onMonthlyReset={() => setShowMonthlyResetModal(true)}
              onOpenInfrastructure={() => setShowInfrastructureModal(true)}
              onDashboard={() => {
                setDashboardMode('all');
                setShowDashboardModal(true);
              }}
              onOpenDashboard={(mode) => {
                setDashboardMode(mode);
                setShowDashboardModal(true);
              }}
              workTargetCount={workFilteredAssets.length}
              onEditSiteRules={() => setShowSiteRulesModal(true)}
              onRefresh={onRefresh}
              effectiveSites={effectiveSites}
            />

            {/* 버전 표시 (배포 확인용) */}
            <Text style={styles.versionText}>{APP_VERSION}</Text>
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
              initialAiSession={fieldFilterAiSession}
              onPersistAiSession={persistFieldFilterAiSession}
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

            {/* 내보내기 모달 - 홈화면에서도 사용 가능 */}
            <ExportPreviewModal
              visible={showExportModal}
              onClose={() => setShowExportModal(false)}
              assets={fieldWorkConfig ? workFilteredAssets : assets}
              schema={schema}
              schemaProperties={schemaProperties}
            />
          </>
        ) : (
          /* 작업 모드 */
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeftContainer}>
                <TouchableOpacity onPress={goHome} style={styles.homeButton}>
                  <Home size={20} color="#6366f1" />
                </TouchableOpacity>
                {Object.keys(locationFilters).length > 0 && (
                  <TouchableOpacity onPress={handleBackToLocation} style={styles.backButtonInline}>
                    <ChevronLeft size={24} color="#6366f1" />
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.headerLeft}>
                <Text style={styles.headerTitle}>현장 작업</Text>
                <Text style={styles.headerSubtitle}>
                  {workFilteredAssets.length} / {assets.length} assets
                </Text>
              </View>
              <View style={styles.headerRight}>
                <TouchableOpacity
                  style={styles.headerButton}
                  onPress={() => setShowBulkUpdateModal(true)}
                >
                  <Upload size={20} color="#6366f1" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.headerButton}
                  onPress={() => setShowExportModal(true)}
                >
                  <Download size={20} color="#6366f1" />
                </TouchableOpacity>
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
              {/* 위치 계층이 설정되어 있고 아직 선택 완료 안됨 (skipLocationSelection이 false일 때만 표시) */}
              {fieldWorkConfig?.locationHierarchy && fieldWorkConfig.locationHierarchy.length > 0 && locationSelectedAssets.length === 0 && !skipLocationSelection ? (
                <LocationNavigator
                  assets={workFilteredAssets}
                  locationHierarchy={fieldWorkConfig.locationHierarchy}
                  sortColumn={fieldWorkConfig.sortColumn}
                  initialLevel={Object.keys(locationFilters).length}
                  initialSelectedValues={locationFilters}
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
                  allAssets={assets}
                  schema={schema}
                  schemaProperties={schemaProperties}
                  onUpdateAsset={handleUpdateAsset}
                  editableFields={fieldWorkConfig?.editableFields}
                  filterConfig={fieldWorkConfig}
                  activeQuickTask={activeQuickTask}
                  onCompleteQuickTask={handleCompleteQuickTask}
                  combinedMode={combinedQuickTask}
                  onAddNote={handleAddNote}
                  locationHierarchy={fieldWorkConfig?.locationHierarchy}
                  locationFilters={locationFilters}
                  onRequestChangeLocation={() => {
                    setSkipLocationSelection(false);
                    setLocationSelectedAssets([]);
                    setLocationFilters({});
                  }}
                  onLocalUpdate={(assetId, field, value) => {
                    // 로컬 상태 즉시 업데이트 (Optimistic Update)
                    setAssets(prev => prev.map(a =>
                      a.id === assetId
                        ? { ...a, values: { ...a.values, [field]: value } }
                        : a
                    ));
                    // locationSelectedAssets도 함께 업데이트
                    setLocationSelectedAssets(prev => prev.map(a =>
                      a.id === assetId
                        ? { ...a, values: { ...a.values, [field]: value } }
                        : a
                    ));
                  }}
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
              initialAiSession={fieldFilterAiSession}
              onPersistAiSession={persistFieldFilterAiSession}
            />

            <ExportPreviewModal
              visible={showExportModal}
              onClose={() => setShowExportModal(false)}
              assets={workFilteredAssets}
              schema={schema}
              schemaProperties={schemaProperties}
            />
          </>
        )}

        {/* 모달들 - 항상 마운트됨 */}
        <BulkUpdateModal
          visible={showBulkUpdateModal}
          onClose={() => {
            setShowBulkUpdateModal(false);
            loadData(); // Refresh after bulk update
          }}
          assets={assets}
          schema={schema}
          schemaProperties={schemaProperties}
          onUpdate={handleUpdateAsset}
          initialLookupColumn={bulkLookupColumn}
          onPersistLookupColumn={persistBulkLookupColumn}
          onCreatePage={async (values) => {
            if (!notionClient) return null;
            return await notionClient.createPage(values, schemaProperties);
          }}
          onDeletePage={async (pageId) => {
            if (!notionClient) return false;
            return await notionClient.archivePage(pageId);
          }}
          onCreateProperty={async (propertyName, type) => {
            if (!notionClient) return false;
            return await notionClient.createDatabaseProperty(propertyName, type || 'rich_text');
          }}
        />

        <SourceImportModal
          visible={showSourceImportModal}
          onClose={() => {
            setShowSourceImportModal(false);
            loadData(); // 임포트 후 새로고침
          }}
          assets={assets}
          schemaProperties={schemaProperties}
          onUpdate={handleUpdateAsset}
        />

        <DashboardModal
          visible={showDashboardModal}
          onClose={() => setShowDashboardModal(false)}
          assets={dashboardMode === 'filtered' ? workFilteredAssets : siteFilteredAssets}
          schema={schema}
          schemaProperties={schemaProperties}
          onUpdate={handleUpdateAsset}
          title={dashboardMode === 'filtered' ? '작업 대상' : '전체 장비'}
        />

        <SiteRulesModal
          visible={showSiteRulesModal}
          onClose={() => setShowSiteRulesModal(false)}
          overrides={sitesOverrides}
          onSave={handleSaveSitesOverrides}
        />

        <DBManagementModal
          visible={showDBManagementModal}
          onClose={() => setShowDBManagementModal(false)}
          onExport={() => setShowExportModal(true)}
          onBulkUpdate={() => setShowBulkUpdateModal(true)}
          onSourceImport={() => setShowSourceImportModal(true)}
          onCleanupHistoryDates={handleCleanupHistoryDates}
          cleanupProgress={cleanupProgress}
        />

        <FieldSupportSubmitModal
          visible={showFieldSupportModal}
          onClose={() => {
            setShowFieldSupportModal(false);
            loadData(); // 접수 후 새로고침
          }}
          assets={assets}
          schemaProperties={schemaProperties}
          onUpdate={handleUpdateAsset}
        />

        <MonthlyResetModal
          visible={showMonthlyResetModal}
          onClose={() => {
            setShowMonthlyResetModal(false);
            loadData();
          }}
          assets={assets}
          schemaProperties={schemaProperties}
          onUpdate={handleUpdateAsset}
        />

        <InfrastructureModal
          visible={showInfrastructureModal}
          onClose={() => setShowInfrastructureModal(false)}
          data={infrastructure}
          assets={assets}
          effectiveSites={effectiveSites}
          onSave={handleSaveInfrastructure}
          onOpenLayout={(b, f, r) => {
            // 인프라 닫고 레이아웃 편집기 띄움. 닫히면 인프라 다시 열기.
            setShowInfrastructureModal(false);
            setReturnToInfrastructure(true);
            setEditingRoom({ building: b, floor: f, room: r });
          }}
        />

        {/* 레이아웃: 연구실 선택 → 편집기 */}
        <LayoutRoomPickerModal
          visible={showLayoutPicker}
          onClose={() => setShowLayoutPicker(false)}
          assets={assets}
          existingRoomKeys={new Set(Object.keys(layoutsStore.rooms))}
          titleField={Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name'}
          onSelect={(b, f, r) => {
            setShowLayoutPicker(false);
            setEditingRoom({ building: b, floor: f, room: r });
          }}
        />

        {editingRoom && (() => {
          const k = roomKey(editingRoom.building, editingRoom.floor, editingRoom.room);
          const roomAssets = assets.filter(a => {
            const v = a.values as any;
            return v['L)건물'] === editingRoom.building
              && v['L)층'] === editingRoom.floor
              && v['L)연구실'] === editingRoom.room;
          });
          const titleField = Object.keys(schemaProperties).find(p => schemaProperties[p].type === 'title') || 'Name';
          return (
            <LayoutEditorModal
              visible
              onClose={() => {
                setEditingRoom(null);
                if (returnToInfrastructure) {
                  setReturnToInfrastructure(false);
                  setShowInfrastructureModal(true);
                }
              }}
              building={editingRoom.building}
              floor={editingRoom.floor}
              room={editingRoom.room}
              initialLayout={layoutsStore.rooms[k] || null}
              roomAssets={roomAssets}
              titleField={titleField}
              onSave={async (lay) => {
                await handleSaveRoomLayout(k, lay);
                setEditingRoom(null);
                if (returnToInfrastructure) {
                  setReturnToInfrastructure(false);
                  setShowInfrastructureModal(true);
                }
              }}
            />
          );
        })()}

        <TaskDashboardModal
          visible={showTaskDashboardModal}
          onClose={() => setShowTaskDashboardModal(false)}
          assets={siteFilteredAssets}
          schemaProperties={schemaProperties}
          onCompleteQuickTask={handleCompleteQuickTask}
          currentSite={currentSite}
          effectiveSites={effectiveSites}
          onJumpToAsset={(asset) => {
            setShowTaskDashboardModal(false);
            // 카드 뷰로 점프 — 통합 큐 모드로 진입해 해당 자산을 시작점으로
            handleCombinedQuickTask();
            setLocationSelectedAssets([asset]);
            // 카드에서 '대시보드로' 버튼이 보이도록 표시
            setReturnToDashboard(true);
          }}
        />

        {/* 글로벌 플로팅 버튼 - 홈, 대시보드(있을 때), 새로고침 */}
        <View style={styles.globalFloatingBar}>
          <TouchableOpacity
            style={styles.globalFloatingButton}
            onPress={goHome}
          >
            <Home size={22} color="#ffffff" />
          </TouchableOpacity>
          {returnToDashboard && (
            <TouchableOpacity
              style={[styles.globalFloatingButton, { backgroundColor: '#4338ca' }]}
              onPress={backToTaskDashboard}
            >
              <Text style={{ color: '#ffffff', fontSize: 16 }}>📊</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.globalFloatingButton, refreshing && styles.globalFloatingButtonActive]}
            onPress={() => {
              if (!refreshing) {
                Alert.alert(
                  '🔄 새로고침',
                  'Notion에서 최신 데이터를 가져옵니다. 현재 작업 상태는 유지됩니다.',
                  [
                    { text: '취소', style: 'cancel' },
                    {
                      text: '새로고침',
                      onPress: () => {
                        onRefresh();
                      }
                    }
                  ]
                );
              }
            }}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <RefreshCw size={22} color="#ffffff" />
            )}
          </TouchableOpacity>
        </View>
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
  headerLeft: {
    flex: 1,
  },
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
    marginRight: 4,
  },
  headerLeftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonInline: {
    padding: 8,
    marginRight: 4,
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
  globalFloatingBar: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    flexDirection: 'column',
    gap: 10,
    zIndex: 1000,
  },
  globalFloatingButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  globalFloatingButtonActive: {
    backgroundColor: '#4f46e5',
  },
  versionText: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    fontSize: 10,
    color: '#9ca3af',
    opacity: 0.7,
  },
});
