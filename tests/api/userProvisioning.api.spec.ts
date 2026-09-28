/**
 * End-to-end user-provisioning contract:
 *   getOrgChannel -> createUser -> assignRole -> userSearch confirms.
 * This is also the fast API path that can replace the UI signup wizard, so
 * keeping it green protects both the API surface and any UI test built on it.
 */
// `provisionUser` runs the whole create-user chain in one call; the rest is our fixtures file.
import { test, expect, provisionUser } from '../helpers/apiFixtures';
// Tells us whether API credentials are configured.
import { hasApiCreds } from '../helpers/sphereApi';
// Looks up an organisation's details (orgId, channel) by its short key.
import { getOrg } from '../helpers/orgs';

// Group for the provisioning contract. @api marks it as a no-browser test.
test.describe('User provisioning @api', () => {
  // Skip cleanly rather than fail when credentials are missing.
  test.skip(!hasApiCreds(), 'SPHERE_API_TOKEN / cookie not set — configure .env');

  // The happy path: create a user, then prove the server really knows about them.
  test('creates a BNRC user, assigns PUBLIC role, and finds it via search', async ({ sphereApi }) => {
    // Run the full chain — org lookup, create, assign role — against the BNRC org.
    const user = await provisionUser(sphereApi, 'BNRC');

    // The returned id must look like a real UUID-ish identifier, not an empty string or an error.
    expect(user.userId).toMatch(/^[0-9a-f-]{20,}$/i);
    // Provisioned users always get a yopmail address.
    expect(user.email).toContain('@yopmail.com');

    // Now search for that user by id. Destructuring takes the first (and only) match.
    const [found] = await sphereApi.userSearch({ userId: user.userId });
    // The second argument to expect() is a message shown when the assertion fails.
    expect(found, 'created user should be searchable').toBeTruthy();
    // The user must belong to the organisation we created them under.
    expect(found.rootOrgId).toBe(getOrg('BNRC').orgId);

    // Roles can live in two places, so gather both into one flat list.
    const roles: string[] = (found.organisations ?? [])
      // Pull the roles out of each organisation entry and flatten them into one array.
      .flatMap((o: any) => o.roles ?? [])
      // Then append any roles attached directly to the user record.
      .concat(found.roles ?? []);
    // The PUBLIC role must be among them.
    expect(roles).toContain('PUBLIC');
  });

  // Negative case: an incomplete body must be rejected, not silently accepted.
  test('createUser rejects a malformed body (missing required fields)', async ({ sphereApi }) => {
    // Send only an email — no name, no password, no channel.
    const res = await sphereApi.rawPost('/api/user/v3/create', {
      request: { email: 'incomplete@yopmail.com' },
    });
    // `ok()` is true for any 2xx. We want it FALSE — i.e. the server refused. The message prints the real status.
    expect(res.ok(), `expected client error, got ${res.status()}`).toBeFalsy();
  });
});
