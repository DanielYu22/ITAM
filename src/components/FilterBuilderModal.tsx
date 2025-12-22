
import React, { useState, useEffect } from 'react';
import { X, Trash2, Plus, Save, Eye, EyeOff, CheckSquare, Square } from 'lucide-react';
import { FilterCondition } from '../lib/utils';

interface FilterBuilderModalProps {
    schema: string[];
    initialFilter: FilterCondition;
    initialVisibleColumns?: string[];
    onSave: (filter: FilterCondition, visibleColumns: string[]) => void;
    onSaveAsTemplate: (name: string, filter: FilterCondition, visibleColumns: string[]) => void;
    onClose: () => void;
}

const FilterRule = ({ condition, schema, onUpdate, onRemove }: { condition: FilterCondition, schema: string[], onUpdate: (c: Partial<FilterCondition>) => void, onRemove: () => void }) => {
    return (
        <div className="flex flex-col md:flex-row md:items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl group hover:border-indigo-300 transition-all shadow-sm">
            <div className="flex gap-2 flex-1">
                <select
                    value={condition.field}
                    onChange={(e) => onUpdate({ field: e.target.value })}
                    className="bg-slate-50 border-0 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-100 cursor-pointer text-slate-700"
                >
                    {schema.map((col: string) => (
                        <option key={col} value={col}>{col}</option>
                    ))}
                </select>
                <select
                    value={condition.operator}
                    onChange={(e) => onUpdate({ operator: e.target.value as any })}
                    className="bg-slate-50 border-0 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-100 cursor-pointer text-slate-600"
                >
                    <option value="contains">Contains</option>
                    <option value="equals">Equals</option>
                    <option value="not_equals">Not Equals</option>
                    <option value="is_empty">Is Empty</option>
                    <option value="is_not_empty">Is Not Empty</option>
                </select>
            </div>
            {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && (
                <input
                    type="text"
                    value={condition.value}
                    onChange={(e) => onUpdate({ value: e.target.value })}
                    placeholder="Value..."
                    className="flex-1 bg-slate-50 border-0 rounded-lg px-3 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-100 min-w-[100px] text-slate-800 placeholder:text-slate-300"
                />
            )}
            <button onClick={onRemove} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={14} /></button>
        </div>
    );
};

const FilterGroup = ({ condition, schema, onUpdate, onRemove, depth = 0 }: { condition: FilterCondition, schema: string[], onUpdate: (c: Partial<FilterCondition>) => void, onRemove: () => void, depth?: number }) => {

    const updateChild = (id: string, updates: Partial<FilterCondition>) => {
        const newConditions = condition.conditions?.map(c => c.id === id ? { ...c, ...updates } : c);
        onUpdate({ conditions: newConditions });
    };

    const updateNestedChild = (childId: string, updates: Partial<FilterCondition>) => {
        // Only needed if we didn't pass specific update handlers down. 
        // Actually, we pass `onUpdate` which calls `updateChild` of parent.
        // So the recursion happens via the component tree props.
        // THIS IS WRONG. The recursive update in state at top level handles everything.
        // But wait, it's cleaner to let each Group manage its children? 
        // No, simpler to have one big state update function at top and pass it down?
        // Let's use the monolithic update from top for consistency.
        // Actually, local update is easier for UI recursion.
        // Let's use the provided `onUpdate` which updates THIS condition in the parent's array.
        // So to update a child, we modify `condition.conditions` and call `onUpdate`.
        const recUpdate = (list: FilterCondition[], targetId: string, ups: Partial<FilterCondition>): FilterCondition[] => {
            return list.map(c => {
                if (c.id === targetId) return { ...c, ...ups };
                if (c.conditions) return { ...c, conditions: recUpdate(c.conditions, targetId, ups) };
                return c;
            })
        };
        const newConds = recUpdate(condition.conditions || [], childId, updates);
        onUpdate({ conditions: newConds });
    };

    const addChildRule = () => {
        const newRule: FilterCondition = { id: Date.now().toString() + Math.random(), field: schema[0], operator: 'contains', value: '' };
        onUpdate({ conditions: [...(condition.conditions || []), newRule] });
    };

    const addChildGroup = () => {
        const newGroup: FilterCondition = { id: Date.now().toString() + Math.random(), logic: 'AND', conditions: [{ id: Date.now().toString() + Math.random() + '1', field: schema[0], operator: 'contains', value: '' }] };
        onUpdate({ conditions: [...(condition.conditions || []), newGroup] });
    };

    const removeChild = (id: string) => {
        onUpdate({ conditions: condition.conditions?.filter(c => c.id !== id) });
    };

    return (
        <div className={`flex flex-col gap-3 ${depth > 0 ? 'ml-6 pl-4 border-l-2 border-slate-100 relative' : ''}`}>
            {depth > 0 && <div className="absolute top-4 -left-[2px] w-2 h-2 bg-slate-200 rounded-full" />}

            <div className="flex items-center gap-3">
                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0">
                    <button
                        onClick={() => onUpdate({ logic: 'AND' })}
                        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${condition.logic === 'AND' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >AND</button>
                    <button
                        onClick={() => onUpdate({ logic: 'OR' })}
                        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${condition.logic === 'OR' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >OR</button>
                </div>
                {depth > 0 && (
                    <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-500 font-bold px-2">Delete Group</button>
                )}
            </div>

            <div className="space-y-3">
                {condition.conditions?.map(child => (
                    <div key={child.id}>
                        {child.logic ? (
                            <FilterGroup
                                condition={child}
                                schema={schema}
                                onUpdate={(u) => updateChild(child.id, u)}
                                onRemove={() => removeChild(child.id)}
                                depth={depth + 1}
                            />
                        ) : (
                            <FilterRule
                                condition={child}
                                schema={schema}
                                onUpdate={(u) => updateChild(child.id, u)}
                                onRemove={() => removeChild(child.id)}
                            />
                        )}
                    </div>
                ))}
            </div>

            <div className="flex gap-2 mt-1">
                <button onClick={addChildRule} className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 flex items-center gap-1 bg-slate-50 px-3 py-2 rounded-lg hover:bg-indigo-50 transition-all border border-transparent hover:border-indigo-100">
                    <Plus size={12} /> Add rule
                </button>
                <button onClick={addChildGroup} className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 flex items-center gap-1 bg-slate-50 px-3 py-2 rounded-lg hover:bg-indigo-50 transition-all border border-transparent hover:border-indigo-100">
                    <Plus size={12} /> Add group
                </button>
            </div>
        </div>
    );
};

export const FilterBuilderModal: React.FC<FilterBuilderModalProps> = ({ schema, initialFilter, initialVisibleColumns, onSave, onSaveAsTemplate, onClose }) => {
    const [filter, setFilter] = useState<FilterCondition>(JSON.parse(JSON.stringify(initialFilter)));
    const [visibleCols, setVisibleCols] = useState<string[]>(initialVisibleColumns && initialVisibleColumns.length > 0 ? initialVisibleColumns : schema);
    const [templateName, setTemplateName] = useState("");
    const [activeTab, setActiveTab] = useState<'filter' | 'view'>('view');

    // Ensure root logic exists
    if (!filter.logic) {
        filter.logic = 'AND';
        filter.conditions = [];
    }

    const handleRootUpdate = (updates: Partial<FilterCondition>) => {
        setFilter({ ...filter, ...updates });
    };

    // ... toggleColumn, toggleAll ... (Keep these)
    const toggleColumn = (col: string) => {
        if (visibleCols.includes(col)) {
            setVisibleCols(visibleCols.filter(c => c !== col));
        } else {
            setVisibleCols([...visibleCols, col]);
        }
    };

    const toggleAll = () => {
        if (visibleCols.length === schema.length) {
            setVisibleCols([]);
        } else {
            setVisibleCols(schema);
        }
    };

    return (
        <div className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 md:p-6 overflow-y-auto">
            <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200 my-auto flex flex-col max-h-[90vh]">
                <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-xl md:text-2xl font-bold text-slate-900">View Builder</h2>
                        <p className="text-xs md:text-sm text-slate-500">Advanced Filtering & Columns</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"><X size={20} /></button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-100 shrink-0">
                    <button onClick={() => setActiveTab('view')} className={`flex-1 py-4 text-sm font-bold border-b-2 transition-all ${activeTab === 'view' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                        Columns ({visibleCols.length})
                    </button>
                    <button onClick={() => setActiveTab('filter')} className={`flex-1 py-4 text-sm font-bold border-b-2 transition-all ${activeTab === 'filter' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                        Advanced Filter
                    </button>
                </div>

                <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-white">
                    {activeTab === 'view' ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Available Columns</span>
                                <button onClick={toggleAll} className="text-xs font-bold text-indigo-600 hover:underline">
                                    {visibleCols.length === schema.length ? 'Deselect All' : 'Select All'}
                                </button>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {schema.map(col => (
                                    <div key={col} onClick={() => toggleColumn(col)} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${visibleCols.includes(col) ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'}`}>
                                        {visibleCols.includes(col) ? <CheckSquare size={18} className="text-indigo-600" /> : <Square size={18} className="text-slate-300" />}
                                        <span className="text-xs font-bold truncate">{col}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="bg-slate-50/50 p-6 rounded-3xl border border-slate-100">
                                <FilterGroup
                                    condition={filter}
                                    schema={schema}
                                    onUpdate={handleRootUpdate}
                                    onRemove={() => { }} // Root cannot be removed
                                    depth={0}
                                />
                            </div>
                        </div>
                    )}

                    <div className="pt-6 border-t border-slate-100 mt-6">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">Save View As Template</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="e.g. Broken Assets View"
                                value={templateName}
                                onChange={e => setTemplateName(e.target.value)}
                                className="flex-1 px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                                onClick={() => templateName && onSaveAsTemplate(templateName, filter, visibleCols)}
                                className="px-6 py-3.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50 active:scale-95 transition-all shadow-lg"
                            >
                                <Save size={18} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-6 md:p-8 bg-slate-50 flex gap-4 shrink-0">
                    <button onClick={() => onSave(filter, visibleCols)} className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-600/20 text-sm md:text-base active:scale-95">Apply View & Filter</button>
                    <button onClick={onClose} className="px-6 md:px-8 py-4 text-slate-500 font-bold hover:text-slate-700 text-sm md:text-base">Cancel</button>
                </div>
            </div>
        </div>
    );
};
