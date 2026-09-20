'use client';

import { useCallback, useState } from 'react';

/**
 * The practice portal's status lookup.
 *
 * The browser worker's counterpart to `/practice-portal`: where that page let
 * the extension's autofill be watched, this one lets the Fargate worker's
 * status check be watched. Same reasoning — the worker's behaviour, especially
 * its refusals, should be observable rather than asserted in a README.
 *
 * Every selector here is mirrored in `packages/core/src/status-check/targets.ts`
 * and checked against this file by the worker's build, so the two cannot drift.
 *
 * The answers are deterministic functions of the reference number, so a demo
 * gives the same result every time. It is not a government website, it holds no
 * complaints, and it looks nothing up.
 */

type Gate = 'none' | 'signin' | 'challenge';

/**
 * Canned outcomes, chosen by the reference's last digit.
 *
 * Deterministic on purpose: a demo that sometimes shows "resolved" and
 * sometimes "not found" is a demo nobody can rehearse.
 */
function lookup(reference: string): { text: string; tone: 'good' | 'warn' | 'bad' } {
  const trimmed = reference.trim();
  if (trimmed.length === 0) return { text: 'Enter a complaint reference.', tone: 'warn' };

  const lastDigit = Number(trimmed.replace(/\D/g, '').slice(-1));
  if (Number.isNaN(lastDigit)) return { text: 'No such complaint on record.', tone: 'bad' };

  if (lastDigit <= 3) return { text: 'Status: Registered — in progress with the ward office.', tone: 'warn' };
  if (lastDigit <= 6) return { text: 'Status: Assigned to a field crew. Under process.', tone: 'warn' };
  if (lastDigit <= 8) return { text: 'Status: Resolved. Closed on site inspection.', tone: 'good' };
  return { text: 'No such complaint on record.', tone: 'bad' };
}

export default function PracticeStatusPage() {
  const [gate, setGate] = useState<Gate>('none');
  const [reference, setReference] = useState('');
  const [result, setResult] = useState<{ text: string; tone: 'good' | 'warn' | 'bad' } | undefined>();

  const run = useCallback(() => {
    setResult(lookup(reference));
  }, [reference]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-2">
      <div className="rounded-2xl border-2 border-warn-line bg-warn-soft p-4">
        <p className="text-sm font-semibold text-ink">Practice environment — not a government website</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          This page is part of CivicSOS. It exists so the status-check worker can be demonstrated and tested without
          touching a real portal. It holds no complaints and looks nothing up — the answers below are canned.
        </p>
      </div>

      {/* Lets the worker's two refusals be triggered on demand. */}
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Demo controls</p>
        <p className="mt-1.5 text-sm text-ink-muted">
          Put a gate in the worker&apos;s way and watch it stop rather than try.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['none', 'No gate'],
              ['signin', 'Require sign-in'],
              ['challenge', 'Require CAPTCHA'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setGate(value)}
              className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
                gate === value
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line-strong bg-surface text-ink-soft hover:border-accent-line'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="border-b border-line bg-surface-sunken px-6 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Municipal services</p>
          <h1 className="mt-1 text-xl font-semibold text-ink">Track your complaint</h1>
        </div>

        <div className="space-y-5 p-6">
          {gate === 'signin' ? (
            <div id="status-signin" className="rounded-xl border border-line bg-surface-soft p-5">
              <h2 className="text-[15px] font-semibold text-ink">Sign in to view a status</h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                The worker reports <code className="rounded bg-surface px-1 py-0.5 text-xs">NEEDS_HUMAN</code> here and
                reads nothing. It has no code that could do otherwise.
              </p>
            </div>
          ) : null}

          {gate === 'challenge' ? (
            <div id="status-challenge" className="rounded-xl border border-line bg-surface-soft p-5">
              <h2 className="text-[15px] font-semibold text-ink">Verify you are human</h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                Stands in for a CAPTCHA. Same behaviour: the worker stops and hands the check back to you.
              </p>
            </div>
          ) : null}

          <fieldset disabled={gate !== 'none'} className="space-y-4 transition-opacity disabled:opacity-40">
            <legend className="sr-only">Complaint lookup</legend>

            <div>
              <label htmlFor="status-reference" className="block text-sm font-medium text-ink">
                Complaint reference number
              </label>
              <input
                id="status-reference"
                name="reference"
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="e.g. SWM/2026/118472"
                className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft"
              />
            </div>

            {/*
              A lookup, not a submission. This registry has no concept of a
              complaint submit button and the worker has no code that presses
              one — reading a status creates no record anywhere.
            */}
            <button
              id="status-lookup"
              type="button"
              onClick={run}
              className="rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Check status
            </button>
          </fieldset>

          <div
            id="status-result"
            role="status"
            aria-live="polite"
            className={`rounded-xl border p-4 text-sm ${
              result?.tone === 'good'
                ? 'border-good-line bg-good-soft text-ink'
                : result?.tone === 'bad'
                  ? 'border-bad-line bg-bad-soft text-ink'
                  : result
                    ? 'border-warn-line bg-warn-soft text-ink'
                    : 'border-line bg-surface-soft text-ink-muted'
            }`}
          >
            {result?.text ?? 'No lookup has been run yet.'}
          </div>
        </div>
      </div>
    </div>
  );
}
