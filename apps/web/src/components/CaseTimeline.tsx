import { formatDateTime } from '@/lib/format';
import type { CaseEvent } from '@/lib/types';

/**
 * The case history.
 *
 * Append-only and never edited, because the point of it is to be the record a
 * citizen can quote back to an authority: "I filed on the 3rd, followed up on
 * the 11th, escalated on the 18th."
 */

const EVENT_STYLE: Record<string, { icon: string; tone: string }> = {
  CASE_CREATED: { icon: '●', tone: 'text-accent' },
  CASE_UPDATED: { icon: '✎', tone: 'text-ink-faint' },
  STATUS_CHANGED: { icon: '→', tone: 'text-ink-muted' },
  EVIDENCE_ADDED: { icon: '📎', tone: 'text-ink-muted' },
  COMPLAINT_EDITED: { icon: '✎', tone: 'text-ink-muted' },
  MARKED_SUBMITTED: { icon: '↗', tone: 'text-accent' },
  FOLLOW_UP_LOGGED: { icon: '↻', tone: 'text-warn' },
  FOLLOW_UP_DUE: { icon: '⏰', tone: 'text-warn' },
  REMINDER_SENT: { icon: '⏰', tone: 'text-warn' },
  ESCALATION_SUGGESTED: { icon: '▲', tone: 'text-warn' },
  ESCALATED: { icon: '▲', tone: 'text-bad' },
  RESOLVED: { icon: '✓', tone: 'text-good' },
  NOTE_ADDED: { icon: '✎', tone: 'text-ink-muted' },
};

export function CaseTimeline({ events }: { events: CaseEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-ink-muted">Nothing has happened on this case yet.</p>;
  }

  // Newest first: the most recent thing is what someone is checking for.
  const ordered = [...events].reverse();

  return (
    <ol className="space-y-4">
      {ordered.map((event) => {
        const style = EVENT_STYLE[event.type] ?? { icon: '•', tone: 'text-ink-muted' };
        const isSystem = event.actor === 'system';
        return (
          <li key={event.eventId} className="flex gap-3.5">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs ${style.tone}`}
            >
              {style.icon}
            </span>
            <div className="min-w-0 flex-1 border-b border-line pb-4 last:border-0 last:pb-0">
              <p className="text-sm leading-relaxed text-ink">{event.message}</p>
              <p className="mt-1 text-xs text-ink-faint">
                <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                {isSystem ? ' · by CivicSOS' : ' · by you'}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
