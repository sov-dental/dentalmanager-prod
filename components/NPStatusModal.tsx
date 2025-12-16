
import React, { useState, useEffect } from 'react';
import { AccountingRow, NPRecord } from '../types';
import { getStaffList, saveNPRecord, getNPRecord, getMarketingTags, saveMarketingTags } from '../services/firebase';
import { X, Save, Loader2, Tag, MessageCircle, User, DollarSign, Settings, Plus, Trash2, CheckSquare, FileText } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    row?: AccountingRow; // Made optional for Manual Add mode
    clinicId: string;
    date: string;
}

const SOURCES = ['FB', 'Line', '電話', '小幫手', '介紹', '過路客', '官網', 'SOV轉介', '其他'];

export const NPStatusModal: React.FC<Props> = ({ isOpen, onClose, row, clinicId, date }) => {
    const [formData, setFormData] = useState<Partial<NPRecord>>({
        source: 'Line',
        marketingTag: '矯正諮詢',
        isVisited: false,
        isClosed: false,
        dealAmount: 0,
        consultant: ''
    });
    
    // For Manual Mode Inputs
    const [manualPatientName, setManualPatientName] = useState('');
    const [manualTreatment, setManualTreatment] = useState('');

    const [consultants, setConsultants] = useState<{id: string, name: string}[]>([]);
    const [marketingTags, setMarketingTags] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Tag Editing State
    const [isEditingTags, setIsEditingTags] = useState(false);
    const [newTagInput, setNewTagInput] = useState('');

    useEffect(() => {
        if (isOpen && clinicId) {
            loadData();
        }
    }, [isOpen, clinicId, row]);

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

            // 3. Setup Default / Fetch Existing Record
            const targetName = row ? row.patientName : '';
            
            if (row) {
                // Linked Mode (From Accounting/Sync)
                const existing = await getNPRecord(clinicId, date, targetName);
                if (existing) {
                    setFormData(existing);
                } else {
                    const defaultTag = tags.includes('矯正諮詢') ? '矯正諮詢' : (tags[0] || '其他');
                    setFormData({
                        source: 'Line',
                        marketingTag: defaultTag,
                        isVisited: false,
                        isClosed: false,
                        dealAmount: 0,
                        consultant: ''
                    });
                }
            } else {
                // Manual Mode (Reset)
                setManualPatientName('');
                setManualTreatment('');
                const defaultTag = tags.includes('矯正諮詢') ? '矯正諮詢' : (tags[0] || '其他');
                setFormData({
                    source: 'Line',
                    marketingTag: defaultTag,
                    isVisited: false,
                    isClosed: false,
                    dealAmount: 0,
                    consultant: ''
                });
            }
        } catch (e) {
            console.error("Failed to load NP data", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        const patientName = row ? row.patientName : manualPatientName;
        const treatment = row ? row.treatmentContent : manualTreatment;

        if (!patientName) {
            alert("請輸入病患姓名");
            return;
        }

        setIsSaving(true);
        try {
            // Ensure numbers are numbers and undefined is handled
            const dealAmount = Number(formData.dealAmount) || 0;
            const isClosed = !!formData.isClosed;
            // Logic: If closed, must be visited
            const isVisited = isClosed ? true : !!formData.isVisited;

            const record: NPRecord = {
                date,
                clinicId,
                patientName: patientName,
                treatment: treatment || '',
                marketingTag: formData.marketingTag || '其他',
                source: formData.source || '其他',
                isVisited,
                isClosed,
                dealAmount,
                consultant: formData.consultant || '',
                updatedAt: new Date().toISOString(),
                calendarNote: formData.calendarNote // Preserve existing note if present
            };

            await saveNPRecord(record);
            onClose();
        } catch (e) {
            alert("儲存失敗: 請檢查網路連線");
            console.error(e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleClosedChange = (checked: boolean) => {
        setFormData(prev => ({
            ...prev,
            isClosed: checked,
            // Auto-check visited if closed
            isVisited: checked ? true : prev.isVisited
        }));
    };

    // --- Tag Management Handlers ---
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
        if (formData.isClosed) {
            return <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold border border-emerald-200">已成交</span>;
        }
        if (formData.isVisited) {
            return <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold border border-blue-200">已報到</span>;
        }
        return <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold border border-slate-200">未到診</span>;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-down flex flex-col max-h-[85vh]">
                <div className="bg-indigo-600 text-white p-4 flex justify-between items-center shrink-0">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <Tag size={20} className="text-indigo-200" />
                        {row ? 'NP 追蹤設定' : '新增 NP 紀錄'}
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
                            {/* Patient Info Section */}
                            {row ? (
                                <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100 mb-2">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-bold text-indigo-900 text-lg">{row.patientName}</span>
                                        {renderStatusBadge()}
                                    </div>
                                    <div className="text-xs text-indigo-700 truncate">{row.treatmentContent || '無療程內容'}</div>
                                    {formData.calendarNote && (
                                        <div className="mt-2 pt-2 border-t border-indigo-200/50 flex items-start gap-2 text-xs text-indigo-800">
                                            <FileText size={12} className="mt-0.5 shrink-0" />
                                            <span className="opacity-80 break-words">{formData.calendarNote}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-200 mb-2">
                                    <div className="flex justify-between items-start mb-1">
                                        <label className="block text-xs font-bold text-slate-500 mb-1">病患姓名</label>
                                        {renderStatusBadge()}
                                    </div>
                                    <div>
                                        <input 
                                            className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                            value={manualPatientName}
                                            onChange={e => setManualPatientName(e.target.value)}
                                            placeholder="請輸入姓名"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 mb-1">療程內容</label>
                                        <input 
                                            className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                            value={manualTreatment}
                                            onChange={e => setManualTreatment(e.target.value)}
                                            placeholder="例如: 植牙諮詢"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 gap-4">
                                {/* MARKETING TAG */}
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs font-bold text-slate-500 flex items-center gap-1">
                                            <Tag size={12}/> 行銷項目 (Tag)
                                        </label>
                                        <button 
                                            onClick={() => setIsEditingTags(!isEditingTags)}
                                            className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center gap-1"
                                        >
                                            <Settings size={10} /> {isEditingTags ? '完成編輯' : '編輯選項'}
                                        </button>
                                    </div>

                                    {isEditingTags ? (
                                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 space-y-2">
                                            <div className="flex gap-2">
                                                <input 
                                                    className="flex-1 border rounded px-2 py-1 text-sm outline-none"
                                                    placeholder="新標籤..."
                                                    value={newTagInput}
                                                    onChange={e => setNewTagInput(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                                                />
                                                <button onClick={handleAddTag} className="bg-indigo-600 text-white px-2 rounded hover:bg-indigo-700"><Plus size={14}/></button>
                                            </div>
                                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                                {marketingTags.map(tag => (
                                                    <span key={tag} className="bg-white border px-2 py-1 rounded text-xs flex items-center gap-1">
                                                        {tag}
                                                        <button onClick={() => handleDeleteTag(tag)} className="text-rose-400 hover:text-rose-600"><X size={10}/></button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <select 
                                            className="w-full border rounded px-3 py-2 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                            value={formData.marketingTag}
                                            onChange={e => setFormData({...formData, marketingTag: e.target.value})}
                                        >
                                            {marketingTags.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                        <MessageCircle size={12}/> 來源管道 (Source)
                                    </label>
                                    <select 
                                        className="w-full border rounded px-3 py-2 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={formData.source}
                                        onChange={e => setFormData({...formData, source: e.target.value})}
                                    >
                                        {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                    <User size={12}/> 負責諮詢師 (Consultant)
                                </label>
                                <select 
                                    className="w-full border rounded px-3 py-2 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={formData.consultant}
                                    onChange={e => setFormData({...formData, consultant: e.target.value})}
                                >
                                    <option value="">未指定</option>
                                    {consultants.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>

                            {/* Status Toggles */}
                            <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
                                <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${formData.isVisited ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}>
                                    <input 
                                        type="checkbox" 
                                        className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                                        checked={formData.isVisited}
                                        onChange={e => setFormData({...formData, isVisited: e.target.checked})}
                                        disabled={formData.isClosed} // Locked if closed
                                    />
                                    <span className={`font-bold ${formData.isVisited ? 'text-blue-700' : 'text-slate-600'}`}>
                                        是否到診 (Visited)
                                    </span>
                                </label>

                                <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${formData.isClosed ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                                    <input 
                                        type="checkbox" 
                                        className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300"
                                        checked={formData.isClosed}
                                        onChange={e => handleClosedChange(e.target.checked)}
                                    />
                                    <span className={`font-bold ${formData.isClosed ? 'text-emerald-700' : 'text-slate-600'}`}>
                                        是否成交 (Closed)
                                    </span>
                                </label>
                            </div>

                            {formData.isClosed && (
                                <div className="animate-fade-in pl-1">
                                    <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                        <DollarSign size={12}/> 成交金額
                                    </label>
                                    <input 
                                        type="number"
                                        className="w-full border rounded px-3 py-2 text-lg font-bold text-indigo-700 outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={formData.dealAmount}
                                        onChange={e => setFormData({...formData, dealAmount: Number(e.target.value)})}
                                        placeholder="0"
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-bold" disabled={isSaving}>
                        取消
                    </button>
                    <button 
                        onClick={handleSave} 
                        disabled={isSaving || isLoading}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-md flex items-center gap-2"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        儲存紀錄
                    </button>
                </div>
            </div>
        </div>
    );
};
