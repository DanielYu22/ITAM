import React, { useMemo, useState } from 'react';
import { Asset } from '../lib/notion';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Activity, AlertTriangle, CheckCircle, BarChart2, Filter } from 'lucide-react';

interface DashboardViewProps {
    assets: Asset[];
    onAnalyze: () => void;
    isAnalyzing?: boolean;
    schema?: string[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658'];

export const DashboardView: React.FC<DashboardViewProps> = ({ assets, onAnalyze, isAnalyzing, schema = [] }) => {
    // Config state for columns
    const [selectedCategoryCol, setSelectedCategoryCol] = useState<string>('');
    const [selectedLocationCol, setSelectedLocationCol] = useState<string>('');

    // Initialize defaults when assets load
    React.useEffect(() => {
        if (assets.length > 0 && !selectedCategoryCol) {
            const likelyStatus = Object.keys(assets[0].values).find(k => k.toLowerCase().includes('status') || k.toLowerCase().includes('상태') || k.toLowerCase().includes('condition')) || '';
            if (likelyStatus) setSelectedCategoryCol(likelyStatus);

            const likelyLoc = Object.keys(assets[0].values).find(k => k.toLowerCase().includes('location') || k.toLowerCase().includes('위치') || k.toLowerCase().includes('place')) || '';
            if (likelyLoc) setSelectedLocationCol(likelyLoc);
        }
    }, [assets]);

    // Calculate Stats
    const stats = useMemo(() => {
        const total = assets.length;
        const conditionCounts: Record<string, number> = {};
        const locationCounts: Record<string, number> = {};
        let maintenanceRequired = 0;

        assets.forEach(asset => {
            const conditionKey = selectedCategoryCol || Object.keys(asset.values).find(k => k.toLowerCase().includes('condition') || k.toLowerCase().includes('상태')) || 'Status';
            const locationKey = selectedLocationCol || Object.keys(asset.values).find(k => k.toLowerCase().includes('location') || k.toLowerCase().includes('장소') || k.toLowerCase().includes('위치')) || 'Location';

            const condition = asset.values[conditionKey] || 'Unknown';
            const location = asset.values[locationKey] || 'Unknown';

            conditionCounts[condition] = (conditionCounts[condition] || 0) + 1;
            locationCounts[location] = (locationCounts[location] || 0) + 1;

            if (condition.toLowerCase().includes('bad') || condition.toLowerCase().includes('repair') || condition.toLowerCase().includes('수리')) {
                maintenanceRequired++;
            }
        });

        return {
            total,
            maintenanceRequired,
            conditionData: Object.entries(conditionCounts).map(([name, value]) => ({ name, value })),
            locationData: Object.entries(locationCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10) // Top 10 locations
        };
    }, [assets, selectedCategoryCol, selectedLocationCol]);

    return (
        <div className="flex-1 overflow-auto bg-slate-50 p-6 md:p-10">
            <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
                    <p className="text-slate-500 mt-2">Overview & Analytics</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={onAnalyze}
                        disabled={isAnalyzing}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                    >
                        <BarChart2 size={18} className={isAnalyzing ? 'animate-bounce' : ''} />
                        {isAnalyzing ? 'Analyzing Full Database...' : 'Analyze All Data'}
                    </button>
                </div>
            </header>

            {/* Configuration Panel */}
            {assets.length > 0 && (
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-8 flex flex-wrap gap-6 items-center">
                    <div className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-wider">
                        <Filter size={14} />
                        Analytics Config
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-600">Category / Status:</label>
                        <select
                            value={selectedCategoryCol}
                            onChange={(e) => setSelectedCategoryCol(e.target.value)}
                            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2 outline-none"
                        >
                            <option value="">Auto-detect</option>
                            {schema.map(col => <option key={col} value={col}>{col}</option>)}
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-600">Group By Location:</label>
                        <select
                            value={selectedLocationCol}
                            onChange={(e) => setSelectedLocationCol(e.target.value)}
                            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2 outline-none"
                        >
                            <option value="">Auto-detect</option>
                            {schema.map(col => <option key={col} value={col}>{col}</option>)}
                        </select>
                    </div>
                </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center space-x-4">
                    <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                        <Activity size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-slate-500 font-medium">Total Assets</p>
                        <h3 className="text-3xl font-bold text-slate-800">{stats.total}</h3>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center space-x-4">
                    <div className="p-3 bg-green-100 text-green-600 rounded-xl">
                        <CheckCircle size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-slate-500 font-medium">Operational Estimate</p>
                        <h3 className="text-3xl font-bold text-slate-800">
                            {/* Rough estimate if we don't know exact 'Operational' keyword */}
                            {stats.total - stats.maintenanceRequired}
                        </h3>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center space-x-4">
                    <div className="p-3 bg-red-100 text-red-600 rounded-xl">
                        <AlertTriangle size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-slate-500 font-medium">Maintenance Req.</p>
                        <h3 className="text-3xl font-bold text-slate-800">{stats.maintenanceRequired}</h3>
                    </div>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
                {/* Condition Chart */}
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Distribution by {selectedCategoryCol || 'Condition'}</h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={stats.conditionData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {stats.conditionData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Location Chart */}
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Top Locations ({selectedLocationCol || 'Auto'})</h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.locationData}>
                                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} interval={0} />
                                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip cursor={{ fill: 'transparent' }} />
                                <Bar dataKey="value" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Recent Items List - Placeholder or Actual Top 5 */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 mb-4">Sample Assets</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-600">
                        <thead>
                            <tr className="border-b border-slate-100">
                                <th className="py-3 px-4 font-semibold">Asset ID</th>
                                <th className="py-3 px-4 font-semibold">{selectedLocationCol || 'Location'}</th>
                                <th className="py-3 px-4 font-semibold">{selectedCategoryCol || 'Condition'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {assets.slice(0, 5).map(asset => {
                                const condKey = selectedCategoryCol || Object.keys(asset.values).find(k => k.toLowerCase().includes('condition') || k.toLowerCase().includes('상태')) || 'Status';
                                const locKey = selectedLocationCol || Object.keys(asset.values).find(k => k.toLowerCase().includes('location') || k.toLowerCase().includes('장소')) || 'Location';
                                return (
                                    <tr key={asset.id} className="border-b border-slate-50 hover:bg-slate-50">
                                        <td className="py-3 px-4">{Object.values(asset.values)[0] || asset.id}</td>
                                        <td className="py-3 px-4">
                                            {asset.values[locKey] || '-'}
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className="px-2 py-1 rounded-full bg-slate-100 text-xs">
                                                {asset.values[condKey] || '-'}
                                            </span>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
