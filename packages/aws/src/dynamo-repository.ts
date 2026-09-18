import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  AppError,
  GUEST_PREFIX,
  dayKey,
  unixSeconds,
  type AuditEvent,
  type CaseEvent,
  type CaseRecord,
  type CaseRepository,
  type CaseStatus,
  type EvidenceItem,
  type ListCasesOptions,
  type NotificationRecord,
  type Page,
  type PointsEntry,
  type Redemption,
  type UserCounterDeltas,
  type UserProfile,
} from '@civicsos/core';
import {
  CASE_SK,
  FOLLOW_UP_LOOKBACK_DAYS,
  TABLE_INDEXES,
  USER_SK,
  auditPk,
  caseEventSk,
  casePk,
  caseSortKey,
  evidenceSk,
  followUpGsiPk,
  followUpSortKey,
  idempotencyPk,
  notificationSk,
  ownerGsiPk,
  pointsDedupeSk,
  pointsSk,
  redemptionSk,
  statusGsiPk,
  userPk,
} from './keys.js';

/**
 * DynamoDB implementation of `CaseRepository`.
 *
 * Every read is a GetItem or a Query against a key or an index. The only place
 * a broad read happens is the reminder sweep, which queries a sparse,
 * day-partitioned index — see `keys.ts`.
 *
 * Guest (demo) records carry a DynamoDB TTL so the demo cleans up after itself
 * and cannot accumulate cost. That policy lives here, in the adapter, rather
 * than leaking a `ttl` field into the domain model.
 */

/** Guest data disappears a day after the session could possibly still be alive. */
const GUEST_TTL_DAYS = 2;
/** Idempotency records only need to outlive a retry storm. */
const IDEMPOTENCY_TTL_HOURS = 24;
/** Audit records are kept long enough to be useful, then expire automatically. */
const AUDIT_TTL_DAYS = 400;

interface Keyed {
  pk: string;
  sk: string;
  /** DynamoDB TTL attribute. Only present on records we want to expire. */
  ttl?: number;
}

function isGuestOwner(ownerId: string): boolean {
  return ownerId.startsWith(GUEST_PREFIX);
}

function guestTtl(ownerId: string, now = new Date()): number | undefined {
  return isGuestOwner(ownerId) ? unixSeconds(new Date(now.getTime() + GUEST_TTL_DAYS * 86_400_000)) : undefined;
}

/** Drops undefined values, which DynamoDB rejects in some positions. */
function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('bad cursor');
    return parsed as Record<string, unknown>;
  } catch {
    throw AppError.badRequest('That page link is no longer valid.');
  }
}

export interface DynamoRepositoryOptions {
  tableName: string;
  client?: DynamoDBClient;
}

export class DynamoCaseRepository implements CaseRepository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(options: DynamoRepositoryOptions) {
    const base = options.client ?? new DynamoDBClient({});
    this.doc = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.table = options.tableName;
  }

  /* ---------------------------------------------------------------- */
  /* Cases                                                            */
  /* ---------------------------------------------------------------- */

  private caseItem(record: CaseRecord): CaseRecord & Keyed & Record<string, unknown> {
    const item: CaseRecord & Keyed & Record<string, unknown> = {
      ...record,
      pk: casePk(record.caseId),
      sk: CASE_SK,
      entity: 'CASE',
      gsi1pk: ownerGsiPk(record.ownerId),
      gsi1sk: caseSortKey(record.createdAt, record.caseId),
      gsi2pk: statusGsiPk(record.status),
      gsi2sk: caseSortKey(record.createdAt, record.caseId),
    };

    // Sparse index: only OPEN cases with a follow-up date get index keys, so
    // the reminder sweep's query set is exactly the cases that could be due.
    const open = record.status !== 'RESOLVED' && record.status !== 'CLOSED_UNRESOLVED';
    if (open && record.followUpAt) {
      item.gsi3pk = followUpGsiPk(dayKey(record.followUpAt));
      item.gsi3sk = followUpSortKey(record.followUpAt, record.caseId);
    } else {
      // Explicitly removed rather than left stale, otherwise a resolved case
      // would keep generating reminders forever.
      delete item.gsi3pk;
      delete item.gsi3sk;
    }

    const ttl = guestTtl(record.ownerId);
    if (ttl) item.ttl = ttl;
    return item;
  }

  private static toCase(item: Record<string, unknown> | undefined): CaseRecord | undefined {
    if (!item) return undefined;
    const { pk, sk, entity, gsi1pk, gsi1sk, gsi2pk, gsi2sk, gsi3pk, gsi3sk, ttl, ...rest } = item;
    return rest as unknown as CaseRecord;
  }

  async createCase(record: CaseRecord, idempotencyKey?: string): Promise<{ record: CaseRecord; created: boolean }> {
    const item = this.caseItem(record);

    if (!idempotencyKey) {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: item,
          // Never silently overwrite an existing case.
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return { record, created: true };
    }

    // Case row and idempotency marker are written together, so a retry can
    // never produce a second case or a marker without a case.
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: item,
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  pk: idempotencyPk(record.ownerId, idempotencyKey),
                  sk: CASE_SK,
                  entity: 'IDEMPOTENCY',
                  caseId: record.caseId,
                  ttl: unixSeconds(new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 3_600_000)),
                },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
          ],
        }),
      );
      return { record, created: true };
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;

      // The marker already existed: return the case it points at.
      const existing = await this.doc.send(
        new GetCommand({
          TableName: this.table,
          Key: { pk: idempotencyPk(record.ownerId, idempotencyKey), sk: CASE_SK },
        }),
      );
      const caseId = existing.Item?.caseId as string | undefined;
      if (caseId) {
        const found = await this.getCase(caseId);
        if (found) return { record: found, created: false };
      }
      throw error;
    }
  }

  async getCase(caseId: string): Promise<CaseRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { pk: casePk(caseId), sk: CASE_SK } }),
    );
    return DynamoCaseRepository.toCase(result.Item);
  }

  async updateCase(record: CaseRecord): Promise<CaseRecord> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: this.caseItem(record),
          // Guards against resurrecting a deleted or expired case.
          ConditionExpression: 'attribute_exists(pk)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) throw AppError.notFound('That case no longer exists.');
      throw error;
    }
    return record;
  }

  async listCasesByOwner(ownerId: string, options: ListCasesOptions = {}): Promise<Page<CaseRecord>> {
    const input: QueryCommandInput = {
      TableName: this.table,
      IndexName: TABLE_INDEXES.byOwner,
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': ownerGsiPk(ownerId) },
      // Newest first.
      ScanIndexForward: false,
      Limit: options.limit ?? 20,
      ExclusiveStartKey: decodeCursor(options.cursor),
    };

    // Filters run server-side on the already-narrow owner partition, so they
    // cost nothing extra in read units beyond the items examined.
    const filters: string[] = [];
    if (options.status) {
      filters.push('#status = :status');
      input.ExpressionAttributeNames = { '#status': 'status' };
      input.ExpressionAttributeValues![':status'] = options.status;
    }
    if (options.includeDemo === false) {
      filters.push('isDemo = :notDemo');
      input.ExpressionAttributeValues![':notDemo'] = false;
    }
    if (filters.length > 0) input.FilterExpression = filters.join(' AND ');

    const result = await this.doc.send(new QueryCommand(input));
    return {
      items: (result.Items ?? [])
        .map((item) => DynamoCaseRepository.toCase(item))
        .filter((item): item is CaseRecord => item !== undefined),
      cursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  async listCasesByStatus(
    status: CaseStatus,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Page<CaseRecord>> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: TABLE_INDEXES.byStatus,
        KeyConditionExpression: 'gsi2pk = :pk',
        ExpressionAttributeValues: { ':pk': statusGsiPk(status) },
        ScanIndexForward: false,
        Limit: options.limit ?? 20,
        ExclusiveStartKey: decodeCursor(options.cursor),
      }),
    );
    return {
      items: (result.Items ?? [])
        .map((item) => DynamoCaseRepository.toCase(item))
        .filter((item): item is CaseRecord => item !== undefined),
      cursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  /**
   * Queries the sparse follow-up index one due-day at a time, walking backwards
   * from the given instant. Bounded by `FOLLOW_UP_LOOKBACK_DAYS` and by `limit`,
   * so the sweep's cost is predictable and never a table scan.
   */
  async listCasesDueForFollowUp(dueBefore: string, limit = 25): Promise<CaseRecord[]> {
    const boundary = new Date(dueBefore);
    const found: CaseRecord[] = [];

    for (let offset = FOLLOW_UP_LOOKBACK_DAYS; offset >= 0 && found.length < limit; offset -= 1) {
      const day = dayKey(new Date(boundary.getTime() - offset * 86_400_000));
      const result = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: TABLE_INDEXES.byFollowUp,
          KeyConditionExpression: 'gsi3pk = :pk AND gsi3sk <= :due',
          ExpressionAttributeValues: {
            ':pk': followUpGsiPk(day),
            // The sort key is `<followUpAt>#<caseId>`, so comparing against the
            // boundary with a high suffix includes everything due at or before it.
            ':due': `${dueBefore}#~`,
          },
          Limit: limit - found.length,
        }),
      );
      for (const item of result.Items ?? []) {
        const record = DynamoCaseRepository.toCase(item);
        if (record) found.push(record);
      }
    }

    return found;
  }

  /* ---------------------------------------------------------------- */
  /* Case events                                                      */
  /* ---------------------------------------------------------------- */

  async appendEvent(event: CaseEvent): Promise<void> {
    const owner = await this.getCase(event.caseId);
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: clean({
          ...event,
          pk: casePk(event.caseId),
          sk: caseEventSk(event.eventId),
          entity: 'CASE_EVENT',
          ttl: owner ? guestTtl(owner.ownerId) : undefined,
        }),
      }),
    );
  }

  async listEvents(caseId: string, limit = 100): Promise<CaseEvent[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': casePk(caseId), ':prefix': 'EVT#' },
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => {
      const { pk, sk, entity, ttl, ...rest } = item;
      return rest as unknown as CaseEvent;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Evidence                                                         */
  /* ---------------------------------------------------------------- */

  async putEvidence(item: EvidenceItem): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: clean({
          ...item,
          pk: casePk(item.caseId),
          sk: evidenceSk(item.evidenceId),
          entity: 'EVIDENCE',
          ttl: guestTtl(item.uploadedBy),
        }),
      }),
    );
  }

  async getEvidence(caseId: string, evidenceId: string): Promise<EvidenceItem | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { pk: casePk(caseId), sk: evidenceSk(evidenceId) } }),
    );
    if (!result.Item) return undefined;
    const { pk, sk, entity, ttl, ...rest } = result.Item;
    return rest as unknown as EvidenceItem;
  }

  async listEvidence(caseId: string): Promise<EvidenceItem[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': casePk(caseId), ':prefix': 'EVD#' },
        Limit: 25,
      }),
    );
    return (result.Items ?? []).map((item) => {
      const { pk, sk, entity, ttl, ...rest } = item;
      return rest as unknown as EvidenceItem;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Audit                                                            */
  /* ---------------------------------------------------------------- */

  async putAudit(event: AuditEvent): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: clean({
          ...event,
          pk: auditPk(event.day),
          sk: event.auditId,
          entity: 'AUDIT',
          ttl: unixSeconds(new Date(Date.now() + AUDIT_TTL_DAYS * 86_400_000)),
        }),
        // Audit records are immutable: a write must never replace an existing one.
        ConditionExpression: 'attribute_not_exists(pk) OR attribute_not_exists(sk)',
      }),
    );
  }

  async listAudit(day: string, limit = 100): Promise<AuditEvent[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': auditPk(day) },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => {
      const { pk, sk, entity, ttl, ...rest } = item;
      return rest as unknown as AuditEvent;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Notifications and users                                          */
  /* ---------------------------------------------------------------- */

  async putNotification(record: NotificationRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: clean({
          ...record,
          pk: userPk(record.userId),
          sk: notificationSk(record.notificationId),
          entity: 'NOTIFICATION',
          // The domain already carries an expiry for notifications.
          ttl: record.expiresAt,
        }),
      }),
    );
  }

  async listNotifications(userId: string, limit = 25): Promise<NotificationRecord[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': 'NTF#' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => {
      const { pk, sk, entity, ttl, ...rest } = item;
      return rest as unknown as NotificationRecord;
    });
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: userPk(userId), sk: notificationSk(notificationId) },
          UpdateExpression: 'SET #read = :true',
          ExpressionAttributeNames: { '#read': 'read' },
          ExpressionAttributeValues: { ':true': true },
          // Scoped to this user's partition, so one user cannot mark another's.
          ConditionExpression: 'attribute_exists(pk)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) return;
      throw error;
    }
  }

  async getUser(userId: string): Promise<UserProfile | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { pk: userPk(userId), sk: USER_SK } }),
    );
    if (!result.Item) return undefined;
    const { pk, sk, entity, ttl, ...rest } = result.Item;
    return rest as unknown as UserProfile;
  }

  async putUser(profile: UserProfile): Promise<UserProfile> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: clean({
          ...profile,
          pk: userPk(profile.userId),
          sk: USER_SK,
          entity: 'USER',
          ttl: guestTtl(profile.userId),
        }),
      }),
    );
    return profile;
  }

  /* ---------------------------------------------------------------- */
  /* Civic points and rewards                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Writes a ledger entry and its dedupe marker in one transaction, both
   * conditional on not already existing.
   *
   * This is what makes point awards idempotent: a replayed award fails the
   * condition, writes nothing, and returns `false` so the caller does not bump
   * the balance. There is no window in which the marker exists without its
   * ledger entry, or vice versa.
   */
  async putPointsEntry(entry: PointsEntry): Promise<boolean> {
    const ttl = guestTtl(entry.userId);
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: clean({
                  ...entry,
                  pk: userPk(entry.userId),
                  sk: pointsSk(entry.entryId),
                  entity: 'POINTS_ENTRY',
                  ttl,
                }),
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: clean({
                  pk: userPk(entry.userId),
                  sk: pointsDedupeSk(entry.dedupeKey),
                  entity: 'POINTS_DEDUPE',
                  entryId: entry.entryId,
                  ttl,
                }),
                ConditionExpression: 'attribute_not_exists(sk)',
              },
            },
          ],
        }),
      );
      return true;
    } catch (error) {
      if (isTransactionConflict(error)) return false;
      throw error;
    }
  }

  async listPointsEntries(userId: string, limit = 25): Promise<PointsEntry[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': 'PTS#' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => {
      const { pk, sk, entity, ttl, ...rest } = item;
      return rest as unknown as PointsEntry;
    });
  }

  /**
   * Atomic counter update.
   *
   * `ADD` rather than a read-modify-write, so two concurrent awards cannot
   * interleave and lose one. `if_not_exists` seeds the identity fields when the
   * profile row does not exist yet.
   */
  async bumpUserCounters(userId: string, deltas: UserCounterDeltas): Promise<UserProfile> {
    const now = new Date().toISOString();
    const result = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: userPk(userId), sk: USER_SK },
        UpdateExpression: [
          'SET userId = if_not_exists(userId, :userId),',
          '#role = if_not_exists(#role, :role),',
          'createdAt = if_not_exists(createdAt, :now),',
          'updatedAt = :now,',
          'entity = if_not_exists(entity, :entity)',
          'ADD civicPoints :points, lifetimePoints :lifetime, casesReported :reported, casesResolved :resolved',
        ].join(' '),
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':role': 'CITIZEN',
          ':now': now,
          ':entity': 'USER',
          ':points': deltas.civicPoints ?? 0,
          ':lifetime': deltas.lifetimePoints ?? 0,
          ':reported': deltas.casesReported ?? 0,
          ':resolved': deltas.casesResolved ?? 0,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );

    const { pk, sk, entity, ttl, ...rest } = result.Attributes ?? {};
    const profile = rest as unknown as UserProfile;
    // A balance should never be able to go negative, even if a debit raced.
    return { ...profile, civicPoints: Math.max(0, profile.civicPoints ?? 0) };
  }

  async putRedemption(redemption: Redemption): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: clean({
          ...redemption,
          pk: userPk(redemption.userId),
          sk: redemptionSk(redemption.redemptionId),
          entity: 'REDEMPTION',
          ttl: guestTtl(redemption.userId),
        }),
      }),
    );
  }

  async listRedemptions(userId: string, limit = 20): Promise<Redemption[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': 'RDM#' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => {
      const { pk, sk, entity, ttl, ...rest } = item;
      return rest as unknown as Redemption;
    });
  }
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
}

function isConditionalCheckFailed(error: unknown): boolean {
  return errorName(error) === 'ConditionalCheckFailedException';
}

function isTransactionConflict(error: unknown): boolean {
  const name = errorName(error);
  return name === 'TransactionCanceledException' || name === 'ConditionalCheckFailedException';
}
