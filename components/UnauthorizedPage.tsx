import React from 'react';
import { LogOut, ShieldAlert } from 'lucide-react';

interface Props {
  email: string | null | undefined;
  onLogout: () => void;
}

export const UnauthorizedPage: React.FC<Props> = ({ email, onLogout }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl border border-rose-100 max-w-md w-full text-center animate-fade-in">
        <div className="mb-4 flex justify-center text-rose-500">
             <ShieldAlert size={64} />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">存取被拒 (Access Denied)</h1>
        <p className="text-slate-500 mb-6">
          您的帳號 <span className="font-mono font-medium text-slate-700 bg-slate-100 px-1 rounded">{email}</span> 未被授權使用此系統。
        </p>
        
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 mb-8 text-sm text-rose-700 text-left">
           <strong>注意：</strong> 請聯繫診所管理員將您的 Email 加入白名單 (Allowed Users)。
        </div>

        <button
          onClick={onLogout}
          className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <LogOut size={18} />
          登出並切換帳號
        </button>
      </div>
    </div>
  );
};