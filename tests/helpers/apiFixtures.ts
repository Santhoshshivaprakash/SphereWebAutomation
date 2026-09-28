/**
 * API-layer fixtures.
 *
 *   sphereApi        — a SphereApiClient bound to the test's request context.
 *   provisionUser()  — create+role a fresh user via API (no signup wizard).
 *   apiAccount       — an auto-provisioned user (create + assign role); the fast
 *                      alternative to the UI-driven `freshAccount` fixture in
 *                      helpers/fixtures.ts.
 *
 * Import `test`/`expect` from here in API specs (or UI specs that want a fast,
 * API-provisioned account instead of the ~90s YOPmail signup flow).
 */
// Playwright's base test, renamed so we can export our extended version as `test`.
import { test as base } from '@playwright/test';
// The API client class, the shape of a provisioned user, and the credentials check.
import { SphereApiClient, ProvisionedUser, hasApiCreds } from './sphereApi';
// Looks an organisation up by its short key.
import { getOrg } from './orgs';
// Builds a random throwaway yopmail address.
import { generateRandomYopmail } from './yopmail';

// The password every provisioned user gets. Overridable, with a safe default.
const USER_PASSWORD = process.env.SPHERE_USER_PASSWORD || 'Sample@123';

/** Create + role a fresh user in the given org. Returns the credentials. */
export async function provisionUser(api: SphereApiClient, orgKey: string): Promise<ProvisionedUser> {
  // Look up the org's ids and email prefix.
  const org = getOrg(orgKey);
  // Resolve the real channel string from the API. It's fetched rather than hard-coded because
  // some orgs store invisible characters that can't be typed by hand.
  const channel = await api.getOrgChannel(org.orgId);
  // Build a unique address, prefixed so you can tell which org a user came from.
  const email = generateRandomYopmail(org.emailPrefix);
  // Create the user and keep the id the server assigns.
  const userId = await api.createUser({
    email,
    firstName: 'Sphere',
    lastName: 'ApiUser',
    password: USER_PASSWORD,
    channel,
  });
  // A freshly created user has no role, so grant one — without it they can't use the app.
  await api.assignRole(userId, org.orgId);
  // Hand back everything a caller needs to log in as this user.
  return { email, password: USER_PASSWORD, userId, orgKey };
}

// The two fixtures this file adds on top of Playwright's built-ins.
type ApiFixtures = {
  // An API client, ready to use.
  sphereApi: SphereApiClient;
  // A brand-new user, created before the test body runs.
  apiAccount: ProvisionedUser;
};

// Extend the base test. Specs import `test` from here to get these fixtures.
export const test = base.extend<ApiFixtures>({
  // Wrap Playwright's built-in `request` client in our own API class.
  sphereApi: async ({ request }, use) => {
    // `use` hands the value to the test; nothing to tear down afterwards.
    await use(new SphereApiClient(request));
  },
  // Provision a user before the test runs. Depends on the sphereApi fixture above.
  apiAccount: async ({ sphereApi }, use) => {
    // Fail fast with a helpful message rather than a confusing 401 deeper in.
    if (!hasApiCreds()) {
      throw new Error('apiAccount needs SPHERE_API_TOKEN + a cookie (SPHERE_API_COOKIE / SESSION_COOKIE) in .env');
    }
    // Create the user in the configured org, defaulting to BNRC.
    const user = await provisionUser(sphereApi, process.env.SPHERE_DEFAULT_ORG || 'BNRC');
    // Hand the credentials to the test.
    await use(user);
  },
});

// Re-export `expect` unchanged so specs can get both from this one file.
export { expect } from '@playwright/test';
