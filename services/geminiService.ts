import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { DailySchedule, Clinic, Doctor } from '../types';
import * as XLSX from 'xlsx';

const getDayName = (dateStr: string) => {
  const date = new Date(dateStr);
  return ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][date.getDay()];
};

const getGenAI = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please configure your environment.");
  }
  return new GoogleGenerativeAI(process.env.API_KEY);
};

export const generateAnnouncement = async (
  clinic: Clinic,
  monthStr: string, // YYYY-MM
  schedules: DailySchedule[],
  doctors: Doctor[]
): Promise<string> => {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Prepare a condensed text summary of the schedule for the model
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
      3. Do NOT list every single day's roster in the text (that's for the image). Instead, highlight that the schedule is attached.
      4. Mention if there are any special notes (like weekends open/closed).
      5. Include a call to action to book an appointment (include the booking link if provided).
      6. Use Chinese (Traditional) suitable for a Taiwan audience.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text() || "Could not generate text.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error generating announcement. Please try again.";
  }
};

// --- AI Vision & Data Analysis for Accounting ---

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
  products?: number; // Retail
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

// Helper: Parse Excel file to CSV text locally
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
    const genAI = getGenAI();
    
    // Determine file type
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('spreadsheet') || file.type.includes('excel');
    
    let contentParts: any[] = [];
    let systemInstruction = "";

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              name: { type: SchemaType.STRING, description: "Patient Name" },
              regFee: { type: SchemaType.NUMBER, description: "Registration Fee (掛號費)" },
              copayment: { type: SchemaType.NUMBER, description: "Co-payment (部分負擔)" },
              prostho: { type: SchemaType.NUMBER, description: "Prosthodontic Fee (假牙)" },
              implant: { type: SchemaType.NUMBER, description: "Implant Fee (植牙)" },
              whitening: { type: SchemaType.NUMBER, description: "Whitening Fee (美白)" },
              ortho: { type: SchemaType.NUMBER, description: "Orthodontic Fee (矯正)" },
              sov: { type: SchemaType.NUMBER, description: "SOV Fee" },
              perio: { type: SchemaType.NUMBER, description: "Periodontal Fee (牙周)" },
              otherSelfPay: { type: SchemaType.NUMBER, description: "Other Self Pay (其他自費)" },
              products: { type: SchemaType.NUMBER, description: "Retail/Products (物販/口衛)" },
            },
            required: ["name"],
          },
        }
      }
    });

    if (isExcel) {
        // Logic A: Text-based Analysis (Excel -> CSV)
        try {
            const csvText = await readExcelToCSV(file);
            systemInstruction = `
              You are a data assistant. Analyze the following CSV data extracted from a dental clinic daily report.
              Map the columns to the following fields:
              - Name: Patient Name
              - RegFee: Registration Fee
              - Copay: Co-payment
              - Prostho, Implant, Whitening, Ortho, SOV, Perio, Other: Self-pay categories
              - Product: Retail/Oral Hygiene products
              
              Ignore rows that are clearly totals or empty.
              Return a JSON array.
            `;
            contentParts = [systemInstruction, csvText];
        } catch (e) {
            console.error("Excel parse error", e);
            throw new Error("Failed to parse Excel file.");
        }
    } else {
        // Logic B: Vision-based Analysis (Image/PDF)
        const imagePart = await fileToGenerativePart(file);
        systemInstruction = `
          Analyze this image/document of a dental clinic daily report.
          Identify rows representing patient visits.
          Extract the following fields for each patient:
          - name (Patient Name)
          - regFee (Registration Fee / 掛號)
          - copayment (Co-payment / 部分負擔)
          - prostho, implant, whitening, ortho, sov, perio, otherSelfPay (Self-pay categories)
          - products (Retail/Oral Hygiene)
          
          Treat handwritten numbers carefully. Return 0 if a field is empty or dashed.
        `;
        contentParts = [systemInstruction, imagePart];
    }

    const result = await model.generateContent(contentParts);
    const jsonText = result.response.text() || "[]";
    const data = JSON.parse(jsonText) as ScannedAccountingRow[];
    return data;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return [];
  }
};

export const analyzeLabStatement = async (file: File): Promise<ScannedLabItem[]> => {
    try {
        const genAI = getGenAI();
        
        // Determine file type
        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('spreadsheet') || file.type.includes('excel');
        
        let contentParts: any[] = [];
        
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            patientName: { type: SchemaType.STRING },
                            itemType: { type: SchemaType.STRING },
                            amount: { type: SchemaType.NUMBER }
                        },
                        required: ["patientName", "amount"]
                    }
                }
            }
        });

        if (isExcel) {
            // Logic A: Excel -> CSV -> Text Prompt
            try {
                const csvText = await readExcelToCSV(file);
                const prompt = `
                    You are a data assistant. Analyze the following CSV data extracted from a dental laboratory statement (技工所對帳單).
                    Extract a list of items where each item represents a patient case.
                    
                    Fields to extract:
                    - patientName (The name of the patient)
                    - itemType (The type of restoration/work, e.g., "Full Zirconia", "PFM", "Denture")
                    - amount (The cost/fee for this item)

                    Return a JSON array.
                    
                    CSV Data:
                    ${csvText}
                `;
                contentParts = [prompt];
            } catch (e) {
                 console.error("Excel parse error", e);
                 throw new Error("Failed to parse Excel file.");
            }
        } else {
            // Logic B: Image/PDF -> Vision/Multimodal Prompt
            const imagePart = await fileToGenerativePart(file);
            const prompt = `
                Analyze this dental laboratory statement (技工所對帳單).
                Extract a list of items where each item represents a patient case.
                
                Fields to extract:
                - patientName (The name of the patient)
                - itemType (The type of restoration/work, e.g., "Full Zirconia", "PFM", "Denture")
                - amount (The cost/fee for this item)

                Return a JSON array.
            `;
            contentParts = [prompt, imagePart];
        }

        const result = await model.generateContent(contentParts);
        return JSON.parse(result.response.text() || "[]") as ScannedLabItem[];
    } catch (e) {
        console.error("Lab Analysis Error", e);
        throw e;
    }
};
