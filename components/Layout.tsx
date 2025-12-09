
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Calendar, Users, Menu, X, Cloud, Loader2, Check, AlertCircle, 
  LogOut, Calculator, Briefcase, Settings, Building2, 
  Microscope, TrendingUp, BarChart2, Image as ImageIcon, 
  Gift, DollarSign, ChevronDown, UserCheck, CreditCard
} from 'lucide-react';
import { UserRole } from '../contexts/AuthContext';

export type SaveStatus = 'idle' | 'saved' | 'saving' | 'error' | 'unsaved';

interface Props {
  children: React.ReactNode;
  saveStatus: SaveStatus;
  onRetrySave: () => void;
  userEmail?: string | null;
  onLogout: () => void;
  userRole: UserRole;
}

type MenuItem = {
  path: string;
  icon: any;
  label: string;
  roles: UserRole[]; // Roles allowed to see this item
};

type MenuCategory = {
  id: string;
  label: string;
  icon?: any;
  items: MenuItem[];
  roles: UserRole[]; // Roles allowed to see this category
  defaultOpen?: boolean;
};

interface SidebarItemProps {
  item: MenuItem;
  userRole: UserRole;
  currentPath: string;
  isChild?: boolean;
}

// Extracted component to avoid "key" prop issues on inline components
const SidebarItem: React.FC<SidebarItemProps> = ({ 
  item, 
  userRole, 
  currentPath, 
  isChild = false 
}) => {
  const hasAccess = (allowedRoles: UserRole[]) => allowedRoles.includes(userRole);
  if (!hasAccess(item.roles)) return null;
  
  const isActive = currentPath === item.path || currentPath.startsWith(item.path + '/');
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      className={`
        flex items-center gap-3 px-4 py-3 transition-all duration-200 group relative
        ${isChild ? 'pl-12 text-sm' : 'text-base font-medium'}
        ${isActive 
          ? 'text-teal-400 bg-slate-800 border-r-4 border-teal-500' 
          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
        }
      `}
    >
      <Icon size={isChild ? 18 : 20} className={`${isActive ? 'text-teal-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
      <span>{item.label}</span>
    </Link>
  );
};

export const Layout: React.FC<Props> = ({ 
  children, saveStatus, onRetrySave, userEmail, onLogout, userRole 
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  
  const location = useLocation();

  const toggleCategory = (id: string) => {
    setOpenCategories(prev => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // --- MENU CONFIGURATION ---
  
  // Top Level Items (Root Menu - Top)
  const topLevelItems: MenuItem[] = [
    { path: '/group-dashboard', icon: BarChart2, label: '集團營運儀表板', roles: ['admin'] },
    { path: '/appointments', icon: Calendar, label: '約診日曆', roles: ['admin', 'staff'] },
    { path: '/accounting', icon: Calculator, label: '每日帳務', roles: ['admin', 'staff'] },
    { path: '/monthly-report', icon: TrendingUp, label: '月營收報表', roles: ['admin', 'staff'] },
    { path: '/lab-reconciliation', icon: Microscope, label: '技工所對帳', roles: ['admin', 'staff'] },
  ];

  // Categorized Items
  const categories: MenuCategory[] = [
     {
      id: 'financials',
      label: '薪資報表',
      icon: DollarSign,
      roles: ['admin'], // STRICTLY ADMIN ONLY
      items: [
        { path: '/salary', icon: DollarSign, label: '醫師薪資', roles: ['admin'] },
        { path: '/assistant-bonus', icon: Gift, label: '助理獎金', roles: ['admin'] },
        { path: '/assistant-salary', icon: CreditCard, label: '助理薪資', roles: ['admin'] },
      ]
    },
    {
      id: 'schedule',
      label: '排班作業',
      icon: Calendar,
      roles: ['admin', 'staff', 'marketing'],
      items: [
        { path: '/marketing-schedule', icon: ImageIcon, label: '預覽與發布', roles: ['admin', 'marketing'] }, // Marketing Primary
        { path: '/schedule', icon: Calendar, label: '醫師排班', roles: ['admin', 'staff', 'marketing'] },
        { path: '/assistant-scheduling', icon: Users, label: '助理排班', roles: ['admin', 'staff'] },
      ]
    },
    {
      id: 'settings',
      label: '人員與診所設定',
      icon: Settings,
      roles: ['admin', 'staff'], // Hidden from Marketing
      items: [
        { path: '/clinics', icon: Building2, label: '診所管理', roles: ['admin'] }, // Security: Admin only
        { path: '/doctors', icon: UserCheck, label: '醫師管理', roles: ['admin', 'staff'] },
        { path: '/consultants', icon: Briefcase, label: '人員管理', roles: ['admin', 'staff'] },
        { path: '/laboratories', icon: Microscope, label: '技工所管理', roles: ['admin', 'staff'] },
        { path: '/sov-referrals', icon: Users, label: 'SOV轉介名單', roles: ['admin', 'staff'] },
      ]
    }
  ];

  // Bottom Level Items (Root Menu - Bottom)
  const bottomLevelItems: MenuItem[] = [
    { path: '/integrations', icon: Cloud, label: '整合設定', roles: ['admin', 'staff'] },
  ];

  const hasAccess = (allowedRoles: UserRole[]) => allowedRoles.includes(userRole);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - RESTORED DARK THEME */}
      <aside className={`
        fixed lg:sticky top-0 left-0 z-50 h-screen w-72 bg-slate-900 text-white flex flex-col transition-transform duration-300 shadow-xl
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Sidebar Header */}
        <div className="p-6 flex items-center justify-between border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-teal-900/20">
              <span className="text-2xl font-bold">D</span>
            </div>
            <div>
              <h1 className="font-bold text-white leading-tight tracking-wide">Dental Manager</h1>
            </div>
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
            <X />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          
          {/* Top Level Items */}
          <div className="mb-2">
            {topLevelItems.map(item => (
              <SidebarItem 
                key={item.path} 
                item={item} 
                userRole={userRole} 
                currentPath={location.pathname} 
              />
            ))}
          </div>

          {/* Categories */}
          {categories.map(cat => {
            if (!hasAccess(cat.roles)) return null;
            
            // Check if there are any visible items in this category for the current user
            const visibleItems = cat.items.filter(i => hasAccess(i.roles));
            if (visibleItems.length === 0) return null;

            const isOpen = openCategories[cat.id];

            return (
              <div key={cat.id} className="mb-1">
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className={`
                    w-full flex items-center justify-between px-4 py-3 text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 transition-colors
                    ${isOpen ? 'bg-slate-800/30' : ''}
                  `}
                >
                  <div className="flex items-center gap-3">
                    {cat.icon && <cat.icon size={20} className="text-slate-500" />}
                    <span className="font-medium">{cat.label}</span>
                  </div>
                  <ChevronDown 
                    size={16} 
                    className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-teal-500' : ''}`} 
                  />
                </button>
                
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="bg-slate-900/50 py-1">
                    {visibleItems.map(item => (
                      <SidebarItem 
                        key={item.path} 
                        item={item} 
                        userRole={userRole} 
                        currentPath={location.pathname}
                        isChild
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Bottom Level Items */}
          <div className="mt-2">
            {bottomLevelItems.map(item => (
              <SidebarItem 
                key={item.path} 
                item={item} 
                userRole={userRole} 
                currentPath={location.pathname} 
              />
            ))}
          </div>
        </nav>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900">
          <div className="flex items-center gap-3 mb-4 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-white font-bold shadow-md">
              {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-200 truncate">{userEmail}</p>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${userRole === 'admin' ? 'bg-rose-500' : userRole === 'marketing' ? 'bg-purple-500' : 'bg-teal-500'}`}></div>
                <p className="text-xs text-slate-400 capitalize">{userRole}</p>
              </div>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <LogOut size={16} /> 登出系統
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Top Mobile Bar */}
        <header className="lg:hidden bg-slate-900 text-white p-4 flex justify-between items-center sticky top-0 z-30 shadow-md">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsMobileMenuOpen(true)} className="text-slate-300">
              <Menu />
            </button>
            <span className="font-bold text-lg">Dental Manager</span>
          </div>
          <div className="flex items-center gap-2">
             {saveStatus === 'saving' && <Loader2 size={18} className="animate-spin text-teal-400" />}
             {saveStatus === 'saved' && <Check size={18} className="text-emerald-400" />}
             {saveStatus === 'error' && <AlertCircle size={18} className="text-rose-400" />}
          </div>
        </header>

        {/* Desktop Top Bar (Status Only) */}
        <div className="hidden lg:flex justify-end items-center px-8 py-2 bg-white border-b border-slate-200 gap-4 h-12">
            <div className="flex items-center gap-2 text-xs font-medium">
                {saveStatus === 'saving' && (
                    <span className="text-teal-600 flex items-center gap-1 bg-teal-50 px-2 py-1 rounded-full"><Loader2 size={12} className="animate-spin"/> 自動儲存中...</span>
                )}
                {saveStatus === 'saved' && (
                    <span className="text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-full"><Check size={12} /> 資料已同步</span>
                )}
                {saveStatus === 'error' && (
                    <span className="text-rose-600 flex items-center gap-1 bg-rose-50 px-2 py-1 rounded-full"><AlertCircle size={12} /> 儲存失敗</span>
                )}
                {saveStatus === 'unsaved' && (
                    <span className="text-amber-600 flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-full"><AlertCircle size={12} /> 未儲存變更</span>
                )}
            </div>
        </div>

        <div className="flex-1 p-4 lg:p-8 overflow-x-hidden">
          {children}
        </div>
      </main>
    </div>
  );
};
