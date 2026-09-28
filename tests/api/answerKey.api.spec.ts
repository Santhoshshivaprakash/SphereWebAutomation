/**
 * Self-assessment answer-key contract.
 *
 * questionset hierarchy -> artifactUrl (public S3) -> quiz.json with isCorrect
 * flags. This is the deterministic engine behind Competency.spec.ts. We assert
 * the pipeline holds; a POISONED bank (all isCorrect:false — Sphere does this
 * on some competency quizzes) is a valid, documented outcome, not a failure.
 *
 * Provide a real quiz do_id via SPHERE_TEST_QUIZ_ID (the do_ part of a running
 * /viewer/quiz/<do_id>?... URL).
 */
// Our fixtures file — supplies the `sphereApi` client.
import { test, expect } from '../helpers/apiFixtures';
// `quizIdFromUrl` pulls a do_ id out of a player URL; `hasApiCreds` checks config.
import { hasApiCreds, quizIdFromUrl } from '../helpers/sphereApi';

// Which quiz to inspect. Empty unless you set it — the second test skips without it.
const QUIZ_ID = process.env.SPHERE_TEST_QUIZ_ID || '';

// Group for the answer-key pipeline. @api marks it as a no-browser test.
test.describe('Answer key @api', () => {
  // Skip cleanly when credentials are missing.
  test.skip(!hasApiCreds(), 'SPHERE_API_TOKEN / cookie not set — configure .env');

  // A pure unit test — no network, no fixtures, just the URL parser.
  test('extracts quiz id from a player URL', () => {
    // A real quiz player URL should yield just the do_ id, query string discarded.
    expect(quizIdFromUrl('https://sphere.aastrika.org/viewer/quiz/do_12345?foo=bar')).toBe('do_12345');
    // A course TOC URL is NOT a quiz URL, so it must return null rather than a wrong id.
    expect(quizIdFromUrl('/app/toc/do_999/overview')).toBeNull();
  });

  // The real pipeline check: hierarchy → artifactUrl → downloadable answer key.
  test('resolves an artifactUrl and reports usable vs poisoned', async ({ sphereApi }) => {
    // Nothing to inspect without a quiz id, so skip rather than fail.
    test.skip(!QUIZ_ID, 'SPHERE_TEST_QUIZ_ID not set — provide a quiz do_id to run this');

    // Step 1: fetch the questionset's hierarchy from the content API.
    const qs = await sphereApi.questionsetHierarchy(QUIZ_ID);
    // It must point at an artifact file — that's the link to the answers.
    expect(qs.artifactUrl, 'questionset should expose an artifactUrl').toBeTruthy();

    // Step 2: download and parse that artifact into a usable answer key.
    const key = await sphereApi.fetchAnswerKey(QUIZ_ID);
    // The bank must contain at least one question.
    expect(key.size, 'artifact should contain questions').toBeGreaterThan(0);
    // "Poisoned" means every isCorrect flag is false — Sphere does this deliberately on some quizzes.
    if (key.poisoned) {
      // That's a valid, documented outcome, so just report it rather than failing.
      console.log(`Quiz ${QUIZ_ID} is POISONED (no isCorrect flags) — Gemini fallback needed.`);
    } else {
      // A healthy bank must actually name which options are correct.
      expect(key.correctOptionIds.size, 'usable key needs correct optionIds').toBeGreaterThan(0);
    }
  });
});
