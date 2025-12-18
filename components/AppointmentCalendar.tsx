
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clinic, Doctor, DailySchedule, Consultant, StaffScheduleConfig, Laboratory } from '../types';
import { listEvents, initGoogleClient, authorizeCalendar, getConnectedCalendarEmail } from '../services/googleCalendar';
import { parseCalendarEvent } from '../utils/eventParser';
import { Patient, db } from '../services/firebase';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, RefreshCw, Building2, Filter, Briefcase, Check, LayoutGrid, Columns, Search, PlugZap } from 'lucide-react';
import { StaffScheduleModal } from './StaffScheduleModal';
import { PatientHistoryModal } from './PatientHistoryModal';
import { PatientSearch } from './PatientSearch';
import { ClinicSelector } from './ClinicSelector';
import { useClinic } from '../contexts/ClinicContext';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
  consultants?: Consultant[];
  laboratories?: Laboratory[];
  schedules?: DailySchedule[];
  onSave?: (schedules: DailySchedule[]) => Promise<void>;
}

interface AppEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  doctorId: string;
  color: string;
  allDay: boolean;
  calendarId?: string; 
}

interface VisualEvent extends AppEvent {
  style: React.CSSProperties;
}

const START_HOUR = 8;
const END_HOUR = 22; // 10 PM
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => i + START_HOUR);
const HOUR_HEIGHT = 80; // px
const CLINIC_SHARED_ID = 'clinic_shared';
const COLUMN_MIN_WIDTH = 200; 
const COLUMN_WIDTH_STYLE = { width: `${COLUMN_MIN_WIDTH}px`, minWidth: `${COLUMN_MIN_WIDTH}px` };

// Layer Heights for Sticky Calculation
const HEADER_HEIGHT = 60; // Layer 1 Height
const ASSISTANT_ROW_HEIGHT = 48; // Layer 2 Height (Minimum)

// Helper: Securely format date to YYYY-MM-DD in Local Time
const toLocalISODate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const WEEKDAYS_ZH = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export const AppointmentCalendar: React.FC<Props> = ({ clinics, doctors, consultants = [], laboratories = [], schedules: propsSchedules = [], onSave }) => {
  const navigate = useNavigate();
  // Global Clinic State
  const { selectedClinicId, selectedClinic } = useClinic();
  
  // Initialize to strictly midnight local time of today
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  const [events, setEvents] = useState<AppEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGapiReady, setIsGapiReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Real-time local state for the specific clinic's schedules
  const [realtimeSchedules, setRealtimeSchedules] = useState<DailySchedule[]>([]);

  // --- View & Filter State ---
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'search'>('day');
  const [showPublicEvents, setShowPublicEvents] = useState(true);

  // New Filter Logic: Exclusive Selection
  const [exclusiveDoctorId, setExclusiveDoctorId] = useState<string | null>(null);
  const [showAllDoctors, setShowAllDoctors] = useState(false); 
  
  // --- Modals ---
  const [editingStaffDate, setEditingStaffDate] = useState<string | null>(null);
  
  // History Modal State
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Time Line State
  const [now, setNow] = useState(new Date());
  
  const scrollContainerRef = useRef<HTMLDivElement>(null); 
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Filter resources based on global selectedClinicId
  const activeClinicDocs = doctors.filter(d => d.clinicId === selectedClinicId);
  const activeClinicStaff = consultants.filter(c => c.clinicId === selectedClinicId);

  // Split Staff into Groups
  const groupA = activeClinicStaff.filter(c => !c.role || c.role === 'consultant' || c.role === 'assistant');
  const groupB = activeClinicStaff.filter(c => c.role === 'part_time');

  // Lookup Helper
  const getStaffName = (id: string) => {
    const staff = consultants.find(c => c.id === id);
    return staff ? staff.name : id;
  };

  // --- Real-time Schedule Listener ---
  useEffect(() => {
    if (!selectedClinicId) {
        setRealtimeSchedules([]);
        return;
    }

    const unsubscribe = db.collection('clinics').doc(selectedClinicId)
      .onSnapshot((doc) => {
        if (doc.exists) {
          const data = doc.data();
          setRealtimeSchedules(data?.schedules || []);
        }
      }, (error) => {
        console.error("Schedule listener error:", error);
      });

    return () => unsubscribe();
  }, [selectedClinicId]);

  // 1. Init Google Client
  useEffect(() => {
    initGoogleClient(
      () => setIsGapiReady(true),
      (status) => {
        setIsLoggedIn(status);
        if (!status) {
           // Connection lost or not init
           setConnectedEmail(null);
        } else {
           setErrorMsg(null);
           getConnectedCalendarEmail().then(email => setConnectedEmail(email));
        }
      }
    );
  }, []);

  // 2. Timer for "Current Time" line
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  // Helper: Get Week Days (Monday start)
  const getWeekDays = (baseDate: Date) => {
    const start = new Date(baseDate);
    const day = start.getDay(); // 0 (Sun) to 6 (Sat)
    const diff = day === 0 ? 6 : day - 1; // Mon=0 ... Sun=6
    start.setDate(start.getDate() - diff);
    start.setHours(0,0,0,0);
    return Array.from({length: 7}, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
    });
  };

  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate]);

  // 3. Auto-Scroll to Now logic
  useEffect(() => {
    const timer = setTimeout(() => {
        if (scrollContainerRef.current) {
            const today = new Date();
            const isToday = today.toDateString() === currentDate.toDateString();
            
            // Only scroll in Day view or if today is in the current week view
            const currentWeekDays = getWeekDays(currentDate);
            const isTodayInWeek = viewMode === 'week' && currentWeekDays.some(d => d.toDateString() === today.toDateString());

            if (isToday || isTodayInWeek) {
                const currentHour = today.getHours();
                if (currentHour >= START_HOUR && currentHour <= END_HOUR) {
                    const top = ((currentHour - START_HOUR) + today.getMinutes() / 60) * HOUR_HEIGHT;
                    // Adjust scroll considering the sticky headers (Layer 1 + Layer 2)
                    // Roughly 60 + 48 = 108px offset
                    const stickyOffset = HEADER_HEIGHT + ASSISTANT_ROW_HEIGHT;
                    scrollContainerRef.current.scrollTo({ 
                        top: Math.max(0, top - 120 + stickyOffset), // -120 to show a bit before
                        behavior: 'smooth' 
                    });
                }
            }
        }
    }, 800);
    return () => clearInterval(timer);
  }, [currentDate, viewMode]);

  // 4. Fetch Events
  const fetchEvents = async () => {
    if (viewMode === 'search') return;

    const mapping = selectedClinic?.googleCalendarMapping;
    if (!mapping) {
        if (events.length > 0) setEvents([]);
        return;
    }

    if (!isGapiReady || !isLoggedIn) return;

    setIsLoading(true);
    setErrorMsg(null);
    
    try {
        let start = new Date(currentDate); 
        let end = new Date(currentDate);
        
        if (viewMode === 'week') {
            const days = getWeekDays(currentDate);
            start = days[0];
            end = days[6];
        }
        
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        
        const linkedDocs = activeClinicDocs.filter(doc => !!mapping[doc.id]);

        const promises = linkedDocs.map(async (doc) => {
            const calendarId = mapping[doc.id];
            const googleEvents = await listEvents(calendarId, start, end);
            return googleEvents.map(ev => ({
                id: ev.id,
                title: ev.summary,
                start: ev.start.dateTime ? new Date(ev.start.dateTime) : (ev.start.date ? new Date(ev.start.date) : new Date()),
                end: ev.end.dateTime ? new Date(ev.end.dateTime) : (ev.end.date ? new Date(ev.end.date) : new Date()),
                doctorId: doc.id,
                color: doc.avatarBgColor || doc.color || '#3b82f6',
                allDay: ev.allDay ?? !ev.start.dateTime,
                calendarId: calendarId
            }));
        });

        const clinicCalId = mapping[CLINIC_SHARED_ID];
        if (clinicCalId) {
             promises.push((async () => {
                 const googleEvents = await listEvents(clinicCalId, start, end);
                 return googleEvents.map(ev => ({
                    id: ev.id,
                    title: ev.summary,
                    start: ev.start.dateTime ? new Date(ev.start.dateTime) : (ev.start.date ? new Date(ev.start.date) : new Date()),
                    end: ev.end.dateTime ? new Date(ev.end.dateTime) : (ev.end.date ? new Date(ev.end.date) : new Date()),
                    doctorId: CLINIC_SHARED_ID,
                    color: '#64748b', 
                    allDay: ev.allDay ?? !ev.start.dateTime,
                    calendarId: clinicCalId
                 }));
             })());
        }

        const results = await Promise.all(promises);
        setEvents(results.flat());
    } catch (e: any) {
        console.error(e);
        if (e.result?.error?.code === 401 || e.status === 401) {
            setErrorMsg("Google 授權已過期，請重新登入");
            setIsLoggedIn(false);
        } else {
            setErrorMsg("無法讀取日曆資料");
        }
    } finally {
        setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [selectedClinicId, currentDate, isGapiReady, isLoggedIn, viewMode]);

  const handleDateChange = (offset: number) => {
    const newDate = new Date(currentDate);
    const jump = viewMode === 'week' ? offset * 7 : offset;
    newDate.setDate(newDate.getDate() + jump);
    newDate.setHours(0, 0, 0, 0);
    setCurrentDate(newDate);
  };

  const handleJumpToToday = () => {
    const now = new Date();
    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  };

  const handleSetViewMode = (mode: 'day' | 'week' | 'search') => {
      setViewMode(mode);
  };

  // --- CRM INTEGRATION: OPEN HISTORY ---
  const handleSelectEvent = (event: AppEvent) => {
      const parsed = parseCalendarEvent(event.title);
      // Construct a temporary patient object for history lookup
      // If parsing fails, we use the raw title as name (better than nothing)
      const name = parsed ? parsed.name : event.title;
      
      const tempPatient: Patient = {
          docId: 'temp_calendar_view', // Placeholder, only need clinicId/chartId/name for history
          clinicId: selectedClinicId,
          chartId: parsed?.chartId || null,
          name: name,
          lastVisit: toLocalISODate(event.start)
      };

      setSelectedPatient(tempPatient);
      setIsHistoryOpen(true);
  };

  // --- Filtering Logic ---
  const activeDocIdsInView = useMemo(() => {
    const todayStr = toLocalISODate(currentDate);
    const relevantEvents = events.filter(e => {
         if (viewMode === 'week') return true; 
         if (e.allDay) return true;
         return toLocalISODate(e.start) === todayStr;
    });
    const ids = new Set(relevantEvents.map(e => e.doctorId));
    return Array.from(ids);
  }, [events, currentDate, viewMode]);

  const chipDoctors = useMemo(() => {
     if (showAllDoctors) return activeClinicDocs;
     return activeClinicDocs.filter(d => activeDocIdsInView.includes(d.id));
  }, [showAllDoctors, activeClinicDocs, activeDocIdsInView]);

  const visibleDoctors = useMemo(() => {
    if (exclusiveDoctorId) {
        const doc = activeClinicDocs.find(d => d.id === exclusiveDoctorId);
        return doc ? [doc] : [];
    }
    return chipDoctors;
  }, [exclusiveDoctorId, chipDoctors, activeClinicDocs]);

  const handleChipClick = (id: string) => {
    if (exclusiveDoctorId === id) {
        setExclusiveDoctorId(null); 
    } else {
        setExclusiveDoctorId(id); 
    }
  };

  // --- Visual Calculations ---
  const getVisualEvents = (dayEvents: AppEvent[], isAllDayRow: boolean = false): VisualEvent[] => {
      const relevantEvents = isAllDayRow 
        ? dayEvents.filter(e => e.allDay)
        : dayEvents.filter(e => !e.allDay);

      if (relevantEvents.length === 0) return [];

      if (isAllDayRow) {
          return relevantEvents.map((ev, idx) => ({
              ...ev,
              style: {
                  position: 'relative',
                  marginBottom: '2px',
                  minHeight: '24px',
                  marginLeft: '2px',
                  marginRight: '2px',
              }
          }));
      }

      const sortedTimed = [...relevantEvents].sort((a, b) => {
          if (a.start.getTime() !== b.start.getTime()) return a.start.getTime() - b.start.getTime();
          return b.end.getTime() - a.end.getTime();
      });

      const computedTimed = sortedTimed.map(ev => {
          const startHour = ev.start.getHours();
          const startMin = ev.start.getMinutes();
          const endHour = ev.end.getHours();
          const endMin = ev.end.getMinutes();

          const startPos = (startHour - START_HOUR) + (startMin / 60);
          const endPos = (endHour - START_HOUR) + (endMin / 60);
          
          const top = Math.max(0, startPos * HOUR_HEIGHT);
          const height = Math.max(24, (endPos - startPos) * HOUR_HEIGHT); 

          return {
              ...ev, top, height,
              startMs: ev.start.getTime(),
              endMs: ev.end.getTime(),
              colIndex: 0, 
              style: { top: `${top}px`, height: `${height}px`, position: 'absolute' } as React.CSSProperties
          };
      });

      const columns: typeof computedTimed[] = [];
      computedTimed.forEach(ev => {
          let placed = false;
          for (let i = 0; i < columns.length; i++) {
              const col = columns[i];
              const lastInCol = col[col.length - 1];
              if (ev.startMs >= lastInCol.endMs) {
                  col.push(ev);
                  ev.colIndex = i;
                  placed = true;
                  break;
              }
          }
          if (!placed) {
              columns.push([ev]);
              ev.colIndex = columns.length - 1;
          }
      });

      computedTimed.forEach(ev => {
          const overlaps = computedTimed.filter(other => 
              ev.id !== other.id && 
              Math.max(ev.startMs, other.startMs) < Math.min(ev.endMs, other.endMs)
          );
          let maxCol = ev.colIndex;
          overlaps.forEach(o => maxCol = Math.max(maxCol, o.colIndex));
          const totalCols = maxCol + 1;
          
          ev.style = {
              ...ev.style,
              width: `${100 / totalCols}%`,
              left: `${(ev.colIndex / totalCols) * 100}%`
          };
      });

      return computedTimed;
  };

  const getStaffStatusString = (date: Date) => {
      const dateStr = toLocalISODate(date);
      // Use realtimeSchedules instead of prop to ensure UI stays synced
      const schedule = realtimeSchedules.find(s => s.date === dateStr);
      
      let config: StaffScheduleConfig;

      if (schedule?.staffConfiguration) {
          config = schedule.staffConfiguration;
      } else if (schedule?.consultantOffs) {
          const off = schedule.consultantOffs.filter(id => groupA.some(s => s.id === id));
          const work = groupB.filter(s => !schedule.consultantOffs?.includes(s.id)).map(s => s.id);
          config = { off, leave: [], work };
      } else {
          config = { off: [], leave: [], work: [] };
      }

      const offNames = groupA.filter(s => config.off.includes(s.id)).map(s => s.name);
      const leaveNames = config.leave.map(l => {
          const staff = activeClinicStaff.find(s => s.id === l.id);
          return staff ? staff.name : '';
      }).filter(n => n);
      const workNames = groupB.filter(s => config.work.includes(s.id)).map(s => s.name);

      const parts = [];
      if (offNames.length > 0) parts.push(`[休]-${offNames.join('、')}`);
      if (leaveNames.length > 0) parts.push(`[假]-${leaveNames.join('、')}`);
      if (workNames.length > 0) parts.push(`[打工]-${workNames.join('、')}`);

      return parts.length > 0 ? parts.join(' ') : '全員上班';
  };

  const todayStr = toLocalISODate(currentDate);

  const triggerDatePicker = () => {
      if (dateInputRef.current) {
          try {
              dateInputRef.current.showPicker();
          } catch (e) {
              dateInputRef.current.click();
          }
      }
  };
  
  const shouldShowPublicColumn = showPublicEvents || activeClinicStaff.length > 0;

  return (
    <div className="flex flex-col h-full space-y-4">
        {/* TOP BAR */}
        <div className="flex flex-col xl:flex-row items-center justify-between gap-4 bg-white p-3 rounded-xl shadow-sm border border-slate-200 shrink-0 relative">
            
            {/* LEFT GROUP: Title, Clinic, View Switcher */}
            <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
                 <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
                     <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hidden md:block">
                            <CalendarIcon size={20} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-800 leading-tight">約診日曆</h1>
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                                <span className="font-medium text-slate-400">診所:</span>
                                <ClinicSelector />
                            </div>
                        </div>
                     </div>
                 </div>

                 <div className="flex bg-slate-100 rounded-lg p-1 shadow-inner w-full md:w-auto">
                    <button 
                        onClick={() => handleSetViewMode('day')}
                        className={`flex-1 md:flex-none px-4 py-1.5 text-sm font-bold rounded-md flex items-center justify-center gap-2 transition-all ${viewMode === 'day' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <Columns size={16} /> 日檢視
                    </button>
                    <button 
                        onClick={() => handleSetViewMode('week')}
                        className={`flex-1 md:flex-none px-4 py-1.5 text-sm font-bold rounded-md flex items-center justify-center gap-2 transition-all ${viewMode === 'week' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <LayoutGrid size={16} /> 週檢視
                    </button>
                    <button 
                        onClick={() => handleSetViewMode('search')}
                        className={`flex-1 md:flex-none px-4 py-1.5 text-sm font-bold rounded-md flex items-center justify-center gap-2 transition-all ${viewMode === 'search' ? 'bg-white shadow text-teal-600' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <Search size={16} /> 病歷搜尋
                    </button>
                </div>
            </div>

            {/* RIGHT GROUP: Date Navigation & Actions */}
            <div className="flex items-center gap-2 w-full xl:w-auto justify-between xl:justify-end">
                {viewMode !== 'search' ? (
                    <>
                        <div className="flex items-center bg-slate-100 rounded-lg p-1 flex-1 xl:flex-none justify-between xl:justify-start">
                            <button onClick={() => handleDateChange(-1)} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500 transition-all"><ChevronLeft size={20}/></button>
                            <div 
                                className="relative flex items-center justify-center cursor-pointer hover:bg-white hover:shadow-sm rounded px-3 py-1 transition-all group flex-1 xl:flex-none xl:min-w-[140px]"
                                onClick={triggerDatePicker}
                                title="點擊選擇日期"
                            >
                                <input 
                                    ref={dateInputRef}
                                    type="date" 
                                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10"
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            const [y, m, d] = e.target.value.split('-').map(Number);
                                            const newDate = new Date(y, m - 1, d);
                                            setCurrentDate(newDate);
                                        }
                                    }}
                                />
                                <span className="font-mono font-bold text-slate-700 text-base text-center w-full">
                                    {viewMode === 'day' ? todayStr : `${toLocalISODate(weekDays[0])} - ${toLocalISODate(weekDays[6]).slice(5)}`}
                                </span>
                            </div>
                            <button onClick={() => handleDateChange(1)} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500 transition-all"><ChevronRight size={20}/></button>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Connected Email Badge */}
                            {connectedEmail && (
                                <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100 font-medium">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                    {connectedEmail}
                                </span>
                            )}

                            <button 
                                onClick={handleJumpToToday}
                                className="px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                            >
                                今日
                            </button>
                            
                            <button 
                                onClick={() => fetchEvents()} 
                                disabled={isLoading}
                                className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-full transition-colors"
                                title="重新整理"
                            >
                                <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </>
                ) : (
                    <div />
                )}
            </div>

            {errorMsg && (
                <div className="absolute top-full right-0 mt-2 bg-rose-50 border border-rose-200 text-rose-600 px-4 py-2 rounded-lg flex items-center gap-2 text-sm z-50 shadow-md">
                    {errorMsg}
                </div>
            )}
        </div>

        {/* CONTAINER FOR FILTER + GRID + OVERLAY */}
        {viewMode === 'search' ? (
            <PatientSearch 
                doctors={activeClinicDocs} 
                mapping={selectedClinic?.googleCalendarMapping || {}}
                onEventClick={(ev) => handleSelectEvent(ev)}
            />
        ) : (
            <div className="flex-1 relative flex flex-col gap-4 min-h-0">
                
                {isGapiReady && !isLoggedIn && (
                    <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 rounded-xl animate-fade-in">
                        <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-inner ring-4 ring-white">
                            <PlugZap size={48} className="text-slate-300" />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-800 mb-3">尚未連結 Google 日曆</h3>
                        <p className="text-slate-500 max-w-md mb-8 leading-relaxed">
                            請先完成帳號連動，系統才能讀取並顯示醫師的約診資訊。
                        </p>
                        <button 
                            onClick={authorizeCalendar}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all flex items-center gap-2 active:scale-95"
                        >
                            連結 Google Calendar
                        </button>
                    </div>
                )}

                {/* FILTER BAR */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 shrink-0 flex flex-wrap gap-2 items-center">
                    <div className="flex items-center gap-2 text-sm text-slate-600 mr-2">
                        <Filter size={18} className="text-slate-400" />
                        <span className="font-bold">篩選:</span>
                    </div>
                    
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors mr-3 border-r border-slate-200 pr-3">
                        <input 
                            type="checkbox" 
                            checked={showAllDoctors}
                            onChange={(e) => setShowAllDoctors(e.target.checked)}
                            className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 border-gray-300"
                        />
                        顯示無診醫師
                    </label>

                    <button
                        onClick={() => setShowPublicEvents(!showPublicEvents)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border transition-all ${showPublicEvents ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                    >
                        {showPublicEvents ? <Check size={12} className="stroke-[3]" /> : <div className="w-3 h-3 rounded-sm border border-slate-300"></div>}
                        公用事項
                    </button>

                    <div className="w-px h-6 bg-slate-200 mx-1"></div>

                    <div className="flex-1 flex flex-wrap gap-2 items-center">
                            {chipDoctors.map(doc => {
                                const isExclusive = exclusiveDoctorId === doc.id;
                                const isDimmed = exclusiveDoctorId !== null && !isExclusive;
                                const isActiveInView = activeDocIdsInView.includes(doc.id);

                                return (
                                    <button
                                    key={doc.id}
                                    onClick={() => handleChipClick(doc.id)}
                                    className={`
                                        flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all
                                        ${isExclusive
                                            ? 'bg-teal-600 border-teal-600 text-white shadow-md transform scale-105' 
                                            : isDimmed
                                                ? 'bg-slate-50 border-slate-200 text-slate-300'
                                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                                        }
                                    `}
                                    >
                                        <div 
                                        className={`w-2 h-2 rounded-full ${isExclusive ? 'ring-2 ring-white/50' : ''}`}
                                        style={{ backgroundColor: isExclusive ? '#ffffff' : (doc.avatarBgColor || doc.color) }}
                                        />
                                        {doc.name}
                                        {isActiveInView && !isExclusive && <span className="w-1.5 h-1.5 bg-green-500 rounded-full ml-0.5" title="有診"></span>}
                                    </button>
                                );
                            })}
                            
                            {chipDoctors.length === 0 && !showAllDoctors && (
                                <span className="text-xs text-slate-400 italic px-2">本區間無醫師有診</span>
                            )}
                    </div>
                </div>

                {/* MAIN CALENDAR CONTAINER (Shared Scroll) */}
                <div 
                    className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-auto relative custom-scrollbar flex flex-col"
                    ref={scrollContainerRef}
                >
                    <div className="min-w-max relative flex flex-col">
                        
                        {/* --- LAYER 1: HEADER ROW (Sticky Top 0) --- */}
                        <div 
                            className="flex border-b border-slate-200 bg-slate-50 sticky top-0 z-[50] shadow-sm"
                            style={{ height: HEADER_HEIGHT }}
                        >
                            {/* Time Spacer (Sticky Left) */}
                            <div className="sticky left-0 z-[60] w-16 shrink-0 border-r border-slate-200 bg-slate-50"></div>
                            
                            {/* DAY VIEW HEADERS */}
                            {viewMode === 'day' ? (
                                <>
                                    {/* Public / Assistant Header */}
                                    {shouldShowPublicColumn && (
                                        <div 
                                            className="p-2 text-center border-r border-slate-200 bg-slate-50 flex items-center justify-center gap-2 text-slate-600 font-bold text-sm shrink-0"
                                            style={COLUMN_WIDTH_STYLE}
                                        >
                                            <Building2 size={16} /> 公用事項
                                        </div>
                                    )}

                                    {/* Doctor Headers */}
                                    {visibleDoctors.map(doc => (
                                        <div 
                                            key={doc.id} 
                                            className="p-2 text-center border-r border-slate-200 last:border-0 bg-white shrink-0"
                                            style={COLUMN_WIDTH_STYLE}
                                        >
                                            <div className="inline-flex flex-col items-center justify-center h-full"><div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm mb-1" style={{ backgroundColor: doc.avatarBgColor || doc.color || '#3b82f6' }}>{doc.avatarText || doc.name.charAt(0)}</div><span className="text-sm font-bold text-slate-700 truncate max-w-[140px]">{doc.name}</span></div>
                                        </div>
                                    ))}
                                </>
                            ) : (
                                /* WEEK VIEW HEADERS */
                                weekDays.map(date => {
                                    const isToday = date.toDateString() === new Date().toDateString();
                                    const dateLabel = `${date.getMonth() + 1}/${date.getDate()}`;
                                    const dayLabel = WEEKDAYS_ZH[date.getDay()];

                                    return (
                                        <div 
                                            key={date.toISOString()}
                                            className={`p-2 text-center border-r border-slate-200 bg-white shrink-0 flex flex-col items-center justify-center ${isToday ? 'bg-blue-50/50' : ''}`}
                                            style={{ flex: 1, minWidth: '120px' }}
                                        >
                                            <div className={`text-sm font-bold ${isToday ? 'text-blue-600' : 'text-slate-700'}`}>{dateLabel}</div>
                                            <div className={`text-xs ${isToday ? 'text-blue-500' : 'text-slate-500'}`}>{dayLabel}</div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* --- LAYER 2: ASSISTANT ROW (Sticky Top 60px) --- */}
                        <div 
                            className="flex border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm sticky z-[40]"
                            style={{ top: HEADER_HEIGHT, minHeight: ASSISTANT_ROW_HEIGHT }}
                        >
                            {/* Assistant Label (Sticky Left) */}
                            <div 
                                className="sticky left-0 z-[60] w-16 shrink-0 border-r border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400 font-bold border-b border-slate-200"
                            >
                                <span className="rotate-0">人員</span>
                            </div>

                            {/* DAY VIEW ASSISTANT ROW (Full Width Span) */}
                            {viewMode === 'day' ? (
                                <div className="flex-1 flex items-center px-4 bg-white/50">
                                    {activeClinicStaff.length > 0 ? (
                                        <div className="flex items-center gap-3 w-full">
                                            <button
                                                onClick={() => setEditingStaffDate(toLocalISODate(currentDate))}
                                                className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors text-xs font-bold border border-indigo-200 shadow-sm whitespace-nowrap"
                                                title="設定人員排班"
                                            >
                                                <Briefcase size={14} />
                                                排班設定
                                            </button>
                                            <div className="text-sm font-medium text-slate-600 flex-1 truncate">
                                                {getStaffStatusString(currentDate)}
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-slate-400 italic">無人員資料</span>
                                    )}
                                </div>
                            ) : (
                                /* WEEK VIEW ASSISTANT CELLS (One per day) */
                                weekDays.map(date => {
                                    const dateStr = toLocalISODate(date);
                                    const isToday = date.toDateString() === new Date().toDateString();
                                    const statusStr = getStaffStatusString(date);
                                    const hasStaff = activeClinicStaff.length > 0;

                                    return (
                                        <div 
                                            key={date.toISOString()} 
                                            className={`border-r border-slate-200 shrink-0 p-1 flex flex-col items-center justify-center gap-1 ${isToday ? 'bg-blue-50/20' : 'bg-white'}`}
                                            style={{ flex: 1, minWidth: '120px' }}
                                        >
                                            {hasStaff && (
                                                <div className="flex items-center gap-1 w-full justify-center">
                                                    <button
                                                        onClick={() => setEditingStaffDate(dateStr)}
                                                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600 transition-colors shrink-0"
                                                    >
                                                        <Briefcase size={12} />
                                                    </button>
                                                    <div className="text-[10px] leading-tight truncate font-bold text-slate-600" title={statusStr}>
                                                        {statusStr === '全員上班' ? <span className="text-emerald-600">全勤</span> : statusStr}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* --- LAYER 3: ALL-DAY ROW (Scrolls Vertically) --- */}
                        <div className="flex border-b border-slate-200 bg-white min-h-[32px]">
                            {/* Label (Sticky Left) */}
                            <div className="sticky left-0 z-[30] w-16 shrink-0 border-r border-slate-200 bg-white flex items-center justify-center text-xs text-slate-400 font-medium">
                                全日
                            </div>
                            
                            {/* DAY VIEW ALL-DAY EVENTS */}
                            {viewMode === 'day' ? (
                                <>
                                    {/* Public All Day */}
                                    {shouldShowPublicColumn && (
                                        <div className="border-r border-slate-200 shrink-0 p-1 bg-slate-50/30" style={COLUMN_WIDTH_STYLE}>
                                            {showPublicEvents && getVisualEvents(events.filter(e => e.doctorId === CLINIC_SHARED_ID), true).map(ev => (
                                                <div 
                                                    key={ev.id} 
                                                    onClick={() => handleSelectEvent(ev)}
                                                    className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded border border-slate-300 truncate mb-1 cursor-pointer hover:bg-slate-300 transition-colors" 
                                                    title={ev.title}
                                                >
                                                    {ev.title}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {/* Doctor All Day */}
                                    {visibleDoctors.map(doc => {
                                        const allDayEvents = getVisualEvents(events.filter(e => e.doctorId === doc.id), true);
                                        return (
                                            <div key={doc.id} className="border-r border-slate-200 shrink-0 p-1 bg-white" style={COLUMN_WIDTH_STYLE}>
                                                {allDayEvents.map(ev => (
                                                    <div 
                                                        key={ev.id} 
                                                        onClick={() => handleSelectEvent(ev)}
                                                        className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded mb-1 truncate border border-indigo-100 font-medium cursor-pointer hover:bg-indigo-100 transition-colors" 
                                                        title={ev.title}
                                                    >
                                                        {ev.title}
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </>
                            ) : (
                                /* WEEK VIEW ALL-DAY CELLS */
                                weekDays.map(date => {
                                    const dateStr = toLocalISODate(date);
                                    const isToday = date.toDateString() === new Date().toDateString();

                                    const dayEvents = events.filter(e => 
                                        toLocalISODate(e.start) === dateStr && 
                                        e.allDay &&
                                        (
                                            (e.doctorId === CLINIC_SHARED_ID && showPublicEvents) ||
                                            visibleDoctors.some(d => d.id === e.doctorId)
                                        )
                                    );

                                    return (
                                        <div 
                                            key={date.toISOString()} 
                                            className={`border-r border-slate-200 shrink-0 p-1 flex flex-col gap-1 ${isToday ? 'bg-blue-50/10' : 'bg-white'}`}
                                            style={{ flex: 1, minWidth: '120px' }}
                                        >
                                            {dayEvents.map(ev => (
                                                <div 
                                                    key={ev.id} 
                                                    onClick={() => handleSelectEvent(ev)}
                                                    className="text-[10px] px-1.5 py-0.5 rounded truncate border cursor-pointer hover:opacity-80"
                                                    style={{ 
                                                        backgroundColor: ev.doctorId === CLINIC_SHARED_ID ? '#e2e8f0' : '#e0e7ff',
                                                        color: ev.doctorId === CLINIC_SHARED_ID ? '#475569' : '#4338ca',
                                                        borderColor: ev.doctorId === CLINIC_SHARED_ID ? '#cbd5e1' : '#c7d2fe'
                                                    }}
                                                    title={ev.title}
                                                >
                                                    {ev.title}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* --- LAYER 4: TIME GRID (Scrolls Vertically) --- */}
                        <div className="flex relative">
                            {/* Time Labels (Sticky Left) */}
                            <div className="sticky left-0 z-[30] w-16 shrink-0 bg-white border-r border-slate-200 select-none">
                                {HOURS.map(h => (
                                    <div key={h} className="relative border-b border-slate-100 text-xs text-slate-400 font-medium text-right pr-2 pt-1" style={{ height: HOUR_HEIGHT }}>
                                        {h}:00
                                    </div>
                                ))}
                            </div>

                            {/* DAY VIEW COLUMNS */}
                            {viewMode === 'day' ? (
                                <>
                                    {/* Public Column */}
                                    {shouldShowPublicColumn && (
                                        <div className="relative border-r border-slate-200 shrink-0 bg-slate-50/30" style={COLUMN_WIDTH_STYLE}>
                                            {/* Grid Lines */}
                                            {HOURS.map(h => (
                                                <div key={h} className="border-b border-slate-100" style={{ height: HOUR_HEIGHT }}></div>
                                            ))}
                                            {/* Events (Only if enabled) */}
                                            {showPublicEvents && getVisualEvents(events.filter(e => e.doctorId === CLINIC_SHARED_ID)).map(ev => (
                                                <div
                                                    key={ev.id}
                                                    onClick={() => handleSelectEvent(ev)}
                                                    style={{...ev.style, backgroundColor: '#f1f5f9', borderLeft: '3px solid #64748b' }}
                                                    className="absolute p-1 rounded-r shadow-sm overflow-hidden hover:z-20 text-xs text-slate-600 border border-slate-200 cursor-pointer"
                                                    title={`${ev.title}\n${ev.start.toLocaleTimeString()} - ${ev.end.toLocaleTimeString()}`}
                                                >
                                                    <div className="font-bold truncate">{ev.title}</div>
                                                    <div className="text-[10px]">{ev.start.getHours()}:{String(ev.start.getMinutes()).padStart(2,'0')} - {ev.end.getHours()}:{String(ev.end.getMinutes()).padStart(2,'0')}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Doctor Columns */}
                                    {visibleDoctors.map(doc => {
                                        const docEvents = events.filter(e => e.doctorId === doc.id);
                                        const visualEvents = getVisualEvents(docEvents);

                                        return (
                                            <div key={doc.id} className="relative border-r border-slate-200 shrink-0 bg-white hover:bg-slate-50/50 transition-colors" style={COLUMN_WIDTH_STYLE}>
                                                {/* Grid Lines */}
                                                {HOURS.map(h => (
                                                    <div key={h} className="border-b border-slate-100" style={{ height: HOUR_HEIGHT }}></div>
                                                ))}

                                                {/* Events */}
                                                {visualEvents.map(ev => (
                                                    <div
                                                        key={ev.id}
                                                        onClick={() => handleSelectEvent(ev)}
                                                        style={{...ev.style, backgroundColor: `${doc.avatarBgColor}20`, borderLeft: `3px solid ${doc.avatarBgColor}` }}
                                                        className="absolute p-1 rounded-r shadow-sm overflow-hidden hover:z-20 text-xs border border-slate-100 group cursor-pointer hover:shadow-md transition-shadow"
                                                        title={`${ev.title}\n${ev.start.toLocaleTimeString()} - ${ev.end.toLocaleTimeString()}`}
                                                    >
                                                        <div className="font-bold text-slate-700 truncate">{ev.title}</div>
                                                        <div className="text-[10px] text-slate-500">
                                                            {ev.start.getHours()}:{String(ev.start.getMinutes()).padStart(2,'0')} - {ev.end.getHours()}:{String(ev.end.getMinutes()).padStart(2,'0')}
                                                        </div>
                                                    </div>
                                                ))}
                                                
                                                {/* Current Time Line */}
                                                {toLocalISODate(now) === toLocalISODate(currentDate) && (
                                                    <div 
                                                        className="absolute w-full border-t-2 border-red-500 z-10 pointer-events-none"
                                                        style={{ top: `${((now.getHours() - START_HOUR) + now.getMinutes() / 60) * HOUR_HEIGHT}px` }}
                                                    >
                                                        <div className="absolute -left-1 -top-1.5 w-3 h-3 bg-red-500 rounded-full"></div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </>
                            ) : (
                                /* WEEK VIEW COLUMNS */
                                weekDays.map(date => {
                                    const dateStr = toLocalISODate(date);
                                    const isToday = date.toDateString() === new Date().toDateString();
                                    
                                    // Filter for TIMED events on this day
                                    const dayEvents = events.filter(e => 
                                        toLocalISODate(e.start) === dateStr && 
                                        !e.allDay &&
                                        (
                                            (e.doctorId === CLINIC_SHARED_ID && showPublicEvents) ||
                                            visibleDoctors.some(d => d.id === e.doctorId)
                                        )
                                    );
                                    
                                    const visualEvents = getVisualEvents(dayEvents);

                                    return (
                                        <div 
                                            key={date.toISOString()}
                                            className={`relative border-r border-slate-200 shrink-0 ${isToday ? 'bg-blue-50/10' : 'bg-white'}`}
                                            style={{ flex: 1, minWidth: '120px' }}
                                        >
                                            {/* Grid Lines */}
                                            {HOURS.map(h => (
                                                <div key={h} className="border-b border-slate-100" style={{ height: HOUR_HEIGHT }}></div>
                                            ))}

                                            {/* Events */}
                                            {visualEvents.map(ev => {
                                                const doc = doctors.find(d => d.id === ev.doctorId);
                                                const isShared = ev.doctorId === CLINIC_SHARED_ID;
                                                const color = isShared ? '#64748b' : (doc?.avatarBgColor || doc?.color || '#3b82f6');

                                                return (
                                                    <div
                                                        key={ev.id}
                                                        onClick={() => handleSelectEvent(ev)}
                                                        style={{...ev.style, backgroundColor: isShared ? '#f1f5f9' : `${color}20`, borderLeft: `3px solid ${color}` }}
                                                        className="absolute p-1 rounded-r shadow-sm overflow-hidden hover:z-20 text-xs border border-slate-100 group cursor-pointer hover:shadow-md transition-shadow"
                                                        title={`${ev.title}\n${isShared ? '公用' : doc?.name}\n${ev.start.toLocaleTimeString()} - ${ev.end.toLocaleTimeString()}`}
                                                    >
                                                        <div className="font-bold text-slate-700 truncate">{ev.title}</div>
                                                        {!isShared && visibleDoctors.length > 1 && (
                                                            <div className="text-[9px] font-bold text-slate-500 truncate mb-0.5">{doc?.name}</div>
                                                        )}
                                                        <div className="text-[10px] text-slate-400 leading-tight">
                                                            {ev.start.getHours()}:{String(ev.start.getMinutes()).padStart(2,'0')} - {ev.end.getHours()}:{String(ev.end.getMinutes()).padStart(2,'0')}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* Current Time Line */}
                                            {isToday && (
                                                <div 
                                                    className="absolute w-full border-t-2 border-red-500 z-10 pointer-events-none"
                                                    style={{ top: `${((now.getHours() - START_HOUR) + now.getMinutes() / 60) * HOUR_HEIGHT}px` }}
                                                >
                                                    <div className="absolute -left-1 -top-1.5 w-3 h-3 bg-red-500 rounded-full"></div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* STAFF SCHEDULE MODAL (Reusable) */}
        <StaffScheduleModal 
            isOpen={!!editingStaffDate}
            onClose={() => setEditingStaffDate(null)}
            dateStr={editingStaffDate || ''}
            clinicId={selectedClinicId}
            schedules={realtimeSchedules} // Replaced props with realtime state
            consultants={consultants}
            onSave={onSave || (async () => {})}
        />

        {/* PATIENT HISTORY MODAL (Replaces AppointmentDetailModal) */}
        <PatientHistoryModal 
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
            patient={selectedPatient}
        />
    </div>
  );
};
