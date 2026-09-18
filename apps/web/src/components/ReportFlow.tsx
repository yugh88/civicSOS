'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { useApi, useAuth } from '@/lib/auth';
import { APP_TAGLINE } from '@/lib/config';
import { placeholderLabel } from '@/lib/format';
import type {
  AnalyzeResponse,
  CaseRecord,
  CategoryId,
  KnowledgeResponse,
  LocationInput,
} from '@/lib/types';
import { PlanView } from './PlanView';
import { Alert, Badge, Button, Card, Field, Input, SectionHeading, Skeleton, Textarea } from './ui';

/**
 * The report flow: describe → understand → review → track.
 *
 * Progressive by design. The first screen asks for one thing — what happened —
 * because a long form is the fastest way to lose someone who is already
 * frustrated. Location, category and the remaining complaint details are
 * collected only once they are actually needed, and only when CivicSOS could
 * not work them out itself.
 *
 * The draft is mirrored into `sessionStorage` so an accidental refresh in the
 * middle of the flow does not throw away what the person typed.
 */

type Step = 'describe' | 'plan' | 'created';

const DRAFT_KEY = 'civicsos.draft';
const MIN_DESCRIPTION = 12;

interface Draft {
  description: string;
  location: LocationInput;
  categoryId?: CategoryId;
  name: string;
  contact: string;
  sinceWhen: string;
}

const EMPTY_DRAFT: Draft = {
  description: '',
  location: {},
  name: '',
  contact: '',
  sinceWhen: '',
};

const EXAMPLES = [
  'There has been garbage outside my apartment for 4 days and it smells terrible.',
  'The street light on our lane has not worked for three weeks and the road is pitch dark.',
  'A large pothole has opened at the junction and two riders have already skidded on it.',
];

function readDraft(): Draft {
  if (typeof window === 'undefined') return EMPTY_DRAFT;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function ReportFlow() {
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [step, setStep] = useState<Step>('describe');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [knowledge, setKnowledge] = useState<KnowledgeResponse | undefined>();
  const [analysis, setAnalysis] = useState<AnalyzeResponse | undefined>();
  const [complaintBody, setComplaintBody] = useState('');
  const [complaintSubject, setComplaintSubject] = useState('');
  const [createdCase, setCreatedCase] = useState<CaseRecord | undefined>();

  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ApiError | Error | undefined>();
  const [locating, setLocating] = useState(false);
  const [touched, setTouched] = useState(false);

  // Restore the draft after mount, so server and client render the same markup.
  useEffect(() => setDraft(readDraft()), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // A full or unavailable sessionStorage is not worth interrupting anyone over.
    }
  }, [draft]);

  // The category catalogue is public, so it loads without a session.
  useEffect(() => {
    let cancelled = false;
    apiFetch<KnowledgeResponse>('/knowledge/categories')
      .then((result) => {
        if (!cancelled) setKnowledge(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const descriptionTooShort = draft.description.trim().length < MIN_DESCRIPTION;

  const useMyLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError(new Error('Your browser cannot share a location. Please type the area instead.'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        // Coordinates are coarsened again server-side; we never store a
        // citizen's precise doorstep.
        setDraft((current) => ({
          ...current,
          location: {
            ...current.location,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            source: 'BROWSER',
          },
        }));
      },
      () => {
        setLocating(false);
        setError(new Error("We couldn't get your location. Please type the area instead."));
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const analyze = useCallback(
    async (categoryOverride?: CategoryId) => {
      setTouched(true);
      if (descriptionTooShort) return;

      setAnalyzing(true);
      setError(undefined);
      try {
        const payload = {
          description: draft.description.trim(),
          location: hasLocation(draft.location) ? draft.location : undefined,
          categoryId: categoryOverride ?? draft.categoryId,
          hasPhoto: false,
        };
        const result = await api<AnalyzeResponse>('/cases/analyze', { method: 'POST', body: payload });
        setAnalysis(result);
        setComplaintSubject(result.analysis.complaint.subject);
        setComplaintBody(result.analysis.complaint.body);
        if (categoryOverride) update('categoryId', categoryOverride);
        setStep('plan');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error('Something went wrong.'));
      } finally {
        setAnalyzing(false);
      }
    },
    [api, descriptionTooShort, draft, update],
  );

  const createCase = useCallback(async () => {
    if (!analysis) return;
    setCreating(true);
    setError(undefined);
    try {
      const result = await api<{ case: CaseRecord; created: boolean }>('/cases', {
        method: 'POST',
        body: {
          description: draft.description.trim(),
          summary: analysis.analysis.summary,
          categoryId: analysis.analysis.categoryId,
          location: hasLocation(draft.location) ? draft.location : { locality: 'Not specified' },
          complaint: { subject: complaintSubject, body: complaintBody },
          facts: {
            sinceWhen: draft.sinceWhen || undefined,
            reporterName: draft.name || undefined,
            reporterContact: draft.contact || undefined,
          },
          // Makes a double-tapped button safe: the server returns the same case.
          idempotencyKey: draftKey(draft.description),
        },
      });
      setCreatedCase(result.case);
      setStep('created');
      window.sessionStorage.removeItem(DRAFT_KEY);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Something went wrong.'));
    } finally {
      setCreating(false);
    }
  }, [analysis, api, complaintBody, complaintSubject, draft]);

  /* ---------------------------------------------------------------- */

  if (step === 'created' && createdCase) {
    return <CreatedStep record={createdCase} onReportAnother={() => resetFlow(setStep, setDraft, setAnalysis)} />;
  }

  if (step === 'plan' && analysis) {
    return (
      <PlanStep
        analysis={analysis}
        complaintSubject={complaintSubject}
        complaintBody={complaintBody}
        onSubjectChange={setComplaintSubject}
        onBodyChange={setComplaintBody}
        onBack={() => setStep('describe')}
        onCreate={createCase}
        onChangeCategory={(categoryId) => analyze(categoryId)}
        categories={knowledge?.categories ?? []}
        creating={creating}
        reanalyzing={analyzing}
        error={error}
        draft={draft}
        onDraftChange={update}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">What problem are you facing?</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-muted">{APP_TAGLINE}</p>
      </div>

      <Card className="p-5 sm:p-6">
        <div className="space-y-5">
          <Field
            label="Tell us what happened, in your own words"
            hint="No forms yet. One or two sentences is enough to get started."
            htmlFor="description"
            required
            error={touched && descriptionTooShort ? 'Please add a little more — at least a sentence.' : undefined}
          >
            <Textarea
              id="description"
              rows={5}
              value={draft.description}
              invalid={touched && descriptionTooShort}
              onChange={(event) => update('description', event.target.value)}
              placeholder="There has been garbage outside my apartment for 4 days…"
              maxLength={4000}
              autoComplete="off"
            />
          </Field>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Or start from an example</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => update('description', example)}
                  className="rounded-full border border-line-strong px-3 py-1.5 text-left text-xs text-ink-soft transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent"
                >
                  {example.slice(0, 44)}…
                </button>
              ))}
            </div>
          </div>

          <details className="group rounded-xl border border-line bg-surface-soft p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink-soft marker:text-ink-faint">
              Add the location now (optional — we will ask if we need it)
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Area or street" htmlFor="locality" hint="A landmark helps a lot.">
                <Input
                  id="locality"
                  value={draft.location.locality ?? ''}
                  onChange={(event) => update('location', { ...draft.location, locality: event.target.value })}
                  placeholder="12th Main, near the bus stop"
                  autoComplete="street-address"
                  maxLength={160}
                />
              </Field>
              <Field label="City" htmlFor="city">
                <Input
                  id="city"
                  value={draft.location.city ?? ''}
                  onChange={(event) => update('location', { ...draft.location, city: event.target.value })}
                  placeholder="Bengaluru"
                  autoComplete="address-level2"
                  maxLength={80}
                />
              </Field>
              <div className="sm:col-span-2">
                <Button type="button" variant="secondary" size="sm" loading={locating} onClick={useMyLocation}>
                  Use my current location
                </Button>
                {draft.location.lat !== undefined ? (
                  <p className="mt-2 text-xs text-ink-muted">
                    Approximate location captured. We round it to about a kilometre and never store your exact
                    position.
                  </p>
                ) : null}
              </div>
            </div>
          </details>

          {error ? (
            <Alert tone="bad" title="We could not do that">
              <p>{error.message}</p>
              {error instanceof ApiError && error.requestId ? (
                <p className="mt-1 text-xs text-ink-muted">Reference: {error.requestId}</p>
              ) : null}
            </Alert>
          ) : null}

          {!sessionLoading && !session ? (
            <Alert tone="accent" title="You will need a session to continue">
              <p className="mb-3">
                CivicSOS keeps your cases private to you, so it needs to know who you are before it can track one.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/signin">
                  <Button size="sm">Sign in or create an account</Button>
                </Link>
                <Link href="/signin?demo=1">
                  <Button size="sm" variant="secondary">
                    Try the demo instead
                  </Button>
                </Link>
              </div>
            </Alert>
          ) : (
            <Button size="lg" full loading={analyzing} onClick={() => analyze()} disabled={sessionLoading}>
              {analyzing ? 'Working out what to do…' : 'Help me solve this'}
            </Button>
          )}

          <p className="text-center text-xs text-ink-muted">
            We strip phone numbers, emails and ID numbers before any AI sees your text.
          </p>
        </div>
      </Card>

      <HowItWorks />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Steps                                                              */
/* ------------------------------------------------------------------ */

function PlanStep({
  analysis,
  complaintSubject,
  complaintBody,
  onSubjectChange,
  onBodyChange,
  onBack,
  onCreate,
  onChangeCategory,
  categories,
  creating,
  reanalyzing,
  error,
  draft,
  onDraftChange,
}: {
  analysis: AnalyzeResponse;
  complaintSubject: string;
  complaintBody: string;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onBack: () => void;
  onCreate: () => void;
  onChangeCategory: (categoryId: CategoryId) => void;
  categories: KnowledgeResponse['categories'];
  creating: boolean;
  reanalyzing: boolean;
  error?: Error;
  draft: Draft;
  onDraftChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const { analysis: result, meta } = analysis;
  const remaining = findPlaceholders(`${complaintSubject}\n${complaintBody}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Step 2 of 3</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Here is what to do</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Edit what I wrote
        </Button>
      </div>

      {/* Honest about where the understanding came from. */}
      {meta.usedFallback ? (
        <Alert tone="warn" title="Our AI assistant is unavailable right now">
          We worked this out with CivicSOS&apos;s own rules instead. The plan below is complete and usable — the
          wording is just a little more generic than usual.
        </Alert>
      ) : null}

      {result.needsCategoryConfirmation ? (
        <Alert tone="accent" title="Is this the right category?">
          <p className="mb-3">
            We are not fully sure which department this belongs to. Picking the right one matters, because it decides
            who receives your complaint.
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category.categoryId}
                type="button"
                disabled={reanalyzing}
                onClick={() => onChangeCategory(category.categoryId as CategoryId)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                  category.categoryId === result.categoryId
                    ? 'border-accent bg-accent text-white'
                    : 'border-line-strong bg-surface text-ink-soft hover:border-accent-line hover:text-accent'
                }`}
              >
                <span aria-hidden="true" className="mr-1">
                  {category.emoji}
                </span>
                {category.label}
              </button>
            ))}
          </div>
        </Alert>
      ) : null}

      <PlanView plan={result.plan} />

      {result.missingInformation.length > 0 ? (
        <Card className="p-5 sm:p-6">
          <SectionHeading
            title="Add these details"
            description="These are the things an official would ask you for."
          />
          <ul className="mt-3 space-y-1.5">
            {result.missingInformation.map((item, index) => (
              <li key={index} className="flex gap-2 text-sm text-ink-muted">
                <span aria-hidden="true">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Your name" htmlFor="reporter-name" hint="As you want it on the complaint.">
              <Input
                id="reporter-name"
                value={draft.name}
                onChange={(event) => onDraftChange('name', event.target.value)}
                autoComplete="name"
                maxLength={120}
              />
            </Field>
            <Field label="Contact for the authority" htmlFor="reporter-contact" hint="Phone or email they can reply to.">
              <Input
                id="reporter-contact"
                value={draft.contact}
                onChange={(event) => onDraftChange('contact', event.target.value)}
                autoComplete="tel"
                maxLength={120}
              />
            </Field>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() =>
              onBodyChange(
                complaintBody
                  .replaceAll('[[YOUR_NAME]]', draft.name || '[[YOUR_NAME]]')
                  .replaceAll('[[YOUR_CONTACT]]', draft.contact || '[[YOUR_CONTACT]]'),
              )
            }
            disabled={!draft.name && !draft.contact}
          >
            Put these into the complaint
          </Button>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="Your complaint"
          description="Read it, change anything you like, then copy it into the official channel."
          aside={
            result.complaint.provenance === 'AI_ASSISTED' ? (
              <Badge tone="accent">AI-assisted draft</Badge>
            ) : (
              <Badge>Template draft</Badge>
            )
          }
        />

        {remaining.length > 0 ? (
          <Alert tone="warn" className="mt-4" title="A few blanks to fill in">
            <p>
              We have left {remaining.length === 1 ? 'one blank' : `${remaining.length} blanks`} rather than guessing:{' '}
              {remaining.map((token) => placeholderLabel(token)).join(', ')}. Look for the{' '}
              <code className="rounded bg-surface px-1 py-0.5 text-xs">[[…]]</code> markers below.
            </p>
          </Alert>
        ) : null}

        <div className="mt-5 space-y-4">
          <Field label="Subject" htmlFor="complaint-subject">
            <Input
              id="complaint-subject"
              value={complaintSubject}
              onChange={(event) => onSubjectChange(event.target.value)}
              maxLength={200}
            />
          </Field>
          <Field label="Complaint" htmlFor="complaint-body">
            <Textarea
              id="complaint-body"
              className="letter min-h-[26rem] font-mono text-[13px] leading-relaxed"
              value={complaintBody}
              onChange={(event) => onBodyChange(event.target.value)}
              maxLength={6000}
            />
          </Field>
          <CopyButton text={`${complaintSubject}\n\n${complaintBody}`} />
        </div>
      </Card>

      {error ? (
        <Alert tone="bad" title="We could not create the case">
          <p>{error.message}</p>
        </Alert>
      ) : null}

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-muted">
            Creating a case lets CivicSOS track it, remind you when to follow up, and show you how to escalate.
          </p>
          <Button size="lg" loading={creating} onClick={onCreate} className="shrink-0">
            Create my case
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreatedStep({ record, onReportAnother }: { record: CaseRecord; onReportAnother: () => void }) {
  return (
    <div className="space-y-6">
      <Card className="p-6 text-center sm:p-10">
        <div
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-2xl text-good ring-1 ring-inset ring-good-line"
        >
          ✓
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">Your case is being tracked</h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-muted">
          CivicSOS has not sent anything to any authority — that part is yours to do. What we have done is record the
          case, work out when you should follow up, and prepare the escalation path if nothing happens.
        </p>

        <dl className="mx-auto mt-6 grid max-w-md gap-3 text-left">
          <div className="rounded-xl bg-surface-soft p-3.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Case reference</dt>
            <dd className="mt-1 font-mono text-sm text-ink">{record.caseId}</dd>
          </div>
          {record.followUpAt ? (
            <div className="rounded-xl bg-surface-soft p-3.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Follow up around</dt>
              <dd className="mt-1 text-sm font-medium text-ink">
                {new Date(record.followUpAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href={`/cases/${record.caseId}`}>
            <Button size="lg">Open my case</Button>
          </Link>
          <Button size="lg" variant="secondary" onClick={onReportAnother}>
            Report something else
          </Button>
        </div>
      </Card>

      <Alert tone="accent" title="Next step: submit it officially">
        Open your case and use the official channel listed there. When you get a complaint number back, record it on
        the case — every follow-up and escalation depends on it.
      </Alert>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bits and pieces                                                    */
/* ------------------------------------------------------------------ */

function HowItWorks() {
  const steps = [
    { title: 'You describe it', detail: 'Plain words. No forms, no jargon, no department names to look up.' },
    { title: 'We work out the route', detail: 'Which body handles it, what evidence they need, what to expect.' },
    { title: 'You submit and we track', detail: 'You file it officially; we remind you when to chase it.' },
  ];

  return (
    <section aria-labelledby="how-it-works" className="space-y-4">
      <SectionHeading id="how-it-works" title="How CivicSOS works" />
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <Card key={step.title} as="li" className="p-5">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent"
            >
              {index + 1}
            </span>
            <h3 className="mt-3 text-sm font-semibold text-ink">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{step.detail}</p>
          </Card>
        ))}
      </ol>
    </section>
  );
}

export function CopyButton({ text, label = 'Copy the complaint' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    } catch {
      // Clipboard access can be denied; say so rather than failing silently.
      setState('failed');
      setTimeout(() => setState('idle'), 4000);
    }
  }, [text]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" onClick={copy}>
        {state === 'copied' ? '✓ Copied' : label}
      </Button>
      {/* Announced politely so a screen reader confirms the copy happened. */}
      <span role="status" aria-live="polite" className="text-xs text-ink-muted">
        {state === 'copied' ? 'Copied to your clipboard.' : null}
        {state === 'failed' ? 'Your browser blocked the copy — select the text and copy it manually.' : null}
      </span>
    </div>
  );
}

export function ReportFlowSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-9 w-3/4 max-w-md" />
      <Skeleton className="h-5 w-full max-w-lg" />
      <Card className="p-6">
        <div className="space-y-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </Card>
    </div>
  );
}

function hasLocation(location: LocationInput): boolean {
  return Boolean(location.locality || location.city || location.lat !== undefined);
}

function findPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\[\[([A-Z_]+)\]\]/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/**
 * Stable idempotency key derived from the description.
 *
 * Two taps on "Create my case" for the same text produce the same key, so the
 * server returns the existing case rather than creating a duplicate.
 */
function draftKey(description: string): string {
  let hash = 0;
  for (let index = 0; index < description.length; index += 1) {
    hash = (hash * 31 + description.charCodeAt(index)) | 0;
  }
  return `draft-${Math.abs(hash).toString(36)}`;
}

function resetFlow(
  setStep: (step: Step) => void,
  setDraft: (draft: Draft) => void,
  setAnalysis: (analysis: undefined) => void,
): void {
  setDraft(EMPTY_DRAFT);
  setAnalysis(undefined);
  setStep('describe');
  window.scrollTo({ top: 0 });
}
