import React from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  onLogin: () => void;
  isLoggingIn: boolean;
}

export const LoginPage: React.FC<Props> = ({ onLogin, isLoggingIn }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 max-w-md w-full text-center animate-fade-in">
        <div className="mb-6 flex justify-center">
             <span className="text-6xl">🦷</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">日不落牙醫排班系統</h1>
        <p className="text-slate-500 mb-8">請登入以管理診所排班與設定</p>
        
        <button
          onClick={onLogin}
          disabled={isLoggingIn}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-teal-200"
        >
          {isLoggingIn ? (
            <>
                <Loader2 className="animate-spin" /> 登入中...
            </>
          ) : (
            <>
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5 bg-white rounded-full p-0.5" alt="" />
                使用 Google 帳號登入
            </>
          )}
        </button>
      </div>
    </div>
  );
};