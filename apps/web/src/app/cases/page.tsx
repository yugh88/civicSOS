'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
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
  PageHeader,
  Skeleton,
  Stat,
} from '@/components/ui';
import {
  CategoryIcon,
  IconArrowRight,
  IconCases,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconLocation,
  IconRewards,
} from '@/components/icons';

/**
 * My Cases.
 *
 * The single question this screen answers at a glance is "is anything waiting on
 * me?" — so overdue follow-ups are surfaced above the list, the default filter
 * keeps everything visible, and each row is compact enough to scan a dozen at
 * once rather than scroll through three.
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

/** Statuses where the citizen has not yet filed the complaint. */
const UNSUBMITTED: CaseStatus[] = ['DRAFT', 'READY_TO_SUBMIT'];

function isOpen(record: CaseRecord): boolean {
  return record.status !== 'RESOLVED' && record.status !== 'CLOSED_UNRESOLVED';
}

function isOverdue(record: CaseRecord): boolean {
  return (
    record.followUpAt !== undefined && new Date(record.followUpAt).getTime() <= Date.now() && isOpen(record)
  );
}

/**
 * "Needs action" means exactly one thing: the next move is the citizen's.
 *
 * That is either a complaint they have not filed yet, or one that is past its
 * follow-up date. Defining it this way keeps the summary tile, the filter and
 * the overdue banner in agreement — they were previously counting different
 * things, which made the page contradict itself.
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

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/cases');
  }, [router, session, sessionLoading]);

  const load = useCallback(
    async (nextCursor?: string) => {
      try {
        const [page, profile] = await Promise.all([
          api<CaseListResponse>('/cases', { query: { limit: 20, cursor: nextCursor } }),
          nextCursor ? Promise.resolve(me) : api<MeResponse>('/me'),
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
    // `me` is only read on the first page; re-creating this on every profile
    // change would refetch the list needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  useEffect(() => {
    if (session) void load();
  }, [load, session]);

  const overdue = cases.filter(isOverdue);
  const actionable = cases.filter(needsAction);
  const resolved = cases.filter((record) => record.status === 'RESOLVED');
  const submitted = cases.filter((record) => record.status === 'SUBMITTED');

  /**
   * Points actually recorded against each case, summed from the ledger the
   * server returned. Never computed from the case's status — the number on
   * screen has to be the number in the ledger.
   */
  const pointsByCase = new Map<string, number>();
  for (const entry of me?.pointsHistory ?? []) {
    if (entry.caseId && entry.delta > 0) {
      pointsByCase.set(entry.caseId, (pointsByCase.get(entry.caseId) ?? 0) + entry.delta);
    }
  }

  const visible = cases.filter((record) => {
    if (filter === 'ALL') return true;
    if (filter === 'NEEDS_ACTION') return needsAction(record);
    return record.status === filter;
  });

  if (sessionLoading || (loading && session)) {
    return (
      <div className="space-y-7">
        <PageHeader title="My Cases" description="Track your reports, follow up and see the impact you're creating." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
        <CaseListSkeleton />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="space-y-7">
      <PageHeader
        title="My Cases"
        description="Track your reports, follow up and see the impact you're creating."
        action={
          <ButtonLink href="/report" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
            Report a problem
          </ButtonLink>
        }
      />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total cases" value={cases.length} icon={<IconCases className="h-5 w-5" />} />
        <Stat
          label="Needs action"
          value={actionable.length}
          tone={actionable.length > 0 ? 'warn' : 'neutral'}
          icon={<IconClock className="h-5 w-5" />}
        />
        <Stat label="Resolved" value={resolved.length} tone="good" icon={<IconCheck className="h-5 w-5" />} />
        <Stat
          label="Civic points"
          value={(me?.profile.civicPoints ?? 0).toLocaleString()}
          tone="gold"
          icon={<IconRewards className="h-5 w-5" />}
          hint={me?.level ? me.level.level.label : undefined}
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
          <ul className="mt-1.5 space-y-1.5">
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
        <FilterRail<FilterId>
          label="Filter cases"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'ALL', label: 'All', count: cases.length },
            { id: 'NEEDS_ACTION', label: 'Needs action', count: actionable.length },
            { id: 'SUBMITTED', label: 'Submitted', count: submitted.length },
            { id: 'RESOLVED', label: 'Resolved', count: resolved.length },
          ]}
        />
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
          title="Nothing in this filter"
          description="Try a different filter above to see your other cases."
          action={
            <Button variant="secondary" size="sm" onClick={() => setFilter('ALL')}>
              Show all cases
            </Button>
          }
        />
      ) : (
        <ul className="stagger space-y-2.5">
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

function CaseRow({ record, pointsEarned }: { record: CaseRecord; pointsEarned?: number }) {
  const overdue = isOverdue(record);
  const location = [record.location.locality, record.location.city].filter(Boolean).join(', ');

  return (
    <Card as="li" interactive className="list-none">
      <Link href={`/cases/${record.caseId}`} className="flex items-start gap-4 p-4 sm:p-5">
        <span
          aria-hidden="true"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-soft sm:flex"
        >
          <CategoryIcon categoryId={record.categoryId} className="h-[22px] w-[22px]" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[record.status]} icon={<Dot tone={STATUS_TONE[record.status]} />}>
              {STATUS_LABELS[record.status]}
            </Badge>
            {record.isDemo ? <DemoBadge /> : null}
            {record.urgency === 'CRITICAL' ? <Badge tone="bad">Urgent</Badge> : null}
            {overdue ? <Badge tone="warn">Follow up now</Badge> : null}
          </span>

          <span className="mt-2.5 block text-[15px] font-semibold leading-snug text-ink">{record.summary}</span>

          <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <IconLocation className="h-3.5 w-3.5 text-ink-faint" />
              {location || 'No location set'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <IconClock className="h-3.5 w-3.5 text-ink-faint" />
              {formatDate(record.createdAt)}
            </span>
            {record.followUpAt ? (
              <span className={overdue ? 'font-medium text-warn' : ''}>
                Follow up {formatRelative(record.followUpAt)}
              </span>
            ) : null}
            {record.officialReference ? (
              <span className="font-mono text-ink-faint">{record.officialReference}</span>
            ) : null}
            {/* Only rendered when the ledger actually has an entry for this case. */}
            {pointsEarned ? (
              <span className="inline-flex items-center gap-1 font-medium text-gold">+{pointsEarned} pts</span>
            ) : null}
          </span>
        </span>

        <IconChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-ink-faint" />
      </Link>
    </Card>
  );
}
