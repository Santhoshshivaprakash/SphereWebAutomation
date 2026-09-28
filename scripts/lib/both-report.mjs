/**
 * One report for a BOTH-environment run.
 * ──────────────────────────────────────
 * scripts/run.mjs runs the same spec on production and then on staging, each
 * writing a Playwright JSON result file. This stitches those into a single
 * side-by-side report — every test as a row, one column per environment — so
 * "passes on production, fails on staging" is readable at a glance instead of
 * being buried in two separate runs' output.
 *
 * Writes an HTML report and the same thing as text, and returns both paths.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every test in a Playwright JSON report, flattened to title → result. */
function readResults(file) {
  if (!existsSync(file)) return null;
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
  const out = new Map();
  const walk = (suite, trail = []) => {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      // A spec can be retried; the LAST result is the one that counts.
      const test = spec.tests?.[spec.tests.length - 1];
      const run = test?.results?.[test.results.length - 1];
      // The RESULT's status is the truth — not `spec.ok`. A SKIPPED test carries
      // ok:true, so trusting ok would report a test that never ran as a pass.
      // These specs are describe.serial: one failure skips the rest of its
      // block, and those skips are exactly what must not look green.
      out.set([...here, spec.title].join(' › '), {
        status: run?.status ?? (spec.ok ? 'passed' : 'unknown'),
        durationMs: run?.duration ?? 0,
        error: (run?.error?.message ?? '').split('\n')[0].slice(0, 200),
      });
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const secs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

// "NOT RUN" rather than "SKIP": these specs are describe.serial, so a skip means
// the test never executed because an earlier one in its block failed. That is a
// gap in coverage, and it must not read as anything like a pass.
const MARK = { passed: '✅ PASS', failed: '❌ FAIL', timedOut: '⏱ TIMEOUT', skipped: '⊘ NOT RUN', interrupted: '⊘ CUT', unknown: '—' };

/**
 * Build the report.
 *
 * @param {object} o
 * @param {string} o.spec        what was run ('' = all specs)
 * @param {Array}  o.envs        [{ label, baseUrl, jsonFile, code }] in run order
 * @param {string} o.outDir      where to write
 * @returns {{htmlPath: string, textPath: string, rows: number, differing: number}}
 */
export function writeBothReport({ spec, envs, outDir }) {
  const loaded = envs.map((e) => ({ ...e, results: readResults(e.jsonFile) }));

  // Every test seen on EITHER side — a test missing from one environment is
  // itself worth showing (a spec that could not even start there).
  const titles = [];
  const seen = new Set();
  for (const env of loaded) {
    for (const title of env.results?.keys() ?? []) {
      if (!seen.has(title)) { seen.add(title); titles.push(title); }
    }
  }

  const rowsData = titles.map((title) => {
    const cells = loaded.map((env) => env.results?.get(title) ?? { status: 'unknown', durationMs: 0, error: '' });
    const statuses = new Set(cells.map((c) => c.status));
    return { title, cells, differs: statuses.size > 1 };
  });
  const differing = rowsData.filter((r) => r.differs);

  const stamp = new Date();
  const slug = (spec || 'all-specs').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const name = `both-env_${slug}_${stamp.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  mkdirSync(outDir, { recursive: true });

  // ── text ──
  const pad = Math.min(Math.max(...titles.map((t) => t.length), 10), 90);
  // Wide enough for the longest env label AND the widest verdict, so the columns
  // never run into each other.
  const col = Math.max(...loaded.map((e) => e.label.length), ...Object.values(MARK).map((m) => m.length)) + 3;
  const lines = [
    `${spec || 'ALL specs'} — production vs staging`,
    stamp.toLocaleString(),
    '',
    ...loaded.map((e) => {
      const r = [...(e.results?.values() ?? [])];
      const p = r.filter((x) => x.status === 'passed').length;
      const sk = r.filter((x) => x.status === 'skipped').length;
      const tally = r.length ? `${p}/${r.length} passed${sk ? `, ${sk} never ran` : ''}` : 'no results — the run did not report';
      return `  ${e.label.padEnd(22)} ${e.baseUrl}\n    ${tally}${e.code !== 0 ? `  (exit ${e.code})` : ''}`;
    }),
    '',
    `  ${differing.length} test(s) behave differently between the two environments.`,
    '',
    `  ${'TEST'.padEnd(pad)}  ${loaded.map((e) => e.label.padEnd(col)).join('')}`,
    `  ${'-'.repeat(pad)}  ${loaded.map(() => '-'.repeat(col - 2) + '  ').join('')}`,
    ...rowsData.map((r) =>
      `${r.differs ? '* ' : '  '}${r.title.slice(0, pad).padEnd(pad)}  ${r.cells.map((c) => (MARK[c.status] ?? c.status).padEnd(col)).join('')}`),
    '',
    '  (rows marked * differ between the environments)',
    '',
    ...differing.flatMap((r) => [
      `  ${r.title}`,
      ...r.cells.map((c, i) => `      ${loaded[i].label.padEnd(22)} ${MARK[c.status] ?? c.status}${c.error ? ` — ${c.error}` : ''}`),
      '',
    ]),
  ];
  const textPath = resolve(outDir, `${name}.txt`);
  writeFileSync(textPath, lines.join('\n'), 'utf-8');

  // ── html ──
  const cell = (c) => {
    const cls = c.status === 'passed' ? 'ok' : c.status === 'failed' || c.status === 'timedOut' ? 'bad' : 'meh';
    return `<td class="${cls}"><span class="mark">${esc(MARK[c.status] ?? c.status)}</span>`
      + (c.durationMs ? `<span class="dur">${esc(secs(c.durationMs))}</span>` : '')
      + (c.error ? `<div class="err">${esc(c.error)}</div>` : '')
      + '</td>';
  };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec || 'All specs')} — production vs staging</title>
<style>
  :root{--navy:#0B2545;--teal:#1B9AAA;--gold:#E8B23A;--ink:#16202E;--muted:#6B7A90;--line:#E3E8EF;--bg:#F7F9FC;--ok:#1E7F4F;--bad:#B3261E;}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.5 "Segoe UI",system-ui,-apple-system,Arial,sans-serif}
  header{background:var(--navy);color:#fff;padding:26px 32px}
  header h1{margin:0 0 6px;font-size:21px;font-weight:650}
  header .meta{color:#B8C6DA;font-size:13px}
  .wrap{max-width:1200px;margin:0 auto;padding:24px 32px 60px}
  .envs{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}
  .env{flex:1 1 260px;background:#fff;border:1px solid var(--line);border-left:4px solid var(--teal);
    border-radius:8px;padding:14px 16px}
  .env b{display:block;font-size:14px} .env span{color:var(--muted);font-size:12.5px;word-break:break-all}
  .env .tally{margin-top:8px;font-size:18px;font-weight:650}
  .env .skips{color:#8A6D1F;font-size:12px;margin-top:3px;line-height:1.35}
  .callout{background:#fff;border:1px solid var(--line);border-left:4px solid var(--gold);
    border-radius:8px;padding:14px 16px;margin:18px 0}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  th{background:var(--navy);color:#fff;text-align:left;padding:11px 14px;font-size:13px;font-weight:600}
  td{padding:10px 14px;border-top:1px solid var(--line);vertical-align:top;font-size:14px}
  tr.differs{background:#FFF9EC} tr.differs td:first-child{border-left:3px solid var(--gold)}
  td.ok .mark{color:var(--ok)} td.bad .mark{color:var(--bad)} td.meh .mark{color:var(--muted)}
  .mark{font-weight:650;white-space:nowrap} .dur{color:var(--muted);font-size:12px;margin-left:8px}
  .err{color:var(--bad);font-size:12.5px;margin-top:4px;font-family:ui-monospace,Consolas,monospace;word-break:break-word}
  .name{width:46%}
  footer{color:var(--muted);font-size:12.5px;margin-top:28px;border-top:1px solid var(--line);padding-top:14px}
  @media(max-width:720px){.wrap{padding:16px}.name{width:auto}}
</style></head><body>
<header>
  <h1>${esc(spec || 'All specs')} — production vs staging</h1>
  <div class="meta">${esc(stamp.toLocaleString())} · the same spec run end to end on each environment</div>
</header>
<div class="wrap">
  <div class="envs">
    ${loaded.map((e) => {
      const r = [...(e.results?.values() ?? [])];
      const p = r.filter((x) => x.status === 'passed').length;
      const sk = r.filter((x) => x.status === 'skipped').length;
      return `<div class="env"><b>${esc(e.label)}</b><span>${esc(e.baseUrl)}</span>
        <div class="tally">${r.length ? `${p} / ${r.length} passed` : 'no results'}</div>
        ${sk ? `<div class="skips">${sk} never ran — an earlier test in the same serial block failed</div>` : ''}</div>`;
    }).join('')}
  </div>
  <div class="callout"><strong>${differing.length}</strong> test(s) behave differently between the two environments.
    ${differing.length ? 'Those rows are highlighted below — start there.' : 'Both environments agree on every test.'}</div>
  <table>
    <thead><tr><th class="name">Test</th>${loaded.map((e) => `<th>${esc(e.label)}</th>`).join('')}</tr></thead>
    <tbody>
      ${rowsData.map((r) => `<tr class="${r.differs ? 'differs' : ''}"><td>${esc(r.title)}</td>${r.cells.map(cell).join('')}</tr>`).join('\n      ')}
    </tbody>
  </table>
  <footer>Generated by scripts/run.mjs · Sphere automation</footer>
</div></body></html>`;
  const htmlPath = resolve(outDir, `${name}.html`);
  writeFileSync(htmlPath, html, 'utf-8');

  return { htmlPath, textPath, rows: rowsData.length, differing: differing.length };
}
