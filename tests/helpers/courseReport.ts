/**
 * courseReport — renders the per-course HTML report for CourseComplete.spec.ts.
 *
 * ── Reading this file ──────────────────────────────────────────────────
 * Most of it is one large HTML template literal. Comments CANNOT be added
 * inside that string (they would render as visible page text), so the code
 * that builds the data is commented line by line, and the template itself is
 * mapped by a section guide just above it.
 */
// Node's file system module — creates the output folder and writes the report.
import * as fs from 'fs';
// Node's path module — builds cross-platform file paths.
import * as path from 'path';

// Everything the report needs in order to render. The spec fills this in as it runs.
export interface CourseReportData {
  courseName: string;
  startedAt: Date;
  durationMs: number;
  moduleTypes: string[]; // ordered: 'video' | 'pdf' | 'assessment' | 'content'
  // Modules the run flagged as suspicious, with the reason why.
  warnings: { module: number; reason: string }[];
  // Each assessment encountered, and how many questions it held.
  assessments: { module: number; id: string; questions: number }[];
  completionMarker: boolean;
  certificateAttached: boolean;
  certificateGenerated: boolean;
  finalUrl: string;
  passed: boolean;
  // Optional: which AI model was used, if the answer-key path fell back.
  aiModel?: string;
  excelReport?: string;
}

// Escape text before putting it into HTML, so a course title containing < or & can't break the page.
const esc = (s: string) =>
  // `&` must be replaced FIRST, or it would double-escape the entities created by the later steps.
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Turn a course title into something safe to use in a filename.
const slug = (s: string) =>
  // Non-word characters become underscores, leading/trailing ones are trimmed, and the result is
  // capped at 60 chars. `|| 'course'` covers a title that reduces to an empty string.
  s.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'course';

// ── Tarento brand tokens (80/15/5 navy · teal · gold) ─────────────────
const NAVY = '#17283C';
const TEAL = '#1E8F8E';
const GOLD = '#F0A500';
// Chart order per brand: navy (primary) → teal (secondary) → orange → purple.
const TYPE_COLOR: Record<string, string> = {
  video: NAVY,
  assessment: TEAL,
  pdf: '#FF9400',
  content: '#31005E',
};

/**
 * Render a per-course HTML report in the Tarento brand style
 * (navy/teal/gold, Inter/Lato, no logo) and write it to test-reports/.
 * Returns the absolute file path.
 */
export function generateCourseReport(d: CourseReportData): string {
  // Tally how many modules of each type the run saw. `reduce` folds the list into a count object.
  const counts = d.moduleTypes.reduce<Record<string, number>>((a, t) => {
    // Increment this type's counter, starting from 0 the first time we see it.
    a[t] = (a[t] ?? 0) + 1;
    return a;
  }, {});
  // Total modules. `|| 1` prevents a divide-by-zero in pct() below.
  const total = d.moduleTypes.length || 1;
  // Convert a count into a whole-number percentage of the total.
  const pct = (n: number) => Math.round((n / total) * 100);
  // The types to render, in brand order, dropping any this course didn't contain.
  const order = ['video', 'pdf', 'assessment', 'content'].filter((t) => counts[t]);

  // Build a module-number → warning-reason lookup, so the timeline can flag the right ticks.
  const flags: Record<number, string> = {};
  // Copy each warning into the lookup, keyed by module number.
  for (const w of d.warnings) flags[w.module] = w.reason;

  // Duration in minutes, to one decimal place.
  const durMin = (d.durationMs / 60000).toFixed(1);
  // A human-readable run timestamp, in the local timezone.
  const runStamp = d.startedAt.toLocaleString();
  // Pulled into its own name because it's used inside the CSS template below.
  const passed = d.passed;

  // The stacked composition bar: one <span> per type, width proportional to its share.
  const barSpans = order
    // `?? '#7C8696'` is a grey fallback for any type not in TYPE_COLOR.
    .map((t) => `<span style="width:${pct(counts[t])}%;background:${TYPE_COLOR[t] ?? '#7C8696'}"></span>`)
    // Join into one HTML string with no separator.
    .join('');
  // The legend beneath that bar: a colour swatch, the type name, its count and its percentage.
  const legend = order
    .map(
      (t) =>
        // `t[0].toUpperCase() + t.slice(1)` capitalises the first letter: "video" → "Video".
        `<div class="item"><span class="swatch" style="background:${TYPE_COLOR[t] ?? '#7C8696'}"></span> ${t[0].toUpperCase() + t.slice(1)} <b>${counts[t]}</b> <span class="pct">${pct(counts[t])}%</span></div>`,
    )
    .join('');

  // The assessments table body — or a single "none" row when the course had no quizzes.
  const assessRows = d.assessments.length
    ? d.assessments
        .map(
          (a, i) =>
            // `i % 2` adds the zebra class to every other row.
            // `padStart(2, '0')` renders module 3 as "03" so the column stays aligned.
            // Long content ids are shortened to "do_…1234567" to keep the column narrow.
            `<tr${i % 2 ? ' class="zebra"' : ''}><td class="mono">${String(a.module).padStart(2, '0')}</td><td class="mono">${esc(a.id.length > 14 ? 'do_…' + a.id.slice(-7) : a.id)}</td><td class="mono">${a.questions || '—'}</td><td>Answer-key match</td><td><span class="pill ok">Answered</span></td></tr>`,
        )
        .join('')
    // The empty state, spanning all five columns.
    : `<tr><td colspan="5" style="color:#7C8696">No assessments encountered.</td></tr>`;

  // The observations list, built up conditionally below.
  const obs: string[] = [];
  // Every module was walked, but the course never showed its completion screen — worth flagging.
  if (!d.completionMarker) {
    obs.push(ob('warn', 'Completion marker not confirmed', `All ${total} modules were traversed, but the course-level completion state (Congratulations / Ratings) was not confirmed.`));
  }
  // A certificate was promised but never produced.
  if (d.certificateAttached && !d.certificateGenerated) {
    obs.push(ob('warn', 'Certificate not generated', `A certificate is attached to this course, but no certificate control was found after completion, so it was not generated.`));
  }
  // One entry per module-level warning the run raised.
  for (const w of d.warnings) {
    obs.push(ob('warn', `Module ${w.module} — ${esc(w.reason)}`, `Flagged on the timeline; confirm this module was not silently skipped.`));
  }
  // Always finish with an informational summary of what the course contained.
  obs.push(ob('info', 'Module composition', `${total} modules traversed — ${order.map((t) => `${counts[t]} ${t}`).join(', ')}.`));

  // ── THE TEMPLATE ────────────────────────────────────────────────────
  // One template literal holding the whole page. Its structure, in order:
  //   <head>    — fonts, then a :root block of Tarento brand tokens and all page CSS.
  //               The verdict pill's colour is interpolated from `passed`.
  //   header    — course title, run metadata, and the pass/fail verdict pill.
  //   §1 Run at a glance   — four metric tiles; the first is the gold headline KPI,
  //                          and the warnings tile turns gold when any were raised.
  //   §2 Content composition — the stacked bar (barSpans) plus its legend.
  //   §3 Module timeline     — an empty <div id="strip"> that the script at the
  //                            bottom fills with one tick per module.
  //   §4 Assessments         — the table whose body is assessRows.
  //   §5 Observations        — the obs array joined together.
  //   §6 Run environment     — a definition list of the run's settings.
  //   <script>  — receives seq / flags / colors as JSON and builds the timeline ticks.
  //
  // Nothing inside this string may carry a // comment — it would render as text.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Course Completion Report — ${esc(d.courseName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lato:wght@400;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --navy:#17283C; --navy-400:#18293D; --navy-100:#7E8A9A;
    --teal:#1E8F8E; --teal-600:#186E6E; --teal-50:#E3F7F6;
    --gold:#F0A500; --gold-700:#9A6800; --gold-50:#FEF6E0;
    --off-white:#F6F7F9; --light-gray:#D8DEE5; --mid-gray:#7C8696; --ink:#0D1218;
    --success:#22C55E; --success-bg:#DCFCE7; --success-dark:#15803D;
    --error:#EF4444; --error-bg:#FEE2E2; --error-dark:#B91C1C;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--off-white);color:var(--ink);
    font-family:'Inter','Open Sans',system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;padding:40px 20px 64px;}
  .wrap{max-width:1000px;margin:0 auto}
  .card{background:#fff;border:1px solid var(--light-gray);border-radius:8px}

  /* header */
  .head{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;justify-content:space-between;
    border-bottom:3px solid var(--navy);padding-bottom:24px;}
  .eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
    color:var(--teal-600);font-weight:600;margin:0 0 10px;}
  h1{font-weight:700;font-size:clamp(24px,4vw,34px);line-height:1.2;letter-spacing:-.01em;margin:0;max-width:22ch;color:var(--navy);}
  .runmeta{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--mid-gray);margin-top:14px;display:flex;flex-wrap:wrap;gap:4px 18px;}
  .runmeta b{color:var(--ink);font-weight:500}
  .status{flex:0 0 auto;text-align:right}
  .verdict{display:inline-flex;align-items:center;gap:9px;font-weight:700;font-size:14px;letter-spacing:.03em;text-transform:uppercase;
    color:#fff;background:${passed ? 'var(--success)' : 'var(--error)'};padding:10px 18px;border-radius:9999px;}
  .verdict .dot{width:9px;height:9px;border-radius:50%;background:#fff}
  .status .sub{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--mid-gray);margin-top:9px;display:block}

  section{margin-top:40px}
  .sec-label{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mid-gray);
    display:flex;align-items:center;gap:12px;margin:0 0 18px;}
  .sec-label::after{content:"";flex:1;height:2px;background:var(--teal);opacity:.35}

  /* metrics — one gold-highlighted headline KPI (the 5%) */
  .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .metric{background:#fff;border:1px solid var(--light-gray);border-radius:8px;padding:18px}
  .metric .num{font-weight:700;font-size:30px;line-height:1;color:var(--navy)}
  .metric .num small{font-size:15px;color:var(--mid-gray);font-weight:500;margin-left:2px}
  .metric .cap{font-size:12px;color:var(--mid-gray);margin-top:9px}
  .metric.head-kpi{background:var(--gold-50);border-color:var(--gold);border-left:4px solid var(--gold)}
  .metric.warnborder{border-color:var(--gold);background:var(--gold-50)}
  .metric.warnborder .num{color:var(--gold-700)}

  .comp,.strip-wrap{background:#fff;border:1px solid var(--light-gray);border-radius:8px;padding:22px}
  .bar{display:flex;height:20px;border-radius:6px;overflow:hidden;margin-bottom:16px;background:var(--off-white)}
  .bar span{display:block;height:100%}
  .legend{display:flex;flex-wrap:wrap;gap:10px 24px}
  .legend .item{display:flex;align-items:center;gap:9px;font-size:13.5px}
  .swatch{width:12px;height:12px;border-radius:3px;flex:0 0 auto}
  .legend b{font-family:'JetBrains Mono',monospace;font-weight:700}
  .legend .pct{color:var(--mid-gray);font-family:'JetBrains Mono',monospace;font-size:12px}

  .strip{display:flex;flex-wrap:wrap;gap:5px}
  .tick{position:relative;width:15px;height:34px;border-radius:4px;display:flex;align-items:flex-end;justify-content:center}
  .tick .n{position:absolute;top:-16px;left:50%;transform:translateX(-50%);font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid-gray);opacity:0;transition:opacity .12s;white-space:nowrap}
  .tick:hover .n{opacity:1}
  .tick.flag::after{content:"";position:absolute;top:-4px;right:-3px;width:8px;height:8px;border-radius:50%;background:var(--gold);border:1.5px solid #fff}
  .strip-key{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:18px;font-size:12.5px;color:var(--mid-gray)}
  .strip-key .item{display:flex;align-items:center;gap:8px}

  .tbl-wrap{background:#fff;border:1px solid var(--light-gray);border-radius:8px;overflow:hidden}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  thead th{text-align:left;font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#fff;
    padding:13px 18px;background:var(--navy);}
  tbody td{padding:12px 18px;border-bottom:1px solid var(--light-gray);vertical-align:middle}
  tbody tr:last-child td{border-bottom:none}
  tbody tr.zebra{background:var(--off-white)}
  td.mono,th.mono{font-family:'JetBrains Mono',monospace}
  .pill{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:11px;padding:3px 10px;border-radius:9999px;font-weight:500}
  .pill.ok{background:var(--success-bg);color:var(--success-dark)}

  .obs{display:grid;gap:12px}
  .ob{display:flex;gap:14px;align-items:flex-start;border-radius:8px;padding:16px 18px}
  .ob.info{background:var(--teal-50);border-left:4px solid var(--teal)}
  .ob.warn{background:var(--gold-50);border-left:4px solid var(--gold)}
  .ob .glyph{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;flex:0 0 auto;margin-top:1px}
  .ob.info .glyph{color:var(--teal-600)}
  .ob.warn .glyph{color:var(--gold-700)}
  .ob .body h4{margin:0 0 3px;font-size:14.5px;font-weight:600;color:var(--navy)}
  .ob .body p{margin:0;font-size:13.5px;color:var(--mid-gray)}
  .ob .body code{font-family:'JetBrains Mono',monospace;font-size:12px;background:#fff;padding:1px 5px;border-radius:4px;color:var(--navy)}

  .env{background:#fff;border:1px solid var(--light-gray);border-radius:8px;padding:6px 22px}
  .env dl{display:grid;grid-template-columns:180px 1fr;margin:0}
  .env dt{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mid-gray);padding:14px 0;border-bottom:1px solid var(--light-gray)}
  .env dd{margin:0;padding:14px 0;border-bottom:1px solid var(--light-gray);font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--ink);word-break:break-all}
  .env dl>*:nth-last-child(-n+2){border-bottom:none}

  footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--light-gray);
    font-family:'Lato',sans-serif;font-size:12px;color:var(--mid-gray);display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}
  @media (max-width:640px){.metrics{grid-template-columns:repeat(2,1fr)}.status{text-align:left}.env dl{grid-template-columns:1fr}.env dt{padding-bottom:0;border-bottom:none}.env dd{padding-top:4px}}
</style>
</head>
<body>
<div class="wrap">
  <header class="head">
    <div>
      <p class="eyebrow">Sphere · Course Completion Automation</p>
      <h1>${esc(d.courseName)}</h1>
      <div class="runmeta">
        <span>Suite <b>CourseComplete.spec.ts</b></span>
        <span>Runner <b>Playwright · Chrome (CDP)</b></span>
        <span>Run <b>${esc(runStamp)}</b></span>
      </div>
    </div>
    <div class="status">
      <span class="verdict"><span class="dot"></span>${passed ? 'Passed' : 'Failed'}</span>
      <span class="sub">${passed ? '1 passed · 0 failed' : '0 passed · 1 failed'}<br>wall time ${durMin} min</span>
    </div>
  </header>

  <section>
    <p class="sec-label">Run at a glance</p>
    <div class="metrics">
      <div class="metric head-kpi"><div class="num">${total}</div><div class="cap">Modules completed</div></div>
      <div class="metric"><div class="num">${d.assessments.length}</div><div class="cap">Assessments auto-answered</div></div>
      <div class="metric ${d.warnings.length ? 'warnborder' : ''}"><div class="num">${d.warnings.length}</div><div class="cap">Warnings raised</div></div>
      <div class="metric"><div class="num">${durMin}<small>m</small></div><div class="cap">End-to-end duration</div></div>
    </div>
  </section>

  <section>
    <p class="sec-label">Content composition</p>
    <div class="comp">
      <div class="bar" aria-hidden="true">${barSpans}</div>
      <div class="legend">${legend}</div>
    </div>
  </section>

  <section>
    <p class="sec-label">Module timeline</p>
    <div class="strip-wrap">
      <div class="strip" id="strip"></div>
      <div class="strip-key">
        <div class="item"><span class="swatch" style="background:${NAVY}"></span> Video</div>
        <div class="item"><span class="swatch" style="background:${TEAL}"></span> Assessment</div>
        <div class="item"><span class="swatch" style="background:#FF9400"></span> PDF</div>
        <div class="item"><span class="swatch" style="background:#31005E"></span> Content</div>
        <div class="item"><span class="swatch" style="background:${GOLD};border-radius:50%"></span> Warning flag</div>
      </div>
    </div>
  </section>

  <section>
    <p class="sec-label">Assessments completed</p>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="mono">Module</th><th>Assessment ID</th><th class="mono">Questions</th><th>Answering</th><th>Result</th></tr></thead>
        <tbody>${assessRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <p class="sec-label">Observations &amp; warnings</p>
    <div class="obs">${obs.join('')}</div>
  </section>

  <section>
    <p class="sec-label">Run environment</p>
    <div class="env">
      <dl>
        <dt>Target course</dt><dd>${esc(d.courseName)}</dd>
        <dt>AI assist</dt><dd>${esc(d.aiModel ?? 'answer-key only')}</dd>
        <dt>Certificate</dt><dd>${d.certificateAttached ? (d.certificateGenerated ? 'attached · generated' : 'attached · not generated') : 'none'}</dd>
        <dt>Excel report</dt><dd>${esc(d.excelReport ?? 'see test-reports/')}</dd>
        <dt>Final URL</dt><dd>${esc(d.finalUrl)}</dd>
      </dl>
    </div>
  </section>

  <footer>
    <span>SphereWebAutomation · CourseComplete.spec.ts</span>
    <span>Generated ${esc(d.startedAt.toISOString().slice(0, 10))} · Tarento brand</span>
  </footer>
</div>
<script>
  const seq=${JSON.stringify(d.moduleTypes)};
  const flags=${JSON.stringify(flags)};
  const colors=${JSON.stringify(TYPE_COLOR)};
  const strip=document.getElementById('strip');
  seq.forEach((t,i)=>{
    const n=i+1;
    const el=document.createElement('div');
    el.className='tick'+(flags[n]?' flag':'');
    el.style.background=colors[t]||'#7C8696';
    el.title='Module '+n+' · '+t+(flags[n]?' · '+flags[n]:'');
    el.innerHTML='<span class="n">'+String(n).padStart(2,'0')+'</span>';
    strip.appendChild(el);
  });
</script>
</body>
</html>`;

  // Where reports go, resolved from wherever the runner was started.
  const dir = path.resolve(process.cwd(), 'test-reports', 'course-reports');
  // Create it (and any missing parents) the first time.
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // A filename-safe timestamp: colons and dots are illegal in Windows filenames, so swap them
  // for dashes, and trim to "2026-09-12T14-05-55".
  const ts = d.startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Course name + timestamp, so repeated runs never overwrite each other.
  const file = path.join(dir, `CourseReport_${slug(d.courseName)}_${ts}.html`);
  // Write it out as UTF-8.
  fs.writeFileSync(file, html, 'utf-8');
  // Hand the path back so the spec can log it.
  return file;
}

// Builds one observation card. `kind` picks the teal (info) or gold (warn) styling.
function ob(kind: 'info' | 'warn', title: string, body: string): string {
  // "!" for warnings, "i" for information.
  const glyph = kind === 'warn' ? '!' : 'i';
  // Note: `title` is escaped here, but `body` is NOT — callers pass pre-escaped HTML into it.
  return `<div class="ob ${kind}"><span class="glyph">${glyph}</span><div class="body"><h4>${esc(title)}</h4><p>${body}</p></div></div>`;
}
