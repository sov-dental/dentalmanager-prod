
import React, { useState, useEffect } from 'react';
import { Clinic, SOVReferral } from '../types';
import { Users, Plus, Trash2, Loader2, WifiOff } from 'lucide-react';
import { useClinic } from '../contexts/ClinicContext';
import { ClinicSelector } from './ClinicSelector';
import { db, saveSOVReferrals } from '../services/firebase';

interface Props {
  referrals?: SOVReferral[]; // Deprecated (Now fetched internally)
  clinics?: Clinic[]; // Deprecated
  onSave?: (referrals: SOVReferral[]) => Promise<void>; // Deprecated
}

export const SOVReferralManager: React.FC<Props> = () => {
  const { selectedClinicId } = useClinic();
  
  // Real-time Data State
  const [localReferrals, setLocalReferrals] = useState<SOVReferral[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [newName, setNewName] = useState('');
  const [newLast3Id, setNewLast3Id] = useState('');

  // Real-time Listener
  useEffect(() => {
      if (!selectedClinicId) {
          setLocalReferrals([]);
          return;
      }

      setIsLoading(true);
      setError(null);

      const unsubscribe = db.collection('clinics').doc(selectedClinicId)
          .onSnapshot((doc) => {
              setIsLoading(false);
              if (doc.exists) {
                  const data = doc.data();
                  const refs = (data?.sovReferrals || []) as SOVReferral[];
                  setLocalReferrals(refs);
              } else {
                  setLocalReferrals([]);
              }
          }, (err) => {
              console.error("Referral Listener Error:", err);
              setError("連線中斷，無法取得即時資料");
              setIsLoading(false);
          });

      return () => unsubscribe();
  }, [selectedClinicId]);

  const handleAdd = async () => {
    if (!newName || !selectedClinicId) return;

    setIsSaving(true);
    try {
        const newReferral: SOVReferral = {
            id: crypto.randomUUID(),
            clinicId: selectedClinicId,
            name: newName.trim(),
            last3Id: newLast3Id.trim()
        };
        
        // Optimistic update prevention: Use the latest local state from snapshot
        // Check for duplicates
        if (localReferrals.some(r => r.name === newReferral.name)) {
            alert("此姓名已存在於清單中");
            setIsSaving(false);
            return;
        }

        const updatedList = [...localReferrals, newReferral];
        
        // Write directly to Firestore using the service
        await saveSOVReferrals(selectedClinicId, updatedList);
        
        setNewName('');
        setNewLast3Id('');
    } catch (error) {
        alert("新增失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!selectedClinicId) return;
    if (!confirm("確定要刪除此筆資料嗎？")) return;
    
    setIsSaving(true);
    try {
        const updatedList = localReferrals.filter(r => r.id !== id);
        await saveSOVReferrals(selectedClinicId, updatedList);
    } catch (error) {
        alert("刪除失敗: " + (error as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
           <div>
               <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                 <Users size={28} className="text-purple-600"/> SOV 轉介名單
               </h2>
               <p className="text-slate-500">管理參與 SOV 轉介方案的病患名單 (即時同步)。</p>
           </div>
           
           <div className="flex items-center gap-3 w-full sm:w-auto">
               {isLoading && <Loader2 className="animate-spin text-slate-400" size={20} />}
               <ClinicSelector className="border p-2 rounded-lg font-medium text-slate-700 bg-white shadow-sm flex-1 sm:flex-none min-w-[150px]" />
           </div>
       </div>

       {error && (
           <div className="bg-rose-50 text-rose-600 p-4 rounded-lg flex items-center gap-2">
               <WifiOff size={20} /> {error}
           </div>
       )}

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
                   disabled={isSaving}
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
                   disabled={isSaving}
               />
           </div>
           <button
                onClick={handleAdd}
                disabled={!newName || isSaving || !selectedClinicId}
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
                {localReferrals.length > 0 ? (
                    localReferrals.map((item, idx) => (
                        <div key={item.id} className="grid grid-cols-12 gap-4 p-4 hover:bg-slate-50 transition-colors items-center animate-fade-in">
                             <div className="col-span-1 text-center text-slate-400 font-mono text-sm">{idx + 1}</div>
                             <div className="col-span-5 font-bold text-slate-800">{item.name}</div>
                             <div className="col-span-4 font-mono text-slate-600">{item.last3Id || '-'}</div>
                             <div className="col-span-2 text-right">
                                <button 
                                    onClick={() => handleDelete(item.id)}
                                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                    title="刪除"
                                    disabled={isSaving}
                                >
                                    <Trash2 size={16}/>
                                </button>
                             </div>
                        </div>
                    ))
                ) : (
                    <div className="p-12 text-center text-slate-400">
                        {isLoading ? '載入中...' : '此診所尚無轉介名單資料'}
                    </div>
                )}
            </div>
       </div>
    </div>
  );
};
