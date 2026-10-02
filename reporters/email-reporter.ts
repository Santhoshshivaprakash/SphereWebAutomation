/**
 * Email alert reporter for Playwright.
 * ──────────────────────────────────────────────────────────────────
 * Sends an email (SMTP) when a run has failures. Designed for the Layer 7
 * synthetic prod monitor, but harmless anywhere:
 *
 *   - No-op unless SMTP is configured (SMTP_HOST + ALERT_EMAIL_TO). Local/dev
 *     runs stay silent.
 *   - Only sends when at least one test FAILED / TIMED OUT (not on all-pass,
 *     not on skips) — so a green monitor makes no noise.
 *
 * Env:
 *   SMTP_HOST         e.g. smtp.gmail.com
 *   SMTP_PORT         465 (SSL) or 587 (STARTTLS). Default 587.
 *   SMTP_USER         SMTP username (usually the full email address)
 *   SMTP_PASS         SMTP password / app password
 *   ALERT_EMAIL_TO    recipient(s), comma-separated
 *   ALERT_EMAIL_FROM  from address (defaults to SMTP_USER)
 *
 * Usage in playwright.config.ts:
 *   reporter: [['list'], ['./reporters/email-reporter.ts']]
 */
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

interface Failure {
  title: string;
  error: string;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.ALERT_EMAIL_TO);
}

class EmailReporter implements Reporter {
  private failures: Failure[] = [];
  private passed = 0;
  private skipped = 0;

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'passed') {
      this.passed++;
    } else if (result.status === 'skipped') {
      this.skipped++;
    } else {
      const err = (result.error?.message ?? 'no error message')
        .replace(/\[[0-9;]*m/g, '') // strip ANSI colour codes
        .split('\n')[0]
        .slice(0, 400);
      this.failures.push({ title: test.titlePath().slice(1).join(' › '), error: err });
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!smtpConfigured()) return; // alerting disabled
    if (this.failures.length === 0) return; // green run — stay silent

    const env = process.env.BASE_URL ?? 'https://sphere.aastrika.org';
    const when = new Date().toISOString();
    const to = process.env.ALERT_EMAIL_TO!;
    const from = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || to;
    const port = Number(process.env.SMTP_PORT || 587);

    const failList = this.failures
      .map((f) => `• ${f.title}\n    ${f.error}`)
      .join('\n');
    const envName = /portal-staging/i.test(env) ? 'staging'
      : /^https?:\/\/uat\./i.test(env) ? 'uat'
        : /^https?:\/\/sphere\./i.test(env) ? 'prod' : new URL(env).host;
    const subject = `🚨 Sphere ${envName} monitor FAILED — ${this.failures.length} check(s) down`;
    const body =
      `Sphere synthetic monitor FAILED (${result.status}).\n\n` +
      `Env:    ${env}\n` +
      `Result: ${this.failures.length} failed · ${this.passed} passed · ${this.skipped} skipped\n` +
      `When:   ${when}\n\n` +
      `Failed checks:\n${failList}\n`;

    try {
      // Lazy import so the config always loads even if nodemailer is absent.
      const nodemailer: any = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465, // 465 = implicit SSL; 587 = STARTTLS
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transporter.sendMail({ from, to, subject, text: body });
      console.log(`📧 Alert email sent to ${to} (${this.failures.length} failure(s)).`);
    } catch (err) {
      console.error(`⚠️  Alert email failed to send: ${(err as Error).message}`);
    }
  }
}

export default EmailReporter;
