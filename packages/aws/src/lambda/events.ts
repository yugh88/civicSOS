import type { EventBridgeHandler } from 'aws-lambda';
import { newNotificationId, StatusCheckService, unixSeconds, type StatusCheckResult } from '@civicsos/core';
import { getAwsRuntime } from '../runtime.js';

/**
 * Domain event consumer.
 *
 * Subscribed to the CivicSOS event bus and responsible for the work that should
 * not slow down a citizen's request: welcome notifications, audit records for
 * state changes, and anything else that can happen a second later without the
 * user noticing.
 *
 * Deliberately not responsible for anything the user's own request depends on.
 * If this function is down, cases are still created, submitted and resolved —
 * only the in-app reminder appears late.
 */

interface CaseEventDetail {
  caseId?: string;
  ownerId?: string;
  occurredAt?: string;
  [key: string]: unknown;
}

/** In-app notifications expire on their own so the table stays small. */
const NOTIFICATION_TTL_DAYS = 60;

export const handler: EventBridgeHandler<string, CaseEventDetail, void> = async (event) => {
  const runtime = await getAwsRuntime();
  const logger = runtime.logger.child({
    eventType: event['detail-type'],
    caseId: event.detail?.caseId,
  });

  /**
   * The worker's observations arrive here like any other domain event.
   *
   * Handled before the owner guard below because a status result deliberately
   * carries no owner: the worker is not trusted to say whose case this is, so
   * the service reads that from the stored record instead. A malformed result
   * therefore cannot drop one citizen's case into another's notifications.
   */
  if (event['detail-type'] === 'StatusCheckCompleted') {
    const result = event.detail as unknown as StatusCheckResult;
    if (!result?.caseId || !result?.targetId || !result?.outcome) {
      logger.warn('ignoring a malformed status check result');
      return;
    }
    const applied = await new StatusCheckService(runtime.ctx).applyResult(result);
    logger.info('status check result handled', { applied: applied.applied, reason: applied.reason });
    return;
  }

  const { caseId, ownerId } = event.detail ?? {};
  if (!caseId || !ownerId) {
    logger.warn('ignoring event without a case or owner');
    return;
  }

  try {
    switch (event['detail-type']) {
      case 'CaseCreated': {
        const record = await runtime.ctx.repository.getCase(caseId);
        if (!record) {
          // The event can arrive before an eventually-consistent read catches
          // up; there is nothing to do and the next sweep will handle the case.
          logger.warn('case not found yet, skipping welcome notification');
          return;
        }
        const now = runtime.ctx.clock.now();
        await runtime.ctx.repository.putNotification({
          notificationId: newNotificationId(now),
          userId: ownerId,
          caseId,
          kind: 'CASE_CREATED',
          title: 'Case created',
          body: record.followUpAt
            ? `We will remind you to follow up around ${record.followUpAt.slice(0, 10)}.`
            : 'Your case is being tracked.',
          read: false,
          createdAt: now.toISOString(),
          expiresAt: unixSeconds(new Date(now.getTime() + NOTIFICATION_TTL_DAYS * 86_400_000)),
        });
        logger.info('welcome notification created');
        return;
      }

      case 'CaseSubmitted':
      case 'CaseStatusChanged':
      case 'CaseResolved':
      case 'EvidenceAdded':
      case 'EscalationAvailable': {
        // The case timeline already records these for the citizen. Here they
        // become an immutable audit record attributed to the system.
        await runtime.ctx.audit.record({
          auth: { userId: 'system', role: 'ADMIN', requestId: event.id },
          action: `EVENT_${event['detail-type']}`,
          resource: `case/${caseId}`,
          outcome: 'ALLOW',
        });
        logger.info('event audited');
        return;
      }

      default:
        logger.warn('unhandled event type');
    }
  } catch (error) {
    // Rethrow so EventBridge retries and, after retries, the failure shows up
    // in CloudWatch rather than disappearing silently.
    logger.error('event handling failed', { error });
    throw error;
  }
};
