
// Types for Google API
declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

// NOTE: In a production environment, this should be in an environment variable.
const CLIENT_ID = '497470423292-hpo7k2u4j10tankppa2fvb2h0b3k8bd9.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

const STORAGE_KEY_TOKEN = 'dental_gcal_token';
const STORAGE_KEY_EXPIRY = 'dental_gcal_expiry';

let tokenClient: any;
let gapiInited = false;
let gisInited = false;
// Store the active callback to ensure the latest component instance receives updates
let activeUserChangedCallback: ((isLoggedIn: boolean) => void) | null = null;

export const initGoogleClient = (
  onInit: () => void,
  onUserChanged: (isLoggedIn: boolean) => void
) => {
  // Update the active callback reference whenever the client is initialized (e.g. component mount)
  activeUserChangedCallback = onUserChanged;

  const attemptRestoreSession = () => {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const expiry = localStorage.getItem(STORAGE_KEY_EXPIRY);
    const now = Date.now();

    if (token && expiry && parseInt(expiry, 10) > now) {
      if (window.gapi.client) {
        window.gapi.client.setToken({ access_token: token });
        // Call the passed callback directly for synchronous checks
        onUserChanged(true);
      }
    } else {
      // Clear invalid/expired token
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.removeItem(STORAGE_KEY_EXPIRY);
      onUserChanged(false);
    }
    onInit();
  };

  const gapiLoaded = () => {
    window.gapi.load('client', async () => {
      await window.gapi.client.init({
        discoveryDocs: [DISCOVERY_DOC],
      });
      gapiInited = true;
      if (gisInited) attemptRestoreSession();
    });
  };

  const gisLoaded = () => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp: any) => {
        if (resp.error !== undefined) {
          throw (resp);
        }
        // Save Token
        const expiryTime = Date.now() + (resp.expires_in * 1000);
        localStorage.setItem(STORAGE_KEY_TOKEN, resp.access_token);
        localStorage.setItem(STORAGE_KEY_EXPIRY, expiryTime.toString());
        
        // Use the module-level active callback to update the current UI
        if (activeUserChangedCallback) {
            activeUserChangedCallback(true);
        }
      },
    });
    gisInited = true;
    if (gapiInited) attemptRestoreSession();
  };

  // If already initialized, just restore/check session
  if (gapiInited && gisInited) {
    attemptRestoreSession();
    return;
  }

  // Check if scripts are already loaded in DOM (e.g. from previous mounts) but not tracked in this module
  if (window.gapi && !gapiInited) gapiLoaded();
  if (window.google && !gisInited) gisLoaded();
};

export const handleAuthClick = () => {
  if (window.gapi.client.getToken() === null) {
    // Prompt the user to select a Google Account and ask for consent to share their data
    // when establishing a new session.
    tokenClient.requestAccessToken({prompt: 'consent'});
  } else {
    // Skip display of account chooser and consent dialog for an existing session.
    tokenClient.requestAccessToken({prompt: ''});
  }
};

export const handleSignOutClick = () => {
  const token = window.gapi.client.getToken();
  if (token !== null) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken('');
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_EXPIRY);
    return true;
  }
  return false;
};

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

export interface GoogleEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  description?: string;
  // We add this helper property for the frontend
  allDay?: boolean; 
}

export const listCalendars = async (): Promise<GoogleCalendar[]> => {
  try {
    const response = await window.gapi.client.calendar.calendarList.list();
    return response.result.items.map((item: any) => ({
      id: item.id,
      summary: item.summary,
      primary: item.primary
    }));
  } catch (err) {
    console.error('Error fetching calendars', err);
    // If error is 401 (Unauthorized), ensure we clear storage
    if ((err as any)?.result?.error?.code === 401) {
        localStorage.removeItem(STORAGE_KEY_TOKEN);
        localStorage.removeItem(STORAGE_KEY_EXPIRY);
    }
    return [];
  }
};

export const listEvents = async (
  calendarId: string, 
  timeMin: Date, 
  timeMax: Date
): Promise<GoogleEvent[]> => {
  try {
    const response = await window.gapi.client.calendar.events.list({
      calendarId: calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      showDeleted: false,
      singleEvents: true,
      maxResults: 250, // Increased limit for busy clinics
      orderBy: 'startTime',
    });
    
    // Map response to ensure consistent structure
    return response.result.items.map((item: any) => {
        const isAllDay = !item.start.dateTime;
        return {
            id: item.id,
            summary: item.summary,
            start: item.start,
            end: item.end,
            description: item.description,
            allDay: isAllDay
        };
    });
  } catch (err) {
    console.error(`Error fetching events for ${calendarId}`, err);
    return [];
  }
};

export const searchEvents = async (
  calendarId: string,
  query: string,
  timeMin: Date,
  timeMax: Date
): Promise<GoogleEvent[]> => {
  try {
    const response = await window.gapi.client.calendar.events.list({
      calendarId: calendarId,
      q: query,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      showDeleted: false,
      singleEvents: true,
      maxResults: 50,
      orderBy: 'startTime',
    });

    return response.result.items.map((item: any) => {
        const isAllDay = !item.start.dateTime;
        return {
            id: item.id,
            summary: item.summary,
            start: item.start,
            end: item.end,
            description: item.description,
            allDay: isAllDay
        };
    });
  } catch (err) {
    console.error(`Error searching events for ${calendarId}`, err);
    return [];
  }
};

export const patchEvent = async (
  calendarId: string,
  eventId: string,
  patchData: { summary?: string; description?: string }
): Promise<boolean> => {
  try {
    await window.gapi.client.calendar.events.patch({
      calendarId: calendarId,
      eventId: eventId,
      resource: patchData,
    });
    return true;
  } catch (err) {
    console.error('Error patching event', err);
    return false;
  }
};

export interface ParsedAppointment {
  np_display: string;      // Used for Status in UI (strictly "NP" or "")
  original_status: string; // Raw prefix (e.g. "V", "@", "(30不)")
  chartId: string;     
  patientName: string; 
  note: string;        
}

/**
 * Parses a Google Calendar Event Summary into structured appointment data.
 * 
 * CORE PARSING LOGIC:
 * 1. Find the Anchor (ID): Look for a continuous sequence of 4, 7, or 10 digits.
 * 2. Scenario A (Standard): No hyphen '-' immediately before the ID.
 *    Format: [Status][ID]-[Name]-[Procedure]
 * 3. Scenario B (Swapped): A hyphen '-' exists immediately before the ID.
 *    Format: [Name]-[ID]-[Procedure] (Status is null)
 * 4. Scenario C (No ID): No 4/7/10 digits found.
 *    Format: [Name]-[Procedure] (ID="NP")
 * 
 * EXCLUSION: If Name contains '+', returns null.
 * 
 * DATA MAPPING:
 * - np_display: "NP" if ID is 10 digits or "NP". Otherwise empty.
 * - original_status: The extracted status prefix (e.g. "V", "@"). Not used for np_display.
 */
export const parseAppointmentTitle = (title: string): ParsedAppointment | null => {
  // 1. Find the Anchor (ID): 10, 7, or 4 digits. Order matters.
  const idRegex = /(\d{10}|\d{7}|\d{4})/;
  const idMatch = title.match(idRegex);

  let chartId = '';
  let status = '';
  let name = '';
  let note = '';
  let np_display = '';

  if (idMatch && idMatch.index !== undefined) {
    chartId = idMatch[0];
    const index = idMatch.index;
    
    // Check character immediately before ID
    const charBefore = index > 0 ? title[index - 1] : '';

    if (charBefore === '-') {
        // Scenario B: [Name]-[ID]-[Note]
        // Status is empty/null in this format
        name = title.substring(0, index - 1).trim();
        
        let remainder = title.substring(index + chartId.length);
        if (remainder.startsWith('-')) {
            remainder = remainder.substring(1);
        }
        note = remainder.trim();
        status = '';
    } else {
        // Scenario A: [Status][ID]-[Name]-[Note]
        status = title.substring(0, index).trim();
        
        let remainder = title.substring(index + chartId.length);
        if (remainder.startsWith('-')) {
            remainder = remainder.substring(1);
        }
        
        const parts = remainder.split('-');
        name = parts[0].trim();
        note = parts.slice(1).join('-').trim();
    }
  } else {
    // Scenario C: No ID found -> NP
    chartId = 'NP';
    
    const parts = title.split('-');
    name = parts[0].trim();
    note = parts.slice(1).join('-').trim();
    status = '';
  }

  // EXCLUSION RULE: If Name contains "+", discard.
  if (name.includes('+')) {
      return null;
  }

  // np_display Logic:
  // Strict Rule: Do NOT include the parsed `Status` in this column.
  // Condition 1: ID has 10 digits OR ID is "NP" -> "NP"
  // Condition 2: ID has 4 or 7 digits -> "" (empty)
  if (chartId === 'NP' || chartId.length === 10) {
      np_display = 'NP';
  } else {
      np_display = '';
  }

  return {
      np_display,
      original_status: status, // Kept for debugging, but not put into np_display
      chartId,
      patientName: name,
      note
  };
};
