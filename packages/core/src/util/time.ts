/** Time helpers. All persisted timestamps are ISO-8601 UTC strings. */

export const DAY_MS = 86_400_000;

export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}

export function addDays(from: Date | string, days: number): Date {
  const base = typeof from === 'string' ? new Date(from) : from;
  return new Date(base.getTime() + days * DAY_MS);
}

export function isoAddDays(from: Date | string, days: number): string {
  return addDays(from, days).toISOString();
}

/** Calendar day key `YYYY-MM-DD` in UTC — used as the audit-log partition key. */
export function dayKey(at: Date | string = new Date()): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  return date.toISOString().slice(0, 10);
}

export function unixSeconds(at: Date | string = new Date()): number {
  const date = typeof at === 'string' ? new Date(at) : at;
  return Math.floor(date.getTime() / 1000);
}

export function daysBetween(from: Date | string, to: Date | string): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

export function isPast(at: string | undefined, now: Date = new Date()): boolean {
  if (!at) return false;
  const time = new Date(at).getTime();
  return Number.isFinite(time) && time <= now.getTime();
}
