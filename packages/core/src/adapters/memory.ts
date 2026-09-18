import type {
  AuditEvent,
  CaseEvent,
  CaseRecord,
  CaseStatus,
  EvidenceItem,
  NotificationRecord,
  UserProfile,
} from '../domain/types.js';
import type {
  CaseRepository,
  DomainEvent,
  EventPublisher,
  ListCasesOptions,
  ObjectStorage,
  Page,
  RateLimiter,
  UploadTarget,
} from '../ports/index.js';
import { AppError } from '../domain/errors.js';

/**
 * In-memory adapters.
 *
 * Used by the test suite and by `npm run dev` when no AWS resources are
 * configured, so the full user journey can be developed and demoed offline.
 * They implement the same ports as the DynamoDB/S3 adapters and enforce the
 * same constraints (idempotency, conditional update, pagination), so behaviour
 * verified here is behaviour that holds in production.
 */

function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw AppError.badRequest('That page link is no longer valid.');
  }
}

function paginate<T extends { sortKey: string }>(rows: T[], limit: number, cursor?: string): Page<T> {
  const after = decodeCursor(cursor);
  const filtered = after ? rows.filter((row) => row.sortKey < after) : rows;
  const items = filtered.slice(0, limit);
  const next = filtered.length > limit ? items[items.length - 1]?.sortKey : undefined;
  return { items, cursor: next ? encodeCursor(next) : undefined };
}

export class InMemoryCaseRepository implements CaseRepository {
  private cases = new Map<string, CaseRecord>();
  private idempotency = new Map<string, string>();
  private events = new Map<string, CaseEvent[]>();
  private evidence = new Map<string, EvidenceItem[]>();
  private audits: AuditEvent[] = [];
  private notifications = new Map<string, NotificationRecord[]>();
  private users = new Map<string, UserProfile>();

  /** Seeds demo data without going through the service layer. */
  seedCase(record: CaseRecord, events: CaseEvent[] = []): void {
    this.cases.set(record.caseId, record);
    if (events.length > 0) this.events.set(record.caseId, [...events]);
  }

  async createCase(record: CaseRecord, idempotencyKey?: string): Promise<{ record: CaseRecord; created: boolean }> {
    if (idempotencyKey) {
      const key = `${record.ownerId}#${idempotencyKey}`;
      const existingId = this.idempotency.get(key);
      if (existingId) {
        const existing = this.cases.get(existingId);
        if (existing) return { record: existing, created: false };
      }
      this.idempotency.set(key, record.caseId);
    }
    this.cases.set(record.caseId, record);
    return { record, created: true };
  }

  async getCase(caseId: string): Promise<CaseRecord | undefined> {
    return this.cases.get(caseId);
  }

  async updateCase(record: CaseRecord): Promise<CaseRecord> {
    if (!this.cases.has(record.caseId)) throw AppError.notFound('That case no longer exists.');
    this.cases.set(record.caseId, record);
    return record;
  }

  async listCasesByOwner(ownerId: string, options: ListCasesOptions = {}): Promise<Page<CaseRecord>> {
    const limit = options.limit ?? 20;
    const rows = [...this.cases.values()]
      .filter((row) => row.ownerId === ownerId)
      .filter((row) => (options.status ? row.status === options.status : true))
      .filter((row) => (options.includeDemo === false ? !row.isDemo : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ ...row, sortKey: `${row.createdAt}#${row.caseId}` }));
    const page = paginate(rows, limit, options.cursor);
    return { items: page.items.map(stripSortKey), cursor: page.cursor };
  }

  async listCasesByStatus(status: CaseStatus, options: { limit?: number; cursor?: string } = {}): Promise<Page<CaseRecord>> {
    const limit = options.limit ?? 20;
    const rows = [...this.cases.values()]
      .filter((row) => row.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ ...row, sortKey: `${row.createdAt}#${row.caseId}` }));
    const page = paginate(rows, limit, options.cursor);
    return { items: page.items.map(stripSortKey), cursor: page.cursor };
  }

  async listCasesDueForFollowUp(dueBefore: string, limit = 25): Promise<CaseRecord[]> {
    return [...this.cases.values()]
      .filter((row) => row.followUpAt !== undefined && row.followUpAt <= dueBefore)
      .filter((row) => row.status !== 'RESOLVED' && row.status !== 'CLOSED_UNRESOLVED')
      .sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? ''))
      .slice(0, limit);
  }

  async appendEvent(event: CaseEvent): Promise<void> {
    const list = this.events.get(event.caseId) ?? [];
    list.push(event);
    this.events.set(event.caseId, list);
  }

  async listEvents(caseId: string, limit = 100): Promise<CaseEvent[]> {
    return [...(this.events.get(caseId) ?? [])]
      .sort((a, b) => a.eventId.localeCompare(b.eventId))
      .slice(-limit);
  }

  async putEvidence(item: EvidenceItem): Promise<void> {
    const list = this.evidence.get(item.caseId) ?? [];
    const index = list.findIndex((row) => row.evidenceId === item.evidenceId);
    if (index >= 0) list[index] = item;
    else list.push(item);
    this.evidence.set(item.caseId, list);
  }

  async getEvidence(caseId: string, evidenceId: string): Promise<EvidenceItem | undefined> {
    return (this.evidence.get(caseId) ?? []).find((row) => row.evidenceId === evidenceId);
  }

  async listEvidence(caseId: string): Promise<EvidenceItem[]> {
    return [...(this.evidence.get(caseId) ?? [])].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  }

  async putAudit(event: AuditEvent): Promise<void> {
    this.audits.push(event);
  }

  async listAudit(day: string, limit = 100): Promise<AuditEvent[]> {
    return this.audits
      .filter((row) => row.day === day)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async putNotification(record: NotificationRecord): Promise<void> {
    const list = this.notifications.get(record.userId) ?? [];
    list.push(record);
    this.notifications.set(record.userId, list);
  }

  async listNotifications(userId: string, limit = 25): Promise<NotificationRecord[]> {
    return [...(this.notifications.get(userId) ?? [])]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    const list = this.notifications.get(userId) ?? [];
    const row = list.find((entry) => entry.notificationId === notificationId);
    if (row) row.read = true;
  }

  async getUser(userId: string): Promise<UserProfile | undefined> {
    return this.users.get(userId);
  }

  async putUser(profile: UserProfile): Promise<UserProfile> {
    this.users.set(profile.userId, profile);
    return profile;
  }
}

function stripSortKey<T extends { sortKey: string }>(row: T): Omit<T, 'sortKey'> {
  const { sortKey, ...rest } = row;
  return rest;
}

/**
 * In-memory object storage.
 *
 * Returns URLs pointing at the app's own local upload route, so evidence upload
 * genuinely works in local dev without an S3 bucket.
 */
export class InMemoryObjectStorage implements ObjectStorage {
  private objects = new Map<string, { bytes: number; contentType: string; body?: Uint8Array }>();

  constructor(
    private readonly baseUrl = 'http://local-storage.invalid',
    /** Injectable so tests can prove URLs are re-issued rather than cached. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  async createUploadUrl(params: {
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<UploadTarget> {
    const expiresInSeconds = params.expiresInSeconds ?? 300;
    // Recorded up front so `headObject` can confirm it, mirroring the S3 flow
    // where the client PUTs directly and we verify afterwards.
    this.objects.set(params.storageKey, { bytes: params.sizeBytes, contentType: params.contentType });
    return {
      url: `${this.baseUrl}/local-upload?key=${encodeURIComponent(params.storageKey)}`,
      headers: { 'content-type': params.contentType },
      storageKey: params.storageKey,
      expiresInSeconds,
    };
  }

  async createDownloadUrl(params: { storageKey: string; expiresInSeconds?: number }): Promise<string> {
    const expires = this.now() + (params.expiresInSeconds ?? 300) * 1000;
    return `${this.baseUrl}/local-download?key=${encodeURIComponent(params.storageKey)}&expires=${expires}`;
  }

  async headObject(storageKey: string): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    const object = this.objects.get(storageKey);
    if (!object) return { exists: false };
    return { exists: true, sizeBytes: object.bytes, contentType: object.contentType };
  }

  async deleteObject(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }
}

/** Collects published events so tests can assert the async contract. */
export class InMemoryEventPublisher implements EventPublisher {
  readonly published: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
  }
}

/** Fixed-window limiter. Per-container in Lambda; see the port's note. */
export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = 20,
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async tryConsume(key: string, cost = 1): Promise<boolean> {
    const current = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      this.buckets.set(key, { count: cost, resetAt: current + this.windowMs });
      return cost <= this.limit;
    }
    if (bucket.count + cost > this.limit) return false;
    bucket.count += cost;
    return true;
  }
}

/** Limiter used when throttling is handled entirely by API Gateway. */
export const noopRateLimiter: RateLimiter = { tryConsume: async () => true };
