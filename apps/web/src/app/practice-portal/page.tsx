'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SubmissionPayload } from '@/lib/types';
import { clearHandoff, HANDOFF_PARAM, readHandoff } from '@/lib/practice-handoff';

/**
 * The CivicSOS practice portal.
 *
 * A grievance form in the style of a public-sector portal — formal header,
 * left-hand dashboard navigation, dense two-column form — so the browser-assist
 * flow can be rehearsed against something that behaves like the real thing.
 *
 * It is **not** a copy of any specific government website, and deliberately so.
 * It carries CivicSOS's own name and mark, no government emblem, no department
 * wordmark, and a banner that says what it is. A page that reproduced a real
 * portal's identity would be a phishing template with a disclaimer on it, and
 * the disclaimer is the first thing anyone would delete.
 *
 * Its selectors are the contract the assistant fills against — every id here is
 * mirrored in `packages/core/src/status-check/targets.ts` and
 * `apps/extension/src/mappings.ts`, and both builds fail if one drifts.
 *
 * There is no sign-in step: the portal treats every visitor as signed in so the
 * complaint lands in the form the moment the page opens.
 *
 * What it will not do, which is the point of practising against it:
 *  - it never submits anywhere; the Submit button produces a local fake number
 *  - the assistant never touches the CAPTCHA — that sits in front of Submit,
 *    where a real portal puts it, and only the citizen can clear it
 *  - the assistant never presses Submit
 */

/** Ids the assistant fills. Changing one is a breaking change — see above. */
const FIELD_IDS = {
  category: 'complaint-category',
  subject: 'complaint-subject',
  location: 'complaint-location',
  city: 'complaint-city',
  state: 'complaint-state',
  pincode: 'complaint-pincode',
  description: 'complaint-description',
} as const;

type FieldKey = keyof typeof FIELD_IDS;

type AssistPhase = { kind: 'IDLE' } | { kind: 'FILLED'; count: number; skipped: string[] };

const NAV = [
  { label: 'Dashboard', badge: undefined },
  { label: 'Lodge a grievance', badge: undefined, active: true },
  { label: 'Track status', badge: undefined },
  { label: 'Reminders', badge: '0' },
  { label: 'Appeals', badge: '0' },
  { label: 'Feedback', badge: undefined },
] as const;

export default function PracticePortalPage() {
  return (
    <Suspense fallback={null}>
      <PracticePortal />
    </Suspense>
  );
}

function PracticePortal() {
  const params = useSearchParams();
  const handoffId = params.get(HANDOFF_PARAM) ?? undefined;

  /** Cleared by the citizen, never by CivicSOS. Gates Submit, not the form. */
  const [challengeSolved, setChallengeSolved] = useState(false);
  const [submitted, setSubmitted] = useState<string | undefined>();
  const solveChallenge = useCallback(() => setChallengeSolved(true), []);

  const [values, setValues] = useState<Record<FieldKey, string>>({
    category: '',
    subject: '',
    location: '',
    city: '',
    state: '',
    pincode: '',
    description: '',
  });

  const [payload, setPayload] = useState<SubmissionPayload | undefined>();
  const [phase, setPhase] = useState<AssistPhase>({ kind: 'IDLE' });
  const filledOnce = useRef(false);

  /** Pick the hand-off up once, on mount. */
  useEffect(() => {
    if (!handoffId) return;
    const found = readHandoff(handoffId);
    if (found) setPayload(found);
  }, [handoffId]);

  /**
   * Fills the form from the case, as soon as the hand-off arrives.
   *
   * Nothing gates this. The CAPTCHA below sits in front of Submit rather than
   * in front of the form, which is where a real portal puts it and which keeps
   * the thing CivicSOS refuses to do — solving it — clearly visible.
   */
  useEffect(() => {
    if (!payload || filledOnce.current) return;

    const next = { ...values };
    const skipped: string[] = [];
    let count = 0;

    for (const field of payload.fields) {
      const key = field.key as FieldKey;
      if (!(key in FIELD_IDS)) {
        skipped.push(field.label);
        continue;
      }
      next[key] = field.value;
      count += 1;
    }

    filledOnce.current = true;
    setValues(next);
    setPhase({ kind: 'FILLED', count, skipped });
    if (handoffId) clearHandoff(handoffId);
    // `values` is intentionally not a dependency: this runs once per hand-off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, handoffId]);

  const set = useCallback((key: FieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="-mx-4 -my-8 min-h-screen bg-[#eef1f5] sm:-mx-6 sm:-my-10">
      {/* Unmissable, above the portal chrome, and never inside a dismissible box. */}
      <div className="bg-warn-soft px-4 py-2.5 text-center sm:px-6">
        <p className="text-[13px] font-semibold text-ink">
          CivicSOS practice portal — a training environment, not a government website
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">
          Not affiliated with any government body. Nothing here is submitted anywhere and every reference is fictional.
        </p>
      </div>

      {/* Portal masthead */}
      <header className="border-b-4 border-[#1f3a63] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3.5 sm:px-6">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#1f3a63] text-sm font-bold text-white"
          >
            CS
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight text-[#1f3a63] sm:text-lg">
              CivicSOS Practice Grievance Portal
            </p>
            <p className="truncate text-[11px] leading-tight text-ink-muted sm:text-xs">
              Training environment for civic complaint workflows · Demonstration only
            </p>
          </div>
          <div className="hidden items-center gap-2 text-xs text-ink-muted sm:flex">
            <span className="rounded border border-line px-2 py-1">A- A A+</span>
            <span className="rounded border border-line px-2 py-1">English</span>
          </div>
        </div>

        <nav aria-label="Portal sections" className="bg-[#1f3a63]">
          <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 sm:px-4">
            {['Home', 'Lodge Grievance', 'Track Grievance', 'Appeal', 'Help', 'Contact'].map((item, index) => (
              <span
                key={item}
                className={`whitespace-nowrap px-3 py-2.5 text-[13px] font-medium ${
                  index === 1 ? 'bg-white/15 text-white' : 'text-white/80'
                }`}
              >
                {item}
              </span>
            ))}
          </div>
        </nav>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[240px_1fr]">
        {/* Dashboard sidebar */}
        <aside className="h-fit rounded border border-line bg-white">
          <div className="border-b border-line bg-[#f6f8fa] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Citizen dashboard</p>
            <p className="mt-1 text-sm font-semibold text-ink">Demo Visitor</p>
          </div>
          <ul className="p-2">
            {NAV.map((item) => (
              <li key={item.label}>
                <span
                  className={`flex items-center justify-between rounded px-3 py-2 text-[13px] ${
                    'active' in item && item.active
                      ? 'bg-accent-soft font-semibold text-[#1f3a63]'
                      : 'text-ink-soft'
                  }`}
                >
                  {item.label}
                  {item.badge ? <span className="text-xs text-ink-faint">{item.badge}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </aside>

        <main className="space-y-4">
          <AssistPanel phase={phase} payload={payload} />

          <section className="overflow-hidden rounded border border-line bg-white">
            <div className="border-b border-line bg-[#f6f8fa] px-5 py-3">
              <h1 className="text-[15px] font-bold text-[#1f3a63]">Lodge a Public Grievance</h1>
              <p className="mt-0.5 text-xs text-ink-muted">
                Fields marked <span className="text-bad">*</span> are mandatory.
              </p>
            </div>

            <div className="space-y-5 p-5">
              <fieldset>
                <legend className="sr-only">Grievance details</legend>

                <div className="grid gap-4 sm:grid-cols-2">
                  <PortalField
                    id={FIELD_IDS.category}
                    label="Grievance category"
                    required
                    value={values.category}
                    onChange={(v) => set('category', v)}
                  />
                  <PortalField
                    id={FIELD_IDS.subject}
                    label="Subject"
                    required
                    value={values.subject}
                    onChange={(v) => set('subject', v)}
                  />
                </div>

                <div className="mt-4">
                  <PortalField
                    id={FIELD_IDS.location}
                    label="Location / landmark"
                    required
                    value={values.location}
                    onChange={(v) => set('location', v)}
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <PortalField id={FIELD_IDS.city} label="City / district" value={values.city} onChange={(v) => set('city', v)} />
                  <PortalField id={FIELD_IDS.state} label="State" value={values.state} onChange={(v) => set('state', v)} />
                  <PortalField
                    id={FIELD_IDS.pincode}
                    label="PIN code"
                    value={values.pincode}
                    onChange={(v) => set('pincode', v)}
                  />
                </div>

                <div className="mt-4">
                  <label htmlFor={FIELD_IDS.description} className="block text-[13px] font-semibold text-ink">
                    Grievance description <span className="text-bad">*</span>
                  </label>
                  <textarea
                    id={FIELD_IDS.description}
                    name="description"
                    rows={11}
                    value={values.description}
                    onChange={(event) => set('description', event.target.value)}
                    className="mt-1.5 w-full rounded border border-line-strong bg-white px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
                  />
                </div>

                <div className="mt-4 rounded border border-dashed border-line-strong bg-[#f6f8fa] p-4">
                  <label htmlFor="portal-evidence" className="block text-[13px] font-semibold text-ink">
                    Supporting documents
                  </label>
                  <input
                    id="portal-evidence"
                    type="file"
                    multiple
                    className="mt-2 block w-full text-[13px] text-ink-muted"
                  />
                  <p className="mt-2 text-xs text-ink-muted">
                    No browser lets a script put files into this box — you attach these yourself, here as on any real
                    portal.
                  </p>
                </div>

                {/*
                  Verification, then Submit — both the citizen's, neither ever
                  CivicSOS's. Keeping them together in front of the one
                  irreversible control is where a real portal puts them, and it
                  is the clearest place to show what the assistant refuses.
                */}
                <div className="mt-5 border-t border-line pt-5">
                  {!challengeSolved ? (
                    <div id="portal-challenge" className="rounded border border-warn-line bg-warn-soft p-4">
                      <h2 className="text-sm font-bold text-ink">Verification required before submitting</h2>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                        Stands in for a CAPTCHA or an OTP. CivicSOS never solves or bypasses either — it has no code
                        that could. Only you can clear this.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="select-none rounded border border-line-strong bg-white px-4 py-2 font-mono text-base tracking-[0.35em] text-ink-muted line-through decoration-line-strong">
                          7Q4KD
                        </span>
                        <button
                          type="button"
                          onClick={solveChallenge}
                          className="rounded bg-[#1f3a63] px-5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                        >
                          I have verified
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      id="portal-submit"
                      type="button"
                      disabled={!challengeSolved}
                      onClick={() => setSubmitted(`PRACTICE-${Math.floor(Math.random() * 90000) + 10000}`)}
                      className="rounded bg-[#1f3a63] px-6 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Submit grievance
                    </button>
                    <p className="text-xs text-ink-muted">
                      CivicSOS stops before this button, every time. You press it.
                    </p>
                  </div>
                </div>
              </fieldset>

              {submitted ? (
                <div className="rounded border border-good-line bg-good-soft p-4">
                  <p className="text-sm font-bold text-ink">Practice grievance recorded</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                    Fictional registration number{' '}
                    <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">{submitted}</code>. Nothing was
                    sent anywhere. Paste it back into CivicSOS to see tracking begin, or look it up under{' '}
                    <a href="/practice-portal/status" className="font-medium text-accent underline underline-offset-2">
                      Track Grievance
                    </a>
                    .
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

/**
 * The assistant's own status strip.
 *
 * Says what it did, what it is waiting for, and what it will not do — in the
 * portal, not back in the app, because that is where the citizen is looking.
 */
function AssistPanel({ phase, payload }: { phase: AssistPhase; payload?: SubmissionPayload }) {
  if (!payload) return null;

  return (
    <section
      aria-live="polite"
      className={`rounded border p-4 ${
        phase.kind === 'FILLED' ? 'border-good-line bg-good-soft' : 'border-accent-line bg-accent-soft'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[#1f3a63] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
          CivicSOS assist
        </span>
        <p className="text-[13px] font-semibold text-ink">
          {phase.kind === 'FILLED'
            ? `Filled ${phase.count} field${phase.count === 1 ? '' : 's'} from your case.`
            : 'Preparing…'}
        </p>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink-soft">
        {phase.kind === 'FILLED'
          ? 'Check every field before you submit. CivicSOS has stopped here — it does not solve the verification below and it does not press Submit. This practice portal reaches no authority.'
          : 'Carrying your complaint across…'}
      </p>

      {phase.kind === 'FILLED' && phase.skipped.length > 0 ? (
        <p className="mt-2 text-xs text-ink-muted">Not supported on this form: {phase.skipped.join(', ')}.</p>
      ) : null}
    </section>
  );
}

function PortalField({
  id,
  label,
  value,
  onChange,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-semibold text-ink">
        {label} {required ? <span className="text-bad">*</span> : null}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded border border-line-strong bg-white px-3 py-2 text-[13.5px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
      />
    </div>
  );
}
