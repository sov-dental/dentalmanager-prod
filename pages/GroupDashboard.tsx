

import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Consultant, NPRecord, UserRole, ClinicMonthlySummary } from '../types';
import { fetchDashboardSnapshot, saveMonthlyTarget, auth, getMonthlyAccounting, CLINIC_ORDER, saveNPRecord, getNPRecord, getStaffList, deleteNPRecord, db } from '../services/firebase';
import { listEvents, handleAuthClick } from '../services/googleCalendar';
import { parseCalendarEvent } from '../utils/eventParser';
import { UnauthorizedPage } from '../components/UnauthorizedPage';
import { NPStatusModal } from '../components/NPStatusModal';
import { 
    BarChart2, TrendingUp, Users, DollarSign, Calendar, 
    ArrowUpRight, ArrowDownRight, Loader2, 
    Trophy, Activity, AlertCircle, Target, PieChart as PieChartIcon,
    RefreshCw, Filter, UserCheck, Tag, Trash2, Plus
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Line, ComposedChart,
    PieChart, Pie, Cell
} from 'recharts';

interface Props {
    clinics: Clinic[];
    userRole?: UserRole;
}

interface SelfPayBreakdown {
    total: number;
    prostho: number;
    implant: number;
    ortho: number;
    sov: number;
    inv: number;
    whitening: number;
    perio: number;
    other: number;
    retail: number;
}

// --- HELPER COMPONENTS ---

const KPICard = ({ title, actual, target, prev, yearPrev, prefix = '', suffix = '', colorClass = 'text-slate-800', isActive, onClick, icon: Icon, customRate, customSubtext }: any) => {
    const rate = customRate !== undefined ? customRate : (target > 0 ? (actual / target) * 100 : 0);
    const isAchieved = rate >= 100; 
    const badgeColor = customRate !== undefined ? 'bg-blue-50 text-blue-600 border-blue-100' : (isAchieved ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100');
    
    const mom = prev > 0 ? ((actual - prev) / prev) * 100 : 0;
    const yoy = yearPrev > 0 ? ((actual - yearPrev) / yearPrev) * 100 : 0;

    return (
        <button 
            onClick={onClick}
            className={`
                text-left w-full rounded-xl p-5 flex flex-col justify-between relative overflow-hidden transition-all duration-200
                ${isActive 
                    ? 'bg-white ring-2 ring-indigo-500 shadow-lg scale-[1.02] z-10' 
                    : 'bg-white shadow-sm border border-slate-200 hover:bg-slate-50 hover:border-indigo-200'
                }
            `}
        >
            <div className="relative z-10 w-full">
                <div className="flex justify-between items-start mb-2">
                    <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${isActive ? 'text-indigo-600' : 'text-slate-500'}`}>
                        {Icon && <Icon size={14} />}
                        {title}
                    </h4>
                    {(target > 0 || customRate !== undefined) && (
                        <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${badgeColor}`}>
                            <Target size={10} /> {rate.toFixed(1)}%
                        </div>
                    )}
                </div>
                <div className={`text-3xl font-black tabular-nums tracking-tight ${colorClass} mb-1`}>
                    {prefix}{actual.toLocaleString()}{suffix}
                </div>
                {customSubtext ? (
                    <div className="text-xs text-slate-500 font-bold">{customSubtext}</div>
                ) : (
                    target > 0 && <div className="text-xs text-slate-400 font-medium">目標: {prefix}{target.toLocaleString()}</div>
                )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex gap-4 relative z-10 w-full">
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
            
            {isActive && <div className="absolute inset-0 bg-indigo-50 opacity-10 pointer-events-none"></div>}
        </button>
    );
};

const PIE_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c', '#d0ed57', '#8dd1e1', '#0088FE', '#F87171'];

const CustomTooltip = ({ active, payload, label, valuePrefix = '$' }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-xs">
                <div className="font-bold text-slate-700 mb-2 border-b border-slate-100 pb-1">{label}</div>
                {payload.map((entry: any, index: number) => {
                    const isRate = entry.name.includes('達成率') || entry.dataKey.includes('Rate');
                    const valueDisplay = isRate 
                        ? `${entry.value.toFixed(1)}%` 
                        : `${valuePrefix}${entry.value.toLocaleString()}`;
                    
                    return (
                        <div key={index} className="flex items-center gap-2 mb-1 last:mb-0">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></div>
                            <span className="text-slate-500">{entry.name}:</span>
                            <span className="font-bold text-slate-700 ml-auto">{valueDisplay}</span>
                        </div>
                    );
                })}
            </div>
        );
    }
    return null;
};

// --- TABLE FILTER HELPERS ---
const TableHeaderFilter = ({ 
    label, 
    value, 
    onChange, 
    options 
}: { 
    label: string, 
    value: string, 
    onChange: (val: string) => void, 
    options: string[] 
}) => (
    <div className="flex flex-col gap-1 w-full">
        <span className="text-xs text-slate-500 font-bold uppercase">{label}</span>
        <select
            className="w-full text-xs border border-slate-200 rounded px-1 py-0.5 bg-slate-50 text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => e.stopPropagation()} // Prevent sort trigger if added later
        >
            <option value="">全部</option>
            {options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
            ))}
        </select>
    </div>
);

// --- MAIN COMPONENT ---

export const GroupDashboard: React.FC<Props> = ({ clinics, userRole }) => {
    // Permission Check
    if (!['admin', 'manager'].includes(userRole || '')) {
        return <UnauthorizedPage email={auth.currentUser?.email} onLogout={() => auth.signOut()} />;
    }

    const [currentMonth, setCurrentMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    
    // Separate loading states to prevent UI flash
    const [isFinancialLoading, setIsFinancialLoading] = useState(false);
    const [isNpLoading, setIsNpLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    // View State
    const [activeTab, setActiveTab] = useState<'revenue' | 'self-pay' | 'marketing'>('revenue');
    const [pieFilter, setPieFilter] = useState<string>('all'); 

    // Data State (Financial)
    const [snapshot, setSnapshot] = useState<{
        current: ClinicMonthlySummary[];
        lastMonth: ClinicMonthlySummary[];
        lastYear: ClinicMonthlySummary[];
    }>({ current: [], lastMonth: [], lastYear: [] });

    // Detailed Data (Financial)
    const [breakdowns, setBreakdowns] = useState<Record<string, SelfPayBreakdown>>({});
    
    // Data State (Marketing) - Live
    const [npRecords, setNpRecords] = useState<NPRecord[]>([]);
    
    // Consultant List (Cached)
    const [allConsultants, setAllConsultants] = useState<Consultant[]>([]);
    
    // Memoize Flattened Doctors for Lookup
    const allDoctors = useMemo(() => clinics.flatMap(c => c.doctors || []), [clinics]);

    // Stable ID Signature for Effects
    const clinicIdsSignature = useMemo(() => clinics.map(c => c.id).sort().join(','), [clinics]);

    // Marketing Specific State
    const [isSyncing, setIsSyncing] = useState(false);
    const [marketingPieMode, setMarketingPieMode] = useState<'tag' | 'source'>('tag');
    const [marketingClinicFilter, setMarketingClinicFilter] = useState<string>('all');
    
    // Table Filters State
    const [tableFilters, setTableFilters] = useState({
        date: '',
        clinicName: '',
        doctorName: '',
        marketingTag: '',
        source: '',
        consultant: '',
        status: ''
    });
    
    // NP Modal
    const [editingNP, setEditingNP] = useState<NPRecord | null>(null);
    const [isManualAdd, setIsManualAdd] = useState(false);

    // --- DATA FETCHING EFFECT 1: FINANCIALS (One-time fetch) ---
    useEffect(() => {
        if (!clinicIdsSignature) return;

        const loadFinancials = async () => {
            setIsFinancialLoading(true);
            try {
                // 1. Fetch High-Level Snapshot
                const data = await fetchDashboardSnapshot(clinics, currentMonth);
                
                // 2. Fetch Granular Data for Self-Pay
                const breakdownMap: Record<string, SelfPayBreakdown> = {};
                await Promise.all(clinics.map(async (clinic) => {
                    const rows = await getMonthlyAccounting(clinic.id, currentMonth);
                    const bd: SelfPayBreakdown = {
                        total: 0, prostho: 0, implant: 0, ortho: 0, sov: 0, inv: 0, whitening: 0, perio: 0, other: 0, retail: 0
                    };
                    rows.forEach(row => {
                        const t = row.treatments;
                        const r = row.retail;
                        bd.prostho += (t.prostho || 0);
                        bd.implant += (t.implant || 0);
                        bd.ortho += (t.ortho || 0);
                        bd.sov += (t.sov || 0);
                        bd.inv += (t.inv || 0);
                        bd.whitening += (t.whitening || 0);
                        bd.perio += (t.perio || 0);
                        bd.other += (t.otherSelfPay || 0);
                        
                        const retailSum = (r.products || 0) + (r.diyWhitening || 0);
                        bd.retail += retailSum;
                    });
                    
                    bd.total = bd.prostho + bd.implant + bd.ortho + bd.sov + bd.inv + bd.whitening + bd.perio + bd.other + bd.retail;
                    breakdownMap[clinic.id] = bd;

                    const snapshotEntry = data.current.find(d => d.clinicId === clinic.id);
                    if (snapshotEntry) {
                        snapshotEntry.actualSelfPay = bd.total;
                    }
                }));
                
                setSnapshot(data);
                setBreakdowns(breakdownMap);

                // 3. Fetch Consultants
                const staffPromises = clinics.map(c => getStaffList(c.id));
                const staffLists = await Promise.all(staffPromises);
                setAllConsultants(staffLists.flat());

            } catch (e) {
                console.error(e);
            } finally {
                setIsFinancialLoading(false);
            }
        };

        loadFinancials();
    }, [currentMonth, clinicIdsSignature]);

    // --- DATA FETCHING EFFECT 2: NP RECORDS (Real-time Snapshot) ---
    useEffect(() => {
        if (!clinicIdsSignature) return;

        setIsNpLoading(true);
        
        const [year, month] = currentMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
        const endStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        // Listen to ALL records in range, filter by clinic client-side for security/simplicity
        const unsubscribe = db.collection('np_records')
            .where('date', '>=', startStr)
            .where('date', '<=', endStr)
            .onSnapshot((snap) => {
                const records: NPRecord[] = [];
                const allowedIds = new Set(clinics.map(c => c.id));
                
                snap.forEach(doc => {
                    const data = doc.data() as NPRecord;
                    if (allowedIds.has(data.clinicId)) {
                        records.push({ id: doc.id, ...data });
                    }
                });
                
                setNpRecords(records);
                setIsNpLoading(false); // Only turn off, never turn on again in this effect
            }, (error) => {
                console.error("NP Records Snapshot Error:", error);
                setIsNpLoading(false);
            });

        return () => unsubscribe();
    }, [currentMonth, clinicIdsSignature]);

    // --- Lookup Helpers ---
    const getClinicName = (r: NPRecord) => r.clinicName || clinics.find(c => c.id === r.clinicId)?.name || 'Unknown';
    const getDoctorName = (r: NPRecord) => {
        if (r.doctorName) return r.doctorName;
        const doc = allDoctors.find(d => d.id === r.doctor);
        return doc ? doc.name : (r.doctor || '-');
    };

    // --- Sorting & Aggregation ---
    const getSortOrder = (name: string) => CLINIC_ORDER[name] || 999;

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

    const npTotal = npRecords.length;
    const npVisited = npRecords.filter(r => r.isVisited).length;
    const npClosed = npRecords.filter(r => r.isClosed).length;
    const npConversionRate = npTotal > 0 ? (npClosed / npTotal) * 100 : 0;

    const sortedSnapshot = useMemo(() => {
        return [...snapshot.current].sort((a, b) => getSortOrder(a.clinicName) - getSortOrder(b.clinicName));
    }, [snapshot.current]);

    const sortedClinics = useMemo(() => {
        return [...clinics].sort((a, b) => getSortOrder(a.name) - getSortOrder(b.name));
    }, [clinics]);

    // Unique Values for Filters (Memoized)
    const uniqueValues = useMemo(() => {
        const getOptions = (key: keyof NPRecord | 'status' | 'clinicName' | 'doctorName') => {
            const values = new Set<string>();
            npRecords.forEach(r => {
                if (key === 'status') {
                    let s = '未到診';
                    const todayStr = new Date().toISOString().split('T')[0];
                    if (r.isClosed) s = '已成交';
                    else if (r.isVisited) s = '已報到';
                    else if (r.date > todayStr) s = '待回診';
                    values.add(s);
                } else if (key === 'clinicName') {
                    values.add(getClinicName(r));
                } else if (key === 'doctorName') {
                    const dName = getDoctorName(r);
                    if (dName && dName !== '-') values.add(dName);
                } else if (key === 'consultant') {
                    const name = r.consultant 
                        ? (allConsultants.find(c => c.id === r.consultant)?.name || 'Unknown') 
                        : '未指定';
                    values.add(name);
                } else {
                    const val = r[key as keyof NPRecord];
                    if (typeof val === 'string' && val) values.add(val);
                }
            });
            return Array.from(values).sort();
        };

        return {
            dates: getOptions('date'),
            clinics: getOptions('clinicName'),
            doctors: getOptions('doctorName'),
            tags: getOptions('marketingTag'),
            sources: getOptions('source'),
            consultants: getOptions('consultant'),
            statuses: getOptions('status'),
        };
    }, [npRecords, allConsultants, clinics, allDoctors]);

    // Filtered Records (Memoized)
    const filteredNpRecords = useMemo(() => {
        return npRecords.filter(r => {
            if (tableFilters.date && r.date !== tableFilters.date) return false;
            if (tableFilters.clinicName && getClinicName(r) !== tableFilters.clinicName) return false;
            if (tableFilters.doctorName && getDoctorName(r) !== tableFilters.doctorName) return false;
            if (tableFilters.marketingTag && r.marketingTag !== tableFilters.marketingTag) return false;
            if (tableFilters.source && r.source !== tableFilters.source) return false;
            
            if (tableFilters.consultant) {
                const cName = r.consultant 
                    ? (allConsultants.find(c => c.id === r.consultant)?.name || 'Unknown') 
                    : '未指定';
                if (cName !== tableFilters.consultant) return false;
            }

            if (tableFilters.status) {
                let s = '未到診';
                const todayStr = new Date().toISOString().split('T')[0];
                if (r.isClosed) s = '已成交';
                else if (r.isVisited) s = '已報到';
                else if (r.date > todayStr) s = '待回診';
                
                if (s !== tableFilters.status) return false;
            }

            return true;
        }).sort((a,b) => b.date.localeCompare(a.date));
    }, [npRecords, tableFilters, allConsultants, clinics, allDoctors]);

    // --- Actions ---
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
            console.error(e);
        } finally {
            setIsSaving(false);
        }
    };

    // --- MARKETING SYNC LOGIC (ENHANCED) ---
    const handleCalendarSync = async () => {
        setIsSyncing(true);
        try {
            const [year, month] = currentMonth.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const start = new Date(year, month - 1, 1);
            const end = new Date(year, month - 1, daysInMonth, 23, 59, 59);

            let addedCount = 0;

            const determineSource = (desc: string): string => {
                const lower = (desc || '').toLowerCase();
                if (lower.includes('官網') || lower.includes('後台')) return '官網';
                if (lower.includes('轉介') || lower.includes('轉')) return 'SOV轉介';
                if (lower.includes('tel') || lower.includes('電')) return '電話';
                if (lower.includes('臉書') || lower.includes('ig') || lower.includes('fb') || lower.includes('facebook')) return 'FB';
                if (lower.includes('朋友') || lower.includes('媽媽') || lower.includes('老婆') || lower.includes('男友') || lower.includes('幫約') || lower.includes('介紹') || lower.includes('一起')) return '介紹';
                if (lower.includes('幫')) return '小幫手';
                if (lower.includes('現') || lower.includes('現場')) return '過路客';
                if (lower.includes('line')) return 'Line';
                return '其他';
            };

            for (const clinic of clinics) {
                if (!clinic.googleCalendarMapping) continue;
                
                const calendarIds = new Map<string, string>();
                clinic.doctors?.forEach(d => {
                    if (clinic.googleCalendarMapping![d.id]) {
                        calendarIds.set(clinic.googleCalendarMapping![d.id], d.name);
                    }
                });

                for (const [calId, doctorName] of Array.from(calendarIds.entries())) {
                    try {
                        const events = await listEvents(calId, start, end);
                        
                        for (const ev of events) {
                            if (!ev.start.dateTime) continue;

                            const parsed = parseCalendarEvent(ev.summary);
                            const eventDate = ev.start.date || (ev.start.dateTime ? ev.start.dateTime.split('T')[0] : '');
                            
                            if (parsed && parsed.isNP && eventDate) {
                                const existing = await getNPRecord(clinic.id, eventDate, parsed.name);
                                if (!existing) {
                                    const description = ev.description || '';
                                    const detectedSource = determineSource(description);

                                    const newRecord: NPRecord = {
                                        date: eventDate,
                                        clinicId: clinic.id,
                                        clinicName: clinic.name,
                                        patientName: parsed.name,
                                        treatment: parsed.treatment,
                                        doctor: doctorName,
                                        doctorName: doctorName,
                                        isVisited: false, 
                                        isClosed: false,
                                        marketingTag: '矯正諮詢',
                                        source: detectedSource,
                                        calendarNote: description,
                                        updatedAt: new Date()
                                    };
                                    await saveNPRecord(newRecord);
                                    addedCount++;
                                }
                            }
                        }
                    } catch (err) {
                        console.warn(`Failed to sync calendar ${calId}`, err);
                    }
                }
            }
            
            if (addedCount > 0) {
                alert(`同步完成，新增 ${addedCount} 筆 NP 資料`);
            } else {
                alert("同步完成，無新增資料");
            }

        } catch (e) {
            console.error(e);
            alert("同步失敗，請確認 Google 日曆連結狀態");
            handleAuthClick(); 
        } finally {
            setIsSyncing(false);
        }
    };

    const handleDeleteNP = async (record: NPRecord) => {
        if (!confirm(`確定刪除 ${record.patientName} 的資料嗎？此動作無法復原。`)) return;
        try {
            await deleteNPRecord(record.clinicId, record.date, record.patientName);
        } catch (e) {
            alert("刪除失敗");
        }
    };

    const handleManualAdd = () => {
        const [year, month] = currentMonth.split('-').map(Number);
        const today = new Date();
        let defaultDate = today.toISOString().split('T')[0];
        if (today.getMonth() + 1 !== month) {
            defaultDate = `${year}-${String(month).padStart(2, '0')}-01`;
        }

        const newRecord: any = {
            clinicId: clinics[0]?.id || '',
            date: defaultDate,
            patientName: '',
            treatment: ''
        };
        setEditingNP(newRecord);
        setIsManualAdd(true);
    };

    const getStatusBadge = (record: NPRecord) => {
        const todayStr = new Date().toISOString().split('T')[0];
        if (record.isClosed) return <span className="text-emerald-600 font-bold text-xs bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">已成交</span>;
        if (record.isVisited) return <span className="text-blue-600 font-bold text-xs bg-blue-50 px-2 py-0.5 rounded border border-blue-100">已報到</span>;
        if (record.date > todayStr) return <span className="text-amber-600 font-bold text-xs bg-amber-50 px-2 py-0.5 rounded border border-amber-100">待回診</span>;
        return <span className="text-slate-500 font-bold text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200">未到診</span>;
    };

    // --- Chart Data Preparation (Memoized) ---
    const chartData = useMemo(() => {
        return sortedSnapshot.map(d => {
            const revTarget = d.targets.revenueTarget || 0;
            const spTarget = d.targets.selfPayTarget || 0;
            
            return {
                name: d.clinicName,
                RevenueActual: d.actualRevenue,
                RevenueTarget: revTarget,
                RevenueRate: revTarget > 0 ? (d.actualRevenue / revTarget) * 100 : 0,
                SelfPayActual: d.actualSelfPay,
                SelfPayTarget: spTarget,
                SelfPayRate: spTarget > 0 ? (d.actualSelfPay / spTarget) * 100 : 0,
            };
        });
    }, [sortedSnapshot]);

    const pieChartData = useMemo(() => {
        const keys: (keyof SelfPayBreakdown)[] = ['implant', 'ortho', 'prostho', 'sov', 'inv', 'whitening', 'perio', 'other', 'retail'];
        const labels = ['植牙', '矯正', '假牙', 'SOV', 'INV', '美白', '牙周', '其他', '物販/小金庫'];
        const totals = keys.map(() => 0);

        Object.keys(breakdowns).forEach(cid => {
            if (pieFilter === 'all' || pieFilter === cid) {
                const bd = breakdowns[cid];
                keys.forEach((k, idx) => totals[idx] += bd[k]);
            }
        });

        return keys.map((k, i) => ({ name: labels[i], value: totals[i] })).filter(item => item.value > 0);
    }, [breakdowns, pieFilter]);

    // Marketing Analytics Data (Updated for Clinic Filter)
    const marketingData = useMemo(() => {
        const records = marketingClinicFilter === 'all' 
            ? npRecords 
            : npRecords.filter(r => r.clinicId === marketingClinicFilter);

        const leads = records.length;
        const visited = records.filter(r => r.isVisited).length;
        const closed = records.filter(r => r.isClosed).length;
        const funnelData = [
            { name: 'Leads (NP)', value: leads, fill: '#818cf8' },
            { name: 'Visited (已診)', value: visited, fill: '#34d399' },
            { name: 'Closed (成交)', value: closed, fill: '#f472b6' }
        ];

        const distMap: Record<string, number> = {};
        records.forEach(r => {
            const key = marketingPieMode === 'tag' ? (r.marketingTag || '未分類') : (r.source || '未分類');
            distMap[key] = (distMap[key] || 0) + 1;
        });
        const distData = Object.keys(distMap).map(k => ({ name: k, value: distMap[k] }));

        const consultantMap: Record<string, { leads: number, closed: number, revenue: number }> = {};
        records.forEach(r => {
            const name = r.consultant ? 
                (allConsultants.find(c => c.id === r.consultant)?.name || 'Unknown') 
                : '未指定';
            
            if (!consultantMap[name]) consultantMap[name] = { leads: 0, closed: 0, revenue: 0 };
            consultantMap[name].leads++;
            if (r.isClosed) {
                consultantMap[name].closed++;
                consultantMap[name].revenue += r.dealAmount || 0;
            }
        });
        const scorecard = Object.keys(consultantMap).map(name => ({
            name,
            ...consultantMap[name],
            rate: consultantMap[name].leads > 0 ? (consultantMap[name].closed / consultantMap[name].leads) * 100 : 0
        })).sort((a,b) => b.revenue - a.revenue);

        return { funnelData, distData, scorecard };
    }, [npRecords, marketingPieMode, marketingClinicFilter, allConsultants]);

    const setFilter = (key: keyof typeof tableFilters, val: string) => {
        setTableFilters(prev => ({ ...prev, [key]: val }));
    };

    return (
        <div className="space-y-8 pb-12 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <BarChart2 className="text-indigo-600" />
                        集團營運儀表板 (Group BI)
                    </h2>
                    <p className="text-slate-500 text-sm">監控全集團營收、自費分析與目標達成率。</p>
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
                    {/* Just a refresh button, though effect handles updates */}
                    <div className="text-xs text-slate-400 font-medium px-2">
                        {isNpLoading || isFinancialLoading ? <Loader2 className="animate-spin text-indigo-500" size={20} /> : <Activity size={20} className="text-slate-300" />}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <KPICard 
                    title="總營收 (Revenue)" 
                    actual={currentTotals.revenue} 
                    target={currentTotals.targetRevenue} 
                    prev={prevTotals.revenue}
                    yearPrev={yearPrevTotals.revenue}
                    prefix="$" 
                    colorClass="text-indigo-600"
                    isActive={activeTab === 'revenue'}
                    onClick={() => setActiveTab('revenue')}
                    icon={DollarSign}
                />
                <KPICard 
                    title="自費營收 (Self-Pay)" 
                    actual={currentTotals.selfPay} 
                    target={currentTotals.targetSelfPay} 
                    prev={prevTotals.selfPay}
                    yearPrev={yearPrevTotals.selfPay}
                    prefix="$" 
                    colorClass="text-purple-600"
                    isActive={activeTab === 'self-pay'}
                    onClick={() => setActiveTab('self-pay')}
                    icon={PieChartIcon}
                />
                <KPICard 
                    title="NP 成交人次 (NP Deals)" 
                    actual={npClosed}
                    customRate={npConversionRate}
                    customSubtext={`到診: ${npVisited} / 約診: ${npTotal}`}
                    prev={0} 
                    yearPrev={0}
                    colorClass="text-emerald-600"
                    isActive={activeTab === 'marketing'}
                    onClick={() => setActiveTab('marketing')}
                    icon={Users}
                />
            </div>

            {/* Main Content Area */}
            {activeTab === 'marketing' ? (
                // --- MARKETING ANALYSIS VIEW ---
                <div className="space-y-6 animate-fade-in">
                    
                    {/* Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        
                        {/* 1. Funnel */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                                <Target size={18} className="text-rose-500"/> 轉換漏斗 (Conversion)
                            </h3>
                            <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart 
                                        layout="vertical" 
                                        data={marketingData.funnelData} 
                                        margin={{top: 5, right: 30, left: 40, bottom: 5}}
                                        barCategoryGap="15%"
                                    >
                                        <XAxis type="number" hide />
                                        <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 11, fontWeight: 'bold'}} />
                                        <Tooltip cursor={{fill: 'transparent'}} />
                                        <Bar dataKey="value" barSize={30} radius={[0, 4, 4, 0]}>
                                            {marketingData.funnelData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.fill} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* 2. Distribution Pie (Enhanced) */}
                        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                    <PieChartIcon size={18} className="text-teal-500"/> 客群分佈 (Distribution)
                                </h3>
                                <div className="flex gap-2">
                                    <select 
                                        className="bg-slate-50 border border-slate-200 text-xs rounded px-2 py-1 outline-none text-slate-600 font-bold"
                                        value={marketingClinicFilter}
                                        onChange={(e) => setMarketingClinicFilter(e.target.value)}
                                    >
                                        <option value="all">全集團 (All Clinics)</option>
                                        {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>

                                    <div className="flex bg-slate-100 rounded-lg p-1 text-xs font-bold">
                                        <button 
                                            onClick={() => setMarketingPieMode('tag')}
                                            className={`px-3 py-1 rounded transition-all ${marketingPieMode === 'tag' ? 'bg-white shadow text-teal-600' : 'text-slate-500'}`}
                                        >
                                            依項目
                                        </button>
                                        <button 
                                            onClick={() => setMarketingPieMode('source')}
                                            className={`px-3 py-1 rounded transition-all ${marketingPieMode === 'source' ? 'bg-white shadow text-teal-600' : 'text-slate-500'}`}
                                        >
                                            依來源
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 w-full relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={marketingData.distData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={2}
                                            dataKey="value"
                                            label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        >
                                            {marketingData.distData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Consultant Scorecard */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 bg-indigo-50 border-b border-indigo-100">
                            <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                                <Trophy size={18} className="text-amber-500"/> 諮詢師績效榜 (Scorecard)
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-white text-slate-500 font-bold uppercase text-xs border-b border-slate-100">
                                    <tr>
                                        <th className="px-4 py-3">諮詢師</th>
                                        <th className="px-4 py-3 text-right">接洽數 (Leads)</th>
                                        <th className="px-4 py-3 text-right">成交數 (Closed)</th>
                                        <th className="px-4 py-3 text-right">成交率 (Rate)</th>
                                        <th className="px-4 py-3 text-right">總成交金額</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {marketingData.scorecard.map((c, idx) => (
                                        <tr key={c.name} className="hover:bg-indigo-50/20">
                                            <td className="px-4 py-3 font-bold text-slate-700">
                                                {idx < 3 && <span className="mr-1 text-amber-500">★</span>}
                                                {c.name}
                                            </td>
                                            <td className="px-4 py-3 text-right">{c.leads}</td>
                                            <td className="px-4 py-3 text-right">{c.closed}</td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${c.rate >= 50 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                    {c.rate.toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-indigo-700">
                                                ${c.revenue.toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                    {marketingData.scorecard.length === 0 && (
                                        <tr><td colSpan={5} className="p-8 text-center text-slate-400">無數據</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Raw Data Table with Advanced Filters */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                    <Users size={18} className="text-slate-500"/> NP 原始資料 (Raw Data)
                                </h3>
                                {isNpLoading && <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 className="animate-spin" size={12}/> Live Updating...</span>}
                            </div>
                            <div className="flex gap-2">
                                <button 
                                    onClick={handleManualAdd}
                                    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                                >
                                    <Plus size={14}/> 手動新增
                                </button>
                                <button 
                                    onClick={handleCalendarSync}
                                    disabled={isSyncing}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
                                >
                                    {isSyncing ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>}
                                    同步約診日曆
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto max-h-96 custom-scrollbar">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-white text-slate-500 font-bold uppercase text-xs border-b border-slate-100 sticky top-0 z-10">
                                    <tr>
                                        {/* DATE FILTER */}
                                        <th className="px-4 py-2 w-28 bg-slate-50">
                                            <TableHeaderFilter 
                                                label="日期" 
                                                value={tableFilters.date} 
                                                onChange={v => setFilter('date', v)} 
                                                options={uniqueValues.dates}
                                            />
                                        </th>
                                        
                                        {/* NAME (NO FILTER) */}
                                        <th className="px-4 py-2 w-32 bg-slate-50 align-top">
                                            <div className="mt-1">姓名</div>
                                        </th>

                                        {/* CLINIC FILTER (NEW) */}
                                        <th className="px-4 py-2 w-28 bg-slate-50">
                                            <TableHeaderFilter 
                                                label="診所" 
                                                value={tableFilters.clinicName} 
                                                onChange={v => setFilter('clinicName', v)} 
                                                options={uniqueValues.clinics}
                                            />
                                        </th>

                                        {/* DOCTOR FILTER */}
                                        <th className="px-4 py-2 w-24 bg-slate-50">
                                            <TableHeaderFilter 
                                                label="醫師" 
                                                value={tableFilters.doctorName} 
                                                onChange={v => setFilter('doctorName', v)} 
                                                options={uniqueValues.doctors}
                                            />
                                        </th>

                                        {/* TREATMENT (No Filter) */}
                                        <th className="px-4 py-2 bg-slate-50 align-top">
                                            <div className="mt-1">療程內容</div>
                                        </th>

                                        {/* TAG FILTER */}
                                        <th className="px-4 py-2 w-28 bg-slate-50">
                                            <TableHeaderFilter 
                                                label="項目 (Tag)" 
                                                value={tableFilters.marketingTag} 
                                                onChange={v => setFilter('marketingTag', v)} 
                                                options={uniqueValues.tags}
                                            />
                                        </th>

                                        {/* SOURCE FILTER */}
                                        <th className="px-4 py-2 w-24 bg-slate-50">
                                            <TableHeaderFilter 
                                                label="來源" 
                                                value={tableFilters.source} 
                                                onChange={v => setFilter('source', v)} 
                                                options={uniqueValues.sources}
                                            />
                                        </th>

                                        {/* CALENDAR NOTE */}
                                        <th className="px-4 py-2 w-48 bg-slate-50 align-top">
                                            <div className="mt-1">日曆備註</div>
                                        </th>

                                        {/* CONSULTANT FILTER */}
                                        <th className="px-4 py-2 w-24 bg-slate-50">
                                            <TableHeaderFilter 
                                                label="諮詢師" 
                                                value={tableFilters.consultant} 
                                                onChange={v => setFilter('consultant', v)} 
                                                options={uniqueValues.consultants}
                                            />
                                        </th>

                                        {/* STATUS FILTER */}
                                        <th className="px-4 py-2 w-24 text-center bg-slate-50">
                                            <TableHeaderFilter 
                                                label="狀態" 
                                                value={tableFilters.status} 
                                                onChange={v => setFilter('status', v)} 
                                                options={uniqueValues.statuses}
                                            />
                                        </th>

                                        <th className="px-4 py-2 text-right w-12 bg-slate-50"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredNpRecords.map(r => {
                                            const consultantName = r.consultant 
                                                ? (allConsultants.find(c => c.id === r.consultant)?.name || 'Unknown') 
                                                : '-';
                                            const docName = getDoctorName(r); 
                                            const clinicName = getClinicName(r);
                                            
                                            return (
                                                <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => { setEditingNP(r); setIsManualAdd(false); }}>
                                                    <td className="px-4 py-3 font-mono text-slate-500">{r.date.slice(5)}</td>
                                                    <td className="px-4 py-3 font-bold text-slate-700">{r.patientName}</td>
                                                    <td className="px-4 py-3 text-slate-600 text-xs">{clinicName}</td>
                                                    <td className="px-4 py-3 text-slate-600">{docName}</td>
                                                    <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[150px]" title={r.treatment}>{r.treatment}</td>
                                                    <td className="px-4 py-3">
                                                        <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100 text-xs whitespace-nowrap">
                                                            {r.marketingTag || '-'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-600 text-xs">{r.source || '-'}</td>
                                                    <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[150px]" title={r.calendarNote}>{r.calendarNote || '-'}</td>
                                                    <td className="px-4 py-3 text-slate-600 text-xs">{consultantName}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        {getStatusBadge(r)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteNP(r); }} 
                                                            className="text-slate-300 hover:text-rose-500 p-1 rounded transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                    })}
                                    {filteredNpRecords.length === 0 && (
                                        <tr><td colSpan={11} className="p-8 text-center text-slate-400">尚無符合條件的資料</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : activeTab === 'self-pay' ? (
                // ... Existing Self Pay View ...
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200 min-h-[400px]">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                    <TrendingUp size={18} className="text-purple-500"/> 各診所自費總額 (Target vs Actual)
                                </h3>
                            </div>
                            <div className="h-80 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartData} margin={{top: 20, right: 30, left: 0, bottom: 5}}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12, fontWeight: 600}} dy={10} />
                                        <YAxis yAxisId="amount" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} tickFormatter={(val) => `$${val/1000}k`} />
                                        <YAxis yAxisId="rate" orientation="right" axisLine={false} tickLine={false} tick={{fill: '#f59e0b', fontSize: 12}} unit="%" />
                                        <Tooltip content={<CustomTooltip valuePrefix="$" />} cursor={{fill: '#f8fafc'}} />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                        
                                        <Bar yAxisId="amount" dataKey="SelfPayTarget" name="目標 (Target)" fill="#e5e7eb" radius={[4, 4, 0, 0]} barSize={24} />
                                        <Bar yAxisId="amount" dataKey="SelfPayActual" name="實際 (Actual)" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={24} />
                                        <Line yAxisId="rate" type="monotone" dataKey="SelfPayRate" name="達成率 (%)" stroke="#f59e0b" strokeWidth={3} dot={{r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff'}} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 min-h-[400px] flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                    <PieChartIcon size={18} className="text-indigo-500"/> 項目佔比
                                </h3>
                                <select 
                                    className="text-xs border rounded p-1 outline-none bg-slate-50 text-slate-600"
                                    value={pieFilter}
                                    onChange={e => setPieFilter(e.target.value)}
                                >
                                    <option value="all">全集團</option>
                                    {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 w-full relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieChartData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={2}
                                            dataKey="value"
                                        >
                                            {pieChartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val: number) => `$${val.toLocaleString()}`} />
                                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 bg-purple-50 border-b border-purple-100 flex justify-between items-center">
                            <h3 className="font-bold text-purple-900 flex items-center gap-2">
                                <DollarSign size={18} className="text-purple-600"/> 
                                自費項目詳細報表 (Detailed Breakdown)
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-white border-b border-slate-100 text-slate-500 font-bold uppercase text-xs">
                                    <tr>
                                        <th className="px-4 py-3 sticky left-0 bg-white z-10 border-r border-slate-100">診所</th>
                                        <th className="px-4 py-3 text-right bg-purple-50/50 text-purple-900 font-black">自費總計</th>
                                        <th className="px-4 py-3 text-right">植牙 (Implant)</th>
                                        <th className="px-4 py-3 text-right">矯正 (Ortho)</th>
                                        <th className="px-4 py-3 text-right">假牙 (Prostho)</th>
                                        <th className="px-4 py-3 text-right">SOV</th>
                                        <th className="px-4 py-3 text-right">INV</th>
                                        <th className="px-4 py-3 text-right">美白 (White)</th>
                                        <th className="px-4 py-3 text-right">牙周 (Perio)</th>
                                        <th className="px-4 py-3 text-right">其他</th>
                                        <th className="px-4 py-3 text-right text-orange-600 bg-orange-50/30">物販/小金庫</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sortedClinics.map(clinic => {
                                            const bd = breakdowns[clinic.id] || { total:0, prostho:0, implant:0, ortho:0, sov:0, inv:0, whitening:0, perio:0, other:0, retail:0 };
                                            return (
                                                <tr key={clinic.id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 font-bold text-slate-700 sticky left-0 bg-white border-r border-slate-100">{clinic.name}</td>
                                                    <td className="px-4 py-3 text-right font-black text-purple-700 bg-purple-50/30">${bd.total.toLocaleString()}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{bd.implant > 0 ? bd.implant.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{bd.ortho > 0 ? bd.ortho.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{bd.prostho > 0 ? bd.prostho.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{bd.sov > 0 ? bd.sov.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{bd.inv > 0 ? bd.inv.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{bd.whitening > 0 ? bd.whitening.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{bd.perio > 0 ? bd.perio.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-400">{bd.other > 0 ? bd.other.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-orange-600 bg-orange-50/30 font-bold">{bd.retail > 0 ? bd.retail.toLocaleString() : '-'}</td>
                                                </tr>
                                            );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            ) : (
                // --- REVENUE VIEW (Matrix) ---
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200 min-h-[400px]">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                    <TrendingUp size={18} className="text-indigo-500"/> 
                                    營收達成狀況 (Revenue vs Target)
                                </h3>
                            </div>
                            <div className="h-80 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartData} margin={{top: 20, right: 30, left: 0, bottom: 5}}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12, fontWeight: 600}} dy={10} />
                                        
                                        <YAxis yAxisId="amount" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} tickFormatter={(val) => `$${val/1000}k`} />
                                        <YAxis yAxisId="rate" orientation="right" axisLine={false} tickLine={false} tick={{fill: '#f59e0b', fontSize: 12}} unit="%" />
                                        
                                        <Tooltip content={<CustomTooltip valuePrefix="$" />} cursor={{fill: '#f8fafc'}} />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />

                                        <Bar yAxisId="amount" dataKey="RevenueTarget" name="目標 (Target)" fill="#e5e7eb" radius={[4, 4, 0, 0]} barSize={24} />
                                        <Bar yAxisId="amount" dataKey="RevenueActual" name="實際 (Actual)" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={24} />
                                        <Line yAxisId="rate" type="monotone" dataKey="RevenueRate" name="達成率 (%)" stroke="#f59e0b" strokeWidth={3} dot={{r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff'}} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                                <Trophy size={18} className="text-amber-500" /> 
                                業績達成排行榜
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
                                                const targetA = a.targets.revenueTarget;
                                                const actualA = a.actualRevenue;
                                                const rateA = targetA ? actualA / targetA : 0;

                                                const targetB = b.targets.revenueTarget;
                                                const actualB = b.actualRevenue;
                                                const rateB = targetB ? actualB / targetB : 0;
                                                
                                                return rateB - rateA;
                                            })
                                            .map((d, idx) => {
                                                const target = d.targets.revenueTarget;
                                                const actual = d.actualRevenue;
                                                const rate = target ? (actual / target) * 100 : 0;
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
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

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
                                    </tr>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="sticky left-0 bg-slate-50 z-20 border-r border-slate-200 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]"></th>
                                        
                                        <th className="px-2 py-1 text-right text-slate-400 min-w-[90px]">目標</th>
                                        <th className="px-2 py-1 text-right text-slate-700 min-w-[90px]">實際</th>
                                        <th className="px-2 py-1 text-right text-slate-400 min-w-[60px]">%</th>
                                        
                                        <th className="px-2 py-1 text-right text-slate-400 min-w-[90px]">目標</th>
                                        <th className="px-2 py-1 text-right text-slate-700 min-w-[90px]">實際</th>
                                        <th className="px-2 py-1 text-right text-slate-400 min-w-[60px]">%</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sortedSnapshot.map(d => {
                                        const rTarget = d.targets.revenueTarget || 0;
                                        const rRate = rTarget > 0 ? (d.actualRevenue / rTarget) * 100 : 0;
                                        
                                        const sTarget = d.targets.selfPayTarget || 0;
                                        const sRate = sTarget > 0 ? (d.actualSelfPay / sTarget) * 100 : 0;
                                        
                                        return (
                                            <tr key={d.clinicId} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-4 py-3 font-bold text-slate-700 sticky left-0 bg-white border-r border-slate-100 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)] z-10">
                                                    {d.clinicName}
                                                </td>
                                                
                                                {/* Revenue */}
                                                <td className="px-2 py-2 text-right">
                                                    <input 
                                                        type="number" 
                                                        className="w-full text-right border-b border-dashed border-slate-300 focus:border-indigo-500 outline-none bg-transparent"
                                                        value={d.targets.revenueTarget || ''}
                                                        onChange={(e) => handleTargetChange(d.clinicId, 'revenueTarget', e.target.value)}
                                                        onBlur={() => handleSaveTarget(d.clinicId)}
                                                        placeholder="0"
                                                    />
                                                </td>
                                                <td className="px-2 py-2 text-right font-mono text-slate-700">{d.actualRevenue.toLocaleString()}</td>
                                                <td className={`px-2 py-2 text-right text-xs font-bold ${rRate >= 100 ? 'text-emerald-500' : 'text-slate-400'}`}>{rRate.toFixed(0)}%</td>
                                                
                                                {/* Self Pay */}
                                                <td className="px-2 py-2 text-right bg-slate-50/30 border-l border-slate-50">
                                                    <input 
                                                        type="number" 
                                                        className="w-full text-right border-b border-dashed border-slate-300 focus:border-purple-500 outline-none bg-transparent"
                                                        value={d.targets.selfPayTarget || ''}
                                                        onChange={(e) => handleTargetChange(d.clinicId, 'selfPayTarget', e.target.value)}
                                                        onBlur={() => handleSaveTarget(d.clinicId)}
                                                        placeholder="0"
                                                    />
                                                </td>
                                                <td className="px-2 py-2 text-right font-mono text-slate-700 bg-slate-50/30">{d.actualSelfPay.toLocaleString()}</td>
                                                <td className={`px-2 py-2 text-right text-xs font-bold bg-slate-50/30 ${sRate >= 100 ? 'text-emerald-500' : 'text-slate-400'}`}>{sRate.toFixed(0)}%</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* NP Editor Modal */}
            {editingNP && (
                <NPStatusModal 
                    isOpen={!!editingNP}
                    onClose={() => setEditingNP(null)} // IMPORTANT: Removed loadData()
                    row={{ patientName: editingNP.patientName, treatmentContent: editingNP.treatment } as any} 
                    clinicId={editingNP.clinicId}
                    date={editingNP.date}
                />
            )}
        </div>
    );
};