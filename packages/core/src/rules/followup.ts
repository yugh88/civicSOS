import type { CaseRecord, CaseStatus, EscalationStep } from '../domain/types.js';
import { getResolutionPath } from '../knowledge/resolution-paths.js';
import { addDays, daysBetween, isoAddDays } from '../util/time.js';

/**
 * Follow-up and escalation rules.
 *
 * Entirely deterministic and pure: given a case and a clock, the same follow-up
 * date and escalation level always come out. That matters because these dates
 * drive reminders and because a citizen quoting a deadline needs it to be
 * defensible, not model-generated.
 */

/** Urgent problems get a shorter leash than the category default. */
const URGENCY_MULTIPLIER = {
  CRITICAL: 0.25,
  HIGH: 0.5,
  MEDIUM: 1,
  LOW: 1.25,
} as const;

const MIN_FOLLOW_UP_DAYS = 1;

/**
 * When the citizen should chase the complaint.
 *
 * Measured from submission where we know it, otherwise from case creation, and
 * based on the acknowledgement window — a citizen should not wait for the full
 * resolution window before asking whether anyone has even looked at it.
 */
export function computeFollowUpDate(
  caseRecord: Pick<CaseRecord, 'categoryId' | 'urgency' | 'submittedAt' | 'createdAt' | 'escalationLevel'>,
): string {
  const path = getResolutionPath(caseRecord.categoryId);
  const anchor = caseRecord.submittedAt ?? caseRecord.createdAt;
  const multiplier = URGENCY_MULTIPLIER[caseRecord.urgency];

  const base = Math.max(MIN_FOLLOW_UP_DAYS, Math.round(path.expectedAcknowledgementDays * multiplier));

  // Each escalation restarts the clock at the window for the *next* step.
  const step = path.escalationSteps[caseRecord.escalationLevel - 1];
  const days = caseRecord.escalationLevel > 0 && step ? Math.max(MIN_FOLLOW_UP_DAYS, Math.round(step.afterDays / 3)) : base;

  return isoAddDays(anchor, days);
}

export interface EscalationAssessment {
  /** Escalation level the case is eligible for, 0 when none. */
  availableLevel: number;
  step?: EscalationStep;
  /** Days since the case was submitted (or created, if never submitted). */
  ageDays: number;
  /** True when the follow-up date has passed and the case is still open. */
  followUpOverdue: boolean;
  reason: string;
}

const ESCALATABLE_STATUSES: readonly CaseStatus[] = ['SUBMITTED', 'AWAITING_RESPONSE', 'ESCALATED'];

/**
 * Decides whether escalation guidance should be offered.
 *
 * Note this only ever *suggests* — CivicSOS never escalates on a citizen's
 * behalf, and the model has no say in this decision at all.
 */
export function assessEscalation(
  caseRecord: Pick<
    CaseRecord,
    'categoryId' | 'status' | 'submittedAt' | 'createdAt' | 'followUpAt' | 'escalationLevel'
  >,
  now: Date = new Date(),
): EscalationAssessment {
  const path = getResolutionPath(caseRecord.categoryId);
  const anchor = caseRecord.submittedAt ?? caseRecord.createdAt;
  const ageDays = Math.max(0, daysBetween(anchor, now));
  const followUpOverdue =
    Boolean(caseRecord.followUpAt) &&
    new Date(caseRecord.followUpAt!).getTime() <= now.getTime() &&
    ESCALATABLE_STATUSES.includes(caseRecord.status);

  if (!ESCALATABLE_STATUSES.includes(caseRecord.status)) {
    return {
      availableLevel: 0,
      ageDays,
      followUpOverdue: false,
      reason:
        caseRecord.status === 'RESOLVED' || caseRecord.status === 'CLOSED_UNRESOLVED'
          ? 'This case is closed.'
          : 'Escalation applies once the complaint has been submitted to the authority.',
    };
  }

  // Highest step whose waiting period has elapsed and which is above the
  // level already reached.
  let available = 0;
  let step: EscalationStep | undefined;
  for (const candidate of path.escalationSteps) {
    if (ageDays >= candidate.afterDays && candidate.level > caseRecord.escalationLevel) {
      available = candidate.level;
      step = candidate;
    }
  }

  if (available === 0) {
    const next = path.escalationSteps.find((candidate) => candidate.level > caseRecord.escalationLevel);
    return {
      availableLevel: 0,
      ageDays,
      followUpOverdue,
      reason: next
        ? `Escalation to "${next.title}" becomes appropriate ${next.afterDays} days after submission (day ${ageDays} now).`
        : 'You have already worked through every escalation step we can suggest.',
    };
  }

  return {
    availableLevel: available,
    step,
    ageDays,
    followUpOverdue,
    reason: `It has been ${ageDays} days since submission with no resolution, so escalation step ${available} now applies.`,
  };
}

/** Next escalation step to display, whether or not it is unlocked yet. */
export function nextEscalationStep(
  categoryId: CaseRecord['categoryId'],
  currentLevel: number,
): EscalationStep | undefined {
  return getResolutionPath(categoryId).escalationSteps.find((step) => step.level > currentLevel);
}

/** Date on which a case becomes eligible for its next escalation step. */
export function nextEscalationDate(
  caseRecord: Pick<CaseRecord, 'categoryId' | 'submittedAt' | 'createdAt' | 'escalationLevel'>,
): string | undefined {
  const step = nextEscalationStep(caseRecord.categoryId, caseRecord.escalationLevel);
  if (!step) return undefined;
  return addDays(caseRecord.submittedAt ?? caseRecord.createdAt, step.afterDays).toISOString();
}
