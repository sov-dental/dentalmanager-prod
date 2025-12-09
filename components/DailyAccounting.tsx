
import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Doctor, Consultant, Laboratory, SOVReferral, DailyAccountingRecord, AccountingRow, Expenditure } from '../types';
import { hydrateRow, getStaffList, db } from '../services/firebase';
import { exportDailyReportToExcel } from '../services/excelExport';
import { listEvents, parseAppointmentTitle } from '../services/googleCalendar';
import { ClinicSelector } from './ClinicSelector';
import { useClinic } from '../contexts/ClinicContext';
import { 
  Save, Plus, Trash2, FileSpreadsheet, Loader2,
  ChevronLeft, ChevronRight, RefreshCw, 
  Wallet, CreditCard, TrendingUp, CheckCircle, Circle, Filter,
  WifiOff
} from 'lucide-react';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
  consultants: Consultant[];
  laboratories: Laboratory[];
  sovReferrals: SOVReferral[];
}

// --- 1. Debounced Input Component (Fixes Focus Loss) ---
const InputCell = ({ 
    initialValue, 
    onCommit, 
    className = "", 
    placeholder = "",
    type = "text",
    align = "left"
}: { 
    initialValue: any, 
    onCommit: (val: any) => void, 
    className?: string, 
    placeholder?: string, 
    type?: "text" | "number",
    align?: "left" | "right" | "center"
}) => {
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const handleBlur = () => {
        // Only commit if value changed to prevent unnecessary writes
        if (value != initialValue) {
            onCommit(value);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
        }
    };

    const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

    return (
        <input
            type={type}
            className={`w-full bg-transparent outline-none px-1 py-1 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 rounded-sm transition-colors placeholder-slate-300 ${alignClass} ${className}`}
            value={value === 0 && type === 'number' ? '' : value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
        />
    );
};

// Helper
const safeNum = (val: any) => (isNaN(Number(val)) ? 0 : Number(val));

export const DailyAccounting: React.FC<Props> = ({ clinics, doctors, laboratories }) => {
  const { selectedClinicId, selectedClinic } = useClinic();
  
  // --- Global State ---
  const [currentDate, setCurrentDate] = useState(() => {
      // Initialize with Local Time YYYY-MM-DD
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
  });
  
  const [dailyRecord, setDailyRecord] = useState<DailyAccountingRecord | null>(null);
  const [rows, setRows] = useState<AccountingRow[]>([]);
  const [expenditures, setExpenditures] = useState<Expenditure[]>([]);
  const [fullStaffList, setFullStaffList] = useState<Consultant[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isManualSaving, setIsManualSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Filter State
  const [filterDoctorId, setFilterDoctorId] = useState<string>('');

  // --- 1. Data Fetching ---

  // Helper: Get consistent Document ID based on Clinic and Date
  const getDocId = (clinicId: string, dateStr: string) => {
      // Ensure strictly ClinicID_YYYY-MM-DD
      return `${clinicId}_${dateStr}`;
  };

  // Fetch Staff Profiles
  useEffect(() => {
      const fetchStaff = async () => {
          if (selectedClinicId) {
              try {
                  const list = await getStaffList(selectedClinicId);
                  setFullStaffList(list);
              } catch (error) {
                  console.error("Error fetching staff:", error);
              }
          }
      };
      fetchStaff();
  }, [selectedClinicId]);

  // Derived Lists
  const consultantOptions = useMemo(() => 
      fullStaffList.filter(c => c.role === 'consultant' || c.role === 'trainee'), 
  [fullStaffList]);

  const staffOptions = useMemo(() => 
      fullStaffList.filter(c => ['consultant', 'trainee', 'assistant'].includes(c.role || '')), 
  [fullStaffList]);

  const clinicDocs = doctors.filter(d => d.clinicId === selectedClinicId);
  const clinicLabs = laboratories.filter(l => l.clinicId === selectedClinicId);

  // Dynamic Doctor Filter Options (Only show doctors present in rows)
  const activeDoctorsInTable = useMemo(() => {
      const docIds = new Set(rows.map(r => r.doctorId).filter(Boolean));
      return clinicDocs.filter(d => docIds.has(d.id));
  }, [rows, clinicDocs]);

  // Listen to Daily Record (Real-time)
  useEffect(() => {
      if (!selectedClinicId || !currentDate) {
          setDailyRecord(null);
          setRows([]);
          setExpenditures([]);
          return;
      }

      setIsLoading(true);
      const docId = getDocId(selectedClinicId, currentDate);
      
      console.log(`[DailyAccounting] Listening to Firestore Path: daily_accounting/${docId}`);

      const unsubscribe = db.collection('daily_accounting').doc(docId).onSnapshot((doc: any) => {
          setIsLoading(false);
          console.log(`[DailyAccounting] Snapshot received. Exists? ${doc.exists}`);
          
          if (doc.exists) {
              const data = doc.data() as DailyAccountingRecord;
              console.log(`[DailyAccounting] Loaded Data Rows: ${data.rows?.length}`);
              setDailyRecord(data);
              
              const loadedRows = (data.rows || []).map(r => {
                  const hydrated = hydrateRow(r);
                  // Ensure attendance fallback logic is consistent with hydrateRow
                  return hydrated;
              });
              
              setRows(loadedRows);
              setExpenditures(data.expenditures || []);
          } else {
              console.log("[DailyAccounting] Document does not exist. Initializing empty state.");
              setDailyRecord(null);
              setRows([]);
              setExpenditures([]);
          }
      }, (error: any) => {
          console.error("[DailyAccounting] Listener Error:", error);
          setIsLoading(false);
          setSaveStatus('error');
      });

      return () => unsubscribe();
  }, [selectedClinicId, currentDate]);

  // --- 2. Calculation & Logic ---

  // Filtered Rows for Display
  const visibleRows = useMemo(() => {
      if (!filterDoctorId) return rows;
      return rows.filter(r => r.doctorId === filterDoctorId);
  }, [rows, filterDoctorId]);

  // Dashboard Logic
  const totals = useMemo(() => {
      let cashRevenue = 0;
      let cardRevenue = 0;
      let transferRevenue = 0;
      let totalRevenue = 0;

      rows.forEach(row => {
          const t = row.treatments;
          const r = row.retail;
          const rowTotal = (t.regFee||0) + (t.copayment||0) + 
                           (t.prostho||0) + (t.implant||0) + (t.ortho||0) + (t.sov||0) + (t.inv||0) + (t.perio||0) + (t.whitening||0) + (t.otherSelfPay||0) +
                           (r.products||0) + (r.diyWhitening||0);
          
          totalRevenue += rowTotal;

          if (row.paymentMethod === 'card') cardRevenue += rowTotal;
          else if (row.paymentMethod === 'transfer') transferRevenue += rowTotal;
          else cashRevenue += rowTotal;
      });

      const totalExpenditure = expenditures.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      return {
          cashRevenue,
          cashBalance: cashRevenue - totalExpenditure,
          nonCash: cardRevenue + transferRevenue,
          cardRevenue,
          transferRevenue,
          netTotal: totalRevenue - totalExpenditure,
          totalRevenue,
          totalExpenditure
      };
  }, [rows, expenditures]);

  // Styling Helpers
  const getPatientNameClass = (row: AccountingRow) => {
      // Increased size to lg and heavy bold for visibility
      const base = "text-lg font-bold";
      if (row.isManual) return `${base} text-blue-600`;
      if (!row.attendance) return `${base} text-gray-100 font-medium`; 
      const t = row.treatments;
      const r = row.retail;
      const highValue = (t.prostho||0) + (t.implant||0) + (t.ortho||0) + (t.sov||0) + (t.inv||0) + (t.perio||0) + (t.whitening||0) + (t.otherSelfPay||0) +
                        (r.products||0) + (r.diyWhitening||0);
      return highValue > 0 ? `${base} text-gray-900` : `${base} text-red-500`;
  };

  const getDoctorColor = (docId: string) => {
      const doc = clinicDocs.find(d => d.id === docId);
      return doc?.avatarBgColor || doc?.color || '#cbd5e1';
  };

  const getDoctorAvatarText = (docId: string, docName: string) => {
      const doc = clinicDocs.find(d => d.id === docId);
      if (doc?.avatarText) return doc.avatarText;
      return docName ? docName.substring(0, 2) : '?';
  };

  // --- 3. Actions ---

  const handleSyncCalendar = async () => {
      if (!selectedClinic?.googleCalendarMapping) {
          alert("此診所尚未設定 Google 日曆連結");
          return;
      }
      setIsSyncing(true);
      try {
          // 1. Setup Time Range
          const start = new Date(currentDate); start.setHours(0,0,0,0);
          const end = new Date(currentDate); end.setHours(23,59,59,999);
          const mapping = selectedClinic.googleCalendarMapping;
          
          // 2. Build Set of Existing Row IDs (To prevent overwriting)
          // We assume 'rows' is up-to-date from state (Snapshot ensures this)
          const existingIds = new Set(rows.map(r => r.id));
          const newRows: AccountingRow[] = [];

          // 3. Fetch from Google
          for (const doc of clinicDocs) {
              const calendarId = mapping[doc.id];
              if (calendarId) {
                  const events = await listEvents(calendarId, start, end);
                  events.forEach(ev => {
                      if (!existingIds.has(ev.id) && !ev.allDay) { 
                          const parsed = parseAppointmentTitle(ev.summary);
                          newRows.push({
                              ...hydrateRow({}),
                              id: ev.id,
                              patientName: parsed?.patientName || ev.summary,
                              doctorId: doc.id,
                              doctorName: doc.name,
                              treatmentContent: parsed?.note || '',
                              npStatus: parsed?.np_display || '',
                              isManual: false,
                              attendance: true,
                              startTime: ev.start.dateTime || new Date().toISOString()
                          });
                      }
                  });
              }
          }

          // 4. Merge (Existing Rows + New Rows) & Sort
          if (newRows.length > 0) {
              const updated = [...rows, ...newRows].sort((a,b) => (a.startTime||'').localeCompare(b.startTime||''));
              // Save strictly merged result
              // NOTE: persistData uses direct write, triggering snapshot update
              await persistData(updated, expenditures);
          } else {
              alert("已同步，無新增項目");
          }
      } catch (e) {
          console.error(e);
          alert("同步失敗，請檢查日曆連結");
      } finally {
          setIsSyncing(false);
      }
  };

  const handleAddRow = () => {
      const newRow: AccountingRow = {
          ...hydrateRow({}),
          id: crypto.randomUUID(),
          isManual: true,
          attendance: true,
          startTime: new Date().toISOString()
      };
      const updated = [...rows, newRow];
      // Optimistic update not needed as snapshot will reflect change, but for UX responsiveness we can invoke persist directly
      persistData(updated, expenditures);
  };

  const handleDeleteRow = (id: string) => {
      if (!confirm("確定刪除此列？")) return;
      const updated = rows.filter(r => r.id !== id);
      persistData(updated, expenditures);
  };

  // --- SAVE LOGIC ---

  const prepareDataForSave = (currentRows: AccountingRow[]) => {
      return currentRows.map(row => {
          const t = row.treatments;
          const r = row.retail;
          // Ensure all numbers are safe (no NaN or undefined)
          const safeT = {
              regFee: safeNum(t.regFee),
              copayment: safeNum(t.copayment),
              sov: safeNum(t.sov),
              ortho: safeNum(t.ortho),
              prostho: safeNum(t.prostho),
              implant: safeNum(t.implant),
              whitening: safeNum(t.whitening),
              perio: safeNum(t.perio),
              inv: safeNum(t.inv),
              otherSelfPay: safeNum(t.otherSelfPay),
              consultant: t.consultant || ''
          };
          
          const safeR = {
              diyWhitening: safeNum(r.diyWhitening),
              products: safeNum(r.products),
              productNote: r.productNote || '',
              staff: r.staff || ''
          };

          const total = safeT.regFee + safeT.copayment + 
                        safeT.prostho + safeT.implant + safeT.ortho + safeT.sov + safeT.inv + safeT.perio + safeT.whitening + safeT.otherSelfPay +
                        safeR.products + safeR.diyWhitening;
          
          const pb = { cash: 0, card: 0, transfer: 0 };
          if (row.paymentMethod === 'card') pb.card = total;
          else if (row.paymentMethod === 'transfer') pb.transfer = total;
          else pb.cash = total;

          return {
              ...row,
              patientName: row.patientName || '',
              treatments: safeT,
              retail: safeR,
              actualCollected: total,
              paymentBreakdown: pb,
              attendance: row.attendance ?? true 
          };
      });
  };

  const persistData = async (currentRows: AccountingRow[], currentExp: Expenditure[]) => {
      if (!selectedClinicId) return;
      setSaveStatus('saving');
      try {
          const cleanRows = prepareDataForSave(currentRows);
          const docId = getDocId(selectedClinicId, currentDate);

          const payload = {
              clinicId: selectedClinicId,
              date: currentDate,
              rows: cleanRows,
              expenditures: currentExp,
              lastUpdated: Date.now(),
              // Preserve existing report image if it exists
              reportImageUrl: dailyRecord?.reportImageUrl || null
          };

          console.log(`[Persist] Writing to daily_accounting/${docId}`, payload);
          await db.collection('daily_accounting').doc(docId).set(payload, { merge: true });
          
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (e) {
          console.error(e);
          setSaveStatus('error');
      }
  };

  const handleManualSave = async () => {
      if (!selectedClinicId) {
          alert("請先選擇診所");
          return;
      }
      setIsManualSaving(true);
      
      try {
          console.log("Starting Manual Save. Raw Rows:", rows);
          const cleanRows = prepareDataForSave(rows);
          const docId = getDocId(selectedClinicId, currentDate);
          
          console.log(`Processed Rows for Save. Writing to ${docId}:`, cleanRows);

          const payload = {
              clinicId: selectedClinicId,
              date: currentDate,
              rows: cleanRows,
              expenditures: expenditures,
              lastUpdated: Date.now(),
              reportImageUrl: dailyRecord?.reportImageUrl || null
          };

          await db.collection('daily_accounting').doc(docId).set(payload, { merge: true });
          
          setSaveStatus('saved');
          alert("✅ 儲存成功！ (Saved Successfully)");
      } catch (error: any) {
          console.error("Manual Save Error:", error);
          setSaveStatus('error');
          alert("❌ 儲存失敗 (Save Failed): " + (error.message || "Unknown error"));
      } finally {
          setIsManualSaving(false);
      }
  };

  // --- Core Update Logic (Called on Blur) ---
  const updateRow = (id: string, updates: Partial<AccountingRow> | any) => {
      // Optimistic Update
      const updatedRows = rows.map(r => {
          if (r.id === id) {
              const newRow = { ...r };
              // Deep merge for nested objects
              Object.keys(updates).forEach(key => {
                  if (typeof updates[key] === 'object' && updates[key] !== null && !Array.isArray(updates[key])) {
                      (newRow as any)[key] = { 
                          ...((newRow as any)[key] as any), 
                          ...updates[key] 
                      };
                  } else {
                      (newRow as any)[key] = updates[key];
                  }
              });
              // Auto-update Doctor Name if ID changes
              if (updates.doctorId) {
                  const doc = clinicDocs.find(d => d.id === updates.doctorId);
                  if (doc) newRow.doctorName = doc.name;
              }
              return newRow;
          }
          return r;
      });
      
      // Update local state immediately for UI responsiveness
      setRows(updatedRows);
      // Trigger background save
      persistData(updatedRows, expenditures);
  };

  const handleExpenditureChange = (newExp: Expenditure[]) => {
      setExpenditures(newExp);
      persistData(rows, newExp);
  };

  return (
    <div className="space-y-6 pb-20">
        {/* 1. Header & Controls */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
                <ClinicSelector className="border p-2 rounded-lg bg-slate-50 min-w-[150px]" />
                <div className="flex items-center bg-slate-100 rounded-lg p-1">
                    <button onClick={() => {
                        // Safe date manipulation
                        const [y, m, d] = currentDate.split('-').map(Number);
                        const prevDate = new Date(y, m - 1, d - 1);
                        const year = prevDate.getFullYear();
                        const month = String(prevDate.getMonth() + 1).padStart(2, '0');
                        const day = String(prevDate.getDate()).padStart(2, '0');
                        setCurrentDate(`${year}-${month}-${day}`);
                    }} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500"><ChevronLeft size={20}/></button>
                    <input type="date" className="bg-transparent border-none text-center font-bold text-slate-700 outline-none w-32" value={currentDate} onChange={e => setCurrentDate(e.target.value)} />
                    <button onClick={() => {
                        const [y, m, d] = currentDate.split('-').map(Number);
                        const nextDate = new Date(y, m - 1, d + 1);
                        const year = nextDate.getFullYear();
                        const month = String(nextDate.getMonth() + 1).padStart(2, '0');
                        const day = String(nextDate.getDate()).padStart(2, '0');
                        setCurrentDate(`${year}-${month}-${day}`);
                    }} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500"><ChevronRight size={20}/></button>
                </div>
            </div>
            <div className="flex gap-2 items-center">
                {saveStatus === 'saving' && <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Saving...</span>}
                {saveStatus === 'saved' && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={12}/> Saved</span>}
                {saveStatus === 'error' && <span className="text-xs text-rose-500 flex items-center gap-1"><WifiOff size={12}/> Disconnected</span>}
                
                <button 
                    onClick={handleManualSave} 
                    disabled={isManualSaving} 
                    className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
                >
                    {isManualSaving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} 
                    {isManualSaving ? "儲存中..." : "儲存變更"}
                </button>

                <button onClick={handleSyncCalendar} disabled={isSyncing} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-blue-100 transition-colors">
                    {isSyncing ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} 同步預約
                </button>
                
                <button onClick={() => selectedClinic && exportDailyReportToExcel(selectedClinic.name, currentDate, rows)} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-slate-200 transition-colors">
                    <FileSpreadsheet size={16} /> 匯出 Excel
                </button>
            </div>
        </div>

        {/* 2. Dashboard Logic */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
            {/* Card 1 */}
            <div className="bg-emerald-600 rounded-xl shadow-lg p-5 text-white flex flex-col justify-between relative overflow-hidden">
                <div className="relative z-10">
                    <h4 className="text-xs font-bold text-emerald-100 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <Wallet size={16} /> 現金結餘 (收入-支出)
                    </h4>
                    <div className="text-3xl font-black tabular-nums">${totals.cashBalance.toLocaleString()}</div>
                </div>
                <div className="mt-4 pt-3 border-t border-emerald-500/50 text-[10px] text-emerald-100 font-medium flex justify-between relative z-10">
                    <span>現金收: ${totals.cashRevenue.toLocaleString()}</span>
                    <span>總支: -${totals.totalExpenditure.toLocaleString()}</span>
                </div>
                <Wallet className="absolute -right-4 -bottom-4 text-emerald-500 opacity-20 rotate-12" size={100} />
            </div>

            {/* Card 2 */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 flex flex-col justify-between">
                <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <CreditCard size={16} className="text-slate-400" /> 非現金收入 (NON-CASH)
                    </h4>
                    <div className="text-3xl font-black text-slate-800 tabular-nums">${totals.nonCash.toLocaleString()}</div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 font-medium flex justify-between">
                    <span>💳 ${totals.cardRevenue.toLocaleString()}</span>
                    <span>🏦 ${totals.transferRevenue.toLocaleString()}</span>
                </div>
            </div>

            {/* Card 3 */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg rounded-xl p-5 text-white flex flex-col justify-between relative overflow-hidden">
                <div className="relative z-10">
                    <h4 className="text-xs font-bold text-blue-100 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <TrendingUp size={16} /> 本日總結 (總收-支出)
                    </h4>
                    <div className="text-3xl font-black tabular-nums">${totals.netTotal.toLocaleString()}</div>
                </div>
                <div className="mt-4 pt-3 border-t border-white/10 text-[10px] text-blue-100 font-medium">
                    公式: (現金 + 刷卡 + 匯款) - 總支出
                </div>
                <TrendingUp className="absolute -right-4 -bottom-4 text-white opacity-10 rotate-12" size={100} />
            </div>
        </div>

        {/* 3. Main Data Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            {!isLoading && rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 bg-slate-50/50 m-4 border-2 border-dashed border-slate-200 rounded-xl gap-6 animate-fade-in">
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-indigo-500 shadow-sm border border-indigo-100">
                        <RefreshCw size={36} />
                    </div>
                    <div className="text-center space-y-1">
                        <h3 className="text-xl font-bold text-slate-800">尚無今日資料</h3>
                        <p className="text-slate-500 font-medium">No data for this date</p>
                    </div>
                    <div className="flex flex-col gap-3 w-full max-w-xs">
                        <button 
                            onClick={handleSyncCalendar} 
                            disabled={isSyncing}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3.5 px-6 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all active:scale-95 disabled:opacity-70 disabled:scale-100"
                        >
                            {isSyncing ? <Loader2 className="animate-spin" /> : <RefreshCw size={20} />}
                            同步 Google 日曆
                        </button>
                        
                        <div className="relative flex py-2 items-center">
                            <div className="flex-grow border-t border-slate-200"></div>
                            <span className="flex-shrink-0 mx-4 text-slate-300 text-xs font-bold uppercase">OR</span>
                            <div className="flex-grow border-t border-slate-200"></div>
                        </div>

                        <button 
                            onClick={handleAddRow}
                            className="w-full bg-white border-2 border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800 py-3 px-6 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                        >
                            <Plus size={18} />
                            手動新增一列
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto custom-scrollbar flex-1 min-h-[400px]">
                        <table className="w-full border-collapse text-xs">
                            <thead className="bg-gray-50 sticky top-0 z-40 shadow-sm font-bold tracking-tight">
                                <tr>
                                    {/* Group 1: Info */}
                                    <th className="px-2 py-2 border-r border-gray-200 text-center sticky left-0 bg-gray-50 z-50 w-10 text-slate-600">#</th>
                                    <th className="px-2 py-2 border-r border-gray-200 sticky left-[40px] bg-gray-50 z-50 min-w-[120px] text-left text-slate-600">病患姓名</th>
                                    <th className="px-2 py-2 border-r border-gray-200 min-w-[100px] text-right">
                                        <div className="flex items-center gap-1 justify-end">
                                            <span className="text-slate-600">醫師</span>
                                            <div className="relative group">
                                                <Filter size={12} className="text-slate-400 cursor-pointer" />
                                                <select 
                                                    className="absolute top-0 right-0 w-full h-full opacity-0 cursor-pointer"
                                                    value={filterDoctorId}
                                                    onChange={e => setFilterDoctorId(e.target.value)}
                                                >
                                                    <option value="">全部</option>
                                                    {activeDoctorsInTable.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </th>
                                    
                                    {/* Group 2: Fees (Blue) */}
                                    <th colSpan={2} className="px-2 py-1 border-r border-gray-200 border-t-4 border-blue-400 bg-blue-50/20 text-center text-slate-700">基本費用 (FEES)</th>
                                    
                                    {/* Group 3: Self-Pay (Purple) */}
                                    <th colSpan={8} className="px-2 py-1 border-r border-gray-200 border-t-4 border-purple-400 bg-purple-50/20 text-center text-slate-700">自費療程 (TREATMENT)</th>
                                    
                                    {/* Group 4: Retail (Orange) */}
                                    <th colSpan={4} className="px-2 py-1 border-r border-gray-200 border-t-4 border-orange-400 bg-orange-50/20 text-center text-slate-700">小金庫 (RETAIL)</th>
                                    
                                    {/* Group 5: Payment (Green) */}
                                    <th colSpan={2} className="px-2 py-1 border-r border-gray-200 border-t-4 border-emerald-500 bg-emerald-50/20 text-center text-slate-700">結帳 (PAYMENT)</th>
                                    
                                    {/* Group 6: Notes */}
                                    <th colSpan={4} className="px-2 py-1 border-t-4 border-slate-300 bg-slate-50 text-center text-slate-600">備註與操作</th>
                                </tr>
                                <tr>
                                    <th className="sticky left-0 bg-gray-50 z-50"></th>
                                    <th className="sticky left-[40px] bg-gray-50 z-50"></th>
                                    <th></th>
                                    {/* Sub Headers */}
                                    <th className="px-2 py-1 border-r border-blue-100 bg-blue-50/20 text-slate-700 text-center min-w-[60px]">掛號</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-blue-50/20 text-slate-700 text-center min-w-[60px]">部分</th>
                                    
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50/20 text-slate-700 text-center min-w-[70px]">假牙</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50/20 text-slate-700 text-center min-w-[70px]">植牙</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50/20 text-slate-700 text-center min-w-[70px]">矯正</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50/20 text-slate-700 text-center min-w-[70px]">SOV</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50/20 text-slate-700 text-center min-w-[70px]">INV</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50/20 text-slate-700 text-center min-w-[70px]">牙周</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50/20 text-slate-700 text-center min-w-[70px]">美白</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-purple-50/20 text-slate-700 text-center min-w-[70px]">其他</th>
                                    
                                    <th className="px-2 py-1 border-r border-orange-100 bg-orange-50/20 text-slate-700 text-center min-w-[70px]">小金庫</th>
                                    <th className="px-2 py-1 border-r border-orange-100 bg-orange-50/20 text-slate-700 text-center min-w-[70px]">物販</th>
                                    <th className="px-2 py-1 border-r border-orange-100 bg-orange-50/20 text-slate-700 text-center min-w-[100px]">品項</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-orange-50/20 text-slate-700 text-center min-w-[80px]">經手人</th>
                                    
                                    <th className="px-2 py-1 border-r border-emerald-100 bg-emerald-50/20 text-slate-700 text-center min-w-[80px]">實收總計</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-emerald-50/20 text-slate-700 text-center min-w-[70px]">方式</th>
                                    
                                    <th className="px-2 py-1 border-r border-gray-200 bg-slate-50 text-slate-500 min-w-[50px]">NP</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-slate-50 text-slate-500 min-w-[120px]">療程內容</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-slate-50 text-slate-500 min-w-[100px]">技工所</th>
                                    <th className="px-2 py-1 bg-slate-50 w-8"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {visibleRows.map((row, idx) => {
                                    const totalAmount = (row.treatments.regFee||0) + (row.treatments.copayment||0) + 
                                                    (row.treatments.prostho||0) + (row.treatments.implant||0) + (row.treatments.ortho||0) + 
                                                    (row.treatments.sov||0) + (row.treatments.inv||0) + (row.treatments.perio||0) + 
                                                    (row.treatments.whitening||0) + (row.treatments.otherSelfPay||0) + 
                                                    (row.retail.products||0) + (row.retail.diyWhitening||0);

                                    return (
                                        <tr key={row.id} className="hover:bg-blue-50/30 group">
                                            {/* 1. Info */}
                                            <td className="px-1 py-1 border-r border-gray-200 text-center sticky left-0 bg-white group-hover:bg-blue-50/30 z-30">
                                                <div className="flex flex-col items-center gap-1">
                                                    <button 
                                                        onClick={() => updateRow(row.id, { attendance: !row.attendance })}
                                                        className="transition-colors"
                                                    >
                                                        {row.attendance ? <CheckCircle size={14} className="text-emerald-500" /> : <Circle size={14} className="text-slate-300" />}
                                                    </button>
                                                    <span className="text-[9px] text-slate-400">{idx+1}</span>
                                                </div>
                                            </td>
                                            <td className="px-1 py-1 border-r border-gray-200 sticky left-[40px] bg-white group-hover:bg-blue-50/30 z-30 align-middle">
                                                <InputCell 
                                                    initialValue={row.patientName} 
                                                    onCommit={(v) => updateRow(row.id, { patientName: v })}
                                                    className={getPatientNameClass(row)}
                                                />
                                            </td>
                                            <td className="px-1 py-1 border-r border-gray-200 text-center align-middle">
                                                {row.isManual ? (
                                                    <select 
                                                        className="w-full bg-transparent text-xs outline-none text-slate-700 font-medium text-right"
                                                        dir="rtl"
                                                        value={row.doctorId}
                                                        onChange={(e) => updateRow(row.id, { doctorId: e.target.value, doctorName: clinicDocs.find(d=>d.id===e.target.value)?.name||'' })}
                                                    >
                                                        <option value="">選醫師</option>
                                                        {clinicDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                                    </select>
                                                ) : (
                                                    <div className="flex items-center gap-2 justify-end pr-2">
                                                        <div 
                                                            className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] text-white font-bold shrink-0"
                                                            style={{ backgroundColor: getDoctorColor(row.doctorId) }}
                                                        >
                                                            {getDoctorAvatarText(row.doctorId, row.doctorName)}
                                                        </div>
                                                        <span className="text-xs text-slate-700 font-medium truncate max-w-[60px] text-right">{row.doctorName}</span>
                                                    </div>
                                                )}
                                            </td>

                                            {/* 2. Fees */}
                                            <td className="px-1 py-1 border-r border-gray-200 bg-blue-50/10">
                                                <InputCell type="number" align="right" className="text-blue-600 font-mono text-[14px]" initialValue={row.treatments.regFee} onCommit={(v) => updateRow(row.id, { treatments: { regFee: safeNum(v) } })} />
                                            </td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-blue-50/10">
                                                <InputCell type="number" align="right" className="text-blue-600 font-mono text-[14px]" initialValue={row.treatments.copayment} onCommit={(v) => updateRow(row.id, { treatments: { copayment: safeNum(v) } })} />
                                            </td>

                                            {/* 3. Self-Pay */}
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.prostho} onCommit={(v) => updateRow(row.id, { treatments: { prostho: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.implant} onCommit={(v) => updateRow(row.id, { treatments: { implant: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.ortho} onCommit={(v) => updateRow(row.id, { treatments: { ortho: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.sov} onCommit={(v) => updateRow(row.id, { treatments: { sov: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.inv} onCommit={(v) => updateRow(row.id, { treatments: { inv: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.perio} onCommit={(v) => updateRow(row.id, { treatments: { perio: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.whitening} onCommit={(v) => updateRow(row.id, { treatments: { whitening: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.otherSelfPay} onCommit={(v) => updateRow(row.id, { treatments: { otherSelfPay: safeNum(v) } })} /></td>

                                            {/* 4. Retail */}
                                            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell type="number" align="right" className="text-orange-600 font-mono text-[14px]" initialValue={row.retail.diyWhitening} onCommit={(v) => updateRow(row.id, { retail: { diyWhitening: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell type="number" align="right" className="text-orange-600 font-mono text-[14px]" initialValue={row.retail.products} onCommit={(v) => updateRow(row.id, { retail: { products: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell initialValue={row.retailItem} onCommit={(v) => updateRow(row.id, { retailItem: v })} placeholder="品項" /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10">
                                                <select 
                                                    className="w-full bg-transparent text-xs text-slate-600 outline-none"
                                                    value={row.retail.staff || ''}
                                                    onChange={(e) => updateRow(row.id, { retail: { staff: e.target.value } })}
                                                >
                                                    <option value=""></option>
                                                    {staffOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                </select>
                                            </td>

                                            {/* 5. Payment */}
                                            <td className="px-2 py-1 border-r border-gray-200 bg-emerald-50/10 text-right font-black text-emerald-600 text-lg font-bold">
                                                {totalAmount > 0 ? totalAmount.toLocaleString() : '-'}
                                            </td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-emerald-50/10">
                                                <select 
                                                    className={`w-full bg-transparent text-[10px] font-bold outline-none uppercase text-center ${row.paymentMethod === 'card' ? 'text-pink-600' : row.paymentMethod === 'transfer' ? 'text-amber-600' : 'text-emerald-600'}`}
                                                    value={row.paymentMethod}
                                                    onChange={(e) => updateRow(row.id, { paymentMethod: e.target.value })}
                                                >
                                                    <option value="cash">CASH</option>
                                                    <option value="card">CARD</option>
                                                    <option value="transfer">TRANS</option>
                                                </select>
                                            </td>

                                            {/* 6. Notes & Ops */}
                                            <td className="px-1 py-1 border-r border-gray-200"><InputCell initialValue={row.npStatus} onCommit={(v) => updateRow(row.id, { npStatus: v })} placeholder="$" /></td>
                                            <td className="px-1 py-1 border-r border-gray-200"><InputCell initialValue={row.treatmentContent} onCommit={(v) => updateRow(row.id, { treatmentContent: v })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200">
                                                <select
                                                    className="w-full bg-transparent text-xs outline-none text-slate-600"
                                                    value={row.labName || ''}
                                                    onChange={(e) => updateRow(row.id, { labName: e.target.value })}
                                                >
                                                    <option value=""></option>
                                                    {clinicLabs.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                                                </select>
                                            </td>
                                            <td className="px-1 py-1 text-center">
                                                {row.isManual && (
                                                    <button onClick={() => handleDeleteRow(row.id)} className="text-slate-300 hover:text-rose-500 transition-colors">
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <button onClick={handleAddRow} className="w-full py-2 bg-slate-50 border-t border-slate-200 text-blue-600 font-bold text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-1">
                        <Plus size={16} /> 新增一列 (Add Row)
                    </button>
                </>
            )}
        </div>

        {/* 4. Expenditure */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 bg-rose-50 border-b border-rose-100 flex justify-between items-center">
                <h4 className="font-bold text-rose-700 text-sm">診所支出 (Expenditure)</h4>
                <div className="flex items-center gap-4">
                    <span className="text-xs font-bold text-rose-600">總計: ${totals.totalExpenditure.toLocaleString()}</span>
                    <button onClick={() => handleExpenditureChange([...expenditures, { id: crypto.randomUUID(), item: '', amount: 0 }])} className="text-xs bg-white text-rose-600 px-2 py-1 rounded border border-rose-200 font-bold hover:bg-rose-100">
                        + 新增
                    </button>
                </div>
            </div>
            <div className="p-2 space-y-2 max-h-[200px] overflow-y-auto">
                {expenditures.map((ex, idx) => (
                    <div key={ex.id} className="flex gap-2 items-center bg-slate-50 p-1.5 rounded border border-slate-100">
                        <input className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none" value={ex.item} onChange={e => {
                            const newEx = [...expenditures]; newEx[idx].item = e.target.value; handleExpenditureChange(newEx);
                        }} placeholder="項目名稱" />
                        <input type="number" className="w-24 bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none text-right font-bold text-rose-600" value={ex.amount} onChange={e => {
                            const newEx = [...expenditures]; newEx[idx].amount = Number(e.target.value); handleExpenditureChange(newEx);
                        }} placeholder="0" />
                        <button onClick={() => handleExpenditureChange(expenditures.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-500"><Trash2 size={14} /></button>
                    </div>
                ))}
            </div>
        </div>
    </div>
  );
};
