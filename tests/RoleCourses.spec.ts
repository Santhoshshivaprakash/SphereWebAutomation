/**
 * Role → courses
 * ──────────────────────────────────────────────────────────────────
 * Switches ONE user through every Designation (Account → Organization Details),
 * saving each, and checks that the courses offered follow the role:
 *
 *   1. select the designation, fill any field it requires (e.g. RN/RM), Save
 *   2. reload the tab and confirm the designation actually SAVED
 *   3. read My Courses → "For You" (count + titles) and the home-page course cards
 *   4. finally: print a role-by-role table and FAIL if every role got the same
 *      For You list — that would mean the role is not being applied at all
 *
 * The designation field holds ONE role at a time, so roles are applied one after
 * another rather than all at once.
 *
 * Runs as the last SIGNED-UP user (USE_FRESH_USER=1) — never the shared .env
 * account, because changing that account's role breaks the other signed-in specs
 * (Competency needs it to stay ANM/MPW). The user is left on ANM/MPW at the end.
 *
 *   USE_FRESH_USER=1 npx playwright test tests/RoleCourses.spec.ts --project=Chrome
 *   ROLES="Doctors,ANM/MPW"   limit to some roles (default: all ten)
 *
 * Output: test-reports/role-courses/role-courses_<timestamp>.json
 */
import { test, expect } from './helpers/authedTest';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// Every designation the dropdown offered on prod (2026-09-30), minus the placeholder.
const ALL_ROLES = [
  'Midwives', 'GNM', 'Doctors', 'Public Health Professionals', 'Paramedical',
  'Pharmacist', 'Community Health Officer (CHO)', 'BSC Nurse', 'ANM/MPW', 'Others',
];
const ROLES = process.env.ROLES
  ? process.env.ROLES.split(',').map((r) => r.trim()).filter(Boolean)
  : ALL_ROLES;
// The role the user is left on — Competency / CompleteCompetency need ANM/MPW.
const RESTORE_ROLE = 'ANM/MPW';

type RoleResult = { role: string; saved: string; forYouCount: number | null; forYou: string[]; home: string[] };
const results: RoleResult[] = [];

const exact = (s: string) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

/** Account → Organization Details, via the header (a direct URL renders the Account route blank). */
async function openOrgTab(page: Page) {
  await page.goto(`${BASE_URL}/page/home`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^account$/i }).or(page.getByText(/^account$/i)).first()
    .click({ timeout: 30_000 });
  await page.getByText(/^organization details$/i).first().click({ timeout: 30_000 });
  // The three dropdowns: Background, Designation, Organisation type.
  await page.locator('mat-select').nth(1).waitFor({ state: 'visible', timeout: 30_000 });
}

const designationSelect = (page: Page) => page.locator('mat-select').nth(1);

/** Choose a designation, fill whatever it requires, and Save. */
async function saveDesignation(page: Page, role: string) {
  await openOrgTab(page);
  await designationSelect(page).click();
  await page.locator('mat-option, [role="option"]').filter({ hasText: exact(role) }).first()
    .click({ timeout: 15_000 });
  // The choice must be showing in the field before Save — otherwise Save sends the old role.
  await expect(designationSelect(page), `dropdown should show ${role} before saving`).toHaveText(exact(role), { timeout: 10_000 });
  // Some roles add fields (RN/RM number for nursing roles). Fill any empty text box
  // in the form so Save isn't blocked by a required field.
  const inputs = page.locator('input[type="text"]:visible, input:not([type]):visible');
  for (let i = 0; i < (await inputs.count()); i++) {
    const box = inputs.nth(i);
    const placeholder = ((await box.getAttribute('placeholder')) || '').toLowerCase();
    if (/search|learn today/.test(placeholder)) continue; // the header search box
    if (!(await box.inputValue().catch(() => 'x'))) {
      await box.fill(/number|rn|rm|reg/i.test(placeholder) ? '1234' : 'Aastrika');
    }
  }
  const save = page.getByRole('button', { name: /^save$/i });
  await expect(save, `Save should be enabled for ${role}`).toBeEnabled({ timeout: 10_000 });
  // Wait for the server to answer the save itself, not a fixed pause — a slow
  // response used to be cut off by the reload, and the old role stayed saved.
  const saved = page.waitForResponse(
    (r) => r.request().method() !== 'GET' && /update|profile|user/i.test(r.url()),
    { timeout: 20_000 },
  ).catch(() => null);
  await save.click();
  await saved;
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** Titles of the course cards on the current page (home and For You share one card component). */
async function cardTitles(page: Page): Promise<string[]> {
  await page.locator('ws-web-course-card p.name').first()
    .waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  const t = await page.locator('ws-web-course-card p.name').allInnerTexts();
  return [...new Set(t.map((s) => s.trim()).filter(Boolean))];
}

async function readForYou(page: Page): Promise<{ count: number | null; titles: string[] }> {
  await page.goto(`${BASE_URL}/app/user/my_courses`, { waitUntil: 'domcontentloaded' });
  const tab = page.getByText(/^for you/i).first();
  await tab.waitFor({ state: 'visible', timeout: 30_000 });
  // "For You (10)" → 10
  const m = (await tab.innerText()).match(/\((\d+)\)/);
  await tab.click();
  await page.waitForTimeout(1_500);
  return { count: m ? Number(m[1]) : null, titles: await cardTitles(page) };
}

async function readHome(page: Page): Promise<string[]> {
  await page.goto(`${BASE_URL}/page/home`, { waitUntil: 'domcontentloaded' });
  return cardTitles(page);
}

test.describe.serial('Role → courses (one user, every designation)', () => {
  let page: Page;

  test.beforeAll(async ({ authContext }) => {
    page = await authContext.newPage();
  });

  for (const role of ROLES) {
    test(`Role: ${role}`, async () => {
      // Save, then reload the tab and read the dropdown back. A save that didn't
      // stick is retried (up to 3 attempts) before it counts as a failure.
      let saved = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        await saveDesignation(page, role);
        await openOrgTab(page);
        saved = (await designationSelect(page).innerText()).trim();
        if (exact(role).test(saved)) break;
        console.log(`   ↻ ${role}: still shows "${saved}" after saving (attempt ${attempt}/3) — saving again`);
      }
      console.log(`\n👤 ${role} — saved designation: "${saved}"`);
      expect(saved, `designation should be saved as ${role}`).toMatch(exact(role));

      const forYou = await readForYou(page);
      const home = await readHome(page);
      results.push({ role, saved, forYouCount: forYou.count, forYou: forYou.titles, home });

      console.log(`   📚 For You (${forYou.count ?? '?'}): ${forYou.titles.join(' | ') || '—'}`);
      console.log(`   🏠 Home cards (${home.length}): ${home.join(' | ') || '—'}`);
      // Soft: a role with no suggestions is reported, not fatal, so the loop continues.
      expect.soft(forYou.count ?? forYou.titles.length, `For You should offer courses for ${role}`).toBeGreaterThan(0);
    });
  }

  test('Courses follow the role (summary)', async () => {
    const outDir = path.join(process.cwd(), 'test-reports', 'role-courses');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
    fs.writeFileSync(path.join(outDir, `role-courses_${stamp}.json`), JSON.stringify(results, null, 2));

    console.log('\n══ Role → For You courses ══');
    console.table(results.map((r) => ({ role: r.role, saved: r.saved, forYou: r.forYouCount, home: r.home.length })));
    // Which titles are unique to one role — the clearest evidence of role targeting.
    for (const r of results) {
      const others = new Set(results.filter((o) => o !== r).flatMap((o) => o.forYou));
      const only = r.forYou.filter((t) => !others.has(t));
      if (only.length) console.log(`   ⭐ only for ${r.role}: ${only.join(' | ')}`);
    }

    // The point of the check: if EVERY role got the identical For You list, the
    // designation is not driving the suggestions.
    if (results.length >= 2) {
      const distinct = new Set(results.map((r) => [...r.forYou].sort().join('\n')));
      expect(distinct.size, 'For You should differ between roles — identical for every role means the role is ignored')
        .toBeGreaterThan(1);
    }
  });

  // Leave the user on ANM/MPW so the competency runners (which need it) still work.
  test.afterAll(async () => {
    if (!page || ROLES[ROLES.length - 1] === RESTORE_ROLE) return;
    await saveDesignation(page, RESTORE_ROLE).catch((e) => console.log(`⚠️  could not restore ${RESTORE_ROLE}: ${e.message}`));
  });
});
