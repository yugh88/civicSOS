import type {
  AgentActionId,
  AgentStep,
  AgentStepStatus,
  CaseEvent,
  CasePhase,
  CaseRecord,
  EvidenceRequirement,
} from '../domain/types.js';
import { AppError } from '../domain/errors.js';
import { getAuthority } from '../knowledge/authorities.js';
import { getResolutionPath } from '../knowledge/resolution-paths.js';
import { remainingPlaceholders } from './complaint.js';
import { assessEscalation } from './followup.js';
import { isoNow } from '../util/time.js';

/**
 * The agent's rules.
 *
 * CivicSOS's promise is that it does the repetitive work — but an agent acting
 * on a citizen's behalf against a public body is exactly the place where "the
 * model decided" is not an acceptable answer. So the agent is deliberately
 * narrow:
 *
 *  - The action set is closed (`AGENT_ACTIONS`). Nothing outside it can run.
 *  - Every action passes `assertActionAllowed` first, which reads only the
 *    persisted case and the knowledge layer — never model output.
 *  - Submission is gated on explicit citizen approval, a complete complaint and
 *    a resolved channel, and refuses outright on an already-submitted case.
 *  - The channel, the authority and the reference are produced here, from data.
 *    A model cannot invent any of them.
 *
 * The submission itself runs against the demo environment (see
 * `services/agent-service.ts`), which performs no network call of any kind.
 */

/* ------------------------------------------------------------------ */
/* Case phase — what the citizen is shown                             */
/* ------------------------------------------------------------------ */

export const PHASE_LABELS: Record<CasePhase, string> = {
  PREPARING: 'Preparing',
  AWAITING_APPROVAL: 'Awaiting approval',
  SUBMITTED: 'Submitted',
  MONITORING: 'Monitoring',
  FOLLOW_UP_READY: 'Follow-up ready',
  ESCALATION_READY: 'Escalation ready',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/** One line of contextual microcopy per phase. */
export const PHASE_MESSAGES: Record<CasePhase, string> = {
  PREPARING: 'One thing is still missing before this can go out.',
  AWAITING_APPROVAL: 'Everything is ready. It needs your approval to go.',
  SUBMITTED: "You're done. We'll keep watching this one.",
  MONITORING: 'Waiting on the authority. We are watching for a response.',
  FOLLOW_UP_READY: 'This case needs attention — we have prepared the next step.',
  ESCALATION_READY: 'No movement. Escalation is now appropriate.',
  RESOLVED: 'Looks like this one is resolved.',
  CLOSED: 'Closed without a resolution. You can still escalate later.',
};

/**
 * Derives the phase from the record and the clock.
 *
 * Computed rather than stored, so a phase can never contradict the case it
 * describes. The ordering matters: escalation outranks follow-up, which
 * outranks plain monitoring.
 */
export function casePhase(record: CaseRecord, now: Date = new Date()): CasePhase {
  if (record.status === 'RESOLVED') return 'RESOLVED';
  if (record.status === 'CLOSED_UNRESOLVED') return 'CLOSED';

  if (!record.submittedAt) {
    const outstanding = remainingPlaceholders(`${record.complaint.subject}\n${record.complaint.body}`);
    return outstanding.length > 0 ? 'PREPARING' : 'AWAITING_APPROVAL';
  }

  const escalation = assessEscalation(record, now);
  if (escalation.availableLevel > 0) return 'ESCALATION_READY';
  if (escalation.followUpOverdue) return 'FOLLOW_UP_READY';
  return record.status === 'SUBMITTED' ? 'SUBMITTED' : 'MONITORING';
}

/* ------------------------------------------------------------------ */
/* Policy                                                             */
/* ------------------------------------------------------------------ */

export interface ActionContext {
  record: CaseRecord;
  /** Confirmed evidence count, read from storage rather than the record. */
  confirmedEvidence: number;
  /** The citizen pressed "Approve & submit" on this request. */
  approved: boolean;
  now: Date;
}

export interface PolicyDecision {
  allowed: boolean;
  /** Citizen-facing explanation when refused. Safe to display. */
  reason?: string;
}

/**
 * The gate every action passes through.
 *
 * Reads only persisted state and the knowledge layer. There is no parameter
 * here that a model could influence.
 */
export function checkAction(action: AgentActionId, context: ActionContext): PolicyDecision {
  const { record, approved } = context;
  const closed = record.status === 'RESOLVED' || record.status === 'CLOSED_UNRESOLVED';

  switch (action) {
    case 'submit_complaint':
    case 'prepare_submission': {
      if (closed) return { allowed: false, reason: 'This case is already closed.' };
      if (record.submittedAt) {
        return { allowed: false, reason: 'This complaint has already been submitted.' };
      }
      if (!approved) {
        return { allowed: false, reason: 'CivicSOS needs your approval before it submits anything.' };
      }
      const outstanding = remainingPlaceholders(`${record.complaint.subject}\n${record.complaint.body}`);
      if (outstanding.length > 0) {
        return { allowed: false, reason: 'The complaint still has blanks that need filling in.' };
      }
      return { allowed: true };
    }

    case 'send_follow_up': {
      if (closed) return { allowed: false, reason: 'This case is already closed.' };
      if (!record.submittedAt) {
        return { allowed: false, reason: 'Follow-ups start once the complaint has been submitted.' };
      }
      if (!approved) {
        return { allowed: false, reason: 'CivicSOS needs your approval before it sends a follow-up.' };
      }
      return { allowed: true };
    }

    case 'verify_submission':
    case 'capture_reference':
      if (closed) return { allowed: false, reason: 'This case is already closed.' };
      return { allowed: true };

    // Read-only actions: safe on any case the caller can already see.
    default:
      return { allowed: true };
  }
}

export function assertActionAllowed(action: AgentActionId, context: ActionContext): void {
  const decision = checkAction(action, context);
  if (!decision.allowed) throw AppError.conflict(decision.reason ?? 'That action is not available right now.');
}

/* ------------------------------------------------------------------ */
/* Plans                                                              */
/* ------------------------------------------------------------------ */

/** The submission run, in order. */
export const SUBMISSION_PLAN: AgentActionId[] = [
  'resolve_jurisdiction',
  'validate_evidence',
  'find_official_channel',
  'generate_complaint',
  'prepare_submission',
  'submit_complaint',
  'verify_submission',
  'capture_reference',
  'notify_user',
];

export const FOLLOW_UP_PLAN: AgentActionId[] = [
  'check_case_status',
  'prepare_follow_up',
  'send_follow_up',
  'evaluate_escalation',
  'notify_user',
];

/** Citizen-facing titles. Plain language, present participle. */
export const ACTION_TITLES: Record<AgentActionId, string> = {
  resolve_jurisdiction: 'Understanding the problem',
  find_official_channel: 'Finding the right channel',
  validate_evidence: 'Checking your evidence',
  generate_complaint: 'Preparing your complaint',
  prepare_submission: 'Filling in the submission',
  submit_complaint: 'Submitting your complaint',
  verify_submission: 'Verifying the submission',
  capture_reference: 'Confirming your reference',
  check_case_status: 'Checking the case status',
  prepare_follow_up: 'Preparing your follow-up',
  send_follow_up: 'Sending the follow-up',
  evaluate_escalation: 'Checking whether to escalate',
  notify_user: 'Updating your case',
};

export function agentStep(
  action: AgentActionId,
  detail: string,
  status: AgentStepStatus,
  now: Date,
): AgentStep {
  return { action, title: ACTION_TITLES[action], detail, status, completedAt: isoNow(now) };
}

/* ------------------------------------------------------------------ */
/* Deterministic details                                              */
/* ------------------------------------------------------------------ */

/** What the jurisdiction step reports. Straight from the knowledge layer. */
export function describeJurisdiction(record: CaseRecord): string {
  const path = getResolutionPath(record.categoryId);
  const authority = getAuthority(path.authorityId);
  const place = [record.location.locality, record.location.city].filter(Boolean).join(', ');
  return `${authority.name}${place ? ` for ${place}` : ''}.`;
}

/** What the channel step reports, and the channel it actually selected. */
export function selectSubmissionChannel(record: CaseRecord) {
  const authority = getAuthority(getResolutionPath(record.categoryId).authorityId);
  // Prefer a genuinely official, nationally available channel. Only if there is
  // none does the agent fall back to the generic template, and it says so.
  const official = authority.channels.find((channel) => !channel.isSample && channel.kind !== 'PHONE');
  const channel = official ?? authority.channels[0];
  if (!channel) throw AppError.internal({ reason: 'authority has no channels', authorityId: authority.authorityId });
  return { authority, channel, isVerified: !channel.isSample };
}

export interface EvidenceCheck {
  satisfied: boolean;
  missing: string[];
  detail: string;
}

/** Evidence validation, against the category's own requirements. */
export function validateEvidence(record: CaseRecord, confirmedEvidence: number): EvidenceCheck {
  const path = getResolutionPath(record.categoryId);
  const hasLocation = Boolean(record.location.locality || record.location.city);

  const missing: string[] = [];
  for (const requirement of path.evidenceRequirements as Omit<EvidenceRequirement, 'satisfied'>[]) {
    if (!requirement.required) continue;
    if (requirement.key === 'photo' && confirmedEvidence === 0) missing.push('a photo');
    else if (requirement.key === 'location' && !hasLocation) missing.push('the location');
  }

  return {
    satisfied: missing.length === 0,
    missing,
    detail:
      missing.length === 0
        ? `${confirmedEvidence} photo${confirmedEvidence === 1 ? '' : 's'} and a location — everything the department asks for.`
        : `Still needed: ${missing.join(' and ')}.`,
  };
}

/**
 * Deterministic demo reference.
 *
 * The `CS-DEMO-` prefix is not cosmetic: it is the guarantee that a simulated
 * reference can never be mistaken for one a real authority issued. Derived from
 * the case id so the same case always produces the same reference, which is
 * what makes the demo reproducible.
 */
export function demoReference(caseId: string): string {
  let hash = 0;
  for (let index = 0; index < caseId.length; index += 1) {
    hash = (hash * 31 + caseId.charCodeAt(index)) | 0;
  }
  return `CS-DEMO-${(Math.abs(hash) % 90000) + 10000}`;
}

/** Timeline entries the agent writes, so its work is auditable afterwards. */
export function agentTimelineMessage(step: AgentStep): Pick<CaseEvent, 'type' | 'message'> {
  switch (step.action) {
    case 'submit_complaint':
      return { type: 'MARKED_SUBMITTED', message: `CivicSOS submitted the complaint. ${step.detail}` };
    case 'capture_reference':
      return { type: 'NOTE_ADDED', message: `Reference captured: ${step.detail}` };
    case 'send_follow_up':
      return { type: 'FOLLOW_UP_LOGGED', message: `CivicSOS sent a follow-up. ${step.detail}` };
    default:
      return { type: 'NOTE_ADDED', message: `${step.title}: ${step.detail}` };
  }
}
