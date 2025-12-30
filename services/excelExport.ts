import * as ExcelJSModule from 'exceljs';
import { AccountingRow, Expenditure, NPRecord, Consultant } from '../types';
import { db } from './firebase';

// Defensive import strategy for ExcelJS
const ExcelJS = (ExcelJSModule as any).default?.Workbook ? (ExcelJSModule as any).default : ExcelJSModule;

// Helper: Convert YYYY-MM-DD to ROC Date (114/01/01)
const toROCDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const year = date.getFullYear() - 1911;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}/${month}/${day}`;
};

// Helper: Format number with payment method suffix
// e.g. 5000 -> 5000(刷) if card
const formatCurrency = (val: number | undefined, paymentMethod: string): string | number => {
    if (!val || val === 0) return '';
    
    let suffix = '';
    if (paymentMethod === 'card') suffix = '(刷)';
    else if (paymentMethod === 'transfer') suffix = '(匯)';
    
    // Return string if suffix exists, otherwise number for Excel math
    if (suffix) return `${val}${suffix}`;
    return val;
};

export const exportDailyReportToExcel = async (
  clinicId: string,
  clinicName: string,
  dateStr: string,
  rows: AccountingRow[],
  expenditures: Expenditure[],
  consultants: Consultant[] = []
) => {
  // --- 0. Data Preparation ---

  // Filter: Exclude non-attended patients
  const activeRows = rows.filter(r => r.attendance);
  
  // A. Build Staff Lookup Map (ID -> Name) for resolving Consultant names in NP records
  const staffMap = new Map<string, string>();
  consultants.forEach(c => {
      staffMap.set(c.id, c.name);
  });

  // B. Fetch NP Details from Firestore for this specific clinic and date
  // Double Map Strategy for robust matching
  const npMapById = new Map<string, NPRecord>();
  const npMapByName = new Map<string, NPRecord>();

  try {
      const npSnap = await db.collection('np_records')
        .where('clinicId', '==', clinicId)
        .where('date', '==', dateStr)
        .get();
      
      console.log(`Export: Fetched NP Records for ${dateStr}:`, npSnap.size);
      
      npSnap.docs.forEach(doc => {
          const data = doc.data() as NPRecord;
          if (!data.isHidden) {
              // Primary key: Document ID (corresponds to row.id from calendar)
              npMapById.set(doc.id, data);
              
              // Secondary key: Patient Name (trimmed) for fallback matching
              if (data.patientName) {
                  npMapByName.set(data.patientName.trim(), data);
              }
          }
      });
      
      console.log("Export: Built Maps. IDs:", npMapById.size, "Names:", npMapByName.size);
  } catch (e) {
      console.error("Error fetching NP records for export:", e);
  }

  // C. Group/Sort by Doctor Name (Using filtered activeRows)
  const sortedRows = [...activeRows].sort((a, b) => 
      (a.doctorName || '').localeCompare(b.doctorName || '', 'zh-TW')
  );

  // --- 1. Workbook Setup ---
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Daily Report', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      margins: {
        left: 0.25, right: 0.25, top: 0.5, bottom: 0.5,
        header: 0.3, footer: 0.3
      }
    }
  });

  // --- 2. Columns Setup (A to T) ---
  sheet.columns = [
    { key: 'no', width: 5 },        // A: 序號
    { key: 'name', width: 12 },     // B: 病患姓名
    { key: 'reg', width: 9 },       // C: 掛號費
    { key: 'copay', width: 9 },     // D: 部分負擔
    { key: 'prostho', width: 9 },   // E: 假牙
    { key: 'implant', width: 9 },   // F: 植牙
    { key: 'whitening', width: 9 }, // G: 美白
    { key: 'ortho', width: 9 },     // H: 矯正
    { key: 'sov', width: 9 },       // I: SOV
    { key: 'inv', width: 9 },       // J: INV
    { key: 'perio', width: 9 },     // K: 牙周
    { key: 'other', width: 9 },     // L: 其他
    { key: 'merch', width: 9 },     // M: 物販/小金庫
    { key: 'deposit', width: 8 },   // N: 押單
    { key: 'doc', width: 12 },      // O: 醫師 (Full Name)
    { key: 'note', width: 35 },     // P: 備註/NP (Widened to fit merged info)
    { key: 'content', width: 25 },  // Q: 療程內容
    { key: 'consultant', width: 10 },// R: 諮詢師
    { key: 'retailItem', width: 15 },// S: 販售品項
    { key: 'handler', width: 10 },   // T: 經手人
  ];

  // --- 3. Header Section ---
  
  // Row 1: Title
  sheet.mergeCells('A1:T1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = clinicName;
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.font = { name: 'Microsoft JhengHei', size: 18, bold: true };

  // Row 2: Date
  sheet.mergeCells('A2:T2');
  const dateCell = sheet.getCell('A2');
  dateCell.value = `日期：${toROCDate(dateStr)}`;
  dateCell.alignment = { vertical: 'middle', horizontal: 'right' };
  dateCell.font = { name: 'Microsoft JhengHei', size: 12 };

  // Row 3: Table Headers
  const headerRow = sheet.getRow(3);
  headerRow.values = [
    '序號', '姓名', 
    '掛號費', '部分負擔', 
    '假牙', '植牙', '美白', '矯正', 'SOV', 'INV', '牙周', '其他', '物販', '押單',
    '醫師', '備註 (NP)', '療程內容', '諮詢師', '販售品項', '經手人'
  ];
  headerRow.font = { name: 'Microsoft JhengHei', size: 10, bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;
  
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0F0F0' }
    };
  });

  // --- 4. Data Rows ---
  let currentRowIdx = 4;
  let totalCash = 0;
  let totalCard = 0;
  let totalTransfer = 0;

  let colTotals = {
    reg: 0, copay: 0, prostho: 0, implant: 0, whitening: 0, ortho: 0, sov: 0, inv: 0, perio: 0, other: 0, merch: 0
  };

  sortedRows.forEach((row, index) => {
    const r = sheet.getRow(currentRowIdx);
    const method = row.paymentMethod || 'cash';
    const rowTotal = row.actualCollected || 0;
    
    const bd = row.paymentBreakdown || { cash: 0, card: 0, transfer: 0 };
    if (bd.cash > 0 || bd.card > 0 || bd.transfer > 0) {
        totalCash += bd.cash;
        totalCard += bd.card;
        totalTransfer += bd.transfer;
    } else {
        if (method === 'card') totalCard += rowTotal;
        else if (method === 'transfer') totalTransfer += rowTotal;
        else totalCash += rowTotal;
    }

    colTotals.reg += (row.treatments.regFee || 0);
    colTotals.copay += (row.treatments.copayment || 0);
    colTotals.prostho += (row.treatments.prostho || 0);
    colTotals.implant += (row.treatments.implant || 0);
    colTotals.whitening += (row.treatments.whitening || 0);
    colTotals.ortho += (row.treatments.ortho || 0);
    colTotals.sov += (row.treatments.sov || 0);
    colTotals.inv += (row.treatments.inv || 0);
    colTotals.perio += (row.treatments.perio || 0);
    colTotals.other += (row.treatments.otherSelfPay || 0);
    colTotals.merch += (row.retail.products || 0) + (row.retail.diyWhitening || 0);

    // --- CRITICAL FIX: Dual Lookup Strategy for NP Matching ---
    let noteStr = "";
    let npData = npMapById.get(row.id);
    
    // Fallback to name-based lookup if ID match fails
    if (!npData && row.patientName) {
        npData = npMapByName.get(row.patientName.trim());
    }
    
    // Diagnostic logging for the first 5 rows
    if (index < 5) {
        console.log(`Export Row ${index + 1}: [${row.patientName}] (ID:${row.id}) Found NP Data:`, !!npData);
    }
    
    if (npData) {
        // Resolve Consultant Name from ID
        const consultantId = npData.consultant || '';
        const consultantName = staffMap.get(consultantId) || consultantId || '';
        
        // Detailed string format: NP / [Tag] / [Source] / [Consultant]
        // CLEANUP: Legacy '一般健保' is no longer a default.
        const npParts = [
            npData.marketingTag,
            npData.source,
            consultantName
        ].filter(p => p && p !== '-' && p !== '' && p !== '一般健保'); 
        
        noteStr = "NP" + (npParts.length > 0 ? " / " + npParts.join(" / ") : "");
    } else {
        // Fallback to existing manual notes if no NP tracking record found
        noteStr = row.npStatus || (row as any).note || "";
    }

    r.values = [
      index + 1,
      row.patientName,
      formatCurrency(row.treatments.regFee, method),
      formatCurrency(row.treatments.copayment, method),
      formatCurrency(row.treatments.prostho, method),
      formatCurrency(row.treatments.implant, method),
      formatCurrency(row.treatments.whitening, method),
      formatCurrency(row.treatments.ortho, method),
      formatCurrency(row.treatments.sov, method),
      formatCurrency(row.treatments.inv, method),
      formatCurrency(row.treatments.perio, method),
      formatCurrency(row.treatments.otherSelfPay, method),
      formatCurrency((row.retail.products||0) + (row.retail.diyWhitening||0), method),
      '',
      row.doctorName || '',
      noteStr, // Column P: Merged NP Details
      row.treatmentContent || '',
      row.treatments.consultant || '',
      row.retailItem || row.retail.productNote || '',
      row.retail.staff || ''
    ];

    r.font = { name: 'Microsoft JhengHei', size: 10 };
    r.alignment = { vertical: 'middle', horizontal: 'center' }; 
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });

    currentRowIdx++;
  });

  // Add some padding rows
  for (let i = 0; i < 3; i++) {
    const r = sheet.getRow(currentRowIdx);
    r.values = [sortedRows.length + i + 1];
    r.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });
    currentRowIdx++;
  }

  // Footer Totals Row
  const totalsRow = sheet.getRow(currentRowIdx);
  totalsRow.values = [
    '總計', '', 
    colTotals.reg, colTotals.copay, 
    colTotals.prostho, colTotals.implant, colTotals.whitening, colTotals.ortho, colTotals.sov, colTotals.inv, colTotals.perio, colTotals.other, colTotals.merch, 0,
    '', '', '', '', '', ''
  ];
  totalsRow.font = { name: 'Microsoft JhengHei', size: 11, bold: true };
  totalsRow.alignment = { vertical: 'middle', horizontal: 'center' };
  for(let c=3; c<=14; c++) {
      const cell = totalsRow.getCell(c);
      cell.border = { top: {style:'double'}, bottom: {style:'double'} };
  }
  currentRowIdx += 2;

  // Expenditures & Summary Section
  const startFooterRow = currentRowIdx;
  const totalExpenditureAmount = expenditures.reduce((s, e) => s + e.amount, 0);
  const netTotal = totalCash - totalExpenditureAmount + totalCard + totalTransfer;

  sheet.mergeCells(`A${startFooterRow}:H${startFooterRow}`);
  const expTitleCell = sheet.getCell(`A${startFooterRow}`);
  expTitleCell.value = "支出明細 (Expenditure Details):";
  expTitleCell.font = { name: 'Microsoft JhengHei', size: 10, bold: true };

  let expString = expenditures.length > 0 
    ? expenditures.map((e, i) => `${i + 1}. ${e.item} $${e.amount.toLocaleString()}`).join('\n')
    : "無支出";

  sheet.mergeCells(`A${startFooterRow+1}:H${startFooterRow+6}`);
  const expListCell = sheet.getCell(`A${startFooterRow+1}`);
  expListCell.value = expString;
  expListCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  expListCell.font = { name: 'Microsoft JhengHei', size: 10 };
  expListCell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

  const labelCol = 'K';
  const valueCol = 'N';
  
  const addSummaryLine = (rowOffset: number, label: string, amount: number, isNegative = false, isTotal = false) => {
      const rIdx = startFooterRow + rowOffset;
      sheet.mergeCells(`${labelCol}${rIdx}:M${rIdx}`);
      const lCell = sheet.getCell(`${labelCol}${rIdx}`);
      lCell.value = label;
      lCell.alignment = { horizontal: 'right' };
      lCell.font = { name: 'Microsoft JhengHei', size: 11, bold: true };

      sheet.mergeCells(`${valueCol}${rIdx}:P${rIdx}`);
      const vCell = sheet.getCell(`${valueCol}${rIdx}`);
      vCell.value = isNegative ? `-$${amount.toLocaleString()}` : `$${amount.toLocaleString()}`;
      vCell.alignment = { horizontal: 'right' };
      vCell.font = { name: 'Microsoft JhengHei', size: 11, bold: true, color: { argb: isTotal ? 'FF000000' : isNegative ? 'FFFF0000' : 'FF000000' } };
      if (isTotal) vCell.border = { top: {style:'double'} };
  };

  addSummaryLine(0, "現金收入 (Cash):", totalCash);
  addSummaryLine(1, "(-) 支出 (Exp):", totalExpenditureAmount, true);
  addSummaryLine(2, "刷卡 (Card):", totalCard);
  addSummaryLine(3, "匯款 (Trans):", totalTransfer);
  addSummaryLine(4, "總營收 (Net Total):", netTotal, false, true);

  // Signatures
  const signRow = startFooterRow + 6;
  sheet.mergeCells(`Q${signRow}:T${signRow}`);
  const signCell = sheet.getCell(`Q${signRow}`);
  signCell.value = "核對人: ________________";
  signCell.alignment = { horizontal: 'right', vertical: 'bottom' };
  signCell.font = { name: 'Microsoft JhengHei', size: 10 };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${clinicName}_日報表_${dateStr}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
};