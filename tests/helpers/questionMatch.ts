/**
 * Answer-key question matching — shared by every quiz-answering spec.
 * ──────────────────────────────────────────────────────────────────────
 * Maps the question currently on screen to its entry in the published
 * answer-key bank (the S3 quiz.json), so the correct options can be picked.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Sphere renders case-study assessments as several questions that all share
 * one long case description:
 *
 *   "CASE: 1 Description: A 20-year-old woman, pregnant for her first time …"
 *
 * When the player shows only that description (the actual question sentence
 * lives in a sibling element the scrape can miss), the stem is IDENTICAL for
 * every question in the case. The old matcher took the first pool entry whose
 * text contained the scrape — so all five questions of CASE 1 resolved to the
 * SAME bank entry, and four of them got another question's answers applied.
 * Those four then fell through to the AI fallback, which was out of quota, and
 * every one of them defaulted to "A". The assessment could not reach its 75%
 * pass mark and the module never completed.
 *
 * THE RULE
 * ────────
 * Option sets are the reliable identity, not question text:
 *   - the bank carries every option verbatim,
 *   - Sphere shuffles option ORDER but not option TEXT,
 *   - two questions in one case study have different options even when they
 *     share a stem.
 *
 * So option-set overlap is tried FIRST, and a text match is trusted ONLY when
 * it resolves to exactly one bank entry. An ambiguous stem is disambiguated by
 * option overlap instead of silently taking the first candidate.
 */

/** Minimal structural shape — matches the local QuizQuestion in every spec. */
export interface MatchableQuestion {
  // The question stem, possibly containing HTML.
  question: string;
  // Its options, each with its own (possibly HTML) text.
  options: { text: string }[];
}

// Turn HTML into plain text so on-screen text and bank text can be compared like for like.
export function stripHtml(s: string): string {
  // String() guards against null/undefined. Then: drop tags, decode &nbsp;, collapse whitespace, trim.
  return String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Reduce text to a comparable form: lower-cased, punctuation flattened to single spaces.
export function normalizeText(s: string): string {
  // The । character is the Devanagari full stop — included so Hindi questions normalise too.
  return String(s ?? '').toLowerCase().replace(/[।?.,!\s]+/g, ' ').trim();
}

/** Minimum share of options that must line up before an overlap match is trusted. */
const OPTION_RATIO = 0.75;
/** Minimum absolute number of overlapping options — guards tiny option sets. */
const MIN_OVERLAP = 2;

// A scored candidate: the bank entry plus how well it fits the screen.
interface Ranked<T> { entry: T; overlap: number; ratio: number }

/** Rank every bank entry by how much of its option set appears on screen. */
function rankByOptionOverlap<T extends MatchableQuestion>(
  scrapedOptions: string[],
  pool: T[],
): Ranked<T>[] {
  // Normalise what's on screen into a Set — O(1) lookups, and duplicates collapse.
  const screen = new Set(scrapedOptions.map(normalizeText).filter((t) => t.length > 0));
  // Nothing usable on screen means we can't rank anything.
  if (screen.size === 0) return [];
  return pool
    // Score every bank entry.
    .map((entry) => {
      // Normalise this entry's options the same way.
      const poolOpts = entry.options.map((o) => normalizeText(stripHtml(o.text)));
      // How many of them appear on screen?
      const overlap = poolOpts.filter((o) => screen.has(o)).length;
      // Divide by the LARGER of the two sizes. Using the larger denominator stops a
      // 2-option entry scoring 100% against a 6-option screen.
      return { entry, overlap, ratio: overlap / Math.max(poolOpts.length, screen.size) };
    })
    // Best ratio first; ties broken by raw overlap count (|| falls through when the ratios are equal).
    .sort((a, b) => b.ratio - a.ratio || b.overlap - a.overlap);
}

/**
 * Find the bank entry for the question on screen.
 * Returns null when nothing clears the bar — a wrong match costs the pass mark,
 * so declining to answer from the key (and letting the caller fall back) is
 * always better than confidently applying another question's answers.
 */
export function findMatchingQuestion<T extends MatchableQuestion>(
  scrapedQuestion: string,
  scrapedOptions: string[],
  pool: T[],
): T | null {
  // No bank to search.
  if (!pool || pool.length === 0) return null;
  // Normalise the scraped stem once, up front.
  const normScrape = normalizeText(scrapedQuestion);

  // ── 1. Option-set overlap — the strongest signal, so it goes first. ──
  // Requires a CLEAR winner: a tie on ratio means two bank entries fit the
  // screen equally well, and picking either would be a guess.
  // Only bother ranking if we scraped enough options to be meaningful.
  const ranked = scrapedOptions.length >= MIN_OVERLAP
    ? rankByOptionOverlap(scrapedOptions, pool)
    : [];
  // The best-scoring candidate (undefined if the list is empty).
  const top = ranked[0];
  // It must clear BOTH bars: enough options in common, and a high enough proportion.
  if (top && top.overlap >= MIN_OVERLAP && top.ratio >= OPTION_RATIO) {
    // Is anything else scoring identically?
    const tied = ranked.filter((r) => r.ratio === top.ratio && r.overlap === top.overlap);
    // Accept ONLY an outright winner. A tie means we'd be guessing.
    if (tied.length === 1) return top.entry;
  }

  // ── 2. Exact stem match — trusted only when it is unambiguous. ──
  // Ignore very short stems; they match too loosely to mean anything.
  const exact = normScrape.length >= 5
    ? pool.filter((p) => normalizeText(stripHtml(p.question)) === normScrape)
    : [];
  // Exactly one hit is trustworthy. Two or more is the case-study trap — handled at step 4.
  if (exact.length === 1) return exact[0];

  // ── 3. Contains match — again, only when it resolves to one entry. ──
  // Needs a longer stem than the exact check, since substring matching is looser.
  const contains = normScrape.length >= 10
    ? pool.filter((p) => {
        // Normalise the bank entry's stem.
        const pq = normalizeText(stripHtml(p.question));
        // Match in EITHER direction: the scrape may be a truncated stem, or a stem plus extra text.
        return pq.length >= 10 && (pq.includes(normScrape) || normScrape.includes(pq));
      })
    : [];
  // Again, only an unambiguous single hit counts.
  if (contains.length === 1) return contains[0];

  // ── 4. Ambiguous stem (the case-study trap): several entries share this
  //       text, so break the tie on option overlap among those candidates
  //       only. This is the path that recovers the questions the old matcher
  //       silently mis-answered. ──
  // Prefer the exact-match candidates; fall back to the contains-match ones.
  const ambiguous = exact.length > 1 ? exact : contains;
  // Only worth doing when there really are several candidates and we have options to compare.
  if (ambiguous.length > 1 && scrapedOptions.length >= MIN_OVERLAP) {
    // Re-rank, but ONLY within the ambiguous set — a much smaller, fairer contest.
    const narrowed = rankByOptionOverlap(scrapedOptions, ambiguous);
    // The best of those.
    const best = narrowed[0];
    // A lower bar here (1 instead of MIN_OVERLAP): the stem already narrowed the field,
    // so a single matching option is enough to distinguish these siblings.
    if (best && best.overlap >= 1) {
      // Still require an outright winner.
      const tied = narrowed.filter((r) => r.overlap === best.overlap);
      if (tied.length === 1) return best.entry;
    }
  }

  // Nothing cleared the bar. Returning null lets the caller fall back to the AI or
  // to a default — far safer than applying another question's answers.
  return null;
}
