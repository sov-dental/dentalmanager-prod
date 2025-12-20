import React, { useState, useEffect, useMemo, memo } from 'react';
import { Clinic, Consultant, NPRecord, UserRole, ClinicMonthlySummary, AccountingRow, MonthlyTarget } from '../types';
import { 
    fetchDashboardSnapshot, auth, 
    getMonthlyAccounting, CLINIC_ORDER, 
    getStaffList, db,
    saveMonthlyTarget, deleteNPRecord
} from '../services/firebase';
import { UnauthorizedPage } from '../components/UnauthorizedPage';
import { NPStatusModal } from '../components/NPStatusModal';
import { 
    BarChart2, TrendingUp, Users, DollarSign, Calendar, 
    ArrowUpRight, ArrowDownRight, Loader2, 
    Trophy, Activity, Target, PieChart as PieChartIcon,
    Filter, LineChart, CheckCircle, ArrowUp, ArrowDown,
    Medal, Star, Trash2, Clock, AlertCircle, User, Info as InfoIcon,
    Tag, MessageCircle, ShieldX
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, ComposedChart, Line
} from 'recharts';

interface Props {
    clinics: Clinic[];
    userRole?: UserRole;
}

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#ec4899', '#06b6d4', '#14b8a6', '#6366f1'];
const CLINIC_COLORS = ['#6366f1', '#a855f7', '#10b981', '#f59e0b', '#f43f5e', '#ec4899', '#06b6d4'];

// --- MEMOIZED SUB-COMPONENTS ---

const CustomTooltip = memo(({ active, payload, label, valuePrefix = '$', isCount = false, sortedClinics = [] }: any) => {
    if (active && payload && payload.length) {
        if (isCount) {
            const totalAppt = payload.reduce((acc: number, p: any) => p.dataKey.startsWith('appt_') ? acc + (p.value || 0) : acc, 0);
            const totalVisit = payload.reduce((acc: number, p: any) => p.dataKey.startsWith('visit_') ? acc + (p.value || 0) : acc, 0);
            const totalClosed = payload.reduce((acc: number, p: any) => p.dataKey.startsWith('closed_') ? acc + (p.value || 0) : acc, 0);

            return (
                <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl text-xs min-w-[200px]">
                    <div className="font-black text-slate-800 mb-2 border-b border-slate-100 pb-2">
                        <div className="flex justify-between items-center mb-1">
                            <span>第 {label} 日</span>
                            <span className="text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                [總計: {totalAppt}.{totalVisit}.{totalClosed}]
                            </span>
                        </div>
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                        {sortedClinics.map((clinic: Clinic) => {
                            const originalIndex = sortedClinics.findIndex((sc: Clinic) => sc.id === clinic.id);
                            const appt = payload.find((p: any) => p.dataKey === `appt_${clinic.id}`)?.value || 0;
                            const visit = payload.find((p: any) => p.dataKey === `visit_${clinic.id}`)?.value || 0;
                            const closed = payload.find((p: any) => p.dataKey === `closed_${clinic.id}`)?.value || 0;
                            
                            if (appt === 0 && visit === 0 && closed === 0) return null;

                            return (
                                <div key={clinic.id} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CLINIC_COLORS[originalIndex % CLINIC_COLORS.length] }}></div>
                                        <span className="font-bold text-slate-700">{clinic.name}:</span>
                                    </div>
                                    <span className="font-mono text-slate-600 bg-slate-50 px-1.5 rounded border border-slate-100">
                                        {appt}.{visit}.{closed}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // Revenue logic with Total display
        const total = payload.reduce((sum: number, entry: any) => sum + (Number(entry.value) || 0), 0);

        return (
            <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl text-xs min-w-[200px]">
                <div className="font-black text-slate-800 mb-2 border-b border-slate-100 pb-2">
                    <div className="flex justify-between items-center mb-1">
                        <span>第 {label} 日</span>
                        <span className="text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                            當日總計: {valuePrefix}{total.toLocaleString()}
                        </span>
                    </div>
                </div>
                <div className="space-y-1">
                    <div className="max-h-60 overflow-y-auto custom-scrollbar pr-1">
                        {sortedClinics.map((clinic: Clinic) => {
                            const entry = payload.find((p: any) => p.dataKey === clinic.id);
                            if (!entry) return null;
                            const originalIndex = sortedClinics.findIndex((sc: Clinic) => sc.id === clinic.id);
                            return (
                                <div key={clinic.id} className="flex items-center gap-4 mb-1 last:mb-0">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CLINIC_COLORS[originalIndex % CLINIC_COLORS.length] }}></div>
                                        <span className="text-slate-500 whitespace-nowrap">{clinic.name}:</span>
                                    </div>
                                    <span className="font-mono font-bold text-slate-700 ml-auto">
                                        {valuePrefix}{entry.value.toLocaleString()}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }
    return null;
});

const KPICard = memo(({ title, actual, target, prev, yearPrev, prefix = '', suffix = '', colorClass = 'text-slate-800', isActive, onClick, icon: Icon, customRate, customSubtext }: any) => {
    const rate = customRate !== undefined ? customRate : (target > 0 ? (actual / target) * 100 : 0);
    const isAchieved = rate >= 100; 
    const badgeColor = customRate !== undefined ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : (isAchieved ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100');
    const mom = prev > 0 ? ((actual - prev) / prev) * 100 : 0;
    const yoy = yearPrev > 0 ? ((actual - yearPrev) / yearPrev) * 100 : 0;

    return (
        <button 
            onClick={onClick}
            className={`text-left w-full rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden transition-all duration-300 ${isActive ? 'bg-white ring-2 ring-indigo-500 shadow-xl scale-[1.02] z-10' : 'bg-white shadow-sm border border-slate-200 hover:shadow-md hover:border-indigo-200'}`}
        >
            <div className="relative z-10 w-full">
                <div className="flex justify-between items-start mb-3">
                    <div className={`p-2 rounded-lg ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>{Icon && <Icon size={20} />}</div>
                    {(target > 0 || customRate !== undefined) && <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full font-bold border ${badgeColor}`}><Target size={12} /> {rate.toFixed(1)}%</div>}
                </div>
                <h4 className="text-sm font-bold text-slate-500 mb-1">{title}</h4>
                <div className={`text-3xl font-black tabular-nums tracking-tight ${colorClass} mb-1`}>{prefix}{actual.toLocaleString()}{suffix}</div>
                {customSubtext ? <div className="text-xs text-slate-400 font-medium">{customSubtext}</div> : target > 0 && <div className="text-xs text-slate-400 font-medium">目標: {prefix}{target.toLocaleString()}</div>}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-50 flex gap-6 relative z-10 w-full">
                <div className="flex flex-col"><span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">MoM</span><div className={`flex items-center text-xs font-bold ${mom >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{mom >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(mom).toFixed(1)}%</div></div>
                <div className="flex flex-col"><span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">YoY</span><div className={`flex items-center text-xs font-bold ${yoy >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{yoy >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(yoy).toFixed(1)}%</div></div>
            </div>
        </button>
    );
});

const RevenueTrendChart = memo(({ data, sortedClinics, filterId, getClinicName }: any) => {
    const visibleClinics = filterId === 'all' ? sortedClinics : sortedClinics.filter((c: Clinic) => c.id === filterId);
    
    const legendPayload = useMemo(() => visibleClinics.map((c: Clinic) => {
        const originalIndex = sortedClinics.findIndex((sc: Clinic) => sc.id === c.id);
        return {
            value: c.name,
            type: 'rect',
            color: CLINIC_COLORS[originalIndex % CLINIC_COLORS.length],
            id: c.id
        };
    }), [visibleClinics, sortedClinics]);

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `$${v/1000}k`} />
                <Tooltip content={<CustomTooltip valuePrefix="$" sortedClinics={sortedClinics} />} cursor={{ fill: '#f8fafc' }} />
                <Legend payload={legendPayload} wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold' }} />
                {visibleClinics.map((clinic: Clinic) => {
                    const originalIndex = sortedClinics.findIndex((sc: Clinic) => sc.id === clinic.id);
                    const color = CLINIC_COLORS[originalIndex % CLINIC_COLORS.length];
                    return (
                        <Bar key={clinic.id} stackId="a" dataKey={clinic.id} name={clinic.name} fill={color} radius={[0, 0, 0, 0]} isAnimationActive={false} />
                    );
                })}
            </BarChart>
        </ResponsiveContainer>
    );
});

const KPIProgressChart = memo(({ data, color, valuePrefix = '$' }: any) => (
    <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontBold: 'bold' }} />
            <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => `${valuePrefix}${v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k'}`} />
            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#f59e0b', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip 
                formatter={(val: number, name: string) => [name === '達成率' ? `${val.toFixed(1)}%` : `${valuePrefix}${val.toLocaleString()}`, name]}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
            />
            <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: '20px', fontSize: '11px' }} />
            <Bar yAxisId="left" dataKey="target" name="目標 (Target)" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={40} />
            <Bar yAxisId="left" dataKey="actual" name="實際 (Actual)" fill={color} radius={[4, 4, 0, 0]} barSize={40} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name="達成率" stroke="#f59e0b" strokeWidth={3} dot={{ r: 5, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }} />
        </ComposedChart>
    </ResponsiveContainer>
));

const SelfPayAchievementChart = memo(({ data }: any) => (
    <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontBold: 'bold' }} />
            <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => `$${v/1000}k`} />
            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#f59e0b', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                formatter={(val: number, name: string) => [name === '達成率' ? `${val.toFixed(1)}%` : `$${val.toLocaleString()}`, name]}
            />
            <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: '20px', fontSize: '11px' }} />
            <Bar yAxisId="left" dataKey="target" name="自費目標" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={40} />
            <Bar yAxisId="left" dataKey="actual" name="自費實收" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={40} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name="達成率" stroke="#f59e0b" strokeWidth={3} dot={{ r: 5, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }} />
        </ComposedChart>
    </ResponsiveContainer>
));

const MarketingTrendChart = memo(({ data, sortedClinics, filterId }: any) => {
    const visibleClinics = filterId === 'all' ? sortedClinics : sortedClinics.filter((c: Clinic) => c.id === filterId);
    
    const legendPayload = useMemo(() => visibleClinics.map((c: Clinic) => {
        const originalIndex = sortedClinics.findIndex((sc: Clinic) => sc.id === c.id);
        return {
            value: c.name,
            type: 'rect',
            color: CLINIC_COLORS[originalIndex % CLINIC_COLORS.length],
            id: c.id
        };
    }), [visibleClinics, sortedClinics]);

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip isCount={true} sortedClinics={sortedClinics} />} cursor={{ fill: '#f8fafc' }} />
                <Legend payload={legendPayload} wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontBold: 'bold' }} />
                {visibleClinics.map((clinic: Clinic) => {
                    const originalIndex = sortedClinics.findIndex((sc: Clinic) => sc.id === clinic.id);
                    const color = CLINIC_COLORS[originalIndex % CLINIC_COLORS.length];
                    return (
                        <React.Fragment key={clinic.id}>
                            <Bar stackId="a" dataKey={`appt_${clinic.id}`} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1} isAnimationActive={false} legendType="none" />
                            <Bar stackId="b" dataKey={`visit_${clinic.id}`} fill={color} fillOpacity={0.5} stroke={color} strokeWidth={1} isAnimationActive={false} legendType="none" />
                            <Bar stackId="c" dataKey={`closed_${clinic.id}`} fill={color} fillOpacity={1.0} isAnimationActive={false} legendType="none" />
                        </React.Fragment>
                    );
                })}
            </BarChart>
        </ResponsiveContainer>
    );
});

const SelfPayBreakdownChart = memo(({ data, hideLegend = false, isCurrency = true }: any) => (
    <ResponsiveContainer width="100%" height="100%">
        <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value" animationBegin={0} animationDuration={800}>
                {data.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
                ))}
            </Pie>
            <Tooltip formatter={(val: number) => isCurrency ? `$${val.toLocaleString()}` : `${val.toLocaleString()} 人`} />
            {!hideLegend && <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />}
        </PieChart>
    </ResponsiveContainer>
));

const MarketingFunnelChart = memo(({ data }: any) => (
    <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={data} margin={{top: 5, right: 30, left: 40, bottom: 5}} barCategoryGap="15%">
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 11, fontBold: 'bold', fill: '#64748b'}} axisLine={false} tickLine={false} />
            <Tooltip cursor={{fill: '#f8fafc'}} />
            <Bar dataKey="value" barSize={30} radius={[0, 4, 4, 0]}>
                {data.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
            </Bar>
        </BarChart>
    </ResponsiveContainer>
));

const TableHeaderFilter = memo(({ label, value, onChange, options }: any) => (
    <div className="flex flex-col gap-1 w-full">
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</span>
        <select className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-slate-50 text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-bold" value={value} onChange={(e) => onChange(e.target.value)} onClick={(e) => e.stopPropagation()}>
            <option value="">全部</option>
            {options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
    </div>
));

// --- MAIN COMPONENT ---

export const GroupDashboard: React.FC<Props> = ({ clinics, userRole }) => {
    if (!['admin', 'manager'].includes(userRole || '')) {
        return <UnauthorizedPage email={auth.currentUser?.email} onLogout={() => auth.signOut()} />;
    }

    const [currentMonth, setCurrentMonth] = useState<string>(new Date().toISOString().slice(0, 7));
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'revenue' | 'self-pay' | 'marketing'>('revenue');
    const [trendFilter, setTrendFilter] = useState('all');
    const [breakdownFilter, setBreakdownFilter] = useState('all');
    const [marketingFilter, setMarketingFilter] = useState('all');
    const [selectedTagFilter, setSelectedTagFilter] = useState('all');
    
    // Independent filters for Customer Profile card
    const [pieClinicFilter, setPieClinicFilter] = useState('all');
    const [pieTagFilter, setPieTagFilter] = useState('all');

    // Global toggle for Marketing Analysis
    const [excludeNHI, setExcludeNHI] = useState(false);

    const sortedClinics = useMemo(() => {
        return [...clinics].sort((a, b) => (CLINIC_ORDER[a.name] ?? 999) - (CLINIC_ORDER[b.name] ?? 999));
    }, [clinics]);
    
    const [snapshot, setSnapshot] = useState<{ current: ClinicMonthlySummary[], lastMonth: ClinicMonthlySummary[], lastYear: ClinicMonthlySummary[] }>({ current: [], lastMonth: [], lastYear: [] });
    const [monthlyRows, setMonthlyRows] = useState<Record<string, AccountingRow[]>>({});
    const [prevMonthlyRows, setPrevMonthlyRows] = useState<Record<string, AccountingRow[]>>({});
    const [npRecords, setNpRecords] = useState<NPRecord[]>([]);
    const [staffMap, setStaffMap] = useState<Record<string, string>>({}); 
    const [tableFilters, setTableFilters] = useState<Record<string, string>>({});
    const [editingNP, setEditingNP] = useState<NPRecord | null>(null);

    // Derived state for charts based on excludeNHI toggle
    const chartFilteredRecords = useMemo(() => {
        return npRecords.filter(r => {
            if (excludeNHI && (r.marketingTag || '').includes('健保')) return false;
            return true;
        });
    }, [npRecords, excludeNHI]);

    // --- DATA FETCHING (HYBRID: STATIC + REAL-TIME) ---
    useEffect(() => {
        if (!clinics.length) return;

        // 1. One-time fetch for static/heavy data (Accounting Rows & Dash Snapshot)
        const loadStaticData = async () => {
            setIsLoading(true);
            try {
                const snapshotPromise = fetchDashboardSnapshot(clinics, currentMonth);
                const [y, m] = currentMonth.split('-').map(Number);
                const pmDate = new Date(y, m - 2, 1);
                const prevMonth = `${pmDate.getFullYear()}-${String(pmDate.getMonth() + 1).padStart(2, '0')}`;

                const granularPromises = clinics.map(async (clinic) => {
                    const rows = await getMonthlyAccounting(clinic.id, currentMonth);
                    const staff = await getStaffList(clinic.id);
                    return { clinicId: clinic.id, rows, staff };
                });

                const prevGranularPromises = clinics.map(async (clinic) => {
                    const rows = await getMonthlyAccounting(clinic.id, prevMonth);
                    return { clinicId: clinic.id, rows };
                });

                const [snap, granularResults, prevGranularResults] = await Promise.all([
                    snapshotPromise, 
                    Promise.all(granularPromises), 
                    Promise.all(prevGranularPromises)
                ]);

                const newRows: Record<string, AccountingRow[]> = {};
                const newStaffMap: Record<string, string> = {};
                granularResults.forEach(res => {
                    newRows[res.clinicId] = res.rows;
                    res.staff.forEach(s => newStaffMap[s.id] = s.name);
                });

                const newPrevRows: Record<string, AccountingRow[]> = {};
                prevGranularResults.forEach(res => {
                    newPrevRows[res.clinicId] = res.rows;
                });

                setSnapshot(snap);
                setMonthlyRows(newRows);
                setPrevMonthlyRows(newPrevRows);
                setStaffMap(newStaffMap);
            } catch (e) {
                console.error("[GroupDashboard] Static load failed", e);
            } finally {
                setIsLoading(false);
            }
        };

        // 2. Real-time Listener for NP Records (Firestore onSnapshot)
        const [year, monthVal] = currentMonth.split('-').map(Number);
        const startStr = `${year}-${String(monthVal).padStart(2, '0')}-01`;
        const endStr = `${year}-${String(monthVal).padStart(2, '0')}-31`;
        
        const allowedIds = new Set(clinics.map(c => c.id));
        const unsubscribeNP = db.collection('np_records')
            .where('date', '>=', startStr)
            .where('date', '<=', endStr)
            .onSnapshot(snap => {
                const newNp: NPRecord[] = [];
                snap.forEach(doc => {
                    const data = doc.data() as NPRecord;
                    if (allowedIds.has(data.clinicId)) newNp.push({ id: doc.id, ...data });
                });
                setNpRecords(newNp);
            }, err => {
                console.error("[GroupDashboard] NP Snapshot Error", err);
            });

        loadStaticData();

        return () => {
            unsubscribeNP();
        };
    }, [currentMonth, clinics]);

    const getClinicName = (id: string) => clinics.find(c => c.id === id)?.name || id;

    // Reactively derive unique tags from npRecords with counts and sorting (Safe copy sort)
    const availableMarketingTags = useMemo(() => {
        const counts: Record<string, number> = {};
        npRecords.forEach(r => {
            const tag = r.marketingTag || '未分類';
            counts[tag] = (counts[tag] || 0) + 1;
        });
        return [...Object.entries(counts)]
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }, [npRecords]);

    const totals = useMemo(() => {
        const current = snapshot.current.reduce((acc, curr) => ({
            revenue: acc.revenue + curr.actualRevenue,
            targetRevenue: acc.targetRevenue + (curr.targets.revenueTarget || 0),
            selfPay: acc.selfPay + curr.actualSelfPay,
            targetSelfPay: acc.targetSelfPay + (curr.targets.selfPayTarget || 0),
        }), { revenue: 0, targetRevenue: 0, selfPay: 0, targetSelfPay: 0 });
        const prev = snapshot.lastMonth.reduce((acc, curr) => ({ revenue: acc.revenue + curr.actualRevenue, selfPay: acc.selfPay + curr.actualSelfPay, }), { revenue: 0, selfPay: 0 });
        const yearPrev = snapshot.lastYear.reduce((acc, curr) => ({ revenue: acc.revenue + curr.actualRevenue, selfPay: acc.selfPay + curr.actualSelfPay, }), { revenue: 0, selfPay: 0 });
        const marketing = { leads: npRecords.length, visited: npRecords.filter(r => r.isVisited).length, closed: npRecords.filter(r => r.isClosed).length, };
        return { current, prev, yearPrev, marketing };
    }, [snapshot, npRecords]);

    const dailyTrendData = useMemo(() => {
        const [year, month] = currentMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const dataMap: Record<number, any> = {};
        for (let d = 1; d <= daysInMonth; d++) {
            dataMap[d] = { day: d };
            clinics.forEach(c => dataMap[d][c.id] = 0);
        }
        (Object.entries(monthlyRows) as [string, AccountingRow[]][]).forEach(([clinicId, rows]) => {
            rows.forEach(row => {
                const dateStr = row.originalDate || row.startTime?.split('T')[0];
                if (!dateStr) return;
                const d = parseInt(dateStr.split('-')[2]);
                if (dataMap[d]) dataMap[d][clinicId] += (row.actualCollected || 0);
            });
        });
        return [...Object.values(dataMap)].sort((a, b) => a.day - b.day);
    }, [monthlyRows, clinics, currentMonth]);

    const marketingTrendData = useMemo(() => {
        const [year, month] = currentMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const dataMap: Record<number, any> = {};
        for (let d = 1; d <= daysInMonth; d++) {
            dataMap[d] = { day: d };
            clinics.forEach(c => {
                dataMap[d][`appt_${c.id}`] = 0;
                dataMap[d][`visit_${c.id}`] = 0;
                dataMap[d][`closed_${c.id}`] = 0;
            });
        }
        
        chartFilteredRecords.forEach(r => {
            if (!r.date) return;
            if (selectedTagFilter !== 'all' && (r.marketingTag || '未分類') !== selectedTagFilter) return;

            const d = parseInt(r.date.split('-')[2]);
            if (dataMap[d]) {
                dataMap[d][`appt_${r.clinicId}`] = (dataMap[d][`appt_${r.clinicId}`] || 0) + 1;
                if (r.isVisited) dataMap[d][`visit_${r.clinicId}`] = (dataMap[d][`visit_${r.clinicId}`] || 0) + 1;
                if (r.isClosed) dataMap[d][`closed_${r.clinicId}`] = (dataMap[d][`closed_${r.clinicId}`] || 0) + 1;
            }
        });
        
        return [...Object.values(dataMap)].sort((a, b) => a.day - b.day);
    }, [chartFilteredRecords, clinics, currentMonth, selectedTagFilter]);

    const performanceMatrix = useMemo(() => {
        return [...snapshot.current]
            .sort((a, b) => (CLINIC_ORDER[a.clinicName] ?? 999) - (CLINIC_ORDER[b.clinicName] ?? 999))
            .map(d => ({
                id: d.clinicId,
                name: d.clinicName,
                revenueActual: d.actualRevenue,
                revenueTarget: d.targets.revenueTarget || 0,
                selfPayActual: d.actualSelfPay,
                selfPayTarget: d.targets.selfPayTarget || 0,
                revenueRate: (d.targets.revenueTarget || 0) > 0 ? (d.actualRevenue / d.targets.revenueTarget) * 100 : 0,
                selfPayRate: (d.targets.selfPayTarget || 0) > 0 ? (d.actualSelfPay / d.targets.selfPayTarget) * 100 : 0,
                fullTarget: d.targets
            }));
    }, [snapshot.current]);

    const achievementRanking = useMemo(() => {
        return [...performanceMatrix].sort((a, b) => b.revenueRate - a.revenueRate);
    }, [performanceMatrix]);

    const selfPayAnalytics = useMemo(() => {
        const keys = ['implant', 'ortho', 'prostho', 'sov', 'inv', 'whitening', 'perio', 'otherSelfPay', 'retail'] as const;
        const labels = ['植牙', '矯正', '假牙', 'SOV', 'INV', '美白', '牙周', '其他', '物販/小金庫'];
        
        const currentTotals = keys.map(() => 0);
        const prevTotals = keys.map(() => 0);

        const sumCategories = (source: Record<string, AccountingRow[]>, targetArray: number[]) => {
            Object.entries(source).forEach(([cid, rows]) => {
                if (breakdownFilter !== 'all' && breakdownFilter !== cid) return;
                rows.forEach(row => {
                    const t = row.treatments as any;
                    const r = row.retail;
                    keys.forEach((k, idx) => {
                        if (k === 'retail') targetArray[idx] += (r.products || 0) + (r.diyWhitening || 0);
                        else targetArray[idx] += (t[k] || 0);
                    });
                });
            });
        };

        sumCategories(monthlyRows, currentTotals);
        sumCategories(prevMonthlyRows, prevTotals);

        const pieData = keys.map((k, i) => ({ name: labels[i], value: currentTotals[i] })).filter(d => d.value > 0);
        const tableData = sortedClinics.map(c => {
            const rows = monthlyRows[c.id] || [];
            const rowBD = keys.map(() => 0);
            rows.forEach(r => {
                keys.forEach((k, idx) => {
                    if (k === 'retail') rowBD[idx] += (r.retail.products || 0) + (r.retail.diyWhitening || 0);
                    else rowBD[idx] += ((r.treatments as any)[k] || 0);
                });
            });
            return { id: c.id, name: c.name, totals: rowBD, sum: rowBD.reduce((a,b) => a+b, 0) };
        });

        const grandSumCurrent = currentTotals.reduce((a, b) => a + b, 0);
        const grandSumPrev = prevTotals.reduce((a, b) => a + b, 0);
        const getGrowth = (curr: number, prev: number) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return ((curr - prev) / prev) * 100;
        };

        return { 
            pieData, tableData, labels, 
            summary: {
                current: currentTotals,
                growth: keys.map((_, i) => getGrowth(currentTotals[i], prevTotals[i])),
                totalCurrent: grandSumCurrent,
                totalGrowth: getGrowth(grandSumCurrent, grandSumPrev)
            }
        };
    }, [monthlyRows, prevMonthlyRows, sortedClinics, breakdownFilter]);

    const marketingAnalytics = useMemo(() => {
        const records = marketingFilter === 'all' ? chartFilteredRecords : chartFilteredRecords.filter(r => r.clinicId === marketingFilter);
        const leads = records.length;
        const visited = records.filter(r => r.isVisited).length;
        const closed = records.filter(r => r.isClosed).length;
        const funnelData = [{ name: 'Leads (NP)', value: leads, fill: '#818cf8' }, { name: 'Visited (已診)', value: visited, fill: '#34d399' }, { name: 'Closed (成交)', value: closed, fill: '#f472b6' }];
        
        const consultantMap: Record<string, { leads: number, closed: number, revenue: number }> = {};
        records.forEach(r => {
            const name = r.consultant ? (staffMap[r.consultant] || 'Unknown') : '未指定';
            if (!consultantMap[name]) consultantMap[name] = { leads: 0, closed: 0, revenue: 0 };
            consultantMap[name].leads++;
            if (r.isClosed) { consultantMap[name].closed++; consultantMap[name].revenue += r.dealAmount || 0; }
        });
        const scorecard = Object.keys(consultantMap)
            .map(name => ({ name, ...consultantMap[name], rate: consultantMap[name].leads > 0 ? (consultantMap[name].closed / consultantMap[name].leads) * 100 : 0 }))
            .sort((a,b) => b.revenue - a.revenue);
        return { funnelData, scorecard };
    }, [chartFilteredRecords, marketingFilter, staffMap]);

    // Refactored Pie Chart Data (Permanently Source Mode)
    const marketingPieData = useMemo(() => {
        const filtered = chartFilteredRecords.filter(r => {
            const clinicMatch = pieClinicFilter === 'all' || r.clinicId === pieClinicFilter;
            const tagMatch = pieTagFilter === 'all' || (r.marketingTag || '未分類') === pieTagFilter;
            return clinicMatch && tagMatch;
        });

        const counts: Record<string, { value: number, visit: number, closed: number }> = {};
        filtered.forEach(r => {
            const source = r.source || '未分類';
            if (!counts[source]) counts[source] = { value: 0, visit: 0, closed: 0 };
            counts[source].value++;
            if (r.isVisited) counts[source].visit++;
            if (r.isClosed) counts[source].closed++;
        });

        return [...Object.entries(counts)]
            .map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.value - a.value);
    }, [chartFilteredRecords, pieClinicFilter, pieTagFilter]);

    // Reactive table data for NP records (Safe copy sort) - Always uses original npRecords
    const filteredNpRecords = useMemo(() => {
        const filtered = npRecords.filter(r => {
            if (tableFilters.date && r.date !== tableFilters.date) return false;
            if (getClinicName(r.clinicId) !== tableFilters.clinic && tableFilters.clinic) return false;
            if (tableFilters.doctor && (r.doctorName || r.doctor || '未指定') !== tableFilters.doctor) return false;
            if (tableFilters.consultant && (staffMap[r.consultant || ''] || '未指定') !== tableFilters.consultant) return false;
            if (tableFilters.tag && r.marketingTag !== tableFilters.tag) return false;
            if (tableFilters.source && r.source !== tableFilters.source) return false;
            if (tableFilters.status) {
                const today = new Date().toISOString().split('T')[0];
                let s = '';
                if (r.isClosed) s = '已成交';
                else if (r.isVisited) s = '已報到';
                else if (r.date > today) s = '待到診';
                else s = '未到診';
                
                if (s !== tableFilters.status) return false;
            }
            return true;
        });
        return [...filtered].sort((a: any, b: any) => b.date.localeCompare(a.date));
    }, [npRecords, tableFilters, clinics, staffMap]);

    // Reactive filter options based on available data (Safe copy sort)
    const filterOptions = useMemo(() => ({
        dates: [...new Set(npRecords.map(r => r.date))].sort((a: any, b: any) => b.localeCompare(a)),
        clinics: [...new Set(npRecords.map(r => getClinicName(r.clinicId)))].sort((a: any, b: any) => (CLINIC_ORDER[a as string] ?? 999) - (CLINIC_ORDER[b as string] ?? 999)),
        doctors: [...new Set(npRecords.map(r => r.doctorName || r.doctor || '未指定'))].sort(),
        consultants: [...new Set(npRecords.map(r => staffMap[r.consultant || ''] || '未指定'))].sort(),
        tags: [...new Set(npRecords.map(r => r.marketingTag || '未分類'))].sort(),
        sources: [...new Set(npRecords.map(r => r.source || '未分類'))].sort(),
        statuses: ['已成交', '已報到', '待到診', '未到診']
    }), [npRecords, clinics, staffMap]);

    const handleUpdateTarget = async (clinicId: string, type: 'revenue' | 'selfPay', value: string) => {
        const numVal = parseInt(value) || 0;
        setSnapshot(prev => ({
            ...prev,
            current: prev.current.map(c => {
                if (c.clinicId !== clinicId) return c;
                return {
                    ...c,
                    targets: { ...c.targets, [type === 'revenue' ? 'revenueTarget' : 'selfPayTarget']: numVal }
                };
            })
        }));
        try {
            const currentItem = snapshot.current.find(c => c.clinicId === clinicId);
            if (!currentItem) return;
            const updatedTarget: MonthlyTarget = {
                ...currentItem.targets,
                [type === 'revenue' ? 'revenueTarget' : 'selfPayTarget']: numVal
            };
            await saveMonthlyTarget(clinicId, currentMonth, updatedTarget);
        } catch (e) {
            console.error("[GroupDashboard] Failed to save target", e);
        }
    };

    const handleDeleteNP = async (id: string, clinicId: string, date: string, patientName: string) => {
        if (!confirm("確定刪除此筆 NP 紀錄？")) return;
        try {
            await deleteNPRecord(clinicId, date, patientName);
            // No need for manual state filter because onSnapshot will handle it.
        } catch (e) {
            alert("刪除失敗");
        }
    };

    const renderNPStatus = (r: NPRecord) => {
        const today = new Date().toISOString().split('T')[0];
        if (r.isClosed) return <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full text-[10px] font-black border border-emerald-100 flex items-center gap-1 w-fit shadow-sm"><CheckCircle size={12}/> 已成交</span>;
        if (r.isVisited) return <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-[10px] font-black border border-blue-100 flex items-center gap-1 w-fit shadow-sm"><User size={12}/> 已報到</span>;
        if (r.date > today) return <span className="bg-slate-50 text-slate-500 px-2 py-1 rounded-full text-[10px] font-black border border-slate-100 flex items-center gap-1 w-fit shadow-sm"><Clock size={12}/> 待到診</span>;
        return <span className="bg-rose-50 text-rose-600 px-2 py-1 rounded-full text-[10px] font-black border border-rose-100 flex items-center gap-1 w-fit shadow-sm"><AlertCircle size={12}/> 未到診</span>;
    };

    return (
        <div className="space-y-8 pb-12 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div><h2 className="text-3xl font-black text-slate-800 flex items-center gap-3"><div className="p-2 bg-indigo-600 rounded-xl text-white"><BarChart2 size={24} /></div>集團營運儀表板</h2><p className="text-slate-500 font-medium ml-12">全集團診所數據監測與行銷轉化分析 (BI)</p></div>
                <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-100"><Calendar className="text-slate-400 ml-2" size={18} /><input type="month" className="bg-transparent font-black text-slate-700 outline-none pr-4 cursor-pointer" value={currentMonth} onChange={e => setCurrentMonth(e.target.value)}/><div className="w-px h-6 bg-slate-200 mx-1"></div>{isLoading ? <Loader2 className="animate-spin text-indigo-500 mx-2" size={20} /> : <Activity size={20} className="text-emerald-500 mx-2" />}</div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <KPICard title="總營收 (Total Revenue)" actual={totals.current.revenue} target={totals.current.targetRevenue} prev={totals.prev.revenue} yearPrev={totals.yearPrev.revenue} prefix="$" colorClass="text-indigo-600" isActive={activeTab === 'revenue'} onClick={() => setActiveTab('revenue')} icon={DollarSign} />
                <KPICard title="自費營收 (Self-Pay)" actual={totals.current.selfPay} target={totals.current.targetSelfPay} prev={totals.prev.selfPay} yearPrev={totals.yearPrev.selfPay} prefix="$" colorClass="text-purple-600" isActive={activeTab === 'self-pay'} onClick={() => setActiveTab('self-pay')} icon={PieChartIcon} />
                <KPICard title="NP 成交轉換 (NP Conversion)" actual={totals.marketing.closed} customRate={totals.marketing.leads > 0 ? (totals.marketing.closed / totals.marketing.leads) * 100 : 0} customSubtext={`本月進單: ${totals.marketing.leads} / 已報到: ${totals.marketing.visited}`} isActive={activeTab === 'marketing'} onClick={() => setActiveTab('marketing')} icon={Users} colorClass="text-emerald-600" />
            </div>

            {activeTab === 'revenue' && (
                <div className="space-y-6 animate-fade-in">
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><LineChart className="text-indigo-500" size={22} /> 每日營收趨勢 (Stacked Trend)</h3>
                            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border"><Filter size={14} className="text-slate-400 ml-2" /><select className="bg-transparent text-xs font-black text-slate-600 py-1.5 px-2 outline-none cursor-pointer" value={trendFilter} onChange={e => setTrendFilter(e.target.value)}><option value="all">全集團 (Stacked)</option>{sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                        </div>
                        <div className="h-96 w-full"><RevenueTrendChart data={dailyTrendData} sortedClinics={sortedClinics} filterId={trendFilter} getClinicName={getClinicName} /></div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-6 h-auto md:h-[500px]">
                        <div className="w-full md:w-2/3 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[300px] md:h-full">
                             <div className="flex justify-between items-center mb-6 shrink-0">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Target className="text-indigo-600" /> 院所達成率圖表 (Revenue Achievement)</h3>
                             </div>
                             <div className="flex-1 min-h-0 w-full">
                                <KPIProgressChart 
                                    data={performanceMatrix.map(p => ({ 
                                        name: p.name, 
                                        actual: p.revenueActual, 
                                        target: p.revenueTarget,
                                        rate: p.revenueRate
                                    }))} 
                                    color="#6366f1" 
                                />
                             </div>
                        </div>

                        <div className="w-full md:w-1/3 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[400px] md:h-full overflow-hidden">
                            <div className="sticky top-0 bg-white z-10 p-5 border-b border-slate-50 flex items-center gap-2 text-slate-800 shrink-0">
                                <Medal className="text-amber-500" />
                                <h3 className="font-black uppercase tracking-wider text-sm">達成排行榜 (Ranking)</h3>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 pt-2 space-y-3">
                                {achievementRanking.map((item, idx) => {
                                    let RankIcon = null;
                                    let rankColor = "bg-slate-100 text-slate-500";
                                    let rowBg = "bg-slate-50 border-slate-100";
                                    let nameColor = "text-slate-700";

                                    if (idx === 0) {
                                        RankIcon = "🥇";
                                        rankColor = "bg-amber-100 text-amber-600";
                                        rowBg = "bg-amber-50/50 border-amber-100 ring-1 ring-amber-200/50 shadow-sm";
                                        nameColor = "text-amber-900";
                                    } else if (idx === 1) {
                                        RankIcon = "🥈";
                                        rankColor = "bg-slate-100 text-slate-500";
                                        rowBg = "bg-slate-100/50 border-slate-200";
                                    } else if (idx === 2) {
                                        RankIcon = "🥉";
                                        rankColor = "bg-orange-100 text-orange-600";
                                        rowBg = "bg-orange-50/30 border-orange-100";
                                    }

                                    return (
                                        <div key={item.id} className={`p-3 rounded-xl border transition-all ${rowBg}`}>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs ${rankColor}`}>
                                                        {RankIcon || (idx + 1)}
                                                    </div>
                                                    <span className={`font-bold text-sm ${nameColor}`}>{item.name}</span>
                                                </div>
                                                <span className={`font-black tabular-nums text-sm ${item.revenueRate >= 100 ? 'text-emerald-600' : item.revenueRate >= 80 ? 'text-amber-600' : 'text-rose-500'}`}>
                                                    {item.revenueRate.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="w-full h-1.5 bg-white/50 rounded-full overflow-hidden border border-slate-200/30">
                                                <div 
                                                    className={`h-full transition-all duration-1000 ease-out ${item.revenueRate >= 100 ? 'bg-emerald-500' : item.revenueRate >= 80 ? 'bg-amber-400' : 'bg-rose-400'}`}
                                                    style={{ width: `${Math.min(item.revenueRate, 100)}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between mt-1.5 text-[9px] text-slate-400 font-bold uppercase">
                                                <span>實收: ${item.revenueActual.toLocaleString()}</span>
                                                <span>目標: ${item.revenueTarget.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center"><h3 className="font-bold text-slate-700 flex items-center gap-2"><Trophy size={18} className="text-amber-500" /> 各院所績效目標設定 Matrix</h3><div className="text-[10px] text-slate-400 font-bold bg-white px-3 py-1 rounded-full border border-slate-200 flex items-center gap-1">
                                <InfoIcon size={12}/> 輸入後點擊外框或按 Enter 儲存
                            </div></div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-white border-b border-slate-100 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                    <tr>
                                        <th className="px-6 py-4 sticky left-0 bg-white z-10 border-r">診所</th>
                                        <th className="px-4 py-4 text-center bg-indigo-50/30" colSpan={3}>總營收目標設定 (Revenue Target)</th>
                                        <th className="px-4 py-4 text-center bg-purple-50/30" colSpan={3}>自費目標設定 (Self-Pay Target)</th>
                                    </tr>
                                    <tr className="bg-slate-50/50">
                                        <th className="sticky left-0 bg-slate-50 border-r"></th>
                                        <th className="px-4 py-2 text-center text-indigo-600">目標金額</th>
                                        <th className="px-4 py-2 text-right">當前實際</th>
                                        <th className="px-4 py-2 text-center">目前達成率</th>
                                        <th className="px-4 py-2 text-center text-purple-600">目標金額</th>
                                        <th className="px-4 py-2 text-right">當前實際</th>
                                        <th className="px-4 py-2 text-center">目前達成率</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {performanceMatrix.map(d => (
                                        <tr key={d.name} className="hover:bg-slate-50 transition-colors group">
                                            <td className="px-6 py-4 font-bold text-slate-700 sticky left-0 bg-white border-r z-10">{d.name}</td>
                                            <td className="px-4 py-4 text-center bg-indigo-50/10">
                                                <div className="flex items-center gap-1 justify-center">
                                                    <span className="text-slate-400 font-mono">$</span>
                                                    <input 
                                                        type="number"
                                                        className="w-32 bg-white border border-slate-200 rounded px-2 py-1 text-sm font-black text-indigo-700 focus:ring-2 focus:ring-indigo-500 outline-none text-right tabular-nums shadow-inner transition-all hover:border-indigo-300"
                                                        defaultValue={d.revenueTarget}
                                                        onBlur={(e) => handleUpdateTarget(d.id, 'revenue', e.target.value)}
                                                        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-right font-mono font-bold text-slate-600">${d.revenueActual.toLocaleString()}</td>
                                            <td className="px-4 py-4 text-center">
                                                <span className={`px-2 py-1 rounded-full font-bold text-[10px] ${d.revenueRate >= 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                                    {d.revenueRate.toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-center bg-purple-50/10">
                                                <div className="flex items-center gap-1 justify-center">
                                                    <span className="text-slate-400 font-mono">$</span>
                                                    <input 
                                                        type="number"
                                                        className="w-32 bg-white border border-slate-200 rounded px-2 py-1 text-sm font-black text-purple-700 focus:ring-2 focus:ring-purple-500 outline-none text-right tabular-nums shadow-inner transition-all hover:border-purple-300"
                                                        defaultValue={d.selfPayTarget}
                                                        onBlur={(e) => handleUpdateTarget(d.id, 'selfPay', e.target.value)}
                                                        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-right font-mono font-bold text-slate-600">${d.selfPayActual.toLocaleString()}</td>
                                            <td className="px-4 py-4 text-center">
                                                <span className={`px-2 py-1 rounded-full font-bold text-[10px] ${d.selfPayRate >= 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                                    {d.selfPayRate.toFixed(1)}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'self-pay' && (
                <div className="space-y-6 animate-fade-in">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-auto lg:h-[500px]">
                        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
                             <div className="flex justify-between items-center mb-8 shrink-0">
                                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Target className="text-purple-600" /> 自費目標達成狀況</h3>
                             </div>
                             <div className="flex-1 min-h-[400px]">
                                <SelfPayAchievementChart data={performanceMatrix.map(p => ({
                                    name: p.name,
                                    target: p.selfPayTarget,
                                    actual: p.selfPayActual,
                                    rate: p.selfPayRate
                                }))} />
                             </div>
                        </div>

                        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col shrink-0">
                            <div className="flex justify-between items-center mb-6 shrink-0">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><PieChartIcon size={20} className="text-teal-500" /> 項目佔比分析</h3>
                                <select className="bg-slate-50 text-[10px] font-black p-1 border rounded" value={breakdownFilter} onChange={e => setBreakdownFilter(e.target.value)}><option value="all">全集團</option>{sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                            </div>
                            <div className="flex-1 min-h-[300px]">
                                <SelfPayBreakdownChart data={selfPayAnalytics.pieData} />
                            </div>
                            <div className="mt-4 space-y-2 overflow-y-auto max-h-32 custom-scrollbar pr-1 shrink-0">
                                {selfPayAnalytics.pieData.map((d, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                            <span className="font-medium text-slate-600">{d.name}</span>
                                        </div>
                                        <span className="font-bold text-slate-900">${d.value.toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 bg-purple-50 border-b border-purple-100 flex justify-between items-center"><h3 className="font-bold text-purple-900">自費項目詳細報表 (Detailed Breakdown)</h3></div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10 border-r">診所</th>
                                        {selfPayAnalytics.labels.map(l => <th key={l} className="px-4 py-3 text-right">{l}</th>)}
                                        <th className="px-4 py-3 text-right bg-purple-50 text-purple-700 font-black">小計</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {selfPayAnalytics.tableData.map(row => (
                                        <tr key={row.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 font-bold text-slate-700 sticky left-0 bg-white border-r z-10">{row.name}</td>
                                            {row.totals.map((v, i) => <td key={i} className="px-4 py-3 text-right font-mono text-slate-500">{v > 0 ? v.toLocaleString() : '-'}</td>)}
                                            <td className="px-4 py-3 text-right font-black text-purple-600 bg-purple-50/30">${row.sum.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-100 font-black text-slate-800 border-t-2 border-slate-300">
                                    <tr>
                                        <td className="px-4 py-4 sticky left-0 bg-slate-100 border-r z-20">全集團總計 / MoM</td>
                                        {selfPayAnalytics.summary.current.map((val, i) => (
                                            <td key={i} className="px-4 py-4 text-right">
                                                <div>${val.toLocaleString()}</div>
                                                <div className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${selfPayAnalytics.summary.growth[i] >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{selfPayAnalytics.summary.growth[i] >= 0 ? <ArrowUp size={10}/> : <ArrowDown size={10}/>}{Math.abs(selfPayAnalytics.summary.growth[i]).toFixed(1)}%</div>
                                            </td>
                                        ))}
                                        <td className="px-4 py-4 text-right bg-purple-100/50"><div>${selfPayAnalytics.summary.totalCurrent.toLocaleString()}</div><div className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${selfPayAnalytics.summary.totalGrowth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{selfPayAnalytics.summary.totalGrowth >= 0 ? <ArrowUp size={10}/> : <ArrowDown size={10}/>}{Math.abs(selfPayAnalytics.summary.totalGrowth).toFixed(1)}%</div></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'marketing' && (
                <div className="space-y-6 animate-fade-in">
                    {/* Global Filter Toolbar for Marketing */}
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                         <div className="flex items-center gap-2">
                             <div className="p-2 bg-rose-50 rounded-lg text-rose-600">
                                 <Filter size={18} />
                             </div>
                             <span className="font-bold text-slate-700">行銷數據篩選 (Filters)</span>
                         </div>
                         <div className="flex items-center gap-4">
                             <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 hover:border-indigo-300 transition-all select-none group">
                                 <input 
                                    type="checkbox" 
                                    checked={excludeNHI}
                                    onChange={e => setExcludeNHI(e.target.checked)}
                                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                                 />
                                 <div className="flex items-center gap-1.5">
                                    <ShieldX size={14} className={excludeNHI ? "text-rose-500" : "text-slate-400"} />
                                    <span className={`text-sm font-black ${excludeNHI ? "text-indigo-600" : "text-slate-500"}`}>排除健保項目 (Exclude NHI)</span>
                                 </div>
                             </label>
                         </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                             <h3 className="text-xl font-bold text-slate-800 mb-8 flex items-center gap-2"><Target size={22} className="text-rose-500" /> 顧客轉化漏斗</h3>
                             <div className="h-72"><MarketingFunnelChart data={marketingAnalytics.funnelData} /></div>
                             <div className="mt-4 grid grid-cols-3 gap-4"><div className="text-center"><div className="text-[10px] text-slate-400 font-bold uppercase">總報名</div><div className="text-xl font-black text-indigo-600">{marketingAnalytics.funnelData[0].value}</div></div><div className="text-center border-l border-slate-100"><div className="text-[10px] text-slate-400 font-bold uppercase">到診率</div><div className="text-xl font-black text-teal-600">{marketingAnalytics.funnelData[0].value > 0 ? (marketingAnalytics.funnelData[1].value / marketingAnalytics.funnelData[0].value * 100).toFixed(0) : 0}%</div></div><div className="text-center border-l border-slate-100"><div className="text-[10px] text-slate-400 font-bold uppercase">最終成交</div><div className="text-xl font-black text-rose-600">{marketingAnalytics.funnelData[2].value}</div></div></div>
                        </div>
                        
                        {/* Refactored Customer Profile Card: Sources Analysis with Filters */}
                        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 shrink-0 gap-4">
                                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><PieChartIcon className="text-indigo-500" /> 客群來源分析 (Source)</h3>
                                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                                    <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border">
                                        <Filter size={12} className="text-slate-400 ml-1.5" />
                                        <select 
                                            className="bg-transparent text-[10px] font-black text-slate-600 py-1 px-1 outline-none cursor-pointer" 
                                            value={pieClinicFilter} 
                                            onChange={e => setPieClinicFilter(e.target.value)}
                                        >
                                            <option value="all">全集團診所</option>
                                            {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border">
                                        <Tag size={12} className="text-slate-400 ml-1.5" />
                                        <select 
                                            className="bg-transparent text-[10px] font-black text-slate-600 py-1 px-1 outline-none cursor-pointer" 
                                            value={pieTagFilter} 
                                            onChange={e => setPieTagFilter(e.target.value)}
                                        >
                                            <option value="all">全部標籤</option>
                                            {availableMarketingTags.map(({ tag }) => <option key={tag} value={tag}>{tag}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex flex-col md:flex-row items-center gap-8 flex-1 min-h-[400px]">
                                <div className="w-full md:w-1/2 h-[350px]">
                                    <SelfPayBreakdownChart data={marketingPieData} hideLegend isCurrency={false} />
                                </div>
                                <div className="w-full md:w-1/2 max-h-[350px] overflow-y-auto custom-scrollbar pr-2 py-4">
                                    <div className="space-y-3">
                                        {marketingPieData.map((d, i) => (
                                            <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 shadow-sm transition-all hover:bg-white hover:border-indigo-200">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: PIE_COLORS[marketingPieData.indexOf(d) % PIE_COLORS.length] }}></div>
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-slate-700 truncate text-sm">{d.name}</span>
                                                        <span className="text-[10px] text-slate-400 font-bold uppercase">Source Channel</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4 shrink-0">
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 min-w-[80px] text-center tabular-nums">
                                                                {d.value}.{d.visit}.{d.closed}
                                                            </span>
                                                            <span className="text-[9px] text-slate-400 font-bold uppercase mt-0.5 mr-1">[約.到.成]</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {marketingPieData.length === 0 && (
                                            <div className="text-center py-12 text-slate-400 italic text-sm">無相關數據</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-center gap-2"><Trophy size={20} className="text-amber-500" /><h3 className="font-bold text-slate-700">諮詢師轉化戰報</h3></div>
                        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-white text-[10px] text-slate-400 font-bold uppercase tracking-widest border-b border-slate-100"><tr><th className="px-6 py-4">諮詢師姓名</th><th className="px-4 py-4 text-right">進單數</th><th className="px-4 py-4 text-right">成交數</th><th className="px-4 py-4 text-center">成交率 (%)</th><th className="px-6 py-4 text-right bg-slate-50 text-indigo-600">成交總額</th></tr></thead><tbody className="divide-y divide-slate-50">{marketingAnalytics.scorecard.map((c, idx) => (<tr key={c.name} className="hover:bg-indigo-50/20 transition-colors"><td className="px-6 py-4 font-bold text-slate-700 flex items-center gap-2">{idx === 0 && <Star size={14} className="text-amber-400 fill-amber-400" />}{c.name}</td><td className="px-4 py-4 text-right font-mono">{c.leads}</td><td className="px-4 py-4 text-right font-mono font-bold">{c.closed}</td><td className="px-4 py-4 text-center"><div className="flex items-center justify-center gap-2"><div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500" style={{ width: `${c.rate}%` }}></div></div><span className="font-black text-slate-700 w-10">{c.rate.toFixed(0)}%</span></div></td><td className="px-6 py-4 text-right font-mono font-black text-indigo-700 bg-slate-50/50">${c.revenue.toLocaleString()}</td></tr>))}</tbody></table></div>
                    </div>

                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><LineChart className="text-indigo-500" size={22} /> 每日 NP 轉化趨勢 (Stacked Trend)</h3>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border">
                                    <Tag size={14} className="text-slate-400 ml-2" />
                                    <select className="bg-transparent text-xs font-black text-slate-600 py-1.5 px-2 outline-none cursor-pointer" value={selectedTagFilter} onChange={e => setSelectedTagFilter(e.target.value)}>
                                        <option value="all">全部項目 ({chartFilteredRecords.length})</option>
                                        {availableMarketingTags.map(({ tag, count }) => (
                                            <option key={tag} value={tag}>{tag} ({count})</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border">
                                    <Filter size={14} className="text-slate-400 ml-2" />
                                    <select className="bg-transparent text-xs font-black text-slate-600 py-1.5 px-2 outline-none cursor-pointer" value={marketingFilter} onChange={e => setMarketingFilter(e.target.value)}>
                                        <option value="all">全集團 (All Clinics)</option>
                                        {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="h-96 w-full"><MarketingTrendChart data={marketingTrendData} sortedClinics={sortedClinics} filterId={marketingFilter} /></div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center"><h3 className="font-bold text-slate-700">NP 進單明細原始資料 (Raw Data)</h3><div className="text-[10px] text-slate-400 font-bold bg-white px-3 py-1 rounded-full border border-slate-200">點擊列可編輯狀態</div></div>
                        <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                             <table className="w-full text-sm text-left">
                                <thead className="bg-white border-b border-slate-100 sticky top-0 z-20 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-4 w-28 bg-slate-50/50"><TableHeaderFilter label="日期" value={tableFilters.date} onChange={(v: string) => setTableFilters(f => ({...f, date: v}))} options={filterOptions.dates} /></th>
                                        <th className="px-4 py-4 w-32 text-[10px] text-slate-400 font-bold uppercase">姓名</th>
                                        <th className="px-4 py-4 bg-slate-50/50"><TableHeaderFilter label="診所" value={tableFilters.clinic} onChange={(v: string) => setTableFilters(f => ({...f, clinic: v}))} options={filterOptions.clinics} /></th>
                                        <th className="px-4 py-4 bg-slate-50/50"><TableHeaderFilter label="醫師" value={tableFilters.doctor} onChange={(v: string) => setTableFilters(f => ({...f, doctor: v}))} options={filterOptions.doctors} /></th>
                                        <th className="px-4 py-4 text-[10px] text-slate-400 font-bold uppercase">療程內容</th>
                                        <th className="px-4 py-4 bg-slate-50/50"><TableHeaderFilter label="標籤" value={tableFilters.tag} onChange={(v: string) => setTableFilters(f => ({...f, tag: v}))} options={filterOptions.tags} /></th>
                                        <th className="px-4 py-4 bg-slate-50/50"><TableHeaderFilter label="管道" value={tableFilters.source} onChange={(v: string) => setTableFilters(f => ({...f, source: v}))} options={filterOptions.sources} /></th>
                                        <th className="px-4 py-4 bg-slate-50/50"><TableHeaderFilter label="諮詢師" value={tableFilters.consultant} onChange={(v: string) => setTableFilters(f => ({...f, consultant: v}))} options={filterOptions.consultants} /></th>
                                        <th className="px-4 py-4 bg-slate-50/50"><TableHeaderFilter label="狀態" value={tableFilters.status} onChange={(v: string) => setTableFilters(f => ({...f, status: v}))} options={filterOptions.statuses} /></th>
                                        <th className="px-4 py-4 w-10 text-center text-[10px] text-slate-400 font-bold uppercase">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredNpRecords.map(r => (<tr key={r.id} className="hover:bg-indigo-50/10 cursor-pointer transition-colors group" onClick={() => setEditingNP(r)}><td className="px-4 py-4 font-mono text-slate-500">{r.date.slice(5)}</td><td className="px-4 py-4 font-black text-slate-700">{r.patientName}</td><td className="px-4 py-4 text-slate-500 font-bold text-xs">{getClinicName(r.clinicId)}</td><td className="px-4 py-4 text-slate-500 text-xs font-bold">{r.doctorName || r.doctor || '未指定'}</td><td className="px-4 py-4 text-slate-400 text-[10px] truncate max-w-[120px]">{r.treatment || '-'}</td><td className="px-4 py-4"><span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-lg border border-indigo-100 text-[10px] font-bold whitespace-nowrap">{r.marketingTag || '-'}</span></td><td className="px-4 py-4 text-slate-500 text-xs font-bold">{r.source || '-'}</td><td className="px-4 py-4 text-slate-500 text-xs font-bold">{staffMap[r.consultant || ''] || '未指定'}</td><td className="px-4 py-4">{renderNPStatus(r)}</td><td className="px-4 py-4 text-center"><button onClick={(e) => { e.stopPropagation(); handleDeleteNP(r.id!, r.clinicId, r.date, r.patientName); }} className="text-slate-300 hover:text-rose-500 p-2 rounded-full hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100" title="刪除"><Trash2 size={16}/></button></td></tr>))}
                                    {filteredNpRecords.length === 0 && (<tr><td colSpan={10} className="p-12 text-center text-slate-400 font-medium">查無相關進單資料</td></tr>)}
                                </tbody>
                             </table>
                        </div>
                    </div>
                </div>
            )}
            {editingNP && <NPStatusModal isOpen={!!editingNP} onClose={() => setEditingNP(null)} row={editingNP as any} clinicId={editingNP.clinicId} date={editingNP.date} />}
        </div>
    );
};