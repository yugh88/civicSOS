'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import { CATEGORY_ALT, categoryArt } from '@/lib/category-art';
import { STATUS_TONE, formatDate, formatRelative } from '@/lib/format';
import type { CaseListResponse, CaseRecord, CaseStatus, MeResponse } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CaseListSkeleton,
  DemoBadge,
  Dot,
  EmptyState,
  FilterRail,
  Input,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import {
  IconArrowRight,
  IconCases,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDocument,
  IconLocation,
  IconRewards,
} from '@/components/icons';

/**
 * My Cases.
 *
 * The question this screen answers at a glance is "is anything waiting on me?".
 * Overdue follow-ups are surfaced above the list, and rows are compact enough to
 * scan a dozen at once rather than scroll through three.
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

type FilterId = 'ALL' | 'NEEDS_ACTION' | 'SUBMITTED' | 'RESOLVED';
type SortId = 'RECENT' | 'OLDEST' | 'FOLLOW_UP' | 'POINTS';

const SORT_LABELS: Record<SortId, string> = {
  RECENT: 'Latest first',
  OLDEST: 'Oldest first',
  FOLLOW_UP: 'Follow-up date',
  POINTS: 'Points earned',
};

/** Statuses where the citizen has not yet filed the complaint. */
const UNSUBMITTED: CaseStatus[] = ['DRAFT', 'READY_TO_SUBMIT'];

function isOpen(record: CaseRecord): boolean {
  return record.status !== 'RESOLVED' && record.status !== 'CLOSED_UNRESOLVED';
}

function isOverdue(record: CaseRecord): boolean {
  return record.followUpAt !== undefined && new Date(record.followUpAt).getTime() <= Date.now() && isOpen(record);
}

/**
 * "Needs action" means exactly one thing: the next move is the citizen's.
 *
 * That is either a complaint they have not filed yet, or one past its follow-up
 * date. Defining it once keeps the summary tile, the filter and the overdue
 * banner in agreement.
 */
function needsAction(record: CaseRecord): boolean {
  return isOpen(record) && (UNSUBMITTED.includes(record.status) || isOverdue(record));
}

export default function CasesPage() {
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [me, setMe] = useState<MeResponse | undefined>();
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState<FilterId>('ALL');
  const [sort, setSort] = useState<SortId>('RECENT');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/cases');
  }, [router, session, sessionLoading]);

  const load = useCallback(
    async (nextCursor?: string) => {
      try {
        const [page, profile] = await Promise.all([
          api<CaseListResponse>('/cases', { query: { limit: 20, cursor: nextCursor } }),
          nextCursor ? Promise.resolve(undefined) : api<MeResponse>('/me'),
        ]);
        setCases((current) => (nextCursor ? [...current, ...page.cases] : page.cases));
        setCursor(page.cursor);
        if (profile) setMe(profile);
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

  /**
   * Points actually recorded against each case, summed from the ledger the
   * server returned. Never derived from status — the number on screen has to be
   * the number in the ledger.
   */
  const pointsByCase = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of me?.pointsHistory ?? []) {
      if (entry.caseId && entry.delta > 0) map.set(entry.caseId, (map.get(entry.caseId) ?? 0) + entry.delta);
    }
    return map;
  }, [me]);

  const overdue = cases.filter(isOverdue);
  const actionable = cases.filter(needsAction);
  const resolved = cases.filter((record) => record.status === 'RESOLVED');
  const submitted = cases.filter((record) => record.status === 'SUBMITTED');

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();

    const filtered = cases.filter((record) => {
      if (filter === 'NEEDS_ACTION' && !needsAction(record)) return false;
      if (filter === 'SUBMITTED' && record.status !== 'SUBMITTED') return false;
      if (filter === 'RESOLVED' && record.status !== 'RESOLVED') return false;
      if (!term) return true;
      // Search what a person would actually remember: the problem, where it
      // was, and the reference number they were given.
      return [
        record.summary,
        record.description,
        record.location.locality,
        record.location.city,
        record.officialReference,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'OLDEST':
          return a.createdAt.localeCompare(b.createdAt);
        case 'FOLLOW_UP': {
          // Cases with no follow-up date sink to the bottom rather than jumping
          // to the top on an empty-string comparison.
          const left = a.followUpAt ?? '9999';
          const right = b.followUpAt ?? '9999';
          return left.localeCompare(right);
        }
        case 'POINTS':
          return (pointsByCase.get(b.caseId) ?? 0) - (pointsByCase.get(a.caseId) ?? 0);
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return sorted;
  }, [cases, filter, pointsByCase, query, sort]);

  if (sessionLoading || (loading && session)) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Cases" description="Track, follow up and see the impact you're creating." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[86px] w-full rounded-2xl" />
          ))}
        </div>
        <CaseListSkeleton />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Cases"
        description="Track, follow up and see the impact you're creating."
        action={
          <ButtonLink href="/report" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
            Report a new problem
          </ButtonLink>
        }
      />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Total Cases" value={cases.length} icon={<IconDocument className="h-5 w-5" />} tone="accent" />
        <SummaryTile
          label="Needs Action"
          value={actionable.length}
          icon={<IconClock className="h-5 w-5" />}
          tone={actionable.length > 0 ? 'warn' : 'neutral'}
        />
        <SummaryTile label="Resolved" value={resolved.length} icon={<IconCheck className="h-5 w-5" />} tone="good" />
        <SummaryTile
          label="Points Earned"
          value={`+${(me?.profile.lifetimePoints ?? 0).toLocaleString()}`}
          icon={<IconRewards className="h-5 w-5" />}
          tone="gold"
        />
      </div>

      {error ? (
        <Alert
          tone="bad"
          title="We could not load your cases"
          action={
            <Button size="sm" onClick={() => load()}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {overdue.length > 0 ? (
        <Alert tone="warn" title={`${overdue.length} case${overdue.length === 1 ? '' : 's'} need a follow-up`}>
          <ul className="mt-1.5 space-y-1">
            {overdue.slice(0, 3).map((record) => (
              <li key={record.caseId}>
                <Link
                  href={`/cases/${record.caseId}`}
                  className="font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
                >
                  {record.summary}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {cases.length > 0 ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterRail<FilterId>
            label="Filter cases"
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'ALL', label: 'All', count: cases.length },
              { id: 'NEEDS_ACTION', label: 'Needs Action', count: actionable.length },
              { id: 'SUBMITTED', label: 'Submitted', count: submitted.length },
              { id: 'RESOLVED', label: 'Resolved', count: resolved.length },
            ]}
          />

          <div className="flex shrink-0 items-center gap-2">
            <div className="relative flex-1 lg:w-52">
              <label htmlFor="case-search" className="sr-only">
                Search cases
              </label>
              <Input
                id="case-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search cases…"
                className="h-10 py-0 pl-9 text-sm"
              />
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
            </div>

            <label htmlFor="case-sort" className="sr-only">
              Sort cases
            </label>
            <select
              id="case-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortId)}
              className="h-10 shrink-0 rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink-soft transition-colors hover:bg-surface-soft focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft"
            >
              {(Object.keys(SORT_LABELS) as SortId[]).map((id) => (
                <option key={id} value={id}>
                  {SORT_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {cases.length === 0 ? (
        <EmptyState
          icon={<IconCases className="h-6 w-6" />}
          title="No cases yet"
          description="Describe a civic problem and CivicSOS will work out who handles it, what evidence you need and what to do next."
          action={
            <ButtonLink href="/report" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
              Report a problem
            </ButtonLink>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconCases className="h-6 w-6" />}
          title={query.trim() ? 'No cases match that search' : 'Nothing in this filter'}
          description={
            query.trim()
              ? 'Try a different word, or clear the search to see everything.'
              : 'Try a different filter above to see your other cases.'
          }
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFilter('ALL');
                setQuery('');
              }}
            >
              Show all cases
            </Button>
          }
        />
      ) : (
        <ul className="stagger space-y-2">
          {visible.map((record) => (
            <CaseRow key={record.caseId} record={record} pointsEarned={pointsByCase.get(record.caseId)} />
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

/* ------------------------------------------------------------------ */

function SummaryTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone: 'accent' | 'warn' | 'good' | 'gold' | 'neutral';
}) {
  const badge = {
    accent: 'bg-accent-soft text-accent',
    warn: 'bg-warn-soft text-warn',
    good: 'bg-good-soft text-good',
    gold: 'bg-gold-soft text-gold',
    neutral: 'bg-surface-sunken text-ink-muted',
  }[tone];

  const figure = {
    accent: 'text-ink',
    warn: 'text-warn',
    good: 'text-good',
    gold: 'text-gold',
    neutral: 'text-ink',
  }[tone];

  return (
    <Card className="flex items-center gap-3 p-4">
      <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${badge}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={`block text-xl font-semibold tabular-nums leading-tight ${figure} sm:text-2xl`}>{value}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">{label}</span>
      </span>
    </Card>
  );
}

function CaseRow({ record, pointsEarned }: { record: CaseRecord; pointsEarned?: number }) {
  const overdue = isOverdue(record);
  const location = [record.location.locality, record.location.city].filter(Boolean).join(', ');

  return (
    <Card as="li" interactive className="group list-none overflow-hidden">
      <Link href={`/cases/${record.caseId}`} className="flex items-stretch gap-3 sm:gap-4">
        {/* Category imagery doubles as a fast visual index down the list. */}
        <span className="relative w-20 shrink-0 overflow-hidden bg-surface-sunken sm:w-28">
          <img
            src={categoryArt(record.categoryId)}
            alt={CATEGORY_ALT[record.categoryId] ?? ''}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </span>

        <span className="min-w-0 flex-1 py-3 pr-2 sm:py-3.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[record.status]} icon={<Dot tone={STATUS_TONE[record.status]} />}>
              {STATUS_LABELS[record.status]}
            </Badge>
            {record.isDemo ? <DemoBadge /> : null}
            {record.urgency === 'CRITICAL' ? <Badge tone="bad">Urgent</Badge> : null}
          </span>

          <span className="mt-1.5 block text-sm font-semibold leading-snug text-ink">{record.summary}</span>

          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted sm:text-xs">
            <span className="inline-flex items-center gap-1">
              <IconLocation className="h-3.5 w-3.5 text-ink-faint" />
              {location || 'Not specified'}
            </span>
            <span className="inline-flex items-center gap-1">
              <IconClock className="h-3.5 w-3.5 text-ink-faint" />
              {formatDate(record.createdAt)}
            </span>
            {record.followUpAt ? (
              <span className={overdue ? 'font-medium text-warn' : ''}>
                Follow up {formatRelative(record.followUpAt)}
              </span>
            ) : record.resolvedAt ? (
              <span className="text-good">Resolved {formatDate(record.resolvedAt)}</span>
            ) : null}
            {record.officialReference ? (
              <span className="hidden font-mono text-ink-faint sm:inline">Ref: {record.officialReference}</span>
            ) : null}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1 self-center pr-3 sm:gap-2 sm:pr-4">
          {/* Only rendered when the ledger actually has an entry for this case. */}
          {pointsEarned ? (
            <span className="text-xs font-semibold tabular-nums text-gold sm:text-sm">+{pointsEarned} pts</span>
          ) : null}
          <IconChevronRight
            aria-hidden="true"
            className="h-4 w-4 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent"
          />
        </span>
      </Link>
    </Card>
  );
}
