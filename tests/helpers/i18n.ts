/**
 * Translation helper — match a label in English OR Hindi
 * ──────────────────────────────────────────────────────
 * The portal shows each account in its own language (many orgs default to
 * Hindi), so a check that only knows the English wording fails for a Hindi
 * account even though the page is perfectly fine — that alone failed 102 tests
 * in one UAT run (the signed-in header read "आप आज क्या सीखना चाहते हैं?").
 *
 * The Hindi wording comes from the PORTAL'S OWN translation file
 * (/assets/i18n/hi.json, prod + staging + UAT merged), saved next to this file
 * as i18n/hi.json so tests never depend on fetching it. Refresh it when the
 * portal adds or changes wording:
 *
 *   npm run i18n:update
 *
 * Use:
 *   page.getByRole('button', { name: bi('Resume') })      // /^\s*(Resume|दोबारा शुरू करें)\s*$/i
 *   page.getByPlaceholder(bi('What do you want to learn today ?', { exact: false }))
 *   hi('My Certificates')                                   // 'मेरे प्रमाण पत्र'
 *   both('Log in')                                          // ['Log in', 'लॉग इन करें']
 */
import * as fs from 'fs';
import * as path from 'path';

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const key = (s: string) => tidy(s).toLowerCase().replace(/[\s?!.:]+$/g, '');

// English (normalised) → every Hindi wording the portal uses for it. One label
// can have several ("Next" is both "अगला" and "आगे" in different screens).
let dict: Map<string, string[]> | null = null;
function load(): Map<string, string[]> {
  if (dict) return dict;
  dict = new Map();
  try {
    // A value is one Hindi string, or a list when the portal spells it several ways.
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'hi.json'), 'utf-8')) as Record<string, string | string[]>;
    for (const [en, hiText] of Object.entries(raw)) {
      const list = dict.get(key(en)) ?? [];
      for (const h of Array.isArray(hiText) ? hiText : [hiText]) if (!list.includes(tidy(h))) list.push(tidy(h));
      dict.set(key(en), list);
    }
  } catch {
    // No dictionary → English-only matching; tests still run.
  }
  return dict;
}

/** The portal's Hindi for an English label (undefined if it has none). */
export function hi(en: string): string | undefined {
  return load().get(key(en))?.[0];
}

/** Hindi of the (at most 3) dictionary sentences whose English contains `phrase`. */
export function hiContaining(phrase: string): string[] {
  const p = key(phrase);
  const out: string[] = [];
  for (const [en, list] of load()) {
    if (en !== p && en.includes(p)) out.push(...list);
    if (out.length >= 3) break;
  }
  return out;
}

/** Every Hindi wording the portal uses for an English label. */
export function hiAll(en: string): string[] {
  return load().get(key(en)) ?? [];
}

/** The label in every language the portal uses: [English, Hindi…, …extra]. */
export function both(en: string, ...extra: string[]): string[] {
  return [...new Set([tidy(en), ...hiAll(en), ...extra].filter((s): s is string => Boolean(s)))];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');

/**
 * A RegExp matching the label in English or Hindi. Whitespace-tolerant and
 * case-insensitive. `exact` (default true) anchors it to the whole text;
 * `exact: false` matches it anywhere (for placeholders, longer sentences).
 * Trailing "?"/"." are optional, since the two languages punctuate differently.
 */
export function bi(en: string, opts: { exact?: boolean; extra?: string[] } = {}): RegExp {
  const words = both(en, ...(opts.extra ?? [])).map((s) => esc(s.replace(/[\s?.!:]+$/, '')) + '\\s*[?.!:]?');
  const body = `(?:${words.join('|')})`;
  return new RegExp(opts.exact === false ? body : `^\\s*${body}\\s*$`, 'i');
}

/** Source of bi() — for code that must pass a pattern into page.evaluate(). */
export function biSource(en: string, opts: { exact?: boolean; extra?: string[] } = {}): string {
  return bi(en, opts).source;
}

/** The signed-in header's search box, in either language. */
export const SEARCH_PLACEHOLDER = bi('What do you want to learn today ?', { exact: false });
/** The public "Log in" button / link, in either language. */
export const LOGIN_LABEL = bi('Log in', { extra: ['Login', hi('Login') ?? ''] });

/**
 * Add the Hindi wording to an EXISTING English pattern, keeping its anchors:
 *   hiAlso(/^(resume|start)$/i)  →  /^(?:resume|start|दोबारा शुरू करें|शुरू करें)$/i
 * Each alternative is looked up in the portal's dictionary; alternatives with
 * no Hindi entry are kept as they are. Returns the pattern unchanged when
 * nothing is found, so wrapping is always safe.
 */
export function hiAlso(re: RegExp): RegExp {
  let src = re.source;
  const start = src.startsWith('^') ? '^' : '';
  const end = src.endsWith('$') && !src.endsWith('\\$') ? '$' : '';
  src = src.slice(start.length, src.length - end.length);
  // Strip ONE wrapping group: (a|b) or (?:a|b) — only if it spans the whole thing.
  const wrapped = src.match(/^\((?:\?:)?(.*)\)$/);
  if (wrapped && !/[()]/.test(wrapped[1])) src = wrapped[1];
  if (/[()[\]]/.test(src)) return re; // too complex to rewrite safely — leave it
  const alts = src.split('|');
  const extra: string[] = [];
  for (const a of alts) {
    // Regex source → plain words: "\s*" → space, "\x" → x, drop quantifiers.
    const plain = a.replace(/\\s[*+]?/g, ' ').replace(/\\(.)/g, '$1').replace(/[?*+^$]/g, '').replace(/\./g, ' ').trim();
    for (const h of plain ? hiAll(plain) : []) if (!extra.includes(h)) extra.push(h);
    // An unanchored PART of a longer sentence ("explore various courses and
    // pick"): use the Hindi of the full sentence(s) that contain it.
    if (plain.length >= 12 && !start && !end && !hiAll(plain).length) {
      for (const h of hiContaining(plain)) if (!extra.includes(h)) extra.push(h);
    }
  }
  if (!extra.length) return re;
  const hiAlts = extra.map((h) => esc(h.replace(/[\s?.!:]+$/, '')) + '\\s*[?.!:]?');
  return new RegExp(`${start}(?:${[...alts, ...hiAlts].join('|')})${end}`, re.flags);
}

/** A tab label with its count, either language: withCount('Started') matches "Started (65)" and "शुरू किया (65)". */
export function withCount(en: string): RegExp {
  return new RegExp(`^\\s*(?:${both(en).map(esc).join('|')})\\s*\\(\\d+\\)\\s*$`, 'i');
}
