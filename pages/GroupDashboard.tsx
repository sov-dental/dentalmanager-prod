import React, { useState, useEffect, useMemo, memo } from 'react';
import { Clinic, Consultant, NPRecord, UserRole, ClinicMonthlySummary, AccountingRow, MonthlyTarget } from '../types';
import { 
    fetchDashboardSnapshot, auth, 
    getMonthlyAccounting, CLINIC_ORDER, 
    getStaffList, db,
    saveMonthlyTarget, deleteNPRecord, updateNPRecord, getMarketingTags, saveNPRecord
} from '../services/firebase';
import { listEvents, initGoogleClient, authorizeCalendar } from '../services/googleCalendar';
import { parseCalendarEvent, parseSourceFromNote } from '../utils/eventParser';
import { UnauthorizedPage } from '../components/UnauthorizedPage';
import { NPStatusModal } from '../components/NPStatusModal';
import { 
    BarChart2, TrendingUp, Users, DollarSign, Calendar, 
    ArrowUpRight, ArrowDownRight, Loader2, 
    Trophy, Activity, Target, PieChart as PieChartIcon,
    Filter, LineChart, CheckCircle, ArrowUp, ArrowDown,
    Medal, Star, Trash2, Clock, AlertCircle, User, Info as InfoIcon,
    Tag, MessageCircle, ShieldOff, RefreshCw, PlugZap, LayoutGrid
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, ComposedChart, Line, LabelList
} from 'recharts';

// --- TYPES & INTERFACES ---

interface Props {
    clinics: Clinic[];
    userRole?: UserRole;
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    valuePrefix?: string;
    isCount?: boolean;
    sortedClinics?: Clinic[];
    isMarketing?: boolean;
}

// --- CONSTANTS ---

const PIE_COLORS = ['#818cf8', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#ec4899', '#06b6d4', '#14b8a6', '#6366f1'];
const CLINIC_COLORS = ['#6366f1', '#a855f7', '#10b981', '#f59e0b', '#f43f5e', '#ec4899', '#06b6d4'];

// --- MEMOIZED SUB-COMPONENTS ---

const CustomTooltip = memo(({ active, payload, label, valuePrefix = '$', sortedClinics = [], isMarketing = false }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
        if (isMarketing) {
            // Read from the raw data object stored in the first entry of the payload
            const dayData = payload[0].payload;
            const totalStats = dayData.total_stats || '0.0.0';

            return (
                <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl text-xs min-w-[200px]">
                    <div className="font-black text-slate-800 mb-2 border-b border-slate-100 pb-2">
                        <div className="flex justify-between items-center mb-1">
                            <span>第 {label} 日</span>
                            <span className="text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                [總計: {totalStats}]
                            </span>
                        </div>
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                        {sortedClinics.map((clinic: Clinic) => {
                            const stats = dayData[`${clinic.id}_stats`];
                            if (!stats || stats === '0.0.0') return null;

                            const originalIndex = sortedClinics.findIndex((sc: Clinic) => sc.id === clinic.id);
                            return (
                                <div key={clinic.id} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CLINIC_COLORS[originalIndex % CLINIC_COLORS.length] }}></div>
                                        <span className="font-bold text-slate-700">{clinic.name}:</span>
                                    </div>
                                    <span className="font-mono text-slate-600 bg-slate-50 px-1.5 rounded border border-slate-100">
                                        {stats}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

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
                    <div className={`p-2 rounded-lg ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-50'}`}>{Icon && <Icon size={20} />}</div>
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

const RevenueTrendChart = memo(({ data, sortedClinics, filterId }: any) => {
    const visibleClinics = filterId === 'all' ? sortedClinics : sortedClinics.filter((c: Clinic) => c.id === filterId);
    
    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `$${v/1000}k`} />
                <Tooltip content={<CustomTooltip valuePrefix="$" sortedClinics={sortedClinics} />} cursor={{ fill: '#f8fafc' }} />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold' }} />
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
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} />
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
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} />
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

const SelfPayBreakdownChart = memo(({ data }: any) => {
    const total = data.reduce((s: number, i: any) => s + (i.value || 0), 0);

    const renderCustomLegend = (props: any) => {
        const { payload } = props;
        if (!payload || payload.length === 0) return null; // Safety guard clause

        return (
            <ul className="flex flex-col gap-1.5 mt-4 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                {payload.map((entry: any, index: number) => {
                    const value = entry.payload?.value || 0;
                    const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                    return (
                        <li key={`item-${index}`} className="flex items-center justify-between text-[11px] group">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></div>
                                <span className="text-slate-500 font-bold group-hover:text-slate-900 transition-colors">{entry.value}</span>
                            </div>
                            <span className="font-mono font-black text-slate-700">
                                ${value.toLocaleString()} 
                                <span className="text-slate-400 font-medium ml-1.5">({percent}%)</span>
                            </span>
                        </li>
                    );
                })}
            </ul>
        );
    };

    return (
        <ResponsiveContainer width="100%" height="100%">
            <PieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="40%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                >
                    {data.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip 
                    formatter={(v: number) => `$${v.toLocaleString()}`}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Legend content={renderCustomLegend} />
            </PieChart>
        </ResponsiveContainer>
    );
});

const MarketingTrendChart = memo(({ data, sortedClinics, filterId }: any) => {
    const visibleClinics = filterId === 'all' ? sortedClinics : sortedClinics.filter((c: Clinic) => c.id === filterId);
    
    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip isMarketing={true} sortedClinics={sortedClinics} />} cursor={{ fill: '#f8fafc' }} />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold' }} />
                {visibleClinics.map((clinic: Clinic) => {
                    const originalIndex = sortedClinics.findIndex((sc: Clinic) => sc.id === clinic.id);
                    const color = CLINIC_COLORS[originalIndex % CLINIC_COLORS.length];
                    return (
                        <Bar 
                            key={clinic.id}
                            stackId="a" 
                            dataKey={`appt_${clinic.id}`} 
                            name={clinic.name}
                            fill={color} 
                            isAnimationActive={false} 
                        />
                    );
                })}
            </BarChart>
        </ResponsiveContainer>
    );
});

const MarketingConversionChart = memo(({ data }: any) => (
    <ResponsiveContainer width="100%" height="100%">
        <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 20, right: 60, left: 20, bottom: 20 }}
        >
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={100} axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 'bold', fill: '#64748b' }} />
            <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
            <Bar dataKey="value" barSize={35} radius={[0, 10, 10, 0]}>
                <LabelList dataKey="value" position="right" offset={10} style={{ fontSize: '14px', fontWeight: 'bold', fill: '#1e293b' }} />
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
            {Array.isArray(options) && options.map((opt: any) => <option key={String(opt)} value={String(opt)}>{String(opt)}</option>)}
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
    const [trendTagFilter, setTrendTagFilter] = useState('all');
    
    const [pieClinicFilter, setPieClinicFilter] = useState('all');
    const [pieTagFilter, setPieTagFilter] = useState('all');

    const [excludeNHI, setExcludeNHI] = useState(false);
    const [isSyncingNP, setIsSyncingNP] = useState(false);
    const [isGoogleLoggedIn, setIsGoogleLoggedIn] = useState(false);

    // Column Filter States
    const [filterDate, setFilterDate] = useState('');
    const [filterClinic, setFilterClinic] = useState('');
    const [filterDoctor, setFilterDoctor] = useState('');
    const [filterTag, setFilterTag] = useState('');
    const [filterConsultant, setFilterConsultant] = useState('');
    const [filterSource, setFilterSource] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    const sortedClinics = useMemo(() => {
        return [...clinics].sort((a, b) => (CLINIC_ORDER[a.name] ?? 999) - (CLINIC_ORDER[b.name] ?? 999));
    }, [clinics]);
    
    const [snapshot, setSnapshot] = useState<{ current: ClinicMonthlySummary[], lastMonth: ClinicMonthlySummary[], lastYear: ClinicMonthlySummary[] }>({ current: [], lastMonth: [], lastYear: [] });
    const [monthlyRows, setMonthlyRows] = useState<Record<string, AccountingRow[]>>({});
    const [prevMonthlyRows, setPrevMonthlyRows] = useState<Record<string, AccountingRow[]>>({});
    const [npRecords, setNpRecords] = useState<NPRecord[]>([]);
    const [staffMap, setStaffMap] = useState<Record<string, string>>({}); 
    const [marketingTags, setMarketingTags] = useState<string[]>([]);
    const [editingNP, setEditingNP] = useState<NPRecord | null>(null);

    // Google API Init
    useEffect(() => {
        initGoogleClient(
            () => {},
            (status) => setIsGoogleLoggedIn(status)
        );
        getMarketingTags().then(setMarketingTags);
    }, []);

    // Main Data Load (Static Snapshots)
    useEffect(() => {
        if (!clinics.length) return;

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

        loadStaticData();
    }, [currentMonth, clinics]);

    // NP Real-time Listener (Source of Truth for NP Dashboard)
    useEffect(() => {
        if (!clinics.length || !currentMonth) return;
        
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
                    if (allowedIds.has(data.clinicId) && !data.isHidden) {
                        newNp.push({ id: doc.id, ...data });
                    }
                });
                setNpRecords(newNp);
            }, err => {
                console.error("[GroupDashboard] NP Snapshot Error", err);
            });

        return () => {
            unsubscribeNP();
        };
    }, [currentMonth, clinics]);

    const getClinicName = (id: string) => clinics.find(c => c.id === id)?.name || id;

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
            dataMap[d] = { 
                day: d, 
                total_appt: 0, 
                total_visit: 0, 
                total_closed: 0 
            };
            clinics.forEach(c => {
                dataMap[d][`appt_${c.id}`] = 0;
                dataMap[d][`visit_${c.id}`] = 0;
                dataMap[d][`closed_${c.id}`] = 0;
            });
        }

        npRecords.forEach(r => {
            // Apply Exclude NHI Filter
            if (excludeNHI && r.marketingTag && r.marketingTag.includes('健保')) return;

            if (trendTagFilter !== 'all' && (r.marketingTag || '未分類') !== trendTagFilter) return;
            
            const d = parseInt(r.date.split('-')[2]);
            if (dataMap[d]) {
                const cid = r.clinicId;
                dataMap[d][`appt_${cid}`]++;
                dataMap[d].total_appt++;
                if (r.isVisited) {
                    dataMap[d][`visit_${cid}`]++;
                    dataMap[d].total_visit++;
                }
                if (r.isClosed) {
                    dataMap[d][`closed_${cid}`]++;
                    dataMap[d].total_closed++;
                }
            }
        });

        // Compute string representations for tooltip stability
        Object.values(dataMap).forEach((dayData: any) => {
            clinics.forEach(c => {
                const appt = dayData[`appt_${c.id}`] || 0;
                const visit = dayData[`visit_${c.id}`] || 0;
                const closed = dayData[`closed_${c.id}`] || 0;
                dayData[`${c.id}_stats`] = `${appt}.${visit}.${closed}`;
            });
            dayData['total_stats'] = `${dayData.total_appt}.${dayData.total_visit}.${dayData.total_closed}`;
        });

        return [...Object.values(dataMap)].sort((a, b) => a.day - b.day);
    }, [npRecords, clinics, currentMonth, trendTagFilter, excludeNHI]);

    const chartFilteredRecords = useMemo(() => {
        return npRecords.filter(r => {
            if (excludeNHI && (r.marketingTag || '').includes('健保')) return false;
            return true;
        });
    }, [npRecords, excludeNHI]);

    const trendTagOptions = useMemo(() => {
        const records = (marketingFilter === 'all' ? chartFilteredRecords : chartFilteredRecords.filter(r => r.clinicId === marketingFilter));
        const counts: Record<string, number> = {};
        records.forEach(r => {
            const tag = r.marketingTag || '未分類';
            counts[tag] = (counts[tag] || 0) + 1;
        });
        return {
            options: Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
            total: records.length
        };
    }, [chartFilteredRecords, marketingFilter]);

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
                visitActual: d.actualVisits,
                visitTarget: d.targets.visitTarget || 0,
                revenueRate: (d.targets.revenueTarget || 0) > 0 ? (d.actualRevenue / d.targets.revenueTarget) * 100 : 0,
                selfPayRate: (d.targets.selfPayTarget || 0) > 0 ? (d.actualSelfPay / d.targets.selfPayTarget) * 100 : 0,
                fullTarget: d.targets
            }));
    }, [snapshot.current]);

    const achievementRanking = useMemo(() => {
        return [...performanceMatrix].sort((a: any, b: any) => b.revenueRate - a.revenueRate);
    }, [performanceMatrix]);

    const selfPayAnalytics = useMemo(() => {
        const keys = ['implant', 'ortho', 'prostho', 'sov', 'inv', 'whitening', 'perio', 'otherSelfPay', 'retail'] as const;
        const labels = ['植牙', '矯正', '假牙', 'SOV', 'INV', '美白', '牙周', '其他', '物販/小金庫'];
        
        const globalCurrentTotals = keys.map(() => 0);
        const globalPrevTotals = keys.map(() => 0);

        const clinicBreakdown: Record<string, { name: string, current: number[], prev: number[], total: number }> = {};
        clinics.forEach(c => {
            clinicBreakdown[c.id] = { name: c.name, current: keys.map(() => 0), prev: keys.map(() => 0), total: 0 };
        });

        // 1. Process Current Month
        Object.entries(monthlyRows).forEach(([cid, rows]) => {
            if (!clinicBreakdown[cid]) return;
            rows.forEach(row => {
                const t = row.treatments as any;
                const r = row.retail;
                const rowTotal = (t.implant || 0) + (t.ortho || 0) + (t.prostho || 0) + (t.sov || 0) + (t.inv || 0) + (t.whitening || 0) + (t.perio || 0) + (t.otherSelfPay || 0) + (r.products || 0) + (r.diyWhitening || 0);
                clinicBreakdown[cid].total += rowTotal;

                keys.forEach((k, idx) => {
                    const amount = k === 'retail' ? (r.products || 0) + (r.diyWhitening || 0) : (t[k] || 0);
                    clinicBreakdown[cid].current[idx] += amount;
                    if (breakdownFilter === 'all' || breakdownFilter === cid) {
                        globalCurrentTotals[idx] += amount;
                    }
                });
            });
        });

        // 2. Process Previous Month
        Object.entries(prevMonthlyRows).forEach(([cid, rows]) => {
            if (!clinicBreakdown[cid]) return;
            rows.forEach(row => {
                const t = row.treatments as any;
                const r = row.retail;
                keys.forEach((k, idx) => {
                    const amount = k === 'retail' ? (r.products || 0) + (r.diyWhitening || 0) : (t[k] || 0);
                    clinicBreakdown[cid].prev[idx] += amount;
                    if (breakdownFilter === 'all' || breakdownFilter === cid) {
                        globalPrevTotals[idx] += amount;
                    }
                });
            });
        });

        const pieData = keys.map((k, i) => ({ name: labels[i], value: globalCurrentTotals[i] })).filter(d => d.value > 0);
        
        const grandSumCurrent = globalCurrentTotals.reduce((a, b) => a + b, 0);
        const grandSumPrev = globalPrevTotals.reduce((a, b) => a + b, 0);

        const getGrowth = (curr: number, prev: number) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return ((curr - prev) / prev) * 100;
        };

        const sortedClinicData = Object.values(clinicBreakdown).sort((a, b) => (CLINIC_ORDER[a.name] ?? 999) - (CLINIC_ORDER[b.name] ?? 999));

        return { 
            pieData, labels, 
            clinicMatrix: sortedClinicData,
            summary: {
                current: globalCurrentTotals,
                growth: keys.map((_, i) => getGrowth(globalCurrentTotals[i], globalPrevTotals[i])),
                totalCurrent: grandSumCurrent,
                totalPrev: grandSumPrev,
                totalGrowth: getGrowth(grandSumCurrent, grandSumPrev)
            }
        };
    }, [monthlyRows, prevMonthlyRows, clinics, breakdownFilter]);

    const marketingAnalytics = useMemo(() => {
        const records = marketingFilter === 'all' ? chartFilteredRecords : chartFilteredRecords.filter(r => r.clinicId === marketingFilter);
        const leads = records.length;
        const visited = records.filter(r => r.isVisited).length;
        const closed = records.filter(r => r.isClosed).length;
        
        const conversionData = [
            { name: '約診', value: leads, fill: '#818cf8' }, 
            { name: '到診', value: visited, fill: '#34d399' }, 
            { name: '成交', value: closed, fill: '#f472b6' }
        ];
        
        const consultantMap: Record<string, { leads: number, visited: number, closed: number }> = {};
        records.forEach(r => {
            const name = r.consultant ? (staffMap[r.consultant] || 'Unknown') : '未指定';
            if (!consultantMap[name]) consultantMap[name] = { leads: 0, visited: 0, closed: 0 };
            consultantMap[name].leads++;
            if (r.isVisited) consultantMap[name].visited++;
            if (r.isClosed) consultantMap[name].closed++;
        });

        const scorecard = Object.keys(consultantMap)
            .map(name => ({ name, ...consultantMap[name], rate: consultantMap[name].leads > 0 ? (consultantMap[name].closed / consultantMap[name].leads) * 100 : 0 }))
            .filter(c => c.name && c.name !== '未指定' && c.name !== 'Unknown')
            .sort((a,b) => b.closed - a.closed)
            .slice(0, 5);

        return { conversionData, scorecard, leads, visited, closed };
    }, [chartFilteredRecords, marketingFilter, staffMap]);

    const pieTagOptions = useMemo(() => {
        const filtered = chartFilteredRecords.filter(r => pieClinicFilter === 'all' || r.clinicId === pieClinicFilter);
        const counts: Record<string, number> = {};
        filtered.forEach(r => {
            const tag = r.marketingTag || '未分類';
            counts[tag] = (counts[tag] || 0) + 1;
        });
        return {
            options: Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
            total: filtered.length
        };
    }, [chartFilteredRecords, pieClinicFilter]);

    const marketingPieData = useMemo(() => {
        const filtered = chartFilteredRecords.filter(r => {
            const clinicMatch = pieClinicFilter === 'all' || r.clinicId === pieClinicFilter;
            const tagMatch = pieTagFilter === 'all' || (r.marketingTag || '未分類') === pieTagFilter;
            return clinicMatch && tagMatch;
        });

        const totalFiltered = filtered.length;
        const counts: Record<string, { value: number, visit: number, closed: number }> = {};
        filtered.forEach(r => {
            const source = r.source || '未分類';
            if (!counts[source]) counts[source] = { value: 0, visit: 0, closed: 0 };
            counts[source].value++;
            if (r.isVisited) counts[source].visit++;
            if (r.isClosed) counts[source].closed++;
        });

        return [...Object.entries(counts)]
            .map(([name, stats]) => ({ 
                name, 
                ...stats, 
                rate: totalFiltered > 0 ? (stats.value / totalFiltered) * 100 : 0 
            }))
            .sort((a, b) => b.value - a.value);
    }, [chartFilteredRecords, pieClinicFilter, pieTagFilter]);

    const filteredNpRecords = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return npRecords.filter(r => {
            if (filterDate && r.date !== filterDate) return false;
            if (filterClinic && getClinicName(r.clinicId) !== filterClinic) return false;
            if (filterDoctor && (r.doctorName || r.doctor || '未指定') !== filterDoctor) return false;
            if (filterTag && (r.marketingTag || '未分類') !== filterTag) return false;
            if (filterConsultant && (staffMap[r.consultant || ''] || '未指定') !== filterConsultant) return false;
            if (filterSource && (r.source || '未分類') !== filterSource) return false;
            if (filterStatus) {
                let s = '';
                if (r.isClosed) s = '已成交';
                else if (r.isVisited) s = '已報到';
                else if (r.date > today) s = '待到診';
                else s = '未到診';
                if (s !== filterStatus) return false;
            }
            return true;
        }).sort((a: NPRecord, b: NPRecord) => (b.date || '').localeCompare(a.date || ''));
    }, [npRecords, filterDate, filterClinic, filterDoctor, filterTag, filterConsultant, filterSource, filterStatus, staffMap]);

    const filterOptions = useMemo(() => ({
        dates: Array.from<string>(new Set(npRecords.map(r => r.date || ''))).sort((a, b) => b.localeCompare(a)),
        clinics: Array.from<string>(new Set(npRecords.map(r => getClinicName(r.clinicId)))).sort((a, b) => (CLINIC_ORDER[a] ?? 999) - (CLINIC_ORDER[b] ?? 999)),
        doctors: Array.from<string>(new Set(npRecords.map(r => r.doctorName || r.doctor || '未指定'))).sort((a, b) => a.localeCompare(b)),
        consultants: Array.from<string>(new Set(npRecords.map(r => staffMap[r.consultant || ''] || '未指定'))).sort((a, b) => a.localeCompare(b)),
        tags: Array.from<string>(new Set(npRecords.map(r => r.marketingTag || '未分類'))).sort((a, b) => a.localeCompare(b)),
        sources: Array.from<string>(new Set(npRecords.map(r => r.source || '未分類'))).sort((a, b) => a.localeCompare(b)),
        statuses: ['已成交', '已報到', '待到診', '未到診']
    }), [npRecords, clinics, staffMap]);

    // --- HANDLERS ---

    const handleSyncNP = async () => {
        if (!isGoogleLoggedIn) {
            authorizeCalendar();
            return;
        }

        if (!confirm("確定要同步本月 Google 日曆中的 NP 資料嗎？這將自動偵測含有 'NP' 標註的預約並建立追蹤紀錄。")) return;
        
        setIsSyncingNP(true);
        try {
            const [y, m] = currentMonth.split('-').map(Number);
            const start = new Date(y, m - 1, 1);
            const end = new Date(y, m, 0, 23, 59, 59, 999);
            
            const batch = db.batch();
            let count = 0;
            
            // CRITICAL FIX: Snapshot current record IDs to skip already synced ones
            const existingIds = new Set(npRecords.map(r => r.id));

            for (const clinic of sortedClinics) {
                const mapping = clinic.googleCalendarMapping;
                if (!mapping) continue;

                const calendarIds = Array.from<string>(new Set(Object.values(mapping)));

                for (const calId of calendarIds) {
                    try {
                        const events = await listEvents(calId, start, end);
                        
                        for (const ev of events) {
                            if (!ev.start.dateTime) continue;
                            
                            // SKIP IF ALREADY SYNCED
                            if (existingIds.has(ev.id)) continue;

                            const parsed = parseCalendarEvent(ev.summary);
                            if (parsed && parsed.isNP) {
                                let doctorName = '未知';
                                const docEntry = Object.entries(mapping).find(([id, cid]) => cid === calId);
                                if (docEntry) {
                                    if (docEntry[0] === 'clinic_shared' || docEntry[0] === 'clinic_public') {
                                        doctorName = '診所公用';
                                    } else {
                                        const doc = clinics.flatMap(c => c.doctors || []).find(d => d.id === docEntry[0]);
                                        if (doc) doctorName = doc.name;
                                    }
                                }

                                const dateStr = ev.start.dateTime.split('T')[0];
                                const note = ev.description || '';
                                const source = parseSourceFromNote(note);

                                const npRef = db.collection('np_records').doc(ev.id);
                                batch.set(npRef, {
                                    clinicId: clinic.id,
                                    clinicName: clinic.name,
                                    date: dateStr,
                                    patientName: parsed.name,
                                    calendarTreatment: parsed.treatment,
                                    calendarNote: note,
                                    doctorName: doctorName,
                                    marketingTag: '矯正諮詢',
                                    source: source,
                                    isVisited: false,
                                    isClosed: false,
                                    updatedAt: new Date().toISOString()
                                }, { merge: true });
                                count++;
                                // Mark as processed for current loop
                                existingIds.add(ev.id);
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to sync calendar ${calId}`, e);
                    }
                }
            }

            if (count > 0) {
                await batch.commit();
                alert(`同步完成！共新增 ${count} 筆紀錄。`);
            } else {
                alert("未在日曆中發現符合標註的新 NP 預約。");
            }
        } catch (e) {
            console.error(e);
            alert("同步發生錯誤。");
        } finally {
            setIsSyncingNP(false);
        }
    };

    const handleDeleteNP = async (id: string) => {
        if (!confirm("確定刪除此筆 NP 紀錄？")) return;
        try {
            await deleteNPRecord(id);
        } catch (e) {
            alert("刪除失敗");
        }
    };

    const handleInlineTagChange = async (id: string, newTag: string) => {
        try {
            await updateNPRecord(id, { marketingTag: newTag });
        } catch (e) {
            console.error("Failed to update tag", e);
            alert("標籤更新失敗");
        }
    };

    const handleTargetUpdate = async (clinicId: string, field: keyof MonthlyTarget, value: string) => {
        const numValue = parseInt(value) || 0;
        
        // Find current clinic summary
        const summary = snapshot.current.find(s => s.clinicId === clinicId);
        if (!summary) return;

        const newTarget = {
            ...summary.targets,
            [field]: numValue
        };

        try {
            await saveMonthlyTarget(clinicId, currentMonth, newTarget);
            // Optimistic update
            setSnapshot(prev => ({
                ...prev,
                current: prev.current.map(s => s.clinicId === clinicId ? { ...s, targets: newTarget } : s)
            }));
        } catch (e) {
            console.error("Failed to save target", e);
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
            {/* Page Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div>
                    <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3">
                        <div className="p-2 bg-indigo-600 rounded-xl text-white">
                            <BarChart2 size={24} />
                        </div>
                        集團營運儀表板
                    </h2>
                    <p className="text-slate-500 font-medium ml-12">全集團診所數據監測與行銷轉化分析 (BI)</p>
                </div>
                <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-100">
                    <Calendar className="text-slate-400 ml-2" size={18} />
                    <input 
                        type="month" 
                        className="bg-transparent font-black text-slate-700 outline-none pr-4 cursor-pointer" 
                        value={currentMonth} 
                        onChange={e => setCurrentMonth(e.target.value)}
                    />
                    <div className="w-px h-6 bg-slate-200 mx-1"></div>
                    {isLoading ? <Loader2 className="animate-spin text-indigo-500 mx-2" size={20} /> : <Activity size={20} className="text-emerald-500 mx-2" />}
                </div>
            </div>
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <KPICard title="總營收 (Total Revenue)" actual={totals.current.revenue} target={totals.current.targetRevenue} prev={totals.prev.revenue} yearPrev={totals.yearPrev.revenue} prefix="$" colorClass="text-indigo-600" isActive={activeTab === 'revenue'} onClick={() => setActiveTab('revenue')} icon={DollarSign} />
                <KPICard title="自費營營 (Self-Pay)" actual={totals.current.selfPay} target={totals.current.targetSelfPay} prev={totals.prev.selfPay} yearPrev={totals.yearPrev.selfPay} prefix="$" colorClass="text-purple-600" isActive={activeTab === 'self-pay'} onClick={() => setActiveTab('self-pay')} icon={PieChartIcon} />
                <KPICard title="NP 成交轉換 (NP Conversion)" actual={totals.marketing.closed} customRate={totals.marketing.leads > 0 ? (totals.marketing.closed / totals.marketing.leads) * 100 : 0} customSubtext={`進單: ${totals.marketing.leads} / 已報到: ${totals.marketing.visited}`} isActive={activeTab === 'marketing'} onClick={() => setActiveTab('marketing')} icon={Users} colorClass="text-emerald-600" />
            </div>

            {/* Content Tabs */}
            {activeTab === 'revenue' && (
                <div className="space-y-6 animate-fade-in">
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><LineChart className="text-indigo-500" size={22} /> 每日營收趨勢 (Stacked Trend)</h3>
                            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border">
                                <Filter size={14} className="text-slate-400 ml-2" />
                                <select className="bg-transparent text-xs font-black text-slate-600 py-1.5 px-2 outline-none cursor-pointer" value={trendFilter} onChange={e => setTrendFilter(e.target.value)}>
                                    <option value="all">全集團 (Stacked)</option>
                                    {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="h-96 w-full">
                            <RevenueTrendChart data={dailyTrendData} sortedClinics={sortedClinics} filterId={trendFilter} />
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-6 lg:h-[500px] min-h-[400px]">
                        <div className="w-full lg:w-2/3 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
                             <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Target className="text-indigo-600" /> 院所達成率圖表 (Revenue Achievement)</h3>
                             </div>
                             <div className="flex-1 w-full overflow-hidden">
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

                        <div className="w-full lg:w-1/3 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                            <div className="sticky top-0 bg-white z-10 p-5 border-b border-slate-50 flex items-center gap-2 text-slate-800">
                                <Medal className="text-amber-500" />
                                <h3 className="font-black uppercase tracking-wider text-sm">達成排行榜 (Ranking)</h3>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 pt-2 space-y-3">
                                {achievementRanking.map((item: any, idx: number) => (
                                    <div key={item.id} className={`p-3 rounded-xl border transition-all ${idx === 0 ? 'bg-amber-50/50 border-amber-100 ring-1 ring-amber-200/50 shadow-sm' : 'bg-slate-50 border-slate-100'}`}>
                                        <div className="flex justify-between items-center mb-1.5">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs ${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : (idx + 1)}`}>
                                                    {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : (idx + 1)}
                                                </div>
                                                <span className="font-bold text-sm text-slate-700">{item.name}</span>
                                            </div>
                                            <span className={`font-black tabular-nums text-sm ${item.revenueRate >= 100 ? 'text-emerald-600' : item.revenueRate >= 80 ? 'text-amber-600' : 'text-rose-500'}`}>
                                                {item.revenueRate.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="w-full h-1.5 bg-white/50 rounded-full overflow-hidden border border-slate-200/30">
                                            <div className={`h-full transition-all duration-1000 ease-out ${item.revenueRate >= 100 ? 'bg-emerald-500' : item.revenueRate >= 80 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${Math.min(item.revenueRate, 100)}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Detailed Data & Target Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                            <LayoutGrid className="text-indigo-600" />
                            <h3 className="font-black text-slate-800 uppercase tracking-wider text-sm">各院數據明細與目標設定 (Detailed Data & Targets)</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-white text-slate-400 font-bold uppercase text-[10px] border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-4 sticky left-0 bg-white z-10">診所名稱</th>
                                        <th className="px-6 py-4 text-right bg-indigo-50/50 text-indigo-700">營收目標 (Total Target)</th>
                                        <th className="px-6 py-4 text-right">營收實績 (Actual)</th>
                                        <th className="px-6 py-4 text-center">營收達成率</th>
                                        <th className="px-6 py-4 text-right bg-purple-50/50 text-purple-700">自費目標 (Self-Pay Target)</th>
                                        <th className="px-6 py-4 text-right">自費實績 (Actual)</th>
                                        <th className="px-6 py-4 text-center">自費達成率</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {performanceMatrix.map((item) => (
                                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4 font-black text-slate-700 sticky left-0 bg-white z-10 border-r border-slate-50 shadow-sm">{item.name}</td>
                                            {/* Revenue Section */}
                                            <td className="px-6 py-4 text-right bg-indigo-50/30">
                                                <div className="flex items-center justify-end gap-1">
                                                    <span className="text-slate-400 text-[10px]">$</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-28 border border-slate-200 rounded px-2 py-1 text-right font-mono font-bold bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        value={item.revenueTarget}
                                                        onChange={(e) => handleTargetUpdate(item.id, 'revenueTarget', e.target.value)}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right font-black text-slate-700 tabular-nums">${item.revenueActual.toLocaleString()}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`px-2 py-1 rounded-lg text-xs font-black tabular-nums border ${item.revenueRate >= 100 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : item.revenueRate >= 80 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                                                    {item.revenueRate.toFixed(1)}%
                                                </span>
                                            </td>
                                            {/* Self-Pay Section */}
                                            <td className="px-6 py-4 text-right bg-purple-50/30">
                                                <div className="flex items-center justify-end gap-1">
                                                    <span className="text-slate-400 text-[10px]">$</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-28 border border-slate-200 rounded px-2 py-1 text-right font-mono font-bold bg-white focus:ring-2 focus:ring-purple-500 outline-none"
                                                        value={item.selfPayTarget}
                                                        onChange={(e) => handleTargetUpdate(item.id, 'selfPayTarget', e.target.value)}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right font-black text-slate-700 tabular-nums">${item.selfPayActual.toLocaleString()}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`px-2 py-1 rounded-lg text-xs font-black tabular-nums border ${item.selfPayRate >= 100 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : item.selfPayRate >= 80 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                                                    {item.selfPayRate.toFixed(1)}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-900 text-white font-bold">
                                    <tr>
                                        <td className="px-6 py-4 sticky left-0 bg-slate-900 z-10 border-r border-slate-800">全集團總計 (Grand Total)</td>
                                        {/* Total Revenue Summary */}
                                        <td className="px-6 py-4 text-right tabular-nums">${totals.current.targetRevenue.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-right tabular-nums text-teal-400 font-black">${totals.current.revenue.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="bg-white/10 px-2 py-1 rounded tabular-nums">
                                                {(totals.current.targetRevenue > 0 ? (totals.current.revenue / totals.current.targetRevenue) * 100 : 0).toFixed(1)}%
                                            </span>
                                        </td>
                                        {/* Total Self-Pay Summary */}
                                        <td className="px-6 py-4 text-right tabular-nums">${totals.current.targetSelfPay.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-right tabular-nums text-purple-300 font-black">${totals.current.selfPay.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="bg-white/10 px-2 py-1 rounded tabular-nums">
                                                {(totals.current.targetSelfPay > 0 ? (totals.current.selfPay / totals.current.targetSelfPay) * 100 : 0).toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'self-pay' && (
                <div className="space-y-6 animate-fade-in">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[500px]">
                             <div className="flex justify-between items-center mb-8">
                                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Target className="text-purple-600" /> 自費目標達成狀況</h3>
                             </div>
                             <div className="flex-1 w-full">
                                <SelfPayAchievementChart data={performanceMatrix.map(p => ({ name: p.name, target: p.selfPayTarget, actual: p.selfPayActual, rate: p.selfPayRate }))} />
                             </div>
                        </div>

                        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[500px]">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><PieChartIcon size={20} className="text-teal-500" /> 項目佔比分析</h3>
                                <select className="bg-slate-50 text-[10px] font-black p-1 border rounded" value={breakdownFilter} onChange={e => setBreakdownFilter(e.target.value)}>
                                    <option value="all">全集團</option>
                                    {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 w-full">
                                <SelfPayBreakdownChart data={selfPayAnalytics.pieData} />
                            </div>
                        </div>
                    </div>

                    {/* Matrix Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                            <LayoutGrid className="text-indigo-600" />
                            <h3 className="font-black text-slate-800 uppercase tracking-wider text-sm">自費療程數據矩陣 (Clinic x Category Matrix)</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-white text-slate-400 font-bold uppercase text-[10px] border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-4 sticky left-0 bg-white z-10">診所名稱</th>
                                        <th className="px-6 py-4 text-right bg-indigo-50/50 text-indigo-700">總計 (Total)</th>
                                        {selfPayAnalytics.labels.map(l => (
                                            <th key={l} className="px-6 py-4 text-right">{l}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {selfPayAnalytics.clinicMatrix.map((clinic) => (
                                        <tr key={clinic.name} className="hover:bg-indigo-50/10 transition-colors">
                                            <td className="px-6 py-4 font-black text-slate-700 sticky left-0 bg-white z-10 border-r border-slate-50 shadow-sm">{clinic.name}</td>
                                            <td className="px-6 py-4 text-right font-black text-indigo-600 tabular-nums bg-indigo-50/30">${clinic.total.toLocaleString()}</td>
                                            {clinic.current.map((val, idx) => (
                                                <td key={idx} className="px-6 py-4 text-right tabular-nums text-slate-500 font-medium">
                                                    {val > 0 ? `$${val.toLocaleString()}` : '-'}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {/* Total Row */}
                                    <tr className="bg-slate-900 text-white font-bold">
                                        <td className="px-6 py-4 sticky left-0 bg-slate-900 z-10 border-r border-slate-800">全院總計 (Total)</td>
                                        <td className="px-6 py-4 text-right tabular-nums text-emerald-400 font-black">${selfPayAnalytics.summary.totalCurrent.toLocaleString()}</td>
                                        {selfPayAnalytics.summary.current.map((val, idx) => (
                                            <td key={idx} className="px-6 py-4 text-right tabular-nums">${val.toLocaleString()}</td>
                                        ))}
                                    </tr>
                                    {/* Growth Row */}
                                    <tr className="bg-slate-50 font-bold text-slate-500">
                                        <td className="px-6 py-3 sticky left-0 bg-slate-50 z-10 border-r border-slate-200">
                                            <div className="flex items-center gap-1.5 text-[10px] uppercase">
                                                <TrendingUp size={12} /> MoM 成長率 (%)
                                            </div>
                                        </td>
                                        <td className={`px-6 py-3 text-right tabular-nums ${selfPayAnalytics.summary.totalGrowth >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {selfPayAnalytics.summary.totalGrowth >= 0 ? '+' : ''}{selfPayAnalytics.summary.totalGrowth.toFixed(1)}%
                                        </td>
                                        {selfPayAnalytics.summary.growth.map((rate, idx) => (
                                            <td key={idx} className={`px-6 py-3 text-right tabular-nums ${rate === 0 && selfPayAnalytics.summary.current[idx] === 0 ? 'text-slate-300' : rate >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {rate === 0 && selfPayAnalytics.summary.current[idx] === 0 ? '-' : `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`}
                                            </td>
                                        ))}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div className="p-4 bg-slate-50 text-[10px] text-slate-400 font-medium flex items-center gap-4">
                            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-slate-300"></div> 所有數據皆為本月自費實收 (Net Revenue)</div>
                            <div className="flex items-center gap-1.5"><TrendingUp size={10} /> MoM = 同比上月成長率</div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'marketing' && (
                <div className="space-y-6 animate-fade-in">
                    {/* Filters Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                         <div className="flex items-center gap-2">
                            <div className="p-2 bg-rose-50 rounded-lg text-rose-600">
                                <Filter size={18} />
                            </div>
                            <span className="font-bold text-slate-700">行銷數據篩選 (Filters)</span>
                        </div>
                         <div className="flex items-center gap-4">
                            <button
                                onClick={handleSyncNP}
                                disabled={isSyncingNP}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 ${isGoogleLoggedIn ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50'}`}
                            >
                                {isSyncingNP ? <Loader2 size={16} className="animate-spin" /> : isGoogleLoggedIn ? <RefreshCw size={16} /> : <PlugZap size={16} />}
                                {isGoogleLoggedIn ? '同步本月 NP (Sync Calendar)' : '連結日曆以同步 NP'}
                            </button>
                            <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 hover:border-indigo-300 transition-all select-none group">
                                <input type="checkbox" checked={excludeNHI} onChange={e => setExcludeNHI(e.target.checked)} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300" />
                                <div className="flex items-center gap-1.5">
                                    <ShieldOff size={14} className={excludeNHI ? "text-rose-500" : "text-slate-400"} />
                                    <span className={`text-sm font-black ${excludeNHI ? "text-indigo-600" : "text-slate-500"}`}>排除健保項目 (Exclude NHI)</span>
                                </div>
                            </label>
                         </div>
                    </div>

                    {/* Row 1: Conversion Chart + Source Pie (Equal Height) */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Conversion Horizontal Bar Chart */}
                        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[400px]">
                             <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Target size={22} className="text-indigo-500" /> 顧客轉化分析</h3>
                             <div className="w-full flex-1 min-h-0">
                                <MarketingConversionChart data={marketingAnalytics.conversionData} />
                             </div>
                             {/* Conversion Stats Summary */}
                             <div className="grid grid-cols-3 gap-2 w-full mt-6 pt-6 border-t border-slate-50 shrink-0">
                                <div className="text-center">
                                    <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">總約診 (Leads)</div>
                                    <div className="text-xl font-black text-indigo-600 tabular-nums">{marketingAnalytics.leads}</div>
                                </div>
                                <div className="text-center border-x border-slate-100">
                                    <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">到診率 (Visit)</div>
                                    <div className="text-xl font-black text-emerald-600 tabular-nums">
                                        {marketingAnalytics.leads > 0 ? ((marketingAnalytics.visited / marketingAnalytics.leads) * 100).toFixed(0) : 0}%
                                    </div>
                                </div>
                                <div className="text-center">
                                    <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">成交率 (Closed)</div>
                                    <div className="text-xl font-black text-pink-600 tabular-nums">
                                        {marketingAnalytics.leads > 0 ? ((marketingAnalytics.closed / marketingAnalytics.leads) * 100).toFixed(0) : 0}%
                                    </div>
                                </div>
                             </div>
                        </div>
                        
                        {/* Source Distribution with Side Legend */}
                        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[400px]">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 shrink-0 gap-4">
                                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><PieChartIcon className="text-indigo-500" /> 客群來源分佈 (Source)</h3>
                                <div className="flex wrap gap-2 w-full sm:w-auto">
                                    <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border">
                                        <Tag size={12} className="text-slate-400 ml-1.5" />
                                        <select className="bg-transparent text-[10px] font-black text-slate-600 py-1 px-1 outline-none cursor-pointer" value={pieTagFilter} onChange={e => setPieTagFilter(e.target.value)}>
                                            <option value="all">全部標籤 ({pieTagOptions.total})</option>
                                            {pieTagOptions.options.map(({ tag, count }) => (
                                                <option key={tag} value={tag}>{tag} ({count})</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border">
                                        <Filter size={12} className="text-slate-400 ml-1.5" />
                                        <select className="bg-transparent text-[10px] font-black text-slate-600 py-1 px-1 outline-none cursor-pointer" value={pieClinicFilter} onChange={e => setPieClinicFilter(e.target.value)}>
                                            <option value="all">全集團診所</option>
                                            {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col md:flex-row items-center gap-8 flex-1 min-h-0">
                                <div className="w-full md:w-1/2 h-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie 
                                                data={marketingPieData} 
                                                cx="50%" cy="50%" 
                                                innerRadius={60} 
                                                outerRadius={100} 
                                                paddingAngle={5} 
                                                dataKey="value"
                                                stroke="none"
                                            >
                                                {marketingPieData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip formatter={(v: number) => `${v} 人`} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="w-full md:w-1/2 h-full overflow-y-auto custom-scrollbar pr-4">
                                    <div className="space-y-2">
                                        {marketingPieData.map((d, i) => (
                                            <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                                    <span className="font-bold text-slate-700 text-sm truncate max-w-[120px]">{d.name}</span>
                                                </div>
                                                <span className="text-xs font-black text-slate-500 tabular-nums whitespace-nowrap">
                                                    {d.value}.{d.visit}.{d.closed} <span className="text-slate-300 ml-1">({d.rate.toFixed(1)}%)</span>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Row 2: Daily Marketing Trend with Tag Filter */}
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><LineChart className="text-indigo-500" size={22} /> 每日 NP 進單趨勢</h3>
                            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                                <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border">
                                    <Tag size={14} className="text-slate-400 ml-2" />
                                    <select className="bg-transparent text-xs font-black text-slate-600 py-1.5 px-2 outline-none cursor-pointer" value={trendTagFilter} onChange={e => setTrendTagFilter(e.target.value)}>
                                        <option value="all">全部標籤 ({trendTagOptions.total})</option>
                                        {trendTagOptions.options.map(({ tag, count }) => (
                                            <option key={tag} value={tag}>{tag} ({count})</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border">
                                    <Filter size={14} className="text-slate-400 ml-2" />
                                    <select className="bg-transparent text-xs font-black text-slate-600 py-1.5 px-2 outline-none cursor-pointer" value={marketingFilter} onChange={e => setMarketingFilter(e.target.value)}>
                                        <option value="all">全集團 (Stacked)</option>
                                        {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="h-80 w-full">
                            <MarketingTrendChart data={marketingTrendData} sortedClinics={sortedClinics} filterId={marketingFilter} />
                        </div>
                    </div>

                    {/* Row 3: Consultant Scorecard */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 border-b border-slate-50 flex items-center gap-2">
                             <Trophy className="text-amber-500" />
                             <h3 className="font-bold text-slate-800 uppercase tracking-wider text-sm">諮詢師戰報 (Top 5)</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-4">諮詢師姓名</th>
                                        <th className="px-6 py-4 text-center">總進單 (Leads)</th>
                                        <th className="px-6 py-4 text-center">已到診 (Visited)</th>
                                        <th className="px-6 py-4 text-center">已成交 (Closed)</th>
                                        <th className="px-6 py-4 text-right">轉換率 (%)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {marketingAnalytics.scorecard.map((staff, idx) => (
                                        <tr key={idx} className="hover:bg-indigo-50/10 transition-colors">
                                            <td className="px-6 py-4 font-bold text-slate-700">{staff.name}</td>
                                            <td className="px-6 py-4 text-center font-mono text-slate-500 tabular-nums">{staff.leads}</td>
                                            <td className="px-6 py-4 text-center font-mono text-emerald-600 tabular-nums">{staff.visited}</td>
                                            <td className="px-6 py-4 text-center font-mono text-pink-500 font-bold tabular-nums">{staff.closed}</td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex flex-col items-end gap-1">
                                                    <span className={`font-black text-sm tabular-nums ${staff.rate >= 30 ? 'text-emerald-600' : staff.rate >= 15 ? 'text-amber-600' : 'text-slate-400'}`}>
                                                        {staff.rate.toFixed(1)}%
                                                    </span>
                                                    <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                        <div className={`h-full ${staff.rate >= 30 ? 'bg-emerald-500' : staff.rate >= 15 ? 'bg-amber-400' : 'bg-slate-300'}`} style={{ width: `${Math.min(staff.rate, 100)}%` }} />
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {marketingAnalytics.scorecard.length === 0 && (
                                        <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic">本月尚無進單數據</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* NP Raw Data Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="font-bold text-slate-700">NP 進單原始資料 (Raw Data)</h3>
                        </div>
                        <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                             <table className="w-full text-sm text-left">
                                <thead className="bg-white border-b border-slate-100 sticky top-0 z-20 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-4 min-w-[140px]"><TableHeaderFilter label="日期" value={filterDate} onChange={setFilterDate} options={filterOptions.dates} /></th>
                                        <th className="px-4 py-4 font-bold text-slate-400 text-[10px] uppercase">姓名</th>
                                        <th className="px-4 py-4 min-w-[140px]"><TableHeaderFilter label="診所" value={filterClinic} onChange={setFilterClinic} options={filterOptions.clinics} /></th>
                                        <th className="px-4 py-4 min-w-[140px]"><TableHeaderFilter label="醫師" value={filterDoctor} onChange={setFilterDoctor} options={filterOptions.doctors} /></th>
                                        <th className="px-4 py-4 font-bold text-slate-400 text-[10px] uppercase min-w-[150px]">預約療程</th>
                                        <th className="px-4 py-4 min-w-[160px]"><TableHeaderFilter label="行銷標籤" value={filterTag} onChange={setFilterTag} options={marketingTags} /></th>
                                        <th className="px-4 py-4 min-w-[140px]"><TableHeaderFilter label="諮詢師" value={filterConsultant} onChange={setFilterConsultant} options={filterOptions.consultants} /></th>
                                        <th className="px-4 py-4 min-w-[140px]"><TableHeaderFilter label="來源" value={filterSource} onChange={setFilterSource} options={filterOptions.sources} /></th>
                                        <th className="px-4 py-4 min-w-[140px]"><TableHeaderFilter label="狀態" value={filterStatus} onChange={setFilterStatus} options={filterOptions.statuses} /></th>
                                        <th className="px-4 py-4 text-center text-[10px] text-slate-400 font-bold uppercase w-16">刪除</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredNpRecords.map(r => (
                                        <tr key={r.id} className="hover:bg-indigo-50/10 cursor-pointer transition-colors" onClick={() => setEditingNP(r)}>
                                            <td className="px-4 py-4 font-mono text-slate-500">{r.date ? r.date.slice(5) : ''}</td>
                                            <td className="px-4 py-4 font-black text-slate-700">{r.patientName}</td>
                                            <td className="px-4 py-4 text-slate-500 font-bold text-xs">{getClinicName(r.clinicId)}</td>
                                            <td className="px-4 py-3 text-slate-600 text-xs font-medium">{r.doctorName || r.doctor || '未指定'}</td>
                                            <td className="px-4 py-4 text-slate-400 text-[11px] truncate max-w-[150px]" title={r.calendarTreatment}>{r.calendarTreatment || '-'}</td>
                                            <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                                                <select 
                                                    className="w-full text-[11px] border border-indigo-100 rounded bg-white px-1 py-1 font-bold text-indigo-700 outline-none focus:ring-1 focus:ring-indigo-400"
                                                    value={r.marketingTag || '其他'}
                                                    onChange={(e) => handleInlineTagChange(r.id!, e.target.value)}
                                                >
                                                    {marketingTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                                                </select>
                                            </td>
                                            <td className="px-4 py-4 text-slate-500 text-xs">{staffMap[r.consultant || ''] || '未指定'}</td>
                                            <td className="px-4 py-4 text-slate-500 text-[11px] font-bold">{r.source || '未分類'}</td>
                                            <td className="px-4 py-4">{renderNPStatus(r)}</td>
                                            <td className="px-4 py-4 text-center">
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        handleDeleteNP(r.id!); 
                                                    }} 
                                                    className="text-slate-300 hover:text-rose-500 p-2 rounded-full hover:bg-rose-50 transition-colors" 
                                                    title="刪除"
                                                >
                                                    <Trash2 size={16}/>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredNpRecords.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="p-12 text-center text-slate-400">
                                                本月尚無符合條件的 NP 資料。
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                             </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Modals */}
            {editingNP && (
                <NPStatusModal 
                    isOpen={!!editingNP} 
                    onClose={() => setEditingNP(null)} 
                    recordId={editingNP.id!}
                    patientName={editingNP.patientName}
                    calendarTreatment={editingNP.calendarTreatment || editingNP.calendarNote}
                    actualTreatment={editingNP.treatment}
                    clinicId={editingNP.clinicId} 
                    date={editingNP.date} 
                />
            )}
        </div>
    );
};
