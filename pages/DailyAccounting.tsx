import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Doctor, Consultant, Laboratory, SOVReferral, DailyAccountingRecord, AccountingRow, Expenditure, AuditLogEntry, NPRecord } from '../types';
import { hydrateRow, getStaffList, db, deepSanitize, lockDailyReport, unlockDailyReport, saveDailyAccounting, findPatientProfile, addSOVReferral } from '../services/firebase';
import { exportDailyReportToExcel } from '../services/excelExport';
import { listEvents } from '../services/googleCalendar';
import { parseCalendarEvent } from '../utils/eventParser';
import { ClinicSelector } from '../components/ClinicSelector';
import { useClinic } from '../contexts/ClinicContext';
import { useAuth } from '../contexts/AuthContext';
import { ClosingSummaryModal } from '../components/ClosingSummaryModal';
import { AuditLogModal } from '../components/AuditLogModal';
import { NPStatusModal } from '../components/NPStatusModal';
import { 
  Save, Plus, Trash2, FileSpreadsheet, Loader2,
  ChevronLeft, ChevronRight, RefreshCw, 
  Wallet, CreditCard, TrendingUp, CheckCircle, Circle, Filter,
  WifiOff, Lock, Unlock, History, Tag
} from 'lucide-react';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
  consultants: Consultant[];
  laboratories: Laboratory[];
  sovReferrals: SOVReferral[];
}

const InputCell = ({ 
    initialValue, 
    onCommit, 
    className = "", 
    placeholder = "",
    type = "text",
    align = "left",
    disabled = false
}: { 
    initialValue: any, 
    onCommit: (val: any) => void, 
    className?: string, 
    placeholder?: string, 
    type?: "text" | "number",
    align?: "left" | "right" | "center",
    disabled?: boolean
}) => {
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const handleBlur = () => {
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
            disabled={disabled}
            className={`w-full bg-transparent outline-none px-1 py-1 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 rounded-sm transition-colors placeholder-slate-300 ${alignClass} ${className} ${disabled ? 'cursor-not-allowed text-slate-400' : ''}`}
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

// --- Date Helpers (Local Time) ---
const getTodayStr = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const getNextDate = (dateStr: string, offset: number) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d); // Construct Local Date
    date.setDate(date.getDate() + offset); // Mutate safely
    
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
};

const TREATMENT_LABELS: Record<string, string> = {
    regFee: '掛號', copayment: '部分', prostho: '假牙', implant: '植牙',
    ortho: '矯正', sov: 'SOV', inv: 'INV', whitening: '美白',
    perio: '牙周', otherSelfPay: '其他'
};

const RETAIL_LABELS: Record<string, string> = {
    products: '物販', diyWhitening: '小金庫'
};

const calculateDiff = (oldRow: AccountingRow, newRow: AccountingRow): string | null => {
    const changes: string[] = [];
    const prefix = `[${newRow.patientName || '未命名'}]`;

    if (oldRow.chartId !== newRow.chartId) changes.push(`ChartID: ${oldRow.chartId || '無'} -> ${newRow.chartId}`);
    if (oldRow.patientName !== newRow.patientName) changes.push(`Name: ${oldRow.patientName} -> ${newRow.patientName}`);
    if (oldRow.paymentMethod !== newRow.paymentMethod) changes.push(`支付: ${oldRow.paymentMethod} -> ${newRow.paymentMethod}`);
    
    (Object.keys(TREATMENT_LABELS) as Array<keyof typeof newRow.treatments>).forEach(key => {
        const oldV = safeNum(oldRow.treatments[key]);
        const newV = safeNum(newRow.treatments[key]);
        if (oldV !== newV) {
            changes.push(`${TREATMENT_LABELS[key]}: ${oldV} -> ${newV}`);
        }
    });

    (Object.keys(RETAIL_LABELS) as Array<keyof typeof newRow.retail>).forEach(key => {
        const oldV = safeNum(oldRow.retail[key]);
        const newV = safeNum(newRow.retail[key]);
        if (oldV !== newV) {
            changes.push(`${RETAIL_LABELS[key]}: ${oldV} -> ${newV}`);
        }
    });
    
    if (changes.length === 0) return null;
    return `${prefix} ${changes.join(', ')}`;
};

export const DailyAccounting: React.FC<Props> = ({ clinics, doctors, consultants, laboratories, sovReferrals }) => {
  const { selectedClinicId, selectedClinic } = useClinic();
  const { currentUser, userRole } = useAuth();
  
  // ... (State definitions remain same) ...
  const [currentDate, setCurrentDate] = useState(getTodayStr());
  
  const [dailyRecord, setDailyRecord] = useState<DailyAccountingRecord | null>(null);
  const [rows, setRows] = useState<AccountingRow[]>([]);
  const [expenditures, setExpenditures] = useState<Expenditure[]>([]);
  const [fullStaffList, setFullStaffList] = useState<Consultant[]>([]);
  
  // New: Store NP Records for Status Colors
  const [todaysNPRecords, setTodaysNPRecords] = useState<Record<string, NPRecord>>({});
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isManualSaving, setIsManualSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [filterDoctorId, setFilterDoctorId] = useState<string>('');
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [npModalData, setNpModalData] = useState<{row: AccountingRow} | null>(null);

  const getDocId = (clinicId: string, dateStr: string) => `${clinicId}_${dateStr}`;

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

  // NEW: Real-time listener for NP Records Status
  useEffect(() => {
      if (!selectedClinicId || !currentDate) {
          setTodaysNPRecords({});
          return;
      }

      const unsubscribe = db.collection('np_records')
          .where('clinicId', '==', selectedClinicId)
          .where('date', '==', currentDate)
          .onSnapshot(snapshot => {
              const map: Record<string, NPRecord> = {};
              snapshot.forEach(doc => {
                  const data = doc.data() as NPRecord;
                  if (data.patientName) {
                      map[data.patientName.trim()] = data;
                  }
              });
              setTodaysNPRecords(map);
          });

      return () => unsubscribe();
  }, [selectedClinicId, currentDate]);

  const consultantOptions = useMemo(() => 
      fullStaffList.filter(c => c.role === 'consultant' || c.role === 'trainee'), 
  [fullStaffList]);

  const staffOptions = useMemo(() => 
      fullStaffList.filter(c => ['consultant', 'trainee', 'assistant'].includes(c.role || '')), 
  [fullStaffList]);

  const clinicDocs = doctors.filter(d => d.clinicId === selectedClinicId);
  const clinicLabs = laboratories.filter(l => l.clinicId === selectedClinicId);

  const activeDoctorsInTable = useMemo(() => {
      const docIds = new Set(rows.map(r => r.doctorId).filter(Boolean));
      return clinicDocs.filter(d => docIds.has(d.id));
  }, [rows, clinicDocs]);

  useEffect(() => {
      if (!selectedClinicId || !currentDate) {
          setDailyRecord(null);
          setRows([]);
          setExpenditures([]);
          return;
      }

      setIsLoading(true);
      const docId = getDocId(selectedClinicId, currentDate);
      
      const unsubscribe = db.collection('daily_accounting').doc(docId).onSnapshot((doc: any) => {
          setIsLoading(false);
          
          if (doc.exists) {
              const data = doc.data() as DailyAccountingRecord;
              setDailyRecord(data);
              
              const loadedRows = (data.rows || []).map(r => hydrateRow(r));
              setRows(loadedRows);
              setExpenditures(data.expenditures || []);
          } else {
              setDailyRecord(null);
              setRows([]);
              setExpenditures([]);
          }
      }, (error: any) => {
          console.error("Listener Error:", error);
          setIsLoading(false);
          setSaveStatus('error');
      });

      return () => unsubscribe();
  }, [selectedClinicId, currentDate]);

  const isLocked = dailyRecord?.isLocked || false;

  // UX Improvement: Sort Daily Report Rows (Calendar First, Manual Last)
  const visibleRows = useMemo(() => {
      let filtered = rows;
      if (filterDoctorId) {
          filtered = rows.filter(r => r.doctorId === filterDoctorId);
      }
      
      return [...filtered].sort((a, b) => {
          // Primary Sort: Calendar (isManual === false) first, Manual (isManual === true) second
          if (a.isManual !== b.isManual) {
              return a.isManual ? 1 : -1;
          }
          // Secondary Sort: Start Time
          return (a.startTime || '').localeCompare(b.startTime || '');
      });
  }, [rows, filterDoctorId]);

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

  const getPatientNameClass = (row: AccountingRow) => {
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

  const handleSyncCalendar = async () => {
      if (isLocked) { alert("今日已結帳，無法同步。"); return; }
      if (!selectedClinic?.googleCalendarMapping) { alert("此診所尚未設定 Google 日曆連結"); return; }
      
      setIsSyncing(true);
      try {
          const start = new Date(currentDate); start.setHours(0,0,0,0);
          const end = new Date(currentDate); end.setHours(23,59,59,999);
          const mapping = selectedClinic.googleCalendarMapping;
          const existingIds = new Set(rows.map(r => r.id));
          const newRows: AccountingRow[] = [];

          const allEvents: any[] = [];

          // 1. Gather all events first to process in parallel
          for (const doc of clinicDocs) {
              const calendarId = mapping[doc.id];
              if (calendarId) {
                  const events = await listEvents(calendarId, start, end);
                  events.forEach(ev => {
                      if (!existingIds.has(ev.id) && !ev.allDay) {
                          allEvents.push({ event: ev, doc });
                      }
                  });
              }
          }

          // 2. Process events with CRM Lookup in parallel
          const processedRows = await Promise.all(allEvents.map(async ({ event, doc }) => {
              const parsed = parseCalendarEvent(event.summary);
              if (!parsed) return null;

              let lastConsultant = '';
              let finalChartId = parsed.chartId; // Default to calendar ID (if present)

              // Unified Strict Lookup
              // If parsed.chartId exists, look up by ID only (Case A).
              // If parsed.chartId is missing, fallback to Name lookup (Case B).
              try {
                  const profile = await findPatientProfile(selectedClinicId, parsed.name, parsed.chartId);
                  if (profile) {
                      // Found a CRM match
                      if (profile.lastConsultant) lastConsultant = profile.lastConsultant;
                      // Sync the canonical Chart ID from CRM (overwrites typo in calendar if match found)
                      if (profile.chartId) finalChartId = profile.chartId;
                  }
              } catch (e) {
                  console.warn("CRM lookup failed", e);
              }

              // Construct the row
              return {
                  ...hydrateRow({}),
                  id: event.id,
                  patientName: parsed.name,
                  doctorId: doc.id,
                  doctorName: doc.name,
                  treatmentContent: parsed.treatment,
                  // FIX: If it's not an NP, the field must be BLANK by default. 
                  npStatus: parsed.isNP ? 'NP' : '',
                  isManual: false,
                  attendance: true,
                  startTime: event.start.dateTime || new Date().toISOString(),
                  chartId: finalChartId || undefined,
                  patientStatus: parsed.status,
                  // @ts-ignore
                  isNP: parsed.isNP,
                  treatments: {
                      ...hydrateRow({}).treatments,
                      consultant: lastConsultant
                  }
              } as AccountingRow;
          }));

          // Filter out nulls
          processedRows.forEach(row => {
              if (row) newRows.push(row);
          });

          if (newRows.length > 0) {
              const updated = [...rows, ...newRows].sort((a,b) => (a.startTime||'').localeCompare(b.startTime||''));
              await persistData(updated, expenditures);
          } else {
              alert("已同步，無新增項目");
          }
      } catch (e) {
          console.error(e);
          alert("同步失敗");
      } finally {
          setIsSyncing(false);
      }
  };

  const handleAddRow = () => {
      if (isLocked) return;
      const newRow: AccountingRow = {
          ...hydrateRow({}),
          id: crypto.randomUUID(),
          isManual: true,
          attendance: true,
          startTime: new Date().toISOString(),
          chartId: null,
          patientStatus: '',
          paymentBreakdown: { cash: 0, card: 0, transfer: 0 }
      };
      const updated = [...rows, newRow];
      persistData(updated, expenditures);
  };

  const handleDeleteRow = (id: string) => {
      if (isLocked) return;
      if (!confirm("確定刪除此列？")) return;
      const updated = rows.filter(r => r.id !== id);
      persistData(updated, expenditures);
  };

  const prepareDataForSave = (currentRows: AccountingRow[]) => {
      return currentRows.map(row => {
          const t = row.treatments;
          const r = row.retail;
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
              attendance: row.attendance ?? true,
              chartId: row.chartId || ''
          };
      });
  };

  const persistData = async (currentRows: AccountingRow[], currentExp: Expenditure[], diffDetails?: string) => {
      if (!selectedClinicId) return;
      setSaveStatus('saving');
      try {
          const cleanRows = prepareDataForSave(currentRows);
          
          const payload = {
              clinicId: selectedClinicId,
              date: currentDate,
              rows: cleanRows,
              expenditures: currentExp,
              lastUpdated: Date.now(),
              isLocked: dailyRecord?.isLocked || false,
          };

          let auditEntry: AuditLogEntry | undefined;
          if (diffDetails) {
              auditEntry = {
                  timestamp: new Date().toISOString(),
                  userId: currentUser?.uid || 'unknown',
                  userName: currentUser?.email || 'User',
                  action: 'UPDATE',
                  details: diffDetails
              };
          }

          await saveDailyAccounting(payload, auditEntry);
          
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (e) {
          console.error(e);
          setSaveStatus('error');
      }
  };

  const handleManualSave = async () => {
      if (isLocked) { alert("已結帳鎖定，無法修改"); return; }
      if (!selectedClinicId) { alert("請先選擇診所"); return; }
      setIsManualSaving(true);
      try {
          await persistData(rows, expenditures);
          alert("✅ 儲存成功！");
      } catch (error: any) {
          alert("❌ 儲存失敗: " + error.message);
      } finally {
          setIsManualSaving(false);
      }
  };

  const updateRow = (id: string, updates: Partial<AccountingRow> | any) => {
      const isRestrictedField = Object.keys(updates).some(key => 
          ['treatments', 'retail', 'patientName', 'paymentMethod', 'doctorId', 'chartId'].includes(key)
      );

      if (isLocked && isRestrictedField) {
          console.warn("Edit prevented: Record is locked.");
          return;
      }

      let diffString: string | null = null;

      const updatedRows = rows.map(r => {
          if (r.id === id) {
              const newRow = { ...r };
              Object.keys(updates).forEach(key => {
                  if (typeof updates[key] === 'object' && updates[key] !== null && !Array.isArray(updates[key])) {
                      (newRow as any)[key] = { ...((newRow as any)[key] as any), ...updates[key] };
                  } else {
                      (newRow as any)[key] = updates[key];
                  }
              });
              
              if (updates.doctorId) {
                  const doc = clinicDocs.find(d => d.id === updates.doctorId);
                  if (doc) newRow.doctorName = doc.name;
              }

              // --- AUTO LEARN SOV REFERRAL ---
              if (updates.labName === 'SOV轉介' && newRow.patientName) {
                  addSOVReferral(selectedClinicId, newRow.patientName).catch(e => console.error(e));
              }

              // --- AUTO SOV LAB LOGIC START ---
              if (updates.treatments && typeof updates.treatments.sov === 'number') {
                  const sovAmount = updates.treatments.sov;
                  if (sovAmount > 0) {
                      const pName = (newRow.patientName || '').trim();
                      // Check matching referral for this clinic
                      const isReferral = sovReferrals.some(ref => 
                          ref.name.trim() === pName && 
                          ref.clinicId === selectedClinicId
                      );
                      
                      newRow.labName = isReferral ? "SOV轉介" : "SOV自約";
                  }
              }
              // --- AUTO SOV LAB LOGIC END ---

              diffString = calculateDiff(r, newRow);
              return newRow;
          }
          return r;
      });

      setRows(updatedRows);
      persistData(updatedRows, expenditures, diffString || undefined);
  };

  const handleExpenditureChange = (newExp: Expenditure[]) => {
      if (isLocked) return;
      setExpenditures(newExp);
      persistData(rows, newExp);
  };

  const handleLockDay = async () => {
      if (!currentUser || !selectedClinicId) return;
      try {
          await lockDailyReport(currentDate, selectedClinicId, rows, { uid: currentUser.uid, name: currentUser.email || 'User' });
      } catch (e) {
          alert("結帳失敗，請重試");
          throw e; 
      }
  };

  const handleUnlockDay = async () => {
      if (!currentUser || !selectedClinicId) return;
      if (userRole !== 'admin' && userRole !== 'manager') {
          alert("權限不足：僅管理員可解鎖");
          return;
      }
      if (!confirm("確定要解鎖嗎？系統將自動嘗試填入遺漏的病歷號，所有變更將被記錄。")) return;
      
      setIsSyncing(true);
      try {
          let hasUpdates = false;
          const updatedRows = [...rows];
          
          await Promise.all(updatedRows.map(async (row, idx) => {
              // Replaced logic: Use findPatientProfile for reliable lookup
              if (!row.chartId && row.patientName) {
                  const patient = await findPatientProfile(selectedClinicId, row.patientName);
                  if (patient && patient.chartId) {
                      updatedRows[idx] = { ...row, chartId: patient.chartId };
                      hasUpdates = true;
                  }
              }
          }));

          if (hasUpdates) {
              await persistData(updatedRows, expenditures);
              setRows(updatedRows);
          }

          await unlockDailyReport(currentDate, selectedClinicId, { uid: currentUser.uid, name: currentUser.email || 'User' });
      } catch (e) {
          console.error(e);
          alert("解鎖失敗");
      } finally {
          setIsSyncing(false);
      }
  };

  const handleSafeDateChange = async (targetDate: string) => {
      const todayStr = getTodayStr();
      const isCurrentPagePast = currentDate < todayStr;
      const hasData = rows.length > 0;
      const isLockedStatus = dailyRecord?.isLocked === true;
      const isUnlocked = !isLockedStatus;

      if (isCurrentPagePast && hasData && isUnlocked) {
          const confirmLock = window.confirm(
              `[日期: ${currentDate}] 尚未結帳鎖定。\n是否立即鎖定並繼續？\n(按確定: 鎖定並跳轉 | 按取消: 不鎖定直接跳轉)`
          );

          if (confirmLock) {
              try {
                  await handleLockDay(); 
              } catch(e) {
                  return;
              }
          }
      }
      
      setCurrentDate(targetDate);
  };

  const handlePrevDay = () => handleSafeDateChange(getNextDate(currentDate, -1));
  const handleNextDay = () => handleSafeDateChange(getNextDate(currentDate, 1));

  useEffect(() => {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          const todayStr = getTodayStr();
          const isCurrentPagePast = currentDate < todayStr;
          const hasData = rows.length > 0;
          const isLockedStatus = dailyRecord?.isLocked === true;
          const isUnlocked = !isLockedStatus;
          
          if (isCurrentPagePast && hasData && isUnlocked) {
              e.preventDefault();
              e.returnValue = ''; 
          }
      };
      
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dailyRecord, currentDate, rows.length]);

  return (
    <div className="space-y-6 pb-20">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
                <ClinicSelector className="border p-2 rounded-lg bg-slate-50 min-w-[150px]" />
                <div className="flex items-center bg-slate-100 rounded-lg p-1">
                    <button onClick={handlePrevDay} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500"><ChevronLeft size={20}/></button>
                    
                    <input 
                        type="date" 
                        className="bg-transparent border-none text-center font-bold text-slate-700 outline-none w-32 cursor-pointer" 
                        value={currentDate} 
                        onChange={e => handleSafeDateChange(e.target.value)} 
                    />
                    
                    <button onClick={handleNextDay} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500"><ChevronRight size={20}/></button>
                </div>
                
                {isLocked ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm font-bold">
                        <Lock size={14} /> 已結帳
                    </div>
                ) : (
                    <button 
                        onClick={() => setIsClosingModalOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm font-bold hover:bg-emerald-100 transition-colors"
                    >
                        <Unlock size={14} /> 結帳鎖定
                    </button>
                )}
            </div>

            <div className="flex gap-2 items-center">
                {saveStatus === 'saving' && <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Saving...</span>}
                {saveStatus === 'saved' && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={12}/> Saved</span>}
                {saveStatus === 'error' && <span className="text-xs text-rose-500 flex items-center gap-1"><WifiOff size={12}/> Disconnected</span>}
                
                {isLocked && (userRole === 'admin' || userRole === 'manager') && (
                    <button onClick={handleUnlockDay} disabled={isSyncing} className="text-rose-500 hover:bg-rose-50 px-3 py-2 rounded-lg font-bold text-sm border border-rose-200 flex items-center gap-2">
                        {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />} 
                        解鎖
                    </button>
                )}

                <button onClick={() => setIsAuditModalOpen(true)} className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100" title="異動紀錄">
                    <History size={18} />
                </button>

                <button 
                    onClick={handleManualSave} 
                    disabled={isManualSaving || isLocked} 
                    className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
                >
                    {isManualSaving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} 
                    儲存
                </button>

                <button onClick={handleSyncCalendar} disabled={isSyncing || isLocked} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-blue-100 transition-colors disabled:opacity-50">
                    {isSyncing ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} 同步預約
                </button>
                
                <button 
                    onClick={() => selectedClinic && exportDailyReportToExcel(selectedClinic.id, selectedClinic.name, currentDate, rows, expenditures, fullStaffList)} 
                    className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-slate-200 transition-colors"
                >
                    <FileSpreadsheet size={16} /> 匯出
                </button>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
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

            <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 flex flex-col justify-between">
                <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <CreditCard size={16} className="text-slate-400" /> 非現金收入 (NON-CASH)
                    </h4>
                    <div className="text-3xl font-black text-slate-800 tabular-nums">${totals.nonCash.toLocaleString()}</div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 font-medium flex justify-between">
                    <span>💳刷卡 ${totals.cardRevenue.toLocaleString()}</span>
                    <span>🏦匯款 ${totals.transferRevenue.toLocaleString()}</span>
                </div>
            </div>

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
                    {!isLocked && (
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
                    )}
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)] custom-scrollbar flex-1 min-h-[400px] border-b border-slate-200">
                        <table className="w-full border-collapse text-xs">
                            <thead className="bg-gray-50 z-40 shadow-sm font-bold tracking-tight">
                                <tr className="sticky top-[2px] z-40">
                                    <th className="px-2 py-2 border-r border-gray-200 text-center sticky left-0 bg-gray-50 z-50 min-w-[24px] text-slate-600" rowSpan={2}>#</th>
                                    
                                    <th className="px-2 py-2 border-r border-gray-200 sticky left-[24px] bg-gray-50 z-50 min-w-[80px] text-left text-slate-600" rowSpan={2}>病歷號</th>
                                    
                                    <th className="px-2 py-2 border-r border-gray-200 sticky left-[104px] bg-gray-50 z-50 min-w-[100px] text-left text-slate-600" rowSpan={2}>病患姓名</th>
                                    <th className="px-2 py-2 border-r border-gray-200 min-w-[100px] text-right bg-gray-50" rowSpan={2}>
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
                                    
                                    <th colSpan={2} className="px-2 py-1 border-r border-gray-200 border-t-4 border-blue-400 bg-blue-50 text-center text-slate-700">基本費用 (FEES)</th>
                                    <th colSpan={9} className="px-2 py-1 border-r border-gray-200 border-t-4 border-purple-400 bg-purple-50 text-center text-slate-700">自費療程 (TREATMENT)</th>
                                    <th colSpan={4} className="px-2 py-1 border-r border-gray-200 border-t-4 border-orange-400 bg-orange-50 text-center text-slate-700">小金庫 (RETAIL)</th>
                                    <th colSpan={2} className="px-2 py-1 border-r border-gray-200 border-t-4 border-emerald-500 bg-emerald-50 text-center text-slate-700">結帳 (PAYMENT)</th>
                                    <th colSpan={4} className="px-2 py-1 border-t-4 border-slate-300 bg-slate-50 text-center text-slate-600">備註與操作</th>
                                </tr>
                                <tr className="sticky top-[25px] z-30 shadow-sm">
                                    <th className="px-2 py-1 border-r border-blue-100 bg-blue-50 text-slate-700 text-center min-w-[60px]">掛號</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-blue-50 text-slate-700 text-center min-w-[60px]">部分</th>
                                    
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50 text-slate-700 text-center min-w-[70px]">假牙</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50 text-slate-700 text-center min-w-[70px]">植牙</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50 text-slate-700 text-center min-w-[70px]">矯正</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50 text-slate-700 text-center min-w-[70px]">SOV</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50 text-slate-700 text-center min-w-[70px]">INV</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50 text-slate-700 text-center min-w-[70px]">牙周</th>
                                    <th className="px-2 py-1 border-r border-purple-100 bg-purple-50 text-slate-700 text-center min-w-[70px]">美白</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-purple-50 text-slate-700 text-center min-w-[70px]">其他</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-purple-50 text-slate-700 text-center min-w-[80px]">諮詢師</th>
                                    
                                    <th className="px-2 py-1 border-r border-orange-100 bg-orange-50 text-slate-700 text-center min-w-[70px]">小金庫</th>
                                    <th className="px-2 py-1 border-r border-orange-100 bg-orange-50 text-slate-700 text-center min-w-[70px]">物販</th>
                                    <th className="px-2 py-1 border-r border-orange-100 bg-orange-50 text-slate-700 text-center min-w-[100px]">品項</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-orange-50 text-slate-700 text-center min-w-[80px]">經手人</th>
                                    
                                    <th className="px-2 py-1 border-r border-emerald-100 bg-emerald-50 text-slate-700 text-center min-w-[80px]">實收總計</th>
                                    <th className="px-2 py-1 border-r border-gray-200 bg-emerald-50 text-slate-700 text-center min-w-[70px]">方式</th>
                                    
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
                                    
                                    const isChartIdLocked = isLocked || (!row.isManual && !!row.chartId && row.chartId !== 'NP');
                                    
                                    const isNP = 
                                        (row as any).isNP === true || 
                                        (row.npStatus && typeof row.npStatus === 'string' && row.npStatus.toUpperCase().includes('NP')) ||
                                        ((row as any).note && typeof (row as any).note === 'string' && (row as any).note.toUpperCase().includes('NP'));

                                    // NP Button Color Logic
                                    // Strictly dependent on np_records state, ignoring row.attendance
                                    const npRec = todaysNPRecords[(row.patientName || '').trim()];
                                    let btnClass = "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"; // Default (Gray)
                                    let btnIcon = <Tag size={12} />;

                                    if (npRec) {
                                        if (npRec.isClosed) {
                                            btnClass = "bg-emerald-100 border-emerald-200 text-emerald-700 hover:bg-emerald-200";
                                        } else if (npRec.isVisited) {
                                            btnClass = "bg-blue-100 border-blue-200 text-blue-700 hover:bg-blue-200";
                                        }
                                        // If record exists but neither visited nor closed, it stays Default (Gray)
                                    }

                                    return (
                                        <tr key={row.id} className="hover:bg-blue-50/30 group">
                                            <td className="px-1 py-1 border-r border-gray-200 text-center sticky left-0 bg-white group-hover:bg-blue-50/30 z-30">
                                                <div className="flex flex-col items-center gap-1">
                                                    <button 
                                                        onClick={() => updateRow(row.id, { attendance: !row.attendance })}
                                                        className="transition-colors"
                                                        disabled={isLocked}
                                                    >
                                                        {row.attendance ? <CheckCircle size={14} className="text-emerald-500" /> : <Circle size={14} className="text-slate-300" />}
                                                    </button>
                                                    <span className="text-[9px] text-slate-400">{idx+1}</span>
                                                </div>
                                            </td>
                                            
                                            <td className="px-1 py-1 border-r border-gray-200 sticky left-[24px] bg-white group-hover:bg-blue-50/30 z-30 align-middle">
                                                <InputCell 
                                                    initialValue={row.chartId} 
                                                    onCommit={(v) => updateRow(row.id, { chartId: v })}
                                                    className={`text-slate-700 font-mono text-[11px] ${isChartIdLocked ? 'bg-slate-50' : ''}`}
                                                    placeholder="病歷號"
                                                    disabled={isChartIdLocked}
                                                />
                                            </td>

                                            <td className="px-1 py-1 border-r border-gray-200 sticky left-[104px] bg-white group-hover:bg-blue-50/30 z-30 align-middle">
                                                <InputCell 
                                                    initialValue={row.patientName} 
                                                    onCommit={(v) => updateRow(row.id, { patientName: v })}
                                                    className={getPatientNameClass(row)}
                                                    disabled={isLocked}
                                                />
                                            </td>
                                            <td className="px-1 py-1 border-r border-gray-200 text-center align-middle">
                                                {row.isManual ? (
                                                    <select 
                                                        className="w-full bg-transparent text-xs outline-none text-slate-700 font-medium text-right"
                                                        dir="rtl"
                                                        value={row.doctorId}
                                                        onChange={(e) => updateRow(row.id, { doctorId: e.target.value, doctorName: clinicDocs.find(d=>d.id===e.target.value)?.name||'' })}
                                                        disabled={isLocked}
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

                                            <td className="px-1 py-1 border-r border-gray-200 bg-blue-50/10">
                                                <InputCell disabled={isLocked} type="number" align="right" className="text-blue-600 font-mono text-[14px]" initialValue={row.treatments.regFee} onCommit={(v) => updateRow(row.id, { treatments: { regFee: safeNum(v) } })} />
                                            </td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-blue-50/10">
                                                <InputCell disabled={isLocked} type="number" align="right" className="text-blue-600 font-mono text-[14px]" initialValue={row.treatments.copayment} onCommit={(v) => updateRow(row.id, { treatments: { copayment: safeNum(v) } })} />
                                            </td>

                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.prostho} onCommit={(v) => updateRow(row.id, { treatments: { prostho: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.implant} onCommit={(v) => updateRow(row.id, { treatments: { implant: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.ortho} onCommit={(v) => updateRow(row.id, { treatments: { ortho: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.sov} onCommit={(v) => updateRow(row.id, { treatments: { sov: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.inv} onCommit={(v) => updateRow(row.id, { treatments: { inv: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.perio} onCommit={(v) => updateRow(row.id, { treatments: { perio: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.whitening} onCommit={(v) => updateRow(row.id, { treatments: { whitening: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.otherSelfPay} onCommit={(v) => updateRow(row.id, { treatments: { otherSelfPay: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10">
                                                <select 
                                                    className="w-full bg-transparent text-xs text-slate-600 outline-none"
                                                    value={row.treatments.consultant || ''}
                                                    onChange={(e) => updateRow(row.id, { treatments: { consultant: e.target.value } })}
                                                    disabled={isLocked}
                                                >
                                                    <option value=""></option>
                                                    {consultantOptions.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                                </select>
                                            </td>

                                            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-orange-600 font-mono text-[14px]" initialValue={row.retail.diyWhitening} onCommit={(v) => updateRow(row.id, { retail: { diyWhitening: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-orange-600 font-mono text-[14px]" initialValue={row.retail.products} onCommit={(v) => updateRow(row.id, { retail: { products: safeNum(v) } })} /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell disabled={isLocked} initialValue={row.retailItem} onCommit={(v) => updateRow(row.id, { retailItem: v })} placeholder="品項" /></td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10">
                                                <select 
                                                    className="w-full bg-transparent text-xs text-slate-600 outline-none"
                                                    value={row.retail.staff || ''}
                                                    onChange={(e) => updateRow(row.id, { retail: { staff: e.target.value } })}
                                                    disabled={isLocked}
                                                >
                                                    <option value=""></option>
                                                    {staffOptions.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                                </select>
                                            </td>

                                            <td className="px-2 py-1 border-r border-gray-200 bg-emerald-50/10 text-right font-black text-emerald-600 text-lg font-bold">
                                                {totalAmount > 0 ? totalAmount.toLocaleString() : '-'}
                                            </td>
                                            <td className="px-1 py-1 border-r border-gray-200 bg-emerald-50/10">
                                                <select 
                                                    className={`w-full bg-transparent text-[10px] font-bold outline-none uppercase text-center ${row.paymentMethod === 'card' ? 'text-pink-600' : row.paymentMethod === 'transfer' ? 'text-amber-600' : 'text-emerald-600'} ${isLocked ? 'opacity-50' : ''}`}
                                                    value={row.paymentMethod}
                                                    onChange={(e) => updateRow(row.id, { paymentMethod: e.target.value })}
                                                    disabled={isLocked}
                                                >
                                                    <option value="cash">CASH</option>
                                                    <option value="card">CARD</option>
                                                    <option value="transfer">TRANS</option>
                                                </select>
                                            </td>

                                            <td className="px-1 py-1 border-r border-gray-200 text-center align-middle">
                                                {isNP ? (
                                                    <button 
                                                        onClick={() => setNpModalData({ row })}
                                                        className={`w-full ${btnClass} border px-1 py-1 rounded text-xs font-bold flex items-center justify-center gap-1 transition-colors`}
                                                    >
                                                        {btnIcon} NP
                                                    </button>
                                                ) : (
                                                    <InputCell 
                                                        initialValue={row.npStatus || (row as any).note || ""} 
                                                        onCommit={(v) => updateRow(row.id, { npStatus: v })} 
                                                    />
                                                )}
                                            </td>
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
                                                {row.isManual && !isLocked && (
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
                    {!isLocked && (
                        <button onClick={handleAddRow} className="w-full py-2 bg-slate-50 border-t border-slate-200 text-blue-600 font-bold text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-1">
                            <Plus size={16} /> 新增一列 (Add Row)
                        </button>
                    )}
                </>
            )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 bg-rose-50 border-b border-rose-100 flex justify-between items-center">
                <h4 className="font-bold text-rose-700 text-sm">診所支出 (Expenditure)</h4>
                <div className="flex items-center gap-4">
                    <span className="text-xs font-bold text-rose-600">總計: ${totals.totalExpenditure.toLocaleString()}</span>
                    {!isLocked && (
                        <button onClick={() => handleExpenditureChange([...expenditures, { id: crypto.randomUUID(), item: '', amount: 0 }])} className="text-xs bg-white text-rose-600 px-2 py-1 rounded border border-rose-200 font-bold hover:bg-rose-100">
                            + 新增
                        </button>
                    )}
                </div>
            </div>
            <div className="p-2 space-y-2 max-h-[200px] overflow-y-auto">
                {expenditures.map((ex, idx) => (
                    <div key={ex.id} className="flex gap-2 items-center bg-slate-50 p-1.5 rounded border border-slate-100">
                        <input 
                            className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none" 
                            value={ex.item} 
                            disabled={isLocked}
                            onChange={e => {
                                const newEx = [...expenditures]; newEx[idx].item = e.target.value; handleExpenditureChange(newEx);
                            }} 
                            placeholder="項目名稱" 
                        />
                        <input 
                            type="number" 
                            className="w-24 bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none text-right font-bold text-rose-600" 
                            value={ex.amount} 
                            disabled={isLocked}
                            onChange={e => {
                                const newEx = [...expenditures]; newEx[idx].amount = Number(e.target.value); handleExpenditureChange(newEx);
                            }} 
                            placeholder="0" 
                        />
                        {!isLocked && (
                            <button onClick={handleExpenditureChange.bind(null, expenditures.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-500">
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>

        <ClosingSummaryModal 
            isOpen={isClosingModalOpen}
            onClose={() => setIsClosingModalOpen(false)}
            onConfirm={handleLockDay}
            date={currentDate}
            clinicId={selectedClinicId}
            rows={rows}
            totals={{ cash: totals.cashBalance, card: totals.cardRevenue, transfer: totals.transferRevenue, total: totals.totalRevenue }}
        />

        <AuditLogModal 
            isOpen={isAuditModalOpen}
            onClose={() => setIsAuditModalOpen(false)}
            logs={dailyRecord?.auditLog || []}
        />

        {npModalData && (
            <NPStatusModal 
                isOpen={!!npModalData}
                onClose={() => setNpModalData(null)}
                row={npModalData.row}
                clinicId={selectedClinicId}
                date={currentDate}
            />
        )}
    </div>
  );
};

export default DailyAccounting;
