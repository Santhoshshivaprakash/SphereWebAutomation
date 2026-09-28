/**
 * The live competency list, shared by the interactive runners.
 *
 * On Sphere a competency is NOT its own primaryCategory — each level is stored
 * as a "Course" carrying `competency: true` (that is also why the course picker
 * filters those out). So one competency title usually comes back several times,
 * once per level; we group by name and count the levels.
 *
 * Cached per host for a day, like the course list.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cacheFile = (apiOrigin) =>
  resolve(ROOT, '.cache', `competencies-${new URL(apiOrigin).hostname}.json`);

/** Every Live competency on `apiOrigin`, one entry per title, sorted by name. */
export async function fetchCompetencies(apiOrigin) {
  const byName = new Map(); // name → { name, levels, identifiers[] }
  const PAGE = 200;
  for (let offset = 0; offset < 4000; offset += PAGE) {
    const res = await fetch(`${apiOrigin}/api/content/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          filters: { primaryCategory: ['Course'], status: ['Live'], competency: true },
          fields: ['name', 'identifier', 'competencies_v1'],
          sort_by: { name: 'asc' },
          limit: PAGE,
          offset,
        },
      }),
    });
    if (!res.ok) throw new Error(`search API returned HTTP ${res.status}`);
    const body = await res.json();
    const batch = body?.result?.content ?? [];
    for (const c of batch) {
      const name = String(c.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const entry = byName.get(name) ?? { name, levels: 0, identifiers: [] };
      entry.levels += 1;
      entry.identifiers.push(c.identifier);
      byName.set(name, entry);
    }
    const total = body?.result?.count ?? 0;
    if (!batch.length || offset + PAGE >= total) break;
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The competency list for `apiOrigin`, from the day-old cache when possible. */
export async function loadCompetencies(apiOrigin, { refresh = false, print = console.log } = {}) {
  const file = cacheFile(apiOrigin);
  const host = new URL(apiOrigin).hostname;

  if (!refresh && existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf-8'));
      if (Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS && cached.competencies?.length) {
        print(`🧗 ${cached.competencies.length} competencies on ${host} (cached — use --refresh to re-fetch)`);
        return cached.competencies;
      }
    } catch (e) {
      /* fall through to a live fetch */
    }
  }

  print(`🧗 Fetching the live competency list from ${apiOrigin} … `);
  try {
    const competencies = await fetchCompetencies(apiOrigin);
    print(`${competencies.length} found`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), competencies }, null, 2));
    return competencies;
  } catch (e) {
    print(`failed (${e.message})`);
    if (existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, 'utf-8'));
      print(`   Falling back to the cached list (${cached.competencies.length}).`);
      return cached.competencies;
    }
    return [];
  }
}
