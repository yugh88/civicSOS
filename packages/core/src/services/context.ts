import type { CaseRepository, Clock, EventPublisher, ObjectStorage, RateLimiter } from '../ports/index.js';
import type { GeminiClient } from '../ai/gemini.js';
import type { Logger } from '../util/logger.js';
import type { AuditWriter } from './audit.js';

/**
 * Service dependencies, assembled once per Lambda container (or once per
 * Next.js server process) and passed explicitly. Constructor injection rather
 * than module-level singletons, so tests build a real service against in-memory
 * adapters with no mocking framework.
 */
export interface ServiceContext {
  repository: CaseRepository;
  storage: ObjectStorage;
  events: EventPublisher;
  gemini: GeminiClient;
  audit: AuditWriter;
  logger: Logger;
  clock: Clock;
  rateLimiter: RateLimiter;
  /** Feature/environment flags resolved from configuration. */
  config: RuntimeConfig;
}

export interface RuntimeConfig {
  /** `local` or the deployed stage name. Shown in the admin view. */
  stage: string;
  /** Seeds and serves clearly-labelled demo cases. */
  demoEnabled: boolean;
  /** Lifetime of pre-signed evidence URLs. Short by design. */
  signedUrlTtlSeconds: number;
  /** Per-user allowance for the AI-backed analyze endpoint, per minute. */
  analyzeRateLimit: number;
  /**
   * HMAC secret for guest (demo) session tokens. Absent means the demo path is
   * disabled rather than insecure.
   */
  guestSecret?: string;
}

export const defaultRuntimeConfig: RuntimeConfig = {
  stage: 'local',
  demoEnabled: true,
  signedUrlTtlSeconds: 300,
  analyzeRateLimit: 10,
};
