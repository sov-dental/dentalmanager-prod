
import React, { useEffect, useState } from 'react';
import { Clinic, Doctor } from '../types';
import { initGoogleClient, handleAuthClick, handleSignOutClick, listCalendars, GoogleCalendar, getCalendarProfile } from '../services/googleCalendar';
import { updateClinicCalendarMapping } from '../services/firebase'; // Direct update
import { performFullBackup } from '../services/backupService';
import { Link, Save, LogOut, Check, Loader2, AlertCircle, Building2, Download, ShieldCheck, RefreshCw, Wand2 } from 'lucide-react';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
  onSave: (clinics: Clinic[]) => Promise<void>; // Kept for compatibility but we use direct update
}

export const Integrations: React.FC<Props> = ({ clinics, doctors, onSave }) => {
  const { selectedClinic } = useClinic();
  const [isGapiReady, setIsGapiReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userCalendars, setUserCalendars] = useState<GoogleCalendar[]>([]);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  
  // Local state for the mapping being edited. 
  // Syncs with selectedClinic whenever it changes.
  const [mapping, setMapping] = useState<Record<string, string>>({});
  
  const [isSaving, setIsSaving] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);

  useEffect(() => {
    // Initialize Google API on mount
    initGoogleClient(
      () => setIsGapiReady(true),
      (status) => {
        setIsLoggedIn(status);
        if (status) {
            fetchCalendars();
            getCalendarProfile().then(setConnectedEmail);
        }
      }
    );
  }, []);

  // Sync local mapping state with global selected clinic
  useEffect(() => {
    if (selectedClinic) {
      setMapping(selectedClinic.googleCalendarMapping || {});
    } else {
      setMapping({});
    }
  }, [selectedClinic]);

  const fetchCalendars = async () => {
    const cals = await listCalendars();
    setUserCalendars(cals);
  };

  const handleLogin = () => {
    handleAuthClick();
  };

  const handleLogout = () => {
    handleSignOutClick();
    setIsLoggedIn(false);
    setUserCalendars([]);
    setConnectedEmail(null);
  };

  const handleMapChange = (key: string, calendarId: string) => {
    setMapping(prev => ({
      ...prev,
      [key]: calendarId
    }));
  };

  // Smart Auto-Match: Try to match Doctor Name to Calendar Summary
  const handleAutoMatch = () => {
      if (!selectedClinic) return;
      const newMapping = { ...mapping };
      let matchCount = 0;

      // 1. Match Clinic Shared
      if (!newMapping['clinic_shared']) {
          const sharedMatch = userCalendars.find(c => 
              c.summary.includes(selectedClinic.name) || 
              c.summary.includes('公用') || 
              c.summary.includes('Shared')
          );
          if (sharedMatch) {
              newMapping['clinic_shared'] = sharedMatch.id;
              matchCount++;
          }
      }

      // 2. Match Doctors
      const filteredDoctors = doctors.filter(d => d.clinicId === selectedClinic.id);
      filteredDoctors.forEach(doc => {
          if (!newMapping[doc.id]) {
              const docMatch = userCalendars.find(c => c.summary.includes(doc.name));
              if (docMatch) {
                  newMapping[doc.id] = docMatch.id;
                  matchCount++;
              }
          }
      });

      setMapping(newMapping);
      alert(`自動配對完成: ${matchCount} 個項目`);
  };

  const saveMapping = async () => {
    if (!selectedClinic) return;
    
    setIsSaving(true);
    try {
      // Use the direct update function to persist mapping
      await updateClinicCalendarMapping(selectedClinic.id, mapping);
      
      // Optionally notify parent if needed for local state update, 
      // though typically a context refresh or reload handles this.
      // We still call onSave to ensure local 'clinics' state in App.tsx is refreshed if it relies on that.
      const updatedClinics = clinics.map(c => 
        c.id === selectedClinic.id 
          ? { ...c, googleCalendarMapping: mapping } 
          : c
      );
      await onSave(updatedClinics);

      alert('設定已儲存！');
    } catch (e) {
      console.error(e);
      alert('儲存失敗');
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleBackup = async () => {
      if(!confirm("即將匯出系統內所有資料 (診所、人員、每日帳務)。\n這可能需要幾秒鐘時間。確定嗎？")) return;
      
      setIsBackingUp(true);
      try {
          await performFullBackup();
          alert("備份檔已下載。請妥善保存！");
      } catch(e) {
          alert("備份失敗: " + (e as Error).message);
      } finally {
          setIsBackingUp(false);
      }
  };

  const filteredDoctors = doctors.filter(d => selectedClinic && d.clinicId === selectedClinic.id);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
            <Link size={28} className="text-blue-500" /> 系統整合與備份
          </h2>
          <p className="text-slate-500">管理外部連結 (Google Calendar) 與資料安全設定。</p>
        </div>
      </div>

      {/* SECTION 1: DATA BACKUP */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-6 rounded-xl shadow-md border border-slate-600 text-white">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div>
                  <h3 className="text-xl font-bold flex items-center gap-2 mb-2">
                      <ShieldCheck className="text-emerald-400" /> 資料災難復原 (Disaster Recovery)
                  </h3>
                  <p className="text-slate-300 text-sm max-w-2xl">
                      建議定期執行完整備份。此功能將匯出系統內所有診所設定、人員資料及每日帳務紀錄為 JSON 檔案。
                      若發生資料遺失，可聯絡技術支援團隊使用此檔案進行復原。
                  </p>
              </div>
              <button 
                  onClick={handleBackup}
                  disabled={isBackingUp}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-lg font-bold shadow-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                  {isBackingUp ? <Loader2 className="animate-spin" /> : <Download size={20} />}
                  匯出完整備份
              </button>
          </div>
      </div>

      {/* SECTION 2: GOOGLE CALENDAR */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-100 pb-6 mb-6">
          <div>
            <h3 className="text-lg font-bold text-slate-700 flex items-center gap-2">
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              Google Calendar 帳號連結
            </h3>
            <p className="text-sm text-slate-500 mt-1">請登入包含診所醫師日曆的 Google 帳號。</p>
          </div>

          {!isGapiReady ? (
            <div className="flex items-center gap-2 text-slate-400 bg-slate-50 px-4 py-2 rounded-lg">
              <Loader2 className="animate-spin" size={16} /> API 初始化中...
            </div>
          ) : isLoggedIn ? (
            <div className="flex items-center gap-3">
              <span className="text-green-600 font-medium flex items-center gap-1 text-sm bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
                <Check size={14} /> 已連結: {connectedEmail || 'Account'}
              </span>
              <button 
                onClick={handleLogout}
                className="text-slate-500 hover:text-rose-500 text-sm font-medium flex items-center gap-1 px-3 py-1.5 hover:bg-rose-50 rounded-lg transition-colors"
              >
                <LogOut size={14} /> 登出
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="w-5 h-5"/>
              登入 Google 帳號
            </button>
          )}
        </div>

        {isLoggedIn && (
          <div className="space-y-6 animate-fade-in">
             <div className="flex items-center gap-4 bg-blue-50 p-4 rounded-lg border border-blue-100 text-blue-800 text-sm">
                 <AlertCircle size={20} className="shrink-0" />
                 <div>
                     <strong>如何設定？</strong> 請先在 Google 日曆中為每位醫師建立獨立的日曆 (或確認現有日曆)，然後在下方將系統醫師對應到正確的 Google 日曆。
                 </div>
             </div>

             <div className="flex items-end justify-between gap-4">
                 <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">選擇要設定的診所</label>
                    <ClinicSelector className="border p-2 rounded-lg font-medium text-slate-700 bg-white w-full sm:w-auto min-w-[200px]" />
                 </div>
                 {selectedClinic && (
                     <div className="flex gap-2">
                         <button 
                            onClick={fetchCalendars}
                            className="bg-white border border-slate-300 text-slate-600 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-slate-50"
                         >
                             <RefreshCw size={16} /> 重新讀取日曆
                         </button>
                         <button 
                            onClick={handleAutoMatch}
                            className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-indigo-100"
                         >
                             <Wand2 size={16} /> 自動配對
                         </button>
                     </div>
                 )}
             </div>

             {selectedClinic ? (
                 <>
                    <div className="border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-2 bg-slate-50 border-b border-slate-200 p-3 font-medium text-slate-500 text-sm">
                            <div>資源 / 醫師 (系統)</div>
                            <div>對應 Google 日曆</div>
                        </div>

                        {/* Clinic Shared Calendar Section */}
                        <div className="grid grid-cols-1 md:grid-cols-2 p-3 border-b hover:bg-slate-50 items-center gap-2 md:gap-0 bg-slate-50/50">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-600 text-white shadow-sm">
                                    <Building2 size={16} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-bold text-slate-800">診所公用日曆 (Clinic Shared)</span>
                                    <span className="text-[10px] text-slate-500">用於顯示公休、會議或全院事項</span>
                                </div>
                            </div>
                            <div>
                                <select
                                    className={`w-full border rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${mapping['clinic_shared'] ? 'text-slate-800 bg-white' : 'text-slate-400 bg-slate-50'}`}
                                    value={mapping['clinic_shared'] || ''}
                                    onChange={e => handleMapChange('clinic_shared', e.target.value)}
                                >
                                    <option value="">-- 未連結 --</option>
                                    {userCalendars.map(cal => (
                                        <option key={cal.id} value={cal.id}>
                                            {cal.summary} {cal.primary ? '(主日曆)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Doctor Mapping Section */}
                        {filteredDoctors.length > 0 ? (
                            filteredDoctors.map(doc => {
                                const currentCal = mapping[doc.id] || '';
                                return (
                                    <div key={doc.id} className="grid grid-cols-1 md:grid-cols-2 p-3 border-b last:border-0 hover:bg-slate-50 items-center gap-2 md:gap-0">
                                        <div className="flex items-center gap-3">
                                            <div 
                                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                                style={{ backgroundColor: doc.avatarBgColor || doc.color || '#3b82f6' }}
                                            >
                                                {doc.avatarText || doc.name.charAt(0)}
                                            </div>
                                            <span className="font-medium text-slate-700">{doc.name}</span>
                                        </div>
                                        <div>
                                            <select
                                                className={`w-full border rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${currentCal ? 'text-slate-800 bg-white' : 'text-slate-400 bg-slate-50'}`}
                                                value={currentCal}
                                                onChange={e => handleMapChange(doc.id, e.target.value)}
                                            >
                                                <option value="">-- 未連結 --</option>
                                                {userCalendars.map(cal => (
                                                    <option key={cal.id} value={cal.id}>
                                                        {cal.summary} {cal.primary ? '(主日曆)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="p-8 text-center text-slate-400">此診所尚無醫師資料</div>
                        )}
                    </div>

                    <div className="flex justify-end pt-4">
                        <button
                            onClick={saveMapping}
                            disabled={isSaving}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium shadow-md transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                            儲存對應設定
                        </button>
                    </div>
                 </>
             ) : (
                 <div className="p-12 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                     請先選擇上方診所
                 </div>
             )}
          </div>
        )}
      </div>
    </div>
  );
};
