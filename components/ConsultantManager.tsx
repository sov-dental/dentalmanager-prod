import React, { useState, useEffect } from 'react';
import { Consultant, Clinic, ConsultantRole, InsuranceGrade } from '../types';
import { Briefcase, UserPlus, Trash2, Edit2, X, Loader2, UserCog, UserCheck, Clock, GraduationCap, Calendar, DollarSign, Heart, Sun, Settings, Plus, Palette } from 'lucide-react';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';
import { getStaffList, saveStaff, deleteStaff, getInsuranceTable, saveInsuranceTable } from '../services/firebase';

interface Props {
  consultants: Consultant[]; // Deprecated, keeping for type sig but will ignore
  clinics: Clinic[]; // Compatibility
  onSave: (consultants: Consultant[]) => Promise<void>; // Deprecated
}

const ROLE_LABELS: Record<ConsultantRole, string> = {
    consultant: '諮詢師',
    assistant: '助理',
    part_time: '打工',
    trainee: '培訓諮詢師'
};

const ROLE_ICONS: Record<ConsultantRole, React.ReactNode> = {
    consultant: <UserCog size={14} />,
    assistant: <UserCheck size={14} />,
    part_time: <Clock size={14} />,
    trainee: <GraduationCap size={14} />
};

const ROLE_COLORS: Record<ConsultantRole, string> = {
    consultant: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    assistant: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    part_time: 'bg-amber-100 text-amber-700 border-amber-200',
    trainee: 'bg-slate-100 text-slate-700 border-slate-200'
};

const PRESET_COLORS = ['#3b82f6', '#10b981', '#ec4899', '#f59e0b', '#8b5cf6', '#94a3b8'];

export const ConsultantManager: React.FC<Props> = ({ clinics }) => {
  const { selectedClinicId } = useClinic();
  
  // Local State for Staff List
  const [staffList, setStaffList] = useState<Consultant[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Insurance State
  const [insuranceTable, setInsuranceTable] = useState<InsuranceGrade[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Consolidated Form State
  const [formData, setFormData] = useState({
      name: '',
      role: 'consultant' as ConsultantRole,
      clinicId: '',
      avatarText: '',
      avatarColor: '#94a3b8',
      onboardDate: '',
      resignationDate: '',
      baseSalary: 0,
      hourlyRate: 0,
      allowance: 0,
      insuredSalary: 0,
      dependents: 0,
      annualLeave: 0,
      insuranceGradeLevel: 0,
      monthlyInsuranceCost: 0
  });

  // Fetch staff when clinic changes
  useEffect(() => {
      if (selectedClinicId) {
          fetchStaff();
      } else {
          setStaffList([]);
      }
  }, [selectedClinicId]);

  // Fetch Insurance Table on Mount
  useEffect(() => {
      getInsuranceTable().then(setInsuranceTable).catch(console.error);
  }, []);

  const fetchStaff = async () => {
      if (!selectedClinicId) return;
      setIsLoading(true);
      try {
          const list = await getStaffList(selectedClinicId);
          setStaffList(list);
      } catch (e) {
          console.error("Failed to load staff", e);
      } finally {
          setIsLoading(false);
      }
  };

  const resetForm = () => {
    setFormData({
        name: '',
        role: 'consultant',
        clinicId: selectedClinicId, // Default to current clinic
        avatarText: '',
        avatarColor: '#94a3b8',
        onboardDate: '',
        resignationDate: '',
        baseSalary: 0,
        hourlyRate: 0,
        allowance: 0,
        insuredSalary: 0,
        dependents: 0,
        annualLeave: 0,
        insuranceGradeLevel: 0,
        monthlyInsuranceCost: 0
    });
    setEditingId(null);
    setIsAdding(false);
    setIsSaving(false);
  };

  const handleEdit = (consultant: Consultant) => {
    setFormData({
        name: consultant.name,
        role: consultant.role || 'consultant',
        clinicId: consultant.clinicId,
        avatarText: consultant.avatarText || '',
        avatarColor: consultant.avatarColor || '#94a3b8',
        onboardDate: consultant.onboardDate || '',
        resignationDate: consultant.resignationDate || '',
        baseSalary: consultant.baseSalary || 0,
        hourlyRate: consultant.hourlyRate || 0,
        allowance: consultant.allowance || 0,
        insuredSalary: consultant.insuredSalary || 0,
        dependents: consultant.dependents || 0,
        annualLeave: consultant.annualLeave || 0,
        insuranceGradeLevel: consultant.insuranceGradeLevel || 0,
        monthlyInsuranceCost: consultant.monthlyInsuranceCost || 0
    });
    setEditingId(consultant.id);
    setIsAdding(true);
  };

  const handleAddClick = () => {
      resetForm(); // Ensure clean state
      setFormData(prev => ({ ...prev, clinicId: selectedClinicId }));
      setIsAdding(true);
  };

  // Auto-Calculate Insurance Cost when Grade or Dependents change
  useEffect(() => {
      const grade = insuranceTable.find(g => g.level === formData.insuranceGradeLevel);
      if (grade) {
          const labor = grade.laborFee;
          const dependents = Number(formData.dependents || 0);
          const health = grade.healthFee * (1 + dependents);
          const total = labor + health;
          
          setFormData(prev => ({
              ...prev,
              insuredSalary: grade.salary, // Sync insuredSalary with grade
              monthlyInsuranceCost: total
          }));
      }
  }, [formData.insuranceGradeLevel, formData.dependents, insuranceTable]);

  const handleSave = async () => {
    if (!formData.name || !formData.clinicId) {
        alert("請輸入姓名並選擇診所");
        return;
    }

    setIsSaving(true);
    try {
        const staffData: Consultant = {
            id: editingId || crypto.randomUUID(),
            name: formData.name,
            clinicId: formData.clinicId,
            role: formData.role,
            avatarText: formData.avatarText || formData.name.substring(0, 1),
            avatarColor: formData.avatarColor,
            isActive: true,
            // HR Fields
            onboardDate: formData.onboardDate,
            resignationDate: formData.resignationDate,
            baseSalary: Number(formData.baseSalary) || 0,
            hourlyRate: Number(formData.hourlyRate) || 0,
            allowance: Number(formData.allowance) || 0,
            insuredSalary: Number(formData.insuredSalary) || 0,
            dependents: Number(formData.dependents) || 0,
            annualLeave: Number(formData.annualLeave) || 0,
            insuranceGradeLevel: Number(formData.insuranceGradeLevel) || 0,
            monthlyInsuranceCost: Number(formData.monthlyInsuranceCost) || 0
        };

        // Write to new collection
        await saveStaff(staffData);
        
        // Refresh local list
        await fetchStaff();
        resetForm();
    } catch (error) {
        alert("儲存失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("確定要刪除這位人員嗎？此動作將從新資料庫中移除。")) return;

    setIsSaving(true);
    try {
        await deleteStaff(id);
        await fetchStaff();
    } catch (error) {
        alert("刪除失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const updateField = (field: string, value: any) => {
      setFormData(prev => ({ ...prev, [field]: value }));
  };

  // --- SETTINGS MODAL COMPONENT ---
  const SettingsModal = () => {
      const [grades, setGrades] = useState<InsuranceGrade[]>([...insuranceTable].sort((a,b) => a.level - b.level));
      const [isSavingTable, setIsSavingTable] = useState(false);

      const addRow = () => {
          const nextLevel = grades.length > 0 ? Math.max(...grades.map(g => g.level)) + 1 : 1;
          setGrades([...grades, { level: nextLevel, salary: 0, laborFee: 0, healthFee: 0 }]);
      };

      const updateRow = (index: number, field: keyof InsuranceGrade, val: string) => {
          const newGrades = [...grades];
          newGrades[index] = { ...newGrades[index], [field]: Number(val) };
          setGrades(newGrades);
      };

      const removeRow = (index: number) => {
          setGrades(grades.filter((_, i) => i !== index));
      };

      const saveTable = async () => {
          setIsSavingTable(true);
          try {
              const sorted = [...grades].sort((a,b) => a.level - b.level);
              await saveInsuranceTable(sorted);
              setInsuranceTable(sorted);
              setIsSettingsOpen(false);
          } catch(e) {
              alert("儲存失敗");
          } finally {
              setIsSavingTable(false);
          }
      };

      return (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl animate-fade-in flex flex-col max-h-[85vh]">
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                          <Settings size={18} /> 勞健保級距表設定
                      </h3>
                      <button onClick={() => setIsSettingsOpen(false)}><X className="text-slate-400 hover:text-slate-600" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6">
                      <table className="w-full text-sm text-left">
                          <thead className="text-slate-500 font-bold border-b border-slate-100">
                              <tr>
                                  <th className="py-2 px-2">級數 (Level)</th>
                                  <th className="py-2 px-2">月投保薪資 (Salary)</th>
                                  <th className="py-2 px-2">勞保費 (Labor)</th>
                                  <th className="py-2 px-2">健保費 (Health)</th>
                                  <th className="py-2 px-2 w-10"></th>
                              </tr>
                          </thead>
                          <tbody>
                              {grades.map((g, idx) => (
                                  <tr key={idx} className="border-b border-slate-50">
                                      <td className="p-2">
                                          <input type="number" className="w-16 border rounded px-2 py-1 bg-slate-50" value={g.level} onChange={e => updateRow(idx, 'level', e.target.value)} />
                                      </td>
                                      <td className="p-2">
                                          <input type="number" className="w-full border rounded px-2 py-1" value={g.salary} onChange={e => updateRow(idx, 'salary', e.target.value)} />
                                      </td>
                                      <td className="p-2">
                                          <input type="number" className="w-full border rounded px-2 py-1" value={g.laborFee} onChange={e => updateRow(idx, 'laborFee', e.target.value)} />
                                      </td>
                                      <td className="p-2">
                                          <input type="number" className="w-full border rounded px-2 py-1" value={g.healthFee} onChange={e => updateRow(idx, 'healthFee', e.target.value)} />
                                      </td>
                                      <td className="p-2 text-center">
                                          <button onClick={() => removeRow(idx)} className="text-slate-300 hover:text-rose-500"><Trash2 size={16} /></button>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                      <button onClick={addRow} className="mt-4 flex items-center gap-2 text-teal-600 font-bold text-sm hover:text-teal-700">
                          <Plus size={16} /> 新增級距
                      </button>
                  </div>
                  <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-xl">
                      <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">取消</button>
                      <button onClick={saveTable} disabled={isSavingTable} className="bg-teal-600 hover:bg-teal-700 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                          {isSavingTable && <Loader2 size={16} className="animate-spin" />} 儲存
                      </button>
                  </div>
              </div>
          </div>
      );
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
           <div>
               <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                 <Briefcase size={28} className="text-teal-600"/> 人員管理 (HR)
               </h2>
               <p className="text-slate-500">管理診所的諮詢師、助理、打工與實習人員及人事薪資資料。</p>
           </div>
           
           {!isAdding && (
               <div className="flex items-center gap-2 w-full sm:w-auto">
                   <button 
                       onClick={() => setIsSettingsOpen(true)}
                       className="bg-white text-slate-600 border border-slate-300 hover:bg-slate-50 px-3 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm text-sm font-bold"
                   >
                       <Settings size={16} /> 勞健保級距設定
                   </button>
                   <ClinicSelector className="border p-2 rounded-lg font-medium text-slate-700 bg-white shadow-sm flex-1 sm:flex-none" />
                   <button
                        onClick={handleAddClick}
                        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap shadow-md"
                    >
                        <UserPlus size={18} /> 新增人員
                    </button>
               </div>
           )}
       </div>

       {isSettingsOpen && <SettingsModal />}

       {isAdding && (
           <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 animate-fade-in max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-2">
                    <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                        {editingId ? <Edit2 size={18}/> : <UserPlus size={18}/>}
                        {editingId ? '編輯人員資料' : '新增人員'}
                    </h3>
                    <button onClick={resetForm} disabled={isSaving} className="text-slate-400 hover:text-slate-600 transition-colors"><X /></button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Left Column: Basic Info */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-bold text-slate-600 uppercase mb-2 border-b pb-1">基本資料</h4>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">所屬診所</label>
                            <select
                                className="w-full border rounded-lg px-3 py-2 bg-slate-50 text-slate-700 outline-none"
                                value={formData.clinicId}
                                onChange={e => updateField('clinicId', e.target.value)}
                                disabled={!!editingId}
                            >
                                <option value="">請選擇</option>
                                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">姓名</label>
                            <input
                                type="text"
                                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                                value={formData.name}
                                onChange={e => {
                                    updateField('name', e.target.value);
                                    if (!formData.avatarText) {
                                        updateField('avatarText', e.target.value.substring(0, 1));
                                    }
                                }}
                                placeholder="例如：王小美"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">人員身分</label>
                            <div className="grid grid-cols-2 gap-2">
                                {(['consultant', 'assistant', 'part_time', 'trainee'] as ConsultantRole[]).map(role => (
                                    <button
                                        key={role}
                                        type="button"
                                        onClick={() => updateField('role', role)}
                                        className={`
                                            flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-bold transition-all
                                            ${formData.role === role 
                                                ? 'bg-teal-600 text-white border-teal-600 shadow-md transform scale-105' 
                                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                            }
                                        `}
                                    >
                                        {ROLE_ICONS[role]}
                                        {ROLE_LABELS[role]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Avatar Settings Section */}
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                <Palette size={14} /> 頭貼設定 (Avatar)
                            </h4>
                            <div className="flex items-start gap-4">
                                <div className="flex flex-col items-center gap-2">
                                    <div 
                                        className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-md border-2 border-white transition-all"
                                        style={{ backgroundColor: formData.avatarColor }}
                                    >
                                        {formData.avatarText || (formData.name ? formData.name.substring(0,1) : '?')}
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">預覽</span>
                                </div>
                                <div className="flex-1 space-y-3">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">頭貼簡稱 (建議2-3字)</label>
                                        <input
                                            type="text"
                                            maxLength={3}
                                            className="w-full border rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-teal-500"
                                            value={formData.avatarText}
                                            onChange={e => updateField('avatarText', e.target.value)}
                                            placeholder="例如: 娘"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">背景顏色</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                className="w-8 h-8 rounded-md cursor-pointer border-0 p-0 overflow-hidden shrink-0"
                                                value={formData.avatarColor}
                                                onChange={e => updateField('avatarColor', e.target.value)}
                                            />
                                            <div className="flex flex-wrap gap-1.5">
                                                {PRESET_COLORS.map(c => (
                                                    <button 
                                                        key={c}
                                                        type="button"
                                                        className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${formData.avatarColor === c ? 'border-teal-500 shadow-sm' : 'border-white'}`}
                                                        style={{ backgroundColor: c }}
                                                        onClick={() => updateField('avatarColor', c)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">到職日期 (Onboard)</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    type="date"
                                    className="w-full pl-10 border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                                    value={formData.onboardDate}
                                    onChange={e => updateField('onboardDate', e.target.value)}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">離職日期 (Resignation)</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    type="date"
                                    className="w-full pl-10 border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                                    value={formData.resignationDate}
                                    onChange={e => updateField('resignationDate', e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Right Column: HR & Payroll */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-bold text-slate-600 uppercase mb-2 border-b pb-1">薪資與保險 (Payroll & HR)</h4>
                        
                        {formData.role === 'part_time' ? (
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                    <Clock size={12}/> 時薪 (Hourly Rate)
                                </label>
                                <input
                                    type="number"
                                    className="w-full border rounded-lg px-3 py-2 text-right font-mono bg-amber-50 border-amber-200 focus:ring-amber-500"
                                    value={formData.hourlyRate}
                                    onChange={e => updateField('hourlyRate', e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                        <DollarSign size={12}/> 本薪 (Base Salary)
                                    </label>
                                    <input
                                        type="number"
                                        className="w-full border rounded-lg px-3 py-2 text-right font-mono"
                                        value={formData.baseSalary}
                                        onChange={e => updateField('baseSalary', e.target.value)}
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                        <DollarSign size={12}/> 職務加給 (Allowance)
                                    </label>
                                    <input
                                        type="number"
                                        className="w-full border rounded-lg px-3 py-2 text-right font-mono"
                                        value={formData.allowance}
                                        onChange={e => updateField('allowance', e.target.value)}
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                        )}

                        {/* INSURANCE GRADE SELECTOR */}
                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <label className="block text-xs font-bold text-slate-500 mb-2">投保級距 (Insurance Grade)</label>
                            <select 
                                className="w-full border rounded-lg px-3 py-2 mb-3 bg-white"
                                value={formData.insuranceGradeLevel}
                                onChange={e => updateField('insuranceGradeLevel', Number(e.target.value))}
                            >
                                <option value="0">請選擇級距...</option>
                                {insuranceTable.map(g => (
                                    <option key={g.level} value={g.level}>
                                        第 {g.level} 級 (${g.salary.toLocaleString()})
                                    </option>
                                ))}
                            </select>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                    <span className="text-slate-400 block">投保薪資</span>
                                    <span className="font-mono font-bold text-slate-700">${formData.insuredSalary.toLocaleString()}</span>
                                </div>
                                <div>
                                    <span className="text-slate-400 block">預估勞健保自付</span>
                                    <span className="font-mono font-bold text-rose-600">${Math.round(formData.monthlyInsuranceCost).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                    <Heart size={12}/> 健保眷屬人數
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    className="w-full border rounded-lg px-3 py-2 text-center font-mono"
                                    value={formData.dependents}
                                    onChange={e => updateField('dependents', e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                    <Sun size={12}/> 特休剩餘天數
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    className="w-full border rounded-lg px-3 py-2 text-center font-mono"
                                    value={formData.annualLeave}
                                    onChange={e => updateField('annualLeave', e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                        onClick={resetForm}
                        disabled={isSaving}
                        className="px-6 py-2.5 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50 font-medium"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!formData.name || isSaving}
                        className="bg-teal-600 text-white px-8 py-2.5 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-bold shadow-lg"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 size={18} className="animate-spin" /> 儲存中...
                            </>
                        ) : (
                            editingId ? '更新資料' : '新增人員'
                        )}
                    </button>
                </div>
           </div>
       )}

       <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {isLoading ? (
                <div className="p-12 flex justify-center">
                    <Loader2 className="animate-spin text-teal-600" />
                </div>
            ) : (
                <div className="grid grid-cols-1 divide-y divide-slate-100">
                    {staffList.length > 0 ? (
                        staffList.map(consultant => {
                            const role = consultant.role || 'consultant'; 
                            return (
                                <div key={consultant.id} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors group">
                                    <div className="flex items-center gap-4">
                                        <div 
                                            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm border border-white"
                                            style={{ backgroundColor: consultant.avatarColor || '#94a3b8' }}
                                        >
                                            {consultant.avatarText || consultant.name.charAt(0)}
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-800 flex items-center gap-2">
                                                {consultant.name}
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${ROLE_COLORS[role]}`}>
                                                    {ROLE_ICONS[role]}
                                                    {ROLE_LABELS[role]}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-3">
                                                {consultant.onboardDate && (
                                                    <span className="flex items-center gap-1"><Calendar size={10} /> 到: {consultant.onboardDate}</span>
                                                )}
                                                {consultant.resignationDate && (
                                                    <span className="flex items-center gap-1 text-rose-400"><Calendar size={10} /> 離: {consultant.resignationDate}</span>
                                                )}
                                                {consultant.insuredSalary && (
                                                    <span className="flex items-center gap-1"><DollarSign size={10} /> 投保: ${consultant.insuredSalary.toLocaleString()}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={() => handleEdit(consultant)}
                                            className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors"
                                            title="編輯"
                                        >
                                            <Edit2 size={16}/>
                                        </button>
                                        <button 
                                            onClick={() => handleDelete(consultant.id)}
                                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                            title="刪除"
                                        >
                                            <Trash2 size={16}/>
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="p-8 text-center text-slate-400">
                            {isAdding ? '請填寫上方表單新增資料' : '此診所尚未建立人員資料'}
                        </div>
                    )}
                </div>
            )}
       </div>
    </div>
  );
};