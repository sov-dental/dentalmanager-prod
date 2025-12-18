
import React, { useState, useEffect } from 'react';
import { Consultant, StaffScheduleConfig, DailySchedule } from '../types';
import { Briefcase, UserMinus, Clock, X, Loader2, Store, Zap, AlertCircle } from 'lucide-react';
import { useClinic } from '../contexts/ClinicContext';
import { getStaffList } from '../services/firebase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
  clinicId?: string; 
  schedules: DailySchedule[];
  consultants: Consultant[]; 
  onSave: (newSchedules: DailySchedule[]) => Promise<void>;
}

const LEAVE_TYPES = ['事假', '病假', '特休', '公假', '喪假', '婚假', '產假', '其他', '遲到'];

// Shift Options for Dropdown
const FULL_TIME_OPTIONS = [
    { value: 'full', label: '上班 (全)', color: 'text-slate-700' },
    { value: 'off', label: '休假 (Off)', color: 'text-rose-600 font-bold' },
    { value: 'leave_full', label: '請假 (全)', color: 'text-purple-600' },
    { value: 'leave_half', label: '請假 (半)', color: 'text-purple-600' },
];

const SUNDAY_OPTIONS = [
    { value: 'off', label: '休假 (Off)', color: 'text-rose-600 font-bold' },
    { value: 'overtime_full', label: '加班 (全)', color: 'text-amber-600 font-bold' },
    { value: 'overtime_half', label: '加班 (半)', color: 'text-amber-600 font-bold' },
    { value: 'leave_full', label: '請假 (全)', color: 'text-purple-600' }, 
    { value: 'leave_half', label: '請假 (半)', color: 'text-purple-600' },
];

export const StaffScheduleModal: React.FC<Props> = ({ 
  isOpen, onClose, dateStr, schedules, consultants, onSave 
}) => {
  const { selectedClinicId } = useClinic();
  const [isSaving, setIsSaving] = useState(false);
  const [tempConfig, setTempConfig] = useState<StaffScheduleConfig>({ off: [], leave: [], work: [], overtime: [], late: [] });
  
  // Local Data State (Source of Truth)
  const [staffList, setStaffList] = useState<Consultant[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);

  const isSunday = new Date(dateStr).getDay() === 0;

  // Fetch Staff from staff_profiles
  useEffect(() => {
      if (isOpen && selectedClinicId) {
          const fetchStaff = async () => {
              setIsLoadingStaff(true);
              try {
                  const list = await getStaffList(selectedClinicId);
                  setStaffList(list);
              } catch (e) {
                  console.error("Failed to load staff list", e);
              } finally {
                  setIsLoadingStaff(false);
              }
          };
          fetchStaff();
      }
  }, [isOpen, selectedClinicId]);

  // Categorization Logic
  const groupA = staffList.filter(c => 
      !c.role || ['consultant', 'assistant', 'trainee', 'manager'].includes(c.role)
  );
  const groupB = staffList.filter(c => c.role === 'part_time');

  // Initialize Config
  useEffect(() => {
    if (isOpen && dateStr && selectedClinicId) {
        const schedule = schedules.find(s => s.date === dateStr && s.clinicId === selectedClinicId);
        
        if (schedule?.staffConfiguration) {
            setTempConfig({
                off: schedule.staffConfiguration.off || [],
                leave: schedule.staffConfiguration.leave || [],
                work: schedule.staffConfiguration.work || [],
                overtime: schedule.staffConfiguration.overtime || [],
                late: schedule.staffConfiguration.late || []
            });
        } else if (schedule?.consultantOffs) {
            if (staffList.length > 0) {
                const off = schedule.consultantOffs.filter(id => groupA.some(s => s.id === id));
                const work = groupB.filter(s => !schedule.consultantOffs?.includes(s.id)).map(s => s.id);
                setTempConfig({ off, leave: [], work, overtime: [], late: [] });
            }
        } else {
            if (isSunday && staffList.length > 0) {
                setTempConfig({ 
                    off: groupA.map(c => c.id), 
                    leave: [], 
                    work: [],
                    overtime: [],
                    late: []
                });
            } else {
                setTempConfig({ off: [], leave: [], work: [], overtime: [], late: [] });
            }
        }
    }
  }, [isOpen, dateStr, selectedClinicId, schedules, staffList.length, isSunday]);

  const saveStaffConfig = async () => {
      if (!dateStr || !selectedClinicId) return;
      setIsSaving(true);
      try {
          const currentSchedule = schedules.find(s => s.date === dateStr && s.clinicId === selectedClinicId);
          
          let newSchedules = [...schedules];
          if (currentSchedule) {
              newSchedules = newSchedules.map(s => (s.date === dateStr && s.clinicId === selectedClinicId) ? { ...s, staffConfiguration: tempConfig } : s);
          } else {
               newSchedules.push({
                   date: dateStr,
                   clinicId: selectedClinicId,
                   isClosed: false,
                   shifts: { Morning: [], Afternoon: [], Evening: [] },
                   staffConfiguration: tempConfig
               });
          }
          await onSave(newSchedules);
          onClose();
      } catch (e) {
          alert('儲存失敗');
      } finally {
          setIsSaving(false);
      }
  };

  const handleSetClinicClosed = () => {
      if (!confirm("確定將本日設為休診？\n這將把所有正職人員設為「休」，並清除所有請假/加班/遲到紀錄。")) return;
      
      setTempConfig({
          off: groupA.map(c => c.id),
          leave: [],
          work: [],
          overtime: [],
          late: []
      });
  };

  const toggleWork = (id: string) => {
      setTempConfig(prev => {
          const isWorking = prev.work.includes(id);
          const newWork = isWorking ? prev.work.filter(x => x !== id) : [...prev.work, id];
          return { ...prev, work: newWork };
      });
  };

  const toggleLate = (id: string) => {
      setTempConfig(prev => {
          const currentLate = prev.late || [];
          const isLate = currentLate.includes(id);
          const newLate = isLate ? currentLate.filter(x => x !== id) : [...currentLate, id];
          return { ...prev, late: newLate };
      });
  };

  const getStatus = (id: string) => {
      const isOff = tempConfig.off.includes(id);
      if (isOff) return 'off';

      const leaveEntry = tempConfig.leave.find(l => l.id === id);
      if (leaveEntry) {
          return leaveEntry.type.includes('(半)') ? 'leave_half' : 'leave_full';
      }

      const overtimeEntry = (tempConfig.overtime || []).find(o => o.id === id);
      if (overtimeEntry) {
          return overtimeEntry.type.includes('(半)') ? 'overtime_half' : 'overtime_full';
      }

      return 'full'; 
  };

  const handleStatusChange = (id: string, newStatus: string) => {
      setTempConfig(prev => {
          const newOff = prev.off.filter(x => x !== id);
          const newLeave = prev.leave.filter(l => l.id !== id);
          const newOvertime = (prev.overtime || []).filter(o => o.id !== id);
          let newLate = prev.late || [];

          if (newStatus === 'off') {
              newOff.push(id);
              newLate = newLate.filter(x => x !== id); // Can't be late if off
          } else if (newStatus.startsWith('leave')) {
              const suffix = newStatus === 'leave_half' ? '(半)' : '(全)';
              const oldLeave = prev.leave.find(l => l.id === id);
              const baseType = oldLeave ? oldLeave.type.replace(/\(.*\)/, '') : '事假';
              newLeave.push({ id, type: `${baseType}${suffix}` });
              if (newStatus === 'leave_full') newLate = newLate.filter(x => x !== id);
          } else if (newStatus.startsWith('overtime')) {
              const suffix = newStatus === 'overtime_half' ? '(半)' : '(全)';
              newOvertime.push({ id, type: `加班${suffix}` });
          } 

          return { ...prev, off: newOff, leave: newLeave, overtime: newOvertime, late: newLate };
      });
  };

  const changeLeaveBaseType = (id: string, newBaseType: string) => {
      setTempConfig(prev => {
          const target = prev.leave.find(l => l.id === id);
          if (!target) return prev;
          
          const isHalf = target.type.includes('(半)');
          const newType = `${newBaseType}${isHalf ? '(半)' : '(全)'}`;
          
          return {
              ...prev,
              leave: prev.leave.map(l => l.id === id ? { ...l, type: newType } : l)
          };
      });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl animate-fade-in flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
                <div className="flex items-center gap-2">
                    <Briefcase className="text-teal-600" />
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            人員排班設定 
                            {isSunday && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">週日模式</span>}
                        </h3>
                        <p className="text-xs text-slate-500 font-mono">{dateStr}</p>
                    </div>
                </div>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {isLoadingStaff ? (
                    <div className="flex justify-center py-10 text-slate-400 gap-2">
                        <Loader2 className="animate-spin" /> 讀取人員資料中...
                    </div>
                ) : (
                    <>  
                        <div className="bg-orange-50 border border-orange-100 p-3 rounded-lg flex items-center justify-between">
                            <span className="text-xs font-bold text-orange-800 flex items-center gap-2">
                                <Store size={14} /> 快速操作
                            </span>
                            <button 
                                onClick={handleSetClinicClosed}
                                className="bg-white text-orange-600 border border-orange-200 hover:bg-orange-100 px-3 py-1.5 rounded-md text-xs font-bold shadow-sm transition-colors flex items-center gap-1"
                            >
                                🏥 本日休診 (全體排休)
                            </button>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-bold text-slate-700 flex items-center gap-2 border-l-4 border-teal-400 pl-2">
                                {isSunday ? <Zap size={18} className="text-amber-500" /> : <UserMinus size={18} className="text-teal-500" />}
                                {isSunday ? '週日出勤設定 (Sunday Overtime)' : '正職排班 (Regular Schedule)'}
                            </h4>
                            
                            <div className="grid grid-cols-1 gap-2">
                                {groupA.map(c => {
                                    const status = getStatus(c.id);
                                    const options = isSunday ? SUNDAY_OPTIONS : FULL_TIME_OPTIONS;
                                    const leaveEntry = tempConfig.leave.find(l => l.id === c.id);
                                    const currentLeaveBase = leaveEntry ? leaveEntry.type.replace(/\(.*\)/, '') : '事假';
                                    const isLate = (tempConfig.late || []).includes(c.id);

                                    return (
                                        <div key={c.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-teal-300 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="font-bold text-slate-700 w-24 truncate">{c.name}</div>
                                                {status !== 'off' && status !== 'leave_full' && (
                                                    <label className={`flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded border transition-colors ${isLate ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-400 hover:border-amber-200'}`}>
                                                        <input 
                                                            type="checkbox" 
                                                            className="w-3.5 h-3.5 rounded text-amber-600 focus:ring-amber-500"
                                                            checked={isLate}
                                                            onChange={() => toggleLate(c.id)}
                                                        />
                                                        <span className="text-xs font-bold">遲到</span>
                                                    </label>
                                                )}
                                            </div>
                                            
                                            <div className="flex-1 flex justify-end gap-2">
                                                {status.startsWith('leave') && (
                                                    <select
                                                        className="text-xs border border-purple-200 rounded px-2 py-1 bg-purple-50 text-purple-700 outline-none focus:ring-1 focus:ring-purple-500"
                                                        value={currentLeaveBase}
                                                        onChange={(e) => changeLeaveBaseType(c.id, e.target.value)}
                                                    >
                                                        {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                    </select>
                                                )}

                                                <select
                                                    className={`text-sm border rounded-md px-3 py-1.5 outline-none font-bold cursor-pointer transition-colors
                                                        ${status === 'off' ? 'bg-rose-50 border-rose-200 text-rose-600' : 
                                                          status.startsWith('overtime') ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                                          status.startsWith('leave') ? 'bg-purple-50 border-purple-200 text-purple-700' :
                                                          'bg-white border-slate-300 text-slate-700'}
                                                    `}
                                                    value={status}
                                                    onChange={(e) => handleStatusChange(c.id, e.target.value)}
                                                >
                                                    {options.map(opt => (
                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-bold text-slate-700 flex items-center gap-2 border-l-4 border-amber-400 pl-2">
                                <Clock size={18} className="text-amber-500" /> 打工排班 (Part-time Shift)
                            </h4>
                            <div className="grid grid-cols-1 gap-2">
                                {groupB.map(c => {
                                    const isWorking = tempConfig.work.includes(c.id);
                                    const isLate = (tempConfig.late || []).includes(c.id);
                                    return (
                                        <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all ${isWorking ? 'bg-amber-50 border-amber-300 shadow-sm' : 'bg-white border-slate-200'}`}>
                                            <label className="flex items-center gap-3 cursor-pointer flex-1">
                                                <input 
                                                    type="checkbox" 
                                                    className="w-4 h-4 text-amber-500 focus:ring-amber-500 border-gray-300 rounded"
                                                    checked={isWorking}
                                                    onChange={() => toggleWork(c.id)}
                                                />
                                                <span className="text-sm font-bold text-slate-700">{c.name}</span>
                                            </label>
                                            
                                            {isWorking && (
                                                <label className={`flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded border transition-colors ${isLate ? 'bg-amber-200 border-amber-400 text-amber-900' : 'bg-white border-amber-200 text-amber-600 hover:bg-amber-100'}`}>
                                                    <input 
                                                        type="checkbox" 
                                                        className="w-3.5 h-3.5 rounded text-amber-800 focus:ring-amber-700"
                                                        checked={isLate}
                                                        onChange={() => toggleLate(c.id)}
                                                    />
                                                    <span className="text-xs font-bold">遲到</span>
                                                </label>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>
            
            <div className="flex justify-end gap-3 p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl">
                <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium">取消</button>
                <button 
                onClick={saveStaffConfig} 
                disabled={isSaving || isLoadingStaff}
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 font-bold shadow-md"
                >
                    {isSaving && <Loader2 size={16} className="animate-spin" />} 儲存設定
                </button>
            </div>
        </div>
    </div>
  );
};
