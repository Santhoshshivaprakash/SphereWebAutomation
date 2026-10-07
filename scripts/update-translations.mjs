/**
 * Refresh the Hindi dictionary the tests use (tests/helpers/i18n/hi.json).
 * ────────────────────────────────────────────────────────────────────────
 * Downloads the portal's own translation file (/assets/i18n/hi.json) from
 * production, staging and UAT, merges them (UAT wins — it is usually the
 * newest build) and saves the plain English → Hindi pairs.
 *
 *   npm run i18n:update
 *
 * Run it when the portal adds or rewords screens; then commit the JSON.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'tests/helpers/i18n/hi.json');
const HOSTS = ['https://sphere.aastrika.org', 'https://portal-staging.aastrika.org', 'https://uat.aastrika.org'];

const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();
const flat = (o, pre = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flat(v, `${pre}${k}.`, out);
    else out[pre + k] = v;
  }
  return out;
};

const before = existsSync(OUT) ? Object.keys(JSON.parse(readFileSync(OUT, 'utf-8'))).length : 0;
const merged = [];
for (const host of HOSTS) {
  try {
    const res = await fetch(`${host}/assets/i18n/hi.json`);
    if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) throw new Error(`HTTP ${res.status}`);
    const pairs = flat(await res.json());
    merged.push(...Object.entries(pairs));
    console.log(`✔ ${host}: ${Object.keys(pairs).length} entries`);
  } catch (e) {
    console.log(`⚠️  ${host}: ${e.message} — skipped`);
  }
}

// The same English label can appear under several raw keys (different
// whitespace) with DIFFERENT Hindi spellings ("मेरे प्रमाण पत्र" / "मेरे
// प्रमाणपत्र"), so keep every spelling: a string, or a list when there are several.
const out = {};
for (const [k, v] of merged) {
  if (typeof v !== 'string') continue;
  const en = tidy(k);
  const hi = tidy(v);
  if (!en || !hi || en === hi) continue;
  const prev = out[en];
  if (prev === undefined) out[en] = hi;
  else if (Array.isArray(prev)) { if (!prev.includes(hi)) prev.push(hi); }
  else if (prev !== hi) out[en] = [prev, hi];
}
if (!Object.keys(out).length) {
  console.error('✖ Nothing downloaded — the existing dictionary was left as it is.');
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf-8');
console.log(`\nSaved ${Object.keys(out).length} English → Hindi pairs (was ${before}) to tests/helpers/i18n/hi.json`);
