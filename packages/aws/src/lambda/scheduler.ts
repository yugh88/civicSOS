import type { ScheduledHandler } from 'aws-lambda';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { ReminderService, StatusCheckService, type StatusCheckRequest } from '@civicsos/core';
import { getAwsRuntime } from '../runtime.js';

/**
 * Daily scheduler — invoked once a day by an EventBridge rule.
 *
 * Two jobs, in order:
 *
 *  1. The reminder sweep: who should be nudged, and who can escalate.
 *  2. The status sweep: of those cases, which have a reference on a portal we
 *     can actually read — handed to a Fargate task that opens a real browser.
 *
 * One scheduled invocation plus a bounded query against the sparse follow-up
 * index, rather than a timer per case. That is both dramatically cheaper and
 * impossible to get out of sync with case state, because the due set is derived
 * from the cases themselves every time it runs.
 */

/** Bounded so one sweep can never run away with the free-tier budget. */
const MAX_CASES_PER_SWEEP = 100;

const CLUSTER_ARN = process.env.WORKER_CLUSTER_ARN;
const TASK_ARN = process.env.WORKER_TASK_ARN;
const CONTAINER_NAME = process.env.WORKER_CONTAINER_NAME ?? 'status-check';
const SUBNET_IDS = (process.env.WORKER_SUBNET_IDS ?? '').split(',').filter(Boolean);
const SECURITY_GROUP_ID = process.env.WORKER_SECURITY_GROUP_ID;

/** True only when the optional worker was deployed alongside this stack. */
function workerConfigured(): boolean {
  return Boolean(CLUSTER_ARN && TASK_ARN && SUBNET_IDS.length > 0 && SECURITY_GROUP_ID);
}

/**
 * Starts one task carrying the whole batch.
 *
 * One task rather than one per case: a container cold start costs seconds, and
 * launching a dozen Chromiums to read a dozen references would turn a cheap
 * nightly job into an expensive one for no benefit.
 */
async function startWorker(batch: StatusCheckRequest[]): Promise<string | undefined> {
  const ecs = new ECSClient({});
  const response = await ecs.send(
    new RunTaskCommand({
      cluster: CLUSTER_ARN,
      taskDefinition: TASK_ARN,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: SUBNET_IDS,
          securityGroups: SECURITY_GROUP_ID ? [SECURITY_GROUP_ID] : undefined,
          // Public subnet, no NAT gateway — the task needs a public IP to
          // reach the internet at all. See the worker construct for why that
          // is the cheap option rather than the lazy one.
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: CONTAINER_NAME,
            environment: [{ name: 'STATUS_CHECK_BATCH', value: JSON.stringify(batch) }],
          },
        ],
      },
    }),
  );

  return response.tasks?.[0]?.taskArn;
}

export const handler: ScheduledHandler = async (event) => {
  const runtime = await getAwsRuntime();
  const logger = runtime.logger.child({ job: 'daily-sweep', scheduledAt: event.time });

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

  if (!workerConfigured()) {
    // The worker is optional infrastructure. Without it the product behaves
    // exactly as it did before: the citizen follows up manually.
    logger.info('status check worker is not configured, skipping');
    return;
  }

  /**
   * The status sweep is explicitly *not* allowed to fail the invocation.
   *
   * The reminders above are the part citizens depend on. A browser that could
   * not start is a missing enhancement, not a missed reminder, and failing the
   * whole handler would fire an alarm for the wrong thing.
   */
  try {
    const now = runtime.ctx.clock.now();
    const candidates = await runtime.ctx.repository.listCasesDueForFollowUp(
      now.toISOString(),
      MAX_CASES_PER_SWEEP,
    );

    const sweep = await new StatusCheckService(runtime.ctx).sweep(candidates);
    if (sweep.requests.length === 0) {
      logger.info('no cases need a status check');
      return;
    }

    const taskArn = await startWorker(sweep.requests);
    logger.info('status check worker started', { batchSize: sweep.requests.length, taskArn });
  } catch (error) {
    logger.error('could not start the status check worker', { error });
  }
};
