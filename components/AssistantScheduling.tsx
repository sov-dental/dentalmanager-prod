import React, { useState, useMemo, useEffect } from 'react';
import { Clinic, Consultant, DailySchedule, StaffScheduleConfig, Doctor, ShiftType } from '../types';
import { StaffScheduleModal } from './StaffScheduleModal';
import { 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw, 
  Users, 
  Briefcase, 
  Clock, 
  CalendarDays, 
  Loader2, 
  Download, 
  Stethoscope,
  Coffee,
  CalendarOff
} from 'lucide-react';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';
import { db } from '../services/firebase';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
  consultants: Consultant[];
  schedules: DailySchedule[]; // Prop schedules contains data for ALL clinics
  onSave: (schedules: DailySchedule[]) => Promise<void>;
}

// Helper: Ensure YYYY-MM-DD format
const normalizeDate = (d: Date | string): string => {
    if (typeof d === 'string') {
        const parts = d.split('-');
        if (parts.length === 3) {
            return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
        return d;
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const AssistantScheduling: React.FC<Props> = ({ consultants, doctors, schedules: propsSchedules, onSave }) => {
  const { selectedClinicId, selectedClinic } = useClinic();
  
  // Safety First: Fix Data Source for Doctors
  const safeDoctors = useMemo(() => {
      const list = (doctors && doctors.length > 0) ? doctors : (selectedClinic?.doctors || []);
      console.log("[AssistantScheduling] Active Doctors Count:", list.length);
      return list;
  }, [doctors, selectedClinic]);

  const safeConsultants = consultants || [];
  const safePropsSchedules = propsSchedules || [];

  const [currentDate, setCurrentDate] = useState(new Date());
  const [isImporting, setIsImporting] = useState(false);
  const [modalDateStr, setModalDateStr] = useState<string | null>(null);
  
  // Real-time local state for the specific clinic's schedules
  const [schedules, setSchedules] = useState<DailySchedule[]>([]);
  const [isDataSyncing, setIsDataSyncing] = useState(false);

  // Safe reference for local schedules state
  const safeSchedules = schedules || [];

  // --- Real-time Listener ---
  useEffect(() => {
    if (!selectedClinicId) {
        setSchedules([]);
        return;
    }

    setIsDataSyncing(true);
    const unsubscribe = db.collection('clinics').doc(selectedClinicId)
      .onSnapshot((doc) => {
        if (doc.exists) {
          const data = doc.data();
          // We only need the schedules for the current clinic for local calculations
          setSchedules(data?.schedules || []);
        }
        setIsDataSyncing(false);
      }, (error) => {
        console.error("Schedule listener error:", error);
        setIsDataSyncing(false);
      });

    return () => unsubscribe();
  }, [selectedClinicId]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handleMonthChange = (offset: number) => {
    setCurrentDate(new Date(year, month + offset, 1));
  };

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

  const daysCount = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const blanks = Array.from({ length: firstDay }, (_, i) => i);
  const days = Array.from({ length: daysCount }, (_, i) => i + 1);

  // 1. Filter Consultants by Clinic
  const activeConsultants = useMemo(() => {
      return safeConsultants.filter(c => c.clinicId === selectedClinicId);
  }, [safeConsultants, selectedClinicId]);

  // 2. Lookup Helper (Safe Name Resolution)
  const getStaffObj = (id: string) => safeConsultants.find(c => c.id === id);
  const getStaffName = (id: string) => getStaffObj(id)?.name || id;
  const getStaffShortName = (id: string) => {
      const s = getStaffObj(id);
      return s?.avatarText || s?.name.charAt(0) || '?';
  };

  // 3. Group by Role
  const groupFullTime = activeConsultants.filter(c => !c.role || ['consultant', 'assistant', 'trainee', 'manager'].includes(c.role));
  const groupPartTime = activeConsultants.filter(c => c.role === 'part_time');

  // 4. Helper to extract config from the local schedules state
  const getStaffConfig = (targetDateStr: string): StaffScheduleConfig => {
      const schedule = safeSchedules.find(s => 
          normalizeDate(s.date) === targetDateStr
      );

      if (schedule?.staffConfiguration) {
          const config = schedule.staffConfiguration;
          return { 
            off: config.off || [],
            leave: config.leave || [],
            work: config.work || [],
            overtime: config.overtime || [],
            late: config.late || [] 
          };
      }
      
      if (schedule?.consultantOffs) {
          const off = schedule.consultantOffs.filter(id => groupFullTime.some(s => s.id === id));
          const work = groupPartTime.filter(s => !schedule.consultantOffs?.includes(s.id)).map(s => s.id);
          return { off, leave: [], work, overtime: [], late: [] };
      }
      
      return { off: [], leave: [], work: [], overtime: [], late: [] };
  };

  // --- Statistics Calculation (Derived from local schedules state) ---
  const stats = useMemo(() => {
    const fullTimeStats: Record<string, { off: string[], leaveDays: number, sundayOT: number, totalShifts: number, lateCount: number }> = {};
    const partTimeStats: Record<string, { work: string[], lateCount: number }> = {};

    groupFullTime.forEach(c => fullTimeStats[c.id] = { off: [], leaveDays: 0, sundayOT: 0, totalShifts: 0, lateCount: 0 });
    groupPartTime.forEach(c => partTimeStats[c.id] = { work: [], lateCount: 0 });

    for (let d = 1; d <= daysCount; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay(); 
        
        const config = getStaffConfig(dateStr);
        const dayLabel = String(d);

        groupFullTime.forEach(c => {
            if (!fullTimeStats[c.id]) return;

            const isOff = config.off.includes(c.id);
            const leaveEntry = config.leave.find(l => l.id === c.id);
            const overtimeEntry = config.overtime?.find(o => o.id === c.id);
            const isLate = (config.late || []).includes(c.id);

            if (isOff) {
                fullTimeStats[c.id].off.push(dayLabel);
            } else if (leaveEntry) {
                const duration = leaveEntry.type.includes('(半)') ? 0.5 : 1.0;
                fullTimeStats[c.id].leaveDays += duration;
            } else {
                if (isLate) fullTimeStats[c.id].lateCount++;

                if (dayOfWeek === 0) { 
                    if (overtimeEntry) {
                        const otDuration = overtimeEntry.type.includes('(半)') ? 0.5 : 1.0;
                        fullTimeStats[c.id].sundayOT += otDuration;
                        fullTimeStats[c.id].totalShifts += otDuration;
                    } else {
                        fullTimeStats[c.id].sundayOT += 1.0;
                        fullTimeStats[c.id].totalShifts += 1.0;
                    }
                } else {
                    fullTimeStats[c.id].totalShifts += 1.0;
                }
            }
        });

        config.work.forEach(id => {
            if (partTimeStats[id]) {
                partTimeStats[id].work.push(dayLabel);
                if ((config.late || []).includes(id)) {
                    partTimeStats[id].lateCount++;
                }
            }
        });
    }

    return { fullTimeStats, partTimeStats };
  }, [safeSchedules, year, month, selectedClinicId, groupFullTime, groupPartTime, daysCount]);

  const handleImportDefaults = async () => {
      if (!selectedClinic || !selectedClinic.weeklyHours) {
          alert("無法讀取診所營業時間設定");
          return;
      }
      
      if (!confirm(`確定要代入預設休診日？\n系統將掃描本月所有週休診日 (例如每週日)，並將該日設為「全員排休」。`)) return;

      setIsImporting(true);
      try {
          const closedDaysOfWeek = selectedClinic.weeklyHours
              .map((h, idx) => (!h.Morning && !h.Afternoon && !h.Evening) ? idx : -1)
              .filter(i => i !== -1);

          if (closedDaysOfWeek.length === 0) {
              alert("此診所設定為無固定公休日。");
              setIsImporting(false);
              return;
          }

          let updatedLocalSchedules = [...safeSchedules];
          const fullTimeIds = groupFullTime.map(c => c.id);

          for (let d = 1; d <= daysCount; d++) {
              const dateObj = new Date(year, month, d);
              if (closedDaysOfWeek.includes(dateObj.getDay())) {
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  
                  const newConfig: StaffScheduleConfig = {
                      off: fullTimeIds,
                      leave: [], 
                      work: [],
                      overtime: [],
                      late: [] 
                  };

                  const existingIdx = updatedLocalSchedules.findIndex(s => s.date === dateStr);
                  
                  if (existingIdx >= 0) {
                      updatedLocalSchedules[existingIdx] = { ...updatedLocalSchedules[existingIdx], staffConfiguration: newConfig };
                  } else {
                      updatedLocalSchedules.push({
                          date: dateStr,
                          clinicId: selectedClinicId,
                          isClosed: true,
                          shifts: { Morning: [], Afternoon: [], Evening: [] },
                          staffConfiguration: newConfig
                      });
                  }
              }
          }

          const otherClinicsSchedules = safePropsSchedules.filter(s => s.clinicId !== selectedClinicId);
          await onSave([...otherClinicsSchedules, ...updatedLocalSchedules]);
          alert("已成功代入預設休診設定！");

      } catch (e) {
          console.error(e);
          alert("代入失敗");
      } finally {
          setIsImporting(false);
      }
  };

  const handleExportICS = () => {
      if (!selectedClinic) return;
      
      const icsLines = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//DentalManager//AssistantSchedule//TW',
          'CALSCALE:GREGORIAN',
          'METHOD:PUBLISH'
      ];

      for (let d = 1; d <= daysCount; d++) {
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const config = getStaffConfig(dateStr);
          
          const groups: string[] = [];

          // Group 1: [休]
          if (config.off.length > 0) {
              const names = config.off.map(id => getStaffShortName(id)).join('.');
              groups.push(`[休-${names}]`);
          }

          // Group 2: [假]
          if (config.leave.length > 0) {
              const names = config.leave.map(l => getStaffShortName(l.id)).join('.');
              groups.push(`[假-${names}]`);
          }

          // Group 3: [遲]
          if (config.late && config.late.length > 0) {
              const names = config.late.map(id => getStaffShortName(id)).join('.');
              groups.push(`[遲-${names}]`);
          }

          // Group 4: [打工]
          if (config.work.length > 0) {
              const names = config.work.map(id => getStaffShortName(id)).join('.');
              groups.push(`[打工-${names}]`);
          }

          if (groups.length > 0) {
              const summary = groups.join(' ');
              const dateVal = dateStr.replace(/-/g, '');
              const nextDateObj = new Date(year, month, d + 1);
              const nextDateVal = normalizeDate(nextDateObj).replace(/-/g, '');
              
              icsLines.push('BEGIN:VEVENT');
              icsLines.push(`UID:${dateStr}-${selectedClinicId}-assistant@dentalmanager`);
              icsLines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`);
              icsLines.push(`DTSTART;VALUE=DATE:${dateVal}`);
              icsLines.push(`DTEND;VALUE=DATE:${nextDateVal}`);
              icsLines.push(`SUMMARY:${summary}`);
              icsLines.push('TRANSP:TRANSPARENT');
              icsLines.push('END:VEVENT');
          }
      }

      icsLines.push('END:VCALENDAR');
      
      const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Assistant_Schedule_${selectedClinic.name}_${year}${String(month + 1).padStart(2, '0')}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const renderStaffAvatar = (id: string, label: string, statusType: string) => {
      const s = getStaffObj(id);
      if (!s) return null;
      
      const bgColor = s.avatarColor || '#94a3b8';
      const shortName = s.avatarText || s.name.charAt(0);

      return (
          <div 
              key={id}
              style={{ backgroundColor: bgColor }}
              title={`${s.name} (${label})`}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-sm border border-white/50 shrink-0 transition-transform hover:scale-110"
          >
              {shortName}
          </div>
      );
  };

  // Helper to get active doctors for the whole month summary
  const monthlyActiveDoctors = useMemo(() => {
    const docIdsOrNames = new Set<string>();
    safeSchedules.forEach(s => {
        if (!s.isClosed && s.shifts) {
            (s.shifts.Morning || []).forEach(id => docIdsOrNames.add(id));
            (s.shifts.Afternoon || []).forEach(id => docIdsOrNames.add(id));
            (s.shifts.Evening || []).forEach(id => docIdsOrNames.add(id));
        }
    });
    // Critical Fix: Match against BOTH ID and Name for Firestore flexibility
    return safeDoctors.filter(doc => 
        docIdsOrNames.has(doc.id) || docIdsOrNames.has(doc.name)
    );
  }, [safeSchedules, safeDoctors]);

  return (
    <div className="space-y-6">
      {/* Header & Filters */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
           <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
             <Users size={28} className="text-teal-600"/> 助理排班總控
           </h2>
           <p className="text-slate-500">管理正職排休、請假與打工排班，並檢視月度統計。</p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
            <ClinicSelector className="border p-2 rounded-lg font-medium text-slate-700 bg-slate-50 min-w-[150px]" />
            
            <div className="flex items-center bg-slate-100 rounded-lg p-1">
                <button onClick={() => handleMonthChange(-1)} className="p-1.5 hover:bg-white rounded-md shadow-sm transition"><ChevronLeft size={20}/></button>
                <span className="w-32 text-center font-bold text-slate-800">{year}年 {month + 1}月</span>
                <button onClick={() => handleMonthChange(1)} className="p-1.5 hover:bg-white rounded-md shadow-sm transition"><ChevronRight size={20}/></button>
            </div>

            <div className="flex gap-2">
                <button 
                    onClick={handleExportICS}
                    className="flex items-center gap-2 bg-white text-slate-600 border border-slate-300 hover:bg-slate-50 px-3 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors"
                >
                    <Download size={16} />
                    匯出 ICS
                </button>
                <button 
                    onClick={handleImportDefaults}
                    disabled={isImporting || isDataSyncing}
                    className="flex items-center gap-2 bg-orange-50 text-orange-600 hover:bg-orange-100 px-3 py-2 rounded-lg text-sm font-bold border border-orange-200 transition-colors disabled:opacity-50"
                >
                    {isImporting ? <Loader2 size={16} className="animate-spin"/> : <CalendarDays size={16} />}
                    代入預設休診
                </button>
            </div>

            <button 
                onClick={() => window.location.reload()}
                className="p-2 bg-slate-100 hover:bg-teal-50 text-slate-500 hover:text-teal-600 rounded-lg transition-colors"
                title="重新整理"
            >
                <RefreshCw size={20} className={isDataSyncing ? 'animate-spin' : ''} />
            </button>
        </div>
      </div>

      {/* Syncing Indicator */}
      {isDataSyncing && (
          <div className="flex items-center gap-2 text-teal-600 text-sm font-medium bg-teal-50 px-3 py-1.5 rounded-lg border border-teal-100 w-fit">
              <Loader2 size={14} className="animate-spin" />
              正在同步最新排班資料...
          </div>
      )}

      {/* Calendar Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-center py-2 text-sm font-bold text-slate-500">
             {['週日', '週一', '週二', '週三', '週四', '週五', '週六'].map(d => <div key={d}>{d}</div>)}
         </div>
         <div className="grid grid-cols-7 auto-rows-fr bg-slate-100 gap-px border-b border-slate-200">
             {blanks.map(i => <div key={`blank-${i}`} className="bg-white min-h-[160px] opacity-50"></div>)}
             
             {days.map(d => {
                 const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                 const config = getStaffConfig(dateStr);
                 const daySchedule = safeSchedules.find(s => normalizeDate(s.date) === dateStr);
                 
                 // Critical Fix: Identifing doctors using nested shifts structure
                 const activeDayDoctors = safeDoctors.filter(doc => {
                    if (!daySchedule || daySchedule.isClosed || !daySchedule.shifts) return false;
                    return (
                        (daySchedule.shifts.Morning || []).includes(doc.id) ||
                        (daySchedule.shifts.Afternoon || []).includes(doc.id) ||
                        (daySchedule.shifts.Evening || []).includes(doc.id) ||
                        // Backup check for Name if ID match fails (for legacy/manual sync)
                        (daySchedule.shifts.Morning || []).includes(doc.name) ||
                        (daySchedule.shifts.Afternoon || []).includes(doc.name) ||
                        (daySchedule.shifts.Evening || []).includes(doc.name)
                    );
                 });

                 const hasData = config.off.length > 0 || config.leave.length > 0 || config.work.length > 0 || (config.late && config.late.length > 0);

                 return (
                     <div 
                        key={d} 
                        onClick={() => setModalDateStr(dateStr)}
                        className="bg-white min-h-[160px] p-2 hover:bg-blue-50 cursor-pointer transition-colors relative group"
                     >
                         <div className="text-sm font-bold text-slate-700 mb-2 flex justify-between">
                             {d}
                             <span className="text-[10px] text-slate-300 group-hover:text-blue-400 font-normal">編輯</span>
                         </div>
                         
                         <div className="space-y-2">
                             {/* READ-ONLY DOCTOR ROW IN CALENDAR CELL */}
                             {activeDayDoctors.length > 0 && (
                                 <div 
                                    className="flex flex-wrap items-center gap-1 pb-1 mb-1 border-b border-slate-50"
                                    onClick={(e) => e.stopPropagation()} // Strictly Read-Only
                                 >
                                     <div className="p-1 bg-indigo-50 text-indigo-400 rounded shrink-0" title="今日看診醫師">
                                         <Stethoscope size={10} />
                                     </div>
                                     {activeDayDoctors.map(doc => {
                                         const docShifts = [];
                                         if (daySchedule?.shifts?.Morning?.includes(doc.id) || daySchedule?.shifts?.Morning?.includes(doc.name)) docShifts.push('早');
                                         if (daySchedule?.shifts?.Afternoon?.includes(doc.id) || daySchedule?.shifts?.Afternoon?.includes(doc.name)) docShifts.push('午');
                                         if (daySchedule?.shifts?.Evening?.includes(doc.id) || daySchedule?.shifts?.Evening?.includes(doc.name)) docShifts.push('晚');

                                         return (
                                            <div 
                                                key={doc.id}
                                                style={{ backgroundColor: doc.avatarBgColor || doc.color || '#3b82f6' }}
                                                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-sm border border-white/50 shrink-0"
                                                title={`${doc.name} (${docShifts.join('/')})`}
                                            >
                                                {doc.avatarText || doc.name.substring(0, 2)}
                                            </div>
                                         );
                                     })}
                                 </div>
                             )}

                             {/* Group 1: Off (休) */}
                             {config.off.length > 0 && (
                                 <div className="flex items-center gap-1 text-slate-400 text-[10px]">
                                     <Coffee size={10} className="shrink-0" />
                                     <div className="flex flex-wrap gap-1">
                                         {config.off.map(id => renderStaffAvatar(id, '休假', 'off'))}
                                     </div>
                                 </div>
                             )}

                             {/* Group 2: Leave (假) */}
                             {config.leave.length > 0 && (
                                 <div className="flex items-center gap-1 text-rose-500 text-[10px] font-bold">
                                     <CalendarOff size={10} className="shrink-0" />
                                     <div className="flex flex-wrap gap-1">
                                         {config.leave.map(l => renderStaffAvatar(l.id, l.type, 'leave'))}
                                     </div>
                                 </div>
                             )}

                             {/* Group 3: Late (遲) */}
                             {config.late && config.late.length > 0 && (
                                 <div className="flex items-center gap-1 text-amber-500 text-[10px] font-bold">
                                     <Clock size={10} className="shrink-0" />
                                     <div className="flex flex-wrap gap-1">
                                         {config.late.map(id => renderStaffAvatar(id, '遲到', 'late'))}
                                     </div>
                                 </div>
                             )}

                             {/* Group 4: Part-time Work (工) */}
                             {config.work.length > 0 && (
                                 <div className="flex items-center gap-1 text-blue-500 text-[10px] font-bold">
                                     <Briefcase size={10} className="shrink-0" />
                                     <div className="flex flex-wrap gap-1">
                                         {config.work.map(id => renderStaffAvatar(id, '打工', 'work'))}
                                     </div>
                                 </div>
                             )}

                             {!hasData && activeDayDoctors.length === 0 && (
                                 <div className="text-[10px] text-slate-300 italic py-1">全員上班</div>
                             )}
                         </div>
                     </div>
                 );
             })}
         </div>
      </div>

      {/* Statistics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                  <Briefcase size={20} className="text-teal-600" />
                  <h3 className="font-bold text-slate-800">正職人員統計 (Full-Time Stats)</h3>
              </div>
              <div className="p-4">
                  <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                              <tr>
                                  <th className="px-3 py-2">姓名</th>
                                  <th className="px-3 py-2 text-right">週日加班</th>
                                  <th className="px-3 py-2 text-right">請假天數</th>
                                  <th className="px-3 py-2 text-right">遲到 (次)</th>
                                  <th className="px-3 py-2 text-right">排休天數</th>
                                  <th className="px-3 py-2 text-right">總班數</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {/* READ-ONLY DOCTOR SUMMARY ROW */}
                              {monthlyActiveDoctors.length > 0 && (
                                  <tr className="bg-indigo-50/40">
                                      <td className="px-3 py-3 font-bold text-indigo-700 flex items-center gap-2">
                                          <Stethoscope size={14} />
                                          醫師 (Dr.)
                                      </td>
                                      <td colSpan={5} className="px-3 py-3">
                                          <div className="flex flex-wrap gap-1.5">
                                              {monthlyActiveDoctors.map(doc => (
                                                  <div 
                                                    key={doc.id}
                                                    style={{ backgroundColor: doc.avatarBgColor || doc.color || '#3b82f6' }}
                                                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black text-white shadow-sm border border-white"
                                                    title={doc.name}
                                                  >
                                                      {doc.avatarText || doc.name.substring(0, 2)}
                                                  </div>
                                              ))}
                                          </div>
                                      </td>
                                  </tr>
                              )}

                              {groupFullTime.map(c => {
                                  const s = stats.fullTimeStats[c.id];
                                  if (!s) return null;
                                  return (
                                      <tr key={c.id} className="hover:bg-slate-50">
                                          <td className="px-3 py-3 font-bold text-slate-700">
                                              <div className="flex items-center gap-2">
                                                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold" style={{ backgroundColor: c.avatarColor || '#94a3b8' }}>{c.avatarText || c.name[0]}</div>
                                                  {c.name}
                                              </div>
                                          </td>
                                          <td className={`px-3 py-3 text-right font-bold ${s.sundayOT > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                              {s.sundayOT}
                                          </td>
                                          <td className="px-3 py-3 text-right">
                                              <div className={`font-bold ${s.leaveDays > 0 ? 'text-purple-600' : 'text-slate-400'}`}>{s.leaveDays}</div>
                                          </td>
                                          <td className="px-3 py-3 text-right">
                                              <div className={`font-black ${s.lateCount > 0 ? 'text-amber-600' : 'text-slate-300'}`}>{s.lateCount}</div>
                                          </td>
                                          <td className="px-3 py-3 text-right">
                                              <div className="font-bold text-slate-600">{s.off.length}</div>
                                          </td>
                                          <td className="px-3 py-3 text-right">
                                              <div className="font-bold text-indigo-600">{s.totalShifts}</div>
                                          </td>
                                      </tr>
                                  );
                              })}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                  <Clock size={20} className="text-amber-500" />
                  <h3 className="font-bold text-slate-800">打工人員統計 (Part-time)</h3>
              </div>
              <div className="p-4">
                  <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                              <tr>
                                  <th className="px-3 py-2">姓名</th>
                                  <th className="px-3 py-2 text-right">遲到 (次)</th>
                                  <th className="px-3 py-2 text-right">上班天數</th>
                                  <th className="px-3 py-2">日期</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {groupPartTime.map(c => {
                                  const s = stats.partTimeStats[c.id];
                                  if (!s) return null;
                                  return (
                                      <tr key={c.id} className="hover:bg-slate-50">
                                          <td className="px-3 py-3 font-bold text-slate-700">
                                              <div className="flex items-center gap-2">
                                                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold" style={{ backgroundColor: c.avatarColor || '#94a3b8' }}>{c.avatarText || c.name[0]}</div>
                                                  {c.name}
                                              </div>
                                          </td>
                                          <td className="px-3 py-3 text-right font-black text-amber-600">{s.lateCount}</td>
                                          <td className="px-3 py-3 text-right font-bold text-indigo-600">{s.work.length} 天</td>
                                          <td className="px-3 py-3 text-xs text-slate-500 break-words max-w-[200px]">
                                              {s.work.join(', ') || '-'}
                                          </td>
                                      </tr>
                                  );
                              })}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>
      </div>

      <StaffScheduleModal 
          isOpen={!!modalDateStr}
          onClose={() => setModalDateStr(null)}
          dateStr={modalDateStr || ''}
          clinicId={selectedClinicId}
          schedules={safeSchedules}
          consultants={safeConsultants}
          onSave={async (updatedClinicSchedules) => {
              const otherClinicsSchedules = safePropsSchedules.filter(s => s.clinicId !== selectedClinicId);
              await onSave([...otherClinicsSchedules, ...updatedClinicSchedules]);
          }}
      />
    </div>
  );
};