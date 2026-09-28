/**
 * SphereApiClient — Layer 2 (API / service) client for sphere.aastrika.org.
 *
 * Built on Playwright's APIRequestContext so every call is traced and shows up
 * in the HTML report. Wraps the Sunbird endpoints:
 *   - POST  /api/org/v1/search               (resolve an org's channel)
 *   - POST  /api/user/v3/create              (create a user)
 *   - POST  /api/user/private/v1/assign/role (grant roles)
 *   - PATCH /api/user/private/v1/update      (update profile)
 *   - POST  /api/user/v1/search              (find users)
 *   - GET   /api/questionset/v1/hierarchy/:id (self-assessment answer key)
 *
 * Auth = bearer token + connect.sid cookie. Read from .env:
 *   SPHERE_API_TOKEN   — the bearer token (required)
 *   SPHERE_API_COOKIE  — the connect.sid value (falls back to SESSION_COOKIE)
 * These are SESSION creds and WILL expire — refresh from DevTools when calls
 * start returning 401/419.
 */
// Playwright's HTTP client type, and the type of a response it returns.
import { APIRequestContext, APIResponse } from '@playwright/test';

// Which environment to call. Its own var wins, then the shared one, then production.
export const BASE_URL = process.env.SPHERE_BASE_URL || process.env.BASE_URL || 'https://sphere.aastrika.org';

// Everything the create-user endpoint requires.
export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  // Must be the org's channel string byte-for-byte — hence getOrgChannel() below.
  channel: string;
}

// What a caller gets back after provisioning.
export interface ProvisionedUser {
  email: string;
  password: string;
  userId: string;
  orgKey: string;
}

// A parsed answer key, with several lookup shapes for different matching strategies.
export interface AnswerKey {
  /** all correct optionIds, e.g. "Q156-c" — matched against a radio input's `value`. */
  correctOptionIds: Set<string>;
  /** normalized question text -> normalized correct option text (fallback matching). */
  byQuestion: Map<string, string>;
  /** all normalized correct option texts (fallback matching). */
  correctOptions: Set<string>;
  /** number of questions in the bank. */
  size: number;
  /**
   * True when the bank has questions but NONE are flagged correct — Sphere
   * "poisons" some competency quizzes this way to defeat the answer-key path.
   * Callers should fall back to another strategy (e.g. Gemini) when poisoned.
   */
  poisoned: boolean;
}

/** The connect.sid cookie value — SPHERE_API_COOKIE, or the shared SESSION_COOKIE. */
export function apiCookieValue(): string | undefined {
  // Three accepted names, in order of preference.
  return process.env.SPHERE_API_COOKIE || process.env.SESSION_COOKIE || process.env.CONNECT_SID;
}

/** True when both the bearer token and a cookie are configured. */
export function hasApiCreds(): boolean {
  // Both are needed — a token alone won't authenticate these endpoints.
  return Boolean(process.env.SPHERE_API_TOKEN && apiCookieValue());
}

/** Build the auth header block. Overridable for negative-auth tests. */
export function authHeaders(
  // Defaults come from env, but a caller can pass junk values to test rejection.
  token = process.env.SPHERE_API_TOKEN,
  cookie = apiCookieValue(),
): Record<string, string> {
  // Fail with a clear message rather than sending an empty header and getting a puzzling 401.
  if (!token) throw new Error('SPHERE_API_TOKEN not set in .env');
  if (!cookie) throw new Error('SPHERE_API_COOKIE / SESSION_COOKIE not set in .env');
  return {
    'Content-Type': 'application/json',
    // Accept a token pasted with or without the "bearer " prefix.
    Authorization: token.toLowerCase().startsWith('bearer ') ? token : `bearer ${token}`,
    // Same tolerance for the cookie: accept the bare value or the full "name=value" form.
    Cookie: cookie.startsWith('connect.sid=') ? cookie : `connect.sid=${cookie}`,
  };
}

/** Strip tags/entities, collapse whitespace, lowercase — for robust text matching. */
export function normalize(s: string): string {
  // `(s || '')` guards against null/undefined.
  return (s || '')
    // Remove HTML tags.
    .replace(/<[^>]+>/g, ' ')
    // Decode non-breaking spaces.
    .replace(/&nbsp;/gi, ' ')
    // Decode escaped ampersands.
    .replace(/&amp;/gi, '&')
    // Replace literal non-breaking space characters (U+00A0) with ordinary ones.
    .replace(/ /g, ' ')
    // Collapse runs of whitespace.
    .replace(/\s+/g, ' ')
    // Trim the ends.
    .trim()
    // Lower-case so comparisons ignore capitalisation.
    .toLowerCase();
}

/** True when a Sunbird envelope reports success (status casing varies). */
export function isSuccessEnvelope(json: any): boolean {
  // Success is reported in one of two places depending on the endpoint.
  const status: string | undefined = json?.params?.status;
  const code: string | undefined = json?.responseCode;
  // Accept either. The regexes tolerate "SUCCESS", "success", "Successful", "OK", "ok".
  return Boolean((status && /^success/i.test(status)) || (code && /^ok$/i.test(code)));
}

/** The quiz content id embedded in a player URL like /viewer/quiz/do_xxx?... */
export function quizIdFromUrl(url: string): string | null {
  // Only matches the quiz player path, so a course TOC URL correctly returns null.
  const m = url.match(/\/viewer\/quiz\/(do_\d+)/);
  // Return the captured id, or null if this wasn't a quiz URL.
  return m ? m[1] : null;
}

// The client itself. One instance wraps one HTTP context.
export class SphereApiClient {
  constructor(
    // `private readonly` declares AND assigns the field in one step — TypeScript shorthand.
    private readonly request: APIRequestContext,
    // Public so callers can read which environment this client targets.
    readonly baseUrl: string = BASE_URL,
  ) {}

  // ── Raw request layer (returns APIResponse, no envelope assertion) ──────────
  // Used directly by negative tests that WANT to inspect a failure.
  rawPost(path: string, data: unknown, headers = authHeaders()): Promise<APIResponse> {
    return this.request.post(`${this.baseUrl}${path}`, { headers, data });
  }
  // PATCH variant, for profile updates.
  rawPatch(path: string, data: unknown, headers = authHeaders()): Promise<APIResponse> {
    return this.request.patch(`${this.baseUrl}${path}`, { headers, data });
  }
  // GET variant, for reads.
  rawGet(path: string, headers = authHeaders()): Promise<APIResponse> {
    return this.request.get(`${this.baseUrl}${path}`, { headers });
  }

  // ── Envelope-checked layer (throws on non-success) ──────────────────────────
  // Validates a response three ways and returns the parsed JSON.
  private async ok(res: APIResponse, label: string): Promise<any> {
    // Read the body as text first, so it can be included in any error message.
    const text = await res.text();
    // Check 1: the HTTP status. The body is appended so the failure is diagnosable.
    if (!res.ok()) throw new Error(`${label} -> ${res.status()} ${res.statusText()}\n${text}`);
    // Where the parsed body will go.
    let json: any;
    try {
      // Check 2: it must actually be JSON.
      json = JSON.parse(text);
    } catch {
      // An HTML error page instead of JSON is a common failure — name it explicitly.
      throw new Error(`${label} returned non-JSON:\n${text}`);
    }
    // Check 3: Sunbird can return HTTP 200 with a failure envelope, so check that too.
    if (!isSuccessEnvelope(json)) throw new Error(`${label} not successful:\n${text}`);
    // All three passed.
    return json;
  }

  /** Full org record (POST /api/org/v1/search by id). */
  async orgSearch(orgId: string): Promise<any> {
    // Search by exact id.
    const res = await this.rawPost('/api/org/v1/search', { request: { filters: { id: orgId } } });
    // Validate; the label makes any error say which org failed.
    const json = await this.ok(res, `orgSearch(${orgId})`);
    // Dig the first (and only) result out of the nested envelope.
    const org = json?.result?.response?.content?.[0];
    // An empty result is a real problem for the caller, so fail rather than return undefined.
    if (!org) throw new Error(`No org found for id ${orgId}`);
    return org;
  }

  /** The org's exact `channel` string, byte-for-byte (needed by create-user). */
  async getOrgChannel(orgId: string): Promise<string> {
    // Fetch the record and read one field off it.
    const channel = (await this.orgSearch(orgId))?.channel;
    // Fail loudly — create-user would otherwise be rejected for a reason that's hard to trace.
    if (!channel) throw new Error(`No channel on org ${orgId}`);
    return channel;
  }

  /** Create a user; returns the new userId. */
  async createUser(input: CreateUserInput): Promise<string> {
    // POST the user details, wrapped in Sunbird's `request` envelope.
    const res = await this.rawPost('/api/user/v3/create', { request: input });
    // Validate the response.
    const json = await this.ok(res, 'createUser');
    // Pull out the id the server assigned.
    const userId: string | undefined = json?.result?.userId;
    // A success envelope with no id means the shape changed — dump the whole body.
    if (!userId) throw new Error(`createUser: no userId in response\n${JSON.stringify(json)}`);
    return userId;
  }

  /** Assign roles (default PUBLIC) to a user within an organisation. */
  async assignRole(userId: string, organisationId: string, roles: string[] = ['PUBLIC']): Promise<void> {
    // POST the assignment.
    const res = await this.rawPost('/api/user/private/v1/assign/role', {
      request: { userId, organisationId, roles },
    });
    // Validate it, discarding the body — there's nothing useful in it.
    await this.ok(res, 'assignRole');
  }

  /** Update a user's profile. The userId is injected where the API expects it. */
  async updateProfile(userId: string, profileDetails: any): Promise<void> {
    // Deep-copy so we don't mutate the caller's object — important when the same
    // profile template is reused across several users.
    const details = structuredClone(profileDetails);
    // The API wants the id in two places inside the nested request, so fill both.
    if (details?.profileReq) {
      details.profileReq.id = userId;
      details.profileReq.userId = userId;
    }
    // This endpoint is a PATCH, not a POST.
    const res = await this.rawPatch('/api/user/private/v1/update', {
      request: { userId, profileDetails: details },
    });
    // Validate.
    await this.ok(res, 'updateProfile');
  }

  /** Search users. Returns the content array (possibly empty). */
  async userSearch(filters: Record<string, unknown>): Promise<any[]> {
    // POST the filters.
    const res = await this.rawPost('/api/user/v1/search', { request: { filters } });
    // Validate.
    const json = await this.ok(res, 'userSearch');
    // An empty array is a legitimate result here, so default to [] rather than throwing.
    return json?.result?.response?.content ?? [];
  }

  /** questionset hierarchy for a quiz do_id (contains artifactUrl + metadata). */
  async questionsetHierarchy(quizId: string): Promise<any> {
    // mode=edit is what makes the response include the artifactUrl we need.
    const res = await this.rawGet(`/api/questionset/v1/hierarchy/${quizId}?mode=edit`);
    // Validate.
    const json = await this.ok(res, `questionsetHierarchy(${quizId})`);
    // Dig out the questionSet object.
    const qs = json?.result?.questionSet;
    // Fail clearly if it isn't there.
    if (!qs) throw new Error(`No questionSet for ${quizId}`);
    return qs;
  }

  /**
   * Deterministic answer key for a self-assessment quiz.
   * questionset hierarchy -> artifactUrl (public S3) -> quiz.json (isCorrect).
   * Sets `poisoned: true` when questions exist but none are flagged correct.
   */
  async fetchAnswerKey(quizId: string): Promise<AnswerKey> {
    // Step 1: get the hierarchy and read the artifact link off it.
    const artifactUrl: string | undefined = (await this.questionsetHierarchy(quizId))?.artifactUrl;
    // No link means no answer key.
    if (!artifactUrl) throw new Error(`No artifactUrl for quiz ${quizId}`);
    // Step 2: download it. Note: NOT rawGet — this is public S3, and sending our
    // auth headers to a third-party bucket would leak them.
    const res = await this.request.get(artifactUrl); // public S3 — no auth headers
    // Fail clearly if the artifact is missing.
    if (!res.ok()) throw new Error(`artifact GET ${artifactUrl} -> ${res.status()}`);
    // Parse the quiz JSON.
    const quiz: any = await res.json();

    // Three lookup shapes, because different matching strategies need different keys.
    // By option id — the most precise, matched against a radio input's `value`.
    const correctOptionIds = new Set<string>();
    // Question text → its first correct option's text.
    const byQuestion = new Map<string, string>();
    // Every correct option's text, for when the question can't be identified.
    const correctOptions = new Set<string>();
    // How many questions the bank holds — needed to tell "empty" from "poisoned".
    let questionCount = 0;
    // Walk every question. `|| []` guards against the key being absent.
    for (const q of quiz.questions || []) {
      // Count it, whether or not it has correct answers marked.
      questionCount++;
      // Which of its options are flagged correct?
      const corrects = (q.options || []).filter((o: any) => o.isCorrect);
      // None flagged — skip it. This is what produces a "poisoned" bank.
      if (!corrects.length) continue;
      // Record every correct option.
      for (const c of corrects) {
        // By id, when the artifact provides one.
        if (c.optionId) correctOptionIds.add(c.optionId);
        // And by normalised text, always.
        correctOptions.add(normalize(c.text));
      }
      // Map the question to its FIRST correct option — the fallback for single-answer questions.
      byQuestion.set(normalize(q.question), normalize(corrects[0].text));
    }
    // "Poisoned" = there ARE questions, but not one correct answer among them.
    // Distinguishing this from an empty bank is what lets callers fall back to the AI path.
    const poisoned = questionCount > 0 && correctOptionIds.size === 0 && correctOptions.size === 0;
    // Hand back all four lookups plus the poisoned flag.
    return { correctOptionIds, byQuestion, correctOptions, size: byQuestion.size, poisoned };
  }
}
