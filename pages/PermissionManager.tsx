
import React, { useState, useEffect } from 'react';
import { User, Clinic, UserRole } from '../types';
import { getAllUsers, updateUserRole, updateUserClinicAccess, getRolePermissions, saveRolePermissions, getClinics } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { UnauthorizedPage } from '../components/UnauthorizedPage';
import { 
    Shield, Users, Lock, Save, Loader2, Search, CheckCircle, 
    MoreHorizontal, Building2, UserCog, Key, Check
} from 'lucide-react';

interface Props {
    // No direct props needed, fetches its own data for security
}

// Menu Items Constant (Source of Truth for Matrix)
const MENU_CONFIG_ITEMS = [
    { key: '/group-dashboard', label: '集團營運儀表板 (BI)' },
    { key: '/salary', label: '醫師薪資報表' },
    { key: '/assistant-bonus', label: '助理獎金計算' },
    { key: '/assistant-salary', label: '助理薪資結算' },
    { key: '/appointments', label: '約診日曆 (Calendar)' },
    { key: '/accounting', label: '每日帳務 (Accounting)' },
    { key: '/monthly-report', label: '月營收報表' },
    { key: '/patients', label: '病歷管理系統 (CRM)' },
    { key: '/lab-reconciliation', label: '技工所對帳' },
    { key: '/assistant-scheduling', label: '助理排班' },
    { key: '/schedule', label: '醫師排班' },
    { key: '/marketing-schedule', label: '行銷與發布' },
    { key: '/clinics', label: '診所設定' },
    { key: '/doctors', label: '醫師管理' },
    { key: '/consultants', label: '人員管理 (HR)' },
    { key: '/laboratories', label: '技工所管理' },
    { key: '/sov-referrals', label: 'SOV 轉介名單' },
    { key: '/integrations', label: '系統整合 (Google/Backup)' },
];

const ROLES: UserRole[] = ['manager', 'team_leader', 'staff', 'marketing']; // Admin is implicit

export const PermissionManager: React.FC<Props> = () => {
    const { currentUser, userRole, loading: authLoading } = useAuth();
    const [activeTab, setActiveTab] = useState<'users' | 'menu'>('users');
    const [isLoading, setIsLoading] = useState(false);
    
    // User Management State
    const [users, setUsers] = useState<User[]>([]);
    const [clinics, setClinics] = useState<Clinic[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingUser, setEditingUser] = useState<User | null>(null); // For Clinic Modal
    const [tempAllowedClinics, setTempAllowedClinics] = useState<string[]>([]);
    const [isSavingUser, setIsSavingUser] = useState(false);

    // Menu Permission State
    const [permissions, setPermissions] = useState<Record<string, string[]>>({});
    const [isSavingPerms, setIsSavingPerms] = useState(false);

    // --- ACCESS CONTROL CHECK ---
    useEffect(() => {
        console.log("[PermissionManager] Mounted. User:", currentUser?.email, "Role:", userRole);
    }, [currentUser, userRole]);

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="animate-spin text-teal-600" size={32} />
            </div>
        );
    }

    // Robust case-insensitive check for Admin access
    if (!userRole || !['admin'].includes(userRole.toLowerCase())) {
        console.warn("[PermissionManager] Access Denied. Current Role:", userRole);
        return <UnauthorizedPage email={currentUser?.email} onLogout={() => {}} />;
    }

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [allUsers, allClinics, rolePerms] = await Promise.all([
                getAllUsers(),
                getClinics(),
                getRolePermissions()
            ]);
            setUsers(allUsers);
            setClinics(allClinics);
            setPermissions(rolePerms);
        } catch (e) {
            console.error(e);
            alert("載入資料失敗");
        } finally {
            setIsLoading(false);
        }
    };

    // --- TAB 1: USER MANAGEMENT ACTIONS ---

    const handleRoleChange = async (uid: string, newRole: UserRole) => {
        if (!confirm(`確定更改此用戶權限為 ${newRole}?`)) return;
        try {
            await updateUserRole(uid, newRole);
            setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
        } catch (e) {
            alert("更新失敗");
        }
    };

    const openClinicModal = (user: User) => {
        setEditingUser(user);
        // Ensure we work with a clean array
        setTempAllowedClinics(user.allowedClinics || []);
    };

    const toggleClinicAccess = (clinicId: string) => {
        setTempAllowedClinics(prev => {
            if (prev.includes(clinicId)) {
                return prev.filter(id => id !== clinicId);
            } else {
                return [...prev, clinicId];
            }
        });
    };

    const saveClinicAccess = async () => {
        if (!editingUser) return;
        setIsSavingUser(true);
        try {
            await updateUserClinicAccess(editingUser, tempAllowedClinics);
            setUsers(prev => prev.map(u => u.uid === editingUser.uid ? { ...u, allowedClinics: tempAllowedClinics } : u));
            setEditingUser(null);
        } catch (e) {
            alert("權限同步失敗");
        } finally {
            setIsSavingUser(false);
        }
    };

    // --- TAB 2: MENU CONFIG ACTIONS ---

    const togglePermission = (role: string, menuKey: string) => {
        setPermissions(prev => {
            const currentList = prev[role] || [];
            const newList = currentList.includes(menuKey)
                ? currentList.filter(k => k !== menuKey)
                : [...currentList, menuKey];
            return { ...prev, [role]: newList };
        });
    };

    const savePermissions = async () => {
        setIsSavingPerms(true);
        try {
            await saveRolePermissions(permissions);
            alert("選單權限已更新！");
        } catch (e) {
            alert("儲存失敗");
        } finally {
            setIsSavingPerms(false);
        }
    };

    // --- RENDER HELPERS ---

    const filteredUsers = users.filter(u => 
        u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        u.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getRoleBadgeColor = (role: UserRole) => {
        switch(role) {
            case 'admin': return 'bg-rose-100 text-rose-700 border-rose-200';
            case 'manager': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
            case 'team_leader': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'marketing': return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'staff': return 'bg-teal-100 text-teal-700 border-teal-200';
            default: return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    if (isLoading) return (
        <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="animate-spin text-teal-600" size={32} />
        </div>
    );

    return (
        <div className="space-y-6 pb-20">
            {/* Header */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Shield className="text-purple-600" /> 權限管理中心
                    </h2>
                    <p className="text-slate-500 text-sm">統一管理用戶角色、診所存取權限與系統選單可見度。</p>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab('users')}
                        className={`px-6 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'users' ? 'bg-white shadow text-teal-600' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <UserCog size={16} /> 人員權限管理
                    </button>
                    <button
                        onClick={() => setActiveTab('menu')}
                        className={`px-6 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'menu' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <Lock size={16} /> 選單存取控制
                    </button>
                </div>
            </div>

            {/* TAB 1: USERS */}
            {activeTab === 'users' && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-fade-in">
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                        <div className="relative w-full max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input 
                                type="text" 
                                placeholder="搜尋姓名或 Email..." 
                                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 outline-none"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="text-sm text-slate-500 font-bold">
                            共 {filteredUsers.length} 位用戶
                        </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white text-slate-500 font-bold uppercase text-xs border-b border-slate-100">
                                <tr>
                                    <th className="px-6 py-3">用戶資訊</th>
                                    <th className="px-6 py-3">系統角色 (Role)</th>
                                    <th className="px-6 py-3">診所存取權 (Access)</th>
                                    <th className="px-6 py-3 text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredUsers.map(user => (
                                    <tr key={user.uid} className="hover:bg-slate-50">
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-slate-800 text-base">{user.name}</div>
                                            <div className="text-slate-500 text-xs font-mono">{user.email}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-1 rounded text-xs font-bold border uppercase ${getRoleBadgeColor(user.role)}`}>
                                                    {user.role}
                                                </span>
                                                {user.role !== 'admin' && (
                                                    <select 
                                                        className="bg-transparent text-xs font-bold text-slate-400 outline-none cursor-pointer hover:text-slate-600 border-b border-dashed border-slate-300"
                                                        value={user.role}
                                                        onChange={(e) => handleRoleChange(user.uid, e.target.value as UserRole)}
                                                    >
                                                        <option value="manager">Manager</option>
                                                        <option value="team_leader">Team Leader (組長)</option>
                                                        <option value="staff">Staff</option>
                                                        <option value="marketing">Marketing</option>
                                                    </select>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {user.role === 'admin' ? (
                                                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                                                    <CheckCircle size={12} /> 全域存取 (Admin)
                                                </span>
                                            ) : (
                                                <div className="flex flex-wrap gap-1">
                                                    {(user.allowedClinics || []).map(clinicId => {
                                                        const clinic = clinics.find(c => c.id === clinicId);
                                                        // Fallback to displaying the ID if clinic not found (legacy or deleted)
                                                        const displayName = clinic ? clinic.name : clinicId;
                                                        return (
                                                            <span key={clinicId} className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600 border border-slate-200">
                                                                {displayName}
                                                            </span>
                                                        );
                                                    })}
                                                    {(user.allowedClinics || []).length === 0 && (
                                                        <span className="text-xs text-rose-400 italic">無存取權限</span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {user.role !== 'admin' && (
                                                <button 
                                                    onClick={() => openClinicModal(user)}
                                                    className="text-indigo-600 hover:text-indigo-800 font-bold text-xs border border-indigo-200 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
                                                >
                                                    管理診所
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 2: MENU PERMISSIONS */}
            {activeTab === 'menu' && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-fade-in">
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Key size={16} />
                            <span>勾選以允許該角色存取對應功能。Admin 預設擁有所有權限。</span>
                        </div>
                        <button 
                            onClick={savePermissions}
                            disabled={isSavingPerms}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold shadow-md flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSavingPerms ? <Loader2 size={16} className="animate-spin"/> : <Save size={16} />}
                            儲存設定
                        </button>
                    </div>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white text-slate-500 font-bold uppercase text-xs border-b border-slate-100">
                                <tr>
                                    <th className="px-6 py-3 w-1/4">功能選單 (Feature)</th>
                                    <th className="px-6 py-3 text-center bg-indigo-50/50 text-indigo-700">Manager</th>
                                    <th className="px-6 py-3 text-center bg-amber-50/50 text-amber-700">Team Leader</th>
                                    <th className="px-6 py-3 text-center bg-teal-50/50 text-teal-700">Staff</th>
                                    <th className="px-6 py-3 text-center bg-purple-50/50 text-purple-700">Marketing</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {MENU_CONFIG_ITEMS.map(item => (
                                    <tr key={item.key} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-3 font-bold text-slate-700 border-r border-slate-100">
                                            {item.label}
                                            <div className="text-[10px] text-slate-400 font-mono font-normal">{item.key}</div>
                                        </td>
                                        {ROLES.map(role => {
                                            const isChecked = (permissions[role] || []).includes(item.key);
                                            return (
                                                <td key={role} className={`px-6 py-3 text-center border-r border-slate-50 last:border-0 ${
                                                    role === 'manager' ? 'bg-indigo-50/10' :
                                                    role === 'team_leader' ? 'bg-amber-50/10' :
                                                    role === 'staff' ? 'bg-teal-50/10' :
                                                    role === 'marketing' ? 'bg-purple-50/10' : ''
                                                }`}>
                                                    <label className="inline-flex items-center justify-center cursor-pointer p-2 rounded-md hover:bg-slate-200/50 transition-colors">
                                                        <input 
                                                            type="checkbox" 
                                                            className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                            checked={isChecked}
                                                            onChange={() => togglePermission(role, item.key)}
                                                        />
                                                    </label>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Clinic Access Modal */}
            {editingUser && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-lg w-full max-w-lg overflow-hidden animate-slide-down">
                        <div className="bg-slate-800 text-white p-4 flex justify-between items-center">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                <Building2 size={20} /> 管理診所權限
                            </h3>
                            <span className="text-xs bg-slate-700 px-2 py-1 rounded">{editingUser.name}</span>
                        </div>
                        
                        <div className="p-6 max-h-[60vh] overflow-y-auto">
                            <p className="text-sm text-slate-500 mb-4">勾選此用戶可存取的診所。系統將自動同步權限至各診所設定。</p>
                            <div className="grid grid-cols-1 gap-2">
                                {clinics.map(clinic => {
                                    // Strict ID Matching
                                    const isSelected = tempAllowedClinics.includes(clinic.id);
                                    
                                    return (
                                        <label 
                                            key={clinic.id} 
                                            className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                                        >
                                            <span className={`font-bold ${isSelected ? 'text-indigo-700' : 'text-slate-600'}`}>{clinic.name}</span>
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                                                {isSelected && <Check size={14} className="text-white" />}
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                className="hidden"
                                                checked={isSelected}
                                                onChange={() => toggleClinicAccess(clinic.id)}
                                            />
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button 
                                onClick={() => setEditingUser(null)} 
                                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg"
                                disabled={isSavingUser}
                            >
                                取消
                            </button>
                            <button 
                                onClick={saveClinicAccess} 
                                disabled={isSavingUser}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2"
                            >
                                {isSavingUser ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                儲存變更
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};