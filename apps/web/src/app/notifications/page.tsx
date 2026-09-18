'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import { notifyProfileChanged } from '@/lib/profile-events';
import type { CivicNotification, MeResponse } from '@/lib/types';
import { notificationTone } from '@/components/AppShell';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, FilterRail, PageHeader, Skeleton } from '@/components/ui';
import {
  IconArrowRight,
  IconBell,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconEscalate,
  IconRewards,
  IconSend,
} from '@/components/icons';

/**
 * Notifications.
 *
 * Reminders are the mechanism that turns a filed complaint into a resolved one,
 * so they get a real screen rather than only a dropdown. Unread items are
 * visually distinct without being alarming, and every one links to the case it
 * is about — a notification you cannot act on is just noise.
 */

type FilterId = 'ALL' | 'UNREAD';

const KIND_META: Record<string, { label: string; icon: (props: { className?: string }) => React.ReactElement }> = {
  FOLLOW_UP_DUE: { label: 'Follow-up reminder', icon: IconClock },
  ESCALATION_AVAILABLE: { label: 'Escalation available', icon: IconEscalate },
  CASE_CREATED: { label: 'Case created', icon: IconSend },
  POINTS_EARNED: { label: 'Civic Points', icon: IconRewards },
  REWARD_AVAILABLE: { label: 'New reward', icon: IconRewards },
};

export default function NotificationsPage() {
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [items, setItems] = useState<CivicNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState<FilterId>('ALL');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/notifications');
  }, [router, session, sessionLoading]);

  const load = useCallback(async () => {
    try {
      const me = await api<MeResponse>('/me');
      setItems(me.notifications);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load your notifications.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (session) void load();
  }, [load, session]);

  const markRead = useCallback(
    async (notificationId: string) => {
      // Optimistic: marking read is trivially reversible and never destructive,
      // so the UI should not wait on a round trip.
      setItems((current) =>
        current.map((item) => (item.notificationId === notificationId ? { ...item, read: true } : item)),
      );
      try {
        await api(`/me/notifications/${notificationId}/read`, { method: 'POST', body: {} });
        notifyProfileChanged();
      } catch {
        await load();
      }
    },
    [api, load],
  );

  const markAllRead = useCallback(async () => {
    setBusy(true);
    try {
      await api('/me/notifications/read-all', { method: 'POST', body: {} });
      await load();
      notifyProfileChanged();
    } catch {
      setError('We could not mark those as read. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [api, load]);

  if (sessionLoading || (loading && session)) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="Notifications" />
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!session) return null;

  const unread = items.filter((item) => !item.read);
  const visible = filter === 'UNREAD' ? unread : items;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Reminders about your cases, escalation windows and points you have earned."
        action={
          unread.length > 0 ? (
            <Button variant="secondary" loading={busy} onClick={markAllRead} icon={<IconCheck className="h-4 w-4" />}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <Alert tone="bad" title="Something went wrong" action={<Button size="sm" onClick={load}>Try again</Button>}>
          {error}
        </Alert>
      ) : null}

      {items.length > 0 ? (
        <FilterRail<FilterId>
          label="Filter notifications"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'ALL', label: 'All', count: items.length },
            { id: 'UNREAD', label: 'Unread', count: unread.length },
          ]}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<IconBell className="h-6 w-6" />}
          title="No notifications yet"
          description="When one of your cases passes its follow-up date, or you earn Civic Points, it appears here."
          action={
            <ButtonLink href="/report" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
              Report a problem
            </ButtonLink>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconCheck className="h-6 w-6" />}
          title="All caught up"
          description="You have read everything. New reminders will appear here."
          action={
            <Button variant="secondary" size="sm" onClick={() => setFilter('ALL')}>
              Show all
            </Button>
          }
        />
      ) : (
        <ul className="stagger space-y-2.5">
          {visible.map((item) => {
            const meta = KIND_META[item.kind] ?? { label: 'Update', icon: IconBell };
            const Icon = meta.icon;
            const tone = notificationTone(item.kind);

            return (
              <Card
                as="li"
                key={item.notificationId}
                interactive
                className={`list-none ${item.read ? '' : 'border-accent-line bg-accent-soft/30'}`}
              >
                <div className="flex items-start gap-4 p-4 sm:p-5">
                  <span
                    aria-hidden="true"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      tone === 'gold'
                        ? 'bg-gold-soft text-gold'
                        : tone === 'bad'
                          ? 'bg-bad-soft text-bad'
                          : tone === 'warn'
                            ? 'bg-warn-soft text-warn'
                            : 'bg-accent-soft text-accent'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone}>{meta.label}</Badge>
                      {!item.read ? (
                        <span className="text-xs font-medium text-accent">
                          Unread<span className="sr-only"> notification</span>
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-2 text-[15px] font-semibold leading-snug text-ink">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">{item.body}</p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <time dateTime={item.createdAt} className="text-xs text-ink-faint">
                        {formatRelative(item.createdAt)} · {formatDateTime(item.createdAt)}
                      </time>
                      <Link
                        href={`/cases/${item.caseId}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
                      >
                        Open case
                        <IconChevronRight className="h-3 w-3" />
                      </Link>
                      {!item.read ? (
                        <button
                          type="button"
                          onClick={() => markRead(item.notificationId)}
                          className="text-xs font-medium text-ink-muted transition-colors hover:text-ink"
                        >
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
