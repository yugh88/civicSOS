import { z } from 'zod';
import {
  MAX_DESCRIPTION,
  MAX_EVIDENCE_BYTES,
  MIN_DESCRIPTION,
  caseStatusSchema,
  categoryIdSchema,
  complaintFactsSchema,
  idSchema,
  line,
  locationSchema,
  text,
} from './common.js';
import { MAX_COMPLAINT_BODY, MAX_COMPLAINT_SUBJECT } from '../rules/complaint.js';

/**
 * Request schemas — the server-side contract for every endpoint.
 *
 * The frontend validates for friendliness; these schemas are the ones that
 * actually decide what is accepted. They are exported so the web client can
 * reuse the exact same rules without them becoming the authority.
 */

export const analyzeRequestSchema = z.object({
  description: text(MAX_DESCRIPTION).refine((value) => value.length >= MIN_DESCRIPTION, {
    message: 'Tell us a little more — at least a sentence about what happened.',
  }),
  location: locationSchema.optional(),
  /** Set when the user picked the category themselves; overrides classification. */
  categoryId: categoryIdSchema.optional(),
  hasPhoto: z.boolean().optional(),
  /** Lets the demo and tests exercise the deterministic path deliberately. */
  skipAi: z.boolean().optional(),
});

export const createCaseRequestSchema = z.object({
  description: text(MAX_DESCRIPTION).refine((value) => value.length >= MIN_DESCRIPTION, {
    message: 'Tell us a little more — at least a sentence about what happened.',
  }),
  summary: line(240).optional(),
  categoryId: categoryIdSchema,
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  location: locationSchema,
  complaint: z
    .object({
      subject: line(MAX_COMPLAINT_SUBJECT),
      body: text(MAX_COMPLAINT_BODY),
    })
    .optional(),
  facts: complaintFactsSchema.optional(),
  /**
   * Client-generated key that makes case creation idempotent: a double-tapped
   * "Create case" button must not produce two cases.
   */
  idempotencyKey: idSchema.optional(),
});

export const listCasesQuerySchema = z.object({
  status: caseStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().max(2000).optional(),
  includeDemo: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export const updateCaseRequestSchema = z
  .object({
    status: caseStatusSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    location: locationSchema.optional(),
    officialReference: line(120).optional(),
    complaint: z
      .object({
        subject: line(MAX_COMPLAINT_SUBJECT).optional(),
        body: text(MAX_COMPLAINT_BODY).optional(),
      })
      .optional(),
    note: line(500).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update.',
  });

export const resolveCaseRequestSchema = z.object({
  resolutionNote: line(500).optional(),
  /** Whether the underlying problem was actually fixed. */
  outcome: z.enum(['FIXED', 'CLOSED_WITHOUT_FIX']).default('FIXED'),
});

export const followUpRequestSchema = z.object({
  note: line(500).optional(),
  /** Set when the citizen wants to record an escalation rather than a nudge. */
  escalate: z.boolean().optional(),
  /** Reference number received from the authority, if any. */
  officialReference: line(120).optional(),
});

export const markSubmittedRequestSchema = z.object({
  officialReference: line(120).optional(),
  channel: line(120).optional(),
  submittedAt: z.string().datetime().optional(),
});

const ALLOWED_EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;

export const evidenceUploadRequestSchema = z.object({
  fileName: line(200),
  contentType: z.enum(ALLOWED_EVIDENCE_TYPES, {
    errorMap: () => ({ message: 'Upload a JPEG, PNG, WebP, HEIC image or a PDF.' }),
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_EVIDENCE_BYTES, { message: 'Files must be 8 MB or smaller.' }),
  label: line(120).optional(),
});

export const evidenceConfirmRequestSchema = z.object({
  evidenceId: idSchema,
});

/**
 * Agent run request.
 *
 * `approve` is the entire approval gate as far as the wire is concerned: the
 * policy layer refuses every acting step without it, so an accidental or
 * replayed call cannot submit anything.
 */
export const agentRunRequestSchema = z.object({
  approve: z.boolean().optional(),
});

export const profileUpdateRequestSchema = z.object({
  displayName: line(120).optional(),
  defaultLocation: locationSchema.optional(),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type CreateCaseRequest = z.infer<typeof createCaseRequestSchema>;
export type ListCasesQuery = z.infer<typeof listCasesQuerySchema>;
export type UpdateCaseRequest = z.infer<typeof updateCaseRequestSchema>;
export type ResolveCaseRequest = z.infer<typeof resolveCaseRequestSchema>;
export type FollowUpRequest = z.infer<typeof followUpRequestSchema>;
export type MarkSubmittedRequest = z.infer<typeof markSubmittedRequestSchema>;
export type EvidenceUploadRequest = z.infer<typeof evidenceUploadRequestSchema>;
export type ProfileUpdateRequest = z.infer<typeof profileUpdateRequestSchema>;
export type AgentRunRequestInput = z.infer<typeof agentRunRequestSchema>;
export { ALLOWED_EVIDENCE_TYPES };
