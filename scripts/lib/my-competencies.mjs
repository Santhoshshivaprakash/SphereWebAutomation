/**
 * The competencies THIS ACCOUNT can actually assess.
 *
 * The content API lists every competency on the platform (85 on staging), but a
 * learner can only assess the ones on their own Competency Dashboard — 9 for a
 * typical account, driven by their job description. Picking any of the other 76
 * leaves the spec with no card to click:
 *
 *   CompleteCompetency.spec.ts → "No card found containing …" → gives up
 *   Competency.spec.ts (no name) → clicks the FIRST Assess button on the page,
 *                                  which is some other competency entirely
 *
 * So this reads the dashboard itself — signed in, headless — and caches the
 * titles per environment + account.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { authState, credentialsFor } from './env-login.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // the dashboard changes rarely, but not never

const cacheFile = (baseUrl, email) =>
  resolve(ROOT, '.cache', `my-competencies-${new URL(baseUrl).hostname}-${email.replace(/[^a-z0-9]/gi, '_')}.json`);

/** Card titles on one dashboard tab. */
async function titlesOnTab(page, tab) {
  await page.getByText(new RegExp(`^${tab}$`, 'i')).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('mat-card, [class*="card" i]')]
      .map((c) => {
        const head = c.querySelector('h1,h2,h3,h4,[class*="title" i]') ?? c;
        return (head.innerText || '').trim().split('\n')[0].trim();
      })
      .filter((t) => t && t.length < 90));
  return [...new Set(titles)];
}

/**
 * @returns {Promise<{email:string, required:string[], passbook:string[], all:string[]}|null>}
 *          null when there are no credentials for this environment.
 */
export async function myCompetencies(baseUrl, { refresh = false, print = console.log } = {}) {
  const creds = credentialsFor(baseUrl);
  if (!creds) return null;

  const file = cacheFile(baseUrl, creds.email);
  if (!refresh && existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf-8'));
      if (Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS && cached.all?.length) {
        print(`🧗 ${cached.all.length} competencies assigned to ${creds.email} (cached)`);
        return cached;
      }
    } catch (e) {
      /* fall through and read the dashboard again */
    }
  }

  print(`🧗 Reading ${creds.email}'s competency dashboard on ${new URL(baseUrl).hostname} … `);
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ headless: true });
  try {
    const { state } = await authState(browser, baseUrl, creds.email, creds.password, { refresh, print: () => {} });
    const ctx = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${baseUrl}/app/user/competency`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3500);

    const required = await titlesOnTab(page, 'Required');
    const passbook = await titlesOnTab(page, 'Passbook');
    const all = [...new Set([...required, ...passbook])];

    const data = { fetchedAt: new Date().toISOString(), email: creds.email, required, passbook, all };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
    print(`${all.length} found (${required.length} to assess, ${passbook.length} already in the passbook)`);
    return data;
  } catch (e) {
    print(`could not read the dashboard (${String(e.message).slice(0, 120)})`);
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf-8'));
      } catch (err) {
        /* nothing usable cached */
      }
    }
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}
