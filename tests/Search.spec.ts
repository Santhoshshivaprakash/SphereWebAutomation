/**
 * Search — results, not just the search box
 * ──────────────────────────────────────────
 * The Home spec only checks that the header search box takes text. This spec
 * checks what search actually RETURNS, by comparing the results page with the
 * search API the page itself calls (POST /apis/public/v8/publicSearch/getCourses):
 *
 *   - the "Showing N results" count, the cards on screen and the API agree;
 *   - a result opens the right course;
 *   - a course seen on the home page can be found by its title;
 *   - Hindi search terms work;
 *   - search ignores upper/lower case;
 *   - the language filter only leaves courses in that language;
 *   - a nonsense term shows the "No result" screen, and "Clear search results"
 *     gets the user out of it;
 *   - a search link opened directly still shows its results.
 *
 * Runs on any environment (BASE_URL) with the usual logged-in session
 * (helpers/authedTest).
 */
import { Page, Response } from '@playwright/test';
import { test, expect } from './helpers/authedTest';
import { hiAlso } from './helpers/i18n';

const BASE_URL = (process.env.BASE_URL ?? 'https://sphere.aastrika.org').replace(/\/+$/, '');
const HOME_URL = `${BASE_URL}/page/home`;
const SEARCH_URL = `${BASE_URL}/app/search/learning`;

// Terms that have stable results on every environment. Override with
// SEARCH_TERM / SEARCH_TERM_HI if content changes.
const TERM = process.env.SEARCH_TERM || 'maternal';
const TERM_HI = process.env.SEARCH_TERM_HI || 'पोस्टपार्टम';
const NONSENSE = 'zzqxvplk';

const SEARCH_API = /\/apis\/public\/v8\/publicSearch\/getCourses/;

type ApiCourse = { identifier: string; name: string; lang?: string };

// ── locators ────────────────────────────────────────────────────────────
const searchBox = (page: Page) => page.getByPlaceholder(/what do you want to learn today|आप आज क्या सीखना चाहते हैं/i).first();
const cards = (page: Page) => page.locator('ws-app-learning-card');
const cardTitles = (page: Page) => page.locator('ws-app-learning-card a.mat-title');
const resultLine = (page: Page) => page.locator('.withFilter').first();
const langFilter = (page: Page) => page.locator('select.lang-select').first();
const noResult = (page: Page) => page.getByText(hiAlso(/^\s*No result\s*$/i)).first();

/** Wait for the search API call made for `term`, and return the courses it sent back. */
function searchResponse(page: Page, term: string): Promise<ApiCourse[]> {
  return page
    .waitForResponse(
      (r: Response) => SEARCH_API.test(r.url()) && r.request().method() === 'POST'
        && (r.request().postDataJSON()?.request?.query ?? '').toLowerCase() === term.toLowerCase(),
      { timeout: 30_000 },
    )
    .then(async (r) => ((await r.json())?.result?.content ?? []) as ApiCourse[]);
}

/** Type a term into the header search and press Enter. Returns the API's results. */
async function searchFor(page: Page, term: string): Promise<ApiCourse[]> {
  await page.goto(HOME_URL);
  await page.waitForLoadState('networkidle').catch(() => {});
  const box = searchBox(page);
  await box.waitFor({ state: 'visible', timeout: 30_000 });
  const api = searchResponse(page, term);
  await box.fill(term);
  await box.press('Enter');
  const courses = await api;
  await page.waitForURL(/\/app\/search\/learning/, { timeout: 20_000 });
  await settle(page);
  return courses;
}

/** Wait until the results page has painted either cards or the No-result screen. */
async function settle(page: Page) {
  await expect(cards(page).first().or(noResult(page))).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800); // let the rest of the cards render
}

/** The number in "Showing N results". */
async function shownCount(page: Page): Promise<number> {
  const text = (await resultLine(page).innerText()).replace(/\s+/g, ' ');
  // "Showing 11 results" / "दिखा रहे हैं 11 परिणाम" — the first number, either language.
  const m = text.match(/(\d+)/);
  if (!m) throw new Error(`No "Showing N results" line — got: "${text}"`);
  return Number(m[1]);
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

test.describe('Search — results', () => {
  test('header search opens the results page for the term', async ({ page }) => {
    await searchFor(page, TERM);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/app/search/learning');
    expect(url.searchParams.get('q')).toBe(TERM);
    await expect(resultLine(page)).toBeVisible();
    console.log(`✅ "${TERM}" → ${page.url()}`);
  });

  test('result count, cards on screen and the search API all agree', async ({ page }) => {
    const api = await searchFor(page, TERM);
    expect(api.length, `the API should find courses for "${TERM}"`).toBeGreaterThan(0);

    const count = await shownCount(page);
    const onScreen = (await cardTitles(page).allInnerTexts()).map(norm);
    console.log(`   API ${api.length} · "Showing ${count}" · ${onScreen.length} cards`);

    expect(count, '"Showing N results" should match the API').toBe(api.length);
    expect(onScreen.length, 'one card per result').toBe(api.length);
    const apiNames = new Set(api.map((c) => norm(c.name)));
    const unexpected = onScreen.filter((t) => !apiNames.has(t));
    expect(unexpected, 'every card should be a course the API returned').toEqual([]);
    console.log('✅ count, cards and API match');
  });

  test('clicking a result opens that course', async ({ page }) => {
    await searchFor(page, TERM);
    const title = norm(await cardTitles(page).first().innerText());
    await cardTitles(page).first().click();
    await page.waitForURL(/\/app\/toc\/do_/, { timeout: 30_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect
      .poll(async () => norm(await page.locator('body').innerText()).includes(title), {
        timeout: 20_000,
        message: `course page should show the title "${title}"`,
      })
      .toBe(true);
    console.log(`✅ "${title}" → ${page.url()}`);
  });

  test('a course from the home page can be found by its title', async ({ page }) => {
    await page.goto(HOME_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    // Course cards on the home page carry their title in a title="" attribute.
    const titleAttr = page.locator('[title]').filter({ hasNot: page.locator('img') });
    const titles = (await titleAttr.evaluateAll((els) =>
      els.map((e) => e.getAttribute('title') || '').filter((t) => t.length > 12 && t.length < 90)));
    test.skip(!titles.length, 'no course titles on the home page to search for');
    const wanted = titles[0];

    const api = await searchFor(page, wanted);
    const onScreen = (await cardTitles(page).allInnerTexts()).map(norm);
    expect(api.map((c) => norm(c.name)), 'API should return the course').toContain(norm(wanted));
    expect(onScreen, 'the course should be in the results').toContain(norm(wanted));
    console.log(`✅ found "${wanted}"`);
  });

  test('Hindi search terms find Hindi courses', async ({ page }) => {
    const api = await searchFor(page, TERM_HI);
    expect(api.length, `the API should find courses for "${TERM_HI}"`).toBeGreaterThan(0);
    const onScreen = await cardTitles(page).allInnerTexts();
    expect(onScreen.length).toBe(api.length);
    expect(onScreen.some((t) => t.includes(TERM_HI)), `a result title should contain "${TERM_HI}"`).toBe(true);
    console.log(`✅ "${TERM_HI}" → ${onScreen.join(' / ')}`);
  });

  test('search ignores upper/lower case', async ({ page }) => {
    const lower = await searchFor(page, TERM.toLowerCase());
    const upper = await searchFor(page, TERM.toUpperCase());
    expect(upper.map((c) => c.identifier).sort()).toEqual(lower.map((c) => c.identifier).sort());
    expect(await shownCount(page)).toBe(lower.length);
    console.log(`✅ "${TERM.toLowerCase()}" and "${TERM.toUpperCase()}" both give ${lower.length}`);
  });

  test('language filter leaves only courses in that language', async ({ page }) => {
    // The course's language lives in `lang` ("hi"/"en"). The older `language`
    // field says "English" even on Hindi courses, so it can't be used here.
    const api = await searchFor(page, TERM);
    let shownTotal = 0;

    for (const [code, name] of [['hi', 'Hindi'], ['en', 'English']] as const) {
      const expected = api.filter((c) => norm(String(c.lang ?? '')) === code).map((c) => norm(c.name)).sort();
      await langFilter(page).selectOption(code);
      await page.waitForURL(new RegExp(`[?&]lang=${code}`), { timeout: 20_000 });
      await settle(page);
      const onScreen = (await cardTitles(page).allInnerTexts()).map(norm).sort();
      console.log(`   ${name}: ${onScreen.length} shown · ${expected.length} of ${api.length} results are ${name}`);
      expect(onScreen, `the ${name} filter should show exactly the ${name} courses`).toEqual(expected);
      shownTotal += onScreen.length;
    }
    expect(shownTotal, 'Hindi + English should add up to all results').toBe(api.length);
    console.log('✅ language filter shows exactly the courses in that language');
  });

  test('nonsense term shows "No result", and Clear search results gets out of it', async ({ page }) => {
    const api = await searchFor(page, NONSENSE);
    expect(api.length).toBe(0);
    await expect(noResult(page)).toBeVisible();
    await expect(page.getByText(hiAlso(/different keywords/i)).first()).toBeVisible();
    await expect(cards(page)).toHaveCount(0);

    // "Clear search results" is a label; the clickable part is the restore (↺) icon beside it.
    await page.locator('h4', { hasText: hiAlso(/clear search results/i) }).locator('button').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(noResult(page), 'the No-result screen should go away').toBeHidden({ timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('q') ?? '', 'the search term should be cleared').not.toBe(NONSENSE);
    console.log(`✅ cleared → ${page.url()}`);
  });

  test('a search link opened directly shows its results', async ({ page }) => {
    const api = searchResponse(page, TERM);
    await page.goto(`${SEARCH_URL}?q=${encodeURIComponent(TERM)}`);
    const courses = await api;
    await settle(page);
    expect(await shownCount(page)).toBe(courses.length);
    expect(await cardTitles(page).count()).toBe(courses.length);
    console.log(`✅ direct link shows ${courses.length} results`);
  });
});
