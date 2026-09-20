'use client';

import { useState } from 'react';

/**
 * The CivicSOS practice portal.
 *
 * A deliberately generic complaint form that exists for one reason: the browser
 * assistant's autofill has to be testable and demonstrable somewhere, and that
 * somewhere must not be a real government website.
 *
 * Because CivicSOS owns this page, the extension's mapping for it is *verified*
 * rather than guessed — the selectors are real because they are written here.
 * That is the honest way to ship a working autofill mechanism without inventing
 * selectors for portals nobody has inspected.
 *
 * It borrows no government branding, claims no affiliation, and submits nowhere.
 * The sign-in and CAPTCHA gates are switchable so the assistant's pause-and-wait
 * behaviour can be seen rather than taken on trust.
 */

const FIELD_IDS = {
  category: 'complaint-category',
  subject: 'complaint-subject',
  location: 'complaint-location',
  city: 'complaint-city',
  state: 'complaint-state',
  pincode: 'complaint-pincode',
  description: 'complaint-description',
} as const;

export default function PracticePortalPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [challengeSolved, setChallengeSolved] = useState(false);
  const [submitted, setSubmitted] = useState<string | undefined>();

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-2">
      {/* Unmissable, and first on the page. */}
      <div className="rounded-2xl border-2 border-warn-line bg-warn-soft p-4">
        <p className="text-sm font-semibold text-ink">Practice environment — not a government website</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          This page is part of CivicSOS. It exists so the browser assistant&apos;s autofill can be demonstrated and
          tested without touching a real portal. It is not affiliated with any government body, it submits nothing
          anywhere, and any reference it shows is fictional.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="border-b border-line bg-surface-sunken px-6 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Municipal services</p>
          <h1 className="mt-1 text-xl font-semibold text-ink">Lodge a public grievance</h1>
        </div>

        <div className="space-y-5 p-6">
          {/* Sign-in gate. The assistant waits here rather than acting. */}
          {!signedIn ? (
            <div id="portal-signin" className="rounded-xl border border-line bg-surface-soft p-5">
              <h2 className="text-[15px] font-semibold text-ink">Sign in to continue</h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                A real portal would ask for your credentials here. This one asks for nothing — press the button.
                CivicSOS never fills, reads or stores anything on a sign-in screen.
              </p>
              <button
                type="button"
                onClick={() => setSignedIn(true)}
                className="mt-4 rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Sign in
              </button>
            </div>
          ) : null}

          {/* Challenge gate. Same behaviour: the assistant stops and waits. */}
          {signedIn && !challengeSolved ? (
            <div id="portal-challenge" className="rounded-xl border border-line bg-surface-soft p-5">
              <h2 className="text-[15px] font-semibold text-ink">Verify you are human</h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                Stands in for a CAPTCHA or an OTP. CivicSOS never solves or bypasses either — it waits for you.
              </p>
              <button
                type="button"
                onClick={() => setChallengeSolved(true)}
                className="mt-4 rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                I am human
              </button>
            </div>
          ) : null}

          <fieldset
            disabled={!signedIn || !challengeSolved}
            className="space-y-4 transition-opacity disabled:opacity-40"
          >
            <legend className="sr-only">Complaint details</legend>

            <PortalField id={FIELD_IDS.category} label="Complaint category" />
            <PortalField id={FIELD_IDS.subject} label="Subject" />
            <PortalField id={FIELD_IDS.location} label="Location / landmark" />

            <div className="grid gap-4 sm:grid-cols-3">
              <PortalField id={FIELD_IDS.city} label="City" />
              <PortalField id={FIELD_IDS.state} label="State" />
              <PortalField id={FIELD_IDS.pincode} label="PIN code" />
            </div>

            <div>
              <label htmlFor={FIELD_IDS.description} className="block text-sm font-medium text-ink">
                Complaint details
              </label>
              <textarea
                id={FIELD_IDS.description}
                name="description"
                rows={10}
                className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft"
              />
            </div>

            <div className="rounded-xl border border-dashed border-line-strong bg-surface-soft p-4">
              <label htmlFor="portal-evidence" className="block text-sm font-medium text-ink">
                Attach photographs
              </label>
              <input id="portal-evidence" type="file" multiple className="mt-2 block w-full text-sm text-ink-muted" />
              <p className="mt-2 text-xs text-ink-muted">
                No browser lets a script put files into this box — you attach these yourself, here as on any real
                portal.
              </p>
            </div>

            {/* The control the assistant is written never to click. */}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <button
                id="portal-submit"
                type="button"
                onClick={() => setSubmitted(`PRACTICE-${Math.floor(Math.random() * 90000) + 10000}`)}
                className="rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Submit complaint
              </button>
              <p className="text-xs text-ink-muted">
                CivicSOS stops before this button, every time. You press it.
              </p>
            </div>
          </fieldset>

          {submitted ? (
            <div className="rounded-xl border border-good-line bg-good-soft p-5">
              <p className="text-sm font-semibold text-ink">Practice complaint recorded</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                Fictional reference{' '}
                <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">{submitted}</code>. Nothing was
                sent anywhere. Paste it back into CivicSOS to see the tracking flow begin.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PortalField({ id, label }: { id: string; label: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft"
      />
    </div>
  );
}
