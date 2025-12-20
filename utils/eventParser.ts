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
  const match = title.match(/^(.*?)(\d+)-(.+)$/);

  if (match) {
    const rawStatus = match[1].trim();
    const digits = match[2];
    const rest = match[3].trim();

    const isValidChartId = digits.length >= 4 && digits.length <= 7;

    let name = rest;
    let treatment = '';
    const firstHyphenIndex = rest.indexOf('-');
    if (firstHyphenIndex > 0) {
        name = rest.substring(0, firstHyphenIndex).trim();
        treatment = rest.substring(firstHyphenIndex + 1).trim();
    }

    if (rawStatus.endsWith('-')) {
        const namePart = rawStatus.slice(0, -1).trim();
        if (namePart) {
            return {
                chartId: isValidChartId ? digits : null,
                name: namePart,
                treatment: isValidChartId ? rest : `${digits}-${rest}`, 
                status: '',
                isNP: !isValidChartId
            };
        }
    }

    if (isValidChartId) {
        return {
            chartId: digits,
            name,
            treatment,
            status: rawStatus,
            isNP: false
        };
    } else {
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

  const parts = title.split('-').map(p => p.trim());
  if (parts.length >= 2) {
    const name = parts[0];
    if (name.includes('+')) return null;

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

/**
 * Smart Source Parser (Refined)
 * Analyzes Calendar Description and returns the Source based on priority keywords.
 * Priority: Line -> FB -> 官網 -> SOV轉介 -> 介紹 -> 小幫手 -> 電話 -> 過路客 -> 其他
 */
export const parseSourceFromNote = (note: string): string => {
  if (!note) return '其他';
  const n = note.toLowerCase();
  
  // 1. Line
  if (n.includes('line')) return 'Line';
  
  // 2. FB / Social
  if (n.includes('fb') || n.includes('臉書') || n.includes('ig')) return 'FB';
  
  // 3. Official Site
  if (n.includes('官網') || n.includes('後台')) return '官網';

  // 4. SOV Referral (New Rule)
  if (n.includes('轉')) return 'SOV轉介';
  
  // 5. Referral (CRITICAL: Check "幫約" before "幫")
  if (n.includes('介紹') || n.includes('朋友') || n.includes('老婆') || n.includes('媽媽') || n.includes('男友') || n.includes('幫約')) {
      return '介紹';
  }
  
  // 6. Assistant
  if (n.includes('小幫手') || n.includes('幫')) return '小幫手';
  
  // 7. Phone
  if (n.includes('電') || n.includes('電話') || n.includes('tel')) return '電話';
  
  // 8. Walk-in
  if (n.includes('現') || n.includes('現場')) return '過路客';
  
  return '其他';
};