
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clinic, Doctor, AccountingRow, DailyAccountingRecord, TechnicianRecord, NHIRecord, SalaryAdjustment } from '../types';
import { loadDailyAccounting, getTechnicianRecords, getNHIRecords, getClinicSalaryAdjustments, addSalaryAdjustment, deleteSalaryAdjustment } from '../services/firebase';
import { NHIClaimsModal } from './NHIClaimsModal';
import { 
  Calculator, ChevronDown, 
  Banknote, TrendingUp, DollarSign, Loader2, AlertCircle, FileText, FileEdit, Plus, Trash2, ArrowUpCircle, ArrowDownCircle, FileSpreadsheet,
  Users, User, X
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
}

interface CalculatedItem {
    type: 'revenue' | 'cost' | 'merged'; 
    date: string;
    patient: string;
    content: string;
    revenue: number;
    labFee: number;
    netProfit: number;
    income: number;
    originalRowId?: string; 
}

interface CategoryResult {
    items: CalculatedItem[];
    totalRevenue: number;
    totalLabFee: number;
    totalNetProfit: number;
    totalIncome: number;
    rate: number;
}

type ReportData = Record<string, CategoryResult>;

interface CommissionMap {
    label: string;
    rateKey: keyof Doctor['commissionRates'] | 'nhi'; 
}

// STRICT ORDER: NHI -> Implant -> Ortho -> Prostho -> SOV -> INV -> Whitening -> Perio -> Other
const CATEGORY_MAP: Record<string, CommissionMap> = {
    'nhi': { label: '健保申報 (NHI)', rateKey: 'nhi' },
    'implant': { label: '植牙 (Implant)', rateKey: 'implant' },
    'ortho': { label: '矯正 (Ortho)', rateKey: 'ortho' },
    'prostho': { label: '假牙 (Prostho)', rateKey: 'prostho' },
    'sov': { label: 'SOV', rateKey: 'sov' },
    'inv': { label: '隱適美 (INV)', rateKey: 'inv' }, // Added INV
    'whitening': { label: '美白 (Whitening)', rateKey: 'whitening' }, // Uses independent rate
    'perio': { label: '牙周 (Perio)', rateKey: 'perio' },
    'otherSelfPay': { label: '其他自費 (Other)', rateKey: 'otherSelfPay' }
};

// Summary Matrix Data Structure
interface DoctorSummary {
    doctorId: string;
    doctorName: string;
    categories: Record<string, number>; // key: categoryKey, value: income
    totalAdjustments: number;
    totalPayout: number;
}

// Safe helpers
const getDocId = (d: any) => (typeof d === 'string' ? d : d?.id || '');
const getDocName = (d: any) => (typeof d === 'string' ? d : d?.name || '');

export const SalaryStatementPage: React.FC<Props> = ({ clinics, doctors }) => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'individual' | 'summary'>('individual');
    
    // Shared State
    const [selectedClinicId, setSelectedClinicId] = useState<string>(clinics[0]?.id || '');
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    
    // Individual Tab State
    const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
    const [report, setReport] = useState<ReportData | null>(null);
    const [grandTotal, setGrandTotal] = useState<number>(0);
    const [adjustments, setAdjustments] = useState<SalaryAdjustment[]>([]);
    
    // Summary Tab State
    const [summaryReport, setSummaryReport] = useState<DoctorSummary[]>([]);

    const [isLoading, setIsLoading] = useState(false);

    // NHI Data for Batch Modal (Shared)
    const [nhiRecords, setNhiRecords] = useState<NHIRecord[]>([]);
    const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);

    // Adjustment Form (Individual)
    const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
    const [adjDate, setAdjDate] = useState('');
    const [adjType, setAdjType] = useState<'income' | 'deduction'>('income');
    const [adjCategory, setAdjCategory] = useState('行政費');
    const [adjAmount, setAdjAmount] = useState('');
    const [adjNote, setAdjNote] = useState('');
    const [isSavingAdj, setIsSavingAdj] = useState(false);

    // Filter doctors safely
    const clinicDocs = doctors.filter(d => {
        if (typeof d === 'string') return true; 
        return d.clinicId === selectedClinicId;
    });

    // Initial doctor selection
    useEffect(() => {
        if (selectedClinicId && doctors.length > 0 && !selectedDoctorId) {
            if (clinicDocs.length > 0) setSelectedDoctorId(getDocId(clinicDocs[0]));
        }
    }, [selectedClinicId, doctors]);

    // Fetch NHI records whenever clinic/month changes to keep modal data fresh
    useEffect(() => {
        if (selectedClinicId && selectedMonth) {
            getNHIRecords(selectedClinicId, selectedMonth).then(setNhiRecords);
        }
    }, [selectedClinicId, selectedMonth]);

    const refreshNHIData = async () => {
        if (selectedClinicId && selectedMonth) {
            try {
                const records = await getNHIRecords(selectedClinicId, selectedMonth);
                setNhiRecords(records);
            } catch (error) {
                console.error("Failed to refresh NHI records:", error);
            }
        }
    };

    const calculateDoctorIncome = (
        doctor: Doctor, 
        dailyRecords: (DailyAccountingRecord | null)[], 
        techRecords: TechnicianRecord[], 
        nhiRecords: NHIRecord[],
        adjRecords: SalaryAdjustment[]
    ) => {
        const docId = getDocId(doctor);
        const docName = getDocName(doctor);
        
        const tempReport: ReportData = {};
        let totalIncome = 0;

        // Init Categories
        Object.keys(CATEGORY_MAP).forEach(catKey => {
            const map = CATEGORY_MAP[catKey];
            let rate = 0;
            if (typeof doctor !== 'string' && doctor.commissionRates) {
                // Ensure whitening uses its specific key, defaulting to 0 if undefined
                rate = (doctor.commissionRates as any)[map.rateKey] || 0;
            }
            tempReport[catKey] = {
                items: [],
                totalRevenue: 0,
                totalLabFee: 0,
                totalNetProfit: 0,
                totalIncome: 0,
                rate: rate
            };
        });

        // 1. Process Revenue
        dailyRecords.forEach((record) => {
            if (record) {
                record.rows.forEach(row => {
                    if (row.doctorId === docId) {
                        const treatments = row.treatments as any;
                        
                        Object.keys(CATEGORY_MAP).forEach(cat => {
                            if (cat === 'nhi') return;
                            
                            // Robust number check
                            const revenue = Number(treatments[cat]) || 0;
                            
                            if (revenue !== 0) {
                                const rate = tempReport[cat].rate;
                                const income = revenue * (rate / 100);
                                tempReport[cat].totalRevenue += revenue;
                                tempReport[cat].totalNetProfit += revenue;
                                tempReport[cat].totalIncome += income;
                                
                                // Only keep detailed items for individual report to save memory
                                if (docId === selectedDoctorId && activeTab === 'individual') {
                                    tempReport[cat].items.push({
                                        type: 'revenue',
                                        date: record.date,
                                        patient: row.patientName,
                                        content: row.treatmentContent || CATEGORY_MAP[cat].label,
                                        revenue: revenue,
                                        labFee: 0, 
                                        netProfit: revenue, 
                                        income: income, 
                                        originalRowId: row.id
                                    });
                                }
                            }
                        });
                    }
                });
            }
        });

        // 2. Process NHI
        const myNhi = nhiRecords.find(r => r.doctorId === docId);
        if (myNhi && myNhi.amount > 0) {
            const revenue = myNhi.amount;
            const rate = tempReport['nhi'].rate;
            const income = revenue * (rate / 100);
            tempReport['nhi'].totalRevenue += revenue;
            tempReport['nhi'].totalNetProfit += revenue;
            tempReport['nhi'].totalIncome += income;

            if (docId === selectedDoctorId && activeTab === 'individual') {
                tempReport['nhi'].items.push({
                    type: 'revenue',
                    date: selectedMonth,
                    patient: '健保局',
                    content: '健保申報總額',
                    revenue: revenue,
                    labFee: 0, netProfit: revenue, income: income
                });
            }
        }

        // 3. Process Lab Fees
        const docTechRecords = techRecords.filter(r => r.doctorName === docName);
        docTechRecords.forEach(record => {
            if (record.category === 'vault' || !record.category) return;
            const catKey = record.category;
            if (tempReport[catKey]) {
                const cost = record.amount;
                const rate = tempReport[catKey].rate;
                
                const netProfitImpact = -cost;
                const incomeImpact = netProfitImpact * (rate / 100);

                tempReport[catKey].totalLabFee += cost;
                tempReport[catKey].totalNetProfit += netProfitImpact;
                tempReport[catKey].totalIncome += incomeImpact;

                // Detailed merge for individual view
                if (docId === selectedDoctorId && activeTab === 'individual') {
                    let merged = false;
                    if (record.type === 'linked') {
                        const targetRow = tempReport[catKey].items.find(item => 
                            (record.linkedRowId && item.originalRowId === record.linkedRowId) ||
                            (!record.linkedRowId && item.date === record.date && item.patient === record.patientName)
                        );
                        if (targetRow) {
                            targetRow.type = 'merged';
                            targetRow.labFee += cost;
                            targetRow.netProfit -= cost;
                            // Re-calculate row income
                            targetRow.income = targetRow.netProfit * (rate / 100);
                            
                            const labLabel = record.labName ? `[${record.labName}]` : '[Lab]';
                            if (!targetRow.content.includes(labLabel)) targetRow.content += ` ${labLabel}`;
                            merged = true;
                        }
                    }
                    if (!merged) {
                        const sourceType = record.type === 'linked' ? '系統' : '手動';
                        const labInfo = record.labName ? `[${record.labName}]` : '';
                        tempReport[catKey].items.push({
                            type: 'cost',
                            date: record.date,
                            patient: record.patientName || '未指定',
                            content: `(技工-${sourceType}) ${labInfo} ${record.treatmentContent || record.note || ''}`,
                            revenue: 0,
                            labFee: cost,
                            netProfit: netProfitImpact,
                            income: incomeImpact
                        });
                    }
                }
            }
        });

        // 4. Sum up Incomes
        Object.keys(tempReport).forEach(key => {
            totalIncome += tempReport[key].totalIncome;
            if (docId === selectedDoctorId) {
                tempReport[key].items.sort((a, b) => a.date.localeCompare(b.date));
            }
        });

        // 5. Adjustments
        const myAdjustments = adjRecords.filter(a => a.doctorId === docId);
        const totalAdj = myAdjustments.reduce((sum, item) => sum + item.amount, 0);
        
        return {
            reportData: tempReport,
            totalIncome: totalIncome + totalAdj,
            totalAdjustments: totalAdj,
            adjustments: myAdjustments
        };
    };

    const fetchAllData = async () => {
        const [year, month] = selectedMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        
        // A. Fetch All Daily Records for Month
        const dailyPromises = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            dailyPromises.push(loadDailyAccounting(selectedClinicId, dateStr));
        }
        const dailyRecords = await Promise.all(dailyPromises);

        // B. Fetch All Technician Records
        const techRecords = await getTechnicianRecords(selectedClinicId, '', selectedMonth);

        // C. Fetch NHI Records
        const nhiRecords = await getNHIRecords(selectedClinicId, selectedMonth);

        // D. Fetch Clinic-Wide Adjustments
        const adjRecords = await getClinicSalaryAdjustments(selectedClinicId, selectedMonth);

        return { dailyRecords, techRecords, nhiRecords, adjRecords };
    };

    const handleCalculate = async () => {
        if (!selectedClinicId || !selectedMonth) return;
        setIsLoading(true);

        try {
            const { dailyRecords, techRecords, nhiRecords, adjRecords } = await fetchAllData();
            setNhiRecords(nhiRecords); // Update shared NHI state

            if (activeTab === 'individual') {
                if (!selectedDoctorId) return;
                const doctor = clinicDocs.find(d => getDocId(d) === selectedDoctorId);
                if (!doctor) return;

                const result = calculateDoctorIncome(doctor, dailyRecords, techRecords, nhiRecords, adjRecords);
                
                setReport(result.reportData);
                setGrandTotal(result.totalIncome);
                setAdjustments(result.adjustments);
            } else {
                // Summary Mode
                const summaryList: DoctorSummary[] = [];
                
                clinicDocs.forEach(doctor => {
                    const result = calculateDoctorIncome(doctor, dailyRecords, techRecords, nhiRecords, adjRecords);
                    
                    const categories: Record<string, number> = {};
                    Object.keys(result.reportData).forEach(cat => {
                        categories[cat] = result.reportData[cat].totalIncome;
                    });

                    summaryList.push({
                        doctorId: getDocId(doctor),
                        doctorName: getDocName(doctor),
                        categories: categories,
                        totalAdjustments: result.totalAdjustments,
                        totalPayout: result.totalIncome
                    });
                });
                setSummaryReport(summaryList);
            }

        } catch (error) {
            console.error(error);
            alert("計算失敗: " + (error as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportExcel = () => {
        if (!report || !selectedClinicId || !selectedDoctorId) return;

        const clinic = clinics.find(c => c.id === selectedClinicId);
        const doctor = doctors.find(d => (typeof d === 'string' ? d : d.id) === selectedDoctorId);
        const docName = typeof doctor === 'string' ? doctor : (doctor?.name || 'Unknown');
        const clinicName = clinic?.name || 'Clinic';

        const wb = XLSX.utils.book_new();
        const wsData: any[][] = [];

        // Header
        wsData.push([`${clinicName} 醫師薪資表`]);
        wsData.push([`醫師: ${docName}`, `月份: ${selectedMonth}`]);
        wsData.push([]);

        // --- Section A: Summary ---
        wsData.push(["【薪資匯總 Summary】"]);
        wsData.push(["項目", "總實收", "總技工費", "淨利", "抽成比 (%)", "醫師所得"]);

        // Categories
        Object.keys(CATEGORY_MAP).forEach(key => {
            const data = report[key];
            if (data.totalRevenue === 0 && data.totalLabFee === 0 && data.totalIncome === 0) return;
            
            wsData.push([
                CATEGORY_MAP[key].label,
                data.totalRevenue,
                data.totalLabFee,
                data.totalNetProfit,
                `${data.rate}%`,
                data.totalIncome
            ]);
        });

        // Adjustments
        adjustments.forEach(adj => {
            wsData.push([
                `其他: ${adj.category} (${adj.note})`,
                "-", "-", "-", "-", 
                adj.amount
            ]);
        });

        // Grand Total
        wsData.push(["總計", "", "", "", "", grandTotal]);
        wsData.push([]);
        wsData.push([]);

        // --- Section B: Details ---
        wsData.push(["【療程明細 Details】"]);

        Object.keys(CATEGORY_MAP).forEach(key => {
            const data = report[key];
            if (data.items.length === 0) return;

            wsData.push([`--- ${CATEGORY_MAP[key].label} ---`]);
            wsData.push(["日期", "病患", "療程內容", "實收", "技工費", "淨利", "醫師所得"]);

            data.items.forEach(item => {
                wsData.push([
                    item.date,
                    item.patient,
                    item.content,
                    item.revenue,
                    item.labFee,
                    item.netProfit,
                    item.income
                ]);
            });
            // Subtotal row for category
            wsData.push([
                "小計", "", "", 
                data.totalRevenue, 
                data.totalLabFee, 
                data.totalNetProfit, 
                data.totalIncome
            ]);
            wsData.push([]); // Spacer
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        
        // Column widths
        ws['!cols'] = [
            { wch: 15 }, // Date/Item
            { wch: 15 }, // Patient
            { wch: 30 }, // Content
            { wch: 12 }, // Revenue
            { wch: 12 }, // Lab
            { wch: 12 }, // Net
            { wch: 12 }, // Income
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Salary Statement");
        XLSX.writeFile(wb, `${docName}_${selectedMonth}_薪資表.xlsx`);
    };

    const handleExportSummaryExcel = () => {
        if (summaryReport.length === 0 || !selectedClinicId) return;
        const clinic = clinics.find(c => c.id === selectedClinicId);
        const clinicName = clinic?.name || 'Clinic';

        const wb = XLSX.utils.book_new();
        const wsData: any[][] = [];

        // Header
        wsData.push([`${clinicName} 全院醫師薪資總表`]);
        wsData.push([`月份: ${selectedMonth}`]);
        wsData.push([]);

        // Columns: Category, Doc1, Doc2, ...
        const headerRow = ["項目", ...summaryReport.map(s => s.doctorName)];
        wsData.push(headerRow);

        // Rows: Each Category
        Object.keys(CATEGORY_MAP).forEach(catKey => {
            const row: (string | number)[] = [CATEGORY_MAP[catKey].label];
            let hasValue = false;
            summaryReport.forEach(doc => {
                const val = doc.categories[catKey] || 0;
                row.push(val);
                if (val !== 0) hasValue = true;
            });
            if (hasValue) wsData.push(row);
        });

        // Adjustments Row
        const adjRow: (string | number)[] = ["其他增減項"];
        summaryReport.forEach(doc => adjRow.push(doc.totalAdjustments));
        wsData.push(adjRow);

        // Total Row
        const totalRow: (string | number)[] = ["實領總額"];
        summaryReport.forEach(doc => totalRow.push(doc.totalPayout));
        wsData.push(totalRow);

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, "Clinic Summary");
        XLSX.writeFile(wb, `${clinicName}_${selectedMonth}_全院總表.xlsx`);
    };

    // --- Individual View Handlers ---
    const handleOpenAdjModal = () => {
        setAdjDate(selectedMonth + '-01');
        setAdjType('income');
        setAdjCategory('行政費');
        setAdjAmount('');
        setAdjNote('');
        setIsAdjustmentModalOpen(true);
    };

    const handleAddAdjustment = async () => {
        if (!adjDate || !adjAmount) return;
        setIsSavingAdj(true);
        try {
            let finalAmount = parseFloat(adjAmount);
            if (isNaN(finalAmount)) throw new Error("Invalid Amount");
            if (adjType === 'deduction') finalAmount = -Math.abs(finalAmount);
            else finalAmount = Math.abs(finalAmount);

            const adjustment: SalaryAdjustment = {
                clinicId: selectedClinicId,
                doctorId: selectedDoctorId,
                month: selectedMonth,
                date: adjDate,
                category: adjCategory,
                amount: finalAmount,
                note: adjNote,
                updatedAt: Date.now()
            };
            await addSalaryAdjustment(adjustment);
            setIsAdjustmentModalOpen(false);
            handleCalculate(); // Refresh individual view
        } catch (error) {
            alert("新增失敗: " + (error as Error).message);
        } finally {
            setIsSavingAdj(false);
        }
    };

    const handleDeleteAdjustment = async (id: string) => {
        if(!confirm("確定要刪除此項目嗎？")) return;
        try {
            await deleteSalaryAdjustment(id);
            handleCalculate();
        } catch (error) {
            alert("刪除失敗");
        }
    };

    return (
        <div className="space-y-6 pb-12">
            {/* Header & Tabs */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {/* Global Controls */}
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <Calculator className="text-teal-600" /> 薪資報表
                        </h2>
                        <p className="text-slate-500 text-sm">包含每日帳務、技工扣費與健保申報計算。</p>
                    </div>
                    
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('individual')}
                            className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'individual' ? 'bg-white shadow text-teal-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <User size={16} /> 個人薪資單
                        </button>
                        <button
                            onClick={() => setActiveTab('summary')}
                            className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'summary' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Users size={16} /> 全院匯總表
                        </button>
                    </div>
                </div>

                {/* Common Filters */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-6 bg-slate-50 border-b border-slate-200 items-end">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">診所</label>
                        <select 
                            className="w-full border p-2 rounded bg-white"
                            value={selectedClinicId}
                            onChange={e => setSelectedClinicId(e.target.value)}
                        >
                            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                    
                    {/* Tab Specific Filter: Doctor */}
                    {activeTab === 'individual' ? (
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">醫師</label>
                            <select 
                                className="w-full border p-2 rounded bg-white"
                                value={selectedDoctorId}
                                onChange={e => setSelectedDoctorId(e.target.value)}
                            >
                                {clinicDocs.map(d => (
                                    <option key={getDocId(d)} value={getDocId(d)}>{getDocName(d)}</option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div></div> // Spacer
                    )}

                    <button 
                        onClick={() => handleCalculate()}
                        disabled={isLoading}
                        className={`text-white px-4 py-2 rounded-lg font-bold shadow-md transition-colors flex items-center justify-center gap-2 ${activeTab === 'individual' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                        {isLoading ? <Loader2 className="animate-spin" size={18}/> : <Calculator size={18} />}
                        {activeTab === 'individual' ? '計算個人' : '計算全院'}
                    </button>
                </div>
                
                {/* Actions Toolbar */}
                <div className="p-4 bg-white flex justify-end gap-3">
                    <button 
                        onClick={() => setIsBatchModalOpen(true)}
                        className="bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors"
                    >
                        <FileText size={16} /> 健保申報 (NHI Claims)
                    </button>
                    {activeTab === 'individual' && (
                        <button 
                            onClick={handleExportExcel}
                            disabled={!report}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                            <FileSpreadsheet size={16} /> 匯出個人 Excel
                        </button>
                    )}
                    {activeTab === 'summary' && (
                        <button 
                            onClick={handleExportSummaryExcel}
                            disabled={summaryReport.length === 0}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                            <FileSpreadsheet size={16} /> 匯出全院總表
                        </button>
                    )}
                </div>
            </div>

            {/* Content Body */}
            
            {/* VIEW 1: INDIVIDUAL */}
            {activeTab === 'individual' && report && (
                <div className="space-y-6 animate-fade-in">
                    {/* Summary Card */}
                    <div className="bg-gradient-to-r from-teal-600 to-emerald-600 rounded-xl shadow-lg p-6 text-white flex justify-between items-center relative overflow-hidden">
                         <div className="relative z-10">
                            <h3 className="text-lg font-medium opacity-90 mb-1">本月總薪資 (Estimated)</h3>
                            <div className="text-4xl font-black tracking-tight flex items-center gap-2">
                                <DollarSign size={32} />
                                {Math.round(grandTotal).toLocaleString()}
                            </div>
                            <p className="text-xs opacity-70 mt-2">
                                *包含技工費扣除、健保申報與其他增減項
                            </p>
                         </div>
                         <Banknote size={100} className="absolute -right-6 -bottom-6 text-white opacity-20 rotate-12" />
                    </div>

                    {/* Detailed Tables per Category */}
                    {Object.keys(report).map(catKey => {
                        const data = report[catKey];
                        if (data.totalRevenue === 0 && data.totalLabFee === 0 && data.totalIncome === 0) return null;

                        return (
                            <div key={catKey} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp className={catKey === 'nhi' ? 'text-blue-500' : 'text-slate-400'} size={20} />
                                        <h3 className="font-bold text-slate-800 text-lg">
                                            {CATEGORY_MAP[catKey].label}
                                        </h3>
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${catKey === 'nhi' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-teal-100 text-teal-800 border-teal-200'}`}>
                                            抽成: {data.rate}%
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">類別薪資</span>
                                        <div className="text-xl font-bold text-teal-600 tabular-nums">
                                            ${Math.round(data.totalIncome).toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-white border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                                            <tr>
                                                <th className="px-4 py-3">日期</th>
                                                <th className="px-4 py-3">病患</th>
                                                <th className="px-4 py-3">內容</th>
                                                <th className="px-4 py-3 text-right">實收 (Revenue)</th>
                                                <th className="px-4 py-3 text-right">技工費 (Lab)</th>
                                                <th className="px-4 py-3 text-right">淨利 (Net)</th>
                                                <th className="px-4 py-3 text-right">醫師所得</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {data.items.map((item, idx) => (
                                                <tr key={idx} className={`hover:bg-slate-50 transition-colors ${item.type === 'cost' ? 'bg-rose-50/30' : item.type === 'merged' ? 'bg-blue-50/10' : ''}`}>
                                                    <td className="px-4 py-3 font-mono text-blue-600 font-bold cursor-pointer hover:underline" onClick={() => catKey !== 'nhi' && navigate(`/accounting?date=${item.date}`)}>
                                                        {item.date.slice(5)}
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-slate-700">{item.patient}</td>
                                                    <td className="px-4 py-3 text-slate-500 truncate max-w-[250px] text-xs">
                                                        {item.type === 'cost' && <span className="inline-block w-2 h-2 rounded-full bg-rose-400 mr-2"></span>}
                                                        {item.content}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-600">
                                                        {item.revenue !== 0 ? `$${item.revenue.toLocaleString()}` : '-'}
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-mono ${item.labFee > 0 ? 'text-rose-500 font-bold' : (item.labFee < 0 ? 'text-green-600' : 'text-slate-300')}`}>
                                                        {item.labFee !== 0 ? `-$${Math.round(item.labFee).toLocaleString()}` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-700">${Math.round(item.netProfit).toLocaleString()}</td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-teal-600">${Math.round(item.income).toLocaleString()}</td>
                                                </tr>
                                            ))}
                                            <tr className="bg-slate-50/50 font-bold text-slate-700 border-t border-slate-200">
                                                <td colSpan={3} className="px-4 py-3 text-right uppercase text-xs text-slate-400">Total</td>
                                                <td className="px-4 py-3 text-right">${data.totalRevenue.toLocaleString()}</td>
                                                <td className="px-4 py-3 text-right text-rose-500">
                                                    {data.totalLabFee > 0 ? `-$${Math.round(data.totalLabFee).toLocaleString()}` : `$${Math.abs(Math.round(data.totalLabFee)).toLocaleString()}`}
                                                </td>
                                                <td className="px-4 py-3 text-right">${Math.round(data.totalNetProfit).toLocaleString()}</td>
                                                <td className="px-4 py-3 text-right text-teal-600">${Math.round(data.totalIncome).toLocaleString()}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })}

                    {/* Adjustments Section */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 bg-amber-50 border-b border-amber-200 flex justify-between items-center">
                            <h3 className="font-bold text-amber-800 flex items-center gap-2">
                                <FileEdit size={18} /> 其他增減項 (Other Adjustments)
                            </h3>
                            <div className="flex items-center gap-4">
                                <span className="text-sm font-bold text-amber-800">
                                    小計: ${adjustments.reduce((s,i) => s + i.amount, 0).toLocaleString()}
                                </span>
                                <button 
                                    onClick={handleOpenAdjModal}
                                    className="bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300 flex items-center gap-1 transition-colors"
                                >
                                    <Plus size={14} /> 新增項目
                                </button>
                            </div>
                        </div>
                        {adjustments.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-sm">無其他增減項目</div>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead className="bg-amber-50 text-amber-900 font-bold text-xs uppercase border-b border-amber-200">
                                    <tr>
                                        <th className="px-4 py-2">日期</th>
                                        <th className="px-4 py-2">類別</th>
                                        <th className="px-4 py-2">備註</th>
                                        <th className="px-4 py-2 text-right">金額</th>
                                        <th className="px-4 py-2 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-amber-100">
                                    {adjustments.map(adj => (
                                        <tr key={adj.id} className="hover:bg-amber-50/50">
                                            <td className="px-4 py-2">{adj.date}</td>
                                            <td className="px-4 py-2 font-bold text-amber-700">{adj.category}</td>
                                            <td className="px-4 py-2 text-slate-500 text-xs">{adj.note}</td>
                                            <td className={`px-4 py-2 text-right font-mono font-bold ${adj.amount < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                                                {adj.amount.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                <button onClick={() => handleDeleteAdjustment(adj.id!)} className="text-slate-300 hover:text-rose-500">
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* VIEW 2: SUMMARY */}
            {activeTab === 'summary' && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-fade-in">
                    {summaryReport.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">請先點擊「計算全院」按鈕產生報表</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10 border-r border-slate-200">項目 (Category)</th>
                                        {summaryReport.map(doc => (
                                            <th key={doc.doctorId} className="px-4 py-3 text-center min-w-[120px]">{doc.doctorName}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {Object.keys(CATEGORY_MAP).map(catKey => (
                                        <tr key={catKey} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 font-bold text-slate-700 sticky left-0 bg-white border-r border-slate-100">
                                                {CATEGORY_MAP[catKey].label}
                                            </td>
                                            {summaryReport.map(doc => (
                                                <td key={doc.doctorId} className="px-4 py-3 text-right font-mono text-slate-600">
                                                    {doc.categories[catKey] ? doc.categories[catKey].toLocaleString() : '-'}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {/* Adjustments Row */}
                                    <tr className="bg-amber-50/50 hover:bg-amber-50">
                                        <td className="px-4 py-3 font-bold text-amber-800 sticky left-0 bg-amber-50/50 border-r border-amber-100">
                                            其他增減項
                                        </td>
                                        {summaryReport.map(doc => (
                                            <td key={doc.doctorId} className="px-4 py-3 text-right font-mono font-bold text-amber-700">
                                                {doc.totalAdjustments !== 0 ? doc.totalAdjustments.toLocaleString() : '-'}
                                            </td>
                                        ))}
                                    </tr>
                                    {/* Total Row */}
                                    <tr className="bg-indigo-50/50 font-black text-slate-800 border-t-2 border-indigo-100">
                                        <td className="px-4 py-3 sticky left-0 bg-indigo-50/50 border-r border-indigo-200">
                                            實領總額 (Payout)
                                        </td>
                                        {summaryReport.map(doc => (
                                            <td key={doc.doctorId} className="px-4 py-3 text-right font-mono text-indigo-700 text-lg">
                                                ${doc.totalPayout.toLocaleString()}
                                            </td>
                                        ))}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* NHI Modal */}
            <NHIClaimsModal 
                isOpen={isBatchModalOpen}
                onClose={() => setIsBatchModalOpen(false)}
                clinicId={selectedClinicId}
                month={selectedMonth}
                doctors={clinicDocs}
                onSave={() => {
                    refreshNHIData();
                    if (report) handleCalculate(); // Refresh report if open
                }}
            />

            {/* Adjustment Modal */}
            {isAdjustmentModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-lg w-full max-w-md animate-fade-in overflow-hidden">
                        <div className="p-4 bg-amber-500 text-white font-bold flex justify-between items-center">
                            <h3>新增薪資調整項目</h3>
                            <button onClick={() => setIsAdjustmentModalOpen(false)} className="hover:text-amber-100"><X /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">日期</label>
                                <input type="date" className="w-full border rounded p-2" value={adjDate} onChange={e => setAdjDate(e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">類型</label>
                                    <div className="flex bg-slate-100 rounded p-1">
                                        <button 
                                            className={`flex-1 py-1 text-sm rounded ${adjType === 'income' ? 'bg-white shadow text-emerald-600 font-bold' : 'text-slate-500'}`}
                                            onClick={() => setAdjType('income')}
                                        >
                                            加項 (+)
                                        </button>
                                        <button 
                                            className={`flex-1 py-1 text-sm rounded ${adjType === 'deduction' ? 'bg-white shadow text-rose-600 font-bold' : 'text-slate-500'}`}
                                            onClick={() => setAdjType('deduction')}
                                        >
                                            減項 (-)
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">項目類別</label>
                                    <select className="w-full border rounded p-2" value={adjCategory} onChange={e => setAdjCategory(e.target.value)}>
                                        <option value="行政費">行政費</option>
                                        <option value="餐費">餐費</option>
                                        <option value="代墊款">代墊款</option>
                                        <option value="獎金">獎金</option>
                                        <option value="預支">預支</option>
                                        <option value="其他">其他</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">金額</label>
                                <input 
                                    type="number" 
                                    className={`w-full border rounded p-2 font-bold text-lg outline-none focus:ring-2 ${adjType === 'income' ? 'text-emerald-600 focus:ring-emerald-500' : 'text-rose-600 focus:ring-rose-500'}`}
                                    value={adjAmount} 
                                    onChange={e => setAdjAmount(e.target.value)} 
                                    placeholder="0"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">備註</label>
                                <textarea className="w-full border rounded p-2 h-20" value={adjNote} onChange={e => setAdjNote(e.target.value)} placeholder="說明原因..." />
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 flex justify-end gap-3 border-t border-slate-100">
                            <button onClick={() => setIsAdjustmentModalOpen(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-200 rounded-lg">取消</button>
                            <button 
                                onClick={handleAddAdjustment} 
                                disabled={isSavingAdj}
                                className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2"
                            >
                                {isSavingAdj && <Loader2 size={16} className="animate-spin" />} 儲存
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
