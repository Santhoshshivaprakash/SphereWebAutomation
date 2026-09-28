/**
 * One-round regression runner.
 *
 * Runs the end-to-end journey IN ORDER, each spec as its own Playwright process
 * (so one crash never blocks the rest), then aggregates a combined report with
 * per-failure root causes into regression-results/.
 *
 *   Create Account → BGV → Private Page → My Course → Competency → Account
 *
 *   node scripts/regression.mjs                 (uses BASE_URL / HEADLESS from env)
 *   BASE_URL=https://portal-staging.aastrika.org HEADLESS=true node scripts/regression.mjs
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');

const OUT = resolve(ROOT, 'regression-results');
mkdirSync(OUT, { recursive: true });

const BASE_URL = (process.env.BASE_URL || 'https://portal-staging.aastrika.org')
  .replace(/\/+$/, '').replace(/\/public\/home$/, '');
const HEADLESS = process.env.HEADLESS || 'true';

// The journey, in the requested order.
const STEPS = [
  ['1-create-account', 'tests/create-account.spec.ts',    'Create Account'],
  ['2-bgv',            'tests/Profile/ALL-BGV.spec.ts',    'BGV (background / profile completion)'],
  ['3-private-page',   'tests/PrivatePage.spec.ts',        'Private Page'],
  ['4-my-course',      'tests/Mycourse.spec.ts',           'My Course'],
  ['5-competency',     'tests/Competency.spec.ts',         'Competency'],
  ['6-account',        'tests/Account.spec.ts',            'Account tab'],
];

console.log(`\n🧪 REGRESSION ROUND on ${BASE_URL} (headless=${HEADLESS})\n`);

const runStamp = process.env.RUN_STAMP || String(Date.now());
const summary = [];

for (const [id, spec, label] of STEPS) {
  const jsonPath = resolve(OUT, `${id}.json`);
  console.log(`\n════════ ▶ ${label}  (${spec}) ════════\n`);
  const started = Number(process.env.RUN_STAMP ? 0 : 0); // wall time via reporter json
  const res = spawnSync(
    process.execPath,
    [cli, 'test', spec, '--project=Chrome', '--reporter=list,json'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_URL,
        HEADLESS,
        PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath,
      },
    },
  );
  summary.push({ id, spec, label, exit: res.status ?? -1, jsonPath });
}

// ── Aggregate ────────────────────────────────────────────────────
function collect(jsonPath) {
  if (!existsSync(jsonPath)) return { pass: 0, fail: 0, flaky: 0, skip: 0, ms: 0, fails: [] };
  let r;
  try { r = JSON.parse(readFileSync(jsonPath, 'utf8')); }
  catch { return { pass: 0, fail: 0, flaky: 0, skip: 0, ms: 0, fails: [], parseError: true }; }
  let pass = 0, fail = 0, flaky = 0, skip = 0, ms = 0;
  const fails = [];
  const walk = (suites, path) => {
    for (const s of suites || []) {
      const p = path ? `${path} › ${s.title}` : s.title;
      for (const sp of s.specs || []) {
        for (const t of sp.tests || []) {
          const dur = (t.results || []).reduce((a, x) => a + (x.duration || 0), 0);
          ms += dur;
          if (t.status === 'expected') pass++;
          else if (t.status === 'flaky') flaky++;
          else if (t.status === 'skipped') skip++;
          else {
            fail++;
            const last = (t.results || [])[t.results.length - 1] || {};
            const err = (last.error && (last.error.message || '')) ||
              (last.errors && last.errors[0] && last.errors[0].message) || '';
            const firstLine = String(err).replace(/\[[0-9;]*m/g, '').split('\n')
              .find((l) => l.trim()) || '(no error message)';
            fails.push({ title: `${p} › ${sp.title}`, error: firstLine.trim().slice(0, 240) });
          }
        }
      }
      walk(s.suites, p);
    }
  };
  walk(r.suites, '');
  return { pass, fail, flaky, skip, ms, fails };
}

let md = `# Regression Round — ${BASE_URL}\n\n`;
md += `Order: Create Account → BGV → Private Page → My Course → Competency → Account\n\n`;
md += `| # | Step | Passed | Failed | Flaky | Skipped | Time | Exit |\n`;
md += `|---|------|-------:|-------:|------:|--------:|-----:|-----:|\n`;

const allFails = [];
let T = { pass: 0, fail: 0, flaky: 0, skip: 0, ms: 0 };
summary.forEach((s, i) => {
  const c = collect(s.jsonPath);
  T.pass += c.pass; T.fail += c.fail; T.flaky += c.flaky; T.skip += c.skip; T.ms += c.ms;
  const note = c.parseError ? ' ⚠️no-json' : (c.pass + c.fail + c.flaky + c.skip === 0 ? ' ⚠️0-tests' : '');
  md += `| ${i + 1} | ${s.label}${note} | ${c.pass} | ${c.fail} | ${c.flaky} | ${c.skip} | ${(c.ms / 1000).toFixed(0)}s | ${s.exit} |\n`;
  c.fails.forEach((f) => allFails.push({ step: s.label, ...f }));
});
md += `| | **TOTAL** | **${T.pass}** | **${T.fail}** | **${T.flaky}** | **${T.skip}** | **${(T.ms / 1000 / 60).toFixed(1)} min** | |\n\n`;

if (allFails.length) {
  md += `## Failures (${allFails.length}) — with first error line\n\n`;
  allFails.forEach((f, i) => {
    md += `**${i + 1}. [${f.step}]** ${f.title}\n\n    ${f.error}\n\n`;
  });
} else {
  md += `## ✅ No failures.\n\n`;
}

const mdPath = resolve(OUT, 'SUMMARY.md');
writeFileSync(mdPath, md);
console.log('\n\n' + '='.repeat(70));
console.log(md);
console.log('='.repeat(70));
console.log(`\n📄 Combined report: ${mdPath}`);
console.log(`   Per-spec JSON:   ${OUT}\\{1..6}-*.json\n`);
