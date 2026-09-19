'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { useApi, useAuth } from '@/lib/auth';
import { URGENCY_LABEL, URGENCY_TONE, formatDate, placeholderLabel } from '@/lib/format';
import { notifyProfileChanged } from '@/lib/profile-events';
import type {
  AgentRunResponse,
  AnalyzeResponse,
  CaseRecord,
  CategoryId,
  CreateCaseResponse,
  KnowledgeResponse,
  LocationInput,
} from '@/lib/types';
import { AgentExecution, SimulationNotice } from './AgentExecution';
import { SubmissionChoice } from './SubmissionChoice';
import { PhotoPicker, type PickedPhoto } from './PhotoPicker';
import { uploadEvidenceBatch } from '@/lib/evidence-upload';
import { PlanView } from './PlanView';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  PointsPill,
  SectionHeading,
  Skeleton,
  Spinner,
  Textarea,
} from './ui';
import {
  CategoryIcon,
  IconArrowLeft,
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconLocation,
  IconSend,
  IconShield,
  IconSparkle,
} from './icons';

/**
 * The report flow: describe → understand → review → tracked.
 *
 * Progressive by design. The first screen asks for exactly one thing, because a
 * long form is the fastest way to lose someone who is already frustrated.
 * Location, category and the rest of the complaint details are collected only
 * when they are actually needed, and only when CivicSOS could not work them out.
 *
 * The draft is mirrored into `sessionStorage`, so an accidental refresh
 * mid-flow does not discard what was typed.
 */

type Step = 'describe' | 'plan' | 'agent' | 'created';

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

const EMPTY_DRAFT: Draft = { description: '', location: {}, name: '', contact: '', sinceWhen: '' };

const EXAMPLES = [
  'There has been garbage outside my apartment for 4 days and it smells terrible.',
  'The street light on our lane has not worked for three weeks and the road is pitch dark.',
  'A large pothole has opened at the junction and two riders have already skidded on it.',
];

function readDraft(): Draft {
  if (typeof window === 'undefined') return EMPTY_DRAFT;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function ReportFlow({ initialCategory }: { initialCategory?: CategoryId }) {
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();

  const [step, setStep] = useState<Step>('describe');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [knowledge, setKnowledge] = useState<KnowledgeResponse | undefined>();
  const [analysis, setAnalysis] = useState<AnalyzeResponse | undefined>();
  const [complaintSubject, setComplaintSubject] = useState('');
  const [complaintBody, setComplaintBody] = useState('');
  const [created, setCreated] = useState<CreateCaseResponse | undefined>();
  /**
   * Photos chosen before the case exists. Held in memory and replayed through
   * the existing evidence API once creation succeeds — no new endpoint.
   */
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [agentRun, setAgentRun] = useState<AgentRunResponse | undefined>();
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentRevealed, setAgentRevealed] = useState(false);
  const [photoUpload, setPhotoUpload] = useState<
    { state: 'idle' } | { state: 'uploading'; done: number; total: number } | { state: 'done'; uploaded: number; failed: number; error?: string }
  >({ state: 'idle' });

  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [locating, setLocating] = useState(false);
  const [touched, setTouched] = useState(false);

  // Restore after mount so server and client render identical markup.
  useEffect(() => {
    const restored = readDraft();
    setDraft(initialCategory ? { ...restored, categoryId: initialCategory } : restored);
  }, [initialCategory]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // A full or unavailable sessionStorage is not worth interrupting anyone over.
    }
  }, [draft]);

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

  const tooShort = draft.description.trim().length < MIN_DESCRIPTION;

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
      if (tooShort) return;

      setAnalyzing(true);
      setError(undefined);
      try {
        const result = await api<AnalyzeResponse>('/cases/analyze', {
          method: 'POST',
          body: {
            description: draft.description.trim(),
            location: hasLocation(draft.location) ? draft.location : undefined,
            categoryId: categoryOverride ?? draft.categoryId,
            // Lets the plan's evidence checklist reflect what is already in hand.
            hasPhoto: photos.length > 0,
          },
        });
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
    [api, draft, photos.length, tooShort, update],
  );

  const createCase = useCallback(async () => {
    if (!analysis) return;
    setCreating(true);
    setError(undefined);
    try {
      const result = await api<CreateCaseResponse>('/cases', {
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
      setCreated(result);
      if (result.pointsAwarded > 0) notifyProfileChanged();
      setStep('agent');
      window.sessionStorage.removeItem(DRAFT_KEY);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Photos go up first, so the agent's evidence check sees them. A failure
      // here never invalidates the case — it is reported on the confirmation
      // screen with a pointer to the case's Evidence tab.
      if (photos.length > 0 && result.created) {
        setPhotoUpload({ state: 'uploading', done: 0, total: photos.length });
        const outcome = await uploadEvidenceBatch(
          api,
          result.case.caseId,
          photos.map((photo) => photo.file),
          (done, total) => setPhotoUpload({ state: 'uploading', done, total }),
        );
        setPhotoUpload({ state: 'done', uploaded: outcome.uploaded, failed: outcome.failed, error: outcome.firstError });
        if (outcome.uploaded > 0) notifyProfileChanged();
      }

      // The case exists and the complaint is approved. How it goes out is the
      // citizen's choice — a simulation they can watch, or the real official
      // channel — so the flow stops here rather than picking for them.
      setAgentRunning(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Something went wrong.'));
    } finally {
      setCreating(false);
    }
  }, [analysis, api, complaintBody, complaintSubject, draft, photos]);

  const restart = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setAnalysis(undefined);
    setCreated(undefined);
    setPhotos([]);
    setPhotoUpload({ state: 'idle' });
    setAgentRun(undefined);
    setAgentRunning(false);
    setAgentRevealed(false);
    setTouched(false);
    setStep('describe');
    window.scrollTo({ top: 0 });
  }, []);

  if (step === 'agent' && created) {
    return (
      <AgentStep
        caseId={created.case.caseId}
        running={agentRunning}
        run={agentRun}
        error={error}
        onRevealed={() => setAgentRevealed(true)}
        revealed={agentRevealed}
        onRunDemo={async () => {
          setAgentRunning(true);
          setError(undefined);
          try {
            const run = await api<AgentRunResponse>(`/cases/${created.case.caseId}/agent/submit`, {
              method: 'POST',
              body: { approve: true },
            });
            setAgentRun(run);
          } catch (caught) {
            // A failed run leaves a perfectly good case behind.
            setError(
              caught instanceof Error
                ? caught
                : new Error('CivicSOS could not complete the submission. Your case is saved.'),
            );
          } finally {
            setAgentRunning(false);
          }
        }}
        onContinue={() => {
          setStep('created');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (step === 'created' && created) {
    return (
      <CreatedStep
        result={created}
        run={agentRun}
        onReportAnother={restart}
        photoUpload={photoUpload}
        error={error}
      />
    );
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
    <div className="mx-auto max-w-2xl space-y-7">
      <StepRail current={1} />

      <div className="space-y-2.5 text-center">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">
          Tell us what happened.
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          No complicated forms. Just describe the problem.
        </p>
      </div>

      <Card className="p-5 sm:p-7">
        <div className="space-y-6">
          <Field
            label="What happened?"
            hint="One or two sentences is enough. No forms yet."
            htmlFor="description"
            required
            error={touched && tooShort ? 'Please add a little more — at least a sentence.' : undefined}
            labelAside={
              <span className="text-xs tabular-nums text-ink-faint">{draft.description.length}/4000</span>
            }
          >
            <Textarea
              id="description"
              rows={5}
              value={draft.description}
              invalid={touched && tooShort}
              onChange={(event) => update('description', event.target.value)}
              placeholder="Garbage has not been collected outside my apartment for 5 days."
              maxLength={4000}
              autoComplete="off"
            />
          </Field>

          <div>
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Or start from an example</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => update('description', example)}
                  className="rounded-full border border-line-strong px-3 py-1.5 text-left text-xs text-ink-soft transition-colors duration-150 hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink"
                >
                  {example.slice(0, 42)}…
                </button>
              ))}
            </div>
          </div>

          {/* Category is optional — the classifier usually gets it right. */}
          {knowledge ? (
            <div>
              <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
                Category <span className="font-normal normal-case text-ink-faint">(optional — we can work it out)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {knowledge.categories.map((category) => {
                  const selected = draft.categoryId === category.categoryId;
                  return (
                    <button
                      key={category.categoryId}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        update('categoryId', selected ? undefined : (category.categoryId as CategoryId))
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                        selected
                          ? 'border-accent bg-accent text-white'
                          : 'border-line-strong bg-surface text-ink-soft hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink'
                      }`}
                    >
                      <CategoryIcon categoryId={category.categoryId} className="h-3.5 w-3.5" />
                      {category.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Photos: first-class, not hidden behind a disclosure. A photo is
              the single most useful thing a citizen can attach. */}
          <div>
            <p className="mb-2.5 flex items-center gap-2 text-sm font-medium text-ink">
              <IconCamera className="h-4 w-4 text-ink-faint" />
              Add photos
              <span className="text-xs font-normal text-ink-faint">(optional)</span>
            </p>
            <PhotoPicker photos={photos} onChange={setPhotos} disabled={analyzing || creating} />
          </div>

          <details className="group rounded-2xl border border-line bg-surface-soft p-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-soft">
              <IconLocation className="h-4 w-4 text-ink-faint" />
              Where is this happening?
              <span className="ml-auto text-xs font-normal text-ink-faint">Optional</span>
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
              <div className="sm:col-span-2 space-y-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={locating}
                  onClick={useMyLocation}
                  icon={<IconLocation className="h-4 w-4" />}
                >
                  Use my current location
                </Button>
                {draft.location.lat !== undefined ? (
                  <p className="text-xs text-ink-muted">
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
                <ButtonLink href="/signin?next=/report" size="sm">
                  Sign in or create an account
                </ButtonLink>
                <ButtonLink href="/signin?demo=1" size="sm" variant="secondary">
                  Try the demo instead
                </ButtonLink>
              </div>
            </Alert>
          ) : (
            <Button
              size="xl"
              full
              loading={analyzing}
              onClick={() => analyze()}
              disabled={sessionLoading}
              trailingIcon={analyzing ? undefined : <IconArrowRight className="h-[18px] w-[18px]" />}
            >
              {analyzing ? 'Understanding what happened…' : 'Let CivicSOS handle it'}
            </Button>
          )}

          <p className="flex items-center justify-center gap-2 text-center text-xs text-ink-muted">
            <IconShield className="h-4 w-4 shrink-0 text-teal" />
            We strip phone numbers, emails and ID numbers before any AI sees your text.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Steps                                                              */
/* ------------------------------------------------------------------ */

/** Three-step progress rail. Orientation, not decoration. */
function StepRail({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = ['Describe', 'Approve', 'We submit', 'Track it'];
  return (
    <ol className="flex items-center justify-center gap-2 text-xs font-medium" aria-label="Progress">
      {steps.map((label, index) => {
        const position = index + 1;
        const done = position < current;
        const active = position === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
                active
                  ? 'bg-accent text-white'
                  : done
                    ? 'bg-good-soft text-good ring-1 ring-inset ring-good-line'
                    : 'bg-surface-sunken text-ink-faint'
              }`}
            >
              {done ? <IconCheck className="h-3.5 w-3.5" /> : <span className="tabular-nums">{position}</span>}
              <span className="hidden sm:inline">{label}</span>
            </span>
            {position < steps.length ? <span aria-hidden="true" className="h-px w-4 bg-line-strong sm:w-8" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

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
  const location = [draft.location.locality, draft.location.city].filter(Boolean).join(', ');
  const canFill = Boolean(draft.name || draft.contact || draft.sinceWhen || location);

  return (
    <div className="space-y-6">
      <StepRail current={2} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">
            Here&apos;s what I understood
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            Check this over. Once you approve, CivicSOS handles the submission.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack} icon={<IconArrowLeft className="h-4 w-4" />}>
          Edit what I wrote
        </Button>
      </div>

      {/* Honest about where the understanding came from. */}
      {meta.usedFallback ? (
        <Alert tone="warn" title="Our AI assistant is unavailable right now">
          We worked this out with CivicSOS&apos;s own rules instead. The plan below is complete and usable — the
          wording is just a little more generic than usual.
        </Alert>
      ) : null}

      {/* Summary strip: the four things someone checks first. */}
      <Card className="overflow-hidden">
        <div className="grid divide-y divide-line sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <SummaryCell label="Problem" value={result.summary} wide />
          <SummaryCell
            label="Category"
            value={
              <span className="inline-flex items-center gap-1.5">
                <CategoryIcon categoryId={result.categoryId} className="h-4 w-4 text-accent" />
                {result.categoryLabel}
              </span>
            }
          />
          <SummaryCell label="Location" value={location || 'Not specified'} />
          <SummaryCell
            label="Priority"
            value={<Badge tone={URGENCY_TONE[result.urgency]}>{URGENCY_LABEL[result.urgency]}</Badge>}
          />
        </div>
      </Card>

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
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                  category.categoryId === result.categoryId
                    ? 'border-accent bg-accent text-white'
                    : 'border-line-strong bg-surface text-ink-soft hover:border-accent-line hover:text-accent-ink'
                }`}
              >
                <CategoryIcon categoryId={category.categoryId} className="h-3.5 w-3.5" />
                {category.label}
              </button>
            ))}
          </div>
        </Alert>
      ) : null}

      <div>
        <h2 className="mb-4 text-lg font-semibold tracking-tight text-ink">What happens next</h2>
        <PlanView plan={result.plan} />
      </div>

      {remaining.length > 0 || result.missingInformation.length > 0 ? (
        <Card className="p-5 sm:p-6">
          <SectionHeading
            title="One thing is missing"
            description="Fill these in and CivicSOS can submit it for you."
          />
          <ul className="mt-3.5 space-y-2">
            {result.missingInformation.map((item, index) => (
              <li key={index} className="flex gap-2.5 text-sm text-ink-muted">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
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
            {/* Location lives here too: without it the complaint keeps a
                [[LOCATION]] blank that could otherwise only be fixed by
                hand-editing the letter, which is exactly the friction this
                product exists to remove. */}
            <Field label="Where is this happening?" htmlFor="fix-locality" hint="Street plus a nearby landmark.">
              <Input
                id="fix-locality"
                value={draft.location.locality ?? ''}
                onChange={(event) => onDraftChange('location', { ...draft.location, locality: event.target.value })}
                autoComplete="street-address"
                maxLength={160}
              />
            </Field>
            <Field label="City" htmlFor="fix-city">
              <Input
                id="fix-city"
                value={draft.location.city ?? ''}
                onChange={(event) => onDraftChange('location', { ...draft.location, city: event.target.value })}
                autoComplete="address-level2"
                maxLength={80}
              />
            </Field>
            <Field label="How long has it been like this?" htmlFor="fix-since" hint="A date or a rough duration.">
              <Input
                id="fix-since"
                value={draft.sinceWhen}
                onChange={(event) => onDraftChange('sinceWhen', event.target.value)}
                maxLength={120}
              />
            </Field>
          </div>

          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            disabled={!canFill}
            onClick={() => {
              const place = [draft.location.locality, draft.location.city].filter(Boolean).join(', ');
              const fill = (text: string) =>
                text
                  .replaceAll('[[YOUR_NAME]]', draft.name || '[[YOUR_NAME]]')
                  .replaceAll('[[YOUR_CONTACT]]', draft.contact || '[[YOUR_CONTACT]]')
                  .replaceAll('[[SINCE_WHEN]]', draft.sinceWhen || '[[SINCE_WHEN]]')
                  .replaceAll('[[LOCATION]]', place || '[[LOCATION]]');
              onSubjectChange(fill(complaintSubject));
              onBodyChange(fill(complaintBody));
            }}
          >
            Fill these into the complaint
          </Button>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="Your complaint is ready"
          description="Read it and change anything you like. CivicSOS sends this one."
          aside={
            result.complaint.provenance === 'AI_ASSISTED' ? (
              <Badge tone="accent" icon={<IconSparkle className="h-3.5 w-3.5" />}>
                AI-assisted draft
              </Badge>
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
              className="letter min-h-[24rem] font-mono text-[13px] leading-relaxed"
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
          {error.message}
        </Alert>
      ) : null}

      {/* Sticky commit bar: the next action is never scrolled off screen. */}
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface/95 px-4 py-4 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-ink-muted">
            {remaining.length > 0
              ? 'Fill in the blanks above before approving — CivicSOS will not submit an incomplete complaint.'
              : 'Approving lets CivicSOS submit this for you, capture the reference and keep following it up.'}
          </p>
          <Button
            size="lg"
            loading={creating}
            onClick={onCreate}
            disabled={remaining.length > 0}
            className="shrink-0"
            trailingIcon={creating ? undefined : <IconArrowRight className="h-[18px] w-[18px]" />}
          >
            Approve &amp; submit
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryCell({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`p-4 sm:p-5 ${wide ? 'sm:col-span-1' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <div className="mt-1.5 text-sm font-medium leading-relaxed text-ink">{value}</div>
    </div>
  );
}

type PhotoUploadState =
  | { state: 'idle' }
  | { state: 'uploading'; done: number; total: number }
  | { state: 'done'; uploaded: number; failed: number; error?: string };

function AgentStep({
  caseId,
  running,
  run,
  error,
  revealed,
  onRevealed,
  onRunDemo,
  onContinue,
}: {
  caseId: string;
  running: boolean;
  run?: AgentRunResponse;
  error?: Error;
  revealed: boolean;
  onRevealed: () => void;
  onRunDemo: () => void;
  onContinue: () => void;
}) {
  const steps = run?.steps ?? [];

  // Before a choice is made, offer both paths. They are genuinely different
  // things, so neither is the default.
  if (!run && !running) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <StepRail current={3} />

        <div className="space-y-2 text-center">
          <h1 className="text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">
            Your complaint is ready
          </h1>
          <p className="text-[15px] text-ink-muted">How would you like it submitted?</p>
        </div>

        {error ? (
          <Alert tone="bad" title="That did not work">
            {error.message}
          </Alert>
        ) : null}

        <SubmissionChoice caseId={caseId} onDemo={onRunDemo} demoBusy={running} />

        <p className="text-center">
          <Button variant="ghost" size="sm" onClick={onContinue}>
            Skip for now — just track the case
          </Button>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <StepRail current={3} />

      <AgentExecution steps={steps} running={running || steps.length === 0} onRevealed={onRevealed} />

      {error ? (
        <Alert tone="bad" title="CivicSOS could not finish the submission">
          <p>{error.message}</p>
          <p className="mt-1.5">
            Your case is saved. Open it and use the official channel listed there to submit it yourself.
          </p>
          <Button size="sm" className="mt-3" onClick={onContinue}>
            Continue
          </Button>
        </Alert>
      ) : null}

      {/* The continue action only appears once the citizen has actually seen
          what the agent did — the point of this screen is the visibility. */}
      {!running && revealed && run ? (
        <div className="rise space-y-4">
          <SimulationNotice />
          <Button
            size="lg"
            full
            onClick={onContinue}
            trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}
          >
            See the result
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CreatedStep({
  result,
  run,
  onReportAnother,
  photoUpload,
  error,
}: {
  result: CreateCaseResponse;
  run?: AgentRunResponse;
  onReportAnother: () => void;
  photoUpload: PhotoUploadState;
  error?: Error;
}) {
  // The agent's copy of the case is newer than the one creation returned.
  const record: CaseRecord = run?.case ?? result.case;
  const levelUp = result.awards.find((award) => award.levelUp)?.levelUp;
  const submitted = Boolean(run?.completed && run.reference);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <StepRail current={4} />

      <Card className="rise p-6 text-center sm:p-10">
        <div
          aria-hidden="true"
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-good-soft text-good ring-1 ring-inset ring-good-line"
        >
          <IconCheck className="h-8 w-8" />
        </div>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
          {submitted ? "You're done." : 'Your case is being tracked'}
        </h1>
        {submitted ? (
          <p className="mt-2 text-[15px] text-ink-soft">Complaint submitted successfully.</p>
        ) : null}

        {/* Points appear as a small, factual line — not a celebration. */}
        {result.pointsAwarded > 0 ? (
          <div className="mt-4 flex justify-center">
            <PointsPill points={result.pointsAwarded} size="md" />
          </div>
        ) : null}
        {levelUp ? <p className="mt-2 text-sm font-medium text-gold">You reached {levelUp}.</p> : null}

        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-muted">
          {submitted
            ? "We'll keep watching this case and tell you the moment it needs you again."
            : 'CivicSOS has recorded the case, worked out when you should follow up, and prepared the escalation path if nothing happens.'}
        </p>

        <dl className="mx-auto mt-6 grid max-w-md gap-3 text-left sm:grid-cols-2">
          <div className="rounded-xl bg-surface-soft p-3.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              {submitted ? 'Reference' : 'Case reference'}
            </dt>
            <dd className="mt-1 truncate font-mono text-sm text-ink">{run?.reference ?? record.caseId}</dd>
          </div>
          <div className="rounded-xl bg-surface-soft p-3.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              {submitted ? 'Next check' : 'Follow up around'}
            </dt>
            <dd className="mt-1 text-sm font-medium text-ink">
              {record.followUpAt ? formatDate(record.followUpAt) : '—'}
            </dd>
          </div>
        </dl>

        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <ButtonLink
            href={`/cases/${record.caseId}`}
            size="lg"
            trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}
          >
            View my case
          </ButtonLink>
          <Button size="lg" variant="secondary" onClick={onReportAnother}>
            Report something else
          </Button>
        </div>
      </Card>

      {/* Photo upload runs after creation, so its outcome is reported here
          rather than silently. A failure never invalidates the case. */}
      {photoUpload.state === 'uploading' ? (
        <Alert tone="accent" title="Uploading your photos" icon={<Spinner />}>
          <p aria-live="polite">
            {photoUpload.done} of {photoUpload.total} done. You can leave this page — the case is already saved.
          </p>
        </Alert>
      ) : null}

      {photoUpload.state === 'done' && photoUpload.uploaded > 0 && photoUpload.failed === 0 ? (
        <Alert tone="good" title="Photos attached" icon={<IconCheck className="h-[18px] w-[18px]" />}>
          {photoUpload.uploaded} photo{photoUpload.uploaded === 1 ? '' : 's'} added to your case.
        </Alert>
      ) : null}

      {photoUpload.state === 'done' && photoUpload.failed > 0 ? (
        <Alert tone="warn" title="Some photos did not upload">
          <p>
            {photoUpload.uploaded > 0 ? `${photoUpload.uploaded} uploaded, ` : ''}
            {photoUpload.failed} could not be attached. {photoUpload.error ?? ''} Your case is saved — open it and add
            them again from the Evidence tab.
          </p>
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="warn" title="Submission did not complete">
          <p>{error.message}</p>
          <p className="mt-1.5">
            Your case is saved. Open it and use the official channel listed there to submit it yourself.
          </p>
        </Alert>
      ) : null}

      {submitted ? (
        <SimulationNotice />
      ) : (
        <Alert tone="accent" title="Next step: submit it officially" icon={<IconSend className="h-[18px] w-[18px]" />}>
          Open your case and use the official channel listed there. When you get a complaint number back, record it on
          the case — every follow-up and escalation depends on it.
        </Alert>
      )}

      <p className="text-center text-sm text-ink-muted">
        <Link href="/cases" className="font-medium text-accent underline underline-offset-4 hover:text-accent-hover">
          See all my cases
        </Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bits and pieces                                                    */
/* ------------------------------------------------------------------ */

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
      <Button
        type="button"
        variant={state === 'copied' ? 'secondary' : 'secondary'}
        onClick={copy}
        icon={state === 'copied' ? <IconCheck className="h-4 w-4 text-good" /> : undefined}
      >
        {state === 'copied' ? 'Copied' : label}
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
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true">
      <Skeleton className="mx-auto h-8 w-64" />
      <Skeleton className="mx-auto h-9 w-3/4" />
      <Card className="p-7">
        <div className="space-y-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-14 w-full" />
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
 * server returns the existing case rather than creating a duplicate — and, with
 * it, refuses to award a second set of Civic Points.
 */
function draftKey(description: string): string {
  let hash = 0;
  for (let index = 0; index < description.length; index += 1) {
    hash = (hash * 31 + description.charCodeAt(index)) | 0;
  }
  return `draft-${Math.abs(hash).toString(36)}`;
}
