import type { CaseStatus, Urgency } from './types';

/**
 * Presentation helpers.
 *
 * Deliberately plain-English: the person reading this screen is usually annoyed,
 * often in a hurry, and does not care what an "escalation level" is. Dates are
 * relative where that is genuinely clearer and absolute where precision matters.
 */

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "in 3 days" / "4 days ago" / "today". */
export function formatRelative(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '—';

  const days = Math.round((target.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days < 30) return `in ${days} days`;
  if (days < -1 && days > -30) return `${Math.abs(days)} days ago`;
  return formatDate(iso);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const STATUS_TONE: Record<CaseStatus, 'neutral' | 'accent' | 'good' | 'warn' | 'bad'> = {
  DRAFT: 'neutral',
  READY_TO_SUBMIT: 'accent',
  SUBMITTED: 'accent',
  AWAITING_RESPONSE: 'warn',
  ESCALATED: 'bad',
  RESOLVED: 'good',
  CLOSED_UNRESOLVED: 'neutral',
};

export const URGENCY_LABEL: Record<Urgency, string> = {
  LOW: 'Low priority',
  MEDIUM: 'Normal priority',
  HIGH: 'High priority',
  CRITICAL: 'Urgent — safety risk',
};

export const URGENCY_TONE: Record<Urgency, 'neutral' | 'accent' | 'good' | 'warn' | 'bad'> = {
  LOW: 'neutral',
  MEDIUM: 'neutral',
  HIGH: 'warn',
  CRITICAL: 'bad',
};

/** Human label for the placeholder tokens left in a complaint. */
export function placeholderLabel(token: string): string {
  const labels: Record<string, string> = {
    LOCATION: 'the location',
    SINCE_WHEN: 'how long it has been like this',
    HAZARD_TYPE: 'what exactly is dangerous',
    RISK_TO_PEOPLE: 'who is at risk',
    HOUSEHOLDS_AFFECTED: 'how many households are affected',
    CONSUMER_NUMBER: 'your water consumer number',
    YOUR_NAME: 'your name',
    YOUR_CONTACT: 'your contact details',
    DESCRIPTION: 'a description of the problem',
  };
  return labels[token] ?? token.toLowerCase().replace(/_/g, ' ');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
