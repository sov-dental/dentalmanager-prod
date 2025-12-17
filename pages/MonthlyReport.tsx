import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clinic, Doctor, AccountingRow, NHIRecord, MonthlyClosing } from '../types';
import { getMonthlyAccounting, getNHIRecords, getMonthlyClosingStatus, lockMonthlyReport, unlockMonthlyReport } from '../services/firebase';
import { useClinic } from '../contexts/ClinicContext';
import { useAuth } from '../contexts/AuthContext';
import { ClinicSelector } from '../components/ClinicSelector';
import { NHIClaimsModal } from '../components/NHIClaimsModal';
import { 
  TrendingUp, Banknote, CreditCard, Landmark, 
  Search, Loader2, FileSpreadsheet, Filter, ChevronDown, PlusCircle,
  Stethoscope, Activity, Ticket, Wallet, Star, Lock, Unlock
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface Props {
  clinics: Clinic[]; // Kept for compatibility
  doctors: Doctor[];
}

interface SplitCapsuleProps {
    label: string;
    amount: number;
    colorClass: string;
}

const SplitCapsule: React.FC<SplitCapsuleProps> = ({ label, amount, colorClass }) => {
    return (
        <span className={`inline-flex items-baseline gap-1.5 px-2 py-0.5 rounded-md border shadow-sm ${colorClass} whitespace-nowrap`}>
            <span className="text-xs font-medium opacity-80 uppercase">{label}</span>
            <span className="text-sm font-bold tabular-nums">${amount.toLocaleString()}</span>
        </span>
    );
};

export const MonthlyReport: React.FC<Props> = ({ doctors }) => {
  const navigate = useNavigate();
  const { selectedClinicId } = useClinic();
  const { userRole, currentUser } = useAuth();
  
  const [currentMonth, setCurrentMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [searchTerm, setSearchTerm] = useState('');
  const [rows, setRows] = useState<AccountingRow[]>([]);
  const [nhiRecords, setNhiRecords] = useState<NHIRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isNHIModalOpen, setIsNHIModalOpen] = useState(false);

  // Monthly Closing State
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyClosing | null>(null);
  const [isClosingActionLoading, setIsClosingActionLoading] = useState(false);

  // --- Column Filters ---
  const [filterDate, setFilterDate] = useState('');
  const [filterDoctor, setFilterDoctor] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterSelfPay, setFilterSelfPay] = useState('');
  const [filterRetail, setFilterRetail] = useState('');

  useEffect(() => {
      if (selectedClinicId && currentMonth) {
          fetchData();
      }
  }, [selectedClinicId, currentMonth]);

  const fetchData = async () => {
      if (!selectedClinicId) return;
      setIsLoading(true);
      try {
          const [dailyData, nhiData, status] = await Promise.all([
              getMonthlyAccounting(selectedClinicId, currentMonth),
              getNHIRecords(selectedClinicId, currentMonth),
              getMonthlyClosingStatus(selectedClinicId, currentMonth)
          ]);
          setRows(dailyData);
          setNhiRecords(nhiData);
          setMonthlyStatus(status);
          
          // Reset filters
          setFilterDate('');
          setFilterDoctor('');
          setFilterPayment('');
          setFilterSelfPay('');
          setFilterRetail('');
      } catch (error) {
          console.error(error);
          alert("讀取月報表失敗");
      } finally {
          setIsLoading(false);
      }
  };

  const handleLockMonth = async () => {
      if (!selectedClinicId || !currentMonth || !currentUser) return;
      if (!confirm("確定要進行月結鎖定嗎？鎖定後，本月的所有日報表將無法解鎖。")) return;

      setIsClosingActionLoading(true);
      try {
          await lockMonthlyReport(selectedClinicId, currentMonth, { uid: currentUser.uid, name: currentUser.email || 'User' });
          alert("✅ 本月已成功結帳鎖定！");
          fetchData();
      } catch (e: any) {
          alert(`❌ 鎖定失敗: ${e.message}`);
      } finally {
          setIsClosingActionLoading(false);
      }
  };

  const handleUnlockMonth = async () => {
      if (!selectedClinicId || !currentMonth) return;
      if (!confirm("確定要重啟本月月結嗎？")) return;

      setIsClosingActionLoading(true);
      try {
          await unlockMonthlyReport(selectedClinicId, currentMonth);
          alert("🔓 已解除月結鎖定。");
          fetchData();
      } catch (e: any) {
          alert(`❌ 解除失敗: ${e.message}`);
      } finally {
          setIsClosingActionLoading(false);
      }
  };

  const refreshNHIData = async () => {
      if (!selectedClinicId) return;
      try {
          const nhiData = await getNHIRecords(selectedClinicId, currentMonth);
          setNhiRecords(nhiData);
      } catch (e) {
          console.error("Failed to refresh NHI data", e);
      }
  };

  // --- Derived Data for Filters ---
  const uniqueDates = useMemo(() => {
      const dates = new Set(rows.map(r => r.originalDate || (r.startTime ? r.startTime.split('T')[0] : '')));
      return Array.from(dates).filter(Boolean).sort();
  }, [rows]);

  const uniqueDoctors = useMemo(() => {
      const docs = new Set(rows.map(r => r.doctorName));
      return Array.from(docs).filter(Boolean).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
      return rows.filter(row => {
          if (searchTerm) {
              const lower = searchTerm.toLowerCase();
              if (!row.patientName.toLowerCase().includes(lower) && 
                  !row.doctorName.toLowerCase().includes(lower)) {
                  return false;
              }
          }

          const rowDate = row.originalDate || (row.startTime ? row.startTime.split('T')[0] : '');
          if (filterDate && rowDate !== filterDate) return false;
          if (filterDoctor && row.doctorName !== filterDoctor) return false;

          if (filterPayment) {
              const { cash, card, transfer } = row.paymentBreakdown || { cash: 0, card: 0, transfer: 0 };
              let isCash = cash > 0;
              let isCard = card > 0;
              let isTransfer = transfer > 0;

              if (!isCash && !isCard && !isTransfer && row.actualCollected > 0) {
                  if (row.paymentMethod === 'card') isCard = true;
                  else if (row.paymentMethod === 'transfer') isTransfer = true;
                  else isCash = true;
              }

              if (filterPayment === 'cash' && !isCash) return false;
              if (filterPayment === 'card' && !isCard) return false;
              if (filterPayment === 'transfer' && !isTransfer) return false;
          }

          if (filterSelfPay) {
              const t = row.treatments as any;
              if (!t[filterSelfPay] || t[filterSelfPay] <= 0) return false;
          }

          if (filterRetail) {
              const r = row.retail;
              if (filterRetail === 'products' && (!r.products || r.products <= 0)) return false;
              if (filterRetail === 'diyWhitening' && (!r.diyWhitening || r.diyWhitening <= 0)) return false;
          }

          return true;
      });
  }, [rows, searchTerm, filterDate, filterDoctor, filterPayment, filterSelfPay, filterRetail]);

  const totals = useMemo(() => {
      return filteredRows.reduce((acc, row) => {
          const breakdown = row.paymentBreakdown || { cash: 0, card: 0, transfer: 0 };
          if (breakdown.cash > 0 || breakdown.card > 0 || breakdown.transfer > 0) {
              acc.cash += breakdown.cash;
              acc.card += breakdown.card;
              acc.transfer += breakdown.transfer;
          } else {
              if (row.paymentMethod === 'card') acc.card += row.actualCollected;
              else if (row.paymentMethod === 'transfer') acc.transfer += row.actualCollected;
              else acc.cash += row.actualCollected;
          }
          return acc;
      }, { cash: 0, card: 0, transfer: 0 });
  }, [filteredRows]);

  const totalNHI = useMemo(() => nhiRecords.reduce((sum, r) => sum + r.amount, 0), [nhiRecords]);
  
  const revenueSources = useMemo(() => {
      return filteredRows.reduce((acc, row) => {
          const t = row.treatments;
          const r = row.retail;
          const reg = (t.regFee || 0) + (t.copayment || 0);
          const self = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + 
                       (t.sov || 0) + (t.inv || 0) + (t.whitening || 0) + (t.perio || 0) + 
                       (t.otherSelfPay || 0) + (r.products || 0) + (r.diyWhitening || 0);
          acc.registration += reg;
          acc.selfPay += self;
          return acc;
      }, { registration: 0, selfPay: 0 });
  }, [filteredRows]);

  const heroTotalRevenue = revenueSources.registration + revenueSources.selfPay + totalNHI;
  const clinicTotalRevenue = revenueSources.registration + revenueSources.selfPay;

  const handleExport = () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(filteredRows.map(r => ({
          日期: r.originalDate || (r.startTime ? r.startTime.split('T')[0] : '-'),
          病患: r.patientName,
          醫師: r.doctorName,
          NP備註: r.npStatus,
          掛號費: r.treatments.regFee || 0,
          部分負擔: r.treatments.copayment || 0,
          假牙: r.treatments.prostho || 0,
          植牙: r.treatments.implant || 0,
          矯正: r.treatments.ortho || 0,
          SOV: r.treatments.sov || 0,
          INV: r.treatments.inv || 0,
          美白: r.treatments.whitening || 0,
          牙周: r.treatments.perio || 0,
          其他: r.treatments.otherSelfPay || 0,
          物販: r.retail.products || 0,
          小金庫: r.retail.diyWhitening || 0,
          實收: r.actualCollected,
          支付方式: r.paymentBreakdown?.card ? '刷卡' : r.paymentBreakdown?.transfer ? '匯款' : '現金',
          療程內容: r.treatmentContent,
      })));
      XLSX.utils.book_append_sheet(wb, ws, "Daily Detail");

      if (nhiRecords.length > 0) {
          const wsNHI = XLSX.utils.json_to_sheet(nhiRecords.map(r => ({
              醫師: r.doctorName,
              申報金額: r.amount,
              備註: r.note
          })));
          XLSX.utils.book_append_sheet(wb, wsNHI, "NHI Claims");
      }

      XLSX.writeFile(wb, `Monthly_Report_${selectedClinicId}_${currentMonth}.xlsx`);
  };

  const renderDoctorAvatar = (row: AccountingRow) => {
      const doc = doctors.find(d => d.id === row.doctorId) || 
                  doctors.find(d => d.name === row.doctorName && d.clinicId === selectedClinicId);
      const color = doc?.avatarBgColor || doc?.color || '#cbd5e1';
      const text = doc?.avatarText || (row.doctorName ? row.doctorName.charAt(0) : '?');
      return (
          <div className="flex justify-center" title={row.doctorName}>
              <div 
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[14px] font-bold shadow-sm ring-2 ring-white"
                style={{ backgroundColor: color }}
              >
                  {text}
              </div>
          </div>
      );
  };

  const getPatientNameColor = (row: AccountingRow) => {
      const base = "text-lg font-bold";
      if (row.isManual) return `${base} text-blue-600`;
      const isArrived = row.attendance !== undefined ? row.attendance : true;
      if (isArrived) return `${base} text-gray-900`;
      return `${base} text-gray-100`;
  };

  const renderSelfPayCapsules = (row: AccountingRow) => {
      const items = [
          { label: '假牙', amount: row.treatments.prostho, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
          { label: '植牙', amount: row.treatments.implant, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
          { label: '矯正', amount: row.treatments.ortho, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
          { label: 'SOV', amount: row.treatments.sov, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
          { label: 'INV', amount: row.treatments.inv, color: 'bg-sky-50 border-sky-200 text-sky-700' },
          { label: '美白', amount: row.treatments.whitening, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
          { label: '牙周', amount: row.treatments.perio, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
          { label: '其他', amount: row.treatments.otherSelfPay, color: 'bg-slate-50 border-slate-200 text-slate-700' },
      ];
      const activeItems = items.filter(i => i.amount > 0);
      if (activeItems.length === 0) return <span className="text-slate-300 text-xs">-</span>;
      return (
          <div className="flex flex-col gap-1 items-end w-full">
              {activeItems.map((item, idx) => (
                  <SplitCapsule key={idx} label={item.label} amount={item.amount} colorClass={item.color} />
              ))}
          </div>
      );
  };

  const renderRetailCapsules = (row: AccountingRow) => {
      const items: { label: string; amount: number; color: string }[] = [];
      if (row.retail.products > 0) items.push({ label: '物販', amount: row.retail.products, color: 'bg-orange-50 border-orange-200 text-orange-700' });
      if (row.retail.diyWhitening > 0) items.push({ label: '小金庫', amount: row.retail.diyWhitening, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' });
      if (items.length === 0) return <span className="text-slate-300 text-xs">-</span>;
      return (
          <div className="flex flex-col gap-1 items-end w-full">
              {items.map((item, idx) => (
                  <SplitCapsule key={idx} label={item.label} amount={item.amount} colorClass={item.color} />
              ))}
          </div>
      );
  };

  const renderTotalAmount = (row: AccountingRow) => {
      const total = row.actualCollected;
      if (total === 0) return <span className="text-slate-300 text-sm font-bold">$0</span>;
      const { cash, card, transfer } = row.paymentBreakdown || { cash: 0, card: 0, transfer: 0 };
      let isCash = cash > 0, isCard = card > 0, isTransfer = transfer > 0;
      if (!isCash && !isCard && !isTransfer) {
          if (row.paymentMethod === 'card') isCard = true;
          else if (row.paymentMethod === 'transfer') isTransfer = true;
          else isCash = true;
      }
      if (isCard) return <SplitCapsule label="刷卡" amount={total} colorClass="bg-pink-50 border-pink-200 text-pink-700" />;
      if (isTransfer) return <SplitCapsule label="匯款" amount={total} colorClass="bg-slate-100 border-slate-300 text-slate-700" />;
      return <span className="text-sm font-bold text-slate-700 tabular-nums">${total.toLocaleString()}</span>;
  };

  const isMonthLocked = monthlyStatus?.isLocked || false;
  const headerCellStyle = "px-4 py-3 text-xs font-bold text-slate-500 uppercase bg-slate-50 border-b border-slate-200 border-r border-slate-100 sticky top-0 z-20";

  return (
    <div className="space-y-6">
      {/* 1. Header & Controls */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <TrendingUp className="text-teal-600" /> 月營收報表
                </h2>
                {isMonthLocked && (
                    <div className="flex items-center gap-2 mt-1 text-rose-600 font-bold text-sm bg-rose-50 px-2 py-0.5 rounded border border-rose-100 w-fit">
                        <Lock size={14} /> 本月帳務已結帳鎖定
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-2">
                {/* Monthly Closing Buttons */}
                {(userRole === 'admin' || userRole === 'manager') && (
                    isMonthLocked ? (
                        <button 
                            onClick={handleUnlockMonth}
                            disabled={isClosingActionLoading}
                            className="flex items-center gap-2 bg-rose-100 text-rose-700 border border-rose-200 hover:bg-rose-200 px-4 py-2 rounded-lg transition-colors text-sm font-bold shadow-sm"
                        >
                            {isClosingActionLoading ? <Loader2 size={18} className="animate-spin" /> : <Unlock size={18} />}
                            🔓 重啟月結 (Re-open)
                        </button>
                    ) : (
                        <button 
                            onClick={handleLockMonth}
                            disabled={isClosingActionLoading}
                            className="flex items-center gap-2 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 px-4 py-2 rounded-lg transition-colors text-sm font-bold shadow-sm"
                        >
                            {isClosingActionLoading ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
                            🔒 月結鎖定 (Close Month)
                        </button>
                    )
                )}

                <button 
                    onClick={handleExport}
                    className="flex items-center gap-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg transition-colors text-sm font-bold"
                >
                    <FileSpreadsheet size={18} /> 匯出 Excel
                </button>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">診所</label>
                <ClinicSelector className="border p-2 rounded bg-white w-full" />
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">月份</label>
                <input 
                    type="month" 
                    className="w-full border p-2 rounded bg-white"
                    value={currentMonth}
                    onChange={e => setCurrentMonth(e.target.value)}
                />
            </div>
            <div className="md:col-span-2 flex items-end">
                <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                        type="text"
                        placeholder="搜尋病患姓名..."
                        className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 outline-none"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>
        </div>
      </div>

      {/* 2. Dashboard Grid */}
      <div className="space-y-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl shadow-lg p-6 text-white relative overflow-hidden">
                  <div className="relative z-10 flex flex-col md:flex-row items-center md:items-end justify-between gap-4">
                      <div>
                          <h3 className="text-sm font-bold text-blue-100 uppercase tracking-widest mb-1 flex items-center gap-2">
                              <TrendingUp size={16} /> 本月總營收 (Total Revenue)
                          </h3>
                          <p className="text-4xl md:text-5xl font-black tracking-tight tabular-nums mt-1">
                              ${heroTotalRevenue.toLocaleString()}
                          </p>
                      </div>
                      <div className="text-right w-full md:w-auto">
                           <div className="text-xs text-blue-200 bg-white/10 px-3 py-2 rounded-lg backdrop-blur-sm flex flex-col gap-1 md:block">
                              <span className="flex justify-between md:inline-block md:mr-2">
                                  <span>診所:</span> 
                                  <span className="font-bold ml-1">${clinicTotalRevenue.toLocaleString()}</span>
                              </span>
                              <span className="hidden md:inline-block border-l border-white/20 h-3 mx-2"></span>
                              <span className="flex justify-between md:inline-block md:border-none border-t border-white/10 pt-1 md:pt-0">
                                  <span>健保:</span> 
                                  <span className="font-bold ml-1">${totalNHI.toLocaleString()}</span>
                              </span>
                           </div>
                      </div>
                  </div>
                  <div className="absolute -right-6 -bottom-6 opacity-10 transform rotate-12 pointer-events-none">
                      <TrendingUp size={120} />
                  </div>
              </div>

              <button 
                  onClick={() => setIsNHIModalOpen(true)}
                  className="md:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 border-l-4 border-l-teal-500 p-6 flex flex-row md:flex-col justify-between items-center md:items-start relative overflow-hidden hover:bg-slate-50 transition-colors text-left group"
              >
                  <div className="relative z-10 flex flex-col justify-between items-start h-full w-full">
                      <div className="w-full flex justify-between md:block">
                          <h3 className="text-xs font-bold text-teal-600 uppercase tracking-widest mb-1 flex items-center gap-2">
                              <Activity size={16} /> 健保申報 (NHI)
                          </h3>
                          <div className="text-2xl md:text-3xl font-black text-slate-700 tabular-nums">
                              ${totalNHI.toLocaleString()}
                          </div>
                      </div>
                      <div className="flex items-center justify-between w-full mt-2 md:mt-auto">
                          <div className="text-[10px] text-slate-400 bg-slate-50 px-2 py-1 rounded">
                              *點擊設定金額
                          </div>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-teal-500 bg-teal-50 p-1 rounded-full"><PlusCircle size={16} /></span>
                      </div>
                  </div>
                  <div className="absolute -right-4 -bottom-4 text-teal-50 opacity-50 pointer-events-none transform -rotate-12">
                      <Activity size={80} />
                  </div>
              </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 border-l-4 border-l-purple-600 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                  <Wallet className="text-purple-600" /> 診所實收 (Clinic Revenue)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="md:col-span-3 bg-purple-50 rounded-xl p-5 border border-purple-100 relative overflow-hidden group">
                      <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center">
                          <div>
                              <div className="flex items-center gap-2 text-purple-700 mb-1 font-bold text-sm uppercase">
                                  <Stethoscope size={18} /> 自費項目 (Self-Pay)
                              </div>
                              <div className="text-3xl md:text-4xl font-black text-purple-800 tracking-tight tabular-nums">
                                  ${revenueSources.selfPay.toLocaleString()}
                              </div>
                          </div>
                      </div>
                      <div className="absolute right-0 bottom-0 opacity-5 transform translate-y-1/4 translate-x-1/4 pointer-events-none">
                          <Star size={120} className="text-purple-900" />
                      </div>
                  </div>
                  <div className="md:col-span-1 bg-slate-50 rounded-xl p-5 border border-slate-100 flex flex-col justify-center">
                      <div className="flex items-center gap-2 text-slate-500 mb-1 text-xs font-bold uppercase">
                          <Ticket size={14} /> 掛號費
                      </div>
                      <div className="text-2xl font-bold text-slate-600 tabular-nums">
                          ${revenueSources.registration.toLocaleString()}
                      </div>
                  </div>
              </div>

              <div className="border-t border-slate-100 my-6"></div>
              <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">收款方式分佈 (Payment Methods)</h4>
                  <div className="flex h-3 md:h-4 rounded-full overflow-hidden mb-6 bg-slate-100 border border-slate-100">
                      {clinicTotalRevenue > 0 && (
                          <>
                            <div style={{ width: `${(totals.cash / clinicTotalRevenue * 100) || 0}%` }} className="bg-emerald-500 transition-all duration-500"></div>
                            <div style={{ width: `${(totals.card / clinicTotalRevenue * 100) || 0}%` }} className="bg-pink-500 transition-all duration-500"></div>
                            <div style={{ width: `${(totals.transfer / clinicTotalRevenue * 100) || 0}%` }} className="bg-amber-500 transition-all duration-500"></div>
                          </>
                      )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="p-3 rounded-lg border border-slate-100 bg-white flex items-center justify-between shadow-sm">
                          <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0"><Banknote size={16}/></div>
                              <span className="text-xs font-bold text-slate-500">現金</span>
                          </div>
                          <span className="text-lg font-bold text-slate-700 tabular-nums">${totals.cash.toLocaleString()}</span>
                      </div>
                      <div className="p-3 rounded-lg border border-slate-100 bg-white flex items-center justify-between shadow-sm">
                          <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center text-pink-600 shrink-0"><CreditCard size={16}/></div>
                              <span className="text-xs font-bold text-slate-500">刷卡</span>
                          </div>
                          <span className="text-lg font-bold text-slate-700 tabular-nums">${totals.card.toLocaleString()}</span>
                      </div>
                      <div className="p-3 rounded-lg border border-slate-100 bg-white flex items-center justify-between shadow-sm">
                          <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0"><Landmark size={16}/></div>
                              <span className="text-xs font-bold text-slate-500">匯款</span>
                          </div>
                          <span className="text-lg font-bold text-slate-700 tabular-nums">${totals.transfer.toLocaleString()}</span>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {/* 3. Data Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[500px]">
          <div className="flex-1 overflow-x-auto custom-scrollbar">
              {isLoading ? (
                  <div className="flex items-center justify-center h-64 text-slate-400 gap-2">
                      <Loader2 className="animate-spin" /> 讀取中...
                  </div>
              ) : (
                  <table className="w-full border-collapse">
                      <thead>
                          <tr>
                              <th className={`${headerCellStyle} text-left min-w-[80px]`}>
                                  <div className="flex items-center justify-between gap-1">
                                      <span>日期</span>
                                      <div className="relative group">
                                          <Filter size={12} className="cursor-pointer hover:text-teal-600" />
                                          <select className="absolute top-0 right-0 w-full h-full opacity-0 cursor-pointer" value={filterDate} onChange={e => setFilterDate(e.target.value)}>
                                              <option value="">全部</option>
                                              {uniqueDates.map(d => <option key={d} value={d}>{d.slice(5)}</option>)}
                                          </select>
                                      </div>
                                  </div>
                              </th>
                              <th className={`${headerCellStyle} text-left min-w-[100px]`}>病患</th>
                              <th className={`${headerCellStyle} text-center min-w-[80px]`}>
                                  <div className="flex items-center justify-center gap-1">
                                      <span>醫師</span>
                                      <div className="relative group">
                                          <ChevronDown size={10} className="cursor-pointer hover:text-teal-600" />
                                          <select className="absolute top-0 right-0 w-full h-full opacity-0 cursor-pointer" value={filterDoctor} onChange={e => setFilterDoctor(e.target.value)}>
                                              <option value="">全部</option>
                                              {uniqueDoctors.map(d => <option key={d} value={d}>{d}</option>)}
                                          </select>
                                      </div>
                                  </div>
                              </th>
                              <th className={`${headerCellStyle} text-right min-w-[100px]`}>掛號/部分負擔</th>
                              <th className={`${headerCellStyle} text-right min-w-[140px]`}>
                                  <div className="flex items-center justify-end gap-1">
                                      <span>自費項目</span>
                                      <div className="relative group">
                                          <Filter size={12} className="cursor-pointer hover:text-teal-600" />
                                          <select className="absolute top-0 right-0 w-full h-full opacity-0 cursor-pointer" value={filterSelfPay} onChange={e => setFilterSelfPay(e.target.value)}>
                                              <option value="">全部</option>
                                              <option value="prostho">假牙</option>
                                              <option value="implant">植牙</option>
                                              <option value="ortho">矯正</option>
                                              <option value="sov">SOV</option>
                                              <option value="inv">INV</option>
                                              <option value="whitening">美白</option>
                                              <option value="perio">牙周</option>
                                              <option value="otherSelfPay">其他</option>
                                          </select>
                                      </div>
                                  </div>
                              </th>
                              <th className={`${headerCellStyle} text-right min-w-[140px]`}>
                                  <div className="flex items-center justify-end gap-1">
                                      <span>小金庫/物販</span>
                                      <div className="relative group">
                                          <Filter size={12} className="cursor-pointer hover:text-teal-600" />
                                          <select className="absolute top-0 right-0 w-full h-full opacity-0 cursor-pointer" value={filterRetail} onChange={e => setFilterRetail(e.target.value)}>
                                              <option value="">全部</option>
                                              <option value="products">物販</option>
                                              <option value="diyWhitening">小金庫</option>
                                          </select>
                                      </div>
                                  </div>
                              </th>
                              <th className={`${headerCellStyle} text-right min-w-[140px]`}>
                                  <div className="flex items-center justify-end gap-1">
                                      <span>總金額 (實收)</span>
                                      <div className="relative group">
                                          <Filter size={12} className="cursor-pointer hover:text-teal-600" />
                                          <select className="absolute top-0 right-0 w-full h-full opacity-0 cursor-pointer" value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
                                              <option value="">全部</option>
                                              <option value="cash">現金</option>
                                              <option value="card">刷卡</option>
                                              <option value="transfer">匯款</option>
                                          </select>
                                      </div>
                                  </div>
                              </th>
                              <th className={`${headerCellStyle} text-left min-w-[100px]`}>療程內容</th>
                              <th className={`${headerCellStyle} text-left min-w-[80px] border-r-0`}>NP/備註</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                          {filteredRows.map((row, idx) => {
                              const dateStr = row.originalDate || (row.startTime ? row.startTime.split('T')[0] : '');
                              return (
                                <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-4 py-3 text-lg font-mono text-blue-600 font-bold border-r border-slate-50 cursor-pointer hover:underline whitespace-nowrap" onClick={() => navigate(`/accounting?date=${dateStr}`)}>
                                        {dateStr.slice(5)}
                                    </td>
                                    <td className="px-4 py-3 text-sm border-r border-slate-50 whitespace-nowrap"><span className={getPatientNameColor(row)}>{row.patientName}</span></td>
                                    <td className="px-2 py-3 border-r border-slate-50">{renderDoctorAvatar(row)}</td>
                                    <td className="px-4 py-3 text-right text-sm font-mono text-slate-600 border-r border-slate-50 whitespace-nowrap">
                                        {row.treatments.regFee > 0 || row.treatments.copayment > 0 ? (
                                            <><span>{row.treatments.regFee}</span><span className="text-slate-300 mx-1">/</span><span>{row.treatments.copayment}</span></>
                                        ) : <span className="text-slate-200">-</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right border-r border-slate-50 align-top">{renderSelfPayCapsules(row)}</td>
                                    <td className="px-4 py-3 text-right border-r border-slate-50 align-top">{renderRetailCapsules(row)}</td>
                                    <td className="px-4 py-3 text-right border-r border-slate-50 whitespace-nowrap align-top">{renderTotalAmount(row)}</td>
                                    <td className="px-4 py-3 text-xs text-slate-500 border-r border-slate-50 truncate max-w-[200px]">{row.treatmentContent}</td>
                                    <td className="px-4 py-3 text-xs">
                                        {row.npStatus ? <span className={`font-bold px-1.5 py-0.5 rounded ${row.npStatus.includes('NP') ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{row.npStatus}</span> : <span className="text-slate-300">-</span>}
                                    </td>
                                </tr>
                              );
                          })}
                      </tbody>
                  </table>
              )}
          </div>
      </div>

      <NHIClaimsModal 
          isOpen={isNHIModalOpen}
          onClose={() => setIsNHIModalOpen(false)}
          clinicId={selectedClinicId}
          month={currentMonth}
          doctors={doctors.filter(d => d.clinicId === selectedClinicId)}
          onSave={refreshNHIData}
      />
    </div>
  );
};
