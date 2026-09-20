import type {
  AuthContext,
  CaseEvent,
  CaseRecord,
  CaseStatus,
  ResolutionPlan,
} from '../domain/types.js';
import type {
  AnalyzeRequest,
  CreateCaseRequest,
  FollowUpRequest,
  ListCasesQuery,
  MarkSubmittedRequest,
  ResolveCaseRequest,
  UpdateCaseRequest,
} from '../schemas/requests.js';
import type { Page } from '../ports/index.js';
import type { ServiceContext } from './context.js';
import { AppError } from '../domain/errors.js';
import { newCaseEventId, newCaseId } from '../domain/ids.js';
import { assertCanReadCase, assertCanWriteCase, hasRole } from './authorization.js';
import { assertTransition, isOpen } from '../rules/status.js';
import { buildCasePlan } from '../rules/resolution.js';
import { buildComplaintDraft, remainingPlaceholders } from '../rules/complaint.js';
import { getResolutionPath } from '../knowledge/resolution-paths.js';
import { assessEscalation, computeFollowUpDate, nextEscalationStep } from '../rules/followup.js';
import { runAnalysis, type AnalyzeOutcome } from '../ai/pipeline.js';
import { PointsService, type AwardResult } from './points-service.js';
import { earnsCompletenessBonus } from '../rules/points.js';
import { classifyDeterministic } from '../rules/classify.js';
import { isoNow } from '../util/time.js';
import { sanitizeLine } from '../util/sanitize.js';

/**
 * Case service — the application's core workflow.
 *
 * Responsibilities: authorization, state transitions, persistence, timeline
 * events, audit records and async event publication. The civic decisions
 * (authority, evidence, timings, escalation) come from the rules engine; the
 * natural-language work comes from the AI pipeline. This layer orchestrates.
 */

export interface CaseDetail {
  case: CaseRecord;
  plan: ResolutionPlan;
  escalation: ReturnType<typeof assessEscalation>;
  nextEscalationStep?: ReturnType<typeof nextEscalationStep>;
  timeline: CaseEvent[];
  /** Placeholders still to be filled before the complaint is submission-ready. */
  outstandingPlaceholders: string[];
}

export class CaseService {
  private readonly points: PointsService;

  constructor(private readonly ctx: ServiceContext) {
    this.points = new PointsService(ctx);
  }

  /** Step 3 of the journey: understand the problem and produce a plan. */
  async analyze(auth: AuthContext, request: AnalyzeRequest): Promise<AnalyzeOutcome> {
    // The only endpoint that can cost money, so it carries its own allowance
    // on top of API Gateway throttling.
    const allowed = await this.ctx.rateLimiter.tryConsume(`analyze:${auth.userId}`);
    if (!allowed) {
      await this.ctx.audit.record({
        auth,
        action: 'CASE_ANALYZE',
        resource: 'analysis',
        outcome: 'DENY',
        detail: 'rate limited',
      });
      throw AppError.rateLimited('You have run quite a few analyses in the last minute. Please wait a moment.');
    }

    const outcome = await runAnalysis(
      {
        description: request.description,
        location: request.location,
        categoryId: request.categoryId,
        hasPhoto: request.hasPhoto,
        skipAi: request.skipAi,
        now: this.ctx.clock.now(),
      },
      { gemini: this.ctx.gemini, logger: this.ctx.logger.child({ requestId: auth.requestId }) },
    );

    await this.ctx.audit.record({
      auth,
      action: 'CASE_ANALYZE',
      resource: 'analysis',
      outcome: 'ALLOW',
      detail: `category=${outcome.analysis.categoryId} fallback=${outcome.analysis.usedFallback}`,
    });

    return outcome;
  }

  /** Steps 11–12: create the tracked case. */
  async create(
    auth: AuthContext,
    request: CreateCaseRequest,
  ): Promise<{ case: CaseRecord; created: boolean; pointsAwarded: number; awards: AwardResult[] }> {
    const now = this.ctx.clock.now();
    const nowIso = isoNow(now);

    // Urgency is re-derived server-side. A client claiming CRITICAL must not be
    // able to jump the reminder cadence just by editing a request body.
    const deterministic = classifyDeterministic(request.description);
    const urgency = request.urgency && hasRole(auth, 'ADMIN') ? request.urgency : deterministic.urgency;

    const complaint = request.complaint
      ? {
          subject: request.complaint.subject,
          body: request.complaint.body,
          placeholders: remainingPlaceholders(`${request.complaint.subject}\n${request.complaint.body}`),
          provenance: 'USER_PROVIDED' as const,
          editedByUser: true,
        }
      : buildComplaintDraft({
          categoryId: request.categoryId,
          description: request.description,
          location: request.location,
          sinceWhen: request.facts?.sinceWhen,
          hazardType: request.facts?.hazardType,
          riskToPeople: request.facts?.riskToPeople,
          householdsAffected: request.facts?.householdsAffected,
          consumerNumber: request.facts?.consumerNumber,
          reporterName: request.facts?.reporterName,
          reporterContact: request.facts?.reporterContact,
          now,
        });

    const path = getResolutionPath(request.categoryId);

    const draft: CaseRecord = {
      caseId: newCaseId(now),
      ownerId: auth.userId,
      status: complaint.placeholders.length === 0 ? 'READY_TO_SUBMIT' : 'DRAFT',
      categoryId: request.categoryId,
      urgency,
      description: request.description,
      summary: request.summary || deriveSummary(request.description),
      location: request.location,
      pathId: path.pathId,
      authorityId: path.authorityId,
      complaint,
      escalationLevel: 0,
      evidenceCount: 0,
      isDemo: false,
      classifiedBy: request.complaint ? 'USER_PROVIDED' : 'DETERMINISTIC_RULES',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    draft.followUpAt = computeFollowUpDate(draft);

    const { record, created } = await this.ctx.repository.createCase(draft, request.idempotencyKey);

    // Points are a side effect of the real action, never its precondition, and
    // are idempotent per case — so a replayed create awards nothing extra.
    const awards = created ? await this.points.awardForNewCase(record, earnsCompletenessBonus(record)) : [];
    const pointsAwarded = awards.reduce((sum, award) => sum + award.delta, 0);

    if (created) {
      await this.appendEvent(record.caseId, {
        type: 'CASE_CREATED',
        message: 'Case created in CivicSOS.',
        actor: auth.userId,
        data: { category: record.categoryId, urgency: record.urgency },
      });
      // Fire-and-forget: reminder scheduling and notification happen
      // asynchronously so the citizen's request stays fast.
      await this.publish('CaseCreated', record, { category: record.categoryId, urgency: record.urgency });
    }

    await this.ctx.audit.record({
      auth,
      action: 'CASE_CREATE',
      resource: `case/${record.caseId}`,
      outcome: 'ALLOW',
      detail: created ? 'created' : 'idempotent replay',
    });

    return { case: record, created, pointsAwarded, awards };
  }

  async list(auth: AuthContext, query: ListCasesQuery): Promise<Page<CaseRecord>> {
    return this.ctx.repository.listCasesByOwner(auth.userId, {
      status: query.status,
      limit: query.limit ?? 20,
      cursor: query.cursor,
      includeDemo: query.includeDemo ?? true,
    });
  }

  /** Steps 12–16: the full case view, including the live "what happens next" plan. */
  async detail(auth: AuthContext, caseId: string): Promise<CaseDetail> {
    const record = assertCanReadCase(auth, await this.ctx.repository.getCase(caseId));
    const now = this.ctx.clock.now();
    const [timeline, evidence] = await Promise.all([
      this.ctx.repository.listEvents(caseId),
      this.ctx.repository.listEvidence(caseId),
    ]);

    const plan = buildCasePlan(record, { hasPhoto: evidence.some((item) => item.confirmed), now });

    return {
      case: record,
      plan,
      escalation: plan.escalationAssessment,
      nextEscalationStep: nextEscalationStep(record.categoryId, record.escalationLevel),
      timeline,
      outstandingPlaceholders: remainingPlaceholders(`${record.complaint.subject}\n${record.complaint.body}`),
    };
  }

  async update(auth: AuthContext, caseId: string, request: UpdateCaseRequest): Promise<CaseRecord> {
    const existing = assertCanWriteCase(auth, await this.ctx.repository.getCase(caseId));
    const now = this.ctx.clock.now();
    const next: CaseRecord = { ...existing, updatedAt: isoNow(now) };
    const changes: string[] = [];

    if (request.status && request.status !== existing.status) {
      assertTransition(existing.status, request.status);
      next.status = request.status;
      changes.push(`status=${request.status}`);
    }

    if (request.categoryId && request.categoryId !== existing.categoryId) {
      // Re-routing the case changes the authority and every timing with it,
      // so the resolution path is recomputed rather than patched.
      const path = getResolutionPath(request.categoryId);
      next.categoryId = request.categoryId;
      next.pathId = path.pathId;
      next.authorityId = path.authorityId;
      next.followUpAt = computeFollowUpDate(next);
      changes.push(`category=${request.categoryId}`);
    }

    if (request.location) {
      next.location = { ...existing.location, ...request.location };
      changes.push('location');
    }

    if (request.officialReference !== undefined) {
      next.officialReference = request.officialReference;
      changes.push('reference');
    }

    if (request.complaint) {
      const subject = request.complaint.subject ?? existing.complaint.subject;
      const body = request.complaint.body ?? existing.complaint.body;
      next.complaint = {
        ...existing.complaint,
        subject,
        body,
        placeholders: remainingPlaceholders(`${subject}\n${body}`),
        editedByUser: true,
      };
      // Completing the last placeholder is what makes a draft submittable.
      if (next.status === 'DRAFT' && next.complaint.placeholders.length === 0) {
        next.status = 'READY_TO_SUBMIT';
      }
      changes.push('complaint');
    }

    const saved = await this.ctx.repository.updateCase(next);

    if (request.complaint) {
      await this.appendEvent(caseId, {
        type: 'COMPLAINT_EDITED',
        message: 'Complaint text updated.',
        actor: auth.userId,
      });
    }
    if (request.note) {
      await this.appendEvent(caseId, { type: 'NOTE_ADDED', message: request.note, actor: auth.userId });
    }
    if (next.status !== existing.status) {
      await this.appendEvent(caseId, {
        type: 'STATUS_CHANGED',
        message: `Status changed from ${existing.status} to ${next.status}.`,
        actor: auth.userId,
        data: { from: existing.status, to: next.status },
      });
      await this.publish('CaseStatusChanged', saved, { from: existing.status, to: next.status });
    }

    await this.ctx.audit.record({
      auth,
      action: 'CASE_UPDATE',
      resource: `case/${caseId}`,
      outcome: 'ALLOW',
      detail: changes.join(',') || 'no-op',
    });

    return saved;
  }

  /** Step 10–11: the citizen records that they submitted it officially. */
  async markSubmitted(auth: AuthContext, caseId: string, request: MarkSubmittedRequest): Promise<CaseRecord> {
    const existing = assertCanWriteCase(auth, await this.ctx.repository.getCase(caseId));
    assertTransition(existing.status, 'SUBMITTED');

    const now = this.ctx.clock.now();
    const submittedAt = request.submittedAt ?? isoNow(now);
    const next: CaseRecord = {
      ...existing,
      status: 'SUBMITTED',
      submittedAt,
      officialReference: request.officialReference ?? existing.officialReference,
      // The citizen filed this themselves through a real channel, so the
      // reference is a real one. Recorded explicitly: without it a genuine
      // submission is indistinguishable from an unset field, and the case
      // screen cannot tell the citizen which of the two happened.
      submissionMode: 'MANUAL',
      updatedAt: isoNow(now),
    };
    next.followUpAt = computeFollowUpDate(next);

    const saved = await this.ctx.repository.updateCase(next);

    await this.appendEvent(caseId, {
      type: 'MARKED_SUBMITTED',
      message: request.channel
        ? `Submitted through ${sanitizeLine(request.channel, 120)}.`
        : 'Submitted through the official channel.',
      actor: auth.userId,
      data: request.officialReference ? { hasReference: true } : { hasReference: false },
    });
    await this.publish('CaseSubmitted', saved, { followUpAt: saved.followUpAt ?? '' });

    await this.ctx.audit.record({ auth, action: 'CASE_SUBMIT', resource: `case/${caseId}`, outcome: 'ALLOW' });
    return saved;
  }

  /** Step 14–16: log a follow-up, or record an escalation. */
  async followUp(auth: AuthContext, caseId: string, request: FollowUpRequest): Promise<CaseDetail> {
    const existing = assertCanWriteCase(auth, await this.ctx.repository.getCase(caseId));
    const now = this.ctx.clock.now();

    if (!isOpen(existing.status)) {
      throw AppError.conflict('This case is closed, so there is nothing to follow up on.');
    }
    if (!existing.submittedAt) {
      throw AppError.conflict(
        'Record the case as submitted first — follow-ups are measured from the date you filed it.',
      );
    }

    const assessment = assessEscalation(existing, now);
    const next: CaseRecord = { ...existing, updatedAt: isoNow(now) };

    if (request.escalate) {
      if (assessment.availableLevel === 0) {
        // Escalating too early weakens the citizen's position, so the rules
        // engine gates it and explains why.
        throw AppError.conflict(assessment.reason);
      }
      next.escalationLevel = assessment.availableLevel;
      next.status = 'ESCALATED';
    } else if (existing.status === 'SUBMITTED') {
      next.status = 'AWAITING_RESPONSE';
    }

    if (request.officialReference) next.officialReference = request.officialReference;
    next.followUpAt = computeFollowUpDate(next);

    await this.ctx.repository.updateCase(next);

    await this.appendEvent(caseId, {
      type: request.escalate ? 'ESCALATED' : 'FOLLOW_UP_LOGGED',
      message: request.note
        ? request.note
        : request.escalate
          ? `Escalated to step ${next.escalationLevel}: ${assessment.step?.title ?? ''}`.trim()
          : 'Followed up with the authority.',
      actor: auth.userId,
      data: { escalationLevel: next.escalationLevel, ageDays: assessment.ageDays },
    });

    if (request.escalate) {
      await this.publish('EscalationAvailable', next, { level: next.escalationLevel });
    }

    await this.ctx.audit.record({
      auth,
      action: request.escalate ? 'CASE_ESCALATE' : 'CASE_FOLLOW_UP',
      resource: `case/${caseId}`,
      outcome: 'ALLOW',
      detail: `level=${next.escalationLevel}`,
    });

    return this.detail(auth, caseId);
  }

  /** Step 17: close the case. */
  async resolve(
    auth: AuthContext,
    caseId: string,
    request: ResolveCaseRequest,
  ): Promise<{ case: CaseRecord; pointsAwarded: number; levelUp?: string }> {
    const existing = assertCanWriteCase(auth, await this.ctx.repository.getCase(caseId));
    const targetStatus: CaseStatus = request.outcome === 'FIXED' ? 'RESOLVED' : 'CLOSED_UNRESOLVED';
    assertTransition(existing.status, targetStatus);

    const now = this.ctx.clock.now();
    const next: CaseRecord = {
      ...existing,
      status: targetStatus,
      resolvedAt: isoNow(now),
      resolutionNote: request.resolutionNote,
      // Clearing the follow-up date removes the case from the reminder GSI,
      // so a resolved case can never generate another reminder.
      followUpAt: undefined,
      updatedAt: isoNow(now),
    };

    const saved = await this.ctx.repository.updateCase(next);

    // The large award is for an outcome, not for filing. Only a genuine fix
    // earns it; closing without a fix does not.
    const award =
      request.outcome === 'FIXED'
        ? await this.points.awardForResolution(saved)
        : { awarded: false, delta: 0, reason: 'CASE_RESOLVED' as const };

    await this.appendEvent(caseId, {
      type: 'RESOLVED',
      message:
        request.outcome === 'FIXED'
          ? request.resolutionNote || 'Marked resolved by the citizen.'
          : request.resolutionNote || 'Closed without resolution.',
      actor: auth.userId,
      data: { outcome: request.outcome },
    });
    await this.publish('CaseResolved', saved, { outcome: request.outcome });

    await this.ctx.audit.record({
      auth,
      action: 'CASE_RESOLVE',
      resource: `case/${caseId}`,
      outcome: 'ALLOW',
      detail: request.outcome,
    });

    return { case: saved, pointsAwarded: award.delta, levelUp: award.levelUp };
  }

  async timeline(auth: AuthContext, caseId: string): Promise<CaseEvent[]> {
    assertCanReadCase(auth, await this.ctx.repository.getCase(caseId));
    return this.ctx.repository.listEvents(caseId);
  }

  private async appendEvent(caseId: string, event: Omit<CaseEvent, 'caseId' | 'eventId' | 'createdAt'>): Promise<void> {
    const now = this.ctx.clock.now();
    await this.ctx.repository.appendEvent({
      ...event,
      caseId,
      eventId: newCaseEventId(now),
      createdAt: isoNow(now),
    });
  }

  private async publish(
    type: Parameters<ServiceContext['events']['publish']>[0]['type'],
    record: CaseRecord,
    detail?: Record<string, string | number | boolean>,
  ): Promise<void> {
    try {
      await this.ctx.events.publish({
        type,
        caseId: record.caseId,
        ownerId: record.ownerId,
        occurredAt: isoNow(this.ctx.clock.now()),
        detail,
      });
    } catch (error) {
      // Async side effects are enhancements, not part of the user's transaction.
      this.ctx.logger.error('event publish failed', { error, eventType: type, caseId: record.caseId });
    }
  }
}

/** First sentence, trimmed — good enough for a list row when no model ran. */
function deriveSummary(description: string): string {
  const firstSentence = description.split(/(?<=[.!?])\s/)[0] ?? description;
  return sanitizeLine(firstSentence, 200) || 'Civic problem reported.';
}
