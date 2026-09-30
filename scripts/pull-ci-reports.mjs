/**
 * Copy GitHub Actions reports to this PC.
 * ───────────────────────────────────────
 * Every workflow uploads its reports as artifacts, but GitHub deletes them after
 * 90 days. This downloads each finished run's artifacts into ci-reports/ so
 * they are kept here for good:
 *
 *   ci-reports/<workflow>/<date time>_run<N>_<result>/<artifact>/…
 *   e.g. ci-reports/synthetic-monitor-prod-staging/2026-09-30_15-00_run42_success/
 *          monitor-report-production-42/test-reports/run-reports/RunReport_….pdf
 *
 * Runs already downloaded are listed in ci-reports/.pulled.json and skipped,
 * so it is safe to run as often as you like — only new runs are fetched.
 *
 *   npm run reports:pull                       newest 100 runs, every workflow
 *   npm run reports:pull -- --limit 300        look further back
 *   npm run reports:pull -- --workflow prod-monitor.yml   one workflow only
 *
 * Needs the GitHub CLI, installed and logged in once:
 *   winget install --id GitHub.cli
 *   gh auth login
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'ci-reports');
const LEDGER = join(OUT, '.pulled.json');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const LIMIT = flag('--limit', '100');
const WORKFLOW = flag('--workflow', '');

// `gh` on PATH, else the default Windows install location — a terminal opened
// before gh was installed (e.g. inside an already-running VS Code) still has the
// old PATH and can't find it by name.
const GH_DEFAULT = join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe');
const GH_BIN = spawnSync('gh', ['--version']).error && existsSync(GH_DEFAULT) ? GH_DEFAULT : 'gh';

/** Run the GitHub CLI from the repo folder (it reads the repo from the git remote). */
function gh(args) {
  return spawnSync(GH_BIN, args, { cwd: ROOT, encoding: 'utf-8', shell: false });
}

// ── preflight: gh installed and logged in ─────────────────────────────
const version = gh(['--version']);
if (version.error) {
  console.error('\n✖ The GitHub CLI (gh) is not installed. Install it once, then log in:');
  console.error('    winget install --id GitHub.cli');
  console.error('    gh auth login\n  (open a NEW terminal after installing so gh is on PATH)\n');
  process.exit(1);
}
if (gh(['auth', 'status']).status !== 0) {
  console.error('\n✖ The GitHub CLI is not logged in. Run:  gh auth login\n');
  process.exit(1);
}

// ── which runs exist ──────────────────────────────────────────────────
const listArgs = ['run', 'list', '--limit', LIMIT, '--json', 'databaseId,number,workflowName,createdAt,status,conclusion'];
if (WORKFLOW) listArgs.push('--workflow', WORKFLOW);
const list = gh(listArgs);
if (list.status !== 0) {
  console.error(`\n✖ Could not list workflow runs:\n${list.stderr}`);
  process.exit(1);
}
// Only finished runs — an in-progress run's artifacts aren't all uploaded yet.
const runs = JSON.parse(list.stdout).filter((r) => r.status === 'completed');

const pulled = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf-8')) : {};
const todo = runs.filter((r) => !pulled[r.databaseId]);

console.log(`\n📥 ${runs.length} finished run(s) found · ${todo.length} new · saving to ${relative(process.cwd(), OUT) || OUT}\n`);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const pad = (n) => String(n).padStart(2, '0');
/** createdAt (UTC) → this PC's local time, e.g. 2026-09-30_15-00. */
const stamp = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
};

let saved = 0;
let empty = 0;
let failed = 0;
// Oldest first, so the ledger and folders fill in time order.
for (const r of todo.reverse()) {
  const dir = join(OUT, slug(r.workflowName), `${stamp(r.createdAt)}_run${r.number}_${r.conclusion || 'unknown'}`);
  const label = `${r.workflowName} #${r.number} (${r.conclusion})`;
  const res = gh(['run', 'download', String(r.databaseId), '--dir', dir]);

  if (res.status === 0) {
    console.log(`  ✅ ${label} → ${relative(ROOT, dir)}`);
    pulled[r.databaseId] = { workflow: r.workflowName, run: r.number, dir: relative(ROOT, dir), at: new Date().toISOString() };
    saved++;
  } else if (/no valid artifacts|no artifact/i.test(res.stderr)) {
    // Nothing to fetch (the run uploaded nothing, or its artifacts expired) —
    // record it so it isn't retried on every pull.
    console.log(`  ⊘ ${label} — no artifacts (none uploaded, or already expired)`);
    pulled[r.databaseId] = { workflow: r.workflowName, run: r.number, dir: null, at: new Date().toISOString() };
    empty++;
  } else {
    // Network or permission problem — NOT recorded, so the next pull retries it.
    console.log(`  ✖ ${label} — download failed, will retry next time:\n      ${res.stderr.trim().split('\n').join('\n      ')}`);
    failed++;
  }
  // Save after every run, so an interrupted pull keeps its progress.
  mkdirSync(OUT, { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(pulled, null, 2));
}

console.log(`\n  ${saved} downloaded · ${empty} without artifacts · ${failed} failed`);
console.log(`  📂 ${OUT}\n`);
process.exit(failed ? 1 : 0);
