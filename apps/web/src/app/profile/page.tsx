'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import { formatDate, formatRelative } from '@/lib/format';
import type { MeResponse } from '@/lib/types';
import {
  Alert,
  Avatar,
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  SectionHeading,
  Skeleton,
} from '@/components/ui';
import {
  IconArrowRight,
  IconBell,
  IconCases,
  IconCheck,
  IconChevronRight,
  IconRewards,
  IconSettings,
  IconSparkle,
  IconUsers,
} from '@/components/icons';

/**
 * Profile.
 *
 * Shows who the citizen is, what they have achieved, and where to go next.
 * Gamification is present but quiet: one points figure, one progress bar, one
 * level name. No confetti, no streaks, no badges wall — the reward for civic
 * participation should feel like recognition, not a mobile game.
 */

const LEVEL_TONE: Record<string, 'neutral' | 'gold' | 'teal' | 'accent'> = {
  BRONZE: 'neutral',
  SILVER: 'teal',
  GOLD: 'gold',
  CHAMPION: 'accent',
};

const MENU = [
  { href: '/cases', label: 'My Cases', description: 'Track and follow up on your reports', icon: IconCases },
  { href: '/rewards', label: 'Rewards', description: 'Spend your Civic Points', icon: IconRewards },
  { href: '/notifications', label: 'Notifications', description: 'Reminders and updates', icon: IconBell },
  { href: '/settings', label: 'Settings', description: 'Your details and privacy', icon: IconSettings },
] as const;

export default function ProfilePage() {
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [me, setMe] = useState<MeResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/profile');
  }, [router, session, sessionLoading]);

  const load = useCallback(async () => {
    try {
      setMe(await api<MeResponse>('/me'));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (session) void load();
  }, [load, session]);

  if (sessionLoading || (loading && session)) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="My Profile" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!session) return null;

  if (error || !me) {
    return (
      <div className="space-y-4">
        <PageHeader title="My Profile" />
        <Alert tone="bad" title="We could not load your profile">
          {error ?? 'Please try again in a moment.'}
        </Alert>
      </div>
    );
  }

  const displayName = me.profile.displayName || session.displayName || me.profile.email || 'Citizen';
  const levelTone = LEVEL_TONE[me.level.level.id] ?? 'neutral';
  const earned = me.pointsHistory.filter((entry) => entry.delta > 0);

  return (
    <div className="space-y-7">
      <PageHeader title="My Profile" />

      {session.kind === 'guest' ? (
        <Alert tone="warn" title="You are in a demo session">
          <p>
            This session and its sample cases disappear on their own. Create an account if you want to track a real
            problem and keep your Civic Points.
          </p>
          <ButtonLink href="/signin" size="sm" className="mt-3">
            Create an account
          </ButtonLink>
        </Alert>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Identity and level                                               */}
      {/* ---------------------------------------------------------------- */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-7">
          <div className="flex items-center gap-4">
            <Avatar name={displayName} size="xl" />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-tight text-ink">{displayName}</h2>
              <p className="truncate text-sm text-ink-muted">
                {me.profile.email ?? (session.kind === 'guest' ? 'Demo visitor' : 'Signed in')}
              </p>
              <Badge tone={levelTone} className="mt-2.5" icon={<IconSparkle className="h-3.5 w-3.5" />}>
                {me.level.level.label}
              </Badge>
            </div>
          </div>

          <div className="min-w-0 flex-1 sm:border-l sm:border-line sm:pl-8">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Civic Points</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums tracking-tight text-gold">
                {me.profile.civicPoints.toLocaleString()}
              </span>
              <span className="text-sm text-ink-muted">available</span>
            </p>

            <ProgressBar
              value={me.level.progress}
              tone="gold"
              className="mt-4"
              label={`Progress to ${me.level.next?.label ?? 'the top level'}`}
            />
            <p className="mt-2 text-sm text-ink-muted">
              {me.level.next ? (
                <>
                  You&apos;re <span className="font-semibold text-ink">{me.level.pointsToNext} points</span> away from{' '}
                  {me.level.next.label}.
                </>
              ) : (
                me.level.level.blurb
              )}
            </p>
          </div>
        </div>

        <div className="border-t border-line bg-surface-soft px-6 py-3.5 sm:px-7">
          <p className="text-xs leading-relaxed text-ink-muted">
            {me.level.level.blurb} Points come from reporting real problems and following them through — your level is
            based on everything you have ever earned, so spending points never lowers it.
          </p>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Impact                                                           */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="impact" className="space-y-4">
        <SectionHeading id="impact" title="My impact" description="What your reports have added up to." />
        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ImpactTile
            label="Problems reported"
            value={me.impact.casesReported}
            icon={<IconCases className="h-5 w-5" />}
            tone="accent"
          />
          <ImpactTile
            label="Problems resolved"
            value={me.impact.casesResolved}
            icon={<IconCheck className="h-5 w-5" />}
            tone="good"
          />
          <ImpactTile
            label="Points earned"
            value={me.impact.lifetimePoints.toLocaleString()}
            icon={<IconRewards className="h-5 w-5" />}
            tone="gold"
          />
          <ImpactTile
            label="Community impact"
            value={
              me.impact.casesResolved > 0
                ? `${Math.round((me.impact.casesResolved / Math.max(1, me.impact.casesReported)) * 100)}%`
                : '—'
            }
            hint="of your reports resolved"
            icon={<IconUsers className="h-5 w-5" />}
            tone="teal"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Recent activity                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="activity" className="space-y-4">
        <SectionHeading
          id="activity"
          title="Recent points activity"
          description="Every award, exactly as recorded."
          aside={
            <Link href="/rewards" className="text-sm font-medium text-accent hover:text-accent-hover">
              Spend points
            </Link>
          }
        />

        {me.pointsHistory.length === 0 ? (
          <EmptyState
            icon={<IconSparkle className="h-6 w-6" />}
            title="No points yet"
            description="Report a civic problem to earn your first 50 Civic Points."
            action={
              <ButtonLink href="/report" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
                Report a problem
              </ButtonLink>
            }
          />
        ) : (
          <Card className="divide-y divide-line">
            {me.pointsHistory.slice(0, 8).map((entry) => (
              <div key={entry.entryId} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{entry.label}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {formatRelative(entry.createdAt)} · {formatDate(entry.createdAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    entry.delta > 0 ? 'text-gold' : 'text-ink-muted'
                  }`}
                >
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </span>
              </div>
            ))}
            {earned.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">No awards yet — only redemptions.</p>
            ) : null}
          </Card>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Menu                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="menu" className="space-y-4">
        <SectionHeading id="menu" title="Manage" />
        <ul className="stagger grid gap-2.5 sm:grid-cols-2">
          {MENU.map((item) => (
            <Card as="li" key={item.href} interactive className="list-none">
              <Link href={item.href} className="flex items-center gap-4 p-4">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-soft"
                >
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{item.description}</span>
                </span>
                {item.href === '/notifications' && me.unreadCount > 0 ? (
                  <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                    {me.unreadCount}
                  </span>
                ) : null}
                <IconChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" />
              </Link>
            </Card>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ImpactTile({
  label,
  value,
  icon,
  tone,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone: 'accent' | 'good' | 'gold' | 'teal';
  hint?: string;
}) {
  const toneClass = {
    accent: 'bg-accent-soft text-accent',
    good: 'bg-good-soft text-good',
    gold: 'bg-gold-soft text-gold',
    teal: 'bg-teal-soft text-teal',
  };

  return (
    <Card className="p-5">
      <span aria-hidden="true" className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass[tone]}`}>
        {icon}
      </span>
      <p className="mt-3.5 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      <p className="mt-0.5 text-sm text-ink-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-faint">{hint}</p> : null}
    </Card>
  );
}
