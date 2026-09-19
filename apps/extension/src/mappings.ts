import type { PayloadField } from './types.js';

/**
 * Verified field mappings, by portal origin.
 *
 * HONESTY POLICY — read before adding an entry.
 *
 * A mapping may only be added after someone has actually inspected that portal
 * and confirmed each selector. Writing plausible-looking selectors for a
 * government site you have not opened is inventing them, and a wrong selector
 * types a citizen's complaint into the wrong field — which is worse than no
 * autofill at all.
 *
 * This ships with **no unverified entries**. Until a portal is mapped, the
 * assistant falls back to the review panel: the prepared fields with one-click
 * copy. That works everywhere and cannot type into the wrong box.
 *
 * To add one:
 *   1. Open the portal's complaint form.
 *   2. For each field CivicSOS can supply, record a stable CSS selector.
 *   3. Record `loggedOutSelector` — something present only when signed out.
 *   4. Record `submitSelector` so the assistant knows what never to click.
 *   5. Test against the live form before committing.
 */

export interface PortalMapping {
  /** Exact origin, e.g. "https://example.gov.in". Never a wildcard. */
  origin: string;
  label: string;
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
 * Empty by design. See the policy above.
 *
 * The assistant is fully functional with an empty registry — it reviews rather
 * than fills — so shipping nothing here costs a convenience, not the feature.
 */
export const PORTAL_MAPPINGS: PortalMapping[] = [];

export function mappingFor(origin: string): PortalMapping | undefined {
  return PORTAL_MAPPINGS.find((mapping) => mapping.origin === origin);
}

/** Fields the payload carries that this portal has no selector for. */
export function unsupportedFields(mapping: PortalMapping, fields: PayloadField[]): string[] {
  return fields.filter((field) => !mapping.fields[field.key]).map((field) => field.label);
}
