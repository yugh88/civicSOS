import {
  AppError,
  buildRoutes,
  createAuditWriter,
  createAuthResolver,
  createGeminiClient,
  createLogger,
  createRouter,
  disabledGeminiClient,
  systemClock,
  type GeminiClient,
  type Logger,
  type Router,
  type RuntimeConfig,
  type ServiceContext,
} from '@civicsos/core';
import { DynamoCaseRepository } from './dynamo-repository.js';
import { DynamoRateLimiter } from './dynamo-rate-limiter.js';
import { S3ObjectStorage } from './s3-storage.js';
import { EventBridgeEventPublisher } from './eventbridge-publisher.js';
import { createCognitoTokenVerifier } from './cognito-auth.js';
import { loadSecrets } from './secrets.js';

/**
 * Lambda runtime wiring.
 *
 * Built once per container and reused across invocations, so DynamoDB/S3
 * clients, the Cognito JWKS cache and the router are all warm after the first
 * request. Configuration is read from the environment exactly once and
 * validated up front — a missing table name should fail loudly at init, not
 * halfway through a citizen's request.
 */

export interface AwsEnvironment {
  STAGE?: string;
  TABLE_NAME?: string;
  EVIDENCE_BUCKET?: string;
  EVENT_BUS_NAME?: string;
  USER_POOL_ID?: string;
  USER_POOL_CLIENT_ID?: string;
  GEMINI_MODEL?: string;
  /** SSM parameter names, not the secrets themselves. */
  GEMINI_API_KEY_PARAM?: string;
  GUEST_SESSION_SECRET_PARAM?: string;
  ALLOWED_ORIGINS?: string;
  DEMO_ENABLED?: string;
  SIGNED_URL_TTL_SECONDS?: string;
  ANALYZE_RATE_LIMIT?: string;
  LOG_LEVEL?: string;
}

function required(env: AwsEnvironment, key: keyof AwsEnvironment): string {
  const value = env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value.trim();
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface AwsRuntime {
  ctx: ServiceContext;
  router: Router;
  logger: Logger;
  allowedOrigins: string[];
}

export async function createAwsRuntime(env: AwsEnvironment = process.env as AwsEnvironment): Promise<AwsRuntime> {
  const stage = env.STAGE?.trim() || 'dev';
  const logger = createLogger({ stage }, (env.LOG_LEVEL as 'info') || 'info');

  const repository = new DynamoCaseRepository({ tableName: required(env, 'TABLE_NAME') });
  const storage = new S3ObjectStorage({
    bucket: required(env, 'EVIDENCE_BUCKET'),
    defaultExpirySeconds: integer(env.SIGNED_URL_TTL_SECONDS, 300),
  });
  const events = new EventBridgeEventPublisher({ busName: required(env, 'EVENT_BUS_NAME'), logger });

  // AI is optional by design: without a key the app runs on deterministic rules.
  const secrets = await loadSecrets(
    {
      geminiApiKey: env.GEMINI_API_KEY_PARAM ?? '',
      guestSessionSecret: env.GUEST_SESSION_SECRET_PARAM ?? '',
    },
    logger,
  );

  const gemini: GeminiClient = secrets.geminiApiKey
    ? createGeminiClient({ apiKey: secrets.geminiApiKey, model: env.GEMINI_MODEL, timeoutMs: 8000 }, logger)
    : disabledGeminiClient;
  if (!secrets.geminiApiKey) {
    logger.warn('no Gemini key in parameter store; running on deterministic classification only');
  }

  const config: RuntimeConfig = {
    stage,
    demoEnabled: env.DEMO_ENABLED !== 'false',
    signedUrlTtlSeconds: integer(env.SIGNED_URL_TTL_SECONDS, 300),
    analyzeRateLimit: integer(env.ANALYZE_RATE_LIMIT, 10),
    guestSecret: secrets.guestSessionSecret,
  };

  // Better to disable the demo than to sign guest tokens with a weak secret.
  if (config.demoEnabled && (!config.guestSecret || config.guestSecret.length < 32)) {
    logger.error('guest session secret missing or too short; disabling demo sessions');
    config.demoEnabled = false;
    config.guestSecret = undefined;
  }

  const ctx: ServiceContext = {
    repository,
    storage,
    events,
    gemini,
    audit: createAuditWriter(repository, logger),
    logger,
    clock: systemClock,
    // Genuinely global now: a conditional counter in the shared table rather
    // than one per warm container. See dynamo-rate-limiter.ts.
    rateLimiter: new DynamoRateLimiter({
      tableName: required(env, 'TABLE_NAME'),
      limit: config.analyzeRateLimit,
      logger,
    }),
    config,
  };

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (allowedOrigins.length === 0) {
    logger.warn('ALLOWED_ORIGINS is empty; browser calls from other origins will be blocked');
  }

  const verifyIdToken =
    env.USER_POOL_ID && env.USER_POOL_CLIENT_ID
      ? createCognitoTokenVerifier({ userPoolId: env.USER_POOL_ID, clientId: env.USER_POOL_CLIENT_ID })
      : undefined;

  if (!verifyIdToken) {
    logger.error('Cognito is not configured; only demo guest sessions will be able to sign in');
  }

  const router = createRouter({
    routes: buildRoutes(ctx),
    auth: createAuthResolver({
      verifyIdToken,
      guestSecret: config.demoEnabled ? config.guestSecret : undefined,
      logger,
      // Never enabled in a deployed stage. Kept explicit so the guard is visible.
      devHeaders: { enabled: false, stage },
    }),
    logger,
    allowedOrigins,
  });

  return { ctx, router, logger, allowedOrigins };
}

/**
 * Lazily built and cached for the life of the container.
 *
 * The promise itself is cached, not its result, so two concurrent invocations
 * during a cold start share one initialization instead of racing to fetch
 * secrets twice.
 */
let cached: Promise<AwsRuntime> | undefined;

export function getAwsRuntime(): Promise<AwsRuntime> {
  if (!cached) {
    cached = createAwsRuntime().catch((error) => {
      // Do not cache a failed initialization: the next invocation should retry
      // rather than be permanently broken by one transient SSM failure.
      cached = undefined;
      throw error;
    });
  }
  return cached;
}

export { AppError };
