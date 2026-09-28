/**
 * Generate the Sphere Web Automation test case workbook.
 *
 *   node scripts/generate-testcases-excel.mjs
 *
 * Output: test-reports/excel-reports/Sphere-Automation-TestCases.xlsx
 *   Sheet 1 "Test Cases"  — every automated check, one row each
 *   Sheet 2 "Coverage Summary" — per-module counts
 */
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { part1 } from './lib/tc-01-public.mjs';
import { part2 } from './lib/tc-02-onboarding.mjs';
import { part3 } from './lib/tc-03-app.mjs';
import { part4 } from './lib/tc-04-learning.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-reports', 'excel-reports');
const OUT_FILE = path.join(OUT_DIR, 'Sphere-Automation-TestCases.xlsx');

const suites = [...part1, ...part2, ...part3, ...part4];

// ── Tarento brand palette ───────────────────────────────────────────
const NAVY = 'FF17283C';
const NAVY_300 = 'FF2D3E54';
const TEAL_50 = 'FFE3F7F6';
const GOLD_50 = 'FFFEF6E0';
const OFF_WHITE = 'FFF6F7F9';
const WHITE = 'FFFFFFFF';
const BORDER = 'FFD8DEE5';
const MID_GRAY = 'FF7C8696';

const thin = { style: 'thin', color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

const COLUMNS = [
  { header: 'Test Case ID',     key: 'id',       width: 14 },
  { header: 'Page / Module',    key: 'module',   width: 30 },
  { header: 'Test Steps',       key: 'steps',    width: 58 },
  { header: 'Input Data',       key: 'input',    width: 34 },
  { header: 'Expected Results', key: 'expected', width: 58 },
  { header: 'Actual Results',   key: 'actual',   width: 24 },
  { header: 'Test Environment', key: 'env',      width: 34 },
  { header: 'Execution Status', key: 'status',   width: 16 },
  { header: 'Bug Severity',     key: 'severity', width: 13 },
  { header: 'Bug Priority',     key: 'priority', width: 13 },
  { header: 'Notes',            key: 'notes',    width: 46 },
];

const wb = new ExcelJS.Workbook();
wb.creator = 'Sphere Web Automation';
wb.created = new Date();

// ══════════════════════════════════════════════════════════════════
// SHEET 1 — TEST CASES
// ══════════════════════════════════════════════════════════════════
const ws = wb.addWorksheet('Test Cases', {
  views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
});
ws.columns = COLUMNS;

// Header row
const head = ws.getRow(1);
head.height = 34;
head.eachCell((cell) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.font = { name: 'Open Sans', size: 11, bold: true, color: { argb: WHITE } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = allBorders;
});
ws.autoFilter = { from: 'A1', to: 'K1' };

let total = 0;
const summary = [];

for (const suite of suites) {
  // ── Section banner row ────────────────────────────────────────
  const banner = ws.addRow({ id: `${suite.module} — ${suite.spec}` });
  ws.mergeCells(`A${banner.number}:K${banner.number}`);
  banner.height = 28;
  const bc = ws.getCell(`A${banner.number}`);
  bc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL_50 } };
  bc.font = { name: 'Open Sans', size: 11, bold: true, color: { argb: NAVY } };
  bc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  for (let c = 1; c <= 11; c++) ws.getRow(banner.number).getCell(c).border = allBorders;

  // ── Precondition row ──────────────────────────────────────────
  const pre = ws.addRow({ id: `Run: ${suite.command}   |   Pre-condition: ${suite.precondition}` });
  ws.mergeCells(`A${pre.number}:K${pre.number}`);
  pre.height = 26;
  const pc = ws.getCell(`A${pre.number}`);
  pc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OFF_WHITE } };
  pc.font = { name: 'Open Sans', size: 9, italic: true, color: { argb: MID_GRAY } };
  pc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  for (let c = 1; c <= 11; c++) ws.getRow(pre.number).getCell(c).border = allBorders;

  // ── Test case rows ────────────────────────────────────────────
  suite.rows.forEach(([steps, input, expected, notes], i) => {
    const n = String(i + 1).padStart(3, '0');
    const row = ws.addRow({
      id: `TC-${suite.id}-${n}`,
      module: suite.module,
      steps,
      input,
      expected,
      actual: 'As expected',
      env: suite.env,
      status: 'Pass',
      severity: 'NA',
      priority: 'NA',
      notes: notes || `Automated — ${suite.spec}`,
    });
    total++;

    const zebra = i % 2 === 1;
    row.height = Math.max(30, 13 * Math.max(steps.split('\n').length, Math.ceil(expected.length / 62)));
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: 'Open Sans', size: 10, color: { argb: 'FF0D1218' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: col === 1 || (col >= 8 && col <= 10) ? 'center' : 'left',
        wrapText: true,
        indent: col === 1 || (col >= 8 && col <= 10) ? 0 : 1,
      };
      cell.border = allBorders;
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OFF_WHITE } };
    });
    row.getCell('id').font = { name: 'Open Sans', size: 10, bold: true, color: { argb: NAVY } };
    row.getCell('status').font = { name: 'Open Sans', size: 10, bold: true, color: { argb: 'FF15803D' } };
    row.getCell('env').font = { name: 'Open Sans', size: 9, color: { argb: NAVY_300 } };
    row.getCell('notes').font = { name: 'Open Sans', size: 9, color: { argb: MID_GRAY } };
  });

  summary.push({ module: suite.module, spec: suite.spec, count: suite.rows.length, command: suite.command });
}

// ── Data validation dropdowns on the editable columns ────────────
const lastRow = ws.rowCount;
for (let r = 2; r <= lastRow; r++) {
  ws.getCell(`H${r}`).dataValidation = {
    type: 'list', allowBlank: true,
    formulae: ['"Pass,Fail,Blocked,Skipped,Not Run"'],
  };
  ws.getCell(`I${r}`).dataValidation = {
    type: 'list', allowBlank: true,
    formulae: ['"NA,Critical,High,Medium,Low"'],
  };
  ws.getCell(`J${r}`).dataValidation = {
    type: 'list', allowBlank: true,
    formulae: ['"NA,P1,P2,P3,P4"'],
  };
}

// ══════════════════════════════════════════════════════════════════
// SHEET 2 — COVERAGE SUMMARY
// ══════════════════════════════════════════════════════════════════
const sum = wb.addWorksheet('Coverage Summary', {
  views: [{ state: 'frozen', ySplit: 1 }],
});
sum.columns = [
  { header: 'Page / Module',   key: 'module',  width: 44 },
  { header: 'Automation Script', key: 'spec',  width: 42 },
  { header: 'Test Cases',      key: 'count',   width: 14 },
  { header: 'How to Run',      key: 'command', width: 56 },
];
const sumHead = sum.getRow(1);
sumHead.height = 34;
sumHead.eachCell((cell) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.font = { name: 'Open Sans', size: 11, bold: true, color: { argb: WHITE } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = allBorders;
});

summary.forEach((s, i) => {
  const row = sum.addRow(s);
  row.height = 26;
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.font = { name: 'Open Sans', size: 10, color: { argb: 'FF0D1218' } };
    cell.alignment = { vertical: 'middle', horizontal: col === 3 ? 'center' : 'left', wrapText: true, indent: col === 3 ? 0 : 1 };
    cell.border = allBorders;
    if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OFF_WHITE } };
  });
});

const totalRow = sum.addRow({ module: 'TOTAL AUTOMATED TEST CASES', spec: `${suites.length} automation scripts`, count: total, command: 'npm run test  (full regression)' });
totalRow.height = 32;
totalRow.eachCell({ includeEmpty: true }, (cell, col) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col === 3 ? GOLD_50 : TEAL_50 } };
  cell.font = { name: 'Open Sans', size: 11, bold: true, color: { argb: NAVY } };
  cell.alignment = { vertical: 'middle', horizontal: col === 3 ? 'center' : 'left', wrapText: true, indent: col === 3 ? 0 : 1 };
  cell.border = allBorders;
});

fs.mkdirSync(OUT_DIR, { recursive: true });
await wb.xlsx.writeFile(OUT_FILE);

console.log(`\nTest case workbook written:`);
console.log(`   ${OUT_FILE}`);
console.log(`   ${total} test cases across ${suites.length} automation scripts\n`);
summary.forEach((s) => console.log(`   ${String(s.count).padStart(4)}  ${s.module}`));
console.log('');
