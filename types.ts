

export type ShiftType = 'Morning' | 'Afternoon' | 'Evening';

export enum DayOfWeek {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6
}

export type UserRole = 'admin' | 'manager' | 'staff' | 'marketing' | 'guest';

export interface User {
    uid: string;
    email: string;
    name: string;
    role: UserRole;
    allowedClinics: string[];
    clinicId?: string;
    createdAt?: string;
    lastSyncedAt?: string;
}

export interface DailyHours {
    Morning: boolean;
    Afternoon: boolean;
    Evening: boolean;
}

export interface ClinicStyleConfig {
    palette: any;
    layout: any;
    typography: any;
    shifts: any;
    spacing: any;
    corrections: any;
    canvas_layout: any;
    canvasLayout?: any; // Legacy
}

export interface Clinic {
  id: string;
  name: string;
  weeklyHours: DailyHours[];
  themeColor: string;
  address?: string;
  phone?: string;
  lineUrl?: string;
  scheduleImageUrl?: string;
  logoUrl?: string;
  shiftColors?: {
      morning: string;
      afternoon: string;
      evening: string;
  };
  shiftLabels?: {
      morning: string;
      afternoon: string;
      evening: string;
  };
  styleConfig?: ClinicStyleConfig;
  googleCalendarMapping?: Record<string, string>;
  allowedUsers?: string[];

  // Embedded Data Fields
  doctors?: Doctor[];
  laboratories?: Laboratory[];
  sovReferrals?: SOVReferral[];
  schedules?: DailySchedule[];
}

export interface Doctor {
  id: string;
  name: string;
  clinicId: string;
  color?: string; // Legacy
  avatarText?: string;
  avatarBgColor?: string;
  recurringShifts: { day: DayOfWeek, shift: ShiftType }[];
  commissionRates?: {
      prostho: number;
      implant: number;
      ortho: number;
      sov: number;
      inv?: number; // New: Invisalign rate
      perio: number;
      whitening?: number; // New independent rate
      otherSelfPay: number;
      nhi?: number;
  };
  // NEW: Lab Fee Self-Pay Configuration
  // If true for a category, the doctor pays 100% of the lab fee.
  // If false/undefined, the lab fee is deducted from revenue before split (Shared Cost).
  labFeeSelfPay?: {
      prostho?: boolean;
      implant?: boolean;
      ortho?: boolean;
      sov?: boolean;
      inv?: boolean;
      perio?: boolean;
      whitening?: boolean;
      otherSelfPay?: boolean;
  };
  isDeleted?: boolean; // Soft delete flag
}

export type ConsultantRole = 'consultant' | 'assistant' | 'part_time' | 'trainee';

export interface Consultant {
  id: string;
  name: string;
  clinicId: string;
  role: ConsultantRole;
  isActive?: boolean;
  // HR & Payroll Fields
  onboardDate?: string;   // 到職日 (YYYY-MM-DD)
  baseSalary?: number;    // 本薪
  allowance?: number;     // 職務加給
  insuredSalary?: number; // 投保薪資
  dependents?: number;    // 眷保眷屬人數
  annualLeave?: number;   // 特休剩餘天數
  // Insurance
  insuranceGradeLevel?: number; // 投保等級
  monthlyInsuranceCost?: number; // 預估勞健保自付額 (Total)
}

export interface InsuranceGrade {
  level: number;
  salary: number;
  laborFee: number;
  healthFee: number;
}

export interface LabPricingItem {
    id: string;
    name: string;
    price: number;
    isPercentage?: boolean; // NEW: If true, price is a percentage (0-100)
}

export interface Laboratory {
    id: string;
    name: string;
    clinicId: string;
    pricingList?: LabPricingItem[]; // NEW: Pricing List
    isDeleted?: boolean; // Soft delete flag
}

export interface SOVReferral {
    id: string;
    clinicId: string;
    name: string;
    last3Id?: string;
}

export interface StaffScheduleConfig {
    off: string[]; // IDs of Consultant/Assistant on Day Off
    leave: { id: string; type: string }[]; // IDs of Consultant/Assistant on Leave
    work: string[]; // IDs of Part-time working
    overtime?: { id: string; type: string }[]; // IDs of Sunday Overtime
}

export interface DailySchedule {
  date: string; // YYYY-MM-DD
  clinicId: string;
  isClosed: boolean;
  shifts: {
    Morning: string[];
    Afternoon: string[];
    Evening: string[];
  };
  consultantOffs?: string[]; // Legacy: IDs of consultants who are OFF
  staffConfiguration?: StaffScheduleConfig; // New 3-tier system configuration
}

export interface AccountingRow {
    id: string;
    patientName: string;
    doctorName: string;
    doctorId: string;
    treatments: {
        regFee: number;
        copayment: number;
        sov: number;
        ortho: number;
        prostho: number;
        implant: number;
        whitening: number;
        perio: number;
        inv: number; // New: Invisalign/Invisible Aligner
        otherSelfPay: number;
        consultant: string;
    };
    retail: {
        diyWhitening: number;
        products: number;
        productNote: string;
        staff: string;
    };
    // Enhanced Fields for POS (Optional for backward compatibility)
    technician?: string;
    selfPayItem?: string; 
    retailItem?: string;
    paymentBreakdown?: {
        cash: number;
        card: number;
        transfer: number;
    };
    
    actualCollected: number;
    paymentMethod: string;
    isPaymentManual: boolean;
    npStatus: string;
    treatmentContent: string;
    labName: string;
    labFee?: number;
    isManual: boolean;
    isManualName?: boolean;
    attendance?: boolean; // Renamed from isArrived
    startTime?: string;
    originalDate?: string; 
    matchStatus?: 'none' | 'matched' | 'manual' | 'saved';
    
    // CRM Fields (Hidden)
    chartId?: string;
    patientStatus?: string;
}

export interface Expenditure {
    id: string;
    item: string;
    amount: number;
}

export interface AuditLogEntry {
    timestamp: string;
    userId: string;
    userName: string;
    action: 'LOCK' | 'UNLOCK' | 'UPDATE';
    details?: string;
}

export interface DailyAccountingRecord {
    clinicId: string;
    date: string;
    rows: AccountingRow[];
    expenditures?: Expenditure[];
    initialCash?: number;
    reportImageUrl?: string | null;
    lastUpdated?: number;
    
    // Locking & Audit
    isLocked?: boolean;
    auditLog?: AuditLogEntry[];
}

export interface LabOrderDetail {
    id: string;
    name: string;
    toothPos: string;
    qty: number;
    price: number;
    subtotal: number;
}

// NEW: Technician Reconciliation Record
export interface TechnicianRecord {
    id: string; // Auto-generated
    clinicId: string;
    labName: string;
    date: string; // YYYY-MM-DD
    type: 'linked' | 'manual';
    
    // Financials
    amount: number; // Final Net Fee (after discount)
    details?: LabOrderDetail[]; // NEW: Multi-item details
    discount?: number; // NEW: Discount Amount
    
    // For Linked (from Daily Accounting)
    linkedRowId?: string;
    
    // For Manual (Adjustments) & Linked Detail
    patientName?: string;
    doctorName?: string;
    treatmentContent?: string;
    category?: string; // The attributed category (e.g., 'implant', 'vault')
    note?: string;
    
    updatedAt: number;
}

// NEW: NHI Claim Record
export interface NHIRecord {
    id: string; // Composite: clinicId_month_doctorId
    clinicId: string;
    month: string; // YYYY-MM
    doctorId: string;
    doctorName: string;
    amount: number;
    rate?: number; // Optional profit share %
    note?: string;
    updatedAt: number;
}

// NEW: Salary Adjustment Record
export interface SalaryAdjustment {
    id?: string;
    clinicId: string;
    doctorId: string;
    month: string; // YYYY-MM
    date: string;
    category: string; // e.g., "餐費", "代墊款", "獎金"
    amount: number;
    note: string;
    updatedAt: number;
}

// NEW: Monthly Target for Dashboard
export interface MonthlyTarget {
    clinicId?: string; // Optional context
    yearMonth?: string; // Optional context
    revenueTarget: number;
    visitTarget: number;
    selfPayTarget: number;
}

export interface ClinicMonthlySummary {
    clinicId: string;
    clinicName: string;
    actualRevenue: number;
    actualVisits: number;
    actualSelfPay: number;
    targets: MonthlyTarget;
}

// NEW: Marketing / NP Record
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
    calendarNote?: string; // New: Full Calendar Description
    updatedAt: any;
}

export interface AppData {
  clinics: Clinic[];
  doctors: Doctor[];
  consultants: Consultant[];
  laboratories: Laboratory[];
  sovReferrals: SOVReferral[];
  schedules: DailySchedule[];
  allowedUsers?: string[];
}