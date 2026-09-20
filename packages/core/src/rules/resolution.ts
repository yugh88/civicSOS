import type {
  AnalysisResult,
  CaseRecord,
  CategoryId,
  EvidenceRequirement,
  LocationInput,
  PlanStep,
  ResolutionPlan,
  Urgency,
} from '../domain/types.js';
import { getCategory } from '../knowledge/categories.js';
import { KNOWLEDGE_DISCLAIMER, getAuthority } from '../knowledge/authorities.js';
import { getResolutionPath } from '../knowledge/resolution-paths.js';
import { assessEscalation, computeFollowUpDate, nextEscalationDate } from './followup.js';
import { formatLocation } from './complaint.js';
import { isoAddDays } from '../util/time.js';

/**
 * Resolution plan builder — the "What happens next?" engine.
 *
 * Takes a classified problem and produces the complete plan: who handles it,
 * what evidence is needed, what to do now, what happens after submission, when
 * to follow up, and how to escalate. Every value here is derived from the
 * knowledge layer and the rules engine, never from a model.
 */

export interface PlanContext {
  categoryId: CategoryId;
  urgency: Urgency;
  location: LocationInput;
  whatHappened: string;
  /** Evidence keys the user has already satisfied. */
  satisfiedEvidence?: string[];
  hasPhoto?: boolean;
  now?: Date;
}

/**
 * Marks evidence requirements as satisfied.
 *
 * `photo` and `location` are inferred from actual state rather than asking the
 * user to tick a box, so the checklist reflects reality.
 */
function resolveEvidence(context: PlanContext): EvidenceRequirement[] {
  const path = getResolutionPath(context.categoryId);
  const satisfied = new Set(context.satisfiedEvidence ?? []);
  const hasLocation = formatLocation(context.location).length > 0;

  return path.evidenceRequirements.map((requirement) => ({
    ...requirement,
    satisfied:
      satisfied.has(requirement.key) ||
      (requirement.key === 'photo' && Boolean(context.hasPhoto)) ||
      (requirement.key === 'location' && hasLocation),
  }));
}

/**
 * Builds the visual timeline.
 *
 * `status` is computed, not stored: the first incomplete step is CURRENT and
 * everything before it is DONE, so the timeline is always consistent with the
 * case's real state.
 */
function buildSteps(
  context: PlanContext,
  evidence: EvidenceRequirement[],
  /**
   * The date the rest of the product calls "your follow-up date" — the one on
   * the case header, in the overdue banner and in the reminder. The timeline
   * must quote that exact date rather than deriving its own, or the same screen
   * ends up saying the follow-up was due yesterday and again in seven days.
   */
  followUpAt: string,
  caseRecord?: Pick<CaseRecord, 'status' | 'submittedAt' | 'escalationLevel' | 'resolvedAt'>,
): PlanStep[] {
  const path = getResolutionPath(context.categoryId);
  const now = context.now ?? new Date();
  const missingRequired = evidence.filter((item) => item.required && !item.satisfied);
  const submitted = Boolean(caseRecord?.submittedAt);
  const resolved = caseRecord?.status === 'RESOLVED';
  const escalated = (caseRecord?.escalationLevel ?? 0) > 0;

  const anchor = caseRecord?.submittedAt ?? now.toISOString();

  const steps: Array<Omit<PlanStep, 'status'> & { done: boolean }> = [
    {
      key: 'understood',
      title: 'We worked out what this is',
      detail: `Classified as ${getCategory(context.categoryId).label.toLowerCase()}, handled by the ${getAuthority(
        path.authorityId,
      ).name.toLowerCase()}.`,
      owner: 'CIVICSOS',
      done: true,
    },
    {
      key: 'evidence',
      title: missingRequired.length === 0 ? 'Your evidence is ready' : 'Gather the required evidence',
      detail:
        missingRequired.length === 0
          ? 'You have everything the authority will ask for.'
          : submitted
            ? `You submitted without: ${missingRequired
                .map((item) => item.label.toLowerCase())
                .join(', ')}. Add it if the authority asks.`
            : `Still needed: ${missingRequired.map((item) => item.label.toLowerCase()).join(', ')}.`,
      owner: 'YOU',
      // Submitting moves the citizen past this step even if something was
      // missing — the checklist still shows what is absent, but the timeline
      // must not tell them to go back and do a step they have already passed.
      done: missingRequired.length === 0 || submitted,
    },
    {
      key: 'submit',
      title: 'Submit through the official channel',
      detail:
        'CivicSOS does not file complaints for you. Copy the complaint, submit it on the official channel, and save the reference number you get back.',
      owner: 'YOU',
      done: submitted,
    },
    {
      key: 'acknowledgement',
      title: 'Wait for acknowledgement',
      detail: `A complaint number or acknowledgement typically arrives within about ${path.expectedAcknowledgementDays} day(s).`,
      owner: 'AUTHORITY',
      done: submitted && (caseRecord?.status === 'AWAITING_RESPONSE' || escalated || resolved),
      dueAt: submitted ? isoAddDays(anchor, path.expectedAcknowledgementDays) : undefined,
    },
    {
      key: 'follow_up',
      title: 'Follow up if nothing happens',
      detail: `Chase it with your complaint number if there is no movement. Typical resolution window is about ${path.expectedResolutionDays} days.`,
      owner: 'YOU',
      // AWAITING_RESPONSE is exactly the state a logged follow-up produces.
      done: caseRecord?.status === 'AWAITING_RESPONSE' || escalated || resolved,
      // Only once submitted: before that there is nothing to chase, and a date
      // here would read as a deadline the citizen has already started missing.
      dueAt: submitted ? followUpAt : undefined,
    },
    {
      key: 'escalate',
      title: 'Escalate if still unresolved',
      detail: path.escalationSteps[0]
        ? `${path.escalationSteps[0].title} — ${path.escalationSteps[0].detail}`
        : 'Escalation guidance appears here once the waiting window has passed.',
      owner: 'YOU',
      done: escalated || resolved,
      dueAt: caseRecord ? nextEscalationDate({ ...caseRecord, categoryId: context.categoryId, createdAt: anchor }) : undefined,
    },
    {
      key: 'resolved',
      title: 'Mark it resolved',
      detail: 'Close the case once the problem is actually fixed. The full history stays available.',
      owner: 'YOU',
      done: resolved,
    },
  ];

  /**
   * Collapse the flags into statuses, enforcing monotonicity.
   *
   * A step can only be DONE if every step before it is also done. Without this
   * invariant a case could render "do this now" on step 2 while steps 3 and 4
   * showed as completed, which makes the timeline unreadable. The first
   * not-done step is CURRENT; everything after it is UPCOMING.
   */
  let stillOnTrack = true;
  let currentAssigned = false;

  return steps.map((step) => {
    const { done, ...rest } = step;
    if (stillOnTrack && done) return { ...rest, status: 'DONE' as const };
    stillOnTrack = false;
    if (!currentAssigned) {
      currentAssigned = true;
      return { ...rest, status: 'CURRENT' as const };
    }
    return { ...rest, status: 'UPCOMING' as const };
  });
}

export function buildResolutionPlan(
  context: PlanContext,
  caseRecord?: Pick<
    CaseRecord,
    'status' | 'submittedAt' | 'createdAt' | 'escalationLevel' | 'followUpAt' | 'resolvedAt'
  >,
): ResolutionPlan {
  const path = getResolutionPath(context.categoryId);
  const authority = getAuthority(path.authorityId);
  const category = getCategory(context.categoryId);
  const evidence = resolveEvidence(context);
  const now = context.now ?? new Date();

  const followUpAt = caseRecord
    ? (caseRecord.followUpAt ??
      computeFollowUpDate({
        categoryId: context.categoryId,
        urgency: context.urgency,
        submittedAt: caseRecord.submittedAt,
        createdAt: caseRecord.createdAt,
        escalationLevel: caseRecord.escalationLevel,
      }))
    : computeFollowUpDate({
        categoryId: context.categoryId,
        urgency: context.urgency,
        createdAt: now.toISOString(),
        escalationLevel: 0,
      });

  // Only show escalation steps that are relevant: everything above the level
  // already reached, so the guidance stays a forward-looking path.
  const reachedLevel = caseRecord?.escalationLevel ?? 0;
  const escalation = path.escalationSteps.filter((step) => step.level > reachedLevel);

  return {
    categoryId: context.categoryId,
    categoryLabel: category.label,
    urgency: context.urgency,
    whatHappened: context.whatHappened,
    authority,
    requestedAction: path.requestedAction,
    evidence,
    steps: buildSteps(context, evidence, followUpAt, caseRecord),
    expectedAcknowledgementDays: path.expectedAcknowledgementDays,
    expectedResolutionDays: path.expectedResolutionDays,
    followUpAt,
    afterSubmission: path.afterSubmission,
    escalation,
    submissionChannels: authority.channels,
    disclaimer: KNOWLEDGE_DISCLAIMER,
  };
}

/** Plan for an existing case, including live escalation availability. */
export function buildCasePlan(
  caseRecord: CaseRecord,
  options: { hasPhoto?: boolean; now?: Date } = {},
): ResolutionPlan & { escalationAssessment: ReturnType<typeof assessEscalation> } {
  const now = options.now ?? new Date();
  const plan = buildResolutionPlan(
    {
      categoryId: caseRecord.categoryId,
      urgency: caseRecord.urgency,
      location: caseRecord.location,
      whatHappened: caseRecord.summary,
      hasPhoto: options.hasPhoto ?? caseRecord.evidenceCount > 0,
      now,
    },
    caseRecord,
  );
  return { ...plan, escalationAssessment: assessEscalation(caseRecord, now) };
}

/** Convenience assembler used by the analyze endpoint. */
export function assembleAnalysis(parts: Omit<AnalysisResult, 'plan' | 'categoryLabel'>, plan: ResolutionPlan): AnalysisResult {
  return { ...parts, categoryLabel: getCategory(parts.categoryId).label, plan };
}
