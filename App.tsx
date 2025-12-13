
import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ClinicManager } from './components/ClinicManager';
import { DoctorManager } from './components/DoctorManager';
import { ConsultantManager } from './components/ConsultantManager';
import { LaboratoryManager } from './components/LaboratoryManager';
import { SOVReferralManager } from './components/SOVReferralManager';
import { PermissionManager } from './pages/PermissionManager';
import { MonthlyScheduler } from './components/MonthlyScheduler';
import { Integrations } from './components/Integrations';
import { AppointmentCalendar } from './components/AppointmentCalendar';
import { AssistantScheduling } from './components/AssistantScheduling';
import { DailyAccounting } from './pages/DailyAccounting';
import { AssistantBonus } from './components/AssistantBonus';
import { AssistantSalary } from './pages/AssistantSalary';
import { LabReconciliation } from './components/LabReconciliation';
import { SalaryStatementPage } from './components/SalaryStatementPage';
import { MonthlyReport } from './components/MonthlyReport';
import { ExportView } from './components/ExportView';
import { GroupDashboard } from './pages/GroupDashboard';
import { PatientManager } from './pages/PatientManager'; // Imported
import { 
  loadAppData, 
  saveAppData, 
  saveDoctors,
  saveLaboratories,
  saveSchedules,
  saveSOVReferrals,
  seedTestEnvironment,
  auth, 
  signInWithGoogle, // CHANGED from signInWithPopup
  signOut
} from './services/firebase';
import { LoginPage } from './components/LoginPage';
import { UnauthorizedPage } from './components/UnauthorizedPage';
import { AppData, Clinic, Doctor, DailySchedule, Consultant, Laboratory, SOVReferral, UserRole } from './types';
import { Loader2, Bug, Database } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { ClinicProvider } from './contexts/ClinicContext';

export type SaveStatus = 'idle' | 'saved' | 'saving' | 'error' | 'unsaved';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
  isDataLoading: boolean;
}

// --- ROUTE GUARD COMPONENT (Extracted) ---
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  allowedRoles,
  isDataLoading 
}) => {
  const { currentUser, userRole, loading: authLoading } = useAuth();

  if (authLoading || isDataLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <Loader2 size={48} className="animate-spin text-teal-600" />
        </div>
      );
  }

  if (!currentUser) {
      return <Navigate to="/" replace />;
  }

  // Strict Role Check
  if (!allowedRoles.includes(userRole)) {
      // Redirect based on role capability
      if (userRole === 'marketing') return <Navigate to="/marketing-schedule" replace />;
      if (userRole === 'staff') return <Navigate to="/appointments" replace />;
      return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  // Auth State from Context (Role Source of Truth)
  const { currentUser, userRole, loading: authLoading } = useAuth();
  
  // Local UI State
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  
  // Debug State
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  // App Data State
  const [data, setData] = useState<AppData>({ 
      clinics: [], 
      doctors: [], 
      consultants: [], 
      laboratories: [], 
      sovReferrals: [], 
      schedules: [], 
      allowedUsers: [] 
  });
  const [isDataLoading, setIsDataLoading] = useState(false);

  const addDebugLog = (msg: string) => {
      setDebugInfo(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  // Reset state when user changes
  useEffect(() => {
    if (!currentUser) {
        setLoadError(null);
        setDebugInfo([]);
    }
  }, [currentUser]);

  // --- DATA FETCHING ---
  useEffect(() => {
    if (!currentUser?.uid) return;

    let isMounted = true;

    const initData = async () => {
      setIsDataLoading(true);
      setLoadError(null);
      addDebugLog(`User: ${currentUser.email}, Role: ${userRole}`);
      
      try {
        let cloudData = await loadAppData();
        
        if (!isMounted) return;

        setData(cloudData);

      } catch (error: any) {
        if (!isMounted) return;
        console.error("Data Load Error", error);
        setLoadError(error.message || "Unknown Error");
      } finally {
        if (isMounted) setIsDataLoading(false);
      }
    };
    
    initData();

    return () => { isMounted = false; };
  }, [currentUser?.uid]); // Reload if user changes

  const performSave = async (newData: AppData) => {
      try {
          setData(newData); 
          await saveAppData(newData);
      } catch (e: any) {
          console.error("Save Failed:", e);
          alert("儲存失敗，請檢查連線: " + e.message);
      }
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
        // Use the new sync-aware login function
        await signInWithGoogle();
    } catch (e: any) {
        console.error("Login failed", e);
        alert("登入失敗: " + e.message);
    } finally {
        setIsLoggingIn(false);
    }
  };

  const handleSeedData = async () => {
      setIsSeeding(true);
      try {
          await seedTestEnvironment();
      } catch (e) {
          alert("Seeding failed");
      } finally {
          setIsSeeding(false);
      }
  };

  // Explicit Save Handlers
  const handleSaveClinics = async (newClinics: Clinic[]) => {
    await performSave({ ...data, clinics: newClinics });
  };

  const handleSaveDoctors = async (newDocs: Doctor[]) => {
    setData(prev => ({ ...prev, doctors: newDocs }));
    const promises = data.clinics.map(clinic => {
        const clinicDocs = newDocs.filter(d => d.clinicId === clinic.id);
        return saveDoctors(clinic.id, clinicDocs);
    });
    await Promise.all(promises);
  };

  const handleSaveConsultants = async (newConsultants: Consultant[]) => {
    await performSave({ ...data, consultants: newConsultants });
  };

  const handleSaveLaboratories = async (newLabs: Laboratory[]) => {
    setData(prev => ({ ...prev, laboratories: newLabs }));
    const promises = data.clinics.map(clinic => {
        const clinicLabs = newLabs.filter(l => l.clinicId === clinic.id);
        return saveLaboratories(clinic.id, clinicLabs);
    });
    await Promise.all(promises);
  };
  
  const handleSaveSOVReferrals = async (newReferrals: SOVReferral[]) => {
    setData(prev => ({ ...prev, sovReferrals: newReferrals }));
    const promises = data.clinics.map(clinic => {
        const clinicRefs = newReferrals.filter(r => r.clinicId === clinic.id);
        return saveSOVReferrals(clinic.id, clinicRefs);
    });
    await Promise.all(promises);
  };

  const handleSaveSchedules = async (newScheds: DailySchedule[]) => {
    setData(prev => ({ ...prev, schedules: newScheds }));
    const promises = data.clinics.map(clinic => {
        const clinicScheds = newScheds.filter(s => s.clinicId === clinic.id);
        return saveSchedules(clinic.id, clinicScheds);
    });
    await Promise.all(promises);
  };

  const handleRetryLoad = () => {
      window.location.reload();
  };

  // --- HOME REDIRECT HELPER ---
  const HomeRedirect = () => {
      if (userRole === 'marketing') return <Navigate to="/marketing-schedule" replace />;
      if (userRole === 'admin') return <Navigate to="/group-dashboard" replace />;
      // Staff default
      return <Navigate to="/appointments" replace />;
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 flex-col gap-4">
        <Loader2 size={48} className="animate-spin text-teal-600" />
        <p className="text-slate-500 font-medium">驗證身分中...</p>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} isLoggingIn={isLoggingIn} />;
  }
  
  // If user is guest/unauthorized (handled by AuthContext setting role to guest if not in whitelist)
  if (userRole === 'guest') {
      return <UnauthorizedPage email={currentUser.email} onLogout={() => signOut(auth)} />;
  }

  if (isDataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 flex-col gap-4">
        <Loader2 size={48} className="animate-spin text-teal-600" />
        <div className="text-center">
            <p className="text-slate-500 font-medium">正在從雲端同步資料...</p>
            <p className="text-xs text-slate-400 mt-2 font-mono">{currentUser.uid}</p>
        </div>
      </div>
    );
  }

  if (loadError) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
              <div className="bg-white p-6 rounded-2xl shadow-xl border border-rose-100 max-w-lg w-full">
                  <div className="flex items-center gap-2 mb-4 text-rose-600">
                      <Bug size={32} />
                      <h1 className="text-2xl font-bold">系統連線中斷</h1>
                  </div>
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 mb-4 font-mono text-xs text-rose-800 break-all overflow-auto max-h-48">
                      <strong>Error:</strong> {loadError}
                  </div>
                  <div className="flex flex-col gap-3">
                      <button onClick={handleRetryLoad} className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded-xl transition-colors">重新整理</button>
                      <button onClick={handleSeedData} disabled={isSeeding} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                          {isSeeding ? <Loader2 className="animate-spin" /> : <Database size={18} />} ⚡ Initialize Data
                      </button>
                      <button onClick={() => signOut(auth)} className="w-full bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 font-bold py-3 px-4 rounded-xl transition-colors">登出</button>
                  </div>
              </div>
          </div>
      );
  }

  return (
    <HashRouter>
      <ClinicProvider clinics={data.clinics}>
        <Layout 
          saveStatus={'saved'} 
          onRetrySave={() => {}}
          userEmail={currentUser.email}
          onLogout={() => signOut(auth)}
          userRole={userRole}
        >
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            
            {/* Admin Only Routes */}
            <Route path="/group-dashboard" element={
              <ProtectedRoute allowedRoles={['admin']} isDataLoading={isDataLoading}>
                  <GroupDashboard clinics={data.clinics} userRole={userRole as any} />
              </ProtectedRoute>
            } />
            <Route path="/salary" element={
              <ProtectedRoute allowedRoles={['admin']} isDataLoading={isDataLoading}>
                  <SalaryStatementPage clinics={data.clinics} doctors={data.doctors} />
              </ProtectedRoute>
            } />
            <Route path="/assistant-bonus" element={
              <ProtectedRoute allowedRoles={['admin']} isDataLoading={isDataLoading}>
                  <AssistantBonus clinics={data.clinics} consultants={data.consultants || []} />
              </ProtectedRoute>
            } 
            />
            <Route path="/assistant-salary" element={
              <ProtectedRoute allowedRoles={['admin']} isDataLoading={isDataLoading}>
                  <AssistantSalary clinics={data.clinics} />
              </ProtectedRoute>
            } 
            />

            {/* Settings Routes (Admin + Staff) */}
            <Route path="/clinics" element={<ProtectedRoute allowedRoles={['admin']} isDataLoading={isDataLoading}><ClinicManager clinics={data.clinics} onSave={handleSaveClinics} /></ProtectedRoute>} />
            <Route path="/doctors" element={<ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}><DoctorManager doctors={data.doctors} onSave={handleSaveDoctors} clinics={data.clinics} /></ProtectedRoute>} />
            <Route path="/consultants" element={<ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}><ConsultantManager consultants={data.consultants || []} onSave={handleSaveConsultants} clinics={data.clinics} /></ProtectedRoute>} />
            <Route path="/laboratories" element={<ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}><LaboratoryManager laboratories={data.laboratories || []} onSave={handleSaveLaboratories} clinics={data.clinics} /></ProtectedRoute>} />
            <Route path="/sov-referrals" element={<ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}><SOVReferralManager referrals={data.sovReferrals || []} clinics={data.clinics} onSave={handleSaveSOVReferrals} /></ProtectedRoute>} />
            <Route path="/integrations" element={<ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}><Integrations clinics={data.clinics} doctors={data.doctors} onSave={handleSaveClinics} /></ProtectedRoute>} />
            
            {/* Permission Manager - Note: Internal check handles strict/case-insensitive Auth */}
            <Route path="/permission-manager" element={<PermissionManager />} />

            {/* Operational Routes (Admin + Staff) */}
            <Route path="/accounting" element={
              <ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}>
                  <DailyAccounting 
                      clinics={data.clinics} 
                      doctors={data.doctors} 
                      consultants={data.consultants || []} 
                      laboratories={data.laboratories || []}
                      sovReferrals={data.sovReferrals || []}
                  />
              </ProtectedRoute>
            } />
            <Route path="/monthly-report" element={
              <ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}>
                  <MonthlyReport clinics={data.clinics} doctors={data.doctors} />
              </ProtectedRoute>
            } />
            <Route path="/lab-reconciliation" element={
              <ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}>
                  <LabReconciliation clinics={data.clinics} laboratories={data.laboratories || []} />
              </ProtectedRoute>
            } />
            <Route path="/appointments" element={
                <ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}>
                    <AppointmentCalendar 
                      clinics={data.clinics} 
                      doctors={data.doctors} 
                      consultants={data.consultants || []}
                      laboratories={data.laboratories || []} 
                      schedules={data.schedules} 
                      onSave={handleSaveSchedules}
                    />
                </ProtectedRoute>
              } 
            />
            {/* NEW: Patient Manager (CRM) */}
            <Route path="/patients" element={
                <ProtectedRoute allowedRoles={['admin', 'manager', 'staff']} isDataLoading={isDataLoading}>
                    <PatientManager />
                </ProtectedRoute>
              } 
            />
            <Route path="/assistant-scheduling" element={
              <ProtectedRoute allowedRoles={['admin', 'staff']} isDataLoading={isDataLoading}>
                  <AssistantScheduling 
                      clinics={data.clinics} 
                      consultants={data.consultants || []}
                      schedules={data.schedules} 
                      onSave={handleSaveSchedules}
                  />
              </ProtectedRoute>
            } 
            />

            {/* Schedule Routes (Admin + Staff + Marketing) */}
            <Route path="/schedule" element={
              <ProtectedRoute allowedRoles={['admin', 'staff', 'marketing']} isDataLoading={isDataLoading}>
                  <MonthlyScheduler clinics={data.clinics} doctors={data.doctors} schedules={data.schedules} onSave={handleSaveSchedules} />
              </ProtectedRoute>
            } />
            
            {/* Marketing Specific (Admin + Marketing) */}
            <Route path="/marketing-schedule" element={
              <ProtectedRoute allowedRoles={['admin', 'marketing']} isDataLoading={isDataLoading}>
                  <ExportView clinics={data.clinics} doctors={data.doctors} schedules={data.schedules} />
              </ProtectedRoute>
            } />

            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </Layout>
      </ClinicProvider>
    </HashRouter>
  );
};

export default App;
