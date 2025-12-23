import React, { useState, useEffect } from 'react';
import { NotionProperty } from '../lib/notion';
import { Check } from 'lucide-react';

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

    // For multi_select: parse comma-separated string into array
    const [selectedTags, setSelectedTags] = useState<string[]>(
        value ? value.split(', ').filter(Boolean) : []
    );

    // Sync tempValue if parent value changes (optimistic updates from elsewhere)
    useEffect(() => {
        setTempValue(value);
        setSelectedTags(value ? value.split(', ').filter(Boolean) : []);
    }, [value]);

    const handleSave = () => {
        if (tempValue !== value) {
            onSave(tempValue);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        }
        if (e.key === 'Escape') {
            setIsEditing(false);
            setTempValue(value);
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

    if (isEditing) {
        // Handle Select / Status
        if (type === 'select' || type === 'status') {
            return (
                <select
                    autoFocus
                    className="w-full p-2 border rounded shadow-sm outline-none ring-2 ring-indigo-500 bg-theme-secondary text-theme-primary border-theme-primary"
                    value={tempValue}
                    onChange={(e) => {
                        setTempValue(e.target.value);
                        if (e.target.value !== value) onSave(e.target.value);
                        setIsEditing(false);
                    }}
                    onBlur={() => setIsEditing(false)}
                    onKeyDown={handleKeyDown}
                >
                    <option value="">- Select -</option>
                    {property?.options?.map(opt => (
                        <option key={opt.id} value={opt.name}>{opt.name}</option>
                    ))}
                </select>
            );
        }

        // Handle Multi-Select (Tag-style)
        if (type === 'multi_select') {
            return (
                <div className="bg-theme-secondary border border-indigo-500 rounded-xl p-2 shadow-lg space-y-2 max-h-48 overflow-y-auto">
                    {property?.options?.map(opt => (
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
                    <button
                        onClick={() => setIsEditing(false)}
                        className="w-full mt-2 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm"
                    >
                        Done
                    </button>
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
