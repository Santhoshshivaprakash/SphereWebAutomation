/**
 * Org search contract (POST /api/org/v1/search). The channel resolved here is
 * what create-user validates byte-for-byte, so it's load-bearing.
 */
// Our own fixtures file — supplies the `sphereApi` client fixture used below.
import { test, expect } from '../helpers/apiFixtures';
// Tells us whether API credentials are configured.
import { hasApiCreds } from '../helpers/sphereApi';
// The table of known organisations (key, orgId, …) this suite checks.
import { ORGS } from '../helpers/orgs';

// Group for the org-search contract. @api tags it as a no-browser API test.
test.describe('Org search @api', () => {
  // Skip cleanly instead of failing when credentials are absent.
  test.skip(!hasApiCreds(), 'SPHERE_API_TOKEN / cookie not set — configure .env');

  // Generate one test per known org instead of writing the same test repeatedly.
  for (const org of Object.values(ORGS)) {
    // Name the test after the org so a failure says which one broke.
    test(`resolves a channel for ${org.key}`, async ({ sphereApi }) => {
      // Ask the API to look this organisation up by its id.
      const record = await sphereApi.orgSearch(org.orgId);
      // The record we got back must be the one we asked for.
      expect(record.id).toBe(org.orgId);
      // It must carry a channel, and that channel must be a string…
      expect(typeof record.channel).toBe('string');
      // …and not an empty one, since create-user compares it byte-for-byte.
      expect(record.channel.length).toBeGreaterThan(0);
    });
  }

  // Negative case: a made-up id must come back empty, not error or return something random.
  test('returns an empty result for an unknown org id', async ({ sphereApi }) => {
    // Post the raw search payload with an id that cannot exist.
    const res = await sphereApi.rawPost('/api/org/v1/search', {
      request: { filters: { id: 'does-not-exist-000000000000' } },
    });
    // The call itself should still succeed at the HTTP level (2xx).
    expect(res.ok()).toBeTruthy();
    // Parse the JSON body.
    const body = await res.json();
    // The content array must be empty. `?? []` guards against the key being absent entirely.
    expect(body?.result?.response?.content ?? []).toHaveLength(0);
  });
});
