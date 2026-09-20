import type { CaseRecord, StatusCheckRequest, StatusCheckResult } from '../domain/types.js';
import type { ServiceContext } from './context.js';
import { applyStatusCheck, MAX_CHECKS_PER_SWEEP, shouldCheckStatus, statusCheckTargetFor } from '../rules/status-check.js';
import { getStatusCheckTarget } from '../status-check/targets.js';
import { addDays, isoNow, unixSeconds } from '../util/time.js';
import { newCaseEventId, newNotificationId } from '../domain/ids.js';

/**
 * Scheduling status checks, and applying what came back.
 *
 * This service never opens a browser. It decides *which* cases are worth
 * looking at and publishes a request; a container running Playwright does the
 * looking and publishes a result; this service applies that result through the
 * deterministic rules. The worker holds no database access, no API credential
 * and no authority over case state — it can only describe what it saw.
 *
 * That split is deliberate. A browser driving a third-party page is the least
 * predictable component in the system, so it is also the one with the least
 * power.
 */

const NOTIFICATION_TTL_DAYS = 45;

export interface StatusSweepResult {
  scanned: number;
  /** The batch to hand to whatever runs the browser. */
  requests: StatusCheckRequest[];
}

export class StatusCheckService {
  constructor(private readonly ctx: ServiceContext) {}

  /**
   * Picks the cases worth looking up and returns them as a batch.
   *
   * Deliberately returns rather than dispatches: how a check actually reaches a
   * browser — a Fargate task, a queue, a developer running the worker on their
   * laptop — is an infrastructure decision, and the core does not get to have
   * one. It only decides *what* is worth checking.
   *
   * Runs over the same population the reminder sweep already walks: cases that
   * are open and past their follow-up date are exactly the cases where "has
   * anything actually happened?" is the unanswered question.
   */
  async sweep(candidates: CaseRecord[]): Promise<StatusSweepResult> {
    const now = this.ctx.clock.now();
    const requests: StatusCheckRequest[] = [];

    for (const record of candidates) {
      if (requests.length >= MAX_CHECKS_PER_SWEEP) break;
      if (!shouldCheckStatus(record, now)) continue;

      const targetId = statusCheckTargetFor(record);
      if (!targetId || !record.officialReference) continue;

      requests.push({
        caseId: record.caseId,
        ownerId: record.ownerId,
        targetId,
        // The citizen's own complaint number, which is the only thing the
        // worker needs. Nothing else about them travels with it: no name, no
        // address, no complaint text.
        officialReference: record.officialReference,
      });
    }

    this.ctx.logger.info('status check sweep complete', {
      scanned: candidates.length,
      requested: requests.length,
    });
    return { scanned: candidates.length, requests };
  }

  /**
   * Applies one observation from the worker.
   *
   * Authorization note: the worker is a trusted internal caller, but it does
   * not get to name a case *and* an owner — the owner is read from the stored
   * record. A result quoting the wrong owner therefore cannot leak one
   * citizen's case into another's notification list.
   */
  async applyResult(result: StatusCheckResult): Promise<{ applied: boolean; reason?: string }> {
    const now = this.ctx.clock.now();

    if (!getStatusCheckTarget(result.targetId)) {
      // A result for a target that is not in the registry is not a result we
      // asked for. Refusing is cheap; trusting it is not.
      this.ctx.logger.warn('status check result for an unknown target', { targetId: result.targetId });
      return { applied: false, reason: 'unknown-target' };
    }

    const record = await this.ctx.repository.getCase(result.caseId);
    if (!record) return { applied: false, reason: 'case-not-found' };

    const application = applyStatusCheck(record, result, now);

    await this.ctx.repository.updateCase(application.record);

    await this.ctx.repository.appendEvent({
      caseId: record.caseId,
      eventId: newCaseEventId(now),
      type: 'STATUS_CHECKED',
      message: application.eventMessage,
      // Attributed to the agent, never to the citizen — they were asleep.
      actor: 'agent',
      data: { outcome: result.outcome, targetId: result.targetId },
      createdAt: isoNow(now),
    });

    if (application.notification) {
      await this.ctx.repository.putNotification({
        notificationId: newNotificationId(now),
        userId: record.ownerId,
        caseId: record.caseId,
        kind: application.notification.kind,
        title: application.notification.title,
        body: application.notification.body,
        read: false,
        createdAt: isoNow(now),
        expiresAt: unixSeconds(addDays(now, NOTIFICATION_TTL_DAYS)),
      });
    }

    this.ctx.logger.info('status check applied', {
      caseId: record.caseId,
      outcome: result.outcome,
      changed: application.changed,
    });

    return { applied: true };
  }
}
