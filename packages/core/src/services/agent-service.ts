import type { AgentRunResult, AgentStep, AuthContext, CaseRecord } from '../domain/types.js';
import type { ServiceContext } from './context.js';
import { AppError } from '../domain/errors.js';
import { newCaseEventId, timeOrderedId } from '../domain/ids.js';
import { assertCanWriteCase } from './authorization.js';
import {
  FOLLOW_UP_PLAN,
  SUBMISSION_PLAN,
  agentStep,
  agentTimelineMessage,
  assertActionAllowed,
  checkAction,
  demoReference,
  describeJurisdiction,
  selectSubmissionChannel,
  validateEvidence,
  type ActionContext,
} from '../rules/agent.js';
import { assessEscalation, computeFollowUpDate, nextEscalationStep } from '../rules/followup.js';
import { remainingPlaceholders } from '../rules/complaint.js';
import { isoNow } from '../util/time.js';
import { PointsService } from './points-service.js';

/**
 * The agent.
 *
 * Runs a fixed plan of allowed actions, each gated by policy, and records what
 * it actually did on the case timeline. Two properties are non-negotiable:
 *
 *  1. **It never submits without explicit approval.** `approve: true` must be
 *     present on the request, and the policy layer refuses otherwise.
 *  2. **It never touches a real government system.** The submission step runs
 *     against the demo environment below, which performs no network call at
 *     all — there is no URL, no fetch, nothing to misfire. Every reference it
 *     issues is prefixed `CS-DEMO-` and every case it touches is stamped
 *     `submissionMode: 'SIMULATED'`, so nothing downstream can present a
 *     simulated submission as a real one.
 *
 * A deployment that gains a genuine machine-to-machine submission channel
 * replaces `runDemoSubmission` and sets `submissionMode: 'MANUAL'` or a new
 * verified mode. Nothing else changes.
 */

export interface AgentRunRequest {
  /** Must be true for any action that acts on the citizen's behalf. */
  approve?: boolean;
}

export class AgentService {
  private readonly points: PointsService;

  constructor(private readonly ctx: ServiceContext) {
    this.points = new PointsService(ctx);
  }

  /**
   * Prepares and submits the complaint.
   *
   * Idempotent: an already-submitted case is refused by policy rather than
   * submitted twice, so a double-tapped approval cannot produce two complaints.
   */
  async submit(auth: AuthContext, caseId: string, request: AgentRunRequest): Promise<AgentRunResult & { case: CaseRecord }> {
    const record = assertCanWriteCase(auth, await this.ctx.repository.getCase(caseId));
    const now = this.ctx.clock.now();
    const evidence = await this.ctx.repository.listEvidence(caseId);
    const confirmedEvidence = evidence.filter((item) => item.confirmed).length;

    const context: ActionContext = {
      record,
      confirmedEvidence,
      approved: request.approve === true,
      now,
    };

    // Gate the whole run on its one privileged action before doing any work,
    // so a refusal is a clean explanation rather than a half-finished run.
    const gate = checkAction('submit_complaint', context);
    if (!gate.allowed) {
      await this.ctx.audit.record({
        auth,
        action: 'AGENT_SUBMIT',
        resource: `case/${caseId}`,
        outcome: 'DENY',
        detail: gate.reason,
      });
      throw AppError.conflict(gate.reason ?? 'That is not available right now.');
    }

    const steps: AgentStep[] = [];
    const { authority, channel, isVerified } = selectSubmissionChannel(record);

    steps.push(agentStep('resolve_jurisdiction', describeJurisdiction(record), 'OK', now));

    const evidenceCheck = validateEvidence(record, confirmedEvidence);
    steps.push(
      agentStep('validate_evidence', evidenceCheck.detail, evidenceCheck.satisfied ? 'OK' : 'SKIPPED', now),
    );

    steps.push(
      agentStep(
        'find_official_channel',
        isVerified
          ? `${channel.label} — a verified official channel.`
          : `${channel.label} — generic guidance, not a verified directory entry.`,
        'OK',
        now,
      ),
    );

    steps.push(
      agentStep(
        'generate_complaint',
        `${record.complaint.subject} — ${record.complaint.body.length} characters, no blanks left.`,
        'OK',
        now,
      ),
    );

    // From here the agent is acting, not just reading.
    assertActionAllowed('prepare_submission', context);
    const submission = this.runDemoSubmission(record, confirmedEvidence);
    steps.push(agentStep('prepare_submission', submission.prepared, 'OK', now));

    assertActionAllowed('submit_complaint', context);
    steps.push(agentStep('submit_complaint', submission.submitted, 'OK', now));

    steps.push(agentStep('verify_submission', submission.verified, 'OK', now));

    const reference = demoReference(caseId);
    steps.push(agentStep('capture_reference', reference, 'OK', now));

    // Persist through the same fields the manual path writes, so every later
    // rule — follow-up dates, escalation windows — behaves identically.
    const submitted: CaseRecord = {
      ...record,
      status: 'SUBMITTED',
      submittedAt: isoNow(now),
      officialReference: reference,
      submissionMode: 'SIMULATED',
      updatedAt: isoNow(now),
    };
    submitted.followUpAt = computeFollowUpDate(submitted);
    const saved = await this.ctx.repository.updateCase(submitted);

    for (const step of steps) {
      const entry = agentTimelineMessage(step);
      await this.ctx.repository.appendEvent({
        caseId,
        eventId: newCaseEventId(now),
        type: entry.type,
        message: entry.message,
        actor: 'agent',
        createdAt: isoNow(now),
      });
    }

    steps.push(
      agentStep(
        'notify_user',
        `We will check for a response around ${saved.followUpAt?.slice(0, 10) ?? 'the expected date'}.`,
        'OK',
        now,
      ),
    );

    await this.publish(saved, 'CaseSubmitted', { simulated: true });
    await this.ctx.audit.record({
      auth,
      action: 'AGENT_SUBMIT',
      resource: `case/${caseId}`,
      outcome: 'ALLOW',
      detail: `simulated reference=${reference}`,
    });

    this.ctx.logger.info('agent submission complete', { caseId, simulated: true, steps: steps.length });

    return {
      runId: timeOrderedId('run', now),
      steps,
      completed: true,
      reference,
      submissionMode: 'SIMULATED',
      simulated: true,
      case: saved,
    };
  }

  /**
   * Prepares the next follow-up, and sends it once approved.
   *
   * Without `approve`, this is a dry run: it returns the prepared message and
   * stops before `send_follow_up`, so the citizen can read exactly what would
   * go out before anything does.
   */
  async followUp(auth: AuthContext, caseId: string, request: AgentRunRequest): Promise<AgentRunResult & { case: CaseRecord; draft: string }> {
    const record = assertCanWriteCase(auth, await this.ctx.repository.getCase(caseId));
    const now = this.ctx.clock.now();
    const evidence = await this.ctx.repository.listEvidence(caseId);

    const context: ActionContext = {
      record,
      confirmedEvidence: evidence.filter((item) => item.confirmed).length,
      approved: request.approve === true,
      now,
    };

    if (!record.submittedAt) {
      throw AppError.conflict('Follow-ups start once the complaint has been submitted.');
    }

    const steps: AgentStep[] = [];
    const assessment = assessEscalation(record, now);

    steps.push(
      agentStep(
        'check_case_status',
        `${assessment.ageDays} day(s) since submission, no response recorded.`,
        'OK',
        now,
      ),
    );

    const draft = this.buildFollowUpMessage(record, assessment.ageDays);
    steps.push(agentStep('prepare_follow_up', 'A follow-up quoting your reference is ready to send.', 'OK', now));

    const gate = checkAction('send_follow_up', context);
    if (!gate.allowed) {
      // A dry run is the expected path, not an error: the citizen is meant to
      // read the message before approving it.
      steps.push(agentStep('send_follow_up', gate.reason ?? 'Waiting for your approval.', 'BLOCKED', now));
      return {
        runId: timeOrderedId('run', now),
        steps,
        completed: false,
        blockedReason: gate.reason,
        simulated: true,
        case: record,
        draft,
      };
    }

    steps.push(
      agentStep('send_follow_up', `Sent through the demo environment, quoting ${record.officialReference ?? 'your reference'}.`, 'OK', now),
    );

    const next: CaseRecord = {
      ...record,
      status: record.status === 'SUBMITTED' ? 'AWAITING_RESPONSE' : record.status,
      updatedAt: isoNow(now),
    };
    next.followUpAt = computeFollowUpDate(next);
    const saved = await this.ctx.repository.updateCase(next);

    await this.ctx.repository.appendEvent({
      caseId,
      eventId: newCaseEventId(now),
      type: 'FOLLOW_UP_LOGGED',
      message: 'CivicSOS sent a follow-up on your behalf (demo environment).',
      actor: 'agent',
      createdAt: isoNow(now),
    });

    const escalation = assessEscalation(saved, now);
    const nextStep = nextEscalationStep(saved.categoryId, saved.escalationLevel);
    steps.push(
      agentStep(
        'evaluate_escalation',
        escalation.availableLevel > 0
          ? `Escalation step ${escalation.availableLevel} is now appropriate.`
          : nextStep
            ? `Not yet — ${nextStep.title.toLowerCase()} applies after ${nextStep.afterDays} days.`
            : 'No further escalation steps remain.',
        'OK',
        now,
      ),
    );
    steps.push(
      agentStep('notify_user', `Next check around ${saved.followUpAt?.slice(0, 10) ?? 'the expected date'}.`, 'OK', now),
    );

    await this.ctx.audit.record({ auth, action: 'AGENT_FOLLOW_UP', resource: `case/${caseId}`, outcome: 'ALLOW' });

    return {
      runId: timeOrderedId('run', now),
      steps,
      completed: true,
      simulated: true,
      case: saved,
      draft,
    };
  }

  /**
   * The demo submission environment.
   *
   * Deliberately pure: it takes a case, returns strings describing what a
   * submission would involve, and performs **no network call**. There is no URL
   * here and no HTTP client, so there is no code path by which a demo run could
   * reach a real portal.
   */
  private runDemoSubmission(record: CaseRecord, confirmedEvidence: number) {
    const { channel } = selectSubmissionChannel(record);
    const place = [record.location.locality, record.location.city].filter(Boolean).join(', ') || 'the reported location';

    return {
      prepared: `Category, location (${place}) and ${confirmedEvidence} attachment${confirmedEvidence === 1 ? '' : 's'} filled into the form.`,
      submitted: `Complaint lodged in the CivicSOS demo submission environment (a simulation of ${channel.label}).`,
      verified: 'Submission confirmed present in the demo environment.',
    };
  }

  private buildFollowUpMessage(record: CaseRecord, ageDays: number): string {
    const reference = record.officialReference ?? '[[REFERENCE]]';
    const place = [record.location.locality, record.location.city].filter(Boolean).join(', ');
    // The summary is a complete sentence; splicing it mid-sentence would leave
    // a stray full stop before the location clause.
    const subject = record.summary.replace(/[.!?]+\s*$/, '').toLowerCase();

    return `Subject: Follow-up on complaint ${reference}

Sir / Madam,

I am following up on complaint ${reference}, filed ${ageDays} day(s) ago regarding ${subject}${place ? ` at ${place}` : ''}.

No action has been observed at the location and I have not received an update.

I request:
1. The current status of the complaint and the officer it is assigned to.
2. An expected date for the work to be carried out.

Photographs taken since the complaint was filed are available on request.

Yours faithfully,`;
  }

  private async publish(record: CaseRecord, type: 'CaseSubmitted', detail: Record<string, string | number | boolean>) {
    try {
      await this.ctx.events.publish({
        type,
        caseId: record.caseId,
        ownerId: record.ownerId,
        occurredAt: isoNow(this.ctx.clock.now()),
        detail,
      });
    } catch (error) {
      // Async side effects are never part of the citizen's transaction.
      this.ctx.logger.error('agent event publish failed', { error, caseId: record.caseId });
    }
  }

  /** Placeholders still blocking submission, for the approval screen. */
  outstanding(record: CaseRecord): string[] {
    return remainingPlaceholders(`${record.complaint.subject}\n${record.complaint.body}`);
  }

  /** Points are awarded by the case service; exposed here for the run summary. */
  get pointsService(): PointsService {
    return this.points;
  }
}
