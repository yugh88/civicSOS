import type { CaseRecord, StatusCheckOutcome, StatusCheckResult } from '../domain/types.js';
import { TERMINAL_STATUSES } from '../domain/types.js';
import { getResolutionPath } from '../knowledge/resolution-paths.js';
import { getAuthority } from '../knowledge/authorities.js';
import { getStatusCheckTarget, STATUS_CHECK_TARGETS } from '../status-check/targets.js';
import { daysBetween } from '../util/time.js';

/**
 * Status-check rules.
 *
 * The browser worker observes; this file decides. Keeping the two apart is the
 * same discipline applied to the language model elsewhere in the codebase: an
 * observer that can also mutate state produces failures nobody can audit,
 * because a wrong reading and a wrong decision look identical afterwards.
 *
 * Three things are settled here and nowhere else:
 *   - which cases are eligible to be looked at, and how often;
 *   - what a given observation is permitted to change;
 *   - what the citizen is told, including when the answer was "I could not tell".
 */

/**
 * Minimum gap between two checks of the same case.
 *
 * A status page is someone else's server. Polling it harder than a person would
 * is both rude and a good way to get CivicSOS blocked, and nothing about a
 * municipal complaint changes hourly.
 */
export const MIN_CHECK_INTERVAL_HOURS = 20;

/**
 * Cap per sweep. Keeps one bad night from turning into a burst of traffic at a
 * government site, and keeps the Fargate task's runtime predictable.
 */
export const MAX_CHECKS_PER_SWEEP = 25;

/**
 * Which status page, if any, applies to this case.
 *
 * Returns undefined when the category's authority has no verified status page
 * in the registry — which today is every real authority. Those cases are simply
 * never scheduled, and the citizen keeps the manual follow-up they have now.
 */
export function statusCheckTargetFor(record: Pick<CaseRecord, 'categoryId' | 'isDemo'>): string | undefined {
  // Seeded demo cases are checked against the practice portal, so the whole
  // loop is demonstrable without a real complaint existing anywhere.
  if (record.isDemo) return 'CIVICSOS_PRACTICE';

  const authority = getAuthority(getResolutionPath(record.categoryId).authorityId);
  const verified = authority.channels.find((channel) => !channel.isSample && Boolean(channel.url));
  if (!verified) return undefined;

  return STATUS_CHECK_TARGETS.find((target) => !target.practice && verified.url?.startsWith(target.url))?.targetId;
}

/**
 * Whether this case should be looked at now.
 *
 * Every condition here is a reason not to waste a request: nothing to look up,
 * nowhere to look it up, nothing left to learn, or checked too recently.
 */
export function shouldCheckStatus(
  record: Pick<
    CaseRecord,
    'status' | 'submittedAt' | 'officialReference' | 'submissionMode' | 'categoryId' | 'isDemo' | 'lastStatusCheckAt'
  >,
  now: Date,
): boolean {
  // Nothing was ever filed, so there is no reference to look up.
  if (!record.submittedAt || !record.officialReference) return false;

  // A simulated submission has a CS-DEMO- reference that exists only inside
  // CivicSOS. Looking for it on a real portal would be absurd; looking for it
  // on the practice portal is exactly what the practice portal is for.
  if (record.submissionMode === 'SIMULATED' && !record.isDemo) return false;

  // The case is already finished. Nothing a portal says changes that.
  if (TERMINAL_STATUSES.includes(record.status)) return false;

  if (!statusCheckTargetFor(record)) return false;

  if (record.lastStatusCheckAt) {
    const hours = (now.getTime() - new Date(record.lastStatusCheckAt).getTime()) / 3_600_000;
    if (hours < MIN_CHECK_INTERVAL_HOURS) return false;
  }

  return true;
}

export interface StatusCheckApplication {
  /** The case as it should now be persisted. */
  record: CaseRecord;
  /** True when the observation actually moved the case forward. */
  changed: boolean;
  /** Timeline entry. Always written, including for a failed read. */
  eventMessage: string;
  /** Set only when the citizen should be told something. */
  notification?: { kind: 'STATUS_CHANGED' | 'NEEDS_ATTENTION'; title: string; body: string };
}

/**
 * Applies one observation to one case.
 *
 * Pure, and deliberately conservative. The only transition a worker can cause
 * is SUBMITTED/AWAITING_RESPONSE → AWAITING_RESPONSE, plus recording that a
 * portal claims the complaint is closed. It cannot resolve a case: "the portal
 * says resolved" and "the problem is actually fixed" are different claims, and
 * only the citizen standing in front of the uncollected rubbish can make the
 * second one. So a RESOLVED reading asks them to confirm rather than closing
 * the case behind their back.
 */
export function applyStatusCheck(record: CaseRecord, result: StatusCheckResult, now: Date): StatusCheckApplication {
  const target = getStatusCheckTarget(result.targetId);
  const source = target?.practice
    ? 'the CivicSOS practice portal (not a government site)'
    : (target?.label ?? 'the official portal');
  const checkedAt = now.toISOString();
  const base: CaseRecord = {
    ...record,
    lastStatusCheckAt: checkedAt,
    lastStatusCheckOutcome: result.outcome,
    updatedAt: checkedAt,
  };

  const label = result.observedLabel ? ` It reads: "${result.observedLabel}".` : '';

  switch (result.outcome) {
    case 'RESOLVED':
      return {
        // Note what the portal says; do not close the case on its say-so.
        record: base,
        changed: true,
        eventMessage: `${source} reports this complaint as closed.${label}`,
        notification: {
          kind: 'NEEDS_ATTENTION',
          title: 'The portal says your complaint is closed',
          body: `${source} now shows this as closed.${label} If the problem is actually fixed, mark the case resolved. If it is not, that is the strongest possible evidence for an escalation — and CivicSOS has the next step ready.`,
        },
      };

    case 'IN_PROGRESS': {
      // Moving to AWAITING_RESPONSE is what a logged follow-up does, and it is
      // the honest reading: someone at the authority has the complaint.
      const moved = record.status === 'SUBMITTED';
      return {
        record: moved ? { ...base, status: 'AWAITING_RESPONSE' } : base,
        changed: moved,
        eventMessage: `${source} shows this complaint as open.${label}`,
        notification: moved
          ? {
              kind: 'STATUS_CHANGED',
              title: 'Your complaint has been picked up',
              body: `${source} shows it as in progress.${label} CivicSOS will keep watching and will tell you if it stalls.`,
            }
          : undefined,
      };
    }

    case 'NOT_FOUND':
      return {
        record: base,
        changed: false,
        eventMessage: `${source} does not recognise reference ${record.officialReference}.`,
        notification: {
          kind: 'NEEDS_ATTENTION',
          title: 'That reference is not being recognised',
          body: `${source} has no record of ${record.officialReference}. It is worth checking the number for a typo — and if it is right, the complaint may not have registered, which is worth filing again.`,
        },
      };

    case 'NEEDS_HUMAN':
      // The worker hit a login or a challenge and stopped, which is correct.
      // Say so plainly rather than dressing a refusal up as a failure.
      return {
        record: base,
        changed: false,
        eventMessage: `${source} asked for a sign-in or a CAPTCHA, so CivicSOS stopped and did not read the status.`,
        notification: {
          kind: 'NEEDS_ATTENTION',
          title: 'This one needs you',
          body: `${source} asks for a sign-in or a CAPTCHA before it will show a status. CivicSOS never handles either, so this is a check only you can do.`,
        },
      };

    case 'UNREADABLE':
    default:
      // Silent: a page we could not parse is our problem, not the citizen's,
      // and a notification every night about our own scraper would be noise.
      return {
        record: base,
        changed: false,
        eventMessage: `CivicSOS could not read a status from ${source}.`,
      };
  }
}

/** Days since the last successful look, for display. Undefined if never. */
export function daysSinceStatusCheck(record: Pick<CaseRecord, 'lastStatusCheckAt'>, now: Date): number | undefined {
  if (!record.lastStatusCheckAt) return undefined;
  return daysBetween(new Date(record.lastStatusCheckAt), now);
}

/** Outcomes that mean CivicSOS genuinely saw the page. */
export function isConclusive(outcome: StatusCheckOutcome): boolean {
  return outcome === 'RESOLVED' || outcome === 'IN_PROGRESS' || outcome === 'NOT_FOUND';
}
