
import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Consultant, DailySchedule, AccountingRow } from '../types';
import { 
    getStaffList, loadAppData, loadDailyAccounting, hydrateRow, getBonusSettings 
} from '../services/firebase';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from '../components/ClinicSelector';
import { 
    Calculator, DollarSign, Calendar, Loader2, FileSpreadsheet, 
    AlertCircle, Save, Clock, Trophy, Umbrella
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
    
    // Leaves
    leaves: {
        personalDays: number; // 事假
        sickDays: number;     // 病假
        specialDays: number;  // 特休/公/婚/喪/產
        details: string;      // Display string
    };
    leaveDeduction: number;
    
    // Attendance Bonus
    fullAttendanceBonus: number;
    
    // Overtime
    sundayOTDays: number;
    sundayOTPay: number;
    regularOTMins: number; // Input
    regularOTPay: number;
    
    // Performance (From Phase 3 Logic)
    performanceBonus: number;
    
    // Adjustments
    insurance: number; // Input
    adjustment: number; // Input
    
    // Final
    netPay: number;
}

const SPECIAL_LEAVES = ['特休', '公假', '婚假', '喪假', '產假'];

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
    }, [selectedClinicId, currentMonth]); // Recalc on context change

    // Re-calculate when global settings change (debounced or explicit button? Explicit is safer for performance, but Effect is reactive)
    // We'll use a "Recalculate" button for heavy data fetching, but effects for local math.
    // For now, trigger full calc.

    const fetchPerformanceBonus = async (consultants: Consultant[], schedules: DailySchedule[]) => {
        // 1. Load Daily Accounting for the whole month
        const [year, month] = currentMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        
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
                rec.rows.forEach(r => allRows.push(hydrateRow(r)));
            }
        });

        // 3. Get Pool Settings
        const poolSettings = await getBonusSettings(selectedClinicId, currentMonth);
        const poolRate = poolSettings?.poolRate ?? 30; // Default 30%

        // 4. Calculate Base Bonus per Consultant
        let poolTotal = 0;
        let eligibleCount = 0;

        const bonusMap: Record<string, { base: number, contribution: number, keep: number, role: string }> = {};

        consultants.forEach(c => {
            let selfPayTotal = 0;
            let retailTotal = 0;

            allRows.forEach(row => {
                const t = row.treatments;
                const sp = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + 
                           (t.sov || 0) + (t.perio || 0) + (t.whitening || 0) + 
                           (t.inv || 0) + (t.otherSelfPay || 0);
                if (sp > 0 && t.consultant === c.id) selfPayTotal += sp;

                const r = row.retail;
                const ret = (r.products || 0) + (r.diyWhitening || 0);
                const ownerId = r.staff || t.consultant;
                if (ret > 0 && ownerId === c.id) retailTotal += ret;
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

        // 5. Distribute Pool
        const share = eligibleCount > 0 ? Math.round(poolTotal / eligibleCount) : 0;
        
        const finalBonusMap: Record<string, number> = {};
        consultants.forEach(c => {
            const data = bonusMap[c.id];
            const isEligible = data.role === 'consultant';
            finalBonusMap[c.id] = data.keep + (isEligible ? share : 0);
        });

        return finalBonusMap;
    };

    const calculateSalary = async () => {
        setIsLoading(true);
        try {
            // A. Fetch Basic Data
            const appData = await loadAppData();
            const staffList = await getStaffList(selectedClinicId);
            
            // Filter Full-Time Only (Consultant, Assistant, Trainee)
            // Part-time is handled in separate logic usually, but here requested for "Assistant Salary".
            // We'll include everyone but logic might differ. Prompt focused on "Leave Logic" which applies to full-time.
            // Let's include Part-time but they usually don't get monthly salary base? 
            // For now, include all to be safe, filter visually if needed.
            // Assuming this tool is for Monthly Salary Staff.
            const targetStaff = staffList.filter(c => c.role !== 'part_time');

            // B. Schedules
            const monthPrefix = currentMonth;
            const relevantSchedules = appData.schedules.filter(s => 
                s.clinicId === selectedClinicId && s.date.startsWith(monthPrefix)
            );

            // C. Performance Bonus
            const bonusMap = await fetchPerformanceBonus(targetStaff, relevantSchedules);

            // D. Build Rows
            const newRows: SalaryRow[] = targetStaff.map(staff => {
                const baseSalary = staff.baseSalary || 0;
                const allowance = staff.allowance || 0;
                const totalBase = baseSalary + allowance;
                const dailyRate = Math.round(totalBase / 30);

                // --- 1. Leave & Sunday Stats ---
                let personalDays = 0;
                let sickDays = 0;
                let specialDays = 0;
                let sundayOTDays = 0;

                relevantSchedules.forEach(s => {
                    const date = new Date(s.date);
                    const isSunday = date.getDay() === 0;
                    const config = s.staffConfiguration;
                    
                    if (config) {
                        // Check Leave
                        const leave = config.leave?.find(l => l.id === staff.id);
                        if (leave) {
                            const duration = leave.type.includes('(半)') ? 0.5 : 1.0;
                            const typeName = leave.type.replace(/\(.*\)/, '');
                            
                            if (typeName === '事假') personalDays += duration;
                            else if (typeName === '病假') sickDays += duration;
                            else if (SPECIAL_LEAVES.includes(typeName)) specialDays += duration;
                            else {
                                // Default fallback to personal if unknown type
                                personalDays += duration; 
                            }
                        }

                        // Check Sunday OT
                        if (isSunday) {
                            // Explicit Overtime
                            const ot = config.overtime?.find(o => o.id === staff.id);
                            if (ot) {
                                sundayOTDays += ot.type.includes('(半)') ? 0.5 : 1.0;
                            } else {
                                // Implicit: Not Off, Not Leave => Full OT (Legacy support)
                                const isOff = config.off?.includes(staff.id);
                                if (!isOff && !leave) {
                                    sundayOTDays += 1.0;
                                }
                            }
                        }
                    }
                });

                // --- 2. Leave Deduction ---
                const leaveDeduction = Math.round((personalDays * dailyRate) + (sickDays * dailyRate * 0.5));

                // --- 3. Attendance Bonus ---
                // Condition: No Personal, No Sick. Special leaves allowed.
                const fullAttendanceBonus = (personalDays + sickDays === 0) ? attendanceBonusBase : 0;

                // --- 4. Overtime Pay ---
                const sundayOTPay = Math.round(dailyRate * sundayOTDays);
                
                // Get Manual Inputs
                const regularOTMins = regularOTInputs[staff.id] || 0;
                const regularOTPay = Math.round(regularOTMins * otRate);
                
                const insurance = insuranceInputs[staff.id] !== undefined 
                    ? insuranceInputs[staff.id] 
                    : (staff.monthlyInsuranceCost || 0); // Default from profile
                
                const adjustment = adjustmentInputs[staff.id] || 0;

                const performanceBonus = bonusMap[staff.id] || 0;

                // --- 5. Net Pay ---
                const netPay = totalBase 
                    - leaveDeduction 
                    + fullAttendanceBonus 
                    + sundayOTPay 
                    + regularOTPay 
                    + performanceBonus 
                    - insurance 
                    + adjustment;

                // Build Detail String
                const details = [];
                if (personalDays > 0) details.push(`事:${personalDays}`);
                if (sickDays > 0) details.push(`病:${sickDays}`);
                if (specialDays > 0) details.push(`特:${specialDays}`);
                const detailStr = details.length > 0 ? details.join(' / ') : '全勤';

                return {
                    consultant: staff,
                    baseSalary,
                    allowance,
                    totalBase,
                    dailyRate,
                    leaves: { personalDays, sickDays, specialDays, details: detailStr },
                    leaveDeduction,
                    fullAttendanceBonus,
                    sundayOTDays,
                    sundayOTPay,
                    regularOTMins,
                    regularOTPay,
                    performanceBonus,
                    insurance,
                    adjustment,
                    netPay
                };
            });

            setSalaryData(newRows);

        } catch (e) {
            console.error(e);
            alert("計算失敗");
        } finally {
            setIsLoading(false);
        }
    };

    // --- Input Handlers ---
    // Note: Updating these inputs triggers a re-render, but does NOT automatically re-calculate `netPay` 
    // because `netPay` is derived in `calculateSalary`. 
    // We need to either re-run calculation or use a memoized approach. 
    // Given the structure, let's update local state AND update the `salaryData` state immediately for responsiveness.

    const updateRowState = (staffId: string, updates: Partial<SalaryRow>) => {
        setSalaryData(prev => prev.map(row => {
            if (row.consultant.id !== staffId) return row;
            
            const newRow = { ...row, ...updates };
            // Recalculate Net
            newRow.netPay = newRow.totalBase 
                - newRow.leaveDeduction 
                + newRow.fullAttendanceBonus 
                + newRow.sundayOTPay 
                + newRow.regularOTPay 
                + newRow.performanceBonus 
                - newRow.insurance 
                + newRow.adjustment;
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
            '全勤獎金': row.fullAttendanceBonus,
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
            {/* Header / Global Settings */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col gap-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <Calculator className="text-teal-600" /> 助理薪資結算
                        </h2>
                        <p className="text-slate-500 text-sm">自動整合排班考勤、績效獎金與加班費計算。</p>
                    </div>
                    <div className="flex gap-2">
                        <button 
                            onClick={calculateSalary}
                            disabled={isLoading}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50"
                        >
                            {isLoading ? <Loader2 size={18} className="animate-spin"/> : <Calculator size={18} />}
                            重新計算
                        </button>
                        <button 
                            onClick={handleExportExcel}
                            disabled={salaryData.length === 0}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50"
                        >
                            <FileSpreadsheet size={18} /> 匯出 Excel
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <ClinicSelector className="border p-2 rounded bg-white w-full" />
                    <input 
                        type="month" 
                        className="w-full border p-2 rounded bg-white"
                        value={currentMonth}
                        onChange={e => setCurrentMonth(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">全勤獎金 $</label>
                        <input 
                            type="number" 
                            className="w-full border p-2 rounded bg-white"
                            value={attendanceBonusBase}
                            onChange={e => setAttendanceBonusBase(Number(e.target.value))}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">平日加班費/分 $</label>
                        <input 
                            type="number" step="0.1"
                            className="w-full border p-2 rounded bg-white"
                            value={otRate}
                            onChange={e => setOtRate(Number(e.target.value))}
                        />
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10">姓名/職稱</th>
                                <th className="px-4 py-3 text-right">薪資基數 (Base)</th>
                                <th className="px-4 py-3 min-w-[140px]">考勤 (Attendance)</th>
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
                                        <div className="text-[10px] text-slate-400">{row.consultant.role}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums">
                                        <div className="font-bold text-slate-700">${row.totalBase.toLocaleString()}</div>
                                        <div className="text-[10px] text-slate-400">日薪: ${row.dailyRate}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-xs font-bold text-slate-600 mb-1">{row.leaves.details}</div>
                                        {row.leaveDeduction > 0 && (
                                            <div className="text-xs text-rose-500 font-bold bg-rose-50 px-1 rounded inline-block">
                                                扣: -${row.leaveDeduction.toLocaleString()}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-emerald-600 tabular-nums">
                                        {row.fullAttendanceBonus > 0 ? `+$${row.fullAttendanceBonus}` : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="font-bold text-amber-600 tabular-nums">+${row.sundayOTPay.toLocaleString()}</div>
                                        {row.sundayOTDays > 0 && <div className="text-[10px] text-amber-400">{row.sundayOTDays} 天</div>}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-1 mb-1">
                                            <input 
                                                type="number" 
                                                className="w-16 border rounded px-1 py-0.5 text-right text-sm bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                                placeholder="0"
                                                value={row.regularOTMins || ''}
                                                onChange={e => handleRegularOTChange(row.consultant.id, e.target.value)}
                                            />
                                            <span className="text-[10px] text-slate-400">分</span>
                                        </div>
                                        <div className="text-xs font-bold text-slate-600">+${row.regularOTPay.toLocaleString()}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-purple-600 tabular-nums">
                                        +${row.performanceBonus.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input 
                                            type="number" 
                                            className="w-20 border rounded px-1 py-0.5 text-right text-sm text-rose-600 font-bold bg-rose-50/50 focus:bg-white focus:ring-1 focus:ring-rose-500 outline-none mb-1"
                                            value={row.insurance}
                                            onChange={e => handleInsuranceChange(row.consultant.id, e.target.value)}
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input 
                                            type="number" 
                                            className="w-20 border rounded px-1 py-0.5 text-right text-sm bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                            placeholder="0"
                                            value={row.adjustment || ''}
                                            onChange={e => handleAdjustmentChange(row.consultant.id, e.target.value)}
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right font-black text-lg text-indigo-700 bg-indigo-50/30 border-l border-indigo-100 tabular-nums">
                                        ${row.netPay.toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                            {salaryData.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="p-12 text-center text-slate-400">
                                        請點擊「重新計算」以產生報表
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
