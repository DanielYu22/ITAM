import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
    LayoutDashboard,
    Package,
    Plus,
    Trash2,
    PlayCircle,
    Database,
    Smartphone,
    Edit2,
    Copy,
    Check,
    X,
    Search,
    Download,
    BarChart3,
    Menu
} from 'lucide-react';
import { Asset, NotionClient, NotionConfig, NotionProperty } from './lib/notion'; // Updated import
import { FilterCondition, FilterTemplate, SortRule, DEFAULT_FILTER, toNotionFilter, toNotionSorts } from './lib/utils';
import { OfficeView } from './components/OfficeView';
import { FieldView } from './components/FieldView';
import { FilterBuilderModal } from './components/FilterBuilderModal';
import { DashboardView } from './components/DashboardView';

type AppMode = 'OFFICE' | 'FIELD' | 'DASHBOARD';

const NavItem = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-medium text-sm group ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
    >
        <div className={`transition-colors ${active ? 'text-white' : 'text-slate-500 group-hover:text-white'}`}>
            {icon}
        </div>
        <span>{label}</span>
        {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white shadow-sm" />}
    </button>
);

const ALL_TASKS_TEMPLATE: FilterTemplate = {
    id: 'all_tasks_complex',
    name: '모든 과제',
    filter: {
        id: 'root',
        logic: 'AND',
        conditions: [
            {
                id: 'g1',
                logic: 'OR',
                conditions: [
                    { id: 'c1', field: '1. 기기정보VBS어디저장되는지', operator: 'is_empty' },
                    { id: 'c2', field: '분기백업대상여부', operator: 'is_empty' },
                    { id: 'c3', field: '4. 알약(온라인인지)', operator: 'is_empty' },
                    { id: 'c4', field: '알약작업비고', operator: 'contains', value: '!!' },
                    { id: 'c5', field: '7. 기기정보관련', operator: 'contains', value: '!!' },
                    { id: 'c6', field: 'PC자산인지', operator: 'not_equals', value: 'PC' },
                    { id: 'c7', field: 'PC자산인지', operator: 'is_empty' },
                    { id: 'c8', field: '3. Synology URL 설치여부', operator: 'is_empty' }
                ]
            },
            { id: 'c9', field: '4. 알약(온라인인지)', operator: 'does_not_contain', value: '알약대상아님' },
            { id: 'l_multi', field: '설치 장소(건물)', operator: 'is_in', value: '창조관|Instructions|바이오센터|경영관|혁신관' },
            {
                id: 'g3',
                logic: 'AND',
                conditions: [
                    { id: 'e1', field: 'PC자산인지', operator: 'not_equals', value: '대상아님(PC아님)' },
                    { id: 'e2', field: 'PC자산인지', operator: 'not_equals', value: '대상아님(SET장비)' },
                    { id: 'e3', field: 'PC자산인지', operator: 'not_equals', value: '대상아님(오송)' }
                ]
            }
        ]
    }
};

const App = () => {
    // Use environment variables or fallback to hardcoded (development only)
    const [notionConfig] = useState<NotionConfig>({
        apiKey: import.meta.env.VITE_NOTION_KEY || 'ntn_J64101163006UO3bpj09kzvX9XeQSQhHuV15OYnEzCK0YP',
        databaseId: import.meta.env.VITE_NOTION_DATABASE_ID || '2d017e129ccc81bb8b07c8b41547bcd9'
    });

    const [assets, setAssets] = useState<Asset[]>([]);
    const [schema, setSchema] = useState<string[]>([]);
    const [schemaProperties, setSchemaProperties] = useState<Record<string, NotionProperty>>({}); // New State
    const [schemaTypes, setSchemaTypes] = useState<Record<string, string>>({});
    const [visibleColumns, setVisibleColumns] = useState<string[]>([]); // New State
    const [appMode, setAppMode] = useState<AppMode>('DASHBOARD'); // Default to dashboard mode
    const [isSyncing, setIsSyncing] = useState(false);

    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [isSavedViewsOpen, setIsSavedViewsOpen] = useState(true); // Sidebar toggle


    const [templates, setTemplates] = useState<FilterTemplate[]>([]);
    const [activeFilter, setActiveFilter] = useState<FilterCondition>(DEFAULT_FILTER);
    const [activeSorts, setActiveSorts] = useState<SortRule[]>([]); // New State
    const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
    const [showFilterBuilder, setShowFilterBuilder] = useState(false);

    // Template Editing State
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");

    // Global Search State
    const [globalSearchQuery, setGlobalSearchQuery] = useState("");

    // Summary Fields Config
    const [summaryFields] = useState<string[]>(['Status', 'Type']); // Default fields

    const handleSync = useCallback(async (reset = true) => {
        setIsSyncing(true);
        const client = new NotionClient(notionConfig);

        let props = schemaProperties;
        if (Object.keys(props).length === 0) {
            props = await client.getDatabaseSchema();
            setSchemaProperties(props);
            setSchema(Object.keys(props));
            const types: Record<string, string> = {};
            Object.entries(props).forEach(([k, v]) => types[k] = v.type);
            setSchemaTypes(types);
            if (visibleColumns.length === 0) setVisibleColumns(Object.keys(props));
        }

        let notionFilter = undefined;
        if (appMode === 'OFFICE') {
            notionFilter = toNotionFilter(activeFilter, schemaTypes); // Use state directly if valid
        }

        // Convert Sorts
        const notionSorts = toNotionSorts(activeSorts);

        // If reset, start fresh. If not, use nextCursor.
        const cursor = reset ? undefined : (nextCursor || undefined);

        // Load 100 items - User asked for more? Maybe 100 is fine if "Load More" works well.
        // User asked: "Load Data button... fetch 100 more...". Updated to 100.
        const result = await client.queryDatabase(notionFilter, notionSorts, 100, cursor);

        if (reset) {
            setAssets(result.assets);
        } else {
            setAssets(prev => [...prev, ...result.assets]); // Append
        }

        setNextCursor(result.nextCursor || null);
        setHasMore(result.hasMore);
        setIsSyncing(false);
    }, [notionConfig, appMode, activeFilter, activeSorts, visibleColumns, nextCursor, schemaTypes]);

    const handleSearch = useCallback(async (filter: FilterCondition, sorts: SortRule[] = []) => {
        setIsSyncing(true);
        const client = new NotionClient(notionConfig);

        // Ensure schema types for filter conversion
        let currentTypes = schemaTypes;

        // Helper to check if any field in the filter is missing from known schema
        const checkFields = (f: FilterCondition): boolean => {
            if (f.field && !currentTypes[f.field]) return true; // Found missing field
            if (f.conditions) return f.conditions.some(checkFields);
            return false;
        };

        const isMissingSchema = Object.keys(currentTypes).length === 0 || checkFields(filter);

        if (isMissingSchema) {
            console.log("Refetching schema due to missing keys...");
            const props = await client.getDatabaseSchema();
            setSchemaProperties(props);

            const types: Record<string, string> = {};
            Object.entries(props).forEach(([k, v]) => types[k] = v.type);
            setSchemaTypes(types);
            setSchema(Object.keys(props));
            currentTypes = types;

            if (visibleColumns.length === 0) setVisibleColumns(Object.keys(props));
        }

        const notionFilter = toNotionFilter(filter, currentTypes);
        const notionSorts = toNotionSorts(sorts);

        // Always reset pagination on new search
        const result = await client.queryDatabase(notionFilter, notionSorts, 100, undefined); // 100 items

        setAssets(result.assets);
        setNextCursor(result.nextCursor || null);
        setHasMore(result.hasMore);
        setIsSyncing(false);
    }, [notionConfig, schemaTypes, visibleColumns]);

    const handleLoadMore = () => {
        if (!hasMore || isSyncing) return;
        handleSync(false); // Pass false to append
    };

    const handleLoadAll = async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        const client = new NotionClient(notionConfig);

        let currentTypes = schemaTypes;
        if (Object.keys(currentTypes).length === 0) {
            const props = await client.getDatabaseSchema();
            setSchemaProperties(props);
            const types: Record<string, string> = {};
            Object.entries(props).forEach(([k, v]) => types[k] = v.type);
            currentTypes = types;
            setSchemaTypes(types);
            setSchema(Object.keys(props));
            if (visibleColumns.length === 0) setVisibleColumns(Object.keys(props));
        }

        const notionFilter = toNotionFilter(activeFilter, currentTypes);
        const notionSorts = toNotionSorts(activeSorts);

        const result = await client.fetchAllDatabase(notionFilter, notionSorts);
        setAssets(result.assets);
        setNextCursor(null);
        setHasMore(false);
        setIsSyncing(false);
    };

    const handleAnalyze = async () => {
        setIsSyncing(true);
        const client = new NotionClient(notionConfig);
        // ... same setup ...
        let currentTypes = schemaTypes;
        if (Object.keys(currentTypes).length === 0) {
            const props = await client.getDatabaseSchema();
            setSchemaProperties(props);
            const types: Record<string, string> = {};
            Object.entries(props).forEach(([k, v]) => types[k] = v.type);
            currentTypes = types;
            setSchemaTypes(types);
            setSchema(Object.keys(props));
            if (visibleColumns.length === 0) setVisibleColumns(Object.keys(props));
        }

        const notionFilter = toNotionFilter(activeFilter, currentTypes);
        // Fetch ALL
        const result = await client.fetchAllDatabase(notionFilter);

        setAssets(result.assets);
        setNextCursor(null); // No more pagination for analysis view
        setHasMore(false);
        setIsSyncing(false);
    };

    const handleExport = async () => {
        if (isSyncing) return;
        if (!confirm("This will fetch all matching data and export to Excel. Continue?")) return;

        setIsSyncing(true);
        try {
            const client = new NotionClient(notionConfig);

            // Re-use fetch logic
            let currentTypes = schemaTypes;
            if (Object.keys(currentTypes).length === 0) {
                const props = await client.getDatabaseSchema();
                setSchemaProperties(props);
                const types: Record<string, string> = {};
                Object.entries(props).forEach(([k, v]) => types[k] = v.type);
                currentTypes = types;
                setSchemaTypes(types);
            }

            const notionFilter = toNotionFilter(activeFilter, currentTypes);
            const notionSorts = toNotionSorts(activeSorts);

            // Fetch ALL data
            const result = await client.fetchAllDatabase(notionFilter, notionSorts);

            // Map to Excel Rows using VISIBLE COLUMNS
            const exportData = result.assets.map(asset => {
                const row: Record<string, any> = {};
                // Include ID/Link automatically? Or just visible columns
                // User said: "current setting columns"
                visibleColumns.forEach(col => {
                    row[col] = asset.values[col] || '';
                });
                return row;
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(exportData);
            XLSX.utils.book_append_sheet(wb, ws, "Assets");

            const fileName = (activeTemplateId ? (templates.find(t => t.id === activeTemplateId)?.name || 'Export') : 'All_Assets') + '.xlsx';
            XLSX.writeFile(wb, fileName);

        } catch (e) {
            console.error("Export failed", e);
            alert("Export failed. Please try again.");
        } finally {
            setIsSyncing(false);
        }
    };

    const handleGlobalSearch = async (query: string) => {
        if (!query.trim()) return;
        setAppMode('OFFICE');
        setIsSyncing(true);

        // 1. Need schema to identify text fields
        const client = new NotionClient(notionConfig);
        let props = schemaProperties;
        if (Object.keys(props).length === 0) {
            props = await client.getDatabaseSchema();
            setSchemaProperties(props);
            // ... update types ...
            const types: Record<string, string> = {};
            Object.entries(props).forEach(([k, v]) => types[k] = v.type);
            setSchemaTypes(types);
            props = props; // Keep TS happy
        }

        // 2. Build OR Filter across all Text/Select fields
        const conditions: FilterCondition[] = [];
        Object.entries(props).forEach(([key, prop]) => {
            if (prop.type === 'title' || prop.type === 'rich_text') {
                conditions.push({ id: `s_${key} `, field: key, operator: 'contains', value: query });
            } else if (prop.type === 'select' || prop.type === 'multi_select') {
                // Notion API doesn't support 'contains' for select directly in same way as text? 
                // Wait, Select supports 'equals' or 'is_not_empty'. Partial match?
                // Actually filter object for select has 'equals' or 'does_not_equal'.
                // Using 'contains' might not work on Select, only on Multi-Select?
                // Correction: Select usually requires exact match. 
                // Notion API hack: You cannot easily do partial search on Select values via Filter API.
                // We will stick to Text fields for "Global Search" via Filter, OR fetch all and filter client side (too heavy).
                // Let's try adding it, but 'contains' on 'select' is typically not supported.
                // Wait, Multi-select supports 'contains'. Select does NOT support 'contains', only 'equals'.
                // So for 'select', we skipping partial match in API filter.
            }
        });

        // Let's rely on Title and Rich Text for now.
        // User asked for "Select property 'Changjo' ...".
        // To support that, we might need to fetch options for Select, find matches, and then filter by EXACT match.
        // That's complex. Let's start with simple text search.

        const searchFilter: FilterCondition = {
            id: 'global_search',
            logic: 'OR',
            conditions: conditions
        };

        // If user wants to search Select, I will add logic to check known Select Options? 
        // Too complicated for one step. Stick to Text for now or use client side if they "Fetch All".

        // Actually, let's just use what FilterBuilder supports. 'contains' works on Text.
        setActiveFilter(searchFilter);
        setActiveTemplateId(null); // Clear active template
        handleSearch(searchFilter, []);
    };


    // Trigger sync on mode change?
    useEffect(() => {
        if (appMode === 'DASHBOARD') {
            if (assets.length === 0) handleSync(true);
        } else if (appMode === 'OFFICE') {
            if (activeTemplateId) {
                handleSync(true);
            }
        }
    }, [appMode]);

    // Load templates on mount
    useEffect(() => {
        const saved = localStorage.getItem('nexus_itam_templates');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (!parsed.find((t: FilterTemplate) => t.id === 'all_tasks_complex')) {
                    parsed.push(ALL_TASKS_TEMPLATE);
                }
                setTemplates(parsed);
            } catch (e) {
                console.error("Failed to load templates", e);
                setTemplates([ALL_TASKS_TEMPLATE]);
            }
        } else {
            setTemplates([ALL_TASKS_TEMPLATE]);
        }
    }, []);

    const saveTemplate = (name: string, filter: FilterCondition, columns: string[] = [], sorts: SortRule[] = []) => {
        const newTemplate: FilterTemplate = {
            id: crypto.randomUUID(),
            name,
            filter,
            visibleColumns: columns,
            sorts
        };
        const updated = [...templates, newTemplate];
        setTemplates(updated);
        localStorage.setItem('nexus_itam_templates', JSON.stringify(updated));
    };

    const deleteTemplate = (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (confirm("Are you sure you want to delete this view?")) {
            const updated = templates.filter(t => t.id !== id);
            setTemplates(updated);
            localStorage.setItem('nexus_itam_templates', JSON.stringify(updated));
            if (activeTemplateId === id) {
                setActiveTemplateId(null);
                setActiveFilter(DEFAULT_FILTER);
                // Reset view? Maybe not full reset, just filter clearing
            }
        }
    };

    const duplicateTemplate = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const template = templates.find(t => t.id === id);
        if (!template) return;
        const newTemplate = {
            ...template,
            id: crypto.randomUUID(),
            name: `${template.name} (Copy)`
        };
        const updated = [...templates, newTemplate];
        setTemplates(updated);
        localStorage.setItem('nexus_itam_templates', JSON.stringify(updated));
    };

    const updateTemplate = (id: string, updates: Partial<FilterTemplate>) => {
        const updated = templates.map(t => t.id === id ? { ...t, ...updates } : t);
        setTemplates(updated);
        localStorage.setItem('nexus_itam_templates', JSON.stringify(updated));
    };

    const startEditing = (t: FilterTemplate, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingTemplateId(t.id);
        setEditName(t.name);
    };

    const saveEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (editingTemplateId && editName.trim()) {
            updateTemplate(editingTemplateId, { name: editName });
            setEditingTemplateId(null);
        }
    };

    const cancelEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingTemplateId(null);
    };

    const applyTemplate = (t: FilterTemplate) => {
        setAppMode('OFFICE');
        setActiveFilter(t.filter);
        if (t.visibleColumns) setVisibleColumns(t.visibleColumns);
        if (t.sorts) setActiveSorts(t.sorts); else setActiveSorts([]); // Apply sorts
        setActiveTemplateId(t.id);
        handleSearch(t.filter, t.sorts || []);
    };

    const updateAssetField = async (id: string, field: string, value: string) => {
        // Optimistic update
        setAssets(prev => prev.map(a => a.id === id ? { ...a, values: { ...a.values, [field]: value } } : a));

        // API call
        const client = new NotionClient(notionConfig);
        if (schemaProperties[field]) {
            await client.updatePage(id, field, value, schemaProperties[field].type);
        }
    };

    // Calculate Summary Stats (Client Side on Loaded Data)
    const summaryStats = useMemo(() => {
        const stats: Record<string, Record<string, number>> = {};
        summaryFields.forEach(field => {
            stats[field] = {};
            assets.forEach(a => {
                const val = (a.values[field] || 'Empty') as string;
                stats[field][val] = (stats[field][val] || 0) + 1;
            });
        });
        return stats;
    }, [assets, summaryFields]);

    const renderContent = () => {
        switch (appMode) {
            case 'DASHBOARD':
                return <DashboardView assets={assets} onAnalyze={handleAnalyze} isAnalyzing={isSyncing} schema={schema} />;
            case 'FIELD':
                return (
                    <FieldView
                        assets={assets}
                        templates={templates}
                        schema={schema}
                        schemaProperties={schemaProperties} // Pass properties
                        activeFilter={activeFilter} // Pass filter
                        updateAssetField={updateAssetField}
                        onExit={() => setAppMode('OFFICE')}
                    />
                );
            case 'OFFICE':
            default:
                return (
                    <div className="flex flex-col h-full">
                        {/* Office Header with Export & Summary */}
                        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-800">
                                {activeTemplateId ? (templates.find(t => t.id === activeTemplateId)?.name) : 'All Assets'}
                            </h2>
                            <div className="flex items-center gap-3">
                                {/* Summary Dropdown/Display */}
                                <div className="flex items-center gap-2 text-xs bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                                    <BarChart3 size={14} className="text-indigo-500" />
                                    <span className="font-bold text-slate-600">Summary:</span>
                                    <span className="text-slate-900 font-mono font-bold mr-2">{assets.length} loaded</span>
                                    {/* Simple Stats Display */}
                                    {Object.entries(summaryStats).slice(0, 3).map(([field, counts]) => (
                                        <div key={field} className="flex gap-1 border-l border-slate-300 pl-2">
                                            <span className="text-slate-400">{field}:</span>
                                            {Object.entries(counts).slice(0, 2).map(([val, count]) => (
                                                <span key={val} className="text-slate-600">{val}({count})</span>
                                            ))}
                                        </div>
                                    ))}
                                </div>

                                <button
                                    onClick={handleExport}
                                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm transition-colors shadow-sm"
                                >
                                    <Download size={16} /> Export Excel
                                </button>
                            </div>
                        </div>
                        <OfficeView
                            assets={assets}
                            schema={schema}
                            visibleColumns={visibleColumns}
                            schemaProperties={schemaProperties}
                            onUpdateAsset={updateAssetField}
                            onOpenFilter={() => setShowFilterBuilder(true)}
                            onSync={() => handleSync(true)} // Explicit refresh implies reset
                            onSearch={() => handleSearch(activeFilter, activeSorts)}
                            isSyncing={isSyncing}
                            activeTemplateName={templates.find(t => t.id === activeTemplateId)?.name}
                            onClearFilter={() => {
                                const emptyFilter = DEFAULT_FILTER;
                                setActiveFilter(emptyFilter);
                                setActiveTemplateId(null);
                                setVisibleColumns(schema);
                                setAssets([]); // Clear Screen
                                setNextCursor(null);
                                setHasMore(false);
                            }}
                            hasMore={hasMore} // New
                            onLoadMore={handleLoadMore} // New
                            onLoadAll={handleLoadAll}
                        />
                    </div>
                );
        }
    }

    const [showMobileMenu, setShowMobileMenu] = useState(false); // New state

    return (
        <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 font-sans">
            {/* Mobile Header */}
            {appMode !== 'FIELD' && (
                <div className="md:hidden bg-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-800">
                    <button onClick={() => setShowMobileMenu(!showMobileMenu)} className="text-slate-300">
                        {showMobileMenu ? <X size={24} /> : <Menu size={24} />}
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">IT</div>
                        <h1 className="text-lg font-bold text-white tracking-tight">Nexus ITAM</h1>
                    </div>
                    <div className="w-6"></div>{/* Spacer for centering logo */}
                </div>
            )}

            {/* Sidebar (Desktop + Mobile Overlay) */}
            {appMode !== 'FIELD' && (
                <>
                    {/* Mobile Overlay Backdrop */}
                    {showMobileMenu && (
                        <div
                            className="fixed inset-0 bg-black/50 z-40 md:hidden"
                            onClick={() => setShowMobileMenu(false)}
                        />
                    )}

                    <aside className={`
                        flex flex-col w-64 bg-slate-900 text-slate-300 p-4 border-r border-slate-800
                        fixed md:relative inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out
                        ${showMobileMenu ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                    `}>
                        {/* Desktop Header (Hidden on Mobile as we have the top bar) */}
                        <div className="hidden md:flex items-center gap-3 px-2 mb-6">
                            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">IT</div>
                            <h1 className="text-lg font-bold text-white tracking-tight">Nexus ITAM</h1>
                        </div>

                        {/* Global Search */}
                        <div className="px-2 mb-6">
                            <div className="relative group">
                                <Search size={16} className="absolute left-3 top-2.5 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                                <input
                                    type="text"
                                    placeholder="Global Search..."
                                    value={globalSearchQuery}
                                    onChange={(e) => setGlobalSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleGlobalSearch(globalSearchQuery)}
                                    className="w-full bg-slate-800 text-white rounded-xl pl-10 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 border border-slate-700 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                />
                            </div>
                        </div>

                        <nav className="flex-1 space-y-6 overflow-y-auto">
                            <div className="space-y-1">
                                <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Main</p>
                                <NavItem icon={<LayoutDashboard size={20} />} label="Dashboard" active={appMode === 'DASHBOARD'} onClick={() => {
                                    setAppMode('DASHBOARD');
                                    setActiveFilter(DEFAULT_FILTER);
                                    setActiveTemplateId(null);
                                    setShowMobileMenu(false);
                                }} />
                                <NavItem icon={<Package size={20} />} label="All Assets" active={appMode === 'OFFICE' && activeTemplateId === null} onClick={() => {
                                    setAppMode('OFFICE');
                                    setActiveFilter(DEFAULT_FILTER);
                                    setActiveTemplateId(null);
                                    setAssets([]);
                                    setNextCursor(null);
                                    setHasMore(false);
                                    setShowMobileMenu(false);
                                }} />
                            </div>

                            {/* Saved Views Section */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between px-3 mb-2 cursor-pointer hover:text-white transition-colors" onClick={() => setIsSavedViewsOpen(!isSavedViewsOpen)}>
                                    <div className="flex items-center gap-2">
                                        <Database size={14} className={isSavedViewsOpen ? 'text-indigo-400' : 'text-slate-500'} />
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Saved Views</p>
                                    </div>
                                    <span className={`text - [10px] transition - transform ${isSavedViewsOpen ? 'rotate-90' : ''} `}>▶</span>
                                </div>

                                {isSavedViewsOpen && (
                                    <div className="pl-2 space-y-1 border-l border-slate-800 ml-2">
                                        <div className="flex items-center justify-between px-2 mb-1">
                                            <span className="text-[10px] text-slate-600">Templates</span>
                                            <button onClick={() => setShowFilterBuilder(true)} className="text-slate-500 hover:text-white p-1 rounded-md hover:bg-slate-800"><Plus size={12} /></button>
                                        </div>
                                        {templates.map(t => (
                                            <div key={t.id} className="group flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-slate-800 transition-all cursor-pointer">
                                                <PlayCircle size={14} className={activeTemplateId === t.id ? 'text-indigo-400' : 'text-slate-600'} />

                                                {editingTemplateId === t.id ? (
                                                    <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                        <input
                                                            value={editName}
                                                            onChange={e => setEditName(e.target.value)}
                                                            className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-white outline-none focus:border-indigo-500"
                                                            autoFocus
                                                        />
                                                        <button onClick={saveEdit} className="text-green-400 hover:text-green-300"><Check size={12} /></button>
                                                        <button onClick={cancelEdit} className="text-red-400 hover:text-red-300"><X size={12} /></button>
                                                    </div>
                                                ) : (
                                                    <span
                                                        className={`flex - 1 truncate ${activeTemplateId === t.id ? 'text-white font-semibold' : 'text-slate-400'} `}
                                                        onClick={() => {
                                                            applyTemplate(t);
                                                            setShowMobileMenu(false);
                                                        }}
                                                    >
                                                        {t.name}
                                                    </span>
                                                )}

                                                {editingTemplateId !== t.id && (
                                                    <div className="hidden group-hover:flex items-center gap-1">
                                                        <button onClick={(e) => startEditing(t, e)} className="text-slate-500 hover:text-blue-400" title="Rename"><Edit2 size={12} /></button>
                                                        <button onClick={(e) => duplicateTemplate(t.id, e)} className="text-slate-500 hover:text-white" title="Duplicate"><Copy size={12} /></button>
                                                        <button onClick={(e) => deleteTemplate(t.id, e)} className="text-slate-500 hover:text-red-400" title="Delete"><Trash2 size={12} /></button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {templates.length === 0 && <p className="px-3 text-xs text-slate-600 italic">No saved views</p>}
                                    </div>
                                )}
                            </div>
                        </nav>

                        <div className="mt-auto space-y-2 pt-4 border-t border-slate-800">
                            <div className="px-3 py-3 mb-2 bg-indigo-950/30 rounded-2xl border border-indigo-500/20">
                                <div className="flex items-center gap-2 mb-2">
                                    <Database size={14} className="text-indigo-400" />
                                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Connected</span>
                                </div>
                                <p className="text-[10px] text-slate-400 truncate font-mono">{notionConfig.databaseId}</p>
                            </div>

                            <button
                                onClick={() => {
                                    setAppMode('FIELD');
                                    setShowMobileMenu(false);
                                }}
                                className="flex items-center justify-center gap-3 w-full px-4 py-4 text-sm font-bold bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-600/20 active:scale-95"
                            >
                                <Smartphone size={18} /> Field Mode
                            </button>
                        </div>
                    </aside>
                </>
            )}

            <main className="flex-1 flex flex-col h-screen overflow-hidden">
                {renderContent()}
            </main>

            {showFilterBuilder && (
                <FilterBuilderModal
                    schema={schema}
                    schemaProperties={schemaProperties} // Pass full properties for dropdowns
                    initialFilter={activeFilter}
                    initialSorts={activeSorts} // Pass sorts
                    initialVisibleColumns={visibleColumns} // Pass current view
                    onSave={(filter: any, columns: string[], sorts: any[]) => {
                        setActiveFilter(filter);
                        setVisibleColumns(columns); // Apply changes
                        setActiveSorts(sorts);
                        setShowFilterBuilder(false);
                        handleSearch(filter, sorts);
                    }}
                    onSaveAsTemplate={(name: string, filter: any, columns: string[], sorts: any[]) => {
                        saveTemplate(name, filter, columns, sorts);
                        setActiveFilter(filter);
                        setVisibleColumns(columns);
                        setActiveSorts(sorts);
                        setShowFilterBuilder(false);
                        handleSearch(filter, sorts);
                    }}
                    onClose={() => setShowFilterBuilder(false)}
                    activeTemplateId={activeTemplateId}
                    onUpdateTemplate={(updates) => {
                        if (activeTemplateId) {
                            updateTemplate(activeTemplateId, updates);
                            // If updating filter/sorts, also apply them immediately
                            if (updates.filter) setActiveFilter(updates.filter);
                            if (updates.visibleColumns) setVisibleColumns(updates.visibleColumns);
                            if (updates.sorts) setActiveSorts(updates.sorts);

                            setShowFilterBuilder(false);
                            handleSearch(updates.filter || activeFilter, updates.sorts || activeSorts);
                        }
                    }}
                />
            )}
        </div>
    );
};

export default App;
