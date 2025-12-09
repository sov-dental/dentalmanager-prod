
import React, { useState, useRef } from 'react';
import { Clinic, SOVReferral } from '../types';
import { Users, Plus, Trash2, FileSpreadsheet, Loader2, Save, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';

interface Props {
  referrals: SOVReferral[];
  clinics: Clinic[]; // Compatibility
  onSave: (referrals: SOVReferral[]) => Promise<void>;
}

export const SOVReferralManager: React.FC<Props> = ({ referrals, onSave }) => {
  const { selectedClinicId, clinics } = useClinic();
  const [newName, setNewName] = useState('');
  const [newLast3Id, setNewLast3Id] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAdd = async () => {
    if (!newName || !selectedClinicId) return;

    setIsSaving(true);
    try {
        const newReferral: SOVReferral = {
            id: crypto.randomUUID(),
            clinicId: selectedClinicId,
            name: newName,
            last3Id: newLast3Id
        };
        const updatedList = [...referrals, newReferral];
        await onSave(updatedList);
        setNewName('');
        setNewLast3Id('');
    } catch (error) {
        alert("新增失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("確定要刪除此筆資料嗎？")) return;
    setIsSaving(true);
    try {
        const updatedList = referrals.filter(r => r.id !== id);
        await onSave(updatedList);
    } catch (error) {
        alert("刪除失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      try {
          const buffer = await file.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json<any>(sheet);

          // Expected columns: 診所, 姓名, ID後三碼 (or similar)
          const newReferrals: SOVReferral[] = [];
          
          data.forEach((row: any) => {
              const clinicName = row['診所'] || row['clinic'];
              const name = row['姓名'] || row['name'];
              const id3 = row['ID後三碼'] || row['id3'] || '';

              if (!name) return;

              // Try to match clinic name to ID, default to currently selected or first
              let targetClinicId = selectedClinicId;
              if (clinicName) {
                  const matched = clinics.find(c => c.name.includes(clinicName));
                  if (matched) targetClinicId = matched.id;
              }

              newReferrals.push({
                  id: crypto.randomUUID(),
                  clinicId: targetClinicId,
                  name: String(name).trim(),
                  last3Id: String(id3).trim()
              });
          });

          if (newReferrals.length === 0) {
              alert("未讀取到有效資料，請確認 Excel 欄位名稱 (診所, 姓名, ID後三碼)");
              return;
          }

          if (confirm(`即將匯入 ${newReferrals.length} 筆資料，確定嗎？`)) {
              await onSave([...referrals, ...newReferrals]);
              alert("匯入成功！");
          }

      } catch (error) {
          console.error(error);
          alert("匯入失敗，請確認檔案格式。");
      } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  const filteredReferrals = referrals.filter(r => r.clinicId === selectedClinicId);

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
           <div>
               <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                 <Users size={28} className="text-purple-600"/> SOV 轉介名單
               </h2>
               <p className="text-slate-500">管理參與 SOV 轉介方案的病患名單 (db_sov_referrals)。</p>
           </div>
           
           <div className="flex items-center gap-3 w-full sm:w-auto">
               <input 
                   type="file" 
                   ref={fileInputRef} 
                   className="hidden" 
                   accept=".xlsx,.xls,.csv" 
                   onChange={handleFileUpload} 
               />
               <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap shadow-md disabled:opacity-50"
                >
                    {isImporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
                    Excel 匯入
                </button>
               <ClinicSelector className="border p-2 rounded-lg font-medium text-slate-700 bg-white shadow-sm flex-1 sm:flex-none min-w-[150px]" />
           </div>
       </div>

       {/* Add Form */}
       <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 items-end">
           <div className="flex-1 w-full">
               <label className="block text-xs font-bold text-slate-500 uppercase mb-1">姓名</label>
               <input
                   type="text"
                   className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none"
                   value={newName}
                   onChange={e => setNewName(e.target.value)}
                   placeholder="例如：陳小美"
               />
           </div>
           <div className="flex-1 w-full">
               <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ID後三碼 (選填)</label>
               <input
                   type="text"
                   className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none"
                   value={newLast3Id}
                   onChange={e => setNewLast3Id(e.target.value)}
                   placeholder="例如：123"
               />
           </div>
           <button
                onClick={handleAdd}
                disabled={!newName || isSaving}
                className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-md transition-colors flex items-center gap-2 disabled:opacity-50 w-full md:w-auto justify-center"
            >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                新增資料
            </button>
       </div>

       {/* Data Table */}
       <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-slate-600 grid grid-cols-12 gap-4">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-5">姓名</div>
                <div className="col-span-4">ID後三碼</div>
                <div className="col-span-2 text-right">操作</div>
            </div>
            <div className="divide-y divide-slate-100">
                {filteredReferrals.length > 0 ? (
                    filteredReferrals.map((item, idx) => (
                        <div key={item.id} className="grid grid-cols-12 gap-4 p-4 hover:bg-slate-50 transition-colors items-center">
                             <div className="col-span-1 text-center text-slate-400 font-mono text-sm">{idx + 1}</div>
                             <div className="col-span-5 font-bold text-slate-800">{item.name}</div>
                             <div className="col-span-4 font-mono text-slate-600">{item.last3Id || '-'}</div>
                             <div className="col-span-2 text-right">
                                <button 
                                    onClick={() => handleDelete(item.id)}
                                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                    title="刪除"
                                >
                                    <Trash2 size={16}/>
                                </button>
                             </div>
                        </div>
                    ))
                ) : (
                    <div className="p-12 text-center text-slate-400">
                        此診所尚無轉介名單資料
                    </div>
                )}
            </div>
       </div>
    </div>
  );
};
