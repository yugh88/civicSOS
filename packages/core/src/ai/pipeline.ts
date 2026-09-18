import type { AnalysisResult, CategoryId, LocationInput, Provenance, Urgency } from '../domain/types.js';
import { parseAiAnalysis } from '../schemas/ai.js';
import { classifyDeterministic, reconcileCategory, assessUrgency, CONFIRMATION_THRESHOLD } from '../rules/classify.js';
import { buildComplaintDraft } from '../rules/complaint.js';
import { assembleAnalysis, buildResolutionPlan } from '../rules/resolution.js';
import { getCategory } from '../knowledge/categories.js';
import { minimizeForAi, sanitizeLine, scrubInjection } from '../util/sanitize.js';
import type { Logger } from '../util/logger.js';
import type { GeminiClient } from './gemini.js';

/**
 * The analysis pipeline.
 *
 * Flow:
 *   citizen text
 *     -> injection scrub + PII minimization
 *     -> Gemini (optional, time-boxed)
 *     -> strict schema validation
 *     -> deterministic reconciliation of category and urgency
 *     -> rules engine builds the resolution plan
 *     -> deterministic complaint template filled in
 *
 * Every arrow after "Gemini" is deterministic. If the model is missing, slow,
 * rate-limited or wrong, the pipeline still produces a complete, useful plan —
 * that is the whole point of this file's structure.
 */

export interface AnalyzeInput {
  description: string;
  location?: LocationInput;
  /** Category the citizen chose explicitly; treated as authoritative. */
  categoryId?: CategoryId;
  hasPhoto?: boolean;
  /** Skips the model entirely. Used by the deterministic demo and by tests. */
  skipAi?: boolean;
  reporterName?: string;
  now?: Date;
}

export interface AnalyzeDiagnostics {
  aiAttempted: boolean;
  aiSucceeded: boolean;
  aiFailureReason?: string;
  aiLatencyMs?: number;
  /** Set when the model returned something that did not match the schema. */
  aiParseError?: string;
  injectionDetected: boolean;
  piiRemoved: string[];
  deterministicCategory: CategoryId;
  deterministicConfidence: number;
}

export interface AnalyzeOutcome {
  analysis: AnalysisResult;
  diagnostics: AnalyzeDiagnostics;
}

/** Hard cap on the text we are willing to send to a third-party model. */
const MAX_AI_INPUT_CHARS = 3000;

export async function runAnalysis(
  input: AnalyzeInput,
  deps: { gemini: GeminiClient; logger: Logger },
): Promise<AnalyzeOutcome> {
  const now = input.now ?? new Date();
  const { logger } = deps;

  // 1. Neutralize override attempts, then strip direct identifiers. Order
  //    matters: scrubbing first means redaction tokens cannot be used to hide
  //    an injection payload.
  const scrubbed = scrubInjection(input.description);
  const minimized = minimizeForAi(scrubbed.text.slice(0, MAX_AI_INPUT_CHARS));
  const locationHint = input.location ? minimizeForAi(sanitizeLine(locationToHint(input.location), 160)).text : undefined;

  // 2. Deterministic classification always runs. It is both the fallback and
  //    the cross-check on the model.
  const deterministic = classifyDeterministic(input.description);

  const diagnostics: AnalyzeDiagnostics = {
    aiAttempted: false,
    aiSucceeded: false,
    injectionDetected: scrubbed.detected,
    piiRemoved: minimized.removed,
    deterministicCategory: deterministic.categoryId,
    deterministicConfidence: deterministic.confidence,
  };

  let categoryId: CategoryId = input.categoryId ?? deterministic.categoryId;
  let urgency: Urgency = deterministic.urgency;
  let summary = fallbackSummary(input.description, categoryId);
  let missingInformation = deterministicMissingInfo(input);
  let suggestedEvidence: string[] = [];
  let problemStatement = input.description;
  let durationHint: string | undefined;
  let classifiedBy: Provenance = input.categoryId ? 'USER_PROVIDED' : 'DETERMINISTIC_RULES';
  let needsConfirmation = !input.categoryId && deterministic.confidence < CONFIRMATION_THRESHOLD;

  const shouldCallAi = !input.skipAi && deps.gemini.configured && minimized.text.length > 0;

  if (shouldCallAi) {
    diagnostics.aiAttempted = true;
    const outcome = await deps.gemini.analyze({
      description: minimized.text,
      locationHint,
      userSelectedCategory: input.categoryId,
    });
    diagnostics.aiLatencyMs = outcome.latencyMs;

    if (!outcome.ok) {
      diagnostics.aiFailureReason = outcome.reason;
      logger.warn('ai analysis unavailable, using deterministic rules', {
        reason: outcome.reason,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
      });
    } else {
      const parsed = parseAiAnalysis(outcome.text);
      if (!parsed.ok) {
        diagnostics.aiFailureReason = parsed.reason;
        diagnostics.aiParseError = parsed.detail;
        logger.warn('ai output rejected by schema, using deterministic rules', {
          reason: parsed.reason,
          detail: parsed.detail,
        });
      } else {
        diagnostics.aiSucceeded = true;
        const ai = parsed.value;

        // 3. Reconcile. A user-chosen category always wins; otherwise the
        //    keyword rules and the model have to agree, or we ask the citizen.
        if (input.categoryId) {
          categoryId = input.categoryId;
          needsConfirmation = false;
          classifiedBy = 'USER_PROVIDED';
        } else {
          const reconciled = reconcileCategory(ai.category, deterministic);
          categoryId = reconciled.categoryId;
          needsConfirmation = reconciled.needsConfirmation;
          classifiedBy = 'AI_ASSISTED';
        }

        // Urgency: take the more severe of the two. The model may notice risk
        // our keywords miss, but it can never talk us down from a hazard.
        urgency = maxUrgency(assessUrgency(input.description, categoryId), ai.urgency);

        if (ai.summary) summary = ai.summary;
        if (ai.missing_information.length > 0) missingInformation = ai.missing_information;
        if (ai.suggested_evidence.length > 0) suggestedEvidence = ai.suggested_evidence;
        if (ai.problem_statement) problemStatement = ai.problem_statement;
        if (ai.duration_hint) durationHint = ai.duration_hint;
      }
    }
  }

  const location = input.location ?? {};

  const plan = buildResolutionPlan({
    categoryId,
    urgency,
    location,
    whatHappened: summary,
    hasPhoto: input.hasPhoto,
    now,
  });

  const complaint = buildComplaintDraft(
    {
      categoryId,
      description: problemStatement,
      location,
      sinceWhen: durationHint,
      reporterName: input.reporterName,
      now,
    },
    diagnostics.aiSucceeded ? 'AI_ASSISTED' : 'DETERMINISTIC_RULES',
  );

  const analysis = assembleAnalysis(
    {
      categoryId,
      urgency,
      summary,
      locationHint: locationHint || undefined,
      missingInformation,
      suggestedEvidence,
      complaint,
      classifiedBy,
      usedFallback: diagnostics.aiAttempted && !diagnostics.aiSucceeded,
      needsCategoryConfirmation: needsConfirmation,
    },
    plan,
  );

  logger.info('analysis complete', {
    categoryId,
    urgency,
    classifiedBy,
    usedFallback: analysis.usedFallback,
    aiLatencyMs: diagnostics.aiLatencyMs,
    injectionDetected: diagnostics.injectionDetected,
    piiRemovedCount: diagnostics.piiRemoved.length,
  });

  return { analysis, diagnostics };
}

const URGENCY_RANK: Record<Urgency, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

function locationToHint(location: LocationInput): string {
  return [location.locality, location.city, location.state].filter(Boolean).join(', ');
}

/** Readable one-liner when no model is available. */
function fallbackSummary(description: string, categoryId: CategoryId): string {
  const label = getCategory(categoryId).label.toLowerCase();
  const firstSentence = description.split(/(?<=[.!?])\s/)[0] ?? description;
  const trimmed = sanitizeLine(firstSentence, 180);
  return trimmed.length > 0 ? trimmed : `A reported ${label} problem.`;
}

/** What an official would need that the citizen has not given us yet. */
function deterministicMissingInfo(input: AnalyzeInput): string[] {
  const missing: string[] = [];
  const hasLocality = Boolean(input.location?.locality || input.location?.city);
  if (!hasLocality) missing.push('the street name and a nearby landmark');
  if (!/\b(?:day|days|week|weeks|month|months|year|years|since|yesterday|today|ago)\b/i.test(input.description)) {
    missing.push('how long the problem has been there');
  }
  if (!input.hasPhoto) missing.push('a photo of the problem');
  return missing;
}
