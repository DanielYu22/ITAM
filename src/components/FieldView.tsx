import React, { useState, useMemo, useEffect } from 'react';
import { Asset, NotionProperty } from '../lib/notion';
import { FilterTemplate, FilterCondition } from '../lib/utils';
import { ChevronLeft, ArrowRight, Settings, Square, Box } from 'lucide-react';
import { FieldModeConfig, HierarchyConfig } from './FieldModeConfig';
import EditableCell from './EditableCell';

interface FieldViewProps {
    assets: Asset[];
    templates: FilterTemplate[];
    schema: string[]; // List of column names
    schemaProperties: Record<string, NotionProperty>; // For identifying types
    activeFilter?: FilterCondition; // For filtering relevant fields
    updateAssetField: (id: string, field: string, value: string) => void;
    onExit: () => void;
}

export const FieldView: React.FC<FieldViewProps> = ({ assets, schema, schemaProperties, activeFilter, updateAssetField, onExit }) => {
    // Steps: 0 = Config (if not set), 1 = Level A, 2 = Level B, 3 = Level C, 4 = List
    const [step, setStep] = useState<number>(0);
    const [config, setConfig] = useState<HierarchyConfig | null>(null);
    const [selections, setSelections] = useState<{ A: string, B: string, C: string }>({ A: '', B: '', C: '' });
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null); // For details modal

    // Load config from local storage
    useEffect(() => {
        const saved = localStorage.getItem('nexus_itam_field_config');
        if (saved) {
            setConfig(JSON.parse(saved));
            setStep(1); // Skip config if saved
        }
    }, []);

    const handleSaveConfig = (newConfig: HierarchyConfig) => {
        setConfig(newConfig);
        localStorage.setItem('nexus_itam_field_config', JSON.stringify(newConfig));
        setStep(1);
    };

    const handleSelection = (level: 'A' | 'B' | 'C', value: string) => {
        setSelections(prev => ({ ...prev, [level]: value }));
        setStep(prev => prev + 1);
    };

    const handleBack = () => {
        if (step === 1) {
            onExit();
        } else {
            setStep(prev => prev - 1);
            if (step === 2) setSelections(prev => ({ ...prev, A: '' }));
        }
    };

    // Helper: Find Title Column
    const titleColumn = useMemo(() => {
        return Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title') || 'Name';
    }, [schemaProperties]);

    // Helper: Extract relevant fields from filter
    const relevantFields = useMemo(() => {
        const fields = new Set<string>();
        const extract = (c: FilterCondition) => {
            if (c.field) fields.add(c.field);
            if (c.conditions) c.conditions.forEach(extract);
        };
        if (activeFilter) extract(activeFilter);

        // If no fields found (e.g. empty filter), show all? Or generic set?
        // User said: "only target variables required by filter"
        // If empty, let's show all for safety, but if filter exists, restrict.
        const list = Array.from(fields);
        // Force include status column if we can guess it
        // list.push('Status'); 
        return list;
    }, [activeFilter]);

    // Filter assets based on current selections
    const currentOptions = useMemo(() => {
        if (!config) return [];
        let filtered = assets;

        if (step >= 2) {
            filtered = filtered.filter(a => (a.values[config.levelA] || '') === selections.A);
        }
        if (step >= 3) {
            filtered = filtered.filter(a => (a.values[config.levelB] || '') === selections.B);
        }

        const targetColumn = step === 1 ? config.levelA : (step === 2 ? config.levelB : config.levelC);

        // Get unique values
        const values = Array.from(new Set(filtered.map(a => a.values[targetColumn] || 'Unknown')));
        return values.sort();
    }, [assets, config, step, selections]);

    // Final list of assets in the room (Step 4)
    const roomAssets = useMemo(() => {
        if (!config || step !== 4) return [];
        return assets.filter(a =>
            (a.values[config.levelA] || '') === selections.A &&
            (a.values[config.levelB] || '') === selections.B &&
            (a.values[config.levelC] || '') === selections.C
        );
    }, [assets, config, step, selections]);

    const isCompleted = (asset: Asset) => {
        const status = Object.values(asset.values).find(v => v === 'Done' || v === 'Verified' || v === '완료');
        return !!status;
    };

    const activeAssets = roomAssets.filter(a => !isCompleted(a));
    const completedAssets = roomAssets.filter(a => isCompleted(a));

    // Render Steps
    if (!config || step === 0) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col">
                <header className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
                    <button onClick={onExit} className="flex items-center gap-2 text-slate-500 font-bold"><ChevronLeft /> Exit</button>
                    <span className="font-bold text-slate-800">Field Mode Setup</span>
                    <div className="w-10"></div>
                </header>
                <div className="flex-1 p-6">
                    <FieldModeConfig schema={schema} onSave={handleSaveConfig} currentConfig={config || undefined} />
                </div>
            </div>
        );
    }

    // Navigation Lists (Step 1-3)
    if (step < 4) {
        const title = step === 1 ? `Select ${config.levelA}` : (step === 2 ? `Select ${config.levelB}` : `Select ${config.levelC}`);
        const subtitle = step === 1 ? 'Start your patrol' : (step === 2 ? `Inside ${selections.A}` : `Inside ${selections.A} > ${selections.B}`);

        return (
            <div className="min-h-screen bg-slate-50 flex flex-col">
                <header className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
                    <button onClick={handleBack} className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full"><ChevronLeft /></button>
                    <div className="text-center">
                        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
                        <p className="text-xs text-slate-400">{subtitle}</p>
                    </div>
                    <button onClick={() => setStep(0)} className="p-2 -mr-2 text-slate-400 hover:text-slate-600"><Settings size={20} /></button>
                </header>

                <div className="flex-1 p-4 grid grid-cols-1 gap-3 overflow-auto">
                    {currentOptions.map(opt => (
                        <button
                            key={opt}
                            onClick={() => handleSelection(step === 1 ? 'A' : (step === 2 ? 'B' : 'C'), opt)}
                            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 text-left hover:bg-indigo-50 hover:border-indigo-200 transition-all group active:scale-95"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-lg font-bold text-slate-700 group-hover:text-indigo-700">{opt}</span>
                                <ArrowRight className="text-slate-300 group-hover:text-indigo-400" />
                            </div>
                        </button>
                    ))}
                    {currentOptions.length === 0 && (
                        <div className="text-center py-20 text-slate-400">
                            <Box size={48} className="mx-auto mb-4 opacity-20" />
                            <p>No options found.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Step 4: Asset List in Room
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="px-6 py-4 bg-indigo-600 text-white flex items-center justify-between sticky top-0 z-20 shadow-lg">
                <button onClick={handleBack} className="p-2 -ml-2 hover:bg-white/10 rounded-full"><ChevronLeft /></button>
                <div className="text-center">
                    <h1 className="text-lg font-bold">{selections.C}</h1>
                    <p className="text-xs text-indigo-200">{selections.A} &gt; {selections.B}</p>
                </div>
                <div className="w-10 text-right font-mono font-bold text-indigo-200">{activeAssets.length}</div>
            </header>

            <div className="flex-1 p-4 overflow-auto space-y-3">
                {activeAssets.length === 0 && (
                    <div className="py-20 flex flex-col items-center justify-center text-slate-400 bg-white rounded-3xl border border-dashed border-slate-200 m-4">
                        <Box size={64} className="text-emerald-100 mb-4" />
                        <h3 className="text-xl font-bold text-slate-700">All Clear!</h3>
                        <p>No pending assets in this room.</p>
                        <button onClick={handleBack} className="mt-6 px-6 py-3 bg-indigo-100 text-indigo-600 font-bold rounded-xl">
                            Next Room
                        </button>
                    </div>
                )}

                {activeAssets.map(asset => (
                    <div
                        key={asset.id}
                        onClick={() => setSelectedAsset(asset)}
                        className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between active:scale-95 transition-transform"
                    >
                        <div>
                            <p className="text-xs font-bold text-indigo-500 mb-1">{asset.id.slice(0, 5)}..</p>
                            <h3 className="text-base font-bold text-slate-800 line-clamp-1">
                                {asset.values[titleColumn] || 'No Name'}
                            </h3>
                            <p className="text-xs text-slate-400 mt-1">
                                {schema.find(k => k.includes('Serial')) ? asset.values[schema.find(k => k.includes('Serial'))!] : ''}
                            </p>
                        </div>
                        <Square className="text-slate-300" />
                    </div>
                ))}

                {completedAssets.length > 0 && (
                    <div className="mt-8 pt-8 border-t border-slate-200 opacity-50">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 px-2">Completed</h4>
                        <div className="space-y-2">
                            {completedAssets.map(asset => (
                                <div key={asset.id} className="bg-slate-50 p-4 rounded-xl flex items-center justify-between border border-emerald-100">
                                    <span className="text-sm text-slate-500 line-through decoration-emerald-500/50">{asset.values[titleColumn] || 'Asset'}</span>
                                    <Box size={16} className="text-emerald-500" />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Config Reset at bottom */}
            <div className="p-4 flex justify-center pb-8 safe-area-bottom">
                <button onClick={() => setStep(0)} className="text-xs text-indigo-400 font-bold bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                    Change Hierarchy
                </button>
            </div>

            {/* Detail Modal */}
            {selectedAsset && (
                <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                            <div>
                                <h2 className="text-2xl font-black text-slate-900 leading-tight mb-2">
                                    {selectedAsset.values[titleColumn] || 'Asset Details'}
                                </h2>
                                <p className="font-mono text-sm text-indigo-600 bg-indigo-50 px-2 py-1 rounded inline-block">
                                    {selectedAsset.id.slice(0, 8)}
                                </p>
                            </div>
                            <button onClick={() => setSelectedAsset(null)} className="p-2 bg-slate-200 rounded-full text-slate-500">
                                <ChevronLeft className="-rotate-90 sm:rotate-0" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            {/* Render Relevant Fields from Filter as Editable */}
                            {relevantFields.length > 0 && (
                                <div className="mb-4">
                                    <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">Mission Targets (Edit to Complete)</div>
                                    {relevantFields.map(key => (
                                        <div key={key} className="mb-3">
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">{key}</label>
                                            <div className="bg-white p-1 rounded-xl border border-indigo-100 shadow-sm focus-within:ring-2 ring-indigo-500 transition-all">
                                                <EditableCell
                                                    field={key}
                                                    value={selectedAsset.values[key] || ''}
                                                    type={schemaProperties[key]?.type || 'text'}
                                                    property={schemaProperties[key]}
                                                    onSave={(val) => updateAssetField(selectedAsset.id, key, val)}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Show other fields? Or just Filter fields? User said "only target variables".
                                Let's show Title and maybe Serial if not in filter.
                                And hide everything else.
                            */}
                            {/* If no filter fields, maybe show all? */}
                            {relevantFields.length === 0 && Object.entries(selectedAsset.values).map(([key, val]) => (
                                <div key={key}>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">{key}</label>
                                    <p className="text-slate-800 font-medium text-sm bg-slate-50 p-3 rounded-xl border border-slate-100">
                                        {val || <span className="text-slate-300 italic">Empty</span>}
                                    </p>
                                </div>
                            ))}
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-white safe-area-bottom">
                            <button
                                onClick={() => setSelectedAsset(null)}
                                className="w-full py-4 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-lg rounded-2xl shadow-xl flex items-center justify-center gap-2 transition-all"
                            >
                                <ChevronLeft size={20} />
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
