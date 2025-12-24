
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Trash2, Plus, Save, CheckSquare, Square, ChevronDown } from 'lucide-react'; // Added icons
import { FilterCondition, SortRule, SortDirection, FilterTemplate } from '../lib/utils'; // Added types

import { NotionProperty, Asset } from '../lib/notion';

interface FilterBuilderModalProps {
    schema: string[];
    schemaProperties?: Record<string, NotionProperty>;
    initialFilter: FilterCondition;
    initialSorts?: SortRule[]; // New prop
    initialVisibleColumns?: string[];
    activeTemplateId?: string | null; // For overwrite check
    assets?: Asset[]; // For calculating filter match counts
    onLoadAllAssets?: () => Promise<Asset[]>; // Callback to load all assets for accurate count
    onSave: (filter: FilterCondition, visibleColumns: string[], sorts: SortRule[]) => void;
    onSaveAsTemplate: (name: string, filter: FilterCondition, visibleColumns: string[], sorts: SortRule[]) => void;
    onUpdateTemplate?: (updates: Partial<FilterTemplate>) => void; // For overwrite
    onClose: () => void;
}

// Helper: Evaluate if a single asset matches a filter condition
const evaluateFilter = (asset: Asset, filter: FilterCondition): boolean => {
    if (!filter) return true;

    // Group condition
    if (filter.conditions && filter.conditions.length > 0) {
        const results = filter.conditions.map(c => evaluateFilter(asset, c));
        return filter.logic === 'AND'
            ? results.every(r => r)
            : results.some(r => r);
    }

    // Single condition
    if (!filter.field) return true;

    const value = asset.values[filter.field] || '';
    const filterValue = filter.value || '';
    const valueLower = value.toLowerCase();
    const filterLower = filterValue.toLowerCase();

    switch (filter.operator) {
        // Text/Select: is, is not
        case 'equals': return valueLower === filterLower;
        case 'does_not_equal': return valueLower !== filterLower;

        // Multi-select: contains = OR logic (any of selected values matches, empty NOT included)
        case 'contains': {
            const filterValues = filterValue.split('|').filter(Boolean);
            if (filterValues.length === 0) return true;
            // Empty values do NOT match
            if (!value || value.trim() === '') return false;
            // OR: any value matches
            return filterValues.some(fv => valueLower.includes(fv.toLowerCase()));
        }

        // Multi-select: does not contain = AND logic + empty included
        case 'does_not_contain': {
            const filterValues = filterValue.split('|').filter(Boolean);
            if (filterValues.length === 0) return true;
            // Empty values match (don't contain anything)
            if (!value || value.trim() === '') return true;
            // AND: none of the values should be present
            return filterValues.every(fv => !valueLower.includes(fv.toLowerCase()));
        }

        // Text: starts with, ends with
        case 'starts_with': return valueLower.startsWith(filterLower);
        case 'ends_with': return valueLower.endsWith(filterLower);

        // Number comparisons
        case 'number_equals': return parseFloat(value) === parseFloat(filterValue);
        case 'number_does_not_equal': return parseFloat(value) !== parseFloat(filterValue);
        case 'greater_than': return parseFloat(value) > parseFloat(filterValue);
        case 'less_than': return parseFloat(value) < parseFloat(filterValue);
        case 'greater_than_or_equal_to': return parseFloat(value) >= parseFloat(filterValue);
        case 'less_than_or_equal_to': return parseFloat(value) <= parseFloat(filterValue);

        // Common: empty checks
        case 'is_empty': return !value || value.trim() === '';
        case 'is_not_empty': return !!value && value.trim() !== '';

        // Legacy support
        case 'is_in': return filterValue.split('|').some(fv => valueLower.includes(fv.toLowerCase()));
        case 'is_not_in': return !filterValue.split('|').some(fv => valueLower.includes(fv.toLowerCase()));

        default: return true;
    }
};

// Count matching assets for a filter condition
const countMatches = (assets: Asset[], filter: FilterCondition): number => {
    return assets.filter(asset => evaluateFilter(asset, filter)).length;
};

// Custom Dropdown Component for Notion-like feel with optional search
const Dropdown = ({ value, label, children, className = "", searchable = false, searchPlaceholder = "Search..." }: {
    value?: string,
    label: React.ReactNode,
    children: React.ReactNode,
    className?: string,
    searchable?: boolean,
    searchPlaceholder?: string
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearchQuery('');
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [ref]);

    // Focus search input when opened
    useEffect(() => {
        if (isOpen && searchable && searchRef.current) {
            searchRef.current.focus();
        }
    }, [isOpen, searchable]);

    // Filter children based on search query
    const filteredChildren = searchable && searchQuery
        ? React.Children.toArray(children).filter(child => {
            if (React.isValidElement(child)) {
                const text = child.props.children?.toString?.() || '';
                return text.toLowerCase().includes(searchQuery.toLowerCase());
            }
            return true;
        })
        : children;

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
                <div className="absolute top-full left-0 mt-1 w-full min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-60 overflow-hidden flex flex-col">
                    {/* Search Input */}
                    {searchable && (
                        <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
                            <input
                                ref={searchRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={searchPlaceholder}
                                className="w-full px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md outline-none focus:border-indigo-400"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                    )}
                    <div className="overflow-y-auto p-1 flex-1">
                        {React.Children.map(filteredChildren, child => {
                            if (React.isValidElement(child)) {
                                return React.cloneElement(child, {
                                    onClick: (...args: any[]) => {
                                        child.props.onClick?.(...args);
                                        if (!child.props['data-keep-open']) {
                                            setIsOpen(false);
                                            setSearchQuery('');
                                        }
                                    }
                                } as any);
                            }
                            return child;
                        })}
                        {searchable && searchQuery && React.Children.count(filteredChildren) === 0 && (
                            <div className="px-2 py-1.5 text-xs text-slate-400 italic">No results</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const FilterRule = ({ condition, schema, schemaProperties, assets = [], onUpdate, onRemove, onWrapInGroup }: {
    condition: FilterCondition,
    schema: string[],
    schemaProperties?: Record<string, NotionProperty>,
    assets?: Asset[],
    onUpdate: (c: Partial<FilterCondition>) => void,
    onRemove: () => void,
    onWrapInGroup?: () => void
}) => {
    // Determine field type
    const fieldType = schemaProperties?.[condition.field || '']?.type || 'rich_text';
    const isSelect = fieldType === 'select' || fieldType === 'status';
    const isMultiSelect = fieldType === 'multi_select';
    const isNumber = fieldType === 'number';
    const options = schemaProperties?.[condition.field || '']?.options || [];

    // Calculate matching count for this single condition
    const matchCount = useMemo(() => {
        const count = countMatches(assets, condition);
        return count;
    }, [assets, condition]);

    // Notion-style operator labels
    const getOperatorLabel = (op: string) => {
        switch (op) {
            // Select operators
            case 'equals': return 'Is';
            case 'does_not_equal': return 'Is not';
            // Multi-select operators  
            case 'contains': return 'Contains';
            case 'does_not_contain': return 'Does not contain';
            // Text operators
            case 'starts_with': return 'Starts with';
            case 'ends_with': return 'Ends with';
            // Number operators
            case 'greater_than': return '>';
            case 'less_than': return '<';
            case 'greater_than_or_equal_to': return '≥';
            case 'less_than_or_equal_to': return '≤';
            case 'number_equals': return '=';
            case 'number_does_not_equal': return '≠';
            // Common operators
            case 'is_empty': return 'Is empty';
            case 'is_not_empty': return 'Is not empty';
            default: return op;
        }
    }

    // Notion-style valid operators per field type
    const validOperators = (() => {
        const emptyOps = ['is_empty', 'is_not_empty'];

        if (isSelect) {
            // Select: is, is not, is empty, is not empty
            return ['equals', 'does_not_equal', ...emptyOps];
        }
        if (isMultiSelect) {
            // Multi-select: contains, does not contain, is empty, is not empty
            return ['contains', 'does_not_contain', ...emptyOps];
        }
        if (isNumber) {
            // Number: =, ≠, >, <, ≥, ≤, is empty, is not empty
            return ['number_equals', 'number_does_not_equal', 'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to', ...emptyOps];
        }
        // Text (default): is, is not, contains, does not contain, starts with, ends with, is empty, is not empty
        return ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', ...emptyOps];
    })();

    // Helper for multiselect values
    const selectedValues = condition.value?.split('|').filter(Boolean) || [];

    return (
        <div className="flex flex-col md:flex-row md:items-center gap-2 p-2 bg-white border border-slate-200 rounded-md hover:border-slate-300 transition-all shadow-sm">
            {/* Match Count Badge - inline at end */}
            {/* Field Selector */}
            <div className="w-full md:w-1/3 min-w-[150px]">
                <Dropdown label={condition.field || "Select property"} value={condition.field} searchable searchPlaceholder="컬럼 검색...">
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

            {/* Value Selector - varies by field type */}
            {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && (
                <div className="flex-1 w-full min-w-[150px]">
                    {isSelect ? (
                        // Select: Single dropdown
                        <Dropdown
                            label={condition.value || "Select value..."}
                            searchable
                            searchPlaceholder="값 검색..."
                        >
                            {options.map(opt => (
                                <div
                                    key={opt.id}
                                    onClick={() => onUpdate({ value: opt.name })}
                                    className={`px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded cursor-pointer flex items-center gap-2 ${condition.value === opt.name ? 'bg-indigo-50' : ''}`}
                                >
                                    <span className={`px-2 py-0.5 rounded text-[10px] bg-${opt.color}-100`}>{opt.name}</span>
                                </div>
                            ))}
                        </Dropdown>
                    ) : isMultiSelect ? (
                        // Multi-select: Checkbox list (keep open)
                        <Dropdown
                            label={
                                selectedValues.length > 0
                                    ? <div className="flex gap-1 flex-wrap">
                                        {selectedValues.map(v => (
                                            <span key={v} className="px-1.5 bg-indigo-100 text-indigo-700 rounded text-[10px]">{v}</span>
                                        ))}
                                    </div>
                                    : "Select tags..."
                            }
                            searchable
                            searchPlaceholder="태그 검색..."
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
                    ) : isNumber ? (
                        // Number: Number input
                        <input
                            type="number"
                            value={condition.value}
                            onChange={(e) => onUpdate({ value: e.target.value })}
                            placeholder="숫자 입력..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-xs outline-none focus:border-indigo-400 transition-colors"
                        />
                    ) : (
                        // Text: Text input
                        <input
                            type="text"
                            value={condition.value}
                            onChange={(e) => onUpdate({ value: e.target.value })}
                            placeholder="값 입력..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-xs outline-none focus:border-indigo-400 transition-colors"
                        />
                    )}
                </div>
            )}

            {/* Match Count Badge + Actions */}
            <div className="flex items-center gap-1 shrink-0">
                <div className="px-2 py-0.5 bg-indigo-500 text-white text-[9px] font-bold rounded-full">
                    {matchCount}
                </div>
                {/* Wrap in group button */}
                {onWrapInGroup && (
                    <button
                        onClick={onWrapInGroup}
                        title="그룹으로 감싸기"
                        className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-md transition-all"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M9 9h6v6H9z" />
                        </svg>
                    </button>
                )}
                <button onClick={onRemove} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"><Trash2 size={14} /></button>
            </div>
        </div>
    );
};

const FilterGroup = ({ condition, schema, schemaProperties, assets = [], onUpdate, onRemove, depth = 0 }: {
    condition: FilterCondition,
    schema: string[],
    schemaProperties?: Record<string, NotionProperty>,
    assets?: Asset[],
    onUpdate: (c: Partial<FilterCondition>) => void,
    onRemove: () => void,
    depth?: number
}) => {
    // Drag state
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);

    // Calculate matching count for this group
    const groupMatchCount = useMemo(() => countMatches(assets, condition), [assets, condition]);

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

    // Wrap a rule in a new group
    const wrapInGroup = (id: string) => {
        const child = condition.conditions?.find(c => c.id === id);
        if (!child) return;

        // Create new group containing this rule
        const newGroup: FilterCondition = {
            id: Date.now().toString() + Math.random(),
            logic: 'AND',
            conditions: [{ ...child }]
        };

        // Replace the original rule with the new group
        const newConditions = condition.conditions?.map(c => c.id === id ? newGroup : c);
        onUpdate({ conditions: newConditions });
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
                {/* Group Match Count */}
                <div className="px-2 py-0.5 bg-emerald-500 text-white text-[10px] font-bold rounded-full">
                    {groupMatchCount}건
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
                                assets={assets}
                                onUpdate={(u) => updateChild(child.id, u)}
                                onRemove={() => removeChild(child.id)}
                                depth={depth + 1}
                            />
                        ) : (
                            <FilterRule
                                condition={child}
                                schema={schema}
                                schemaProperties={schemaProperties}
                                assets={assets}
                                onUpdate={(u) => updateChild(child.id, u)}
                                onRemove={() => removeChild(child.id)}
                                onWrapInGroup={() => wrapInGroup(child.id)}
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

export const FilterBuilderModal: React.FC<FilterBuilderModalProps> = ({ schema, schemaProperties, initialFilter, initialSorts = [], initialVisibleColumns, activeTemplateId, assets = [], onLoadAllAssets, onSave, onSaveAsTemplate, onUpdateTemplate, onClose }) => {
    const [filter, setFilter] = useState<FilterCondition>(JSON.parse(JSON.stringify(initialFilter)));
    const [sorts, setSorts] = useState<SortRule[]>(initialSorts);
    const [visibleCols, setVisibleCols] = useState<string[]>(initialVisibleColumns && initialVisibleColumns.length > 0 ? initialVisibleColumns : schema);
    const [templateName, setTemplateName] = useState("");
    const [activeTab, setActiveTab] = useState<'filter' | 'sort' | 'view'>('filter'); // Added Sort tab

    // State for all assets (for accurate count calculation)
    const [allAssets, setAllAssets] = useState<Asset[]>(assets);
    const [isLoadingAllAssets, setIsLoadingAllAssets] = useState(false);

    // Load all assets on mount if callback provided
    useEffect(() => {
        if (onLoadAllAssets && assets.length < 500) { // Only load if we don't have many
            setIsLoadingAllAssets(true);
            onLoadAllAssets().then((loadedAssets: Asset[]) => {
                setAllAssets(loadedAssets);
                setIsLoadingAllAssets(false);
                console.log('[FilterBuilder] Loaded all assets:', loadedAssets.length);
            }).catch(() => {
                setAllAssets(assets);
                setIsLoadingAllAssets(false);
            });
        } else {
            setAllAssets(assets);
        }
    }, [onLoadAllAssets, assets]);

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
                            {/* Loading indicator */}
                            {isLoadingAllAssets && (
                                <div className="text-xs text-slate-500 flex items-center gap-2 mb-2">
                                    <div className="animate-spin w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full" />
                                    전체 자산 로딩 중...
                                </div>
                            )}
                            {!isLoadingAllAssets && allAssets.length > 0 && (
                                <div className="text-xs text-slate-500 mb-2">
                                    총 {allAssets.length}개 자산 기준으로 계산
                                </div>
                            )}
                            <div className="bg-slate-50/50 p-6 rounded-3xl border border-slate-100">
                                <FilterGroup
                                    condition={filter}
                                    schema={schema}
                                    schemaProperties={schemaProperties}
                                    assets={allAssets}
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
