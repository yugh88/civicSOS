import type { ScheduledHandler } from 'aws-lambda';
import { ReminderService } from '@civicsos/core';
import { getAwsRuntime } from '../runtime.js';

/**
 * Reminder scheduler — invoked once a day by an EventBridge rule.
 *
 * One scheduled invocation plus a bounded query against the sparse follow-up
 * index, rather than a timer per case. That is both dramatically cheaper (a few
 * hundred invocations a year instead of one per case) and impossible to get out
 * of sync with case state, because the due set is derived from the cases
 * themselves every time it runs.
 */

/** Bounded so one sweep can never run away with the free-tier budget. */
const MAX_CASES_PER_SWEEP = 100;

export const handler: ScheduledHandler = async (event) => {
  const runtime = await getAwsRuntime();
  const logger = runtime.logger.child({ job: 'reminder-sweep', scheduledAt: event.time });

  try {
    const result = await new ReminderService(runtime.ctx).sweep(MAX_CASES_PER_SWEEP);
    logger.info('reminder sweep finished', {
      scanned: result.scanned,
      remindersCreated: result.remindersCreated,
      escalationsSuggested: result.escalationsSuggested,
    });
  } catch (error) {
    // Rethrown so the invocation is recorded as a failure and the CloudWatch
    // alarm on Lambda errors fires.
    logger.error('reminder sweep failed', { error });
    throw error;
  }
};
