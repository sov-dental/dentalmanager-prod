import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Clinic, Doctor, Consultant, Laboratory, SOVReferral, DailyAccountingRecord, AccountingRow, Expenditure, AuditLogEntry, NPRecord, MonthlyClosing } from '../types';
import { hydrateRow, getStaffList, db, lockDailyReport, unlockDailyReport, saveDailyAccounting, findPatientProfile, addSOVReferral, getMonthlyClosingStatus, saveNPRecord, deleteNPRecord } from '../services/firebase';
import { exportDailyReportToExcel } from '../services/excelExport';
import { listEvents, initGoogleClient, authorizeCalendar } from '../services/googleCalendar';
import { parseCalendarEvent, parseSourceFromNote } from '../utils/eventParser';
import { ClinicSelector } from '../components/ClinicSelector';
import { useClinic } from '../contexts/ClinicContext';
import { useAuth } from '../contexts/AuthContext';
import { ClosingSummaryModal } from '../components/ClosingSummaryModal';
import { AuditLogModal } from '../components/AuditLogModal';
import { NPStatusModal } from '../components/NPStatusModal';
import DailyAccountingRow from '../components/DailyAccountingRow';
import { 
  Save, Plus, Trash2, FileSpreadsheet, Loader2,
  ChevronLeft, ChevronRight, RefreshCw, 
  Wallet, CreditCard, TrendingUp, CheckCircle, 
  WifiOff, Lock, Unlock, History, AlertCircle, Filter
} from 'lucide-react';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
  consultants: Consultant[];
  laboratories: Laboratory[];
  sovReferrals: SOVReferral[];
}

// Feature: "Clinic Public" Virtual Option
const PUBLIC_DOCTOR = {
  id: 'clinic_public',
  name: '診所 (Public)',
  avatarText: '診',
  avatarColor: '#94a3b8' // Slate-400 (Gray)
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
  
  const [currentDate, setCurrentDate] = useState(getTodayStr());
  
  const [dailyRecord, setDailyRecord] = useState<DailyAccountingRecord | null>(null);
  const [rows, setRows] = useState<AccountingRow[]>([]);
  const [expenditures, setExpenditures] = useState<Expenditure[]>([]);
  const [fullStaffList, setFullStaffList] = useState<Consultant[]>([]);
  
  // Real-time Data States
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyClosing | null>(null);
  const [todaysNPRecords, setTodaysNPRecords] = useState<Record<string, NPRecord>>({});
  const [realtimeSovReferrals, setRealtimeSovReferrals] = useState<SOVReferral[]>(sovReferrals);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isManualSaving, setIsManualSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Performance Optimization: Debounce State
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filterDoctorId, setFilterDoctorId] = useState<string>('');
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [npModalData, setNpModalData] = useState<{row: AccountingRow} | null>(null);

  // Use Refs to prevent stale closures in useCallback
  const rowsRef = useRef(rows);
  const expendituresRef = useRef(expenditures);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    expendituresRef.current = expenditures;
  }, [expenditures]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

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

  // Sync Monthly Closing Status
  useEffect(() => {
      if (selectedClinicId && currentDate) {
          const yearMonth = currentDate.slice(0, 7);
          getMonthlyClosingStatus(selectedClinicId, yearMonth).then(setMonthlyStatus);
      }
  }, [selectedClinicId, currentDate]);

  // Real-time SOV Referrals Listener
  useEffect(() => {
      if (!selectedClinicId) {
          setRealtimeSovReferrals(sovReferrals);
          return;
      }

      const unsubscribe = db.collection('clinics').doc(selectedClinicId)
          .onSnapshot((doc) => {
              if (doc.exists) {
                  const data = doc.data();
                  setRealtimeSovReferrals(data?.sovReferrals || []);
              }
          }, (error) => {
              console.error("Referral listener error:", error);
          });

      return () => unsubscribe();
  }, [selectedClinicId, sovReferrals]);

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
                  if (!data.isHidden) {
                    map[doc.id] = { id: doc.id, ...data };
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

  const clinicDocs = useMemo(() => doctors.filter(d => d.clinicId === selectedClinicId), [doctors, selectedClinicId]);
  const clinicLabs = useMemo(() => laboratories.filter(l => l.clinicId === selectedClinicId), [laboratories, selectedClinicId]);

  const activeDoctorsInTable = useMemo(() => {
      const docIds = new Set(rows.map(r => r.doctorId).filter(Boolean));
      const filtered = clinicDocs.filter(d => docIds.has(d.id));
      if (docIds.has('clinic_public')) {
          return [{ id: PUBLIC_DOCTOR.id, name: PUBLIC_DOCTOR.name } as any, ...filtered];
      }
      return filtered;
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
              // PRIMARY SORT BY sortOrder
              setRows(loadedRows.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
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
  const isMonthLocked = monthlyStatus?.isLocked || false;

  const visibleRows = useMemo(() => {
      let filtered = rows;
      if (filterDoctorId) {
          filtered = rows.filter(r => r.doctorId === filterDoctorId);
      }
      
      // Strict sorting by sortOrder to respect user manual inputs and incremental sync
      return [...filtered].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
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

  const validationErrors = useMemo(() => {
      const errors: string[] = [];
      rows.forEach((row, idx) => {
          const t = row.treatments;
          const r = row.retail;
          const totalAmount = (t.regFee||0) + (t.copayment||0) + 
                           (t.prostho||0) + (t.implant||0) + (t.ortho||0) + (t.sov||0) + (t.inv||0) + (t.perio||0) + (t.whitening||0) + (t.otherSelfPay||0) +
                           (r.products||0) + (r.diyWhitening||0);
          
          if (totalAmount > 0) {
              const rowErrors: string[] = [];
              if (!row.patientName?.trim()) rowErrors.push("姓名");
              if (!row.doctorId) rowErrors.push("醫師");
              if (!row.paymentMethod) rowErrors.push("付款方式");
              
              if (rowErrors.length > 0) {
                  errors.push(`第 ${idx + 1} 列 (${row.patientName || '未命名'}): 缺少 ${rowErrors.join('、')}`);
              }
          }
      });
      return errors;
  }, [rows]);

  const prepareDataForSave = (currentRows: AccountingRow[]) => {
      return currentRows.map((row, index) => {
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
              chartId: row.chartId || '',
              sortOrder: row.sortOrder || (index + 1) * 10
          };
      });
  };

  const persistData = useCallback(async (currentRows: AccountingRow[], currentExp: Expenditure[], diffDetails?: string) => {
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
          setHasUnsavedChanges(false);
          setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (e) {
          console.error(e);
          setSaveStatus('error');
      }
  }, [selectedClinicId, currentDate, dailyRecord?.isLocked, currentUser]);

  const handleSyncCalendar = async () => {
      if (isLocked) { alert("今日已結帳，無法同步。"); return; }
      if (!selectedClinic?.googleCalendarMapping) { alert("此診所尚未設定 Google 日曆連結"); return; }
      
      setIsSyncing(true);
      try {
          const start = new Date(currentDate); start.setHours(0,0,0,0);
          const end = new Date(currentDate); end.setHours(23,59,59,999);
          const mapping = selectedClinic.googleCalendarMapping;
          const currentRows = rowsRef.current;
          
          const existingManualRows = currentRows.filter(r => r.isManual);
          const existingIds = new Set(currentRows.map(r => r.id));
          const allEvents: any[] = [];

          for (const doc of clinicDocs) {
              const calendarId = mapping[doc.id];
              if (calendarId) {
                  const events = await listEvents(calendarId, start, end);
                  events.forEach(ev => {
                      if (!ev.allDay) {
                          allEvents.push({ event: ev, doc });
                      }
                  });
              }
          }

          const publicCalId = mapping['clinic_public'] || mapping['clinic_shared'];
          if (publicCalId) {
              const pEvents = await listEvents(publicCalId, start, end);
              pEvents.forEach(ev => {
                  if (!ev.allDay) {
                      allEvents.push({ event: ev, isPublic: true });
                  }
              });
          }

          // 1. Sort Events in Memory: Doctor Order > Time
          const sortedEvents = allEvents.sort((a, b) => {
              const getDocIndex = (item: any) => {
                  if (item.isPublic) return 9999;
                  const idx = clinicDocs.findIndex(d => d.id === item.doc.id);
                  return idx === -1 ? 9998 : idx;
              };
              const idxA = getDocIndex(a);
              const idxB = getDocIndex(b);
              if (idxA !== idxB) return idxA - idxB;
              return (a.event.start.dateTime || '').localeCompare(b.event.start.dateTime || '');
          });

          // 2. Process into Rows and Assign sortOrder in gaps of 10
          const processedCalendarRows = await Promise.all(sortedEvents.map(async (item, index) => {
              const { event, doc, isPublic } = item;
              const parsed = parseCalendarEvent(event.summary);
              if (!parsed) return null;

              let lastConsultant = '';
              let finalChartId = parsed.chartId;

              // Preserve content if row already exists
              const existingRow = currentRows.find(r => r.id === event.id);

              if (!existingRow) {
                  try {
                      const profile = await findPatientProfile(selectedClinicId, parsed.name, parsed.chartId);
                      if (profile) {
                          if (profile.lastConsultant) lastConsultant = profile.lastConsultant;
                          if (profile.chartId) finalChartId = profile.chartId;
                      }
                  } catch (e) {
                      console.warn("CRM lookup failed", e);
                  }
              }

              return {
                  ...hydrateRow(existingRow || {}),
                  id: event.id,
                  patientName: parsed.name,
                  doctorId: isPublic ? PUBLIC_DOCTOR.id : doc.id,
                  doctorName: isPublic ? PUBLIC_DOCTOR.name : doc.name,
                  treatmentContent: existingRow?.treatmentContent || "", 
                  calendarTreatment: parsed.treatment, 
                  npStatus: existingRow?.npStatus || (parsed.isNP ? 'NP' : ''),
                  paymentMethod: existingRow?.paymentMethod || 'cash',
                  isManual: false,
                  isPublicCalendar: isPublic || false,
                  attendance: existingRow?.attendance ?? true,
                  startTime: event.start.dateTime || new Date().toISOString(),
                  chartId: finalChartId || existingRow?.chartId || undefined,
                  sortOrder: (index + 1) * 10 // Assignment with gaps
              } as AccountingRow;
          }));

          const validCalendarRows = processedCalendarRows.filter(Boolean) as AccountingRow[];
          
          // 3. Combine with manual rows (preserving their sortOrders)
          const finalCombined = [...validCalendarRows, ...existingManualRows];

          setRows(finalCombined);
          await persistData(finalCombined, expendituresRef.current);
          
      } catch (e) {
          console.error(e);
          alert("同步失敗");
      } finally {
          setIsSyncing(false);
      }
  };

  const handleAddRow = useCallback(() => {
      if (isLocked) return;
      const currentRows = rowsRef.current;
      const maxSortOrder = Math.max(...currentRows.map(r => r.sortOrder || 0), 0);

      const newRow: AccountingRow = {
          ...hydrateRow({}),
          id: crypto.randomUUID(),
          isManual: true,
          attendance: true,
          startTime: new Date().toISOString(),
          chartId: null,
          patientStatus: '',
          paymentMethod: 'cash',
          paymentBreakdown: { cash: 0, card: 0, transfer: 0 },
          sortOrder: maxSortOrder + 10
      };
      const updated = [...currentRows, newRow];
      setRows(updated);
      setHasUnsavedChanges(true);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
          persistData(rowsRef.current, expendituresRef.current);
      }, 2000);
  }, [isLocked, persistData]);

  const handleManualSave = async () => {
      if (isLocked) { alert("已結帳鎖定，無法修改"); return; }
      if (!selectedClinicId) { alert("請先選擇診所"); return; }
      setIsManualSaving(true);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      try {
          await persistData(rowsRef.current, expendituresRef.current);
          alert("✅ 儲存成功！");
      } catch (error: any) {
          alert("❌ 儲存失敗: " + error.message);
      } finally {
          setIsManualSaving(false);
      }
  };

  const handleRevokeNP = useCallback((rowId: string) => {
    const currentRows = rowsRef.current;
    const updatedRows = currentRows.map(r => {
        if (r.id === rowId) {
            // Revert NP status indicators
            return { ...r, npStatus: "", isNP: false };
        }
        return r;
    });
    setRows(updatedRows);
    setHasUnsavedChanges(true);
    
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
        persistData(rowsRef.current, expendituresRef.current);
    }, 1000);
  }, [persistData]);

  const updateRow = useCallback((id: string, updates: Partial<AccountingRow> | any) => {
      const currentRows = rowsRef.current;
      const isRestrictedField = Object.keys(updates).some(key => 
          ['treatments', 'retail', 'patientName', 'paymentMethod', 'doctorId', 'chartId'].includes(key)
      );

      if (isLocked && isRestrictedField) {
          return;
      }

      let diffString: string | null = null;

      const updatedRows = currentRows.map(r => {
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
                  const val = updates.doctorId;
                  if (val === 'clinic_public') {
                      newRow.doctorName = PUBLIC_DOCTOR.name;
                  } else {
                      const doc = clinicDocs.find(d => d.id === val);
                      if (doc) newRow.doctorName = doc.name;
                  }
              }

              if (updates.labName === 'SOV轉介' && newRow.patientName) {
                  addSOVReferral(selectedClinicId, newRow.patientName).catch(e => console.error(e));
              }

              if (updates.treatments && typeof updates.treatments.sov === 'number') {
                  const sovAmount = updates.treatments.sov;
                  if (sovAmount > 0) {
                      const pName = (newRow.patientName || '').trim();
                      const isReferral = realtimeSovReferrals.some(ref => 
                          ref.name.trim() === pName && 
                          ref.clinicId === selectedClinicId
                      );
                      newRow.labName = isReferral ? "SOV轉介" : "SOV自約";
                  }
              }

              if (newRow.patientName && newRow.patientName.trim()) {
                  const searchStr = `${newRow.npStatus || ''} ${(newRow as any).note || ''} ${newRow.treatmentContent || ''}`.toUpperCase();
                  const isNPDetected = searchStr.includes('NP') || searchStr.includes('新患') || searchStr.includes('初診');
                  
                  if (isNPDetected) {
                      (newRow as any).isNP = true;
                      
                      saveNPRecord(newRow.id, {
                          date: currentDate,
                          clinicId: selectedClinicId,
                          patientName: newRow.patientName.trim(),
                          treatment: newRow.treatmentContent || '',
                          isVisited: true,
                          isClosed: false,
                          source: '過路客',
                          marketingTag: '',
                          calendarTreatment: newRow.calendarTreatment,
                          updatedAt: new Date().toISOString(),
                          isHidden: false 
                      }).catch(e => console.error("[AutoNP] Restoration failed:", e));
                  }
              }

              diffString = calculateDiff(r, newRow);
              return newRow;
          }
          return r;
      });

      setRows(updatedRows);
      setHasUnsavedChanges(true);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
          persistData(rowsRef.current, expendituresRef.current, diffString || undefined);
      }, 2000);
  }, [isLocked, clinicDocs, selectedClinicId, realtimeSovReferrals, currentDate, persistData]);

  const handleDeleteRow = useCallback(async (id: string) => {
      if (isLocked) return;
      if (!confirm("確定刪除此列？")) return;

      try {
          await deleteNPRecord(id);
      } catch (e) {}

      const updated = rowsRef.current.filter(r => r.id !== id);
      setRows(updated);
      setHasUnsavedChanges(true);
      
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
          persistData(rowsRef.current, expendituresRef.current);
      }, 2000);
  }, [isLocked, persistData]);

  const handleExpenditureChange = (newExp: Expenditure[]) => {
      if (isLocked) return;
      setExpenditures(newExp);
      setHasUnsavedChanges(true);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
          persistData(rowsRef.current, expendituresRef.current);
      }, 2000);
  };

  const handleLockDay = async () => {
      if (!currentUser || !selectedClinicId) return;
      if (validationErrors.length > 0) {
         // Join the error messages with newlines for a readable alert
          const errorMessage = "無法結帳，請檢查以下資料：\n\n" + validationErrors.join("\n");
          alert(errorMessage);
          return; // Stop execution gracefully (don't throw exception)
      }

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      try {
          await lockDailyReport(currentDate, selectedClinicId, rowsRef.current, { uid: currentUser.uid, name: currentUser.email || 'User' });
          setHasUnsavedChanges(false);
      } catch (e) {
          alert("結帳失敗，請重試");
          throw e; 
      }
  };

  const handleUnlockDay = async () => {
      if (!currentUser || !selectedClinicId) return;
      
      const canUnlock = ['admin', 'manager', 'team_leader', 'staff'].includes(userRole || '');
      if (!canUnlock) {
          alert("權限不足");
          return;
      }
      if (isMonthLocked) {
          alert("⚠️ 本月已結帳鎖定");
          return;
      }

      if (!confirm("確定要解鎖嗎？")) return;
      
      setIsSyncing(true);
      try {
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
      if (currentDate < todayStr && rowsRef.current.length > 0 && !dailyRecord?.isLocked) {
          const confirmLock = window.confirm(`[日期: ${currentDate}] 尚未結帳。是否立即鎖定並繼續？`);
          if (confirmLock) {
              try { await handleLockDay(); } catch(e) { return; }
          }
      }
      setCurrentDate(targetDate);
  };

  const headerCellStyle = "px-2 py-1 border-r border-slate-200 text-slate-700 text-center font-bold";

  return (
    <div className="space-y-6 pb-20">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
                <ClinicSelector className="border p-2 rounded-lg bg-slate-50 min-w-[150px]" />
                <div className="flex items-center bg-slate-100 rounded-lg p-1">
                    <button onClick={() => handleSafeDateChange(getNextDate(currentDate, -1))} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500"><ChevronLeft size={20}/></button>
                    <input type="date" className="bg-transparent border-none text-center font-bold text-slate-700 outline-none w-32 cursor-pointer" value={currentDate} onChange={e => handleSafeDateChange(e.target.value)} />
                    <button onClick={() => handleSafeDateChange(getNextDate(currentDate, 1))} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500"><ChevronRight size={20}/></button>
                </div>
                {isLocked ? (
                    <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm font-bold ${isMonthLocked ? 'bg-rose-100 border-rose-300 text-rose-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                        <Lock size={14} /> {isMonthLocked ? '月結鎖定中' : '已結帳'}
                    </div>
                ) : (
                    <button onClick={() => setIsClosingModalOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm font-bold hover:bg-emerald-100 transition-colors">
                        <Unlock size={14} /> 結帳鎖定
                    </button>
                )}
            </div>

            <div className="flex gap-2 items-center">
                {saveStatus === 'saving' && <span className="text-xs text-blue-500 font-bold animate-pulse">儲存中...</span>}
                {hasUnsavedChanges && saveStatus !== 'saving' && <span className="text-xs text-amber-600 font-bold">變更未儲存</span>}
                {!hasUnsavedChanges && saveStatus === 'saved' && <span className="text-xs text-emerald-600 font-bold">資料已儲存</span>}
                
                {isLocked && (['admin', 'manager', 'team_leader', 'staff'].includes(userRole || '')) && (
                    <button onClick={handleUnlockDay} disabled={isSyncing || isMonthLocked} className={`px-3 py-2 rounded-lg font-bold text-sm border flex items-center gap-2 transition-all ${isMonthLocked ? 'text-slate-400 cursor-not-allowed' : 'text-rose-500 hover:bg-rose-50'}`}>
                        {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />} 
                        解鎖
                    </button>
                )}

                <button onClick={() => setIsAuditModalOpen(true)} className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100" title="異動紀錄"><History size={18} /></button>
                <button onClick={handleManualSave} disabled={isManualSaving || isLocked} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50">{isManualSaving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} 儲存</button>
                <button onClick={handleSyncCalendar} disabled={isSyncing || isLocked} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-blue-100 transition-colors disabled:opacity-50">{isSyncing ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} 同步預約</button>
                <button onClick={() => selectedClinic && exportDailyReportToExcel(selectedClinic.id, selectedClinic.name, currentDate, rows, expenditures, fullStaffList)} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-slate-200 transition-colors"><FileSpreadsheet size={16} /> 匯出</button>
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
                                {isSyncing ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={20} />}
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
                        <table className="min-w-[2000px] border-collapse text-xs">
                            <thead className="bg-gray-50 z-40 shadow-sm font-bold tracking-tight">
                                <tr className="sticky top-[2px] z-[60]">
                                    <th className="px-2 py-2 border-r border-gray-200 text-center sticky left-0 bg-gray-50 z-[70] min-w-[30px] text-slate-600" rowSpan={2}>#</th>
                                    <th className="px-2 py-2 border-r border-gray-200 sticky left-[32px] bg-gray-50 z-[70] min-w-[80px] text-left text-slate-600" rowSpan={2}>病歷號</th>
                                    <th className="px-2 py-2 border-r border-gray-200 sticky left-[114px] bg-gray-50 z-[70] min-w-[110px] text-left text-slate-600" rowSpan={2}>病患姓名</th>
                                    <th className="px-2 py-2 border-r-2 border-gray-300 sticky left-[226px] bg-gray-50 z-[70] min-w-[110px] text-right" rowSpan={2}>醫師</th>
                                    <th colSpan={2} className="px-2 py-1 border-r border-gray-200 border-t-4 border-blue-400 bg-blue-50 text-center text-slate-700">基本費用 (FEES)</th>
                                    <th colSpan={9} className="px-2 py-1 border-r border-gray-200 border-t-4 border-purple-400 bg-purple-50 text-center text-slate-700">自費療程 (TREATMENT)</th>
                                    <th colSpan={4} className="px-2 py-1 border-r border-gray-200 border-t-4 border-orange-400 bg-orange-50 text-center text-slate-700">小金庫 (RETAIL)</th>
                                    <th colSpan={2} className="px-2 py-1 border-r border-gray-200 border-t-4 border-emerald-500 bg-emerald-50 text-center text-slate-700">結帳 (PAYMENT)</th>
                                    <th colSpan={4} className="px-2 py-1 border-t-4 border-slate-300 bg-slate-50 text-center text-slate-600">備註與操作</th>
                                </tr>
                                <tr className="sticky top-[25px] z-30 shadow-sm text-center">
                                    <th className={`${headerCellStyle} border-r-blue-100 bg-blue-50 min-w-[60px]`}>掛號</th>
                                    <th className={`${headerCellStyle} bg-blue-50 min-w-[60px]`}>部分</th>
                                    <th className={`${headerCellStyle} border-r-purple-100 bg-purple-50 min-w-[70px]`}>假牙</th>
                                    <th className={`${headerCellStyle} border-r-purple-100 bg-purple-50 min-w-[70px]`}>植牙</th>
                                    <th className={`${headerCellStyle} border-r-purple-100 bg-purple-50 min-w-[70px]`}>矯正</th>
                                    <th className={`${headerCellStyle} border-r-purple-100 bg-purple-50 min-w-[70px]`}>SOV</th>
                                    <th className={`${headerCellStyle} border-r-purple-100 bg-purple-50 min-w-[70px]`}>INV</th>
                                    <th className={`${headerCellStyle} border-r-purple-100 bg-purple-50 min-w-[70px]`}>牙周</th>
                                    <th className={`${headerCellStyle} border-r-purple-100 bg-purple-50 min-w-[70px]`}>美白</th>
                                    <th className={`${headerCellStyle} bg-purple-50 min-w-[70px]`}>其他</th>
                                    <th className={`${headerCellStyle} bg-purple-50 min-w-[80px]`}>諮詢師</th>
                                    <th className={`${headerCellStyle} border-r-orange-100 bg-orange-50 min-w-[70px]`}>小金庫</th>
                                    <th className={`${headerCellStyle} border-r-orange-100 bg-orange-50 min-w-[70px]`}>物販</th>
                                    <th className={`${headerCellStyle} border-r-orange-100 bg-orange-50 min-w-[100px]`}>品項</th>
                                    <th className={`${headerCellStyle} bg-orange-50 min-w-[80px]`}>經手人</th>
                                    <th className={`${headerCellStyle} border-r-emerald-100 bg-emerald-50 min-w-[80px]`}>實收</th>
                                    <th className={`${headerCellStyle} bg-emerald-50 min-w-[70px]`}>方式</th>
                                    <th className={`${headerCellStyle} bg-slate-50 min-w-[50px]`}>NP</th>
                                    <th className={`${headerCellStyle} bg-slate-50 min-w-[120px]`}>內容</th>
                                    <th className={`${headerCellStyle} bg-slate-50 min-w-[100px]`}>技工所</th>
                                    <th className="px-2 py-1 bg-slate-50 w-8"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {visibleRows.map((row, idx) => (
                                    <DailyAccountingRow
                                        key={row.id}
                                        index={idx}
                                        row={row}
                                        isLocked={isLocked}
                                        clinicDocs={clinicDocs}
                                        clinicLabs={clinicLabs}
                                        consultantOptions={consultantOptions}
                                        staffOptions={staffOptions}
                                        npRec={todaysNPRecords[row.id]}
                                        onUpdate={updateRow}
                                        onDelete={handleDeleteRow}
                                        onOpenNPModal={(r) => setNpModalData({ row: r })}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!isLocked && (<button onClick={handleAddRow} className="w-full py-2 bg-slate-50 border-t border-slate-200 text-blue-600 font-bold text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"><Plus size={16} /> 新增一列</button>)}
                </>
            )}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 bg-rose-50 border-b border-rose-100 flex justify-between items-center"><h4 className="font-bold text-rose-700 text-sm">診所支出</h4><div className="flex items-center gap-4"><span className="text-xs font-bold text-rose-600">總計: ${totals.totalExpenditure.toLocaleString()}</span>{!isLocked && (<button onClick={() => handleExpenditureChange([...expenditures, { id: crypto.randomUUID(), item: '', amount: 0 }])} className="text-xs bg-white text-rose-600 px-2 py-1 rounded border border-rose-200 font-bold hover:bg-rose-100">+ 新增</button>)}</div></div>
            <div className="p-2 space-y-2 max-h-[200px] overflow-y-auto">{expenditures.map((ex, idx) => (<div key={ex.id} className="flex gap-2 items-center bg-slate-50 p-1.5 rounded border border-slate-100"><input className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none" value={ex.item} disabled={isLocked} onChange={e => { const newEx = [...expenditures]; newEx[idx].item = e.target.value; handleExpenditureChange(newEx); }} placeholder="項目名稱" /><input type="number" className="w-24 bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none text-right font-bold text-rose-600" value={ex.amount} disabled={isLocked} onChange={e => { const newEx = [...expenditures]; newEx[idx].amount = Number(e.target.value); handleExpenditureChange(newEx); }} placeholder="0" />{!isLocked && (<button onClick={() => handleExpenditureChange(expenditures.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-500"><Trash2 size={14} /></button>)}</div>))}</div>
        </div>
        <ClosingSummaryModal isOpen={isClosingModalOpen} onClose={() => setIsClosingModalOpen(false)} onConfirm={handleLockDay} date={currentDate} clinicId={selectedClinicId} rows={rows} totals={{ cash: totals.cashBalance, card: totals.cardRevenue, transfer: totals.transferRevenue, total: totals.netTotal }} validationErrors={validationErrors} />
        <AuditLogModal isOpen={isAuditModalOpen} onClose={() => setIsAuditModalOpen(false)} logs={dailyRecord?.auditLog || []} />
        {npModalData && (
            <NPStatusModal 
                isOpen={!!npModalData} 
                onClose={() => setNpModalData(null)} 
                recordId={npModalData.row.id}
                patientName={npModalData.row.patientName}
                calendarTreatment={npModalData.row.calendarTreatment}
                actualTreatment={npModalData.row.treatmentContent}
                clinicId={selectedClinicId} 
                date={currentDate} 
                onRevokeNP={() => handleRevokeNP(npModalData.row.id)}
            />
        )}
    </div>
  );
};

export default DailyAccounting;