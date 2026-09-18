import type {
  AuditEvent,
  CaseEvent,
  CaseRecord,
  CaseStatus,
  EvidenceItem,
  NotificationRecord,
  UserProfile,
} from '../domain/types.js';

/**
 * Ports — the boundary between business logic and infrastructure.
 *
 * Everything above this line (services, rules, knowledge) is pure TypeScript
 * with no AWS dependency, which is why the whole workflow is unit-testable in
 * milliseconds. DynamoDB, S3 and EventBridge are adapters that implement these
 * interfaces; an in-memory adapter implements them for local dev and tests.
 */

export interface Page<T> {
  items: T[];
  /** Opaque cursor. Callers must not parse it. */
  cursor?: string;
}

export interface ListCasesOptions {
  status?: CaseStatus;
  limit?: number;
  cursor?: string;
  includeDemo?: boolean;
}

export interface CaseRepository {
  /**
   * Creates a case.
   *
   * Must be idempotent on `idempotencyKey` scoped to the owner: a retried or
   * double-tapped request returns the existing case rather than creating a
   * second one.
   */
  createCase(record: CaseRecord, idempotencyKey?: string): Promise<{ record: CaseRecord; created: boolean }>;
  getCase(caseId: string): Promise<CaseRecord | undefined>;
  /** Conditional update; rejects if the case no longer exists. */
  updateCase(record: CaseRecord): Promise<CaseRecord>;
  listCasesByOwner(ownerId: string, options?: ListCasesOptions): Promise<Page<CaseRecord>>;
  /** Admin/authority view. Query-based, never a full table scan in normal flows. */
  listCasesByStatus(status: CaseStatus, options?: { limit?: number; cursor?: string }): Promise<Page<CaseRecord>>;
  /**
   * Open cases whose follow-up date has passed, for the scheduled reminder job.
   * Backed by a sparse GSI so the scan cost is proportional to due cases only.
   */
  listCasesDueForFollowUp(dueBefore: string, limit?: number): Promise<CaseRecord[]>;

  appendEvent(event: CaseEvent): Promise<void>;
  listEvents(caseId: string, limit?: number): Promise<CaseEvent[]>;

  putEvidence(item: EvidenceItem): Promise<void>;
  getEvidence(caseId: string, evidenceId: string): Promise<EvidenceItem | undefined>;
  listEvidence(caseId: string): Promise<EvidenceItem[]>;

  putAudit(event: AuditEvent): Promise<void>;
  listAudit(day: string, limit?: number): Promise<AuditEvent[]>;

  putNotification(record: NotificationRecord): Promise<void>;
  listNotifications(userId: string, limit?: number): Promise<NotificationRecord[]>;
  markNotificationRead(userId: string, notificationId: string): Promise<void>;

  getUser(userId: string): Promise<UserProfile | undefined>;
  putUser(profile: UserProfile): Promise<UserProfile>;
}

export interface UploadTarget {
  /** Pre-signed PUT URL. Short-lived. */
  url: string;
  /** Headers the client must send with the PUT, exactly as given. */
  headers: Record<string, string>;
  storageKey: string;
  expiresInSeconds: number;
}

export interface ObjectStorage {
  /** Pre-signed upload URL, constrained to the given content type and size. */
  createUploadUrl(params: {
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<UploadTarget>;
  /** Short-lived pre-signed GET URL. The bucket itself is always private. */
  createDownloadUrl(params: { storageKey: string; expiresInSeconds?: number }): Promise<string>;
  /** Confirms an object actually exists before we record it as evidence. */
  headObject(storageKey: string): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }>;
  deleteObject(storageKey: string): Promise<void>;
}

/** Domain events published for asynchronous work. */
export type DomainEventType =
  | 'CaseCreated'
  | 'CaseStatusChanged'
  | 'CaseSubmitted'
  | 'EvidenceAdded'
  | 'FollowUpDue'
  | 'EscalationAvailable'
  | 'CaseResolved';

export interface DomainEvent {
  type: DomainEventType;
  caseId: string;
  ownerId: string;
  occurredAt: string;
  /** Small, non-PII payload. Consumers re-read the case for detail. */
  detail?: Record<string, string | number | boolean>;
}

export interface EventPublisher {
  /** Best-effort: a publishing failure must never fail the user's request. */
  publish(event: DomainEvent): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Simple in-process rate limiter port.
 *
 * Lambda gives each container its own memory, so the in-memory implementation
 * is per-container rather than global. API Gateway throttling is the real
 * global control; this adds a cheap per-user guard on the expensive AI path.
 */
export interface RateLimiter {
  /** Returns false when the caller has exceeded the allowance. */
  tryConsume(key: string, cost?: number): Promise<boolean>;
}
