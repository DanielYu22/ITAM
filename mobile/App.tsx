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
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Search, Database, RefreshCw, Settings, Filter } from 'lucide-react-native';
import { NotionClient, Asset, NotionProperty } from './src/lib/notion';
import { NOTION_API_KEY, NOTION_DATABASE_ID, API_BASE_URL } from './src/config';
import { MobileCardView } from './src/components/MobileCardView';
import { evaluateFilter, FilterCondition, DEFAULT_FILTER } from './src/lib/utils';
import { FieldWorkFilter } from './src/components/FieldWorkFilter';

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
  const [fieldWorkConfig, setFieldWorkConfig] = useState<any>(null);

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

  // Load data
  const loadData = useCallback(async () => {
    if (!notionClient) {
      console.log('[App] No Notion client configured');
      setLoading(false);
      return;
    }

    try {
      console.log('[App] Loading data...');

      // Get schema first
      const schemaProps = await notionClient.getDatabaseSchema();
      setSchemaProperties(schemaProps);

      // Query database
      const result = await notionClient.queryDatabase(undefined, undefined, 100);
      setAssets(result.assets);
      setSchema(result.schema);
      setFilteredAssets(result.assets);

      console.log(`[App] Loaded ${result.assets.length} assets`);
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
    if (!fieldWorkConfig) return filteredAssets;

    let result = filteredAssets;

    // 작업 대상 조건 적용
    if (fieldWorkConfig.targetConditions) {
      fieldWorkConfig.targetConditions.forEach((cond: any) => {
        result = result.filter(asset => {
          const val = (asset.values[cond.column] || '').toLowerCase();
          switch (cond.type) {
            case 'is_empty':
              return !val || val === '';
            case 'is_not_empty':
              return val && val !== '';
            case 'contains':
              return val.includes((cond.value || '').toLowerCase());
            case 'not_contains':
              return !val.includes((cond.value || '').toLowerCase());
            case 'equals':
              return val === (cond.value || '').toLowerCase();
            default:
              return true;
          }
        });
      });
    }

    // 위치 필터 적용
    if (fieldWorkConfig.locationFilters) {
      Object.entries(fieldWorkConfig.locationFilters).forEach(([col, values]: [string, any]) => {
        if (values && values.length > 0) {
          result = result.filter(asset => {
            const val = asset.values[col] || '';
            return values.some((v: string) => val.includes(v));
          });
        }
      });
    }

    return result;
  }, [filteredAssets, fieldWorkConfig]);

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

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>NEXUS ITAM</Text>
            <Text style={styles.headerSubtitle}>
              {workFilteredAssets.length} / {assets.length} assets
              {fieldWorkConfig && ' (필터 적용중)'}
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
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => setShowSettings(true)}
            >
              <Settings size={20} color="#6366f1" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Search size={18} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search assets..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#9ca3af"
          />
        </View>

        {/* Main Content */}
        <View style={styles.content}>
          {filteredAssets.length === 0 ? (
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
            />
          )}
        </View>

        {/* Field Work Filter Modal */}
        <FieldWorkFilter
          visible={showFieldWorkFilter}
          onClose={() => setShowFieldWorkFilter(false)}
          onApply={setFieldWorkConfig}
          schema={schema}
          schemaProperties={schemaProperties}
          assets={assets}
          currentConfig={fieldWorkConfig}
        />
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
});
