
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
    getPatients, migratePatientId, Patient, 
} from '../services/firebase';
import { useClinic } from '../contexts/ClinicContext';
import { 
    Users, Search, RefreshCw, Loader2, Save, History, 
    ArrowRight, AlertTriangle, Building2, ChevronDown
} from 'lucide-react';
import { PatientHistoryModal } from '../components/PatientHistoryModal';

// Badge Colors for Purchased Items
const BADGE_COLORS: Record<string, string> = {
    '植牙': 'bg-blue-100 text-blue-700 border-blue-200',
    '矯正': 'bg-purple-100 text-purple-700 border-purple-200',
    '隱適美': 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
    '假牙': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'SOV': 'bg-pink-100 text-pink-700 border-pink-200',
    '美白': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    '牙周': 'bg-teal-100 text-teal-700 border-teal-200',
    '物販': 'bg-orange-100 text-orange-700 border-orange-200',
    '小金庫': 'bg-emerald-100 text-emerald-700 border-emerald-200'
};

const DefaultBadge = 'bg-slate-100 text-slate-600 border-slate-200';

// Helper: Safely extract purchased items as array
const getPurchasedItems = (patient: any): string[] => {
    if (Array.isArray(patient.purchasedItems)) {
        return patient.purchasedItems;
    }
    // Fallback: If it's a string, wrap it in an array.
    if (typeof patient.purchasedItems === 'string' && patient.purchasedItems.trim() !== '') {
        return [patient.purchasedItems];
    }
    return [];
};

export const PatientManager: React.FC = () => {
    const { selectedClinicId, clinics } = useClinic();
    
    // Local Clinic State for Filtering
    const [currentClinicId, setCurrentClinicId] = useState<string>(selectedClinicId || '');

    const [patients, setPatients] = useState<Patient[]>([]);
    const [lastDoc, setLastDoc] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Debounce Ref
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Filters
    const [showMissingIdOnly, setShowMissingIdOnly] = useState(false);

    // UI State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [tempIdValue, setTempIdValue] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    
    // History Modal
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);

    // Sync local clinic state with global on mount/change if empty
    useEffect(() => {
        if (selectedClinicId && !currentClinicId) {
            setCurrentClinicId(selectedClinicId);
        }
    }, [selectedClinicId]);

    // Data Loading Function
    const loadData = useCallback(async (reset = false, search = '') => {
        if (!currentClinicId) return;
        setLoading(true);
        try {
            const startDoc = reset ? undefined : lastDoc;
            const res = await getPatients(currentClinicId, startDoc, search);
            
            if (reset) {
                setPatients(res.patients);
            } else {
                setPatients(prev => [...prev, ...res.patients]);
            }
            
            // If searching, we currently disable pagination cursor because sort orders might differ
            // Ideally backend returns compatible cursors, but simplicity for now:
            if (search) {
                setHasMore(false); // Disable "Load More" in search mode to prevent cursor mismatch errors
            } else {
                setLastDoc(res.lastVisible);
                setHasMore(!!res.lastVisible);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [currentClinicId, lastDoc]);

    // Handle Search Term Changes with Debounce
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        debounceRef.current = setTimeout(() => {
            // Trigger load with reset=true and the current searchTerm
            // Only if clinic matches
            if (currentClinicId) {
                loadData(true, searchTerm);
            }
        }, 500);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [searchTerm, currentClinicId]);

    // Client-side filtering only for "Missing ID" toggle (visual filter on loaded set)
    // Since backend query handles the bulk, this is fine for the view.
    const displayedPatients = patients.filter(p => {
        if (showMissingIdOnly) {
            if (p.chartId) return false; // Skip if has ID
        }
        return true;
    });

    const handleIdEditStart = (patient: Patient) => {
        setEditingId(patient.docId);
        setTempIdValue(patient.chartId || '');
    };

    const handleIdMigration = async (patient: Patient) => {
        if (!tempIdValue || tempIdValue === patient.chartId) {
            setEditingId(null);
            return;
        }

        const action = tempIdValue === patient.chartId ? "無變更" : "變更";
        if (action === "無變更") {
             setEditingId(null);
             return;
        }

        if (!confirm(`確定將病歷號從 "${patient.chartId || '無'}" 改為 "${tempIdValue}"？\n如果目標病歷號已存在，資料將會自動合併 (Merge)。`)) {
            setEditingId(null);
            return;
        }

        setProcessingId(patient.docId);
        try {
            await migratePatientId(patient.docId, tempIdValue, patient.clinicId);
            // Reload to reflect changes
            await loadData(true, searchTerm);
        } catch (e: any) {
            alert("更新失敗: " + e.message);
        } finally {
            setProcessingId(null);
            setEditingId(null);
        }
    };

    const openHistory = (patient: Patient) => {
        setSelectedPatient(patient);
        setIsHistoryOpen(true);
    };

    return (
        <div className="space-y-6 pb-20">
            {/* Header */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <Users className="text-indigo-600" /> 病歷管理系統 (CRM)
                        </h2>
                        <p className="text-slate-500 text-sm">管理病患資料、修正病歷號與檢視消費紀錄。</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-slate-50 p-4 rounded-lg border border-slate-200">
                    {/* Local Clinic Selector */}
                    <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">診所 (Clinic)</label>
                        <div className="relative group">
                            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <select
                                className="w-full pl-10 pr-8 py-2 border rounded-lg appearance-none bg-white font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer hover:border-indigo-300"
                                value={currentClinicId}
                                onChange={(e) => setCurrentClinicId(e.target.value)}
                            >
                                <option value="" disabled>請選擇診所</option>
                                {clinics.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                        </div>
                    </div>

                    {/* Search */}
                    <div className="md:col-span-4 relative">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">搜尋 (Server-Side)</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input 
                                type="text" 
                                className="w-full pl-10 pr-4 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="輸入姓名或病歷號..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                            {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-indigo-500" size={16} />}
                        </div>
                    </div>

                    {/* Filters & Actions */}
                    <div className="md:col-span-5 flex items-center justify-between gap-4">
                        <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 select-none shadow-sm transition-colors">
                            <input 
                                type="checkbox" 
                                checked={showMissingIdOnly}
                                onChange={e => setShowMissingIdOnly(e.target.checked)}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm font-bold text-slate-600">只顯示未設定病歷號</span>
                        </label>

                        <button 
                            onClick={() => loadData(true, searchTerm)} 
                            className="bg-white hover:bg-slate-100 text-slate-600 p-2 rounded-lg border border-slate-300 transition-colors shadow-sm"
                            title="重新整理"
                        >
                            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Patient Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 w-48">病歷號 (Chart ID)</th>
                                <th className="px-6 py-4 w-32">姓名</th>
                                <th className="px-6 py-4 w-32">最近看診</th>
                                <th className="px-6 py-4">消費項目 (Purchased Items)</th>
                                <th className="px-6 py-4 text-right w-24">詳細</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {displayedPatients.map(patient => {
                                const purchasedItems = getPurchasedItems(patient);
                                return (
                                    <tr key={patient.docId} className="hover:bg-slate-50 transition-colors group">
                                        {/* Chart ID Column */}
                                        <td className="px-6 py-4">
                                            {processingId === patient.docId ? (
                                                <div className="flex items-center gap-2 text-indigo-600">
                                                    <Loader2 size={16} className="animate-spin" /> 更新中...
                                                </div>
                                            ) : editingId === patient.docId ? (
                                                <div className="flex items-center gap-2">
                                                    <input 
                                                        className="border rounded px-2 py-1 w-24 font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        value={tempIdValue}
                                                        onChange={e => setTempIdValue(e.target.value)}
                                                        onBlur={() => handleIdMigration(patient)}
                                                        onKeyDown={e => e.key === 'Enter' && handleIdMigration(patient)}
                                                        autoFocus
                                                    />
                                                </div>
                                            ) : (
                                                <div 
                                                    className={`flex items-center gap-2 cursor-pointer ${!patient.chartId ? 'text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200' : 'text-slate-700 font-mono font-bold'}`}
                                                    onClick={() => handleIdEditStart(patient)}
                                                    title="點擊修改"
                                                >
                                                    {patient.chartId || <span className="flex items-center gap-1 text-xs font-bold"><AlertTriangle size={12}/> 設定病歷號</span>}
                                                    <span className="opacity-0 group-hover:opacity-100 text-slate-400"><Save size={12} /></span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Name */}
                                        <td className="px-6 py-4 font-bold text-slate-800">{patient.name}</td>

                                        {/* Last Visit */}
                                        <td className="px-6 py-4 text-slate-500 font-mono">
                                            {patient.lastVisit || '-'}
                                        </td>

                                        {/* Purchased Items (Tags) */}
                                        <td className="px-6 py-4">
                                            <div className="flex flex-wrap gap-2 items-center">
                                                {purchasedItems.map(item => (
                                                    <span key={item} className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold border ${BADGE_COLORS[item] || DefaultBadge}`}>
                                                        {item}
                                                    </span>
                                                ))}
                                                {purchasedItems.length === 0 && (
                                                    <span className="text-slate-300 text-xs italic">無特定自費紀錄</span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Actions */}
                                        <td className="px-6 py-4 text-right">
                                            <button 
                                                onClick={() => openHistory(patient)}
                                                className="text-slate-400 hover:text-indigo-600 transition-colors p-2 rounded-full hover:bg-indigo-50"
                                                title="查看歷程"
                                            >
                                                <History size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            
                            {displayedPatients.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-12 text-center text-slate-400">
                                        {loading ? "搜尋中..." : showMissingIdOnly ? "太棒了！所有病患皆已設定病歷號。" : "無符合資料"}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                
                {/* Load More */}
                {hasMore && !searchTerm && (
                    <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-center">
                        <button 
                            onClick={() => loadData(false)}
                            disabled={loading}
                            className="text-sm font-bold text-slate-500 hover:text-indigo-600 flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-white transition-colors"
                        >
                            {loading ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                            載入更多
                        </button>
                    </div>
                )}
            </div>

            <PatientHistoryModal 
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
                patient={selectedPatient}
            />
        </div>
    );
};
