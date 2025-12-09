
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
  // This ensures downstream components ONLY see what they are allowed to see.
  const visibleClinics = useMemo(() => {
    if (!rawClinics || rawClinics.length === 0) return [];

    let filteredClinics: Clinic[] = [];

    // Admin / Marketing: Access to ALL clinics
    if (userRole === 'admin' || userRole === 'marketing') {
        filteredClinics = [...rawClinics];
    } 
    // Staff: Strict Allow-List Filter
    else if (userRole === 'staff') {
        // Normalize names for comparison (trim + lowercase) to prevent mismatch bugs
        const normalize = (str: string | undefined | null) => (str ? String(str).trim().toLowerCase() : '');
        const safeAllowed = (allowedClinics || []).map(normalize).filter(Boolean);
        
        filteredClinics = rawClinics.filter(c => {
            const cName = normalize(c.name);
            return cName && safeAllowed.includes(cName);
        });
    }

    // Sort the filtered list
    return filteredClinics.sort((a, b) => {
        const orderA = ORDER_MAP[a.name] || 999;
        const orderB = ORDER_MAP[b.name] || 999;
        return orderA - orderB;
    });

  }, [rawClinics, userRole, allowedClinics]);

  const selectedClinic = visibleClinics.find(c => c.id === selectedClinicId);

  // 2. Auto-Selection Logic
  useEffect(() => {
    // If no clinics available, clear selection
    if (visibleClinics.length === 0) {
        if (selectedClinicId) setSelectedClinicId('');
        return;
    }

    // Check if the currently selected ID is valid within the *filtered* list
    const isCurrentValid = visibleClinics.some(c => c.id === selectedClinicId);

    // If current selection is invalid (e.g. switched user, or init), force select the first valid one
    if (!isCurrentValid) {
        console.log(`[ClinicContext] Auto-selecting first available clinic: ${visibleClinics[0].name}`);
        setSelectedClinicId(visibleClinics[0].id);
    }
  }, [visibleClinics, selectedClinicId]);

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
