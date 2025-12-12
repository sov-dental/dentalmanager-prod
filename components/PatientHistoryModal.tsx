
import React, { useState, useEffect } from 'react';
import { Patient } from '../services/firebase';
import { getPatientHistory } from '../services/firebase';
import { X, Calendar, Stethoscope, Loader2, DollarSign, User } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    patient: Patient | null;
}

export const PatientHistoryModal: React.FC<Props> = ({ isOpen, onClose, patient }) => {
    const [history, setHistory] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen && patient) {
            loadHistory();
        }
    }, [isOpen, patient]);

    const loadHistory = async () => {
        if (!patient) return;
        setIsLoading(true);
        try {
            const data = await getPatientHistory(patient.clinicId, patient.name, patient.chartId);
            setHistory(data);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen || !patient) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-slide-down flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="bg-slate-900 text-white p-4 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <Stethoscope size={20} className="text-teal-400" />
                            病歷紀錄 (History)
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-slate-400 mt-1">
                            <span className="bg-slate-800 px-2 py-0.5 rounded text-white font-bold">{patient.name}</span>
                            {patient.chartId && <span className="font-mono bg-slate-800 px-2 py-0.5 rounded text-teal-300">{patient.chartId}</span>}
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-full hover:bg-slate-800">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <Loader2 size={32} className="animate-spin mb-2 text-teal-600" />
                            <p>正在搜尋最近六個月紀錄...</p>
                        </div>
                    ) : history.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl m-4">
                            <Calendar size={48} className="text-slate-200 mb-4" />
                            <p className="font-medium">查無近期看診紀錄</p>
                            <p className="text-xs mt-1 text-slate-400">(僅顯示最近 180 天內資料)</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {history.map((record, idx) => (
                                <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 hover:border-teal-200 transition-colors group">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-slate-100 text-slate-600 px-3 py-1 rounded-lg text-sm font-bold font-mono flex items-center gap-2 border border-slate-200">
                                                <Calendar size={14} /> {record.date}
                                            </div>
                                            <div className="flex items-center gap-1 text-sm font-bold text-slate-700 bg-indigo-50 px-2 py-1 rounded text-indigo-700">
                                                <User size={14} /> {record.doctor}
                                            </div>
                                        </div>
                                        <div className="font-black text-slate-800 flex items-center gap-1 text-lg">
                                            <span className="text-xs text-slate-400 font-medium mr-1">實收</span>
                                            <DollarSign size={16} className="text-emerald-500" />
                                            {record.amount.toLocaleString()}
                                        </div>
                                    </div>
                                    
                                    <div className="text-sm text-slate-700 pl-4 border-l-4 border-slate-100 py-1 mb-3">
                                        {record.treatment || <span className="text-slate-300 italic">無療程內容</span>}
                                    </div>
                                    
                                    {/* Detailed breakdown badges */}
                                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-50">
                                        {Object.entries(record.items).map(([key, val]) => {
                                            const amount = Number(val);
                                            if (amount > 0 && key !== 'consultant') {
                                                // Human readable key map (simplified)
                                                const labelMap: Record<string, string> = {
                                                    regFee: '掛號', copayment: '部分', prostho: '假牙', 
                                                    implant: '植牙', ortho: '矯正', sov: 'SOV', inv: '隱適美',
                                                    perio: '牙周', whitening: '美白', otherSelfPay: '其他',
                                                };
                                                const label = labelMap[key] || key;
                                                return (
                                                    <span key={key} className="text-xs px-2 py-1 bg-slate-50 text-slate-600 rounded border border-slate-100 font-medium flex items-center gap-1">
                                                        {label} <span className="text-slate-400">|</span> ${amount}
                                                    </span>
                                                )
                                            }
                                            return null;
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
