/**
 * Gather every group's blob (blob-reports/<group>/*.zip) into one flat folder
 * and merge them into a single Tarento-branded report.
 *
 *   node scripts/merge-branded.mjs
 *
 * Produces brand-reports/report_merged_<ts>.html (+ latest.html).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'blob-reports';
const FLAT = path.join(ROOT, '_merge');

fs.rmSync(FLAT, { recursive: true, force: true });
fs.mkdirSync(FLAT, { recursive: true });

let n = 0;
if (fs.existsSync(ROOT)) {
  for (const entry of fs.readdirSync(ROOT)) {
    const full = path.join(ROOT, entry);
    if (entry === '_merge') continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(full)) {
        if (f.endsWith('.zip')) {
          fs.copyFileSync(path.join(full, f), path.join(FLAT, `${entry}-${f}`));
          n++;
        }
      }
    } else if (entry.endsWith('.zip')) {
      fs.copyFileSync(full, path.join(FLAT, entry));
      n++;
    }
  }
}

if (n === 0) {
  console.error('❌ No blob reports found. Run `npm run report:auth` and `npm run report:app` first.');
  process.exit(1);
}

console.log(`Merging ${n} blob(s) from ${ROOT}/ …`);
execSync(
  `npx cross-env REPORT_LABEL=merged playwright merge-reports --reporter ./reporters/brand-html-reporter.ts "${FLAT}"`,
  { stdio: 'inherit' },
);
