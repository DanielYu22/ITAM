import React, { useState, useEffect, useRef } from 'react';
import { NotionProperty } from '../lib/notion';
import { Check, Plus, Search } from 'lucide-react';

interface EditableCellProps {
    field: string;
    value: string;
    type: string;
    options?: any[]; // For select options
    property?: NotionProperty; // For select options (alt)
    onSave: (val: string) => void;
}

export default function EditableCell({ value, type, property, onSave }: EditableCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [tempValue, setTempValue] = useState(value);
    const [searchQuery, setSearchQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // For multi_select: parse comma-separated string into array
    const [selectedTags, setSelectedTags] = useState<string[]>(
        value ? value.split(', ').filter(Boolean) : []
    );

    // Sync tempValue if parent value changes (optimistic updates from elsewhere)
    useEffect(() => {
        setTempValue(value);
        setSelectedTags(value ? value.split(', ').filter(Boolean) : []);
    }, [value]);

    // Focus search input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    const handleSave = () => {
        if (tempValue !== value) {
            onSave(tempValue);
        }
        setIsEditing(false);
        setSearchQuery('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        }
        if (e.key === 'Escape') {
            setIsEditing(false);
            setTempValue(value);
            setSearchQuery('');
        }
    };

    const toggleTag = (tagName: string) => {
        const newTags = selectedTags.includes(tagName)
            ? selectedTags.filter(t => t !== tagName)
            : [...selectedTags, tagName];
        setSelectedTags(newTags);
        const newValue = newTags.join(', ');
        setTempValue(newValue);
        onSave(newValue);
    };

    // Filter options based on search query
    const allOptions = property?.options || [];
    const filteredOptions = searchQuery
        ? allOptions.filter(opt =>
            opt.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : allOptions;

    // Check if search query matches any existing option
    const isNewValue = searchQuery &&
        !allOptions.some(opt => opt.name.toLowerCase() === searchQuery.toLowerCase());

    // Handle selecting an option (for single select)
    const handleSelectOption = (optionName: string) => {
        setTempValue(optionName);
        onSave(optionName);
        setIsEditing(false);
        setSearchQuery('');
    };

    // Handle creating a new value
    const handleCreateNew = () => {
        if (type === 'multi_select') {
            toggleTag(searchQuery);
        } else {
            handleSelectOption(searchQuery);
        }
        setSearchQuery('');
    };

    if (isEditing) {
        // Handle Select / Status - Searchable Combobox
        if (type === 'select' || type === 'status') {
            return (
                <div className="bg-theme-secondary border border-indigo-500 rounded-xl shadow-lg overflow-hidden">
                    {/* Search Input */}
                    <div className="p-2 border-b border-theme-primary">
                        <div className="flex items-center gap-2 bg-theme-tertiary rounded-lg px-3 py-2">
                            <Search size={14} className="text-theme-tertiary" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && isNewValue) {
                                        e.preventDefault();
                                        handleCreateNew();
                                    } else {
                                        handleKeyDown(e);
                                    }
                                }}
                                placeholder="검색 또는 새로 입력..."
                                className="flex-1 bg-transparent outline-none text-theme-primary text-sm placeholder-theme-tertiary"
                            />
                        </div>
                    </div>

                    {/* Options List */}
                    <div className="max-h-48 overflow-y-auto p-1">
                        {/* Create New Option */}
                        {isNewValue && (
                            <button
                                onClick={handleCreateNew}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors mb-1"
                            >
                                <Plus size={14} />
                                "{searchQuery}" 새로 생성
                            </button>
                        )}

                        {/* Empty Select Option */}
                        {!searchQuery && (
                            <button
                                onClick={() => handleSelectOption('')}
                                className="w-full text-left px-3 py-2 rounded-lg text-sm text-theme-tertiary hover:bg-theme-tertiary transition-colors"
                            >
                                - 선택 안 함 -
                            </button>
                        )}

                        {/* Filtered Options */}
                        {filteredOptions.map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => handleSelectOption(opt.name)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tempValue === opt.name
                                        ? 'bg-indigo-500/20 text-indigo-400'
                                        : 'text-theme-primary hover:bg-theme-tertiary'
                                    }`}
                            >
                                {opt.name}
                            </button>
                        ))}

                        {filteredOptions.length === 0 && !isNewValue && (
                            <p className="px-3 py-2 text-sm text-theme-tertiary italic">검색 결과 없음</p>
                        )}
                    </div>

                    {/* Cancel Button */}
                    <div className="p-2 border-t border-theme-primary">
                        <button
                            onClick={() => { setIsEditing(false); setSearchQuery(''); }}
                            className="w-full py-2 text-sm text-theme-tertiary hover:text-theme-primary transition-colors"
                        >
                            취소
                        </button>
                    </div>
                </div>
            );
        }

        // Handle Multi-Select - Searchable with checkboxes
        if (type === 'multi_select') {
            return (
                <div className="bg-theme-secondary border border-indigo-500 rounded-xl shadow-lg overflow-hidden">
                    {/* Search Input */}
                    <div className="p-2 border-b border-theme-primary">
                        <div className="flex items-center gap-2 bg-theme-tertiary rounded-lg px-3 py-2">
                            <Search size={14} className="text-theme-tertiary" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && isNewValue) {
                                        e.preventDefault();
                                        handleCreateNew();
                                    } else {
                                        handleKeyDown(e);
                                    }
                                }}
                                placeholder="검색 또는 새로 입력..."
                                className="flex-1 bg-transparent outline-none text-theme-primary text-sm placeholder-theme-tertiary"
                            />
                        </div>
                    </div>

                    {/* Selected Tags Preview */}
                    {selectedTags.length > 0 && (
                        <div className="px-2 py-1 border-b border-theme-primary flex flex-wrap gap-1">
                            {selectedTags.map(tag => (
                                <span key={tag} className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded-full text-xs font-medium">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Options List */}
                    <div className="max-h-40 overflow-y-auto p-1">
                        {/* Create New Option */}
                        {isNewValue && (
                            <button
                                onClick={handleCreateNew}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors mb-1"
                            >
                                <Plus size={14} />
                                "{searchQuery}" 추가
                            </button>
                        )}

                        {/* Filtered Options */}
                        {filteredOptions.map(opt => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => toggleTag(opt.name)}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedTags.includes(opt.name)
                                        ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                        : 'bg-theme-tertiary text-theme-secondary hover:bg-theme-primary border border-transparent'
                                    }`}
                            >
                                <div className={`w-4 h-4 rounded flex items-center justify-center ${selectedTags.includes(opt.name) ? 'bg-indigo-500 text-white' : 'border border-slate-300'
                                    }`}>
                                    {selectedTags.includes(opt.name) && <Check size={12} />}
                                </div>
                                {opt.name}
                            </button>
                        ))}

                        {filteredOptions.length === 0 && !isNewValue && (
                            <p className="px-3 py-2 text-sm text-theme-tertiary italic">검색 결과 없음</p>
                        )}
                    </div>

                    {/* Done Button */}
                    <div className="p-2 border-t border-theme-primary">
                        <button
                            onClick={() => { setIsEditing(false); setSearchQuery(''); }}
                            className="w-full py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 transition-colors"
                        >
                            완료
                        </button>
                    </div>
                </div>
            );
        }

        // Default: Text input
        return (
            <input
                autoFocus
                className="w-full p-2 border rounded shadow-sm outline-none ring-2 ring-indigo-500 bg-theme-secondary text-theme-primary border-theme-primary"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
            />
        );
    }

    // Display Mode
    return (
        <div
            onClick={() => setIsEditing(true)}
            className="cursor-pointer hover:bg-indigo-500/10 p-2 rounded -ml-2 min-h-[2rem] flex items-center transition-colors"
        >
            {type === 'multi_select' && selectedTags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                    {selectedTags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded-full text-xs font-medium">
                            {tag}
                        </span>
                    ))}
                </div>
            ) : (
                <span className={!value ? "text-theme-tertiary italic text-sm" : "text-theme-primary font-medium"}>
                    {value || 'Empty'}
                </span>
            )}
        </div>
    );
}
