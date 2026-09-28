/**
 * Org registry for the API layer.
 *
 * Only what the provisioning APIs consume: orgId (assign role) + an email
 * prefix. The real `channel` string is resolved from the org API by orgId
 * (some orgs store invisible characters that can't be hand-typed), so it is
 * NOT stored here. Add orgs as needed.
 */
// The shape every entry in the registry below must have.
export interface OrgConfig {
  // Short code used to look the org up, e.g. 'BNRC'.
  key: string;
  /** Display name only — the real channel is resolved from the org API by orgId. */
  name: string;
  /** organisationId, used on assign-role. */
  orgId: string;
  /** Email prefix for provisioned users. */
  emailPrefix: string;
  /** Written into professionalDetails[0].designation when a profile is applied. */
  designation: string;
}

// The registry itself — a lookup table keyed by the short code.
export const ORGS: Record<string, OrgConfig> = {
  // Bihar Nursing Registration Council — the default org for provisioned test users.
  BNRC: {
    key: 'BNRC',
    name: 'Bihar Nursing Registration Council',
    orgId: '014005962721189888281',
    emailPrefix: 'bnrc-api',
    designation: 'ANM-Student-Bihar',
  },
  // State Institute of Health and Family Welfare, Uttar Pradesh.
  SIHFWUP: {
    key: 'SIHFWUP',
    name: 'State Institute of Health and Family Welfare, UP',
    orgId: '0142443633580769283117',
    emailPrefix: 'sihfwup-api',
    designation: 'Medical Officer-UP',
  },
  // State Health Society Bihar.
  SHSB: {
    key: 'SHSB',
    name: 'State Health Society Bihar',
    orgId: '01403709013603123234776',
    emailPrefix: 'shsb-api',
    designation: 'ANM-Bihar',
  },
};

// Safe lookup — use this rather than indexing ORGS directly.
export function getOrg(key: string): OrgConfig {
  // Try to find the entry.
  const org = ORGS[key];
  // Fail loudly with the list of valid keys, rather than returning undefined and
  // producing a confusing "cannot read property of undefined" somewhere downstream.
  if (!org) throw new Error(`Unknown org "${key}". Known: ${Object.keys(ORGS).join(', ')}`);
  // Found it.
  return org;
}
