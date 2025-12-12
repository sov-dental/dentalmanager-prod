
import React from 'react';
import { AuditLogEntry } from '../types';
import { X, History, Lock, Unlock, Edit2 } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    logs: AuditLogEntry[];
}

export const AuditLogModal: React.FC<Props> = ({ isOpen, onClose, logs }) => {
    if (!isOpen) return null;

    const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-md animate-fade-in flex flex-col max-h-[80vh]">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <History size={18} className="text-slate-500" /> 異動紀錄 (Audit Log)
                    </h3>
                    <button onClick={onClose}><X className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4">
                    {sortedLogs.length === 0 ? (
                        <div className="text-center text-slate-400 py-8 text-sm">無紀錄</div>
                    ) : (
                        <div className="space-y-3">
                            {sortedLogs.map((log, idx) => (
                                <div key={idx} className="flex gap-3 text-sm p-3 hover:bg-slate-50 rounded-lg transition-colors border border-slate-100 shadow-sm">
                                    <div className="mt-1">
                                        {log.action === 'LOCK' && <Lock size={16} className="text-emerald-500" />}
                                        {log.action === 'UNLOCK' && <Unlock size={16} className="text-rose-500" />}
                                        {log.action === 'UPDATE' && <Edit2 size={16} className="text-blue-500" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className={`font-bold ${log.action === 'LOCK' ? 'text-emerald-700' : log.action === 'UNLOCK' ? 'text-rose-700' : 'text-slate-700'}`}>
                                                {log.action === 'LOCK' ? '結帳鎖定' : log.action === 'UNLOCK' ? '解鎖' : '修改內容'}
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                                                {new Date(log.timestamp).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                            由 <span className="font-medium text-slate-900 bg-slate-100 px-1 rounded">{log.userName}</span> 操作
                                        </div>
                                        {log.details && (
                                            <div className="text-xs text-slate-500 mt-1.5 pl-2 border-l-2 border-slate-200 italic break-words">
                                                {log.details}
                                            </div>
                                        )}
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
