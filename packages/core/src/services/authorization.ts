import type { AuthContext, CaseRecord, Role } from '../domain/types.js';
import { AppError } from '../domain/errors.js';

/**
 * Authorization decisions.
 *
 * Every rule lives here and is called from the service layer, which the HTTP
 * handlers go through. There is no path where a client can reach data without
 * passing one of these checks — the frontend's own checks are cosmetic.
 */

const ROLE_RANK: Record<Role, number> = { CITIZEN: 0, AUTHORITY: 1, ADMIN: 2 };

export function hasRole(auth: AuthContext, minimum: Role): boolean {
  return ROLE_RANK[auth.role] >= ROLE_RANK[minimum];
}

export function requireRole(auth: AuthContext, minimum: Role): void {
  if (!hasRole(auth, minimum)) throw AppError.forbidden('This area is for authorised staff only.');
}

/**
 * Read access to a case.
 *
 * Deliberately returns 404 rather than 403 for a case owned by someone else: a
 * 403 would confirm that the id exists, which leaks the existence of other
 * citizens' cases to anyone enumerating ids.
 */
export function assertCanReadCase(auth: AuthContext, caseRecord: CaseRecord | undefined): CaseRecord {
  if (!caseRecord) throw AppError.notFound('We couldn’t find that case.');
  if (caseRecord.ownerId === auth.userId) return caseRecord;
  if (hasRole(auth, 'AUTHORITY')) return caseRecord;
  throw AppError.notFound('We couldn’t find that case.');
}

/**
 * Write access to a case.
 *
 * Only the owner may edit their own complaint. Staff can read for oversight but
 * must not rewrite a citizen's complaint text; an ADMIN is allowed to change
 * status for moderation, and that is recorded in the audit trail.
 */
export function assertCanWriteCase(auth: AuthContext, caseRecord: CaseRecord | undefined): CaseRecord {
  const record = assertCanReadCase(auth, caseRecord);
  if (record.ownerId === auth.userId) return record;
  if (auth.role === 'ADMIN') return record;
  throw AppError.forbidden('Only the person who created this case can change it.');
}

/** Evidence inherits the case's access rules; there is no separate ACL. */
export function assertCanAccessEvidence(auth: AuthContext, caseRecord: CaseRecord | undefined): CaseRecord {
  return assertCanReadCase(auth, caseRecord);
}

/** Fields only staff may set. Enforced before any write is applied. */
export function assertStaffOnlyFields(auth: AuthContext, fields: Record<string, unknown>): void {
  const staffOnly = ['isDemo', 'ownerId', 'classifiedBy'];
  const attempted = staffOnly.filter((field) => fields[field] !== undefined);
  if (attempted.length > 0 && !hasRole(auth, 'ADMIN')) {
    throw AppError.forbidden('Some of those fields cannot be changed.');
  }
}
