/**
 * CivicSOS domain model.
 *
 * These types are the single source of truth shared by the Lambda handlers,
 * the Next.js server routes and the browser client. They are deliberately
 * transport-agnostic: nothing here knows about DynamoDB, API Gateway or React.
 */

/** Supported civic problem categories. Extend via the knowledge layer, not code. */
export const CATEGORY_IDS = [
  'ROAD_DAMAGE',
  'GARBAGE_SANITATION',
  'STREETLIGHT',
  'WATER_SEWERAGE',
  'PUBLIC_SAFETY_HAZARD',
  'OTHER',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export const URGENCY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export const CASE_STATUSES = [
  'DRAFT',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'AWAITING_RESPONSE',
  'ESCALATED',
  'RESOLVED',
  'CLOSED_UNRESOLVED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Statuses from which a case can no longer move forward in the workflow. */
export const TERMINAL_STATUSES: readonly CaseStatus[] = ['RESOLVED', 'CLOSED_UNRESOLVED'];

export const ROLES = ['CITIZEN', 'AUTHORITY', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const CASE_EVENT_TYPES = [
  'CASE_CREATED',
  'CASE_UPDATED',
  'STATUS_CHANGED',
  'EVIDENCE_ADDED',
  'COMPLAINT_EDITED',
  'MARKED_SUBMITTED',
  'FOLLOW_UP_LOGGED',
  'FOLLOW_UP_DUE',
  'REMINDER_SENT',
  'ESCALATION_SUGGESTED',
  'ESCALATED',
  'RESOLVED',
  'NOTE_ADDED',
] as const;
export type CaseEventType = (typeof CASE_EVENT_TYPES)[number];

/** Where a piece of information came from. Surfaced in the UI for honesty. */
export const PROVENANCE = ['AI_ASSISTED', 'DETERMINISTIC_RULES', 'USER_PROVIDED', 'DEMO_DATA'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export interface LocationInput {
  /** Free-text locality the user typed or confirmed, e.g. "Sector 21, Gurugram". */
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
  /** Coarse coordinates only. Rounded before storage — see `roundCoordinate`. */
  lat?: number;
  lng?: number;
  /** How the coordinates were obtained. */
  source?: 'BROWSER' | 'MANUAL' | 'AI_HINT';
}

export interface UserProfile {
  userId: string;
  email?: string;
  displayName?: string;
  role: Role;
  defaultLocation?: LocationInput;
  /** Spendable balance. Server-maintained; never accepted from a client. */
  civicPoints: number;
  /** Total ever earned. Drives the citizen level, so redeeming never demotes. */
  lifetimePoints: number;
  /** Impact counters, incremented atomically alongside points. */
  casesReported: number;
  casesResolved: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Civic Points.
 *
 * The point of points is to reward *useful* civic participation — a complete,
 * evidenced report that actually gets resolved — not volume. Every award is
 * calculated on the server and written through an idempotent ledger, so a
 * replayed request, a double-tapped button or a tampered client payload cannot
 * mint points.
 */
export const POINT_REASONS = [
  'REPORT_CREATED',
  'COMPLETE_INFORMATION',
  'EVIDENCE_PROVIDED',
  'CASE_RESOLVED',
  'REWARD_REDEEMED',
] as const;
export type PointReason = (typeof POINT_REASONS)[number];

export interface PointsEntry {
  entryId: string;
  userId: string;
  reason: PointReason;
  /** Positive for an award, negative for a redemption. */
  delta: number;
  /** Human-readable, shown in the profile's activity list. */
  label: string;
  caseId?: string;
  rewardId?: string;
  /**
   * Deduplication key, unique per user. Awards use `<reason>#<caseId>` so a
   * reason can be earned at most once per case, however many times the
   * triggering request is replayed.
   */
  dedupeKey: string;
  createdAt: string;
}

export const CITIZEN_LEVELS = ['BRONZE', 'SILVER', 'GOLD', 'CHAMPION'] as const;
export type CitizenLevelId = (typeof CITIZEN_LEVELS)[number];

export interface CitizenLevel {
  id: CitizenLevelId;
  label: string;
  /** Lifetime points required to reach this level. */
  minPoints: number;
  blurb: string;
}

export const REWARD_CATEGORIES = ['VOUCHER', 'PRODUCT', 'EXPERIENCE'] as const;
export type RewardCategory = (typeof REWARD_CATEGORIES)[number];

export interface RewardRecord {
  rewardId: string;
  /** Partner name. Every catalogue entry shipped with the MVP is fictional. */
  partner: string;
  name: string;
  description: string;
  category: RewardCategory;
  pointsRequired: number;
  /** Emoji used as the card's visual mark — no image hosting required. */
  emoji: string;
  /**
   * True for the placeholder catalogue shipped with the project. The UI renders
   * a visible badge, because claiming an unconfirmed sponsor would be a lie.
   */
  isSampleCatalog: boolean;
  /** Minimum citizen level, when a reward is level-gated. */
  minLevel?: CitizenLevelId;
}

export interface Redemption {
  redemptionId: string;
  userId: string;
  rewardId: string;
  rewardName: string;
  pointsSpent: number;
  /** Placeholder voucher code for the demo catalogue. */
  code: string;
  createdAt: string;
}

export interface EvidenceItem {
  evidenceId: string;
  caseId: string;
  /** S3 object key. Never exposed directly; always served via a signed URL. */
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  label?: string;
  uploadedAt: string;
  uploadedBy: string;
  /** True once the object has been confirmed present in object storage. */
  confirmed: boolean;
}

export interface ComplaintDraft {
  subject: string;
  body: string;
  /** Which fields the user still needs to fill in, as `[[PLACEHOLDER]]` tokens. */
  placeholders: string[];
  provenance: Provenance;
  editedByUser: boolean;
}

/** One step in the "What happens next?" plan. */
export interface PlanStep {
  key: string;
  title: string;
  detail: string;
  /** Actor responsible for the step. */
  owner: 'YOU' | 'AUTHORITY' | 'CIVICSOS';
  status: 'DONE' | 'CURRENT' | 'UPCOMING';
  /** ISO date this step becomes relevant, when the rules engine can compute it. */
  dueAt?: string;
}

export interface EvidenceRequirement {
  key: string;
  label: string;
  description: string;
  required: boolean;
  satisfied: boolean;
}

export interface SubmissionChannel {
  kind: 'WEB_PORTAL' | 'PHONE' | 'MOBILE_APP' | 'EMAIL' | 'IN_PERSON';
  label: string;
  /** Official URL. Empty when the channel is not a link (e.g. a helpline). */
  url?: string;
  value?: string;
  /** Marked true when this record is illustrative sample data, not verified. */
  isSample: boolean;
  note?: string;
}

export interface AuthorityRecord {
  authorityId: string;
  name: string;
  jurisdictionLevel: 'MUNICIPAL' | 'STATE' | 'NATIONAL' | 'UTILITY';
  /** Human-readable scope, e.g. "Municipal Corporation (generic template)". */
  scope: string;
  channels: SubmissionChannel[];
  /** Always true for records shipped with the MVP: they are templates, not a verified directory. */
  isSample: boolean;
  sourceNote: string;
}

export interface EscalationStep {
  level: number;
  title: string;
  detail: string;
  /** Days after the previous milestone before this escalation applies. */
  afterDays: number;
  authorityHint?: string;
}

export interface ResolutionPath {
  pathId: string;
  categoryId: CategoryId;
  authorityId: string;
  /** What the citizen is actually asking the authority to do. */
  requestedAction: string;
  evidenceRequirements: Omit<EvidenceRequirement, 'satisfied'>[];
  /** Statutory/typical acknowledgement window in days, per the configured knowledge record. */
  expectedAcknowledgementDays: number;
  /** Typical resolution window in days. */
  expectedResolutionDays: number;
  escalationSteps: EscalationStep[];
  afterSubmission: string[];
  complaintTemplate: {
    subject: string;
    body: string;
  };
}

export interface CategoryRecord {
  categoryId: CategoryId;
  label: string;
  /** Short description shown in the category picker. */
  description: string;
  emoji: string;
  /** Lower-cased keywords used by the deterministic classifier fallback. */
  keywords: string[];
  /** Phrases that strongly imply this category; weighted higher than keywords. */
  strongSignals: string[];
  defaultUrgency: Urgency;
  /** Signals that push urgency to HIGH/CRITICAL regardless of category. */
  hazardSignals?: string[];
}

export interface CaseRecord {
  caseId: string;
  ownerId: string;
  status: CaseStatus;
  categoryId: CategoryId;
  urgency: Urgency;
  /** The citizen's own words, sanitized. */
  description: string;
  /** One-line neutral summary used in lists. */
  summary: string;
  location: LocationInput;
  pathId: string;
  authorityId: string;
  complaint: ComplaintDraft;
  /** Reference number for the complaint, if one exists. */
  officialReference?: string;
  /**
   * How the complaint reached (or will reach) the authority.
   *
   * `SIMULATED` means the agent ran the demo submission environment — a local
   * simulation, never a government portal — and the reference is a `CS-DEMO-`
   * placeholder. `MANUAL` means the citizen filed it themselves through a real
   * official channel and typed in the reference they were given. The UI labels
   * these differently everywhere, because conflating them would be a lie.
   */
  submissionMode?: 'SIMULATED' | 'MANUAL';
  submittedAt?: string;
  followUpAt?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  escalationLevel: number;
  evidenceCount: number;
  /** True for seeded demo cases. Rendered with a DEMO badge and never mixed into real metrics. */
  isDemo: boolean;
  classifiedBy: Provenance;
  createdAt: string;
  updatedAt: string;
}

export interface CaseEvent {
  caseId: string;
  /** ISO timestamp + monotonic suffix; doubles as the sort key. */
  eventId: string;
  type: CaseEventType;
  message: string;
  actor: string;
  /** Small, non-PII structured detail for audit rendering. */
  data?: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface AuditEvent {
  auditId: string;
  /** Partition key: `YYYY-MM-DD` so the log is queryable by day without scans. */
  day: string;
  action: string;
  actorId: string;
  actorRole: Role;
  resource: string;
  outcome: 'ALLOW' | 'DENY' | 'ERROR';
  requestId: string;
  detail?: string;
  createdAt: string;
}

export interface NotificationRecord {
  notificationId: string;
  userId: string;
  caseId: string;
  kind: 'FOLLOW_UP_DUE' | 'ESCALATION_AVAILABLE' | 'CASE_CREATED' | 'POINTS_EARNED' | 'REWARD_AVAILABLE';
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  /** Unix seconds; DynamoDB TTL attribute so notifications self-expire. */
  expiresAt: number;
}

/** The full "what happens next" plan assembled by the rules engine. */
export interface ResolutionPlan {
  categoryId: CategoryId;
  categoryLabel: string;
  urgency: Urgency;
  whatHappened: string;
  authority: AuthorityRecord;
  requestedAction: string;
  evidence: EvidenceRequirement[];
  steps: PlanStep[];
  expectedAcknowledgementDays: number;
  expectedResolutionDays: number;
  followUpAt?: string;
  afterSubmission: string[];
  escalation: EscalationStep[];
  submissionChannels: SubmissionChannel[];
  /** Honest disclosure shown with every plan. */
  disclaimer: string;
}

export interface AnalysisResult {
  categoryId: CategoryId;
  categoryLabel: string;
  urgency: Urgency;
  summary: string;
  locationHint?: string;
  missingInformation: string[];
  suggestedEvidence: string[];
  complaint: ComplaintDraft;
  plan: ResolutionPlan;
  /** Where the classification came from — surfaced in the UI. */
  classifiedBy: Provenance;
  /** True when Gemini was unavailable and deterministic rules were used instead. */
  usedFallback: boolean;
  /** Set when the classifier is not confident and the user should confirm. */
  needsCategoryConfirmation: boolean;
}

/**
 * Agent actions.
 *
 * The complete, closed set of things the agent is permitted to do. A language
 * model can suggest nothing outside this list, and each action is gated by
 * `assertActionAllowed` before it runs.
 */
export const AGENT_ACTIONS = [
  'resolve_jurisdiction',
  'find_official_channel',
  'validate_evidence',
  'generate_complaint',
  'prepare_submission',
  'submit_complaint',
  'verify_submission',
  'capture_reference',
  'check_case_status',
  'prepare_follow_up',
  'send_follow_up',
  'evaluate_escalation',
  'notify_user',
] as const;
export type AgentActionId = (typeof AGENT_ACTIONS)[number];

export type AgentStepStatus = 'OK' | 'BLOCKED' | 'SKIPPED';

export interface AgentStep {
  action: AgentActionId;
  /** Citizen-facing label, e.g. "Checking your evidence". */
  title: string;
  /** One line of what actually happened. Never speculative. */
  detail: string;
  status: AgentStepStatus;
  completedAt: string;
}

export interface AgentRunResult {
  runId: string;
  steps: AgentStep[];
  /** True when every step completed; false when policy blocked one. */
  completed: boolean;
  /** Set once `capture_reference` has run. */
  reference?: string;
  submissionMode?: 'SIMULATED' | 'MANUAL';
  /** Why the run stopped, when it did not complete. */
  blockedReason?: string;
  /** Always true for the shipped simulator. Drives the UI's demo labelling. */
  simulated: boolean;
}

/**
 * The phase a case is in, derived from its status and timings.
 *
 * Distinct from `CaseStatus`, which is the persisted state machine. The phase
 * is what the citizen is shown — "Monitoring", "Follow-up ready" — and is
 * computed, so it can never drift from the underlying record.
 */
export const CASE_PHASES = [
  'PREPARING',
  'AWAITING_APPROVAL',
  'SUBMITTED',
  'MONITORING',
  'FOLLOW_UP_READY',
  'ESCALATION_READY',
  'RESOLVED',
  'CLOSED',
] as const;
export type CasePhase = (typeof CASE_PHASES)[number];

export interface AuthContext {
  userId: string;
  role: Role;
  email?: string;
  /** Correlation id for logs and the audit trail. */
  requestId: string;
}
