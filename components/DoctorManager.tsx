
import React, { useState } from 'react';
import { Doctor, Clinic, DayOfWeek, ShiftType } from '../types';
import { UserPlus, Calendar, Trash2, Edit2, X, Loader2, DollarSign } from 'lucide-react';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';

interface Props {
  doctors: Doctor[];
  onSave: (docs: Doctor[]) => Promise<void>;
  clinics: Clinic[]; // Compatibility
}

const SHIFTS: ShiftType[] = ['Morning', 'Afternoon', 'Evening'];
const DAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const SHORT_DAYS = ['日', '一', '二', '三', '四', '五', '六'];
const DAY_ENUMS = [
    DayOfWeek.Sunday, DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, 
    DayOfWeek.Thursday, DayOfWeek.Friday, DayOfWeek.Saturday
];

const SHIFT_LABELS: Record<ShiftType, string> = {
    Morning: '早診',
    Afternoon: '午診',
    Evening: '晚診'
};

// --- Safe Type Helpers ---
const getDocName = (d: any) => (typeof d === 'string' ? d : d?.name || '');
const getDocId = (d: any) => (typeof d === 'string' ? d : d?.id || '');
const getDocColor = (d: any) => (typeof d === 'string' ? '#3b82f6' : (d?.avatarBgColor || d?.color || '#3b82f6'));
const getDocAvatarText = (d: any) => {
    const name = getDocName(d);
    return (typeof d !== 'string' && d?.avatarText) ? d.avatarText : name.substring(0, 1);
};

export const DoctorManager: React.FC<Props> = ({ doctors, onSave }) => {
  const { selectedClinicId, clinics } = useClinic();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formClinicId, setFormClinicId] = useState('');

  const [newDoc, setNewDoc] = useState<Partial<Doctor>>({
    name: '',
    color: '#3b82f6',
    avatarText: '',
    avatarBgColor: '#3b82f6',
    recurringShifts: [],
    commissionRates: { prostho: 0, implant: 0, ortho: 0, sov: 0, inv: 0, perio: 0, whitening: 0, otherSelfPay: 0, nhi: 0 }
  });

  const resetForm = () => {
      setNewDoc({ 
          name: '', 
          color: '#3b82f6', 
          avatarText: '', 
          avatarBgColor: '#3b82f6', 
          recurringShifts: [],
          commissionRates: { prostho: 0, implant: 0, ortho: 0, sov: 0, inv: 0, perio: 0, whitening: 0, otherSelfPay: 0, nhi: 0 }
      });
      setFormClinicId('');
      setEditingId(null);
      setIsAdding(false);
      setIsSaving(false);
  };

  const handleEdit = (doc: any) => {
      const isString = typeof doc === 'string';
      const name = getDocName(doc);
      const id = getDocId(doc);
      
      // Default / Safe values
      const color = isString ? '#3b82f6' : (doc.color || '#3b82f6');
      const avatarText = isString ? name.substring(0, 1) : (doc.avatarText || name.substring(0, 1));
      const avatarBgColor = isString ? '#3b82f6' : (doc.avatarBgColor || color);
      const recurringShifts = isString ? [] : (doc.recurringShifts || []);
      
      // Ensure whitening and inv are decoupled. If it exists in doc, use it. If not, default to 0.
      const commissionRates = (!isString && doc.commissionRates) ? 
          { 
              ...doc.commissionRates, 
              whitening: doc.commissionRates.whitening !== undefined ? doc.commissionRates.whitening : 0,
              inv: doc.commissionRates.inv !== undefined ? doc.commissionRates.inv : 0
          } : 
          { prostho: 0, implant: 0, ortho: 0, sov: 0, inv: 0, perio: 0, whitening: 0, otherSelfPay: 0, nhi: 0 };
          
      const clinicId = (!isString && doc.clinicId) ? doc.clinicId : (selectedClinicId || '');

      setNewDoc({
          name,
          color,
          avatarText,
          avatarBgColor,
          recurringShifts: [...recurringShifts],
          commissionRates
      });
      setFormClinicId(clinicId);
      setEditingId(id);
      setIsAdding(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddClick = () => {
      setFormClinicId(selectedClinicId);
      setIsAdding(true);
  };

  const handleToggleRecurring = (day: DayOfWeek, shift: ShiftType) => {
    const current = newDoc.recurringShifts || [];
    const exists = current.some(r => r.day === day && r.shift === shift);
    
    if (exists) {
      setNewDoc({
        ...newDoc,
        recurringShifts: current.filter(r => !(r.day === day && r.shift === shift))
      });
    } else {
      setNewDoc({
        ...newDoc,
        recurringShifts: [...current, { day, shift }]
      });
    }
  };
  
  const handleCommissionChange = (key: keyof Doctor['commissionRates'], val: string) => {
      setNewDoc(prev => ({
          ...prev,
          commissionRates: {
              ...prev.commissionRates!,
              [key]: Number(val) || 0
          }
      }));
  };

  const handleSaveDoctor = async () => {
    if (!newDoc.name || !formClinicId) return;
    
    setIsSaving(true);
    try {
        let updatedDoctors: Doctor[];
        
        // Ensure defaults
        const avatarText = newDoc.avatarText || newDoc.name.substring(0, 1);
        const avatarBgColor = newDoc.avatarBgColor || newDoc.color || '#3b82f6';
        const commissionRates = newDoc.commissionRates || { prostho: 0, implant: 0, ortho: 0, sov: 0, inv: 0, perio: 0, whitening: 0, otherSelfPay: 0, nhi: 0 };

        if (editingId) {
            // Update
            updatedDoctors = doctors.map((d: any) => {
                const currentId = getDocId(d);
                if (currentId === editingId) {
                    return {
                        id: currentId,
                        name: newDoc.name!,
                        clinicId: formClinicId, 
                        recurringShifts: newDoc.recurringShifts || [],
                        color: avatarBgColor, // Sync legacy color
                        avatarText,
                        avatarBgColor,
                        commissionRates,
                        isDeleted: d.isDeleted // Preserve flag if exists
                    } as Doctor;
                }
                // Return as is (handling if it was string, it remains string unless matched)
                return d; 
            });
        } else {
            // Create
            const doctor: Doctor = {
                id: crypto.randomUUID(),
                name: newDoc.name!,
                clinicId: formClinicId,
                recurringShifts: newDoc.recurringShifts || [],
                color: avatarBgColor,
                avatarText,
                avatarBgColor,
                commissionRates
            };
            updatedDoctors = [...doctors, doctor];
        }

        await onSave(updatedDoctors);
        resetForm();
    } catch (error) {
        alert("儲存失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const handleDeleteDoctor = async (id: string) => {
      if (!confirm("確定要刪除這位醫師嗎？此動作將隱藏資料而非永久刪除。")) return;
      
      setIsSaving(true);
      try {
          // Soft Delete: Map over array and set isDeleted flag
          const updatedDoctors = doctors.map((d: any) => {
              const currentId = getDocId(d);
              if (currentId === id) {
                  // Handle legacy string case by converting to object
                  if (typeof d === 'string') {
                      return {
                          id: d,
                          name: d,
                          clinicId: selectedClinicId,
                          isDeleted: true,
                          // Defaults for safety
                          color: '#3b82f6',
                          recurringShifts: [],
                          commissionRates: { prostho: 0, implant: 0, ortho: 0, sov: 0, inv: 0, perio: 0, whitening: 0, otherSelfPay: 0, nhi: 0 }
                      } as Doctor;
                  }
                  return { ...d, isDeleted: true };
              }
              return d;
          });
          await onSave(updatedDoctors);
      } catch (error) {
          alert("刪除失敗: " + (error as Error).message);
      } finally {
          setIsSaving(false);
      }
  };

  // Sync avatar text with name if empty
  const handleNameChange = (val: string) => {
      setNewDoc(prev => ({
          ...prev,
          name: val,
          avatarText: prev.avatarText ? prev.avatarText : val.substring(0, 1)
      }));
  };

  // Filter safely - Hide deleted
  const filteredDoctors = doctors.filter((d: any) => {
      // Exclude soft deleted
      if (typeof d !== 'string' && d.isDeleted) return false;

      if (typeof d === 'string') return true; // Legacy strings don't have clinicId, so show them everywhere.
      return d.clinicId === selectedClinicId;
  });

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
           <div>
               <h2 className="text-3xl font-bold text-slate-800">醫師管理</h2>
               <p className="text-slate-500">管理醫師名單、抽成設定及固定排班。</p>
           </div>
           
           {!isAdding && (
               <div className="flex items-center gap-2 w-full sm:w-auto">
                   <ClinicSelector className="border p-2 rounded-lg font-medium text-slate-700 bg-white shadow-sm flex-1 sm:flex-none" />
                   <button
                        onClick={handleAddClick}
                        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap shadow-md"
                    >
                        <UserPlus size={18} /> 新增醫師
                    </button>
               </div>
           )}
       </div>

       {isAdding && (
           <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 animate-fade-in">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
                    <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                        {editingId ? <Edit2 size={18}/> : <UserPlus size={18}/>}
                        {editingId ? '編輯醫師資料' : '新增醫師'}
                    </h3>
                    <button onClick={resetForm} disabled={isSaving} className="text-slate-400 hover:text-slate-600 transition-colors"><X /></button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">所屬診所</label>
                                <select
                                    className="w-full border rounded-lg px-3 py-2 bg-slate-50 text-slate-700 outline-none"
                                    value={formClinicId}
                                    onChange={e => setFormClinicId(e.target.value)}
                                    disabled={!!editingId}
                                >
                                    {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">醫師姓名</label>
                                <input
                                    type="text"
                                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                                    value={newDoc.name}
                                    onChange={e => handleNameChange(e.target.value)}
                                    placeholder="例如：李醫師"
                                />
                            </div>
                            
                            {/* Avatar Settings */}
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                <label className="block text-sm font-bold text-slate-700 mb-3">頭貼設定 (Avatar)</label>
                                <div className="flex items-start gap-4">
                                    <div className="flex flex-col items-center gap-2">
                                        <div 
                                            className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-md border-2 border-white"
                                            style={{ backgroundColor: newDoc.avatarBgColor || '#3b82f6' }}
                                        >
                                            {newDoc.avatarText || (newDoc.name ? newDoc.name.substring(0,1) : '?')}
                                        </div>
                                        <span className="text-xs text-slate-400">預覽</span>
                                    </div>
                                    <div className="flex-1 space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-500 mb-1">頭貼文字 (最多2字)</label>
                                            <input
                                                type="text"
                                                maxLength={2}
                                                className="w-full border rounded px-2 py-1.5 text-sm"
                                                value={newDoc.avatarText}
                                                onChange={e => setNewDoc({ ...newDoc, avatarText: e.target.value })}
                                                placeholder="例如: 安"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-500 mb-1">頭貼底色</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    className="w-8 h-8 rounded cursor-pointer border-0"
                                                    value={newDoc.avatarBgColor}
                                                    onChange={e => setNewDoc({ ...newDoc, avatarBgColor: e.target.value })}
                                                />
                                                <span className="text-xs text-slate-400 font-mono">{newDoc.avatarBgColor}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Commission Settings */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                                <DollarSign size={16}/> 抽成設定 (Commission Rates %)
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">假牙 (Prostho)</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        value={newDoc.commissionRates?.prostho}
                                        onChange={e => handleCommissionChange('prostho', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">植牙 (Implant)</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        value={newDoc.commissionRates?.implant}
                                        onChange={e => handleCommissionChange('implant', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">矯正 (Ortho)</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        value={newDoc.commissionRates?.ortho}
                                        onChange={e => handleCommissionChange('ortho', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">SOV</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        value={newDoc.commissionRates?.sov}
                                        onChange={e => handleCommissionChange('sov', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">隱適美 (INV)</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        value={newDoc.commissionRates?.inv}
                                        onChange={e => handleCommissionChange('inv', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">牙周 (Perio)</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        value={newDoc.commissionRates?.perio}
                                        onChange={e => handleCommissionChange('perio', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">美白 (Whitening)</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        value={newDoc.commissionRates?.whitening}
                                        onChange={e => handleCommissionChange('whitening', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">其他自費 (Other)</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        value={newDoc.commissionRates?.otherSelfPay}
                                        onChange={e => handleCommissionChange('otherSelfPay', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">健保 (NHI)</label>
                                    <input 
                                        type="number" min="0" max="100" step="1"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none font-bold text-blue-600"
                                        value={newDoc.commissionRates?.nhi}
                                        onChange={e => handleCommissionChange('nhi', e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                            <Calendar size={16}/> 固定排班時段 (Recurring Shifts)
                        </label>
                        <div className="border rounded-lg overflow-hidden text-sm bg-white">
                            <div className="grid grid-cols-4 bg-slate-50 border-b p-2 font-medium text-slate-500 text-center">
                                <div className="text-left pl-2">星期</div>
                                <div>早診</div>
                                <div>午診</div>
                                <div>晚診</div>
                            </div>
                            {DAYS.map((dayLabel, idx) => {
                                const dayEnum = DAY_ENUMS[idx];
                                return (
                                    <div key={dayLabel} className="grid grid-cols-4 items-center p-2 border-b last:border-0 hover:bg-slate-50 transition-colors">
                                        <div className="font-medium text-slate-700 pl-2">{dayLabel}</div>
                                        {SHIFTS.map(shift => {
                                            const isSelected = newDoc.recurringShifts?.some(r => r.day === dayEnum && r.shift === shift);
                                            return (
                                                <div key={shift} className="flex justify-center">
                                                    <button
                                                        onClick={() => handleToggleRecurring(dayEnum, shift)}
                                                        className={`
                                                            w-6 h-6 rounded-full border flex items-center justify-center transition-all
                                                            ${isSelected 
                                                                ? 'bg-teal-500 border-teal-500 text-white shadow-sm' 
                                                                : 'bg-white border-slate-200 text-transparent hover:border-teal-300'
                                                            }
                                                        `}
                                                    >
                                                        ✓
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                        onClick={resetForm}
                        disabled={isSaving}
                        className="px-6 py-2 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSaveDoctor}
                        disabled={!newDoc.name || isSaving}
                        className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 size={16} className="animate-spin" /> 儲存中...
                            </>
                        ) : (
                            editingId ? '更新資料' : '新增醫師'
                        )}
                    </button>
                </div>
           </div>
       )}

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           {filteredDoctors.map((doc: any) => {
               const id = getDocId(doc);
               const name = getDocName(doc);
               const color = getDocColor(doc);
               const avatarText = getDocAvatarText(doc);
               const commissionRates = typeof doc !== 'string' ? doc.commissionRates : null;
               const recurringShifts = typeof doc !== 'string' ? (doc.recurringShifts || []) : [];

               return (
                   <div key={id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 hover:shadow-md transition-shadow relative group">
                       <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                           <button 
                                onClick={() => handleEdit(doc)}
                                className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors"
                           >
                               <Edit2 size={16}/>
                           </button>
                           <button 
                                onClick={() => handleDeleteDoctor(id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                           >
                               <Trash2 size={16}/>
                           </button>
                       </div>
                       
                       <div className="flex items-center gap-3 mb-2">
                           <div 
                                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-sm border border-slate-100"
                                style={{ backgroundColor: color }}
                           >
                               {avatarText}
                           </div>
                           <div>
                               <h3 className="font-bold text-slate-800 text-lg">{name}</h3>
                               <p className="text-xs text-slate-500">
                                   每週 {recurringShifts.length} 診
                               </p>
                           </div>
                       </div>

                       {/* Quick Commission Preview */}
                       <div className="flex flex-wrap gap-1 mt-2 text-[10px] text-slate-500">
                           {commissionRates && (
                               <>
                                   <span className="bg-slate-100 px-1.5 py-0.5 rounded">植牙: {commissionRates.implant}%</span>
                                   <span className="bg-slate-100 px-1.5 py-0.5 rounded">矯正: {commissionRates.ortho}%</span>
                                   <span className="bg-slate-100 px-1.5 py-0.5 rounded">假牙: {commissionRates.prostho}%</span>
                                   {commissionRates.inv !== undefined && commissionRates.inv > 0 && (
                                       <span className="bg-slate-100 px-1.5 py-0.5 rounded">INV: {commissionRates.inv}%</span>
                                   )}
                                   {commissionRates.whitening !== undefined && commissionRates.whitening > 0 && (
                                       <span className="bg-slate-100 px-1.5 py-0.5 rounded">美白: {commissionRates.whitening}%</span>
                                   )}
                                   {commissionRates.nhi !== undefined && (
                                       <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">健保: {commissionRates.nhi}%</span>
                                   )}
                               </>
                           )}
                           {typeof doc === 'string' && <span className="bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded border border-amber-100">舊資料 (String)</span>}
                       </div>

                       {/* Visual Weekly Schedule Grid */}
                       <div className="mt-3 pl-[60px]">
                           <div className="grid grid-cols-7 gap-1">
                                {SHORT_DAYS.map((day, dayIdx) => (
                                    <div key={dayIdx} className="flex flex-col gap-1 items-center">
                                         <div className="text-[10px] text-slate-400 font-medium">{day}</div>
                                         {SHIFTS.map(shift => {
                                             const dayEnum = DAY_ENUMS[dayIdx];
                                             const isActive = recurringShifts.some((r: any) => r.day === dayEnum && r.shift === shift);
                                             
                                             return (
                                                 <div 
                                                     key={shift}
                                                     className={`w-full h-2 rounded-sm transition-colors ${isActive ? '' : 'bg-slate-100'}`}
                                                     style={{ backgroundColor: isActive ? color : undefined }}
                                                     title={isActive ? `${DAYS[dayIdx]} ${SHIFT_LABELS[shift]}` : undefined}
                                                 />
                                             );
                                         })}
                                    </div>
                                ))}
                           </div>
                       </div>
                   </div>
               );
           })}
           
           {filteredDoctors.length === 0 && !isAdding && (
               <div className="col-span-full py-12 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                   此診所尚未建立醫師資料
               </div>
           )}
       </div>
    </div>
  );
};
