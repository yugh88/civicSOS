import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Logger, RateLimiter } from '@civicsos/core';
import { unixSeconds } from '@civicsos/core';

/**
 * Distributed rate limiter, backed by the table we already have.
 *
 * Replaces the per-container in-memory limiter, which counted separately in
 * every warm Lambda — so the real ceiling was `limit × containers`, not `limit`.
 * That was a documented approximation; this closes it.
 *
 * Why DynamoDB and not Redis, which is the usual answer:
 *
 *   ElastiCache lives in a VPC, so every Lambda would have to join that VPC.
 *   That means either interface endpoints for SSM, EventBridge and Cognito
 *   (~$7/month each) or a NAT gateway (~$32/month before traffic) — plus the
 *   cache node itself. It converts a VPC-free architecture into a VPC one, and
 *   adds a second datastore to keep alive, to solve a problem one conditional
 *   write already solves.
 *
 *   A fixed-window counter is a single atomic `UpdateItem`. The condition and
 *   the increment happen together, so two concurrent requests cannot both see
 *   "9 of 10" and both pass. Rows expire by TTL, so nothing accumulates.
 *
 * Fixed window rather than sliding: a sliding window needs either a sorted set
 * (Redis' actual advantage) or several writes per check. For "10 AI calls a
 * minute" the boundary effect — up to 2× the limit across a window edge — is
 * irrelevant, and one write beats four.
 */

export interface DynamoRateLimiterOptions {
  tableName: string;
  /** Requests allowed per window, per key. */
  limit: number;
  windowMs?: number;
  client?: DynamoDBClient;
  logger: Logger;
}

export class DynamoRateLimiter implements RateLimiter {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly logger: Logger;

  constructor(options: DynamoRateLimiterOptions) {
    this.doc = DynamoDBDocumentClient.from(options.client ?? new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.table = options.tableName;
    this.limit = Math.max(1, options.limit);
    this.windowMs = options.windowMs ?? 60_000;
    this.logger = options.logger;
  }

  async tryConsume(key: string, cost = 1): Promise<boolean> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    // The window is part of the key, so a new window starts from zero without
    // anything having to reset the old one.
    const partition = `RATE#${key}#${windowStart}`;

    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: partition, sk: 'COUNTER' },
          // Condition and increment in one atomic operation: two concurrent
          // requests cannot both read "under the limit" and both proceed.
          UpdateExpression: 'ADD #count :cost SET #ttl = :ttl, entity = :entity',
          ConditionExpression: 'attribute_not_exists(#count) OR #count <= :ceiling',
          ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':cost': cost,
            ':ceiling': this.limit - cost,
            // Two windows of slack, then the row disappears on its own.
            ':ttl': unixSeconds(new Date(windowStart + this.windowMs * 2)),
            ':entity': 'RATE_LIMIT',
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;

      // A limiter outage must not take the product down with it. API Gateway
      // throttling is still in force, and so is the WAF rate rule, so failing
      // open here degrades one guard rather than removing all of them.
      this.logger.error('rate limiter unavailable, allowing request', { error, key });
      return true;
    }
  }
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    'name' in error! &&
    String((error as { name: unknown }).name) === 'ConditionalCheckFailedException'
  );
}
