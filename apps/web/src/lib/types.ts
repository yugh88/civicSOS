/**
 * The API's response shapes, re-exported from the shared core package.
 *
 * Because the frontend and the backend import the same types, a change to a
 * handler's return value is a compile error in the UI rather than a runtime
 * surprise.
 */
export type {
  AnalysisResult,
  CitizenLevel,
  CitizenLevelId,
  PointsEntry,
  PointReason,
  Redemption,
  RewardCategory,
  RewardRecord,
  AuditEvent,
  AuthorityRecord,
  CaseEvent,
  CaseRecord,
  CaseStatus,
  CategoryId,
  CategoryRecord,
  ComplaintDraft,
  EscalationStep,
  EvidenceRequirement,
  LocationInput,
  NotificationRecord,
  PlanStep,
  ResolutionPlan,
  Role,
  SubmissionChannel,
  Urgency,
  UserProfile,
} from '@civicsos/core';

import type { AnalysisResult, CaseEvent, CaseRecord, CaseStatus, ResolutionPlan } from '@civicsos/core';

export interface AnalyzeResponse {
  analysis: AnalysisResult;
  meta: {
    usedFallback: boolean;
    aiAttempted: boolean;
    aiFailureReason?: string;
    piiRemoved: string[];
    injectionDetected: boolean;
  };
}

export interface EscalationAssessment {
  availableLevel: number;
  step?: { level: number; title: string; detail: string; afterDays: number; authorityHint?: string };
  ageDays: number;
  followUpOverdue: boolean;
  reason: string;
}

export interface CaseDetailResponse extends PhaseFields {
  case: CaseRecord;
  plan: ResolutionPlan;
  escalation: EscalationAssessment;
  nextEscalationStep?: { level: number; title: string; detail: string; afterDays: number };
  timeline: CaseEvent[];
  outstandingPlaceholders: string[];
}

export interface CaseListResponse {
  cases: Array<CaseRecord & Partial<PhaseFields>>;
  cursor?: string;
}

export interface EvidenceViewResponse {
  evidence: Array<{
    evidenceId: string;
    caseId: string;
    contentType: string;
    sizeBytes: number;
    label?: string;
    uploadedAt: string;
    confirmed: boolean;
    downloadUrl: string;
  }>;
}

export interface UploadReservationResponse {
  evidenceId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  maxBytes: number;
}

export interface CivicNotification {
  notificationId: string;
  caseId: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface LevelProgressView {
  level: { id: string; label: string; minPoints: number; blurb: string };
  next?: { id: string; label: string; minPoints: number; blurb: string };
  pointsToNext: number;
  /** 0–1 through the current level. */
  progress: number;
}

export interface MeResponse {
  profile: {
    userId: string;
    email?: string;
    displayName?: string;
    role: string;
    defaultLocation?: { locality?: string; city?: string; state?: string };
    civicPoints: number;
    lifetimePoints: number;
    casesReported: number;
    casesResolved: number;
  };
  role: string;
  notifications: CivicNotification[];
  unreadCount: number;
  level: LevelProgressView;
  impact: {
    casesReported: number;
    casesResolved: number;
    civicPoints: number;
    lifetimePoints: number;
  };
  pointsHistory: Array<{
    entryId: string;
    reason: string;
    delta: number;
    label: string;
    caseId?: string;
    rewardId?: string;
    createdAt: string;
  }>;
}

export interface RewardView {
  rewardId: string;
  partner: string;
  name: string;
  description: string;
  category: 'VOUCHER' | 'PRODUCT' | 'EXPERIENCE';
  pointsRequired: number;
  emoji: string;
  isSampleCatalog: boolean;
  minLevel?: string;
  affordable: boolean;
  eligible: boolean;
  pointsShort: number;
  lockedReason?: string;
}

export interface RewardsResponse {
  balance: number;
  lifetimePoints: number;
  level: LevelProgressView;
  rewards: RewardView[];
  redemptions: Array<{
    redemptionId: string;
    rewardId: string;
    rewardName: string;
    pointsSpent: number;
    code: string;
    createdAt: string;
  }>;
  disclaimer: string;
  isSampleCatalog: boolean;
}

export interface RedeemResponse {
  redemption: {
    redemptionId: string;
    rewardId: string;
    rewardName: string;
    pointsSpent: number;
    code: string;
    createdAt: string;
  };
  balance: number;
}

export type CasePhase =
  | 'PREPARING'
  | 'AWAITING_APPROVAL'
  | 'SUBMITTED'
  | 'MONITORING'
  | 'FOLLOW_UP_READY'
  | 'ESCALATION_READY'
  | 'RESOLVED'
  | 'CLOSED';

export interface PhaseFields {
  phase: CasePhase;
  phaseLabel: string;
  phaseMessage: string;
}

export interface AgentStep {
  action: string;
  title: string;
  detail: string;
  status: 'OK' | 'BLOCKED' | 'SKIPPED';
  completedAt: string;
}

export interface AgentRunResponse extends PhaseFields {
  runId: string;
  steps: AgentStep[];
  completed: boolean;
  reference?: string;
  submissionMode?: 'SIMULATED' | 'MANUAL';
  blockedReason?: string;
  /** Always true for the shipped demo environment. */
  simulated: boolean;
  case: CaseRecord;
  /** Present on a follow-up run: the exact message that would be sent. */
  draft?: string;
}

export interface CreateCaseResponse {
  case: CaseRecord;
  created: boolean;
  /** Points actually written to the ledger — never a client-side guess. */
  pointsAwarded: number;
  awards: Array<{ reason: string; delta: number; levelUp?: string }>;
}

export interface ResolveCaseResponse {
  case: CaseRecord;
  pointsAwarded: number;
  levelUp?: string;
}

export interface KnowledgeResponse {
  categories: Array<{ categoryId: string; label: string; description: string; emoji: string }>;
  statuses: Array<{ statusId: CaseStatus; label: string; hint: string }>;
  disclaimer: string;
}

export interface GuestSessionResponse {
  token: string;
  userId: string;
  expiresAt: string;
  expiresInSeconds: number;
  seededCases: number;
  isDemo: boolean;
}

export interface AdminOverviewResponse {
  stage: string;
  generatedAt: string;
  totals: {
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    open: number;
    resolved: number;
    demo: number;
    real: number;
  };
  overdue: Array<{ caseId: string; summary: string; status: CaseStatus; followUpAt?: string; isDemo: boolean }>;
  recentAudit: Array<{ action: string; actorRole: string; resource: string; outcome: string; createdAt: string }>;
}
