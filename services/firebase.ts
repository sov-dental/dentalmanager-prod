import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import { AppData, DailyAccountingRecord, AccountingRow, TechnicianRecord, MonthlyTarget, Clinic, NHIRecord, SalaryAdjustment, Consultant, InsuranceGrade } from '../types';

// --- CONFIGURATION STRATEGY: HOSTNAME BASED ---

// 1. Development Configuration
// (Paste your Development/Test Project keys here)
const devConfig = {
  apiKey: "AIzaSyC77kXgBNUGdyNV-JJ-Lkn5qYNDJwVKSrE", 
  authDomain: "sunlight-schedule-data.firebaseapp.com",
  projectId: "sunlight-schedule-data",
  storageBucket: "sunlight-schedule-data.firebasestorage.app",
  messagingSenderId: "534278828682",
  appId: "1:534278828682:web:681029e46b7b0a3ef1f373"
};

// 2. Production Configuration
// (Paste your Production/Live Project keys here)
const prodConfig = {
  apiKey: "AIzaSyD252Ef1MRy9m-k1IEtYUhGQVeP9gd1KYw",
  authDomain: "sunlight-schedule-data-prod.firebaseapp.com",
  projectId: "sunlight-schedule-data-prod",
  storageBucket: "sunlight-schedule-data-prod.firebasestorage.app",
  messagingSenderId: "102873326358",
  appId: "1:102873326358:web:86d41907668f845c572637"
};

// 3. Switching Logic
// Detects environment based on the browser's URL hostname
const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

// Logic: If the URL contains '-prod', it is the Production Environment.
// Everything else (including localhost, or the original url) is Development.
const isProd = hostname.includes('-prod');

console.log("Current Hostname:", hostname);
console.log("Config Mode:", isProd ? "PRODUCTION" : "DEVELOPMENT");

const firebaseConfig = isProd ? prodConfig : devConfig;

// --- SINGLETON INITIALIZATION (COMPAT) ---
const app = !firebase.apps.length 
  ? firebase.initializeApp(firebaseConfig) 
  : firebase.app();

export const db = firebase.firestore();
export const auth = firebase.auth();
export const storage = firebase.storage();

// Explicitly set persistence
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error) => {
  console.error("Firebase Auth Persistence Error:", error);
});

export const googleProvider = new firebase.auth.GoogleAuthProvider();

// --- AUTH HELPERS ---
export const signInWithPopup = (authInstance: any, provider: any) => authInstance.signInWithPopup(provider);
export const signOut = (authInstance: any) => authInstance.signOut();

export const onAuthStateChanged = (cb: (user: firebase.User | null) => void) => {
  return auth.onAuthStateChanged(cb);
};

const DOC_ID = 'demo-clinic';

// --- DATA HELPERS ---

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
        isArrived: !!row.isArrived,
        startTime: row.startTime || null,
        originalDate: row.originalDate || null, 
        matchStatus: row.matchStatus || null
    } as any;
};

export const hydrateRow = (row: any): AccountingRow => {
    return {
        ...row,
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
        isArrived: row.isArrived !== undefined ? row.isArrived : (!!row.isManual),
        startTime: row.startTime || new Date().toISOString()
    };
};

export const sortAccountingRows = (rows: AccountingRow[]): AccountingRow[] => {
    return [...rows].sort((a, b) => {
        const docA = a.doctorName || "未指定";
        const docB = b.doctorName || "未指定";
        
        const isUnassigned = (name: string) => 
            name === "未指定" || name === "" || name === "診所公用" || name === "Clinic Shared";

        const unassignedA = isUnassigned(docA);
        const unassignedB = isUnassigned(docB);

        if (!unassignedA && unassignedB) return -1;
        if (unassignedA && !unassignedB) return 1;

        const docDiff = docA.localeCompare(docB, 'zh-TW');
        if (docDiff !== 0) return docDiff;

        const aIsManual = !!a.isManual;
        const bIsManual = !!b.isManual;

        if (!aIsManual && bIsManual) return -1;
        if (aIsManual && !bIsManual) return 1;

        const timeA = a.startTime || "";
        const timeB = b.startTime || "";
        
        if (timeA !== timeB) {
            return timeA.localeCompare(timeB);
        }

        return (a.id || '').localeCompare(b.id || '');
    });
};

export const uploadImage = async (file: File, path: string): Promise<string> => {
    const storageRef = storage.ref();
    const fileRef = storageRef.child(path);
    await fileRef.put(file);
    return await fileRef.getDownloadURL();
};

export const uploadReportImage = async (file: File, clinicId: string, date: string): Promise<string> => {
    const extension = file.name.split('.').pop();
    const path = `reports/${clinicId}/${date}_${Date.now()}.${extension}`;
    return uploadImage(file, path);
};

// --- SYNC PERMISSIONS SYSTEM ---

export const syncUserPermissions = async (user: firebase.User) => {
    if (!user.email) return;
    const email = user.email.trim().toLowerCase();
    
    console.log(`[Permission Sync] Pulling permissions for ${email}...`);

    try {
        const clinicsSnapshot = await db.collection('clinics').get();
        const allowedClinicNames: string[] = [];

        clinicsSnapshot.forEach(doc => {
            const data = doc.data();
            if (doc.id === DOC_ID || Array.isArray(data.clinics)) return;

            const clinicAllowed = Array.isArray(data.allowedUsers) ? data.allowedUsers : [];
            if (clinicAllowed.some((u: any) => String(u).trim().toLowerCase() === email)) {
                if (data.name) allowedClinicNames.push(data.name);
            }
        });

        const userRef = db.collection('users').doc(user.uid);
        const userSnap = await userRef.get();

        if (userSnap.exists) {
            await userRef.update({
                allowedClinics: allowedClinicNames,
                lastSyncedAt: new Date().toISOString()
            });
        } else {
            const role = email.includes('marketing') ? 'marketing' : 'staff';
            await userRef.set({
                email: user.email,
                name: user.displayName || email.split('@')[0],
                role: role,
                allowedClinics: allowedClinicNames,
                createdAt: new Date().toISOString(),
                lastSyncedAt: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error("[Permission Sync] Failed:", error);
    }
};

const pushPermissionUpdates = async (oldClinics: Clinic[], newClinics: Clinic[]) => {
    const oldMap = new Map(oldClinics.map(c => [c.id, c]));

    for (const newClinic of newClinics) {
        const oldClinic = oldMap.get(newClinic.id);
        const normalize = (e: string) => String(e).trim().toLowerCase();

        const newEmailsRaw = newClinic.allowedUsers || [];
        const oldEmailsRaw = oldClinic?.allowedUsers || [];

        const newEmailsNormalized = new Set(newEmailsRaw.map(normalize));
        const oldEmailsNormalized = new Set(oldEmailsRaw.map(normalize));

        const addedEmails = newEmailsRaw.filter(e => !oldEmailsNormalized.has(normalize(e)));
        const removedEmails = oldEmailsRaw.filter(e => !newEmailsNormalized.has(normalize(e)));

        if (addedEmails.length === 0 && removedEmails.length === 0) continue;

        await Promise.all(addedEmails.map(async (email) => {
            try {
                let userQuery = await db.collection('users').where('email', '==', email).limit(1).get();
                if (userQuery.empty && email !== email.toLowerCase()) {
                     userQuery = await db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get();
                }

                if (!userQuery.empty) {
                    const userDoc = userQuery.docs[0];
                    await userDoc.ref.update({
                        allowedClinics: firebase.firestore.FieldValue.arrayUnion(newClinic.name)
                    });
                }
            } catch (e) {
                console.error(`[Permission Sync] ERROR adding ${email}:`, e);
            }
        }));

        await Promise.all(removedEmails.map(async (email) => {
            try {
                let userQuery = await db.collection('users').where('email', '==', email).limit(1).get();
                if (userQuery.empty && email !== email.toLowerCase()) {
                     userQuery = await db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get();
                }

                if (!userQuery.empty) {
                    const userDoc = userQuery.docs[0];
                    await userDoc.ref.update({
                        allowedClinics: firebase.firestore.FieldValue.arrayRemove(newClinic.name)
                    });
                }
            } catch (e) {
                console.error(`[Permission Sync] ERROR removing ${email}:`, e);
            }
        }));
    }
};

// --- APP DATA FUNCTIONS ---

const CLINIC_ORDER_MAP: Record<string, number> = {
  '日亞美': 1,
  '台南蒔光': 2,
  '新竹橙蒔': 3,
  '台中日蒔': 4,
  '古亭蒔光': 5,
  '古亭蒔穗': 5
};

export const getClinics = async (): Promise<Clinic[]> => {
    try {
        console.log("Fetching independent clinics...");
        const snapshot = await db.collection('clinics').get();
        const clinics: Clinic[] = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (doc.id === DOC_ID || Array.isArray(data.clinics)) {
                return; 
            }
            clinics.push({ id: doc.id, ...data } as Clinic);
        });

        return clinics.sort((a, b) => {
            const orderA = CLINIC_ORDER_MAP[a.name] || 999;
            const orderB = CLINIC_ORDER_MAP[b.name] || 999;
            return orderA - orderB;
        });
    } catch (error) {
        console.error("Error fetching clinics:", error);
        return [];
    }
};

export const saveClinic = async (clinic: Clinic) => {
    if (!clinic) return;
    
    const docId = clinic.id || db.collection('clinics').doc().id;
    const docRef = db.collection('clinics').doc(docId);
    
    let oldClinic: Clinic | undefined;
    try {
        const snap = await docRef.get();
        if (snap.exists) oldClinic = snap.data() as Clinic;
    } catch(e) { console.warn("Could not fetch old clinic for diff", e); }

    const clinicToSave = { ...clinic, id: docId };

    console.log(`Saving clinic ${docId} to root collection...`);
    await docRef.set(clinicToSave, { merge: true });
    
    await pushPermissionUpdates(oldClinic ? [oldClinic] : [], [clinicToSave]);
};

// --- STAFF PROFILES FUNCTIONS ---

export const getStaffList = async (clinicId: string): Promise<Consultant[]> => {
    try {
        let query = db.collection('staff_profiles').where('clinicId', '==', clinicId);
        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Consultant));
    } catch (error) {
        console.error(`Error fetching staff for clinic ${clinicId}:`, error);
        return [];
    }
};

export const getAllStaff = async (): Promise<Consultant[]> => {
    try {
        const snapshot = await db.collection('staff_profiles').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Consultant));
    } catch (error) {
        console.error("Error fetching all staff:", error);
        return [];
    }
};

export const saveStaff = async (staff: Consultant) => {
    if (!staff.clinicId) throw new Error("Missing Clinic ID");
    
    const docId = staff.id || db.collection('staff_profiles').doc().id;
    
    const dataToSave = {
        id: docId,
        clinicId: staff.clinicId,
        name: staff.name || '',
        role: staff.role || 'consultant',
        isActive: staff.isActive ?? true,
        onboardDate: staff.onboardDate || null,
        baseSalary: Number(staff.baseSalary) || 0,
        allowance: Number(staff.allowance) || 0,
        insuredSalary: Number(staff.insuredSalary) || 0,
        dependents: Number(staff.dependents) || 0,
        annualLeave: Number(staff.annualLeave) || 0,
        insuranceGradeLevel: Number(staff.insuranceGradeLevel) || 0,
        monthlyInsuranceCost: Number(staff.monthlyInsuranceCost) || 0
    };

    console.log(`[saveStaff] Saving to staff_profiles/${docId}`, dataToSave);
    await db.collection('staff_profiles').doc(docId).set(dataToSave, { merge: true });
};

export const deleteStaff = async (id: string) => {
    if (!id) return;
    console.log(`[deleteStaff] Deleting staff_profiles/${id}`);
    await db.collection('staff_profiles').doc(id).delete();
};

// --- INSURANCE TABLE FUNCTIONS ---

export const getInsuranceTable = async (): Promise<InsuranceGrade[]> => {
    try {
        const doc = await db.collection('settings').doc('insurance_table').get();
        if (doc.exists) {
            return (doc.data()?.grades || []) as InsuranceGrade[];
        }
        return [];
    } catch (e) {
        console.error("Error loading insurance table", e);
        return [];
    }
};

export const saveInsuranceTable = async (grades: InsuranceGrade[]) => {
    try {
        await db.collection('settings').doc('insurance_table').set({ grades }, { merge: true });
    } catch (e) {
        console.error("Error saving insurance table", e);
        throw e;
    }
};

// --- BONUS SETTINGS FUNCTIONS ---

export const saveBonusSettings = async (clinicId: string, month: string, settings: any) => {
    if (!clinicId || !month) throw new Error("Invalid ID params: ClinicId or Month is missing");
    if (settings.poolRate !== undefined) {
        settings.poolRate = Number(settings.poolRate);
    }
    const docId = `${clinicId}_${month}`;
    await db.collection('bonus_settings').doc(docId).set(settings, { merge: true });
    return true;
};

export const getBonusSettings = async (clinicId: string, month: string) => {
    if (!clinicId || !month) return null;
    const docId = `${clinicId}_${month}`;
    try {
        const doc = await db.collection('bonus_settings').doc(docId).get();
        return doc.exists ? doc.data() : null;
    } catch (error) {
        console.error("Error fetching bonus settings:", error);
        return null;
    }
};

export const loadAppData = async (): Promise<AppData> => {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("必須先登入才能存取資料");

  console.log(`[loadAppData] User: ${user.email} loading data...`);

  syncUserPermissions(user).catch(e => console.warn("Background sync failed", e));

  const [independentClinics, allStaff] = await Promise.all([
      getClinics(),
      getAllStaff()
  ]);

  let mainData: any = {};
  try {
      const masterDoc = await db.collection('clinics').doc(DOC_ID).get();
      if (masterDoc.exists) {
          mainData = masterDoc.data();
      }
  } catch(e) { console.error("Legacy load failed", e); }
  
  return {
    clinics: independentClinics,
    doctors: mainData.doctors || [],
    consultants: allStaff, 
    laboratories: mainData.laboratories || [],
    sovReferrals: mainData.sovReferrals || [],
    schedules: mainData.schedules || [],
    allowedUsers: mainData.allowedUsers || [user.email]
  };
};

export const saveAppData = async (newData: AppData) => {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  try {
      const clinicPromises = newData.clinics.map(c => saveClinic(c));
      await Promise.all(clinicPromises);

      const { clinics, consultants, ...otherData } = newData;
      await db.collection('clinics').doc(DOC_ID).set(otherData, { merge: true });
      
  } catch (e: any) {
      console.error("Save Failed:", e);
      throw e;
  }
};

export const seedTestEnvironment = async () => {
    console.log("Seeding triggered (No-op)");
};

// --- DAILY ACCOUNTING FUNCTIONS ---

export const loadDailyAccounting = async (clinicId: string, date: string): Promise<DailyAccountingRecord | null> => {
  if (!clinicId || !date) return null;
  const docId = `${clinicId}_${date}`;
  try {
      const docSnap = await db.collection('daily_accounting').doc(docId).get();
      if (docSnap.exists) {
          return docSnap.data() as DailyAccountingRecord;
      }
      return null;
  } catch (error) {
      console.error("Error loading daily accounting:", error);
      return null;
  }
};

export const saveDailyAccounting = async (record: DailyAccountingRecord) => {
  try {
      if (!record.clinicId || !record.date) throw new Error("Invalid Record ID (Missing clinicId or date)");
      const docId = `${record.clinicId}_${record.date}`;
      
      const cleanRecord = {
          ...record,
          reportImageUrl: record.reportImageUrl || null,
          rows: record.rows.map(sanitizeRow),
          expenditures: record.expenditures || [],
          lastUpdated: Date.now()
      };

      await db.collection('daily_accounting').doc(docId).set(cleanRecord, { merge: true });
  } catch (error: any) {
      alert("Save Error: " + (error.message || JSON.stringify(error)));
      console.error("saveDailyAccounting Error:", error);
      throw error;
  }
};

// --- MONTHLY REPORT FUNCTION ---

export const getMonthlyAccounting = async (clinicId: string, yearMonth: string): Promise<AccountingRow[]> => {
    const startId = `${clinicId}_${yearMonth}-01`;
    const endId = `${clinicId}_${yearMonth}-31` + '\uf8ff';

    try {
        const snapshot = await db.collection('daily_accounting')
            .where(firebase.firestore.FieldPath.documentId(), '>=', startId)
            .where(firebase.firestore.FieldPath.documentId(), '<=', endId)
            .get();

        const flattenedRows: AccountingRow[] = [];

        snapshot.docs.forEach(doc => {
            const data = doc.data() as DailyAccountingRecord;
            const recordDate = data.date; 
            
            if (data.rows && Array.isArray(data.rows)) {
                data.rows.forEach(row => {
                    const hydrated = hydrateRow(row);
                    flattenedRows.push({
                        ...hydrated,
                        originalDate: recordDate
                    });
                });
            }
        });

        return flattenedRows;
    } catch (error) {
        console.error("Error fetching monthly accounting:", error);
        throw error;
    }
};

// --- TECHNICIAN RECONCILIATION FUNCTIONS ---

export const getTechnicianRecords = async (clinicId: string, labName: string | null, yearMonth: string): Promise<TechnicianRecord[]> => {
    if (!clinicId || !yearMonth) return [];
    
    console.log(`[getTechnicianRecords] Fetching for Clinic: ${clinicId}, Lab: ${labName || 'ALL'}, Month: ${yearMonth}`);

    try {
        const snapshot = await db.collection('technician_records')
            .where('clinicId', '==', clinicId)
            .get();

        const records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TechnicianRecord));
        
        const filtered = records.filter(r => {
            const dateMatch = r.date && r.date.startsWith(yearMonth);
            const labMatch = labName ? (r.labName && r.labName.trim() === labName.trim()) : true;
            return dateMatch && labMatch;
        });

        return filtered;
    } catch (error) {
        console.error("Error fetching technician records:", error);
        return [];
    }
};

export const saveTechnicianRecord = async (record: TechnicianRecord) => {
    try {
        if (!record.clinicId) throw new Error("Missing Clinic ID");

        const dataToSave = {
            ...record,
            updatedAt: Date.now()
        };

        if (record.id) {
            await db.collection('technician_records').doc(record.id).set(dataToSave, { merge: true });
        } else {
            const newRef = db.collection('technician_records').doc();
            await newRef.set({ ...dataToSave, id: newRef.id });
        }
    } catch (error) {
        console.error("Error saving technician record:", error);
        throw error;
    }
};

export const deleteTechnicianRecord = async (id: string) => {
    try {
        if (!id) throw new Error("Missing Record ID");
        await db.collection('technician_records').doc(id).delete();
    } catch (error) {
        console.error("Error deleting technician record:", error);
        throw error;
    }
};

// --- NHI CLAIMS FUNCTIONS ---

export const getNHIRecords = async (clinicId: string, month: string): Promise<NHIRecord[]> => {
    if (!clinicId || !month) return [];
    try {
        const snapshot = await db.collection('nhi_records')
            .where('clinicId', '==', clinicId)
            .where('month', '==', month)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NHIRecord));
    } catch (error) {
        console.error("Error fetching NHI records:", error);
        return [];
    }
};

export const saveNHIRecord = async (record: NHIRecord) => {
    try {
        if (!record.clinicId || !record.month || !record.doctorId) {
            throw new Error("Missing required NHI record fields");
        }
        
        const docId = `${record.clinicId}_${record.month}_${record.doctorId}`;
        
        const dataToSave = {
            ...record,
            id: docId,
            updatedAt: Date.now()
        };

        await db.collection('nhi_records').doc(docId).set(dataToSave, { merge: true });
    } catch (error) {
        console.error("Error saving NHI record:", error);
        throw error;
    }
};

export const saveBatchNHIRecords = async (records: NHIRecord[]) => {
    try {
        const promises = records.map(record => saveNHIRecord(record));
        await Promise.all(promises);
    } catch (error) {
        console.error("Error batch saving NHI records:", error);
        throw error;
    }
};

// --- SALARY ADJUSTMENT FUNCTIONS ---

export const getSalaryAdjustments = async (clinicId: string, doctorId: string, month: string): Promise<SalaryAdjustment[]> => {
    try {
        const snapshot = await db.collection('salary_adjustments')
            .where('clinicId', '==', clinicId)
            .where('doctorId', '==', doctorId)
            .where('month', '==', month)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SalaryAdjustment));
    } catch (error) {
        console.error("Error fetching salary adjustments:", error);
        return [];
    }
};

export const getClinicSalaryAdjustments = async (clinicId: string, month: string): Promise<SalaryAdjustment[]> => {
    try {
        const snapshot = await db.collection('salary_adjustments')
            .where('clinicId', '==', clinicId)
            .where('month', '==', month)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SalaryAdjustment));
    } catch (error) {
        console.error("Error fetching clinic salary adjustments:", error);
        return [];
    }
};

export const addSalaryAdjustment = async (adjustment: SalaryAdjustment) => {
    try {
        const docRef = db.collection('salary_adjustments').doc();
        await docRef.set({ ...adjustment, id: docRef.id, updatedAt: Date.now() });
    } catch (error) {
        console.error("Error adding salary adjustment:", error);
        throw error;
    }
};

export const deleteSalaryAdjustment = async (id: string) => {
    try {
        await db.collection('salary_adjustments').doc(id).delete();
    } catch (error) {
        console.error("Error deleting salary adjustment:", error);
        throw error;
    }
};

// --- GROUP DASHBOARD & TARGET FUNCTIONS ---

export const saveMonthlyTarget = async (clinicId: string, yearMonth: string, targets: MonthlyTarget) => {
    const docId = `${clinicId}_${yearMonth}`;
    try {
        await db.collection('monthly_targets').doc(docId).set(targets, { merge: true });
    } catch (e) {
        console.error("Error saving targets", e);
        throw e;
    }
};

export const getMonthlyTargets = async (clinicId: string, yearMonth: string): Promise<MonthlyTarget> => {
    const docId = `${clinicId}_${yearMonth}`;
    try {
        const snap = await db.collection('monthly_targets').doc(docId).get();
        if (snap.exists) {
            return snap.data() as MonthlyTarget;
        }
    } catch (e) {
        console.error("Error fetching targets (likely permission or missing doc):", e);
    }
    return {
        revenueTarget: 0,
        visitTarget: 0,
        selfPayTarget: 0
    };
};

export interface ClinicMonthlySummary {
    clinicId: string;
    clinicName: string;
    actualRevenue: number;
    actualVisits: number;
    actualSelfPay: number;
    targets: MonthlyTarget;
}

const getClinicMonthlySummary = async (clinic: Clinic, yearMonth: string): Promise<ClinicMonthlySummary> => {
    const [rows, targets, nhiRecords] = await Promise.all([
        getMonthlyAccounting(clinic.id, yearMonth),
        getMonthlyTargets(clinic.id, yearMonth),
        getNHIRecords(clinic.id, yearMonth)
    ]);

    let revenue = 0;
    let visits = 0;
    let selfPay = 0;

    rows.forEach(row => {
        if (row.npStatus !== '爽約') {
            visits++;
            revenue += (row.actualCollected || 0);
            
            const t = row.treatments;
            const sp = (t.prostho || 0) + (t.implant || 0) + (t.ortho || 0) + 
                       (t.sov || 0) + (t.perio || 0) + (t.whitening || 0) + 
                       (t.inv || 0) + (t.otherSelfPay || 0);
            selfPay += sp;
        }
    });

    const nhiTotal = nhiRecords.reduce((sum, r) => sum + (r.amount || 0), 0);
    revenue += nhiTotal;

    return {
        clinicId: clinic.id,
        clinicName: clinic.name,
        actualRevenue: revenue,
        actualVisits: visits,
        actualSelfPay: selfPay,
        targets
    };
};

export const fetchGroupData = async (clinics: Clinic[], yearMonth: string): Promise<ClinicMonthlySummary[]> => {
    try {
        const promises = clinics.map(c => getClinicMonthlySummary(c, yearMonth));
        return await Promise.all(promises);
    } catch (e) {
        console.error("Error fetching group data", e);
        return [];
    }
};

export interface DashboardSnapshot {
    current: ClinicMonthlySummary[];
    lastMonth: ClinicMonthlySummary[];
    lastYear: ClinicMonthlySummary[];
}

export const fetchDashboardSnapshot = async (clinics: Clinic[], currentYearMonth: string): Promise<DashboardSnapshot> => {
    const d = new Date(currentYearMonth + '-01');
    d.setMonth(d.getMonth() - 1);
    const lastMonthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const d2 = new Date(currentYearMonth + '-01');
    d2.setFullYear(d2.getFullYear() - 1);
    const lastYearStr = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}`;

    console.log(`Fetching Dashboard: ${currentYearMonth} vs ${lastMonthStr} (MoM) vs ${lastYearStr} (YoY)`);

    const [current, lastMonth, lastYear] = await Promise.all([
        fetchGroupData(clinics, currentYearMonth),
        fetchGroupData(clinics, lastMonthStr),
        fetchGroupData(clinics, lastYearStr)
    ]);

    return { current, lastMonth, lastYear };
};
