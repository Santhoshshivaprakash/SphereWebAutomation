/**
 * Regression: the case-study question bank that broke the
 * "Hypertension in Pregnancy" run on 2026-09-11.
 *
 * The bank has 9 questions across 2 case studies. Five share the CASE 1
 * description as their stem and four share the CASE 2 description. When the
 * player shows only that description, stem text cannot tell them apart — the
 * old matcher resolved all five CASE 1 questions to the first bank entry and
 * applied its answers to all of them.
 */
// Straight from Playwright — this is a pure unit test, no browser involved.
import { test, expect } from '@playwright/test';
// The function under test, its HTML-stripping helper, and the type it expects.
import { findMatchingQuestion, stripHtml, MatchableQuestion } from './questionMatch';

// Local type: a matchable question plus an `id`, so assertions can name which entry matched.
type Q = MatchableQuestion & { id: string };

// The CASE 1 description. Five questions share this exact text as their stem prefix.
const CASE1 = 'CASE: 1 Description: A 20-year-old woman, pregnant for her first time presents in week 32 of pregnancy.';
// The CASE 2 description. Four questions share this one.
const CASE2 = 'Case: 2 Description A 21-year-old pregnant woman, gravida 2 para 1, at 37 weeks of gestation.';

/** Shape mirrors the real artifact: shared stem prefix + distinct option sets. */
// Nine questions. The stems collide in pairs/groups; only the OPTIONS make each one unique.
const BANK: Q[] = [
  // q1 — CASE 1, 4 options. This is the entry the old matcher wrongly returned for all five CASE 1 stems.
  { id: 'q1', question: `${CASE1} What will you do first?`, options: [
    { text: 'Do urine analysis for proteinuria.' }, { text: 'Discuss family planning.' },
    { text: 'Measure blood pressure.' }, { text: 'Ask previous obstetric history.' }] },
  // q2 — CASE 1, 5 options.
  { id: 'q2', question: `${CASE1} She is diagnosed with severe pre-eclampsia. What next?`, options: [
    { text: 'Give IV Hydralazine and Magnesium sulphate' },
    { text: 'Give her Paracetamol, send her home and recommend drinking plenty of fluids' },
    { text: 'Assess urine for protein' }, { text: 'Assess foetal heart rate.' },
    { text: 'Ask for signs of severe pre-eclampsia.' }] },
  // q3 — CASE 1, 6 options.
  { id: 'q3', question: `${CASE1} After four hours she starts convulsions. What will you do?`, options: [
    { text: 'Call help and protect her from hurting herself.' },
    { text: 'Wait until fits spontaneously cease.' },
    { text: 'Treat blood pressure at or above 160 mmHg systolic with IV antihypertensives' },
    { text: 'Give Magnesium Sulphate 4 g IV as fast as possible (push).' },
    { text: 'Give loading dose of Magnesium Sulphate 14gm.' },
    { text: 'Give 2 litres of crystalloids fast.' }] },
  // q4 — CASE 1, 6 options.
  { id: 'q4', question: `${CASE1} Which monitoring is required?`, options: [
    { text: 'Monitor respiratory rate hourly.' }, { text: 'Monitor deep tendon reflexes.' },
    { text: 'Monitor urine output hourly.' }, { text: 'Stop all fluids.' },
    { text: 'Monitor blood pressure every 15 minutes.' }, { text: 'Discharge immediately.' }] },
  // q5 — CASE 1, 6 options. Used on its own by the "empty stem" test below.
  { id: 'q5', question: `${CASE1} What is the definitive management?`, options: [
    { text: 'Deliver the baby.' }, { text: 'Continue expectant management to term.' },
    { text: 'Start antihypertensives and review in a week.' }, { text: 'Administer corticosteroids.' },
    { text: 'Arrange referral to a higher facility.' }, { text: 'Do nothing.' }] },
  // q6 — CASE 2 starts here. 6 options.
  { id: 'q6', question: `${CASE2} What will you do?`, options: [
    { text: 'Refer to a higher-level health facility because of history of pre-eclampsia.' },
    { text: 'Give injection dexamethasone 6mg IM.' },
    { text: 'Perform vaginal examination to know cervical dilatation.' },
    { text: 'Tell her not to drink and eat as she is in labour.' },
    { text: 'Insert two large bore IV accesses.' },
    { text: 'Assess vital signs and ask for danger signs.' }] },
  // q7 — CASE 2, 5 options.
  { id: 'q7', question: `${CASE2} Which investigations?`, options: [
    { text: 'Complete blood count.' }, { text: 'Liver function tests.' },
    { text: 'Platelet count.' }, { text: 'No investigation needed.' },
    { text: 'Serum creatinine.' }] },
  // q8 — CASE 2, 6 options.
  { id: 'q8', question: `${CASE2} Which drugs would you prepare?`, options: [
    { text: 'Magnesium sulphate.' }, { text: 'Hydralazine.' }, { text: 'Labetalol.' },
    { text: 'Oxytocin for third stage.' }, { text: 'Aspirin 300mg.' }, { text: 'Ibuprofen.' }] },
  // q9 — CASE 2, 4 options. Note how similar these four are: only the dosage differs.
  { id: 'q9', question: `${CASE2} After 20 minutes of the loading dose of MgSo4 she convulses again. What now?`, options: [
    { text: 'Give 14gm (IM+IV) repeat dose of MgSo4.' },
    { text: 'Give 4 gm (IV) repeat dose of MgSo4.' },
    { text: 'Give 10gm (IV) repeat dose of MgSo4.' },
    { text: 'Give 2gm (IV) repeat dose of MgSo4.' }] },
];

/** The player shuffles option order — never rely on positional indexing. */
// Take a question's option texts, strip any HTML, and reverse them — a cheap way to
// guarantee the matcher never sees them in their original order.
const shuffled = (q: Q) => [...q.options.map((o) => stripHtml(o.text))].reverse();

// Group for the matcher's unit tests. @unit marks it as needing no browser or network.
test.describe('findMatchingQuestion — case-study bank @unit', () => {
  // THE REGRESSION TEST — this is the exact scenario that broke in production.
  test('resolves every question when the stem is the shared case description', () => {
    // The exact failure condition: the scrape captured ONLY the case text.
    // Walk all nine questions.
    for (const q of BANK) {
      // Work out which shared description this question would have shown.
      const sharedStem = q.question.startsWith('CASE: 1') ? CASE1 : CASE2;
      // Ask the matcher to identify it from the ambiguous stem plus its shuffled options.
      const match = findMatchingQuestion(sharedStem, shuffled(q), BANK);
      // It must find something — the failure message names which question went unmatched.
      expect(match, `no match for ${q.id} on the shared stem`).not.toBeNull();
      // And it must find the RIGHT one. This is what the old matcher got wrong.
      expect((match as Q).id, `${q.id} resolved to the wrong bank entry`).toBe(q.id);
    }
  });

  // The easy case: when the full stem is available, matching should be trivial.
  test('resolves every question when the full stem IS scraped', () => {
    // Walk all nine again.
    for (const q of BANK) {
      // Match on the complete, unique stem this time.
      const match = findMatchingQuestion(q.question, shuffled(q), BANK);
      // Must resolve to itself.
      expect((match as Q)?.id, `${q.id} mismatched on full stem`).toBe(q.id);
    }
  });

  // Safety: the matcher must know when it DOESN'T know, rather than guessing.
  test('declines rather than guessing when options do not belong to the bank', () => {
    // Give it a real stem but options that match nothing in the bank.
    const match = findMatchingQuestion(CASE1, ['Totally unrelated A', 'Totally unrelated B'], BANK);
    // Returning null is correct. Returning a wrong entry would silently answer the quiz incorrectly.
    expect(match, 'should return null instead of applying a wrong entry').toBeNull();
  });

  // The hardest case: no stem at all, so the options are the ONLY signal.
  test('still matches when the stem is empty and only options are visible', () => {
    // Pick q5 (index 4 — arrays start at 0).
    const q = BANK[4];
    // An empty stem plus shuffled options must still resolve to q5.
    expect((findMatchingQuestion('', shuffled(q), BANK) as Q)?.id).toBe(q.id);
  });

  // The explicit guard against the original bug ever coming back.
  test('old behaviour is fixed: CASE 1 questions no longer all collapse onto q1', () => {
    // Take just the five CASE 1 questions and match each on the ambiguous shared stem…
    const resolved = BANK.filter((q) => q.question.startsWith('CASE: 1'))
      // …collecting the id each one resolved to.
      .map((q) => (findMatchingQuestion(CASE1, shuffled(q), BANK) as Q)?.id);
    // A Set discards duplicates: 5 unique ids means all five resolved distinctly.
    // The old bug produced ['q1','q1','q1','q1','q1'] — a set of size 1.
    expect(new Set(resolved).size, `all CASE 1 stems collapsed onto: ${resolved.join(', ')}`).toBe(5);
  });
});
