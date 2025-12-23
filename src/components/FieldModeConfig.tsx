import React, { useState, useEffect } from 'react';
import { Save, ChevronRight, Map } from 'lucide-react';

export interface HierarchyConfig {
    levelA: string; // e.g. "Building"
    levelB: string; // e.g. "Floor"
    levelC: string; // e.g. "Room"
}

interface FieldModeConfigProps {
    schema: string[];
    onSave: (config: HierarchyConfig) => void;
    currentConfig?: HierarchyConfig;
}

export const FieldModeConfig: React.FC<FieldModeConfigProps> = ({ schema, onSave, currentConfig }) => {
    const [config, setConfig] = useState<HierarchyConfig>({
        levelA: '',
        levelB: '',
        levelC: ''
    });

    useEffect(() => {
        if (currentConfig) {
            setConfig(currentConfig);
        } else {
            // Try to auto-detect sensible defaults with exact match priority
            const building = schema.find(s => s === '설치 장소(건물)') ||
                schema.find(s => s.toLowerCase().includes('building') || s.includes('건물'));
            const floor = schema.find(s => s.toLowerCase() === 'floor') ||
                schema.find(s => s.toLowerCase().includes('floor') || s.includes('층'));
            const room = schema.find(s => s === '설치 장소(연구실)') ||
                schema.find(s => s.toLowerCase().includes('room') || s.toLowerCase().includes('lab') || s.includes('호') || s.includes('실험실') || s.includes('연구실'));

            setConfig({
                levelA: building || '',
                levelB: floor || '',
                levelC: room || ''
            });
        }
    }, [currentConfig, schema]);

    const handleSubmit = () => {
        if (config.levelA && config.levelB && config.levelC) {
            onSave(config);
        } else {
            alert('Please select columns for all hierarchy levels.');
        }
    };

    return (
        <div className="bg-theme-secondary p-6 rounded-3xl shadow-lg border border-theme-primary max-w-md mx-auto mt-10">
            <div className="flex items-center gap-3 mb-6 text-theme-primary">
                <div className="p-3 bg-indigo-500/20 rounded-xl">
                    <Map size={24} className="text-indigo-400" />
                </div>
                <div>
                    <h2 className="text-xl font-bold">Field Navigation Setup</h2>
                    <p className="text-sm text-theme-tertiary">Configure your patrol path hierarchy</p>
                </div>
            </div>

            <div className="space-y-6">
                <div className="space-y-2">
                    <label className="text-sm font-bold text-theme-secondary flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">A</span>
                        Top Level (e.g. Building)
                    </label>
                    <select
                        value={config.levelA}
                        onChange={(e) => setConfig({ ...config, levelA: e.target.value })}
                        className="w-full p-3 bg-theme-tertiary border border-theme-primary rounded-xl text-theme-primary font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                        <option value="">Select Column...</option>
                        {schema.map(col => <option key={col} value={col}>{col}</option>)}
                    </select>
                </div>

                <div className="flex justify-center">
                    <ChevronRight className="text-theme-tertiary rotate-90" />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-bold text-theme-secondary flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">B</span>
                        Mid Level (e.g. Floor)
                    </label>
                    <select
                        value={config.levelB}
                        onChange={(e) => setConfig({ ...config, levelB: e.target.value })}
                        className="w-full p-3 bg-theme-tertiary border border-theme-primary rounded-xl text-theme-primary font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                        <option value="">Select Column...</option>
                        {schema.map(col => <option key={col} value={col}>{col}</option>)}
                    </select>
                </div>

                <div className="flex justify-center">
                    <ChevronRight className="text-theme-tertiary rotate-90" />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-bold text-theme-secondary flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">C</span>
                        Bottom Level (e.g. Room/Lab)
                    </label>
                    <select
                        value={config.levelC}
                        onChange={(e) => setConfig({ ...config, levelC: e.target.value })}
                        className="w-full p-3 bg-theme-tertiary border border-theme-primary rounded-xl text-theme-primary font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                        <option value="">Select Column...</option>
                        {schema.map(col => <option key={col} value={col}>{col}</option>)}
                    </select>
                </div>

                <button
                    onClick={handleSubmit}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-xl shadow-indigo-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 mt-4"
                >
                    <Save size={20} />
                    Start Patrol
                </button>
            </div>
        </div>
    );
};
