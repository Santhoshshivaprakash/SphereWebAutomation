/**
 * Auth contract for the private user-provisioning APIs.
 * Negative cases run without valid creds (CI-safe); the positive reachability
 * check skips when creds are absent.
 */
// Our fixtures file — supplies the `sphereApi` client.
import { test, expect } from '../helpers/apiFixtures';
// `authHeaders` builds the real auth headers; `hasApiCreds` reports whether they're configured.
import { hasApiCreds, authHeaders } from '../helpers/sphereApi';

// The protected endpoint these tests probe.
const CREATE_PATH = '/api/user/v3/create';
// A well-formed body — so a rejection can only be about AUTH, never about a bad payload.
const SAMPLE_BODY = {
  request: {
    email: 'noop@yopmail.com',
    firstName: 'X',
    lastName: 'Y',
    password: 'Sample@123',
    channel: 'Bihar Nursing Registration Council',
  },
};

// Group for the auth contract. Note: NO group-level skip — the negative tests run anywhere.
test.describe('API auth contract @api', () => {
  // With no Authorization header at all, the endpoint must refuse.
  test('rejects a request with no Authorization header', async ({ sphereApi }) => {
    // Send a valid body but only a Content-Type header — deliberately no auth.
    const res = await sphereApi.rawPost(CREATE_PATH, SAMPLE_BODY, {
      'Content-Type': 'application/json',
    });
    // Must NOT be a 2xx. The message prints the actual status if this fails.
    expect(res.ok(), `expected non-2xx, got ${res.status()}`).toBeFalsy();
    // And it must be a proper auth rejection — 419 is the session-expired code this stack uses.
    expect([401, 403, 419]).toContain(res.status());
  });

  // A made-up token and cookie must also be refused, not merely ignored.
  test('rejects a request with a bogus bearer token', async ({ sphereApi }) => {
    // Same valid body, but with junk credentials attached.
    const res = await sphereApi.rawPost(CREATE_PATH, SAMPLE_BODY, {
      'Content-Type': 'application/json',
      Authorization: 'bearer not-a-real-token',
      Cookie: 'connect.sid=not-a-real-cookie',
    });
    // Must be rejected. No status-code list here — any non-2xx is acceptable.
    expect(res.ok(), `expected non-2xx, got ${res.status()}`).toBeFalsy();
  });

  // The positive side: with real credentials configured, a protected call should work.
  test('accepts the configured session creds (org search reachable)', async ({ sphereApi }) => {
    // This one needs real creds, so skip it when they're absent.
    test.skip(!hasApiCreds(), 'SPHERE_API_TOKEN / cookie not set — configure .env');
    // Building the headers must not throw — i.e. the config is well-formed.
    expect(() => authHeaders()).not.toThrow();
    // Make an authenticated call against a known org id.
    const org = await sphereApi.orgSearch('014005962721189888281'); // BNRC
    // Getting a record back with a channel proves the credentials were accepted.
    expect(org).toHaveProperty('channel');
  });
});
