
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clinic, Laboratory, AccountingRow, TechnicianRecord, Doctor, LabOrderDetail } from '../types';
import { getMonthlyAccounting, getTechnicianRecords, saveTechnicianRecord, deleteTechnicianRecord, loadAppData } from '../services/firebase';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';
import { 
    Microscope, Save, Plus, Loader2, 
    Search, X, FileEdit, Trash2, List
} from 'lucide-react';

interface Props {
  clinics: Clinic[]; // Compatible but unused for selection
  laboratories: Laboratory[];
}

// Extended row for UI display
interface LinkedRow extends AccountingRow {
    originalDate: string; 
    savedFee?: number; // Fee from technician_records
    currentFee: number; // Current displayed fee (Net)
    recordId?: string; // ID of the linked technician_record
    
    // Category Attribution Logic
    availableCategories: { key: string; label: string }[];
    selectedCategory: string; // The currently selected attribution
    
    // Details
    details?: LabOrderDetail[];
    discount?: number;

    isDirty: boolean; // If input changed
}

const CATEGORY_MAP: Record<string, string> = {
    'prostho': '假牙',
    'implant': '植牙',
    'ortho': '矯正',
    'sov': 'SOV',
    'inv': 'INV',
    'whitening': '美白',
    'perio': '牙周',
    'otherSelfPay': '其他',
    'vault': '小金庫/物販'
};

const MANUAL_CATEGORY_OPTIONS = [
    { value: 'prostho', label: '假牙' },
    { value: 'implant', label: '植牙' },
    { value: 'ortho', label: '矯正' },
    { value: 'sov', label: 'SOV' },
    { value: 'inv', label: 'INV' },
    { value: 'whitening', label: '美白' },
    { value: 'perio', label: '牙周' },
    { value: 'otherSelfPay', label: '其他' },
    { value: 'vault', label: '小金庫/物販' },
];

// Helper: Inline Input for Table Editing
const InlineInput = ({ 
    value, 
    onChange, 
    className = "", 
    placeholder = "",
    type = "text",
    list
}: { 
    value: string | number | undefined; 
    onChange: (val: string) => void; 
    className?: string; 
    placeholder?: string;
    type?: string;
    list?: string;
}) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleBlur = () => {
        if (localValue !== value) {
            onChange(String(localValue));
        }
    };

    return (
        <input 
            type={type}
            className={`w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 outline-none transition-all ${className}`}
            value={localValue || ''}
            onChange={e => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            placeholder={placeholder}
            list={list}
        />
    );
};

export const LabReconciliation: React.FC<Props> = ({ laboratories }) => {
    const navigate = useNavigate();
    const { selectedClinicId } = useClinic();
    const [selectedLabId, setSelectedLabId] = useState<string>(''); // '' or 'all'
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    
    const [linkedRows, setLinkedRows] = useState<LinkedRow[]>([]);
    const [manualRecords, setManualRecords] = useState<TechnicianRecord[]>([]);
    const [clinicDoctors, setClinicDoctors] = useState<Doctor[]>([]);
    
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Order Modal State
    const [orderModalOpen, setOrderModalOpen] = useState(false);
    const [activeOrderType, setActiveOrderType] = useState<'linked' | 'manual'>('linked');
    const [selectedOrderRecordId, setSelectedOrderRecordId] = useState<string | null>(null); // For manual
    const [selectedOrderRowId, setSelectedOrderRowId] = useState<string | null>(null); // For linked
    
    const [orderRowRevenue, setOrderRowRevenue] = useState(0); 
    const [orderItems, setOrderItems] = useState<LabOrderDetail[]>([]);
    const [orderDiscount, setOrderDiscount] = useState(0);
    const [activeOrderLab, setActiveOrderLab] = useState<Laboratory | undefined>(undefined);

    useEffect(() => {
        if (selectedClinicId) {
            // Default to 'all'
            setSelectedLabId('all');
            
            // Fetch Doctors for Dropdown
            const loadDocs = async () => {
                try {
                    const data = await loadAppData();
                    const docs = data.doctors.filter(d => d.clinicId === selectedClinicId);
                    setClinicDoctors(docs);
                } catch(e) { console.error(e); }
            };
            loadDocs();
        }
    }, [selectedClinicId]);

    useEffect(() => {
        if (selectedClinicId && selectedLabId && selectedMonth) {
            fetchData();
        }
    }, [selectedClinicId, selectedLabId, selectedMonth]);

    const getLabName = (id: string) => laboratories.find(l => l.id === id)?.name || '';

    const fetchData = async () => {
        if (!selectedClinicId) return;
        setIsLoading(true);
        setLinkedRows([]);
        setManualRecords([]);

        try {
            const labNameFilter = selectedLabId === 'all' ? null : getLabName(selectedLabId);

            // 1. Fetch Daily Accounting (Read-Only Source)
            const dailyData = await getMonthlyAccounting(selectedClinicId, selectedMonth);
            
            // 2. Fetch Existing Technician Records (Write Target)
            const techData = await getTechnicianRecords(selectedClinicId, labNameFilter, selectedMonth);

            // 3. Separate Manual Adjustments
            const manual = techData.filter(r => r.type === 'manual');
            setManualRecords(manual);

            // 4. Merge Linked Records
            const linkedTechRecords = techData.filter(r => r.type === 'linked');
            const recordMap = new Map(linkedTechRecords.map(r => [r.linkedRowId, r]));

            // 5. Filter Daily Rows
            const merged: LinkedRow[] = dailyData
                .filter(row => {
                    if (labNameFilter) {
                        return row.labName && row.labName.trim() === labNameFilter.trim();
                    }
                    return !!row.labName; // Must have lab name
                })
                .map(row => {
                    const savedRecord = recordMap.get(row.id);
                    const fee = savedRecord ? savedRecord.amount : 0;
                    
                    const availableCats: { key: string; label: string }[] = [];
                    const t = row.treatments as any;
                    Object.keys(CATEGORY_MAP).forEach(key => {
                        if (key !== 'vault' && t[key] > 0) {
                            availableCats.push({ key, label: CATEGORY_MAP[key] });
                        }
                    });

                    const r = row.retail;
                    const isVault = (r.products || 0) + (r.diyWhitening || 0) > 0;
                    
                    let selectedCat = 'otherSelfPay'; 

                    if (savedRecord && savedRecord.category) {
                        selectedCat = savedRecord.category;
                    } else if (isVault) {
                        selectedCat = 'vault';
                    } else if (availableCats.length > 0) {
                        selectedCat = availableCats[0].key;
                    }

                    return {
                        ...row,
                        originalDate: row.originalDate || (row.startTime ? row.startTime.split('T')[0] : ''),
                        savedFee: savedRecord ? savedRecord.amount : undefined,
                        currentFee: fee,
                        recordId: savedRecord?.id,
                        availableCategories: availableCats,
                        selectedCategory: selectedCat,
                        details: savedRecord?.details || [],
                        discount: savedRecord?.discount || 0,
                        isDirty: false
                    };
                })
                .sort((a, b) => a.originalDate.localeCompare(b.originalDate));

            setLinkedRows(merged);

        } catch (error) {
            console.error(error);
            alert("讀取資料失敗");
        } finally {
            setIsLoading(false);
        }
    };

    // --- Linked Row Handlers ---
    const handleCategoryChange = (rowId: string, cat: string) => {
        setLinkedRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            return {
                ...row,
                selectedCategory: cat,
                isDirty: true
            };
        }));
    };

    const handleSaveLinked = async () => {
        const dirtyRows = linkedRows.filter(r => r.isDirty);
        if (dirtyRows.length === 0) return;

        setIsSaving(true);
        try {
            const promises = dirtyRows.map(row => {
                const record: TechnicianRecord = {
                    id: row.recordId || crypto.randomUUID(), 
                    clinicId: selectedClinicId,
                    labName: row.labName,
                    date: row.originalDate,
                    type: 'linked',
                    amount: row.currentFee,
                    linkedRowId: row.id,
                    patientName: row.patientName,
                    doctorName: row.doctorName,
                    treatmentContent: row.treatmentContent,
                    category: row.selectedCategory,
                    details: row.details,
                    discount: row.discount,
                    updatedAt: Date.now()
                };
                return saveTechnicianRecord(record);
            });
            await Promise.all(promises);
            alert("儲存成功！");
            fetchData(); 
        } catch (e) {
            console.error(e);
            alert("儲存失敗");
        } finally {
            setIsSaving(false);
        }
    };

    // --- Manual Row Handlers ---
    const handleAddManualRow = async () => {
        setIsSaving(true);
        try {
            const defaultLab = (selectedLabId && selectedLabId !== 'all') ? getLabName(selectedLabId) : '';
            const newRecord: TechnicianRecord = {
                id: crypto.randomUUID(),
                clinicId: selectedClinicId,
                labName: defaultLab,
                date: `${selectedMonth}-01`,
                type: 'manual',
                amount: 0,
                patientName: '',
                doctorName: '',
                category: 'prostho',
                treatmentContent: '',
                updatedAt: Date.now()
            };
            
            // Save immediately to get a persistent ID
            await saveTechnicianRecord(newRecord);
            setManualRecords(prev => [...prev, newRecord]);
        } catch(e) {
            console.error(e);
            alert("新增失敗");
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdateManualRow = async (id: string, updates: Partial<TechnicianRecord>) => {
        // Optimistic UI Update
        setManualRecords(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
        
        // Background Save
        const record = manualRecords.find(r => r.id === id);
        if (record) {
            try {
                await saveTechnicianRecord({ ...record, ...updates, updatedAt: Date.now() });
            } catch (e) {
                console.error("Auto-save failed", e);
            }
        }
    };

    const handleDeleteManual = async (id: string) => {
        if (!confirm("確定要刪除此筆調整項目嗎？")) return;
        try {
            await deleteTechnicianRecord(id);
            setManualRecords(prev => prev.filter(r => r.id !== id));
        } catch (e) {
            alert("刪除失敗");
        }
    };

    // --- Modal Logic ---
    const handleOpenOrderModal = (type: 'linked' | 'manual', item: LinkedRow | TechnicianRecord) => {
        setActiveOrderType(type);
        setOrderItems(item.details || []);
        setOrderDiscount(item.discount || 0);
        
        if (type === 'linked') {
            const row = item as LinkedRow;
            setSelectedOrderRowId(row.id);
            setSelectedOrderRecordId(null);
            setOrderRowRevenue(row.actualCollected || 0);
            setActiveOrderLab(laboratories.find(l => l.name === row.labName && l.clinicId === selectedClinicId));
        } else {
            const rec = item as TechnicianRecord;
            setSelectedOrderRecordId(rec.id);
            setSelectedOrderRowId(null);
            setOrderRowRevenue(0); // Manual rows don't have linked revenue
            setActiveOrderLab(laboratories.find(l => l.name === rec.labName && l.clinicId === selectedClinicId));
        }
        
        setOrderModalOpen(true);
    };

    const handleSaveOrder = async () => {
        let recordToSave: TechnicianRecord | null = null;

        if (activeOrderType === 'linked' && selectedOrderRowId) {
            const row = linkedRows.find(r => r.id === selectedOrderRowId);
            if (!row) return;
            const subTotal = orderItems.reduce((acc, item) => acc + item.subtotal, 0);
            const finalTotal = subTotal - orderDiscount;
            
            recordToSave = {
                id: row.recordId || crypto.randomUUID(),
                clinicId: selectedClinicId,
                labName: row.labName,
                date: row.originalDate,
                type: 'linked',
                amount: finalTotal,
                linkedRowId: row.id,
                patientName: row.patientName,
                doctorName: row.doctorName,
                treatmentContent: row.treatmentContent,
                category: row.selectedCategory,
                details: orderItems,
                discount: orderDiscount,
                updatedAt: Date.now()
            };

            // Update local state
            setLinkedRows(prev => prev.map(r => r.id === selectedOrderRowId ? {
                ...r, details: orderItems, discount: orderDiscount, currentFee: finalTotal, savedFee: finalTotal, recordId: recordToSave!.id, isDirty: false
            } : r));

        } else if (activeOrderType === 'manual' && selectedOrderRecordId) {
            const rec = manualRecords.find(r => r.id === selectedOrderRecordId);
            if (!rec) return;
            const subTotal = orderItems.reduce((acc, item) => acc + item.subtotal, 0);
            const finalTotal = subTotal - orderDiscount;

            recordToSave = {
                ...rec,
                amount: finalTotal,
                details: orderItems,
                discount: orderDiscount,
                updatedAt: Date.now()
            };

            // Update local state
            setManualRecords(prev => prev.map(r => r.id === selectedOrderRecordId ? recordToSave! : r));
        }

        if (recordToSave) {
            await saveTechnicianRecord(recordToSave);
        }
        setOrderModalOpen(false);
    };

    const totalLinkedFee = linkedRows.reduce((sum, r) => sum + r.currentFee, 0);
    const totalManualFee = manualRecords.reduce((sum, r) => sum + r.amount, 0);
    const grandTotal = totalLinkedFee + totalManualFee;

    const renderAttribution = (row: LinkedRow) => {
        const isVault = (row.retail.products || 0) + (row.retail.diyWhitening || 0) > 0;
        if (isVault) {
             return <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded border border-slate-200 whitespace-nowrap">Vault (小金庫/物販)</span>;
        }
        return (
            <select
                className={`w-full text-xs border rounded px-1 py-1 outline-none bg-white focus:ring-1 focus:ring-purple-500 text-indigo-700 font-bold`}
                value={row.selectedCategory}
                onChange={e => handleCategoryChange(row.id, e.target.value)}
            >
                {row.availableCategories.length > 0 ? (
                    row.availableCategories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)
                ) : (
                    Object.keys(CATEGORY_MAP).filter(k => k !== 'vault').map(key => <option key={key} value={key}>{CATEGORY_MAP[key]}</option>)
                )}
            </select>
        );
    };

    const activeLabs = laboratories.filter(l => l.clinicId === selectedClinicId);

    return (
        <div className="space-y-6 relative h-full flex flex-col">
            {/* Header */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 shrink-0">
                <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-4">
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Microscope className="text-purple-600" /> 技工對帳 (Technician Reconciliation)
                    </h2>
                    <div className="text-right">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">總計應付 (Total Payable)</span>
                        <span className="text-3xl font-black text-purple-700 tabular-nums">${grandTotal.toLocaleString()}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">診所</label>
                        <ClinicSelector className="w-full border p-2 rounded bg-white" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">技工所</label>
                        <select 
                            className="w-full border p-2 rounded bg-white"
                            value={selectedLabId}
                            onChange={e => setSelectedLabId(e.target.value)}
                        >
                            <option value="all">顯示全部 (All Laboratories)</option>
                            {activeLabs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">月份</label>
                        <input 
                            type="month" 
                            className="w-full border p-2 rounded bg-white"
                            value={selectedMonth}
                            onChange={e => setSelectedMonth(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-auto space-y-6 pb-20 custom-scrollbar">
                
                {/* Section A: Linked Cases */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                        <h3 className="font-bold text-slate-700 flex items-center gap-2">
                            <Search size={18} className="text-blue-500" /> 系統內病歷 (Linked Cases)
                        </h3>
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-slate-500">小計: ${totalLinkedFee.toLocaleString()}</span>
                            {linkedRows.some(r => r.isDirty) && (
                                <button 
                                    onClick={handleSaveLinked}
                                    disabled={isSaving}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
                                >
                                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                    儲存類別變更
                                </button>
                            )}
                        </div>
                    </div>
                    
                    {isLoading ? (
                        <div className="p-12 flex justify-center text-slate-400 gap-2"><Loader2 className="animate-spin"/> 讀取中...</div>
                    ) : linkedRows.length === 0 ? (
                        <div className="p-12 text-center text-slate-400 italic">本月無相關紀錄</div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white text-slate-500 font-bold uppercase text-xs border-b border-slate-100">
                                <tr>
                                    <th className="px-4 py-3 w-28">日期</th>
                                    {selectedLabId === 'all' && <th className="px-4 py-3 w-32">技工所</th>}
                                    <th className="px-4 py-3 w-28">病患</th>
                                    <th className="px-4 py-3 w-24">醫師</th>
                                    <th className="px-4 py-3 w-32">歸屬</th>
                                    <th className="px-4 py-3">療程內容</th>
                                    <th className="px-4 py-3 text-right w-32">技工費 (Net)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {linkedRows.map(row => (
                                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                                        <td 
                                            className="px-4 py-3 font-mono text-blue-600 font-bold cursor-pointer hover:underline"
                                            onClick={() => navigate(`/accounting?date=${row.originalDate}`)}
                                        >
                                            {row.originalDate.slice(5)}
                                        </td>
                                        {selectedLabId === 'all' && <td className="px-4 py-3 text-slate-600 font-bold">{row.labName}</td>}
                                        <td className="px-4 py-3 font-bold text-slate-700">{row.patientName}</td>
                                        <td className="px-4 py-3 text-slate-600">{row.doctorName}</td>
                                        <td className="px-4 py-3">
                                            {renderAttribution(row)}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[200px]" title={row.treatmentContent}>{row.treatmentContent}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => handleOpenOrderModal('linked', row)}
                                                className={`w-full text-right border rounded px-2 py-1.5 font-bold transition-colors ${row.isDirty ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-blue-400'}`}
                                            >
                                                {row.currentFee.toLocaleString()}
                                                {row.discount > 0 && <span className="text-xs text-rose-500 ml-1">(折${row.discount})</span>}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Section B: Manual Adjustments */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 bg-amber-50 border-b border-amber-200 flex justify-between items-center">
                        <h3 className="font-bold text-amber-800 flex items-center gap-2">
                            <FileEdit size={18} /> 手動調整 (Manual Adjustments)
                        </h3>
                        <div className="flex items-center gap-4">
                            <span className="text-sm font-bold text-amber-800">小計: ${totalManualFee.toLocaleString()}</span>
                            <button 
                                onClick={handleAddManualRow}
                                disabled={isSaving}
                                className="bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300 flex items-center gap-1 transition-colors"
                            >
                                {isSaving ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14} />} 新增手動項目
                            </button>
                        </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white text-slate-500 font-bold uppercase text-xs border-b border-slate-100">
                                <tr>
                                    <th className="px-4 py-3 w-32">日期</th>
                                    {selectedLabId === 'all' && <th className="px-4 py-3 w-32">技工所</th>}
                                    <th className="px-4 py-3 w-32">病患</th>
                                    <th className="px-4 py-3 w-28">類別</th>
                                    <th className="px-4 py-3 w-28">醫師</th>
                                    <th className="px-4 py-3">內容/備註</th>
                                    <th className="px-4 py-3 text-right w-32">金額</th>
                                    <th className="px-4 py-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {manualRecords.map(rec => (
                                    <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-2 py-2">
                                            <InlineInput 
                                                type="date"
                                                value={rec.date}
                                                onChange={(val) => handleUpdateManualRow(rec.id, { date: val })}
                                            />
                                        </td>
                                        {selectedLabId === 'all' && (
                                            <td className="px-2 py-2">
                                                <select 
                                                    className="w-full bg-transparent border border-transparent hover:border-slate-300 rounded px-1 py-1 outline-none text-slate-600 font-bold"
                                                    value={rec.labName}
                                                    onChange={e => handleUpdateManualRow(rec.id, { labName: e.target.value })}
                                                >
                                                    <option value="">選擇技工所</option>
                                                    {activeLabs.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                                                </select>
                                            </td>
                                        )}
                                        <td className="px-2 py-2">
                                            <InlineInput 
                                                value={rec.patientName}
                                                placeholder="姓名"
                                                className="font-bold text-slate-700"
                                                onChange={val => handleUpdateManualRow(rec.id, { patientName: val })}
                                            />
                                        </td>
                                        <td className="px-2 py-2">
                                            <select 
                                                className="w-full bg-transparent border border-transparent hover:border-slate-300 rounded px-1 py-1 outline-none text-xs"
                                                value={rec.category || 'prostho'}
                                                onChange={e => handleUpdateManualRow(rec.id, { category: e.target.value })}
                                            >
                                                {MANUAL_CATEGORY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                        </td>
                                        <td className="px-2 py-2">
                                            <select 
                                                className="w-full bg-transparent border border-transparent hover:border-slate-300 rounded px-1 py-1 outline-none text-xs"
                                                value={rec.doctorName || ''}
                                                onChange={e => handleUpdateManualRow(rec.id, { doctorName: e.target.value })}
                                            >
                                                <option value="">未指定</option>
                                                {clinicDoctors.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                                            </select>
                                        </td>
                                        <td className="px-2 py-2">
                                            <InlineInput 
                                                value={rec.treatmentContent}
                                                placeholder="內容或備註..."
                                                className="text-xs text-slate-500"
                                                onChange={val => handleUpdateManualRow(rec.id, { treatmentContent: val })}
                                            />
                                        </td>
                                        <td className="px-2 py-2 text-right">
                                            <button
                                                onClick={() => handleOpenOrderModal('manual', rec)}
                                                className={`w-full text-right border rounded px-2 py-1 font-mono font-bold transition-colors bg-white hover:border-blue-400 text-slate-700`}
                                            >
                                                {rec.amount.toLocaleString()}
                                            </button>
                                        </td>
                                        <td className="px-2 py-2 text-center">
                                            <button onClick={() => handleDeleteManual(rec.id)} className="text-slate-300 hover:text-rose-500 p-1">
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {manualRecords.length === 0 && (
                                    <tr><td colSpan={selectedLabId === 'all' ? 8 : 7} className="p-8 text-center text-slate-400 text-sm">無手動調整項目</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Lab Order Modal (Multi-Item) */}
            {orderModalOpen && (
                <LabOrderModal 
                    isOpen={orderModalOpen}
                    onClose={() => setOrderModalOpen(false)}
                    items={orderItems}
                    onUpdateItems={setOrderItems}
                    discount={orderDiscount}
                    onUpdateDiscount={setOrderDiscount}
                    lab={activeOrderLab}
                    onSave={handleSaveOrder}
                    revenue={orderRowRevenue}
                />
            )}
        </div>
    );
};

// --- SUB-COMPONENT: Lab Order Modal ---
const LabOrderModal = ({ 
    isOpen, onClose, items, onUpdateItems, discount, onUpdateDiscount, lab, onSave, revenue
}: {
    isOpen: boolean;
    onClose: () => void;
    items: LabOrderDetail[];
    onUpdateItems: (items: LabOrderDetail[]) => void;
    discount: number;
    onUpdateDiscount: (v: number) => void;
    lab: Laboratory | undefined;
    onSave: () => Promise<void>;
    revenue: number;
}) => {
    const [selectedPricingItem, setSelectedPricingItem] = useState('');
    const [toothPos, setToothPos] = useState('');
    const [qty, setQty] = useState(1);
    const [price, setPrice] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    
    // Auto-calc tracking
    const [isPercentageApplied, setIsPercentageApplied] = useState(false);
    const [percentageValue, setPercentageValue] = useState(0);

    const pricingList = lab?.pricingList || [];

    const handlePricingSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        setSelectedPricingItem(id);
        const item = pricingList.find(p => p.id === id);
        
        if (item) {
            if (item.isPercentage) {
                const calculatedPrice = Math.round(revenue * (item.price / 100));
                setPrice(calculatedPrice);
                setIsPercentageApplied(true);
                setPercentageValue(item.price);
            } else {
                setPrice(item.price);
                setIsPercentageApplied(false);
                setPercentageValue(0);
            }
        }
    };

    const addItem = () => {
        if (!selectedPricingItem) return;
        const pItem = pricingList.find(p => p.id === selectedPricingItem);
        if (!pItem) return;

        const newItem: LabOrderDetail = {
            id: crypto.randomUUID(),
            name: pItem.name,
            toothPos: toothPos,
            qty: qty,
            price: price,
            subtotal: qty * price
        };
        onUpdateItems([...items, newItem]);
        setToothPos('');
        setQty(1);
        setIsPercentageApplied(false);
        setPercentageValue(0);
        setSelectedPricingItem('');
        setPrice(0);
    };

    const removeItem = (index: number) => {
        const newItems = [...items];
        newItems.splice(index, 1);
        onUpdateItems(newItems);
    };

    const handleSaveClick = async () => {
        setIsSaving(true);
        try {
            await onSave();
        } catch(e) {
            console.error(e);
            alert("儲存失敗");
        } finally {
            setIsSaving(false);
        }
    };

    const itemsTotal = items.reduce((sum, i) => sum + i.subtotal, 0);
    const finalTotal = itemsTotal - discount;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-slide-down flex flex-col max-h-[90vh]">
                <div className="bg-indigo-700 text-white p-4 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <List size={20} /> 技工單明細 ({lab?.name || '未選擇技工所'})
                        </h3>
                        {revenue > 0 && (
                            <p className="text-xs text-indigo-200 mt-1">
                                當日實收 (Revenue): ${revenue.toLocaleString()}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose}><X size={20} className="hover:text-indigo-200" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Add Item Form */}
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3">
                        <div className="grid grid-cols-12 gap-3 items-end">
                            <div className="col-span-4">
                                <label className="block text-xs font-bold text-slate-500 mb-1">項目</label>
                                <select 
                                    className="w-full border rounded px-2 py-1.5 text-sm"
                                    value={selectedPricingItem}
                                    onChange={handlePricingSelect}
                                >
                                    <option value="">選擇項目...</option>
                                    {pricingList.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {p.name} {p.isPercentage ? `(${p.price}%)` : `($${p.price})`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="col-span-3">
                                <label className="block text-xs font-bold text-slate-500 mb-1">牙位</label>
                                <input 
                                    className="w-full border rounded px-2 py-1.5 text-sm"
                                    value={toothPos}
                                    onChange={e => setToothPos(e.target.value)}
                                    placeholder="#11, #21..."
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-slate-500 mb-1">單價</label>
                                <input 
                                    type="number"
                                    className="w-full border rounded px-2 py-1.5 text-sm"
                                    value={price}
                                    onChange={e => setPrice(Number(e.target.value))}
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-xs font-bold text-slate-500 mb-1">數量</label>
                                <input 
                                    type="number"
                                    className="w-full border rounded px-2 py-1.5 text-sm text-center"
                                    value={qty}
                                    onChange={e => setQty(Number(e.target.value))}
                                />
                            </div>
                            <div className="col-span-2">
                                <button 
                                    onClick={addItem}
                                    className="w-full bg-indigo-600 text-white py-1.5 rounded text-sm font-bold hover:bg-indigo-700"
                                >
                                    新增
                                </button>
                            </div>
                        </div>
                        {/* Percentage Helper Text */}
                        {isPercentageApplied && (
                            <p className="text-xs text-indigo-600 font-bold">
                                * 自動計算: 總實收 ${revenue.toLocaleString()} 的 {percentageValue}%
                            </p>
                        )}
                        {pricingList.length === 0 && <p className="text-xs text-rose-500">* 此技工所尚未設定價目表</p>}
                    </div>

                    {/* Items Table */}
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 font-bold bg-slate-100">
                            <tr>
                                <th className="px-3 py-2">項目</th>
                                <th className="px-3 py-2">牙位</th>
                                <th className="px-3 py-2 text-right">單價</th>
                                <th className="px-3 py-2 text-center">數量</th>
                                <th className="px-3 py-2 text-right">小計</th>
                                <th className="w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {items.map((item, idx) => (
                                <tr key={idx}>
                                    <td className="px-3 py-2">{item.name}</td>
                                    <td className="px-3 py-2">{item.toothPos}</td>
                                    <td className="px-3 py-2 text-right">{item.price}</td>
                                    <td className="px-3 py-2 text-center">{item.qty}</td>
                                    <td className="px-3 py-2 text-right font-bold">{item.subtotal}</td>
                                    <td className="px-3 py-2 text-center">
                                        <button onClick={() => removeItem(idx)} className="text-slate-300 hover:text-rose-500"><Trash2 size={14}/></button>
                                    </td>
                                </tr>
                            ))}
                            {items.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">尚未加入項目</td></tr>}
                        </tbody>
                    </table>

                    {/* Summary */}
                    <div className="border-t border-slate-200 pt-4 space-y-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-600">項目總計</span>
                            <span className="font-bold">${itemsTotal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-600 flex items-center gap-1">減免/折扣 <span className="text-xs text-slate-400">(Discount)</span></span>
                            <div className="flex items-center gap-2">
                                <span className="text-rose-500 font-bold">-</span>
                                <input 
                                    type="number" 
                                    className="w-24 text-right border rounded px-2 py-1 font-bold text-rose-600"
                                    value={discount}
                                    onChange={e => onUpdateDiscount(Number(e.target.value))}
                                />
                            </div>
                        </div>
                        <div className="flex justify-between items-center text-lg pt-2 border-t border-slate-100">
                            <span className="font-bold text-slate-800">總金額 (Total)</span>
                            <span className="font-black text-indigo-700">${finalTotal.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-200 font-bold" disabled={isSaving}>取消</button>
                    <button 
                        onClick={handleSaveClick} 
                        disabled={isSaving}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold shadow-md flex items-center gap-2"
                    >
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        儲存工單
                    </button>
                </div>
            </div>
        </div>
    );
};
