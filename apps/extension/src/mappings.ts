import type { PayloadField } from './types.js';

/**
 * Verified field mappings, by portal.
 *
 * HONESTY POLICY — read before adding an entry.
 *
 * A mapping may only be added after someone has actually inspected that portal
 * and confirmed each selector. Writing plausible-looking selectors for a
 * government site you have not opened is inventing them, and a wrong selector
 * types a citizen's complaint into the wrong field — which is worse than no
 * autofill at all.
 *
 * This ships with **no unverified entries**, and exactly one verified one: the
 * CivicSOS practice portal, whose selectors are verifiable by construction
 * because CivicSOS writes that page itself. Until a real portal is mapped, the
 * assistant falls back to the review panel: the prepared fields with one-click
 * copy. That works everywhere and cannot type into the wrong box.
 *
 * To add a real portal:
 *   1. Open the portal's complaint form.
 *   2. For each field CivicSOS can supply, record a stable CSS selector.
 *   3. Record `loggedOutSelector` — something present only when signed out.
 *   4. Record `challengeSelector` — present only during a CAPTCHA or OTP.
 *   5. Record `submitSelector` so the assistant knows what never to click.
 *   6. Test against the live form, then add its origin to the manifest's
 *      `content_scripts.matches` as well — a mapping alone does nothing.
 */

export interface PortalMapping {
  /**
   * Exact origins this mapping applies to. Never a wildcard: a pattern that
   * matched too broadly would carry one portal's selectors onto another site.
   */
  origins: string[];
  /**
   * When set, the mapping applies only to paths beginning with this, and the
   * origin check is skipped. Used only for the practice portal, which CivicSOS
   * serves from its own origin — whatever that origin happens to be in a given
   * deployment — under one fixed path.
   */
  pathPrefix?: string;
  label: string;
  /**
   * True for the CivicSOS practice portal. The panel says so out loud, so a
   * successful autofill there can never be mistaken for a real filing.
   */
  practice?: boolean;
  /** Payload field key → CSS selector on that portal. */
  fields: Partial<Record<string, string>>;
  /**
   * Present only when the citizen still needs to sign in. When this matches,
   * the assistant waits rather than filling.
   */
  loggedOutSelector?: string;
  /** Matches a CAPTCHA or OTP challenge. Same behaviour: wait. */
  challengeSelector?: string;
  /**
   * The final submit control. Recorded so the assistant can be certain it is
   * never the thing being clicked.
   */
  submitSelector?: string;
}

/**
 * The CivicSOS practice portal (`/practice-portal` in this app).
 *
 * This is the one mapping that can be honestly verified without inspecting a
 * third-party site, because the form it points at lives in this repository at
 * `apps/web/src/app/practice-portal/page.tsx`. Its purpose is to make the
 * autofill mechanism — and, more importantly, the places the assistant refuses
 * to act — observable rather than merely claimed.
 */
const PRACTICE_PORTAL: PortalMapping = {
  origins: [],
  pathPrefix: '/practice-portal',
  label: 'CivicSOS practice portal (not a government site)',
  practice: true,
  fields: {
    category: '#complaint-category',
    subject: '#complaint-subject',
    location: '#complaint-location',
    city: '#complaint-city',
    state: '#complaint-state',
    pincode: '#complaint-pincode',
    description: '#complaint-description',
  },
  loggedOutSelector: '#portal-signin',
  challengeSelector: '#portal-challenge',
  submitSelector: '#portal-submit',
};

export const PORTAL_MAPPINGS: PortalMapping[] = [PRACTICE_PORTAL];

export function mappingFor(location: { origin: string; pathname: string }): PortalMapping | undefined {
  return PORTAL_MAPPINGS.find((mapping) =>
    mapping.pathPrefix
      ? location.pathname.startsWith(mapping.pathPrefix)
      : mapping.origins.includes(location.origin),
  );
}

/** Fields the payload carries that this portal has no selector for. */
export function unsupportedFields(mapping: PortalMapping, fields: PayloadField[]): string[] {
  return fields.filter((field) => !mapping.fields[field.key]).map((field) => field.label);
}
