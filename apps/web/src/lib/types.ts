/**
 * The API's response shapes, re-exported from the shared core package.
 *
 * Because the frontend and the backend import the same types, a change to a
 * handler's return value is a compile error in the UI rather than a runtime
 * surprise.
 */
export type {
  AnalysisResult,
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

export interface CaseDetailResponse {
  case: CaseRecord;
  plan: ResolutionPlan;
  escalation: EscalationAssessment;
  nextEscalationStep?: { level: number; title: string; detail: string; afterDays: number };
  timeline: CaseEvent[];
  outstandingPlaceholders: string[];
}

export interface CaseListResponse {
  cases: CaseRecord[];
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

export interface MeResponse {
  profile: {
    userId: string;
    email?: string;
    displayName?: string;
    role: string;
    defaultLocation?: { locality?: string; city?: string; state?: string };
  };
  role: string;
  notifications: Array<{
    notificationId: string;
    caseId: string;
    kind: string;
    title: string;
    body: string;
    read: boolean;
    createdAt: string;
  }>;
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
