import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Consultant, DailySchedule, AccountingRow } from '../types';
import { 
    getStaffList, loadAppData, loadDailyAccounting, hydrateRow, getBonusSettings, getYearlySickLeaveCount, getMonthlyScheduleStats 
} from '../services/firebase';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from '../components/ClinicSelector';
import { 
    Calculator, DollarSign, Calendar, Loader2, FileSpreadsheet, 
    AlertCircle, Clock, Trophy, Umbrella, Info
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface Props {
    clinics: Clinic[];
    userRole?: string;
}

interface SalaryRow {
    consultant: Consultant;
    baseSalary: number;
    allowance: number;
    totalBase: number;
    dailyRate: number;
    
    // Leaves & Late
    leaves: {
        personalDays: number; // 事假
        sickDays: number;     // 病假
        specialDays: number;  // 特休/公/婚/喪/產
        lateCount: number;    // 遲到次數
        ytdSickDays: number;  // 年度累計病假 (不含本月)
        details: string;      // Display string
    };
    leaveDeduction: number;
    
    // Attendance Bonus
    fullAttendanceBonus: number;
    bonusDisqualifiedReason: string; 
    
    // Overtime
    sundayOTDays: number;
    sundayOTPay: number;
    regularOTMins: number; // Input
    regularOTPay: number;
    
    // Performance
    performanceBonus: number;
    
    // Adjustments
    insurance: number; // Input
    adjustment: number; // Input
    
    // Final
    netPay: number;
}

export const AssistantSalary: React.FC<Props> = ({ clinics }) => {
    const { selectedClinicId, selectedClinic } = useClinic();
    
    // Global Settings
    const [currentMonth, setCurrentMonth] = useState<string>(new Date().toISOString().slice(0, 7));
    const [attendanceBonusBase, setAttendanceBonusBase] = useState<number>(3000);
    const [otRate, setOtRate] = useState<number>(3.5); // Per Minute
    
    // Data State
    const [salaryData, setSalaryData] = useState<SalaryRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // Input States (Map by consultant ID)
    const [regularOTInputs, setRegularOTInputs] = useState<Record<string, number>>({});
    const [insuranceInputs, setInsuranceInputs] = useState<Record<string, number>>({});
    const [adjustmentInputs, setAdjustmentInputs] = useState<Record<string, number>>({});

    useEffect(() => {
        if (selectedClinicId && currentMonth) {
            calculateSalary();
        }
    }, [selectedClinicId, currentMonth]);

    const fetchPerformanceBonus = async (consultants: Consultant[]) => {
        const [year, month] = currentMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        
        const dailyPromises = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            dailyPromises.push(loadDailyAccounting(selectedClinicId, dateStr));
        }
        const dailyRecords = await Promise.all(dailyPromises);
        
        const allRows: AccountingRow[] = [];
        dailyRecords.forEach(rec => {
            if (rec && rec.rows) {
                rec.rows.forEach(r => allRows.push(hydrateRow(r)));
            }
        });

        const poolSettings = await getBonusSettings(selectedClinicId, currentMonth);
        const poolRate = poolSettings?.poolRate ?? 30;

        let poolTotal = 0;
        let eligibleCount = 0;

        const bonusMap: Record<string, { base: number, contribution: number, keep: number, role: string }> = {};

        consultants.forEach(c => {
            let selfPayTotal = 0;
            let retailTotal = 0;
            const staffName = (c.name || '').trim();

            allRows.forEach(row => {
                const t = row.treatments;
                const r = row.retail;
                const sp = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + 
                           (t.sov || 0) + (t.perio || 0) + (t.whitening || 0) + 
                           (t.inv || 0) + (t.otherSelfPay || 0);
                if (sp > 0 && (t.consultant === c.id || t.consultant === staffName)) selfPayTotal += sp;

                const ret = (r.products || 0) + (r.diyWhitening || 0);
                const ownerId = r.staff || t.consultant;
                if (ret > 0 && (ownerId === c.id || ownerId === staffName)) retailTotal += ret;
            });

            const baseBonus = Math.round((selfPayTotal * 0.01) + (retailTotal * 0.1));
            const isConsultant = c.role === 'consultant';
            
            let contribution = 0;
            if (isConsultant) {
                if (baseBonus > 0) contribution = Math.round(baseBonus * (poolRate / 100));
                eligibleCount++;
            }

            poolTotal += contribution;
            bonusMap[c.id] = {
                base: baseBonus,
                contribution,
                keep: baseBonus - contribution,
                role: c.role || 'consultant'
            };
        });

        const share = eligibleCount > 0 ? Math.round(poolTotal / eligibleCount) : 0;
        
        const finalBonusMap: Record<string, number> = {};
        consultants.forEach(c => {
            const data = bonusMap[c.id];
            const isEligible = data.role === 'consultant';
            finalBonusMap[c.id] = (data?.keep || 0) + (isEligible ? share : 0);
        });

        return finalBonusMap;
    };

    const calculateSalary = async () => {
        setIsLoading(true);
        try {
            const staffList = await getStaffList(selectedClinicId);
            const targetStaff = staffList.filter(c => c.role !== 'part_time');

            const monthStats = await getMonthlyScheduleStats(selectedClinicId, currentMonth);
            const bonusMap = await fetchPerformanceBonus(targetStaff);
            const [y, m] = currentMonth.split('-').map(Number);

            const newRows: SalaryRow[] = await Promise.all(targetStaff.map(async (staff) => {
                const baseSalary = staff.baseSalary || 0;
                const allowance = staff.allowance || 0;
                const totalBase = baseSalary + allowance;
                const dailyRate = Math.round(totalBase / 30);

                const s = monthStats[staff.id] || { personalLeave: 0, sickLeave: 0, sundayOT: 0, lateCount: 0, specialLeave: 0 };
                
                const personalDays = s.personalLeave;
                const sickDays = s.sickLeave;
                const specialDays = s.specialLeave;
                const lateCount = s.lateCount;
                const sundayOTDays = s.sundayOT;

                const ytdSickDays = await getYearlySickLeaveCount(selectedClinicId, staff.id, y, m);

                // --- Full Attendance Bonus Logic (Strict Rule Update) ---
                let bonus = attendanceBonusBase;
                let disqualifiedReason = '';

                // NEW: Strict Rule - Disqualify if any Late OR any Personal Leave
                if (lateCount > 0 || personalDays > 0) {
                    bonus = 0;
                    const reasons = [];
                    if (lateCount > 0) reasons.push('遲到');
                    if (personalDays > 0) reasons.push('事假');
                    disqualifiedReason = reasons.join('/');
                } else if (sickDays > 0) {
                    // Sick Leave: Proportional deduction only after 10-day buffer
                    const remainingBuffer = Math.max(0, 10 - ytdSickDays);
                    const deductibleSickDays = Math.max(0, sickDays - remainingBuffer);
                    bonus -= (attendanceBonusBase / 30) * deductibleSickDays;
                }
                
                const finalFullAttendanceBonus = Math.max(0, Math.round(bonus));

                // --- Standard Salary Logic ---
                const leaveDeduction = Math.round((personalDays * dailyRate) + (sickDays * dailyRate * 0.5));
                const sundayOTPay = Math.round(dailyRate * sundayOTDays);
                const regularOTMins = regularOTInputs[staff.id] || 0;
                const regularOTPay = Math.round(regularOTMins * otRate);
                
                const insurance = insuranceInputs[staff.id] !== undefined ? insuranceInputs[staff.id] : (staff.monthlyInsuranceCost || 0);
                const adjustment = adjustmentInputs[staff.id] || 0;
                const performanceBonus = bonusMap[staff.id] || 0;

                const netPay = totalBase - leaveDeduction + finalFullAttendanceBonus + sundayOTPay + regularOTPay + performanceBonus - insurance + adjustment;

                const details = [];
                if (personalDays > 0) details.push(`事:${personalDays}`);
                if (sickDays > 0) details.push(`病:${sickDays} (YTD:${ytdSickDays + sickDays})`);
                if (specialDays > 0) details.push(`特:${specialDays}`);
                if (lateCount > 0) details.push(`遲:${lateCount}`);
                const detailStr = details.length > 0 ? details.join(' / ') : '全勤';

                return {
                    consultant: staff,
                    baseSalary, allowance, totalBase, dailyRate,
                    leaves: { personalDays, sickDays, specialDays, lateCount, ytdSickDays, details: detailStr },
                    leaveDeduction,
                    fullAttendanceBonus: finalFullAttendanceBonus,
                    bonusDisqualifiedReason: disqualifiedReason,
                    sundayOTDays, sundayOTPay,
                    regularOTMins, regularOTPay,
                    performanceBonus, insurance, adjustment, netPay
                };
            }));

            setSalaryData(newRows);
        } catch (e) {
            console.error(e);
            alert("薪資計算失敗，請檢查網路連線");
        } finally {
            setIsLoading(false);
        }
    };

    const updateRowState = (staffId: string, updates: Partial<SalaryRow>) => {
        setSalaryData(prev => prev.map(row => {
            if (row.consultant.id !== staffId) return row;
            const newRow = { ...row, ...updates };
            newRow.netPay = newRow.totalBase - newRow.leaveDeduction + newRow.fullAttendanceBonus + newRow.sundayOTPay + newRow.regularOTPay + newRow.performanceBonus - newRow.insurance + newRow.adjustment;
            return newRow;
        }));
    };

    const handleRegularOTChange = (id: string, mins: string) => {
        const val = Number(mins) || 0;
        setRegularOTInputs(prev => ({ ...prev, [id]: val }));
        const row = salaryData.find(r => r.consultant.id === id);
        if (row) {
            const regularOTPay = Math.round(val * otRate);
            updateRowState(id, { regularOTMins: val, regularOTPay });
        }
    };

    const handleInsuranceChange = (id: string, amount: string) => {
        const val = Number(amount) || 0;
        setInsuranceInputs(prev => ({ ...prev, [id]: val }));
        updateRowState(id, { insurance: val });
    };

    const handleAdjustmentChange = (id: string, amount: string) => {
        const val = Number(amount) || 0;
        setAdjustmentInputs(prev => ({ ...prev, [id]: val }));
        updateRowState(id, { adjustment: val });
    };

    const handleExportExcel = () => {
        if (salaryData.length === 0) return;
        const wb = XLSX.utils.book_new();
        const data = salaryData.map(row => ({
            '姓名': row.consultant.name,
            '職位': row.consultant.role,
            '本薪': row.baseSalary,
            '職務加給': row.allowance,
            '薪資基數': row.totalBase,
            '考勤紀錄': row.leaves.details,
            '請假扣款': row.leaveDeduction,
            '全勤獎金': row.fullAttendanceBonus + (row.bonusDisqualifiedReason ? ` (${row.bonusDisqualifiedReason})` : ''),
            '週日加班天數': row.sundayOTDays,
            '週日加班費': row.sundayOTPay,
            '平日加班分鐘': row.regularOTMins,
            '平日加班費': row.regularOTPay,
            '績效獎金': row.performanceBonus,
            '勞健保自付': row.insurance,
            '其他調整': row.adjustment,
            '實領薪資': row.netPay
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Salary");
        XLSX.writeFile(wb, `${selectedClinic?.name}_助理薪資_${currentMonth}.xlsx`);
    };

    return (
        <div className="space-y-6 pb-12">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col gap-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <Calculator className="text-teal-600" /> 助理薪資結算
                        </h2>
                        <p className="text-slate-500 text-sm">自動同步排班系統數據，包含「半日假」與「遲到」統計。</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={calculateSalary} disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50">
                            {isLoading ? <Loader2 size={18} className="animate-spin"/> : <Calculator size={18} />} 同步數據並計算
                        </button>
                        <button onClick={handleExportExcel} disabled={salaryData.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50">
                            <FileSpreadsheet size={18} /> 匯出 Excel
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <ClinicSelector className="border p-2 rounded bg-white w-full" />
                    <input type="month" className="w-full border p-2 rounded bg-white" value={currentMonth} onChange={e => setCurrentMonth(e.target.value)} />
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">全勤基數 $</label>
                        <input type="number" className="w-full border p-2 rounded bg-white" value={attendanceBonusBase} onChange={e => setAttendanceBonusBase(Number(e.target.value))} />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">加班/分 $</label>
                        <input type="number" step="0.1" className="w-full border p-2 rounded bg-white" value={otRate} onChange={e => setOtRate(Number(e.target.value))} />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10">姓名/職稱</th>
                                <th className="px-4 py-3 text-right">薪資基數</th>
                                <th className="px-4 py-3 min-w-[220px]">考勤統計</th>
                                <th className="px-4 py-3 text-right text-emerald-600">全勤獎金</th>
                                <th className="px-4 py-3 text-right text-amber-600">週日加班</th>
                                <th className="px-4 py-3 text-right min-w-[120px]">平日加班 (分)</th>
                                <th className="px-4 py-3 text-right text-purple-600">績效獎金</th>
                                <th className="px-4 py-3 text-right min-w-[100px]">勞健保 (扣)</th>
                                <th className="px-4 py-3 text-right min-w-[100px]">其他調整</th>
                                <th className="px-4 py-3 text-right font-black bg-indigo-50 text-indigo-700 border-l border-indigo-100">實領薪資</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {salaryData.map(row => (
                                <tr key={row.consultant.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                        <div className="font-bold text-slate-700">{row.consultant.name}</div>
                                        <div className="text-[10px] text-slate-400 uppercase">{row.consultant.role}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums">
                                        <div className="font-bold text-slate-700">${row.totalBase.toLocaleString()}</div>
                                        <div className="text-[10px] text-slate-400">日薪: ${row.dailyRate}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-xs font-bold text-slate-600 mb-1">
                                            {row.leaves.details}
                                        </div>
                                        {row.leaveDeduction > 0 && (
                                            <div className="text-[10px] text-rose-500 font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 inline-block">
                                                扣薪: -${row.leaveDeduction.toLocaleString()}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className={`font-black tabular-nums ${row.fullAttendanceBonus > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                            {row.fullAttendanceBonus > 0 ? `+$${row.fullAttendanceBonus.toLocaleString()}` : '0'}
                                            {row.bonusDisqualifiedReason && <span className="text-[10px] ml-1 block opacity-70">({row.bonusDisqualifiedReason})</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="font-bold text-amber-600 tabular-nums">+${row.sundayOTPay.toLocaleString()}</div>
                                        {row.sundayOTDays > 0 && <div className="text-[10px] text-amber-400">{row.sundayOTDays} 天</div>}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-1 mb-1">
                                            <input type="number" className="w-16 border rounded px-1 py-0.5 text-right text-sm bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="0" value={row.regularOTMins || ''} onChange={e => handleRegularOTChange(row.consultant.id, e.target.value)} />
                                            <span className="text-[10px] text-slate-400">分</span>
                                        </div>
                                        <div className="text-xs font-bold text-slate-600">+${row.regularOTPay.toLocaleString()}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-purple-600 tabular-nums">
                                        +${row.performanceBonus.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input type="number" className="w-20 border rounded px-1 py-0.5 text-right text-sm text-rose-600 font-bold bg-rose-50/50 focus:bg-white focus:ring-1 focus:ring-rose-500 outline-none mb-1" value={row.insurance} onChange={e => handleInsuranceChange(row.consultant.id, e.target.value)} />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input type="number" className="w-20 border rounded px-1 py-0.5 text-right text-sm bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="0" value={row.adjustment || ''} onChange={e => handleAdjustmentChange(row.consultant.id, e.target.value)} />
                                    </td>
                                    <td className="px-4 py-3 text-right font-black text-lg text-indigo-700 bg-indigo-50/30 border-l border-indigo-100 tabular-nums">
                                        ${row.netPay.toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                            {salaryData.length === 0 && (
                                <tr><td colSpan={10} className="p-12 text-center text-slate-400 font-bold">尚未同步數據。請選擇月份並點擊上方按鈕。</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div className="bg-slate-100 p-4 rounded-lg border border-slate-200 flex items-start gap-3">
                <Info size={18} className="text-slate-500 mt-0.5" />
                <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-bold">薪資計算規則說明 (2026 Edition):</p>
                    <ul className="list-disc ml-4 space-y-0.5">
                        <li><strong>全勤獎金:</strong> 若該月有「遲到」或「事假」紀錄，全勤獎金立即歸零。</li>
                        <li><strong>事假扣款:</strong> 薪資基數依 30 天比例扣薪。</li>
                        <li><strong>病假扣款:</strong> 薪資基數扣除半薪；全勤獎金每年享有 10 天緩衝，超過 10 天後開始按天數扣除。</li>
                        <li><strong>週日加班:</strong> 依「薪資基數/30」計算每日加班費，半日班則減半計算。</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};