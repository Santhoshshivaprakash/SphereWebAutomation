/**
 * One-off codemod: make English-only label matchers in specs also match the
 * portal's Hindi wording, by wrapping them in hiAlso(...).
 *
 *   npx tsx scripts/i18n-wrap.ts tests/Mycourse.spec.ts tests/PrivatePage.spec.ts …
 *   npx tsx scripts/i18n-wrap.ts --dry …   (report only)
 *
 * Only regex literals in label positions are touched —
 *   getByText(/…/)  getByPlaceholder(/…/)  getByLabel(/…/)  name: /…/  hasText: /…/
 * — and only when hiAlso() actually adds Hindi (i.e. the dictionary knows the
 * words). Patterns that already contain Hindi are left alone.
 */
import * as fs from 'fs';
import * as path from 'path';
import { hiAlso } from '../tests/helpers/i18n';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const files = args.filter((a) => !a.startsWith('--'));

const CONTEXT = /(getByText\(\s*|getByPlaceholder\(\s*|getByLabel\(\s*|\bname:\s*|\bhasText:\s*)$/;

/** Read a regex literal starting at s[i] === '/'. Returns [end index, body, flags] or null. */
function readRegex(s: string, i: number): [number, string, string] | null {
  let j = i + 1;
  let inClass = false;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '\n') return null;
    if (c === '\\') { j++; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) break;
  }
  if (j >= s.length) return null;
  const m = s.slice(j + 1).match(/^[a-z]*/);
  const flags = m ? m[0] : '';
  return [j + 1 + flags.length, s.slice(i + 1, j), flags];
}

let total = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf-8');
  let out = '';
  let last = 0;
  let changed = 0;
  for (let i = 0; i < src.length; i++) {
    // Plain-text labels: getByText('Started') matches a case-insensitive
    // substring, so the equivalent pattern is /Started/i.
    if ((src[i] === "'" || src[i] === '"') && CONTEXT.test(src.slice(Math.max(0, i - 40), i))) {
      const q = src[i];
      const close = src.indexOf(q, i + 1);
      const text = close > i ? src.slice(i + 1, close) : '';
      // `exact: true` right after would change the meaning — leave those alone.
      const after = src.slice(close + 1, close + 40);
      if (text && !text.includes('\n') && !/[ऀ-ॿ\\]/.test(text) && !/exact:\s*true/.test(after)) {
        const body = text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
        const re = new RegExp(body, 'i');
        if (hiAlso(re).source !== re.source) {
          out += src.slice(last, i) + `hiAlso(/${body}/i)`;
          last = close + 1;
          i = close;
          changed++;
          continue;
        }
      }
    }
    if (src[i] !== '/') continue;
    if (!CONTEXT.test(src.slice(Math.max(0, i - 40), i))) continue;
    if (/hiAlso\(\s*$/.test(src.slice(Math.max(0, i - 10), i))) continue;
    const r = readRegex(src, i);
    if (!r) continue;
    const [end, body, flags] = r;
    if (/[ऀ-ॿ]/.test(body)) { i = end - 1; continue; } // already bilingual
    let re: RegExp;
    try { re = new RegExp(body, flags); } catch { continue; }
    if (hiAlso(re).source === re.source) { i = end - 1; continue; } // nothing to add
    out += src.slice(last, i) + `hiAlso(/${body}/${flags})`;
    last = end;
    i = end - 1;
    changed++;
  }
  out += src.slice(last);
  if (changed && !/\bhiAlso\b[^\n]*from '[^']*i18n'/.test(out)) {
    const rel = path.relative(path.dirname(file), path.resolve('tests/helpers/i18n')).replace(/\\/g, '/');
    const spec = rel.startsWith('.') ? rel : `./${rel}`;
    const existing = out.match(/^import \{([^}]*)\} from '([^']*i18n)';/m);
    if (existing) out = out.replace(existing[0], `import {${existing[1].trimEnd()}, hiAlso } from '${existing[2]}';`);
    else {
      // after the last top-level import statement
      const lines = out.split('\n');
      let at = -1;
      for (let k = 0; k < lines.length; k++) if (/^import .*;\s*$/.test(lines[k]) || /^\} from '.*';\s*$/.test(lines[k])) at = k;
      lines.splice(at + 1, 0, `import { hiAlso } from '${spec}';`);
      out = lines.join('\n');
    }
  }
  console.log(`${changed ? '✎' : '·'} ${file}: ${changed} matcher(s)${dry ? ' (dry run)' : ''}`);
  if (changed && !dry) fs.writeFileSync(file, out, 'utf-8');
  total += changed;
}
console.log(`\n${total} matcher(s) ${dry ? 'would be' : ''} wrapped with hiAlso().`);
