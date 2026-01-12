
import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Consultant, AccountingRow, DailyAccountingRecord } from '../types';
import { hydrateRow, db, saveBonusSettings, getBonusSettings, CLINIC_ORDER } from '../services/firebase';
import { 
  Calculator, Loader2, DollarSign, Save, Users, 
  PieChart, Wallet, ChevronRight, Gift, Percent, Globe
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
    // Sort Clinics
    const sortedClinics = useMemo(() => {
        return [...clinics].sort((a, b) => {
            const orderA = CLINIC_ORDER[a.name] ?? 999;
            const orderB = CLINIC_ORDER[b.name] ?? 999;
            return orderA - orderB;
        });
    }, [clinics]);

    const [selectedClinicId, setSelectedClinicId] = useState<string>(sortedClinics[0]?.id || '');
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    
    // Calculation State
    const [calculatedData, setCalculatedData] = useState<CalculatedStaff[]>([]);
    
    // Configurable Rates (Global)
    const [poolRate, setPoolRate] = useState<number>(30); // Default 30%
    const [selfPayRate, setSelfPayRate] = useState<number>(1); // Default 1%
    const [retailRate, setRetailRate] = useState<number>(10); // Default 10%

    const [rawRows, setRawRows] = useState<AccountingRow[]>([]);
    
    // UI State
    const [isLoading, setIsLoading] = useState(false);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    
    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedDetailStaff, setSelectedDetailStaff] = useState<{id: string, name: string} | null>(null);

    // Ensure selectedClinicId is valid if sortedClinics changes
    useEffect(() => {
        if (!selectedClinicId && sortedClinics.length > 0) {
            setSelectedClinicId(sortedClinics[0].id);
        }
    }, [sortedClinics, selectedClinicId]);

    // Load Global Bonus Settings (Dependent only on ClinicID)
    useEffect(() => {
        if (selectedClinicId) {
            const loadSettings = async () => {
                try {
                    const settings = await getBonusSettings(selectedClinicId);
                    // getBonusSettings now returns defaults if empty, so we can trust it mostly
                    // But safe checks are good
                    setPoolRate(settings?.poolRate !== undefined ? Number(settings.poolRate) : 30);
                    setSelfPayRate(settings?.selfPayRate !== undefined ? Number(settings.selfPayRate) : 1);
                    setRetailRate(settings?.retailRate !== undefined ? Number(settings.retailRate) : 10);
                } catch (e) {
                    console.error("Failed to load bonus settings", e);
                }
            };
            loadSettings();
        }
    }, [selectedClinicId]);

    const handleSaveSettings = async () => {
        if (!selectedClinicId) return;
        setIsSavingSettings(true);
        try {
            await saveBonusSettings(selectedClinicId, { 
                poolRate: Number(poolRate),
                selfPayRate: Number(selfPayRate),
                retailRate: Number(retailRate)
            });
            
            // Trigger silent recalc if data is already present
            if (calculatedData.length > 0) {
                handleCalculate();
            }
            alert("全域設定已儲存 (Saved to Global Settings)");
        } catch (e) {
            alert("Save Error: " + (e as Error).message);
        } finally {
            setIsSavingSettings(false);
        }
    };

    const handleCalculate = async () => {
        if (!selectedClinicId || !selectedMonth) {
            alert("請選擇診所與月份");
            return;
        }

        setIsLoading(true);
        setCalculatedData([]);
        setRawRows([]);

        try {
            const [year, month] = selectedMonth.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            
            const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
            const endStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

            console.log(`[AssistantBonus] Fetching range: ${startStr} to ${endStr} for Clinic: ${selectedClinicId}`);

            const snapshot = await db.collection('daily_accounting')
                .where('clinicId', '==', selectedClinicId)
                .where('date', '>=', startStr)
                .where('date', '<=', endStr)
                .get();

            if (snapshot.empty) {
                console.warn("[AssistantBonus] No accounting records found for this period.");
            }
            
            // Flatten Rows
            const allRows: AccountingRow[] = [];
            snapshot.forEach(doc => {
                const rec = doc.data() as DailyAccountingRecord;
                if (rec && rec.rows) {
                    rec.rows.forEach(r => {
                        const hydrated = hydrateRow(r);
                        hydrated.originalDate = rec.date;
                        allRows.push(hydrated);
                    });
                }
            });
            setRawRows(allRows);

            // Filter Staff
            const allowedRoles = ['consultant', 'trainee', 'assistant'];
            const clinicStaff = consultants.filter(c => 
                c.clinicId === selectedClinicId && 
                allowedRoles.includes(c.role || 'consultant')
            );

            // Calculate Base Metrics
            let tempStaffData = clinicStaff.map(staff => {
                let selfPayTotal = 0;
                let retailTotal = 0;

                const staffName = (staff.name || '').trim();

                allRows.forEach(row => {
                    const t = row.treatments;
                    const r = row.retail;

                    const rowConsultant = (t.consultant || '').trim();
                    const isTreatmentMatch = (
                        rowConsultant === staff.id || 
                        rowConsultant === staffName
                    );

                    const sp = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + 
                               (t.sov || 0) + (t.perio || 0) + (t.whitening || 0) + 
                               (t.inv || 0) + (t.otherSelfPay || 0);
                    
                    if (sp > 0 && isTreatmentMatch) {
                        selfPayTotal += sp;
                    }

                    const rowRetailer = (r.staff || t.consultant || '').trim();
                    const isRetailMatch = (
                        rowRetailer === staff.id || 
                        rowRetailer === staffName
                    );

                    const ret = (r.products || 0) + (r.diyWhitening || 0);
                    
                    if (ret > 0 && isRetailMatch) {
                        retailTotal += ret;
                    }
                });

                // Dynamic Rate Calculation
                const baseBonus = Math.round((selfPayTotal * (selfPayRate / 100)) + (retailTotal * (retailRate / 100)));

                return {
                    id: staff.id,
                    name: staff.name,
                    role: staff.role || 'consultant',
                    selfPayRevenue: selfPayTotal,
                    retailRevenue: retailTotal,
                    baseBonus,
                    personalRate: 100, 
                    personalKeep: 0,
                    poolContribution: 0,
                    poolShare: 0,
                    finalBonus: 0,
                    isEligibleForPool: false
                };
            });

            // Apply Pool Logic
            let totalPool = 0;
            let eligibleCount = 0;

            tempStaffData = tempStaffData.map(s => {
                const isConsultant = s.role === 'consultant';
                let pRate = 100;
                let contrib = 0;

                if (isConsultant) {
                    pRate = 100 - poolRate;
                    if (s.baseBonus > 0) {
                        contrib = Math.round(s.baseBonus * (poolRate / 100));
                    }
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

            // Distribute Pool
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
            console.error("Assistant Bonus Calculation Failed", error);
            alert("計算失敗: " + (error as Error).message);
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
            
            {/* Header */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col xl:flex-row items-center gap-4">
                <div className="flex items-center gap-2 mr-auto">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600">
                        <Gift size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">獎金計算引擎 (Name Match)</h2>
                        <p className="text-xs text-slate-500">Assistant Bonus Engine</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-center xl:justify-end">
                    <div className="w-full sm:w-auto min-w-[160px]">
                        <select 
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 font-bold text-slate-700 bg-white outline-none focus:ring-2 focus:ring-purple-500"
                            value={selectedClinicId}
                            onChange={e => setSelectedClinicId(e.target.value)}
                        >
                            {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {/* Rate Settings Group */}
                    <div className="flex flex-wrap gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-1 border-r border-slate-200 pr-2">
                            <Globe size={14} className="text-slate-400" />
                            <span className="text-[10px] font-bold text-slate-500">全域設定</span>
                        </div>
                        <div className="flex items-center gap-1" title="自費獎金比率">
                            <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">自費%</span>
                            <input 
                                type="number" min="0" max="100" step="0.1"
                                className="w-10 border rounded px-1 py-0.5 text-center font-bold text-indigo-600 text-sm outline-none focus:border-indigo-500"
                                value={selfPayRate}
                                onChange={e => setSelfPayRate(Number(e.target.value))}
                            />
                        </div>
                        <div className="flex items-center gap-1" title="物販獎金比率">
                            <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">物販%</span>
                            <input 
                                type="number" min="0" max="100" step="0.5"
                                className="w-10 border rounded px-1 py-0.5 text-center font-bold text-amber-600 text-sm outline-none focus:border-amber-500"
                                value={retailRate}
                                onChange={e => setRetailRate(Number(e.target.value))}
                            />
                        </div>
                        <div className="flex items-center gap-1" title="團體公積金提撥率">
                            <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">公積金%</span>
                            <input 
                                type="number" min="0" max="100" step="5"
                                className="w-10 border rounded px-1 py-0.5 text-center font-bold text-purple-600 text-sm outline-none focus:border-purple-500"
                                value={poolRate}
                                onChange={e => setPoolRate(Number(e.target.value))}
                            />
                        </div>
                        <button 
                            onClick={handleSaveSettings}
                            disabled={isSavingSettings}
                            className="ml-1 p-1.5 bg-white border border-slate-300 rounded text-slate-500 hover:text-emerald-600 hover:border-emerald-300 transition-colors shadow-sm"
                            title="儲存為診所全域設定"
                        >
                            {isSavingSettings ? <Loader2 size={14} className="animate-spin"/> : <Save size={14} />}
                        </button>
                    </div>

                    <input 
                        type="month" 
                        className="border border-slate-300 rounded-lg px-3 py-2 font-bold text-slate-700 bg-white outline-none focus:ring-2 focus:ring-purple-500"
                        value={selectedMonth}
                        onChange={e => setSelectedMonth(e.target.value)}
                    />

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
                selfPayRate={selfPayRate}
                retailRate={retailRate}
            />
        </div>
    );
};
