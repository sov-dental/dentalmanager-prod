
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clinic, Laboratory, AccountingRow, TechnicianRecord, Doctor, LabOrderDetail } from '../types';
import { getMonthlyAccounting, getTechnicianRecords, saveTechnicianRecord, deleteTechnicianRecord, loadAppData } from '../services/firebase';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';
import { 
    Microscope, Calendar, Save, AlertCircle, Plus, Loader2, 
    Search, X, FileEdit, Trash2, ArrowRightCircle, List, DollarSign
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
    const [selectedOrderRowId, setSelectedOrderRowId] = useState<string | null>(null);
    const [orderRowRevenue, setOrderRowRevenue] = useState(0); // NEW: Revenue for calculation
    const [orderItems, setOrderItems] = useState<LabOrderDetail[]>([]);
    const [orderDiscount, setOrderDiscount] = useState(0);
    // Which lab is the target for the modal?
    const [activeOrderLab, setActiveOrderLab] = useState<Laboratory | undefined>(undefined);

    // Manual Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [manualDate, setManualDate] = useState('');
    const [manualPatient, setManualPatient] = useState('');
    const [manualDoctor, setManualDoctor] = useState('');
    const [manualCategory, setManualCategory] = useState('prostho'); 
    const [manualContent, setManualContent] = useState('');
    const [manualAmount, setManualAmount] = useState<string>('');
    const [manualNote, setManualNote] = useState('');

    useEffect(() => {
        if (selectedClinicId) {
            // Default to 'all' instead of first lab
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
            // Pass null to fetch all if "all" selected
            const techData = await getTechnicianRecords(selectedClinicId, labNameFilter, selectedMonth);

            // 3. Separate Manual Adjustments
            const manual = techData.filter(r => r.type === 'manual');
            setManualRecords(manual);

            // 4. Merge Linked Records
            const linkedTechRecords = techData.filter(r => r.type === 'linked');
            const recordMap = new Map(linkedTechRecords.map(r => [r.linkedRowId, r]));

            // 5. Filter Daily Rows & Process Attribution Logic
            const merged: LinkedRow[] = dailyData
                .filter(row => {
                    if (labNameFilter) {
                        return row.labName && row.labName.trim() === labNameFilter.trim();
                    }
                    // If showing all, ensure it has SOME lab name
                    return !!row.labName;
                })
                .map(row => {
                    const savedRecord = recordMap.get(row.id);
                    const fee = savedRecord ? savedRecord.amount : 0;
                    
                    // Logic: Identify Available Categories
                    const availableCats: { key: string; label: string }[] = [];
                    const t = row.treatments as any;
                    Object.keys(CATEGORY_MAP).forEach(key => {
                        if (key !== 'vault' && t[key] > 0) {
                            availableCats.push({ key, label: CATEGORY_MAP[key] });
                        }
                    });

                    // New Attribution Logic (Fixed per requirement)
                    const r = row.retail;
                    const isVault = (r.products || 0) + (r.diyWhitening || 0) > 0;
                    
                    let selectedCat = 'otherSelfPay'; // Fallback

                    if (savedRecord && savedRecord.category) {
                        selectedCat = savedRecord.category;
                    } else if (isVault) {
                        selectedCat = 'vault';
                    } else if (availableCats.length > 0) {
                        // Default to first
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

    // Global Save (e.g. for Category changes or mass updates if needed)
    const handleSaveLinked = async () => {
        const dirtyRows = linkedRows.filter(r => r.isDirty);
        if (dirtyRows.length === 0) return;

        setIsSaving(true);
        
        try {
            const promises = dirtyRows.map(row => {
                const labName = row.labName; 
                
                const record: TechnicianRecord = {
                    id: row.recordId || crypto.randomUUID(), 
                    clinicId: selectedClinicId,
                    labName: labName,
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
            
            // Refetch to ensure all IDs and states are synced
            fetchData(); 
        } catch (e) {
            console.error(e);
            alert("儲存失敗");
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddManual = async () => {
        if (!manualDate || !manualAmount || !manualCategory || !manualPatient) {
            alert("請填寫日期、金額、類別與病患姓名");
            return;
        }

        setIsSaving(true);
        
        let labName = '';
        if (selectedLabId && selectedLabId !== 'all') {
            labName = getLabName(selectedLabId);
        }
        
        if (!labName) {
            alert("手動新增請先選擇特定的技工所 (Filters)");
            setIsSaving(false);
            return;
        }

        try {
            const record: TechnicianRecord = {
                id: crypto.randomUUID(),
                clinicId: selectedClinicId,
                labName: labName,
                date: manualDate,
                type: 'manual',
                amount: parseFloat(manualAmount),
                category: manualCategory,
                patientName: manualPatient,
                doctorName: manualDoctor || '未指定',
                treatmentContent: manualContent,
                note: manualNote,
                updatedAt: Date.now()
            };

            await saveTechnicianRecord(record);
            setIsModalOpen(false);
            resetModal();
            fetchData();
        } catch (e) {
            console.error(e);
            alert("新增失敗");
        } finally {
            setIsSaving(false);
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

    const resetModal = () => {
        setManualDate(selectedMonth + '-01');
        setManualPatient('');
        setManualDoctor('');
        setManualCategory('prostho');
        setManualContent('');
        setManualAmount('');
        setManualNote('');
    };

    const openModal = () => {
        resetModal();
        setIsModalOpen(true);
    };

    // --- Order Modal Logic ---
    const handleOpenOrderModal = (row: LinkedRow) => {
        setSelectedOrderRowId(row.id);
        setOrderItems(row.details || []);
        setOrderDiscount(row.discount || 0);
        
        // Pass revenue for % calculation (actualCollected is sum of treatments+retail)
        setOrderRowRevenue(row.actualCollected || 0);
        
        // Identify Lab
        const lab = laboratories.find(l => l.name === row.labName && l.clinicId === selectedClinicId);
        setActiveOrderLab(lab);
        
        setOrderModalOpen(true);
    };

    const handleSaveOrder = async () => {
        if (!selectedOrderRowId) return;
        
        const row = linkedRows.find(r => r.id === selectedOrderRowId);
        if (!row) return;

        const subTotal = orderItems.reduce((acc, item) => acc + item.subtotal, 0);
        const finalTotal = subTotal - orderDiscount;

        // Generate ID if new
        const recordId = row.recordId || crypto.randomUUID();

        // Construct Record
        const record: TechnicianRecord = {
            id: recordId,
            clinicId: selectedClinicId,
            labName: row.labName,
            date: row.originalDate,
            type: 'linked',
            amount: finalTotal,
            linkedRowId: row.id,
            patientName: row.patientName,
            doctorName: row.doctorName,
            treatmentContent: row.treatmentContent,
            category: row.selectedCategory, // Preserve current category selection
            details: orderItems,
            discount: orderDiscount,
            updatedAt: Date.now()
        };

        await saveTechnicianRecord(record);

        // Update Local State Immediately
        setLinkedRows(prev => prev.map(r => {
            if (r.id !== selectedOrderRowId) return r;
            return {
                ...r,
                details: orderItems,
                discount: orderDiscount,
                currentFee: finalTotal,
                savedFee: finalTotal, // Synced
                recordId: recordId,
                isDirty: false // Saved, so clean
            };
        }));
        
        setOrderModalOpen(false);
    };

    const totalLinkedFee = linkedRows.reduce((sum, r) => sum + r.currentFee, 0);
    const totalManualFee = manualRecords.reduce((sum, r) => sum + r.amount, 0);
    const grandTotal = totalLinkedFee + totalManualFee;

    const renderAttribution = (row: LinkedRow) => {
        const isVault = (row.retail.products || 0) + (row.retail.diyWhitening || 0) > 0;
        
        if (isVault) {
             return (
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded border border-slate-200 whitespace-nowrap">
                    Vault (小金庫/物販)
                </span>
            );
        }

        // Dropdown for Self-Pay Attribution
        return (
            <select
                className={`w-full text-xs border rounded px-1 py-1 outline-none bg-white focus:ring-1 focus:ring-purple-500 text-indigo-700 font-bold`}
                value={row.selectedCategory}
                onChange={e => handleCategoryChange(row.id, e.target.value)}
            >
                {row.availableCategories.length > 0 ? (
                    row.availableCategories.map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                    ))
                ) : (
                    // Default options if none auto-detected
                    Object.keys(CATEGORY_MAP).filter(k => k !== 'vault').map(key => (
                        <option key={key} value={key}>{CATEGORY_MAP[key]}</option>
                    ))
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
                                                onClick={() => handleOpenOrderModal(row)}
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
                            {selectedLabId && selectedLabId !== 'all' && (
                                <button 
                                    onClick={openModal}
                                    className="bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300 flex items-center gap-1 transition-colors"
                                >
                                    <Plus size={14} /> 新增項目
                                </button>
                            )}
                        </div>
                    </div>
                    {manualRecords.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 text-sm">無手動調整項目</div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white text-slate-500 font-bold uppercase text-xs border-b border-slate-100">
                                <tr>
                                    <th className="px-4 py-3 w-28">日期</th>
                                    {selectedLabId === 'all' && <th className="px-4 py-3 w-32">技工所</th>}
                                    <th className="px-4 py-3 w-28">病患</th>
                                    <th className="px-4 py-3 w-24">類別</th>
                                    <th className="px-4 py-3 w-24">醫師</th>
                                    <th className="px-4 py-3">內容/備註</th>
                                    <th className="px-4 py-3 text-right">金額</th>
                                    <th className="px-4 py-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {manualRecords.map(rec => (
                                    <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                                        <td 
                                            className="px-4 py-3 font-mono text-blue-600 font-bold cursor-pointer hover:underline"
                                            onClick={() => navigate(`/accounting?date=${rec.date}`)}
                                        >
                                            {rec.date.slice(5)}
                                        </td>
                                        {selectedLabId === 'all' && <td className="px-4 py-3 text-slate-600 font-bold">{rec.labName}</td>}
                                        <td className="px-4 py-3 font-bold text-slate-700">{rec.patientName || '-'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold border ${rec.category === 'vault' ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-amber-100 border-amber-200 text-amber-800'}`}>
                                                {CATEGORY_MAP[rec.category || ''] || rec.category}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{rec.doctorName}</td>
                                        <td className="px-4 py-3 text-slate-500 text-xs">
                                            {rec.treatmentContent} 
                                            {rec.note && <span className="text-slate-400 ml-1">({rec.note})</span>}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-mono font-bold ${rec.amount < 0 ? 'text-green-600' : 'text-slate-700'}`}>
                                            {rec.amount.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button onClick={() => handleDeleteManual(rec.id)} className="text-slate-300 hover:text-rose-500">
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Manual Adjustment Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-slide-down">
                        <div className="bg-purple-600 text-white p-4 flex justify-between items-center">
                            <h3 className="font-bold flex items-center gap-2"><Plus size={18}/> 新增調整項目</h3>
                            <button onClick={() => setIsModalOpen(false)} className="hover:text-purple-200"><X size={20}/></button>
                        </div>
                        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                            {/* Inputs */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">日期</label>
                                    <input type="date" className="w-full border rounded px-3 py-2" value={manualDate} onChange={e => setManualDate(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">病患姓名</label>
                                    <input className="w-full border rounded px-3 py-2" value={manualPatient} onChange={e => setManualPatient(e.target.value)} placeholder="例如：王小明" />
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">醫師</label>
                                    <select className="w-full border rounded px-3 py-2 bg-white" value={manualDoctor} onChange={e => setManualDoctor(e.target.value)}>
                                        <option value="">未指定</option>
                                        {clinicDoctors.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">歸屬類別</label>
                                    <select className="w-full border rounded px-3 py-2 bg-white" value={manualCategory} onChange={e => setManualCategory(e.target.value)}>
                                        {MANUAL_CATEGORY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">療程內容</label>
                                <input className="w-full border rounded px-3 py-2" value={manualContent} onChange={e => setManualContent(e.target.value)} placeholder="例如：假牙重作" />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">金額 (可輸入負數)</label>
                                <input type="number" className="w-full border rounded px-3 py-2 font-bold text-lg text-purple-700" value={manualAmount} onChange={e => setManualAmount(e.target.value)} placeholder="0" />
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">備註 (選填)</label>
                                <textarea className="w-full border rounded px-3 py-2 h-20" value={manualNote} onChange={e => setManualNote(e.target.value)} placeholder="其他說明..." />
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">取消</button>
                            <button onClick={handleAddManual} disabled={isSaving} className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                                {isSaving && <Loader2 size={16} className="animate-spin" />} 儲存
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
        // Reset specialized state
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
                            <List size={20} /> 技工單明細 ({lab?.name || 'Unknown Lab'})
                        </h3>
                        <p className="text-xs text-indigo-200 mt-1">
                            當日實收 (Revenue): ${revenue.toLocaleString()}
                        </p>
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
                        {pricingList.length === 0 && <p className="text-xs text-rose-500">* 請先至「技工所管理」設定價目表</p>}
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
