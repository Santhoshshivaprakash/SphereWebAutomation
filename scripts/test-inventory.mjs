/**
 * The full inventory of automated tests, in execution order.
 * ──────────────────────────────────────────────────────────
 * Answers "what exactly does a full run execute, and in what order?" — so a
 * failing full-suite run can be reconciled against a named list instead of a
 * count.
 *
 *   npm run test:list                    every project, in run order
 *   npm run test:list -- --no-signup     as a run with --no-signup would be
 *   npm run test:list -- --print         also dump the list to the terminal
 *
 * Order note: projects execute in playwright.config.ts declaration order
 * (api → monitor → Chrome), and within a project in file/declaration
 * order. That is the order listed here, and the order a serial run uses.
 *
 * Outputs (test-reports/):
 *   test-inventory.xlsx   Inventory sheet + Summary sheet
 *   test-inventory.csv    same rows, for diffing or importing
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'test-reports');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

// playwright.config.ts declaration order == execution order.
const PROJECTS = ['api', 'monitor', 'Chrome'];

const env = { ...process.env };
if (has('--no-signup')) env.SKIP_SIGNUP = '1';

/** Flatten one project's --list JSON into ordered rows. */
function listProject(project) {
  // Write the JSON to a file rather than reading stdout — dotenv and the
  // custom reporters print banners that would corrupt a stdout parse.
  const tmp = join(OUT, `_list.${project}.json`);
  spawnSync('npx',
    ['playwright', 'test', '--list', '--reporter=json', '--project', project],
    { cwd: ROOT, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: tmp },
      shell: true, encoding: 'utf8', stdio: 'ignore' });

  if (!existsSync(tmp)) { console.error(`  ! no JSON for project ${project}`); return []; }
  let json;
  try { json = JSON.parse(readFileSync(tmp, 'utf8')); }
  catch (e) { console.error(`  ! unparsable JSON for ${project}: ${e.message}`); return []; }
  finally { rmSync(tmp, { force: true }); }

  const rows = [];
  const walk = (suite, trail, file) => {
    const f = suite.file || file;
    // A file-level suite's title is the path; inner suites are describe() blocks.
    const norm = (s) => String(s ?? '').replace(/\\/g, '/');
    const isFile = norm(suite.title) === norm(f);
    const path = isFile || !suite.title ? trail : [...trail, suite.title];
    for (const spec of suite.specs || []) {
      rows.push({
        project,
        file: (spec.file || f || '').replace(/\\/g, '/'),
        line: spec.line ?? '',
        suite: path.join(' › '),
        title: spec.title,
      });
    }
    for (const child of suite.suites || []) walk(child, path, f);
  };
  for (const s of json.suites || []) walk(s, [], s.file);
  return rows;
}

console.log('Building inventory...');
const rows = [];
for (const p of PROJECTS) {
  const r = listProject(p);
  console.log(`  ${p.padEnd(8)} ${String(r.length).padStart(4)} tests`);
  rows.push(...r);
}
rows.forEach((r, i) => { r.n = i + 1; });

if (!rows.length) { console.error('No tests found.'); process.exit(1); }

/**
 * Write, falling back to a suffixed name when the target is locked. These files
 * get opened in Excel, which holds an exclusive handle and makes the write fail
 * with EBUSY/EPERM — that shouldn't throw away a completed inventory.
 */
function writeOrFallback(path, write) {
  try {
    write(path);
    return path;
  } catch (err) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
    const alt = path.replace(/(\.[^.]+)$/, `.new$1`);
    write(alt);
    console.warn(`  ! ${path} is locked (open in Excel?) — wrote ${alt} instead`);
    return alt;
  }
}

// ── csv ───────────────────────────────────────────────────────────────────
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = ['#,Project,File,Line,Suite,Test Case']
  .concat(rows.map((r) => [r.n, r.project, r.file, r.line, r.suite, r.title].map(q).join(',')))
  .join('\n');
const csvPath = writeOrFallback(join(OUT, 'test-inventory.csv'),
  (p) => writeFileSync(p, csv, 'utf8'));

// ── xlsx ──────────────────────────────────────────────────────────────────
const NAVY = 'FF17283C', TEAL50 = 'FFE3F7F6', OFFWHITE = 'FFF6F7F9';
const wb = new ExcelJS.Workbook();
wb.creator = 'SphereWebAutomation';

const ws = wb.addWorksheet('Inventory', { views: [{ state: 'frozen', ySplit: 1 }] });
ws.columns = [
  { header: '#', key: 'n', width: 6 },
  { header: 'Project', key: 'project', width: 10 },
  { header: 'File', key: 'file', width: 34 },
  { header: 'Line', key: 'line', width: 7 },
  { header: 'Suite', key: 'suite', width: 46 },
  { header: 'Test Case', key: 'title', width: 68 },
];
ws.addRows(rows);
ws.getRow(1).eachCell((c) => {
  c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  c.alignment = { vertical: 'middle' };
});
ws.getRow(1).height = 24;
ws.eachRow((row, i) => {
  if (i === 1) return;
  row.height = 18;
  row.alignment = { vertical: 'middle', wrapText: false };
  if (i % 2 === 0) row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OFFWHITE } };
  });
});
ws.autoFilter = { from: 'A1', to: `F${rows.length + 1}` };

const sum = wb.addWorksheet('Summary');
sum.columns = [{ width: 30 }, { width: 12 }, { width: 46 }];
const byProject = {};
const byFile = {};
for (const r of rows) {
  byProject[r.project] = (byProject[r.project] || 0) + 1;
  byFile[`${r.project}|${r.file}`] = (byFile[`${r.project}|${r.file}`] || 0) + 1;
}
const head = (t) => {
  const row = sum.addRow([t]);
  row.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  sum.mergeCells(`A${row.number}:C${row.number}`);
  row.height = 22;
};
head('Automated test inventory');
sum.addRow(['Generated', new Date().toISOString().slice(0, 19).replace('T', ' ')]);
sum.addRow(['Total tests', rows.length]);
sum.addRow(['Files', new Set(rows.map((r) => r.file)).size]);
sum.addRow(['Signup specs', has('--no-signup') ? 'excluded' : 'included']);
sum.addRow([]);
head('By project (execution order)');
sum.addRow(['Project', 'Tests']).font = { bold: true };
for (const p of PROJECTS) sum.addRow([p, byProject[p] || 0]);
const tot = sum.addRow(['TOTAL', rows.length]);
tot.font = { bold: true };
tot.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL50 } }; });
sum.addRow([]);
head('By file');
sum.addRow(['File', 'Tests', 'Project']).font = { bold: true };
Object.entries(byFile).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  const [proj, file] = k.split('|');
  sum.addRow([file, v, proj]);
});

const xlsxPath = join(OUT, 'test-inventory.xlsx');
let xlsxWritten = xlsxPath;
try {
  await wb.xlsx.writeFile(xlsxPath);
} catch (err) {
  if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
  xlsxWritten = xlsxPath.replace(/\.xlsx$/, '.new.xlsx');
  await wb.xlsx.writeFile(xlsxWritten);
  console.warn(`  ! ${xlsxPath} is locked (open in Excel?) — wrote ${xlsxWritten} instead`);
}

// ── report ────────────────────────────────────────────────────────────────
if (has('--print')) {
  let lastFile = '';
  for (const r of rows) {
    if (r.file !== lastFile) { console.log(`\n── [${r.project}] ${r.file}`); lastFile = r.file; }
    console.log(`  ${String(r.n).padStart(4)}. ${r.suite ? r.suite + ' › ' : ''}${r.title}`);
  }
}

console.log(`\nTotal: ${rows.length} tests in ${new Set(rows.map((r) => r.file)).size} files`);
console.log(`  ${xlsxWritten}`);
console.log(`  ${csvPath}`);
