import React, { useState, useMemo } from 'react';
import { Asset, NotionProperty } from '../lib/notion';
import { ChevronLeft, ChevronRight, X, ExternalLink, Maximize2 } from 'lucide-react';
import EditableCell from './EditableCell';

interface MobileCardViewProps {
    assets: Asset[];
    schema: string[];
    schemaProperties: Record<string, NotionProperty>;
    onUpdateAsset: (id: string, field: string, value: string) => void;
    primaryFields?: string[]; // Key fields to show on card front
}

export const MobileCardView: React.FC<MobileCardViewProps> = ({
    assets,
    schema,
    schemaProperties,
    onUpdateAsset,
    primaryFields
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [expandedAsset, setExpandedAsset] = useState<Asset | null>(null);
    const [fieldPage, setFieldPage] = useState(0);

    // Determine primary fields - title first, then first 3-4 important ones
    const displayFields = useMemo(() => {
        if (primaryFields && primaryFields.length > 0) return primaryFields;

        const titleField = Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title');
        const others = schema.filter(f => f !== titleField).slice(0, 4);
        return titleField ? [titleField, ...others] : others;
    }, [primaryFields, schema, schemaProperties]);

    // Group all fields into pages of 5 for detail view
    const fieldPages = useMemo(() => {
        const pages: string[][] = [];
        for (let i = 0; i < schema.length; i += 5) {
            pages.push(schema.slice(i, i + 5));
        }
        return pages;
    }, [schema]);

    const currentAsset = assets[currentIndex];

    const goNext = () => {
        if (currentIndex < assets.length - 1) {
            setCurrentIndex(currentIndex + 1);
        }
    };

    const goPrev = () => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        }
    };

    // Touch swipe handling
    const [touchStart, setTouchStart] = useState<number | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        setTouchStart(e.targetTouches[0].clientX);
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (!touchStart) return;

        const touchEnd = e.changedTouches[0].clientX;
        const diff = touchStart - touchEnd;

        if (Math.abs(diff) > 50) {
            if (diff > 0) goNext();
            else goPrev();
        }

        setTouchStart(null);
    };

    if (!currentAsset) {
        return (
            <div className="flex-1 flex items-center justify-center bg-theme-primary p-4">
                <p className="text-theme-tertiary">No assets to display</p>
            </div>
        );
    }

    // Get title for display
    const titleField = Object.keys(schemaProperties).find(k => schemaProperties[k].type === 'title');
    const assetTitle = titleField ? currentAsset.values[titleField] : `Asset ${currentIndex + 1}`;

    return (
        <div className="flex-1 flex flex-col bg-theme-primary">
            {/* Progress indicator */}
            <div className="px-4 py-2 flex items-center justify-between bg-theme-secondary border-b border-theme-primary">
                <span className="text-sm text-theme-tertiary">
                    {currentIndex + 1} / {assets.length}
                </span>
                <div className="flex-1 mx-4 h-1 bg-theme-tertiary rounded-full overflow-hidden">
                    <div
                        className="h-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${((currentIndex + 1) / assets.length) * 100}%` }}
                    />
                </div>
                <button
                    onClick={() => setExpandedAsset(currentAsset)}
                    className="p-2 text-theme-tertiary hover:text-indigo-500"
                >
                    <Maximize2 size={18} />
                </button>
            </div>

            {/* Card View */}
            <div
                className="flex-1 p-4 overflow-hidden"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <div className="bg-theme-secondary rounded-3xl shadow-lg border border-theme-primary h-full flex flex-col overflow-hidden">
                    {/* Card Header */}
                    <div className="p-5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
                        <h2 className="text-xl font-bold truncate">{assetTitle}</h2>
                        <p className="text-indigo-200 text-sm mt-1">Tap to edit • Swipe for next</p>
                    </div>

                    {/* Card Body - Primary Fields */}
                    <div className="flex-1 p-4 space-y-3 overflow-auto">
                        {displayFields.map(field => (
                            <div key={field} className="bg-theme-tertiary rounded-xl p-4">
                                <label className="text-xs font-bold text-theme-tertiary uppercase tracking-wide block mb-2">
                                    {field}
                                </label>
                                <EditableCell
                                    field={field}
                                    value={currentAsset.values[field] || ''}
                                    type={schemaProperties[field]?.type || 'text'}
                                    property={schemaProperties[field]}
                                    onSave={(val) => onUpdateAsset(currentAsset.id, field, val)}
                                />
                            </div>
                        ))}
                    </div>

                    {/* Card Footer */}
                    <div className="p-4 border-t border-theme-primary flex items-center justify-between">
                        <button
                            onClick={() => window.open(currentAsset.url, '_blank')}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-indigo-500 hover:bg-indigo-500/10 rounded-xl transition-colors"
                        >
                            <ExternalLink size={16} />
                            Open in Notion
                        </button>
                    </div>
                </div>
            </div>

            {/* Navigation Arrows */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex justify-between px-2 pointer-events-none">
                <button
                    onClick={goPrev}
                    disabled={currentIndex === 0}
                    className="p-3 bg-theme-secondary/80 backdrop-blur rounded-full shadow-lg pointer-events-auto disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={24} className="text-theme-primary" />
                </button>
                <button
                    onClick={goNext}
                    disabled={currentIndex === assets.length - 1}
                    className="p-3 bg-theme-secondary/80 backdrop-blur rounded-full shadow-lg pointer-events-auto disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronRight size={24} className="text-theme-primary" />
                </button>
            </div>

            {/* Expanded Full-Screen Modal */}
            {expandedAsset && (
                <div className="fixed inset-0 z-50 bg-theme-primary flex flex-col">
                    {/* Modal Header */}
                    <div className="flex items-center justify-between p-4 bg-theme-secondary border-b border-theme-primary">
                        <h2 className="text-lg font-bold text-theme-primary truncate flex-1 mr-4">
                            {titleField ? expandedAsset.values[titleField] : 'Asset Details'}
                        </h2>
                        <button
                            onClick={() => setExpandedAsset(null)}
                            className="p-2 text-theme-tertiary hover:text-red-500"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    {/* Field Pages */}
                    <div className="flex-1 overflow-auto p-4">
                        <div className="space-y-3">
                            {fieldPages[fieldPage]?.map(field => (
                                <div key={field} className="bg-theme-secondary rounded-xl p-4 border border-theme-primary">
                                    <label className="text-xs font-bold text-theme-tertiary uppercase tracking-wide block mb-2">
                                        {field}
                                    </label>
                                    <EditableCell
                                        field={field}
                                        value={expandedAsset.values[field] || ''}
                                        type={schemaProperties[field]?.type || 'text'}
                                        property={schemaProperties[field]}
                                        onSave={(val) => onUpdateAsset(expandedAsset.id, field, val)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Page Navigation */}
                    {fieldPages.length > 1 && (
                        <div className="p-4 bg-theme-secondary border-t border-theme-primary flex items-center justify-center gap-4">
                            <button
                                onClick={() => setFieldPage(p => Math.max(0, p - 1))}
                                disabled={fieldPage === 0}
                                className="p-2 rounded-lg bg-theme-tertiary disabled:opacity-30"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <span className="text-sm text-theme-secondary">
                                Page {fieldPage + 1} / {fieldPages.length}
                            </span>
                            <button
                                onClick={() => setFieldPage(p => Math.min(fieldPages.length - 1, p + 1))}
                                disabled={fieldPage === fieldPages.length - 1}
                                className="p-2 rounded-lg bg-theme-tertiary disabled:opacity-30"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
