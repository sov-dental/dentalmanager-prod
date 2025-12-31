import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import { AppData, DailyAccountingRecord, AccountingRow, TechnicianRecord, MonthlyTarget, Clinic, NHIRecord, SalaryAdjustment, Consultant, InsuranceGrade, User, UserRole, Doctor, Laboratory, SOVReferral, DailySchedule, AuditLogEntry, NPRecord, ClinicMonthlySummary, MonthlyClosing } from '../types';

// --- CONFIGURATION STRATEGY: HOSTNAME SWITCHING ---

const devConfig = {
  apiKey: "AIzaSyC77kXgBNUGdyNV-JJ-Lkn5qYNDJwVKSrE", 
  authDomain: "sunlight-schedule-data.firebaseapp.com",
  projectId: "sunlight-schedule-data",
  storageBucket: "sunlight-schedule-data.firebasestorage.app",
  messagingSenderId: "534278828682",
  appId: "1:534278828682:web:681029e46b7b0a3ef1f373"
};

const prodConfig = {
  apiKey: "AIzaSyD252Ef1MRy9m-k1IEtYUhGQVeP9gd1KYw",
  authDomain: "sunlight-schedule-data-prod.firebaseapp.com",
  projectId: "sunlight-schedule-data-prod",
  storageBucket: "sunlight-schedule-data-prod.firebasestorage.app",
  messagingSenderId: "102873326358",
  appId: "1:102873326358:web:86d41907668f845c572637"
};

const hostname = window.location.hostname;
// Check if URL contains '-prod' to identify Production environment
const isProd = hostname.includes('-prod');

console.log(`[Firebase Init] Hostname: ${hostname}, Environment: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'}`);

const firebaseConfig = isProd ? prodConfig : devConfig;

if (!firebaseConfig.apiKey) throw new Error("Missing Firebase Config.");

const app = !firebase.apps.length ? firebase.initializeApp(firebaseConfig) : firebase.app();

export const db = firebase.firestore();
export const auth = firebase.auth();
export const storage = firebase.storage();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error) => {
  console.error("Firebase Auth Persistence Error:", error);
});

export const googleProvider = new firebase.auth.GoogleAuthProvider();

// --- CONSTANTS ---
export const CLINIC_ORDER: Record<string, number> = {
  '日亞美': 1,
  '台南蒔光': 2,
  '新竹橙蒔': 3,
  '台中日蒔': 4,
  '古亭蒔穗': 5
};

// --- AUTH HELPERS ---

export const signInWithGoogle = async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await auth.signInWithPopup(provider);
    const user = result.user;

    if (user && user.email) {
      console.log("Checking permissions for:", user.email);
      
      const clinicsRef = db.collection('clinics');
      const q = clinicsRef.where('allowedUsers', 'array-contains', user.email);
      const snapshot = await q.get();
      
      const allowedClinicIds = snapshot.docs.map(doc => doc.id);
      console.log("Found authorized clinics (IDs):", allowedClinicIds);

      if (allowedClinicIds.length > 0) {
        const userRef = db.collection('users').doc(user.uid);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            await userRef.update({
                allowedClinics: firebase.firestore.FieldValue.arrayUnion(...allowedClinicIds),
                lastSyncedAt: new Date().toISOString()
            });
        } else {
            await userRef.set({
                uid: user.uid,
                email: user.email,
                name: user.displayName || user.email.split('@')[0],
                role: 'staff',
                allowedClinics: allowedClinicIds,
                createdAt: new Date().toISOString(),
                lastSyncedAt: new Date().toISOString()
            }, { merge: true });
        }
      }
    }
    return result;
  } catch (error) {
    console.error("Sign In / Sync Error", error);
    throw error;
  }
};

export const signOut = (authInstance: any) => authInstance.signOut();

export const onAuthStateChanged = (cb: (user: firebase.User | null) => void) => {
  return auth.onAuthStateChanged(cb);
};

const DOC_ID = 'demo-clinic';

// --- DATA HELPERS ---

/**
 * Enhanced deepSanitize to handle Firestore FieldValue correctly.
 */
export const deepSanitize = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (obj instanceof Date) return obj.toISOString();
  
  if (obj instanceof firebase.firestore.FieldValue) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(deepSanitize);
  }
  
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = deepSanitize(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
};

export const sanitizeRow = (row: AccountingRow): AccountingRow => {
    return deepSanitize(row);
};

export const hydrateRow = (row: any): AccountingRow => {
    return {
        ...row,
        chartId: row.chartId || "",
        paymentMethod: row.paymentMethod || "cash",
        calendarTreatment: row.calendarTreatment || "",
        treatments: {
            regFee: 0, copayment: 0, sov: 0, ortho: 0, prostho: 0, 
            implant: 0, whitening: 0, perio: 0, inv: 0, otherSelfPay: 0, consultant: '',
            ...(row.treatments || {})
        },
        retail: {
            diyWhitening: 0, products: 0, productNote: '', staff: '',
            ...(row.retail || {})
        },
        paymentBreakdown: {
            cash: 0, card: 0, transfer: 0,
            ...(row.paymentBreakdown || {})
        },
        actualCollected: Number(row.actualCollected) || 0,
        attendance: row.attendance !== undefined ? row.attendance : true,
        sortOrder: row.sortOrder || 0,
    };
};

export const uploadImage = async (file: File, path: string): Promise<string> => {
  const ref = storage.ref(path);
  await ref.put(file);
  return await ref.getDownloadURL();
};

// --- CORE APP DATA ---

export const getClinics = async (): Promise<Clinic[]> => {
    try {
        const snap = await db.collection('clinics').get();
        return snap.docs.map(doc => {
            const data = doc.data();
            if (doc.id === 'demo-clinic' && !data.name) return null;
            if (!data.name) return null;
            
            return {
                id: doc.id,
                name: data.name,
                doctors: data.doctors || [],
                laboratories: data.laboratories || [],
                sovReferrals: data.sovReferrals || [],
                schedules: data.schedules || [],
                weeklyHours: data.weeklyHours || Array(7).fill({ Morning: true, Afternoon: true, Evening: true }),
                themeColor: data.themeColor || '#0d9488',
                ...data
            } as Clinic;
        }).filter(Boolean) as Clinic[];
    } catch (error) {
        console.error("Error getting clinics:", error);
        return [];
    }
};

export const loadAppData = async (): Promise<AppData> => {
  const docRef = db.collection('clinics').doc(DOC_ID);
  const doc = await docRef.get();
  
  let data: AppData = { 
      clinics: [], doctors: [], consultants: [], laboratories: [], sovReferrals: [], schedules: [], allowedUsers: [] 
  };

  if (doc.exists) {
    const legacyData = doc.data() as AppData;
    data = { ...legacyData, clinics: [] };
  }

  const realClinics = await getClinics();
  if (realClinics.length > 0) {
      data.clinics = realClinics;
      data.doctors = realClinics.flatMap(c => c.doctors || []);
      data.laboratories = realClinics.flatMap(c => c.laboratories || []);
      data.sovReferrals = realClinics.flatMap(c => c.sovReferrals || []);
      
      const clinicSchedules = realClinics.flatMap(c => c.schedules || []);
      if (clinicSchedules.length > 0) {
          const existingIds = new Set(data.schedules.map(s => `${s.date}_${s.clinicId}`));
          const newSchedules = clinicSchedules.filter(s => !existingIds.has(`${s.date}_${s.clinicId}`));
          data.schedules = [...data.schedules, ...newSchedules];
      }
  }

  try {
      const staffSnap = await db.collection('staff_profiles')
          .where('isActive', '==', true)
          .get();
      
      if (!staffSnap.empty) {
          const staffList = staffSnap.docs.map(d => ({ id: d.id, ...d.data() } as Consultant));
          data.consultants = staffList;
      }
  } catch (e) {
      console.error("[loadAppData] Failed to load staff profiles", e);
  }

  return data;
};

export const saveAppData = async (data: AppData) => {
  const docRef = db.collection('clinics').doc(DOC_ID);
  const { clinics, ...rest } = data; 
  await docRef.set(deepSanitize(rest), { merge: true });
};

export const saveClinic = async (clinicData: Partial<Clinic>) => {
    const collectionRef = db.collection('clinics');
    
    const isNew = !clinicData.id;
    const id = clinicData.id || collectionRef.doc().id;
    const docRef = collectionRef.doc(id);

    const payload: any = { ...clinicData, id };

    if (isNew) {
        if (!payload.doctors) payload.doctors = [];
        if (!payload.schedules) payload.schedules = [];
        if (!payload.laboratories) payload.laboratories = [];
        if (!payload.sovReferrals) payload.sovReferrals = [];
    }

    const sanitizedPayload = deepSanitize(payload);

    await docRef.set(sanitizedPayload, { merge: true });

    if (clinicData.allowedUsers && clinicData.allowedUsers.length > 0) {
        const usersRef = db.collection('users');
        const targetClinicId = id; 
        
        const promises = clinicData.allowedUsers.map(async (email) => {
            const q = await usersRef.where('email', '==', email).limit(1).get();
            if (!q.empty) {
                const userDoc = q.docs[0];
                const userData = userDoc.data();
                const currentAllowed = userData.allowedClinics || [];
                
                if (!currentAllowed.includes(targetClinicId)) {
                    await userDoc.ref.update({
                        allowedClinics: firebase.firestore.FieldValue.arrayUnion(targetClinicId)
                    });
                }
            }
        });
        await Promise.all(promises);
    }
};

export const updateClinicCalendarMapping = async (clinicId: string, mapping: Record<string, string>) => {
    await db.collection('clinics').doc(clinicId).update({
        googleCalendarMapping: deepSanitize(mapping)
    });
};

export const saveDoctors = async (clinicId: string, doctors: Doctor[]) => {
    const sanitizedDoctors = deepSanitize(doctors);
    await db.collection('clinics').doc(clinicId).update({ doctors: sanitizedDoctors });
};

// Fix: Renamed laboratoriesSave to saveLaboratories to match the expected export in App.tsx
export const saveLaboratories = async (clinicId: string, labs: Laboratory[]) => {
    await db.collection('clinics').doc(clinicId).update({ laboratories: deepSanitize(labs) });
};

export const saveSchedules = async (clinicId: string, schedules: DailySchedule[]) => {
    try {
        await db.collection('clinics').doc(clinicId).update({ schedules: deepSanitize(schedules) });
    } catch (error) {
        console.error(`[saveSchedules] Failed to save schedules for clinic ${clinicId}:`, error);
        throw error;
    }
};

// NEW: Strict Single-Clinic Schedule Update (Emergency Fix)
export const saveClinicSchedule = async (clinicId: string, schedules: DailySchedule[]) => {
  console.log("[saveClinicSchedule] Attempting to save schedule for Clinic ID:", clinicId);
  
  if (!clinicId) {
    throw new Error("Clinic ID is missing!");
  }

  try {
    // CRITICAL: Use .update() to modify ONLY the schedules field.
    // If this fails, it means the document doesn't exist.
    await db.collection('clinics').doc(clinicId).update({
      schedules: deepSanitize(schedules),
      lastUpdated: new Date().toISOString()
    });
    
    console.log("[saveClinicSchedule] Schedule updated successfully for:", clinicId);
  } catch (error) {
    console.error("[saveClinicSchedule] Failed to update schedule for clinic:", clinicId, error);
    throw error;
  }
};

export const saveSOVReferrals = async (clinicId: string, referrals: SOVReferral[]) => {
    await db.collection('clinics').doc(clinicId).update({ sovReferrals: deepSanitize(referrals) });
};

export const addSOVReferral = async (clinicId: string, patientName: string) => {
    const docRef = db.collection('clinics').doc(clinicId);
    
    try {
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            if (!doc.exists) return;
            
            const data = doc.data();
            const currentReferrals: SOVReferral[] = data?.sovReferrals || [];
            
            if (currentReferrals.some(r => r.name.trim() === patientName.trim())) {
                return;
            }
            
            const newReferral: SOVReferral = {
                id: crypto.randomUUID(),
                clinicId,
                name: patientName.trim()
            };
            
            transaction.update(docRef, {
                sovReferrals: firebase.firestore.FieldValue.arrayUnion(newReferral)
            });
        });
    } catch (e) {
        console.error("Error adding SOV referral:", e);
    }
};

// --- STAFF & INSURANCE ---

export const getStaffList = async (clinicId: string): Promise<Consultant[]> => {
    const snap = await db.collection('staff_profiles')
        .where('clinicId', '==', clinicId)
        .where('isActive', '==', true)
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Consultant));
};

export const saveStaff = async (staff: Consultant) => {
    await db.collection('staff_profiles').doc(staff.id).set(deepSanitize(staff), { merge: true });
};

export const deleteStaff = async (staffId: string) => {
    await db.collection('staff_profiles').doc(staffId).update({ isActive: false });
};

export const getInsuranceTable = async (): Promise<InsuranceGrade[]> => {
    const doc = await db.collection('settings').doc('insurance_table').get();
    if (doc.exists) {
        return doc.data()?.grades || [];
    }
    return [];
};

export const saveInsuranceTable = async (grades: InsuranceGrade[]) => {
    await db.collection('settings').doc('insurance_table').set({ grades: deepSanitize(grades) });
};

// --- USER & PERMISSIONS ---

export const getAllUsers = async (): Promise<User[]> => {
    const snap = await db.collection('users').get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() } as User));
};

export const updateUserRole = async (uid: string, role: UserRole) => {
    await db.collection('users').doc(uid).update({ role });
};

export const updateUserClinicAccess = async (user: User, allowedClinics: string[]) => {
    await db.collection('users').doc(user.uid).update({ allowedClinics: deepSanitize(allowedClinics) });
};

export const getRolePermissions = async (): Promise<Record<string, string[]>> => {
    const doc = await db.collection('settings').doc('role_permissions').get();
    return doc.exists ? doc.data() as Record<string, string[]> : {};
};

export const saveRolePermissions = async (perms: Record<string, string[]>) => {
    await db.collection('settings').doc('role_permissions').set(deepSanitize(perms));
};

// --- DAILY ACCOUNTING ---

export const loadDailyAccounting = async (clinicId: string, date: string): Promise<DailyAccountingRecord | null> => {
    const docId = `${clinicId}_${date}`;
    const doc = await db.collection('daily_accounting').doc(docId).get();
    if (doc.exists) {
        return doc.data() as DailyAccountingRecord;
    }
    return null;
};

export const saveDailyAccounting = async (record: DailyAccountingRecord, auditEntry?: AuditLogEntry) => {
    const docId = `${record.clinicId}_${record.date}`;
    const { auditLog, ...otherData } = record;
    
    const payload: any = deepSanitize(otherData);
    if (auditEntry) {
        payload.auditLog = firebase.firestore.FieldValue.arrayUnion(deepSanitize(auditEntry));
    }
    
    await db.collection('daily_accounting').doc(docId).set(payload, { merge: true });

    const updates = record.rows.filter(r => r.patientName).map(r => {
        const consultantName = r.treatments.consultant || r.retail.staff || undefined;
        return upsertPatient(record.clinicId, {
            chartId: r.chartId || null,
            name: r.patientName,
            lastVisitDate: record.date,
            consultant: consultantName
        });
    });
    Promise.all(updates).catch(err => console.error("Background CRM Sync Error:", err));
};

export const getMonthlyAccounting = async (clinicId: string, month: string): Promise<AccountingRow[]> => {
    const startId = `${clinicId}_${month}-01`;
    const endId = `${clinicId}_${month}-31`;
    const snap = await db.collection('daily_accounting')
        .where(firebase.firestore.FieldPath.documentId(), '>=', startId)
        .where(firebase.firestore.FieldPath.documentId(), '<=', endId)
        .get();

    const allRows: AccountingRow[] = [];
    snap.forEach(doc => {
        const data = doc.data() as DailyAccountingRecord;
        if (data.rows) {
            data.rows.forEach(r => {
                const hydrated = hydrateRow(r);
                hydrated.originalDate = data.date;
                allRows.push(hydrated);
            });
        }
    });
    return allRows;
};

// --- TECHNICIAN RECORDS ---
export const getTechnicianRecords = async (clinicId: string, labName: string | null, month: string): Promise<TechnicianRecord[]> => {
    let query = db.collection('technician_records')
        .where('clinicId', '==', clinicId)
        .where('date', '>=', `${month}-01`)
        .where('date', '<=', `${month}-31`);
        
    const snap = await query.get();
    let results = snap.docs.map(d => ({ id: d.id, ...d.data() } as TechnicianRecord));
    
    if (labName) {
        results = results.filter(r => r.labName === labName);
    }
    return results;
};

export const saveTechnicianRecord = async (record: TechnicianRecord) => {
    const id = record.id || crypto.randomUUID();
    await db.collection('technician_records').doc(id).set(deepSanitize({ ...record, id }), { merge: true });
};

export const deleteTechnicianRecord = async (id: string) => {
    await db.collection('technician_records').doc(id).delete();
};

// --- DASHBOARD & BI ---
export const fetchDashboardSnapshot = async (clinics: Clinic[], month: string): Promise<{
    current: ClinicMonthlySummary[],
    lastMonth: ClinicMonthlySummary[],
    lastYear: ClinicMonthlySummary[]
}> => {
    const processMonth = async (m: string) => {
        const promises = clinics.map(async (clinic) => {
            const targetDocPromise = db.collection('monthly_targets').doc(`${clinic.id}_${m}`).get();
            const rowsPromise = getMonthlyAccounting(clinic.id, m);
            const nhiRecordsPromise = getNHIRecords(clinic.id, m);

            const [targetDoc, rows, nhiRecords] = await Promise.all([targetDocPromise, rowsPromise, nhiRecordsPromise]);

            const targets: MonthlyTarget = targetDoc.exists 
                ? targetDoc.data() as MonthlyTarget 
                : { clinicId: clinic.id, month: m, revenueTarget: 0, visitTarget: 0, selfPayTarget: 0 };

            let revenue = 0;
            let selfPay = 0;
            let visits = 0;

            rows.forEach(row => {
                if (row.attendance) visits++;
                revenue += (row.actualCollected || 0);
                const t = row.treatments;
                const sp = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + (t.sov || 0) + (t.inv || 0) + (t.whitening || 0) + (t.perio || 0) + (t.otherSelfPay || 0);
                selfPay += sp;
            });

            const nhiTotal = nhiRecords.reduce((sum, r) => sum + r.amount, 0);
            revenue += nhiTotal;

            return {
                clinicId: clinic.id,
                clinicName: clinic.name,
                actualRevenue: revenue,
                actualVisits: visits,
                actualSelfPay: selfPay,
                targets
            } as ClinicMonthlySummary;
        });

        return Promise.all(promises);
    };

    const [y, mStr] = month.split('-').map(Number);
    const lmDate = new Date(y, mStr - 2, 1); 
    const lastMonthStr = `${lmDate.getFullYear()}-${String(lmDate.getMonth() + 1).padStart(2, '0')}`;
    const lyDate = new Date(y - 1, mStr - 1, 1);
    const lastYearStr = `${lyDate.getFullYear()}-${String(lyDate.getMonth() + 1).padStart(2, '0')}`;

    const [current, lastMonth, lastYear] = await Promise.all([
        processMonth(month),
        processMonth(lastMonthStr),
        processMonth(lastYearStr)
    ]);

    return { current, lastMonth, lastYear };
};

export const saveMonthlyTarget = async (clinicId: string, month: string, target: MonthlyTarget) => {
    await db.collection('monthly_targets').doc(`${clinicId}_${month}`).set(deepSanitize(target), { merge: true });
};

// --- NHI & SALARY ---
export const getNHIRecords = async (clinicId: string, month: string): Promise<NHIRecord[]> => {
    const snap = await db.collection('nhi_records')
        .where('clinicId', '==', clinicId)
        .where('month', '==', month)
        .get();
    return snap.docs.map(d => d.data() as NHIRecord);
};

export const saveBatchNHIRecords = async (records: NHIRecord[]) => {
    const batch = db.batch();
    records.forEach(rec => {
        const id = `${rec.clinicId}_${rec.month}_${rec.doctorId}`;
        const ref = db.collection('nhi_records').doc(id);
        batch.set(ref, deepSanitize({ ...rec, id }), { merge: true });
    });
    await batch.commit();
};

export const getClinicSalaryAdjustments = async (clinicId: string, month: string): Promise<SalaryAdjustment[]> => {
    const snap = await db.collection('salary_adjustments')
        .where('clinicId', '==', clinicId)
        .where('month', '==', month)
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SalaryAdjustment));
};

export const addSalaryAdjustment = async (adj: SalaryAdjustment) => {
    await db.collection('salary_adjustments').add(deepSanitize(adj));
};

export const deleteSalaryAdjustment = async (id: string) => {
    await db.collection('salary_adjustments').doc(id).delete();
};

export const getBonusSettings = async (clinicId: string, month: string): Promise<any> => {
    const doc = await db.collection('bonus_settings').doc(`${clinicId}_${month}`).get();
    return doc.exists ? doc.data() : null;
};

export const saveBonusSettings = async (clinicId: string, month: string, settings: any) => {
    await db.collection('bonus_settings').doc(`${clinicId}_${month}`).set(deepSanitize(settings), { merge: true });
};

// --- CRM / PATIENT LOGIC ---

export interface Patient {
    docId: string;
    clinicId: string;
    chartId: string | null;
    name: string;
    lastVisit: string;
    purchasedItems?: string[]; 
    visitHistory?: any[];     
    totalSpending?: number;
    lastConsultant?: string;
    pastConsultants?: string[];
    updatedAt?: any;
}

export const getPatients = async (clinicId: string, lastDoc?: any, searchTerm?: string) => {
    let query: firebase.firestore.Query = db.collection('patients')
        .where('clinicId', '==', clinicId);

    if (searchTerm) {
        const isDigits = /^\d+$/.test(searchTerm);
        if (isDigits) {
            query = query.where('chartId', '==', searchTerm);
        } else {
            query = query
                .where('name', '>=', searchTerm)
                .where('name', '<=', searchTerm + '\uf8ff')
                .orderBy('name');
        }
    } else {
        query = query.orderBy('lastVisit', 'desc');
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }
    }

    query = query.limit(50);
    const snap = await query.get();
    const patients = snap.docs.map(d => ({ docId: d.id, ...d.data() } as Patient));
    
    return {
        patients,
        lastVisible: snap.docs[snap.docs.length - 1]
    };
};

export const upsertPatient = async (clinicId: string, data: { chartId: string | null, name: string, lastVisitDate: string, consultant?: string }) => {
    if (!clinicId || !data.name) return;
    const safeName = data.name.replace(/[\/\s]/g, '_');
    const safeId = data.chartId || 'NP';
    const docId = `${clinicId}_${safeId}_${safeName}`;
    const docRef = db.collection('patients').doc(docId);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            if (doc.exists) {
                const existing = doc.data() as Patient;
                const newVisit = data.lastVisitDate;
                const oldVisit = existing.lastVisit || '';
                const update: any = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
                if (newVisit > oldVisit) update.lastVisit = newVisit;
                if (data.consultant) {
                    update.lastConsultant = data.consultant;
                    update.pastConsultants = firebase.firestore.FieldValue.arrayUnion(data.consultant);
                }
                t.set(docRef, deepSanitize(update), { merge: true });
            } else {
                const payload: any = {
                    clinicId, chartId: data.chartId, name: data.name,
                    lastVisit: data.lastVisitDate, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    visitHistory: [], purchasedItems: []
                };
                if (data.consultant) {
                    payload.lastConsultant = data.consultant;
                    payload.pastConsultants = [data.consultant];
                }
                t.set(docRef, deepSanitize(payload));
            }
        });
    } catch (e) {
        console.error("Upsert patient failed", e);
    }
};

export const migratePatientId = async (oldDocId: string, newChartId: string, clinicId: string) => {
    const oldRef = db.collection('patients').doc(oldDocId);
    const oldSnap = await oldRef.get();
    if (!oldSnap.exists) throw new Error("Patient not found");
    const oldData = oldSnap.data() as Patient;

    const safeName = oldData.name.replace(/[\/\s]/g, '_');
    const safeId = newChartId || 'NP';
    const newDocId = `${clinicId}_${safeId}_${safeName}`;
    const newRef = db.collection('patients').doc(newDocId);

    await db.runTransaction(async (t) => {
        const newSnap = await t.get(newRef);
        let newData = {};
        if (newSnap.exists) {
            const existing = newSnap.data() as Patient;
            newData = {
                ...existing,
                totalSpending: (existing.totalSpending || 0) + (oldData.totalSpending || 0),
                visitHistory: [...(existing.visitHistory || []), ...(oldData.visitHistory || [])],
                purchasedItems: Array.from(new Set([...(existing.purchasedItems || []), ...(oldData.purchasedItems || [])])),
                lastVisit: (existing.lastVisit > oldData.lastVisit) ? existing.lastVisit : oldData.lastVisit,
                pastConsultants: Array.from(new Set([...(existing.pastConsultants || []), ...(oldData.pastConsultants || [])]))
            };
        } else {
            newData = { ...oldData, chartId: newChartId, docId: newDocId };
        }
        t.set(newRef, deepSanitize(newData), { merge: true });
        t.delete(oldRef);
    });
};

export const getPatientHistory = async (clinicId: string, name: string, chartId: string | null) => {
    const startDate = new Date(); startDate.setDate(startDate.getDate() - 180); 
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = new Date().toISOString().split('T')[0];

    const snap = await db.collection('daily_accounting')
        .where(firebase.firestore.FieldPath.documentId(), '>=', `${clinicId}_${startStr}`)
        .where(firebase.firestore.FieldPath.documentId(), '<=', `${clinicId}_${endStr}`)
        .get();

    const history: any[] = [];
    snap.forEach(doc => {
        const data = doc.data() as DailyAccountingRecord;
        if (data.rows) {
            data.rows.forEach(row => {
                let match = (chartId && row.chartId === chartId && row.patientName === name) || (!chartId && row.patientName === name);
                if (match) history.push({ date: data.date, doctor: row.doctorName, treatment: row.treatmentContent, amount: row.actualCollected, items: row.treatments });
            });
        }
    });
    return history.sort((a,b) => b.date.localeCompare(a.date));
};

// --- NP RECORDS ---
export const saveNPRecord = async (recordId: string, record: NPRecord) => {
    const docRef = db.collection('np_records').doc(recordId);
    await docRef.set(deepSanitize({ ...record, id: recordId, updatedAt: new Date().toISOString() }), { merge: true });
};

export const updateNPRecord = async (recordId: string, updates: Partial<NPRecord>) => {
    const docRef = db.collection('np_records').doc(recordId);
    await docRef.update(deepSanitize({ ...updates, updatedAt: new Date().toISOString() }));
};

export const deleteNPRecord = async (id: string) => {
    await db.collection('np_records').doc(id).set({ isHidden: true }, { merge: true });
};

export const getNPRecord = async (clinicId: string, date: string, patientName: string) => {
    const q = await db.collection('np_records')
        .where('clinicId', '==', clinicId)
        .where('date', '==', date)
        .where('patientName', '==', patientName)
        .limit(1)
        .get();
        
    return !q.empty ? q.docs[0].data() as NPRecord : null;
};

export const getMarketingTags = async (): Promise<string[]> => {
    const doc = await db.collection('settings').doc('marketing_tags').get();
    return doc.exists ? (doc.data()?.tags || []) : ['矯正諮詢', '植牙諮詢', '美白', '其他'];
};

export const saveMarketingTags = async (tags: string[]) => {
    await db.collection('settings').doc('marketing_tags').set({ tags: deepSanitize(tags) }, { merge: true });
};

// --- DAILY CLOSING & LOCKING ---

export const lockDailyReport = async (date: string, clinicId: string, rows: AccountingRow[], user: {uid: string, name: string}) => {
    const docId = `${clinicId}_${date}`;
    const batch = db.batch();
    const dailyRef = db.collection('daily_accounting').doc(docId);
    
    batch.update(dailyRef, {
        isLocked: true,
        auditLog: firebase.firestore.FieldValue.arrayUnion(deepSanitize({
            timestamp: new Date().toISOString(), userId: user.uid, userName: user.name, action: 'LOCK'
        }))
    });

    const groups: Record<string, AccountingRow[]> = {};
    rows.forEach(r => {
        // Skip invalid rows without name
        if (!r.patientName || !r.patientName.trim()) return;

        const key = `${r.chartId || 'NP'}_${r.patientName}`;
        if(!groups[key]) groups[key] = [];
        groups[key].push(r);
    });

    for (const key in groups) {
        const groupRows = groups[key];
        const rep = groupRows[0]; 
        
        // Double safety check
        if (!rep.patientName) continue;

        const chartId = rep.chartId || null; 
        const name = rep.patientName;
        // Fix potential crash: Safe replace
        const safeName = name.replace(/[\/\s]/g, '_');
        const patientDocId = `${clinicId}_${chartId || 'NP'}_${safeName}`;
        const patientRef = db.collection('patients').doc(patientDocId);

        let totalSpend = 0;
        const items = new Set<string>();
        
        // Prepare visit history data with strict sanitization for arrayUnion
        const visitHistoryData = groupRows.map(r => deepSanitize({
            date, 
            doctor: r.doctorName || '', 
            treatment: r.treatmentContent || '', 
            amount: r.actualCollected || 0
        }));

        groupRows.forEach(r => {
            totalSpend += (r.actualCollected || 0);
            const t = r.treatments as any;
            if (t.prostho > 0) items.add('假牙');
            if (t.implant > 0) items.add('植牙');
            if (t.ortho > 0) items.add('矯正');
            if (t.sov > 0) items.add('SOV');
            if (t.inv > 0) items.add('隱適美');
            if (t.whitening > 0) items.add('美白');
            if (t.perio > 0) items.add('牙周');
        });

        const purchasedItemsArray = Array.from(items);

        batch.set(patientRef, deepSanitize({
            clinicId, chartId, name, lastVisit: date,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            totalSpending: firebase.firestore.FieldValue.increment(totalSpend),
            // Use undefined check to avoid empty arrayUnion calls if necessary, but empty is safe with ...spread
            purchasedItems: purchasedItemsArray.length > 0 ? firebase.firestore.FieldValue.arrayUnion(...purchasedItemsArray) : undefined,
            visitHistory: visitHistoryData.length > 0 ? firebase.firestore.FieldValue.arrayUnion(...visitHistoryData) : undefined
        }), { merge: true });
    }
    await batch.commit();
};

export const unlockDailyReport = async (date: string, clinicId: string, user: {uid: string, name: string}) => {
    const docId = `${clinicId}_${date}`;
    await db.collection('daily_accounting').doc(docId).update({
        isLocked: false,
        auditLog: firebase.firestore.FieldValue.arrayUnion(deepSanitize({
            timestamp: new Date().toISOString(), userId: user.uid, userName: user.name, action: 'UNLOCK'
        }))
    });
};

export const checkPreviousUnlocked = async (currentDate: string, clinicId: string): Promise<string[]> => {
    // Look back 60 days
    const pastDate = new Date(currentDate); 
    pastDate.setDate(pastDate.getDate() - 60);
    const minDateStr = pastDate.toISOString().split('T')[0];
    
    // Correct range query interpolation
    const snap = await db.collection('daily_accounting')
        .where(firebase.firestore.FieldPath.documentId(), '>=', `${clinicId}_${minDateStr}`)
        .where(firebase.firestore.FieldPath.documentId(), '<', `${clinicId}_${currentDate}`)
        .get();

    const unlocked: string[] = [];
    snap.forEach(doc => {
        const data = doc.data() as DailyAccountingRecord;
        if (data.clinicId === clinicId && !data.isLocked) {
            unlocked.push(data.date);
        }
    });
    return unlocked.sort();
};

// --- MONTHLY CLOSING ---

export const getMonthlyClosingStatus = async (clinicId: string, yearMonth: string): Promise<MonthlyClosing | null> => {
    const docId = `${clinicId}_${yearMonth}`;
    const doc = await db.collection('monthly_closings').doc(docId).get();
    return doc.exists ? (doc.data() as MonthlyClosing) : null;
};

export const lockMonthlyReport = async (clinicId: string, yearMonth: string, user: { uid: string, name: string }) => {
    const startId = `${clinicId}_${yearMonth}-01`;
    const endId = `${clinicId}_${yearMonth}-31`;
    
    const snap = await db.collection('daily_accounting')
        .where(firebase.firestore.FieldPath.documentId(), '>=', startId)
        .where(firebase.firestore.FieldPath.documentId(), '<=', endId)
        .get();

    const unlockedDates: string[] = [];
    snap.forEach(doc => {
        const data = doc.data() as DailyAccountingRecord;
        if (!data.isLocked) unlockedDates.push(data.date);
    });

    if (unlockedDates.length > 0) {
        throw new Error("無法鎖定，以下日期尚未結帳：\n" + unlockedDates.sort().join(", "));
    }

    const docId = `${clinicId}_${yearMonth}`;
    const payload: MonthlyClosing = {
        clinicId, month: yearMonth, isLocked: true,
        lockedAt: new Date().toISOString(),
        lockedBy: { uid: user.uid, name: user.name }
    };
    // Fix: Correctly access the document reference before calling set()
    await db.collection('monthly_closings').doc(docId).set(deepSanitize(payload));
};

export const unlockMonthlyReport = async (clinicId: string, yearMonth: string) => {
    const docId = `${clinicId}_${yearMonth}`;
    await db.collection('monthly_closings').doc(docId).update({
        isLocked: false,
        unlockedAt: new Date().toISOString()
    });
};

export const findPatientIdByName = async (name: string, clinicId: string): Promise<string | null> => {
    const q = await db.collection('patients').where('clinicId', '==', clinicId).where('name', '==', name).limit(1).get();
    return !q.empty ? (q.docs[0].data() as Patient).chartId || null : null;
};

export const findPatientProfile = async (clinicId: string, name: string, chartId?: string | null): Promise<Patient | null> => {
    if (chartId) {
        const docId = `${clinicId}_${chartId}_${name.replace(/[\/\s]/g, '_')}`;
        const doc = await db.collection('patients').doc(docId).get();
        if (doc.exists) return { docId: doc.id, ...doc.data() } as Patient;
    }
    const q = await db.collection('patients').where('clinicId', '==', clinicId).where('name', '==', name).limit(1).get();
    return !q.empty ? { docId: q.docs[0].id, ...q.docs[0].data() } as Patient : null;
}

export const getYearlySickLeaveCount = async (clinicId: string, staffId: string, year: number, currentMonth: number): Promise<number> => {
    const doc = await db.collection('clinics').doc(clinicId).get();
    if (!doc.exists) return 0;
    const schedules = (doc.data()?.schedules || []) as DailySchedule[];
    
    let count = 0;
    const prefix = `${year}-`;
    const monthStart = `${year}-${String(currentMonth).padStart(2, '0')}-01`;

    schedules.forEach(s => {
        if (s.date >= prefix + '01-01' && s.date < monthStart) {
            const leave = s.staffConfiguration?.leave?.find(l => l.id === staffId);
            if (leave && leave.type.includes('病假')) {
                count += leave.type.includes('(半)') ? 0.5 : 1.0;
            }
        }
    });
    return count;
};

export interface MonthlyScheduleStats {
    [staffId: string]: {
        personalLeave: number;
        sickLeave: number;
        sundayOT: number;
        lateCount: number;
        specialLeave: number;
    }
}

export const getMonthlyScheduleStats = async (clinicId: string, yearMonth: string): Promise<MonthlyScheduleStats> => {
    const doc = await db.collection('clinics').doc(clinicId).get();
    if (!doc.exists) return {};
    
    const schedules = (doc.data()?.schedules || []) as DailySchedule[];
    const stats: MonthlyScheduleStats = {};

    schedules.forEach(s => {
        if (s.date.startsWith(yearMonth)) {
            const config = s.staffConfiguration;
            if (!config) return;

            const dateObj = new Date(s.date);
            const isSunday = dateObj.getDay() === 0;

            // 1. Process Lates
            if (config.late) {
                config.late.forEach(id => {
                    if (!stats[id]) stats[id] = { personalLeave: 0, sickLeave: 0, sundayOT: 0, lateCount: 0, specialLeave: 0 };
                    stats[id].lateCount++;
                });
            }

            // 2. Process Leaves
            if (config.leave) {
                config.leave.forEach(l => {
                    const id = l.id;
                    if (!stats[id]) stats[id] = { personalLeave: 0, sickLeave: 0, sundayOT: 0, lateCount: 0, specialLeave: 0 };
                    
                    const duration = l.type.includes('(半)') ? 0.5 : 1.0;
                    const type = l.type.replace(/\(.*\)/, '');
                    
                    if (type === '事假') stats[id].personalLeave += duration;
                    else if (type === '病假') stats[id].sickLeave += duration;
                    else if (['特休', '公假', '婚假', '喪假', '產假'].includes(type)) stats[id].specialLeave += duration;
                    else stats[id].personalLeave += duration;
                });
            }

            // 3. Process Sunday OT
            if (isSunday) {
                // Check explicit OT
                if (config.overtime) {
                    config.overtime.forEach(ot => {
                        const id = ot.id;
                        if (!stats[id]) stats[id] = { personalLeave: 0, sickLeave: 0, sundayOT: 0, lateCount: 0, specialLeave: 0 };
                        const duration = ot.type.includes('(半)') ? 0.5 : 1.0;
                        stats[id].sundayOT += duration;
                    });
                }
                // Also check if NOT off and NOT on leave (implicit OT)
                // This logic is usually handled by UI but we safeguard here
            }
        }
    });

    return stats;
};

export const seedTestEnvironment = async () => { console.log("Seeding skipped."); };
