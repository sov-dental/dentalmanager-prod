
import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Consultant, DailySchedule, AccountingRow, SalaryRecord } from '../types';
import { 
    getStaffList, loadDailyAccounting, hydrateRow, getBonusSettings, getYearlySickLeaveCount, getMonthlyScheduleStats, getMonthlyMealStats, calculateMonthlyBonus, getSalaryRecords, saveSalaryRecord, saveBonusSettings
} from '../services/firebase';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from '../components/ClinicSelector';
import { 
    Calculator, DollarSign, Calendar, Loader2, FileSpreadsheet, 
    AlertCircle, Clock, Trophy, Umbrella, Info, Utensils, Save, Printer, Briefcase
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
    
    // Pro-rata
    workDays?: number;
    isProRata?: boolean;
    proRataNote?: string;

    // Part-time
    isPartTime?: boolean;
    hourlyRate?: number;
    totalHours?: number; // Input for Part-time

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
    holidayBonus: number; // NEW: Holiday Bonus
    
    // Adjustments
    mealDeduction: number; // NEW: Auto-deducted from Meal Fund
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
    const [globalHolidayBonus, setGlobalHolidayBonus] = useState<number>(0); // NEW: Global Holiday Bonus Input
    const [applyHolidayBonus, setApplyHolidayBonus] = useState(false); // NEW: Checkbox State
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    
    // Data State
    const [salaryData, setSalaryData] = useState<SalaryRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // Input States (Map by consultant ID)
    const [regularOTInputs, setRegularOTInputs] = useState<Record<string, number>>({});
    const [partTimeHourInputs, setPartTimeHourInputs] = useState<Record<string, number>>({});
    const [insuranceInputs, setInsuranceInputs] = useState<Record<string, number>>({});
    const [adjustmentInputs, setAdjustmentInputs] = useState<Record<string, number>>({});
    const [holidayBonusInputs, setHolidayBonusInputs] = useState<Record<string, number>>({}); // NEW: Holiday Bonus Inputs

    // Load Settings
    useEffect(() => {
        if (selectedClinicId) {
            const fetchSettings = async () => {
                const settings = await getBonusSettings(selectedClinicId);
                setAttendanceBonusBase(Number(settings.fullAttendanceBonus ?? 3000));
                setOtRate(Number(settings.overtimeRate ?? 3.5));
                setGlobalHolidayBonus(Number(settings.holidayBonus ?? 0));
            };
            fetchSettings();
        }
    }, [selectedClinicId]);

    // Save Settings Handler
    const handleSaveGlobalSettings = async () => {
        if (!selectedClinicId) return;
        setIsSavingSettings(true);
        try {
            await saveBonusSettings(selectedClinicId, {
                fullAttendanceBonus: attendanceBonusBase,
                overtimeRate: otRate,
                holidayBonus: globalHolidayBonus
            });
            // Recalculate to ensure consistency?
            if (salaryData.length > 0) calculateSalary();
            alert("參數已儲存 (Global Settings Saved)");
        } catch(e) {
            console.error(e);
            alert("儲存失敗");
        } finally {
            setIsSavingSettings(false);
        }
    };

    // NEW: Manual Save All Handler
    const handleSaveAll = async () => {
        if (!selectedClinicId || salaryData.length === 0) return;
        setIsLoading(true);
        try {
            const updates = salaryData.map(async (row) => {
                const staffId = row.consultant.id;
                const id = `${selectedClinicId}_${currentMonth}_${staffId}`;
                
                // Construct record from current row state
                const record: SalaryRecord = {
                    id,
                    clinicId: selectedClinicId,
                    yearMonth: currentMonth,
                    staffId,
                    regularOvertimeMinutes: row.regularOTMins,
                    partTimeHours: row.partTimeHours,
                    laborHealthInsurance: row.insurance,
                    otherAdjustment: row.adjustment,
                    holidayBonus: row.holidayBonus
                };
                await saveSalaryRecord(record);
            });

            await Promise.all(updates);
            alert("✅ 所有薪資資料已儲存！");
        } catch (e) {
            console.error("Save All Failed:", e);
            alert("儲存失敗");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (selectedClinicId && currentMonth) {
            calculateSalary();
        }
    }, [selectedClinicId, currentMonth]);

    const calculateSalary = async () => {
        setIsLoading(true);
        try {
            const staffList = await getStaffList(selectedClinicId);
            // We now process ALL staff, differentiating by role
            
            // 1. Fetch ALL data in parallel
            const [monthStats, bonusMap, mealStats, salaryRecords] = await Promise.all([
                getMonthlyScheduleStats(selectedClinicId, currentMonth),
                calculateMonthlyBonus(selectedClinicId, currentMonth), 
                getMonthlyMealStats(selectedClinicId, currentMonth),
                getSalaryRecords(selectedClinicId, currentMonth)
            ]);

            // 2. Populate input maps from persisted records
            const recordMap = new Map(salaryRecords.map(r => [r.staffId, r]));
            const newOTInputs: Record<string, number> = {};
            const newPTHourInputs: Record<string, number> = {};
            const newInsInputs: Record<string, number> = {};
            const newAdjInputs: Record<string, number> = {};
            const newHolidayBonusInputs: Record<string, number> = {};

            staffList.forEach(staff => {
                const rec = recordMap.get(staff.id);
                if (rec) {
                    if (rec.regularOvertimeMinutes !== undefined) newOTInputs[staff.id] = rec.regularOvertimeMinutes;
                    if (rec.partTimeHours !== undefined) newPTHourInputs[staff.id] = rec.partTimeHours;
                    if (rec.laborHealthInsurance !== undefined) newInsInputs[staff.id] = rec.laborHealthInsurance;
                    if (rec.otherAdjustment !== undefined) newAdjInputs[staff.id] = rec.otherAdjustment;
                    if (rec.holidayBonus !== undefined) newHolidayBonusInputs[staff.id] = rec.holidayBonus;
                }
            });

            // Update State for Controlled Inputs
            setRegularOTInputs(newOTInputs);
            setPartTimeHourInputs(newPTHourInputs);
            setInsuranceInputs(newInsInputs);
            setAdjustmentInputs(newAdjInputs);
            setHolidayBonusInputs(newHolidayBonusInputs);

            const [y, m] = currentMonth.split('-').map(Number);
            const daysInMonth = new Date(y, m, 0).getDate(); // Get actual days in month
            const monthStartDate = `${y}-${String(m).padStart(2, '0')}-01`;
            const monthEndDate = new Date(y, m, 0).toISOString().slice(0, 10); // YYYY-MM-DD

            const newRows: SalaryRow[] = await Promise.all(staffList.map(async (staff) => {
                // Filter out future staff
                if (staff.onboardDate && staff.onboardDate > monthEndDate) {
                    return null;
                }
                // Filter out resigned staff (if resigned before month start)
                if (staff.resignationDate && staff.resignationDate < monthStartDate) {
                    return null;
                }

                const isPartTime = staff.role === 'part_time';
                
                // Determine Holiday Bonus Logic
                // If checkbox is checked, apply global bonus to eligible staff (Full-Time)
                // Otherwise, use persisted value or 0
                let holidayBonus = newHolidayBonusInputs[staff.id] || 0;
                
                if (applyHolidayBonus && !isPartTime) {
                    holidayBonus = globalHolidayBonus;
                    // Update the input map immediately so it reflects in the UI
                    newHolidayBonusInputs[staff.id] = holidayBonus;
                }
                
                // --- Part-Time Logic ---
                if (isPartTime) {
                    const hourlyRate = staff.hourlyRate || 0;
                    const partTimeHours = newPTHourInputs[staff.id] || 0;
                    const totalBase = Math.round(partTimeHours * hourlyRate); // Base is calculated from hours
                    
                    const insurance = newInsInputs[staff.id] !== undefined ? newInsInputs[staff.id] : (staff.monthlyInsuranceCost || 0);
                    const adjustment = newAdjInputs[staff.id] || 0;
                    const mealDeduction = mealStats[staff.id] || 0;
                    
                    // Part-timers usually don't get these, but keeping 0 for type consistency
                    const netPay = totalBase - mealDeduction - insurance + adjustment + holidayBonus;

                    return {
                        consultant: staff,
                        baseSalary: 0, allowance: 0, totalBase, dailyRate: 0,
                        isProRata: false, workDays: 0,
                        isPartTime: true, hourlyRate, partTimeHours,
                        leaves: { personalDays: 0, sickDays: 0, specialDays: 0, lateCount: 0, ytdSickDays: 0, details: '' },
                        leaveDeduction: 0,
                        fullAttendanceBonus: 0, bonusDisqualifiedReason: '',
                        sundayOTDays: 0, sundayOTPay: 0,
                        regularOTMins: 0, regularOTPay: 0,
                        performanceBonus: 0, holidayBonus, mealDeduction, insurance, adjustment, netPay
                    };
                }

                // --- Full-Time Logic ---
                let baseSalary = staff.baseSalary || 0;
                let allowance = staff.allowance || 0;
                let isProRata = false;
                let workDays = 30; // Default calculation base
                let proRataNote = '';

                // Pro-rata Calculation
                const monthStart = new Date(y, m - 1, 1);
                const monthEnd = new Date(y, m, 0);
                
                let effectiveStart = monthStart;
                let effectiveEnd = monthEnd;
                let hasProRata = false;

                if (staff.onboardDate) {
                    const onboard = new Date(staff.onboardDate);
                    if (onboard > monthStart) {
                        effectiveStart = onboard;
                        hasProRata = true;
                    }
                }

                if (staff.resignationDate) {
                    const resign = new Date(staff.resignationDate);
                    if (resign < monthEnd) {
                        effectiveEnd = resign;
                        hasProRata = true;
                    }
                }

                if (hasProRata && effectiveStart <= effectiveEnd) {
                    isProRata = true;
                    // Calculate actual days inclusive
                    const diffTime = Math.abs(effectiveEnd.getTime() - effectiveStart.getTime());
                    const actualDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
                    workDays = actualDays;
                    
                    // Pro-rata Formula: (MonthlyBase / 30) * workDays
                    const dailyBase = (baseSalary + allowance) / 30;
                    baseSalary = Math.round((baseSalary / 30) * workDays);
                    allowance = Math.round((allowance / 30) * workDays);
                    proRataNote = `未滿月 (${workDays}天)`;
                }

                const totalBase = baseSalary + allowance;
                const dailyRate = Math.round(totalBase / (isProRata ? workDays : 30)); // Daily rate for deductions

                const s = monthStats[staff.id] || { personalLeave: 0, sickLeave: 0, sundayOT: 0, lateCount: 0, specialLeave: 0 };
                
                const personalDays = s.personalLeave;
                const sickDays = s.sickLeave;
                const specialDays = s.specialLeave;
                const lateCount = s.lateCount;
                const sundayOTDays = s.sundayOT;

                const ytdSickDays = await getYearlySickLeaveCount(selectedClinicId, staff.id, y, m);

                // --- Full Attendance Bonus Logic ---
                let bonus = attendanceBonusBase;
                let disqualifiedReason = '';

                if (isProRata) {
                    bonus = 0;
                    disqualifiedReason = '未滿月';
                } else if (lateCount > 0 || personalDays > 0) {
                    bonus = 0;
                    const reasons = [];
                    if (lateCount > 0) reasons.push('遲到');
                    if (personalDays > 0) reasons.push('事假');
                    disqualifiedReason = reasons.join('/');
                } else if (sickDays > 0) {
                    const remainingBuffer = Math.max(0, 10 - ytdSickDays);
                    const deductibleSickDays = Math.max(0, sickDays - remainingBuffer);
                    bonus -= (attendanceBonusBase / 30) * deductibleSickDays;
                }
                
                const finalFullAttendanceBonus = Math.max(0, Math.round(bonus));

                // --- Standard Salary Logic ---
                const leaveDeduction = Math.round((personalDays * dailyRate) + (sickDays * dailyRate * 0.5));
                const sundayOTPay = Math.round(dailyRate * sundayOTDays);
                
                const regularOTMins = newOTInputs[staff.id] || 0;
                const regularOTPay = Math.round(regularOTMins * otRate);
                
                const insurance = newInsInputs[staff.id] !== undefined ? newInsInputs[staff.id] : (staff.monthlyInsuranceCost || 0);
                const adjustment = newAdjInputs[staff.id] || 0;
                
                const performanceBonus = bonusMap[staff.id] || 0;
                const mealDeduction = mealStats[staff.id] || 0;

                const netPay = totalBase - leaveDeduction + finalFullAttendanceBonus + sundayOTPay + regularOTPay + performanceBonus + holidayBonus - mealDeduction - insurance + adjustment;

                const details = [];
                if (personalDays > 0) details.push(`事:${personalDays}`);
                if (sickDays > 0) details.push(`病:${sickDays} (YTD:${ytdSickDays + sickDays})`);
                if (specialDays > 0) details.push(`特:${specialDays}`);
                if (lateCount > 0) details.push(`遲:${lateCount}`);
                const detailStr = details.length > 0 ? details.join(' / ') : '全勤';

                return {
                    consultant: staff,
                    baseSalary, allowance, totalBase, dailyRate,
                    isProRata, workDays, proRataNote,
                    isPartTime: false, hourlyRate: 0, partTimeHours: 0,
                    leaves: { personalDays, sickDays, specialDays, lateCount, ytdSickDays, details: detailStr },
                    leaveDeduction,
                    fullAttendanceBonus: finalFullAttendanceBonus,
                    bonusDisqualifiedReason: disqualifiedReason,
                    sundayOTDays, sundayOTPay,
                    regularOTMins, regularOTPay,
                    performanceBonus, holidayBonus, mealDeduction, insurance, adjustment, netPay
                };
            }));
            
            // If applying bonus, update the input state to reflect the new values
            if (applyHolidayBonus) {
                setHolidayBonusInputs(newHolidayBonusInputs);
            }

            setSalaryData(newRows.filter((r): r is SalaryRow => r !== null));
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
            newRow.netPay = newRow.totalBase - newRow.leaveDeduction + newRow.fullAttendanceBonus + newRow.sundayOTPay + newRow.regularOTPay + newRow.performanceBonus + newRow.holidayBonus - newRow.mealDeduction - newRow.insurance + newRow.adjustment;
            return newRow;
        }));
    };

    // --- Persistence Helper ---
    const persistInput = async (staffId: string, field: keyof SalaryRecord, value: number) => {
        const id = `${selectedClinicId}_${currentMonth}_${staffId}`;
        const record: SalaryRecord = {
            id,
            clinicId: selectedClinicId,
            yearMonth: currentMonth,
            staffId,
            [field]: value
        };
        await saveSalaryRecord(record);
    };

    const handleRegularOTChange = (id: string, mins: string) => {
        const val = Number(mins) || 0;
        setRegularOTInputs(prev => ({ ...prev, [id]: val }));
        
        // Update UI Calculation Immediately
        const row = salaryData.find(r => r.consultant.id === id);
        if (row) {
            const regularOTPay = Math.round(val * otRate);
            updateRowState(id, { regularOTMins: val, regularOTPay });
        }
    };

    const handlePartTimeHoursChange = (id: string, hours: string) => {
        const val = Number(hours) || 0;
        setPartTimeHourInputs(prev => ({ ...prev, [id]: val }));

        // Update UI Calculation Immediately
        const row = salaryData.find(r => r.consultant.id === id);
        if (row && row.isPartTime) {
            const totalBase = Math.round(val * row.hourlyRate);
            updateRowState(id, { partTimeHours: val, totalBase });
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

    const handleHolidayBonusChange = (id: string, amount: string) => {
        const val = Number(amount) || 0;
        setHolidayBonusInputs(prev => ({ ...prev, [id]: val }));
        updateRowState(id, { holidayBonus: val });
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
            '代扣餐費': row.mealDeduction,
            '勞健保自付': row.insurance,
            '其他調整': row.adjustment,
            '實領薪資': row.netPay
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Salary");
        XLSX.writeFile(wb, `${selectedClinic?.name}_助理薪資_${currentMonth}.xlsx`);
    };

    const handlePrintSlips = () => {
        if (salaryData.length === 0) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert("請允許彈出視窗以進行列印");
            return;
        }

        const slipsHtml = salaryData.map(row => {
            const otherIncome = row.adjustment > 0 ? row.adjustment : 0;
            const otherDeduction = row.adjustment < 0 ? Math.abs(row.adjustment) : 0;
            
            let earningsHtml = '';
            let totalEarningsDisplay = 0;

            if (row.isPartTime) {
                // Part-Time Layout
                totalEarningsDisplay = row.totalBase + otherIncome;
                
                earningsHtml = `
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>時薪 (Hourly)</span><span style="font-weight: bold; font-family: monospace;">$${(row.hourlyRate || 0).toLocaleString()}</span></div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>總時數 (Hours)</span><span style="font-weight: bold; font-family: monospace;">${row.partTimeHours} hrs</span></div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>薪資總額 (Total)</span><span style="font-weight: bold; font-family: monospace;">$${row.totalBase.toLocaleString()}</span></div>
                    ${otherIncome > 0 ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>其他補貼</span><span style="font-weight: bold; font-family: monospace;">${otherIncome.toLocaleString()}</span></div>` : ''}
                `;
            } else {
                // Full-Time Layout
                totalEarningsDisplay = row.baseSalary + row.allowance + row.sundayOTPay + row.regularOTPay + row.performanceBonus + row.fullAttendanceBonus + otherIncome + row.holidayBonus;
                
                earningsHtml = `
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>基本薪資</span><span style="font-weight: bold; font-family: monospace;">${row.baseSalary > 0 ? row.baseSalary.toLocaleString() : '-'}</span></div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>職務津貼</span><span style="font-weight: bold; font-family: monospace;">${row.allowance > 0 ? row.allowance.toLocaleString() : '-'}</span></div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>全勤獎金</span><span style="font-weight: bold; font-family: monospace;">${row.fullAttendanceBonus > 0 ? row.fullAttendanceBonus.toLocaleString() : '-'}</span></div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>平日加班費</span><span style="font-weight: bold; font-family: monospace;">${row.regularOTPay > 0 ? row.regularOTPay.toLocaleString() : '-'}</span></div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>假日加班費</span><span style="font-weight: bold; font-family: monospace;">${row.sundayOTPay > 0 ? row.sundayOTPay.toLocaleString() : '-'}</span></div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>績效獎金</span><span style="font-weight: bold; font-family: monospace;">${row.performanceBonus > 0 ? row.performanceBonus.toLocaleString() : '-'}</span></div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>三節獎金</span><span style="font-weight: bold; font-family: monospace;">${row.holidayBonus > 0 ? row.holidayBonus.toLocaleString() : '-'}</span></div>
                    ${otherIncome > 0 ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>其他補貼</span><span style="font-weight: bold; font-family: monospace;">${otherIncome.toLocaleString()}</span></div>` : ''}
                `;
            }

            const totalDeductions = row.leaveDeduction + row.mealDeduction + row.insurance + otherDeduction;

            return `
                <div style="border: 2px solid #1e293b; padding: 24px; margin-bottom: 32px; page-break-inside: avoid; font-family: sans-serif; background-color: white;">
                    <div style="border-bottom: 2px solid #1e293b; padding-bottom: 8px; margin-bottom: 16px;">
                        <h2 style="text-align: center; margin: 0 0 4px 0; letter-spacing: 2px; font-size: 18px; color: #0f172a;">${selectedClinic?.name || ''} 薪資單</h2>
                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; color: #334155;">
                            <span>月份：${currentMonth}</span>
                            <span>${row.consultant.name} <span style="font-weight: normal; border: 1px solid #94a3b8; padding: 0 4px; border-radius: 4px; font-size: 10px;">${row.consultant.role}</span></span>
                        </div>
                    </div>

                    <div style="display: flex; gap: 24px;">
                        <div style="flex: 1;">
                            <h3 style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; border-bottom: 1px solid #cbd5e1; margin: 0 0 8px 0; padding-bottom: 4px;">應領項目 (Earnings)</h3>
                            <div style="font-size: 13px; line-height: 1.6;">
                                ${earningsHtml}
                            </div>
                            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #1e293b; display: flex; justify-content: space-between; font-weight: bold; font-size: 14px;">
                                <span>應領小計</span>
                                <span>${Math.round(totalEarningsDisplay).toLocaleString()}</span>
                            </div>
                        </div>

                        <div style="flex: 1;">
                            <h3 style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; border-bottom: 1px solid #cbd5e1; margin: 0 0 8px 0; padding-bottom: 4px;">應扣項目 (Deductions)</h3>
                            <div style="font-size: 13px; line-height: 1.6;">
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>勞健保</span><span style="font-weight: bold; font-family: monospace;">${row.insurance > 0 ? row.insurance.toLocaleString() : '-'}</span></div>
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>餐費</span><span style="font-weight: bold; font-family: monospace;">${row.mealDeduction > 0 ? row.mealDeduction.toLocaleString() : '-'}</span></div>
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>請假/遲到</span><span style="font-weight: bold; font-family: monospace;">${row.leaveDeduction > 0 ? row.leaveDeduction.toLocaleString() : '-'}</span></div>
                                ${otherDeduction > 0 ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0;"><span>其他扣款</span><span style="font-weight: bold; font-family: monospace;">${otherDeduction.toLocaleString()}</span></div>` : ''}
                            </div>
                            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #1e293b; display: flex; justify-content: space-between; font-weight: bold; font-size: 14px;">
                                <span>應扣小計</span>
                                <span>${Math.round(totalDeductions).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    <div style="margin-top: 16px; padding-top: 12px; border-top: 2px solid #1e293b; display: flex; justify-content: space-between; align-items: flex-end;">
                        <div style="font-size: 10px; color: #64748b; max-width: 60%;">
                            ${row.leaves.details !== '全勤' ? `<strong>考勤備註:</strong> ${row.leaves.details}` : ''}
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 12px; font-weight: bold; color: #475569; margin-right: 8px;">實付金額 (Net Pay)</span>
                            <span style="font-size: 24px; font-weight: 900; color: #0f172a; border-bottom: 4px double #94a3b8; padding-bottom: 2px;">$${Math.round(row.netPay).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        printWindow.document.write(`
            <html>
                <head>
                    <title>${selectedClinic?.name} 助理薪資單 - ${currentMonth}</title>
                    <style>
                        @media print {
                            body { -webkit-print-color-adjust: exact; }
                        }
                        body {
                            font-family: "Microsoft JhengHei", sans-serif;
                            padding: 40px;
                            max-width: 800px;
                            margin: 0 auto;
                        }
                    </style>
                </head>
                <body>
                    ${slipsHtml}
                    <script>
                        window.onload = function() { window.print(); }
                    </script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    return (
        <>
            <div className="space-y-6 pb-12 print:hidden">
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
                            <button 
                                onClick={handleSaveAll}
                                disabled={isLoading || salaryData.length === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50"
                            >
                                {isLoading ? <Loader2 size={18} className="animate-spin"/> : <Save size={18} />} 儲存薪資單
                            </button>
                            <button onClick={handlePrintSlips} disabled={salaryData.length === 0} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50">
                                <Printer size={18} /> 列印 / 另存 PDF
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
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-slate-500 whitespace-nowrap">三節獎金 $</label>
                            <input type="number" className="w-full border p-2 rounded bg-white" value={globalHolidayBonus} onChange={e => setGlobalHolidayBonus(Number(e.target.value))} />
                            <label className="flex items-center gap-1 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                                    checked={applyHolidayBonus}
                                    onChange={e => setApplyHolidayBonus(e.target.checked)}
                                />
                                <span className="text-xs font-bold text-slate-600 whitespace-nowrap">發放 (Apply)</span>
                            </label>
                        </div>
                        <div className="flex items-center justify-end">
                            <button 
                                onClick={handleSaveGlobalSettings}
                                disabled={isSavingSettings}
                                className="p-2 bg-white border border-slate-300 rounded hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-300 transition-colors shadow-sm"
                                title="儲存為全域設定"
                            >
                                {isSavingSettings ? <Loader2 size={16} className="animate-spin"/> : <Save size={16} />}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
                    <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 flex items-center gap-2">
                        <Briefcase size={18} /> 正職薪資 (Full-Time)
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10">姓名/職稱</th>
                                    <th className="px-4 py-3 text-right">薪資基數</th>
                                    <th className="px-4 py-3 min-w-[200px]">考勤統計</th>
                                    <th className="px-4 py-3 text-right text-emerald-600">全勤獎金</th>
                                    <th className="px-4 py-3 text-right text-amber-600">週日加班</th>
                                    <th className="px-4 py-3 text-right">平日加班 (分)</th>
                                    <th className="px-4 py-3 text-right text-purple-600">績效獎金</th>
                                    <th className="px-4 py-3 text-right text-amber-600">三節獎金</th>
                                    <th className="px-4 py-3 text-right text-rose-600">代扣餐費</th>
                                    <th className="px-4 py-3 text-right min-w-[100px]">勞健保 (扣)</th>
                                    <th className="px-4 py-3 text-right min-w-[100px]">其他調整</th>
                                    <th className="px-4 py-3 text-right font-black text-lg text-indigo-700 bg-indigo-50/30 border-l border-indigo-100">實領薪資</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {salaryData.filter(r => !r.isPartTime).map(row => (
                                    <tr key={row.consultant.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                            <div className="font-bold text-slate-700">{row.consultant.name}</div>
                                            <div className="text-[10px] text-slate-400 uppercase">{row.consultant.role}</div>
                                            {row.isProRata && (
                                                <div className="text-[10px] text-amber-600 font-bold mt-1 bg-amber-50 px-1 rounded inline-block">
                                                    {row.proRataNote}
                                                </div>
                                            )}
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
                                                <input 
                                                    type="number" 
                                                    className="w-16 border rounded px-1 py-0.5 text-right text-sm bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 outline-none" 
                                                    placeholder="0" 
                                                    value={row.regularOTMins || ''} 
                                                    onChange={e => handleRegularOTChange(row.consultant.id, e.target.value)} 
                                                    onBlur={() => persistInput(row.consultant.id, 'regularOvertimeMinutes', regularOTInputs[row.consultant.id] || 0)}
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
                                                className="w-20 border rounded px-1 py-0.5 text-right text-sm text-amber-600 font-bold bg-amber-50/50 focus:bg-white focus:ring-1 focus:ring-amber-500 outline-none" 
                                                value={row.holidayBonus || ''} 
                                                onChange={e => handleHolidayBonusChange(row.consultant.id, e.target.value)} 
                                                onBlur={() => persistInput(row.consultant.id, 'holidayBonus', holidayBonusInputs[row.consultant.id] || 0)}
                                                placeholder="0"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-rose-600 tabular-nums">
                                            {row.mealDeduction > 0 ? `-$${row.mealDeduction.toLocaleString()}` : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <input 
                                                type="number" 
                                                className="w-20 border rounded px-1 py-0.5 text-right text-sm text-rose-600 font-bold bg-rose-50/50 focus:bg-white focus:ring-1 focus:ring-rose-500 outline-none mb-1" 
                                                value={row.insurance} 
                                                onChange={e => handleInsuranceChange(row.consultant.id, e.target.value)} 
                                                onBlur={() => persistInput(row.consultant.id, 'laborHealthInsurance', insuranceInputs[row.consultant.id] || 0)}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <input 
                                                type="number" 
                                                className="w-20 border rounded px-1 py-0.5 text-right text-sm bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 outline-none" 
                                                placeholder="0" 
                                                value={row.adjustment || ''} 
                                                onChange={e => handleAdjustmentChange(row.consultant.id, e.target.value)} 
                                                onBlur={() => persistInput(row.consultant.id, 'otherAdjustment', adjustmentInputs[row.consultant.id] || 0)}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right font-black text-lg text-indigo-700 bg-indigo-50/30 border-l border-indigo-100 tabular-nums">
                                            ${row.netPay.toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                                {salaryData.filter(r => !r.isPartTime).length === 0 && (
                                    <tr><td colSpan={12} className="p-12 text-center text-slate-400 font-bold">無正職人員資料。</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Part-Time Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 bg-amber-50 border-b border-amber-200 font-bold text-amber-800 flex items-center gap-2">
                        <Clock size={18} /> 打工薪資 (Part-Time)
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="bg-amber-50/50 text-slate-500 font-bold uppercase text-xs border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-3 sticky left-0 bg-amber-50/50 z-10">姓名/職稱</th>
                                    <th className="px-4 py-3 text-right">時薪 (Hourly)</th>
                                    <th className="px-4 py-3 text-right">總時數 (Hours)</th>
                                    <th className="px-4 py-3 text-right">薪資小計</th>
                                    <th className="px-4 py-3 text-right text-amber-600">三節獎金</th>
                                    <th className="px-4 py-3 text-right text-rose-600">代扣餐費</th>
                                    <th className="px-4 py-3 text-right min-w-[100px]">勞健保 (扣)</th>
                                    <th className="px-4 py-3 text-right min-w-[100px]">其他調整</th>
                                    <th className="px-4 py-3 text-right font-black text-lg text-indigo-700 bg-indigo-50/30 border-l border-indigo-100">實領薪資</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {salaryData.filter(r => r.isPartTime).map(row => (
                                    <tr key={row.consultant.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                            <div className="font-bold text-slate-700">{row.consultant.name}</div>
                                            <div className="text-[10px] text-slate-400 uppercase">{row.consultant.role}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums">
                                            <div className="font-bold text-slate-700">${row.hourlyRate}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <input 
                                                    type="number" 
                                                    className="w-20 border rounded px-1 py-0.5 text-right text-sm bg-slate-50 focus:bg-white focus:ring-1 focus:ring-amber-500 outline-none" 
                                                    placeholder="0" 
                                                    value={row.partTimeHours || ''} 
                                                    onChange={e => handlePartTimeHoursChange(row.consultant.id, e.target.value)} 
                                                    onBlur={() => persistInput(row.consultant.id, 'partTimeHours', partTimeHourInputs[row.consultant.id] || 0)}
                                                />
                                                <span className="text-[10px] text-slate-400">hr</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-700 tabular-nums">
                                            ${row.totalBase.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <input 
                                                type="number" 
                                                className="w-20 border rounded px-1 py-0.5 text-right text-sm text-amber-600 font-bold bg-amber-50/50 focus:bg-white focus:ring-1 focus:ring-amber-500 outline-none" 
                                                value={row.holidayBonus || ''} 
                                                onChange={e => handleHolidayBonusChange(row.consultant.id, e.target.value)} 
                                                onBlur={() => persistInput(row.consultant.id, 'holidayBonus', holidayBonusInputs[row.consultant.id] || 0)}
                                                placeholder="0"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-rose-600 tabular-nums">
                                            {row.mealDeduction > 0 ? `-$${row.mealDeduction.toLocaleString()}` : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <input 
                                                type="number" 
                                                className="w-20 border rounded px-1 py-0.5 text-right text-sm text-rose-600 font-bold bg-rose-50/50 focus:bg-white focus:ring-1 focus:ring-rose-500 outline-none mb-1" 
                                                value={row.insurance} 
                                                onChange={e => handleInsuranceChange(row.consultant.id, e.target.value)} 
                                                onBlur={() => persistInput(row.consultant.id, 'laborHealthInsurance', insuranceInputs[row.consultant.id] || 0)}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <input 
                                                type="number" 
                                                className="w-20 border rounded px-1 py-0.5 text-right text-sm bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 outline-none" 
                                                placeholder="0" 
                                                value={row.adjustment || ''} 
                                                onChange={e => handleAdjustmentChange(row.consultant.id, e.target.value)} 
                                                onBlur={() => persistInput(row.consultant.id, 'otherAdjustment', adjustmentInputs[row.consultant.id] || 0)}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right font-black text-lg text-indigo-700 bg-indigo-50/30 border-l border-indigo-100 tabular-nums">
                                            ${row.netPay.toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                                {salaryData.filter(r => r.isPartTime).length === 0 && (
                                    <tr><td colSpan={9} className="p-12 text-center text-slate-400 font-bold">無打工人員資料。</td></tr>
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
                            <li><strong>代扣餐費:</strong> 自動從每日帳務「餐費公積金」中匯總該員工的點餐費用。</li>
                            <li><strong>輸入保存:</strong> 加班時數、勞健保與調整金額會在輸入後自動儲存。</li>
                        </ul>
                    </div>
                </div>
            </div>
        </>
    );
};
