import type { CaseRecord, NotificationRecord } from '../domain/types.js';
import type { ServiceContext } from './context.js';
import { newCaseEventId, newNotificationId } from '../domain/ids.js';
import { assessEscalation } from '../rules/followup.js';
import { isoNow, unixSeconds } from '../util/time.js';
import { addDays } from '../util/time.js';

/**
 * Reminder and escalation service — the asynchronous half of the product.
 *
 * Driven by an EventBridge schedule (once a day) rather than a per-case timer:
 * one scheduled invocation plus a sparse-GSI query is dramatically cheaper than
 * thousands of individual schedules, and it cannot drift out of sync with the
 * case state because the follow-up date is recomputed from the case itself.
 *
 * Notifications are stored in DynamoDB with a TTL and surfaced in-app. No email
 * or SMS provider is wired up: both cost money, and an unread in-app reminder is
 * honest about what actually happened.
 */

export interface ReminderSweepResult {
  scanned: number;
  remindersCreated: number;
  escalationsSuggested: number;
  caseIds: string[];
}

/** Notifications self-expire, so the table does not grow without bound. */
const NOTIFICATION_TTL_DAYS = 60;

export class ReminderService {
  constructor(private readonly ctx: ServiceContext) {}

  /**
   * Finds open cases past their follow-up date and records a reminder plus, when
   * the waiting window has elapsed, an escalation suggestion.
   *
   * Idempotent per day: the follow-up date is pushed forward as part of the
   * sweep, so a re-run on the same day does not double-notify.
   */
  async sweep(limit = 50): Promise<ReminderSweepResult> {
    const now = this.ctx.clock.now();
    const due = await this.ctx.repository.listCasesDueForFollowUp(isoNow(now), limit);

    const result: ReminderSweepResult = {
      scanned: due.length,
      remindersCreated: 0,
      escalationsSuggested: 0,
      caseIds: [],
    };

    for (const record of due) {
      try {
        const assessment = assessEscalation(record, now);

        // An unsubmitted case needs a nudge to submit, not to chase a
        // complaint number it does not have yet.
        const submitted = Boolean(record.submittedAt);
        await this.notify(record, {
          kind: 'FOLLOW_UP_DUE',
          title: submitted ? 'Time to follow up' : 'This is still waiting to be submitted',
          body: submitted
            ? `It has been ${assessment.ageDays} day(s) on "${record.summary}". Chase it with your complaint number.`
            : `"${record.summary}" has been sitting for ${assessment.ageDays} day(s) without being submitted. Nothing reaches the authority until you file it.`,
        });
        await this.ctx.repository.appendEvent({
          caseId: record.caseId,
          eventId: newCaseEventId(now),
          type: 'FOLLOW_UP_DUE',
          message: submitted
            ? 'CivicSOS flagged this case for follow-up.'
            : 'CivicSOS flagged this case as not yet submitted.',
          actor: 'system',
          createdAt: isoNow(now),
        });
        result.remindersCreated += 1;

        if (assessment.availableLevel > 0 && assessment.step) {
          await this.notify(record, {
            kind: 'ESCALATION_AVAILABLE',
            title: `Escalation step ${assessment.availableLevel} now applies`,
            body: assessment.step.title,
          });
          await this.ctx.repository.appendEvent({
            caseId: record.caseId,
            eventId: newCaseEventId(now),
            type: 'ESCALATION_SUGGESTED',
            message: `Escalation available: ${assessment.step.title}`,
            actor: 'system',
            createdAt: isoNow(now),
          });
          result.escalationsSuggested += 1;
        }

        // Push the follow-up date forward so the case leaves the due window
        // until the next cycle. This is what makes the sweep idempotent.
        await this.ctx.repository.updateCase({
          ...record,
          followUpAt: addDays(now, nextNudgeDays(record)).toISOString(),
          updatedAt: isoNow(now),
        });

        result.caseIds.push(record.caseId);
      } catch (error) {
        // One bad case must not abort the whole sweep.
        this.ctx.logger.error('reminder sweep failed for case', { error, caseId: record.caseId });
      }
    }

    this.ctx.logger.info('reminder sweep complete', {
      scanned: result.scanned,
      remindersCreated: result.remindersCreated,
      escalationsSuggested: result.escalationsSuggested,
    });

    return result;
  }

  private async notify(
    record: CaseRecord,
    params: { kind: NotificationRecord['kind']; title: string; body: string },
  ): Promise<void> {
    const now = this.ctx.clock.now();
    await this.ctx.repository.putNotification({
      notificationId: newNotificationId(now),
      userId: record.ownerId,
      caseId: record.caseId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      read: false,
      createdAt: isoNow(now),
      expiresAt: unixSeconds(addDays(now, NOTIFICATION_TTL_DAYS)),
    });
  }
}

/** Nudge cadence: urgent cases are chased sooner, and nobody is spammed daily. */
function nextNudgeDays(record: CaseRecord): number {
  switch (record.urgency) {
    case 'CRITICAL':
      return 2;
    case 'HIGH':
      return 3;
    case 'MEDIUM':
      return 7;
    default:
      return 10;
  }
}
