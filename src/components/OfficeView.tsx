import React, { useState, useEffect } from 'react';
import { RefreshCw, Filter, ExternalLink, Bug, ChevronDown } from 'lucide-react';
import { Asset, NotionProperty } from '../lib/notion';

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
}

const EditableCell = ({ value, type, property, onSave }: { field: string, value: string, type: string, property?: NotionProperty, onSave: (val: string) => void }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [tempValue, setTempValue] = useState(value);

    // Sync tempValue if parent value changes (optimistic updates from elsewhere)
    useEffect(() => {
        setTempValue(value);
    }, [value]);

    const handleSave = () => {
        if (tempValue !== value) {
            onSave(tempValue);
        }
        setIsEditing(false);
    };

    if (isEditing) {
        if (type === 'select' || type === 'status') {
            return (
                <select
                    autoFocus
                    value={tempValue}
                    onChange={(e) => {
                        // Auto save on change for select for better UX
                        setTempValue(e.target.value);
                        if (e.target.value !== value) onSave(e.target.value);
                        setIsEditing(false);
                    }}
                    onBlur={() => setIsEditing(false)}
                    className="w-full bg-indigo-50 border border-indigo-200 rounded px-2 py-1 text-sm font-medium outline-none text-indigo-900"
                >
                    <option value="">(Empty)</option>
                    {property?.options?.map(opt => (
                        <option key={opt.id} value={opt.name}>{opt.name}</option>
                    ))}
                </select>
            );
        }

        return (
            <input
                autoFocus
                type="text"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                className="w-full bg-white border border-indigo-500 rounded px-2 py-1 text-sm font-medium outline-none shadow-lg z-10"
            />
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className="cursor-pointer hover:bg-slate-100 px-2 -mx-2 rounded py-1 transition-colors min-h-[1.5rem]"
            title="Click to edit"
        >
            {value || <span className="text-slate-300 text-xs italic">Empty</span>}
        </div>
    );
};

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
    onLoadMore
}) => {
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
        // Or if we just strictly want the FIRST column to be sticky regardless of what it is?
        // User asked "Title property column... basic criteria... always fixed on left".
        // With our reordering above, displayColumns[0] IS the title (if visible).
        if (index === 0 && isTitle) {
            return "sticky left-0 z-20 bg-white shadow-[4px_0_12px_-4px_rgba(0,0,0,0.1)] border-r border-slate-100";
        }
        return "";
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <header className="bg-white border-b border-slate-200 px-8 py-8 flex flex-col lg:flex-row lg:items-center justify-between shrink-0 gap-6">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">{activeTemplateName || "Notion ITAM"}</h2>
                    <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold border border-emerald-100">
                            <div className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${isSyncing ? 'animate-ping' : ''}`}></div>
                            Dynamic Sync
                        </div>
                        <p className="text-xs text-slate-400 font-medium">
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
                        className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all active:scale-95 shadow-sm"
                    >
                        <Filter size={18} /> Configure View
                    </button>
                    {(activeTemplateName || assets.length > 0) && (
                        <button onClick={onClearFilter} className="text-xs text-slate-400 hover:text-red-500 font-bold px-2 py-1 transition-colors">Clear</button>
                    )}
                </div>
            </header>

            <div className="flex-1 overflow-auto p-4 md:p-8">
                <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden h-full flex flex-col">
                    <div className="overflow-auto flex-1 relative">
                        <table className="w-full text-left border-collapse min-w-max">
                            <thead className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100 sticky top-0 z-30 backdrop-blur-md">
                                <tr>
                                    {displayColumns.map((col: string, idx: number) => (
                                        <th key={col} className={`px-8 py-6 bg-slate-50/90 ${getStickyStyle(col, idx)}`}>{col}</th>
                                    ))}
                                    <th className="px-8 py-6 text-right">Notion</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 text-sm">
                                {assets.map((a: Asset) => (
                                    <tr key={a.id} className="hover:bg-indigo-50/30 transition-all group">
                                        {displayColumns.map((col: string, idx: number) => (
                                            <td key={col} className={`px-8 py-6 font-medium text-slate-700 ${getStickyStyle(col, idx) ? 'sticky left-0 z-10 bg-inherit' : ''} ${getStickyStyle(col, idx) && 'group-hover:bg-indigo-50/30 transition-colors'}`}>
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
                                                className="p-2 bg-slate-50 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                                            >
                                                <ExternalLink size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {assets.length === 0 && !isSyncing && (
                            <div className="py-32 flex flex-col items-center justify-center text-slate-300">
                                <Bug size={64} strokeWidth={1} className="mb-4 opacity-20" />
                                <p className="text-lg font-bold text-slate-400">No data found or filter not applied.</p>
                            </div>
                        )}
                    </div>
                </div>
                {hasMore && (
                    <div className="flex justify-center mt-6 pb-8">
                        <button
                            onClick={onLoadMore}
                            disabled={isSyncing}
                            className="bg-white border border-slate-200 text-slate-600 font-bold py-3 px-8 rounded-2xl hover:bg-slate-50 hover:border-indigo-200 hover:text-indigo-600 transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : <ChevronDown size={16} />}
                            Load More Assets
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
