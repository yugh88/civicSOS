/**
 * Public status pages the browser worker is allowed to read.
 *
 * HONESTY POLICY — read before adding an entry.
 *
 * Same rule as the extension's `PORTAL_MAPPINGS`, and for the same reason: a
 * plausible-looking selector for a page nobody has opened is an invented one.
 * Here the stakes are slightly different but no lower — a wrong selector does
 * not mistype a complaint, it reports a *status* the portal never gave, and a
 * citizen who is told "resolved" stops chasing a problem that is still there.
 *
 * So this ships with **no real government entries**. It has exactly one target:
 * the CivicSOS practice portal, whose markup lives in this repository and whose
 * selectors are therefore verifiable by construction.
 *
 * A target may only be added after someone has:
 *   1. Opened the portal's public track-your-complaint page.
 *   2. Confirmed it needs no login to read a status.
 *   3. Recorded the reference input, the lookup button and the result selector.
 *   4. Recorded how that page spells "resolved" and "in progress".
 *   5. Checked the site's terms permit an automated read of your own complaint.
 *
 * What a target may never be: a page behind a login, a page with a CAPTCHA on
 * the read path, or a page that files, edits or withdraws anything.
 */

import type { StatusCheckOutcome } from '../domain/types.js';

export interface StatusCheckTarget {
  targetId: string;
  label: string;
  /**
   * The public status-lookup URL. Read-only by definition: if a URL can change
   * state, it does not belong in this registry.
   */
  url: string;
  /** Where the citizen's reference number goes. The only field ever typed in. */
  referenceSelector: string;
  /**
   * The lookup/search control. Named explicitly so it can never be confused
   * with a complaint submit button — this registry has no concept of the
   * latter, and the worker has no code that would press one.
   */
  lookupSelector: string;
  /** Where the answer appears once the lookup has run. */
  resultSelector: string;
  /**
   * Present only when a login wall or challenge is on screen. When either
   * matches, the worker reports NEEDS_HUMAN and stops.
   */
  loggedOutSelector?: string;
  challengeSelector?: string;
  /**
   * How this portal spells each outcome, lower-cased. Matched against the
   * result text. Ordered: the first list that matches wins, so put the
   * terminal vocabulary first.
   */
  vocabulary: Array<{ outcome: Exclude<StatusCheckOutcome, 'NEEDS_HUMAN' | 'UNREADABLE'>; phrases: string[] }>;
  /** True for the practice portal. Never treated as a real authority answer. */
  practice?: boolean;
}

/**
 * The CivicSOS practice portal's status lookup.
 *
 * Served by our own app at `/practice-portal/status`, so every selector below
 * is checked against real markup by the worker's build, not taken on trust.
 */
const PRACTICE_TARGET: StatusCheckTarget = {
  targetId: 'CIVICSOS_PRACTICE',
  label: 'CivicSOS practice portal (not a government site)',
  url: '/practice-portal/status',
  referenceSelector: '#status-reference',
  lookupSelector: '#status-lookup',
  resultSelector: '#status-result',
  loggedOutSelector: '#status-signin',
  challengeSelector: '#status-challenge',
  practice: true,
  vocabulary: [
    { outcome: 'RESOLVED', phrases: ['resolved', 'closed', 'completed'] },
    { outcome: 'NOT_FOUND', phrases: ['no such complaint', 'not found', 'no record'] },
    { outcome: 'IN_PROGRESS', phrases: ['in progress', 'assigned', 'under process', 'registered'] },
  ],
};

/**
 * Empty of real portals by design. See the policy above.
 *
 * The rest of the system is fully functional with only the practice target:
 * a case whose channel has no verified status page is simply never scheduled
 * for a check, and the citizen keeps the manual follow-up they have today.
 */
export const STATUS_CHECK_TARGETS: StatusCheckTarget[] = [PRACTICE_TARGET];

export function getStatusCheckTarget(targetId: string): StatusCheckTarget | undefined {
  return STATUS_CHECK_TARGETS.find((target) => target.targetId === targetId);
}

/**
 * Maps result text to an outcome using only the target's own vocabulary.
 *
 * Deliberately not fuzzy and deliberately not a language model: "your complaint
 * has not been resolved" must never match `RESOLVED` because the word appears.
 * Each phrase is checked as a whole word-ish substring, and a page that matches
 * nothing is UNREADABLE rather than optimistically IN_PROGRESS.
 */
export function classifyStatusText(target: StatusCheckTarget, text: string): StatusCheckOutcome {
  const haystack = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (haystack.length === 0) return 'UNREADABLE';

  // Negations are the one ambiguity worth handling explicitly, because "not
  // resolved" and "resolved" differ by a word and by everything that matters.
  const negated = /\b(not|never|no longer|yet to be|pending)\s+(been\s+)?(resolved|closed|completed)\b/.test(haystack);

  for (const entry of target.vocabulary) {
    if (entry.outcome === 'RESOLVED' && negated) continue;
    if (entry.phrases.some((phrase) => haystack.includes(phrase.toLowerCase()))) {
      return entry.outcome;
    }
  }
  return 'UNREADABLE';
}
