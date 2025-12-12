import React, { useMemo } from 'react';
import { AccountingRow } from '../types';
import { X, DollarSign, Stethoscope, ShoppingBag } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    staffName: string;
    staffId: string;
    month: string;
    rawRows: AccountingRow[];
}

export const BonusDetailModal: React.FC<Props> = ({ isOpen, onClose, staffName, staffId, month, rawRows }) => {
    if (!isOpen) return null;

    const { selfPayData, retailData, totals } = useMemo(() => {
        const selfPay: AccountingRow[] = [];
        const retail: AccountingRow[] = [];
        let selfPayTotal = 0;
        let retailTotal = 0;

        // 正規化目標名字，避免空白鍵干擾
        const targetName = (staffName || '').trim();

        rawRows.forEach(row => {
            // --- 1. Self Pay Logic ---
            const t = row.treatments;
            const selfPaySum = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + 
                               (t.sov || 0) + (t.perio || 0) + (t.whitening || 0) + 
                               (t.inv || 0) + (t.otherSelfPay || 0);
            
            // 雙重比對：ID 或 Name
            const rowConsultant = (t.consultant || '').trim();
            const isSelfPayMatch = (rowConsultant === staffId || rowConsultant === targetName);
            
            if (selfPaySum > 0 && isSelfPayMatch) {
                selfPay.push(row);
                selfPayTotal += selfPaySum;
            }

            // --- 2. Retail Logic ---
            const r = row.retail;
            const retailSum = (r.products || 0) + (r.diyWhitening || 0);
            
            // Logic matches AssistantBonus: Explicit Staff OR Fallback to Consultant
            const rowRetailer = (r.staff || t.consultant || '').trim();
            
            // 雙重比對：ID 或 Name
            const isRetailMatch = (rowRetailer === staffId || rowRetailer === targetName);
            
            if (retailSum > 0 && isRetailMatch) {
                retail.push(row);
                retailTotal += retailSum;
            }
        });

        // Sort by Doctor then Date
        const sorter = (a: AccountingRow, b: AccountingRow) => {
            const docDiff = a.doctorName.localeCompare(b.doctorName);
            if (docDiff !== 0) return docDiff;
            return (a.originalDate || a.startTime || '').localeCompare(b.originalDate || b.startTime || '');
        };

        selfPay.sort(sorter);
        retail.sort(sorter);

        const selfPayBonus = Math.round(selfPayTotal * 0.01);
        const retailBonus = Math.round(retailTotal * 0.1);

        return {
            selfPayData: selfPay,
            retailData: retail,
            totals: {
                selfPayRevenue: selfPayTotal,
                retailRevenue: retailTotal,
                selfPayBonus,
                retailBonus,
                grandTotalBonus: selfPayBonus + retailBonus
            }
        };
    }, [rawRows, staffId, staffName]); // Added staffName to dependencies

    const getRowDate = (r: AccountingRow) => (r.originalDate || r.startTime?.split('T')[0] || '-').slice(5);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-fade-in">
                {/* Header */}
                <div className="bg-slate-900 text-white p-4 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <span className="text-teal-400">{staffName}</span> 獎金明細
                        </h3>
                        <p className="text-sm text-slate-400 font-mono">{month}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50">
                    {/* Section A: Self-Pay */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                            <h4 className="font-bold text-indigo-800 flex items-center gap-2">
                                <Stethoscope size={18} /> 自費療程 (Self-Pay)
                            </h4>
                            <span className="text-xs font-bold text-indigo-400 bg-white px-2 py-1 rounded border border-indigo-100">
                                獎金 1%
                            </span>
                        </div>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase border-b border-slate-100">
                                <tr>
                                    <th className="px-4 py-2 w-16">日期</th>
                                    <th className="px-4 py-2 w-24">病患</th>
                                    <th className="px-4 py-2 w-24">醫師</th>
                                    <th className="px-4 py-2">療程內容</th>
                                    <th className="px-4 py-2 text-right w-24">金額</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {selfPayData.map((row) => {
                                    const t = row.treatments;
                                    const amount = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + (t.sov || 0) + (t.perio || 0) + (t.whitening || 0) + (t.inv || 0) + (t.otherSelfPay || 0);
                                    return (
                                        <tr key={row.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-2 font-mono text-slate-500">{getRowDate(row)}</td>
                                            <td className="px-4 py-2 font-medium text-slate-700">{row.patientName}</td>
                                            <td className="px-4 py-2 text-slate-600">{row.doctorName}</td>
                                            <td className="px-4 py-2 text-slate-500 truncate max-w-[200px] text-xs">{row.treatmentContent}</td>
                                            <td className="px-4 py-2 text-right font-mono font-bold text-slate-700">{amount.toLocaleString()}</td>
                                        </tr>
                                    )
                                })}
                                {selfPayData.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400 text-xs">無紀錄</td></tr>}
                            </tbody>
                            <tfoot className="bg-indigo-50 font-bold text-indigo-900 border-t border-indigo-100">
                                <tr>
                                    <td colSpan={4} className="px-4 py-2 text-right">總業績</td>
                                    <td className="px-4 py-2 text-right">${totals.selfPayRevenue.toLocaleString()}</td>
                                </tr>
                                <tr>
                                    <td colSpan={4} className="px-4 py-2 text-right text-xs uppercase tracking-wider opacity-70">獎金試算 (1%)</td>
                                    <td className="px-4 py-2 text-right text-lg">${totals.selfPayBonus.toLocaleString()}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Section B: Retail */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 bg-orange-50 border-b border-orange-100 flex justify-between items-center">
                            <h4 className="font-bold text-orange-800 flex items-center gap-2">
                                <ShoppingBag size={18} /> 物販/小金庫 (Retail)
                            </h4>
                            <span className="text-xs font-bold text-orange-400 bg-white px-2 py-1 rounded border border-orange-100">
                                獎金 10%
                            </span>
                        </div>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase border-b border-slate-100">
                                <tr>
                                    <th className="px-4 py-2 w-16">日期</th>
                                    <th className="px-4 py-2 w-24">病患</th>
                                    <th className="px-4 py-2 w-24">醫師</th>
                                    <th className="px-4 py-2">品項內容</th>
                                    <th className="px-4 py-2 text-right w-24">金額</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {retailData.map((row) => {
                                    const r = row.retail;
                                    const amount = (r.products || 0) + (r.diyWhitening || 0);
                                    return (
                                        <tr key={row.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-2 font-mono text-slate-500">{getRowDate(row)}</td>
                                            <td className="px-4 py-2 font-medium text-slate-700">{row.patientName}</td>
                                            <td className="px-4 py-2 text-slate-600">{row.doctorName}</td>
                                            <td className="px-4 py-2 text-slate-500 truncate max-w-[200px] text-xs">
                                                {row.retailItem || r.productNote || '零售項目'}
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono font-bold text-slate-700">{amount.toLocaleString()}</td>
                                        </tr>
                                    )
                                })}
                                {retailData.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400 text-xs">無紀錄</td></tr>}
                            </tbody>
                            <tfoot className="bg-orange-50 font-bold text-orange-900 border-t border-orange-100">
                                <tr>
                                    <td colSpan={4} className="px-4 py-2 text-right">總業績</td>
                                    <td className="px-4 py-2 text-right">${totals.retailRevenue.toLocaleString()}</td>
                                </tr>
                                <tr>
                                    <td colSpan={4} className="px-4 py-2 text-right text-xs uppercase tracking-wider opacity-70">獎金試算 (10%)</td>
                                    <td className="px-4 py-2 text-right text-lg">${totals.retailBonus.toLocaleString()}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                {/* Footer Grand Total */}
                <div className="bg-slate-900 text-white p-4 shrink-0 flex justify-between items-center">
                    <div className="text-sm opacity-70">總獎金 = 自費獎金 + 物販獎金</div>
                    <div className="flex items-center gap-3">
                        <span className="text-lg font-bold">總計發放</span>
                        <span className="text-3xl font-black text-emerald-400 flex items-center">
                            <DollarSign size={24} strokeWidth={3} />
                            {totals.grandTotalBonus.toLocaleString()}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};