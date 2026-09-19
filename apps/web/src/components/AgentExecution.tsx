'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentStep } from '@/lib/types';
import { Badge, Card, Dot, Spinner } from './ui';
import { IconCheck, IconClose, IconShield, IconSparkle } from './icons';

/**
 * The agent execution screen.
 *
 * This is where the product's promise becomes visible: the citizen watches
 * CivicSOS do the work instead of being told that it will.
 *
 * The motion here represents real state, not decoration. Every step shown has
 * already been executed and returned by the server; the component reveals them
 * one at a time so the sequence is legible, then stops. There is no fake
 * progress bar that outruns the work, and no endless typing animation — if the
 * run failed at step four, step four is where it stops and says why.
 */

/** How long each completed step is held before the next appears. */
const REVEAL_MS = 420;

export interface AgentExecutionProps {
  steps: AgentStep[];
  /** True while the request is still in flight. */
  running: boolean;
  /** Called once every step has been revealed. */
  onRevealed?: () => void;
  title?: string;
  subtitle?: string;
}

export function AgentExecution({
  steps,
  running,
  onRevealed,
  title = 'CivicSOS is handling it.',
  subtitle = "Sit back. We're taking care of the repetitive work.",
}: AgentExecutionProps) {
  const [revealed, setRevealed] = useState(0);
  const notified = useRef(false);

  // Reveal the returned steps in sequence. Respects reduced-motion by showing
  // everything at once rather than animating.
  useEffect(() => {
    if (steps.length === 0) {
      setRevealed(0);
      notified.current = false;
      return;
    }

    const reducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      setRevealed(steps.length);
      return;
    }

    const timer = window.setInterval(() => {
      setRevealed((current) => {
        if (current >= steps.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, REVEAL_MS);

    return () => window.clearInterval(timer);
  }, [steps]);

  useEffect(() => {
    if (!running && steps.length > 0 && revealed >= steps.length && !notified.current) {
      notified.current = true;
      onRevealed?.();
    }
  }, [onRevealed, revealed, running, steps.length]);

  const visible = steps.slice(0, revealed);
  const pending = running || revealed < steps.length;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-accent-soft/40 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white shadow-card"
            >
              {pending ? <Spinner className="h-[18px] w-[18px]" /> : <IconCheck className="h-5 w-5" />}
            </span>
            <div>
              <p className="text-[15px] font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>
            </div>
          </div>
          <Badge tone="accent" icon={<Dot tone="accent" />}>
            CivicSOS Agent
          </Badge>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {/* Announced as a live region so the sequence is followable without sight. */}
        <ol className="space-y-1" aria-live="polite" aria-busy={pending}>
          {visible.map((step, index) => {
            const isLast = index === steps.length - 1;
            const blocked = step.status === 'BLOCKED';
            const skipped = step.status === 'SKIPPED';

            return (
              <li key={`${step.action}-${index}`} className="rise relative flex gap-3.5 pb-4 last:pb-0">
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={`absolute left-[13px] top-8 h-[calc(100%-1.25rem)] w-0.5 rounded-full ${
                      blocked ? 'bg-line' : 'bg-good-line'
                    }`}
                  />
                ) : null}

                <span
                  aria-hidden="true"
                  className={`relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    blocked
                      ? 'bg-warn-soft text-warn ring-1 ring-inset ring-warn-line'
                      : skipped
                        ? 'bg-surface-sunken text-ink-faint ring-1 ring-inset ring-line-strong'
                        : 'bg-good text-white'
                  }`}
                >
                  {blocked ? <IconClose className="h-3.5 w-3.5" /> : <IconCheck className="h-4 w-4" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${blocked ? 'text-warn' : 'text-ink'}`}>{step.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">{step.detail}</p>
                </div>
              </li>
            );
          })}

          {/* The next step, while it is still coming. */}
          {pending ? (
            <li className="flex gap-3.5">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
              >
                <Spinner className="h-3.5 w-3.5" />
              </span>
              <p className="pt-1 text-sm text-ink-muted">
                {steps[revealed]?.title ?? 'Working…'}
              </p>
            </li>
          ) : null}
        </ol>
      </div>
    </Card>
  );
}

/**
 * The demo-environment disclosure.
 *
 * Shown wherever the agent submits. Not a footnote: a citizen must never come
 * away believing a complaint reached a real authority when it did not.
 */
export function SimulationNotice({ className = '' }: { className?: string }) {
  return (
    <div className={`flex gap-3 rounded-2xl border border-warn-line bg-warn-soft p-4 ${className}`}>
      <IconShield aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warn" />
      <div className="text-sm leading-relaxed text-ink-soft">
        <p className="font-semibold text-ink">Demo submission environment — not a government portal</p>
        <p className="mt-1">
          CivicSOS submitted this into its own simulation so you can see the agent do the work. Nothing was sent to
          any authority, and the reference below is a placeholder, not a real complaint number. The official channel
          for this problem is shown on your case.
        </p>
      </div>
    </div>
  );
}

/**
 * Compact agent status card for the home page.
 *
 * Shows the same four states the real run produces, so the landing page is a
 * demonstration of the product rather than an invented animation.
 */
export function AgentPreviewCard() {
  const lines = [
    { label: 'Understanding your problem', done: true },
    { label: 'Checking evidence', done: true },
    { label: 'Finding the right channel', done: true },
    { label: 'Ready to submit', done: false },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-accent-soft/40 px-5 py-3.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <IconSparkle aria-hidden="true" className="h-[18px] w-[18px] text-accent" />
          CivicSOS Agent
        </p>
        <Badge tone="teal" icon={<Dot tone="teal" />}>
          Working
        </Badge>
      </div>

      <ul className="space-y-3 p-5">
        {lines.map((line) => (
          <li key={line.label} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                line.done ? 'bg-good text-white' : 'bg-accent-soft text-accent ring-1 ring-inset ring-accent-line'
              }`}
            >
              {line.done ? <IconCheck className="h-3.5 w-3.5" /> : <span className="text-[13px]">→</span>}
            </span>
            <span className={line.done ? 'text-ink-soft' : 'font-medium text-ink'}>{line.label}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
