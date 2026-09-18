import type { AuthContext, Role } from '../src/domain/types.js';
import {
  InMemoryCaseRepository,
  InMemoryEventPublisher,
  InMemoryObjectStorage,
  InMemoryRateLimiter,
} from '../src/adapters/memory.js';
import { createAuditWriter } from '../src/services/audit.js';
import { createLogger } from '../src/util/logger.js';
import { defaultRuntimeConfig, type ServiceContext } from '../src/services/context.js';
import { disabledGeminiClient, type GeminiClient } from '../src/ai/gemini.js';
import { createRouter, type Router } from '../src/http/router.js';
import { buildRoutes } from '../src/http/routes.js';
import { createAuthResolver } from '../src/http/auth.js';
import type { HttpRequest } from '../src/http/types.js';

/** Silent logger so test output stays readable. */
export const testLogger = createLogger({}, 'error');

/** Controllable clock — the follow-up and escalation rules are time-dependent. */
export class TestClock {
  constructor(private current: Date = new Date('2026-03-01T10:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }
  set(at: string): void {
    this.current = new Date(at);
  }
}

export interface TestHarness {
  ctx: ServiceContext;
  repository: InMemoryCaseRepository;
  storage: InMemoryObjectStorage;
  events: InMemoryEventPublisher;
  clock: TestClock;
  router: Router;
  auth(userId: string, role?: Role): AuthContext;
  /** Issues a request through the real router, exactly as the Lambda would. */
  call(
    method: string,
    path: string,
    options?: { body?: unknown; user?: string; role?: Role; token?: string; query?: Record<string, string> },
  ): Promise<{ status: number; json: any; headers: Record<string, string> }>;
}

export const TEST_GUEST_SECRET = 'test-guest-secret-value-at-least-32-chars';

export function createHarness(options: { gemini?: GeminiClient; rateLimit?: number } = {}): TestHarness {
  const repository = new InMemoryCaseRepository();
  const clock = new TestClock();
  const storage = new InMemoryObjectStorage('http://local-storage.invalid', () => clock.now().getTime());
  const events = new InMemoryEventPublisher();
  const gemini = options.gemini ?? disabledGeminiClient;

  const ctx: ServiceContext = {
    repository,
    storage,
    events,
    gemini,
    audit: createAuditWriter(repository, testLogger, () => clock.now()),
    logger: testLogger,
    clock: { now: () => clock.now() },
    rateLimiter: new InMemoryRateLimiter(options.rateLimit ?? 1000, 60_000, () => clock.now().getTime()),
    config: { ...defaultRuntimeConfig, stage: 'local', guestSecret: TEST_GUEST_SECRET },
  };

  const router = createRouter({
    routes: buildRoutes(ctx),
    auth: createAuthResolver({
      guestSecret: TEST_GUEST_SECRET,
      logger: testLogger,
      now: () => clock.now(),
      devHeaders: { enabled: true, stage: 'local' },
    }),
    logger: testLogger,
    allowedOrigins: ['http://localhost:3000'],
  });

  return {
    ctx,
    repository,
    storage,
    events,
    clock,
    router,
    auth(userId, role = 'CITIZEN') {
      return { userId, role, requestId: `req_test_${userId}` };
    },
    async call(method, path, callOptions = {}) {
      const headers: Record<string, string | undefined> = { origin: 'http://localhost:3000' };
      if (callOptions.body !== undefined) headers['content-type'] = 'application/json';
      if (callOptions.token) headers.authorization = `Bearer ${callOptions.token}`;
      else if (callOptions.user) {
        headers['x-dev-user'] = callOptions.user;
        headers['x-dev-role'] = callOptions.role ?? 'CITIZEN';
      }

      const request: HttpRequest = {
        method,
        path,
        query: callOptions.query ?? {},
        headers,
        body: callOptions.body === undefined ? undefined : JSON.stringify(callOptions.body),
      };

      const response = await router.handle(request);
      return {
        status: response.status,
        json: response.body ? JSON.parse(response.body) : undefined,
        headers: response.headers,
      };
    },
  };
}

/** Gemini stub that returns a fixed raw text response. */
export function stubGemini(text: string): GeminiClient {
  return {
    configured: true,
    async analyze() {
      return { ok: true, text, attempts: 1, latencyMs: 12 };
    },
  };
}

/** Gemini stub that always fails, for fallback tests. */
export function failingGemini(reason: 'TIMEOUT' | 'RATE_LIMITED' | 'HTTP_ERROR' = 'TIMEOUT'): GeminiClient {
  return {
    configured: true,
    async analyze() {
      return { ok: false, reason, detail: 'stubbed failure', attempts: 2, latencyMs: 8000 };
    },
  };
}

export const VALID_AI_RESPONSE = JSON.stringify({
  category: 'GARBAGE_SANITATION',
  confidence: 0.92,
  summary: 'Uncollected household waste has been accumulating outside a residential building for several days.',
  urgency: 'MEDIUM',
  location_hint: 'outside an apartment building',
  missing_information: ['the street name', 'the ward number'],
  suggested_evidence: ['a wide photo showing a nearby landmark'],
  problem_statement:
    'Household waste has been left uncollected outside the residential building for four days and is now spreading onto the footpath.',
  duration_hint: 'for four days',
});
