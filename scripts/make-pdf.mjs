/**
 * Render a local HTML file to a print-quality PDF using Playwright's Chromium.
 *   node scripts/make-pdf.mjs docs/Sphere-Automation-Guide.html docs/Sphere-Automation-Guide.pdf
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , inArg, outArg, titleArg] = process.argv;
const inFile = path.resolve(inArg ?? 'docs/Sphere-Automation-Guide.html');
const outFile = path.resolve(outArg ?? 'docs/Sphere-Automation-Guide.pdf');

if (!fs.existsSync(inFile)) {
  console.error(`❌ HTML not found: ${inFile}`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(inFile).href, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
// Give web fonts a moment to load.
await page.waitForTimeout(1200);

await page.pdf({
  path: outFile,
  format: 'A4',
  printBackground: true,
  margin: { top: '14mm', bottom: '16mm', left: '0mm', right: '0mm' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;font-family:Lato,Arial,sans-serif;font-size:8pt;color:#7C8696;padding:0 16mm;">' +
    `<span style="float:left;">${titleArg ?? 'Sphere Web Automation — How We Built It'}</span>` +
    '<span style="float:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
    '</div>',
});

await browser.close();
const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log(`✅ PDF written: ${outFile} (${kb} KB)`);
