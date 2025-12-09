
import React, { useState } from 'react';
import { Laboratory, Clinic } from '../types';
import { Microscope, Plus, Trash2, Edit2, X, Loader2 } from 'lucide-react';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';

interface Props {
  laboratories: Laboratory[];
  clinics: Clinic[]; // Compatibility
  onSave: (labs: Laboratory[]) => Promise<void>;
}

export const LaboratoryManager: React.FC<Props> = ({ laboratories, onSave }) => {
  const { selectedClinicId, clinics } = useClinic();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [newName, setNewName] = useState('');
  const [formClinicId, setFormClinicId] = useState('');

  const resetForm = () => {
    setNewName('');
    setFormClinicId('');
    setEditingId(null);
    setIsAdding(false);
    setIsSaving(false);
  };

  const handleEdit = (lab: Laboratory) => {
    setNewName(lab.name);
    setFormClinicId(lab.clinicId);
    setEditingId(lab.id);
    setIsAdding(true);
  };

  const handleAddClick = () => {
      setFormClinicId(selectedClinicId);
      setIsAdding(true);
  };

  const handleSave = async () => {
    if (!newName || !formClinicId) return;

    setIsSaving(true);
    try {
        let updatedList: Laboratory[];

        if (editingId) {
            // Update
            updatedList = laboratories.map(l => l.id === editingId ? {
                ...l,
                name: newName,
                clinicId: formClinicId
            } : l);
        } else {
            // Create
            const newLab: Laboratory = {
                id: crypto.randomUUID(),
                name: newName,
                clinicId: formClinicId
            };
            updatedList = [...laboratories, newLab];
        }

        await onSave(updatedList);
        resetForm();
    } catch (error) {
        alert("儲存失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("確定要刪除此技工所嗎？")) return;

    setIsSaving(true);
    try {
        const updatedList = laboratories.filter(l => l.id !== id);
        await onSave(updatedList);
    } catch (error) {
        alert("刪除失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const filteredLabs = laboratories.filter(l => l.clinicId === selectedClinicId);

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
           <div>
               <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                 <Microscope size={28} className="text-teal-600"/> 技工所管理
               </h2>
               <p className="text-slate-500">管理合作的技工所名單。</p>
           </div>
           
           {!isAdding && (
               <div className="flex items-center gap-2 w-full sm:w-auto">
                   <ClinicSelector className="border p-2 rounded-lg font-medium text-slate-700 bg-white shadow-sm flex-1 sm:flex-none" />
                   <button
                        onClick={handleAddClick}
                        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap shadow-md"
                    >
                        <Plus size={18} /> 新增技工所
                    </button>
               </div>
           )}
       </div>

       {isAdding && (
           <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 animate-fade-in max-w-lg">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
                    <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                        {editingId ? <Edit2 size={18}/> : <Plus size={18}/>}
                        {editingId ? '編輯技工所' : '新增技工所'}
                    </h3>
                    <button onClick={resetForm} disabled={isSaving} className="text-slate-400 hover:text-slate-600 transition-colors"><X /></button>
                </div>

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
                        <label className="block text-sm font-medium text-slate-700 mb-1">技工所名稱</label>
                        <input
                            type="text"
                            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            placeholder="例如：ABC技工所"
                            autoFocus
                        />
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                        onClick={resetForm}
                        disabled={isSaving}
                        className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!newName || isSaving}
                        className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 size={16} className="animate-spin" /> 儲存中...
                            </>
                        ) : (
                            editingId ? '更新' : '新增'
                        )}
                    </button>
                </div>
           </div>
       )}

       <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-1 divide-y divide-slate-100">
                {filteredLabs.length > 0 ? (
                    filteredLabs.map(lab => (
                        <div key={lab.id} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors group">
                             <div className="flex items-center gap-4">
                                 <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold">
                                     <Microscope size={20} />
                                 </div>
                                 <div className="font-bold text-slate-800">{lab.name}</div>
                             </div>
                             <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                    onClick={() => handleEdit(lab)}
                                    className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors"
                                >
                                    <Edit2 size={16}/>
                                </button>
                                <button 
                                    onClick={() => handleDelete(lab.id)}
                                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                >
                                    <Trash2 size={16}/>
                                </button>
                             </div>
                        </div>
                    ))
                ) : (
                    <div className="p-8 text-center text-slate-400">
                        {isAdding ? '請填寫上方表單新增資料' : '此診所尚未建立技工所資料'}
                    </div>
                )}
            </div>
       </div>
    </div>
  );
};
