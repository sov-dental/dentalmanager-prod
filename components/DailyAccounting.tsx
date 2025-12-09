
import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Doctor, Consultant, Laboratory, SOVReferral, DailyAccountingRecord, AccountingRow, Expenditure } from '../types';
import { loadDailyAccounting, saveDailyAccounting, hydrateRow, sanitizeRow } from '../services/firebase';
import { exportDailyReportToExcel } from '../services/excelExport';
import { listEvents, parseAppointmentTitle } from '../services/googleCalendar';
import { ClinicSelector } from './ClinicSelector';
import { useClinic } from '../contexts/ClinicContext';
import { AppointmentDetailModal } from './AppointmentDetailModal';
import { 
  Save, Plus, Trash2, FileSpreadsheet, Loader2,
  FileText, ChevronLeft, ChevronRight, Check,
  TrendingUp, RefreshCw, Wallet, CreditCard, Landmark
} from 'lucide-react';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
  consultants: Consultant[];
  laboratories: Laboratory[];
  sovReferrals: SOVReferral[];
}

export const DailyAccounting: React.FC<Props> = ({ clinics, doctors, consultants, laboratories, sovReferrals }) => {
  const { selectedClinicId, selectedClinic } = useClinic();
  
  // State
  const [currentDate, setCurrentDate] = useState(() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
  });
  
  const [dailyRecord, setDailyRecord] = useState<DailyAccountingRecord | null>(null);
  const [rows, setRows] = useState<AccountingRow[]>([]);
  const [expenditures, setExpenditures] = useState<Expenditure[]>([]);
  const [reportImageUrl, setReportImageUrl] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // POS Mode State
  const [editingRow, setEditingRow] = useState<AccountingRow | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Filter State
  const [filterDoctor, setFilterDoctor] = useState<string>("");

  // Filter resources
  const clinicDocs = doctors.filter(d => d.clinicId === selectedClinicId);

  useEffect(() => {
      if (selectedClinicId && currentDate) {
          loadData();
      }
  }, [selectedClinicId, currentDate]);

  // Reset save status after 2 seconds
  useEffect(() => {
      if (saveStatus === 'saved') {
          const timer = setTimeout(() => setSaveStatus('idle'), 2000);
          return () => clearTimeout(timer);
      }
  }, [saveStatus]);

  // Derived Data for Filters
  const uniqueDoctors = useMemo(() => {
      const docs = new Set(rows.map(r => r.doctorName).filter(Boolean));
      return Array.from(docs).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
      if (!filterDoctor) return rows;
      return rows.filter(r => r.doctorName === filterDoctor);
  }, [rows, filterDoctor]);

  const createEmptyRow = (isManual = true): AccountingRow => ({
      id: crypto.randomUUID(),
      patientName: '',
      doctorName: '',
      doctorId: '',
      treatments: { regFee: 0, copayment: 0, sov: 0, ortho: 0, prostho: 0, implant: 0, whitening: 0, perio: 0, inv: 0, otherSelfPay: 0, consultant: '' },
      retail: { diyWhitening: 0, products: 0, productNote: '', staff: '' },
      paymentBreakdown: { cash: 0, card: 0, transfer: 0 },
      actualCollected: 0,
      paymentMethod: 'cash',
      isPaymentManual: false,
      npStatus: '',
      treatmentContent: '',
      labName: '',
      isManual: isManual,
      isArrived: isManual, // Default to true if manual row, otherwise false
      startTime: new Date().toISOString()
  });

  const loadData = async () => {
      setIsLoading(true);
      setRows([]);
      setExpenditures([]);
      setReportImageUrl(null);
      setFilterDoctor(""); // Reset filter on date/clinic change

      try {
          const record = await loadDailyAccounting(selectedClinicId, currentDate);
          if (record) {
              setDailyRecord(record);
              const hydratedRows = record.rows.map(hydrateRow);
              setRows(hydratedRows);
              setExpenditures(record.expenditures || []);
              setReportImageUrl(record.reportImageUrl || null);
          } else {
              setDailyRecord(null);
              setRows([]);
          }
      } catch (e) {
          console.error(e);
          alert("讀取失敗");
      } finally {
          setIsLoading(false);
      }
  };

  const handleSyncCalendar = async () => {
      if (!selectedClinic?.googleCalendarMapping) {
          alert("此診所尚未設定 Google 日曆連結");
          return;
      }
      
      setIsSyncing(true);
      try {
          const start = new Date(currentDate);
          start.setHours(0,0,0,0);
          const end = new Date(currentDate);
          end.setHours(23,59,59,999);

          const mapping = selectedClinic.googleCalendarMapping;
          const newRows: AccountingRow[] = [];
          const currentIds = new Set(rows.map(r => r.id));

          for (const doc of clinicDocs) {
              const calendarId = mapping[doc.id];
              if (calendarId) {
                  const events = await listEvents(calendarId, start, end);
                  events.forEach(ev => {
                      if (!currentIds.has(ev.id) && !ev.allDay) { 
                          const parsed = parseAppointmentTitle(ev.summary);
                          const newRow = createEmptyRow(false); // isManual = false
                          newRow.id = ev.id;
                          newRow.patientName = parsed?.patientName || ev.summary;
                          newRow.doctorId = doc.id;
                          newRow.doctorName = doc.name;
                          newRow.treatmentContent = parsed?.note || '';
                          newRow.npStatus = parsed?.np_display || '';
                          newRow.startTime = ev.start.dateTime || new Date().toISOString();
                          
                          newRows.push(newRow);
                      }
                  });
              }
          }

          if (newRows.length > 0) {
              const sortedNewRows = newRows.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || ''));
              const updatedRows = [...rows, ...sortedNewRows];
              setRows(updatedRows);
              // Auto save after sync
              persistData(updatedRows, expenditures);
              alert(`同步成功！新增 ${newRows.length} 筆預約。`);
          } else {
              alert("無新預約需同步。");
          }

      } catch (e) {
          console.error(e);
          alert("同步失敗，請檢查網路或授權");
      } finally {
          setIsSyncing(false);
      }
  };

  const persistData = async (currentRows: AccountingRow[], currentExp: Expenditure[]) => {
      if (!selectedClinicId) return;
      setSaveStatus('saving');
      try {
          const record: DailyAccountingRecord = {
              clinicId: selectedClinicId,
              date: currentDate,
              rows: currentRows,
              expenditures: currentExp,
              reportImageUrl,
              lastUpdated: Date.now()
          };
          await saveDailyAccounting(record);
          setDailyRecord(record);
          setSaveStatus('saved');
      } catch (e) {
          console.error(e);
          setSaveStatus('error');
      }
  };

  const handleManualSave = () => {
      persistData(rows, expenditures);
  };

  const handleModalSave = (updatedRow: AccountingRow) => {
      // Logic: Save row directly
      const finalRow = { ...updatedRow };
      const updatedRows = rows.map(r => r.id === finalRow.id ? finalRow : r);
      setRows(updatedRows);
      setEditingRow(null); // Close modal
      persistData(updatedRows, expenditures); // Auto-save
  };

  const handleAddRow = () => {
      const newRow = createEmptyRow(true); // isManual = true
      const updatedRows = [...rows, newRow];
      setRows(updatedRows);
      setEditingRow(newRow); // Open modal immediately for the new row
  };

  const handleDeleteRow = (e: React.MouseEvent, id: string) => {
      e.stopPropagation(); // Prevent opening modal
      // Only allowed for Manual rows, checked in UI but safety check here
      const row = rows.find(r => r.id === id);
      if (row && !row.isManual) {
          alert("日曆同步資料不可刪除。請在 Google 日曆上操作後重新同步。");
          return;
      }
      
      if(!confirm("確定刪除此列？")) return;
      
      const updatedRows = rows.filter(r => r.id !== id);
      setRows(updatedRows);
      persistData(updatedRows, expenditures);
  };

  const handleExpenditureChange = (newExp: Expenditure[]) => {
      setExpenditures(newExp);
      persistData(rows, newExp);
  };

  // --- Inline Editing Handlers ---
  const handleInlineNameChange = (id: string, newName: string) => {
      setRows(prev => prev.map(r => r.id === id ? { ...r, patientName: newName } : r));
  };

  // --- Calculations for Dashboard (Always based on ALL rows) ---
  const totals = useMemo(() => {
      return rows.reduce((acc, r) => {
          if (r.npStatus && r.npStatus.includes('爽約')) return acc;

          const collected = r.actualCollected || 0;
          const breakdown = r.paymentBreakdown || { cash: 0, card: 0, transfer: 0 };

          if (breakdown.cash > 0 || breakdown.card > 0 || breakdown.transfer > 0) {
              acc.cash += breakdown.cash;
              acc.card += breakdown.card;
              acc.transfer += breakdown.transfer;
          } else {
              // Legacy Fallback
              if (r.paymentMethod === 'card') acc.card += collected;
              else if (r.paymentMethod === 'transfer') acc.transfer += collected;
              else acc.cash += collected;
          }
          return acc;
      }, { cash: 0, card: 0, transfer: 0 });
  }, [rows]);

  const totalExpenditure = useMemo(() => expenditures.reduce((sum, e) => sum + (Number(e.amount) || 0), 0), [expenditures]);
  
  // Cash Balance = Cash Revenue - Expenditure
  const cashBalance = totals.cash - totalExpenditure;
  
  // Net Revenue = Total Revenue - Expenditure
  const netRevenue = (totals.cash + totals.card + totals.transfer) - totalExpenditure;

  // --- Helpers ---
  const getDoctorColor = (docId: string) => {
      const doc = clinicDocs.find(d => d.id === docId);
      return doc?.avatarBgColor || doc?.color || '#cbd5e1';
  };

  const getDoctorAvatar = (docId: string) => {
      const doc = clinicDocs.find(d => d.id === docId);
      return doc?.avatarText || (doc?.name ? doc.name.charAt(0) : '?');
  };

  const handleExport = () => {
      if (!selectedClinic) return;
      exportDailyReportToExcel(selectedClinic.name, currentDate, rows);
  };

  const formatMoney = (val: number) => (val > 0 ? val.toLocaleString() : '-');

  // --- Patient Name Color Logic (STRICT) ---
  const getPatientNameClass = (row: AccountingRow) => {
      // 1. Manual Entry -> Blue (Always)
      if (row.isManual) {
          return 'text-blue-600 font-bold';
      }
      
      // 2. Calendar Entry Logic (isArrived)
      if (row.isArrived) {
          return 'text-gray-900 font-bold'; // Processed -> Black
      }
      
      return 'text-gray-400 font-medium'; // Pending -> Gray
  };

  return (
    <div className="space-y-6 pb-20">
      {/* 1. Header & Controls */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto">
              <ClinicSelector className="border p-2 rounded-lg bg-slate-50 min-w-[150px]" />
              <div className="flex items-center bg-slate-100 rounded-lg p-1">
                  <button onClick={() => {
                      const d = new Date(currentDate);
                      d.setDate(d.getDate() - 1);
                      setCurrentDate(d.toISOString().split('T')[0]);
                  }} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500"><ChevronLeft size={20}/></button>
                  <input 
                      type="date" 
                      className="bg-transparent border-none text-center font-bold text-slate-700 outline-none w-32"
                      value={currentDate}
                      onChange={e => setCurrentDate(e.target.value)}
                  />
                  <button onClick={() => {
                      const d = new Date(currentDate);
                      d.setDate(d.getDate() + 1);
                      setCurrentDate(d.toISOString().split('T')[0]);
                  }} className="p-1.5 hover:bg-white rounded-md shadow-sm text-slate-500"><ChevronRight size={20}/></button>
              </div>
          </div>

          <div className="flex gap-2 w-full md:w-auto overflow-x-auto items-center">
              {/* Status Indicator */}
              {saveStatus === 'saving' && <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Saving...</span>}
              {saveStatus === 'saved' && <span className="text-xs text-emerald-600 flex items-center gap-1"><Check size={12}/> 已儲存</span>}
              {saveStatus === 'error' && <span className="text-xs text-rose-600 flex items-center gap-1">儲存失敗</span>}

              <button 
                  onClick={handleSyncCalendar}
                  disabled={isSyncing}
                  className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-blue-100 transition-colors whitespace-nowrap ml-2"
              >
                  {isSyncing ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>}
                  同步預約
              </button>

              <button 
                  onClick={handleExport}
                  className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-emerald-100 transition-colors whitespace-nowrap"
              >
                  <FileSpreadsheet size={16} /> 匯出 Excel
              </button>
              <button 
                  onClick={handleManualSave}
                  disabled={saveStatus === 'saving'}
                  className="bg-teal-600 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-teal-700 shadow-md transition-colors whitespace-nowrap"
              >
                  {saveStatus === 'saving' ? <Loader2 className="animate-spin" size={16}/> : <Save size={16} />}
                  儲存
              </button>
          </div>
      </div>

      {/* 2. Dashboard Logic */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
          {/* Card 1: Cash Balance (Green) */}
          <div className="bg-white border-l-4 border-emerald-500 shadow-sm rounded-xl p-5 flex flex-col justify-between">
              <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Wallet size={16} className="text-emerald-500" /> 現金結餘 (收入-支出)
                  </h4>
                  <div className="text-3xl font-black text-slate-800 tabular-nums">
                      ${cashBalance.toLocaleString()}
                  </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 font-medium flex justify-between">
                  <span>現金收: ${totals.cash.toLocaleString()}</span>
                  <span className="text-rose-400">總支: -${totalExpenditure.toLocaleString()}</span>
              </div>
          </div>

          {/* Card 2: Non-Cash (White) */}
          <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 flex flex-col justify-between">
              <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <CreditCard size={16} className="text-slate-400" /> 非現金收入 (Non-Cash)
                  </h4>
                  <div className="text-3xl font-black text-slate-800 tabular-nums">
                      ${(totals.card + totals.transfer).toLocaleString()}
                  </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 font-medium flex justify-between">
                  <span className="flex items-center gap-1"><CreditCard size={10}/> ${totals.card.toLocaleString()}</span>
                  <span className="flex items-center gap-1"><Landmark size={10}/> ${totals.transfer.toLocaleString()}</span>
              </div>
          </div>

          {/* Card 3: Net Revenue (Blue Gradient) */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg rounded-xl p-5 text-white flex flex-col justify-between relative overflow-hidden">
              <div className="relative z-10">
                  <h4 className="text-xs font-bold text-blue-100 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <TrendingUp size={16} /> 本日總結 (總收-支出)
                  </h4>
                  <div className="text-3xl font-black tabular-nums">
                      ${netRevenue.toLocaleString()}
                  </div>
              </div>
              <div className="relative z-10 mt-4 pt-3 border-t border-white/20 text-[10px] text-blue-100 font-medium">
                  公式: (現金 + 刷卡 + 匯款) - 總支出
              </div>
              <TrendingUp className="absolute -right-4 -bottom-4 text-white opacity-10 rotate-12" size={100} />
          </div>
      </div>

      {/* 3. Main Data Table (Strict HTML Structure) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="overflow-x-auto custom-scrollbar flex-1 min-h-[400px]">
              <table className="w-full border-collapse text-sm text-left">
                  <thead className="bg-gray-50 sticky top-0 z-40 shadow-sm text-xs font-bold text-slate-500 uppercase">
                      <tr>
                          <th className="px-2 py-2 border-r border-gray-200 text-center sticky left-0 z-30 bg-gray-50 w-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" rowSpan={2}>#</th>
                          <th className="px-2 py-2 border-r border-gray-200 sticky left-[40px] z-30 bg-gray-50 min-w-[100px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" rowSpan={2}>病患姓名</th>
                          
                          {/* Doctor Header with Filter */}
                          <th className="px-2 py-2 border-r border-gray-200 text-center min-w-[80px] align-middle" rowSpan={2}>
                              <div className="flex flex-col items-center justify-center gap-1">
                                  <span>醫師</span>
                                  <select
                                      className="w-full text-[10px] border border-slate-300 rounded py-0 px-1 bg-white text-slate-700 outline-none h-6"
                                      value={filterDoctor}
                                      onChange={(e) => setFilterDoctor(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                  >
                                      <option value="">全部</option>
                                      {uniqueDoctors.map(d => <option key={d} value={d}>{d}</option>)}
                                  </select>
                              </div>
                          </th>
                          
                          <th className="px-2 py-2 border-r border-gray-200 text-center border-t-4 border-blue-400 border-solid" colSpan={2}>健保項目</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-center border-t-4 border-purple-400 border-solid" colSpan={8}>自費療程 (Treatment)</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-center border-t-4 border-orange-400 border-solid" colSpan={2}>小金庫 (Retail)</th>
                          
                          <th className="px-2 py-2 border-r border-gray-200 text-center border-t-4 border-emerald-500 border-solid" colSpan={2}>結帳 (Payment)</th>
                          <th className="px-2 py-2 text-center border-t-4 border-slate-300 border-solid" colSpan={4}>備註與操作</th>
                      </tr>
                      <tr>
                          {/* NHI Sub-header */}
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[60px] bg-blue-50/30">掛號</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[60px] bg-blue-50/30">部分</th>

                          {/* Self Pay Sub-header */}
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-purple-50/30">假牙</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-purple-50/30">植牙</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-purple-50/30">美白</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-purple-50/30">矯正</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-purple-50/30">SOV</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-purple-50/30">INV</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-purple-50/30">牙周</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-purple-50/30">其他</th>
                          
                          {/* Retail Sub-header */}
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-orange-50/30">小金庫</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[70px] bg-orange-50/30">物販</th>

                          {/* Payment Sub-header */}
                          <th className="px-2 py-2 border-r border-gray-200 text-right min-w-[90px] bg-emerald-50/30">實收總計</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-center min-w-[60px] bg-emerald-50/30">方式</th>

                          {/* Info Sub-header */}
                          <th className="px-2 py-2 border-r border-gray-200 text-left min-w-[80px]">NP/備註</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-left min-w-[120px]">療程內容</th>
                          <th className="px-2 py-2 border-r border-gray-200 text-left min-w-[80px]">技工所</th>
                          <th className="px-2 py-2 w-10"></th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                      {filteredRows.map((row, idx) => {
                          const isMissed = row.npStatus && row.npStatus.includes('爽約');
                          const hasPaid = row.actualCollected > 0;

                          return (
                              <tr 
                                key={row.id} 
                                className={`hover:bg-gray-50 transition-colors cursor-pointer group ${isMissed ? 'opacity-60 bg-gray-50' : ''}`} 
                                onClick={() => setEditingRow(row)}
                              >
                                  {/* Col 1: Index (Sticky Left) */}
                                  <td className="px-2 py-2 border-r border-gray-200 text-center text-xs font-mono text-gray-400 sticky left-0 z-30 bg-white group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                      {idx + 1}
                                  </td>
                                  
                                  {/* Col 2: Patient Name (Sticky Left + 40px) */}
                                  <td className="px-2 py-2 border-r border-gray-200 sticky left-[40px] z-30 bg-white group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                      <input
                                          type="text"
                                          className={`bg-transparent border-none outline-none w-full p-0 focus:ring-0 cursor-text ${getPatientNameClass(row)}`}
                                          value={row.patientName}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) => handleInlineNameChange(row.id, e.target.value)}
                                          onBlur={() => persistData(rows, expenditures)}
                                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                      />
                                  </td>

                                  {/* Col 3: Doctor */}
                                  <td className="px-2 py-2 border-r border-gray-200 text-center">
                                      <div className="flex items-center justify-center gap-1" title={row.doctorName}>
                                          <div 
                                              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shadow-sm"
                                              style={{ backgroundColor: getDoctorColor(row.doctorId) }}
                                          >
                                              {getDoctorAvatar(row.doctorId)}
                                          </div>
                                          <span className="text-xs font-bold text-gray-700 truncate max-w-[60px]">
                                              {row.doctorName}
                                          </span>
                                      </div>
                                  </td>

                                  {/* Col 4-5: NHI */}
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-blue-600 font-medium">
                                      {formatMoney(Number(row.treatments.regFee))}
                                  </td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-blue-600 font-medium">
                                      {formatMoney(Number(row.treatments.copayment))}
                                  </td>

                                  {/* Col 6-13: Self Pay */}
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-purple-600 font-medium">{formatMoney(Number(row.treatments.prostho))}</td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-purple-600 font-medium">{formatMoney(Number(row.treatments.implant))}</td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-purple-600 font-medium">{formatMoney(Number(row.treatments.whitening))}</td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-purple-600 font-medium">{formatMoney(Number(row.treatments.ortho))}</td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-purple-600 font-medium">{formatMoney(Number(row.treatments.sov))}</td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-purple-600 font-medium">{formatMoney(Number(row.treatments.inv))}</td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-purple-600 font-medium">{formatMoney(Number(row.treatments.perio))}</td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-purple-600 font-medium">{formatMoney(Number(row.treatments.otherSelfPay))}</td>
                                  
                                  {/* Col 14-15: Retail */}
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-orange-600 font-medium">{formatMoney(Number(row.retail.diyWhitening))}</td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-right font-mono text-orange-600 font-medium">{formatMoney(Number(row.retail.products))}</td>

                                  {/* Col 16-17: Payment */}
                                  <td className="px-2 py-2 border-r border-gray-200 text-right">
                                      <span className={`font-mono font-bold text-base ${hasPaid ? 'text-emerald-600' : 'text-gray-300'}`}>
                                          {formatMoney(row.actualCollected)}
                                      </span>
                                  </td>
                                  <td className="px-2 py-2 border-r border-gray-200 text-center">
                                      {hasPaid && (
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                              row.paymentMethod === 'card' ? 'bg-pink-50 text-pink-600 border border-pink-100' : 
                                              row.paymentMethod === 'transfer' ? 'bg-amber-50 text-amber-600 border border-amber-100' : 
                                              'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                          }`}>
                                              {row.paymentMethod === 'card' ? 'Card' : row.paymentMethod === 'transfer' ? 'Trans' : 'Cash'}
                                          </span>
                                      )}
                                  </td>

                                  {/* Col 18-21: Info & Action */}
                                  <td className="px-2 py-2 border-r border-gray-200">
                                      <div className="truncate max-w-[80px] text-gray-600 text-xs font-medium">{row.npStatus}</div>
                                  </td>
                                  <td className="px-2 py-2 border-r border-gray-200">
                                      <div className="truncate max-w-[120px] text-gray-500 text-xs">{row.treatmentContent}</div>
                                  </td>
                                  <td className="px-2 py-2 border-r border-gray-200">
                                      <div className="truncate max-w-[80px] text-gray-500 text-xs">{row.labName}</div>
                                  </td>
                                  <td className="px-2 py-2 text-center">
                                      {/* DELETE BUTTON: Only for Manual Rows */}
                                      {row.isManual && (
                                          <button 
                                            onClick={(e) => handleDeleteRow(e, row.id)} 
                                            className="text-gray-300 hover:text-rose-500 p-1 rounded hover:bg-rose-50 transition-colors"
                                          >
                                              <Trash2 size={14} />
                                          </button>
                                      )}
                                  </td>
                              </tr>
                          );
                      })}
                      {filteredRows.length === 0 && (
                          <tr>
                              <td colSpan={21} className="p-12 text-center text-slate-400 bg-slate-50 italic">
                                  尚無資料。請使用上方按鈕新增，或同步日曆預約。
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
          <div className="p-2 bg-slate-50 border-t border-slate-200 text-center">
              <button onClick={handleAddRow} className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center justify-center gap-1 w-full py-2 hover:bg-blue-50 transition-colors">
                  <Plus size={16} /> 新增一列 (Manual Row)
              </button>
          </div>
      </div>

      {/* 4. Bottom Section: Expenditure */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-4 bg-rose-50 border-b border-rose-100 flex justify-between items-center">
              <h4 className="font-bold text-rose-700 text-sm flex items-center gap-2">
                  <FileText size={16}/> 診所支出明細 (Expenditures)
              </h4>
              <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-rose-600">總支出: ${totalExpenditure.toLocaleString()}</span>
                  <button 
                      onClick={() => handleExpenditureChange([...expenditures, { id: crypto.randomUUID(), item: '', amount: 0 }])}
                      className="bg-white hover:bg-rose-100 text-rose-600 border border-rose-200 px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                  >
                      <Plus size={12} /> 新增項目
                  </button>
              </div>
          </div>
          
          <div className="flex-1 overflow-y-auto max-h-[200px] p-2 space-y-2">
              {expenditures.map((ex, idx) => (
                  <div key={ex.id} className="flex gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <input 
                          className="flex-1 bg-white border border-slate-200 rounded px-3 py-1.5 text-sm outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-200"
                          placeholder="支出項目名稱"
                          value={ex.item}
                          onChange={e => {
                              const newEx = [...expenditures];
                              newEx[idx].item = e.target.value;
                              handleExpenditureChange(newEx);
                          }}
                      />
                      <div className="relative w-32">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                          <input 
                              type="number"
                              className="w-full bg-white border border-slate-200 rounded pl-5 pr-2 py-1.5 text-sm outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-200 text-right font-mono font-bold text-rose-600"
                              placeholder="0"
                              value={ex.amount}
                              onChange={e => {
                                  const newEx = [...expenditures];
                                  newEx[idx].amount = Number(e.target.value);
                                  handleExpenditureChange(newEx);
                              }}
                          />
                      </div>
                      <button 
                          onClick={() => handleExpenditureChange(expenditures.filter((_, i) => i !== idx))}
                          className="text-slate-300 hover:text-rose-500 p-1.5"
                      >
                          <Trash2 size={16} />
                      </button>
                  </div>
              ))}
              {expenditures.length === 0 && (
                  <div className="text-center text-slate-400 text-xs py-4">無支出項目</div>
              )}
          </div>
      </div>

      {/* POS Modal */}
      {editingRow && (
          <AppointmentDetailModal 
              isOpen={!!editingRow}
              onClose={() => setEditingRow(null)}
              clinicId={selectedClinicId}
              consultants={consultants}
              doctors={doctors}
              laboratories={laboratories}
              event={null}
              initialRow={editingRow}
              onSaveRow={handleModalSave}
          />
      )}
    </div>
  );
};
