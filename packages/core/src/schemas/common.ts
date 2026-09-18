import { z } from 'zod';
import { CASE_STATUSES, CATEGORY_IDS, URGENCY_LEVELS } from '../domain/types.js';
import { roundCoordinate, sanitizeLine, sanitizeText } from '../util/sanitize.js';

/**
 * Shared zod primitives.
 *
 * Every string field sanitizes during parsing, so a handler cannot forget to
 * sanitize: validation and normalization are the same step.
 */

export const MAX_DESCRIPTION = 4000;
export const MIN_DESCRIPTION = 12;
/** Hard cap on any JSON request body. Enforced before parsing. */
export const MAX_REQUEST_BYTES = 64 * 1024;
/** Evidence upload cap. Keeps S3 usage inside the free tier and blocks abuse. */
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

/** Sanitizing single-line string. */
export const line = (max: number) =>
  z
    .string()
    .max(max * 2, { message: `Please keep this under ${max} characters.` })
    .transform((value) => sanitizeLine(value, max));

/** Sanitizing multi-line string. */
export const text = (max: number) =>
  z
    .string()
    .max(max * 2, { message: `Please keep this under ${max} characters.` })
    .transform((value) => sanitizeText(value, max));

export const categoryIdSchema = z.enum(CATEGORY_IDS);
export const urgencySchema = z.enum(URGENCY_LEVELS);
export const caseStatusSchema = z.enum(CASE_STATUSES);

export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{3,80}$/, { message: 'That identifier looks wrong.' });

export const locationSchema = z
  .object({
    locality: line(160).optional(),
    city: line(80).optional(),
    state: line(80).optional(),
    pincode: z
      .string()
      .regex(/^\d{4,10}$/, { message: 'Enter a valid postal code.' })
      .optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    source: z.enum(['BROWSER', 'MANUAL', 'AI_HINT']).optional(),
  })
  // Coordinates are coarsened here, at the trust boundary, so no downstream code
  // can accidentally persist a precise position.
  .transform((value) => ({
    ...value,
    lat: roundCoordinate(value.lat),
    lng: roundCoordinate(value.lng),
  }));

/** Details the citizen can supply to complete the complaint template. */
export const complaintFactsSchema = z.object({
  sinceWhen: line(120).optional(),
  hazardType: line(200).optional(),
  riskToPeople: line(300).optional(),
  householdsAffected: line(60).optional(),
  consumerNumber: line(60).optional(),
  reporterName: line(120).optional(),
  reporterContact: line(120).optional(),
});

export type ComplaintFactsInput = z.infer<typeof complaintFactsSchema>;
export type LocationSchemaOutput = z.infer<typeof locationSchema>;
