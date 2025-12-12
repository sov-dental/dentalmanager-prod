
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import { AppData, DailyAccountingRecord, AccountingRow, TechnicianRecord, MonthlyTarget, Clinic, NHIRecord, SalaryAdjustment, Consultant, InsuranceGrade, User, UserRole, Doctor, Laboratory, SOVReferral, DailySchedule, AuditLogEntry } from '../types';

// --- CONFIGURATION STRATEGY: HOSTNAME BASED ---

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

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isProd = hostname.includes('-prod');
const firebaseConfig = isProd ? prodConfig : devConfig;

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
  '古亭蒔光': 5,
  '古亭蒔穗': 5
};

// --- AUTH HELPERS ---
export const signInWithPopup = (authInstance: any, provider: any) => authInstance.signInWithPopup(provider);
export const signOut = (authInstance: any) => authInstance.signOut();

export const onAuthStateChanged = (cb: (user: firebase.User | null) => void) => {
  return auth.onAuthStateChanged(cb);
};

const DOC_ID = 'demo-clinic';

// --- DATA HELPERS --- (Sanitize, Hydrate, Sort, Upload...)

export const deepSanitize = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj; 
  
  if (Array.isArray(obj)) {
    return obj.map(deepSanitize);
  }
  
  const result: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = deepSanitize(obj[key]);
    }
  }
  return result;
};

export const sanitizeRow = (row: AccountingRow): AccountingRow => {
    const num = (v: any) => (typeof v === 'number' && !isNaN(v)) ? v : 0;
    const str = (v: any) => (v ? String(v) : '');
    return {
        id: str(row.id),
        patientName: str(row.patientName),
        doctorName: str(row.doctorName),
        doctorId: str(row.doctorId),
        treatments: {
            regFee: num(row.treatments?.regFee),
            copayment: num(row.treatments?.copayment),
            sov: num(row.treatments?.sov),
            ortho: num(row.treatments?.ortho),
            prostho: num(row.treatments?.prostho),
            implant: num(row.treatments?.implant),
            whitening: num(row.treatments?.whitening),
            perio: num(row.treatments?.perio),
            inv: num(row.treatments?.inv),
            otherSelfPay: num(row.treatments?.otherSelfPay),
            consultant: str(row.treatments?.consultant)
        },
        retail: {
            diyWhitening: num(row.retail?.diyWhitening),
            products: num(row.retail?.products),
            productNote: str(row.retail?.productNote),
            staff: str(row.retail?.staff)
        },
        technician: str(row.technician),
        selfPayItem: str(row.selfPayItem), 
        retailItem: str(row.retailItem),
        paymentBreakdown: {
            cash: num(row.paymentBreakdown?.cash),
            card: num(row.paymentBreakdown?.card),
            transfer: num(row.paymentBreakdown?.transfer)
        },
        actualCollected: num(row.actualCollected),
        paymentMethod: str(row.paymentMethod) || 'cash',
        isPaymentManual: !!row.isPaymentManual,
        npStatus: str(row.npStatus),
        treatmentContent: str(row.treatmentContent),
        labName: str(row.labName),
        labFee: num(row.labFee),
        isManual: !!row.isManual,
        isManualName: !!row.isManualName,
        attendance: row.attendance !== undefined ? row.attendance : true,
        startTime: row.startTime || null,
        originalDate: row.originalDate || null, 
        matchStatus: row.matchStatus || null,
        chartId: str(row.chartId),
        patientStatus: str(row.patientStatus)
    } as any;
};

export const hydrateRow = (row: any): AccountingRow => {
    return {
        ...row,
        chartId: row.chartId || "",
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
            if (!data.name || Array.isArray(data.clinics)) return null;
            return {
                id: doc.id,
                name: data.name || doc.id,
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
  // 1. Load Main Doc (Legacy Root)
  const docRef = db.collection('clinics').doc(DOC_ID);
  const doc = await docRef.get();
  
  let data: AppData = { 
      clinics: [], doctors: [], consultants: [], laboratories: [], sovReferrals: [], schedules: [], allowedUsers: [] 
  };

  if (doc.exists) {
    data = doc.data() as AppData;
  }

  // 2. Load Real Clinics Collection (Hybrid)
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

  // 3. CRITICAL: Load Staff Profiles Collection
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
  await docRef.set(data, { merge: true });
};

export const saveDoctors = async (clinicId: string, doctors: Doctor[]) => {};
export const saveLaboratories = async (clinicId: string, labs: Laboratory[]) => {
    // Only update the lab array inside the clinic doc if using legacy storage
    // But since we are moving towards independent collections or embedded arrays, 
    // for now we stick to embedded array update in 'clinics' collection.
    await db.collection('clinics').doc(clinicId).update({ laboratories: labs });
};

export const saveSchedules = async (clinicId: string, schedules: DailySchedule[]) => {
    try {
        await db.collection('clinics').doc(clinicId).update({ schedules });
    } catch (error) {
        console.error(`[saveSchedules] Failed to save schedules for clinic ${clinicId}:`, error);
        throw error;
    }
};

export const saveSOVReferrals = async (clinicId: string, referrals: SOVReferral[]) => {};

// --- NEW COLLECTIONS ---

export const getStaffList = async (clinicId: string): Promise<Consultant[]> => {
    const snap = await db.collection('staff_profiles')
        .where('clinicId', '==', clinicId)
        .where('isActive', '==', true)
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Consultant));
};

export const saveStaff = async (staff: Consultant) => {
    await db.collection('staff_profiles').doc(staff.id).set(staff, { merge: true });
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
    await db.collection('settings').doc('insurance_table').set({ grades });
};

export const getAllUsers = async (): Promise<User[]> => {
    const snap = await db.collection('users').get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() } as User));
};

export const updateUserRole = async (uid: string, role: UserRole) => {
    await db.collection('users').doc(uid).update({ role });
};

export const updateUserClinicAccess = async (user: User, allowedClinics: string[]) => {
    await db.collection('users').doc(user.uid).update({ allowedClinics });
};

export const getRolePermissions = async (): Promise<Record<string, string[]>> => {
    const doc = await db.collection('settings').doc('role_permissions').get();
    return doc.exists ? doc.data() as Record<string, string[]> : {};
};

export const saveRolePermissions = async (perms: Record<string, string[]>) => {
    await db.collection('settings').doc('role_permissions').set(perms);
};

// 5. Daily Accounting

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
    const payload: any = deepSanitize(record);
    if (auditEntry) {
        payload.auditLog = firebase.firestore.FieldValue.arrayUnion(auditEntry);
    }
    await db.collection('daily_accounting').doc(docId).set(payload, { merge: true });

    const updates = record.rows.filter(r => r.patientName).map(r => 
        upsertPatientFromEvent(record.clinicId, {
            chartId: r.chartId || null,
            name: r.patientName,
            lastVisitDate: record.date
        })
    );
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

// 6. Technician Records
export const getTechnicianRecords = async (clinicId: string, labName: string | null, month: string): Promise<TechnicianRecord[]> => {
    let query = db.collection('technician_records')
        .where('clinicId', '==', clinicId)
        .where('date', '>=', `${month}-01`)
        .where('date', '<=', `${month}-31`);
        
    const snap = await query.get();
    let results = snap.docs.map(d => ({ id: d.id, ...d.data() } as TechnicianRecord));
    
    // Client-side filtering if labName is provided
    if (labName) {
        results = results.filter(r => r.labName === labName);
    }
    return results;
};

export const saveTechnicianRecord = async (record: TechnicianRecord) => {
    const id = record.id || crypto.randomUUID();
    await db.collection('technician_records').doc(id).set({ ...record, id }, { merge: true });
};

export const deleteTechnicianRecord = async (id: string) => {
    await db.collection('technician_records').doc(id).delete();
};

// 7. Dashboard & BI
export interface ClinicMonthlySummary {
    clinicId: string;
    clinicName: string;
    actualRevenue: number;
    actualVisits: number;
    actualSelfPay: number;
    targets: MonthlyTarget;
}

export const fetchDashboardSnapshot = async (clinics: Clinic[], month: string): Promise<{
    current: ClinicMonthlySummary[],
    lastMonth: ClinicMonthlySummary[],
    lastYear: ClinicMonthlySummary[]
}> => {
    const processMonth = async (m: string) => {
        const summaries: ClinicMonthlySummary[] = [];
        
        for (const clinic of clinics) {
            const targetDoc = await db.collection('monthly_targets').doc(`${clinic.id}_${m}`).get();
            const targets = targetDoc.exists ? targetDoc.data() as MonthlyTarget : { revenueTarget: 0, visitTarget: 0, selfPayTarget: 0 };

            const rows = await getMonthlyAccounting(clinic.id, m);
            
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

            const nhiRecords = await getNHIRecords(clinic.id, m);
            const nhiTotal = nhiRecords.reduce((sum, r) => sum + r.amount, 0);
            revenue += nhiTotal;

            summaries.push({
                clinicId: clinic.id,
                clinicName: clinic.name,
                actualRevenue: revenue,
                actualVisits: visits,
                actualSelfPay: selfPay,
                targets
            });
        }
        return summaries;
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
    await db.collection('monthly_targets').doc(`${clinicId}_${month}`).set(target, { merge: true });
};

// 8. NHI Records
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
        batch.set(ref, { ...rec, id }, { merge: true });
    });
    await batch.commit();
};

// 9. Salary Adjustments
export const getClinicSalaryAdjustments = async (clinicId: string, month: string): Promise<SalaryAdjustment[]> => {
    const snap = await db.collection('salary_adjustments')
        .where('clinicId', '==', clinicId)
        .where('month', '==', month)
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SalaryAdjustment));
};

export const addSalaryAdjustment = async (adj: SalaryAdjustment) => {
    await db.collection('salary_adjustments').add(adj);
};

export const deleteSalaryAdjustment = async (id: string) => {
    await db.collection('salary_adjustments').doc(id).delete();
};

// 10. Bonus Settings
export const getBonusSettings = async (clinicId: string, month: string): Promise<any> => {
    const doc = await db.collection('bonus_settings').doc(`${clinicId}_${month}`).get();
    return doc.exists ? doc.data() : null;
};

export const saveBonusSettings = async (clinicId: string, month: string, settings: any) => {
    await db.collection('bonus_settings').doc(`${clinicId}_${month}`).set(settings, { merge: true });
};

// --- CRM / PATIENT LOGIC ---

export interface Patient {
    docId: string;
    clinicId: string;
    chartId: string | null;
    name: string;
    lastVisit: string;
    purchasedItems?: string[]; // Auto-generated from Payment Records
    visitHistory?: any[];     // Optional full history
    totalSpending?: number;
    aliases?: string[]; // Added: For Smart Search
    updatedAt?: any;
}

// --- NEW: MARKETING / NP RECORDS ---
export interface NPRecord {
    id?: string;
    date: string; // YYYY-MM-DD
    clinicId: string;
    clinicName?: string; // Enhanced: For Dashboard Filtering
    patientName: string;
    treatment: string;
    doctor?: string; // Legacy ID or Name
    doctorName?: string; // Enhanced: For Dashboard Filtering
    marketingTag?: string; // e.g. "植牙", "矯正"
    source?: string; // 'FB', 'Line', '電話', '介紹', '過路客', '其他'
    isVisited: boolean;
    isClosed: boolean; // Deal closed
    dealAmount?: number;
    consultant?: string;
    note?: string;
    updatedAt: any;
}

// --- NEW: MARKETING TAGS HELPERS ---
export const getMarketingTags = async (): Promise<string[]> => {
    const doc = await db.collection('settings').doc('marketing_tags').get();
    if (doc.exists) {
        return (doc.data()?.tags || []);
    }
    // Default Tags if not found
    return ['植牙', '矯正', '貼片/美白', '牙周', '一般健保', '其他'];
};

export const saveMarketingTags = async (tags: string[]) => {
    await db.collection('settings').doc('marketing_tags').set({ tags }, { merge: true });
};

// --- NEW: NP RECORDS HELPERS (For Dashboard) ---
export const getNPRecordsRange = async (clinicId: string, startStr: string, endStr: string): Promise<NPRecord[]> => {
    // Note: NP Records ID format is `clinicId_date_patientName`
    const startId = `${clinicId}_${startStr}`;
    const endId = `${clinicId}_${endStr}\uf8ff`; // \uf8ff ensures we get everything starting with the date

    const snap = await db.collection('np_records')
        .where(firebase.firestore.FieldPath.documentId(), '>=', startId)
        .where(firebase.firestore.FieldPath.documentId(), '<=', endId)
        .get();

    return snap.docs.map(d => ({ id: d.id, ...d.data() } as NPRecord));
};

export const saveNPRecord = async (record: NPRecord) => {
    const safeName = (record.patientName || 'Unknown').replace(/\s+/g, '_');
    const id = `${record.clinicId}_${record.date}_${safeName}`;
    const docRef = db.collection('np_records').doc(id);
    
    const payload = JSON.parse(JSON.stringify({ 
        ...record, 
        id,
        updatedAt: new Date().toISOString() // Use ISO string for safety
    }));

    await docRef.set(payload, { merge: true });
};

export const deleteNPRecord = async (clinicId: string, date: string, patientName: string) => {
    const safeName = (patientName || 'Unknown').replace(/\s+/g, '_');
    const id = `${clinicId}_${date}_${safeName}`;
    await db.collection('np_records').doc(id).delete();
};

export const getNPRecord = async (clinicId: string, date: string, patientName: string) => {
    const safeName = (patientName || 'Unknown').replace(/\s+/g, '_');
    const id = `${clinicId}_${date}_${safeName}`;
    const doc = await db.collection('np_records').doc(id).get();
    return doc.exists ? doc.data() as NPRecord : null;
};

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

export const findPatientIdByName = async (name: string, clinicId: string): Promise<string | null> => {
    const q1 = await db.collection('patients')
        .where('clinicId', '==', clinicId)
        .where('name', '==', name)
        .limit(1)
        .get();
    
    if (!q1.empty) return q1.docs[0].data().chartId || null;

    const q2 = await db.collection('patients')
        .where('clinicId', '==', clinicId)
        .where('aliases', 'array-contains', name)
        .limit(1)
        .get();

    if (!q2.empty) return q2.docs[0].data().chartId || null;

    return null;
}

export const upsertPatientFromEvent = async (clinicId: string, event: { chartId: string | null, name: string, lastVisitDate: string }) => {
    if (!clinicId || !event.name) return;
    let docId = '';
    if (event.chartId) {
        docId = `${clinicId}_${event.chartId}`;
    } else {
        docId = `${clinicId}_NAME_${event.name.replace(/\s+/g, '_')}`;
    }
    const docRef = db.collection('patients').doc(docId);
    
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
        const existing = docSnap.data() as Patient;
        const updateData: any = {
            clinicId,
            chartId: event.chartId || null,
            lastVisit: (event.lastVisitDate > existing.lastVisit) ? event.lastVisitDate : existing.lastVisit,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (existing.name !== event.name) {
            updateData.name = event.name;
            const oldAliases = existing.aliases || [];
            if (!oldAliases.includes(existing.name)) {
                updateData.aliases = firebase.firestore.FieldValue.arrayUnion(existing.name);
            }
        }
        await docRef.update(updateData);
    } else {
        await docRef.set({
            clinicId,
            chartId: event.chartId || null,
            name: event.name,
            lastVisit: event.lastVisitDate,
            aliases: [],
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
};

// SMART MERGE LOGIC
export const migratePatientId = async (oldDocId: string, newChartId: string, clinicId: string) => {
    const oldRef = db.collection('patients').doc(oldDocId);
    const oldSnap = await oldRef.get();
    
    if (!oldSnap.exists) throw new Error("Patient not found");
    const oldData = oldSnap.data() as Patient;

    // Target Doc ID
    const newDocId = `${clinicId}_${newChartId}`;
    const newRef = db.collection('patients').doc(newDocId);
    const newSnap = await newRef.get();

    if (newSnap.exists) {
        const newData = newSnap.data() as Patient;
        const mergedPurchased = Array.from(new Set([...(newData.purchasedItems || []), ...(oldData.purchasedItems || [])]));
        const mergedHistory = [...(newData.visitHistory || []), ...(oldData.visitHistory || [])];
        const lastVisit = (newData.lastVisit > oldData.lastVisit) ? newData.lastVisit : oldData.lastVisit;
        const totalSpending = (newData.totalSpending || 0) + (oldData.totalSpending || 0);

        let aliases = newData.aliases || [];
        if (oldData.name !== newData.name && !aliases.includes(oldData.name)) {
            aliases.push(oldData.name);
        }
        if (oldData.aliases) {
            aliases = [...new Set([...aliases, ...oldData.aliases])];
        }

        await newRef.update({
            purchasedItems: mergedPurchased,
            visitHistory: mergedHistory,
            lastVisit,
            totalSpending,
            aliases,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } else {
        await newRef.set({
            ...oldData,
            chartId: newChartId,
            docId: newDocId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
    await oldRef.delete();
};

export const getPatientHistory = async (clinicId: string, name: string, chartId: string | null) => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 180); 
    
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const snap = await db.collection('daily_accounting')
        .where(firebase.firestore.FieldPath.documentId(), '>=', `${clinicId}_${startStr}`)
        .where(firebase.firestore.FieldPath.documentId(), '<=', `${clinicId}_${endStr}`)
        .get();

    const history: any[] = [];
    
    snap.forEach(doc => {
        const data = doc.data() as DailyAccountingRecord;
        if (!data.rows) return;
        
        data.rows.forEach(row => {
            let match = false;
            if (chartId && row.chartId === chartId) match = true;
            else if (row.patientName === name) match = true;

            if (match) {
                history.push({
                    date: data.date,
                    doctor: row.doctorName,
                    treatment: row.treatmentContent,
                    amount: row.actualCollected,
                    items: row.treatments 
                });
            }
        });
    });

    return history.sort((a,b) => b.date.localeCompare(a.date));
};

// --- DAILY CLOSING & LOCKING ---

export const checkPreviousUnlocked = async (currentDate: string, clinicId: string): Promise<string[]> => {
    const pastDate = new Date(currentDate);
    pastDate.setDate(pastDate.getDate() - 30);
    const minDateStr = pastDate.toISOString().split('T')[0];

    const snap = await db.collection('daily_accounting')
        .where(firebase.firestore.FieldPath.documentId(), '>=', `${clinicId}_${minDateStr}`)
        .where(firebase.firestore.FieldPath.documentId(), '<', `${clinicId}_${currentDate}`)
        .get();

    const unlockedDates: string[] = [];
    snap.forEach(doc => {
        const data = doc.data() as DailyAccountingRecord;
        if (!data.isLocked) {
            unlockedDates.push(data.date);
        }
    });
    
    return unlockedDates.sort();
};

const extractPurchasedItems = (row: AccountingRow): string[] => {
    const items: string[] = [];
    const t = row.treatments as any;
    
    if (t.prostho > 0) items.push('假牙');
    if (t.implant > 0) items.push('植牙');
    if (t.ortho > 0) items.push('矯正');
    if (t.sov > 0) items.push('SOV');
    if (t.inv > 0) items.push('隱適美');
    if (t.whitening > 0) items.push('美白');
    if (t.perio > 0) items.push('牙周');
    
    // Retail
    if (row.retail.products > 0) items.push('物販');
    if (row.retail.diyWhitening > 0) items.push('小金庫');

    return items;
};

export const lockDailyReport = async (date: string, clinicId: string, rows: AccountingRow[], user: {uid: string, name: string}) => {
    const docId = `${clinicId}_${date}`;
    const batch = db.batch();
    
    const dailyRef = db.collection('daily_accounting').doc(docId);
    batch.update(dailyRef, {
        isLocked: true,
        auditLog: firebase.firestore.FieldValue.arrayUnion({
            timestamp: new Date().toISOString(),
            userId: user.uid,
            userName: user.name,
            action: 'LOCK'
        })
    });

    const rowPromises = rows.map(async (row) => {
        let patientDocId = '';
        if (row.chartId) {
            patientDocId = `${clinicId}_${row.chartId}`;
        } else {
            patientDocId = `${clinicId}_NAME_${row.patientName.replace(/\s+/g, '_')}`;
        }
        const ref = db.collection('patients').doc(patientDocId);
        const snap = await ref.get();
        return { row, ref, snap };
    });

    const results = await Promise.all(rowPromises);

    for (const { row, ref, snap } of results) {
        const visitSummary = {
            date,
            doctor: row.doctorName,
            treatment: row.treatmentContent || '',
            amount: row.actualCollected || 0
        };

        const purchased = extractPurchasedItems(row);

        let updateData: any = {
            clinicId,
            chartId: row.chartId || null,
            visitHistory: firebase.firestore.FieldValue.arrayUnion(visitSummary),
            totalSpending: firebase.firestore.FieldValue.increment(row.actualCollected || 0),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (purchased.length > 0) {
            updateData.purchasedItems = firebase.firestore.FieldValue.arrayUnion(...purchased);
        }

        if (snap.exists) {
            const existing = snap.data() as Patient;
            
            if (existing.name !== row.patientName) {
                updateData.name = row.patientName;
                const oldAliases = existing.aliases || [];
                if (!oldAliases.includes(existing.name)) {
                    updateData.aliases = firebase.firestore.FieldValue.arrayUnion(existing.name);
                }
            } else {
                updateData.name = row.patientName; 
            }
            
            if (!existing.lastVisit || date >= existing.lastVisit) {
                updateData.lastVisit = date;
            }

            batch.set(ref, updateData, { merge: true });
        } else {
            updateData.name = row.patientName;
            updateData.lastVisit = date;
            updateData.aliases = [];
            batch.set(ref, updateData, { merge: true });
        }
    }

    await batch.commit();
};

export const unlockDailyReport = async (date: string, clinicId: string, user: {uid: string, name: string}) => {
    const docId = `${clinicId}_${date}`;
    await db.collection('daily_accounting').doc(docId).update({
        isLocked: false,
        auditLog: firebase.firestore.FieldValue.arrayUnion({
            timestamp: new Date().toISOString(),
            userId: user.uid,
            userName: user.name,
            action: 'UNLOCK'
        })
    });
};

export const seedTestEnvironment = async () => {
    console.log("Seeding skipped.");
};
