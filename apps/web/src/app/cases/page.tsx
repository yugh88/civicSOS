'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import { STATUS_TONE, URGENCY_LABEL, formatDate, formatRelative, pluralize } from '@/lib/format';
import type { CaseListResponse, CaseRecord, CaseStatus } from '@/lib/types';
import { Alert, Badge, Button, Card, CaseListSkeleton, DemoBadge, EmptyState, SectionHeading } from '@/components/ui';

/**
 * "My cases" dashboard.
 *
 * The one question this screen has to answer at a glance is "is anything waiting
 * on me?", so overdue follow-ups are surfaced first and everything else is
 * ordered newest-first.
 */

const STATUS_LABELS: Record<CaseStatus, string> = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready to submit',
  SUBMITTED: 'Submitted',
  AWAITING_RESPONSE: 'Awaiting response',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED_UNRESOLVED: 'Closed',
};

const FILTERS: Array<{ id: 'ALL' | 'OPEN' | CaseStatus; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'OPEN', label: 'Needs action' },
  { id: 'SUBMITTED', label: 'Submitted' },
  { id: 'RESOLVED', label: 'Resolved' },
];

const OPEN_STATUSES: CaseStatus[] = ['DRAFT', 'READY_TO_SUBMIT', 'AWAITING_RESPONSE', 'ESCALATED'];

export default function CasesPage() {
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('ALL');

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/cases');
  }, [router, session, sessionLoading]);

  const load = useCallback(
    async (nextCursor?: string) => {
      try {
        const result = await api<CaseListResponse>('/cases', {
          query: { limit: 20, cursor: nextCursor },
        });
        setCases((current) => (nextCursor ? [...current, ...result.cases] : result.cases));
        setCursor(result.cursor);
        setError(undefined);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'We could not load your cases.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (session) void load();
  }, [load, session]);

  const visible = cases.filter((record) => {
    if (filter === 'ALL') return true;
    if (filter === 'OPEN') return OPEN_STATUSES.includes(record.status);
    return record.status === filter;
  });

  const overdue = cases.filter(
    (record) =>
      record.followUpAt !== undefined &&
      new Date(record.followUpAt).getTime() <= Date.now() &&
      record.status !== 'RESOLVED' &&
      record.status !== 'CLOSED_UNRESOLVED',
  );

  if (sessionLoading || (loading && session)) {
    return (
      <div className="space-y-6">
        <SectionHeading title="My cases" />
        <CaseListSkeleton />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">My cases</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {cases.length === 0 ? 'Nothing here yet.' : pluralize(cases.length, 'case')}
            {overdue.length > 0 ? ` · ${overdue.length} need${overdue.length === 1 ? 's' : ''} a follow-up` : ''}
          </p>
        </div>
        <Link href="/">
          <Button size="sm">Report a new problem</Button>
        </Link>
      </div>

      {error ? (
        <Alert tone="bad" title="We could not load your cases" action={<Button size="sm" onClick={() => load()}>Try again</Button>}>
          {error}
        </Alert>
      ) : null}

      {overdue.length > 0 ? (
        <Alert tone="warn" title="Time to chase these up">
          <ul className="mt-1 space-y-1">
            {overdue.slice(0, 3).map((record) => (
              <li key={record.caseId}>
                <Link href={`/cases/${record.caseId}`} className="font-medium text-accent underline underline-offset-2">
                  {record.summary}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {cases.length > 0 ? (
        <div role="tablist" aria-label="Filter cases" className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                filter === option.id
                  ? 'border-accent bg-accent text-white'
                  : 'border-line-strong bg-surface text-ink-soft hover:border-accent-line hover:text-accent'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {cases.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No cases yet"
          description="Describe a civic problem and CivicSOS will work out who handles it, what evidence you need and what to do next."
          action={
            <Link href="/">
              <Button>Report a problem</Button>
            </Link>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState icon="🔎" title="Nothing in this filter" description="Try a different filter above." />
      ) : (
        <ul className="space-y-3">
          {visible.map((record) => (
            <CaseRow key={record.caseId} record={record} />
          ))}
        </ul>
      )}

      {cursor ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void load(cursor);
            }}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CaseRow({ record }: { record: CaseRecord }) {
  const isOverdue =
    record.followUpAt !== undefined &&
    new Date(record.followUpAt).getTime() <= Date.now() &&
    record.status !== 'RESOLVED' &&
    record.status !== 'CLOSED_UNRESOLVED';

  return (
    <Card as="li" className="transition-shadow hover:shadow-[0_2px_8px_rgba(16,24,40,0.07)]">
      <Link href={`/cases/${record.caseId}`} className="block p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[record.status]}>{STATUS_LABELS[record.status]}</Badge>
          {record.isDemo ? <DemoBadge /> : null}
          {record.urgency === 'CRITICAL' || record.urgency === 'HIGH' ? (
            <Badge tone={record.urgency === 'CRITICAL' ? 'bad' : 'warn'}>{URGENCY_LABEL[record.urgency]}</Badge>
          ) : null}
          {isOverdue ? <Badge tone="warn">Follow up now</Badge> : null}
        </div>

        <h2 className="mt-3 text-[15px] font-semibold leading-snug text-ink">{record.summary}</h2>

        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
          <div className="flex gap-1">
            <dt className="sr-only">Location</dt>
            <dd>{[record.location.locality, record.location.city].filter(Boolean).join(', ') || 'No location set'}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Created</dt>
            <dd className="font-medium text-ink-soft">{formatDate(record.createdAt)}</dd>
          </div>
          {record.followUpAt ? (
            <div className="flex gap-1">
              <dt>Follow up</dt>
              <dd className={`font-medium ${isOverdue ? 'text-warn' : 'text-ink-soft'}`}>
                {formatRelative(record.followUpAt)}
              </dd>
            </div>
          ) : null}
          {record.officialReference ? (
            <div className="flex gap-1">
              <dt>Ref</dt>
              <dd className="font-mono text-ink-soft">{record.officialReference}</dd>
            </div>
          ) : null}
        </dl>
      </Link>
    </Card>
  );
}
