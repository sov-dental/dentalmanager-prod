
import React, { useState, useEffect } from 'react';
import { Doctor, NHIRecord } from '../types';
import { getNHIRecords, saveBatchNHIRecords } from '../services/firebase';
import { X, Loader2, Save, AlertCircle } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    clinicId: string;
    month: string;
    doctors: Doctor[];
    onSave: () => void;
}

// Safe helpers for mixed types (String vs Object)
const getDocId = (d: any) => (typeof d === 'string' ? d : d?.id || '');
const getDocName = (d: any) => (typeof d === 'string' ? d : d?.name || '');

export const NHIClaimsModal: React.FC<Props> = ({ isOpen, onClose, clinicId, month, doctors, onSave }) => {
    const [inputs, setInputs] = useState<Record<string, { amount: string }>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filter doctors for current clinic only (if not already filtered)
    const activeDoctors = doctors.filter(d => {
        if (typeof d === 'string') return true; 
        return d.clinicId === clinicId;
    });

    useEffect(() => {
        if (isOpen && clinicId && month) {
            fetchData();
        }
    }, [isOpen, clinicId, month]);

    const fetchData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const records = await getNHIRecords(clinicId, month);
            
            const initial: Record<string, { amount: string }> = {};
            activeDoctors.forEach(doc => {
                const docId = getDocId(doc);
                const rec = records.find(r => r.doctorId === docId);
                initial[docId] = {
                    amount: rec ? String(rec.amount) : '',
                };
            });
            setInputs(initial);
        } catch (e) {
            console.error("Failed to load NHI records", e);
            setError("讀取失敗，請檢查網路連線");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const recordsToSave: NHIRecord[] = activeDoctors.map(doc => {
                const docId = getDocId(doc);
                const amount = parseFloat(inputs[docId]?.amount || '0');
                if (isNaN(amount) && !inputs[docId]?.amount) return null; // Skip if completely empty/undefined, unless 0

                const docName = getDocName(doc);
                
                return {
                    id: '', // Generated in service
                    clinicId,
                    month,
                    doctorId: docId,
                    doctorName: docName,
                    amount: isNaN(amount) ? 0 : amount,
                    updatedAt: Date.now()
                };
            }).filter(Boolean) as NHIRecord[];

            await saveBatchNHIRecords(recordsToSave);
            onSave();
            onClose();
        } catch (e) {
            console.error(e);
            setError("儲存失敗");
        } finally {
            setIsSaving(false);
        }
    };

    const handleChange = (docId: string, value: string) => {
        setInputs(prev => ({
            ...prev,
            [docId]: { amount: value }
        }));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-xl animate-fade-in flex flex-col max-h-[85vh]">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
                    <h3 className="font-bold text-slate-800">健保申報設定 ({month})</h3>
                    <button onClick={onClose}><X className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 relative">
                    {isLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                            <Loader2 className="animate-spin text-teal-600" />
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="text-slate-500 font-bold border-b border-slate-100 bg-white sticky top-0">
                                <tr>
                                    <th className="text-left py-2">醫師</th>
                                    <th className="text-right py-2 w-32">申報金額</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {activeDoctors.map(doc => {
                                    const docId = getDocId(doc);
                                    const docName = getDocName(doc);
                                    const rate = (typeof doc !== 'string' && doc.commissionRates) ? (doc.commissionRates.nhi || 0) : 0;

                                    return (
                                        <tr key={docId} className="hover:bg-slate-50">
                                            <td className="py-3 font-bold text-slate-700">
                                                {docName}
                                                <div className="text-[10px] text-slate-400 font-normal">
                                                    抽成: {rate}%
                                                </div>
                                            </td>
                                            <td className="py-3 px-2">
                                                <input 
                                                    type="number"
                                                    className="w-full border rounded px-2 py-1.5 text-right font-mono outline-none focus:ring-2 focus:ring-blue-500"
                                                    placeholder="0"
                                                    value={inputs[docId]?.amount || ''}
                                                    onChange={e => handleChange(docId, e.target.value)}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                                {activeDoctors.length === 0 && (
                                    <tr><td colSpan={2} className="p-4 text-center text-slate-400">此診所無醫師資料</td></tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                {error && (
                    <div className="px-4 py-2 bg-rose-50 text-rose-600 text-xs flex items-center gap-2">
                        <AlertCircle size={14} /> {error}
                    </div>
                )}

                <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-xl">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg" disabled={isSaving}>取消</button>
                    <button 
                        onClick={handleSave} 
                        disabled={isSaving || isLoading}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold shadow-md flex items-center gap-2"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        儲存
                    </button>
                </div>
            </div>
        </div>
    );
};
