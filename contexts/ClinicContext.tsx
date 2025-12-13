
import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Clinic } from '../types';
import { useAuth } from './AuthContext';

interface ClinicContextType {
  selectedClinicId: string;
  setSelectedClinicId: (id: string) => void;
  selectedClinic: Clinic | undefined;
  clinics: Clinic[]; // Exposed Filtered List
}

const ClinicContext = createContext<ClinicContextType>({
  selectedClinicId: '',
  setSelectedClinicId: () => {},
  selectedClinic: undefined,
  clinics: [],
});

export const useClinic = () => useContext(ClinicContext);

const ORDER_MAP: Record<string, number> = {
  '日亞美': 1,
  '台南蒔光': 2,
  '新竹橙蒔': 3,
  '台中日蒔': 4,
  '古亭蒔光': 5,
  '古亭蒔穗': 5
};

export const ClinicProvider: React.FC<{ clinics: Clinic[]; children: React.ReactNode }> = ({ clinics: rawClinics, children }) => {
  const { userRole, allowedClinics } = useAuth();
  const [selectedClinicId, setSelectedClinicId] = useState<string>('');

  // 1. Strict Security Filtering (The Gatekeeper)
  // Memoize based on JSON string of allowedClinics to prevent ref changes from triggering updates
  const visibleClinics = useMemo(() => {
    if (!rawClinics || rawClinics.length === 0) return [];

    let filteredClinics: Clinic[] = [];

    // Admin / Marketing: Access to ALL clinics
    if (userRole === 'admin' || userRole === 'marketing') {
        filteredClinics = [...rawClinics];
    } 
    // Staff / Manager / Others: Hybrid Filter (ID & Name)
    else {
        // Normalize allowed list to string and trimmed
        const allowed = (allowedClinics || []).map(s => String(s).trim());
        // Lowercase set for name matching
        const allowedLower = new Set(allowed.map(s => s.toLowerCase()));
        // Original set for ID matching (IDs might be case-sensitive)
        const allowedSet = new Set(allowed);

        // Debug log only when list changes size
        // console.log(`[ClinicContext] Filtering. Role: ${userRole}, Allowed: ${allowed.length}`);
        
        filteredClinics = rawClinics.filter(c => {
            // 1. Check ID Match (Primary)
            const matchId = allowedSet.has(c.id);
            
            // 2. Check Name Match (Fallback/Legacy)
            const cName = c.name.trim().toLowerCase();
            const matchName = allowedLower.has(cName);
            
            return matchId || matchName;
        });
    }

    // Sort the filtered list
    return filteredClinics.sort((a, b) => {
        const orderA = ORDER_MAP[a.name] || 999;
        const orderB = ORDER_MAP[b.name] || 999;
        return orderA - orderB;
    });

  }, [rawClinics, userRole, JSON.stringify(allowedClinics)]);

  const selectedClinic = visibleClinics.find(c => c.id === selectedClinicId);

  // 2. Auto-Selection Logic
  // Use a string signature of IDs to prevent loop on object reference change
  const visibleClinicIds = visibleClinics.map(c => c.id).join(',');

  useEffect(() => {
    // If no clinics available, clear selection and STOP.
    if (visibleClinics.length === 0) {
        if (selectedClinicId) setSelectedClinicId('');
        return;
    }

    // Check if the currently selected ID is valid within the *filtered* list
    const isCurrentValid = visibleClinics.some(c => c.id === selectedClinicId);

    // Only update if current selection is INVALID or EMPTY
    if (!isCurrentValid || !selectedClinicId) {
        console.log(`[ClinicContext] Auto-selecting first available clinic: ${visibleClinics[0].name}`);
        setSelectedClinicId(visibleClinics[0].id);
    }
  }, [visibleClinicIds, selectedClinicId]);

  return (
    <ClinicContext.Provider value={{ 
        selectedClinicId, 
        setSelectedClinicId, 
        selectedClinic,
        clinics: visibleClinics // Components consume this secure list
    }}>
      {children}
    </ClinicContext.Provider>
  );
};
