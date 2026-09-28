/**
 * The course search-and-choose prompt, kept separate so it can be exercised
 * with scripted input (see scripts/lib/course-picker.test.mjs).
 *
 * Flow: search for a keyword → the matches are listed and numbered → choose
 * one or several from that list.
 *
 * @param {object} opts
 * @param {{name: string}[]} opts.courses  the catalogue to choose from
 * @param {(q: string) => Promise<string>} opts.ask   prompt for one line of input
 * @param {(s: string) => void} [opts.print]          output sink (defaults to console.log)
 * @param {string} [opts.where]                       hostname shown in the header
 * @param {number} [opts.pageSize]
 * @returns {Promise<string[]>} the chosen course names
 */
export async function chooseCourses({ courses, ask, print = console.log, where = '', pageSize = 30, describe, noun = 'course', nounPlural = 'courses' }) {
  // How each row is shown. Callers can enrich it (e.g. a competency's level
  // count) without changing what gets returned — always the plain name.
  const label = describe ?? ((c) => c.name);
  let filter = '';
  let matches = courses;
  let shown = [];
  let showAll = false;

  const show = () => {
    shown = showAll ? matches : matches.slice(0, pageSize);
    if (!matches.length) {
      print(`\n  ✖ No ${noun} matches "${filter}" — try a shorter keyword.`);
      return;
    }
    print(
      `\n🎓 ${matches.length} ${matches.length === 1 ? noun : nounPlural}` +
        `${filter ? ` matching "${filter}"` : ''} — choose from the list:\n`,
    );
    shown.forEach((c, i) => print(`  ${String(i + 1).padStart(3)}. ${label(c)}`));
    if (matches.length > shown.length) {
      print(`\n  … and ${matches.length - shown.length} more — narrow the search, or type "more" to list them all.`);
    }
  };

  /** Apply a search term and print the numbered hits to choose from. */
  const search = (term) => {
    filter = (term ?? '').trim();
    showAll = false;
    matches = filter
      ? courses.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()))
      : courses;
    show();
  };

  // Step 1 — search. Step 2 — choose from what came back.
  print(`\n🔎 ${courses.length} ${nounPlural} available${where ? ` on ${where}` : ''}.`);
  search(await ask(`\n  Search for a ${noun} (keyword, or Enter to list all) : `));

  for (;;) {
    if (!matches.length) { search(await ask('\n  Search again : ')); continue; }

    const only = shown.length === 1 ? ` — Enter picks "${shown[0].name}"` : '';
    const sel = await ask(
      `\n  👉 Choose number(s) e.g. 3 or 1,4,7${only}` +
        `\n     (or type a new keyword to search  ·  "more"  ·  "all" to run every match) : `,
    );

    // Enter: accept a lone result, otherwise just redisplay the list.
    if (!sel) {
      if (shown.length === 1) return [shown[0].name];
      show();
      continue;
    }

    if (sel.toLowerCase() === 'more') { showAll = true; show(); continue; }

    if (sel.toLowerCase() === 'all') {
      if (shown.length > 5) {
        const ok = await ask(`  Run all ${shown.length} listed ${nounPlural} one after another? (y/N) : `);
        if (!/^y/i.test(ok)) continue;
      }
      return shown.map((c) => c.name);
    }

    if (/^\d+(\s*,\s*\d+)*$/.test(sel)) {
      const picked = [];
      let bad = false;
      for (const part of sel.split(',')) {
        const n = Number(part.trim());
        if (n < 1 || n > shown.length) { print(`  ✖ ${n} is not in the list above.`); bad = true; break; }
        picked.push(shown[n - 1].name);
      }
      if (bad) continue;
      return picked;
    }

    // Anything else is a fresh search term.
    search(sel);
  }
}

/**
 * The two-step course prompt used by the interactive runners: paste a course
 * name outright, or browse/search the live catalogue for the environment.
 *
 * @param {object} opts
 * @param {string} opts.apiOrigin   environment whose catalogue to list
 * @param {(q: string) => Promise<string>} opts.ask
 * @param {(s: string) => void} [opts.print]
 * @param {boolean} [opts.refresh]  ignore the cached catalogue
 * @param {number} [opts.pageSize]
 * @returns {Promise<string[]>} the chosen course names
 */
export async function promptForCourses({ apiOrigin, ask, print = console.log, refresh = false, pageSize = 30 }) {
  const { loadCourses } = await import('./courses.mjs');
  const host = new URL(apiOrigin).hostname;

  print(`\n🎓 This spec needs a course (COURSE_NAME).\n`);
  print(`  1. Show me the courses on ${host} (search + pick)`);
  print(`  2. I'll paste the course name myself`);

  const how = await ask('\n  Number (Enter = 1) : ');
  const typeItIn = async (why = '') => {
    if (why) print(why);
    const typed = await ask('\n  Course name : ');
    if (!typed) { console.error('No course given.'); process.exit(1); }
    return [typed];
  };

  if (how === '2') return typeItIn();

  const courses = await loadCourses(apiOrigin, { refresh, print });
  if (!courses.length) return typeItIn('\n  ✖ Could not load the course list.');

  return chooseCourses({ courses, ask, print, where: host, pageSize });
}

/**
 * The same two-step prompt for COMPETENCIES: paste a title, or search the live
 * list for the environment. Each entry shows how many levels it has.
 *
 * @param {object} opts
 * @param {string} opts.apiOrigin
 * @param {(q: string) => Promise<string>} opts.ask
 * @param {(s: string) => void} [opts.print]
 * @param {boolean} [opts.refresh]
 * @param {number} [opts.pageSize]
 * @param {boolean} [opts.optional]  allow "skip" (the spec picks one itself)
 * @returns {Promise<string[]>} the chosen competency titles ([] when skipped)
 */
export async function promptForCompetencies({
  apiOrigin, ask, print = console.log, refresh = false, pageSize = 30, optional = false,
}) {
  const { loadCompetencies } = await import('./competencies.mjs');
  const { myCompetencies } = await import('./my-competencies.mjs');
  const host = new URL(apiOrigin).hostname;

  // What THIS account can assess. The whole catalogue is much bigger, and a
  // competency that is not on the account's dashboard has no card to click —
  // the spec then either gives up or (Competency.spec.ts with no name) opens
  // whichever competency happens to be first.
  const mine = await myCompetencies(apiOrigin, { refresh, print }).catch(() => null);

  print(`\n🧗 This spec needs a competency (COMPETENCY_NAME).\n`);
  const options = [];
  if (mine?.all?.length) {
    options.push('mine');
    print(`  ${options.length}. Competencies on ${mine.email}'s dashboard (${mine.all.length}) — these are the ones the spec can open`);
  }
  options.push('all');
  print(`  ${options.length}. Every competency published on ${host} (the full catalogue)`);
  options.push('type');
  print(`  ${options.length}. I'll paste the competency name myself`);
  if (optional) {
    options.push('skip');
    print(`  ${options.length}. Skip — ⚠️  the spec then opens the FIRST card on the dashboard, whichever competency that is`);
  }

  const answer = await ask(`\n  Number (Enter = 1) : `);
  const choice = options[(Number(answer) || 1) - 1] ?? options[0];
  if (choice === 'skip') return [];

  const typeItIn = async (why = '') => {
    if (why) print(why);
    const typed = await ask('\n  Competency name : ');
    if (!typed) {
      if (optional) return [];
      console.error('No competency given.');
      process.exit(1);
    }
    return warnIfUnassigned([typed]);
  };

  /** Flag a pick the signed-in account cannot actually assess. */
  const warnIfUnassigned = (names) => {
    if (!mine?.all?.length) return names;
    const lower = mine.all.map((n) => n.toLowerCase());
    const strays = names.filter((n) => !lower.includes(n.toLowerCase()));
    if (strays.length) {
      print(`\n  ⚠️  Not on ${mine.email}'s dashboard: ${strays.map((s) => `"${s}"`).join(', ')}`);
      print('      The spec will not find a card for it — pick from that account\'s own list,');
      print('      or run as an account this competency is assigned to.');
    }
    return names;
  };

  if (choice === 'type') return typeItIn();

  if (choice === 'mine') {
    const list = mine.all.map((name) => ({
      name,
      where: mine.required.includes(name) ? 'to assess' : 'in passbook',
    }));
    return chooseCourses({
      courses: list, ask, print, where: `${mine.email}'s dashboard`, pageSize,
      noun: 'competency', nounPlural: 'competencies',
      describe: (c) => `${c.name}   (${c.where})`,
    });
  }

  const list = await loadCompetencies(apiOrigin, { refresh, print });
  if (!list.length) return typeItIn('\n  ✖ Could not load the competency list.');

  const chosen = await chooseCourses({
    courses: list, ask, print, where: host, pageSize,
    noun: 'competency', nounPlural: 'competencies',
    describe: (c) => {
      const assigned = mine?.all?.some((n) => n.toLowerCase() === c.name.toLowerCase());
      const levels = c.levels > 1 ? `   [${c.levels} levels]` : '';
      return `${c.name}${levels}${mine ? (assigned ? '   ✓ on your dashboard' : '') : ''}`;
    },
  });
  return warnIfUnassigned(chosen);
}
