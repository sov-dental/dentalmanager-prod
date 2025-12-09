
import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Consultant, AccountingRow } from '../types';
import { loadDailyAccounting, hydrateRow, db, saveBonusSettings, getBonusSettings } from '../services/firebase';
import { 
  Calculator, Loader2, DollarSign, Save, Users, 
  PieChart, Wallet, ChevronRight, Gift, CheckCircle
} from 'lucide-react';
import { BonusDetailModal } from './BonusDetailModal';

interface Props {
  clinics: Clinic[];
  consultants: Consultant[];
}

interface CalculatedStaff {
    id: string;
    name: string;
    role: string;
    selfPayRevenue: number;
    retailRevenue: number;
    baseBonus: number;
    personalRate: number; // %
    personalKeep: number;
    poolContribution: number;
    poolShare: number;
    finalBonus: number;
    isEligibleForPool: boolean;
}

export const AssistantBonus: React.FC<Props> = ({ clinics, consultants }) => {
    const [selectedClinicId, setSelectedClinicId] = useState<string>(clinics[0]?.id || '');
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    
    // Calculation State
    const [calculatedData, setCalculatedData] = useState<CalculatedStaff[]>([]);
    const [poolRate, setPoolRate] = useState<number>(30); // Default 30%
    const [rawRows, setRawRows] = useState<AccountingRow[]>([]);
    
    // UI State
    const [isLoading, setIsLoading] = useState(false);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    
    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedDetailStaff, setSelectedDetailStaff] = useState<{id: string, name: string} | null>(null);

    // Load Pool Rate Setting using new getBonusSettings
    useEffect(() => {
        if (selectedClinicId && selectedMonth) {
            const loadSettings = async () => {
                try {
                    const settings = await getBonusSettings(selectedClinicId, selectedMonth);
                    if (settings && settings.poolRate !== undefined) {
                        setPoolRate(Number(settings.poolRate));
                    } else {
                        setPoolRate(30); // Default
                    }
                } catch (e) {
                    console.error("Failed to load bonus settings", e);
                }
            };
            loadSettings();
        }
    }, [selectedClinicId, selectedMonth]);

    const handleSaveSettings = async () => {
        if (!selectedClinicId || !selectedMonth) return;
        setIsSavingSettings(true);
        try {
            // Updated call signature: (clinicId, month, settings)
            await saveBonusSettings(selectedClinicId, selectedMonth, { poolRate: Number(poolRate) });
            
            // Optionally trigger a silent recalc to ensure UI is in sync if data exists
            if (calculatedData.length > 0) {
                handleCalculate();
            }
            // Optional: Success Toast could go here
        } catch (e) {
            alert("Save Error: " + (e as Error).message);
        } finally {
            setIsSavingSettings(false);
        }
    };

    const handleCalculate = async () => {
        if (!selectedClinicId || !selectedMonth) return;

        setIsLoading(true);
        setCalculatedData([]);
        setRawRows([]);

        try {
            const [year, month] = selectedMonth.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            
            // 1. Fetch Daily Data
            const promises = [];
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                promises.push(loadDailyAccounting(selectedClinicId, dateStr));
            }

            const dailyRecords = await Promise.all(promises);
            
            // 2. Flatten Rows
            const allRows: AccountingRow[] = [];
            dailyRecords.forEach(rec => {
                if (rec && rec.rows) {
                    rec.rows.forEach(r => {
                        const hydrated = hydrateRow(r);
                        hydrated.originalDate = rec.date;
                        allRows.push(hydrated);
                    });
                }
            });
            setRawRows(allRows);

            // 3. Filter Staff for this Clinic (Roles: Consultant, Trainee, Assistant)
            // Note: We use getStaffList inside the component or rely on props. 
            // Assuming props.consultants is up to date or we fetch fresh if needed.
            // For now, using props.consultants filtered by ID.
            const allowedRoles = ['consultant', 'trainee', 'assistant'];
            const clinicStaff = consultants.filter(c => 
                c.clinicId === selectedClinicId && 
                allowedRoles.includes(c.role || 'consultant')
            );

            // 4. Calculate Base Metrics per Staff
            // Note: We map ALL eligible staff, even if they have 0 revenue.
            let tempStaffData = clinicStaff.map(staff => {
                let selfPayTotal = 0;
                let retailTotal = 0;

                allRows.forEach(row => {
                    // Self Pay
                    const t = row.treatments;
                    const sp = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + 
                               (t.sov || 0) + (t.perio || 0) + (t.whitening || 0) + 
                               (t.inv || 0) + (t.otherSelfPay || 0);
                    
                    if (sp > 0 && t.consultant === staff.id) {
                        selfPayTotal += sp;
                    }

                    // Retail
                    const r = row.retail;
                    const ret = (r.products || 0) + (r.diyWhitening || 0);
                    // Use staff field if present, otherwise fallback to consultant
                    const ownerId = r.staff || t.consultant;
                    
                    if (ret > 0 && ownerId === staff.id) {
                        retailTotal += ret;
                    }
                });

                // Base Bonus Formula
                const baseBonus = Math.round((selfPayTotal * 0.01) + (retailTotal * 0.1));

                return {
                    id: staff.id,
                    name: staff.name,
                    role: staff.role || 'consultant',
                    selfPayRevenue: selfPayTotal,
                    retailRevenue: retailTotal,
                    baseBonus,
                    personalRate: 100, // Placeholder
                    personalKeep: 0,
                    poolContribution: 0,
                    poolShare: 0,
                    finalBonus: 0,
                    isEligibleForPool: false
                };
            });

            // 5. Apply Pool Logic
            let totalPool = 0;
            let eligibleCount = 0;

            tempStaffData = tempStaffData.map(s => {
                // Rule: Only 'consultant' role contributes to pool. 
                // 'trainee', 'assistant' keep 100%.
                const isConsultant = s.role === 'consultant';
                
                let pRate = 100;
                let contrib = 0;

                if (isConsultant) {
                    pRate = 100 - poolRate;
                    // Only contribute if there is base bonus
                    if (s.baseBonus > 0) {
                        contrib = Math.round(s.baseBonus * (poolRate / 100));
                    }
                    // Consultants are eligible for pool share regardless of revenue (as long as they are active)
                    eligibleCount++;
                }

                totalPool += contrib;

                return {
                    ...s,
                    personalRate: pRate,
                    personalKeep: s.baseBonus - contrib,
                    poolContribution: contrib,
                    isEligibleForPool: isConsultant
                };
            });

            // 6. Distribute Pool
            const sharePerPerson = eligibleCount > 0 ? Math.round(totalPool / eligibleCount) : 0;

            const finalData = tempStaffData.map(s => {
                const share = s.isEligibleForPool ? sharePerPerson : 0;
                return {
                    ...s,
                    poolShare: share,
                    finalBonus: s.personalKeep + share
                };
            });

            setCalculatedData(finalData);

        } catch (error) {
            console.error(error);
            alert("計算失敗");
        } finally {
            setIsLoading(false);
        }
    };

    // Summary Metrics
    const totalPayout = calculatedData.reduce((sum, s) => sum + s.finalBonus, 0);
    const groupPoolTotal = calculatedData.reduce((sum, s) => sum + s.poolContribution, 0);
    const poolShare = calculatedData.find(s => s.isEligibleForPool)?.poolShare || 0;

    const handleRowClick = (staff: CalculatedStaff) => {
        setSelectedDetailStaff({ id: staff.id, name: staff.name });
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-6 pb-12">
            
            {/* 1. COMPACT HEADER ROW */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col xl:flex-row items-center gap-4">
                
                {/* Brand / Title */}
                <div className="flex items-center gap-2 mr-auto">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600">
                        <Gift size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">獎金計算引擎</h2>
                        <p className="text-xs text-slate-500">Assistant Bonus Engine</p>
                    </div>
                </div>

                {/* Controls Container */}
                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-center xl:justify-end">
                    
                    {/* Clinic Selector */}
                    <div className="w-full sm:w-auto min-w-[160px]">
                        <select 
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 font-bold text-slate-700 bg-white outline-none focus:ring-2 focus:ring-purple-500"
                            value={selectedClinicId}
                            onChange={e => setSelectedClinicId(e.target.value)}
                        >
                            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {/* Group Pool Settings (Compact) */}
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                        <span className="text-xs font-bold text-slate-600 whitespace-nowrap">團體公積金 %</span>
                        <input 
                            type="number" min="0" max="100" step="5"
                            className="w-14 border rounded px-1 py-1 text-center font-bold text-purple-700 text-sm outline-none focus:border-purple-500"
                            value={poolRate}
                            onChange={e => setPoolRate(Number(e.target.value))}
                        />
                        <button 
                            onClick={handleSaveSettings}
                            disabled={isSavingSettings}
                            className="ml-1 p-1.5 bg-white border border-slate-300 rounded-md text-slate-500 hover:text-emerald-600 hover:border-emerald-300 transition-colors shadow-sm"
                            title="儲存設定"
                        >
                            {isSavingSettings ? <Loader2 size={14} className="animate-spin"/> : <Save size={14} />}
                        </button>
                    </div>

                    {/* Month Selector */}
                    <input 
                        type="month" 
                        className="border border-slate-300 rounded-lg px-3 py-2 font-bold text-slate-700 bg-white outline-none focus:ring-2 focus:ring-purple-500"
                        value={selectedMonth}
                        onChange={e => setSelectedMonth(e.target.value)}
                    />

                    {/* Calculate Button */}
                    <button 
                        onClick={handleCalculate}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold shadow-md hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
                    >
                        {isLoading ? <Loader2 size={18} className="animate-spin"/> : <Calculator size={18} />}
                        計算
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h4 className="text-xs font-bold text-slate-500 uppercase">獎金發放總額 (TOTAL PAYOUT)</h4>
                    <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-4xl font-black text-slate-800">${totalPayout.toLocaleString()}</span>
                    </div>
                    <DollarSign className="text-slate-100 absolute right-4 bottom-4" size={64} />
                </div>

                <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-6 rounded-xl shadow-lg text-white relative overflow-hidden">
                    <div className="relative z-10">
                        <h4 className="text-xs font-bold text-purple-200 uppercase">公積金總池 (GROUP POOL)</h4>
                        <div className="mt-2 text-4xl font-black">${groupPoolTotal.toLocaleString()}</div>
                        <div className="mt-1 text-xs text-purple-200">來自 {poolRate}% 諮詢師貢獻</div>
                    </div>
                    <Users className="text-white opacity-10 absolute right-[-10px] bottom-[-10px]" size={100} />
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h4 className="text-xs font-bold text-slate-500 uppercase">每人均分 (POOL SHARE)</h4>
                    <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-4xl font-black text-purple-600">${poolShare.toLocaleString()}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">僅分配給正式諮詢師</div>
                    <PieChart className="text-slate-100 absolute right-4 bottom-4" size={64} />
                </div>
            </div>

            {/* Main Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-fade-in">
                <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <Wallet size={18} className="text-amber-500" /> 獎金明細表
                    </h3>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white text-slate-500 font-bold text-xs uppercase border-b border-slate-100">
                            <tr>
                                <th className="px-4 py-3">姓名</th>
                                <th className="px-4 py-3">職位</th>
                                <th className="px-4 py-3 text-right">相關營收</th>
                                <th className="px-4 py-3 text-right text-slate-700">基礎獎金 (BASE)</th>
                                <th className="px-4 py-3 text-center">個人比 (%)</th>
                                <th className="px-4 py-3 text-right text-emerald-600">個人實得</th>
                                <th className="px-4 py-3 text-right text-purple-600">公積金貢獻</th>
                                <th className="px-4 py-3 text-right text-purple-600">公積金分配</th>
                                <th className="px-4 py-3 text-right font-black text-slate-800 bg-slate-50">最終獎金</th>
                                <th className="w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {calculatedData.map((staff) => (
                                <tr 
                                    key={staff.id} 
                                    onClick={() => handleRowClick(staff)}
                                    className="hover:bg-indigo-50/30 transition-colors cursor-pointer group"
                                >
                                    <td className="px-4 py-3 font-bold text-slate-700">{staff.name}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-[10px] px-2 py-1 rounded-full border ${staff.role === 'consultant' ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                            {staff.role === 'consultant' ? '諮詢師' : staff.role === 'assistant' ? '助理' : staff.role === 'trainee' ? '培訓' : staff.role}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                                        ${(staff.selfPayRevenue + staff.retailRevenue).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-700 tabular-nums bg-slate-50/50">
                                        ${staff.baseBonus.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-center text-slate-400 tabular-nums">
                                        {staff.personalRate}%
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-emerald-600 tabular-nums">
                                        ${staff.personalKeep.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-right text-purple-400 tabular-nums">
                                        {staff.poolContribution > 0 ? `-$${staff.poolContribution.toLocaleString()}` : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-purple-600 tabular-nums">
                                        {staff.poolShare > 0 ? `+$${staff.poolShare.toLocaleString()}` : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right font-black text-lg text-slate-800 bg-slate-50 tabular-nums border-l border-slate-100">
                                        ${staff.finalBonus.toLocaleString()}
                                    </td>
                                    <td className="px-2 text-slate-300">
                                        <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </td>
                                </tr>
                            ))}
                            {calculatedData.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-slate-400 italic">
                                        請點擊「計算」按鈕
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail Modal */}
            <BonusDetailModal 
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                staffName={selectedDetailStaff?.name || ''}
                staffId={selectedDetailStaff?.id || ''}
                month={selectedMonth}
                rawRows={rawRows}
            />
        </div>
    );
};
