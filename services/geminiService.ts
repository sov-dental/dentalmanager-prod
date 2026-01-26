import { GoogleGenAI, Type } from "@google/genai";
import { DailySchedule, Clinic, Doctor } from '../types';
import * as XLSX from 'xlsx';

const getDayName = (dateStr: string) => {
  const date = new Date(dateStr);
  return ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][date.getDay()];
};

// Initialize with named parameter using Vite environment variable
const getGenAI = () => {
  // Use Vite environment variable
  // Fix: Property 'env' does not exist on type 'ImportMeta'.
  const apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY || "";
  
  if (!apiKey) {
    console.error("Gemini API Key is missing! Please set VITE_GEMINI_API_KEY in your environment.");
  }

  return new GoogleGenAI({ apiKey });
};

export const generateAnnouncement = async (
  clinic: Clinic,
  monthStr: string, // YYYY-MM
  schedules: DailySchedule[],
  doctors: Doctor[]
): Promise<string> => {
  try {
    const ai = getGenAI();

    const scheduleSummary = schedules
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => {
        if (s.isClosed) return `${s.date} (${getDayName(s.date)}): 休診`;
        
        const getDocNames = (ids: string[]) => ids.map(id => doctors.find(d => d.id === id)?.name || 'Unknown').join(', ');
        
        return `${s.date} (${getDayName(s.date)}): 
          早: ${getDocNames(s.shifts.Morning) || '-'} 
          午: ${getDocNames(s.shifts.Afternoon) || '-'} 
          晚: ${getDocNames(s.shifts.Evening) || '-'}`;
      }).join('\n');

    const prompt = `
      You are a social media manager for "${clinic.name}", a dental clinic.
      Create a friendly, professional, and emoji-rich Facebook/Instagram post announcing the schedule for ${monthStr}.
      
      Clinic Info:
      Address: ${clinic.address || 'N/A'}
      Phone: ${clinic.phone || 'N/A'}
      Booking Link: ${clinic.lineUrl || 'N/A'}

      Schedule Data:
      ${scheduleSummary}

      Instructions:
      1. Start with a catchy headline about the new monthly schedule.
      2. Mention any specific Full Closure days clearly if any exist.
      3. Highlight that the schedule is attached.
      4. Use Chinese (Traditional) suitable for a Taiwan audience.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    
    return response.text || "Could not generate text.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error generating announcement. Please try again.";
  }
};

export interface ScannedAccountingRow {
  name: string;
  regFee?: number;
  copayment?: number;
  prostho?: number;
  implant?: number;
  whitening?: number;
  ortho?: number;
  sov?: number;
  perio?: number;
  otherSelfPay?: number;
  products?: number;
}

export interface ScannedLabItem {
    patientName: string;
    itemType: string;
    amount: number;
}

const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

const readExcelToCSV = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const csv = XLSX.utils.sheet_to_csv(worksheet);
                resolve(csv);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
};

export const analyzeAccountingReport = async (file: File): Promise<ScannedAccountingRow[]> => {
  try {
    const ai = getGenAI();
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('spreadsheet');
    
    let contents: any;
    let systemInstruction = "";

    const responseSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          regFee: { type: Type.NUMBER },
          copayment: { type: Type.NUMBER },
          prostho: { type: Type.NUMBER },
          implant: { type: Type.NUMBER },
          whitening: { type: Type.NUMBER },
          ortho: { type: Type.NUMBER },
          sov: { type: Type.NUMBER },
          perio: { type: Type.NUMBER },
          otherSelfPay: { type: Type.NUMBER },
          products: { type: Type.NUMBER },
        },
        required: ["name"],
      },
    };

    if (isExcel) {
        contents = await readExcelToCSV(file);
        systemInstruction = "Extract dental clinic accounting rows from this CSV. Return JSON array.";
    } else {
        const imagePart = await fileToGenerativePart(file);
        contents = { parts: [imagePart] };
        systemInstruction = "Analyze this image of a dental clinic report. Extract patient rows and financial figures. Return JSON array.";
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema,
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return [];
  }
};

export const analyzeLabStatement = async (file: File): Promise<ScannedLabItem[]> => {
    try {
        const ai = getGenAI();
        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('spreadsheet');
        
        let contents: any;
        let systemInstruction = "Analyze this lab statement. Extract patientName, itemType, and amount. Return JSON array.";

        const responseSchema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    patientName: { type: Type.STRING },
                    itemType: { type: Type.STRING },
                    amount: { type: Type.NUMBER }
                },
                required: ["patientName", "amount"]
            }
        };

        if (isExcel) {
            contents = await readExcelToCSV(file);
        } else {
            const imagePart = await fileToGenerativePart(file);
            contents = { parts: [imagePart] };
        }

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema,
            }
        });

        return JSON.parse(response.text || "[]");
    } catch (e) {
        console.error("Lab Analysis Error", e);
        throw e;
    }
};