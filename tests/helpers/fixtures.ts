// Playwright's base test object, renamed so we can export our extended version as `test`.
import { test as base } from '@playwright/test';
// The signup routine plus the two types describing its input and its result.
import { createSphereAccount, CreatedAccount, CreateAccountInput } from './createAccount';

// What a caller may override. `Omit` removes the two browser contexts — the fixture supplies those itself.
type CreateAccountOverrides = Omit<CreateAccountInput, 'appContext' | 'yopmailContext'>;

// The two fixtures this file adds on top of Playwright's built-ins.
type Fixtures = {
  // A ready-made account, created before the test body runs.
  freshAccount: CreatedAccount;
  // A factory the test can call itself, as many times as it likes.
  createAccount: (overrides?: CreateAccountOverrides) => Promise<CreatedAccount>;
};

// Extend the base test with our fixtures. Specs import `test` from here instead of from Playwright.
export const test = base.extend<Fixtures>({
  /**
   * Factory: call inside a test to spin up a brand-new account with overrides.
   *   const account = await createAccount({ firstName: 'Alice' });
   */
  createAccount: async ({ browser }, use) => {
    // Track every account made during this test so we can clean up afterwards.
    const created: CreatedAccount[] = [];

    // Everything before `use` is setup; `use` hands the value to the test; everything after is teardown.
    await use(async (overrides = {}) => {
      // One isolated browser context for the Sphere app…
      const appContext = await browser.newContext();
      // …and a separate one for yopmail, so their cookies never collide.
      const yopmailContext = await browser.newContext();
      // Run the real signup wizard, letting the caller's overrides win over the defaults.
      const account = await createSphereAccount({
        appContext,
        yopmailContext,
        ...overrides,
      });
      // Remember it for teardown.
      created.push(account);
      // contexts are tracked on the page; close them on teardown
      // Stash each context on the account object. The cast tells TypeScript about these
      // extra private fields, which aren't part of the public CreatedAccount type.
      (account as CreatedAccount & { _appContext?: typeof appContext; _yopmailContext?: typeof yopmailContext })._appContext = appContext;
      (account as CreatedAccount & { _appContext?: typeof appContext; _yopmailContext?: typeof yopmailContext })._yopmailContext = yopmailContext;
      // Hand the finished account back to the caller.
      return account;
    });

    // ── Teardown: runs after the test finishes, however it finished. ──
    for (const account of created) {
      // Cast again to reach the private context fields we attached above.
      const a = account as CreatedAccount & { _appContext?: { close: () => Promise<void> }; _yopmailContext?: { close: () => Promise<void> } };
      // Close the app context. `?.` skips it if the field is somehow missing.
      await a._appContext?.close();
      // Close the yopmail context too.
      await a._yopmailContext?.close();
    }
  },

  /**
   * Pre-built account ready to use:
   *   test('does X', async ({ freshAccount }) => { ... freshAccount.email ... });
   */
  freshAccount: async ({ createAccount }, use) => {
    // Build one account with all defaults, using the factory fixture above.
    const account = await createAccount();
    // Hand it to the test. Cleanup is handled by the createAccount fixture's own teardown.
    await use(account);
  },
});

// Re-export `expect` unchanged so specs can get both from this one file.
export { expect } from '@playwright/test';
