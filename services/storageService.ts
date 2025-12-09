
import { AppData, Clinic, Doctor, DailySchedule, DailyHours, DayOfWeek, ClinicStyleConfig } from '../types';

const STORAGE_KEY = 'dental_scheduler_data_v1';

const DEFAULT_DATA: AppData = {
  clinics: [],
  doctors: [],
  consultants: [],
  laboratories: [],
  sovReferrals: [],
  schedules: [],
};

export const DEFAULT_STYLE_CONFIG: ClinicStyleConfig = {
  palette: {
    background: '#ffffff',
    text: '#1e293b',
    gridBorder: '#e2e8f0',
    gridHeaderBg: '#0f172a',
    gridHeaderText: '#ffffff',
    closedDayBackground: '#f8fafc',
    weekend: {
      saturday: '#10b981', // emerald-500
      sunday: '#f43f5e'    // rose-500
    },
    dateText: {
        weekday: '#1e293b',
        saturday: '#10b981',
        sunday: '#f43f5e'
    }
  },
  layout: {
    borderStyle: 'solid',
    borderWidth: '1px',
    cornerRadius: '0.5rem',
    headerAlignment: 'space-between',
    cellPadding: '0.25rem',
    gridGap: '1px',
    headerCornerStyle: 'rounded-top'
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
    titleFont: '"M PLUS Rounded 1c", sans-serif',
    bodyFont: '"Noto Sans TC", sans-serif',
    headerWeight: '800',
    bodySize: '0.75rem',
    gridHeaderSize: '28px'
  },
  shifts: {
    displayMode: 'bar',
    showTime: true,
    styles: {
        morning: { bg: '#fbbf24', color: '#ffffff' },
        afternoon: { bg: '#fb923c', color: '#ffffff' },
        evening: { bg: '#818cf8', color: '#ffffff' }
    }
  },
  spacing: {
    doctorListTopMargin: '4px',
    doctorRowGap: '2px'
  },
  corrections: {
    headerTextY: '0px',
    doctorNameY: '0px',
    dotTextY: '0px',
    dotContainerY: '0px'
  },
  // Default snake_case layout structure
  canvas_layout: {
    container_width: 1080,
    container_height: 1350,
    grid_area: {
        x: 50,
        y: 300,
        width: 980,
        height: 800
    },
    title_area: {
        x: 50,
        y: 100,
        font_size: 48,
        color: '#000000',
        align: 'left'
    }
  }
};

const createDefaultDailyHours = (isOpen: boolean = true): DailyHours => ({
    Morning: isOpen,
    Afternoon: isOpen,
    Evening: isOpen
});

// Migration helper for old data format
const migrateClinic = (clinic: any): Clinic => {
  let updated = { ...clinic };

  // Migration: closedDays -> weeklyHours
  if (!updated.weeklyHours) {
    const closedDays = updated.closedDays || [];
    updated.weeklyHours = Array(7).fill(null).map((_, idx) => {
      const isClosed = closedDays.includes(idx);
      return createDefaultDailyHours(!isClosed);
    });
    delete updated.closedDays;
  }

  // Migration: add styleConfig if missing
  if (!updated.styleConfig) {
    updated.styleConfig = DEFAULT_STYLE_CONFIG;
  } else {
    // Deep merge for partial configs in existing data
    updated.styleConfig = {
        ...DEFAULT_STYLE_CONFIG,
        ...updated.styleConfig,
        shifts: { ...DEFAULT_STYLE_CONFIG.shifts, ...(updated.styleConfig.shifts || {}) },
        layout: { ...DEFAULT_STYLE_CONFIG.layout, ...(updated.styleConfig.layout || {}) },
        palette: { ...DEFAULT_STYLE_CONFIG.palette, ...(updated.styleConfig.palette || {}) },
        typography: { ...DEFAULT_STYLE_CONFIG.typography, ...(updated.styleConfig.typography || {}) },
        spacing: { ...DEFAULT_STYLE_CONFIG.spacing, ...(updated.styleConfig.spacing || {}) },
        corrections: { ...DEFAULT_STYLE_CONFIG.corrections, ...(updated.styleConfig.corrections || {}) },
        canvas_layout: { ...DEFAULT_STYLE_CONFIG.canvas_layout, ...(updated.styleConfig.canvas_layout || {}) }
    };
  }

  return updated as Clinic;
};

export const loadData = (): AppData => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_DATA;

    const parsed = JSON.parse(stored);

    // Apply migrations
    if (parsed.clinics) {
        parsed.clinics = parsed.clinics.map(migrateClinic);
    }

    return parsed;
  } catch (e) {
    console.error("Failed to load data", e);
    return DEFAULT_DATA;
  }
};

export const saveData = (data: AppData) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save data", e);
  }
};
