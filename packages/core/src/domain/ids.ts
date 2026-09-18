/**
 * Identifier helpers.
 *
 * Ids are prefixed and time-ordered so that DynamoDB sort keys sort naturally
 * and so that a stray id in a log line is immediately recognisable.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** Lexicographically sortable id: base36 millisecond timestamp + random suffix. */
export function timeOrderedId(prefix: string, now: Date = new Date()): string {
  const stamp = now.getTime().toString(36).padStart(9, '0');
  return `${prefix}_${stamp}${randomSuffix(8)}`;
}

export const newCaseId = (now?: Date) => timeOrderedId('case', now);
export const newEvidenceId = (now?: Date) => timeOrderedId('ev', now);
export const newAuditId = (now?: Date) => timeOrderedId('aud', now);
export const newNotificationId = (now?: Date) => timeOrderedId('ntf', now);
export const newRequestId = (now?: Date) => timeOrderedId('req', now);

/**
 * Monotonic counter used to break ties inside a single millisecond.
 *
 * Without it, two events appended in the same millisecond would sort by a
 * random suffix, so a case timeline could render "resolved" before "escalated".
 * The counter guarantees insertion order within a process; across processes a
 * same-millisecond tie is broken by the random tail, which is unavoidable
 * without a central sequencer and harmless in practice.
 */
let eventSequence = 0;

/**
 * Case event ids sort chronologically within a case, and stay unique and
 * correctly ordered when several events land in the same millisecond.
 */
export function newCaseEventId(now: Date = new Date()): string {
  eventSequence = (eventSequence + 1) % 36 ** 6;
  const sequence = eventSequence.toString(36).padStart(6, '0');
  return `${now.toISOString()}#${sequence}${randomSuffix(4)}`;
}

/** Guards against path-traversal and injection through id path params. */
const ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
