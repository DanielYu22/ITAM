import React, { useState, useEffect } from 'react';
import { RefreshCw, Filter, ExternalLink, Bug, ChevronDown, List } from 'lucide-react';
import { Asset, NotionProperty } from '../lib/notion';
import { MobileCardView } from './MobileCardView';
import EditableCell from './EditableCell';

// Hook to detect mobile
const useIsMobile = () => {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    return isMobile;
};

interface OfficeViewProps {
    assets: Asset[];
    schema: string[];
    visibleColumns?: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdateAsset: (id: string, field: string, value: string) => void;
    onOpenFilter: () => void;
    onSync: () => void;
    onSearch: () => void;
    isSyncing: boolean;
    activeTemplateName?: string;
    onClearFilter: () => void;
    hasMore: boolean;
    onLoadMore: () => void;
    onLoadAll: () => void;
}


export const OfficeView: React.FC<OfficeViewProps> = ({
    assets,
    schema,
    visibleColumns,
    schemaProperties,
    onUpdateAsset,
    onOpenFilter,

    onSearch,
    isSyncing,
    activeTemplateName,
    onClearFilter,
    hasMore,
    onLoadMore,
    onLoadAll
}) => {
    const isMobile = useIsMobile();
    const [viewMode, setViewMode] = useState<'table' | 'card'>('table');

    // Auto-switch to card view on mobile
    useEffect(() => {
        if (isMobile && assets.length > 0) {
            setViewMode('card');
        }
    }, [isMobile, assets.length]);

    // Reorder columns: Title first, then rest
    const displayColumns = React.useMemo(() => {
        let cols = visibleColumns && visibleColumns.length > 0 ? [...visibleColumns] : [...schema];

        // Find title property
        const titleCol = Object.keys(schemaProperties).find(key => schemaProperties[key].type === 'title');

        if (titleCol && cols.includes(titleCol)) {
            cols = cols.filter(c => c !== titleCol);
            cols.unshift(titleCol);
        }
        return cols;
    }, [visibleColumns, schema, schemaProperties]);

    // Helper to get sticky style
    const getStickyStyle = (col: string, index: number) => {
        const isTitle = schemaProperties[col]?.type === 'title';
        if (index === 0 && isTitle) {
            return "sticky left-0 z-20 bg-theme-secondary shadow-[4px_0_12px_-4px_rgba(0,0,0,0.1)] border-r border-theme-primary";
        }
        return "";
    };

    // Card view mode
    if (viewMode === 'card') {
        return (
            <div className="flex-1 flex flex-col overflow-hidden bg-theme-primary relative">
                {/* Header with toggle */}
                <header className="bg-theme-secondary border-b border-theme-primary px-4 py-4 flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-theme-primary">{activeTemplateName || "Assets"}</h2>
                        <p className="text-xs text-theme-tertiary">{assets.length} items</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setViewMode('table')}
                            className="p-2 text-theme-tertiary hover:text-indigo-500"
                            title="Table View"
                        >
                            <List size={20} />
                        </button>
                        <button
                            onClick={onOpenFilter}
                            className="p-2 text-theme-tertiary hover:text-indigo-500"
                        >
                            <Filter size={20} />
                        </button>
                        <button
                            onClick={onSearch}
                            disabled={isSyncing}
                            className="p-2 text-indigo-500"
                        >
                            <RefreshCw size={20} className={isSyncing ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </header>

                <MobileCardView
                    assets={assets}
                    schema={schema}
                    schemaProperties={schemaProperties}
                    onUpdateAsset={onUpdateAsset}
                    primaryFields={displayColumns.slice(0, 5)}
                />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-theme-primary">
            <header className="bg-theme-secondary border-b border-theme-primary px-8 py-8 flex flex-col lg:flex-row lg:items-center justify-between shrink-0 gap-6">
                <div>
                    <h2 className="text-3xl font-black text-theme-primary tracking-tight">{activeTemplateName || "Notion ITAM"}</h2>
                    <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-bold border border-emerald-500/20">
                            <div className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${isSyncing ? 'animate-ping' : ''}`}></div>
                            Dynamic Sync
                        </div>
                        <p className="text-xs text-theme-tertiary font-medium">
                            {isSyncing ? 'Fetching...' : `${assets.length} items`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={onSearch}
                        className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-600/20"
                    >
                        <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
                        {isSyncing ? 'Loading...' : 'Load Data'}
                    </button>
                    <button
                        onClick={onOpenFilter}
                        className="flex items-center gap-2 px-5 py-3 bg-theme-secondary border border-theme-primary text-theme-primary rounded-2xl text-sm font-bold hover:bg-theme-tertiary transition-all active:scale-95 shadow-sm"
                    >
                        <Filter size={18} /> Configure View
                    </button>
                    {(activeTemplateName || assets.length > 0) && (
                        <button onClick={onClearFilter} className="text-xs text-theme-tertiary hover:text-red-500 font-bold px-2 py-1 transition-colors">Clear</button>
                    )}
                </div>
            </header>

            <div className="flex-1 overflow-auto p-4 md:p-8">
                <div className="bg-theme-secondary border border-theme-primary rounded-[2.5rem] shadow-sm overflow-hidden h-full flex flex-col">
                    <div className="overflow-auto flex-1 relative">
                        <table className="w-full text-left border-collapse min-w-max">
                            <thead className="bg-theme-tertiary text-theme-tertiary text-[10px] font-black uppercase tracking-widest border-b border-theme-primary sticky top-0 z-30 backdrop-blur-md">
                                <tr>
                                    {displayColumns.map((col: string, idx: number) => (
                                        <th key={col} className={`px-8 py-6 bg-theme-tertiary ${getStickyStyle(col, idx)}`}>{col}</th>
                                    ))}
                                    <th className="px-8 py-6 text-right">Notion</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-theme-primary text-sm">
                                {assets.map((a: Asset) => (
                                    <tr key={a.id} className="hover:bg-indigo-500/10 transition-all group">
                                        {displayColumns.map((col: string, idx: number) => (
                                            <td key={col} className={`px-8 py-6 font-medium text-theme-primary ${getStickyStyle(col, idx) ? 'sticky left-0 z-10 bg-inherit' : ''} ${getStickyStyle(col, idx) && 'group-hover:bg-indigo-50/30 dark:group-hover:bg-indigo-900/20 transition-colors'}`}>
                                                <EditableCell
                                                    field={col}
                                                    value={a.values[col] || ''}
                                                    type={schemaProperties[col]?.type || 'text'}
                                                    property={schemaProperties[col]}
                                                    onSave={(val) => onUpdateAsset(a.id, col, val)}
                                                />
                                            </td>
                                        ))}
                                        <td className="px-8 py-6 text-right">
                                            <button
                                                onClick={() => window.open(a.url, '_blank')}
                                                className="p-2 bg-theme-tertiary rounded-lg text-theme-tertiary hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all"
                                            >
                                                <ExternalLink size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {assets.length === 0 && !isSyncing && (
                            <div className="py-32 flex flex-col items-center justify-center text-theme-tertiary">
                                <Bug size={64} strokeWidth={1} className="mb-4 opacity-20" />
                                <p className="text-lg font-bold text-theme-tertiary">No data found or filter not applied.</p>
                            </div>
                        )}
                    </div>
                </div>
                {hasMore && (
                    <div className="flex justify-center gap-4 mt-6 pb-8">
                        <button
                            onClick={onLoadMore}
                            disabled={isSyncing}
                            className="bg-theme-secondary border border-theme-primary text-theme-secondary font-bold py-3 px-8 rounded-2xl hover:bg-theme-tertiary hover:border-indigo-200 hover:text-indigo-600 transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : <ChevronDown size={16} />}
                            Load More (+100)
                        </button>
                        <button
                            onClick={onLoadAll}
                            disabled={isSyncing}
                            className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            Load All Assets
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
