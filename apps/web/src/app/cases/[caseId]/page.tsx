'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApi, useAuth } from '@/lib/auth';
import { STATUS_TONE, formatDate, formatDateTime, formatRelative, placeholderLabel } from '@/lib/format';
import type { CaseDetailResponse } from '@/lib/types';
import { CaseTimeline } from '@/components/CaseTimeline';
import { EvidenceUploader } from '@/components/EvidenceUploader';
import { PlanView } from '@/components/PlanView';
import { CopyButton } from '@/components/ReportFlow';
import {
  Alert,
  Badge,
  Button,
  Card,
  DemoBadge,
  Field,
  Input,
  SectionHeading,
  Skeleton,
  Textarea,
} from '@/components/ui';

/**
 * Case detail: the tracking screen.
 *
 * Holds the whole later half of the journey — record the official submission,
 * log a follow-up, escalate when the waiting window has passed, attach
 * evidence, and close the case. Every one of those actions is gated by the
 * server's rules engine; the buttons here reflect what the server has already
 * said is possible, and a refusal comes back as a plain explanation rather than
 * a disabled button with no reason.
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
  const [busy, setBusy] = useState<string | undefined>();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace(`/signin?next=/cases/${caseId}`);
  }, [caseId, router, session, sessionLoading]);

  const load = useCallback(async () => {
    try {
      const result = await api<CaseDetailResponse>(`/cases/${caseId}`);
      setDetail(result);
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
      try {
        await api(path, { method: 'POST', body });
        await load();
        setActionNotice(successMessage);
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : 'That did not work.');
      } finally {
        setBusy(undefined);
      }
    },
    [api, load],
  );

  if (sessionLoading || loading) return <CaseDetailSkeleton />;
  if (!session) return null;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-4">
        <Alert tone={notFound ? 'neutral' : 'bad'} title={notFound ? 'We could not find that case' : 'Something went wrong'}>
          <p>{notFound ? 'It may have been removed, or it may belong to a different account.' : error.message}</p>
        </Alert>
        <Link href="/cases">
          <Button variant="secondary">Back to my cases</Button>
        </Link>
      </div>
    );
  }

  if (!detail) return null;

  const { case: record, plan, escalation, timeline, outstandingPlaceholders } = detail;
  const isClosed = record.status === 'RESOLVED' || record.status === 'CLOSED_UNRESOLVED';
  const canMarkSubmitted = !record.submittedAt && !isClosed;

  const panels: Array<{ id: Panel; label: string; count?: number }> = [
    { id: 'plan', label: 'What happens next' },
    { id: 'complaint', label: 'Complaint' },
    { id: 'evidence', label: 'Evidence', count: record.evidenceCount },
    { id: 'history', label: 'History', count: timeline.length },
  ];

  return (
    <div className="space-y-6">
      <Link href="/cases" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        <span aria-hidden="true">←</span> My cases
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[record.status]}>{STATUS_LABELS[record.status]}</Badge>
          <Badge tone="accent">{plan.categoryLabel}</Badge>
          {record.isDemo ? <DemoBadge /> : null}
        </div>
        <h1 className="text-2xl font-semibold leading-snug tracking-tight text-ink">{record.summary}</h1>
        <p className="text-sm text-ink-muted">{STATUS_HINTS[record.status]}</p>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Location">
            {[record.location.locality, record.location.city, record.location.state].filter(Boolean).join(', ') ||
              'Not specified'}
          </Fact>
          <Fact label="Created">{formatDate(record.createdAt)}</Fact>
          <Fact label={record.submittedAt ? 'Submitted' : 'Not yet submitted'}>
            {record.submittedAt ? formatDate(record.submittedAt) : '—'}
          </Fact>
          <Fact label={isClosed ? 'Closed' : 'Follow up'}>
            {isClosed
              ? formatDate(record.resolvedAt)
              : record.followUpAt
                ? `${formatRelative(record.followUpAt)} · ${formatDate(record.followUpAt)}`
                : '—'}
          </Fact>
        </dl>

        {record.officialReference ? (
          <p className="text-sm text-ink-muted">
            Official reference: <span className="font-mono font-medium text-ink">{record.officialReference}</span>
          </p>
        ) : null}
      </header>

      {actionNotice ? <Alert tone="good">{actionNotice}</Alert> : null}
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

      <ActionBar
        detail={detail}
        busy={busy}
        canMarkSubmitted={canMarkSubmitted}
        onSubmitted={(reference, channel) =>
          act('submitted', `/cases/${caseId}/submitted`, { officialReference: reference, channel }, 'Recorded as submitted.')
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

      <div>
        <div role="tablist" aria-label="Case sections" className="flex flex-wrap gap-2 border-b border-line pb-3">
          {panels.map((option) => (
            <button
              key={option.id}
              role="tab"
              id={`tab-${option.id}`}
              aria-selected={panel === option.id}
              aria-controls={`panel-${option.id}`}
              onClick={() => setPanel(option.id)}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                panel === option.id ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface-soft'
              }`}
            >
              {option.label}
              {option.count ? <span className="ml-1.5 text-xs text-ink-faint">{option.count}</span> : null}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`panel-${panel}`}
          aria-labelledby={`tab-${panel}`}
          tabIndex={-1}
          className="pt-6"
        >
          {panel === 'plan' ? (
            <PlanView
              plan={plan}
              notice={
                escalation.followUpOverdue ? (
                  <Alert tone="warn" title="This is past its follow-up date">
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-soft p-3.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{children}</dd>
    </div>
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
      <Alert tone="good" title={record.status === 'RESOLVED' ? 'This case is resolved' : 'This case is closed'}>
        <p>{record.resolutionNote || 'The full history below stays available if the problem comes back.'}</p>
        <p className="mt-1 text-xs text-ink-muted">Closed on {formatDateTime(record.resolvedAt)}.</p>
      </Alert>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading title="Update this case" description="Keep the record accurate — your follow-up dates depend on it." />

      <div className="mt-4 flex flex-wrap gap-2">
        {canMarkSubmitted ? (
          <Button size="sm" onClick={() => setOpen(open === 'submitted' ? undefined : 'submitted')}>
            I submitted it officially
          </Button>
        ) : null}
        {record.submittedAt ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'followup'}
            onClick={() => setOpen(open === 'followup' ? undefined : 'followup')}
          >
            Log a follow-up
          </Button>
        ) : null}
        {escalation.availableLevel > 0 ? (
          <Button size="sm" variant="secondary" loading={busy === 'escalate'} onClick={onEscalate}>
            Escalate to step {escalation.availableLevel}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setOpen(open === 'resolve' ? undefined : 'resolve')}>
          Close this case
        </Button>
      </div>

      {/* Explain why escalation is not offered yet, rather than hiding it silently. */}
      {escalation.availableLevel === 0 && record.submittedAt ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {escalation.reason}
          {nextEscalationStep ? ` Next step would be: ${nextEscalationStep.title}.` : ''}
        </p>
      ) : null}
      {!record.submittedAt ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Follow-ups and escalation start once you record the case as submitted, because every deadline is measured
          from the date you filed it.
        </p>
      ) : null}

      {open === 'submitted' ? (
        <div className="mt-5 space-y-4 rounded-xl border border-line bg-surface-soft p-4">
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
        <div className="mt-5 space-y-4 rounded-xl border border-line bg-surface-soft p-4">
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
        <div className="mt-5 space-y-4 rounded-xl border border-line bg-surface-soft p-4">
          <Field label="Anything to note?" htmlFor="resolve-note" hint="Optional. Useful if the problem returns.">
            <Textarea
              id="resolve-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy === 'resolve'} onClick={() => onResolve(note.trim(), 'FIXED')}>
              The problem is fixed
            </Button>
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
            className="letter min-h-[26rem] font-mono text-[13px] leading-relaxed"
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
              {saved ? '✓ Saved' : 'Save changes'}
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
      <Skeleton className="h-8 w-3/4" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
