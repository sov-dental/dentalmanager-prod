
import React from 'react';
import { useClinic } from '../contexts/ClinicContext';
import { ChevronDown, AlertCircle, Building2 } from 'lucide-react';

interface Props {
  className?: string;
  disabled?: boolean;
}

export const ClinicSelector: React.FC<Props> = ({ className, disabled }) => {
  const { clinics, selectedClinicId, setSelectedClinicId } = useClinic();

  // 1. No Access State
  if (!clinics || clinics.length === 0) {
      return (
        <div className={`flex items-center gap-2 text-slate-400 text-xs border border-slate-200 bg-slate-50 px-3 py-1.5 rounded-lg ${className}`}>
            <AlertCircle size={14} />
            <span className="font-medium">無可用診所</span>
        </div>
      );
  }

  // 2. Single Clinic State (Read-Only UI)
  // Cleaner experience for staff who only work at one location
  if (clinics.length === 1) {
      return (
          <div className={`flex items-center gap-2 px-1 ${className}`}>
              <Building2 size={18} className="text-teal-600" />
              <span className="font-bold text-lg text-slate-800 tracking-tight">
                  {clinics[0].name}
              </span>
          </div>
      );
  }

  // 3. Multi-Clinic State (Dropdown UI)
  // For Admins or Staff working at multiple locations
  return (
    <div className={`relative group ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
        <select
            className={`appearance-none bg-transparent font-bold text-slate-700 outline-none pr-8 pl-1 hover:text-indigo-600 transition-colors w-full cursor-pointer py-1 text-lg`}
            value={selectedClinicId}
            onChange={(e) => setSelectedClinicId(e.target.value)}
            disabled={disabled}
        >
            {clinics.map(c => (
                <option key={c.id} value={c.id}>
                    {c.name}
                </option>
            ))}
        </select>
        {!disabled && (
            <ChevronDown size={16} className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-indigo-500" />
        )}
    </div>
  );
};
