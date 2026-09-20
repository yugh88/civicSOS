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
 * What it will not do, which is the point of practising against it:
 *  - it never submits anywhere; the Submit button produces a local fake number
 *  - the assistant stops at the sign-in gate and resumes only after the citizen
 *    clears it themselves
 *  - the assistant never touches the CAPTCHA, and never presses Submit
 */

/**
 * The portal's own session, so "already signed in" is a state that can exist.
 *
 * localStorage rather than sessionStorage: the portal opens in a new tab every
 * time, and sessionStorage is per-tab — a session established in one tab would
 * be invisible in the next, so the signed-in path could never be reached. A
 * real portal keeps this in a cookie, which is shared across tabs the same way.
 */
const SESSION_KEY = 'civicsos:practice-portal:signed-in';
const CHALLENGE_KEY = 'civicsos:practice-portal:verified';

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

type AssistPhase =
  | { kind: 'IDLE' }
  | { kind: 'WAITING'; reason: string }
  | { kind: 'FILLED'; count: number; skipped: string[] };

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

  /*
   * The portal remembers a signed-in session for the tab.
   *
   * Without this the gate reappears on every visit and "the citizen is already
   * signed in" — the ordinary case on a real portal, and the one where autofill
   * should simply happen — could never be reached or tested.
   */
  const [signedIn, setSignedIn] = useState(false);
  const [challengeSolved, setChallengeSolved] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [submitted, setSubmitted] = useState<string | undefined>();

  useEffect(() => {
    try {
      setSignedIn(localStorage.getItem(SESSION_KEY) === 'true');
      setChallengeSolved(localStorage.getItem(CHALLENGE_KEY) === 'true');
    } catch {
      // Private windows throw; the gates simply show, which is the safe default.
    }
    setSessionLoaded(true);
  }, []);

  const signIn = useCallback(() => {
    setSignedIn(true);
    try {
      localStorage.setItem(SESSION_KEY, 'true');
    } catch {
      /* not worth failing the click over */
    }
  }, []);

  const solveChallenge = useCallback(() => {
    setChallengeSolved(true);
    try {
      localStorage.setItem(CHALLENGE_KEY, 'true');
    } catch {
      /* not worth failing the click over */
    }
  }, []);

  const signOut = useCallback(() => {
    setSignedIn(false);
    setChallengeSolved(false);
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(CHALLENGE_KEY);
    } catch {
      /* nothing to undo */
    }
  }, []);

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

  const gate = useMemo<string | undefined>(() => {
    if (!signedIn) return 'Sign in on this portal and CivicSOS will carry on filling.';
    if (!challengeSolved) return 'Complete the verification below and CivicSOS will carry on filling.';
    return undefined;
  }, [signedIn, challengeSolved]);

  /**
   * Fills the form from the case.
   *
   * Re-runs whenever a gate clears, which is what makes "sign in, then resume"
   * work: the payload is held, nothing is typed while a gate is up, and the
   * moment the citizen clears it themselves the fields populate.
   */
  useEffect(() => {
    if (!payload || filledOnce.current || !sessionLoaded) return;

    if (gate) {
      setPhase({ kind: 'WAITING', reason: gate });
      return;
    }

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
  }, [payload, gate, handoffId, sessionLoaded]);

  const set = useCallback((key: FieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const formDisabled = !signedIn || !challengeSolved;

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
            <p className="mt-1 text-sm font-semibold text-ink">{signedIn ? 'Demo Visitor' : 'Guest'}</p>
            {signedIn ? (
              <button
                type="button"
                onClick={signOut}
                // The session persists per tab, so both halves of the flow can
                // be demonstrated: arriving already signed in, and arriving at
                // a gate. Without a way back there is only ever one of them.
                className="mt-1.5 text-xs font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
              >
                Sign out of the practice portal
              </button>
            ) : null}
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
              {/* Sign-in gate — the assistant waits here rather than acting. */}
              {!signedIn ? (
                <div id="portal-signin" className="rounded border border-accent-line bg-accent-soft p-4">
                  <h2 className="text-sm font-bold text-[#1f3a63]">Sign in to lodge a grievance</h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                    A real portal asks for your credentials here. This one asks for nothing — press the button.
                    CivicSOS never fills, reads or stores anything on a sign-in screen, and will wait until you have
                    finished.
                  </p>
                  <button
                    type="button"
                    onClick={signIn}
                    className="mt-3 rounded bg-[#1f3a63] px-5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Sign in
                  </button>
                </div>
              ) : null}

              {/* Challenge gate — same behaviour, and never solved by CivicSOS. */}
              {signedIn && !challengeSolved ? (
                <div id="portal-challenge" className="rounded border border-warn-line bg-warn-soft p-4">
                  <h2 className="text-sm font-bold text-ink">Verification</h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                    Stands in for a CAPTCHA or an OTP. CivicSOS never solves or bypasses either — it has no code that
                    could, and it waits for you here.
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

              <fieldset disabled={formDisabled} className="transition-opacity disabled:opacity-40">
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

                {/* The control the assistant is written never to press. */}
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
                  <button
                    id="portal-submit"
                    type="button"
                    onClick={() => setSubmitted(`PRACTICE-${Math.floor(Math.random() * 90000) + 10000}`)}
                    className="rounded bg-[#1f3a63] px-6 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Submit grievance
                  </button>
                  <p className="text-xs text-ink-muted">CivicSOS stops before this button, every time. You press it.</p>
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
            : phase.kind === 'WAITING'
              ? phase.reason
              : 'Preparing…'}
        </p>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink-soft">
        {phase.kind === 'FILLED'
          ? 'Check every field before you submit. CivicSOS has stopped — it does not press Submit, and this practice portal reaches no authority.'
          : 'CivicSOS is holding your complaint and will fill the supported fields once you have cleared this step yourself. It never fills a sign-in form and never solves a CAPTCHA.'}
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
