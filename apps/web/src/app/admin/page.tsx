'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApi, useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import type { AdminOverviewResponse } from '@/lib/types';
import { Alert, Badge, Button, Card, DemoBadge, EmptyState, SectionHeading, Skeleton } from '@/components/ui';

/**
 * Admin dashboard — minimal but genuinely functional.
 *
 * Every number comes from an index query rather than a table scan, demo cases
 * are counted separately from real ones, and the audit trail is visible, because
 * an admin view that hides who did what is not much of an admin view.
 *
 * Access is enforced server-side; this page simply reflects the answer.
 */

const STATUS_ORDER = [
  'DRAFT',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'AWAITING_RESPONSE',
  'ESCALATED',
  'RESOLVED',
  'CLOSED_UNRESOLVED',
] as const;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready',
  SUBMITTED: 'Submitted',
  AWAITING_RESPONSE: 'Awaiting',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED_UNRESOLVED: 'Closed',
};

const CATEGORY_LABELS: Record<string, string> = {
  ROAD_DAMAGE: 'Roads',
  GARBAGE_SANITATION: 'Garbage',
  STREETLIGHT: 'Streetlights',
  WATER_SEWERAGE: 'Water',
  PUBLIC_SAFETY_HAZARD: 'Safety',
  OTHER: 'Other',
};

export default function AdminPage() {
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [overview, setOverview] = useState<AdminOverviewResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | undefined>();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/admin');
  }, [router, session, sessionLoading]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<AdminOverviewResponse>('/admin/overview');
      setOverview(result);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('We could not load the dashboard.'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (session) void load();
  }, [load, session]);

  if (sessionLoading || loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session) return null;

  if (error) {
    const forbidden = error instanceof ApiError && error.status === 403;
    return (
      <div className="space-y-4">
        <Alert tone={forbidden ? 'neutral' : 'bad'} title={forbidden ? 'This area is for administrators' : 'Something went wrong'}>
          <p>
            {forbidden
              ? 'Your account does not have administrator access. Ask an administrator to add you to the ADMIN group.'
              : error.message}
          </p>
        </Alert>
        <Link href="/cases">
          <Button variant="secondary">Back to my cases</Button>
        </Link>
      </div>
    );
  }

  if (!overview) return null;

  const { totals } = overview;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Admin dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Stage <span className="font-medium text-ink-soft">{overview.stage}</span> · generated{' '}
            {formatDateTime(overview.generatedAt)}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      <Alert tone="neutral">
        Counts come from a bounded page per status, so this dashboard is cheap to load. Demo cases are counted
        separately and never folded into the real figures.
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open cases" value={totals.open} tone="accent" />
        <Stat label="Resolved" value={totals.resolved} tone="good" />
        <Stat label="Real cases" value={totals.real} />
        <Stat label="Demo cases" value={totals.demo} tone="warn" />
      </div>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="By status" />
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {STATUS_ORDER.map((status) => (
            <li key={status} className="flex items-center justify-between gap-3 rounded-lg bg-surface-soft px-3.5 py-2.5">
              <span className="text-sm text-ink-soft">{STATUS_LABELS[status]}</span>
              <span className="text-sm font-semibold tabular-nums text-ink">{totals.byStatus[status] ?? 0}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="By category" />
        <ul className="mt-4 space-y-2.5">
          {Object.entries(totals.byCategory).map(([categoryId, count]) => {
            const max = Math.max(1, ...Object.values(totals.byCategory));
            return (
              <li key={categoryId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-soft">{CATEGORY_LABELS[categoryId] ?? categoryId}</span>
                  <span className="font-semibold tabular-nums text-ink">{count}</span>
                </div>
                {/* A bar rather than a chart library: one dependency fewer. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.round((count / max) * 100)}%` }}
                    role="presentation"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Past their follow-up date" description="Cases the daily sweep will remind people about." />
        <div className="mt-4">
          {overview.overdue.length === 0 ? (
            <EmptyState icon="✓" title="Nothing overdue" description="Every open case is still inside its waiting window." />
          ) : (
            <ul className="space-y-2.5">
              {overview.overdue.map((row) => (
                <li key={row.caseId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-soft px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{row.summary}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {STATUS_LABELS[row.status]} · due {formatDate(row.followUpAt)}
                    </p>
                  </div>
                  {row.isDemo ? <DemoBadge /> : <Badge tone="accent">Real</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Audit trail (today)" description="Immutable record of who did what, partitioned by day." />
        <div className="mt-4 overflow-x-auto">
          {overview.recentAudit.length === 0 ? (
            <p className="text-sm text-ink-muted">No audited actions recorded today.</p>
          ) : (
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th scope="col" className="pb-2 pr-3 font-medium">
                    Action
                  </th>
                  <th scope="col" className="pb-2 pr-3 font-medium">
                    Role
                  </th>
                  <th scope="col" className="pb-2 pr-3 font-medium">
                    Resource
                  </th>
                  <th scope="col" className="pb-2 pr-3 font-medium">
                    Outcome
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.recentAudit.map((row, index) => (
                  <tr key={index} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 font-mono text-xs text-ink">{row.action}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{row.actorRole}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-ink-muted">{row.resource}</td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={row.outcome === 'ALLOW' ? 'good' : row.outcome === 'DENY' ? 'warn' : 'bad'}>
                        {row.outcome}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-xs text-ink-faint">{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'accent' | 'good' | 'warn' }) {
  const toneClass = {
    neutral: 'text-ink',
    accent: 'text-accent',
    good: 'text-good',
    warn: 'text-warn',
  }[tone];

  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </Card>
  );
}
