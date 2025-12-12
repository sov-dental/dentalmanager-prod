
export interface ParsedEvent {
  chartId: string | null;
  name: string;
  treatment: string;
  status: string;
  isNP: boolean;
}

export const parseCalendarEvent = (title: string): ParsedEvent | null => {
  if (!title) return null;
  
  // Basic Filter: Must contain at least one hyphen
  if (!title.includes('-')) return null;

  // 1. Regex Strategy for Chart ID Extraction
  // Looks for: [Prefix/Status][Digits]-[Rest]
  // Group 1 (Prefix): Non-greedy match for anything before the digits
  // Group 2 (Digits): Any sequence of digits
  // Group 3 (Rest): Everything after the hyphen
  const match = title.match(/^(.*?)(\d+)-(.+)$/);

  if (match) {
    const rawStatus = match[1].trim(); // e.g. "@(60不)" or empty
    const digits = match[2];           // e.g. "0820110" or "0912345678"
    const rest = match[3].trim();      // e.g. "Name-Treatment"

    // STRICT LENGTH RULE: Chart ID must be 4 to 7 digits.
    const isValidChartId = digits.length >= 4 && digits.length <= 7;

    // Parse Name and Treatment from 'rest'
    let name = rest;
    let treatment = '';
    const firstHyphenIndex = rest.indexOf('-');
    if (firstHyphenIndex > 0) {
        name = rest.substring(0, firstHyphenIndex).trim();
        treatment = rest.substring(firstHyphenIndex + 1).trim();
    }

    // Handle "Name-ID-Treatment" case (Legacy Format)
    // If the captured 'prefix' ends with a hyphen, the regex captured "Name-" as Group 1
    if (rawStatus.endsWith('-')) {
        const namePart = rawStatus.slice(0, -1).trim();
        if (namePart) {
            return {
                chartId: isValidChartId ? digits : null,
                name: namePart,
                // If invalid ID (e.g. phone), append it back to treatment to preserve info
                treatment: isValidChartId ? rest : `${digits}-${rest}`, 
                status: '',
                isNP: !isValidChartId
            };
        }
    }

    // Standard Format: [Status]ID-Name-Treatment
    if (isValidChartId) {
        return {
            chartId: digits,
            name,
            treatment,
            status: rawStatus,
            isNP: false
        };
    } else {
        // Digits found, but length invalid (e.g. 10 digits = Phone Number).
        // Treat as NP, preserve digits in status.
        const combinedStatus = rawStatus ? `${rawStatus}${digits}` : digits;
        return {
            chartId: null,
            name,
            treatment,
            status: combinedStatus,
            isNP: true
        };
    }
  }

  // 2. Fallback: NP (New Patient) or Unknown Format
  // Structure: Name-Treatment (No ID detected before hyphen)
  const parts = title.split('-').map(p => p.trim());
  if (parts.length >= 2) {
    const name = parts[0];
    if (name.includes('+')) return null; // Exclusion rule for fallback

    return {
      chartId: null,
      name,
      treatment: parts.slice(1).join('-'),
      status: '',
      isNP: true
    };
  }

  return null;
};
