import React, { useState, useEffect, memo } from 'react';
import { AccountingRow, Doctor, Consultant, Laboratory, NPRecord } from '../types';
import { Tag, CheckCircle, Circle, Trash2 } from 'lucide-react';

const PUBLIC_DOCTOR = {
  id: 'clinic_public',
  name: '診所 (Public)',
  avatarText: '診',
  avatarColor: '#94a3b8' // Slate-400 (Gray)
};

const safeNum = (val: any) => (isNaN(Number(val)) ? 0 : Number(val));

const InputCell = ({ 
    initialValue, 
    onCommit, 
    className = "", 
    placeholder = "",
    type = "text",
    align = "left",
    disabled = false
}: { 
    initialValue: any, 
    onCommit: (val: any) => void, 
    className?: string, 
    placeholder?: string, 
    type?: "text" | "number",
    align?: "left" | "right" | "center",
    disabled?: boolean
}) => {
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const handleBlur = () => {
        if (value != initialValue) {
            onCommit(value);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
        }
    };

    const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

    return (
        <input
            type={type}
            disabled={disabled}
            className={`w-full bg-transparent outline-none px-1 py-1 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 rounded-sm transition-colors placeholder-slate-500 ${alignClass} ${className} ${disabled ? 'cursor-not-allowed text-slate-400' : ''}`}
            value={value === 0 && type === 'number' ? '' : value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
        />
    );
};

interface RowProps {
    row: AccountingRow;
    index: number;
    isLocked: boolean;
    clinicDocs: Doctor[];
    clinicLabs: Laboratory[];
    consultantOptions: Consultant[];
    staffOptions: Consultant[];
    npRec: NPRecord | undefined;
    onUpdate: (id: string, updates: Partial<AccountingRow> | any) => void;
    onDelete: (id: string) => void;
    onOpenNPModal: (row: AccountingRow) => void;
}

const DailyAccountingRow: React.FC<RowProps> = ({
    row, index, isLocked, clinicDocs, clinicLabs, consultantOptions, staffOptions, npRec, onUpdate, onDelete, onOpenNPModal
}) => {
    // Add local state for sortOrder to allow typing
    const [localSortOrder, setLocalSortOrder] = useState(row.sortOrder || 0);

    useEffect(() => {
        setLocalSortOrder(row.sortOrder || 0);
    }, [row.sortOrder]);

    const totalAmount = (row.treatments.regFee||0) + (row.treatments.copayment||0) + 
                    (row.treatments.prostho||0) + (row.treatments.implant||0) + (row.treatments.ortho||0) + 
                    (row.treatments.sov||0) + (row.treatments.inv||0) + (row.treatments.perio||0) + 
                    (row.treatments.whitening||0) + (row.treatments.otherSelfPay||0) + 
                    (row.retail.products||0) + (row.retail.diyWhitening||0);
    
    const isChartIdLocked = isLocked || (!row.isManual && !!row.chartId && row.chartId !== 'NP');
    const isNP = (row as any).isNP === true || (row.npStatus && typeof row.npStatus === 'string' && row.npStatus.toUpperCase().includes('NP')) || ((row as any).note && typeof (row as any).note === 'string' && (row as any).note.toUpperCase().includes('NP'));
    
    let btnClass = "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"; 
    let btnIcon = <Tag size={12} />;
    if (npRec) {
        if (npRec.isClosed) btnClass = "bg-emerald-100 border-emerald-200 text-emerald-700 hover:bg-emerald-200";
        else if (npRec.isVisited) btnClass = "bg-blue-100 border-blue-200 text-blue-700 hover:bg-blue-200";
    }

    const getPatientNameClass = (row: AccountingRow) => {
        const base = "text-lg font-bold";
        if (row.isManual) return `${base} text-blue-600`;
        if (!row.attendance) return `${base} text-gray-100 font-medium`; 
        const t = row.treatments;
        const r = row.retail;
        const highValue = (t.prostho||0) + (t.implant||0) + (t.ortho||0) + (t.sov||0) + (t.inv||0) + (t.perio||0) + (t.whitening||0) + (t.otherSelfPay||0) +
                          (r.products||0) + (r.diyWhitening||0);
        return highValue > 0 ? `${base} text-gray-900` : `${base} text-red-500`;
    };

    const getDoctorColor = (docId: string) => {
        if (docId === 'clinic_public') return PUBLIC_DOCTOR.avatarColor;
        const doc = clinicDocs.find(d => d.id === docId);
        return doc?.avatarBgColor || doc?.color || '#cbd5e1';
    };

    const getDoctorAvatarText = (docId: string, docName: string) => {
        if (docId === 'clinic_public') return PUBLIC_DOCTOR.avatarText;
        const doc = clinicDocs.find(d => d.id === docId);
        if (doc?.avatarText) return doc.avatarText;
        return docName ? docName.substring(0, 2) : '?';
    };

    return (
        <tr className="hover:bg-blue-50/30 group">
            <td className="px-1 py-1 border-r border-gray-200 text-center sticky left-0 bg-white group-hover:bg-blue-50/30 z-30 w-8 min-w-[32px]">
                <div className="flex flex-col items-center gap-1">
                    <button onClick={() => onUpdate(row.id, { attendance: !row.attendance })} className="transition-colors" disabled={isLocked}>
                        {row.attendance ? <CheckCircle size={14} className="text-emerald-500" /> : <Circle size={14} className="text-slate-300" />}
                    </button>
                    <div className="mt-1 flex justify-center">
                        {row.isManual ? (
                            <input
                                type="number"
                                className="w-8 text-center text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded outline-none focus:ring-1 focus:ring-blue-400 p-0"
                                value={localSortOrder}
                                onChange={(e) => setLocalSortOrder(Number(e.target.value))}
                                onBlur={() => onUpdate(row.id, { sortOrder: localSortOrder })}
                                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                                disabled={isLocked}
                            />
                        ) : (
                            <span className="text-[10px] text-slate-400 font-mono">
                                {row.sortOrder || 0}
                            </span>
                        )}
                    </div>
                </div>
            </td>
            <td className="px-1 py-1 border-r border-gray-200 sticky left-[32px] bg-white group-hover:bg-blue-50/30 z-30 align-middle min-w-[80px]">
                <InputCell initialValue={row.chartId} onCommit={(v) => onUpdate(row.id, { chartId: v })} className={`text-slate-700 font-mono text-[11px] ${isChartIdLocked ? 'bg-slate-50' : ''}`} placeholder="病歷號" disabled={isChartIdLocked} />
            </td>
            <td className="px-1 py-1 border-r border-gray-200 sticky left-[114px] bg-white group-hover:bg-blue-50/30 z-30 align-middle min-w-[112px]">
                <InputCell initialValue={row.patientName} onCommit={(v) => onUpdate(row.id, { patientName: v })} className={getPatientNameClass(row)} disabled={isLocked} />
            </td>
            <td className="px-1 py-1 border-r-2 border-gray-300 sticky left-[226px] bg-white group-hover:bg-blue-50/30 z-30 text-center align-middle min-w-[112px]">
                {row.isManual || (row as any).isPublicCalendar ? (
                    <select className="w-full bg-transparent text-xs outline-none text-slate-700 font-medium text-right" dir="rtl" value={row.doctorId} onChange={(e) => { const val = e.target.value; const name = val === 'clinic_public' ? PUBLIC_DOCTOR.name : (clinicDocs.find(d=>d.id===val)?.name||''); onUpdate(row.id, { doctorId: val, doctorName: name }); }} disabled={isLocked}>
                        <option value="">選醫師</option><option value="clinic_public">診所 (Public)</option>{clinicDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                ) : (
                    <div className="flex items-center gap-2 justify-end pr-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] text-white font-bold shrink-0" style={{ backgroundColor: getDoctorColor(row.doctorId) }}>{getDoctorAvatarText(row.doctorId, row.doctorName)}</div>
                        <span className="text-xs text-slate-700 font-medium truncate max-w-[60px] text-right">{row.doctorName}</span>
                    </div>
                )}
            </td>
            <td className="px-1 py-1 border-r border-gray-200 bg-blue-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-blue-600 font-mono text-[14px]" initialValue={row.treatments.regFee} onCommit={(v) => onUpdate(row.id, { treatments: { regFee: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-blue-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-blue-600 font-mono text-[14px]" initialValue={row.treatments.copayment} onCommit={(v) => onUpdate(row.id, { treatments: { copayment: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.prostho} onCommit={(v) => onUpdate(row.id, { treatments: { prostho: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.implant} onCommit={(v) => onUpdate(row.id, { treatments: { implant: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.ortho} onCommit={(v) => onUpdate(row.id, { treatments: { ortho: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.sov} onCommit={(v) => onUpdate(row.id, { treatments: { sov: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.inv} onCommit={(v) => onUpdate(row.id, { treatments: { inv: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.perio} onCommit={(v) => onUpdate(row.id, { treatments: { perio: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.whitening} onCommit={(v) => onUpdate(row.id, { treatments: { whitening: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-purple-600 font-mono text-[14px]" initialValue={row.treatments.otherSelfPay} onCommit={(v) => onUpdate(row.id, { treatments: { otherSelfPay: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-purple-50/10"><select className="w-full bg-transparent text-xs text-slate-600 outline-none" value={row.treatments.consultant || ''} onChange={(e) => onUpdate(row.id, { treatments: { consultant: e.target.value } })} disabled={isLocked}><option value=""></option>{consultantOptions.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-orange-600 font-mono text-[14px]" initialValue={row.retail.diyWhitening} onCommit={(v) => onUpdate(row.id, { retail: { diyWhitening: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell disabled={isLocked} type="number" align="right" className="text-orange-600 font-mono text-[14px]" initialValue={row.retail.products} onCommit={(v) => onUpdate(row.id, { retail: { products: safeNum(v) } })} /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><InputCell disabled={isLocked} initialValue={row.retailItem} onCommit={(v) => onUpdate(row.id, { retailItem: v })} placeholder="品項" /></td>
            <td className="px-1 py-1 border-r border-gray-200 bg-orange-50/10"><select className="w-full bg-transparent text-xs text-slate-600 outline-none" value={row.retail.staff || ''} onChange={(e) => onUpdate(row.id, { retail: { staff: e.target.value } })} disabled={isLocked}><option value=""></option>{staffOptions.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></td>
            <td className="px-2 py-1 border-r border-gray-200 bg-emerald-50/10 text-right font-black text-emerald-600 text-lg font-bold">{totalAmount > 0 ? totalAmount.toLocaleString() : '-'}</td>
            <td className="px-1 py-1 border-r border-gray-200 bg-emerald-50/10"><select className={`w-full bg-transparent text-[10px] font-bold outline-none uppercase text-center ${row.paymentMethod === 'card' ? 'text-pink-600' : row.paymentMethod === 'transfer' ? 'text-amber-600' : 'text-emerald-600'} ${isLocked ? 'opacity-50' : ''}`} value={row.paymentMethod} onChange={(e) => onUpdate(row.id, { paymentMethod: e.target.value })} disabled={isLocked}><option value="cash">CASH</option><option value="card">CARD</option><option value="transfer">TRANS</option></select></td>
            <td className="px-1 py-1 border-r border-gray-200 text-center align-middle">{isNP ? (<button onClick={() => onOpenNPModal(row)} className={`w-full ${btnClass} border px-1 py-1 rounded text-xs font-bold flex items-center justify-center gap-1 transition-colors`}>{btnIcon} NP</button>) : (<InputCell initialValue={row.npStatus || (row as any).note || ""} onCommit={(v) => onUpdate(row.id, { npStatus: v })} />)}</td>
            <td className="px-1 py-1 border-r border-gray-200 "><InputCell initialValue={row.treatmentContent} onCommit={(v) => onUpdate(row.id, { treatmentContent: v })} placeholder={row.calendarTreatment} /></td>
            <td className="px-1 py-1 border-r border-gray-200"><select className="w-full bg-transparent text-xs outline-none text-slate-600" value={row.labName || ''} onChange={(e) => onUpdate(row.id, { labName: e.target.value })}><option value=""></option>{clinicLabs.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}</select></td>
            <td className="px-1 py-1 text-center">{row.isManual && !isLocked && (<button onClick={() => onDelete(row.id)} className="text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>)}</td>
        </tr>
    );
};

export default memo(DailyAccountingRow, (prev, next) => {
    return (
        prev.row === next.row &&
        prev.isLocked === next.isLocked &&
        prev.index === next.index &&
        prev.npRec === next.npRec &&
        prev.clinicDocs === next.clinicDocs &&
        prev.clinicLabs === next.clinicLabs &&
        prev.consultantOptions === next.consultantOptions &&
        prev.staffOptions === next.staffOptions
    );
});