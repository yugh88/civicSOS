'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApi, useAuth } from '@/lib/auth';
import {
  STATUS_TONE,
  URGENCY_LABEL,
  URGENCY_TONE,
  formatDate,
  formatDateTime,
  formatRelative,
  placeholderLabel,
} from '@/lib/format';
import type { AgentRunResponse, CaseDetailResponse, CasePhase, CaseStatus, ResolveCaseResponse } from '@/lib/types';
import { notifyProfileChanged } from '@/lib/profile-events';
import { AgentExecution, SimulationNotice } from '@/components/AgentExecution';
import { CaseTimeline } from '@/components/CaseTimeline';
import { EvidenceUploader } from '@/components/EvidenceUploader';
import { PlanView } from '@/components/PlanView';
import { CopyButton } from '@/components/ReportFlow';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  DemoBadge,
  Dot,
  Field,
  Input,
  PointsPill,
  SectionHeading,
  Skeleton,
  Textarea,
} from '@/components/ui';
import {
  CategoryIcon,
  IconArrowLeft,
  IconCamera,
  IconCheck,
  IconClock,
  IconDocument,
  IconEscalate,
  IconLocation,
  IconSend,
  IconSparkle,
} from '@/components/icons';

/**
 * Case detail: the tracking screen.
 *
 * Holds the later half of the journey — record the official submission, log a
 * follow-up, escalate once the waiting window has passed, attach evidence, and
 * close the case. Every action is gated by the server's rules engine; the
 * buttons reflect what the server has already said is possible, and a refusal
 * comes back as a plain explanation rather than a disabled control with no
 * reason attached.
 */

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready to submit',
  SUBMITTED: 'Submitted',
  AWAITING_RESPONSE: 'Awaiting response',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED_UNRESOLVED: 'Closed without resolution',
};

const STATUS_HINTS: Record<string, string> = {
  DRAFT: 'Fill in the remaining blanks, then submit it through the official channel.',
  READY_TO_SUBMIT: 'Everything is in place. Submit it officially and record the reference number you get back.',
  SUBMITTED: 'Submitted. We will tell you when it is time to follow up.',
  AWAITING_RESPONSE: 'You have followed up and are waiting on the authority.',
  ESCALATED: 'You have escalated. Keep every reference number along the chain.',
  RESOLVED: 'Resolved. The full history stays here in case the problem comes back.',
  CLOSED_UNRESOLVED: 'Closed without resolution. You can still escalate this later.',
};

/** Phase drives the headline badge; it is derived, never stored. */
const PHASE_TONE: Record<CasePhase, 'neutral' | 'accent' | 'teal' | 'good' | 'warn' | 'gold' | 'bad'> = {
  PREPARING: 'neutral',
  AWAITING_APPROVAL: 'accent',
  SUBMITTED: 'accent',
  MONITORING: 'teal',
  FOLLOW_UP_READY: 'warn',
  ESCALATION_READY: 'bad',
  RESOLVED: 'good',
  CLOSED: 'neutral',
};

/** The five milestones shown as the case's headline progress. */
const PROGRESS_STAGES = ['Reported', 'Analysed', 'Submitted', 'In progress', 'Resolved'] as const;

function stageIndex(status: CaseStatus, submitted: boolean): number {
  if (status === 'RESOLVED' || status === 'CLOSED_UNRESOLVED') return 4;
  if (status === 'AWAITING_RESPONSE' || status === 'ESCALATED') return 3;
  if (submitted) return 2;
  return 1;
}

type Panel = 'plan' | 'complaint' | 'evidence' | 'history';

export default function CaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [detail, setDetail] = useState<CaseDetailResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | undefined>();
  const [panel, setPanel] = useState<Panel>('plan');
  const [actionError, setActionError] = useState<string | undefined>();
  const [actionNotice, setActionNotice] = useState<string | undefined>();
  const [pointsNotice, setPointsNotice] = useState<{ points: number; levelUp?: string } | undefined>();
  const [agentRun, setAgentRun] = useState<AgentRunResponse | undefined>();
  const [agentBusy, setAgentBusy] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace(`/signin?next=/cases/${caseId}`);
  }, [caseId, router, session, sessionLoading]);

  const load = useCallback(async () => {
    try {
      setDetail(await api<CaseDetailResponse>(`/cases/${caseId}`));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('We could not load this case.'));
    } finally {
      setLoading(false);
    }
  }, [api, caseId]);

  useEffect(() => {
    if (session) void load();
  }, [load, session]);

  /** Runs a case action, then refreshes so the plan and timeline stay truthful. */
  const act = useCallback(
    async (key: string, path: string, body: unknown, successMessage: string) => {
      setBusy(key);
      setActionError(undefined);
      setActionNotice(undefined);
      setPointsNotice(undefined);
      try {
        const result = await api<Partial<ResolveCaseResponse>>(path, { method: 'POST', body });
        await load();
        setActionNotice(successMessage);
        // Points come back from the server with the action's own response, so
        // the figure shown is the figure written to the ledger.
        if (result?.pointsAwarded) {
          setPointsNotice({ points: result.pointsAwarded, levelUp: result.levelUp });
          notifyProfileChanged();
        }
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : 'That did not work.');
      } finally {
        setBusy(undefined);
      }
    },
    [api, load],
  );

  /** Prepares the follow-up (dry run) or sends it, depending on `approve`. */
  const runFollowUpAgent = useCallback(
    async (approve: boolean) => {
      setAgentBusy(true);
      setActionError(undefined);
      try {
        const run = await api<AgentRunResponse>(`/cases/${caseId}/agent/follow-up`, {
          method: 'POST',
          body: { approve },
        });
        setAgentRun(run);
        if (approve) {
          await load();
          setActionNotice('Follow-up sent. We will check again after the next window.');
        }
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : 'That did not work.');
      } finally {
        setAgentBusy(false);
      }
    },
    [api, caseId, load],
  );

  const runSubmitAgent = useCallback(async () => {
    setAgentBusy(true);
    setActionError(undefined);
    try {
      const run = await api<AgentRunResponse>(`/cases/${caseId}/agent/submit`, {
        method: 'POST',
        body: { approve: true },
      });
      setAgentRun(run);
      await load();
      setActionNotice(`Submitted. Reference ${run.reference}.`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setAgentBusy(false);
    }
  }, [api, caseId, load]);

  if (sessionLoading || loading) return <CaseDetailSkeleton />;
  if (!session) return null;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto max-w-lg space-y-4 py-8">
        <Alert
          tone={notFound ? 'neutral' : 'bad'}
          title={notFound ? 'We could not find that case' : 'Something went wrong'}
        >
          {notFound
            ? 'It may have been removed, or it may belong to a different account.'
            : error.message}
        </Alert>
        <ButtonLink href="/cases" variant="secondary" icon={<IconArrowLeft className="h-4 w-4" />}>
          Back to my cases
        </ButtonLink>
      </div>
    );
  }

  if (!detail) return null;

  const { case: record, plan, escalation, timeline, outstandingPlaceholders } = detail;
  const isClosed = record.status === 'RESOLVED' || record.status === 'CLOSED_UNRESOLVED';
  const canMarkSubmitted = !record.submittedAt && !isClosed;
  const stage = stageIndex(record.status, Boolean(record.submittedAt));

  const panels: Array<{ id: Panel; label: string; count?: number }> = [
    { id: 'plan', label: 'What happens next' },
    { id: 'complaint', label: 'Complaint' },
    { id: 'evidence', label: 'Evidence', count: record.evidenceCount },
    { id: 'history', label: 'History', count: timeline.length },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/cases"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
      >
        <IconArrowLeft className="h-4 w-4" />
        My cases
      </Link>

      {/* ---------------------------------------------------------------- */}
      {/* Header                                                           */}
      {/* ---------------------------------------------------------------- */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={PHASE_TONE[detail.phase] ?? STATUS_TONE[record.status]} icon={<Dot tone={PHASE_TONE[detail.phase] ?? STATUS_TONE[record.status]} />}>
            {detail.phaseLabel ?? STATUS_LABELS[record.status]}
          </Badge>
          <Badge tone="accent" icon={<CategoryIcon categoryId={record.categoryId} className="h-3.5 w-3.5" />}>
            {plan.categoryLabel}
          </Badge>
          <Badge tone={URGENCY_TONE[record.urgency]}>{URGENCY_LABEL[record.urgency]}</Badge>
          {record.isDemo ? <DemoBadge /> : null}
        </div>

        <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-ink sm:text-[30px]">
          {record.summary}
        </h1>
        {/* The phase is derived server-side, so it can never contradict the
            record it describes. */}
        <p className="text-[15px] text-ink-muted">{detail.phaseMessage ?? STATUS_HINTS[record.status]}</p>

        <ProgressRail stage={stage} closedWithoutFix={record.status === 'CLOSED_UNRESOLVED'} />

        <dl className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Location" icon={<IconLocation className="h-4 w-4" />}>
            {[record.location.locality, record.location.city, record.location.state].filter(Boolean).join(', ') ||
              'Not specified'}
          </Fact>
          <Fact label="Reported" icon={<IconClock className="h-4 w-4" />}>
            {formatDate(record.createdAt)}
          </Fact>
          <Fact label="Reference" icon={<IconDocument className="h-4 w-4" />}>
            {record.officialReference ? (
              <span className="font-mono">{record.officialReference}</span>
            ) : (
              <span className="text-ink-muted">Not submitted yet</span>
            )}
          </Fact>
          <Fact label={isClosed ? 'Closed' : 'Follow up'} icon={<IconSend className="h-4 w-4" />}>
            {isClosed
              ? formatDate(record.resolvedAt)
              : record.followUpAt
                ? `${formatRelative(record.followUpAt)} · ${formatDate(record.followUpAt)}`
                : '—'}
          </Fact>
        </dl>
      </header>

      {pointsNotice ? (
        <Alert tone="gold" title={pointsNotice.levelUp ? `You reached ${pointsNotice.levelUp}` : 'Civic Points earned'}>
          <div className="flex flex-wrap items-center gap-3">
            <PointsPill points={pointsNotice.points} size="md" />
            <span>Your problem was resolved — thank you for seeing it through.</span>
          </div>
        </Alert>
      ) : null}

      {actionNotice && !pointsNotice ? (
        <Alert tone="good" icon={<IconCheck className="h-[18px] w-[18px]" />}>
          {actionNotice}
        </Alert>
      ) : null}

      {actionError ? (
        <Alert tone="bad" title="We could not do that">
          {actionError}
        </Alert>
      ) : null}

      {outstandingPlaceholders.length > 0 && !isClosed ? (
        <Alert tone="warn" title="Your complaint still has blanks">
          <p>
            Fill in {outstandingPlaceholders.map((token) => placeholderLabel(token)).join(', ')} before you submit it.
            We leave these blank rather than guessing.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setPanel('complaint')}>
            Edit the complaint
          </Button>
        </Alert>
      ) : null}

      <AgentPanel
        detail={detail}
        busy={agentBusy}
        run={agentRun}
        onSubmit={runSubmitAgent}
        onPrepareFollowUp={() => runFollowUpAgent(false)}
        onSendFollowUp={() => runFollowUpAgent(true)}
        onDismissRun={() => setAgentRun(undefined)}
      />

      <ActionBar
        detail={detail}
        busy={busy}
        canMarkSubmitted={canMarkSubmitted}
        onSubmitted={(reference, channel) =>
          act(
            'submitted',
            `/cases/${caseId}/submitted`,
            { officialReference: reference, channel },
            'Recorded as submitted. We will remind you when to follow up.',
          )
        }
        onFollowUp={(note) => act('followup', `/cases/${caseId}/follow-up`, { note }, 'Follow-up logged.')}
        onEscalate={() =>
          act('escalate', `/cases/${caseId}/follow-up`, { escalate: true }, 'Escalation recorded. Keep the reference numbers.')
        }
        onResolve={(note, outcome) =>
          act(
            'resolve',
            `/cases/${caseId}/resolve`,
            { resolutionNote: note, outcome },
            outcome === 'FIXED' ? 'Marked resolved.' : 'Case closed.',
          )
        }
      />

      {/* ---------------------------------------------------------------- */}
      {/* Panels                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div>
        <div
          role="tablist"
          aria-label="Case sections"
          className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 pb-3 sm:mx-0 sm:px-0"
        >
          {panels.map((option) => (
            <button
              key={option.id}
              role="tab"
              type="button"
              id={`tab-${option.id}`}
              aria-selected={panel === option.id}
              aria-controls={`panel-${option.id}`}
              onClick={() => setPanel(option.id)}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors duration-150 ${
                panel === option.id ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:bg-surface-soft'
              }`}
            >
              {option.label}
              {option.count ? <span className="ml-1.5 tabular-nums text-ink-faint">{option.count}</span> : null}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${panel}`} aria-labelledby={`tab-${panel}`} tabIndex={-1} className="pt-6">
          {panel === 'plan' ? (
            <PlanView
              plan={plan}
              hideSummary
              notice={
                escalation.followUpOverdue ? (
                  <Alert tone="warn" title="This is past its follow-up date" icon={<IconClock className="h-[18px] w-[18px]" />}>
                    {escalation.reason}
                  </Alert>
                ) : undefined
              }
            />
          ) : null}

          {panel === 'complaint' ? <ComplaintPanel detail={detail} onSaved={load} /> : null}

          {panel === 'evidence' ? (
            <Card className="p-5 sm:p-6">
              <SectionHeading
                title="Evidence"
                description="Photos and documents you can attach to your complaint. Only you can see these."
                aside={
                  record.evidenceCount === 0 && !isClosed ? (
                    <Badge tone="gold" icon={<IconCamera className="h-3.5 w-3.5" />}>
                      +10 points
                    </Badge>
                  ) : undefined
                }
              />
              <div className="mt-5">
                <EvidenceUploader caseId={caseId} canUpload={!isClosed} onUploaded={load} />
              </div>
            </Card>
          ) : null}

          {panel === 'history' ? (
            <Card className="p-5 sm:p-6">
              <SectionHeading title="History" description="Every step, with dates you can quote to the authority." />
              <div className="mt-5">
                <CaseTimeline events={timeline} />
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Five-milestone progress strip. Orientation at a glance. */
function ProgressRail({ stage, closedWithoutFix }: { stage: number; closedWithoutFix: boolean }) {
  return (
    <ol className="flex items-center gap-1.5 overflow-x-auto no-scrollbar" aria-label="Case progress">
      {PROGRESS_STAGES.map((label, index) => {
        const done = index < stage;
        const current = index === stage;
        const isFinal = index === PROGRESS_STAGES.length - 1;
        const tone = isFinal && closedWithoutFix ? 'bg-ink-faint' : done || current ? 'bg-accent' : 'bg-line';

        return (
          <li key={label} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span aria-hidden="true" className={`h-1.5 rounded-full transition-colors duration-500 ${tone}`} />
            <span
              aria-current={current ? 'step' : undefined}
              className={`truncate text-[11px] font-medium ${
                done || current ? 'text-ink-soft' : 'text-ink-faint'
              }`}
            >
              {isFinal && closedWithoutFix ? 'Closed' : label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Fact({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-soft p-3.5">
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5 text-sm font-medium leading-snug text-ink">{children}</dd>
    </div>
  );
}

/**
 * What CivicSOS did, and what it will do next.
 *
 * The centrepiece of the case screen: the citizen should be able to see, at a
 * glance, that work is being done on their behalf and exactly what the next
 * action is. Every action here is gated by the server — the buttons reflect a
 * decision the policy layer has already made.
 */
function AgentPanel({
  detail,
  busy,
  run,
  onSubmit,
  onPrepareFollowUp,
  onSendFollowUp,
  onDismissRun,
}: {
  detail: CaseDetailResponse;
  busy: boolean;
  run?: AgentRunResponse;
  onSubmit: () => void;
  onPrepareFollowUp: () => void;
  onSendFollowUp: () => void;
  onDismissRun: () => void;
}) {
  const { case: record, phase, escalation } = detail;
  const simulated = record.submissionMode === 'SIMULATED';

  const did = record.submittedAt
    ? simulated
      ? `CivicSOS submitted your complaint and captured reference ${record.officialReference}.`
      : `You submitted this${record.officialReference ? `, reference ${record.officialReference}` : ''}.`
    : 'CivicSOS worked out the route, checked your evidence and prepared the complaint.';

  const next: Record<CasePhase, string> = {
    PREPARING: 'Fill in the remaining blanks, then approve it and CivicSOS will submit it.',
    AWAITING_APPROVAL: 'Approve it and CivicSOS will submit it for you.',
    SUBMITTED: `We will check for a response around ${formatDate(record.followUpAt)}.`,
    MONITORING: `We will check again around ${formatDate(record.followUpAt)}.`,
    FOLLOW_UP_READY: 'No response in the expected window. We have prepared the next step.',
    ESCALATION_READY: `Escalation step ${escalation.availableLevel} is now appropriate.`,
    RESOLVED: 'Nothing further needed. The history stays here if it comes back.',
    CLOSED: 'Closed without a resolution. You can still escalate later.',
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-accent-soft/40 px-5 py-3.5 sm:px-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <IconSparkle aria-hidden="true" className="h-[18px] w-[18px] text-accent" />
          CivicSOS Agent
        </p>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-surface-soft p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">What CivicSOS did</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{did}</p>
          </div>
          <div className="rounded-xl bg-surface-soft p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">What happens next</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{next[phase]}</p>
          </div>
        </div>

        {simulated ? <SimulationNotice /> : null}

        {/* Follow-up found something. Lead with the finding, not the button. */}
        {(phase === 'FOLLOW_UP_READY' || phase === 'ESCALATION_READY') && !run ? (
          <Alert tone="warn" title="CivicSOS found something">
            <p>We haven&apos;t received a response within the expected window.</p>
            <Button
              size="sm"
              className="mt-3"
              loading={busy}
              onClick={onPrepareFollowUp}
              icon={<IconSparkle className="h-4 w-4" />}
            >
              Prepare the next step
            </Button>
          </Alert>
        ) : null}

        {phase === 'AWAITING_APPROVAL' ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" loading={busy} onClick={onSubmit} icon={<IconSend className="h-4 w-4" />}>
              Approve &amp; submit
            </Button>
            <span className="text-xs text-ink-muted">CivicSOS will not submit anything until you approve.</span>
          </div>
        ) : null}

        {run ? (
          <div className="space-y-3">
            <AgentExecution
              steps={run.steps}
              running={busy}
              title={run.completed ? 'Here is what CivicSOS did' : 'Here is what CivicSOS prepared'}
              subtitle={
                run.completed ? 'Every step below actually ran.' : 'Nothing has been sent. Read it, then decide.'
              }
            />

            {run.draft && !run.completed ? (
              <div className="rounded-2xl border border-line bg-surface-soft p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Follow-up message</p>
                <pre className="letter mt-2 max-h-64 overflow-y-auto text-[13px] leading-relaxed text-ink-soft">
                  {run.draft}
                </pre>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" loading={busy} onClick={onSendFollowUp}>
                    Approve follow-up
                  </Button>
                  <Button size="sm" variant="secondary" onClick={onDismissRun}>
                    Not yet
                  </Button>
                </div>
              </div>
            ) : null}

            {run.completed ? (
              <Button size="sm" variant="ghost" onClick={onDismissRun}>
                Dismiss
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function ActionBar({
  detail,
  busy,
  canMarkSubmitted,
  onSubmitted,
  onFollowUp,
  onEscalate,
  onResolve,
}: {
  detail: CaseDetailResponse;
  busy?: string;
  canMarkSubmitted: boolean;
  onSubmitted: (reference: string, channel: string) => void;
  onFollowUp: (note: string) => void;
  onEscalate: () => void;
  onResolve: (note: string, outcome: 'FIXED' | 'CLOSED_WITHOUT_FIX') => void;
}) {
  const { case: record, escalation, nextEscalationStep } = detail;
  const [open, setOpen] = useState<'submitted' | 'followup' | 'resolve' | undefined>();
  const [reference, setReference] = useState('');
  const [channel, setChannel] = useState('');
  const [note, setNote] = useState('');

  const isClosed = record.status === 'RESOLVED' || record.status === 'CLOSED_UNRESOLVED';

  if (isClosed) {
    return (
      <Alert
        tone={record.status === 'RESOLVED' ? 'good' : 'neutral'}
        title={record.status === 'RESOLVED' ? 'This case is resolved' : 'This case is closed'}
        icon={<IconCheck className="h-[18px] w-[18px]" />}
      >
        <p>{record.resolutionNote || 'The full history below stays available if the problem comes back.'}</p>
        <p className="mt-1 text-xs text-ink-muted">Closed on {formatDateTime(record.resolvedAt)}.</p>
      </Alert>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading
        title="Update this case"
        description="Keep the record accurate — your follow-up dates depend on it."
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {canMarkSubmitted ? (
          <Button
            size="sm"
            icon={<IconSend className="h-4 w-4" />}
            onClick={() => setOpen(open === 'submitted' ? undefined : 'submitted')}
          >
            I submitted it officially
          </Button>
        ) : null}
        {record.submittedAt ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'followup'}
            icon={<IconClock className="h-4 w-4" />}
            onClick={() => setOpen(open === 'followup' ? undefined : 'followup')}
          >
            Log a follow-up
          </Button>
        ) : null}
        {escalation.availableLevel > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'escalate'}
            icon={<IconEscalate className="h-4 w-4" />}
            onClick={onEscalate}
          >
            Escalate to step {escalation.availableLevel}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setOpen(open === 'resolve' ? undefined : 'resolve')}>
          Close this case
        </Button>
      </div>

      {/* Explain why escalation is not offered yet, rather than hiding it. */}
      {escalation.availableLevel === 0 && record.submittedAt ? (
        <p className="mt-3.5 text-xs leading-relaxed text-ink-muted">
          {escalation.reason}
          {nextEscalationStep ? ` Next step would be: ${nextEscalationStep.title}.` : ''}
        </p>
      ) : null}
      {!record.submittedAt ? (
        <p className="mt-3.5 text-xs leading-relaxed text-ink-muted">
          Follow-ups and escalation start once you record the case as submitted, because every deadline is measured
          from the date you filed it.
        </p>
      ) : null}

      {open === 'submitted' ? (
        <div className="rise mt-5 space-y-4 rounded-xl border border-line bg-surface-soft p-4">
          <p className="text-sm text-ink-soft">
            Record it here after you have submitted through the official channel. CivicSOS never files on your behalf.
          </p>
          <Field label="Complaint or reference number" htmlFor="reference" hint="Everything later depends on this.">
            <Input id="reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} />
          </Field>
          <Field label="Where did you submit it?" htmlFor="channel" hint="E.g. the Swachhata app, or the city portal.">
            <Input id="channel" value={channel} onChange={(event) => setChannel(event.target.value)} maxLength={120} />
          </Field>
          <Button size="sm" loading={busy === 'submitted'} onClick={() => onSubmitted(reference.trim(), channel.trim())}>
            Save
          </Button>
        </div>
      ) : null}

      {open === 'followup' ? (
        <div className="rise mt-5 space-y-4 rounded-xl border border-line bg-surface-soft p-4">
          <Field label="What happened?" htmlFor="followup-note" hint="E.g. called the helpline, told it is in process.">
            <Textarea
              id="followup-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </Field>
          <Button size="sm" loading={busy === 'followup'} onClick={() => onFollowUp(note.trim())}>
            Log it
          </Button>
        </div>
      ) : null}

      {open === 'resolve' ? (
        <div className="rise mt-5 space-y-4 rounded-xl border border-line bg-surface-soft p-4">
          <Field label="Anything to note?" htmlFor="resolve-note" hint="Optional. Useful if the problem returns.">
            <Textarea
              id="resolve-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              loading={busy === 'resolve'}
              icon={<IconCheck className="h-4 w-4" />}
              onClick={() => onResolve(note.trim(), 'FIXED')}
            >
              The problem is fixed
            </Button>
            <Badge tone="gold">+100 points</Badge>
            <Button
              size="sm"
              variant="danger"
              loading={busy === 'resolve'}
              onClick={() => onResolve(note.trim(), 'CLOSED_WITHOUT_FIX')}
            >
              Close without a fix
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ComplaintPanel({ detail, onSaved }: { detail: CaseDetailResponse; onSaved: () => Promise<void> }) {
  const api = useApi();
  const { case: record } = detail;
  const [subject, setSubject] = useState(record.complaint.subject);
  const [body, setBody] = useState(record.complaint.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const isClosed = record.status === 'RESOLVED' || record.status === 'CLOSED_UNRESOLVED';
  const dirty = subject !== record.complaint.subject || body !== record.complaint.body;

  const save = useCallback(async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api(`/cases/${record.caseId}`, { method: 'PATCH', body: { complaint: { subject, body } } });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not save that.');
    } finally {
      setSaving(false);
    }
  }, [api, body, onSaved, record.caseId, subject]);

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading
        title="Your complaint"
        description="Edit it freely. Copy it into the official channel when you are happy with it."
      />

      {error ? (
        <Alert tone="bad" className="mt-4" title="We could not save that">
          {error}
        </Alert>
      ) : null}

      <div className="mt-5 space-y-4">
        <Field label="Subject" htmlFor="case-subject">
          <Input
            id="case-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={200}
            disabled={isClosed}
          />
        </Field>
        <Field label="Complaint" htmlFor="case-body">
          <Textarea
            id="case-body"
            className="letter min-h-[24rem] font-mono text-[13px] leading-relaxed"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={6000}
            disabled={isClosed}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <CopyButton text={`${subject}\n\n${body}`} />
          {!isClosed ? (
            <Button variant="secondary" loading={saving} disabled={!dirty} onClick={save}>
              {saved ? 'Saved' : 'Save changes'}
            </Button>
          ) : null}
          <span role="status" aria-live="polite" className="text-xs text-ink-muted">
            {dirty && !saving ? 'You have unsaved changes.' : ''}
          </span>
        </div>
      </div>
    </Card>
  );
}

function CaseDetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading this case</span>
      <Skeleton className="h-4 w-24" />
      <div className="space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}
