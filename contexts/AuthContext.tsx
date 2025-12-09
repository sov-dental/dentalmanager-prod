
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, db, auth } from '../services/firebase';
import firebase from "firebase/compat/app";

export type UserRole = 'admin' | 'staff' | 'marketing' | 'guest';

interface AuthContextType {
  currentUser: firebase.User | null;
  userRole: UserRole;
  userClinicId: string | null; // Legacy: Primary Clinic ID
  allowedClinics: string[];    // New: List of Allowed Clinic Names
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ 
    currentUser: null, 
    userRole: 'guest', 
    userClinicId: null,
    allowedClinics: [],
    loading: true 
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<firebase.User | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('guest');
  const [userClinicId, setUserClinicId] = useState<string | null>(null);
  const [allowedClinics, setAllowedClinics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(async (user) => {
      // Cleanup previous snapshot listener if it exists (e.g. user switching)
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }

      if (user && user.email) {
        console.log("Auth User UID:", user.uid);
        setCurrentUser(user);

        const userRef = db.collection('users').doc(user.uid);
        
        // Use Real-time Listener (onSnapshot) instead of one-time get()
        // This ensures the UI updates immediately when syncUserPermissions writes to DB
        unsubscribeSnapshot = userRef.onSnapshot(async (doc) => {
            if (doc.exists) {
                const data = doc.data();
                const role = data?.role;
                const clinicId = data?.clinicId;
                const allowed = Array.isArray(data?.allowedClinics) ? data.allowedClinics : [];
                
                console.log("[AuthContext] Snapshot Update - Role:", role, "Allowed:", allowed);

                // Strict role checking
                if (role === 'admin') {
                    setUserRole('admin');
                } else if (role === 'marketing') {
                    setUserRole('marketing');
                } else {
                    setUserRole('staff');
                }
                
                setUserClinicId(clinicId || null);
                setAllowedClinics(allowed);
                setLoading(false);
            } else {
                console.log("[AuthContext] User doc missing. Attempting legacy whitelist check...");
                
                // Auto-provisioning Logic for Single-Doc Structure
                // If the user doc doesn't exist, we check the master doc whitelist
                try {
                    const masterDocRef = db.collection('clinics').doc('demo-clinic');
                    const masterDocSnap = await masterDocRef.get();
                    
                    let isWhitelisted = false;
                    let targetClinicId = ''; // Primary ID (legacy)
                    const matchedClinicNames: string[] = [];
                    const targetEmail = user.email!.trim().toLowerCase();

                    if (masterDocSnap.exists) {
                        const masterData = masterDocSnap.data();
                        const clinicsArray = Array.isArray(masterData?.clinics) ? masterData.clinics : [];
                        
                        // 1. Check Global Allowed Users
                        const globalAllowed = Array.isArray(masterData?.allowedUsers) ? masterData.allowedUsers : [];
                        if (globalAllowed.some((u: any) => String(u).toLowerCase() === targetEmail)) {
                            isWhitelisted = true;
                        }

                        // 2. Iterate Clinics Array to find matches
                        clinicsArray.forEach((clinic: any) => {
                            const clinicAllowed = Array.isArray(clinic.allowedUsers) ? clinic.allowedUsers : [];
                            if (clinicAllowed.some((u: any) => String(u).toLowerCase() === targetEmail)) {
                                isWhitelisted = true;
                                matchedClinicNames.push(clinic.name);
                                if (!targetClinicId) targetClinicId = clinic.id; 
                            }
                        });
                    }

                    if (isWhitelisted) {
                        const initialRole: UserRole = targetEmail.includes('marketing') ? 'marketing' : 'staff';
                        console.log("[AuthContext] Whitelisted! Creating profile. Role:", initialRole);
                        
                        // Creating the document will trigger this snapshot listener again with doc.exists = true
                        await userRef.set({
                            email: user.email,
                            role: initialRole,
                            clinicId: targetClinicId,
                            allowedClinics: matchedClinicNames,
                            name: user.displayName || user.email!.split('@')[0],
                            createdAt: new Date().toISOString()
                        });
                        // Do not set loading=false here; wait for the next snapshot update
                    } else {
                        console.warn("[AuthContext] Access Denied: User not found in any whitelist.");
                        setUserRole('guest');
                        setUserClinicId(null);
                        setAllowedClinics([]);
                        setLoading(false);
                    }
                } catch (error) {
                    console.error("[AuthContext] Provisioning Error:", error);
                    setUserRole('guest');
                    setUserClinicId(null);
                    setAllowedClinics([]);
                    setLoading(false);
                }
            }
        }, (error) => {
            console.error("[AuthContext] Snapshot Listener Error:", error);
            // Fallback in case of permission error
            setUserRole('guest');
            setLoading(false);
        });

      } else {
        setCurrentUser(null);
        setUserRole('guest');
        setUserClinicId(null);
        setAllowedClinics([]);
        setLoading(false);
      }
    });

    return () => {
        if (unsubscribeSnapshot) unsubscribeSnapshot();
        unsubscribeAuth();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, userRole, userClinicId, allowedClinics, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
