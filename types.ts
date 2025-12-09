
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
  styleConfig?: ClinicStyleConfig;
  googleCalendarMapping?: Record<string, string>;
  allowedUsers?: string[];
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

export interface Laboratory {
    id: string;
    name: string;
    clinicId: string;
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
    isArrived?: boolean; // New: Patient Arrival Status
    startTime?: string;
    originalDate?: string; 
    matchStatus?: 'none' | 'matched' | 'manual' | 'saved';
}

export interface Expenditure {
    id: string;
    item: string;
    amount: number;
}

export interface DailyAccountingRecord {
    clinicId: string;
    date: string;
    rows: AccountingRow[];
    expenditures?: Expenditure[];
    initialCash?: number;
    reportImageUrl?: string | null;
    lastUpdated?: number;
}

// NEW: Technician Reconciliation Record
export interface TechnicianRecord {
    id: string; // Auto-generated
    clinicId: string;
    labName: string;
    date: string; // YYYY-MM-DD
    type: 'linked' | 'manual';
    amount: number;
    
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

export interface AppData {
  clinics: Clinic[];
  doctors: Doctor[];
  consultants: Consultant[];
  laboratories: Laboratory[];
  sovReferrals: SOVReferral[];
  schedules: DailySchedule[];
  allowedUsers?: string[];
}