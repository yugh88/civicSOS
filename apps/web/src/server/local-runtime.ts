import 'server-only';
import {
  InMemoryCaseRepository,
  InMemoryEventPublisher,
  InMemoryRateLimiter,
  ReminderService,
  buildRoutes,
  createAuditWriter,
  createAuthResolver,
  createGeminiClient,
  createLogger,
  createRouter,
  disabledGeminiClient,
  seedDemoData,
  systemClock,
  type Router,
  type ServiceContext,
} from '@civicsos/core';
import { LocalObjectStorage } from './local-storage';

/**
 * Local development runtime.
 *
 * Runs the exact same router, services and rules engine as the deployed Lambda,
 * but against in-memory adapters. That means `npm run dev` gives a complete,
 * working CivicSOS — full journey, evidence upload, reminders, admin view — with
 * no AWS account, no credentials and no cost, and it means the code path being
 * developed is the code path that ships.
 *
 * Deliberately NOT used in production: the deployed app points at API Gateway
 * (`NEXT_PUBLIC_API_BASE_URL`), and these routes refuse to run unless the app is
 * explicitly in local mode.
 */

/** True when no deployed API is configured, so the app serves its own. */
export const LOCAL_API_ENABLED = !process.env.NEXT_PUBLIC_API_BASE_URL;

interface LocalRuntime {
  ctx: ServiceContext;
  router: Router;
}

/**
 * Held on `globalThis` rather than in a module variable.
 *
 * Next's dev server re-evaluates modules on every edit, which would otherwise
 * reset the in-memory database and rotate the guest-session secret — logging
 * you out and wiping your cases every time a file is saved. Keeping the state
 * on the global object makes local development behave like a real backend.
 */
const globalState = globalThis as typeof globalThis & {
  __civicsosRepository?: InMemoryCaseRepository;
  __civicsosSeeded?: boolean;
  __civicsosGuestSecret?: string;
};

/**
 * The in-memory database, kept across reloads.
 *
 * Only the *data* is cached — the services and router are rebuilt on every
 * module evaluation, so an edit to the business logic takes effect immediately
 * while your cases and your session survive.
 */
function localRepository(): InMemoryCaseRepository {
  globalState.__civicsosRepository ??= new InMemoryCaseRepository();
  return globalState.__civicsosRepository;
}

/**
 * A development-only guest secret.
 *
 * Generated per process when not supplied, so local guest tokens are still
 * properly signed rather than trivially forgeable, and so nothing weak ever gets
 * committed as a default.
 */
function localGuestSecret(): string {
  const configured = process.env.GUEST_SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (!globalState.__civicsosGuestSecret) {
    globalState.__civicsosGuestSecret = Buffer.from(
      globalThis.crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64url');
  }
  return globalState.__civicsosGuestSecret;
}

function build(): LocalRuntime {
  const logger = createLogger({ stage: 'local' }, (process.env.LOG_LEVEL as 'info') ?? 'info');
  const repository = localRepository();
  const storage = new LocalObjectStorage();
  const events = new InMemoryEventPublisher();

  // The Gemini key is a server-side variable: it is never exposed to the browser
  // and never prefixed with NEXT_PUBLIC_.
  const apiKey = process.env.GEMINI_API_KEY;
  const gemini = apiKey
    ? createGeminiClient({ apiKey, model: process.env.GEMINI_MODEL, timeoutMs: 8000 }, logger)
    : disabledGeminiClient;

  const guestSecret = localGuestSecret();

  const ctx: ServiceContext = {
    repository,
    storage,
    events,
    gemini,
    audit: createAuditWriter(repository, logger),
    logger,
    clock: systemClock,
    rateLimiter: new InMemoryRateLimiter(30, 60_000),
    config: {
      stage: 'local',
      demoEnabled: true,
      signedUrlTtlSeconds: 300,
      analyzeRateLimit: 30,
      guestSecret,
    },
  };

  const router = createRouter({
    routes: buildRoutes(ctx),
    auth: createAuthResolver({
      guestSecret,
      logger,
      // Trusted headers, allowed only because the stage is literally 'local'.
      // The resolver itself refuses to honour them on any other stage.
      devHeaders: { enabled: true, stage: 'local' },
    }),
    logger,
    allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  });

  return { ctx, router };
}

/** Rebuilt per module evaluation; the data behind it is not. */
let runtime: LocalRuntime | undefined;

export async function getLocalRuntime(): Promise<LocalRuntime> {
  if (!runtime) runtime = build();
  if (!globalState.__civicsosSeeded) {
    // Demo data for the canonical demo user. Idempotent, so hot reloads and
    // repeated requests do not multiply the fixtures.
    globalState.__civicsosSeeded = true;
    await seedDemoData(runtime.ctx.repository);
  }
  return runtime;
}

/**
 * Runs the reminder sweep on demand.
 *
 * In production this is an EventBridge schedule; locally it is exposed as a
 * development endpoint so the reminder and escalation behaviour can be
 * demonstrated without waiting a day.
 */
export async function runLocalSweep() {
  const { ctx } = await getLocalRuntime();
  return new ReminderService(ctx).sweep(50);
}
