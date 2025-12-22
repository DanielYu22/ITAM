
import React, { useState, useEffect, useCallback } from 'react';
import {
    LayoutDashboard,
    Package,
    Plus,
    Trash2,
    PlayCircle,
    Database,
    Smartphone,
} from 'lucide-react';
import { Asset, NotionClient, NotionConfig, NotionProperty } from './lib/notion'; // Updated import
import { FilterCondition, FilterTemplate, DEFAULT_FILTER, toNotionFilter } from './lib/utils';
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
    const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
    const [showFilterBuilder, setShowFilterBuilder] = useState(false);

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

        // If reset, start fresh. If not, use nextCursor.
        const cursor = reset ? undefined : (nextCursor || undefined);

        const result = await client.queryDatabase(notionFilter, 100, cursor);

        if (reset) {
            setAssets(result.assets);
        } else {
            setAssets(prev => [...prev, ...result.assets]); // Append
        }

        setNextCursor(result.nextCursor || null);
        setHasMore(result.hasMore);
        setIsSyncing(false);
    }, [notionConfig, appMode, activeFilter, visibleColumns, nextCursor, schemaTypes]);

    const handleSearch = useCallback(async (filter: FilterCondition) => {
        setIsSyncing(true);
        const client = new NotionClient(notionConfig);

        // Ensure schema types for filter conversion
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

        const notionFilter = toNotionFilter(filter, currentTypes);
        // Always reset pagination on new search
        const result = await client.queryDatabase(notionFilter, 100, undefined);

        setAssets(result.assets);
        setNextCursor(result.nextCursor || null);
        setHasMore(result.hasMore);
        setIsSyncing(false);
    }, [notionConfig, schemaTypes, visibleColumns]);

    const handleLoadMore = () => {
        if (!hasMore || isSyncing) return;
        handleSync(false); // Pass false to append
    };

    const handleAnalyze = async () => {
        setIsSyncing(true);
        const client = new NotionClient(notionConfig);

        // Ensure schema types for filter conversion
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

    // Trigger sync on mode change?
    useEffect(() => {
        if (appMode === 'DASHBOARD') {
            // Dashboard needs data? Maybe just load once?
            // If we have no assets, load initial batch?
            if (assets.length === 0) handleSync(true);
        } else if (appMode === 'OFFICE') {
            // For Office, User said: "Initial state empty... Load Data button".
            // So we DO NOT auto-load here unless maybe sticking coming from Dashboard?
            // If we change mode, we might want to keep existing data?
            // Let's NOT auto-load for OFFICE effectively implementing "Empty at first".
            // BUT if we applied a template, we WANT to load.
            if (activeTemplateId) {
                handleSync(true);
            }
        }
    }, [appMode]); // Removed handleSync from dependency to avoid loop, check if safe.

    // Load templates on mount
    useEffect(() => {
        const saved = localStorage.getItem('nexus_itam_templates');
        if (saved) {
            try {
                setTemplates(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to load templates", e);
            }
        }
    }, []);

    const saveTemplate = (name: string, filter: FilterCondition, columns: string[] = []) => {
        const newTemplate: FilterTemplate = {
            id: crypto.randomUUID(),
            name,
            filter,
            visibleColumns: columns
        };
        const updated = [...templates, newTemplate];
        setTemplates(updated);
        localStorage.setItem('nexus_itam_templates', JSON.stringify(updated));
    };

    const deleteTemplate = (id: string) => {
        const updated = templates.filter(t => t.id !== id);
        setTemplates(updated);
        localStorage.setItem('nexus_itam_templates', JSON.stringify(updated));
    };

    const applyTemplate = (t: FilterTemplate) => {
        setActiveFilter(t.filter);
        if (t.visibleColumns) setVisibleColumns(t.visibleColumns);
        setActiveTemplateId(t.id);
        handleSearch(t.filter);
    };

    const updateAssetField = async (id: string, field: string, value: string) => {
        // Optimistic update
        setAssets(prev => prev.map(a => a.id === id ? { ...a, values: { ...a.values, [field]: value } } : a));

        // API call
        const client = new NotionClient(notionConfig);
        await client.updatePage(id, { [field]: value }, schemaProperties[field]);
    };

    // ... NavItem ...

    // ... renderContent ... (Pass props)
    // In renderContent:
    /*
        <OfficeView 
            ... 
            hasMore={hasMore} 
            onLoadMore={handleLoadMore} 
        />
    */

    const renderContent = () => {
        switch (appMode) {
            case 'DASHBOARD':
                return <DashboardView assets={assets} onAnalyze={handleAnalyze} isAnalyzing={isSyncing} schema={schema} />;
            case 'FIELD':
                return <FieldView assets={assets} templates={templates} schema={schema} updateAssetField={updateAssetField} onExit={() => setAppMode('OFFICE')} />;
            case 'OFFICE':
            default:
                return (
                    <OfficeView
                        assets={assets}
                        schema={schema}
                        visibleColumns={visibleColumns}
                        schemaProperties={schemaProperties}
                        onUpdateAsset={updateAssetField}
                        onOpenFilter={() => setShowFilterBuilder(true)}
                        onSync={() => handleSync(true)} // Explicit refresh implies reset
                        onSearch={() => handleSearch(activeFilter)}
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
                    />
                );
        }
    }

    return (
        <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 font-sans">
            {appMode !== 'FIELD' && (
                <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-slate-300 p-4 border-r border-slate-800">
                    {/* Header */}
                    <div className="flex items-center gap-3 px-2 mb-8">
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">IT</div>
                        <h1 className="text-lg font-bold text-white tracking-tight">Nexus ITAM</h1>
                    </div>

                    <nav className="flex-1 space-y-6 overflow-y-auto">
                        <div className="space-y-1">
                            <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Main</p>
                            <NavItem icon={<LayoutDashboard size={20} />} label="Dashboard" active={appMode === 'DASHBOARD'} onClick={() => {
                                setAppMode('DASHBOARD');
                                setActiveFilter(DEFAULT_FILTER);
                                setActiveTemplateId(null);
                            }} />
                            <NavItem icon={<Package size={20} />} label="All Assets" active={appMode === 'OFFICE' && activeTemplateId === null} onClick={() => {
                                setAppMode('OFFICE');
                                setActiveFilter(DEFAULT_FILTER);
                                setActiveTemplateId(null);
                                // Empty screen initially for All Assets
                                setAssets([]);
                                setNextCursor(null);
                                setHasMore(false);
                            }} />
                        </div>

                        {/* Saved Views Section */}
                        <div className="space-y-1">
                            <div className="flex items-center justify-between px-3 mb-2 cursor-pointer hover:text-white transition-colors" onClick={() => setIsSavedViewsOpen(!isSavedViewsOpen)}>
                                <div className="flex items-center gap-2">
                                    <Database size={14} className={isSavedViewsOpen ? 'text-indigo-400' : 'text-slate-500'} />
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Saved Views</p>
                                </div>
                                <span className={`text-[10px] transition-transform ${isSavedViewsOpen ? 'rotate-90' : ''}`}>▶</span>
                            </div>

                            {isSavedViewsOpen && (
                                <div className="pl-2 space-y-1 border-l border-slate-800 ml-2 animate-in slide-in-from-left-2 duration-200">
                                    <div className="flex items-center justify-between px-2 mb-1">
                                        <span className="text-[10px] text-slate-600">Templates</span>
                                        <button onClick={() => setShowFilterBuilder(true)} className="text-slate-500 hover:text-white p-1 rounded-md hover:bg-slate-800"><Plus size={12} /></button>
                                    </div>
                                    {templates.map(t => (
                                        <div key={t.id} className="group flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-slate-800 transition-all cursor-pointer">
                                            <PlayCircle size={14} className={activeTemplateId === t.id ? 'text-indigo-400' : 'text-slate-600'} />
                                            <span
                                                className={`flex-1 truncate ${activeTemplateId === t.id ? 'text-white font-semibold' : 'text-slate-400'}`}
                                                onClick={() => applyTemplate(t)}
                                            >
                                                {t.name}
                                            </span>
                                            <button onClick={() => deleteTemplate(t.id)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400">
                                                <Trash2 size={12} />
                                            </button>
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
                            onClick={() => setAppMode('FIELD')}
                            className="flex items-center justify-center gap-3 w-full px-4 py-4 text-sm font-bold bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-600/20 active:scale-95"
                        >
                            <Smartphone size={18} /> Field Mode
                        </button>
                    </div>
                </aside>
            )}

            <main className="flex-1 flex flex-col h-screen overflow-hidden">
                {renderContent()}
            </main>

            {showFilterBuilder && (
                <FilterBuilderModal
                    schema={schema}
                    initialFilter={activeFilter}
                    initialVisibleColumns={visibleColumns} // Pass current view
                    onSave={(filter: any, columns: string[]) => {
                        setActiveFilter(filter);
                        setVisibleColumns(columns); // Apply changes
                        setShowFilterBuilder(false);
                        handleSearch(filter);
                    }}
                    onSaveAsTemplate={(name: string, filter: any, columns: string[]) => {
                        saveTemplate(name, filter, columns);
                        setActiveFilter(filter);
                        setVisibleColumns(columns);
                        setShowFilterBuilder(false);
                        handleSearch(filter);
                    }}
                    onClose={() => setShowFilterBuilder(false)}
                />
            )}
        </div>
    );
};

export default App;
