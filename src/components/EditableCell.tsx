import React, { useState, useEffect } from 'react';
import { NotionProperty } from '../lib/notion';

interface EditableCellProps {
    field: string;
    value: string;
    type: string;
    options?: any[]; // For select options
    property?: NotionProperty; // For select options (alt)
    onSave: (val: string) => void;
}

export default function EditableCell({ field, value, type, property, onSave }: EditableCellProps) {
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

    if (isEditing) {
        if (type === 'select' || type === 'status') {
            return (
                <select
                    autoFocus
                    className="w-full p-2 border rounded shadow-sm outline-none ring-2 ring-indigo-500 bg-white"
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

        return (
            <input
                autoFocus
                className="w-full p-2 border rounded shadow-sm outline-none ring-2 ring-indigo-500"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
            />
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className="cursor-pointer hover:bg-slate-100 p-2 rounded -ml-2 min-h-[2rem] flex items-center transition-colors"
        >
            <span className={!value ? "text-slate-300 italic text-sm" : "text-slate-700 font-medium"}>
                {value || 'Empty'}
            </span>
        </div>
    );
}
