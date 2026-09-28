// The two browser contexts this helper drives, the Page type, and the assertion library.
import { BrowserContext, Page, expect } from '@playwright/test';
// Node's file system module — used to append the generated email to a log file.
import * as fs from 'fs';
// Node's path module — resolves that log file's location.
import * as path from 'path';
// The yopmail OTP reader and the random-address generator.
import { fetchOtpFromYopmail, generateRandomYopmail } from './yopmail';

// Which environment to sign up on.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// Everything a caller can pass in. Only the two contexts are required; the rest have defaults.
export interface CreateAccountInput {
  // The context the Sphere app runs in.
  appContext: BrowserContext;
  // A SEPARATE context for yopmail, so the two sites' cookies never collide.
  yopmailContext: BrowserContext;
  firstName?: string;
  lastName?: string;
  password?: string;
  email?: string;
  // `Partial` means you can override just one profile field and keep the rest.
  profile?: Partial<ProfileDetails>;
  baseUrl?: string;
  // Pass `false` to skip writing the email to a file.
  saveEmailToFile?: string | false;
}

// The onboarding answers filled in after signup.
export interface ProfileDetails {
  birthYear: string;
  birthMonth: string;
  birthDate: string;
  country: string;
  profession: string;
  rnRmNumber: string;
  orgType: string;
  organization: string;
}

// What the caller gets back once the account exists.
export interface CreatedAccount {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  // The live, logged-in tab — returned open so the caller can keep using it.
  appPage: Page;
  // The session cookie, handy for API calls as this user.
  connectSid?: string;
}

// Used for any profile field the caller didn't override.
const DEFAULT_PROFILE: ProfileDetails = {
  birthYear: '1994',
  birthMonth: 'December',
  birthDate: '21',
  country: 'Zambia',
  profession: 'Community Health Officer (CHO)',
  rnRmNumber: '54321',
  orgType: 'Private Sector',
  organization: 'Aastrika',
};

// Drives the entire signup wizard end to end and returns the finished account.
export async function createSphereAccount(input: CreateAccountInput): Promise<CreatedAccount> {
  // Destructure the input, supplying a default for everything optional.
  const {
    appContext,
    yopmailContext,
    firstName = 'creator',
    lastName = 'Sun',
    password = 'Sample@123',
    // Generate a throwaway address unless one was supplied.
    email = generateRandomYopmail(),
    profile = {},
    baseUrl = `${BASE_URL}`,
    saveEmailToFile = 'lastGeneratedEmail.txt',
  } = input;

  // Merge the caller's overrides over the defaults — later keys win.
  const fullProfile: ProfileDetails = { ...DEFAULT_PROFILE, ...profile };
  // A tab for the Sphere app.
  const page = await appContext.newPage();
  // A tab for yopmail, in its own context.
  const yopmailPage = await yopmailContext.newPage();

  // Log which address we're using.
  console.log('Generated email:', email);
  // Append it to the running log, unless the caller opted out.
  if (saveEmailToFile) {
    // `appendFileSync` adds to the file rather than overwriting it, so the log accumulates.
    fs.appendFileSync(path.resolve(saveEmailToFile), email + '\n');
  }

  // Step 1: open home
  await page.goto(`${baseUrl}/public/home`);
  // Wait for the network to settle.
  await page.waitForLoadState('networkidle');
  // Then give Angular time to paint.
  await page.waitForTimeout(3000);

  // Step 2: pick the create-account radio (handles both render variants)
  // Material's auto-generated ids shift between builds, so try both known ones.
  const radio1 = page.locator('(//input[@id="mat-radio-2-input"])[1]');
  const radio2 = page.locator('(//input[@id="mat-radio-3-input"])[1]');
  // Use whichever exists. `count() > 0` means "is present in the DOM".
  if (await radio1.count() > 0) {
    await radio1.click();
  } else if (await radio2.count() > 0) {
    await radio2.click();
  }
  // Let the selection register.
  await page.waitForTimeout(2000);
  // Move on to the signup wizard.
  await page.getByRole('button', { name: 'Create Account' }).click();
  // Wait for the language screen.
  await page.waitForTimeout(3000);

  // Step 3: pick English
  await page.locator('input#mat-radio-2-input').click();
  // Advance to the registration form.
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 4: registration form
  await page.locator('input#firstname').fill(firstName);
  await page.locator('input#lastname').fill(lastName);
  // Keep a handle on the email field so we can read it back.
  const emailField = page.locator('input#email-field');
  await emailField.fill(email);
  // Confirm the value actually stuck before submitting — a truncated email would be hard to debug later.
  await expect(emailField).toHaveValue(email);
  await page.locator('input#mat-radio-6-input').click(); // By password
  // Submit the form.
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 5: confirm name
  // Sphere prints this name on certificates, so it asks the user to confirm it.
  await page.getByRole('button', { name: 'Confirm name' }).click();

  // Step 6: password
  await page.locator('input#password-field').fill(password);
  // The confirmation box must match.
  await page.locator('input#confpassword-field').fill(password);
  await page.getByRole('button', { name: 'Next' }).click();
  // Give the backend time to create the account and send the verification mail.
  await page.waitForTimeout(5000);

  // Step 7+8: OTP
  // Read the real code out of the yopmail inbox, in the second tab.
  const otp = await fetchOtpFromYopmail(yopmailPage, email);
  // The OTP box on the signup screen.
  const otpField = page.locator("(//input[@id='code'])[1]");
  // Type the code.
  await otpField.fill(otp);
  // Enter submits it.
  await otpField.press('Enter');

  // Step 9: accept terms
  // Tick the consent checkbox — Accept is gated on it.
  await page.locator('input#mat-mdc-checkbox-1-input').check();
  // Let the button enable.
  await page.waitForTimeout(2000);
  // Accept the terms.
  await page.getByRole('button', { name: 'Accept' }).click();
  // Wait for the redirect into the app.
  await page.waitForTimeout(5000);

  // Step 10: nav to account (responsive)
  // On narrow layouts the nav collapses behind a hamburger icon.
  const menuIcon = page.locator("img[alt='menu']");
  // Use whichever navigation the current layout offers.
  if (await menuIcon.isVisible()) {
    await menuIcon.click();
  } else {
    await page.getByText('Account').click();
  }
  // Wait for the profile screen.
  await page.waitForTimeout(3000);

  // Step 11: profile
  // Date of birth — year, month, day.
  await page.locator('select#year').selectOption(fullProfile.birthYear);
  await page.locator('select#month').selectOption(fullProfile.birthMonth);
  await page.locator('select#date').selectOption(fullProfile.birthDate);
  // Country.
  await page.locator('select#country').selectOption(fullProfile.country);
  // Advance to the next onboarding screen.
  await page.locator('button#next-btn').click();

  // Click the first card in the content area — an unlabelled tile, so it's addressed positionally.
  await page.locator("//div[@class='content']//div[1]//div[1]").click();

  // Professional details: role, registration number, organisation type and name.
  await page.locator('select#profession').selectOption(fullProfile.profession);
  await page.locator("input[placeholder='RN/RM Number']").fill(fullProfile.rnRmNumber);
  await page.locator('select#orgType').selectOption(fullProfile.orgType);
  await page.locator("input[placeholder='Organization Name']").fill(fullProfile.organization);
  // Finish onboarding.
  await page.locator('button#done-btn').click();
  // Give the profile save time to complete.
  await page.waitForTimeout(8000);

  // Read the context's cookies so we can hand back the session id.
  const cookies = await appContext.cookies();
  // Find the Express session cookie. `?.` yields undefined if it isn't there.
  const connectSid = cookies.find((c) => c.name === 'connect.sid')?.value;

  // Done with yopmail — close that tab. The app tab stays open for the caller.
  await yopmailPage.close();

  // Hand back everything the caller needs, including the live logged-in page.
  return { email, password, firstName, lastName, appPage: page, connectSid };
}

// Wipes browser storage — useful for testing a "returning user with no session" state.
export async function clearAppStorage(page: Page) {
  // Runs inside the browser, where `window` exists.
  await page.evaluate(() => {
    // Clear persistent storage (survives tab close).
    window.localStorage.clear();
    // And per-tab storage.
    window.sessionStorage.clear();
  });
}
