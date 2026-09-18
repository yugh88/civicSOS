import type { CaseStatus } from '../domain/types.js';
import { AppError } from '../domain/errors.js';

/**
 * Case status machine.
 *
 * Explicit transitions rather than free-form updates, so a client cannot move a
 * resolved case back to draft or skip submission. Validated server-side on every
 * PATCH.
 */
const ALLOWED_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  DRAFT: ['DRAFT', 'READY_TO_SUBMIT', 'SUBMITTED', 'CLOSED_UNRESOLVED'],
  READY_TO_SUBMIT: ['READY_TO_SUBMIT', 'DRAFT', 'SUBMITTED', 'CLOSED_UNRESOLVED'],
  SUBMITTED: ['SUBMITTED', 'AWAITING_RESPONSE', 'ESCALATED', 'RESOLVED', 'CLOSED_UNRESOLVED'],
  AWAITING_RESPONSE: ['AWAITING_RESPONSE', 'ESCALATED', 'RESOLVED', 'CLOSED_UNRESOLVED'],
  ESCALATED: ['ESCALATED', 'RESOLVED', 'CLOSED_UNRESOLVED'],
  RESOLVED: ['RESOLVED'],
  CLOSED_UNRESOLVED: ['CLOSED_UNRESOLVED', 'ESCALATED'],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: CaseStatus, to: CaseStatus): void {
  if (!canTransition(from, to)) {
    throw AppError.conflict(
      `A case that is ${STATUS_LABELS[from].toLowerCase()} can't be moved to ${STATUS_LABELS[to].toLowerCase()}.`,
    );
  }
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready to submit',
  SUBMITTED: 'Submitted',
  AWAITING_RESPONSE: 'Awaiting response',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED_UNRESOLVED: 'Closed — unresolved',
};

/** Short explanation of what the status means for the citizen right now. */
export const STATUS_HINTS: Record<CaseStatus, string> = {
  DRAFT: 'Your complaint is drafted. Add the missing details, then submit it through the official channel.',
  READY_TO_SUBMIT: 'Everything needed is in place. Submit it through the official channel and record the reference number.',
  SUBMITTED: 'Submitted to the authority. We will tell you when it is time to follow up.',
  AWAITING_RESPONSE: 'You have followed up and are waiting for the authority to act.',
  ESCALATED: 'You have escalated. Keep a copy of every reference number along the chain.',
  RESOLVED: 'Resolved. The full history stays here in case the problem comes back.',
  CLOSED_UNRESOLVED: 'Closed without resolution. You can still escalate this later if you want to.',
};

/** A case in one of these statuses is done; reminders stop firing for it. */
export function isOpen(status: CaseStatus): boolean {
  return status !== 'RESOLVED' && status !== 'CLOSED_UNRESOLVED';
}
