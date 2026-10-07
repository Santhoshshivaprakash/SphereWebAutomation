/**
 * Certificates — real certificates, not the empty state
 * ─────────────────────────────────────────────────────
 * Account → My Certificates for a user who HAS certificates (the empty state is
 * covered in Account.spec). Checked against the portal's own data:
 *
 *   GET  …/rcCert/user/enrollment/list/adhocCertificates  → courses + issuedCertificates
 *   GET  …/certreg/v2/certs/download/<certificate id>     → the certificate as SVG
 *
 *   - one card on My Certificates per issued certificate;
 *   - every certificate image loads, and prints a learner name and the issue
 *     date (and, where the template prints it, the course name);
 *   - the download button saves a real JPG named after the certificate.
 *
 * Needs an account with at least one issued certificate — on production the
 * TEST_USER has several; in the "run all" journey it is the user who just
 * finished a course. Skips cleanly when the account has none.
 *
 * "[NA]" printed on a certificate (an empty field on the template) is noted in
 * the report, not failed.
 */
import { Page } from '@playwright/test';
import { test, expect } from './helpers/authedTest';
import * as fs from 'fs';
import { hiAlso } from './helpers/i18n';

const BASE_URL = (process.env.BASE_URL ?? 'https://sphere.aastrika.org').replace(/\/+$/, '');

type Issued = { name: string; identifier: string; lastIssuedOn: string; token?: string };
type CertCourse = { courseName?: string; content?: { name?: string }; issuedCertificates?: Issued[] };
type Cert = Issued & { course: string };

/** Open My Certificates and collect the list + every certificate SVG the page fetches. */
async function openMyCertificates(page: Page): Promise<{ certs: Cert[]; svgs: Map<string, string> }> {
  const svgs = new Map<string, string>();
  page.on('response', async (r) => {
    if (!/\/certreg\/v2\/certs\/download\//.test(r.url())) return;
    const j = await r.json().catch(() => null);
    const uri: string | undefined = j?.result?.printUri;
    if (!uri) return;
    const raw = uri.replace(/^data:image\/svg\+xml,/, '');
    // Some certificates contain a stray "%" that is not an escape — decode
    // what can be decoded rather than throwing "URI malformed".
    let svg: string;
    try { svg = decodeURIComponent(raw); } catch { svg = raw.replace(/%[0-9A-F]{2}/gi, (m) => { try { return decodeURIComponent(m); } catch { return m; } }); }
    svgs.set(r.url().split('/').pop()!.split('?')[0], svg);
  });
  const listResp = page.waitForResponse((r) => /adhocCertificates/.test(r.url()), { timeout: 60_000 });

  await page.goto(`${BASE_URL}/app/profile-view`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByText(hiAlso(/^\s*my certificates\s*$/i)).first().click();
  const list = await (await listResp).json();
  await page.waitForLoadState('networkidle').catch(() => {});

  const courses: CertCourse[] = [...(list.generalCertificates ?? []), ...(list.sunbirdRcCertificates ?? [])];
  const certs = courses.flatMap((c) => (c.issuedCertificates ?? []).map((i) => ({ ...i, course: (c.courseName || c.content?.name || '').trim() })));
  return { certs, svgs };
}

/** The visible text lines of a certificate SVG. */
const svgTexts = (svg: string) =>
  [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);

/** "2026-07-03T13:16:52.815+0000" → the same day as printed ("03 July 2026"), allowing ±1 day for time zones. */
function printedDates(iso: string): string[] {
  const d = new Date(iso.replace(/\+0000$/, 'Z'));
  return [-1, 0, 1].map((off) => {
    const x = new Date(d.getTime() + off * 86_400_000);
    return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  });
}

// A slot that actually shows a certificate (has an image). Not by alt text —
// the image's label differs between builds/languages.
const cards = (page: Page) => page.locator('ws-certificate-received').filter({ has: page.locator('img:not([src*="download"])') });

test.describe('My Certificates — real certificates', () => {

  test('My Certificates shows one card per issued certificate', async ({ page }) => {
    const { certs } = await openMyCertificates(page);
    test.skip(!certs.length, 'this account has no issued certificates yet');
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    // Known defect (Oct 2026): the page creates one slot per certificate but only
    // ONE renders; the rest stay blank. This check fails until that is fixed.
    const slots = await page.locator('ws-certificate-received').count();
    console.log(`   ${certs.length} issued · ${slots} slots on the page · ${await cards(page).count()} actually showing a certificate`);
    await expect(cards(page)).toHaveCount(certs.length, { timeout: 30_000 });
    console.log(`✅ ${certs.length} certificates issued, ${certs.length} cards shown:`);
    for (const c of certs) console.log(`   • ${c.course} — "${c.name}" (${c.lastIssuedOn.slice(0, 10)})`);
  });

  test('every certificate prints a name and a date', async ({ page }) => {
    const { certs, svgs } = await openMyCertificates(page);
    test.skip(!certs.length, 'this account has no issued certificates yet');
    // The page fetches the images as the cards render — wait for all of them.
    await expect.poll(() => svgs.size, { timeout: 60_000, message: 'every certificate image should load' }).toBeGreaterThanOrEqual(certs.length);

    const problems: string[] = [];
    const withNA: string[] = [];
    const otherDate: string[] = [];
    for (const c of certs) {
      const svg = svgs.get(c.identifier);
      if (!svg) { problems.push(`${c.course}: certificate ${c.identifier} did not load`); continue; }
      const texts = svgTexts(svg);
      const dates = printedDates(c.lastIssuedOn);
      const printedDate = texts.find((t) => /^\d{1,2} [A-Za-z]+ \d{4}$/.test(t));
      // A re-issued certificate keeps its ORIGINAL date — fine, but note it.
      if (printedDate && !dates.includes(printedDate)) otherDate.push(`${c.course} "${c.name}": prints ${printedDate}, latest issue ${dates[1]}`);
      // The learner's name is the first text line that isn't the date, "[NA]", a number or the course.
      const name = texts.find((t) => t !== printedDate && !/^\[NA\]$|^\d+$/.test(t) && t !== c.course);
      const coursePrinted = texts.includes(c.course);
      if (!name) problems.push(`${c.course}: no learner name printed (${JSON.stringify(texts)})`);
      if (!printedDate) problems.push(`${c.course}: no date printed (${JSON.stringify(texts)})`);
      if (texts.includes('[NA]')) withNA.push(c.course);
      console.log(`   • ${c.course}: name "${name ?? '—'}", date ${printedDate ?? 'MISSING'}${coursePrinted ? ', course name printed' : ''}${texts.includes('[NA]') ? ', shows [NA]' : ''}`);
    }
    if (otherDate.length) {
      test.info().annotations.push({ type: 'note', description: `printed date differs from the latest issue date (re-issued): ${otherDate.join('; ')}` });
    }
    if (withNA.length) {
      test.info().annotations.push({ type: 'note', description: `"[NA]" printed on ${withNA.length} of ${certs.length} certificates: ${withNA.join('; ')}` });
    }
    expect(problems, 'certificate content problems').toEqual([]);
    console.log(`✅ all ${certs.length} certificates print a name and a date`);
  });

  test('the download button saves the certificate as a JPG', async ({ page }) => {
    const { certs } = await openMyCertificates(page);
    test.skip(!certs.length, 'this account has no issued certificates yet');
    const card = cards(page).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const button = card.locator('img[src*="download_cer"], [class*="download"], mat-icon:has-text("download")').first();

    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), button.click()]);
    const file = download.suggestedFilename();
    const bytes = fs.readFileSync(await download.path());
    console.log(`   saved ${file} (${Math.round(bytes.length / 1024)} KB)`);

    expect(file).toMatch(/_certificate\.jpe?g$/i);
    const squash = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
    // Named after the certificate template on production, after the course on UAT — accept either.
    const names = certs.flatMap((c) => [squash(c.name), squash(c.course)]);
    expect(names, 'file name should be one of the issued certificates or their courses').toContain(squash(file.replace(/_certificate\.jpe?g$/i, '')));
    expect(bytes.length, 'the file should not be empty').toBeGreaterThan(10_000);
    expect(bytes.subarray(0, 3).toString('hex'), 'should be a real JPEG').toBe('ffd8ff');
    console.log(`✅ downloaded a real JPG: ${file}`);
  });
});
