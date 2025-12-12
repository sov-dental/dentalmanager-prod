
import React, { useState } from 'react';
import { Laboratory, Clinic, LabPricingItem } from '../types';
import { Microscope, Plus, Trash2, Edit2, X, Loader2, List, Percent } from 'lucide-react';
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
  const [pricingList, setPricingList] = useState<LabPricingItem[]>([]);

  // Item Input State
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemIsPercentage, setNewItemIsPercentage] = useState(false);

  const resetForm = () => {
    setNewName('');
    setFormClinicId('');
    setPricingList([]);
    setEditingId(null);
    setIsAdding(false);
    setIsSaving(false);
    setNewItemName('');
    setNewItemPrice('');
    setNewItemIsPercentage(false);
  };

  const handleEdit = (lab: Laboratory) => {
    setNewName(lab.name);
    setFormClinicId(lab.clinicId);
    setPricingList(lab.pricingList || []);
    setEditingId(lab.id);
    setIsAdding(true);
  };

  const handleAddClick = () => {
      setFormClinicId(selectedClinicId);
      setIsAdding(true);
  };

  // Pricing List Helpers
  const addPricingItem = () => {
      if (!newItemName || !newItemPrice) return;
      
      const priceVal = Number(newItemPrice);
      if (newItemIsPercentage && (priceVal < 0 || priceVal > 100)) {
          alert("百分比必須在 0-100 之間");
          return;
      }

      const newItem: LabPricingItem = {
          id: crypto.randomUUID(),
          name: newItemName,
          price: priceVal,
          isPercentage: newItemIsPercentage
      };
      setPricingList([...pricingList, newItem]);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemIsPercentage(false);
  };

  const removePricingItem = (itemId: string) => {
      setPricingList(pricingList.filter(i => i.id !== itemId));
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
                clinicId: formClinicId,
                pricingList: pricingList
            } : l);
        } else {
            // Create
            const newLab: Laboratory = {
                id: crypto.randomUUID(),
                name: newName,
                clinicId: formClinicId,
                pricingList: pricingList
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
        // Soft Delete: Mark as deleted instead of filtering out
        const updatedList = laboratories.map(l => 
            l.id === id ? { ...l, isDeleted: true } : l
        );
        await onSave(updatedList);
    } catch (error) {
        alert("刪除失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  // Filter out deleted labs
  const filteredLabs = laboratories.filter(l => l.clinicId === selectedClinicId && !l.isDeleted);

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
           <div>
               <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                 <Microscope size={28} className="text-teal-600"/> 技工所管理
               </h2>
               <p className="text-slate-500">管理合作的技工所名單與價目表。</p>
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
           <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 animate-fade-in max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        {editingId ? <Edit2 size={20}/> : <Plus size={20}/>}
                        {editingId ? '編輯技工所' : '新增技工所'}
                    </h3>
                    <button onClick={resetForm} disabled={isSaving} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-100"><X size={20} /></button>
                </div>

                <div className="flex flex-col gap-8">
                    {/* 1. Basics Section (Horizontal Layout) */}
                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                            <Microscope size={14} /> 基本資料
                        </h4>
                        <div className="flex flex-col md:flex-row gap-4 items-start">
                            <div className="flex-1 w-full">
                                <label className="block text-sm font-bold text-slate-700 mb-1">技工所名稱</label>
                                <input
                                    type="text"
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none font-medium bg-white"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder="例如：ABC技工所"
                                    autoFocus
                                />
                            </div>
                            <div className="w-full md:w-64">
                                <label className="block text-sm font-bold text-slate-700 mb-1">所屬診所</label>
                                <div className="relative">
                                    <select
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none appearance-none cursor-pointer hover:border-teal-500"
                                        value={formClinicId}
                                        onChange={e => setFormClinicId(e.target.value)}
                                        disabled={!!editingId}
                                    >
                                        {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 2. Pricing List Section (Full Width) */}
                    <div className="border-t border-slate-100 pt-4">
                        <div className="flex flex-col md:flex-row justify-between items-end mb-3 gap-3">
                            <h4 className="text-sm font-bold text-slate-600 uppercase flex items-center gap-2">
                                <List size={18} className="text-teal-600"/> 價目表 (Pricing List)
                            </h4>
                            <div className="text-xs text-slate-400">
                                共 {pricingList.length} 個項目
                            </div>
                        </div>
                        
                        {/* Add Item Row */}
                        <div className="flex flex-col md:flex-row gap-2 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-200 items-center">
                            <label className="flex items-center gap-2 cursor-pointer select-none bg-white px-3 py-2 rounded-md border border-slate-200 hover:border-indigo-300 transition-colors shadow-sm">
                                <input 
                                    type="checkbox" 
                                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                                    checked={newItemIsPercentage}
                                    onChange={e => setNewItemIsPercentage(e.target.checked)}
                                />
                                <span className={`text-sm font-bold ${newItemIsPercentage ? 'text-indigo-600' : 'text-slate-500'}`}>% 比例</span>
                            </label>
                            
                            <div className="flex-1 w-full relative">
                                <input 
                                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                    placeholder={newItemIsPercentage ? "項目名稱 (e.g. 抽成)" : "項目名稱 (e.g. 燒瓷)"}
                                    value={newItemName}
                                    onChange={e => setNewItemName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && addPricingItem()}
                                />
                            </div>

                            <div className="relative w-full md:w-32">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold pointer-events-none">
                                    {newItemIsPercentage ? '' : '$'}
                                </span>
                                <input 
                                    type="number"
                                    className={`w-full border border-slate-300 rounded-md py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-slate-700 ${newItemIsPercentage ? 'pr-8 pl-3' : 'pl-6 pr-3'}`}
                                    placeholder={newItemIsPercentage ? "50" : "3000"}
                                    value={newItemPrice}
                                    onChange={e => setNewItemPrice(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && addPricingItem()}
                                />
                                {newItemIsPercentage && (
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold pointer-events-none">%</span>
                                )}
                            </div>

                            <button 
                                onClick={addPricingItem} 
                                className="bg-indigo-600 text-white p-2 rounded-md hover:bg-indigo-700 shadow-sm transition-colors md:w-auto w-full flex justify-center items-center"
                                title="新增項目"
                            >
                                <Plus size={20} />
                            </button>
                        </div>

                        {/* Full Width Table */}
                        <div className="max-h-[400px] overflow-y-auto border border-slate-200 rounded-lg bg-white shadow-inner">
                            {pricingList.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                    <List size={32} className="mb-2 opacity-50"/>
                                    <span className="text-sm">尚無項目，請由上方新增</span>
                                </div>
                            ) : (
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-slate-500 bg-slate-50 font-bold uppercase sticky top-0 z-10 border-b border-slate-200">
                                        <tr>
                                            <th className="px-4 py-3">項目名稱</th>
                                            <th className="px-4 py-3 text-right">價格 / 比例</th>
                                            <th className="px-4 py-3 text-center w-16">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {pricingList.map((item, idx) => (
                                            <tr key={item.id} className="bg-white hover:bg-slate-50 transition-colors">
                                                <td className="px-4 py-3 font-medium text-slate-700 flex items-center gap-2">
                                                    <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs font-mono">{idx + 1}</span>
                                                    {item.isPercentage && <Percent size={14} className="text-teal-500" />}
                                                    {item.name}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-slate-600">
                                                    {item.isPercentage ? (
                                                        <span className="text-teal-600 bg-teal-50 px-2 py-1 rounded border border-teal-100">{item.price}%</span>
                                                    ) : (
                                                        `$${item.price.toLocaleString()}`
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button 
                                                        onClick={() => removePricingItem(item.id)} 
                                                        className="text-slate-300 hover:text-rose-500 hover:bg-rose-50 p-1.5 rounded transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                        onClick={resetForm}
                        disabled={isSaving}
                        className="px-6 py-2.5 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!newName || isSaving}
                        className="bg-teal-600 text-white px-8 py-2.5 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-bold shadow-lg"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 size={18} className="animate-spin" /> 儲存中...
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
                                 <div>
                                     <div className="font-bold text-slate-800">{lab.name}</div>
                                     <div className="text-xs text-slate-400">
                                         {lab.pricingList?.length || 0} 個定價項目
                                     </div>
                                 </div>
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
