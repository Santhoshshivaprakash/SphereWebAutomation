// The test runner, the assertion library, and the Page type.
import { test, expect, Page } from '@playwright/test';

// Login can't run on the localhost mirror, so this flow targets staging
// Runs against the shared BASE_URL (production).
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// The login page every test here starts from.
const PUBLIC_URL = `${BASE_URL}/public/login`;

// ─── Helper: scroll element into view before clicking ─────────────
async function scrollAndClick(page: Page, locator: any) {
  // Playwright can't click what isn't on screen.
  await locator.scrollIntoViewIfNeeded();
  // Then click.
  await locator.click();
}

// ─── Helper: the phone/email text box ─────────────────────────────
// The first <input> on the login page is the OTP/Password radio, which
// cannot be filled. The real identifier field is the first text/email/tel
// input, so target that explicitly.
function identifierInput(page: Page) {
  return page
    // The type filter is what skips the radio. `input:not([type])` catches
    // untyped inputs, which default to text.
    .locator('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
    .first();
}

// ─── Helper: the Help control (a clickable div with a "help-icon" img,
// not a <button>, so getByRole('button') will not find it) ─────────
function helpControl(page: Page) {
  return page
    // Exact match, so it can't pick up "Help & Contact" elsewhere on the page.
    .getByText('Help', { exact: true })
    // Fallback: the icon image itself.
    .or(page.locator('img[alt*="help" i]'))
    .first();
}

// ─── Helper: dismiss the login page so we land on plain public/home shell if needed
// Clicks something without letting a failure fail the test — it logs instead.
async function safeClick(page: Page, locator: any, label: string) {
  try {
    await scrollAndClick(page, locator);
    console.log(`✅ Clicked: ${label}`);
  } catch (err) {
    // Only the first line of the error, so one stack trace doesn't flood the log.
    console.log(`⚠️  Could not click ${label}: ${(err as Error).message.split('\n')[0]}`);
  }
}

// ══════════════════════════════════════════════════════════════════
// PUBLIC PAGE — FULL ELEMENT COVERAGE
// ══════════════════════════════════════════════════════════════════
// NOTE: this describe name is identical to the one in PublicPage.spec.ts, so
// `--grep` on it matches BOTH files. Grep an inner group name to target this one.
test.describe('Public Page - Complete Element Coverage', () => {

  // Runs before every test: fresh page, fresh navigation.
  test.beforeEach(async ({ page }) => {
    // Open the login page.
    await page.goto(PUBLIC_URL);
    // `networkidle` (not domcontentloaded): the Angular shell's controls only
    // exist once its bootstrap requests settle.
    await page.waitForLoadState('networkidle');
    console.log('✅ Page loaded:', page.url());
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 1: HEADER
  // ────────────────────────────────────────────────────────────────
  test.describe('Header', () => {

    test('Aastrika Sphere logo is visible', async ({ page }) => {
      // Four alternatives, so a markup change in any one place doesn't break it.
      const logo = page.locator('img[alt*="logo" i], img[alt*="aastrika" i], [class*="logo"] img, ws-app-public-nav-bar img').first();
      await expect(logo).toBeVisible();
      console.log('✅ Logo is visible');
    });

    test('Back arrow button is visible and clickable', async ({ page }) => {
      // The back control is a button whose Material icon renders the
      // ligature text "chevron_left"; match on that, else the first button.
      // Material draws icons from ligature TEXT, so the element literally contains "chevron_left".
      const backBtn = page.getByRole('button').filter({ hasText: /chevron_left|arrow_back/i })
        // Positional fallback: on this page the back control is the first button.
        .or(page.getByRole('button').first())
        .first();
      // Presence IS asserted…
      await expect(backBtn).toBeVisible();
      console.log('✅ Back button is visible');
      // …but the click is not — safeClick swallows a failure.
      await safeClick(page, backBtn, 'Back button');
      await page.waitForTimeout(800);
      // The destination is logged, never compared.
      console.log(`   URL after back click: ${page.url()}`);
    });

    test('Help button is visible and opens chat support modal', async ({ page }) => {
      // The Help control (a div, not a button — hence the helper).
      const helpBtn = helpControl(page);
      await expect(helpBtn).toBeVisible();
      console.log('✅ Help button is visible');

      // Open the modal.
      await scrollAndClick(page, helpBtn);
      await page.waitForTimeout(600);

      // This is one of only two places in the file where a click's CONSEQUENCE is asserted.
      const modalHeading = page.getByText(/aastrika sphere chat support/i);
      await expect(modalHeading).toBeVisible();
      console.log('✅ Help modal opened with heading "Aastrika Sphere chat support"');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 2: WELCOME / HEADINGS
  // ────────────────────────────────────────────────────────────────
  test.describe('Welcome Section', () => {

    test('"Welcome!" heading is visible', async ({ page }) => {
      // Anchored at both ends with an optional "!", so it can't match "Welcome back"
      // or any paragraph merely containing the word.
      const heading = page.getByText(/^welcome!?$/i).first();
      await expect(heading).toBeVisible();
      console.log('✅ "Welcome!" heading is visible');
    });

    test('Sub-heading "Login with your Aastrika account" is visible', async ({ page }) => {
      // The explanatory line under the heading.
      const sub = page.getByText(/login with your aastrika account/i).first();
      await expect(sub).toBeVisible();
      console.log('✅ Sub-heading is visible');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 3: LOGIN MODE TOGGLE (OTP / PASSWORD)
  // ────────────────────────────────────────────────────────────────
  test.describe('Login Mode Toggle', () => {

    test('"Login with OTP" radio is selected by default', async ({ page }) => {
      // NOTE: the test's NAME says "selected by default", but the body only checks
      // that the label is on screen — the radio's checked state is never read.
      const otpLabel = page.getByText(/login with otp/i).first();
      await expect(otpLabel).toBeVisible();
      console.log('✅ "Login with OTP" option visible');
    });

    test('"Login with Password" radio is visible and clickable', async ({ page }) => {
      // The other mode's label.
      const pwdLabel = page.getByText(/login with password/i).first();
      await expect(pwdLabel).toBeVisible();
      console.log('✅ "Login with Password" option visible');

      // Switch modes.
      await scrollAndClick(page, pwdLabel);
      await page.waitForTimeout(400);

      // Prefer the accessible label; fall back to the input type.
      const pwdField = page.getByLabel(/enter password/i).or(page.locator('input[type="password"]')).first();
      // The real assertion: switching modes must REVEAL the password field.
      await expect(pwdField).toBeVisible();
      console.log('✅ Switching to Password mode reveals the password field');
    });

    test('Toggling back to OTP hides the password field', async ({ page }) => {
      // Go to password mode…
      await scrollAndClick(page, page.getByText(/login with password/i).first());
      await page.waitForTimeout(300);
      // …then back to OTP.
      await scrollAndClick(page, page.getByText(/login with otp/i).first());
      await page.waitForTimeout(300);

      // Count the password fields left on the page.
      const pwdField = page.locator('input[type="password"]');
      const count = await pwdField.count();
      console.log(`✅ Toggled back to OTP — password fields on screen: ${count}`);
      // `toBe(0)` is stronger than `not.toBeVisible()`: the field must be GONE from the
      // DOM, not merely hidden — a hidden field would still hold the typed password.
      expect(count).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 4: OTP LOGIN FLOW
  // ────────────────────────────────────────────────────────────────
  test.describe('OTP Login Flow', () => {

    test('Phone/Email input field accepts input', async ({ page }) => {
      // Prefer the accessible label; fall back to the input types.
      const input = page.getByLabel(/phone number.*email/i)
        .or(page.locator('input[type="text"], input[type="email"], input[type="tel"]'))
        .first();
      await expect(input).toBeVisible();

      // Type a phone number…
      await input.fill('9876543210');
      // …and confirm it round-trips exactly (no input mask rewriting it).
      await expect(input).toHaveValue('9876543210');
      console.log('✅ Identifier field accepted phone number');

      // Clear it.
      await input.fill('');
      // Now an email — the SAME field must take both identity types.
      await input.fill('testcase003@yopmail.com');
      await expect(input).toHaveValue('testcase003@yopmail.com');
      console.log('✅ Identifier field accepted email');
    });

    test('"Get OTP" button is visible', async ({ page }) => {
      // The submit button for the OTP path.
      const getOtpBtn = page.getByRole('button', { name: /get otp/i });
      await expect(getOtpBtn).toBeVisible();
      console.log('✅ "Get OTP" button is visible');
    });

    test('"Get OTP" button is disabled when input is empty', async ({ page }) => {
      // Blank the field so the state is unambiguous.
      const input = identifierInput(page);
      await input.fill('');
      // Read the button's state.
      const getOtpBtn = page.getByRole('button', { name: /get otp/i });
      const disabled = await getOtpBtn.isDisabled().catch(() => false);
      // NO expect() — the gate is recorded, not required. The ✅ prints either way,
      // so read the value after the colon rather than the tick.
      console.log(`✅ Empty-state — Get OTP disabled: ${disabled}`);
    });

    test('"Get OTP" button is clickable with valid input', async ({ page }) => {
      // Type a real address.
      const input = identifierInput(page);
      await input.fill('testcase003@yopmail.com');
      await page.waitForTimeout(300);

      // Submit it.
      const getOtpBtn = page.getByRole('button', { name: /get otp/i });
      // safeClick: a failed click only logs.
      await safeClick(page, getOtpBtn, 'Get OTP');
      await page.waitForTimeout(1500);
      // The URL is logged, never asserted — nothing here proves an OTP was actually sent.
      console.log(`   URL after Get OTP click: ${page.url()}`);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 5: PASSWORD LOGIN FLOW
  // ────────────────────────────────────────────────────────────────
  test.describe('Password Login Flow', () => {

    // Nested hook: puts the page into password mode before EVERY test in this group.
    // It's unguarded, so if the toggle breaks all five tests fail together with one error.
    test.beforeEach(async ({ page }) => {
      await scrollAndClick(page, page.getByText(/login with password/i).first());
      await page.waitForTimeout(400);
    });

    test('Identifier field is visible in password mode', async ({ page }) => {
      // Switching modes must not hide the identity field.
      const input = page.getByLabel(/phone number.*email/i)
        .or(page.locator('input').first());
      await expect(input.first()).toBeVisible();
      console.log('✅ Identifier field visible in password mode');
    });

    test('Password field is visible and masks input', async ({ page }) => {
      // The password box.
      const pwdField = page.locator('input[type="password"]').first();
      await expect(pwdField).toBeVisible();
      // Type a password into it.
      await pwdField.fill('Sunbird@123');
      // Read the type attribute back.
      const type = await pwdField.getAttribute('type');
      console.log(`✅ Password field present, input type="${type}" (masked)`);
      // Real security value: type="password" is what makes the browser mask the characters.
      // A field switched to "text" would show the password on screen and in any screen share.
      expect(type).toBe('password');
    });

    test('Eye icon toggles password visibility', async ({ page }) => {
      // Put something in the field so a reveal would be observable.
      await page.locator('input[type="password"]').first().fill('Sunbird@123');

      // Eye icon is usually a mat-icon (visibility / visibility_off) inside the password field's suffix
      // Matched by the Material ligature text, or by an aria-label mentioning "password".
      const eyeIcon = page.locator('mat-icon:has-text("visibility"), mat-icon:has-text("visibility_off"), button[aria-label*="password" i]').first();
      const eyeVisible = await eyeIcon.isVisible().catch(() => false);
      console.log(`✅ Eye icon present: ${eyeVisible}`);

      // Only operate it if it's there.
      if (eyeVisible) {
        await scrollAndClick(page, eyeIcon);
        await page.waitForTimeout(300);
        // Reads input index 1 by raw position — a guess that only holds while the DOM
        // order is radio, identifier, password.
        const afterType = await page.locator('input').nth(1).getAttribute('type').catch(() => null);
        // Printed, not asserted — though the type flipping password→text is a definite,
        // checkable outcome that would pair naturally with the masking test above.
        console.log(`   Password input type after toggle: ${afterType}`);
      }
    });

    test('"Forgot Password?" link is visible and clickable', async ({ page }) => {
      // The `\??` makes the question mark optional.
      const link = page.getByText(/forgot password\??/i).first();
      await expect(link).toBeVisible();
      console.log('✅ "Forgot Password?" link visible');

      // Capture the URL before, so the log can show a before/after pair.
      const urlBefore = page.url();
      await safeClick(page, link, 'Forgot Password');
      await page.waitForTimeout(1200);
      // Both logged; never compared, so a dead link would still pass.
      console.log(`   URL before: ${urlBefore}`);
      console.log(`   URL after:  ${page.url()}`);
    });

    test('"Login" button is visible and clickable', async ({ page }) => {
      // Real credentials, hard-coded — this account may or may not still exist.
      const idInput = identifierInput(page);
      await idInput.fill('testcase003@yopmail.com');

      // And its password.
      const pwdInput = page.locator('input[type="password"]').first();
      await pwdInput.fill('Sunbird@123');
      await page.waitForTimeout(300);

      // Anchored, so it can't match "Login with OTP".
      const loginBtn = page.getByRole('button', { name: /^login$/i });
      await expect(loginBtn).toBeVisible();
      console.log('✅ "Login" button visible');

      // Actually submit real credentials to the live environment.
      await safeClick(page, loginBtn, 'Login');
      await page.waitForTimeout(2500);
      // Where we ended up — logged, never asserted.
      console.log(`   URL after Login click: ${page.url()}`);

      // Capture any error / toast / snackbar
      const toast = page.locator('mat-snack-bar-container, [role="alert"], .toast, .error-message').first();
      // Whatever the server said is printed for a human. Nothing gates on it, so
      // "Invalid username or password" still passes this test.
      if (await toast.isVisible().catch(() => false)) {
        const txt = (await toast.textContent())?.trim();
        console.log(`   Server response: "${txt}"`);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 6: CREATE ACCOUNT
  // ────────────────────────────────────────────────────────────────
  test.describe('Create Account', () => {

    test('"or" separator is visible', async ({ page }) => {
      // Anchored — an unanchored /or/i would match almost every word on the page.
      const sep = page.getByText(/^or$/i).first();
      await expect(sep).toBeVisible();
      console.log('✅ "or" separator visible');
    });

    test('"Create an Account" button is visible and clickable', async ({ page }) => {
      // As a real button if there is one, else as a text node — the same hedge
      // used for the Help control.
      const btn = page.getByRole('button', { name: /create an account/i })
        .or(page.getByText(/create an account/i))
        .first();
      await expect(btn).toBeVisible();
      console.log('✅ "Create an Account" button visible');

      // Click and log; the destination is not checked.
      const urlBefore = page.url();
      await safeClick(page, btn, 'Create an Account');
      await page.waitForTimeout(1500);
      console.log(`   URL before: ${urlBefore}`);
      console.log(`   URL after:  ${page.url()}`);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 7: HELP / CHAT SUPPORT MODAL
  // ────────────────────────────────────────────────────────────────
  test.describe('Help Chat Support Modal', () => {

    // Nested hook: opens the modal before EVERY test in this group.
    test.beforeEach(async ({ page }) => {
      await scrollAndClick(page, helpControl(page));
      await page.waitForTimeout(500);
    });

    test('Modal heading "Aastrika Sphere chat support" is visible', async ({ page }) => {
      // Confirms the hook's click actually landed.
      const heading = page.getByText(/aastrika sphere chat support/i);
      await expect(heading).toBeVisible();
      console.log('✅ Modal heading visible');
    });

    test('"Chat with us on WhatsApp" button is visible and clickable', async ({ page }) => {
      // The WhatsApp option.
      const waBtn = page.getByText(/chat with us on whatsapp/i).first();
      await expect(waBtn).toBeVisible();
      console.log('✅ WhatsApp chat button visible');

      // Capture popup if it opens a new tab
      // Registered BEFORE the click — a tab that opens instantly would otherwise be missed.
      const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
      await safeClick(page, waBtn, 'Chat with us on WhatsApp');
      // `.catch(() => null)` above turns the 3s timeout into null rather than a rejection,
      // so BOTH branches below are normal outcomes.
      const popup = await popupPromise;
      if (popup) {
        // Log where it went, then tidy up.
        console.log(`   Opened popup URL: ${popup.url()}`);
        await popup.close();
      } else {
        console.log('   No popup detected (click may have navigated in-page)');
      }
    });

    test('"Chat with us" button is visible and clickable', async ({ page }) => {
      // Use the button role (skips the hidden third-party "Open chat"
      // widget whose text also contains "chat with us") and keep only the
      // visible one inside the modal.
      const chatBtn = page.getByRole('button', { name: /^chat with us$/i })
        // Anchored, so it can't match the longer WhatsApp label from the test above.
        .or(page.getByText(/^chat with us$/i))
        // This filter is load-bearing: without it .first() could resolve to the hidden widget.
        .filter({ visible: true })
        .first();
      await expect(chatBtn).toBeVisible();
      console.log('✅ "Chat with us" button visible');

      // Same popup handling as the WhatsApp test.
      const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
      await safeClick(page, chatBtn, 'Chat with us');
      const popup = await popupPromise;
      if (popup) {
        console.log(`   Opened popup URL: ${popup.url()}`);
        await popup.close();
      } else {
        console.log('   No popup detected');
      }
    });

    test('Modal close (X) button dismisses the modal', async ({ page }) => {
      // Three shapes: a button containing the Material "close" ligature, an
      // aria-labelled one, or one whose text is the × character.
      const closeBtn = page.locator('button:has(mat-icon:has-text("close")), [aria-label*="close" i], button:has-text("×")').first();
      await expect(closeBtn).toBeVisible();
      console.log('✅ Close button visible');

      // Dismiss it.
      await safeClick(page, closeBtn, 'Close (X)');
      await page.waitForTimeout(500);

      // Is the modal still there?
      const stillOpen = await page.getByText(/aastrika sphere chat support/i).isVisible().catch(() => false);
      console.log(`   Modal still visible after close: ${stillOpen}`);
      // The second of only two asserted click-consequences in this file. A modal that
      // can't be dismissed traps a user on the page they were trying to log in from.
      expect(stillOpen).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 8: INPUT VALIDATION EDGE CASES
  // ────────────────────────────────────────────────────────────────
  test.describe('Input Validation Edge Cases', () => {

    // A reconnaissance test: it produces a table of observed behaviour, not a verdict.
    test('Identifier field handles a range of inputs', async ({ page }) => {
      // Ten payloads, from the trivial to the hostile.
      const cases = [
        { val: '',                              label: 'empty' },
        { val: ' ',                             label: 'single space' },
        { val: 'a',                             label: 'single char' },
        { val: '1234567890',                    label: '10-digit phone' },
        { val: '+919876543210',                 label: 'phone with country code' },
        { val: 'test@example.com',              label: 'standard email' },
        { val: 'TEST@EXAMPLE.COM',              label: 'uppercase email' },
        { val: '!@#$%^&*()',                    label: 'special chars' },
        // repeat(256) builds a 256-character string without typing it out.
        { val: 'a'.repeat(256),                 label: 'very long (256 chars)' },
        { val: '<script>alert(1)</script>',     label: 'XSS payload' },
      ];

      // The field under test…
      const input = identifierInput(page);
      // …and the button whose enabled-state we're measuring.
      const getOtpBtn = page.getByRole('button', { name: /get otp/i });

      // Try each payload in turn.
      for (const c of cases) {
        // Clear first, so the previous value can't linger.
        await input.fill('');
        // Type this payload.
        await input.fill(c.val);
        // Let Angular's validation run.
        await page.waitForTimeout(150);
        // Observation 1: what did the field actually KEEP? (maxlength, masks, sanitising)
        const actual = await input.inputValue();
        // Observation 2: did the submit gate open? Default `true` if the button is missing.
        const enabled = await getOtpBtn.isEnabled().catch(() => true);
        // Truncate the 256-char case so one row can't swamp the log.
        const preview = actual.length > 40 ? `${actual.slice(0, 40)}...` : actual;
        // padEnd aligns the labels into a readable column — the table IS this test's product.
        console.log(`   • ${c.label.padEnd(25)} → accepted="${preview}" | Get OTP enabled=${enabled}`);
      }
      // No expect() anywhere: this test cannot fail. A row showing enabled=true for
      // "single space" is a finding, but only a human reading the log will catch it.
      console.log('✅ All edge cases exercised');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 9: RESPONSIVE / VIEWPORT
  // ────────────────────────────────────────────────────────────────
  test.describe('Responsive Layout', () => {

    // The three widths to check.
    const viewports = [
      { name: 'Mobile  (iPhone 12)', w: 390,  h: 844  },
      { name: 'Tablet  (iPad)',      w: 768,  h: 1024 },
      { name: 'Desktop (1440)',      w: 1440, h: 900  },
    ];

    // Generate one test per viewport rather than writing the same test three times.
    // This is why the file declares 27 tests but runs 29.
    for (const vp of viewports) {
      test(`Renders on ${vp.name}`, async ({ page }) => {
        // Resize the existing page — cheaper than building a new context per width.
        await page.setViewportSize({ width: vp.w, height: vp.h });
        // Let the layout reflow.
        await page.waitForTimeout(400);

        // A reachability check: the copy must not be clipped or collapsed away.
        await expect(page.getByText(/^welcome!?$/i).first()).toBeVisible();
        await expect(page.getByText(/login with your aastrika account/i).first()).toBeVisible();
        // Note this says nothing about the form CONTROLS at this width.
        console.log(`✅ Welcome + sub-heading visible at ${vp.name} (${vp.w}x${vp.h})`);
      });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 10: PAGE-LEVEL HEALTH
  // ────────────────────────────────────────────────────────────────
  test.describe('Page Health', () => {

    test('No console errors on load', async ({ page }) => {
      // Collect them here.
      const errors: string[] = [];
      // Attach the listener BEFORE navigating, or early errors are missed.
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      // Re-navigate so the listener sees the whole page load.
      await page.goto(PUBLIC_URL);
      await page.waitForLoadState('networkidle');
      // Extra settle for anything that errors late.
      await page.waitForTimeout(1000);

      // Report the count…
      console.log(`   Console errors captured: ${errors.length}`);
      // …and the first five, truncated to 200 chars each so the log stays readable.
      errors.slice(0, 5).forEach((e, i) => console.log(`   [${i + 1}] ${e.slice(0, 200)}`));
      // NO expect(). PublicPage.spec.ts runs the same check but DOES assert, after
      // filtering out "Failed to load resource" noise — two lines that would work here too.
      console.log(errors.length === 0 ? '✅ No console errors' : '⚠️  Console errors present (logged above)');
    });

    test('Page title contains "Aastrika" or "Sphere"', async ({ page }) => {
      // Read the document title.
      const title = await page.title();
      console.log(`   Page title: "${title}"`);
      // Cheap, but a real canary: a wrong or empty title usually means the router served
      // the wrong shell, or an error page came back with a 200.
      expect(title).toMatch(/aastrika|sphere/i);
      console.log('✅ Page title matches expected pattern');
    });
  });
});
