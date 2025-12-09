
import * as ExcelJSModule from 'exceljs';
import { AccountingRow } from '../types';

// Defensive import strategy
const ExcelJS = (ExcelJSModule as any).default?.Workbook ? (ExcelJSModule as any).default : ExcelJSModule;

// Helper: Convert YYYY-MM-DD to ROC Date (114/01/01)
const toROCDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const year = date.getFullYear() - 1911;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}/${month}/${day}`;
};

// Helper: Convert number to string, or empty if 0
const numToStr = (val: number | undefined): string | number => {
    if (!val || val === 0) return '';
    return val;
};

export const exportDailyReportToExcel = async (
  clinicName: string,
  dateStr: string,
  rows: AccountingRow[]
) => {
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

  // --- 1. Columns Setup ---
  // A: No, B: Name, C-P: Money, Q: Doc, R: Note
  sheet.columns = [
    { key: 'no', width: 6 },        // A: 序號
    { key: 'name', width: 14 },     // B: 病患姓名
    { key: 'reg', width: 10 },      // C: 掛號費
    { key: 'copay', width: 10 },    // D: 部分負擔
    { key: 'prostho', width: 10 },  // E: 假牙
    { key: 'implant', width: 10 },  // F: 植牙
    { key: 'whitening', width: 10 },// G: 美白
    { key: 'ortho', width: 10 },    // H: 矯正
    { key: 'sov', width: 10 },      // I: SOV
    { key: 'inv', width: 10 },      // J: INV (New)
    { key: 'perio', width: 10 },    // K: 牙周
    { key: 'other', width: 10 },    // L: 其他
    { key: 'merch', width: 10 },    // M: 物販
    { key: 'deposit', width: 10 },  // N: 押單 (Placeholder)
    { key: 'doc', width: 8 },       // O: 醫師
    { key: 'note', width: 20 },     // P: 備註
  ];

  // --- 2. Header Section ---
  
  // Row 1: Title
  sheet.mergeCells('A1:P1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = clinicName;
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.font = { name: 'Microsoft JhengHei', size: 18, bold: true };

  // Row 2: Date
  sheet.mergeCells('A2:P2');
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
    '醫師', '備註'
  ];
  headerRow.font = { name: 'Microsoft JhengHei', size: 10, bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;
  
  // Apply borders/bg to header
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0F0F0' } // Light Gray
    };
  });

  // --- 3. Data Rows ---
  let currentRowIdx = 4;
  let totals = {
    reg: 0, copay: 0, prostho: 0, implant: 0, whitening: 0, ortho: 0, sov: 0, inv: 0, perio: 0, other: 0, merch: 0, deposit: 0
  };

  rows.forEach((row, index) => {
    const r = sheet.getRow(currentRowIdx);
    
    // Update Totals (Keep numbers for calculation)
    totals.reg += (row.treatments.regFee || 0);
    totals.copay += (row.treatments.copayment || 0);
    totals.prostho += (row.treatments.prostho || 0);
    totals.implant += (row.treatments.implant || 0);
    totals.whitening += (row.treatments.whitening || 0);
    totals.ortho += (row.treatments.ortho || 0);
    totals.sov += (row.treatments.sov || 0);
    totals.inv += (row.treatments.inv || 0);
    totals.perio += (row.treatments.perio || 0);
    totals.other += (row.treatments.otherSelfPay || 0);
    totals.merch += (row.retail.products || 0) + (row.retail.diyWhitening || 0); 
    
    const docInitials = row.doctorName ? row.doctorName.substring(0, 1) : '';

    // Apply numToStr to convert 0 to ""
    r.values = [
      index + 1,
      row.patientName,
      numToStr(row.treatments.regFee),
      numToStr(row.treatments.copayment),
      numToStr(row.treatments.prostho),
      numToStr(row.treatments.implant),
      numToStr(row.treatments.whitening),
      numToStr(row.treatments.ortho),
      numToStr(row.treatments.sov),
      numToStr(row.treatments.inv),
      numToStr(row.treatments.perio),
      numToStr(row.treatments.otherSelfPay),
      numToStr((row.retail.products || 0) + (row.retail.diyWhitening || 0)),
      '', // Deposit placeholder
      docInitials,
      row.npStatus // Note
    ];

    r.font = { name: 'Microsoft JhengHei', size: 10 };
    r.alignment = { vertical: 'middle', horizontal: 'center' }; 
    
    // Borders
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });

    currentRowIdx++;
  });

  // --- 4. Padding Rows ---
  for (let i = 0; i < 5; i++) {
    const r = sheet.getRow(currentRowIdx);
    r.values = [
      rows.length + i + 1, 
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
    ];
    r.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });
    currentRowIdx++;
  }

  // --- 5. Footer Summary ---
  
  // A. Repeated Header Row
  const footerHeaderRow = sheet.getRow(currentRowIdx);
  footerHeaderRow.values = [
    '總計', '', 
    '掛號費', '部分負擔', 
    '假牙', '植牙', '美白', '矯正', 'SOV', 'INV', '牙周', '其他', '物販', '押單',
    '', ''
  ];
  footerHeaderRow.font = { name: 'Microsoft JhengHei', size: 9, bold: true, color: { argb: 'FF555555' } };
  footerHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
  currentRowIdx++;

  // B. Totals Row
  const totalsRow = sheet.getRow(currentRowIdx);
  totalsRow.values = [
    '', '', 
    totals.reg, totals.copay, 
    totals.prostho, totals.implant, totals.whitening, totals.ortho, totals.sov, totals.inv, totals.perio, totals.other, totals.merch, 0,
    '', ''
  ];
  totalsRow.font = { name: 'Microsoft JhengHei', size: 11, bold: true };
  totalsRow.alignment = { vertical: 'middle', horizontal: 'center' };
  
  // Apply borders to the totals numbers only (C to N)
  for(let c=3; c<=14; c++) {
      const cell = totalsRow.getCell(c);
      cell.border = { top: {style:'double'}, bottom: {style:'double'} };
  }
  currentRowIdx++;
  currentRowIdx++; 

  // --- 6. Bottom Layout (Sign-off) ---
  const startFooterRow = currentRowIdx;
  
  // Left Zone Text
  sheet.mergeCells(`A${startFooterRow}:F${startFooterRow}`);
  sheet.getCell(`A${startFooterRow}`).value = "押單返回 (未帶健保卡押金不列入當日營業額):";
  sheet.getCell(`A${startFooterRow}`).font = { name: 'Microsoft JhengHei', size: 10 };

  sheet.mergeCells(`A${startFooterRow+1}:F${startFooterRow+4}`);
  const expenseCell = sheet.getCell(`A${startFooterRow+1}`);
  expenseCell.value = "支出明細:\n\n\n";
  expenseCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  expenseCell.font = { name: 'Microsoft JhengHei', size: 10 };
  expenseCell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

  // Right Zone Text
  const rightStartCol = 'H';
  const rightEndCol = 'P';
  
  const addRightLine = (rowOffset: number, text: string) => {
      sheet.mergeCells(`${rightStartCol}${startFooterRow + rowOffset}:${rightEndCol}${startFooterRow + rowOffset}`);
      const cell = sheet.getCell(`${rightStartCol}${startFooterRow + rowOffset}`);
      cell.value = text;
      cell.alignment = { horizontal: 'right' };
      cell.font = { name: 'Microsoft JhengHei', size: 11, bold: true };
  };

  addRightLine(0, `現金總計:   ___________________   `);
  addRightLine(1, `(-)支出:   ___________________   `);
  addRightLine(2, `實收:   ___________________   `);
  addRightLine(3, `日期: ${toROCDate(dateStr)}      結算人: ___________________   `);

  // --- Finish & Download ---
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${clinicName}_日報表_${dateStr}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
};
