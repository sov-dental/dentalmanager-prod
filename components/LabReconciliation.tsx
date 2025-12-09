
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clinic, Laboratory, AccountingRow, TechnicianRecord, Doctor } from '../types';
import { getMonthlyAccounting, getTechnicianRecords, saveTechnicianRecord, deleteTechnicianRecord, loadAppData } from '../services/firebase';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';
import { 
    Microscope, Calendar, Save, AlertCircle, Plus, Loader2, 
    Search, X, FileEdit, Trash2, ArrowRightCircle
} from 'lucide-react';

interface Props {
  clinics: Clinic[]; // Compatible but unused for selection
  laboratories: Laboratory[];
}

// Extended row for UI display
interface LinkedRow extends AccountingRow {
    originalDate: string; 
    savedFee?: number; // Fee from technician_records
    currentFee: number; // Current input value
    recordId?: string; // ID of the linked technician_record
    
    // Category Attribution Logic
    availableCategories: { key: string; label: string }[];
    selectedCategory: string; // The currently selected attribution
    
    isDirty: boolean; // If input changed
}

const CATEGORY_MAP: Record<string, string> = {
    'prostho': '假牙',
    'implant': '植牙',
    'ortho': '矯正',
    'sov': 'SOV',
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
    { value: 'whitening', label: '美白' },
    { value: 'perio', label: '牙周' },
    { value: 'otherSelfPay', label: '其他' },
    { value: 'vault', label: '小金庫/物販' },
];

export const LabReconciliation: React.FC<Props> = ({ laboratories }) => {
    const navigate = useNavigate();
    const { selectedClinicId, clinics } = useClinic();
    const [selectedLabId, setSelectedLabId] = useState<string>('');
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    
    const [linkedRows, setLinkedRows] = useState<LinkedRow[]>([]);
    const [manualRecords, setManualRecords] = useState<TechnicianRecord[]>([]);
    const [clinicDoctors, setClinicDoctors] = useState<Doctor[]>([]);
    
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [manualDate, setManualDate] = useState('');
    const [manualPatient, setManualPatient] = useState('');
    const [manualDoctor, setManualDoctor] = useState('');
    const [manualCategory, setManualCategory] = useState('prostho'); // Default
    const [manualContent, setManualContent] = useState('');
    const [manualAmount, setManualAmount] = useState<string>('');
    const [manualNote, setManualNote] = useState('');

    useEffect(() => {
        if (selectedClinicId) {
            // Reset Lab Selection when clinic changes
            setSelectedLabId('');
            
            // Auto-select first lab if available for this clinic
            const clinicLabs = laboratories.filter(l => l.clinicId === selectedClinicId);
            if (clinicLabs.length > 0) setSelectedLabId(clinicLabs[0].id);

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
    }, [selectedClinicId, laboratories]);

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
            const labName = getLabName(selectedLabId);
            if (!labName) return;

            // 1. Fetch Daily Accounting (Read-Only Source)
            const dailyData = await getMonthlyAccounting(selectedClinicId, selectedMonth);
            
            // 2. Fetch Existing Technician Records (Write Target)
            const techData = await getTechnicianRecords(selectedClinicId, labName, selectedMonth);

            // 3. Separate Manual Adjustments
            const manual = techData.filter(r => r.type === 'manual');
            setManualRecords(manual);

            // 4. Merge Linked Records
            const linkedTechRecords = techData.filter(r => r.type === 'linked');
            const recordMap = new Map(linkedTechRecords.map(r => [r.linkedRowId, r]));

            // 5. Filter Daily Rows & Process Attribution Logic
            const merged: LinkedRow[] = dailyData
                .filter(row => row.labName && row.labName.trim() === labName.trim())
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

                    // Logic: Determine Selected Category
                    let selectedCat = 'vault'; // Default Case A
                    
                    if (savedRecord && savedRecord.category) {
                        // If already saved, respect the decision
                        selectedCat = savedRecord.category;
                    } else if (availableCats.length === 1) {
                        // Case B: Exactly 1 item -> Auto-select
                        selectedCat = availableCats[0].key;
                    } else if (availableCats.length > 1) {
                        // Case C: Multiple -> Default to first, but allow change
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

    const handleFeeChange = (rowId: string, val: string) => {
        const numVal = parseFloat(val);
        setLinkedRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            return {
                ...row,
                currentFee: isNaN(numVal) ? 0 : numVal,
                isDirty: true
            };
        }));
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

    const handleSaveLinked = async () => {
        const dirtyRows = linkedRows.filter(r => r.isDirty);
        if (dirtyRows.length === 0) return;

        setIsSaving(true);
        const labName = getLabName(selectedLabId);

        try {
            const promises = dirtyRows.map(row => {
                const record: TechnicianRecord = {
                    id: row.recordId || '', 
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

    const handleAddManual = async () => {
        if (!manualDate || !manualAmount || !manualCategory || !manualPatient) {
            alert("請填寫日期、金額、類別與病患姓名");
            return;
        }

        setIsSaving(true);
        const labName = getLabName(selectedLabId);

        try {
            const record: TechnicianRecord = {
                id: '',
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

    const totalLinkedFee = linkedRows.reduce((sum, r) => sum + r.currentFee, 0);
    const totalManualFee = manualRecords.reduce((sum, r) => sum + r.amount, 0);
    const grandTotal = totalLinkedFee + totalManualFee;

    const renderAttribution = (row: LinkedRow) => {
        // Case A: 0 Items (Vault)
        if (row.availableCategories.length === 0) {
            return (
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded border border-slate-200 whitespace-nowrap">
                    小金庫/物販
                </span>
            );
        }
        
        // Case B: 1 Item (Read Only)
        if (row.availableCategories.length === 1) {
            const cat = row.availableCategories[0];
            return (
                <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded border border-indigo-200 font-medium whitespace-nowrap">
                    {cat.label}
                </span>
            );
        }

        // Case C: >1 Items (Dropdown)
        return (
            <select
                className={`w-full text-xs border rounded px-1 py-1 outline-none bg-white focus:ring-1 focus:ring-purple-500 ${row.selectedCategory === 'vault' ? 'text-slate-500' : 'text-indigo-700 font-bold'}`}
                value={row.selectedCategory}
                onChange={e => handleCategoryChange(row.id, e.target.value)}
            >
                {row.availableCategories.map(c => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                ))}
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
                            <option value="" disabled>請選擇技工所</option>
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
                                    儲存變更
                                </button>
                            )}
                        </div>
                    </div>
                    
                    {!selectedLabId ? (
                        <div className="p-12 text-center text-slate-400">請先選擇技工所</div>
                    ) : isLoading ? (
                        <div className="p-12 flex justify-center text-slate-400 gap-2"><Loader2 className="animate-spin"/> 讀取中...</div>
                    ) : linkedRows.length === 0 ? (
                        <div className="p-12 text-center text-slate-400 italic">本月無此技工所的系統紀錄</div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white text-slate-500 font-bold uppercase text-xs border-b border-slate-100">
                                <tr>
                                    <th className="px-4 py-3 w-28">日期</th>
                                    <th className="px-4 py-3 w-28">病患</th>
                                    <th className="px-4 py-3 w-24">醫師</th>
                                    <th className="px-4 py-3 w-32">歸屬 (Attribution)</th>
                                    <th className="px-4 py-3">療程內容</th>
                                    <th className="px-4 py-3 text-right w-32">技工費 (Fee)</th>
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
                                        <td className="px-4 py-3 font-bold text-slate-700">{row.patientName}</td>
                                        <td className="px-4 py-3 text-slate-600">{row.doctorName}</td>
                                        <td className="px-4 py-3">
                                            {renderAttribution(row)}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[200px]" title={row.treatmentContent}>{row.treatmentContent}</td>
                                        <td className="px-4 py-3 text-right">
                                            <input 
                                                type="number"
                                                className={`w-full text-right border rounded px-2 py-1.5 font-bold outline-none focus:ring-2 focus:ring-blue-500 ${row.isDirty ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
                                                value={row.currentFee}
                                                onChange={e => handleFeeChange(row.id, e.target.value)}
                                                onFocus={e => e.target.select()}
                                            />
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
                            {selectedLabId && (
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
        </div>
    );
};
