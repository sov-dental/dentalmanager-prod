
import React, { useState, useEffect, useMemo } from 'react';
import { Clinic, Consultant, Doctor, Laboratory, AccountingRow, DailyAccountingRecord } from '../types';
import { loadDailyAccounting, saveDailyAccounting, hydrateRow, sanitizeRow, getStaffList } from '../services/firebase';
import { Calendar as CalendarIcon, X, Loader2, AlertCircle, Stethoscope, DollarSign, Calculator, Plus, Trash2, ShoppingBag, Banknote, CreditCard, Landmark, CheckCircle, Save, ToggleLeft, ToggleRight } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  event: any | null; // Made nullable for POS mode
  clinicId: string;
  consultants: Consultant[]; // Deprecated, but kept for interface compatibility
  doctors: Doctor[];
  laboratories: Laboratory[];
  // POS Mode Props
  initialRow?: AccountingRow;
  onSaveRow?: (row: AccountingRow) => void;
}

// 1. Data Structure Alignment
const TREATMENT_CATEGORIES = [
    { key: 'prostho', label: '假牙 (Prostho)' },
    { key: 'implant', label: '植牙 (Implant)' },
    { key: 'ortho', label: '矯正 (Ortho)' },
    { key: 'sov', label: 'SOV (舒服美)' },
    { key: 'inv', label: '隱適美 (INV)' },
    { key: 'whitening', label: '美白 (Whitening)' },
    { key: 'perio', label: '牙周 (Perio)' },
    { key: 'otherSelfPay', label: '其他 (Other)' }
];

const RETAIL_CATEGORIES = [
    { key: 'products', label: '物販 (Retail)' },
    { key: 'diyWhitening', label: '小金庫 (Vault/DIY)' }
];

interface SelfPayRow {
    id: string;
    category: string;
    itemName: string;
    consultant: string;
    amount: number;
}

interface RetailRow {
    id: string;
    category: 'products' | 'diyWhitening';
    itemName: string;
    staff: string;
    amount: number;
}

export const AppointmentDetailModal: React.FC<Props> = ({ 
    isOpen, 
    onClose, 
    event, 
    clinicId, 
    consultants = [], 
    doctors = [], 
    laboratories = [],
    initialRow,
    onSaveRow
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'found' | 'not_found' | 'error'>('idle');
  const [dailyRecord, setDailyRecord] = useState<DailyAccountingRecord | null>(null);
  const [currentRow, setCurrentRow] = useState<AccountingRow | null>(null);

  // --- Form State ---
  // Clinical & Basic
  const [patientName, setPatientName] = useState('');
  const [npStatus, setNpStatus] = useState('');
  const [doctorId, setDoctorId] = useState(''); // New State for Doctor Editing
  const [technician, setTechnician] = useState('');
  const [treatmentContent, setTreatmentContent] = useState('');
  const [isArrived, setIsArrived] = useState(false); // New: Arrival Status
  
  // Fees
  const [regFee, setRegFee] = useState(150);
  const [copayment, setCopayment] = useState(50);

  // Dynamic Rows
  const [selfPayRows, setSelfPayRows] = useState<SelfPayRow[]>([]);
  const [retailRows, setRetailRows] = useState<RetailRow[]>([]);

  // Payment Logic (Refactored)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);

  // --- NEW: Staff Data Fetching & Filtering ---
  const [fullStaffList, setFullStaffList] = useState<Consultant[]>([]);

  useEffect(() => {
      const fetchStaff = async () => {
          if (clinicId && isOpen) {
              try {
                  // Source of Truth: Fetch from staff_profiles
                  const list = await getStaffList(clinicId);
                  setFullStaffList(list);
              } catch (error) {
                  console.error("Error fetching staff list:", error);
              }
          }
      };
      fetchStaff();
  }, [clinicId, isOpen]);

  // Logic A: Consultant Options (consultant OR trainee)
  const consultantOptions = useMemo(() => {
      return fullStaffList.filter(c => c.role === 'consultant' || c.role === 'trainee');
  }, [fullStaffList]);

  // Logic B: Staff Options (Full-Time: consultant, trainee, assistant)
  const staffOptions = useMemo(() => {
      return fullStaffList.filter(c => 
          c.role === 'consultant' || 
          c.role === 'trainee' || 
          c.role === 'assistant'
      );
  }, [fullStaffList]);

  const activeLabs = useMemo(() => (laboratories || []).filter(l => l.clinicId === clinicId), [laboratories, clinicId]);
  const activeDoctors = useMemo(() => (doctors || []).filter(d => d.clinicId === clinicId), [doctors, clinicId]);

  useEffect(() => {
    if (isOpen) {
      if (initialRow) {
          loadFromRow(initialRow);
      } else if (event && clinicId) {
          fetchData();
      }
    } else {
      resetState();
    }
  }, [isOpen, event, initialRow]);

  // Recalculate Payment Amount whenever total required changes, IF it was 0 or unedited
  const totalSelfPay = useMemo(() => selfPayRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [selfPayRows]);
  const totalRetail = useMemo(() => retailRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [retailRows]);
  const totalRequired = (Number(regFee)||0) + (Number(copayment)||0) + totalSelfPay + totalRetail;

  // Auto-update Payment Amount to Total Required
  useEffect(() => {
      setPaymentAmount(totalRequired);
  }, [totalRequired]);

  // Auto-set Arrived if money entered
  useEffect(() => {
      if (totalRequired > 0 && !isArrived) {
          setIsArrived(true);
      }
  }, [totalRequired]);

  const resetState = () => {
    setStatus('idle');
    setDailyRecord(null);
    setCurrentRow(null);
    setPatientName('');
    setNpStatus('');
    setDoctorId('');
    setTechnician('');
    setTreatmentContent('');
    setIsArrived(false);
    setRegFee(150);
    setCopayment(50);
    setSelfPayRows([]);
    setRetailRows([]);
    setPaymentMethod('cash');
    setPaymentAmount(0);
  };

  const getISODate = (date: Date) => {
    if (!date) return new Date().toISOString().split('T')[0];
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const loadFromRow = (row: AccountingRow) => {
      setStatus('found');
      setCurrentRow(row);
      setPatientName(row.patientName || '');
      setNpStatus(row.npStatus || '');
      setDoctorId(row.doctorId || '');
      setTechnician(row.technician || '');
      setTreatmentContent(row.treatmentContent || '');
      // Init isArrived: default to true if manual row, otherwise respect row val or default false
      setIsArrived(row.isArrived ?? (row.isManual ? true : false));
      setRegFee(row.treatments.regFee);
      setCopayment(row.treatments.copayment);
      hydrateFormRows(row);
  };

  const hydrateFormRows = (match: AccountingRow) => {
      // --- Hydrate Self-Pay Rows ---
      const loadedSelfPayRows: SelfPayRow[] = [];
      TREATMENT_CATEGORIES.forEach(cat => {
          const amt = (match!.treatments as any)[cat.key] || 0;
          if (amt > 0) {
              loadedSelfPayRows.push({
                  id: crypto.randomUUID(),
                  category: cat.key,
                  itemName: loadedSelfPayRows.length === 0 ? (match!.selfPayItem || '') : '',
                  consultant: match!.treatments.consultant || '',
                  amount: amt
              });
          }
      });
      // Fallback
      if (loadedSelfPayRows.length === 0 && match.treatments.otherSelfPay > 0) {
           loadedSelfPayRows.push({
              id: crypto.randomUUID(),
              category: 'otherSelfPay',
              itemName: match.selfPayItem || '',
              consultant: match.treatments.consultant || '',
              amount: match.treatments.otherSelfPay
           });
      }
      setSelfPayRows(loadedSelfPayRows);

      // --- Hydrate Retail Rows ---
      const loadedRetailRows: RetailRow[] = [];
      if ((match.retail.products || 0) > 0) {
          loadedRetailRows.push({
              id: crypto.randomUUID(),
              category: 'products',
              itemName: match.retailItem || match.retail.productNote || '', 
              staff: match.retail.staff || '',
              amount: match.retail.products
          });
      }
      if ((match.retail.diyWhitening || 0) > 0) {
          loadedRetailRows.push({
              id: crypto.randomUUID(),
              category: 'diyWhitening',
              itemName: loadedRetailRows.length === 0 ? (match.retailItem || match.retail.productNote || '') : '', 
              staff: match.retail.staff || '', 
              amount: match.retail.diyWhitening
          });
      }
      setRetailRows(loadedRetailRows);

      // --- Payment Breakdown ---
      const breakdown = match.paymentBreakdown || { cash: 0, card: 0, transfer: 0 };
      
      if (breakdown.card > 0) {
          setPaymentMethod('card');
          setPaymentAmount(breakdown.card); 
      } else if (breakdown.transfer > 0) {
          setPaymentMethod('transfer');
          setPaymentAmount(breakdown.transfer);
      } else if (breakdown.cash > 0) {
          setPaymentMethod('cash');
          setPaymentAmount(breakdown.cash);
      } else if (match.actualCollected > 0) {
          setPaymentMethod((match.paymentMethod as any) || 'cash');
          setPaymentAmount(match.actualCollected);
      } else {
          setPaymentMethod('cash');
          setPaymentAmount(0);
      }
  };

  const fetchData = async () => {
    if (!event || !event.start) return;
    setLoading(true);
    setStatus('loading');
    
    try {
      const dateStr = getISODate(event.start);
      const record = await loadDailyAccounting(clinicId, dateStr);
      
      if (!record) {
        setStatus('not_found');
        setLoading(false);
        // New Record: Default false
        setIsArrived(false);
        return;
      }

      const hydratedRows = record.rows.map(hydrateRow);
      setDailyRecord({ ...record, rows: hydratedRows });

      // Match Logic
      let match = hydratedRows.find(r => r.id === event.id);
      if (!match && event.title) {
        const titleParts = event.title.split(/[- ]/);
        match = hydratedRows.find(r => 
            titleParts.some((part: string) => part.length > 1 && r.patientName.includes(part))
        );
      }

      if (match) {
        setCurrentRow(match);
        setPatientName(match.patientName || '');
        setNpStatus(match.npStatus || '');
        setDoctorId(match.doctorId || '');
        setTechnician(match.technician || '');
        setTreatmentContent(match.treatmentContent || '');
        // Match found: respect saved value or default false
        setIsArrived(match.isArrived ?? false);
        setRegFee(match.treatments.regFee);
        setCopayment(match.treatments.copayment);
        hydrateFormRows(match);
        setStatus('found');
      } else {
        setStatus('not_found');
        setIsArrived(false); // New from calendar
      }

    } catch (e) {
      console.error(e);
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const addSelfPayRow = () => {
      setSelfPayRows([...selfPayRows, {
          id: crypto.randomUUID(),
          category: 'otherSelfPay',
          itemName: '',
          consultant: '',
          amount: 0
      }]);
  };

  const removeSelfPayRow = (id: string) => {
      setSelfPayRows(selfPayRows.filter(r => r.id !== id));
  };

  const updateSelfPayRow = (id: string, field: keyof SelfPayRow, value: any) => {
      setSelfPayRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const addRetailRow = () => {
      setRetailRows([...retailRows, {
          id: crypto.randomUUID(),
          category: 'products',
          itemName: '',
          staff: '',
          amount: 0
      }]);
  };

  const removeRetailRow = (id: string) => {
      setRetailRows(retailRows.filter(r => r.id !== id));
  };

  const updateRetailRow = (id: string, field: keyof RetailRow, value: any) => {
      setRetailRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleSave = async () => {
    if (!currentRow) return;
    
    setSaving(true);
    try {
      // 1. Construct Flat Treatments Object
      const newTreatments: any = {
          ...currentRow.treatments,
          regFee: Number(regFee),
          copayment: Number(copayment),
          prostho: 0, implant: 0, ortho: 0, sov: 0, inv: 0, whitening: 0, perio: 0, otherSelfPay: 0,
          consultant: ''
      };

      let primaryConsultant = '';
      let maxAmount = -1;
      const selfPayItemNames: string[] = [];

      selfPayRows.forEach(row => {
          if (row.amount > 0) {
              const currentVal = newTreatments[row.category] || 0;
              newTreatments[row.category] = currentVal + Number(row.amount);
              
              if (row.consultant && row.amount > maxAmount) {
                  maxAmount = row.amount;
                  primaryConsultant = row.consultant;
              }
              if (row.itemName) selfPayItemNames.push(row.itemName);
          }
      });
      newTreatments.consultant = primaryConsultant;

      let primaryStaff = '';
      maxAmount = -1;
      const retailItemNames: string[] = [];
      let productsTotal = 0;
      let diyWhiteningTotal = 0;

      retailRows.forEach(row => {
          if (row.amount > 0) {
              if (row.category === 'products') productsTotal += Number(row.amount);
              if (row.category === 'diyWhitening') diyWhiteningTotal += Number(row.amount);

              if (row.staff && row.amount > maxAmount) {
                  maxAmount = row.amount;
                  primaryStaff = row.staff;
              }
              if (row.itemName) retailItemNames.push(row.itemName);
          }
      });

      // 2. Construct Payment Breakdown based on Single Input
      const finalPayment = {
          cash: paymentMethod === 'cash' ? paymentAmount : 0,
          card: paymentMethod === 'card' ? paymentAmount : 0,
          transfer: paymentMethod === 'transfer' ? paymentAmount : 0,
      };

      // 3. Resolve Doctor Name
      const selectedDoc = doctors.find(d => d.id === doctorId);
      const finalDocName = selectedDoc ? selectedDoc.name : (currentRow.doctorName || '未指定');

      const updatedRow: AccountingRow = {
        ...currentRow,
        patientName: patientName,
        doctorId: doctorId,
        doctorName: finalDocName,
        npStatus: npStatus, // Use as is, no '$' logic
        technician,
        treatmentContent,
        treatments: newTreatments,
        selfPayItem: selfPayItemNames.join(', '),
        retail: {
          ...currentRow.retail,
          products: productsTotal,
          diyWhitening: diyWhiteningTotal,
          productNote: retailItemNames.join(', '),
          staff: primaryStaff,
        },
        retailItem: retailItemNames.join(', '),
        paymentBreakdown: finalPayment,
        actualCollected: paymentAmount,
        paymentMethod,
        isPaymentManual: true,
        isArrived: isArrived // Save Arrival Status
      };

      // --- DELEGATION CHECK ---
      if (onSaveRow) {
          onSaveRow(updatedRow);
          setSaving(false);
          return;
      }

      // --- INTERNAL SAVE (Legacy Mode) ---
      if (dailyRecord) {
          const updatedRows = dailyRecord.rows.map(r => r.id === currentRow.id ? updatedRow : r);
          await saveDailyAccounting({
            ...dailyRecord,
            rows: updatedRows.map(sanitizeRow)
          });
          alert('儲存成功！');
          onClose();
      } else {
          alert("無法儲存：找不到日報表紀錄");
      }
      
    } catch (e) {
      alert('儲存失敗');
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;
  
  const displayTitle = initialRow ? `POS: ${patientName || 'New Patient'}` : event?.title;
  const displaySub = initialRow 
    ? `${initialRow.startTime?.split('T')[0]} • ${initialRow.doctorName || '未指定'}`
    : `${event?.start?.toLocaleDateString()} • ...`;

  // Determine if Doctor field is editable
  const isManualRow = currentRow?.isManual;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh] animate-slide-down">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-4 flex justify-between items-start shrink-0">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-2">
              <CalendarIcon size={20} className="text-teal-400"/> 
              診療與帳務詳情 (POS)
            </h3>
            <div className="text-sm text-slate-400 mt-1 flex flex-col gap-0.5">
               <span>{displayTitle}</span>
               <span className="text-xs opacity-70">{displaySub}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Loader2 size={40} className="animate-spin mb-4" />
              <p>正在讀取日報表資料...</p>
            </div>
          ) : status === 'not_found' || status === 'error' ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4 text-slate-400">
                <AlertCircle size={32} />
              </div>
              <h4 className="text-lg font-bold text-slate-700">找不到對應資料</h4>
              <p className="text-slate-500 text-sm mt-2 max-w-xs">
                本日尚未建立日報表，或系統無法在報表中找到此病患的紀錄。
              </p>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row min-h-full">
              
              {/* LEFT COLUMN: Clinical & Fees */}
              <div className="w-full lg:w-1/3 p-6 space-y-6 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white">
                  
                  {/* Block A: Clinical Info */}
                  <section>
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                          <Stethoscope size={14} /> 基本診療資訊
                      </h4>
                      <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                              <div>
                                  <label className="block text-xs text-slate-400 mb-1">病患姓名</label>
                                  <input 
                                      className="w-full border rounded px-2 py-1.5 text-lg font-bold text-slate-800 focus:ring-2 focus:ring-teal-500 outline-none"
                                      value={patientName}
                                      onChange={e => setPatientName(e.target.value)}
                                      placeholder="輸入病患姓名"
                                  />
                              </div>
                              <div>
                                  <label className="block text-xs text-slate-400 mb-1">狀態 (Status)</label>
                                  <input 
                                      className="w-full border rounded px-2 py-1.5 text-sm font-medium focus:ring-2 focus:ring-teal-500 outline-none"
                                      value={npStatus}
                                      onChange={e => setNpStatus(e.target.value)}
                                      placeholder="V, @, NP..."
                                  />
                              </div>
                          </div>
                          
                          {/* Arrived Toggle */}
                          <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-200">
                              <span className="text-sm font-bold text-slate-600">已到診 (Arrived)</span>
                              <button 
                                  onClick={() => setIsArrived(!isArrived)}
                                  className={`flex items-center gap-2 px-3 py-1 rounded-full transition-colors ${isArrived ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}
                              >
                                  {isArrived ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                                  <span className="text-xs font-bold">{isArrived ? 'YES' : 'NO'}</span>
                              </button>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                              {/* Doctor Selection Logic */}
                              <div>
                                  <label className="block text-xs text-slate-400 mb-1">主治醫師 (Doctor)</label>
                                  {isManualRow ? (
                                      <select 
                                          className="w-full border rounded px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-teal-500 outline-none font-bold text-slate-700"
                                          value={doctorId}
                                          onChange={e => setDoctorId(e.target.value)}
                                      >
                                          <option value="">請選擇醫師</option>
                                          {activeDoctors.map(doc => (
                                              <option key={doc.id} value={doc.id}>{doc.name}</option>
                                          ))}
                                      </select>
                                  ) : (
                                      <input 
                                          className="w-full border rounded px-2 py-1.5 text-sm bg-slate-50 text-slate-500 font-bold"
                                          value={currentRow?.doctorName}
                                          disabled
                                      />
                                  )}
                              </div>
                              <div>
                                  <label className="block text-xs text-slate-400 mb-1">技工所 (Lab)</label>
                                  <select 
                                      className="w-full border rounded px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-teal-500 outline-none"
                                      value={technician}
                                      onChange={e => setTechnician(e.target.value)}
                                  >
                                      <option value="">無</option>
                                      {activeLabs.map(lab => (
                                          <option key={lab.id} value={lab.name}>{lab.name}</option>
                                      ))}
                                  </select>
                              </div>
                          </div>

                          <div>
                              <label className="block text-xs text-slate-400 mb-1">療程內容 / 備註</label>
                              <textarea 
                                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500 outline-none h-20"
                                  value={treatmentContent}
                                  onChange={e => setTreatmentContent(e.target.value)}
                                  placeholder="填寫療程細節..."
                              />
                          </div>
                      </div>
                  </section>

                  {/* Block B: Basic Fees */}
                  <section className="pt-6 border-t border-slate-100">
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                          <DollarSign size={14} /> 基本費用 (NHI)
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs text-slate-400 mb-1">掛號費</label>
                              <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                                  <input 
                                      type="number" 
                                      className="w-full pl-6 border rounded px-2 py-1.5 text-sm font-bold text-slate-700"
                                      value={regFee}
                                      onChange={e => setRegFee(Number(e.target.value))}
                                  />
                              </div>
                          </div>
                          <div>
                              <label className="block text-xs text-slate-400 mb-1">部分負擔</label>
                              <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                                  <input 
                                      type="number" 
                                      className="w-full pl-6 border rounded px-2 py-1.5 text-sm font-bold text-slate-700"
                                      value={copayment}
                                      onChange={e => setCopayment(Number(e.target.value))}
                                  />
                              </div>
                          </div>
                      </div>
                  </section>
              </div>

              {/* CENTER COLUMN: Self-Pay Items */}
              <div className="w-full lg:w-1/3 p-6 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/50">
                  <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                          <Calculator size={14} /> 自費療程 (Treatments)
                      </h4>
                      <button 
                          onClick={addSelfPayRow}
                          className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 transition-colors flex items-center gap-1 font-bold"
                      >
                          <Plus size={12} /> 新增項目
                      </button>
                  </div>
                  
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {selfPayRows.map((row) => (
                          <div key={row.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm relative group">
                              <div className="grid grid-cols-2 gap-2 mb-2">
                                  <select 
                                      className="text-xs border rounded p-1 font-bold text-slate-700"
                                      value={row.category}
                                      onChange={e => updateSelfPayRow(row.id, 'category', e.target.value)}
                                  >
                                      {TREATMENT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                                  </select>
                                  <div className="relative">
                                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                                      <input 
                                          type="number"
                                          className="w-full pl-5 border rounded p-1 text-sm font-bold text-indigo-600 text-right"
                                          value={row.amount}
                                          onChange={e => updateSelfPayRow(row.id, 'amount', Number(e.target.value))}
                                          placeholder="0"
                                      />
                                  </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                  <input 
                                      type="text"
                                      className="text-xs border rounded p-1"
                                      value={row.itemName}
                                      onChange={e => updateSelfPayRow(row.id, 'itemName', e.target.value)}
                                      placeholder="項目說明 (選填)"
                                  />
                                  <select 
                                      className="text-xs border rounded p-1 text-slate-600"
                                      value={row.consultant}
                                      onChange={e => updateSelfPayRow(row.id, 'consultant', e.target.value)}
                                  >
                                      <option value="">選擇諮詢師</option>
                                      {consultantOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                              </div>
                              <button 
                                  onClick={() => removeSelfPayRow(row.id)}
                                  className="absolute -top-2 -right-2 bg-white text-slate-300 hover:text-rose-500 rounded-full p-1 shadow-sm border opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                  <Trash2 size={12} />
                              </button>
                          </div>
                      ))}
                      {selfPayRows.length === 0 && (
                          <div className="text-center py-8 text-slate-400 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
                              無自費項目
                          </div>
                      )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between items-center">
                      <span className="text-sm font-bold text-slate-600">自費小計</span>
                      <span className="text-lg font-bold text-indigo-600">${totalSelfPay.toLocaleString()}</span>
                  </div>
              </div>

              {/* RIGHT COLUMN: Retail & Total */}
              <div className="w-full lg:w-1/3 p-6 flex flex-col bg-slate-50">
                  {/* Retail Section */}
                  <div className="flex-1 mb-6">
                      <div className="flex justify-between items-center mb-3">
                          <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                              <ShoppingBag size={14} /> 物販與小金庫 (Retail)
                          </h4>
                          <button 
                              onClick={addRetailRow}
                              className="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded hover:bg-emerald-100 transition-colors flex items-center gap-1 font-bold"
                          >
                              <Plus size={12} /> 新增
                          </button>
                      </div>
                      
                      <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                          {retailRows.map((row) => (
                              <div key={row.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm relative group">
                                  <div className="grid grid-cols-2 gap-2 mb-2">
                                      <select 
                                          className="text-xs border rounded p-1 font-bold text-slate-700"
                                          value={row.category}
                                          onChange={e => updateRetailRow(row.id, 'category', e.target.value as any)}
                                      >
                                          {RETAIL_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                                      </select>
                                      <div className="relative">
                                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                                          <input 
                                              type="number"
                                              className="w-full pl-5 border rounded p-1 text-sm font-bold text-emerald-600 text-right"
                                              value={row.amount}
                                              onChange={e => updateRetailRow(row.id, 'amount', Number(e.target.value))}
                                              placeholder="0"
                                          />
                                      </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                      <input 
                                          type="text"
                                          className="text-xs border rounded p-1"
                                          value={row.itemName}
                                          onChange={e => updateRetailRow(row.id, 'itemName', e.target.value)}
                                          placeholder="品項 (選填)"
                                      />
                                      <select 
                                          className="text-xs border rounded p-1 text-slate-600"
                                          value={row.staff}
                                          onChange={e => updateRetailRow(row.id, 'staff', e.target.value)}
                                      >
                                          <option value="">經手人</option>
                                          {staffOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                      </select>
                                  </div>
                                  <button 
                                      onClick={() => removeRetailRow(row.id)}
                                      className="absolute -top-2 -right-2 bg-white text-slate-300 hover:text-rose-500 rounded-full p-1 shadow-sm border opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                      <Trash2 size={12} />
                                  </button>
                              </div>
                          ))}
                          {retailRows.length === 0 && (
                              <div className="text-center py-4 text-slate-400 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
                                  無物販項目
                              </div>
                          )}
                      </div>
                  </div>

                  {/* Total & Save */}
                  <div className="bg-slate-900 rounded-xl p-5 text-white shadow-lg mt-auto">
                      <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-700">
                          <span className="text-sm font-medium text-slate-400">應收總額</span>
                          <span className="text-3xl font-black">${totalRequired.toLocaleString()}</span>
                      </div>
                      
                      <div className="space-y-3 mb-6">
                          <div>
                              <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">支付方式</label>
                              <div className="grid grid-cols-3 gap-2 bg-slate-800 p-1 rounded-lg">
                                  <button 
                                      onClick={() => setPaymentMethod('cash')}
                                      className={`py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1 transition-all ${paymentMethod === 'cash' ? 'bg-emerald-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                  >
                                      <Banknote size={14} /> 現金
                                  </button>
                                  <button 
                                      onClick={() => setPaymentMethod('card')}
                                      className={`py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1 transition-all ${paymentMethod === 'card' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                  >
                                      <CreditCard size={14} /> 刷卡
                                  </button>
                                  <button 
                                      onClick={() => setPaymentMethod('transfer')}
                                      className={`py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1 transition-all ${paymentMethod === 'transfer' ? 'bg-amber-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                  >
                                      <Landmark size={14} /> 匯款
                                  </button>
                              </div>
                          </div>
                          
                          <div>
                              <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">實收金額</label>
                              <input 
                                  type="number"
                                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-right font-mono font-bold text-xl focus:ring-2 focus:ring-teal-500 outline-none text-white"
                                  value={paymentAmount}
                                  onChange={e => setPaymentAmount(Number(e.target.value))}
                              />
                          </div>
                      </div>

                      <button 
                          onClick={handleSave}
                          disabled={saving || !currentRow}
                          className="w-full bg-teal-500 hover:bg-teal-400 text-slate-900 py-3 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-teal-900/50"
                      >
                          {saving ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                          儲存結帳
                      </button>
                  </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
};
