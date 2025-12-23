
import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, Plus, Save, CheckSquare, Square, ChevronDown } from 'lucide-react'; // Added icons
import { FilterCondition, SortRule, SortDirection, FilterTemplate } from '../lib/utils'; // Added types

import { NotionProperty } from '../lib/notion';

interface FilterBuilderModalProps {
    schema: string[];
    schemaProperties?: Record<string, NotionProperty>;
    initialFilter: FilterCondition;
    initialSorts?: SortRule[]; // New prop
    initialVisibleColumns?: string[];
    activeTemplateId?: string | null; // For overwrite check
    onSave: (filter: FilterCondition, visibleColumns: string[], sorts: SortRule[]) => void;
    onSaveAsTemplate: (name: string, filter: FilterCondition, visibleColumns: string[], sorts: SortRule[]) => void;
    onUpdateTemplate?: (updates: Partial<FilterTemplate>) => void; // For overwrite
    onClose: () => void;
}

// Custom Dropdown Component for Notion-like feel
const Dropdown = ({ value, label, children, className = "" }: { value?: string, label: React.ReactNode, children: React.ReactNode, className?: string }) => {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [ref]);

    return (
        <div className={`relative ${className}`} ref={ref}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-between gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-50 min-w-[100px] w-full"
            >
                <div className="truncate">{label || value || "Select..."}</div>
                <ChevronDown size={12} className="text-slate-400" />
            </button>
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-full min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto p-1">
                    {React.Children.map(children, child => {
                        if (React.isValidElement(child)) {
                            return React.cloneElement(child, {
                                onClick: (...args: any[]) => {
                                    child.props.onClick?.(...args);
                                    if (!child.props['data-keep-open']) setIsOpen(false);
                                }
                            } as any);
                        }
                        return child;
                    })}
                </div>
            )}
        </div>
    );
};

const FilterRule = ({ condition, schema, schemaProperties, onUpdate, onRemove }: { condition: FilterCondition, schema: string[], schemaProperties?: Record<string, NotionProperty>, onUpdate: (c: Partial<FilterCondition>) => void, onRemove: () => void }) => {
    // Determine field type
    const fieldType = schemaProperties?.[condition.field || '']?.type || 'rich_text';
    const isSelect = fieldType === 'select' || fieldType === 'status';
    const isMultiSelect = fieldType === 'multi_select';
    const options = schemaProperties?.[condition.field || '']?.options || [];

    const getOperatorLabel = (op: string) => {
        switch (op) {
            case 'equals': return isSelect ? 'Is' : 'Equals';
            case 'not_equals': return isSelect ? 'Is not' : 'Not equals';
            case 'contains': return 'Contains';
            case 'does_not_contain': return 'Does not contain';
            case 'starts_with': return 'Starts with';
            case 'ends_with': return 'Ends with';
            case 'is_empty': return 'Is empty';
            case 'is_not_empty': return 'Is not empty';
            case 'is_in': return 'Is one of'; // Notion UI says "Is" for multi-value select but internally it's IN
            case 'is_not_in': return 'Is not one of'; // Notion UI says "Is not"
            default: return op;
        }
    }

    const validOperators = (() => {
        const common = ['is_empty', 'is_not_empty'];
        if (isSelect || isMultiSelect) return ['is_in', 'is_not_in', ...common, ...(isMultiSelect ? ['contains', 'does_not_contain'] : [])];
        // Text defaults
        return ['equals', 'not_equals', 'contains', 'does_not_contain', 'starts_with', 'ends_with', ...common];
    })();

    // Helper for multiselect values
    const selectedValues = condition.value?.split('|').filter(Boolean) || [];

    return (
        <div className="flex flex-col md:flex-row md:items-center gap-2 p-2 bg-white border border-slate-200 rounded-md hover:border-slate-300 transition-all shadow-sm">
            {/* Field Selector */}
            <div className="w-full md:w-1/3 min-w-[150px]">
                <Dropdown label={condition.field || "Select property"} value={condition.field}>
                    {schema.map(col => (
                        <div
                            key={col}
                            onClick={() => onUpdate({ field: col, value: '', operator: 'contains' })} // Default op
                            className="px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded cursor-pointer flex items-center gap-2"
                        >
                            {/* Icon based on type */}
                            <span className="text-[10px] uppercase font-bold text-slate-400 w-4">{schemaProperties?.[col]?.type?.[0] || 'T'}</span>
                            {col}
                        </div>
                    ))}
                </Dropdown>
            </div>

            {/* Operator Selector */}
            <div className="w-full md:w-1/4 min-w-[120px]">
                <Dropdown label={getOperatorLabel(condition.operator || 'contains')} value={condition.operator}>
                    {validOperators.map(op => (
                        <div
                            key={op}
                            onClick={() => onUpdate({ operator: op as any })}
                            className="px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                        >
                            {getOperatorLabel(op)}
                        </div>
                    ))}
                </Dropdown>
            </div>

            {/* Value Selector */}
            {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && (
                <div className="flex-1 w-full min-w-[150px]">
                    {(isSelect || isMultiSelect) ? (
                        <Dropdown
                            label={
                                selectedValues.length > 0
                                    ? <div className="flex gap-1 flex-wrap">
                                        {selectedValues.map(v => (
                                            <span key={v} className="px-1.5 bg-indigo-100 text-indigo-700 rounded text-[10px]">{v}</span>
                                        ))}
                                    </div>
                                    : "Select options..."
                            }
                        >
                            {options.map(opt => {
                                const isChecked = selectedValues.includes(opt.name);
                                return (
                                    <div
                                        key={opt.id}
                                        data-keep-open={true}
                                        onClick={() => {
                                            const newVals = isChecked
                                                ? selectedValues.filter(v => v !== opt.name)
                                                : [...selectedValues, opt.name];
                                            onUpdate({ value: newVals.join('|') });
                                        }}
                                        className="px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded cursor-pointer flex items-center gap-2"
                                    >
                                        {isChecked ? <CheckSquare size={14} className="text-indigo-600" /> : <Square size={14} className="text-slate-300" />}
                                        <span className={`px-2 py-0.5 rounded text-[10px] bg-${opt.color}-100`}>{opt.name}</span>
                                    </div>
                                );
                            })}
                        </Dropdown>
                    ) : (
                        <input
                            type="text"
                            value={condition.value}
                            onChange={(e) => onUpdate({ value: e.target.value })}
                            placeholder="Type a value..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-xs outline-none focus:border-indigo-400 transition-colors"
                        />
                    )}
                </div>
            )}

            <button onClick={onRemove} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"><Trash2 size={14} /></button>
        </div>
    );
};

const FilterGroup = ({ condition, schema, schemaProperties, onUpdate, onRemove, depth = 0 }: { condition: FilterCondition, schema: string[], schemaProperties?: Record<string, NotionProperty>, onUpdate: (c: Partial<FilterCondition>) => void, onRemove: () => void, depth?: number }) => {
    // Drag state
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);

    const updateChild = (id: string, updates: Partial<FilterCondition>) => {
        const newConditions = condition.conditions?.map(c => c.id === id ? { ...c, ...updates } : c);
        onUpdate({ conditions: newConditions });
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

    // Drag handlers
    const handleDragStart = (e: React.DragEvent, id: string) => {
        setDraggedId(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
    };

    const handleDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        if (draggedId && draggedId !== id) {
            setDragOverId(id);
        }
    };

    const handleDragLeave = () => {
        setDragOverId(null);
    };

    const handleDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        if (!draggedId || draggedId === targetId || !condition.conditions) return;

        const conditions = [...condition.conditions];
        const draggedIndex = conditions.findIndex(c => c.id === draggedId);
        const targetIndex = conditions.findIndex(c => c.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        // Remove dragged item and insert at target position
        const [draggedItem] = conditions.splice(draggedIndex, 1);
        conditions.splice(targetIndex, 0, draggedItem);

        onUpdate({ conditions });
        setDraggedId(null);
        setDragOverId(null);
    };

    const handleDragEnd = () => {
        setDraggedId(null);
        setDragOverId(null);
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
                {condition.conditions?.map((child) => (
                    <div
                        key={child.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, child.id)}
                        onDragOver={(e) => handleDragOver(e, child.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, child.id)}
                        onDragEnd={handleDragEnd}
                        className={`relative group transition-all ${draggedId === child.id ? 'opacity-50' : ''
                            } ${dragOverId === child.id ? 'ring-2 ring-indigo-400 ring-offset-2 rounded-lg' : ''
                            }`}
                    >
                        {/* Drag Handle */}
                        <div className="absolute -left-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="5" cy="5" r="2" />
                                <circle cx="12" cy="5" r="2" />
                                <circle cx="5" cy="12" r="2" />
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="5" cy="19" r="2" />
                                <circle cx="12" cy="19" r="2" />
                            </svg>
                        </div>

                        {/* Drop indicator line */}
                        {dragOverId === child.id && draggedId !== child.id && (
                            <div className="absolute -top-2 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
                        )}

                        {child.logic ? (
                            <FilterGroup
                                condition={child}
                                schema={schema}
                                schemaProperties={schemaProperties}
                                onUpdate={(u) => updateChild(child.id, u)}
                                onRemove={() => removeChild(child.id)}
                                depth={depth + 1}
                            />
                        ) : (
                            <FilterRule
                                condition={child}
                                schema={schema}
                                schemaProperties={schemaProperties}
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

// Sort Builder Component
const SortBuilder = ({ sorts, schema, onUpdate }: { sorts: SortRule[], schema: string[], onUpdate: (s: SortRule[]) => void }) => {
    return (
        <div className="space-y-3">
            {sorts.map((sort, idx) => (
                <div key={sort.id} className="flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-md">
                    <span className="text-xs text-slate-400 w-12 text-right font-medium">{idx === 0 ? "Sort by" : "Then by"}</span>
                    <div className="flex-1">
                        <select
                            value={sort.property}
                            onChange={(e) => {
                                const newSorts = [...sorts];
                                newSorts[idx].property = e.target.value;
                                onUpdate(newSorts);
                            }}
                            className="w-full bg-slate-50 border-0 rounded-md px-2 py-1.5 text-xs text-slate-700"
                        >
                            {schema.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div className="w-32">
                        <select
                            value={sort.direction}
                            onChange={(e) => {
                                const newSorts = [...sorts];
                                newSorts[idx].direction = e.target.value as SortDirection;
                                onUpdate(newSorts);
                            }}
                            className="w-full bg-slate-50 border-0 rounded-md px-2 py-1.5 text-xs text-slate-700"
                        >
                            <option value="ascending">Ascending</option>
                            <option value="descending">Descending</option>
                        </select>
                    </div>
                    <button
                        onClick={() => onUpdate(sorts.filter(s => s.id !== sort.id))}
                        className="p-1 text-slate-400 hover:text-red-500"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            ))}
            <button
                onClick={() => onUpdate([...sorts, { id: Date.now().toString(), property: schema[0], direction: 'ascending' }])}
                className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
            >
                <Plus size={14} /> Add sort
            </button>
        </div>
    );
};

export const FilterBuilderModal: React.FC<FilterBuilderModalProps> = ({ schema, schemaProperties, initialFilter, initialSorts = [], initialVisibleColumns, activeTemplateId, onSave, onSaveAsTemplate, onUpdateTemplate, onClose }) => {
    const [filter, setFilter] = useState<FilterCondition>(JSON.parse(JSON.stringify(initialFilter)));
    const [sorts, setSorts] = useState<SortRule[]>(initialSorts);
    const [visibleCols, setVisibleCols] = useState<string[]>(initialVisibleColumns && initialVisibleColumns.length > 0 ? initialVisibleColumns : schema);
    const [templateName, setTemplateName] = useState("");
    const [activeTab, setActiveTab] = useState<'filter' | 'sort' | 'view'>('filter'); // Added Sort tab

    // Find Title Column
    const titleColumn = Object.keys(schemaProperties || {}).find(k => schemaProperties?.[k].type === 'title') || '';

    // Enforce Title Visibility
    useEffect(() => {
        if (titleColumn && !visibleCols.includes(titleColumn)) {
            setVisibleCols(prev => [titleColumn, ...prev]);
        }
    }, [visibleCols, titleColumn]);

    // Ensure root logic exists
    if (!filter.logic) {
        filter.logic = 'AND';
        filter.conditions = [];
    }

    const handleRootUpdate = (updates: Partial<FilterCondition>) => {
        const newFilter = { ...filter, ...updates };
        setFilter(newFilter);

        // Auto-select columns used in filter
        const usedFields = getUsedFields(newFilter);
        const newCols = [...new Set([...visibleCols, ...usedFields])];
        if (newCols.length !== visibleCols.length) {
            setVisibleCols(newCols);
        }
    };

    const getUsedFields = (f: FilterCondition): string[] => {
        let fields: string[] = [];
        if (f.field) fields.push(f.field);
        if (f.conditions) {
            f.conditions.forEach(c => fields = [...fields, ...getUsedFields(c)]);
        }
        return fields;
    };

    const toggleColumn = (col: string) => {
        if (col === titleColumn) return; // Cannot toggle title
        if (visibleCols.includes(col)) {
            setVisibleCols(visibleCols.filter(c => c !== col));
        } else {
            setVisibleCols([...visibleCols, col]);
        }
    };

    const toggleAll = () => {
        if (visibleCols.length === schema.length) {
            // Keep title
            setVisibleCols(titleColumn ? [titleColumn] : []);
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
                    <button onClick={() => setActiveTab('sort')} className={`flex-1 py-4 text-sm font-bold border-b-2 transition-all ${activeTab === 'sort' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                        Sort ({sorts.length})
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
                                {schema.map(col => {
                                    const isTitle = col === titleColumn;
                                    const isSelected = visibleCols.includes(col);
                                    return (
                                        <div
                                            key={col}
                                            onClick={() => toggleColumn(col)}
                                            className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'} ${isTitle ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                        >
                                            {isSelected ? <CheckSquare size={18} className="text-indigo-600" /> : <Square size={18} className="text-slate-300" />}
                                            <span className="text-xs font-bold truncate">{col} {isTitle && '(Required)'}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : activeTab === 'filter' ? (
                        <div className="space-y-6">
                            <div className="bg-slate-50/50 p-6 rounded-3xl border border-slate-100">
                                <FilterGroup
                                    condition={filter}
                                    schema={schema}
                                    schemaProperties={schemaProperties}
                                    onUpdate={handleRootUpdate}
                                    onRemove={() => { }} // Root cannot be removed
                                    depth={0}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="bg-slate-50/50 p-6 rounded-3xl border border-slate-100">
                                <SortBuilder sorts={sorts} schema={schema} onUpdate={setSorts} />
                            </div>
                        </div>
                    )}

                    <div className="pt-6 border-t border-slate-100 mt-6">
                        <div className="flex gap-3">
                            {activeTemplateId && onUpdateTemplate ? (
                                <button
                                    onClick={() => onUpdateTemplate({ filter, visibleColumns: visibleCols, sorts })}
                                    className="flex-1 px-5 py-3.5 bg-indigo-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 shadow-lg"
                                >
                                    Overwrite Current View
                                </button>
                            ) : null}
                            <input
                                type="text"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                placeholder="Save as new template..."
                                className="flex-1 px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                                onClick={() => templateName && onSaveAsTemplate(templateName, filter, visibleCols, sorts)}
                                className="px-6 py-3.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50 active:scale-95 transition-all shadow-lg"
                            >
                                <Save size={18} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-6 md:p-8 bg-slate-50 flex gap-4 shrink-0">
                    <button onClick={() => onSave(filter, visibleCols, sorts)} className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-600/20 text-sm md:text-base active:scale-95">Apply View & Filter</button>
                    <button onClick={onClose} className="px-6 md:px-8 py-4 text-slate-500 font-bold hover:text-slate-700 text-sm md:text-base">Cancel</button>
                </div>
            </div>
        </div>
    );
};
