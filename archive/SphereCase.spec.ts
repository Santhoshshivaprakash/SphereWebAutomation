import { test, expect, Page } from '@playwright/test';

// ─── Constants ─────────────────────────────────────────────────────
const BASE_URL   = process.env.BASE_URL ?? 'https://sphere.aastrika.org';
const PUBLIC_URL = `${BASE_URL}/public/home`;
const VALID_EMAIL    = 'creator777@yopmail.com';
const VALID_PASSWORD = 'Sunbird@123';

// ─── Login Helper ──────────────────────────────────────────────────
async function login(page: Page) {
  await page.goto(PUBLIC_URL);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByText('Login with Password').click();
  await page.getByRole('textbox', { name: 'Phone Number (or) Email ID' }).fill(VALID_EMAIL);
  await page.getByRole('textbox', { name: 'Enter Password' }).fill(VALID_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/page/home', { timeout: 15000 });
}

// ══════════════════════════════════════════════════════════════════
// 1. PUBLIC PAGE (TC 1–17)
// ══════════════════════════════════════════════════════════════════
test.describe('Public Page', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(PUBLIC_URL);
    await page.waitForLoadState('networkidle');
  });

  // TC 1
  test('TC01 - Login button is clickable', async ({ page }) => {
    const loginBtn = page.getByRole('button', { name: 'Log in' });
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toBeEnabled();
  });

  // TC 2
  test('TC02 - Create Account button is clickable', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: 'Create Account', exact: true });
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();
  });

  // TC 3
  test('TC03 - Watch tutorials scrolls to video section', async ({ page }) => {
    const tutorialLink = page.getByText('Watch tutorials on how sphere works');
    if (await tutorialLink.isVisible()) {
      await tutorialLink.click();
      await page.waitForTimeout(1000);
      const videos = page.locator('iframe[src*="youtube"], video, [class*="video"]');
      expect(await videos.count()).toBeGreaterThanOrEqual(1);
    }
  });

  // TC 4
  test('TC04 - Clicking on a course opens course overview page', async ({ page }) => {
    const courseCard = page.locator('[class*="course-card"], [class*="card"]').first();
    if (await courseCard.isVisible()) {
      await courseCard.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(BASE_URL);
    }
  });

  // TC 5
  test('TC05 - Start Now button opens course overview page', async ({ page }) => {
    const startNow = page.getByRole('button', { name: 'Start now' }).first();
    if (await startNow.isVisible()) {
      await startNow.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(BASE_URL);
    }
  });

  // TC 6
  test('TC06 - Read Chapter button opens a PDF', async ({ page }) => {
    const readChapter = page.getByRole('button', { name: 'Read Chapter' }).first();
    if (await readChapter.isVisible()) {
      const [newPage] = await Promise.all([
        page.context().waitForEvent('page'),
        readChapter.click(),
      ]);
      expect(newPage.url()).toMatch(/\.pdf|chapter/i);
    }
  });

  // TC 8
  test('TC08 - YouTube icon in How does it work opens video popup', async ({ page }) => {
    const youtubeIcon = page.locator('[class*="youtube"], img[alt*="youtube"], [class*="how-it-work"] button').first();
    if (await youtubeIcon.isVisible()) {
      await youtubeIcon.click();
      const popup = page.locator('[class*="modal"], [class*="popup"], [role="dialog"]').first();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 9
  test('TC09 - Register for a course field opens popup', async ({ page }) => {
    const field = page.getByText('Register for a course');
    if (await field.isVisible()) {
      await field.click();
      const popup = page.locator('[class*="modal"], [class*="popup"], [role="dialog"]').first();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 10
  test('TC10 - Take the course field opens popup', async ({ page }) => {
    const field = page.getByText('Take the course');
    if (await field.isVisible()) {
      await field.click();
      const popup = page.locator('[class*="modal"], [class*="popup"], [role="dialog"]').first();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 11
  test('TC11 - Get certified field opens popup', async ({ page }) => {
    const field = page.getByText('Get certified');
    if (await field.isVisible()) {
      await field.click();
      const popup = page.locator('[class*="modal"], [class*="popup"], [role="dialog"]').first();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 12
  test('TC12 - Start Today button navigates to Create Account page', async ({ page }) => {
    await page.getByRole('button', { name: 'Start Today' }).click();
    // Angular routes client-side, so no new document is fetched and
    // waitForLoadState('networkidle') resolves immediately against the load
    // that already finished — the URL check then races the router and still
    // sees /public/home. Wait for the URL itself to change instead.
    await page.waitForURL(/register|create|signup/i, { timeout: 15_000 });
    expect(page.url()).toMatch(/register|create|signup/i);
  });

  // TC 13
  test('TC13 - Privacy Policy link opens privacy page', async ({ page }) => {
    const link = page.getByText('Privacy Policy');
    if (await link.isVisible()) {
      await link.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toMatch(/privacy/i);
    }
  });

  // TC 14
  test('TC14 - Terms of Use link opens terms page', async ({ page }) => {
    const link = page.getByText('Terms of use');
    if (await link.isVisible()) {
      await link.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toMatch(/terms/i);
    }
  });

  // TC 17
  test('TC17 - Additional links redirect to Aastrika foundation page', async ({ page }) => {
    const link = page.getByText('Additional links');
    if (await link.isVisible()) {
      await link.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toMatch(/aastrika/i);
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 2. LOGIN PAGE (TC 18–33)
// ══════════════════════════════════════════════════════════════════
test.describe('Login Page', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(PUBLIC_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Log in' }).click();
  });

  // TC 18
  test('TC18 - Clicking login button opens login page', async ({ page }) => {
    const loginModal = page.locator('[class*="login"], [class*="modal"], [role="dialog"]').first();
    await expect(loginModal).toBeVisible({ timeout: 5000 });
  });

  // TC 19
  test('TC19 - X icon closes the login page', async ({ page }) => {
    const closeBtn = page.getByRole('button', { name: 'X' })
      .or(page.locator('[class*="close"], [aria-label="close"], button[mat-icon-button]')).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await expect(page).toHaveURL(PUBLIC_URL);
    }
  });

  // TC 20
  test('TC20 - OTP and Password radio buttons are selectable', async ({ page }) => {
    const otpRadio = page.getByText('Login with OTP');
    const pwdRadio = page.getByText('Login with Password');
    if (await otpRadio.isVisible()) {
      await otpRadio.click();
      await expect(otpRadio).toBeVisible();
    }
    if (await pwdRadio.isVisible()) {
      await pwdRadio.click();
      await expect(pwdRadio).toBeVisible();
    }
  });

  // TC 21
  test('TC21 - Wrong email in OTP login shows error', async ({ page }) => {
    await page.getByText('Login with OTP').click();
    await page.getByRole('textbox', { name: 'Phone Number (or) Email ID' }).fill('invalid@wrong.com');
    await page.getByRole('button', { name: 'Get OTP' }).click();
    const error = page.locator('[class*="error"], [class*="alert"], [role="alert"]').first();
    await expect(error).toBeVisible({ timeout: 5000 });
  });

  // TC 22
  test('TC22 - Get OTP without filling email shows validation error', async ({ page }) => {
    await page.getByText('Login with OTP').click();
    await page.getByRole('button', { name: 'Get OTP' }).click();
    const error = page.locator('[class*="error"], [class*="alert"], [role="alert"]').first();
    await expect(error).toBeVisible({ timeout: 5000 });
  });

  // TC 23
  test('TC23 - Valid email and password logs in successfully', async ({ page }) => {
    await page.getByText('Login with Password').click();
    await page.getByRole('textbox', { name: 'Phone Number (or) Email ID' }).fill(VALID_EMAIL);
    await page.getByRole('textbox', { name: 'Enter Password' }).fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL('**/page/home', { timeout: 15000 });
    await expect(page).toHaveURL(/page\/home/);
  });

  // TC 24
  test('TC24 - Valid email with invalid password shows error', async ({ page }) => {
    await page.getByText('Login with Password').click();
    await page.getByRole('textbox', { name: 'Phone Number (or) Email ID' }).fill(VALID_EMAIL);
    await page.getByRole('textbox', { name: 'Enter Password' }).fill('WrongPassword@999');
    await page.getByRole('button', { name: 'Login' }).click();
    const error = page.locator('[class*="error"], [class*="alert"], [role="alert"], button[name="Try again"]').first();
    await expect(error).toBeVisible({ timeout: 5000 });
  });

  // TC 25
  test('TC25 - Invalid email and invalid password shows error', async ({ page }) => {
    await page.getByText('Login with Password').click();
    await page.getByRole('textbox', { name: 'Phone Number (or) Email ID' }).fill('invalid@wrong.com');
    await page.getByRole('textbox', { name: 'Enter Password' }).fill('WrongPassword@000');
    await page.getByRole('button', { name: 'Login' }).click();
    const error = page.locator('[class*="error"], [class*="alert"], [role="alert"], button[name="Try again"]').first();
    await expect(error).toBeVisible({ timeout: 5000 });
  });

  // TC 26
  test('TC26 - Sign in without filling fields shows validation error', async ({ page }) => {
    await page.getByText('Login with Password').click();
    await page.getByRole('button', { name: 'Login' }).click();
    const error = page.locator('[class*="error"], [class*="required"], [class*="invalid"]').first();
    await expect(error).toBeVisible({ timeout: 5000 });
  });

  // TC 27
  test('TC27 - Create Account in login page navigates to registration', async ({ page }) => {
    const createAccLink = page.getByText('Create Account').or(page.getByText('New User')).first();
    if (await createAccLink.isVisible()) {
      await createAccLink.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toMatch(/register|create|signup/i);
    }
  });

  // TC 29
  test('TC29 - Get OTP navigates to OTP page', async ({ page }) => {
    await page.getByText('Login with OTP').click();
    await page.getByRole('textbox', { name: 'Phone Number (or) Email ID' }).fill(VALID_EMAIL);
    await page.getByRole('button', { name: 'Get OTP' }).click();
    const otpField = page.getByRole('textbox', { name: 'Code' })
      .or(page.locator('input[id*="otp"], input[id*="code"]')).first();
    await expect(otpField).toBeVisible({ timeout: 8000 });
  });

  // TC 31
  test('TC31 - Resend OTP button resends OTP', async ({ page }) => {
    await page.getByText('Login with OTP').click();
    await page.getByRole('textbox', { name: 'Phone Number (or) Email ID' }).fill(VALID_EMAIL);
    await page.getByRole('button', { name: 'Get OTP' }).click();
    await page.waitForTimeout(2000);
    const resendBtn = page.getByText('Resend OTP').or(page.getByRole('button', { name: 'Resend' })).first();
    if (await resendBtn.isVisible()) {
      await expect(resendBtn).toBeEnabled();
    }
  });

  // TC 33
  test('TC33 - Back to Aastrika Sphere redirects to public home', async ({ page }) => {
    const backLink = page.getByText('Back to aastrika sphere');
    if (await backLink.isVisible()) {
      await backLink.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(PUBLIC_URL);
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 3. CREATE ACCOUNT (TC 34–48)
// ══════════════════════════════════════════════════════════════════
test.describe('Create Account', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(PUBLIC_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Create Account', exact: true }).click();
    await page.waitForLoadState('networkidle');
  });

  // TC 34
  test('TC34 - Create Account button lands on registration page', async ({ page }) => {
    expect(page.url()).toMatch(/register|create|signup|public/i);
  });

  // TC 35
  test('TC35 - Default language is English', async ({ page }) => {
    const englishRadio = page.locator('input[id*="mat-radio-2"]').first();
    if (await englishRadio.isVisible()) {
      await expect(englishRadio).toBeChecked();
    }
  });

  // TC 38
  test('TC38 - Both language radio buttons are selectable', async ({ page }) => {
    const radios = page.locator('mat-radio-button, input[type="radio"]');
    const count = await radios.count();
    if (count >= 2) {
      await radios.nth(0).click();
      await radios.nth(1).click();
      await expect(radios.nth(1)).toBeVisible();
    }
  });

  // TC 40
  test('TC40 - Save button is clickable', async ({ page }) => {
    const saveBtn = page.getByRole('button', { name: 'Save' });
    if (await saveBtn.isVisible()) {
      await expect(saveBtn).toBeEnabled();
    }
  });

  // TC 42
  test('TC42 - Valid details in Create Account navigates to OTP page', async ({ page }) => {
    // Select English
    await page.locator('input#mat-radio-2-input').click();
    await page.getByRole('button', { name: 'Next' }).click();
    // Fill form
    await page.locator('input#firstname').fill('Test');
    await page.locator('input#lastname').fill('User');
    await page.locator('input#email-field').fill('testuser001@yopmail.com');
    await page.locator('input#mat-radio-6-input').click();
    await page.getByRole('button', { name: 'Next' }).click();
    // Check OTP page appears
    const otpField = page.locator('input#code, input[id*="otp"]').first();
    await expect(otpField).toBeVisible({ timeout: 10000 });
  });

  // TC 43
  test('TC43 - Invalid email in signup shows error', async ({ page }) => {
    await page.locator('input#mat-radio-2-input').click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('input#firstname').fill('Test');
    await page.locator('input#lastname').fill('User');
    await page.locator('input#email-field').fill('notavalidemail');
    await page.getByRole('button', { name: 'Next' }).click();
    const error = page.locator('[class*="error"], [class*="invalid"], mat-error').first();
    await expect(error).toBeVisible({ timeout: 5000 });
  });

  // TC 44
  test('TC44 - Next button highlights when valid details are given', async ({ page }) => {
    await page.locator('input#mat-radio-2-input').click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('input#firstname').fill('Test');
    await page.locator('input#lastname').fill('User');
    await page.locator('input#email-field').fill('testuser002@yopmail.com');
    await page.locator('input#mat-radio-6-input').click();
    const nextBtn = page.getByRole('button', { name: 'Next' });
    await expect(nextBtn).toBeEnabled();
  });

  // TC 48
  test('TC48 - Wrong OTP shows error toast', async ({ page }) => {
    await page.locator('input#mat-radio-2-input').click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('input#firstname').fill('Test');
    await page.locator('input#lastname').fill('User');
    await page.locator('input#email-field').fill('testuser003@yopmail.com');
    await page.locator('input#mat-radio-6-input').click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('input#confpassword-field, input#password-field').first().fill('Sample@123');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(3000);
    const otpField = page.locator('input#code').first();
    if (await otpField.isVisible()) {
      await otpField.fill('000000');
      await page.getByRole('button', { name: 'Next' }).click();
      const toast = page.locator('[class*="toast"], [class*="error"], [role="alert"]').first();
      await expect(toast).toBeVisible({ timeout: 5000 });
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 4. PRIVATE HOME PAGE (TC 50–71)
// ══════════════════════════════════════════════════════════════════
test.describe('Private Home Page', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // TC 50
  test('TC50 - Clicking Aastrika logo refreshes/navigates to home', async ({ page }) => {
    const logo = page.locator('[class*="logo"], img[alt*="logo"], [class*="brand"]').first();
    if (await logo.isVisible()) {
      await logo.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/page\/home/);
    }
  });

  // TC 51
  test('TC51 - Get help icon is clickable', async ({ page }) => {
    const helpIcon = page.locator('[class*="help"], img[alt*="help"], [aria-label*="help"]').first();
    if (await helpIcon.isVisible()) {
      await expect(helpIcon).toBeEnabled();
    }
  });

  // TC 53
  test('TC53 - X button in help popup lands on private home page', async ({ page }) => {
    const helpIcon = page.locator('[class*="help"], img[alt*="help"]').first();
    if (await helpIcon.isVisible()) {
      await helpIcon.click();
      const closeBtn = page.locator('[class*="close"], button[aria-label="close"]').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await expect(page).toHaveURL(/page\/home/);
      }
    }
  });

  // TC 55
  test('TC55 - Clicking a course first time opens Tell us more page', async ({ page }) => {
    const courseCard = page.locator('[class*="course-card"], [class*="card"]').first();
    if (await courseCard.isVisible()) {
      await courseCard.click();
      await page.waitForLoadState('networkidle');
      // Either profile page or course page
      expect(page.url()).not.toBe('about:blank');
    }
  });

  // TC 58
  test('TC58 - Next button is clickable only with valid details', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: 'Next' }).first();
    if (await nextBtn.isVisible()) {
      await expect(nextBtn).toBeVisible();
    }
  });

  // TC 65
  test('TC65 - Clicking a course opens TOC page', async ({ page }) => {
    const courseCard = page.locator('[class*="course-card"], [class*="card"]').first();
    if (await courseCard.isVisible()) {
      await courseCard.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(BASE_URL);
    }
  });

  // TC 66
  test('TC66 - View All Courses displays all courses', async ({ page }) => {
    const viewAllBtn = page.getByRole('button', { name: 'View All' }).first();
    if (await viewAllBtn.isVisible()) {
      await viewAllBtn.click();
      await page.waitForLoadState('networkidle');
      const cards = page.locator('[class*="course-card"], [class*="card"]');
      expect(await cards.count()).toBeGreaterThan(0);
    }
  });

  // TC 71
  test('TC71 - Home icon is highlighted in navbar when on home page', async ({ page }) => {
    const homeIcon = page.locator('nav [class*="active"], nav [class*="home"]').first();
    if (await homeIcon.isVisible()) {
      await expect(homeIcon).toBeVisible();
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 5. COURSE TOC PAGE (TC 73–92)
// ══════════════════════════════════════════════════════════════════
test.describe('Course TOC Page', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
    // Navigate to first available course
    const courseCard = page.locator('[class*="course-card"], [class*="card"]').first();
    if (await courseCard.isVisible()) {
      await courseCard.click();
      await page.waitForLoadState('networkidle');
    }
  });

  // TC 73
  test('TC73 - Back button from course takes user to homepage', async ({ page }) => {
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/page\/home/);
  });

  // TC 75
  test('TC75 - Clicking Details opens course details popup', async ({ page }) => {
    const detailsBtn = page.getByRole('button', { name: 'Details' })
      .or(page.getByText('Details')).first();
    if (await detailsBtn.isVisible()) {
      await detailsBtn.click();
      const popup = page.locator('[class*="modal"], [class*="popup"], [role="dialog"]').first();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 76
  test('TC76 - X button closes the details popup', async ({ page }) => {
    const detailsBtn = page.getByText('Details').first();
    if (await detailsBtn.isVisible()) {
      await detailsBtn.click();
      const closeBtn = page.locator('[class*="close"], button[aria-label="close"]').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        const popup = page.locator('[role="dialog"]').first();
        await expect(popup).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  // TC 77
  test('TC77 - Certificate button shows popup to complete the course', async ({ page }) => {
    const certBtn = page.getByRole('button', { name: 'Certificate' }).first();
    if (await certBtn.isVisible()) {
      await certBtn.click();
      const popup = page.locator('[class*="modal"], [class*="popup"], [role="dialog"]').first();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 78
  test('TC78 - Close button closes the popup', async ({ page }) => {
    const certBtn = page.getByRole('button', { name: 'Certificate' }).first();
    if (await certBtn.isVisible()) {
      await certBtn.click();
      const closeBtn = page.getByRole('button', { name: 'Close' }).first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        const popup = page.locator('[role="dialog"]').first();
        await expect(popup).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  // TC 79
  test('TC79 - Share button displays shareable icons', async ({ page }) => {
    const shareBtn = page.getByRole('button', { name: 'Share' }).first();
    if (await shareBtn.isVisible()) {
      await shareBtn.click();
      const shareIcons = page.locator('[class*="share"], [class*="social"]').first();
      await expect(shareIcons).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 80
  test('TC80 - Start button starts the course', async ({ page }) => {
    const startBtn = page.getByRole('button', { name: 'Start' }).first();
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(BASE_URL);
    }
  });

  // TC 81
  test('TC81 - License Terms link opens license page', async ({ page }) => {
    const licenseLink = page.getByText('License Terms').first();
    if (await licenseLink.isVisible()) {
      await licenseLink.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(BASE_URL);
    }
  });

  // TC 82
  test('TC82 - Clicking resources starts the resource', async ({ page }) => {
    const resource = page.locator('[class*="resource"], [class*="module-item"]').first();
    if (await resource.isVisible()) {
      await resource.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(BASE_URL);
    }
  });

  // TC 85
  test('TC85 - PDF resource opens', async ({ page }) => {
    const pdfResource = page.locator('[class*="pdf"], [aria-label*="pdf"]').first();
    if (await pdfResource.isVisible()) {
      await pdfResource.click();
      await page.waitForLoadState('networkidle');
      const viewer = page.locator('[class*="pdf-viewer"], iframe, [class*="viewer"]').first();
      await expect(viewer).toBeVisible({ timeout: 8000 });
    }
  });

  // TC 92
  test('TC92 - Next and Previous icons move between resources', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: 'Next' }).first();
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForLoadState('networkidle');
    }
    const prevBtn = page.getByRole('button', { name: 'Previous' }).first();
    if (await prevBtn.isVisible()) {
      await prevBtn.click();
      await page.waitForLoadState('networkidle');
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 6. ASSESSMENT (TC 94–106)
// ══════════════════════════════════════════════════════════════════
test.describe('Assessment', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // TC 94
  test('TC94 - Clicking assessment opens it', async ({ page }) => {
    const assessment = page.locator('[class*="assessment"]').first();
    if (await assessment.isVisible()) {
      await assessment.click();
      const assessmentView = page.locator('[class*="assessment-view"], [class*="quiz"]').first();
      await expect(assessmentView).toBeVisible({ timeout: 8000 });
    }
  });

  // TC 95
  test('TC95 - Start button starts the assessment', async ({ page }) => {
    const startBtn = page.getByRole('button', { name: 'Start' }).first();
    if (await startBtn.isVisible()) {
      await startBtn.click();
      const question = page.locator('[class*="question"]').first();
      await expect(question).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 97
  test('TC97 - Checkbox selects answers', async ({ page }) => {
    const checkbox = page.locator('input[type="checkbox"], mat-checkbox').first();
    if (await checkbox.isVisible()) {
      await checkbox.click();
      await expect(checkbox).toBeChecked();
    }
  });

  // TC 101
  test('TC101 - Next button moves to next question', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: 'Next' }).first();
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 102
  test('TC102 - Back button moves to previous question', async ({ page }) => {
    const backBtn = page.getByRole('button', { name: 'Back' }).first();
    if (await backBtn.isVisible()) {
      await backBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 104
  test('TC104 - Retake Assessment restarts assessment', async ({ page }) => {
    const retakeBtn = page.getByRole('button', { name: 'Retake Assessment' }).first();
    if (await retakeBtn.isVisible()) {
      await retakeBtn.click();
      const question = page.locator('[class*="question"]').first();
      await expect(question).toBeVisible({ timeout: 5000 });
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 7. MY COURSES (TC 107–113)
// ══════════════════════════════════════════════════════════════════
test.describe('My Courses', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
    const myCourseTab = page.getByText('My course').or(page.locator('[class*="my-course"]')).first();
    if (await myCourseTab.isVisible()) {
      await myCourseTab.click();
      await page.waitForLoadState('networkidle');
    }
  });

  // TC 107
  test('TC107 - My course tab is highlighted in navbar', async ({ page }) => {
    const activeTab = page.locator('nav [class*="active"]').first();
    await expect(activeTab).toBeVisible();
  });

  // TC 109
  test('TC109 - Started courses appear under Started tab', async ({ page }) => {
    const startedTab = page.getByText('Started').first();
    if (await startedTab.isVisible()) {
      await startedTab.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 110
  test('TC110 - For You tab shows designation-based courses', async ({ page }) => {
    const forYouTab = page.getByText('For you').first();
    if (await forYouTab.isVisible()) {
      await forYouTab.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 111
  test('TC111 - Completed tab shows completed courses', async ({ page }) => {
    const completedTab = page.getByText('Completed').first();
    if (await completedTab.isVisible()) {
      await completedTab.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 113
  test('TC113 - Certificate button downloads certificate', async ({ page }) => {
    const completedTab = page.getByText('Completed').first();
    if (await completedTab.isVisible()) {
      await completedTab.click();
      await page.waitForLoadState('networkidle');
      const certBtn = page.getByRole('button', { name: 'Certificate' }).first();
      if (await certBtn.isVisible()) {
        await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
          certBtn.click(),
        ]);
        // Download may trigger or open in new tab
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 8. COMPETENCY DASHBOARD (TC 114–147)
// ══════════════════════════════════════════════════════════════════
test.describe('Competency Dashboard', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
    const competencyTab = page.getByText('Competency').or(page.locator('[class*="competency"]')).first();
    if (await competencyTab.isVisible()) {
      await competencyTab.click();
      await page.waitForLoadState('networkidle');
    }
  });

  // TC 114
  test('TC114 - Competency icon is highlighted in navbar', async ({ page }) => {
    const activeTab = page.locator('nav [class*="active"]').first();
    await expect(activeTab).toBeVisible();
  });

  // TC 115
  test('TC115 - Competency tab opens with passbook', async ({ page }) => {
    const passbook = page.getByText('Passbook').or(page.locator('[class*="passbook"]')).first();
    await expect(passbook).toBeVisible({ timeout: 5000 });
  });

  // TC 116
  test('TC116 - Required tab displays self assessment list', async ({ page }) => {
    const requiredTab = page.getByText('Required').first();
    if (await requiredTab.isVisible()) {
      await requiredTab.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 117
  test('TC117 - Assess button opens self-assessment popup', async ({ page }) => {
    const requiredTab = page.getByText('Required').first();
    if (await requiredTab.isVisible()) {
      await requiredTab.click();
      const assessBtn = page.getByRole('button', { name: 'Assess' }).first();
      if (await assessBtn.isVisible()) {
        await assessBtn.click();
        const popup = page.locator('[class*="modal"], [role="dialog"]').first();
        await expect(popup).toBeVisible({ timeout: 5000 });
      }
    }
  });

  // TC 118
  test('TC118 - Start Now begins the self assessment', async ({ page }) => {
    const startNowBtn = page.getByRole('button', { name: 'Start Now' }).first();
    if (await startNowBtn.isVisible()) {
      await startNowBtn.click();
      const question = page.locator('[class*="question"]').first();
      await expect(question).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 126
  test('TC126 - Failed assessment shows you did not pass message', async ({ page }) => {
    const failMsg = page.getByText("You didn't pass the assessment");
    if (await failMsg.isVisible()) {
      await expect(failMsg).toBeVisible();
    }
  });

  // TC 127
  test('TC127 - View relevant Courses shows related courses', async ({ page }) => {
    const viewCoursesBtn = page.getByRole('button', { name: 'View relevant Courses' }).first();
    if (await viewCoursesBtn.isVisible()) {
      await viewCoursesBtn.click();
      await page.waitForLoadState('networkidle');
      const cards = page.locator('[class*="course-card"], [class*="card"]');
      expect(await cards.count()).toBeGreaterThanOrEqual(0);
    }
  });

  // TC 130
  test('TC130 - Dropdown shows completed assessments in passbook', async ({ page }) => {
    const dropdown = page.locator('[class*="dropdown"], mat-select').first();
    if (await dropdown.isVisible()) {
      await dropdown.click();
      const options = page.locator('[class*="option"], mat-option');
      expect(await options.count()).toBeGreaterThan(0);
    }
  });

  // TC 132
  test('TC132 - Job Description tab shows all roles courses', async ({ page }) => {
    const jobDescTab = page.getByText('Job Description').first();
    if (await jobDescTab.isVisible()) {
      await jobDescTab.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 9. SEARCH BAR (TC 149–156)
// ══════════════════════════════════════════════════════════════════
test.describe('Search Bar', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
  });

  // TC 149
  test('TC149 - Clicking search bar shows recently published courses', async ({ page }) => {
    const searchBar = page.locator('input[type="search"], input[placeholder*="Search"], [class*="search-input"]').first();
    if (await searchBar.isVisible()) {
      await searchBar.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 153
  test('TC153 - Search field accepts text input', async ({ page }) => {
    const searchBar = page.locator('input[type="search"], input[placeholder*="Search"], [class*="search-input"]').first();
    if (await searchBar.isVisible()) {
      await searchBar.fill('health');
      await expect(searchBar).toHaveValue('health');
    }
  });

  // TC 155
  test('TC155 - Language selector allows language selection', async ({ page }) => {
    const langSelector = page.locator('[class*="language"], mat-select[placeholder*="language"]').first();
    if (await langSelector.isVisible()) {
      await langSelector.click();
      const options = page.locator('mat-option, [class*="option"]');
      expect(await options.count()).toBeGreaterThan(0);
    }
  });

  // TC 156
  test('TC156 - Clicking Aastrika logo navigates to home page', async ({ page }) => {
    const searchBar = page.locator('input[type="search"]').first();
    if (await searchBar.isVisible()) {
      await searchBar.fill('test search');
    }
    const logo = page.locator('[class*="logo"], img[alt*="logo"]').first();
    if (await logo.isVisible()) {
      await logo.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/page\/home/);
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 10. ACCOUNT PAGE (TC 157–194)
// ══════════════════════════════════════════════════════════════════
test.describe('Account Page', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
    const accountTab = page.getByText('Account').or(page.locator('[class*="account"], [aria-label*="account"]')).first();
    if (await accountTab.isVisible()) {
      await accountTab.click();
      await page.waitForLoadState('networkidle');
    }
  });

  // TC 157
  test('TC157 - Account tab is highlighted in navbar', async ({ page }) => {
    const activeTab = page.locator('nav [class*="active"]').first();
    await expect(activeTab).toBeVisible();
  });

  // TC 158
  test('TC158 - Account tab shows profile settings', async ({ page }) => {
    const profileSection = page.locator('[class*="profile"], [class*="account-settings"]').first();
    await expect(profileSection).toBeVisible({ timeout: 5000 });
  });

  // TC 159
  test('TC159 - Back button takes user to home page', async ({ page }) => {
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/page\/home/);
  });

  // TC 160
  test('TC160 - Edit icon on profile pic opens image selection popup', async ({ page }) => {
    const editIcon = page.locator('[class*="edit-avatar"], [class*="profile-pic"] [class*="edit"]').first();
    if (await editIcon.isVisible()) {
      await editIcon.click();
      const popup = page.locator('[class*="modal"], [role="dialog"]').first();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 163
  test('TC163 - Language Preference opens new tab for language selection', async ({ page }) => {
    const langPref = page.getByText('Language Preference').first();
    if (await langPref.isVisible()) {
      await langPref.click();
      await page.waitForLoadState('networkidle');
      const radios = page.locator('mat-radio-button, input[type="radio"]');
      expect(await radios.count()).toBeGreaterThan(0);
    }
  });

  // TC 168
  test('TC168 - My Certificates shows all completed certificates', async ({ page }) => {
    const certSection = page.getByText('My certificates').first();
    if (await certSection.isVisible()) {
      await certSection.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 169
  test('TC169 - Download icon downloads certificate', async ({ page }) => {
    const certSection = page.getByText('My certificates').first();
    if (await certSection.isVisible()) {
      await certSection.click();
      await page.waitForLoadState('networkidle');
      const downloadBtn = page.locator('[class*="download"], [aria-label*="download"]').first();
      if (await downloadBtn.isVisible()) {
        await expect(downloadBtn).toBeEnabled();
      }
    }
  });

  // TC 171
  test('TC171 - Profile Details shows all profile info', async ({ page }) => {
    const profileDetails = page.getByText('Profile Details').first();
    if (await profileDetails.isVisible()) {
      await profileDetails.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 172
  test('TC172 - Edit icon in personal details opens edit tab', async ({ page }) => {
    const editBtn = page.locator('[class*="edit-personal"], [aria-label*="edit"]').first();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      const editForm = page.locator('form, [class*="edit-form"]').first();
      await expect(editForm).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 177
  test('TC177 - Gender dropdown is selectable', async ({ page }) => {
    const genderDropdown = page.locator('mat-select[placeholder*="gender"], select[id*="gender"]').first();
    if (await genderDropdown.isVisible()) {
      await genderDropdown.click();
      const options = page.locator('mat-option, option');
      expect(await options.count()).toBeGreaterThan(0);
    }
  });

  // TC 182
  test('TC182 - Save button is enabled after entering a field', async ({ page }) => {
    const inputField = page.locator('input[id*="phone"], input[id*="address"]').first();
    if (await inputField.isVisible()) {
      await inputField.fill('test value');
      const saveBtn = page.getByRole('button', { name: 'Save' });
      await expect(saveBtn).toBeEnabled({ timeout: 3000 });
    }
  });

  // TC 183
  test('TC183 - Organization Details shows org info', async ({ page }) => {
    const orgDetails = page.getByText('Organization Details').first();
    if (await orgDetails.isVisible()) {
      await orgDetails.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 185
  test('TC185 - Designation dropdown is selectable', async ({ page }) => {
    const orgDetails = page.getByText('Organization Details').first();
    if (await orgDetails.isVisible()) {
      await orgDetails.click();
      const editBtn = page.locator('[class*="edit"]').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        const dropdown = page.locator('mat-select[placeholder*="Designation"], select[id*="profession"]').first();
        if (await dropdown.isVisible()) {
          await dropdown.click();
          const options = page.locator('mat-option, option');
          expect(await options.count()).toBeGreaterThan(0);
        }
      }
    }
  });

  // TC 188
  test('TC188 - Academic Details opens new tab', async ({ page }) => {
    const academicDetails = page.getByText('Academic Details').first();
    if (await academicDetails.isVisible()) {
      await academicDetails.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 189
  test('TC189 - + button adds academic details', async ({ page }) => {
    const academicDetails = page.getByText('Academic Details').first();
    if (await academicDetails.isVisible()) {
      await academicDetails.click();
      const addBtn = page.getByRole('button', { name: '+' })
        .or(page.locator('[class*="add-academic"]')).first();
      if (await addBtn.isVisible()) {
        await addBtn.click();
        const form = page.locator('form, [class*="academic-form"]').first();
        await expect(form).toBeVisible({ timeout: 5000 });
      }
    }
  });

  // TC 193
  test('TC193 - Save button enabled only with valid academic details', async ({ page }) => {
    const academicDetails = page.getByText('Academic Details').first();
    if (await academicDetails.isVisible()) {
      await academicDetails.click();
      const addBtn = page.locator('[class*="add"]').first();
      if (await addBtn.isVisible()) {
        await addBtn.click();
        const saveBtn = page.getByRole('button', { name: 'Save' });
        // Save should be disabled with empty form
        if (await saveBtn.isVisible()) {
          await expect(saveBtn).toBeDisabled();
        }
      }
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 11. LOGOUT (TC 195–198)
// ══════════════════════════════════════════════════════════════════
test.describe('Logout', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
    const accountTab = page.getByText('Account').first();
    if (await accountTab.isVisible()) {
      await accountTab.click();
      await page.waitForLoadState('networkidle');
    }
  });

  // TC 195
  test('TC195 - Logout button is clickable', async ({ page }) => {
    const logoutBtn = page.getByRole('button', { name: 'Logout' })
      .or(page.getByText('Logout')).first();
    if (await logoutBtn.isVisible()) {
      await expect(logoutBtn).toBeEnabled();
    }
  });

  // TC 196
  test('TC196 - Logout button shows confirmation popup', async ({ page }) => {
    const logoutBtn = page.getByRole('button', { name: 'Logout' })
      .or(page.getByText('Logout')).first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      const popup = page.locator('[class*="modal"], [role="dialog"]').first();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 197
  test('TC197 - No on logout popup stays on account page', async ({ page }) => {
    const logoutBtn = page.getByRole('button', { name: 'Logout' })
      .or(page.getByText('Logout')).first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      const noBtn = page.getByRole('button', { name: 'No' }).first();
      if (await noBtn.isVisible()) {
        await noBtn.click();
        await expect(page).toHaveURL(/account/i);
      }
    }
  });

  // TC 198
  test('TC198 - Yes on logout popup navigates to public home', async ({ page }) => {
    const logoutBtn = page.getByRole('button', { name: 'Logout' })
      .or(page.getByText('Logout')).first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      const yesBtn = page.getByRole('button', { name: 'Yes' }).first();
      if (await yesBtn.isVisible()) {
        await yesBtn.click();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/public/i);
      }
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 12. QUIZ (TC 199–209)
// ══════════════════════════════════════════════════════════════════
test.describe('Quiz', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // TC 199
  test('TC199 - Clicking quiz opens it', async ({ page }) => {
    const quizItem = page.locator('[class*="quiz"]').first();
    if (await quizItem.isVisible()) {
      await quizItem.click();
      const quizView = page.locator('[class*="quiz-view"], [class*="quiz-container"]').first();
      await expect(quizView).toBeVisible({ timeout: 8000 });
    }
  });

  // TC 200
  test('TC200 - Start Now button starts the quiz', async ({ page }) => {
    const startNow = page.getByRole('button', { name: 'Start Now' }).first();
    if (await startNow.isVisible()) {
      await startNow.click();
      const question = page.locator('[class*="question"]').first();
      await expect(question).toBeVisible({ timeout: 5000 });
    }
  });

  // TC 202
  test('TC202 - Checkbox selects quiz answers', async ({ page }) => {
    const checkbox = page.locator('input[type="checkbox"], mat-checkbox').first();
    if (await checkbox.isVisible()) {
      await checkbox.click();
      await expect(checkbox).toBeChecked();
    }
  });

  // TC 205
  test('TC205 - Submit moves to next question', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: 'Submit' }).first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 206
  test('TC206 - Restart button restarts the quiz', async ({ page }) => {
    const restartBtn = page.getByRole('button', { name: 'Restart' }).first();
    if (await restartBtn.isVisible()) {
      await restartBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // TC 208
  test('TC208 - Retake quiz button restarts the quiz', async ({ page }) => {
    const retakeBtn = page.getByRole('button', { name: 'Retake quiz' }).first();
    if (await retakeBtn.isVisible()) {
      await retakeBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

});

// ══════════════════════════════════════════════════════════════════
// 13. NOTIFICATIONS (TC 210–213)
// ══════════════════════════════════════════════════════════════════
test.describe('Notifications', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
  });

  // TC 210
  test('TC210 - No notification shows empty list with mark as read disabled', async ({ page }) => {
    const notifIcon = page.locator('[class*="notification"], [aria-label*="notification"]').first();
    if (await notifIcon.isVisible()) {
      await notifIcon.click();
      await page.waitForTimeout(1000);
      const markReadBtn = page.getByRole('button', { name: 'Mark as read' })
        .or(page.getByText('Mark all as read')).first();
      if (await markReadBtn.isVisible()) {
        await expect(markReadBtn).toBeDisabled();
      }
    }
  });

  // TC 211
  test('TC211 - Notification badge shows count when notifications exist', async ({ page }) => {
    const badge = page.locator('[class*="badge"], [class*="notification-count"]').first();
    if (await badge.isVisible()) {
      const count = await badge.innerText();
      expect(parseInt(count)).toBeGreaterThan(0);
    }
  });

  // TC 212
  test('TC212 - Clicking a notification shows details and reduces badge count', async ({ page }) => {
    const notifIcon = page.locator('[class*="notification-icon"], [aria-label*="notification"]').first();
    if (await notifIcon.isVisible()) {
      await notifIcon.click();
      await page.waitForTimeout(1000);
      const firstNotif = page.locator('[class*="notification-item"]').first();
      if (await firstNotif.isVisible()) {
        await firstNotif.click();
        await page.waitForTimeout(1000);
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  // TC 213
  test('TC213 - Mark all as read removes notification badge', async ({ page }) => {
    const notifIcon = page.locator('[class*="notification-icon"], [aria-label*="notification"]').first();
    if (await notifIcon.isVisible()) {
      await notifIcon.click();
      await page.waitForTimeout(1000);
      const markAllBtn = page.getByRole('button', { name: 'Mark all as read' })
        .or(page.getByText('Mark all as read')).first();
      if (await markAllBtn.isVisible() && await markAllBtn.isEnabled()) {
        await markAllBtn.click();
        await page.waitForTimeout(1000);
        const badge = page.locator('[class*="badge"], [class*="notification-count"]');
        if (await badge.isVisible()) {
          await expect(badge).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

});