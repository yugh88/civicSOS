import type { RouteDefinition, RouteContext } from './types.js';
import type { ServiceContext } from '../services/context.js';
import { CaseService } from '../services/case-service.js';
import { EvidenceService } from '../services/evidence-service.js';
import { AdminService } from '../services/admin-service.js';
import { AppError } from '../domain/errors.js';
import { isSafeId } from '../domain/ids.js';
import { zodIssues } from './responses.js';
import {
  analyzeRequestSchema,
  createCaseRequestSchema,
  evidenceConfirmRequestSchema,
  evidenceUploadRequestSchema,
  followUpRequestSchema,
  listCasesQuerySchema,
  markSubmittedRequestSchema,
  profileUpdateRequestSchema,
  resolveCaseRequestSchema,
  updateCaseRequestSchema,
} from '../schemas/requests.js';
import { caseStatusSchema } from '../schemas/common.js';
import { CATEGORY_LIST } from '../knowledge/categories.js';
import { KNOWLEDGE_DISCLAIMER } from '../knowledge/authorities.js';
import { STATUS_HINTS, STATUS_LABELS } from '../rules/status.js';
import { isoNow } from '../util/time.js';
import { GUEST_TTL_SECONDS, issueGuestToken } from './auth.js';
import { seedGuestDemoData } from '../demo/guest.js';
import type { z } from 'zod';

/**
 * Route table.
 *
 * Each route validates its input with a zod schema before the service layer is
 * touched, so a handler never sees unvalidated data. Path parameters are checked
 * against a strict id pattern first — that is the traversal guard for anything
 * derived from an id, including S3 keys.
 */

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw zodIssues(result.error);
  return result.data;
}

function caseIdOf(context: RouteContext): string {
  const caseId = context.params.caseId;
  if (!isSafeId(caseId)) throw AppError.notFound('We couldn’t find that case.');
  return caseId;
}

export function buildRoutes(ctx: ServiceContext): RouteDefinition[] {
  const cases = new CaseService(ctx);
  const evidence = new EvidenceService(ctx);
  const admin = new AdminService(ctx);

  return [
    {
      method: 'GET',
      pattern: '/health',
      public: true,
      summary: 'Liveness probe and build metadata.',
      handler: async () => ({
        status: 'ok',
        stage: ctx.config.stage,
        time: isoNow(ctx.clock.now()),
        aiConfigured: ctx.gemini.configured,
      }),
    },

    {
      method: 'GET',
      pattern: '/knowledge/categories',
      public: true,
      summary: 'Category catalogue and the knowledge disclaimer, for the UI picker.',
      handler: async () => ({
        categories: CATEGORY_LIST.map((category) => ({
          categoryId: category.categoryId,
          label: category.label,
          description: category.description,
          emoji: category.emoji,
        })),
        statuses: Object.entries(STATUS_LABELS).map(([id, label]) => ({
          statusId: id,
          label,
          hint: STATUS_HINTS[id as keyof typeof STATUS_HINTS],
        })),
        disclaimer: KNOWLEDGE_DISCLAIMER,
      }),
    },

    {
      method: 'POST',
      pattern: '/auth/guest',
      public: true,
      successStatus: 201,
      summary: 'Start a sandboxed demo session with its own copy of the demo cases.',
      handler: async () => {
        if (!ctx.config.demoEnabled || !ctx.config.guestSecret) {
          throw AppError.forbidden('Demo sessions are turned off on this deployment.');
        }
        const now = ctx.clock.now();
        const session = await issueGuestToken(ctx.config.guestSecret, now);
        // Each guest gets their OWN copy of the demo cases, so demo traffic can
        // never read or modify anyone else's data.
        const seeded = await seedGuestDemoData(ctx.repository, session.userId, now);
        ctx.logger.info('guest demo session started', { seeded: seeded.seeded });
        return {
          token: session.token,
          userId: session.userId,
          expiresAt: session.expiresAt,
          expiresInSeconds: GUEST_TTL_SECONDS,
          seededCases: seeded.seeded,
          isDemo: true,
        };
      },
    },

    {
      method: 'POST',
      pattern: '/cases/analyze',
      summary: 'Understand a described problem and return a full resolution plan.',
      handler: async (context) => {
        const request = parse(analyzeRequestSchema, context.body);
        const outcome = await cases.analyze(context.auth, request);
        return {
          analysis: outcome.analysis,
          // Only the honest, non-sensitive parts of the diagnostics: enough for
          // the UI to say "AI unavailable, used our own rules", nothing more.
          meta: {
            usedFallback: outcome.analysis.usedFallback,
            aiAttempted: outcome.diagnostics.aiAttempted,
            aiFailureReason: outcome.diagnostics.aiFailureReason,
            piiRemoved: outcome.diagnostics.piiRemoved,
            injectionDetected: outcome.diagnostics.injectionDetected,
          },
        };
      },
    },

    {
      method: 'POST',
      pattern: '/cases',
      successStatus: 201,
      summary: 'Create a tracked case from a reviewed complaint.',
      handler: async (context) => {
        const request = parse(createCaseRequestSchema, context.body);
        const { case: record, created } = await cases.create(context.auth, request);
        return { case: record, created };
      },
    },

    {
      method: 'GET',
      pattern: '/cases',
      summary: "List the signed-in citizen's own cases.",
      handler: async (context) => {
        const query = parse(listCasesQuerySchema, context.query);
        const page = await cases.list(context.auth, query);
        return { cases: page.items, cursor: page.cursor };
      },
    },

    {
      method: 'GET',
      pattern: '/cases/:caseId',
      summary: 'Case detail with the live resolution plan, timeline and escalation state.',
      handler: async (context) => cases.detail(context.auth, caseIdOf(context)),
    },

    {
      method: 'PATCH',
      pattern: '/cases/:caseId',
      summary: 'Update a case: complaint text, category, location, reference or status.',
      handler: async (context) => {
        const request = parse(updateCaseRequestSchema, context.body);
        return { case: await cases.update(context.auth, caseIdOf(context), request) };
      },
    },

    {
      method: 'GET',
      pattern: '/cases/:caseId/timeline',
      summary: 'Immutable event history for a case.',
      handler: async (context) => ({ timeline: await cases.timeline(context.auth, caseIdOf(context)) }),
    },

    {
      method: 'POST',
      pattern: '/cases/:caseId/submitted',
      summary: 'Record that the citizen submitted the complaint through the official channel.',
      handler: async (context) => {
        const request = parse(markSubmittedRequestSchema, context.body);
        return { case: await cases.markSubmitted(context.auth, caseIdOf(context), request) };
      },
    },

    {
      method: 'POST',
      pattern: '/cases/:caseId/follow-up',
      summary: 'Log a follow-up, or escalate when the waiting window has passed.',
      handler: async (context) => {
        const request = parse(followUpRequestSchema, context.body);
        return cases.followUp(context.auth, caseIdOf(context), request);
      },
    },

    {
      method: 'POST',
      pattern: '/cases/:caseId/resolve',
      summary: 'Close a case as resolved, or as closed without resolution.',
      handler: async (context) => {
        const request = parse(resolveCaseRequestSchema, context.body);
        return { case: await cases.resolve(context.auth, caseIdOf(context), request) };
      },
    },

    {
      method: 'POST',
      pattern: '/cases/:caseId/evidence',
      successStatus: 201,
      summary: 'Reserve an evidence slot and return a short-lived pre-signed upload URL.',
      handler: async (context) => {
        const request = parse(evidenceUploadRequestSchema, context.body);
        return evidence.reserveUpload(context.auth, caseIdOf(context), request);
      },
    },

    {
      method: 'POST',
      pattern: '/cases/:caseId/evidence/confirm',
      summary: 'Confirm an upload completed, after verifying the object exists.',
      handler: async (context) => {
        const request = parse(evidenceConfirmRequestSchema, context.body);
        return { evidence: await evidence.confirmUpload(context.auth, caseIdOf(context), request.evidenceId) };
      },
    },

    {
      method: 'GET',
      pattern: '/cases/:caseId/evidence',
      summary: 'List confirmed evidence with fresh short-lived download URLs.',
      handler: async (context) => ({ evidence: await evidence.list(context.auth, caseIdOf(context)) }),
    },

    {
      method: 'GET',
      pattern: '/me',
      summary: 'Signed-in profile, plus unread reminders.',
      handler: async (context) => {
        const profile = await ctx.repository.getUser(context.auth.userId);
        const notifications = await ctx.repository.listNotifications(context.auth.userId, 20);
        return {
          profile: profile ?? {
            userId: context.auth.userId,
            email: context.auth.email,
            role: context.auth.role,
            createdAt: isoNow(ctx.clock.now()),
            updatedAt: isoNow(ctx.clock.now()),
          },
          role: context.auth.role,
          notifications,
        };
      },
    },

    {
      method: 'PATCH',
      pattern: '/me',
      summary: 'Update display name and default location.',
      handler: async (context) => {
        const request = parse(profileUpdateRequestSchema, context.body);
        const existing = await ctx.repository.getUser(context.auth.userId);
        const now = isoNow(ctx.clock.now());
        const profile = await ctx.repository.putUser({
          userId: context.auth.userId,
          email: context.auth.email,
          // Role comes from the identity token, never from the request body.
          role: context.auth.role,
          displayName: request.displayName ?? existing?.displayName,
          defaultLocation: request.defaultLocation ?? existing?.defaultLocation,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return { profile };
      },
    },

    {
      method: 'POST',
      pattern: '/me/notifications/:notificationId/read',
      summary: 'Mark one reminder as read.',
      handler: async (context) => {
        const notificationId = context.params.notificationId;
        if (!isSafeId(notificationId)) throw AppError.notFound();
        await ctx.repository.markNotificationRead(context.auth.userId, notificationId);
        return { ok: true };
      },
    },

    {
      method: 'GET',
      pattern: '/admin/overview',
      summary: 'Admin dashboard aggregates, overdue cases and recent audit records.',
      handler: async (context) => admin.overview(context.auth),
    },

    {
      method: 'GET',
      pattern: '/admin/queue/:status',
      summary: 'Staff queue for one case status.',
      handler: async (context) => {
        const parsed = caseStatusSchema.safeParse(context.params.status);
        if (!parsed.success) throw AppError.badRequest('That status does not exist.');
        const page = await admin.queue(context.auth, parsed.data, context.query.cursor);
        return { cases: page.items, cursor: page.cursor };
      },
    },
  ];
}
