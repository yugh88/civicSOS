/**
 * @civicsos/core — the whole application except its infrastructure.
 *
 * Domain model, validation, civic knowledge, deterministic rules engine, AI
 * pipeline, services, and a transport-agnostic HTTP router. No AWS SDK import
 * anywhere in this package, which is what keeps the business logic testable in
 * milliseconds and portable between Lambda and the Next.js server.
 */

// Domain
export * from './domain/types.js';
export * from './domain/errors.js';
export {
  isSafeId,
  newCaseEventId,
  newCaseId,
  newEvidenceId,
  newNotificationId,
  newRequestId,
  timeOrderedId,
} from './domain/ids.js';

// Utilities
export { createLogger, logger, type LogLevel, type Logger } from './util/logger.js';
export {
  escapeHtml,
  minimizeForAi,
  redactForLogs,
  roundCoordinate,
  sanitizeLine,
  sanitizeText,
  scrubInjection,
  wrapUntrusted,
} from './util/sanitize.js';
export { addDays, dayKey, daysBetween, isPast, isoAddDays, isoNow, unixSeconds } from './util/time.js';

// Knowledge layer
export * from './knowledge/index.js';

// Rules engine
export {
  CONFIRMATION_THRESHOLD,
  assessUrgency,
  classifyDeterministic,
  reconcileCategory,
  scoreCategories,
} from './rules/classify.js';
export {
  MAX_COMPLAINT_BODY,
  MAX_COMPLAINT_SUBJECT,
  buildComplaintDraft,
  describePlaceholder,
  formatLocation,
  remainingPlaceholders,
} from './rules/complaint.js';
export { assessEscalation, computeFollowUpDate, nextEscalationDate, nextEscalationStep } from './rules/followup.js';
export { assembleAnalysis, buildCasePlan, buildResolutionPlan } from './rules/resolution.js';
export { STATUS_HINTS, STATUS_LABELS, assertTransition, canTransition, isOpen } from './rules/status.js';

// Schemas
export * from './schemas/common.js';
export * from './schemas/requests.js';
export {
  GEMINI_RESPONSE_SCHEMA,
  aiAnalysisSchema,
  extractJsonObject,
  parseAiAnalysis,
  type AiAnalysis,
} from './schemas/ai.js';

// AI
export { DEFAULT_GEMINI_MODEL, createGeminiClient, disabledGeminiClient, type GeminiClient } from './ai/gemini.js';
export { SYSTEM_INSTRUCTION, buildUserPrompt } from './ai/prompt.js';
export { runAnalysis, type AnalyzeInput, type AnalyzeOutcome } from './ai/pipeline.js';

// Ports & adapters
export * from './ports/index.js';
export {
  InMemoryCaseRepository,
  InMemoryEventPublisher,
  InMemoryObjectStorage,
  InMemoryRateLimiter,
  noopRateLimiter,
} from './adapters/memory.js';

// Services
export { CaseService, type CaseDetail } from './services/case-service.js';
export { EvidenceService, MAX_EVIDENCE_PER_CASE, type EvidenceView } from './services/evidence-service.js';
export { ReminderService, type ReminderSweepResult } from './services/reminder-service.js';
export { AdminService, type AdminOverview } from './services/admin-service.js';
export { createAuditWriter, type AuditWriter } from './services/audit.js';
export {
  assertCanReadCase,
  assertCanWriteCase,
  hasRole,
  requireRole,
} from './services/authorization.js';
export { defaultRuntimeConfig, type RuntimeConfig, type ServiceContext } from './services/context.js';

// HTTP
export * from './http/types.js';
export { SECURITY_HEADERS, corsHeaders, errorResponse, jsonResponse, noContentResponse } from './http/responses.js';
export { createRouter, type Router, type RouterOptions } from './http/router.js';
export { buildRoutes } from './http/routes.js';
export {
  GUEST_PREFIX,
  GUEST_TTL_SECONDS,
  createAuthResolver,
  isGuest,
  issueGuestToken,
  roleFromGroups,
  verifyGuestToken,
  type TokenClaims,
  type TokenVerifier,
} from './http/auth.js';

// Demo
export { DEMO_OWNER_ID, seedDemoData, type SeedResult } from './demo/seed.js';
export { seedGuestDemoData } from './demo/guest.js';
