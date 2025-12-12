
import React, { useState, useEffect } from 'react';
import { Loader2, Lock, AlertTriangle, CheckCircle } from 'lucide-react';
import { AccountingRow } from '../types';
import { checkPreviousUnlocked } from '../services/firebase';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    date: string;
    clinicId: string;
    rows: AccountingRow[];
    totals: { cash: number; card: number; transfer: number; total: number; };
}

export const ClosingSummaryModal: React.FC<Props> = ({ isOpen, onClose, onConfirm, date, clinicId, rows, totals }) => {
    const [unlockedDates, setUnlockedDates] = useState<string[]>([]);
    const [checking, setChecking] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setChecking(true);
            checkPreviousUnlocked(date, clinicId).then(dates => {
                setUnlockedDates(dates);
                setChecking(false);
            });
        }
    }, [isOpen, date, clinicId]);

    const handleConfirm = async () => {
        setIsProcessing(true);
        await onConfirm();
        setIsProcessing(false);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-down">
                <div className="bg-slate-900 text-white p-4 flex justify-between items-center">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <Lock size={20} className="text-emerald-400" />
                        日結帳確認 (Closing)
                    </h3>
                </div>

                <div className="p-6 space-y-6">
                    {/* 1. Date Check */}
                    {checking ? (
                        <div className="text-sm text-slate-500 flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin" /> 檢查前期帳務中...
                        </div>
                    ) : unlockedDates.length > 0 ? (
                        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">
                            <div className="font-bold flex items-center gap-2 mb-1">
                                <AlertTriangle size={16} /> 注意：前期尚未結帳
                            </div>
                            <p>以下日期尚未鎖定，建議依序結帳：</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                                {unlockedDates.slice(0, 5).map(d => (
                                    <span key={d} className="bg-white px-2 py-0.5 rounded border border-rose-200 text-xs font-mono">{d}</span>
                                ))}
                                {unlockedDates.length > 5 && <span>...等 {unlockedDates.length} 天</span>}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700 flex items-center gap-2">
                            <CheckCircle size={16} /> 前期帳務皆已鎖定，可安心結帳。
                        </div>
                    )}

                    {/* 2. Financial Summary */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider">本日營收總結</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                <span className="text-xs text-slate-400 block mb-1">現金 (Cash)</span>
                                <span className="text-xl font-bold text-slate-700">${totals.cash.toLocaleString()}</span>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                <span className="text-xs text-slate-400 block mb-1">刷卡 (Card)</span>
                                <span className="text-xl font-bold text-slate-700">${totals.card.toLocaleString()}</span>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                <span className="text-xs text-slate-400 block mb-1">匯款 (Transfer)</span>
                                <span className="text-xl font-bold text-slate-700">${totals.transfer.toLocaleString()}</span>
                            </div>
                            <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                                <span className="text-xs text-indigo-400 block mb-1">總計 (Total)</span>
                                <span className="text-xl font-bold text-indigo-700">${totals.total.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    <div className="text-xs text-slate-400 bg-slate-50 p-3 rounded">
                        <strong>鎖定後：</strong> 財務金額與病患資料將無法修改。資料將同步至 CRM 病歷系統。
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                    <button 
                        onClick={onClose} 
                        className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium"
                        disabled={isProcessing}
                    >
                        取消
                    </button>
                    <button 
                        onClick={handleConfirm}
                        disabled={isProcessing}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md transition-transform active:scale-95 disabled:opacity-50"
                    >
                        {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
                        確認結帳鎖定
                    </button>
                </div>
            </div>
        </div>
    );
};
