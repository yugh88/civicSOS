import { GEMINI_RESPONSE_SCHEMA } from '../schemas/ai.js';
import { SYSTEM_INSTRUCTION, buildUserPrompt, type PromptInput } from './prompt.js';
import type { Logger } from '../util/logger.js';

/**
 * Gemini client — free tier only.
 *
 * Deliberately a hand-rolled `fetch` call rather than the SDK: one HTTP request
 * with an explicit timeout, no extra dependency in the Lambda bundle, and no
 * chance of a client library silently enabling a billable feature. No grounding,
 * no search tool, no file API — all of which are paid or quota-heavy.
 */

/** Free-tier flash model. Override with GEMINI_MODEL if quotas change. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  /** Total budget for the call. The analyze endpoint must stay responsive. */
  timeoutMs?: number;
  /** One retry only — free-tier quota is precious and users are waiting. */
  maxAttempts?: number;
}

export type GeminiOutcome =
  | { ok: true; text: string; attempts: number; latencyMs: number }
  | {
      ok: false;
      /** Coarse reason, safe to log and to drive fallback decisions. */
      reason: 'NOT_CONFIGURED' | 'TIMEOUT' | 'RATE_LIMITED' | 'HTTP_ERROR' | 'EMPTY' | 'BLOCKED' | 'NETWORK';
      status?: number;
      detail: string;
      attempts: number;
      latencyMs: number;
    };

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export interface GeminiClient {
  readonly configured: boolean;
  analyze(input: PromptInput): Promise<GeminiOutcome>;
}

/** Errors worth one retry: transient server-side or network problems. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function createGeminiClient(config: Partial<GeminiConfig>, logger?: Logger): GeminiClient {
  const apiKey = config.apiKey?.trim() ?? '';
  const model = config.model?.trim() || DEFAULT_GEMINI_MODEL;
  const timeoutMs = config.timeoutMs ?? 8000;
  const maxAttempts = Math.max(1, Math.min(2, config.maxAttempts ?? 2));
  const configured = apiKey.length > 0;

  async function callOnce(prompt: string, attempt: number): Promise<GeminiOutcome> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Header rather than query string so the key never lands in a URL,
          // an access log, or an error message.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            // Classification should be stable, not creative.
            temperature: 0.1,
            topP: 0.8,
            maxOutputTokens: 900,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        // Body may contain the API's own error text; we keep only the message.
        let detail = `HTTP ${response.status}`;
        try {
          const body = (await response.json()) as GeminiResponse;
          if (body.error?.message) detail = body.error.message.slice(0, 200);
        } catch {
          /* non-JSON error body: the status alone is enough */
        }
        return {
          ok: false,
          reason: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
          status: response.status,
          detail,
          attempts: attempt,
          latencyMs,
        };
      }

      const body = (await response.json()) as GeminiResponse;

      if (body.promptFeedback?.blockReason) {
        return {
          ok: false,
          reason: 'BLOCKED',
          detail: `Prompt blocked: ${body.promptFeedback.blockReason}`,
          attempts: attempt,
          latencyMs,
        };
      }

      const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      if (text.trim().length === 0) {
        return {
          ok: false,
          reason: 'EMPTY',
          detail: `No text in candidate (finishReason=${body.candidates?.[0]?.finishReason ?? 'unknown'})`,
          attempts: attempt,
          latencyMs,
        };
      }

      return { ok: true, text, attempts: attempt, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        reason: aborted ? 'TIMEOUT' : 'NETWORK',
        detail: aborted ? `Timed out after ${timeoutMs}ms` : String(error).slice(0, 200),
        attempts: attempt,
        latencyMs,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    configured,

    async analyze(input) {
      if (!configured) {
        return {
          ok: false,
          reason: 'NOT_CONFIGURED',
          detail: 'GEMINI_API_KEY is not set; using deterministic classification.',
          attempts: 0,
          latencyMs: 0,
        };
      }

      const prompt = buildUserPrompt(input);
      let last: GeminiOutcome | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const outcome = await callOnce(prompt, attempt);
        if (outcome.ok) return outcome;
        last = outcome;

        const retryable =
          outcome.reason === 'NETWORK' ||
          outcome.reason === 'TIMEOUT' ||
          (typeof outcome.status === 'number' && isRetryable(outcome.status));
        if (!retryable || attempt === maxAttempts) break;

        logger?.warn('gemini retrying', { attempt, reason: outcome.reason, status: outcome.status });
        // Short fixed backoff: the caller is a user-facing request, not a batch job.
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }

      return (
        last ?? {
          ok: false,
          reason: 'NETWORK',
          detail: 'No attempt completed.',
          attempts: 0,
          latencyMs: 0,
        }
      );
    },
  };
}

/** Client used when AI is disabled by configuration — keeps the pipeline uniform. */
export const disabledGeminiClient: GeminiClient = {
  configured: false,
  async analyze() {
    return {
      ok: false,
      reason: 'NOT_CONFIGURED',
      detail: 'AI disabled by configuration.',
      attempts: 0,
      latencyMs: 0,
    };
  },
};
