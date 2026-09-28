/**
 * Test case catalog — Part 2: signup, OTP, T&C and profile completion.
 */
import { PROD, ANY_ENV } from './tc-01-public.mjs';

export const part2 = [

// ══════════════════════════════════════════════════════════════════
// CREATE ACCOUNT WIZARD — tests/create-account.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'REG',
  module: 'Create Account (Signup Wizard)',
  spec: 'tests/create-account.spec.ts',
  command: 'npm run run:create-account',
  env: PROD,
  precondition: 'User is logged out. A disposable yopmail inbox is used for OTP retrieval. Steps run serially in one shared browser tab.',
  rows: [
    ['1. Navigate to /app/create-account.\n2. Wait for the language step to render.', 'URL: /app/create-account', 'Create Account page opens on Step 1 — Select Language.'],
    ['1. Open the Create Account page.\n2. Check the step heading and the Aastrika logo.', '-', 'Step heading and Aastrika logo are both visible.'],
    ['1. Open the Create Account page.\n2. Do not select any language.\n3. Inspect the Next button state.', 'Language: (none selected)', '"Next" button is disabled until a language is chosen.'],
    ['1. Open the Create Account page.\n2. Click the first language option.', 'Language: English (index 0)', 'English is selectable and becomes highlighted/selected.'],
    ['1. Open the Create Account page.\n2. Click the second language option.', 'Language: Hindi (index 1)', 'Hindi is selectable and becomes highlighted/selected.'],
    ['1. Select English.\n2. Then select Hindi.\n3. Inspect both options.', 'Language: English then Hindi', 'Selection is single-choice — choosing one language unselects the other.'],
    ['1. Select any language.\n2. Inspect the Next button state.', 'Language: English', '"Next" button becomes enabled once a language is selected.'],
    ['1. Select a language and click Next.\n2. Wait for the signup form to render.', 'Click: Next', 'Step 2 "Create your account" form screen is displayed.'],
    ['1. Reach the signup form.\n2. Verify each field and the login-method options.', '-', 'First name, Last name, Email/Phone fields and the "By OTP" / "By Password" login-method options are all visible.'],
    ['1. Reach the signup form.\n2. Leave all fields empty.\n3. Inspect the Next button state.', 'All fields: (empty)', '"Next" button is disabled while required fields are empty.'],
    ['1. Reach the signup form.\n2. Type into First name, Last name and Email.', 'First: Test, Last: User, Email: <generated>@yopmail.com', 'All three fields accept text input and echo the typed values.'],
    ['1. Reach the signup form.\n2. Type a 10-digit phone number into the email/identifier field.', 'Phone: 10-digit number', 'The identifier field accepts a phone number as well as an email address.'],
    ['1. Fill the signup form with a fresh yopmail address.\n2. Select the "By OTP" login method.\n3. Click Next.', 'Email: <generated>@yopmail.com, Method: By OTP', 'Form is submitted and the flow advances past the form step.'],
    ['1. Submit the signup form.\n2. Read the confirmation modal.\n3. Click "Confirm name".', 'Click: Confirm name', 'Name confirmation modal appears showing the entered name; confirming advances to the OTP screen.'],
    ['1. Confirm the name.\n2. Wait for the OTP screen.', '-', 'OTP verification screen is displayed with the code input.'],
    ['1. Open the yopmail inbox for the signup address.\n2. Read the latest OTP mail and extract the code.\n3. Enter the code and submit.', 'OTP: fetched from yopmail inbox', 'The OTP is retrieved and accepted by the portal.'],
    ['1. Submit the correct OTP.\n2. Observe the landing page.', '-', 'Account creation succeeds and the user lands on the Terms of Use page or the logged-in Home page.'],
    ['1. Open a fresh signup tab.\n2. Complete the wizard using a phone number and the "By Password" method.\n3. Submit.', 'Phone + Password: Sunbird@123, Method: By Password', 'Signup completes successfully through the phone + password path.'],
    ['1. Create a brand-new user with email + OTP.\n2. Continue until the Terms & Conditions page.', 'Email: <generated>@yopmail.com', 'New user reaches the Terms & Conditions (T&C) page.'],
    ['1. On the T&C page, tick the agreement checkbox.\n2. Click Accept.', 'Check: I have read and agree; Click: Accept', 'T&C is accepted and the user lands on the logged-in Home page.'],
    ['1. Set the viewport to 390 x 844.\n2. Open Create Account, select a language and click Next.', 'Viewport: 390x844 (Mobile)', '"Create your account" form renders correctly at mobile width.'],
    ['1. Set the viewport to 768 x 1024.\n2. Open Create Account, select a language and click Next.', 'Viewport: 768x1024 (Tablet)', '"Create your account" form renders correctly at tablet width.'],
    ['1. Set the viewport to 1440 x 900.\n2. Open Create Account, select a language and click Next.', 'Viewport: 1440x900 (Desktop)', '"Create your account" form renders correctly at desktop width.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// OTP + TERMS OF USE — tests/OTP.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'OTP',
  module: 'OTP Verification & Terms of Use',
  spec: 'tests/OTP.spec.ts',
  command: 'npm run run:otp',
  env: PROD,
  precondition: 'A fresh signup has been submitted so the OTP screen is reachable. yopmail is used to read the OTP mail.',
  rows: [
    ['1. Reach the OTP screen after submitting signup.\n2. Read the main heading.', '-', '"Check your Email!" heading is visible.'],
    ['1. Reach the OTP screen.\n2. Read the sub-heading below the title.', 'Email used at signup', 'Sub-heading displays the exact email address the OTP was sent to.'],
    ['1. Reach the OTP screen.\n2. Locate the illustration graphic.', '-', 'Phone illustration image is visible.'],
    ['1. Reach the OTP screen.\n2. Read the expiry timer.\n3. Wait a few seconds and read it again.', '-', 'OTP expiry timer is visible and visibly counting down.'],
    ['1. Reach the OTP screen.\n2. Type digits into the code input.', 'OTP: numeric digits', 'Code input is visible and accepts numeric input.'],
    ['1. Reach the OTP screen.\n2. Look for the resend prompt.', '-', '"Did not receive a OTP?" text and the resend link are visible.'],
    ['1. Reach the OTP screen.\n2. Click the resend link.', 'Click: Resend', 'Resend link is clickable and triggers a new OTP request.'],
    ['1. Reach the OTP screen.\n2. Leave the code field empty.\n3. Inspect the Next button.', 'OTP: (empty)', '"Next" button is visible but disabled while the code field is empty.'],
    ['1. Reach the OTP screen.\n2. Enter an incorrect OTP.\n3. Submit.', 'OTP: invalid code', 'An error message is displayed and the user is not allowed through.'],
    ['1. Complete signup.\n2. Fetch the real OTP from the yopmail inbox.\n3. Submit the OTP.\n4. Accept the Terms of Use.\n5. Observe the landing page.', 'OTP: fetched from yopmail', 'Full flow succeeds end to end — OTP accepted, Terms accepted, and the user lands on an authenticated private page.'],
    ['1. Reach the Terms of Use screen.\n2. Read the page heading.', '-', '"Terms of Use" heading is visible.'],
    ['1. Reach the Terms of Use screen.\n2. Locate the illustration.', '-', 'Illustration is visible on the Terms of Use page.'],
    ['1. Reach the Terms of Use screen.\n2. Locate and click the Decline button.', 'Click: Decline', 'Decline button is visible and clickable.'],
    ['1. Reach the Terms of Use screen.\n2. Tick the agreement checkbox (Accept enables).\n3. Untick the checkbox.\n4. Inspect the Accept button.', 'Uncheck: agreement checkbox', 'Unchecking the box disables the Accept button again.'],
    ['1. Reach the Terms of Use screen.\n2. Locate the Terms of Use hyperlink.', '-', 'Terms of Use link is visible on the page.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// POSITIVE FLOW — tests/positiveflow.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'PF',
  module: 'End-to-End Positive Flow (Signup - T&C - Profile)',
  spec: 'tests/positiveflow.spec.ts',
  command: 'npx playwright test tests/positiveflow.spec.ts --headed',
  env: PROD,
  precondition: 'Logged out. Runs serially in one browser tab; each step depends on the previous one. yopmail supplies the OTP.',
  rows: [
    ['Step 01 — Navigate to the Create Account page and wait for it to render.', 'URL: /app/create-account', 'Create Account page opens on the language step.'],
    ['Step 02 — Select the language "English" and click Next.', 'Language: English', 'English is selected and the flow advances to the signup form.'],
    ['Step 03 — Fill in First name, Last name and Email.', 'First: Test, Last: User, Email: <generated>@yopmail.com', 'All three fields accept and retain the entered values.'],
    ['Step 04 — Choose the "By OTP" login method.', 'Method: By OTP', '"By OTP" option is selected.'],
    ['Step 05 — Click Next to submit the signup form.', 'Click: Next', 'Signup form is submitted successfully.'],
    ['Step 06 — Click "Confirm name" on the confirmation modal.', 'Click: Confirm name', 'Name is confirmed and the OTP screen is displayed.'],
    ['Step 07 — Open the yopmail inbox, read the OTP mail and enter the code.', 'OTP: fetched from yopmail', 'The OTP code is retrieved and entered into the code field.'],
    ['Step 08 — Click Next to submit the OTP.', 'Click: Next', 'OTP is accepted and the flow advances.'],
    ['Step 09 — Verify the Terms of Use page is displayed.', '-', 'Terms of Use page is shown after OTP verification.'],
    ['Step 10 — Tick the "I have read and agree" checkbox.', 'Check: agreement checkbox', 'Checkbox is ticked and the Accept button becomes enabled.'],
    ['Step 11 — Click Accept on the Terms of Use page.', 'Click: Accept', 'Terms are accepted and the user proceeds into the app.'],
    ['Step 12 — Open the profile form ("Tell us more about you").', '-', 'The "Tell us more about you" profile form is displayed.'],
    ['Step 13 — Select the Date of Birth Year.', 'DOB Year: 1995', 'Year 1995 is selected in the DOB Year dropdown.'],
    ['Step 14 — Select the Date of Birth Month.', 'DOB Month: January', 'January is selected in the DOB Month dropdown.'],
    ['Step 15 — Select the Date of Birth Date.', 'DOB Date: 15', 'Date 15 is selected in the DOB Date dropdown.'],
    ['Step 16 — Select the Country.', 'Country: India', 'India is selected and the State dropdown is populated.'],
    ['Step 17 — Select the State.', 'State: Karnataka', 'Karnataka is selected and the City dropdown is populated.'],
    ['Step 18 — Select the City.', 'City: Bengaluru', 'Bengaluru is selected.'],
    ['Step 19 — Click Next to move to background selection.', 'Click: Next', '"Choose your background" screen is displayed.'],
    ['Step 20 — Select the background "Healthcare Worker".', 'Background: Healthcare Worker', 'Healthcare Worker is selected and the "Almost done!" role form opens.'],
    ['Step 21 — Select the Designation.', 'Designation: BSC Nurse', 'BSC Nurse is selected in the Designation dropdown.'],
    ['Step 22 — Fill the RN/RM Number field.', 'RN/RM Number: sample value', 'RN/RM Number is accepted by the field.'],
    ['Step 23 — Select the Organization Type.', 'Organization Type: sample value', 'Organization Type is selected.'],
    ['Step 24 — Fill the Organization Name field.', 'Organization Name: sample value', 'Organization Name is accepted by the field.'],
    ['Step 25 — Click Done to submit the profile.', 'Click: Done', 'Profile is submitted without error.'],
    ['Step 26 — Verify the profile form is no longer displayed.', '-', 'The profile form is dismissed and the user is on an authenticated private page — onboarding is complete.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// PROFILE COMPLETION — ELEMENT COVERAGE — tests/Profile/ProfileCompletion.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'PRF',
  module: 'Profile Completion — Element Coverage',
  spec: 'tests/Profile/ProfileCompletion.spec.ts',
  command: 'npx playwright test tests/Profile/ProfileCompletion.spec.ts --headed',
  env: PROD,
  precondition: 'Single automated test that creates one fresh account and walks every background. Each row below is a verification point inside that run.',
  rows: [
    ['1. Generate a unique yopmail address.\n2. Complete signup + OTP to create a brand-new account.', 'Email: <unique>@yopmail.com', 'A fresh account is created and reaches the authenticated area.'],
    ['1. After signup, open the profile form.', '-', 'The "Tell us more about you" profile form opens.'],
    ['1. On the Tell-Us-More screen, verify every element: heading, DOB Year/Month/Date dropdowns, Country/State/City dropdowns and the Next button.', '-', 'All Tell-Us-More screen elements are present and rendered.'],
    ['1. Set DOB Year and Month.\n2. Read the Date dropdown options.', 'DOB Year + Month', 'The Date dropdown is populated with the correct number of day options for the chosen month (28-31).'],
    ['1. Fill every field on the Tell-Us-More form.\n2. Inspect the Next button state.', 'Full Tell-Us-More data', '"Next" button becomes enabled once all required fields are filled.'],
    ['1. Click Next from Tell-Us-More.\n2. Verify the Choose-Background screen elements.', 'Click: Next', '"Choose your background" screen is displayed with all six background options.'],
    ['1. Select the background "Healthcare Worker".\n2. Verify the "Almost done!" form fields for that role.', 'Background: Healthcare Worker', 'Role-specific fields (Designation, RN/RM Number, Organization Type, Organization Name) are rendered.'],
    ['1. Click "Change" to return to background selection.\n2. Select "Healthcare Volunteer".\n3. Verify its "Almost done!" fields.', 'Background: Healthcare Volunteer', 'Correct role-specific fields are rendered for Healthcare Volunteer.'],
    ['1. Click "Change".\n2. Select "ASHA".\n3. Verify its "Almost done!" fields.', 'Background: ASHA', 'Correct role-specific fields (Block, Sub Centre) are rendered for ASHA.'],
    ['1. Click "Change".\n2. Select "Student".\n3. Verify its "Almost done!" fields.', 'Background: Student', 'Correct role-specific fields (Designation, Institution Name, Qualification) are rendered for Student.'],
    ['1. Click "Change".\n2. Select "Faculty".\n3. Verify its "Almost done!" fields.', 'Background: Faculty', 'Correct role-specific fields (Designation, Institution Name) are rendered for Faculty.'],
    ['1. Click "Change".\n2. Select "Others".\n3. Verify its "Almost done!" fields.', 'Background: Others', 'Correct role-specific field (Sub-background) is rendered for Others.'],
    ['1. Verify the "Change" link returns to the background list from every role form.', 'Click: Change', 'The "Choose your background" screen reappears each time, so a user can switch roles freely.'],
    ['1. Select Healthcare Worker for the final save.\n2. Fill all role fields.\n3. Inspect the Done button state.', 'Healthcare Worker full data', '"Done" button becomes enabled once all role-specific required fields are filled.'],
    ['1. Click Done.\n2. Check the final URL and the form visibility.', 'Click: Done', 'Profile saves, the form is dismissed, and the user lands on an authenticated private page.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// PROFILE COMPLETION — POSITIVE FLOW — tests/Profile/BGVPositive.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'BGV',
  module: 'Profile Completion — Positive Flow (Healthcare Worker)',
  spec: 'tests/Profile/BGVPositive.spec.ts',
  command: 'npx playwright test tests/Profile/BGVPositive.spec.ts --headed',
  env: PROD,
  precondition: 'Reuses the account in .last-registered-email.json if present, otherwise creates a fresh one. Each row is a verification point inside the single automated test.',
  rows: [
    ['1. Read .last-registered-email.json.\n2. If an email is stored, log in with that account; otherwise generate a new yopmail address and sign up.', 'Stored email OR <generated>@yopmail.com', 'A usable account session is established — either the stored account logs in, or a fresh account is created via signup + OTP.'],
    ['1. After login/signup, inspect the current screen.\n2. Classify the flow state (home / tell-us-more / choose-bg / almost-done).', '-', 'The current onboarding state is correctly detected so the run can resume from the right step.'],
    ['1. If the user landed on Home, click Account to open the profile form.', 'Click: Account', 'The "Tell us more about you" profile form is opened.'],
    ['1. Fill the Tell-Us-More form (DOB, Country, State, City).\n2. Click Next.', 'DOB + India / Karnataka / Bengaluru', 'All fields are accepted and the flow advances to background selection.'],
    ['1. On the background screen, select "Healthcare Worker".', 'Background: Healthcare Worker', 'Healthcare Worker is selected and the "Almost done!" form opens.'],
    ['1. Fill the Healthcare Worker "Almost done!" fields.\n2. Click Done.', 'Designation, RN/RM Number, Organization Type, Organization Name', 'All role fields are accepted and the profile is submitted.'],
    ['1. After Done, read the final URL.\n2. Check that neither "Tell us more about you" nor "Almost done!" is still visible.', '-', 'The user is on an authenticated private page and the profile form is gone — profile completion succeeded.'],
    ['1. On success, clear .last-registered-email.json.\n2. On failure, keep it.', '-', 'The stored-email record is cleared after a successful completion so the next run starts a fresh account, and retained on failure so the same account can be retried.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// ONE ACCOUNT PER ROLE — tests/Profile/ALL-Roles.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'ROL',
  module: 'Profile Completion — One Account Per Role',
  spec: 'tests/Profile/ALL-Roles.spec.ts',
  command: 'npx playwright test tests/Profile/ALL-Roles.spec.ts --headed',
  env: PROD,
  precondition: 'Serial run. Creates one brand-new account per background role and records the credentials in registered-accounts.xlsx.',
  rows: [
    ['1. Create a fresh account (new yopmail address, OTP signup).\n2. Fill Tell-Us-More and click Next.\n3. Select the role.\n4. Fill all role-specific fields.\n5. Click Done (real save).\n6. Append the role + email to registered-accounts.xlsx.', 'Background: Healthcare Worker | Designation, RN/RM Number, Organization Type, Organization Name', 'Account is created, the Healthcare Worker profile saves successfully, and credentials are written to the tracking workbook.'],
    ['1-6. Same flow as above for this role.', 'Background: Healthcare Volunteer | role-specific fields', 'Account is created, the Healthcare Volunteer profile saves successfully, and credentials are recorded.'],
    ['1-6. Same flow as above for this role.', 'Background: ASHA | Block: Test Block, Sub Centre: Test Sub Centre', 'Account is created, the ASHA profile saves successfully, and credentials are recorded.'],
    ['1-6. Same flow as above for this role.', 'Background: Student | Designation: Bsc nursing, Institution: Aastrika Institute, Qualification: Bsc Nursing', 'Account is created, the Student profile saves successfully, and credentials are recorded.'],
    ['1-6. Same flow as above for this role.', 'Background: Faculty | Designation: Nursing Faculty, Institution: Aastrika Institute', 'Account is created, the Faculty profile saves successfully, and credentials are recorded.'],
    ['1-6. Same flow as above for this role.', 'Background: Others | Sub-background: Mother/Family Members', 'Account is created, the Others profile saves successfully, and credentials are recorded.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// ONE ACCOUNT PER ROLE (HARDENED) — tests/Profile/ALL-BGV.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'ABG',
  module: 'Profile Completion — All Backgrounds (hardened)',
  spec: 'tests/Profile/ALL-BGV.spec.ts',
  command: 'npx playwright test tests/Profile/ALL-BGV.spec.ts --headed',
  env: PROD,
  precondition: 'Hardened variant of ALL-Roles: re-declares the xlsx column schema on append and auto-fills any unknown required field the portal adds.',
  rows: [
    ['1. Create a fresh account (new yopmail address, OTP signup).\n2. Fill Tell-Us-More and click Next.\n3. Select the role and fill every role-specific field.\n4. Auto-fill any remaining visible empty required field.\n5. Click Done.\n6. Append role + email + form data to registered-accounts.xlsx.', 'Background: Healthcare Worker | full role data', 'Profile saves for Healthcare Worker, unknown extra fields are auto-filled, and the row is appended with the correct column mapping.'],
    ['1-6. Same flow as above for this role.', 'Background: Healthcare Volunteer | full role data', 'Profile saves for Healthcare Volunteer and the row is appended correctly.'],
    ['1-6. Same flow as above for this role.', 'Background: ASHA | Block: Test Block, Sub Centre: Test Sub Centre', 'Profile saves for ASHA and the row is appended correctly.'],
    ['1-6. Same flow as above for this role.', 'Background: Student | Designation: Bsc nursing, Institution: Aastrika Institute, Qualification: Bsc Nursing', 'Profile saves for Student and the row is appended correctly.'],
    ['1-6. Same flow as above for this role.', 'Background: Faculty | Designation: Nursing Faculty, Institution: Aastrika Institute', 'Profile saves for Faculty and the row is appended correctly.'],
    ['1-6. Same flow as above for this role.', 'Background: Others | Sub-background: Mother/Family Members', 'Profile saves for Others and the row is appended correctly.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// LOGIN VERIFICATION — tests/login-check.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'LCK',
  module: 'Login Verification (Existing Credentials)',
  spec: 'tests/login-check.spec.ts',
  command: 'npm run login:check',
  env: ANY_ENV,
  precondition: 'An account already exists. LOGIN_ID / LOGIN_PASSWORD / LOGIN_METHOD are supplied by the interactive runner.',
  rows: [
    ['1. Open the login page.\n2. Switch to password mode.\n3. Enter the existing identifier and password.\n4. Submit and read the landing URL.', 'LOGIN_ID + LOGIN_PASSWORD', 'Login succeeds — the browser leaves /public/ and lands on an authenticated /page/* or /app/* route (home or the T&C gate).'],
    ['1. Open the login page in OTP mode.\n2. Enter the existing identifier and request an OTP.\n3. Fetch the OTP from the yopmail inbox.\n4. Submit and read the landing URL.', 'LOGIN_ID (yopmail account)', 'OTP login succeeds — the browser leaves /public/ and lands on an authenticated /page/* or /app/* route.'],
  ],
},
];
