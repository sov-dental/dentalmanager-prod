
import React, { useState, useEffect, useMemo } from 'react';
import { Clinic } from '../types';
import { fetchDashboardSnapshot, ClinicMonthlySummary, saveMonthlyTarget, auth } from '../services/firebase';
import { UnauthorizedPage } from '../components/UnauthorizedPage';
import { 
    BarChart2, TrendingUp, Users, DollarSign, Calendar, 
    ArrowUpRight, ArrowDownRight, Loader2, Save, 
    Trophy, Activity, AlertCircle, Minus, Target
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Line, ComposedChart 
} from 'recharts';

interface Props {
    clinics: Clinic[];
    userRole?: 'admin' | 'staff' | 'guest';
}

const KPICard = ({ title, actual, target, prev, yearPrev, prefix = '', suffix = '', colorClass = 'text-slate-800' }: any) => {
    const achievementRate = target > 0 ? (actual / target) * 100 : 0;
    const isAchieved = achievementRate >= 100;
    
    // Growth Calculations
    const mom = prev > 0 ? ((actual - prev) / prev) * 100 : 0;
    const yoy = yearPrev > 0 ? ((actual - yearPrev) / yearPrev) * 100 : 0;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between relative overflow-hidden">
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{title}</h4>
                    {target > 0 && (
                        <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${isAchieved ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                            <Target size={10} /> {achievementRate.toFixed(1)}%
                        </div>
                    )}
                </div>
                <div className={`text-3xl font-black tabular-nums tracking-tight ${colorClass} mb-1`}>
                    {prefix}{actual.toLocaleString()}{suffix}
                </div>
                {target > 0 && <div className="text-xs text-slate-400 font-medium">目標: {prefix}{target.toLocaleString()}</div>}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex gap-4 relative z-10">
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">MoM</span>
                    <div className={`flex items-center text-xs font-bold ${mom >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {mom >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {Math.abs(mom).toFixed(1)}%
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">YoY</span>
                    <div className={`flex items-center text-xs font-bold ${yoy >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {yoy >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {Math.abs(yoy).toFixed(1)}%
                    </div>
                </div>
            </div>
            
            {/* Background Decoration */}
            <div className={`absolute -right-6 -bottom-6 opacity-5 pointer-events-none transform rotate-12 ${colorClass}`}>
                <Activity size={100} />
            </div>
        </div>
    );
};

export const GroupDashboard: React.FC<Props> = ({ clinics, userRole }) => {
    // 1. Security Check
    if (userRole !== 'admin') {
        return <UnauthorizedPage email={auth.currentUser?.email} onLogout={() => auth.signOut()} />;
    }

    const [currentMonth, setCurrentMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    // Data State: { current: [], lastMonth: [], lastYear: [] }
    const [snapshot, setSnapshot] = useState<{
        current: ClinicMonthlySummary[];
        lastMonth: ClinicMonthlySummary[];
        lastYear: ClinicMonthlySummary[];
    }>({ current: [], lastMonth: [], lastYear: [] });

    // Aggregate Totals Helper
    const aggregate = (data: ClinicMonthlySummary[]) => data.reduce((acc, curr) => ({
        revenue: acc.revenue + curr.actualRevenue,
        targetRevenue: acc.targetRevenue + (curr.targets.revenueTarget || 0),
        
        visits: acc.visits + curr.actualVisits,
        targetVisits: acc.targetVisits + (curr.targets.visitTarget || 0),
        
        selfPay: acc.selfPay + curr.actualSelfPay,
        targetSelfPay: acc.targetSelfPay + (curr.targets.selfPayTarget || 0),
    }), { revenue: 0, targetRevenue: 0, visits: 0, targetVisits: 0, selfPay: 0, targetSelfPay: 0 });

    const currentTotals = useMemo(() => aggregate(snapshot.current), [snapshot.current]);
    const prevTotals = useMemo(() => aggregate(snapshot.lastMonth), [snapshot.lastMonth]);
    const yearPrevTotals = useMemo(() => aggregate(snapshot.lastYear), [snapshot.lastYear]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const data = await fetchDashboardSnapshot(clinics, currentMonth);
            setSnapshot(data);
        } catch (e) {
            console.error(e);
            alert("載入失敗");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (clinics.length > 0) loadData();
    }, [currentMonth, clinics]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Interactive Target Editing ---
    const handleTargetChange = (clinicId: string, field: 'revenueTarget' | 'visitTarget' | 'selfPayTarget', value: string) => {
        const numVal = parseInt(value) || 0;
        setSnapshot(prev => ({
            ...prev,
            current: prev.current.map(d => {
                if (d.clinicId === clinicId) {
                    return { ...d, targets: { ...d.targets, [field]: numVal } };
                }
                return d;
            })
        }));
    };

    const handleSaveTarget = async (clinicId: string) => {
        const clinicData = snapshot.current.find(d => d.clinicId === clinicId);
        if (!clinicData) return;
        
        setIsSaving(true);
        try {
            await saveMonthlyTarget(clinicId, currentMonth, clinicData.targets);
        } catch (e) {
            console.error("Save target failed", e);
        } finally {
            setIsSaving(false);
        }
    };

    // Prepare Chart Data
    const chartData = snapshot.current.map(d => ({
        name: d.clinicName,
        Revenue: d.actualRevenue,
        Target: d.targets.revenueTarget || 0,
        SelfPay: d.actualSelfPay
    }));

    return (
        <div className="space-y-8 pb-12 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <BarChart2 className="text-indigo-600" />
                        集團營運儀表板 (Group BI)
                    </h2>
                    <p className="text-slate-500 text-sm">監控全集團營收、來客數與目標達成率 (MoM/YoY Trend)。</p>
                </div>
                <div className="flex items-center gap-3 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                    <div className="relative group">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-indigo-500 transition-colors" size={18} />
                        <input 
                            type="month" 
                            className="pl-10 pr-4 py-2 border border-slate-200 rounded-md bg-white font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all cursor-pointer hover:border-indigo-300"
                            value={currentMonth}
                            onChange={e => setCurrentMonth(e.target.value)}
                        />
                    </div>
                    <button 
                        onClick={loadData} 
                        disabled={isLoading}
                        className="bg-white hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 border border-slate-200 p-2 rounded-md transition-colors shadow-sm"
                        title="重新整理"
                    >
                        {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Activity size={20} />}
                    </button>
                </div>
            </div>

            {/* Area 1: KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <KPICard 
                    title="總營收 (Revenue)" 
                    actual={currentTotals.revenue} 
                    target={currentTotals.targetRevenue} 
                    prev={prevTotals.revenue}
                    yearPrev={yearPrevTotals.revenue}
                    prefix="$" 
                    colorClass="text-indigo-600"
                />
                <KPICard 
                    title="自費營收 (Self-Pay)" 
                    actual={currentTotals.selfPay} 
                    target={currentTotals.targetSelfPay} 
                    prev={prevTotals.selfPay}
                    yearPrev={yearPrevTotals.selfPay}
                    prefix="$" 
                    colorClass="text-purple-600"
                />
                <KPICard 
                    title="總來客數 (Visits)" 
                    actual={currentTotals.visits} 
                    target={currentTotals.targetVisits} 
                    prev={prevTotals.visits}
                    yearPrev={yearPrevTotals.visits}
                    suffix=" 人次" 
                    colorClass="text-emerald-600"
                />
            </div>

            {/* Area 2: Charts & Ranking */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Chart */}
                <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200 min-h-[400px]">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-slate-700 flex items-center gap-2">
                            <TrendingUp size={18} className="text-indigo-500"/> 營收達成狀況 (Revenue vs Target)
                        </h3>
                        <div className="flex gap-4 text-xs font-bold">
                            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-500 rounded-sm"></span> 實際營收</span>
                            <span className="flex items-center gap-1"><span className="w-3 h-1 bg-amber-400 rounded-sm"></span> 目標金額</span>
                        </div>
                    </div>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{top: 20, right: 30, left: 0, bottom: 5}}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12, fontWeight: 600}} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} tickFormatter={(val) => `$${val/1000}k`} />
                                <Tooltip 
                                    cursor={{fill: '#f8fafc'}}
                                    contentStyle={{backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                                    itemStyle={{fontSize: '12px', fontWeight: 'bold', padding: '2px 0'}}
                                    formatter={(val: number) => `$${val.toLocaleString()}`}
                                />
                                <Bar dataKey="Revenue" barSize={32} fill="#6366f1" radius={[4, 4, 0, 0]} animationDuration={1000} />
                                <Line type="monotone" dataKey="Target" stroke="#fbbf24" strokeWidth={3} dot={{r: 4, fill: '#fbbf24', strokeWidth: 2, stroke: '#fff'}} animationDuration={1500} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Right Ranking */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                        <Trophy size={18} className="text-amber-500" /> 業績達成排行榜
                    </h3>
                    <div className="overflow-y-auto flex-1 custom-scrollbar pr-2">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
                                <tr>
                                    <th className="px-3 py-2 text-left w-10">#</th>
                                    <th className="px-3 py-2 text-left">診所</th>
                                    <th className="px-3 py-2 text-right">達成率</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {[...snapshot.current]
                                    .sort((a, b) => {
                                        const rateA = a.targets.revenueTarget ? a.actualRevenue / a.targets.revenueTarget : 0;
                                        const rateB = b.targets.revenueTarget ? b.actualRevenue / b.targets.revenueTarget : 0;
                                        return rateB - rateA;
                                    })
                                    .map((d, idx) => {
                                        const rate = d.targets.revenueTarget ? (d.actualRevenue / d.targets.revenueTarget) * 100 : 0;
                                        return (
                                            <tr key={d.clinicId} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-3 py-3 font-bold text-slate-400">
                                                    {idx === 0 ? <Trophy size={14} className="text-amber-500" /> : idx + 1}
                                                </td>
                                                <td className="px-3 py-3 font-bold text-slate-700">{d.clinicName}</td>
                                                <td className="px-3 py-3 text-right">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${rate >= 100 ? 'bg-emerald-100 text-emerald-700' : rate >= 90 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                                                        {rate.toFixed(1)}%
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })
                                }
                                {snapshot.current.length === 0 && (
                                    <tr><td colSpan={3} className="p-4 text-center text-slate-400 text-xs">無數據</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Area 3: Detail Matrix (Data Entry) */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <DollarSign size={18} className="text-teal-600"/> 
                        詳細數據與目標設定 (Data Matrix)
                    </h3>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                        <AlertCircle size={12} />
                        修改目標後請點擊空白處以自動儲存
                        {isSaving && <span className="text-emerald-500 font-bold ml-2 flex items-center gap-1"><Loader2 size={10} className="animate-spin"/> 儲存中</span>}
                    </div>
                </div>
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white border-b border-slate-100 text-slate-500 font-bold uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 bg-white z-20 border-r border-slate-100 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)] w-[180px]">診所名稱</th>
                                <th className="px-2 py-3 text-center bg-indigo-50/50 border-l border-white text-indigo-700" colSpan={3}>總營收 (Revenue)</th>
                                <th className="px-2 py-3 text-center bg-purple-50/50 border-l border-white text-purple-700" colSpan={3}>自費營收 (Self-Pay)</th>
                                <th className="px-2 py-3 text-center bg-emerald-50/50 border-l border-white text-emerald-700" colSpan={3}>來客數 (Visits)</th>
                            </tr>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="sticky left-0 bg-slate-50 z-20 border-r border-slate-200 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]"></th>
                                {/* Revenue Cols */}
                                <th className="px-2 py-2 text-right w-28 text-slate-400 font-medium border-l border-slate-200">目標 (Target)</th>
                                <th className="px-2 py-2 text-right w-24 font-bold text-indigo-600">實際 (Actual)</th>
                                <th className="px-2 py-2 text-center w-16 text-slate-400 font-medium">%</th>
                                {/* SelfPay Cols */}
                                <th className="px-2 py-2 text-right w-28 text-slate-400 font-medium border-l border-slate-200">目標 (Target)</th>
                                <th className="px-2 py-2 text-right w-24 font-bold text-purple-600">實際 (Actual)</th>
                                <th className="px-2 py-2 text-center w-16 text-slate-400 font-medium">%</th>
                                {/* Visit Cols */}
                                <th className="px-2 py-2 text-right w-24 text-slate-400 font-medium border-l border-slate-200">目標 (Target)</th>
                                <th className="px-2 py-2 text-right w-20 font-bold text-emerald-600">實際 (Actual)</th>
                                <th className="px-2 py-2 text-center w-16 text-slate-400 font-medium">%</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {snapshot.current.map(d => {
                                const revRate = d.targets.revenueTarget ? (d.actualRevenue / d.targets.revenueTarget) * 100 : 0;
                                const spRate = d.targets.selfPayTarget ? (d.actualSelfPay / d.targets.selfPayTarget) * 100 : 0;
                                const visitRate = d.targets.visitTarget ? (d.actualVisits / d.targets.visitTarget) * 100 : 0;

                                return (
                                    <tr key={d.clinicId} className="hover:bg-slate-50 group transition-colors">
                                        <td className="px-4 py-3 font-bold text-slate-700 sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-100 z-10 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                                            {d.clinicName}
                                        </td>
                                        
                                        {/* Revenue */}
                                        <td className="p-1 border-l border-slate-100">
                                            <div className="relative">
                                                <input 
                                                    type="number"
                                                    className="w-full text-right border border-transparent hover:border-slate-300 focus:border-indigo-500 rounded px-2 py-1.5 outline-none bg-transparent focus:bg-white text-slate-600 font-medium transition-all focus:shadow-sm"
                                                    value={d.targets.revenueTarget || ''}
                                                    placeholder="0"
                                                    onChange={e => handleTargetChange(d.clinicId, 'revenueTarget', e.target.value)}
                                                    onBlur={() => handleSaveTarget(d.clinicId)}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-2 py-3 text-right font-bold text-indigo-700 tabular-nums">
                                            {d.actualRevenue.toLocaleString()}
                                        </td>
                                        <td className="px-2 py-3 text-center">
                                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${revRate >= 100 ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400'}`}>
                                                {revRate > 0 ? `${revRate.toFixed(0)}%` : '-'}
                                            </span>
                                        </td>

                                        {/* Self Pay */}
                                        <td className="p-1 border-l border-slate-100">
                                            <div className="relative">
                                                <input 
                                                    type="number"
                                                    className="w-full text-right border border-transparent hover:border-slate-300 focus:border-purple-500 rounded px-2 py-1.5 outline-none bg-transparent focus:bg-white text-slate-600 font-medium transition-all focus:shadow-sm"
                                                    value={d.targets.selfPayTarget || ''}
                                                    placeholder="0"
                                                    onChange={e => handleTargetChange(d.clinicId, 'selfPayTarget', e.target.value)}
                                                    onBlur={() => handleSaveTarget(d.clinicId)}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-2 py-3 text-right font-bold text-purple-700 tabular-nums">
                                            {d.actualSelfPay.toLocaleString()}
                                        </td>
                                        <td className="px-2 py-3 text-center">
                                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${spRate >= 100 ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400'}`}>
                                                {spRate > 0 ? `${spRate.toFixed(0)}%` : '-'}
                                            </span>
                                        </td>

                                        {/* Visits */}
                                        <td className="p-1 border-l border-slate-100">
                                            <div className="relative">
                                                <input 
                                                    type="number"
                                                    className="w-full text-right border border-transparent hover:border-slate-300 focus:border-emerald-500 rounded px-2 py-1.5 outline-none bg-transparent focus:bg-white text-slate-600 font-medium transition-all focus:shadow-sm"
                                                    value={d.targets.visitTarget || ''}
                                                    placeholder="0"
                                                    onChange={e => handleTargetChange(d.clinicId, 'visitTarget', e.target.value)}
                                                    onBlur={() => handleSaveTarget(d.clinicId)}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-2 py-3 text-right font-bold text-emerald-700 tabular-nums">
                                            {d.actualVisits.toLocaleString()}
                                        </td>
                                        <td className="px-2 py-3 text-center">
                                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${visitRate >= 100 ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400'}`}>
                                                {visitRate > 0 ? `${visitRate.toFixed(0)}%` : '-'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {snapshot.current.length === 0 && (
                                <tr><td colSpan={10} className="p-8 text-center text-slate-400">無資料顯示</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
