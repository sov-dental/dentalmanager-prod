import React, { useState, useEffect } from 'react';
import { AccountingRow, NPRecord } from '../types';
import { getStaffList, saveNPRecord, getNPRecord, getMarketingTags, saveMarketingTags, db, deleteNPRecord } from '../services/firebase';
import { X, Save, Loader2, Tag, MessageCircle, User, DollarSign, Settings, Plus, Trash2, CheckSquare, FileText, AlertCircle, Clock, Info as InfoIcon, XCircle } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    recordId: string;
    patientName: string;
    calendarTreatment?: string;
    actualTreatment?: string;
    clinicId: string;
    date: string;
    onRevokeNP?: () => void;
    // Allow passing the full row for legacy support if needed, but we prefer explicit fields
    row?: any; 
}

const SOURCES = ['FB', 'Line', '電話', '小幫手', '介紹', '過路客', '官網', 'SOV轉介', '其他'];

export const NPStatusModal: React.FC<Props> = ({ isOpen, onClose, recordId, patientName, calendarTreatment, actualTreatment, clinicId, date, onRevokeNP, row }) => {
    const [formData, setFormData] = useState<Partial<NPRecord>>({
        source: 'Line',
        marketingTag: '矯正諮詢',
        isVisited: false,
        isClosed: false,
        dealAmount: 0,
        consultant: '',
        calendarNote: '',
        note: '',
        treatment: actualTreatment || ''
    });
    
    const [consultants, setConsultants] = useState<{id: string, name: string}[]>([]);
    const [marketingTags, setMarketingTags] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Tag Editing State
    const [isEditingTags, setIsEditingTags] = useState(false);
    const [newTagInput, setNewTagInput] = useState('');

    useEffect(() => {
        if (isOpen && clinicId && recordId) {
            loadData();
        }
    }, [isOpen, clinicId, recordId]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            // 1. Fetch Consultants
            const staff = await getStaffList(clinicId);
            const eligible = staff.filter(s => 
                !s.role || ['consultant', 'trainee', 'assistant'].includes(s.role)
            );
            setConsultants(eligible.map(s => ({ id: s.id, name: s.name })));

            // 2. Fetch Marketing Tags (Dynamic)
            const tags = await getMarketingTags();
            setMarketingTags(tags);

            // 3. Fetch Existing Record by Standardized ID
            const doc = await db.collection('np_records').doc(recordId).get();
            let existing: NPRecord | null = null;
            
            if (doc.exists) {
                existing = { id: doc.id, ...doc.data() } as NPRecord;
            } else {
                // Fallback to name-based lookup for legacy records
                existing = await getNPRecord(clinicId, date, patientName);
            }

            if (existing) {
                setFormData({
                    ...existing,
                    treatment: existing.treatment || actualTreatment || '',
                    calendarNote: existing.calendarNote || '',
                    note: existing.note || '',
                    consultant: existing.consultant || '',
                    dealAmount: existing.dealAmount || 0
                });
            } else {
                const defaultTag = tags.includes('矯正諮詢') ? '矯正諮詢' : (tags[0] || '其他');
                setFormData({
                    source: 'Line',
                    marketingTag: defaultTag,
                    isVisited: false,
                    isClosed: false,
                    dealAmount: 0,
                    consultant: '',
                    calendarNote: '',
                    note: '',
                    treatment: actualTreatment || ''
                });
            }
        } catch (e) {
            console.error("Failed to load NP data", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        if (!patientName) {
            alert("病患姓名缺失");
            return;
        }

        setIsSaving(true);
        try {
            const dealAmount = Number(formData.dealAmount) || 0;
            const isClosed = !!formData.isClosed;
            const isVisited = isClosed ? true : !!formData.isVisited;

            const record: NPRecord = {
                date,
                clinicId,
                patientName: patientName,
                treatment: formData.treatment || '', // Actual Treatment
                marketingTag: formData.marketingTag || '其他',
                source: formData.source || '其他',
                isVisited,
                isClosed,
                dealAmount,
                consultant: formData.consultant || '',
                updatedAt: new Date().toISOString(),
                calendarNote: formData.calendarNote || '',
                note: formData.note || ''
            };

            await saveNPRecord(recordId, record);
            onClose();
        } catch (e: any) {
            alert(`儲存失敗: ${e.message || '請檢查網路連線'}`);
            console.error(e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleClosedChange = (checked: boolean) => {
        setFormData(prev => ({
            ...prev,
            isClosed: checked,
            isVisited: checked ? true : prev.isVisited
        }));
    };

    const handleAddTag = async () => {
        const tag = newTagInput.trim();
        if (!tag) return;
        if (marketingTags.includes(tag)) {
            setNewTagInput('');
            return;
        }
        const newTags = [...marketingTags, tag];
        setMarketingTags(newTags);
        setNewTagInput('');
        await saveMarketingTags(newTags); 
    };

    const handleDeleteTag = async (tagToDelete: string) => {
        if (!confirm(`確定刪除標籤 "${tagToDelete}"？`)) return;
        const newTags = marketingTags.filter(t => t !== tagToDelete);
        setMarketingTags(newTags);
        await saveMarketingTags(newTags);
        if (formData.marketingTag === tagToDelete) {
            setFormData(prev => ({ ...prev, marketingTag: newTags[0] || '' }));
        }
    };

    const renderStatusBadge = () => {
        if (formData.isClosed) return <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold border border-emerald-200">已成交</span>;
        if (formData.isVisited) return <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold border border-blue-100">已報到</span>;
        return <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold border border-slate-200">未到診</span>;
    };

    const handleRevokeClick = async () => {
        if (!confirm("確定這不是 NP 嗎？這將移除行銷追蹤並恢復為一般備註。")) return;
        
        setIsSaving(true);
        try {
            await deleteNPRecord(recordId);
            if (onRevokeNP) onRevokeNP();
            onClose();
        } catch (e) {
            alert("移除失敗");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-down flex flex-col max-h-[85vh]">
                <div className="bg-indigo-600 text-white p-4 flex justify-between items-center shrink-0">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <Tag size={20} className="text-indigo-200" />
                        NP 追蹤設定
                    </h3>
                    <button onClick={onClose} className="hover:text-indigo-200 transition-colors"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="animate-spin text-indigo-600" size={32} />
                        </div>
                    ) : (
                        <>
                            {/* Calendar Note Section at the top */}
                            {formData.calendarNote && (
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 shadow-inner">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                                        <InfoIcon size={12} className="text-slate-300" />
                                        日曆備註 (Calendar Note)
                                    </label>
                                    <textarea 
                                        className="w-full h-24 bg-transparent text-sm text-slate-600 font-medium resize-none outline-none border-none cursor-default custom-scrollbar italic"
                                        value={formData.calendarNote}
                                        readOnly
                                    />
                                    <div className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-400">
                                        <AlertCircle size={10} />
                                        <span>此區域僅供查看自動解析來源之依據，無法編輯。</span>
                                    </div>
                                </div>
                            )}

                            <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100 mb-2">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="font-bold text-indigo-900 text-lg">{patientName}</span>
                                    {renderStatusBadge()}
                                </div>
                                <div className="text-xs text-indigo-700 flex items-center gap-1">
                                    <Clock size={12} /> {date} 預約
                                </div>
                            </div>

                            <div className="space-y-4">
                                {/* Split Treatment UI */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1 uppercase tracking-wider">
                                        <FileText size={12}/> 預約療程 (Calendar)
                                    </label>
                                    <input 
                                        className="w-full border rounded px-3 py-2 text-sm bg-slate-50 text-slate-500 cursor-not-allowed italic"
                                        value={calendarTreatment || '無預約資訊'}
                                        disabled
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-indigo-600 mb-1 flex items-center gap-1 uppercase tracking-wider">
                                        <FileText size={12}/> 實際療程 (Actual)
                                    </label>
                                    <input 
                                        className="w-full border-2 border-indigo-100 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold"
                                        value={formData.treatment}
                                        onChange={e => setFormData({...formData, treatment: e.target.value})}
                                        placeholder="輸入當日實際洽談內容"
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-4">
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-xs font-bold text-slate-500 flex items-center gap-1"><Tag size={12}/> 行銷項目 (Tag)</label>
                                            <button onClick={() => setIsEditingTags(!isEditingTags)} className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center gap-1"><Settings size={10} /> {isEditingTags ? '完成編輯' : '編輯選項'}</button>
                                        </div>
                                        {isEditingTags ? (
                                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 space-y-2">
                                                <div className="flex gap-2">
                                                    <input className="flex-1 border rounded px-2 py-1 text-sm outline-none" placeholder="新標籤..." value={newTagInput} onChange={e => setNewTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTag()}/>
                                                    <button onClick={handleAddTag} className="bg-indigo-600 text-white px-2 rounded hover:bg-indigo-700"><Plus size={14}/></button>
                                                </div>
                                                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                                    {marketingTags.map(tag => (
                                                        <span key={tag} className="bg-white border px-2 py-1 rounded text-xs flex items-center gap-1">{tag}<button onClick={() => handleDeleteTag(tag)} className="text-rose-400 hover:text-rose-600"><X size={10}/></button></span>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <select className="w-full border rounded px-3 py-2 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-medium" value={formData.marketingTag} onChange={e => setFormData({...formData, marketingTag: e.target.value})}>
                                                {marketingTags.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><MessageCircle size={12}/> 來源管道 (Source)</label>
                                        <select className="w-full border rounded px-3 py-2 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-medium" value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})}>
                                            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><User size={12}/> 負責諮詢師 (Consultant)</label>
                                    <select className="w-full border rounded px-3 py-2 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-medium" value={formData.consultant} onChange={e => setFormData({...formData, consultant: e.target.value})}>
                                        <option value="">未指定</option>
                                        {consultants.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>

                                <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
                                    <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${formData.isVisited ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}>
                                        <input type="checkbox" className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-gray-300" checked={formData.isVisited} onChange={e => setFormData({...formData, isVisited: e.target.checked})} disabled={formData.isClosed}/>
                                        <span className={`font-bold ${formData.isVisited ? 'text-blue-700' : 'text-slate-600'}`}>是否到診 (Visited)</span>
                                    </label>
                                    <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${formData.isClosed ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                                        <input type="checkbox" className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300" checked={formData.isClosed} onChange={e => handleClosedChange(e.target.checked)}/>
                                        <span className={`font-bold ${formData.isClosed ? 'text-emerald-700' : 'text-slate-600'}`}>是否成交 (Closed)</span>
                                    </label>
                                </div>

                                {formData.isClosed && (
                                    <div className="animate-fade-in pl-1">
                                        <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><DollarSign size={12}/> 成交金額</label>
                                        <input type="number" className="w-full border rounded px-3 py-2 text-lg font-bold text-indigo-700 outline-none focus:ring-2 focus:ring-indigo-500" value={formData.dealAmount} onChange={e => setFormData({...formData, dealAmount: Number(e.target.value)})} placeholder="0"/>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                    <button 
                        onClick={handleRevokeClick}
                        className="flex items-center gap-1.5 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-lg text-sm font-bold transition-colors border border-transparent hover:border-rose-100"
                        disabled={isSaving || isLoading}
                    >
                        <XCircle size={16} /> 非 NP (Not NP)
                    </button>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-bold" disabled={isSaving}>取消</button>
                        <button onClick={handleSave} disabled={isSaving || isLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-md flex items-center gap-2">
                            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            儲存紀錄
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};