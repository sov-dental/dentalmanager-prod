import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Doctor, DailySchedule, ShiftType, DayOfWeek } from '../types';
import { ChevronLeft, ChevronRight, RefreshCw, X, ChevronDown, Download, HelpCircle, Loader2, Image as ImageIcon } from 'lucide-react';
import { PublishModal } from './PublishModal';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';
import { db, saveClinicSchedule, deepSanitize } from '../services/firebase';

interface Props {
  clinics: Clinic[]; // Compatibility
  doctors: Doctor[];
  schedules: DailySchedule[]; // Prop shadowed by local state for reliability
  onSave: (s: DailySchedule[]) => Promise<void>;
}

const SHIFTS: ShiftType[] = ['Morning', 'Afternoon', 'Evening'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const SHIFT_BADGE_TEXT: Record<ShiftType, string> = {
    Morning: '早',
    Afternoon: '午',
    Evening: '晚'
};

// --- Reusable Doctor Avatar Component ---
const DoctorAvatar = ({ doctor, size = 'md', className = '' }: { doctor: Doctor, size?: 'sm' | 'md' | 'lg', className?: string }) => {
    const sizeClasses = {
        sm: 'w-6 h-6 text-xs', // Mobile/Dense
        md: 'w-8 h-8 text-sm', // Standard
        lg: 'w-10 h-10 text-base' // Large
    };
    
    // Fallbacks
    const bgColor = doctor.avatarBgColor || doctor.color || '#3b82f6';
    const text = doctor.avatarText || (doctor.name ? doctor.name.substring(0, 1) : '?');

    return (
        <div 
            className={`rounded-full flex items-center justify-center font-bold text-white shadow-sm shrink-0 border border-white/50 ${sizeClasses[size]} ${className}`}
            style={{ backgroundColor: bgColor }}
            title={doctor.name}
        >
            {text}
        </div>
    );
};

// Collapsible Section Component
interface ShiftEditorSectionProps {
    label: string;
    color: string;
    doctors: Doctor[];
    selectedDocIds: string[];
    onToggle: (id: string) => void;
}

const ShiftEditorSection: React.FC<ShiftEditorSectionProps> = ({
    label,
    color,
    doctors,
    selectedDocIds,
    onToggle
}) => {
    // Smart default: Open if has doctors, closed if empty
    const [isOpen, setIsOpen] = useState(selectedDocIds.length > 0);

    return (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm mb-4">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shadow-sm ring-2 ring-white" style={{ backgroundColor: color }}></div>
                    <span className="font-bold text-lg text-slate-800">{label}</span>
                    {selectedDocIds.length > 0 && (
                        <span className="text-sm font-bold text-white bg-slate-800 px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">
                            {selectedDocIds.length}
                        </span>
                    )}
                </div>
                <ChevronDown size={20} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {isOpen && (
                <div className="p-4 sm:p-6 border-t border-slate-100 animate-fade-in bg-white">
                    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4">
                         {doctors.map(doc => {
                             const isSelected = selectedDocIds.includes(doc.id);
                             const bgColor = doc.avatarBgColor || doc.color || '#3b82f6';
                             const avatarText = doc.avatarText || (doc.name ? doc.name.substring(0, 1) : '?');

                             return (
                                 <button
                                      key={doc.id}
                                      onClick={() => onToggle(doc.id)}
                                      className="flex flex-col items-center gap-2 group outline-none"
                                      type="button"
                                 >
                                     <div 
                                        className={`
                                            relative w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center 
                                            text-2xl font-bold text-white shadow-sm transition-all duration-200
                                            ${isSelected 
                                                ? 'scale-105' 
                                                : 'opacity-40 grayscale group-hover:opacity-75 group-hover:grayscale-0 group-hover:scale-105'
                                            }
                                        `}
                                        style={{ 
                                            backgroundColor: bgColor,
                                            boxShadow: isSelected ? `0 0 0 2px #fff, 0 0 0 5px ${bgColor}` : 'none'
                                        }} 
                                     >
                                         {avatarText}
                                     </div>
                                     <span className={`
                                         text-sm sm:text-base font-bold text-center w-full truncate px-1 rounded
                                         ${isSelected ? 'text-slate-900 bg-slate-100' : 'text-slate-400 group-hover:text-slate-600'}
                                     `}>
                                         {doc.name}
                                     </span>
                                 </button>
                             );
                         })}
                    </div>
                    {doctors.length === 0 && (
                         <div className="text-center py-6 text-slate-400 italic bg-slate-50 rounded-lg mt-2">無可用醫師</div>
                     )}
                </div>
            )}
        </div>
    );
};

export const MonthlyScheduler: React.FC<Props> = ({ doctors, schedules: propsSchedules, onSave }) => {
  const { selectedClinicId, selectedClinic, clinics } = useClinic();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  
  // Real-time local state for the specific clinic's schedules
  const [schedules, setSchedules] = useState<DailySchedule[]>([]);
  const [isDataSyncing, setIsDataSyncing] = useState(false);

  // --- Real-time Listener (onSnapshot) ---
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
          // Update local state with the latest schedules from DB
          setSchedules(data?.schedules || []);
        }
        setIsDataSyncing(false);
      }, (error) => {
        console.error("[MonthlyScheduler] Schedule listener error:", error);
        setIsDataSyncing(false);
      });

    return () => unsubscribe();
  }, [selectedClinicId]);

  // Export State
  const [exportDoctorId, setExportDoctorId] = useState<string>('all');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  // Modal State
  const [editingSchedule, setEditingSchedule] = useState<DailySchedule | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handleMonthChange = (offset: number) => {
    setCurrentDate(new Date(year, month + offset, 1));
  };

  // Get doctors active in this month for the export dropdown
  const activeDoctors = useMemo(() => {
    if (!selectedClinicId) return [];
    
    const docIds = new Set<string>();
    const currentMonthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    schedules.forEach(s => {
        if (s.clinicId !== selectedClinicId) return;
        if (!s.date.startsWith(currentMonthPrefix)) return;
        if (s.isClosed) return;
        
        SHIFTS.forEach(shift => {
            const shiftList = s.shifts[shift] || [];
            shiftList.forEach(id => docIds.add(id));
        });
    });

    return doctors
        .filter(d => docIds.has(d.id))
        .sort((a, b) => a.name.localeCompare(b.name));
  }, [schedules, year, month, selectedClinicId, doctors]);

  const generateDefaultSchedule = async () => {
    try {
        if (!selectedClinicId || selectedClinicId === 'demo-clinic') {
            console.error("[MonthlyScheduler] Invalid Clinic ID for generateDefault:", selectedClinicId);
            alert("找不到有效的診所資料，請嘗試重新整理頁面。");
            return;
        }

        const isConfirmed = window.confirm("目前編輯的內容將被覆蓋，要確認還是取消?");
        if (!isConfirmed) return;

        setIsSaving(true);
        console.log("[MonthlyScheduler] generateDefaultSchedule - Clinic ID:", selectedClinicId);

        const daysCount = getDaysInMonth(year, month);
        const newClinicSchedules: DailySchedule[] = [];

        // Logic: Since we are using saveClinicSchedule (single clinic update), 
        // we only care about the existing schedules for THIS clinic.
        const otherMonthsSchedules = schedules.filter(s => {
            const [sYear, sMonth] = s.date.split('-').map(Number);
            return !(sMonth - 1 === month && sYear === year);
        });

        const clinicDoctors = doctors.filter(d => d.clinicId === selectedClinicId);

        for (let day = 1; day <= daysCount; day++) {
            const dateObj = new Date(year, month, day);
            const dayOfWeek = dateObj.getDay() as DayOfWeek; // 0=Sunday
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            
            const hours = selectedClinic?.weeklyHours?.[dayOfWeek];
            if (!hours) continue;
            
            const isClosed = !hours.Morning && !hours.Afternoon && !hours.Evening;
            const shifts = { Morning: [], Afternoon: [], Evening: [] } as any;

            if (!isClosed) {
                clinicDoctors.forEach(doc => {
                    doc.recurringShifts.forEach(recurring => {
                        if (recurring.day === dayOfWeek && hours[recurring.shift]) {
                            shifts[recurring.shift].push(doc.id);
                        }
                    });
                });
            }

            newClinicSchedules.push({
                date: dateStr,
                clinicId: selectedClinicId,
                isClosed,
                shifts
            });
        }

        const finalSchedulesToSave = [...otherMonthsSchedules, ...newClinicSchedules];
        await saveClinicSchedule(selectedClinicId, finalSchedulesToSave);
        
        // Also call global onSave for internal App.tsx sync if needed (optional based on architecture)
        // But the primary source of truth is now updated directly.
        alert("排班表產生成功！");
    } catch (e) {
        console.error("Schedule generation error:", e);
        alert("產生排班表時發生錯誤，請檢查資料是否完整。");
    } finally {
        setIsSaving(false);
    }
  };

  const handleExportICS = () => {
    if (!selectedClinic) return;
    
    // Header
    let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//DentalScheduler//TW',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH'
    ];

    const daysCount = getDaysInMonth(year, month);
    
    // Helper to format date YYYYMMDD
    const formatDate = (y: number, m: number, d: number) => {
        return `${y}${String(m + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`;
    };

    let eventCount = 0;

    for (let day = 1; day <= daysCount; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const schedule = schedules.find(s => s.date === dateStr && s.clinicId === selectedClinicId);
        
        if (!schedule || schedule.isClosed) continue;

        // Determine which doctors to process
        const doctorsToProcess = exportDoctorId === 'all' 
            ? activeDoctors 
            : activeDoctors.filter(d => d.id === exportDoctorId);

        doctorsToProcess.forEach(doc => {
            const shifts: string[] = [];
            if (schedule.shifts.Morning.includes(doc.id)) shifts.push('早');
            if (schedule.shifts.Afternoon.includes(doc.id)) shifts.push('午');
            if (schedule.shifts.Evening.includes(doc.id)) shifts.push('晚');

            if (shifts.length > 0) {
                const shiftStr = shifts.join('/');
                const summary = `[${selectedClinic.name}] ${doc.name}(${shiftStr})`;
                const dtStart = formatDate(year, month, day);
                const uid = `${dateStr}-${doc.id}@dentalscheduler`;
                const dtStamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

                icsContent.push('BEGIN:VEVENT');
                icsContent.push(`UID:${uid}`);
                icsContent.push(`DTSTAMP:${dtStamp}`);
                icsContent.push(`DTSTART;VALUE=DATE:${dtStart}`);
                icsContent.push(`SUMMARY:${summary}`);
                icsContent.push('STATUS:CONFIRMED');
                icsContent.push('TRANSP:TRANSPARENT'); 
                icsContent.push('END:VEVENT');
                eventCount++;
            }
        });
    }

    icsContent.push('END:VCALENDAR');

    if (eventCount === 0) {
        alert('此區間無排班資料可匯出');
        return;
    }

    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const docName = exportDoctorId === 'all' ? 'All' : (activeDoctors.find(d => d.id === exportDoctorId)?.name || 'Doctor');
    link.download = `Schedule_${docName}_${year}${String(month + 1).padStart(2, '0')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const openDayEditor = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const existing = schedules.find(s => s.date === dateStr && s.clinicId === selectedClinicId);
    
    if (existing) {
      setEditingSchedule({ ...existing }); // Clone
    } else {
       // Create blank if missing
       const dateObj = new Date(year, month, day);
       const dayOfWeek = dateObj.getDay() as DayOfWeek;
       
       const hours = selectedClinic?.weeklyHours?.[dayOfWeek];
       const isClosed = hours ? (!hours.Morning && !hours.Afternoon && !hours.Evening) : false;

       setEditingSchedule({
         date: dateStr,
         clinicId: selectedClinicId,
         isClosed,
         shifts: { Morning: [], Afternoon: [], Evening: [] }
       });
    }
    setSelectedDay(dateStr);
  };

  const saveDayEditor = async () => {
    if (!editingSchedule) return;
    
    setIsSaving(true);
    console.log("[MonthlyScheduler] saveDayEditor - Clinic ID:", selectedClinicId);

    if (!selectedClinicId || selectedClinicId === 'demo-clinic') {
        console.error("[MonthlyScheduler] Invalid Clinic ID for saveDayEditor:", selectedClinicId);
        alert("錯誤：無效的診所 ID。請重新整理頁面。");
        setIsSaving(false);
        return;
    }

    try {
        const filtered = schedules.filter(s => s.date !== editingSchedule.date);
        const finalSchedulesToSave = [...filtered, editingSchedule];
        
        await saveClinicSchedule(selectedClinicId, finalSchedulesToSave);
        
        setEditingSchedule(null);
        setSelectedDay(null);
    } catch (e) {
        console.error("[MonthlyScheduler] saveDayEditor failed:", e);
        alert("儲存失敗: " + (e as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const toggleDoctorInShift = (shift: ShiftType, docId: string) => {
    if (!editingSchedule) return;
    const currentList = editingSchedule.shifts[shift] || [];
    const newList = currentList.includes(docId) 
        ? currentList.filter(id => id !== docId)
        : [...currentList, docId];
    
    setEditingSchedule({
        ...editingSchedule,
        shifts: { ...editingSchedule.shifts, [shift]: newList }
    });
  };

  // Rendering
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const blanks = Array(firstDay).fill(null);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  if (clinics.length === 0) return <div className="p-8 text-center text-slate-500">請先新增診所。</div>;

  const shiftColors = {
      Morning: selectedClinic?.shiftColors?.morning || '#fbbf24',
      Afternoon: selectedClinic?.shiftColors?.afternoon || '#fb923c',
      Evening: selectedClinic?.shiftColors?.evening || '#818cf8',
  };

  // Dynamic Shift Labels from Clinic Settings
  const dynamicShiftLabels: Record<ShiftType, string> = {
      Morning: selectedClinic?.shiftLabels?.morning || '早診 (10:00-13:00)',
      Afternoon: selectedClinic?.shiftLabels?.afternoon || '午診 (14:00-17:00)',
      Evening: selectedClinic?.shiftLabels?.evening || '晚診 (18:00-21:00)'
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col lg:flex-row items-center lg:justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
         {/* LEFT GROUP: Clinic, Month, Generate Defaults */}
         <div className="flex flex-wrap justify-center items-center gap-3 w-full lg:w-auto">
             <ClinicSelector className="border p-2 rounded-lg font-medium text-slate-700 bg-slate-50 w-full sm:w-auto md:min-w-[180px]" />
            
            <div className="flex items-center bg-slate-100 rounded-lg p-1 w-full sm:w-auto justify-between sm:justify-center">
                <button onClick={() => handleMonthChange(-1)} className="p-1 hover:bg-white rounded-md shadow-sm transition"><ChevronLeft size={20}/></button>
                <span className="flex-1 sm:flex-none w-32 md:w-40 text-center font-bold text-slate-800">{year}年 {MONTHS[month]}</span>
                <button onClick={() => handleMonthChange(1)} className="p-1 hover:bg-white rounded-md shadow-sm transition"><ChevronRight size={20}/></button>
            </div>

            <button 
                onClick={generateDefaultSchedule}
                disabled={isSaving || isDataSyncing}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg shadow-md transition-colors w-full sm:w-auto justify-center whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                <span className="hidden lg:inline">產生預設班表</span>
                <span className="lg:hidden">預設班表</span>
            </button>
         </div>
         
         {/* RIGHT GROUP: Export Toolbar */}
         <div className="flex flex-wrap justify-center items-center gap-2 w-full lg:w-auto">
            {isDataSyncing && <div className="flex items-center gap-1 text-xs text-teal-600 font-bold bg-teal-50 px-2 py-1 rounded"><Loader2 size={12} className="animate-spin"/> 同步中</div>}
            
            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200 w-full sm:w-auto justify-between sm:justify-start">
                <select 
                    className="bg-transparent text-sm font-medium text-slate-700 outline-none px-2 py-1 flex-1 sm:flex-none sm:w-32"
                    value={exportDoctorId}
                    onChange={e => setExportDoctorId(e.target.value)}
                >
                    <option value="all">全體醫師</option>
                    {activeDoctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                
                <div className="flex items-center">
                    <button 
                        onClick={handleExportICS}
                        className="px-3 py-1.5 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors flex items-center gap-2 whitespace-nowrap text-sm font-medium"
                        title="匯出行事曆 (ICS)"
                    >
                        <Download size={16} /> <span className="hidden sm:inline">匯出</span>
                    </button>
                    <div className="w-px h-6 bg-slate-200 mx-2"></div>
                    <button 
                        onClick={() => setIsHelpModalOpen(true)}
                        className="p-1.5 text-slate-400 hover:text-teal-600 transition-colors rounded-full hover:bg-teal-50"
                        title="如何匯入日曆？"
                    >
                        <HelpCircle size={18} />
                    </button>
                </div>
            </div>

            {/* Preview & Publish Button */}
            <button
                onClick={() => setShowPublishModal(true)}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg shadow-md transition-all active:scale-95 w-full sm:w-auto justify-center"
            >
                <ImageIcon size={18} />
                <span className="hidden sm:inline">預覽與發布</span>
                <span className="sm:hidden">發布</span>
            </button>
         </div>
       </div>

       {/* Calendar Grid Wrapper */}
       <div className="bg-transparent md:bg-white md:rounded-xl md:shadow-lg md:border md:border-slate-200 overflow-hidden">
          {/* Responsive Scroll Container for Desktop */}
          <div className="md:overflow-x-auto">
              <div className="md:min-w-[1100px]">
                  {/* Header (Desktop Only) */}
                  <div className="hidden md:grid grid-cols-7 bg-slate-50 border-b border-slate-200">
                     {['週日', '週一', '週二', '週三', '週四', '週五', '週六'].map(d => (
                         <div key={d} className="py-3 text-center text-sm font-bold text-slate-500">{d}</div>
                     ))}
                  </div>
                  
                  {/* Body (List on Mobile, Grid on Desktop) */}
                  <div className="flex flex-col gap-4 md:gap-0 md:grid md:grid-cols-7 md:auto-rows-fr">
                     {blanks.map((_, i) => <div key={`blank-${i}`} className="hidden md:block h-32 bg-slate-50/50 border-b border-r border-slate-100"></div>)}
                     
                     {days.map(day => {
                         const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                         const schedule = schedules.find(s => s.date === dateStr && s.clinicId === selectedClinicId);
                         const isClosed = schedule?.isClosed;
                         
                         const dateObj = new Date(year, month, day);
                         const dayOfWeekStr = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][dateObj.getDay()];

                         // Consolidate Doctor Shifts
                         const doctorMap = new Map<string, Set<ShiftType>>();
                         if (schedule && !isClosed) {
                             SHIFTS.forEach(shift => {
                                 const shiftList = schedule.shifts[shift] || [];
                                 shiftList.forEach(docId => {
                                     if (!doctorMap.has(docId)) doctorMap.set(docId, new Set());
                                     doctorMap.get(docId)?.add(shift);
                                 });
                             });
                         }

                         return (
                             <div 
                                key={day} 
                                onClick={() => openDayEditor(day)}
                                className={`
                                    relative cursor-pointer transition-all group
                                    w-full h-auto p-4 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col gap-2
                                    md:w-auto md:min-h-[140px] md:h-auto md:p-2 md:rounded-none md:shadow-none md:border-0 md:border-b md:border-r md:border-slate-100 md:block md:gap-0
                                    
                                    ${isClosed ? 'bg-slate-50 md:bg-slate-50' : 'hover:border-blue-400 md:hover:bg-blue-50/50'}
                                `}
                             >
                                {/* Mobile Date Header */}
                                <div className="flex md:hidden items-center justify-between border-b border-slate-100 pb-2 mb-1">
                                    <span className="font-bold text-slate-800 text-lg">
                                        {month + 1}/{day} <span className="text-sm font-normal text-slate-500 ml-1">{dayOfWeekStr}</span>
                                    </span>
                                    {isClosed && <span className="text-xs font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded">休診</span>}
                                </div>

                                {/* Desktop Date Number */}
                                <span className={`hidden md:block text-sm font-medium mb-1 ${isClosed ? 'text-slate-400' : 'text-slate-700'}`}>{day}</span>
                                
                                {/* Desktop Closed Overlay */}
                                {schedule && isClosed && (
                                    <div className="hidden md:flex absolute inset-0 items-center justify-center pointer-events-none">
                                        <span className="text-rose-500 font-bold text-xl tracking-widest">休診</span>
                                    </div>
                                )}
                                
                                {/* Content */}
                                {schedule && !isClosed && (
                                    <div className="flex flex-col gap-1">
                                        {Array.from(doctorMap.entries()).map(([docId, shifts]) => {
                                            const doc = doctors.find(d => d.id === docId);
                                            if (!doc) return null;
                                            
                                            const activeShifts = SHIFTS.filter(s => shifts.has(s));

                                            return (
                                                <div key={docId} className="flex items-center gap-1.5 w-full p-0.5 rounded hover:bg-slate-100/50 transition-colors">
                                                    <div className="w-12 shrink-0 flex justify-end gap-0.5">
                                                        {activeShifts.map(shift => (
                                                            <span 
                                                                key={shift}
                                                                className="rounded-sm px-1 py-[1px] text-[10px] font-bold text-white leading-tight"
                                                                style={{ backgroundColor: shiftColors[shift] }}
                                                            >
                                                                {SHIFT_BADGE_TEXT[shift]}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <div className="shrink-0">
                                                        <DoctorAvatar doctor={doc} size="sm" />
                                                    </div>
                                                    <span className="flex-1 text-sm font-bold text-slate-700 truncate text-left">
                                                        {doc.name}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                
                                {schedule && !isClosed && doctorMap.size === 0 && (
                                    <div className="md:hidden text-slate-400 italic text-sm">暫無排班</div>
                                )}

                                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded hidden md:block">編輯</div>
                             </div>
                         );
                     })}
                  </div>
              </div>
          </div>
       </div>

       {/* Day Editor Modal */}
       {editingSchedule && (
           <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[85vh] animate-slide-down">
                   {/* Header */}
                   <div className="bg-slate-800 text-white p-4 flex justify-between items-center shrink-0 rounded-t-2xl">
                       <h3 className="text-lg font-bold">編輯排班: {editingSchedule.date}</h3>
                       <button onClick={() => setEditingSchedule(null)} className="hover:text-rose-300 transition-colors" disabled={isSaving}><X /></button>
                   </div>
                   
                   {/* Body (Scrollable) */}
                   <div className="p-6 overflow-y-auto flex-1 bg-slate-50">
                       <div className="flex items-center justify-between mb-6 p-3 bg-white rounded-lg border border-slate-200 shadow-sm">
                           <span className="font-bold text-slate-700">當日狀態</span>
                           <button 
                                onClick={() => setEditingSchedule({...editingSchedule, isClosed: !editingSchedule.isClosed})}
                                className={`px-4 py-1.5 rounded-lg font-bold transition-colors text-sm shadow-sm ${editingSchedule.isClosed ? 'bg-rose-50 text-white hover:bg-rose-600' : 'bg-emerald-50 text-white hover:bg-emerald-600'}`}
                                disabled={isSaving}
                           >
                               {editingSchedule.isClosed ? '休診' : '營業'}
                           </button>
                       </div>

                       {!editingSchedule.isClosed && (
                           <div className="space-y-3">
                               {SHIFTS.map(shift => (
                                   <ShiftEditorSection 
                                       key={shift}
                                       label={dynamicShiftLabels[shift]}
                                       color={shiftColors[shift]}
                                       doctors={doctors.filter(d => d.clinicId === selectedClinicId)}
                                       selectedDocIds={editingSchedule.shifts[shift] || []}
                                       onToggle={(docId) => toggleDoctorInShift(shift, docId)}
                                   />
                               ))}
                           </div>
                       )}
                   </div>
                   
                   {/* Footer (Fixed) */}
                   <div className="bg-white p-4 flex justify-end gap-3 border-t border-slate-100 shrink-0 rounded-b-2xl">
                       <button 
                            onClick={() => setEditingSchedule(null)}
                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium"
                            disabled={isSaving}
                       >
                           取消
                       </button>
                       <button 
                            onClick={saveDayEditor} 
                            disabled={isSaving}
                            className="bg-slate-900 text-white px-6 py-2 rounded-lg hover:bg-slate-800 font-bold shadow-md transition-transform active:scale-95 flex items-center gap-2"
                       >
                           {isSaving && <Loader2 size={16} className="animate-spin" />}
                           {isSaving ? '儲存中...' : '儲存變更'}
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Help / Instruction Modal */}
       {isHelpModalOpen && (
           <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
               <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] animate-slide-down overflow-hidden">
                   <div className="bg-slate-800 text-white p-4 flex justify-between items-center shrink-0">
                       <h3 className="text-lg font-bold flex items-center gap-2">
                           <HelpCircle size={20} /> 
                           如何將班表匯入 Google 日曆？
                       </h3>
                       <button onClick={() => setIsHelpModalOpen(false)} className="hover:text-rose-300 transition-colors"><X /></button>
                   </div>
                   
                   <div className="overflow-y-auto bg-slate-50 p-4">
                        <img 
                            src="https://firebasestorage.googleapis.com/v0/b/sunlight-schedule-data.firebasestorage.app/o/image%2Fics-guide.jpg?alt=media" 
                            alt="匯入說明" 
                            className="w-full h-auto rounded-lg shadow-sm border border-slate-200"
                        />
                   </div>
                   
                   <div className="bg-white p-4 border-t border-slate-100 flex justify-end shrink-0">
                       <button 
                           onClick={() => setIsHelpModalOpen(false)}
                           className="bg-slate-900 text-white px-6 py-2 rounded-lg hover:bg-slate-800 transition-colors"
                       >
                           了解
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Publish & Preview Modal */}
       <PublishModal 
            isOpen={showPublishModal}
            onClose={() => setShowPublishModal(false)}
            clinic={selectedClinic}
            doctors={doctors}
            schedules={schedules}
            year={year}
            month={month}
       />
    </div>
  );
};