import { z } from 'zod';
import { CATEGORY_IDS, URGENCY_LEVELS } from '../domain/types.js';
import { sanitizeLine, sanitizeText } from '../util/sanitize.js';

/**
 * The strict contract for Gemini's output.
 *
 * Raw model output is never used directly. It is parsed against this schema
 * first, and every string is sanitized during parsing. Anything that does not
 * fit is discarded and the deterministic path takes over.
 *
 * Note what is deliberately NOT in this schema: the authority, the escalation
 * policy, the response windows, the required evidence list, permissions. The
 * model contributes understanding of language; the rules engine decides the
 * workflow.
 */

const aiLine = (max: number) =>
  z
    .string()
    .max(max * 3)
    .transform((value) => sanitizeLine(value, max));

const aiText = (max: number) =>
  z
    .string()
    .max(max * 3)
    .transform((value) => sanitizeText(value, max));

export const aiAnalysisSchema = z.object({
  /** Must be one of our categories — a hallucinated category fails parsing. */
  category: z.enum(CATEGORY_IDS),
  /** Model's own confidence. Advisory only; we recompute our own. */
  confidence: z.number().min(0).max(1).optional(),
  summary: aiLine(240),
  urgency: z.enum(URGENCY_LEVELS),
  location_hint: aiLine(160).optional().nullable(),
  missing_information: z.array(aiLine(160)).max(8).default([]),
  suggested_evidence: z.array(aiLine(160)).max(8).default([]),
  /** Improved restatement of the problem for the complaint body. */
  problem_statement: aiText(1200).optional().nullable(),
  /** How long the problem has existed, if the citizen mentioned it. */
  duration_hint: aiLine(120).optional().nullable(),
});

export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

/**
 * Parses a model response defensively.
 *
 * Models wrap JSON in prose or code fences even when told not to, so we extract
 * the first balanced JSON object before parsing rather than failing outright.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const direct = tryParse(candidate);
  if (direct !== undefined) return direct;

  // Scan for the first balanced { ... }, respecting strings and escapes.
  const start = candidate.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return tryParse(candidate.slice(start, index + 1));
    }
  }
  return undefined;
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export type AiParseOutcome =
  | { ok: true; value: AiAnalysis }
  | { ok: false; reason: 'NOT_JSON' | 'SCHEMA_MISMATCH'; detail: string };

/** Single entry point for turning raw model text into trusted data. */
export function parseAiAnalysis(raw: string): AiParseOutcome {
  const json = extractJsonObject(raw);
  if (json === undefined || json === null || typeof json !== 'object') {
    return { ok: false, reason: 'NOT_JSON', detail: 'Response did not contain a JSON object.' };
  }
  const result = aiAnalysisSchema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      reason: 'SCHEMA_MISMATCH',
      detail: result.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; '),
    };
  }
  return { ok: true, value: result.data };
}

/** JSON schema handed to Gemini via `responseSchema` to constrain generation. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...CATEGORY_IDS] },
    confidence: { type: 'number' },
    summary: { type: 'string' },
    urgency: { type: 'string', enum: [...URGENCY_LEVELS] },
    location_hint: { type: 'string' },
    missing_information: { type: 'array', items: { type: 'string' } },
    suggested_evidence: { type: 'array', items: { type: 'string' } },
    problem_statement: { type: 'string' },
    duration_hint: { type: 'string' },
  },
  required: ['category', 'summary', 'urgency'],
} as const;
