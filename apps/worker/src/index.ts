import { chromium } from 'playwright';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { StatusCheckRequest, StatusCheckResult } from '@civicsos/core';
import { runCheck } from './check.js';

/**
 * The CivicSOS status-check worker.
 *
 * A one-shot Fargate task: it starts, reads the batch of checks it was given,
 * opens one Chromium, walks them, publishes what it saw, and exits. Nothing
 * runs between invocations, which is why this is an on-demand task rather than
 * a service — a browser sitting idle is cost with no capability.
 *
 * What it can reach: the public internet, and EventBridge. That is the whole
 * IAM policy. It has no DynamoDB access, no S3 access, no API credential and no
 * ability to change a case, because the deterministic core decides what an
 * observation means and this process is only allowed to make observations.
 */

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const EVENT_BUS = process.env.EVENT_BUS_NAME;
const BASE_URL = process.env.PRACTICE_BASE_URL ?? '';

/** A whole batch should not outlive its usefulness. Fargate bills by the second. */
const MAX_BATCH_RUNTIME_MS = 4 * 60 * 1000;

/**
 * Politeness gap between two page loads.
 *
 * These are public services with real running costs, being read on behalf of
 * citizens who already have a right to the answer. Walking through them at
 * machine speed would be a good way to make CivicSOS someone's incident.
 */
const DELAY_BETWEEN_CHECKS_MS = 2_000;

function log(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  // Structured, and carrying no complaint text or citizen identity — the same
  // rule the Lambda logger enforces.
  console[level === 'error' ? 'error' : 'log'](
    JSON.stringify({ level, message, service: 'civicsos-worker', timestamp: new Date().toISOString(), ...fields }),
  );
}

/**
 * Reads the batch this task was started with.
 *
 * ECS `RunTask` container overrides arrive as environment variables, so the
 * batch comes in as JSON in `STATUS_CHECK_BATCH`. Anything malformed is a bug
 * upstream, and the right response is to exit cleanly rather than guess.
 */
function readBatch(): StatusCheckRequest[] {
  const raw = process.env.STATUS_CHECK_BATCH;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StatusCheckRequest =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as StatusCheckRequest).caseId === 'string' &&
        typeof (item as StatusCheckRequest).targetId === 'string' &&
        typeof (item as StatusCheckRequest).officialReference === 'string',
    );
  } catch {
    log('error', 'could not parse the status check batch');
    return [];
  }
}

async function publish(client: EventBridgeClient, results: StatusCheckResult[]): Promise<void> {
  if (!EVENT_BUS || results.length === 0) return;

  // PutEvents caps at 10 entries per call.
  for (let index = 0; index < results.length; index += 10) {
    const chunk = results.slice(index, index + 10);
    await client.send(
      new PutEventsCommand({
        Entries: chunk.map((result) => ({
          EventBusName: EVENT_BUS,
          Source: 'civicsos.worker',
          DetailType: 'StatusCheckCompleted',
          Detail: JSON.stringify(result),
        })),
      }),
    );
  }
}

async function main(): Promise<void> {
  const batch = readBatch();
  if (batch.length === 0) {
    log('info', 'nothing to check, exiting');
    return;
  }

  const startedAt = Date.now();
  const client = new EventBridgeClient({ region: REGION });
  const results: StatusCheckResult[] = [];

  // One browser for the batch; a fresh, storage-less context per check.
  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // No extensions, no plugins, nothing that could carry state between runs.
      '--disable-extensions',
    ],
  });

  try {
    for (const [index, request] of batch.entries()) {
      if (Date.now() - startedAt > MAX_BATCH_RUNTIME_MS) {
        // The rest will be picked up by the next sweep. Stopping is better than
        // a task that runs long and bills for it.
        log('warn', 'batch runtime cap reached, stopping early', { checked: index, total: batch.length });
        break;
      }

      const result = await runCheck(browser, request, { baseUrl: BASE_URL, now: () => new Date() });
      results.push(result);
      log('info', 'status check complete', { caseId: result.caseId, outcome: result.outcome });

      if (index < batch.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CHECKS_MS));
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  try {
    await publish(client, results);
    log('info', 'published status check results', { count: results.length });
  } catch (error) {
    // The observations are lost, but nothing is corrupted: the cases keep their
    // previous `lastStatusCheckAt` and are simply eligible again next sweep.
    log('error', 'could not publish results', { error: String(error), count: results.length });
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  log('error', 'worker failed', { error: String(error) });
  process.exitCode = 1;
});
