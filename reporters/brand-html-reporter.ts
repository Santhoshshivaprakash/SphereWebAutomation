/**
 * Tarento-branded HTML Test Reporter for Playwright.
 * ──────────────────────────────────────────────────────────────────
 * Runs on EVERY `playwright test` invocation and writes a self-contained,
 * brand-styled HTML report into a dedicated folder:
 *
 *   brand-reports/report_<spec>_<timestamp>.html   (per run, timestamped)
 *   brand-reports/latest.html                       (always the newest)
 *
 * Styling follows the Tarento brand (80/15/5 navy/teal/gold, Open Sans).
 * Per brand rule: NO logo.
 *
 * Usage in playwright.config.ts:
 *   reporter: [['list'], ['./reporters/brand-html-reporter.ts']]
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Reporter, TestCase, TestResult, FullResult, Suite, FullConfig } from '@playwright/test/reporter';

interface Row {
  id: string;
  suite: string;
  title: string;
  file: string;
  env: 'Staging' | 'App';
  status: 'Pass' | 'Fail' | 'Skipped' | 'Timed Out' | 'Flaky';
  duration: string;
  error: string;
}

// Specs that target the staging signup environment (STAGING_URL) instead of the
// shared app env (BASE_URL). Override via STAGING_SPECS="a,b,c" if this changes.
const STAGING_SPECS = new Set(
  (process.env.STAGING_SPECS ?? 'create-account,OTP,positiveflow,public-login')
    .split(',')
    .map((s) => s.trim()),
);

const STATUS_CLASS: Record<Row['status'], string> = {
  Pass: 'pass',
  Fail: 'fail',
  Skipped: 'skip',
  'Timed Out': 'warn',
  Flaky: 'warn',
};

function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class BrandHtmlReporter implements Reporter {
  private rows: Row[] = [];
  private startTime = new Date();
  private specFiles = new Set<string>();
  private runLabel = '';

  onBegin(_config: FullConfig, suite: Suite) {
    this.startTime = new Date();
    for (const t of suite.allTests()) {
      this.specFiles.add(path.basename(t.location.file).replace(/\.spec\.ts$/, ''));
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const parts = test.titlePath().slice(2); // drop [project, file]
    const suite = parts.slice(0, -1).join(' › ') || '(root)';
    const title = parts[parts.length - 1] ?? test.title;
    const file = path.basename(test.location.file).replace(/\.spec\.ts$/, '');
    const env: Row['env'] = STAGING_SPECS.has(file) ? 'Staging' : 'App';

    let status: Row['status'];
    switch (result.status) {
      case 'passed': status = 'Pass'; break;
      case 'failed': status = 'Fail'; break;
      case 'timedOut': status = 'Timed Out'; break;
      case 'skipped': status = 'Skipped'; break;
      default: status = 'Fail';
    }
    const error = (result.error?.message ?? '')
      .replace(/\[\d+m/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);

    this.rows.push({
      id: `TC-${String(this.rows.length + 1).padStart(3, '0')}`,
      suite,
      title,
      file,
      env,
      status,
      duration: (result.duration / 1000).toFixed(2),
      error,
    });
  }

  async onEnd(result: FullResult) {
    const pass = this.rows.filter((r) => r.status === 'Pass').length;
    const fail = this.rows.filter((r) => r.status === 'Fail' || r.status === 'Timed Out').length;
    const skip = this.rows.filter((r) => r.status === 'Skipped').length;
    const total = this.rows.length;
    const rate = total ? ((pass / total) * 100).toFixed(1) : '0.0';
    const env = process.env.BASE_URL ?? 'https://sphere.aastrika.org';
    const durationS = ((Date.now() - this.startTime.getTime()) / 1000).toFixed(1);

    const html = this.render({ result, pass, fail, skip, total, rate, env, durationS });

    // Run label: explicit REPORT_LABEL, else the blob group name (auth/app),
    // else the single spec name. Used in the filename + report title so the
    // auth and app reports are easy to tell apart before merging.
    this.runLabel =
      process.env.REPORT_LABEL ||
      (process.env.BLOB_NAME ? process.env.BLOB_NAME.replace(/\.zip$/i, '') : '') ||
      (this.specFiles.size === 1 ? [...this.specFiles][0] : '');

    const dir = path.resolve(process.cwd(), 'brand-reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = this.startTime.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const labelPart = this.runLabel ? `_${this.runLabel}` : '';
    const file = path.join(dir, `report${labelPart}_${ts}.html`);
    fs.writeFileSync(file, html, 'utf-8');
    fs.writeFileSync(path.join(dir, 'latest.html'), html, 'utf-8');
    console.log(`\n🎨 Branded report saved: ${file}`);
  }

  private render(d: {
    result: FullResult; pass: number; fail: number; skip: number;
    total: number; rate: string; env: string; durationS: string;
  }): string {
    const overall = d.result.status.toUpperCase();
    const overallClass = d.fail > 0 ? 'fail' : 'pass';

    const stagingUrl = process.env.STAGING_URL ?? 'https://staging.aastrika.org';
    const stagingCount = this.rows.filter((r) => r.env === 'Staging').length;
    const appCount = this.rows.filter((r) => r.env === 'App').length;

    const rowsHtml = this.rows
      .map(
        (r) => `
        <tr>
          <td class="tc">${r.id}</td>
          <td class="center"><span class="env ${r.env === 'Staging' ? 'staging' : 'app'}">${r.env}</span></td>
          <td class="suite">${esc(r.file)}</td>
          <td>${esc(r.title)}</td>
          <td class="center"><span class="badge ${STATUS_CLASS[r.status]}">${r.status}</span></td>
          <td class="center num">${r.duration}s</td>
          <td class="err">${esc(r.error)}</td>
        </tr>`,
      )
      .join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sphere Automation — Test Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  :root{
    --navy:#17283C; --navy-400:#18293D; --teal:#1E8F8E; --teal-50:#E3F7F6;
    --gold:#F0A500; --gold-50:#FEF6E0; --gold-700:#9A6800;
    --off-white:#F6F7F9; --light-gray:#D8DEE5; --mid-gray:#7C8696; --almost-black:#0D1218;
    --success:#15803D; --success-lt:#DCFCE7; --error:#B91C1C; --error-lt:#FEE2E2;
    --warning:#B45309; --warning-lt:#FEF3C7;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--off-white);color:var(--almost-black);
    font-family:'Open Sans',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6}
  .wrap{max-width:1280px;margin:0 auto;padding:24px}
  header{background:var(--navy);color:#fff;border-radius:8px 8px 0 0;padding:24px;border-bottom:4px solid var(--teal)}
  header h1{margin:0;font-size:24px;font-weight:700}
  header .meta{margin-top:4px;color:#BEC5CE;font-size:13px}
  header .envs{margin-top:12px;font-size:12px;color:#BEC5CE}
  header .envs code{color:#fff;background:rgba(255,255,255,.08);padding:1px 6px;border-radius:4px}
  .env{display:inline-block;padding:1px 8px;border-radius:9999px;font-size:11px;font-weight:600}
  .env.app{background:var(--teal-50);color:var(--navy)}
  .env.staging{background:var(--gold-50);color:var(--gold-700)}
  .cards{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;background:#fff;padding:24px;
    border-left:1px solid var(--light-gray);border-right:1px solid var(--light-gray)}
  .card{border:1px solid var(--light-gray);border-radius:8px;padding:16px;text-align:center;background:#fff}
  .card .n{font-size:28px;font-weight:700;color:var(--navy)}
  .card .l{font-size:12px;font-weight:600;color:var(--mid-gray);text-transform:uppercase;letter-spacing:.04em}
  .card.pass .n{color:var(--success)} .card.fail .n{color:var(--error)} .card.skip .n{color:var(--mid-gray)}
  /* the single gold (5%) moment — the headline KPI */
  .card.kpi{background:var(--gold-50);border-color:var(--gold)}
  .card.kpi .n{color:var(--gold-700)}
  table{width:100%;border-collapse:collapse;background:#fff;
    border:1px solid var(--light-gray);border-radius:0 0 8px 8px;overflow:hidden}
  thead th{background:var(--navy);color:#fff;text-align:left;font-weight:600;font-size:13px;padding:12px}
  thead th.center{text-align:center}
  tbody td{padding:10px 12px;border-top:1px solid var(--light-gray);vertical-align:top}
  tbody tr:nth-child(even){background:var(--off-white)}
  td.center{text-align:center} td.num{font-variant-numeric:tabular-nums}
  td.tc{font-weight:700;color:var(--navy);white-space:nowrap}
  td.suite{color:var(--mid-gray)}
  td.err{color:var(--error);font-size:12px;max-width:360px}
  .badge{display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600}
  .badge.pass{background:var(--success-lt);color:var(--success)}
  .badge.fail{background:var(--error-lt);color:var(--error)}
  .badge.skip{background:var(--off-white);color:var(--mid-gray);border:1px solid var(--light-gray)}
  .badge.warn{background:var(--warning-lt);color:var(--warning)}
  .bar{height:8px;background:var(--light-gray);border-radius:9999px;overflow:hidden;margin:16px 0 0}
  .bar > i{display:block;height:100%;background:var(--teal)}
  footer{color:var(--mid-gray);font-size:12px;padding:16px 4px;text-align:center}
  .pill{display:inline-block;padding:2px 10px;border-radius:9999px;font-weight:600;font-size:12px}
  .pill.pass{background:var(--success-lt);color:var(--success)}
  .pill.fail{background:var(--error-lt);color:var(--error)}
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Sphere Automation — ${this.runLabel ? esc(this.runLabel[0].toUpperCase() + this.runLabel.slice(1)) + ' ' : ''}Test Report</h1>
      <div class="meta">
        ${esc(this.startTime.toLocaleString())} · Overall: <span class="pill ${overallClass}">${overall}</span>
      </div>
      <div class="envs">
        <span class="env app">App</span> ${appCount} tests · <code>${esc(d.env)}</code>
        &nbsp;&nbsp;<span class="env staging">Staging</span> ${stagingCount} tests · <code>${esc(stagingUrl)}</code>
      </div>
    </header>

    <div class="cards">
      <div class="card"><div class="n">${d.total}</div><div class="l">Total</div></div>
      <div class="card pass"><div class="n">${d.pass}</div><div class="l">Passed</div></div>
      <div class="card fail"><div class="n">${d.fail}</div><div class="l">Failed</div></div>
      <div class="card skip"><div class="n">${d.skip}</div><div class="l">Skipped</div></div>
      <div class="card kpi"><div class="n">${d.rate}%</div><div class="l">Pass Rate</div></div>
    </div>

    <div style="background:#fff;padding:0 24px 16px;border-left:1px solid var(--light-gray);border-right:1px solid var(--light-gray)">
      <div class="bar"><i style="width:${d.rate}%"></i></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>TC</th><th class="center">Env</th><th>Spec</th><th>Test</th>
          <th class="center">Status</th><th class="center">Duration</th><th>Error</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || '<tr><td colspan="7" class="center">No tests ran</td></tr>'}</tbody>
    </table>

    <footer>Duration ${d.durationS}s · Generated by the Sphere automation suite · Tarento brand style</footer>
  </div>
</body>
</html>`;
  }
}

export default BrandHtmlReporter;
